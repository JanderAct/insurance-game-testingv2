// WC's OWN loss-distribution shape, replacing the shared FUNDING_CLF_TABLE for
// WC pricing (finding 38). GL and Property are untouched — see the header on
// src/data/wcClfGrid.ts for why, and for the process-risk-only caveat that
// governs this whole module (do not "correct" any of it toward
// FUNDING_CLF_TABLE's numbers — the two measure different phenomena).
//
// TWO PARTS:
//   1. wcAggregateCumulants — the analytic mean and CV of the aggregate
//      annual gross loss, for a given enrolled book. VERIFIED against Monte
//      Carlo at three book sizes (mean and CV both landed inside the MC 95%
//      CI); this is what the grid interpolation below is indexed on.
//   2. computeWcClf — the percentile lookup itself. A first attempt used a
//      Cornish-Fisher expansion off this module's own skewness/kurtosis, and
//      it failed: WC's skewness (18-42, driven by the deliberately
//      heavy-tailed `large` severity component) is far outside where a
//      cumulant-polynomial correction to the normal quantile is valid, and it
//      produced NEGATIVE loss percentiles. computeWcClf now interpolates a
//      Monte Carlo percentile GRID (src/data/wcClfGrid.ts) on the book's own
//      CV instead — no closed form, no failure mode, and monotonic by
//      construction (interpolating two monotonic curves at matched
//      percentile stops stays monotonic).
//
// THE CUMULANT DERIVATION (mean/CV), for the record: the aggregate loss for a
// book of enrolled members is a SUM OF INDEPENDENT MEMBER PROCESSES, so its
// cumulants are the SUM of each member's own cumulants (cumulants are
// additive under independent summation). Each member's own process is a
// Gamma-mixed compound Poisson: a Poisson count PER SEVERITY COMPONENT,
// jointly thinned by memberFrequencyNoise (Gamma(shape=16, mean=1),
// multiplying every component's rate for that member SIMULTANEOUSLY — a
// bad-frequency-year member draws more of everything, not one component in
// isolation), with severity drawn from that component's lognormal. Its
// cumulant generating function is
//   K(t) = -alpha * ln(1 - C(t)/alpha),  C(t) = Lambda_member * (M_severity(t) - 1)
// where C(t)'s Taylor coefficients (c_1..c_4) are Lambda_member x the RAW
// MOMENTS of severity (the standard compound-Poisson identity kappa_k =
// lambda x E[X^k]). Expanding K(t) to O(t^4) and reading off kappa_k = k! x
// [t^k] K(t) gives, in terms of that member's own c_1..c_4:
//
//   kappa_1 = c1
//   kappa_2 = c2 + c1^2/alpha
//   kappa_3 = c3 + 3 c1 c2/alpha + 2 c1^3/alpha^2
//   kappa_4 = c4 + 4 c1 c3/alpha + 3 c2^2/alpha + 12 c1^2 c2/alpha^2 + 6 c1^4/alpha^3
//
// As alpha -> infinity this reduces to kappa_k = c_k exactly, the ordinary
// compound-Poisson result. kappa_3/kappa_4 are still computed here (skewness,
// excessKurtosis on WcAggregateCumulants) because they were part of the
// verified derivation and cost nothing extra to expose — they are simply not
// fed into a Cornish-Fisher expansion any more.

import type { Member } from '../types/simulation';
import { WC_LOSS_MODEL, WC_SEVERITY_COMPONENTS } from '../data/defaultAssumptions';
import { WC_CLF_GRID, WC_CLF_PERCENTILE_STOPS } from '../data/wcClfGrid';
import {
  ratingGroupOf,
  regionMultiplier,
  thetaWc,
  tiltedWeights,
  trendedMu,
  wcFrequencyTrend,
} from './wcClaimEngine';

const M = WC_LOSS_MODEL;
// The Gamma shape parameter behind memberFrequencyNoise (mean 1, so scale =
// 1/shape). Read from the model rather than restated, so a future change to
// the noise's dispersion is picked up here automatically.
const ALPHA = M.memberFrequencyNoise.shape;

