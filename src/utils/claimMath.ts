// Shared claim mathematics for the claim-level loss generators (WC, GL, and
// eventually Property). Every function here is pure and deterministic given
// its inputs; RNG-consuming helpers take an explicit SeededRandom.
//
// The vintage/truncation helpers were extracted verbatim from wcClaimEngine
// (where their invariants were established); the normal CDF pair is new,
// added for GL's liability gate. If a distribution helper is line-specific
// (WC's annuity streams, payout-pattern factors), it stays in that line's
// engine — this module is only for math that must not fork between lines.

import { SeededRandom } from './random';

// --- standard normal CDF and inverse ----------------------------------------

// Phi(x): standard normal CDF via the Abramowitz & Stegun 7.1.26 erf
// approximation (max absolute error ~1.5e-7) — far below any tolerance used
// by the generators (gate pay-rates are specified to two decimals).
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

// Phi^-1(p): Acklam's rational approximation (relative error ~1.15e-9).
// Used for the liability-gate thresholds t_sub = Phi^-1(1 - payRate) and for
// mapping gate quantiles through lognormal inverses.
export function normalInvCdf(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return Number.NEGATIVE_INFINITY;
    if (p === 1) return Number.POSITIVE_INFINITY;
    return Number.NaN;
  }
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// --- lognormal helpers -------------------------------------------------------

// Lognormal parameters from a target mean and coefficient of variation, so
// E[X] is exactly `mean` — which is what lets an analytic expectation use
// `mean` directly and stay matched to the draw.
export function lognormalParams(mean: number, cv: number): { mu: number; sigma: number } {
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  return { mu: Math.log(mean) - (sigma * sigma) / 2, sigma };
}

export function drawLognormal(rng: SeededRandom, mean: number, cv: number): number {
  const { mu, sigma } = lognormalParams(mean, cv);
  return rng.lognormal(mu, sigma);
}

// E[X^k x 1{X <= bound}] for X ~ LogNormal(mean, cv) — the PARTIAL (truncated,
// UNNORMALISED) k-th moment. Note the difference from expectedOverLognormal
// below, which renormalises: this one does not, so partial moments over
// complementary ranges ADD BACK to the full moment. That is what makes it the
// right tool for a capped quantity:
//
//   E[min(b x X, c) x X] = b x E[X^2 1{X <= c/b}] + c x E[X 1{X > c/b}]
//
// and the second term is E[X] - E[X 1{X <= c/b}], with E[X] = mean exactly.
//
// EXACT, NO QUADRATURE. Closed form from the lognormal cgf:
//   E[X^k 1{X <= t}] = exp(k mu + k^2 sigma^2 / 2) x Phi((ln t - mu - k sigma^2)/sigma)
// The only approximation is normalCdf's ~1.5e-7. Prefer this over integrating
// a capped function on a grid whenever the integrand is a power of X times an
// indicator — which is the shape every hazard-intensity factor takes, because
// intensity enters both the event footprint and the damage ratio.
export function lognormalPartialMoment(mean: number, cv: number, k: number, bound: number): number {
  const { mu, sigma } = lognormalParams(mean, cv);
  const fullMoment = Math.exp(k * mu + (k * k * sigma * sigma) / 2);
  if (!(bound > 0)) return 0;
  if (!Number.isFinite(bound)) return fullMoment;
  return fullMoment * normalCdf((Math.log(bound) - mu - k * sigma * sigma) / sigma);
}

// E[min(X, limit)] for X ~ LogNormal(mu, sigma) — the mu/sigma-parameterized
// twin of lognormalPartialMoment above, for callers whose components are
// already stated as (mu, sigma) rather than (mean, cv): WC's and GL's mixture
// components both are. Closed form, no quadrature:
//   E[X ^ L] = exp(mu + s^2/2) x Phi((ln L - mu - s^2)/s) + L x (1 - Phi((ln L - mu)/s))
// Shared by the tower re-derivation diagnostics and both lines' band moments.
// It lives here rather than in a line-specific module so a GL consumer is not
// importing WC-named math — originally moved out of the since-deleted wcIbnr.ts
// for exactly that reason.
export function limitedExpectedValue(mu: number, sigma: number, limit: number): number {
  if (!(limit > 0)) return 0;
  if (!Number.isFinite(limit)) return Math.exp(mu + (sigma * sigma) / 2);
  const z = (Math.log(limit) - mu) / sigma;
  return Math.exp(mu + (sigma * sigma) / 2) * normalCdf(z - sigma) + limit * (1 - normalCdf(z));
}

// --- dollar vintage: DELETED ------------------------------------------------
//
// ⚠ trendToSettlement AND patternTrendFactor ARE GONE, and the reasoning matters
// more than the two functions did, because WORKING_PRACTICES recorded their
// convention as what made retroactive repricing possible at all.
//
// The chain was dead END TO END and had been since 3181b18. trendToSettlement had
// exactly one caller — patternTrendFactor — which had none. WC called
// patternTrendFactor 7 times at 2dc146a and stopped at 3181b18, the commit that
// ADDED the report lag; Property picked it up there and dropped it at 645c15e
// (its mixture was fitted to amounts already trended to 2024, so trending again
// double-counted); GL never called it.
//
// ⚠ AND NO VINTAGE CONVERSION HAPPENS ANYWHERE. Every live
// Math.pow(1 + trend, year - 1) in the generators — WC frequency and severity,
// GL severity, Property's draw trend, exposureTrend's wage inflation — is a LEVEL
// trend that establishes what a year-N accident year costs in year-N dollars. It
// does not convert BETWEEN two vintages. There was no discipline left for these
// to be the single point of.
//
// THEY WERE KEPT ONCE, AS "the right primitive for the shock repricing that is
// next", AND THAT WAS WRONG. IBNER gives shocks a simpler route: add a term to
// the development step and every open accident year reprices at once, surfacing
// as adverse development — which is how social inflation actually appears in a
// triangle. The reserve walk moves the ESTIMATE, not the claim's vintage, and
// that is the more defensible mechanic as well as the simpler one: the claims did
// not change, what they are expected to cost did.
//
// If a shock ever has to restate the CLAIM REGISTER itself, that wants vintage
// conversion and it is twenty lines. Keeping a dead primitive against a design
// that has not been written is how dead code accumulates.

