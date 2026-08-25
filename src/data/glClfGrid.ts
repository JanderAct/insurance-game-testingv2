// GL's OWN loss-distribution percentile grid — replaces FUNDING_CLF_TABLE for
// GL pricing, the same mismatch WC's grid fixed (finding 38, then GL). MEASURED
// ONCE by Monte Carlo, then held — same convention as GL_HELD_PURE_PREMIUM_PER_100,
// WC_CLF_GRID and FUNDING_CLF_TABLE itself.
//
// ============================================================================
// PROCESS RISK ONLY. DO NOT "CORRECT" THIS TOWARD FUNDING_CLF_TABLE.
//
// See wcClfGrid.ts's header for the full argument — FUNDING_CLF_TABLE measures
// the real pool's parameter/trend uncertainty at $20-30B of payroll (process CV
// ~0.063), a phenomenon this model has no channel for and cannot validate or be
// validated by. GL's OWN process CV runs 0.47-2.12 across the enrollable range
// below — wider than WC's, not narrower — so the SAME generic table mismatches
// GL's curve in the OPPOSITE direction: WC's derived grid narrowed the generic
// table, GL's widens it at the tail (see the EXPANSION note below) while
// actually narrowing it at the 60% default (GL's aggregate loss is heavily
// right-skewed, so its 60th percentile sits noticeably below its mean even
// though its tail runs far above).
// ============================================================================
//
// HOW IT WAS MEASURED: scripts/diagnostics/gl-clf-grid-derive.ts drives
// generateGlClaims directly (single-year draws — valid because GL's severity
// trend prices via glCappedSeverityTrend, which is exactly the capped
// analytic's own growth rate, so drawn/expected is year-invariant), 150,000
// draws per reference book, at nine reference books spanning the enrollable
// range. Each book's own percentiles are stored as ratios to THAT book's own
// analytic expected loss (on the k_GL / drawn-matching basis — see the
// DENOMINATOR note below), at the same 20 stops WC's grid uses.
//
// ============================================================================
// INDEXED ON LAMBDA (expected annual claim count), NOT CV — A DELIBERATE
// DEPARTURE FROM WC's RECIPE, RULED.
//
// WC's grid is CV-indexed because CV is trend-invariant there — the entire
// load-bearing argument at wcClfGrid.ts's header. That argument does NOT
// survive GL's severity cap (GL_SEVERITY_CAP, $100M): the ceiling is FIXED
// while severity inflates, so it is a SHRINKING share of an inflating
// distribution and the CAPPED per-claim CV measurably drifts with the year
// (gl-claim-check.ts section 2c(iv) measures this rather than asserting
// invariance). Indexing a grid on a quantity that itself slides with trend is
// exactly the failure CV-indexing was chosen to prevent for WC, so CV is
// disqualified for GL specifically.
//
// LAMBDA is what CV is a function of anyway (annual CV falls roughly as
// 1/sqrt(lambda) at fixed severity CV — visible in the table below), and it is
// trend-invariant BY CONSTRUCTION rather than by proof: GL frequency reads
// REAL (frozen) payroll and has no frequency trend at all (flat by design), so
// lambda for a book's real composition does not move as wages or severity
// inflate. It is already computed as part of every expected-loss calculation
// (glAggregateCumulants), so indexing on it costs nothing extra at runtime.
//
// ============================================================================
// REFERENCE BOOKS: STRATIFIED BY TARGET EXPOSURE, DECILE ROUND-ROBIN — WC's
// recipe, restated for GL, with the SAME two rejected alternatives (even-
// spaced-by-headcount, largest-first) for the same reasons; see
// wc-clf-grid-derive.ts's header for the full argument.
//
// ⚠ A DIFFERENT STRATIFY_SEED THAN WC's, AND NOT THE FIRST ONE TRIED. GL's nine
// targets are spaced far more tightly at the low end than WC's seven ever were
// (evenly in 1/sqrt(exposure) down to $50M vs WC's $100M floor). At that
// spacing a single large member's payroll addition can jump exposure past TWO
// adjacent targets in one round-robin step, landing two "different" grid
// points on the IDENTICAL book with no error, just two rows of the same
// numbers. WC's own seed (20260815) and the first one tried for GL (20260817)
// both did this; seed 99991 is the first of eight tried that resolves all nine
// targets to genuinely distinct books (asserted by construction in the
// derivation script, not just eyeballed).
//
// Worst deviation from the roster's own mean payroll: 10.4% (within the 15%
// tolerance WC's recipe uses).
//
// ============================================================================
// THE DENOMINATOR: expectedGlGrossLossForKLine, NOT expectedGlGrossLossForPricing
// — a deliberate departure from a LITERAL copy of WC's describeBook, and
// correctly so.
//
// WC's own derivation normalizes by expectedWcGrossLossForPricing (untilted
// severity, real per-member RQ for frequency) because WC's rating-group
// structure means no simpler identity is available. GL is FLAT-RATED — no
// rating groups, no per-type relativity — which makes a STRONGER identity
// available and provable: expectedGlGrossLossForKLine(book, {kGl:
// computeKGl(book), year}) is EXACTLY what GL_HELD_PURE_PREMIUM_PER_100's
// held-rate pricing formula computes for that SAME book, for ANY real
// (non-neutral) risk-quality mix — not an approximation. This follows from two
// facts together: the k_GL invariant (fixed at 72ecaa0) and GL's flat rate
// meaning the neutral-RQ per-dollar expectation is IDENTICAL across all books
// regardless of composition. expectedGlGrossLossForPricing (untilted) does NOT
// have this property at a book's real RQ mix — using it would have baked a
// silent, composition-dependent bias into the grid's overall level, not just
// its shape. ASSERTED, not assumed: gl-clf-grid-derive.ts checks this identity
// at all 11 reference books (9 grid + 2 held-out) — worst relative deviation
// 8.88e-16.
//
// ============================================================================
// THE ANALYTIC CUMULANTS MODULE (glAggregateCumulants, glLossDistribution.ts)
// WAS ITSELF WRONG ONCE DURING THIS DERIVATION, AND THE FIX MATTERS BEYOND
// THIS FILE.
//
// A first attempt at this grid fixed gPool: 1 in every Monte Carlo call
// (copied from gl-claim-check.ts's neutral-book sections, which pin it
// deliberately to isolate OTHER effects — correct there, wrong here). E[gPool]
// = 1 so the analytic MEAN was unaffected (matched to 0.016%) — but gPool
// contributes real variance (Var = 1/25) that a fixed gPool cannot produce,
// and the dedicated ANALYTIC CV vs MONTE CARLO CV check (in the derivation
// script, at the full roster with a bootstrap CI — newly possible under the
// severity cap; see its own header for why) caught it directly: analytic CV
// 0.4747 fell OUTSIDE a gPool=1 Monte Carlo run's bootstrap CI of [0.4293,
// 0.4326] (measured 0.4310). Once gPool was drawn from its actual Gamma(25,
// 1/25) distribution in every Monte Carlo call, analytic and Monte Carlo
// agreed exactly: MC cv 0.4748 against analytic 0.4747, bootstrap CI [0.4732,
// 0.4764]. The entire grid below was measured AFTER that fix. This is the
// check that mattered most for this derivation, because the gPool-mixing
// algebra is the one piece of GL's cumulants module with no WC equivalent to
// copy from (WC pins its own commonLossFactor to 1), so nothing else could
// have caught an error in it.
//
// ============================================================================
// SAMPLE SIZE: 150,000 draws per book, RE-DERIVED AGAINST THE CAPPED
// DISTRIBUTION, NOT WC's 50,000.
//
// A replicate study (8 independent batches per candidate N, at the smallest
// -- $50M, highest CV -- and largest -- $1300M, lowest CV -- reference books)
// measured the sample relative standard error of the 99th-percentile ratio
// directly, rather than assuming WC's alpha_eff-based formula (sized against
// the UNCAPPED tail, alpha~1.41) carried over to a distribution whose severity
// CV fell 29.55 -> 13.68 and whose annual CV more than halved:
//
//   book $50M (cv 2.12):   n=50k 3.17%   n=100k 1.11%   n=150k 1.78%   n=250k 1.20%
//   book $1300M (cv 0.47): n=50k 0.86%   n=100k 0.61%   n=150k 0.56%
//
// The $50M figures bounce around an underlying 1/sqrt(n) trend rather than
// falling on it cleanly — expected noise from only 8 replicates (the relSE
// ESTIMATE itself carries ~27% relative noise at that replicate count).
// 150,000 was chosen as the point closest to the ~1% target on the worse
// (smaller, higher-CV) book once that noise is accounted for, landing in the
// same relative-residual range WC's own held-out validation tolerated (WC's
// worst absolute residual, 0.0148, was 0.3-3.7% relative depending on the
// percentile it fell at). $1300M resolves easily at every candidate N tried
// and was never the deciding book.
//
// ============================================================================
// HELD-OUT VALIDATION, TWO POINTS (the plan called for one in the sparse
// region; both were approved).
//
// $58M sits in the grid's SPARSEST gap (between $50M and $62M, a book near
// collapse) and needed its OWN stratification seed (9, picked as the first of
// twenty tried) — under the main grid's seed, every achievable exposure near
// $50-62M jumps $54.3M -> $63.6M in a single member addition, so no target in
// that range lands strictly between the two grid anchors; every one collapses
// onto whichever side it is closer to, and a held-out point that coincides
// with a grid anchor tests nothing. Mean |residual| 0.0096, worst 0.0565 at
// the 95th percentile.
//
// $450M sits between $317M and $568M, where a real enrolled book is likeliest
// to live operationally, and resolves under the main grid's own seed with no
// issue. Mean |residual| 0.0142, worst 0.1614 at the 99th percentile — the
// single largest residual either held-out point produced, in the region where
// a heavy tail is hardest to interpolate; the interpolated curve stayed
// monotonic throughout.
//
// ============================================================================
// WHERE drawn/expected = 1.000 FALLS, measured by MONTE CARLO (not a lognormal
// approximation — four uses of that shortcut earlier in this project's history
// all understated the skew and were corrected against direct measurement):
//
//   $50M    lambda  42:  ~75.2%     $202M   lambda 157:  ~69.7%
//   $62M    lambda  50:  ~74.6%     $317M   lambda 253:  ~67.4%
//   $78M    lambda  71:  ~72.9%     $568M   lambda 439:  ~64.9%
//   $102M   lambda  86:  ~72.0%     $1300M  lambda 1004: ~60.8%
//   $140M   lambda 111:  ~71.1%
//
// ============================================================================
// EXPANSION vs FUNDING_CLF_TABLE — NOT UNIFORM, AND THAT NUANCE MATTERS.
//
// At the 60% default: GL's OWN curve gives a LOWER load than the generic
// table's flat 1.000 at every book size (-37% at $50M narrowing to -1% at
// $1300M) — a heavily right-skewed aggregate's 60th percentile sits below its
// mean even though its tail runs far above it, so this is a rate CUT at the
// default setting, not an increase. At 90% and 95%, small (high-CV) books
// WIDEN sharply against the generic table (+33% at 95% for $50M) while the
// full roster COMPRESSES (-19% at 95% for $1300M) — GL's curve crosses the
// generic table's own slope rather than sitting uniformly wider or narrower.
// This is the opposite of WC's grid, which narrowed toward the generic table
// nearly everywhere because WC's enrolled-range CV sits mostly below the
// table's implied ~0.80; GL's process CV (0.47-2.12) straddles that value, so
// GL both widens and narrows depending on book size and percentile.
//
// ============================================================================
// RUNTIME BEHAVIOUR: computeGlClf (glLossDistribution.ts) computes the current
// enrolled book's own LAMBDA analytically via glAggregateCumulants (cheap,
// exact, and now verified against Monte Carlo with a bootstrap CI — see
// above), then linearly interpolates each requested percentile between the two
// grid entries bracketing that lambda. A book whose lambda falls outside
// [42.02, 1003.50] (the $50M and $1300M endpoints) is CLAMPED to the nearest
// endpoint rather than extrapolated — same reasoning as WC's grid: the grid
// spans the enrollable range, and extrapolating a linear trend past measured
// bounds risks doing worse than clamping.
// ============================================================================
// ⚠ OPEN ITEM: THIS GRID WAS DERIVED UNDER A FIXED $100M CEILING AND HAS NOT
// BEEN RE-DERIVED AGAINST THE TRENDING ONE. Recorded rather than fixed, exactly
// as wcClfGrid.ts records the same class of staleness for WC.
//
// The ratios below are Monte Carlo percentiles of an aggregate whose severity
// was clamped at a stationary $100M. glSeverityCap now trends that ceiling, so
// a lookup feeds cumulants computed on one basis into a curve measured on
// another. The bias is small and one-directional: the trending ceiling truncates
// LESS in later years, so the true tail is slightly heavier than these ratios
// describe, and the understatement grows with the year.
//
// ONE THING THE CHANGE IMPROVED RATHER THAN BROKE. This grid is indexed on
// LAMBDA, and under the fixed ceiling the aggregate SHAPE at a given lambda
// itself drifted with the year (the capped per-claim CV moved 3.31% by year 10),
// so a lambda-indexed grid was silently year-sensitive. With the ceiling
// trending the capped CV is trend-invariant to 2e-16, so shape-at-a-given-lambda
// is now genuinely year-invariant and the axis does what it was chosen to do.
//
// WHY THIS DOES NOT AFFECT A SHIPPED NUMBER. The engine does not price GL off
// this grid: STATIC_CLF_TABLE.GL is GL_SUPPLIED (clfTables.ts), and computeGlClf
// has no caller in src/ outside this module's own crossing helper — verified by
// search, not assumed. Its live consumers are diagnostics.
//
// WHAT WOULD CLOSE IT: re-run scripts/diagnostics/gl-clf-grid-derive.ts under
// the trending ceiling and replace the entries below.
// ============================================================================
export interface GlClfGridEntry {
  size: number;
  exposure: number;
  lambda: number;
  cv: number;
  ratios: Record<number, number>;
}

