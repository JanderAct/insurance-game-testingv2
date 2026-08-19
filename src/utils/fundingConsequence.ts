// Funding-confidence-level consequence panel — CLF-only pricing.
//
// Every figure here is re-derived from the SAME formulas simulationEngine.ts
// uses to actually price a line, not a parallel definition:
//   poolPremiumRatePer100         = purePremiumPer100 * CLF        (pricingAdjustment is now always 1)
//   adminRatePer100                = purePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM
//   reinsRatePer100                = poolPremiumRatePer100 * reinsCostPct
//   totalMemberChargeRatePer100    = poolPremiumRatePer100 + adminRatePer100 + reinsRatePer100
// "The load" (charge / expected loss) is therefore CLF*(1+reinsCostPct) + 0.15,
// and at the default reinsurance level (2, cost 37.5% of pool premium) that is
// exactly CLF + 0.15 + 0.375*CLF — the reference formula the panel was speced
// against. reinsCostPct is read from the ACTUAL selected reinsurance level
// rather than hardcoded, so the panel stays correct if the player changes it.
//
// Verified against the reference numbers at reinsuranceLevel 2 (default):
//   75% -> load 2.0008, combined ratio 82.7%, margin +17.3%
//   60% -> load 1.5250, combined ratio 100.0% (exact break-even)
//   50% -> load 1.2871, combined ratio 113.4%, funds 82.7% of expected
//   30% -> load 0.8595, combined ratio 156.3%, funds 51.6% of expected
// (all four reproduce exactly using the reference chart's CLF values; see the
// discrepancy note on FUNDING_CLF_TABLE[0.60] in defaultAssumptions.ts — the
// live table's 1.003 there yields 99.8%, not exactly 100.0%.)

import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, REINSURANCE_PROGRAMS, SLIDER_RANGES } from '../data/defaultAssumptions';
import { lookupCLF } from './simulationEngine';
import { hasStaticClf, staticClf, staticClfCrossing } from '../data/clfTables';
import type { CoverageLine } from '../types/simulation';

// ⚠ THREADED, NOT GENERIC lookupCLF. This panel used to call lookupCLF
// unconditionally for every line, while simulationEngine.ts priced WC (and now
// GL) off their own derived distributions — silently showing the player a
// FUNDING_CLF_TABLE-based load/margin/crossing for a line the engine was not
// actually pricing that way. Already ~22-27% off at the 90% confidence
// setting for WC before GL's grid existed to double the problem: GL's own
// curve runs 2-9x WIDER than the generic table (glClfGrid.ts), so the same
// unconditional call would have understated GL's true load severely at any
// confidence level above the crossing. Shipping GL's grid while the panel
// explaining GL's price read a different curve would have been the same
// failure class as a factor reaching the draw and not the price (finding 37) —
// just on the display side instead of the pricing side.
//
// atExpected: WC/GL ONLY — bypasses the grid and returns exactly 1.0, mirroring
// simulationEngine.ts's selectedFundingCLF dispatch. Property ignores it.
function clfFor(line: CoverageLine, confidenceLevel: number, atExpected: boolean): number {
  if (hasStaticClf(line)) return atExpected ? 1.0 : staticClf(line, confidenceLevel);
  return lookupCLF(confidenceLevel);
}

// Where the line's table crosses CLF = 1.000, as a 0-1 fraction — the
// "Expected" marker's true position. Read straight off STATIC_CLF_TABLE by
// interpolation, so it cannot drift from the CLF the same table charges.
//
// ⚠ NO LONGER BOOK-DEPENDENT, and the signature says so. The retired grids
// computed a per-book crossing because they interpolated on the book's own
// CV/lambda; the static tables are one curve per line, so the crossing is one
// number per line — WC 47.2%, GL 68.6% as measured. The `members` and
// `yearNumber` arguments both helpers used to take are gone rather than left
// unused, so nothing suggests a book-dependence that no longer exists.
//
// Property has no table of its own to cross (see clfFor above); its 60% stop
// already coincides with CLF 1.000 in FUNDING_CLF_TABLE, so this returns 0.60
// there rather than a meaningless "crossing".
function expectedPercentileFor(line: CoverageLine): number {
  if (hasStaticClf(line)) return staticClfCrossing(line);
  return 0.60;
}

export interface FundingConsequence {
  // The "as displayed" confidence level: the raw slider fallback value, UNLESS
  // atExpected is true, in which case this is overridden to expectedPercentile
  // so "Adequate in ~X%" reads correctly against the CLF actually charged.
  confidenceLevel: number;
  // Where this book's own grid crosses CLF = 1.000, computed unconditionally
  // (not only while atExpected) — see expectedPercentileFor above.
  expectedPercentile: number;
  clf: number;
  purePremiumPer100: number;
  poolPremiumRatePer100: number;
  adminRatePer100: number;
  reinsRatePer100: number;
  totalMemberChargeRatePer100: number;
  // charge / expected loss — "the load"
  load: number;
  expectedLossRatio: number;
  expectedExpenseRatio: number;
  expectedCombinedRatio: number;
  // Meaningful reading depends on the level:
  isAdequate: boolean;          // confidenceLevel >= 0.60 (CLF >= ~1.0)
  marginPct: number;            // (1 - combinedRatio) * 100 — shown when adequate
  fundedPct: number;            // clf * 100 — shown when underfunded
  // Replaces the information the deleted Rate Change lever used to carry.
  derivedRateChangePct: number | null; // vs last year's totalMemberChargeRatePer100; null if no prior
  // The next step's cost, as a % change in POOL PREMIUM specifically.
  marginalCostPct: number | null; // null when already at the slider's max
  isAtMax: boolean;
}

