// GL's OWN loss-distribution shape, replacing the shared FUNDING_CLF_TABLE for
// GL pricing — the same mismatch WC's grid fixed (wcLossDistribution.ts,
// wcClfGrid.ts). FUNDING_CLF_TABLE is the real pool's curve at $20-30B of
// payroll, where process risk gives an annual loss-ratio CV near 0.063 against
// the table's implied ~0.80 — parameter/trend uncertainty this model has no
// channel for, not claim variance. GL's own process CV runs 0.83-4.3 across the
// enrollable range (see glClfGrid.ts), so the SAME table mismatches GL's curve
// in the OPPOSITE direction from WC's: WC's grid narrowed the table, GL's
// widens it. PROCESS RISK ONLY here — do not "correct" this module toward
// FUNDING_CLF_TABLE's numbers; see wcClfGrid.ts's header for the full argument,
// unchanged by which line it's applied to.
//
// TWO PARTS, mirroring wcLossDistribution.ts:
//   1. glAggregateCumulants — the analytic mean, variance and expected CLAIM
//      COUNT (lambda) of the aggregate annual gross loss, for a given enrolled
//      book. lambda, NOT CV, is what the grid interpolation is indexed on (see
//      glClfGrid.ts for why CV was rejected for GL specifically, unlike WC).
//   2. computeGlClf — the percentile lookup, interpolating a Monte Carlo
//      percentile GRID (src/data/glClfGrid.ts) on lambda.
//
// ============================================================================
// THE CUMULANT DERIVATION, for the record — and it is NOT a copy of WC's.
//
// GL has a THIRD source of variance WC's module has no equivalent for: gPool,
// the pool-wide loss factor every GL draw consumes (WC's own commonLossFactor
// is pinned to 1 at the severity rebuild, so WC's cumulants have no analogous
// term — see simulationEngine.ts's commonLossFactor comment). gPool is drawn
// ONCE per year and multiplies EVERY member's rate SIMULTANEOUSLY, so it does
// NOT diversify away with book size the way independent per-member frequency
// noise does — it is a SHARED risk factor, not an idiosyncratic one, and it
// requires a genuinely different piece of cumulant algebra: a law-of-total-
// variance mixture over a common factor, not a per-member sum.
//
// Per member i (payroll > 0), define the deterministic rate
//   lambda_i = payroll_i x ratePer1M x thetaGl(rq_i) x kGl
// (excludes risk control, per invariant 2, and excludes gPool/frequency-noise —
// those are the two random multipliers being mixed out below) and, at the
// member's own TILTED (draw-matching) weights and this year's dollars, the
// CAPPED severity raw moments m1_i = E[min(X,cap)], m2_i = E[min(X,cap)^2].
//
// CONDITIONAL ON g (one realization of gPool), member i's own frequency noise
// epsilon_i ~ Gamma(shape=8, mean=1) is INDEPENDENT across members (separate
// RNG stream per member.id), so conditional on g the members are independent
// and each one's own cumulants follow the ORDINARY compound-Poisson-Gamma
// result (WC's derivation, restated per member, with the rate scaled by g):
//   kappa_1,i(g) = lambda_i x g x m1_i
//   kappa_2,i(g) = lambda_i x g x m2_i + (lambda_i x g x m1_i)^2 / alpha_freq
// Summing over independent members (still conditional on g):
//   E[S|g]   = g x A1,             A1 = sum_i lambda_i x m1_i
//   Var(S|g) = g x A2 + g^2 x B2,  A2 = sum_i lambda_i x m2_i
//                                  B2 = sum_i (lambda_i x m1_i)^2 / alpha_freq
//
// NOW MIX OVER g ~ Gamma(shape=25, mean=1) (WC_LOSS_MODEL.poolYearFactor — the
// SAME shared draw GL's generator consumes and WC's does not), via the law of
// total variance, E[g]=1, E[g^2]=Var(g)+1=1+Vg, Vg=1/25=0.04:
//   E[S]   = E_g[g x A1] = A1
//   Var(S) = E_g[Var(S|g)] + Var_g[E(S|g)]
//          = A2 x E[g] + B2 x E[g^2] + A1^2 x Var(g)
//          = A2 + B2 x (1 + Vg) + A1^2 x Vg
//
// The (1+Vg) weight on B2 and the A1^2 x Vg term are exactly what a per-member
// derivation (correct for WC, wrong for GL) would MISS — gPool correlates every
// member's outcome, so its contribution to variance does not average down as
// the book grows, unlike ordinary idiosyncratic frequency noise.
//
// VERIFIED against Monte Carlo at the full roster with an honest CI — see
// gl-clf-grid-derive.ts's dedicated section. This was NOT POSSIBLE before the
// severity cap: uncapped, half of E[X^2] came from above $1.42B, once per 5,182
// years, so no feasible sample could touch the region the analytic most needed
// checking. Capped, half comes from above $58.0M, once per ~15 full-market
// years — thousands of such claims in a half-million-draw run.
// ============================================================================

