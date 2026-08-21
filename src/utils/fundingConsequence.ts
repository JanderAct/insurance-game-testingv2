// Funding-confidence-level consequence panel — CLF-only pricing.
//
// ⚠ THE PRICE ITSELF IS NOT COMPUTED HERE ANY MORE. Every rate below comes from
// quoteLineRates in utils/linePricing.ts — the SAME function simulationEngine
// calls to build its own pre-movement quote. That is a structural guarantee,
// not a claim: there is one definition and both callers use it.
//
// WHY THAT CHANGED. This file used to re-derive the stack from its own
// formulas, and the header here asserted it matched the engine. It did not, on
// two counts, and both were invisible because the panel's combined ratio was
// internally consistent on its own basis and read 100.0% — the same 100.0% the
// engine reached once ITS combined-ratio basis was fixed. The two agreed on the
// only summary number anyone would check while the components underneath were:
//
//   GL pool premium rate /$100    panel $5.63 (gross x CLF)   engine $3.26 (net)
//   GL reinsurance rate /$100     panel legacy % of premium   engine runtime tower
//
// A third divergence was found while fixing those two and is worth naming
// separately, because nothing in the brief pointed at it: the panel priced off
// lineState.purePremiumPer100, which is LAST year's. WC and GL re-derive theirs
// from held constants times the current year's trends, so the panel was also a
// year stale (~2%/yr on WC) before any of the above. It now calls
// currentPurePremiumPer100, the engine's own derivation.
//
// WHAT REMAINS DIFFERENT, stated rather than papered over: this is the
// PRE-MOVEMENT quote. The engine's FINAL premium re-runs the same arithmetic on
// the POST-movement book, so the two differ by whoever joins or leaves during
// the year — which the panel cannot know when the decision is being made. The
// engine's own pre-movement estimate is the referent, and parity against it is
// exact. See scripts/diagnostics/panel-engine-parity-check.ts, which asserts
// the components bit-for-bit and MEASURES the post-movement residual instead of
// pretending it is zero.

import { SLIDER_RANGES } from '../data/defaultAssumptions';
import { lookupCLF, currentPurePremiumPer100 } from './simulationEngine';
import { hasStaticClf, staticClf, staticClfCrossing } from '../data/clfTables';
import { quoteLineRates } from './linePricing';
import type { CoverageLine, Member } from '../types/simulation';

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
// ⚠ THE CROSSING IS NOT BOOK-DEPENDENT, and this helper's signature still says
// so even though computeFundingConsequence's no longer can. The retired grids
// computed a per-book crossing because they interpolated on the book's own
// CV/lambda; the static tables are one curve per line, so the crossing is one
// number per line — WC 43.5%, GL 57.7% as currently measured (GL reads its
// SUPPLIED curve; its own derived one crosses at 68.6%).
//
// computeFundingConsequence DOES take members and yearNumber again, for the
// tower — which genuinely prices off the book. This helper deliberately does
// not, so the distinction stays visible: the CLF curve is book-blind, the
// reinsurance price is not.
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
  /** GROSS minus what the placed tower is expected to cede — the base the CLF
   *  is actually applied to. Zero on Property, which is not netted. */
  expectedCededPer100: number;
  netPurePremiumPer100: number;
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

// The book-and-year inputs the price genuinely depends on. Grouped so the
// signature says what it needs rather than accumulating positional arguments.
//
// ⚠ members AND yearNumber ARE BACK, and for a different reason than the ones
// removed at the static-table change. Those were needed only to index the
// retired CV/lambda CLF grids, which is a dependence the pricing genuinely lost.
// These two are needed because the TOWER prices off the actual book and the
// year — occurrenceProgramCost reads both — so a panel that cannot see them
// cannot quote the reinsurance the engine will charge. Different dependence,
// genuinely present.
export interface FundingConsequenceBook {
  yearNumber: number;
  members: Member[];
  exposure: number;
  layersPlaced: boolean[];
  aggregateStopLevel: number;
  /** rateLevel / 100 — permanently 1 today, threaded so it cannot silently
   *  desync if the rate level moves again. */
  pricingAdjustment: number;
  competitivePressure: number;
  /** Last year's stored pure premium and the loss trend — PROPERTY ONLY, which
   *  compounds off its own prior value. Ignored for WC/GL, which re-derive. */
  priorPurePremiumPer100: number;
  lossTrend: number;
  priorRcEffectiveness: number;
  riskControlPct: number;
}