// k-th raw moment of a lognormal(mu, sigma) draw: E[X^k] = exp(k*mu + k^2 sigma^2/2).
function lognormalRawMoment(mu: number, sigma: number, k: number): number {
  return Math.exp(k * mu + (k * k * sigma * sigma) / 2);
}

// One member's c_1..c_4 — Lambda_i x (raw moment) summed over that member's
// mixture components, AT THEIR OWN risk quality (tilted weights, matching the
// actual draw) and region. This is the "as if epsilon = 1" compound-Poisson
// seed the Gamma correction below operates on.
function memberRawCumulantSeeds(member: Member, kLine: number, yearNumber: number): [number, number, number, number] {
  const payroll = member.exposureByLine.WC ?? 0;
  const c: [number, number, number, number] = [0, 0, 0, 0];
  if (payroll <= 0) return c;

  const rq = member.riskQuality;
  const group = ratingGroupOf(member);
  const spec = M.ratingGroups[group];
  const regionMult = regionMultiplier(member.region);
  const theta = thetaWc(rq);
  const trend = wcFrequencyTrend(yearNumber);
  const weights = tiltedWeights(group, rq);

  for (let i = 0; i < spec.mix.length; i++) {
    const lambdaI = payroll * spec.ratePer1M * theta * kLine * trend * weights[i];
    if (lambdaI <= 0) continue;
    const comp = WC_SEVERITY_COMPONENTS[spec.mix[i].component];
    for (let k = 1; k <= 4; k++) {
      // TRENDED, so the cumulants describe the same distribution the draw
      // produces. The k-th raw moment scales as s^k, so kappa_1 -> s x kappa_1
      // and kappa_2 -> s^2 x kappa_2 — and CV = sqrt(kappa_2)/kappa_1 is
      // therefore UNCHANGED. See the note on the CLF grid's interpolation axis.
      c[k - 1] += lambdaI * Math.pow(regionMult, k) * lognormalRawMoment(trendedMu(comp.mu, yearNumber), comp.sigma, k);
    }
  }
  return c;
}

// Gamma-mixed-Poisson correction: turns one member's "as if epsilon=1"
// compound-Poisson seeds into their TRUE cumulants, per the derivation above.
function memberCumulants(c: [number, number, number, number]): [number, number, number, number] {
  const [c1, c2, c3, c4] = c;
  const k1 = c1;
  const k2 = c2 + (c1 * c1) / ALPHA;
  const k3 = c3 + (3 * c1 * c2) / ALPHA + (2 * c1 ** 3) / (ALPHA * ALPHA);
  const k4 =
    c4 +
    (4 * c1 * c3) / ALPHA +
    (3 * c2 * c2) / ALPHA +
    (12 * c1 * c1 * c2) / (ALPHA * ALPHA) +
    (6 * c1 ** 4) / (ALPHA * ALPHA * ALPHA);
  return [k1, k2, k3, k4];
}

export interface WcAggregateCumulants {
  mean: number;      // kappa_1 — E[gross annual loss], draw basis (tilted, k_line-adjusted)
  variance: number;  // kappa_2
  kappa3: number;
  kappa4: number;
  cv: number;
  skewness: number;         // kappa_3 / kappa_2^1.5 — VERIFIED, no longer used for percentiles
  excessKurtosis: number;   // kappa_4 / kappa_2^2 — VERIFIED, no longer used for percentiles
}

// EXPORTED so the derivation/verification scripts (and any future audit) can
// recompute this exactly. `cv` is what computeWcClf interpolates the grid on.
export function wcAggregateCumulants(members: Member[], kLine: number, yearNumber: number): WcAggregateCumulants {
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
  for (const member of members) {
    const seeds = memberRawCumulantSeeds(member, kLine, yearNumber);
    const [mk1, mk2, mk3, mk4] = memberCumulants(seeds);
    k1 += mk1; k2 += mk2; k3 += mk3; k4 += mk4;
  }
  const sd = Math.sqrt(Math.max(0, k2));
  return {
    mean: k1,
    variance: k2,
    kappa3: k3,
    kappa4: k4,
    cv: k1 > 0 ? sd / k1 : 0,
    skewness: k2 > 0 ? k3 / Math.pow(k2, 1.5) : 0,
    excessKurtosis: k2 > 0 ? k4 / (k2 * k2) : 0,
  };
}

