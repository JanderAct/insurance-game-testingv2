// WC IBNR — the reporting pattern, its loss-development factors, and the
// chain-ladder provision booked at accident year.
//
// THIS IS THE FIRST CLAIM-LEVEL INPUT TO THE RESERVE. Everything else in the
// reserve rollforward is a flat factor: `currentYearNetReserve` is
// `netUltimateLoss x 0.60` and the cohorts pay down on a per-line percentage.
// This module puts a real, parameter-derived quantity on the balance sheet, and
// is a genuine step into Phase 3 territory rather than a display change.
//
// ---------------------------------------------------------------------------
// WHY CHAIN-LADDER RATHER THAN "EXPECTED UNREPORTED DOLLARS"
// ---------------------------------------------------------------------------
//
//   IBNR(accident year Y) = actual reported to date x (LDF(age) - 1)
//
// The alternative — book `sum over components of w_i x p_i x mean_i x claims`,
// the expected unreported dollars — is algebraically IDENTICAL IN EXPECTATION.
// It behaves differently though: chain-ladder conditions on what ACTUALLY
// reported, so a year that reports heavy books a heavier IBNR. The reserve
// becomes responsive to experience instead of a fixed fraction of an assumed
// ultimate, which is what a real reserve does. It is also the shape that
// accommodates IBNER later without rework.
//
// ---------------------------------------------------------------------------
// ⚠ ACCRUAL AND BALANCE ARE DIFFERENT NUMBERS AND BOTH APPEAR IN THE SPEC
// ---------------------------------------------------------------------------
//
//   annual accrual        17.1% of the year's loss   what you ADD each year
//   steady-state balance  0.599x annual loss         what SITS on the sheet
//
// They differ by the MEAN LAG (3.5 years), and that relationship is Little's
// Law — inventory = arrival rate x time in system. Ten people join a queue each
// minute and each waits three minutes, so thirty are in the queue. It is forced,
// not observed.
//
// Two failure modes, both silent:
//   - Book the BALANCE as the ACCRUAL. Pours in 3.5x what drains out, settles
//     at roughly 2.5x the correct level, and reads as ordinary conservative
//     reserving.
//   - Book the ACCRUAL as the BALANCE. Under-reserved 3.5x, showing up as
//     persistent adverse development against an inadequate provision.
//
// ---------------------------------------------------------------------------
// ⚠ DO NOT GATE ON 0.599 — CONVERGENCE IS STRUCTURAL
// ---------------------------------------------------------------------------
//
// At game year N only N accident years are open, so the balance CANNOT exceed
// `p x sum over t = 0..N-1 of (1 - F(t))`. A 5-year run reaches 0.443, a 26%
// shortfall on entirely correct code. Gating a realized level against 0.599
// would fail on correct code — the same fixed-percentage failure mode this
// project has hit four times.
//
// GATE ON LITTLE'S LAW INSTEAD: `balance / (accrual x mean lag)` approaches 1
// from below and must never exceed it. That holds from year 2 regardless of the
// transient, and under the balance-as-accrual failure it reads ~3.5 from turn
// one. Assert the ratio, report the level. See littlesLawRatio below.

import {
  WC_LOSS_MODEL,
  WC_SEVERITY_COMPONENTS,
  type WcComponentKey,
} from '../data/defaultAssumptions';
import { REINSURANCE_TOWER } from '../data/reinsuranceTower';
import { lognormalParams, normalCdf } from './claimMath';
import type { Member } from '../types/simulation';
import { ratingGroupOf, regionMultiplier, tiltedWeights, trendedMu } from './wcClaimEngine';

const M = WC_LOSS_MODEL;

// --- the reporting pattern ----------------------------------------------------

// F(t) = P(report lag <= t years), for the lag `round(1 + lognormal(mean, cv))`.
//
// The rounding is what puts the 0.5 in here: lag <= t iff 1 + LN < t + 0.5 iff
// LN < t - 0.5. At t = 0 that bound is negative, so F(0) = 0 — every delayed
// claim is delayed by at least a full year, by construction.
export function reportLagCdf(t: number): number {
  if (t < 1) return 0;
  const { mu, sigma } = lognormalParams(M.reportLag.meanYears, M.reportLag.cv);
  return normalCdf((Math.log(t - 0.5) - mu) / sigma);
}

