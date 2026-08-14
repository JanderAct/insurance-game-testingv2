// WC's OWN loss-distribution percentile grid — replaces FUNDING_CLF_TABLE for
// WC pricing (finding 38). MEASURED ONCE by Monte Carlo, then held — same
// convention as WC_HELD_PURE_PREMIUM_PER_100 and FUNDING_CLF_TABLE itself.
//
// ============================================================================
// PROCESS RISK ONLY. DO NOT "CORRECT" THIS TOWARD FUNDING_CLF_TABLE.
//
// FUNDING_CLF_TABLE is the REAL pool's measured percentile curve, at $20-30
// BILLION of payroll. At that scale, process risk (year-to-year claim count
// and severity variation) gives an annual loss-ratio CV near 0.063 — the
// table's own spread implies roughly 0.80, THIRTEEN TIMES WIDER. A real pool
// that large cannot be seeing that much claim-count/severity variance from
// one year to the next; the table is measuring uncertainty about the MEAN
// ITSELF — parameter risk, trend surprises, legislative change, reserve
// development — which hits the whole book at once and does NOT diversify
// away as the book grows. That is a real risk, but a DIFFERENT QUANTITY from
// claim variance.
//
// This model has no channel for that kind of uncertainty: it is handed the
// expected loss and is correct by construction (fixed severity/frequency
// parameters, no parameter-estimation error, no legislative-change process).
// So this grid and FUNDING_CLF_TABLE measure two different phenomena, and
// NEITHER VALIDATES THE OTHER. If a future change makes this grid's numbers
// drift toward FUNDING_CLF_TABLE's, that is not evidence of a fix — matching
// them would mean smuggling parameter/trend uncertainty into a model that
// structurally cannot have it.
// ============================================================================
//
// HOW IT WAS MEASURED: scripts/diagnostics/wc-clf-grid-derive.ts drives
// generateWcClaims directly (single-year draws — valid because WC's
// frequency trend now prices symmetrically with the draw, so drawn/expected
// is year-invariant; see wcFrequencyTrend's use in simulationEngine.ts),
// 50,000 draws per reference book, at seven reference books spanning the
// enrollable range. Each book's own percentiles are stored as ratios to THAT
// book's own analytic expected loss, at exactly the stops WC's
// funding-confidence slider uses: 5-point steps from 10% to 95%, plus 97.5%
// and 99%.
//
// ⚠ REFERENCE BOOKS ARE SELECTED BY TARGET EXPOSURE, STRATIFIED ACROSS
// PAYROLL DECILES (seed 20260815) — NOT by headcount, and NOT largest-first.
// The full argument for both rejections lives at the top of
// wc-clf-grid-derive.ts; the short version is that CV depends on how exposure
// is DISTRIBUTED across members, not just its total, so a reference book has
// to reproduce the roster's payroll SHAPE or it is not comparable to the
// others. Mean payroll per member lands within 9.3% of the roster's $6.50M at
// every grid point, worst case (the smallest book), and within 2.4% at the
// other six.
//
// THE FIRST VERSION OF THIS GRID SAMPLED BY HEADCOUNT and is the reason this
// warning exists. An even-spaced stride over the roster made exposure
// NON-MONOTONIC in headcount (its 30-member book carried $309.3M against its
// 50-member book's $287.9M, because the stride landed disproportionately on
// large members — $10.31M/member against the roster's $6.50M). The damage was
// not the odd ordering itself but the resulting CV coverage: two points sat
// nearly on top of each other at CV 0.684 and 0.718 while NOTHING anchored
// CV 0.718 to 1.159, a 0.44-wide hole in the region where the curve bends
// hardest — and where a shrinking pool ends up. Exposure and CV are both
// monotonic in headcount in the current grid.
//
// WHY A GRID, NOT A CLOSED FORM. A first attempt fit a Cornish-Fisher
// expansion to the aggregate's analytic cumulants (mean, CV, skewness,
// kurtosis — all derivable in closed form from the compound-Poisson/Gamma-
// frequency-noise structure). Mean and CV verified against Monte Carlo at
// three book sizes; skewness (18-42) and excess kurtosis (18,000-97,000) are
// far outside where a cumulant-polynomial correction to the normal quantile
// is valid, and it produced NEGATIVE loss percentiles. A Monte Carlo grid,
// interpolated at runtime, has no such failure mode — every stored value is
// itself an order statistic of real (non-negative) draws, so interpolating
// between two monotonic curves stays monotonic and stays positive.
//
// INTERPOLATION AXIS: CV, not 1/sqrt(exposure). Established on the previous
// (headcount-sampled) grid, where both axes were tied on mean absolute
// residual (0.0117) but CV was markedly better at the 99th percentile
// (+0.023 vs +0.071) — the stop that matters most for pricing risk. Retained
// unchanged here; the rebuild changed which books anchor the grid, not how
// the curve is indexed.
//
// HELD-OUT VALIDATION, DELIBERATELY IN THE SPARSE REGION. The previous grid's
// validation sat at CV 0.568 with two grid points closely bracketing it — it
// tested the easy case. This one holds out a $155.6M / 24-member book at
// CV 0.8754, bracketed by CV 0.7611 and 1.0809, a 0.32-wide gap and the
// widest in the grid. Mean |residual| 0.0076, worst 0.0148 at the 95th
// percentile, every residual positive (the interpolation overshoots slightly
// and uniformly rather than changing sign in the tail as the old grid did at
// 99%). That is BETTER than the old grid managed on its easier test.
//
// RUNTIME BEHAVIOUR: computeWcClf (wcLossDistribution.ts) computes the
// CURRENT enrolled book's own CV analytically (cheap, exact, verified — see
// wcAggregateCumulants), then linearly interpolates each requested
// percentile between the two grid entries bracketing that CV. A book whose
// CV falls outside [0.3207, 1.0809] (the $1300M and $100M endpoints) is
// CLAMPED to the nearest endpoint rather than extrapolated — the grid spans
// the enrollable range, and extrapolating a linear trend past measured bounds
// risks producing something worse than clamping.
export interface WcClfGridEntry {
  size: number;
  exposure: number;
  cv: number;
  ratios: Record<number, number>;
}

