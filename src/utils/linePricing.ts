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

/**
 * The book-and-decision inputs the CESSION depends on — everything
 * `expectedCededPer100For` needs that is not the rate itself.
 *
 * ⚠ `members` AND `exposure` ARE SEPARATE ON PURPOSE, AND THE ENGINE'S FINAL
 * PASS GENUINELY PASSES A MISMATCHED PAIR. The occurrence tower is quoted on
 * the PRE-movement book and reused rather than re-quoted (see the note at
 * `towerQuote` in simulationEngine), while the per-$100 divisor is the
 * POST-movement exposure the premium is actually charged on. Collapsing these
 * into one book would silently re-quote the tower and move engine values.
 */
export interface CessionBasis {
  /** The book the TOWER prices off. */
  members: Member[];
  /** The exposure the per-$100 rate is denominated in. */
  exposure: number;
  layersPlaced: boolean[];
  aggregateStopLevel: number;
}

export interface CessionQuote {
  towerQuote: ReturnType<typeof occurrenceProgramCost> | null;
  aggregateQuote: ReturnType<typeof quoteAggregate> | null;
  expectedCededPer100: number;
}

/**
 * THE ONE DEFINITION OF EXPECTED CESSION, in rate terms, at a given GROSS rate.
 *
 * ⚠ EXTRACTED FROM quoteLineRates VERBATIM, OPERATION ORDER INCLUDED, and it is
 * extracted rather than duplicated for a specific reason: the gross-up below
 * has to remove exactly what the net-funding subtraction will put back. Two
 * expressions of "expected ceded" that merely agree today would drift, and the
 * drift would land as a member charged the wrong price with every gate green.
 * There is one expression and both directions call it.
 */
export function expectedCededPer100For(
  line: CoverageLine,
  yearNumber: number,
  grossPurePremiumPer100: number,
  cession: CessionBasis,
): CessionQuote {
  const { members, exposure, layersPlaced, aggregateStopLevel } = cession;

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

  // Read through the same normalizer the engine uses — see its header. Keeps
  // the panel and the engine agreeing about whether an aggregate exists at all,
  // which is the parity property this module exists to guarantee.
  const aggLevel = placedForCost
    ? normalizeAggregateStopLevel(line as TowerLine, placedForCost, aggregateStopLevel)
    : -1;
  const aggregateQuote = isAggregateLine && placedForCost && aggLevel >= 0
    ? quoteAggregate(
        line as 'WC' | 'Property', placedForCost, members,
        exposure * grossPurePremiumPer100 * 10_000,
        aggLevel, yearNumber,
      )
    : null;

  const expectedCededDollars =
    (towerQuote?.expectedCeded ?? 0) + (aggregateQuote?.expectedCeded ?? 0);
  const expectedCededPer100 =
    expectedCededDollars / Math.max(exposure * 10_000, 1);

  return { towerQuote, aggregateQuote, expectedCededPer100 };
}

// ============================================================================
// THE GROSS-UP — turning a RETAINED loss cost into the GROSS rate this module's
// contract requires.
//
// ⚠ WHY IT EXISTS. `purePremiumPer100` is documented GROSS and every consumer
// depends on that: `expectedLoss` (the aggregate's own attachment basis and the
// reserve basis), the admin base, and the net-funding subtraction below. The
// held rate satisfies that contract. The EXPERIENCE rate does not: it is
// chain-laddered off ReserveDevelopmentRow, whose `ultimateByValuation` and
// `paidByValuation` are BOTH NET of reinsurance (see the ⚠ at paidByValuation),
// so it is already a retained rate. Handing it to the subtraction unconverted
// removed cession a SECOND time.
//
// ⚠ WHY A FIXED POINT RATHER THAN A SKIPPED SUBTRACTION. Skipping the
// subtraction on the experience path would leave two pricing paths differing by
// basis — the class of defect that produced this one — and would leave
// `expectedLoss` net while its own comment says it stays gross, which is the
// aggregate stop-loss's attachment basis. Grossing up keeps ONE path: the rate
// is gross wherever it is read, and the subtraction happens exactly once, in
// the place it always did.
//
// ⚠ THE FACTOR IS NOT A CONSTANT AND IS NOT FITTED. It is the solution of
//     g - expectedCededPer100For(g) = retained
// solved against the very function the subtraction calls, so the two are
// inverse by construction and cannot drift apart. The occurrence tower's ceded
// does not depend on the rate at all (occurrenceProgramCost reads only the book
// and the year), so on GL — which has no aggregate — this converges on the
// first pass to the exact additive answer g = retained + ceded. WC and Property
// need the iteration because their aggregate's attachment and limit are
// multiples of expected RETAINED loss, so their ceded moves with the rate. That
// dependence is linear with a small slope, so the map is a contraction and
// settles in a few passes. That is not assumed — it is asserted, and throws.
// ============================================================================

/** Relative tolerance on the round trip. Tight enough that gross-then-subtract
 *  returns the retained rate to float noise at the magnitudes involved, loose
 *  enough that the iteration always terminates. */
const GROSS_UP_TOL = 1e-12;
/** Convergence is geometric at the aggregate's marginal cession rate, which is
 *  far under 1. Twenty passes is well past where it settles; exhausting them
 *  means the contraction the header derives is false, so it throws rather than
 *  returning a rate nobody solved for. */
const GROSS_UP_MAX_ITER = 20;

export function grossUpRetainedPurePremium(
  line: CoverageLine,
  yearNumber: number,
  retainedPurePremiumPer100: number,
  cession: CessionBasis,
): number {
  let gross = retainedPurePremiumPer100;
  for (let i = 0; i < GROSS_UP_MAX_ITER; i++) {
    const { expectedCededPer100 } = expectedCededPer100For(line, yearNumber, gross, cession);
    const next = retainedPurePremiumPer100 + expectedCededPer100;
    if (Math.abs(next - gross) <= GROSS_UP_TOL * Math.max(1, Math.abs(next))) return next;
    gross = next;
  }
  throw new Error(
    `grossUpRetainedPurePremium: ${line} year ${yearNumber} did not converge in `
    + `${GROSS_UP_MAX_ITER} passes from a retained rate of ${retainedPurePremiumPer100}. `
    + 'The cession-against-rate map is no longer the contraction the header derives.',
  );
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

  // ADMIN STAYS ON THE GROSS PURE PREMIUM, matching the engine. The pool
  // adjusts, reserves and pays a ceded claim in full and only then recovers, so
  // ceding transfers the loss and not the handling cost.
  const adminRatePer100 = purePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;

  // ⚠ THE CESSION BLOCK THAT USED TO SIT INLINE HERE IS NOW
  // expectedCededPer100For ABOVE, CALLED RATHER THAN COPIED. It moved out
  // unchanged — same statements, same order — so that the gross-up can invert
  // exactly this arithmetic instead of a second copy of it. See that function's
  // header for why one definition is the whole point.
  const { towerQuote, aggregateQuote, expectedCededPer100 } = expectedCededPer100For(
    line, yearNumber, purePremiumPer100,
    { members, exposure, layersPlaced, aggregateStopLevel },
  );
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