// E[lag] for the ROUNDED lag, by the tail-sum identity for a non-negative
// integer variable: E[L] = sum over t >= 0 of (1 - F(t)).
//
// Computed rather than asserted at 3.5. E[1 + LN] is exactly 3.5, but the
// rounding perturbs it slightly, and the Little's Law gate divides by this
// number — so it has to be the model's own value, not the pre-rounding one.
export const MEAN_REPORT_LAG_YEARS = (() => {
  let sum = 0;
  // 400 years is far past convergence: the lag's 1-in-100 is ~22 years and its
  // thin tail reaches ~57.
  for (let t = 0; t < 400; t++) sum += 1 - reportLagCdf(t);
  return sum;
})();

// Fraction of an accident year's ULTIMATE dollars reported by age t, given the
// dollar-weighted delayed share p. Age 0 is the accident year itself.
export function reportedFractionByAge(age: number, pDelayed: number): number {
  return (1 - pDelayed) + pDelayed * reportLagCdf(age);
}

// The loss-development factor to ultimate at age t — the reciprocal of the
// above. This is what makes the lag parameters TESTABLE against real triangles:
// on the pool's own mix it runs 1.2063 at age 0 tailing to 1.0079 at age 10, so
// a 12-month incurred LDF near 1.21 confirms them and one near 1.45 would imply
// p_delayed nearer 31% than 17%.
export function ldfToUltimate(age: number, pDelayed: number): number {
  const reported = reportedFractionByAge(age, pDelayed);
  return reported > 0 ? 1 / reported : 1;
}

// --- the dollar-weighted delayed share ----------------------------------------

// Expected value of min(X, limit) for X ~ lognormal(mu, sigma). Closed form,
// no quadrature:
//   E[X ^ L] = exp(mu + s^2/2) x Phi((ln L - mu - s^2)/s) + L x (1 - Phi((ln L - mu)/s))
export function limitedExpectedValue(mu: number, sigma: number, limit: number): number {
  if (!(limit > 0)) return 0;
  if (!Number.isFinite(limit)) return Math.exp(mu + (sigma * sigma) / 2);
  const z = (Math.log(limit) - mu) / sigma;
  return Math.exp(mu + (sigma * sigma) / 2) * normalCdf(z - sigma) + limit * (1 - normalCdf(z));
}

// Expected RETAINED severity of one claim of this component, after the
// per-occurrence tower cedes to whichever layers are placed.
//
// EXACT FOR WC because WC emits exactly one claim per occurrence, so the layer
// attaches to the claim amount itself.
//
// ⚠ THIS DEPENDS ONLY ON THE LAYER STRUCTURE (attachments and limits), NOT on
// REINSURANCE_TOWER's measured `expectedCededPer100` constants. Those are
// measured OUTPUTS of the old generator and are invalidated by this change; the
// attachments and limits are not, and are unchanged. That is what lets commit 1
// book a correct NET balance sheet without waiting for the tower re-derivation.
//
// THE AGGREGATE STOP-LOSS IS DELIBERATELY EXCLUDED. It attaches to a whole
// year's total retained loss, so it is not a property of any single claim, and
// the year in which a delayed claim eventually reports has its own aggregate
// that will respond then. Netting it here would double-count that recovery.
export function retainedComponentMean(
  component: WcComponentKey,
  regionMult: number,
  layersPlaced: boolean[],
  yearNumber: number,
): number {
  const c = WC_SEVERITY_COMPONENTS[component];
  // regionMult scales the claim, so fold it into mu rather than scaling the
  // limited expectations — a limit does not scale with region.
  const mu = trendedMu(c.mu, yearNumber) + Math.log(regionMult);
  const sigma = c.sigma;
  let retained = Math.exp(mu + (sigma * sigma) / 2);
  const layers = REINSURANCE_TOWER.WC;
  for (let i = 0; i < layers.length; i++) {
    if (!layersPlaced[i]) continue;
    const l = layers[i];
    retained -= limitedExpectedValue(mu, sigma, l.attachment + l.limit) - limitedExpectedValue(mu, sigma, l.attachment);
  }
  return Math.max(0, retained);
}