// --- truncated lognormal (the divergence guard) --------------------------------

// E[f(X)] for X ~ LogNormal(mean, cv) TRUNCATED at upperBound, by
// deterministic quadrature over the underlying normal. Needed where f is
// non-linear (a report lag entering as an exponent), so the analytic
// expectation stays matched to the draw rather than evaluating f at the mean.
//
// The truncation RENORMALISES: both the numerator and the weight accumulate
// only over x <= upperBound, giving E[f(X) | X <= upperBound]. Integrating the
// numerator over the truncated range while normalising by the FULL density
// would under-weight the result and silently break the draw/expectation match
// — the draw rejects-and-redraws, so it samples the renormalised density.
//
// ⚠ LOGNORMAL ONLY. This is a FIXED-GRID quadrature over the underlying normal,
// and it is correct here precisely because a lognormal density is bounded and
// smooth on that grid. It is NOT a general-purpose expectation routine, and it
// is the thing someone will reach for when a new distribution turns up.
//
// It fails silently on any density with an interior or endpoint SINGULARITY —
// notably Beta(a, b) with a < 1, whose density goes as t^(a-1) and is unbounded
// at 0. Property's attritional damage ratio is Beta(0.08, 1.92): a fixed grid
// through that spike underestimates the mass near zero, deflating the CDF and
// inflating the survival function. That exact mistake produced 21.8 per-risk
// breaches/yr against a true 1.78 — a 12x error that looked entirely plausible
// until it was checked against Monte Carlo.
//
// For Beta quantities use the closed form where one exists (E[X] = mu under the
// mean-concentration parameterization) or Monte Carlo otherwise. See
// SeededRandom.beta in random.ts.
export function expectedOverLognormal(
  mean: number,
  cv: number,
  f: (x: number) => number,
  upperBound = Number.POSITIVE_INFINITY,
): number {
  const { mu, sigma } = lognormalParams(mean, cv);
  const POINTS = 20_000;
  const Z_LIMIT = 8;
  let weighted = 0;
  let weight = 0;
  const step = (2 * Z_LIMIT) / POINTS;
  for (let i = 0; i < POINTS; i++) {
    const z = -Z_LIMIT + (i + 0.5) * step;
    const x = Math.exp(mu + sigma * z);
    if (x > upperBound) continue;
    const density = Math.exp(-0.5 * z * z);
    weighted += density * f(x);
    weight += density;
  }
  return weight > 0 ? weighted / weight : f(Math.exp(mu));
}

// --- pure-function-of-year memoization ---------------------------------------

// Wraps a function of a single year into one backed by a module-level Map, so
// a function evaluated repeatedly at the SAME year — the per-claim severity
// draw in both claim generators, the per-member cumulant loops behind the CLF
// grids, the tower's own pricing pass before it got its own cache — costs one
// hash lookup after the first call for that year, forever.
//
// A plain Map keyed on the exact number, not a fixed-size array, because the
// year range is unbounded and includes NEGATIVE years (the pre-game runs at
// year -2): a Map lazily grows to hold only the years actually requested, with
// no offset arithmetic and no upper bound to guess wrong.
//
// `keyOf` lets the caller fold a floor into the CACHE KEY, not just the
// returned value. wcSeverityTrend/glSeverityTrend/wageFactor all floor at year
// 1 (`Math.pow(rate, Math.max(1, year) - 1)`), so years -2, -1, 0 and 1
// already return an IDENTICAL number — passing `keyOf: y => Math.max(1, y)`
// makes them share one cache entry instead of four. wcFrequencyTrend does NOT
// floor (the pre-game is deliberately allowed to run frequency hotter — see
// its own header), so it is memoized with the default identity key: year -2
// gets its own entry because it genuinely is a different value.
//
// ⚠ keyOf IS A CACHE-EFFICIENCY OPTIMISATION ONLY, NEVER THE SOURCE OF
// CORRECTNESS. On a miss, `fn` is called with the RAW year, not the key — so
// `fn` MUST apply its own floor internally, exactly as the original
// unmemoized body did (`Math.pow(rate, Math.max(1, year) - 1)`, not
// `Math.pow(rate, year - 1)` with the floor left to `keyOf`). If `fn` trusted
// `keyOf` to have already floored, whichever raw year happened to populate a
// given slot first — -2, -1, 0 or 1, in whatever order the game calls them —
// would silently decide that slot's value from the wrong exponent.
export function memoizeByYear(
  fn: (year: number) => number,
  keyOf: (year: number) => number = year => year,
): (year: number) => number {
  const cache = new Map<number, number>();
  return (year: number) => {
    const key = keyOf(year);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = fn(year);
    cache.set(key, value);
    return value;
  };
}
