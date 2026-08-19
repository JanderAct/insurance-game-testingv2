// The per-occurrence tower's arithmetic: cap -> retention -> layers, plus the
// runtime-computed aggregate stop-loss price.
//
// Pure and side-effect free. Nothing here draws randomness — the layering is a
// deterministic function of occurrence totals, and the aggregate price is a
// deterministic function of the selection and the exposure.
//
// EROSION FALLS OUT OF THE ARITHMETIC — no mechanic, and none is needed.
// cedeToLayer is independent per layer and per occurrence, so:
//   - a DECLINED layer is retained automatically; nothing has to model that
//   - a CORRIDOR RETENTION (buying $15M xs $10M while declining $5M xs $5M) needs
//     no special case: the middle band simply is not ceded
//   - a large occurrence "erodes through" a retained corridor before reaching a
//     purchased upper layer, purely from the min/max
// The one thing that does NOT fall out is reinstatements, because there is no
// annual limit to reinstate — see the simplification note in reinsuranceTower.ts.

import {
  AGG_ATTACHMENT_LEVELS,
  AGG_LIMIT_MULTIPLE,
  REINSURANCE_TOWER,
  RISK_LOAD_LAMBDA,
  TOWER_TOP,
  type TowerLine,
} from '../data/reinsuranceTower';
import { lognormalPartialMoment } from './claimMath';
import { allLayerRiskMoments, layerRiskMoments, retainedRiskMoments } from './towerMoments';
import type { Claim, CoverageLine, Member, Occurrence } from '../types/simulation';

export const isTowerLine = (line: CoverageLine): line is TowerLine => line === 'WC' || line === 'GL';

// --- the waterfall (J14) ----------------------------------------------------

// One claim's contribution to its occurrence total. Neither line caps
// anything at generation time: WC never did, and GL's statutory cap was
// deleted with the sub-coverage rebuild (the fitted mixture comes from claims
// already realized under real-world caps — applying one on top would
// double-count, the same reasoning that removed GL_SOCIAL_INFLATION's
// trend-to-settlement step). This function now exists only because
// occurrenceTotals needs a uniform per-claim accessor across lines, not
// because the two lines differ.
export function claimContribution(c: Claim): number {
  return c.grossUltimate;
}

// Occurrence totals — the unit the tower attaches to. Occurrence == claim for
// both WC and GL now (GL's multi-claimant abuse batches were deleted with the
// sub-coverage rebuild), so every occurrence sums exactly one claim — this
// function stays line-agnostic rather than special-cased to 1:1, since
// nothing prevents a future multi-claim occurrence from returning.
export function occurrenceTotals(claims: Claim[], occurrences: Occurrence[]): number[] {
  const byId = new Map(claims.map(c => [c.id, c]));
  return occurrences.map(o => {
    let total = 0;
    for (const id of o.claimIds) {
      const c = byId.get(id);
      if (c) total += claimContribution(c);
    }
    return total;
  });
}

export const cedeToLayer = (total: number, attachment: number, limit: number) =>
  Math.max(0, Math.min(total - attachment, limit));

export interface OccurrenceCession {
  cededByLayer: number[];   // index-aligned to REINSURANCE_TOWER[line]
  totalCeded: number;
  retained: number;         // everything the pool keeps, all bands
  retainedAboveTower: number;
}

// Apply the tower to one year's occurrences. `placed[i]` false = that band is
// retained.
export function cedeOccurrences(
  line: TowerLine,
  totals: number[],
  placed: boolean[],
): OccurrenceCession {
  const layers = REINSURANCE_TOWER[line];
  const cededByLayer = layers.map(() => 0);
  let totalCeded = 0, gross = 0, retainedAboveTower = 0;
  for (const t of totals) {
    gross += t;
    layers.forEach((l, i) => {
      // A layer that is not purchasable cannot be placed even if the flag says
      // so — belt and braces against a stale save or a hand-edited decision.
      if (!placed[i] || !l.purchasable) return;
      const c = cedeToLayer(t, l.attachment, l.limit);
      cededByLayer[i] += c;
      totalCeded += c;
    });
    retainedAboveTower += Math.max(0, t - TOWER_TOP[line]);
  }
  return { cededByLayer, totalCeded, retained: gross - totalCeded, retainedAboveTower };
}