export const WC_CLF_PERCENTILE_STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99] as const;

export const WC_CLF_GRID: WcClfGridEntry[] = [
  { size: 18, exposure: 106.1, cv: 1.0809, ratios: { 10: 0.4009, 15: 0.4523, 20: 0.4981, 25: 0.5432, 30: 0.5871, 35: 0.6308, 40: 0.6767, 45: 0.7245, 50: 0.7768, 55: 0.8333, 60: 0.8956, 65: 0.9676, 70: 1.0500, 75: 1.1465, 80: 1.2720, 85: 1.4455, 90: 1.7133, 95: 2.2650, 97.5: 3.0132, 99: 4.2985 } },
  { size: 33, exposure: 219.7, cv: 0.7611, ratios: { 10: 0.5183, 15: 0.5697, 20: 0.6125, 25: 0.6538, 30: 0.6925, 35: 0.7331, 40: 0.7730, 45: 0.8160, 50: 0.8592, 55: 0.9063, 60: 0.9577, 65: 1.0156, 70: 1.0821, 75: 1.1599, 80: 1.2627, 85: 1.3955, 90: 1.6056, 95: 2.0124, 97.5: 2.5363, 99: 3.4624 } },
  { size: 46, exposure: 304.1, cv: 0.6537, ratios: { 10: 0.5690, 15: 0.6168, 20: 0.6562, 25: 0.6951, 30: 0.7327, 35: 0.7692, 40: 0.8067, 45: 0.8456, 50: 0.8860, 55: 0.9303, 60: 0.9772, 65: 1.0291, 70: 1.0902, 75: 1.1604, 80: 1.2514, 85: 1.3710, 90: 1.5565, 95: 1.9031, 97.5: 2.3291, 99: 3.0677 } },
  { size: 69, exposure: 450.8, cv: 0.5422, ratios: { 10: 0.6241, 15: 0.6687, 20: 0.7068, 25: 0.7431, 30: 0.7779, 35: 0.8114, 40: 0.8455, 45: 0.8803, 50: 0.9159, 55: 0.9547, 60: 0.9977, 65: 1.0453, 70: 1.0974, 75: 1.1614, 80: 1.2405, 85: 1.3431, 90: 1.4958, 95: 1.7776, 97.5: 2.1269, 99: 2.7982 } },
  { size: 106, exposure: 705.4, cv: 0.4363, ratios: { 10: 0.6826, 15: 0.7224, 20: 0.7575, 25: 0.7894, 30: 0.8194, 35: 0.8491, 40: 0.8782, 45: 0.9102, 50: 0.9419, 55: 0.9759, 60: 1.0107, 65: 1.0491, 70: 1.0930, 75: 1.1474, 80: 1.2134, 85: 1.2980, 90: 1.4214, 95: 1.6584, 97.5: 1.9405, 99: 2.4642 } },
  { size: 156, exposure: 1013.4, cv: 0.3662, ratios: { 10: 0.7207, 15: 0.7586, 20: 0.7905, 25: 0.8195, 30: 0.8474, 35: 0.8753, 40: 0.9012, 45: 0.9284, 50: 0.9556, 55: 0.9859, 60: 1.0174, 65: 1.0537, 70: 1.0930, 75: 1.1385, 80: 1.1934, 85: 1.2654, 90: 1.3687, 95: 1.5658, 97.5: 1.8003, 99: 2.2145 } },
  { size: 200, exposure: 1300.0, cv: 0.3207, ratios: { 10: 0.7489, 15: 0.7838, 20: 0.8137, 25: 0.8410, 30: 0.8664, 35: 0.8900, 40: 0.9143, 45: 0.9401, 50: 0.9651, 55: 0.9917, 60: 1.0192, 65: 1.0500, 70: 1.0855, 75: 1.1274, 80: 1.1766, 85: 1.2390, 90: 1.3318, 95: 1.5043, 97.5: 1.7010, 99: 2.0597 } },
];