import type { Member } from '../types/simulation';
import { GL_LOSS_MODEL, GL_SEVERITY_COMPONENTS, WC_LOSS_MODEL } from '../data/defaultAssumptions';
import { limitedExpectedValue, normalCdf } from './claimMath';
import { glSeverityCap, thetaGl, tiltedGlWeights, trendedMuGl } from './glClaimEngine';
import { GL_CLF_GRID, GL_CLF_PERCENTILE_STOPS } from '../data/glClfGrid';

const M = GL_LOSS_MODEL;
// The shared gPool factor's variance: Gamma(shape, 1/shape) has mean 1,
// variance 1/shape. Read from the model rather than restated, so a future
// change to gPool's dispersion is picked up here automatically.
const VG = 1 / WC_LOSS_MODEL.poolYearFactor.shape;
// The Gamma shape behind GL's OWN per-member frequency noise (mean 1).
const ALPHA_FREQ = M.memberFrequencyNoise.shape;

// Capped raw moments (1st and 2nd) of the tilted mixture at a member's own
// weights, this year's trended dollars. E[min(X,cap)^2] via the standard
// lognormal-truncated-second-moment identity (same form used throughout the
// severity-cap verification: exp(2mu+2sigma^2) x Phi(...) + cap^2 x (1-Phi(...))).
function cappedRawMoments(weights: number[], yearNumber: number): [number, number] {
  let m1 = 0, m2 = 0;
  // THAT YEAR'S ceiling, not the year-1 constant — it trends with the mixture
  // this function is integrating, so both moments scale by s^k exactly and the
  // CV this feeds stays trend-invariant. See glSeverityCap.
  const cap = glSeverityCap(yearNumber);
  const lnCap = Math.log(cap);
  for (let i = 0; i < GL_SEVERITY_COMPONENTS.length; i++) {
    const c = GL_SEVERITY_COMPONENTS[i];
    const mu = trendedMuGl(c.mu, yearNumber);
    const s2 = c.sigma * c.sigma;
    m1 += weights[i] * limitedExpectedValue(mu, c.sigma, cap);
    m2 += weights[i] * (
      Math.exp(2 * mu + 2 * s2) * normalCdf((lnCap - mu - 2 * s2) / c.sigma)
      + cap * cap * (1 - normalCdf((lnCap - mu) / c.sigma))
    );
  }
  return [m1, m2];
}

export interface GlAggregateCumulants {
  lambda: number;    // expected annual claim COUNT — what the grid is indexed on
  mean: number;      // E[gross annual loss], draw basis (tilted, k_GL-adjusted, gPool-neutral E[g]=1)
  variance: number;
  cv: number;
}

// EXPORTED so the derivation/verification scripts can recompute this exactly.
// `lambda` is what computeGlClf interpolates the grid on; `cv` is reported
// alongside for diagnostics and is NOT the interpolation key (see glClfGrid.ts).
export function glAggregateCumulants(members: Member[], kGl: number, yearNumber: number): GlAggregateCumulants {
  let lambdaTotal = 0, A1 = 0, A2 = 0, B2 = 0;
  for (const member of members) {
    const payroll = member.exposureByLine.GL ?? 0;
    if (payroll <= 0) continue;
    const rq = member.riskQuality;
    const lambda_i = payroll * M.ratePer1M * thetaGl(rq) * kGl;
    if (lambda_i <= 0) continue;
    const [m1, m2] = cappedRawMoments(tiltedGlWeights(rq), yearNumber);
    lambdaTotal += lambda_i;
    A1 += lambda_i * m1;
    A2 += lambda_i * m2;
    B2 += (lambda_i * m1) * (lambda_i * m1) / ALPHA_FREQ;
  }
  const variance = A2 + B2 * (1 + VG) + A1 * A1 * VG;
  return {
    lambda: lambdaTotal,
    mean: A1,
    variance,
    cv: A1 > 0 ? Math.sqrt(Math.max(0, variance)) / A1 : 0,
  };
}