// --- occurrence-layer pricing ----------------------------------------------
//
// premium = E[ceded] + lambda x SD[ceded], BOTH COMPUTED AT RUNTIME from the
// enrolled book and the current year (src/utils/towerMoments.ts), in real drawn
// dollars. This replaced two stored per-layer constants, and the reason is in
// towerMoments.ts's header: `expectedCededPer100` froze legitimately (a
// per-occurrence layer is linear in exposure) but drifted with the severity
// trend, while `sdOverExpected` never froze legitimately at all — it scales as
// ~1/sqrt(exposure), so freezing it undercharged small pools by ~20% and
// overcharged the full market by ~25%.
//
// ⚠ NO exposurePer100 ARGUMENT ANY MORE, and that is the trend fix. The old
// signature multiplied a frozen per-$100 rate by NOMINAL (wage-inflated)
// exposure, so the premium grew at the wage rate (3.63%/yr) while the actual
// ceded loss grew with the SEVERITY trend through a convex layer — 22% to 41%
// faster over a decade on GL, 17% on WC's top layer. The reinsurer handed over
// increasing value for free and the gap widened every year. Computing E[ceded]
// directly from the book removes the mismatch by construction: there is no
// longer a second, differently-trending quantity for the price to be stated in.
export function layerPremium(line: TowerLine, layerIndex: number, members: Member[], yearNumber: number): number {
  const m = layerRiskMoments(line, layerIndex, members, yearNumber);
  return m.expected + RISK_LOAD_LAMBDA * m.sd;
}

export function expectedCededForLayer(line: TowerLine, layerIndex: number, members: Member[], yearNumber: number): number {
  return layerRiskMoments(line, layerIndex, members, yearNumber).expected;
}

export interface OccurrenceProgramQuote {
  // What the reinsurer charges: E[ceded] + lambda x SD[ceded], summed over the
  // PLACED layers.
  premium: number;
  // The SAME E[ceded], WITHOUT the risk load, summed over the same placed
  // layers. Returned rather than recomputed by the caller because it is already
  // the first term of `premium` — one number, one derivation, and the two can
  // therefore never drift apart.
  //
  // ⚠ THIS IS WHAT THE POOL PREMIUM IS NETTED DOWN BY. The pool funds the loss
  // it will actually keep, so expected ceded has to come off the contribution;
  // charging it AND the reinsurance premium on top collected the ceded portion
  // twice. It reflects `placed`, which is the load-bearing part: decline a layer
  // and its expected ceded stays in the pool premium, because the pool is then
  // keeping that loss.
  expectedCeded: number;
}

// ONE pass over the book for the whole program, not one per layer — see
// allLayerRiskMoments. Pricing three layers separately walked the member list
// three times and re-resolved each member's rating group and lambda each time.
export function occurrenceProgramCost(
  line: TowerLine, placed: boolean[], members: Member[], yearNumber: number,
): OccurrenceProgramQuote {
  const moments = allLayerRiskMoments(line, members, yearNumber);
  let premium = 0, expectedCeded = 0;
  REINSURANCE_TOWER[line].forEach((l, i) => {
    if (!(placed[i] && l.purchasable)) return;
    premium += moments[i].expected + RISK_LOAD_LAMBDA * moments[i].sd;
    expectedCeded += moments[i].expected;
  });
  return { premium, expectedCeded };
}

// --- the aggregate stop-loss, priced from the selected configuration --------

export const layerMask = (placed: boolean[]) =>
  placed.reduce((m, on, i) => on ? m | (1 << i) : m, 0);

export interface AggregateQuote {
  attachment: number;
  limit: number;
  expectedRetained: number;
  sdRetained: number;
  expectedCeded: number;
  premium: number;
}

// E[(R - a)+ - (R - b)+] and its second moment, for R lognormal with the given
// mean and CV. Closed form via partial moments — no quadrature, and no
// simulation at runtime.
function layerMoments(mean: number, cv: number, a: number, b: number) {
  const M0a = lognormalPartialMoment(mean, cv, 0, a), M0b = lognormalPartialMoment(mean, cv, 0, b);
  const M1a = lognormalPartialMoment(mean, cv, 1, a), M1b = lognormalPartialMoment(mean, cv, 1, b);
  const M2a = lognormalPartialMoment(mean, cv, 2, a), M2b = lognormalPartialMoment(mean, cv, 2, b);
  const width = b - a;
  // E[C], C = min(max(R-a,0), b-a)
  const e1 = (M1b - M1a) - a * (M0b - M0a) + width * (1 - M0b);
  // E[C^2]
  const e2 = (M2b - M2a) - 2 * a * (M1b - M1a) + a * a * (M0b - M0a) + width * width * (1 - M0b);
  const variance = Math.max(0, e2 - e1 * e1);
  return { expected: Math.max(0, e1), sd: Math.sqrt(variance) };
}

