// THE RATE STACK — ONE definition, called by the engine and by the Decisions
// panel that explains it.
//
// ============================================================================
// WHY THIS MODULE EXISTS. The panel used to re-derive the price from its own
// formulas and claimed, in a comment, to use "the SAME formulas
// simulationEngine.ts actually prices with". That claim decayed silently twice:
//
//   NET FUNDING       the engine subtracts expected ceded before the CLF; the
//                     panel did not. GL's pool premium rate read $5.63 on the
//                     Decisions screen against the engine's $3.26 — 73% high,
//                     on the screen where the decision is made.
//   TOWER PRICING     the engine prices WC/GL per layer off measured expected
//                     ceded loss; the panel charged the (now-retired)
//                     REINSURANCE_PROGRAMS' percentage of premium, a
//                     structure those lines left.
//
// Both were invisible for the worst possible reason: the panel's combined ratio
// was internally consistent ON ITS OWN GROSS BASIS and read 100.0%, and when
// the engine's own combined-ratio basis was fixed it also became 100.0%. The
// two agreed on the single summary number anyone would have checked while every
// component underneath differed.
//
// So the fix is not a third parallel definition kept in step by discipline. The
// engine and the panel now call THIS function, and parity is structural rather
// than asserted. scripts/diagnostics/panel-engine-parity-check.ts still asserts
// it component by component — never on the combined ratio, which is exactly the
// check that would have passed throughout.
// ============================================================================
//
// ⚠ THE CLF IS AN INPUT, DELIBERATELY. Resolving it needs lookupCLF, which
// lives in simulationEngine, and importing that here would make a cycle. Both
// callers already resolve it the same way — the engine via its selectedFundingCLF
// dispatch, the panel via fundingConsequence's clfFor — and the parity harness
// covers the pair, so passing it in costs nothing and keeps this module a leaf.
//
// ⚠ THIS IS THE PRE-MOVEMENT QUOTE. It answers "what would this year cost on
// the book as it stands", which is the question the panel asks and the same one
// the engine asks to build the price signal members respond to. The engine's
// FINAL premium re-runs the same arithmetic on the POST-movement book, so it
// differs by whoever joins or leaves — see the parity harness, which measures
// that residual rather than pretending it is zero.

import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM } from '../data/defaultAssumptions';
import { normalizeAggregateStopLevel, normalizeLayersPlaced, occurrenceProgramCost, quoteAggregate } from './reinsuranceTower';
import type { TowerLine } from '../data/reinsuranceTower';
import type { CoverageLine, Member } from '../types/simulation';

export interface LineRateInputs {
  line: CoverageLine;
  yearNumber: number;
  /** The line's ACTIVE book, pre-movement. The tower prices off the members
   *  themselves, so this is not interchangeable with an exposure total. */
  members: Member[];
  /** Sum of getMemberExposure over `members` for this line and year. Passed
   *  rather than recomputed so the caller's own exposure figure is the one
   *  priced against. */
  exposure: number;
  /** GROSS pure premium per $100, for THIS year. Not last year's stored value:
   *  WC and GL re-derive it from held constants times the year's trends. */
  purePremiumPer100: number;
  clf: number;
  /** rateLevel / 100. Permanently 1 today; carried so the identity survives if
   *  the rate level ever moves again. */
  pricingAdjustment: number;
  layersPlaced: boolean[];
  aggregateStopLevel: number;
}

export interface LineRateQuote {
  purePremiumPer100: number;
  expectedCededPer100: number;
  netPurePremiumPer100: number;
  poolPremiumRatePer100: number;
  adminRatePer100: number;
  reinsuranceCost: number;
  reinsRatePer100: number;
  totalMemberChargeRatePer100: number;
  poolPremium: number;
  /** Returned so the engine can REUSE the quote for its post-movement pass
   *  instead of pricing the tower twice — the same "return it rather than
   *  recompute it" rule the net-funding change was built on. */
  towerQuote: ReturnType<typeof occurrenceProgramCost> | null;
  aggregateQuote: ReturnType<typeof quoteAggregate> | null;
}

// ⚠ OPERATION ORDER IS LOAD-BEARING AND MATCHES simulationEngine's estimate
// block STATEMENT FOR STATEMENT. This was extracted from it verbatim, not
// rewritten to taste: reassociating any of these float operations would move
// engine values, and both export gates would (correctly) go red.
export function quoteLineRates(input: LineRateInputs): LineRateQuote {
  const {
    line, yearNumber, members, exposure, purePremiumPer100, clf,
    pricingAdjustment, layersPlaced, aggregateStopLevel,
  } = input;

  const isWcClaimLine = line === 'WC';
  const isPropertyClaimLine = line === 'Property';
  const isAggregateLine = isWcClaimLine || isPropertyClaimLine;
  const isClaimLine = isWcClaimLine || line === 'GL' || isPropertyClaimLine;

  const placedForCost = isClaimLine
    ? normalizeLayersPlaced(line as TowerLine, layersPlaced)
    : null;
  const towerQuote = isClaimLine && placedForCost
    ? occurrenceProgramCost(line as TowerLine, placedForCost, members, yearNumber)
    : null;

  // ADMIN STAYS ON THE GROSS PURE PREMIUM, matching the engine. The pool
  // adjusts, reserves and pays a ceded claim in full and only then recovers, so
  // ceding transfers the loss and not the handling cost.
  const adminRatePer100 = purePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;

  // Read through the same normalizer the engine uses — see its header. Keeps
  // the panel and the engine agreeing about whether an aggregate exists at all,
  // which is the parity property this module exists to guarantee.
  const aggLevel = placedForCost
    ? normalizeAggregateStopLevel(line as TowerLine, placedForCost, aggregateStopLevel)
    : -1;
  const aggregateQuote = isAggregateLine && placedForCost && aggLevel >= 0
    ? quoteAggregate(
        line as 'WC' | 'Property', placedForCost, members,
        exposure * purePremiumPer100 * 10_000,
        aggLevel, yearNumber,
      )
    : null;

  const expectedCededDollars =
    (towerQuote?.expectedCeded ?? 0) + (aggregateQuote?.expectedCeded ?? 0);
  const expectedCededPer100 =
    expectedCededDollars / Math.max(exposure * 10_000, 1);
  const netPurePremiumPer100 =
    Math.max(0, purePremiumPer100 - expectedCededPer100);

  const poolPremiumRatePer100 =
    netPurePremiumPer100 * clf * pricingAdjustment;

  const poolPremium =
    exposure * poolPremiumRatePer100 * 10_000;

  // WC/GL/Property: the placed layers' premiums plus the aggregate (WC and
  // Property only), priced at runtime off the book. `isClaimLine` is
  // exhaustive over CoverageLine, so towerQuote is never actually null —
  // thrown rather than silently defaulted, so a future line without one
  // fails here instead of billing nothing for reinsurance.
  if (towerQuote === null) {
    throw new Error(`quoteLineRates: no tower quote for line ${line}`);
  }
  const reinsuranceCost = towerQuote.premium + (aggregateQuote?.premium ?? 0);

  const reinsRatePer100 = reinsuranceCost / Math.max(exposure * 10_000, 1);

  const totalMemberChargeRatePer100 =
    poolPremiumRatePer100
    + adminRatePer100
    + reinsRatePer100;

  return {
    purePremiumPer100,
    expectedCededPer100,
    netPurePremiumPer100,
    poolPremiumRatePer100,
    adminRatePer100,
    reinsuranceCost,
    reinsRatePer100,
    totalMemberChargeRatePer100,
    poolPremium,
    towerQuote,
    aggregateQuote,
  };
}
