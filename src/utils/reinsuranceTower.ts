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

import { GL_STATUTORY_CAP } from '../data/defaultAssumptions';
import {
  AGG_ATTACHMENT_LEVELS,
  AGG_LIMIT_MULTIPLE,
  AGG_OCC_FREQ_PER_1M,
  AGG_OVERDISPERSION,
  REINSURANCE_TOWER,
  RISK_LOAD_LAMBDA,
  TOWER_TOP,
  WC_RETAINED_SECOND_MOMENT,
  type TowerLine,
} from '../data/reinsuranceTower';
import { lognormalPartialMoment } from './claimMath';
import type { Claim, CoverageLine, Occurrence } from '../types/simulation';

export const isTowerLine = (line: CoverageLine): line is TowerLine => line === 'WC' || line === 'GL';

// --- the waterfall (J14) ----------------------------------------------------

// One claim's contribution to its occurrence total. WC has no cap. GL caps
// INDEMNITY ONLY and only on stateLaw, then adds ALAE UNCAPPED — so defense
// costs can carry a capped claim into the treaty. Transposing these two is the
// easy mistake; the order here is cap-indemnity, then add ALAE.
export function claimContribution(c: Claim, line: CoverageLine): number {
  if (line !== 'GL') return c.grossUltimate;
  const indemnity = c.indemnity ?? 0;
  const capped = c.legalBasis === 'stateLaw' ? Math.min(indemnity, GL_STATUTORY_CAP) : indemnity;
  return capped + (c.alae ?? 0);
}

// Occurrence totals — the unit the tower attaches to. A GL abuse batch is one
// occurrence across several claimant claims and the treaty sees their sum.
export function occurrenceTotals(claims: Claim[], occurrences: Occurrence[], line: CoverageLine): number[] {
  const byId = new Map(claims.map(c => [c.id, c]));
  return occurrences.map(o => {
    let total = 0;
    for (const id of o.claimIds) {
      const c = byId.get(id);
      if (c) total += claimContribution(c, line);
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

// premium = E[ceded] + lambda x SD[ceded], with both scaled off the measured
// per-$100-of-exposure constants. Linear in exposure, which is exactly why the
// constants can be frozen (see their derivation note).
export function layerPremium(line: TowerLine, layerIndex: number, exposurePer100: number): number {
  const l = REINSURANCE_TOWER[line][layerIndex];
  const expected = l.expectedCededPer100 * exposurePer100;
  return expected * (1 + RISK_LOAD_LAMBDA * l.sdOverExpected);
}

export function expectedCededForLayer(line: TowerLine, layerIndex: number, exposurePer100: number): number {
  return REINSURANCE_TOWER[line][layerIndex].expectedCededPer100 * exposurePer100;
}

export function occurrenceProgramCost(line: TowerLine, placed: boolean[], exposurePer100: number): number {
  return REINSURANCE_TOWER[line].reduce((s, l, i) =>
    s + (placed[i] && l.purchasable ? layerPremium(line, i, exposurePer100) : 0), 0);
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
export function quoteAggregate(
  placed: boolean[],
  exposureMillions: number,
  expectedGrossLoss: number,
  level: number,
): AggregateQuote {
  const exposurePer100 = exposureMillions * 1e6 / 100;
  const lambda = AGG_OCC_FREQ_PER_1M * exposureMillions;
  const mask = layerMask(placed.map((on, i) => on && REINSURANCE_TOWER.WC[i].purchasable));

  // m1 is DERIVED from the frozen per-layer constants rather than stored, so the
  // two cannot drift: retained = gross - everything the occurrence layers cede.
  const cededByPlaced = REINSURANCE_TOWER.WC.reduce((s, l, i) =>
    s + ((mask & (1 << i)) ? l.expectedCededPer100 * exposurePer100 : 0), 0);
  const expectedRetained = Math.max(1, expectedGrossLoss - cededByPlaced);

  const m2 = WC_RETAINED_SECOND_MOMENT[mask] ?? WC_RETAINED_SECOND_MOMENT[0];
  const sdRetained = AGG_OVERDISPERSION * Math.sqrt(lambda * m2);

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