// Nearest of GL_CLF_PERCENTILE_STOPS to the requested percent (0-100 scale).
// Mirrors lookupCLF's own nearest-key behaviour and wcLossDistribution's
// nearestStop — same degrade-gracefully contract for a confidenceLevel that
// does not land exactly on a stop.
function nearestStop(pct: number): number {
  let best: number = GL_CLF_PERCENTILE_STOPS[0];
  let bestDiff = Math.abs(pct - best);
  for (const s of GL_CLF_PERCENTILE_STOPS) {
    const diff = Math.abs(pct - s);
    if (diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}

// Linear interpolation of one percentile stop's ratio across GL_CLF_GRID,
// indexed on LAMBDA (expected annual claim count) — see glClfGrid.ts for why
// this axis was chosen over CV for GL specifically. Clamped to the nearest
// grid endpoint outside [minLambda, maxLambda], same reasoning as WC's grid:
// extrapolating a linear trend past measured bounds risks doing worse than
// clamping.
function interpolateGridRatio(lambda: number, stop: number): number {
  const sorted = [...GL_CLF_GRID].sort((a, b) => a.lambda - b.lambda);
  if (lambda <= sorted[0].lambda) return sorted[0].ratios[stop];
  const last = sorted[sorted.length - 1];
  if (lambda >= last.lambda) return last.ratios[stop];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (lambda >= a.lambda && lambda <= b.lambda) {
      const w = (lambda - a.lambda) / (b.lambda - a.lambda);
      return a.ratios[stop] + w * (b.ratios[stop] - a.ratios[stop]);
    }
  }
  return last.ratios[stop];
}

// THE REPLACEMENT FOR lookupCLF, FOR GL ONLY.
//
// CLF(p) = interpolated_percentile_ratio(p, currentBook's lambda)
//
// Each grid entry's ratios are already normalized to THAT reference book's own
// analytic expected loss on the k_GL (drawn-matching) basis — which is asserted
// in gl-clf-grid-derive.ts to equal exactly what the engine's held-rate pricing
// formula computes for that book, so the interpolated ratio is directly the
// multiplier the engine needs (same dimensionless-multiplier contract lookupCLF
// and computeWcClf already have).
export function computeGlClf(confidenceLevel: number, members: Member[], kGl: number, yearNumber: number): number {
  const lambda = glAggregateCumulants(members, kGl, yearNumber).lambda;
  const stop = nearestStop(confidenceLevel * 100);
  return interpolateGridRatio(lambda, stop);
}

// THE "Expected" MARKER'S POSITION — mirrors wcClfCrossingPercentile exactly,
// on GL's own lambda-indexed grid. Built on the SAME interpolateGridRatio
// computeGlClf calls, at every stop, then linearly interpolated between stops
// on the (monotonic by construction) ratio-vs-percentile curve — never a
// separately derived number, so it cannot drift from what computeGlClf itself
// would report at that same percentile.
//
// Returns a 0-1 fraction, clamped to the grid's own stop range past either end.
export function glClfCrossingPercentile(members: Member[], kGl: number, yearNumber: number): number {
  const lambda = glAggregateCumulants(members, kGl, yearNumber).lambda;
  const stops = GL_CLF_PERCENTILE_STOPS;
  const ratios = stops.map(s => interpolateGridRatio(lambda, s));
  for (let i = 0; i < ratios.length - 1; i++) {
    if (ratios[i] <= 1 && ratios[i + 1] >= 1) {
      const w = ratios[i + 1] === ratios[i] ? 0 : (1 - ratios[i]) / (ratios[i + 1] - ratios[i]);
      return (stops[i] + w * (stops[i + 1] - stops[i])) / 100;
    }
  }
  return (ratios[0] > 1 ? stops[0] : stops[stops.length - 1]) / 100;
}