export const GL_CLF_PERCENTILE_STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99] as const;

export const GL_CLF_GRID: GlClfGridEntry[] = [
  { size: 8, exposure: 54.3, lambda: 42.0159, cv: 2.1177, ratios: { 10: 0.1269, 15: 0.1653, 20: 0.2028, 25: 0.2418, 30: 0.2822, 35: 0.3257, 40: 0.3731, 45: 0.4261, 50: 0.4859, 55: 0.5531, 60: 0.6315, 65: 0.7241, 70: 0.8391, 75: 0.9907, 80: 1.1950, 85: 1.4915, 90: 2.0060, 95: 3.2441, 97.5: 5.0605, 99: 9.0874 } },
  { size: 9, exposure: 63.6, lambda: 49.9073, cv: 1.9577, ratios: { 10: 0.1466, 15: 0.1870, 20: 0.2267, 25: 0.2665, 30: 0.3083, 35: 0.3523, 40: 0.4014, 45: 0.4543, 50: 0.5139, 55: 0.5797, 60: 0.6578, 65: 0.7523, 70: 0.8673, 75: 1.0125, 80: 1.2089, 85: 1.4963, 90: 2.0005, 95: 3.1737, 97.5: 4.9399, 99: 8.7046 } },
  { size: 15, exposure: 91.3, lambda: 71.2891, cv: 1.6360, ratios: { 10: 0.1929, 15: 0.2382, 20: 0.2810, 25: 0.3236, 30: 0.3670, 35: 0.4127, 40: 0.4617, 45: 0.5152, 50: 0.5749, 55: 0.6414, 60: 0.7195, 65: 0.8102, 70: 0.9193, 75: 1.0588, 80: 1.2432, 85: 1.5126, 90: 1.9659, 95: 3.0108, 97.5: 4.5672, 99: 7.7979 } },
  { size: 17, exposure: 110.7, lambda: 85.7743, cv: 1.4881, ratios: { 10: 0.2176, 15: 0.2642, 20: 0.3089, 25: 0.3522, 30: 0.3979, 35: 0.4439, 40: 0.4936, 45: 0.5471, 50: 0.6056, 55: 0.6718, 60: 0.7477, 65: 0.8358, 70: 0.9464, 75: 1.0795, 80: 1.2568, 85: 1.5144, 90: 1.9551, 95: 2.9483, 97.5: 4.4008, 99: 7.4890 } },
  { size: 23, exposure: 141.2, lambda: 110.9839, cv: 1.3207, ratios: { 10: 0.2510, 15: 0.2993, 20: 0.3455, 25: 0.3899, 30: 0.4352, 35: 0.4823, 40: 0.5314, 45: 0.5840, 50: 0.6411, 55: 0.7070, 60: 0.7824, 65: 0.8679, 70: 0.9713, 75: 1.0989, 80: 1.2687, 85: 1.5139, 90: 1.9182, 95: 2.8358, 97.5: 4.1424, 99: 6.9779 } },
  { size: 35, exposure: 203.8, lambda: 157.0267, cv: 1.1048, ratios: { 10: 0.3003, 15: 0.3518, 20: 0.3992, 25: 0.4445, 30: 0.4899, 35: 0.5366, 40: 0.5850, 45: 0.6373, 50: 0.6941, 55: 0.7573, 60: 0.8286, 65: 0.9096, 70: 1.0067, 75: 1.1286, 80: 1.2888, 85: 1.5116, 90: 1.8736, 95: 2.6751, 97.5: 3.8332, 99: 6.3974 } },
  { size: 54, exposure: 320.5, lambda: 253.0192, cv: 0.8888, ratios: { 10: 0.3618, 15: 0.4155, 20: 0.4636, 25: 0.5100, 30: 0.5562, 35: 0.6020, 40: 0.6488, 45: 0.6997, 50: 0.7538, 55: 0.8128, 60: 0.8790, 65: 0.9575, 70: 1.0473, 75: 1.1558, 80: 1.2980, 85: 1.4943, 90: 1.8113, 95: 2.5064, 97.5: 3.4909, 99: 5.5299 } },
  { size: 90, exposure: 568.2, lambda: 439.3036, cv: 0.6809, ratios: { 10: 0.4349, 15: 0.4891, 20: 0.5377, 25: 0.5833, 30: 0.6273, 35: 0.6720, 40: 0.7183, 45: 0.7668, 50: 0.8171, 55: 0.8718, 60: 0.9323, 65: 1.0020, 70: 1.0821, 75: 1.1800, 80: 1.3034, 85: 1.4714, 90: 1.7349, 95: 2.3078, 97.5: 3.0911, 99: 3.8967 } },
  { size: 200, exposure: 1300.0, lambda: 1003.4989, cv: 0.4747, ratios: { 10: 0.5317, 15: 0.5861, 20: 0.6328, 25: 0.6772, 30: 0.7191, 35: 0.7598, 40: 0.8021, 45: 0.8450, 50: 0.8905, 55: 0.9385, 60: 0.9906, 65: 1.0496, 70: 1.1150, 75: 1.1946, 80: 1.2925, 85: 1.4241, 90: 1.6253, 95: 1.9803, 97.5: 2.2703, 99: 2.6130 } },
];