function ratesAt(
  confidenceLevel: number, reinsuranceLevel: number, line: CoverageLine,
  atExpected: boolean, book: FundingConsequenceBook,
) {
  // ⚠ NO priorPurePremiumPer100 / lossTrend / rcEffectiveness ANY MORE. They
  // existed only for Property's compounding random walk, which the Property
  // rebuild replaced with a held constant. Every line's pure premium is now a
  // pure function of the line and the year, so the panel cannot diverge from
  // the engine by carrying a stale prior — one fewer way for the parity this
  // file asserts to break.
  const purePremiumPer100 = currentPurePremiumPer100(line, book.yearNumber);
  const clf = clfFor(line, confidenceLevel, atExpected);
  const q = quoteLineRates({
    line,
    yearNumber: book.yearNumber,
    members: book.members,
    exposure: book.exposure,
    purePremiumPer100,
    clf,
    pricingAdjustment: book.pricingAdjustment,
    layersPlaced: book.layersPlaced,
    aggregateStopLevel: book.aggregateStopLevel,
    reinsuranceLevel,
    competitivePressure: book.competitivePressure,
  });
  return {
    clf,
    purePremiumPer100: q.purePremiumPer100,
    netPurePremiumPer100: q.netPurePremiumPer100,
    expectedCededPer100: q.expectedCededPer100,
    poolPremiumRatePer100: q.poolPremiumRatePer100,
    adminRatePer100: q.adminRatePer100,
    reinsRatePer100: q.reinsRatePer100,
    totalMemberChargeRatePer100: q.totalMemberChargeRatePer100,
  };
}

export function computeFundingConsequence(
  confidenceLevel: number,
  reinsuranceLevel: number,
  priorTotalMemberChargeRatePer100: number | null,
  line: CoverageLine,
  atExpected: boolean,
  book: FundingConsequenceBook,
): FundingConsequence {
  const {
    clf, purePremiumPer100, netPurePremiumPer100, expectedCededPer100,
    poolPremiumRatePer100, adminRatePer100, reinsRatePer100, totalMemberChargeRatePer100,
  } = ratesAt(confidenceLevel, reinsuranceLevel, line, atExpected, book);

  // Computed UNCONDITIONALLY (not only while atExpected) — cheap, and useful
  // for the UI to show "Expected (~X%)" even before the player selects it.
  const expectedPercentile = expectedPercentileFor(line);

  // THE LOAD stays on the GROSS pure premium — "what members pay per dollar of
  // expected loss" is a gross-basis question and is the one the panel label
  // asks.
  const load = purePremiumPer100 > 0 ? totalMemberChargeRatePer100 / purePremiumPer100 : 0;

  // ⚠ THE RATIOS ARE ON THE NET NUMERATOR, matching the engine's
  // expectedLossRatioMemberBasis exactly. The old form here was 1/load — a
  // GROSS numerator over the member charge — which is precisely the basis
  // mismatch the engine carried until it was fixed. Reproducing it here would
  // have re-imported the defect into the display.
  const denom = totalMemberChargeRatePer100;
  const expectedLossRatio = denom > 0 ? netPurePremiumPer100 / denom : 0;
  const expectedExpenseRatio = denom > 0 ? (adminRatePer100 + reinsRatePer100) / denom : 0;
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
    : (ratesAt(nextLevel, reinsuranceLevel, line, false, book).poolPremiumRatePer100 / Math.max(poolPremiumRatePer100, 1e-9) - 1) * 100;

  return {
    // Overridden to the crossing percentile while atExpected, so "Adequate in
    // ~X%" reports the percentile actually being charged (CLF 1.000) rather
    // than the stale fallback slider value.
    confidenceLevel: atExpected ? expectedPercentile : confidenceLevel,
    expectedPercentile,
    clf,
    purePremiumPer100,
    expectedCededPer100,
    netPurePremiumPer100,
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
