// WAGE INFLATION ON THE EXPOSURE BASE — pool-wide framework, wired for WC and GL.
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
import { memoizeByYear } from '../utils/claimMath';

// SOURCED — see the derivation above.
export const WAGE_INFLATION_PER_YEAR = 0.0363;

// ⚠ THE PER-LINE SWITCH. WC AND GL LIVE; PROPERTY OFF. Turning a line on is a
// REPRICING, not a toggle — it must arrive paired with that line's own sourced
// severity trend, or the rate moves by the full wage rate with nothing
// offsetting it:
//
//   GL — LIVE. Paired with GL_SEVERITY_TREND_PER_YEAR (5.7026%/yr, itself
//        1.0363 x 1.020 — wage times long-run social inflation), so GL's rate
//        trend is +2.00%/yr, exactly the social-inflation half. Payroll grows
//        with the economic half; severity grows with both; the difference is
//        what members actually feel. See glClaimEngine.ts for the sourcing and
//        for why the 2.0% is tagged a judgment rather than a Swiss Re figure.
//
//        ⚠ THE TWO HALVES ARRIVED TOGETHER AND MUST STAY TOGETHER. Severity
//        alone makes GL's rate rise 5.70%/yr; payroll alone makes it FALL
//        3.63%/yr. An earlier version of this note said GL's rate trend would
//        become "+3.25%/yr rather than +7%" — that assumed a 7% trend GL did
//        not have, and was wrong even before the sub-coverage rebuild deleted
//        GL_SOCIAL_INFLATION. Removing either half now reintroduces the same
//        class of defect finding 37 corrected on WC.
//
//   PROPERTY — its exposure base is TIV, not payroll, and TIV inflates with
//        CONSTRUCTION COST, not wages. 3.63% IS NOT PROPERTY'S RATE. Turning
//        Property on requires its own sourced figure and its own severity
//        pairing; reusing this constant would be a category error.
//
// Property-solo being byte-identical across a change to this file is the proof
// its switch is genuinely off, not merely nominally off.
export const WAGE_INFLATION_APPLIES: Record<CoverageLine, boolean> = {
  WC: true,
  GL: true,
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
// STARTING_CAPITAL_TO_PREMIUM, and the OPENING_SURPLUS_TO_PREMIUM_BAND
// acceptance test that redraws the pre-game when the opening lands outside it.
// Deflating exposure ~10% while those stay fixed silently re-rates the opening
// position — measured at a 5% lower starting surplus and 3 fewer starting
// members, for no modelling gain.
//
// The same mismatch, caught earlier in the same change, is why
// instanceGenerator pins OPENING_EXPOSURE_YEAR to 1.
//
// ⚠ wcSeverityTrend AND glSeverityTrend FLOOR THE SAME WAY AND MUST CONTINUE TO.
// Each is a pair with this factor: if payroll pins at year 1 pre-game while a
// line's severity deflates, that line's drawn loss and priced loss diverge across
// exactly the years that set the opening reserves.
// MEMOIZED PER LINE. wageFactor is a pure function of (line, yearNumber), but
// it is called from inside member-list loops at 7+ sites (getMemberExposure's
// every caller — instanceGenerator.ts, membershipEngine.ts,
// simulationEngine.ts), several walking the full 200-member market roster
// every year. One Map per line turns every call after the first, for a given
// floored year, into a hash lookup. Floors at the cache-key level too (see
// memoizeByYear's header) — the pre-game's years -2/-1/0 collapse onto the
// same entry as year 1, since the underlying Math.pow already floors there.
// ⚠ fn FLOORS INTERNALLY, exactly like the original unmemoized body — the
// `keyOf` floor below is a cache-key optimisation only, not the source of
// correctness. memoizeByYear calls fn with the RAW year on a cache miss, so
// if fn trusted keyOf to have already floored, whichever raw year happened to
// populate a given slot first (-2, -1, 0 or 1 — order is call-dependent) would
// silently decide that slot's value from the wrong exponent.
const wageFactorByLine: Record<CoverageLine, (year: number) => number> = {
  WC: memoizeByYear(year => Math.pow(1 + WAGE_INFLATION_PER_YEAR, Math.max(1, year) - 1), year => Math.max(1, year)),
  GL: memoizeByYear(year => Math.pow(1 + WAGE_INFLATION_PER_YEAR, Math.max(1, year) - 1), year => Math.max(1, year)),
  Property: () => 1,
};

export function wageFactor(line: CoverageLine, yearNumber: number): number {
  if (!WAGE_INFLATION_APPLIES[line]) return 1;
  return wageFactorByLine[line](yearNumber);
}
