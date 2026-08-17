// WAGE INFLATION ON THE EXPOSURE BASE — pool-wide framework, wired for WC only.
//
// The roster is FROZEN and stays frozen: member payroll in memberCatalog is a
// permanent year-1-dollar figure. This factor rides on top at read time, the
// same pattern as wcFrequencyTrend — a deterministic function of the year,
// blind to the roster, applied where exposure is read rather than baked into
// the data.
//
// ===========================================================================
// WHY THE MODEL NEEDS THIS, AND WHY IT DOES NOT NEED A SEVERITY TREND IN RATE
// TERMS
// ===========================================================================
//
// WC severity grows at almost exactly the rate wages grow, and that is by
// CONSTRUCTION rather than coincidence: indemnity benefits are statutorily
// two-thirds of wage, so the indemnity half of severity tracks wages by
// definition.
//
//   WCIRB blended severity trend        3.67%
//     medical    52% of severity  @ 3.70%/yr   (2017-2023)
//     indemnity  48% of severity  @ 3.63%/yr   ("33% above 2016 by 2024")
//   Wage inflation                      3.63%
//     read off the indemnity severity trend itself, since WCIRB attributes
//     indemnity growth "primarily to increasing average wage levels"
//   Difference                         +0.04%
//
// So there is NO SEVERITY TREND IN RATE TERMS — the NCCI a priori assumption,
// confirmed by data. The model never needed one.
//
// What it was missing is the OTHER half of that relationship: payroll did not
// grow. Exposure sat frozen while the frequency trend pulled the rate down
// 1.5%/yr, so the pool shrank in nominal terms every year. Real pools grow with
// their members' wages.
//
// ⚠ THE TWO HALVES ARE A PAIR. Inflating payroll WITHOUT inflating severity
// makes the rate fall 5.1%/yr instead of 1.46%, because the rate's denominator
// grows while its numerator does not. Both, or neither. WC's severity trend
// lives in wcClaimEngine (WC_SEVERITY_TREND_PER_YEAR) and is applied at the
// DRAW; this module is only the exposure half.
//
// EXPONENTIAL, NOT LINEAR, per CAS Basic Ratemaking: a linear trend model
// eventually projects negative severities.
//
// ⚠ KNOWN SIMPLIFICATION, NOT AN OVERSIGHT. CAS prescribes SEPARATE medical and
// indemnity trends for workers' compensation. The severity rebuild made that
// impossible — the mixture draws ONE amount per claim with no legs to trend
// differently (see CALIBRATION_FINDINGS 30 for the full list of what the
// medical/indemnity/impairment split's removal cost). The blended 3.67% is the
// best available single rate, and a per-leg trend is what a future model with
// legs would restore.

import type { CoverageLine } from '../types/simulation';

// SOURCED — see the derivation above.
export const WAGE_INFLATION_PER_YEAR = 0.0363;

// ⚠ THE PER-LINE SWITCH. WC ONLY IN THIS COMMIT. The framework is built
// line-agnostic because GL and Property will both need it, but turning either on
// is a REPRICING, not a toggle:
//
//   GL — CARRIES NO SEVERITY OR FREQUENCY TREND OF ANY KIND (the GL
//        sub-coverage rebuild deleted GL_SOCIAL_INFLATION entirely — see
//        GL_LOSS_MODEL in defaultAssumptions.ts). An EARLIER version of this
//        comment claimed GL's rate trend would become "+3.25%/yr rather than
//        +7%" once payroll grows — that assumed a 7% trend GL no longer has,
//        and was wrong even before the rebuild (it never paired frequency's
//        flatness with any severity trend correctly). With no trend at all,
//        flipping this switch on GL as-is would make GL's rate FALL by the
//        full wage rate (payroll grows, nothing offsets it) — the mirror
//        image of the defect WC's own wage-inflation work fixed. Do not flip
//        this switch until GL has a sourced severity trend to pair against it,
//        exactly as WC's wcSeverityTrend pairs with this factor.
//
//   PROPERTY — its exposure base is TIV, not payroll, and TIV inflates with
//        CONSTRUCTION COST, not wages. 3.63% IS NOT PROPERTY'S RATE. Turning
//        Property on requires its own sourced figure and its own severity
//        pairing; reusing this constant would be a category error.
//
// GL-solo and Property-solo being byte-identical across this change is the
// proof the switch is genuinely off, not merely nominally off.
export const WAGE_INFLATION_APPLIES: Record<CoverageLine, boolean> = {
  WC: true,
  GL: false,
  Property: false,
};

// The cumulative wage factor for a given year. Live year 1 is the reference
// (factor 1.0), matching wcFrequencyTrend's convention.
//
// ⚠ THE PRE-GAME IS PINNED AT YEAR-1 DOLLARS — the factor FLOORS at 1.0 rather
// than deflating for negative yearNumbers, and that is deliberate.
//
// It would be more symmetric with wcFrequencyTrend (which does let the pre-game
// run hotter, because the past was more dangerous). But the pre-game is NOT a
// simulated wage history — it is an INITIAL-CONDITIONS GENERATOR, three years
// run only to produce an opening balance sheet for a pool that has been
// operating. Every dollar constant that shapes it is expressed in year-1
// dollars: STARTING_FINANCIALS' premium and surplus ranges,
// STARTING_CAPITAL_TO_PREMIUM, and the OPENING_MULTIPLE_BAND acceptance test
// that redraws the whole pre-game when the opening surplus lands outside it.
// Deflating exposure ~10% while those stay fixed silently re-rates the opening
// position — measured at a 5% lower starting surplus and 3 fewer starting
// members, for no modelling gain.
//
// The same mismatch, caught earlier in the same change, is why
// instanceGenerator pins OPENING_EXPOSURE_YEAR to 1.
//
// ⚠ wcSeverityTrend FLOORS THE SAME WAY AND MUST CONTINUE TO. The two are a
// pair: if payroll pins at year 1 pre-game while severity deflates, the drawn
// loss and the priced loss diverge across exactly the years that set the
// opening reserves.
export function wageFactor(line: CoverageLine, yearNumber: number): number {
  if (!WAGE_INFLATION_APPLIES[line]) return 1;
  return Math.pow(1 + WAGE_INFLATION_PER_YEAR, Math.max(1, yearNumber) - 1);
}