// Quote the WC aggregate for a given occurrence-layer selection. `level` indexes
// AGG_ATTACHMENT_LEVELS; expectedGrossLoss is the line's own E[gross].
//
// ============================================================================
// TWO DEFECTS FIXED HERE, AND THE SECOND ONE IS NOT A TREND PROBLEM.
//
// 1. THE STORED SECOND MOMENT WAS FROZEN AT YEAR-1 DOLLARS.
//    WC_RETAINED_SECOND_MOMENT[mask] was measured once and indexed by placement
//    bitmask. Retained loss is a SECOND moment, so it grows roughly as trend^2 —
//    the stored table understated SD[R] by more every year, making the aggregate
//    progressively cheaper in real terms exactly as the risk it covers grew.
//    Now computed from retainedRiskMoments, which integrates the piecewise-linear
//    retained function band by band in closed form at the current year.
//
// 2. lambda WAS ON THE WRONG EXPOSURE BASIS — independent of trend, and it would
//    have survived any re-measurement of the table.
//    The old line was `lambda = AGG_OCC_FREQ_PER_1M x exposureMillions`, where
//    exposureMillions is NOMINAL (wage-inflated) exposure. But WC's occurrence
//    COUNT tracks REAL (frozen) payroll x wcFrequencyTrend — payroll growth here
//    is pure wage inflation, and letting claim counts rise with it would assert
//    that paying people more injures more of them (the exact defect lineHelpers'
//    getMemberExposure header warns about, and finding 37's class). So modelled
//    lambda grew at 3.63%/yr while true lambda grew at the frequency trend.
//    Worse, E[R] was derived from the correctly-trended expectedGrossLoss while
//    SD[R] came from this incorrectly-trended lambda, so the CV fed to the
//    lognormal was wrong in a way NEITHER INPUT REVEALED ALONE.
//    retainedRiskMoments reads each member's real payroll and the line's own
//    wcFrequencyTrend, so there is no separate frequency constant to be on the
//    wrong basis.
//
// WHAT IS DELIBERATELY UNCHANGED: E[R] is still derived as
// (expectedGrossLoss - ceded by the placed layers) rather than taken from
// retainedRiskMoments directly. That keeps the existing "the two cannot drift"
// property — E[R] and the layer prices come from one arithmetic — and keeps E[R]
// on the engine's own actual-risk-quality basis. Only the CV comes from the
// neutral-RQ moment machinery, because a RATIO is far less basis-sensitive than
// either moment alone: the neutral and actual bases differ by a few percent on
// each moment and by very little on their quotient.
//
// AGG_OVERDISPERSION IS GONE. It was a 1.05 fudge back-solved to widen a pure
// -Poisson SD into the measured one, compensating for per-member Gamma frequency
// noise that the stored table could not represent. retainedRiskMoments carries
// that noise analytically (the B2 term), so multiplying by 1.05 on top would now
// double-count it.
// ============================================================================
export function quoteAggregate(
  placed: boolean[],
  members: Member[],
  expectedGrossLoss: number,
  level: number,
  yearNumber: number,
): AggregateQuote {
  const effective = placed.map((on, i) => on && REINSURANCE_TOWER.WC[i].purchasable);

  // m1 is DERIVED from the layer prices rather than measured separately, so the
  // two cannot drift: retained = gross - everything the occurrence layers cede.
  // ONE moment pass for all layers — expectedCededForLayer per layer would walk
  // the book three times for the same numbers.
  const layerMoms = allLayerRiskMoments('WC', members, yearNumber);
  const cededByPlaced = REINSURANCE_TOWER.WC.reduce((s, _l, i) =>
    s + (effective[i] ? layerMoms[i].expected : 0), 0);
  const expectedRetained = Math.max(1, expectedGrossLoss - cededByPlaced);

  // CV from the runtime moments; SD rescaled onto the engine's own E[R].
  const retained = retainedRiskMoments('WC', effective, members, yearNumber);
  const sdRetained = expectedRetained * retained.sdOverExpected;

  const attachment = expectedRetained * AGG_ATTACHMENT_LEVELS[level];
  const limit = expectedRetained * AGG_LIMIT_MULTIPLE;
  const { expected, sd } = layerMoments(expectedRetained, sdRetained / expectedRetained, attachment, attachment + limit);

  return {
    attachment, limit, expectedRetained, sdRetained,
    expectedCeded: expected,
    // SAME risk-load parameter as the occurrence layers. One market view across
    // the whole program, not a second knob for the aggregate.
    premium: expected + RISK_LOAD_LAMBDA * sd,
  };
}

// What the aggregate actually pays on a realized year. The aggregate sits on
// RETAINED loss, so it is applied AFTER the occurrence layers.
export const aggregateRecovery = (retained: number, q: AggregateQuote) =>
  cedeToLayer(retained, q.attachment, q.limit);

// Coerce a possibly-absent or wrong-length placement array from a save or a
// hand-edited decision into a valid one. Missing -> ALL PURCHASABLE LAYERS
// PLACED, matching the default-on-load rule (see App.tsx).
export function normalizeLayersPlaced(line: TowerLine, placed: boolean[] | undefined): boolean[] {
  const layers = REINSURANCE_TOWER[line];
  if (!placed || placed.length !== layers.length) return layers.map(l => l.purchasable);
  return layers.map((l, i) => !!placed[i] && l.purchasable);
}