function reinsCostPctFor(reinsuranceLevel: number): number {
  const prog = REINSURANCE_PROGRAMS[reinsuranceLevel];
  return prog ? (prog.costPctOfPremiumMin + prog.costPctOfPremiumMax) / 2 : 0;
}

function ratesAt(purePremiumPer100: number, confidenceLevel: number, reinsuranceLevel: number, line: CoverageLine, atExpected: boolean) {
  const clf = clfFor(line, confidenceLevel, atExpected);
  const poolPremiumRatePer100 = purePremiumPer100 * clf;
  const adminRatePer100 = purePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  const reinsRatePer100 = poolPremiumRatePer100 * reinsCostPctFor(reinsuranceLevel);
  const totalMemberChargeRatePer100 = poolPremiumRatePer100 + adminRatePer100 + reinsRatePer100;
  return { clf, poolPremiumRatePer100, adminRatePer100, reinsRatePer100, totalMemberChargeRatePer100 };
}

export function computeFundingConsequence(
  purePremiumPer100: number,
  confidenceLevel: number,
  reinsuranceLevel: number,
  priorTotalMemberChargeRatePer100: number | null,
  line: CoverageLine,
  // ⚠ NO members / yearNumber ANY MORE. Both were needed only to index the
  // retired CV/lambda grids; the static tables in clfTables.ts are one curve per
  // line and take neither. Dropping them from the signature rather than leaving
  // them unused keeps the panel from implying a book-dependence the pricing no
  // longer has.
  atExpected: boolean,
): FundingConsequence {
  const { clf, poolPremiumRatePer100, adminRatePer100, reinsRatePer100, totalMemberChargeRatePer100 } =
    ratesAt(purePremiumPer100, confidenceLevel, reinsuranceLevel, line, atExpected);

  // Computed UNCONDITIONALLY (not only while atExpected) — cheap, and useful
  // for the UI to show "Expected (~X%)" even before the player selects it.
  const expectedPercentile = expectedPercentileFor(line);

  const load = purePremiumPer100 > 0 ? totalMemberChargeRatePer100 / purePremiumPer100 : 0;
  const expectedLossRatio = load > 0 ? 1 / load : 0;
  const expectedExpenseRatio = load > 0 ? (adminRatePer100 + reinsRatePer100) / purePremiumPer100 / load : 0;
  const expectedCombinedRatio = expectedLossRatio + expectedExpenseRatio;

  const derivedRateChangePct = priorTotalMemberChargeRatePer100 && priorTotalMemberChargeRatePer100 > 0
    ? (totalMemberChargeRatePer100 / priorTotalMemberChargeRatePer100 - 1) * 100
    : null;

  // The "next step" preview always steps from the raw slider fallback value
  // and is never itself priced atExpected — it answers "what would the NEXT
  // CONCRETE STOP cost", a question that stays well-defined even while the
  // player is currently sitting on Expected rather than a stop.
  const step = SLIDER_RANGES.fundingConfidenceLevel.step;
  const max = SLIDER_RANGES.fundingConfidenceLevel.max;
  const nextLevel = Math.round((confidenceLevel + step) * 100) / 100;
  const isAtMax = nextLevel > max + 1e-9;
  const marginalCostPct = isAtMax
    ? null
    : (ratesAt(purePremiumPer100, nextLevel, reinsuranceLevel, line, false).poolPremiumRatePer100 / Math.max(poolPremiumRatePer100, 1e-9) - 1) * 100;

  return {
    // Overridden to the crossing percentile while atExpected, so "Adequate in
    // ~X%" reports the percentile actually being charged (CLF 1.000) rather
    // than the stale fallback slider value.
    confidenceLevel: atExpected ? expectedPercentile : confidenceLevel,
    expectedPercentile,
    clf,
    purePremiumPer100,
    poolPremiumRatePer100,
    adminRatePer100,
    reinsRatePer100,
    totalMemberChargeRatePer100,
    load,
    expectedLossRatio,
    expectedExpenseRatio,
    expectedCombinedRatio,
    // CLF-BASED, not a hardcoded confidenceLevel threshold. The old
    // `confidenceLevel >= 0.60` test was already wrong the moment WC/GL got
    // their own derived grids (WC's full-roster break-even runs as low as
    // ~56.5%, GL's as high as ~75.2% — neither is "0.60"), and it would have
    // been actively backwards once atExpected can override confidenceLevel
    // above to a crossing value: CLF is always exactly 1.000 there by
    // construction, so the adequacy test must key off CLF, not the label.
    isAdequate: clf >= 1 - 1e-9,
    marginPct: (1 - expectedCombinedRatio) * 100,
    fundedPct: clf * 100,
    derivedRateChangePct,
    marginalCostPct,
    isAtMax,
  };
}