// Nearest of WC_CLF_PERCENTILE_STOPS to the requested percent (0-100 scale).
// Mirrors lookupCLF's own nearest-key behaviour, so a confidenceLevel that
// does not land exactly on a stop (legacy saves, future UI values) degrades
// the same way the old table did rather than throwing or interpolating
// across percentiles (WC's slider only ever offers these 20 exact stops).
function nearestStop(pct: number): number {
  let best: number = WC_CLF_PERCENTILE_STOPS[0];
  let bestDiff = Math.abs(pct - best);
  for (const s of WC_CLF_PERCENTILE_STOPS) {
    const diff = Math.abs(pct - s);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}

// Linear interpolation of one percentile stop's ratio across WC_CLF_GRID,
// indexed on CV (see wcClfGrid.ts for why CV was chosen over
// 1/sqrt(exposure)). Clamped to the nearest grid endpoint outside
// [minCv, maxCv] — the grid spans the enrollable range; extrapolating a
// linear trend past measured bounds risks doing worse than clamping.
function interpolateGridRatio(cv: number, stop: number): number {
  const sorted = [...WC_CLF_GRID].sort((a, b) => a.cv - b.cv);
  if (cv <= sorted[0].cv) return sorted[0].ratios[stop];
  const last = sorted[sorted.length - 1];
  if (cv >= last.cv) return last.ratios[stop];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (cv >= a.cv && cv <= b.cv) {
      const w = (cv - a.cv) / (b.cv - a.cv);
      return a.ratios[stop] + w * (b.ratios[stop] - a.ratios[stop]);
    }
  }
  return last.ratios[stop];
}

// THE REPLACEMENT FOR lookupCLF, FOR WC ONLY.
//
// CLF(p) = interpolated_percentile_ratio(p, currentBook's CV)
//
// Each grid entry's ratios are already normalized to THAT book's own
// analytic expected loss, so the interpolated ratio is directly the
// multiplier the engine needs — no separate reconciliation against the
// current book's expectedLoss is required (the same dimensionless-multiplier
// contract lookupCLF already has for GL/Property).
export function computeWcClf(confidenceLevel: number, members: Member[], kLine: number, yearNumber: number): number {
  const cv = wcAggregateCumulants(members, kLine, yearNumber).cv;
  const stop = nearestStop(confidenceLevel * 100);
  return interpolateGridRatio(cv, stop);
}

// THE "Expected" MARKER'S POSITION — where does this book's own grid curve
// cross ratio = 1.000? Built on the SAME interpolateGridRatio the percentile
// stops above use, at every stop, then linearly interpolated BETWEEN stops on
// the (monotonic, by construction — see wcClfGrid.ts) ratio-vs-percentile
// curve. Deliberately NOT a separate formula: computeWcClf and this function
// must never be able to drift apart, since "Expected" is defined as "wherever
// this line's own grid says CLF=1.000 falls," not as an independently
// estimated number that happens to usually agree.
//
// Returns a 0-1 fraction (0.672 for "67.2%"), clamped to the grid's own stop
// range if the book's CV puts break-even outside the measured curve (the same
// clamp-past-the-ends contract interpolateGridRatio itself uses).
export function wcClfCrossingPercentile(members: Member[], kLine: number, yearNumber: number): number {
  const cv = wcAggregateCumulants(members, kLine, yearNumber).cv;
  const stops = WC_CLF_PERCENTILE_STOPS;
  const ratios = stops.map(s => interpolateGridRatio(cv, s));
  for (let i = 0; i < ratios.length - 1; i++) {
    if (ratios[i] <= 1 && ratios[i + 1] >= 1) {
      const w = ratios[i + 1] === ratios[i] ? 0 : (1 - ratios[i]) / (ratios[i + 1] - ratios[i]);
      return (stops[i] + w * (stops[i + 1] - stops[i])) / 100;
    }
  }
  return (ratios[0] > 1 ? stops[0] : stops[stops.length - 1]) / 100;
}