// The book's dollar-weighted delayed share — the `p` every function above takes.
//
// ⚠ IT IS NOT A CONSTANT 0.171. That figure is the FULL CANONICAL ROSTER on a
// GROSS basis. It differs by group (Schools 5.0%, County 17.3%, Low Safety
// 17.4%, High Safety 17.7%), so a book with a different mix has a different
// pattern — and it differs again on a NET basis, because delayed dollars are
// concentrated in the `large` component, which is exactly what the tower cedes.
// Computing it from the actual book is both more correct and no harder.
//
// `layersPlaced` empty (or all false) gives the GROSS share.
// yearNumber carries the SEVERITY TREND into the netting. The layer bounds are
// fixed dollars while severity inflates, so the retained share of a claim — and
// therefore the delayed share of NET dollars — drifts slowly over a game. Small,
// but it is the same fixed-attachment effect the tower constants have, and
// hiding it behind a year-1 default would make it invisible.
export function dollarWeightedPDelayed(members: Member[], layersPlaced: boolean[], yearNumber: number): number {
  let delayed = 0;
  let total = 0;
  for (const member of members) {
    const payroll = member.exposureByLine.WC ?? 0;
    if (payroll <= 0) continue;
    const group = ratingGroupOf(member);
    const g = M.ratingGroups[group];
    const regionMult = regionMultiplier(member.region);
    // The RQ severity tilt moves the mix toward the heavy component, which is
    // also the delayed-heavy one, so it genuinely moves the reporting pattern.
    const weights = tiltedWeights(group, member.riskQuality);
    const lambda = payroll * g.ratePer1M;
    for (let i = 0; i < g.mix.length; i++) {
      const key = g.mix[i].component;
      const perClaim = retainedComponentMean(key, regionMult, layersPlaced, yearNumber);
      const dollars = lambda * weights[i] * perClaim;
      total += dollars;
      delayed += dollars * WC_SEVERITY_COMPONENTS[key].pDelayed;
    }
  }
  return total > 0 ? delayed / total : 0;
}

// --- the provision -------------------------------------------------------------

// What one accident year contributes to the IBNR balance, and what the whole
// balance is.
//
// `reported` is NET reported-to-date for that accident year, and `pDelayed` is
// the NET dollar-weighted share MEASURED IN THAT ACCIDENT YEAR — stored per year
// rather than recomputed, because the book's mix and its reinsurance placement
// both change, and the pattern that applies to a 2027 accident year is 2027's.
export interface WcAccidentYearReported {
  yearNumber: number;
  netReported: number;
  pDelayedNet: number;
}

export function accidentYearIbnr(entry: WcAccidentYearReported, currentYear: number): number {
  const age = currentYear - entry.yearNumber;
  if (age < 0) return 0;
  return entry.netReported * (ldfToUltimate(age, entry.pDelayedNet) - 1);
}

export function wcIbnrBalance(entries: WcAccidentYearReported[], currentYear: number): number {
  return entries.reduce((s, e) => s + accidentYearIbnr(e, currentYear), 0);
}

// THE GATE. balance / (mean accrual x mean lag) approaches 1 FROM BELOW and must
// never exceed it, from year 2 onward, regardless of where in the transient the
// game is. Returns null when there is no accrual to divide by.
//
// ⚠ `meanAccrual` MUST BE THE AVERAGE OVER THE OPEN ACCIDENT YEARS, NOT ONE
// YEAR'S. Little's Law is L = lambda x W, and lambda is an average ARRIVAL RATE.
// A single year's accrual is proportional to that year's reported loss, which on
// a book with a blended CV above 11 swings by a factor of three — dividing a
// smoothly accumulated balance by one volatile year produces spikes above 1 that
// mean nothing about the reserve. Measured on this book, a single-year
// denominator peaked at 2.47 in a light-reporting year while the balance was
// entirely correct.
export function littlesLawRatio(balance: number, meanAccrual: number): number | null {
  const denominator = meanAccrual * MEAN_REPORT_LAG_YEARS;
  if (!(denominator > 0)) return null;
  return balance / denominator;
}
