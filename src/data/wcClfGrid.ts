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
// 50,000 draws per reference book, at six book sizes spanning the enrollable
// range (15-200 members, evenly subsampled from the 200-member canonical
// roster). Each book's own percentiles are stored as ratios to THAT book's
// own analytic expected loss, at exactly the stops WC's funding-confidence
// slider uses: 5-point steps from 10% to 95%, plus 97.5% and 99%.
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
// INTERPOLATION AXIS: CV, not 1/sqrt(exposure). Checked against a held-out
// book size (65 members, not a grid point) with both axes: mean absolute
// residual was statistically tied (0.0117 both), but CV interpolation is
// meaningfully more accurate at the 99th percentile specifically (residual
// +0.023 vs +0.071 for 1/sqrt(exposure)) — the percentile that matters most
// for pricing risk. See scripts/diagnostics/wc-clf-grid-derive.ts for the
// full residual table.
//
// RUNTIME BEHAVIOUR: computeWcClf (wcLossDistribution.ts) computes the
// CURRENT enrolled book's own CV analytically (cheap, exact, verified — see
// wcAggregateCumulants), then linearly interpolates each requested
// percentile between the two grid entries bracketing that CV. A book whose
// CV falls outside [0.3207, 1.1587] (the 200-member and 15-member endpoints)
// is CLAMPED to the nearest endpoint rather than extrapolated — the grid
// spans the enrollable range, and extrapolating a linear trend past measured
// bounds risks producing something worse than clamping.
export interface WcClfGridEntry {
  size: number;
  exposure: number;
  cv: number;
  ratios: Record<number, number>;
}

export const WC_CLF_PERCENTILE_STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99] as const;

export const WC_CLF_GRID: WcClfGridEntry[] = [
  { size: 15, exposure: 93.6, cv: 1.1587, ratios: { 10: 0.3767, 15: 0.4288, 20: 0.4755, 25: 0.5205, 30: 0.5642, 35: 0.6091, 40: 0.6559, 45: 0.7034, 50: 0.7574, 55: 0.8134, 60: 0.8775, 65: 0.9516, 70: 1.0346, 75: 1.1356, 80: 1.2631, 85: 1.4357, 90: 1.7191, 95: 2.3097, 97.5: 3.0896, 99: 4.4961 } },
  { size: 30, exposure: 309.3, cv: 0.6836, ratios: { 10: 0.5635, 15: 0.6133, 20: 0.6563, 25: 0.6955, 30: 0.7346, 35: 0.7725, 40: 0.8094, 45: 0.8488, 50: 0.8915, 55: 0.9376, 60: 0.9859, 65: 1.0404, 70: 1.1028, 75: 1.1762, 80: 1.2714, 85: 1.3981, 90: 1.5889, 95: 1.9630, 97.5: 2.4275, 99: 3.2380 } },
  { size: 50, exposure: 287.9, cv: 0.7180, ratios: { 10: 0.5553, 15: 0.6045, 20: 0.6485, 25: 0.6889, 30: 0.7272, 35: 0.7649, 40: 0.8027, 45: 0.8425, 50: 0.8850, 55: 0.9319, 60: 0.9834, 65: 1.0402, 70: 1.1056, 75: 1.1823, 80: 1.2794, 85: 1.4128, 90: 1.6175, 95: 2.0071, 97.5: 2.5152, 99: 3.4411 } },
  { size: 80, exposure: 434.6, cv: 0.5690, ratios: { 10: 0.6062, 15: 0.6517, 20: 0.6897, 25: 0.7252, 30: 0.7593, 35: 0.7931, 40: 0.8269, 45: 0.8613, 50: 0.8982, 55: 0.9384, 60: 0.9810, 65: 1.0284, 70: 1.0823, 75: 1.1448, 80: 1.2248, 85: 1.3264, 90: 1.4812, 95: 1.7860, 97.5: 2.1662, 99: 2.8756 } },
  { size: 130, exposure: 839.0, cv: 0.4031, ratios: { 10: 0.6938, 15: 0.7333, 20: 0.7674, 25: 0.7968, 30: 0.8250, 35: 0.8526, 40: 0.8806, 45: 0.9100, 50: 0.9400, 55: 0.9713, 60: 1.0048, 65: 1.0409, 70: 1.0824, 75: 1.1318, 80: 1.1910, 85: 1.2703, 90: 1.3857, 95: 1.6042, 97.5: 1.8599, 99: 2.3207 } },
  { size: 200, exposure: 1300.0, cv: 0.3207, ratios: { 10: 0.7489, 15: 0.7838, 20: 0.8137, 25: 0.8410, 30: 0.8664, 35: 0.8900, 40: 0.9143, 45: 0.9401, 50: 0.9651, 55: 0.9917, 60: 1.0192, 65: 1.0500, 70: 1.0855, 75: 1.1274, 80: 1.1766, 85: 1.2390, 90: 1.3318, 95: 1.5043, 97.5: 1.7010, 99: 2.0597 } },
];
