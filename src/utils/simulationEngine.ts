// Core simulation engine for Risk Pool Simulation v1
// Premium formula: Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { Claim, GameState, Occurrence, PoolState, DecisionSet, LinePoolState, LineDecisionSet, ResultSet, LineResultSet, ReserveCohort, Member, MemberLossResult, MembershipHistory, CoverageLine, GameInstance, AssetAllocation } from '../types/simulation';
import type { LineShockEffects, ShockFiring, ShockRecord } from '../types/shocks';
import { resolveShocks, ownFreqMultipliers, ownComponentFreqMultipliers, ownSevMultipliers } from './shockResolver';
import { WHOLE_LINE } from './shockEffects';

// Collapse the per-line shock records into one row per EVENT for the pool
// result, summing each cost across the lines that event touched and unioning
// the lines it affected. Returns undefined when no line recorded anything, so
// the pool result carries no empty array.
function mergeShockRecords(lineResults: LineResultSet[]): ShockRecord[] | undefined {
  const merged = new Map<string, ShockRecord>();
  for (const r of lineResults) {
    for (const rec of r.shockEvents ?? []) {
      const existing = merged.get(rec.shockId);
      if (!existing) { merged.set(rec.shockId, { ...rec, linesAffected: [...rec.linesAffected] }); continue; }
      existing.attributableGrossLoss += rec.attributableGrossLoss;
      existing.attributableClaims += rec.attributableClaims;
      existing.expectedGrossLossAdded += rec.expectedGrossLossAdded;
    }
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}
import { SeededRandom, deriveSubRng } from './random';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, AGGREGATE_LOSS_DISTRIBUTION, FUNDING_CLF_TABLE, MEMBER_LOSS_VOLATILITY, RISK_CONTROL_PARAMS, LINE_RESERVE_PAYDOWN_PCT, OPERATING_CASH_PCT_OF_PREMIUM, WC_LOSS_MODEL } from '../data/defaultAssumptions';
import { getReinsuranceStructure, calculateReinsuranceCost, calculateReinsuranceRecovery } from './reinsuranceEngine';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import {
  aggregateRecovery,
  cedeOccurrences,
  normalizeLayersPlaced,
  occurrenceProgramCost,
  occurrenceTotals,
  quoteAggregate,
} from './reinsuranceTower';
import { simulateMarketReturns, blendInvestmentReturn } from './investmentEngine';
import { simulateMemberMovement } from './membershipEngine';
import { cloneMembershipHistory, openInterval, closeInterval } from './membershipHistory';
import { cloneMemberLossHistory, recordMemberLossYear } from './memberLossHistory';
import { computeKLine, deriveNeutralPurePremiumPer100, expectedWcGrossLossForPricing, generateWcClaims, wcFrequencyTrend, wcSeverityTrend } from './wcClaimEngine';
import { hasStaticClf, staticClf } from '../data/clfTables';
import { computeKGl, deriveNeutralGlPurePremiumPer100, expectedGlGrossLossForPricing, generateGlClaims, glCappedSeverityTrend } from './glClaimEngine';
import { generateNarrative } from './narrativeEngine';
import { getMemberExposure } from './lineHelpers';
import { wageFactor } from '../data/exposureTrend';
import { getPredefinedMarketMembers } from '../data/memberCatalog';

export function lookupCLF(level: number): number {
  const rounded = Math.round(level * 20) / 20;
  const keys = Object.keys(FUNDING_CLF_TABLE).map(Number).sort((a, b) => a - b);

  let best = keys[0];
  let bestDiff = Math.abs(rounded - keys[0]);

  for (const k of keys) {
    const diff = Math.abs(rounded - k);
    if (diff < bestDiff) {
      best = k;
      bestDiff = diff;
    }
  }

  return FUNDING_CLF_TABLE[best];
}

// THE LOSS PROVISION THE POOL PREMIUM ACTUALLY FUNDS — the numerator every
// expected-loss ratio must use, and the reason it is a function rather than an
// inlined expression at each of its two call sites (line scope and pool
// aggregation).
//
// ⚠ WHY NOT expectedLoss. Since the net-funding change, poolPremium funds
// (gross expected - expected ceded) x CLF x rateLevel/100, while expectedLoss
// stays GROSS on purpose. Pairing gross expectedLoss with a denominator built
// on the net-funded poolPremium counts the ceded loss TWICE — once in the loss
// numerator and again as reinsuranceCost in the expense ratio — which is what
// pushed the Expected Combined Ratio to 130.0% on GL and 118.9% on WC while
// the pool was funding exactly its expected cost.
//
// ⚠ WHY DIVIDING BY THE CLF IS THE RIGHT INVERSION, and not merely convenient.
// poolPremium = exposure x netPurePremiumPer100 x CLF x pricingAdjustment x
// 10_000, so this returns net expected loss AT THE PRICED RATE LEVEL. That
// matters: the identity below has to close for any pricingAdjustment, not just
// the 1.0 it currently sits at, and re-deriving the net loss from the pure
// premium instead would drop the rate-level factor and reopen the gap the
// moment rateLevel moves off 100.
//
// THE IDENTITY THIS EXISTS TO PRESERVE. poolPremium + adminExpense +
// reinsuranceCost is identically totalMemberCharge, so at CLF 1.000 this
// numerator IS poolPremium and the Expected Combined Ratio is EXACTLY 1.0000 —
// not approximately. Above CLF 1.000 the shortfall below 1.0000 is the funding
// margin, which is the whole point of a confidence level. Asserted to float
// precision in scripts/diagnostics/ratio-basis-check.ts; if it stops closing
// exactly, this function or its callers are wrong.
//
// PROPERTY IS UNCHANGED BY CONSTRUCTION, which is what makes this a diagnosis
// rather than a guess: Property is deliberately not netted, so its
// netPurePremiumPer100 IS its gross pure premium and this returns exactly the
// expectedLoss it already used. Property-solo must stay byte-identical.
function fundedNetExpectedLoss(r: { poolPremium: number; selectedFundingCLF: number }): number {
  return r.poolPremium / Math.max(r.selectedFundingCLF, 1e-9);
}

// The claim lines' pure premiums: derived ONCE, at module load, from each
// claim generator's analytic expectation over the FULL canonical roster at
// neutral risk quality, then held for every line-year of every game. This is
// the finding-6 fix — losses and premium are two views of the same model
// rather than two independent assertions that drift apart. Computed rather
// than hardcoded so they can never fall out of step with the generators'
// parameters.
// KNOWN AND ACCEPTED BY DESIGN — the enrolled-book composition effect.
// Holding these off the NEUTRAL FULL BOOK means a given year's enrolled roster
// is priced at the full market's average loss cost per exposure dollar, not its
// own. k_line/k_GL correct the risk-quality tilt but deliberately NOT the
// payroll/relativity mix of who actually enrolled. Measured for GL at 40 seeds
// x 5 years: enrolled-book neutral pure premium 6.7807 vs the held 6.8305, so
// the book is priced ~0.7% high, which moves the analytic gross loss ratio from
// 66.8% to 66.36% — inside tolerance.
// This is the PRICE of Correction 1, not a defect. Making the pure premium
// track the enrolled mix would rebuild exactly the pricing-chases-roster
// feedback loop Correction 1 exists to prevent: premium would fall as good
// risks left, which changes who leaves next year, and the loss ratio would
// wander instead of holding. Do not "fix" this.
const WC_HELD_PURE_PREMIUM_PER_100 = deriveNeutralPurePremiumPer100(getPredefinedMarketMembers());
const GL_HELD_PURE_PREMIUM_PER_100 = deriveNeutralGlPurePremiumPer100(getPredefinedMarketMembers());

// Line-specific label for a seeded sub-RNG stream. WC keeps its original,
// unsuffixed label so a WC-only game's random draws (and therefore the Stage
// 1.2 regression baseline) are completely unaffected by other lines existing.
// Every other line gets its own independent stream via a suffixed label.
function lineRngLabel(base: string, line: CoverageLine): string {
  return line === 'WC' ? base : `${base}_${line}`;
}

// Context needed to process a single line's year. cash is this line's
// allocated SHARE of the pool's shared operating cash (see processYear).
// investments/investedAssets are this line's OWN
// segregated portfolio (Stage 2.9 — carried on LinePoolState, not split from a
// shared pot), and investmentIncome/investmentReturnRate come from this line's
// own seeded draw against its own allocation.
interface LineYearContext {
  instance: GameInstance;
  yearNumber: number;
  calendarYear: number;
  allMarketMembers: Member[];
  // The authoritative per-line enrollment ledger (as of this year's entry,
  // plus earlier-processed lines' same-year updates — irrelevant to this
  // line's own per-line reads). Recruitment eligibility reads from THIS,
  // never from Member.status (see membershipHistory.ts).
  membershipHistory: MembershipHistory;
  // The year's pool-wide loss factor (mean 1), drawn ONCE in processYear and
  // shared by every line — the cross-line aggregate correlation that the
  // per-line commonLossFactor could not express. The WC and GL claim
  // generators consume it; Property still draws its own commonLossFactor and
  // IGNORES this, so there is no double application while it awaits its own
  // generator.
  gPool: number;
  // This line's slice of the year's shock resolution, PROJECTED DOWN from
  // processYear. Absent when nothing is in force, which keeps the no-shock code
  // path textually identical to what it was before shocks existed.
  //
  // A line receives only its OWN effects and cannot see another line's, which
  // is the point: events emit into several lines from one cause, but the
  // coordination happens at pool level and a line-local generator never learns
  // that another line exists.
  shock?: LineShockEffects;
  // The firings that touched this line, for RECORDING. Separate from `shock`
  // because effects are what the generators consume and firings are what the
  // audit page reads — a compounded frequency multiplier no longer knows which
  // events produced it, so the narrative has to travel alongside it.
  shockFirings?: ShockFiring[];
  cash: number;
  investments: number;
  assetAllocation: AssetAllocation;
  investedAssets: number;
  investmentIncome: number;
  investmentReturnRate: number;
  dividendBlocked: boolean; // true when this line carried a negative surplus in from last year
  priorResult?: LineResultSet;
}

// Shared fields this line's year processing updates. Investments are absent —
// each line's ending portfolio goes to its own LinePoolState.investedAssets.
interface LineYearShared {
  cash: number;
  unearnedPremium: number;
  allMarketMembers: Member[];
}

export function processLineYear(
  line: CoverageLine,
  lineState: LinePoolState,
  lineDecisions: LineDecisionSet,
  ctx: LineYearContext
): { updatedLineState: LinePoolState; updatedShared: LineYearShared; result: LineResultSet } {
  const { instance, yearNumber, calendarYear, priorResult } = ctx;

  const priorYearLossRatio = priorResult
    ? priorResult.grossUltimateLoss / Math.max(priorResult.grossPremium, 1)
    : undefined;

  // Moved ahead of the CLF lookup below (was declared just before member
  // movement) — WC's own CLF now needs the book BEFORE it can price, and this
  // is the only book available at that point: last year's ending enrolled
  // members, before this year's movement is computed. Real underwriting has
  // the same constraint (you price off the book you have, not one that
  // hasn't been determined yet); the "preliminary vs final" split already
  // used for estimatedExposure/estimatedPremium below is the same tolerance.
  const currentActiveMembers = lineState.members.filter(m => m.status === 'active');

  // --- Selected Funding Confidence ---
  // CLF is selected by the player and applied after the expected actuarial loss-cost rate is calculated.
  //
  // WC AND GL READ THEIR OWN MEASURED TABLES, NOT FUNDING_CLF_TABLE (finding 38,
  // then repeated for GL). FUNDING_CLF_TABLE is the real pool's measured curve
  // at $20-30B of payroll and cannot describe either line's own distribution.
  //
  // ⚠ THOSE TABLES ARE NOW STATIC AND MEASURED FROM THIS ENGINE — see
  // src/data/clfTables.ts. They replace the interpolated CV-indexed (WC) and
  // lambda-indexed (GL) Monte Carlo grids, which were derived from a MODEL of
  // the draw rather than the draw: measured against the engine, WC's grid
  // over-delivered at every one of nine stops. A static table backtested on the
  // engine cannot carry that class of error.
  //
  // Two consequences of the table being one curve per line: it takes NO book
  // argument (the book holds near 62 members since the membership equilibrium
  // fix, so the size axis bought little), and it is calibrated at the DEFAULT
  // layer placement (declining layers costs up to ~8.9pp of label accuracy —
  // measured, and recorded at clfTables.ts).
  //
  // Property is unaffected: it has no Claim/Occurrence objects, was never in
  // scope, and still reads FUNDING_CLF_TABLE.
  const selectedFundingConfidenceLevel = lineDecisions.fundingConfidenceLevel;
  // ⚠ THE PRE-MOVEMENT k_line / k_GL THAT USED TO BE COMPUTED HERE IS GONE.
  // It existed only to index the retired CV/lambda grids, and the static tables
  // take no book argument. The DRAW's own k is unaffected and is still computed
  // further down (computeKLine / computeKGl on memberResult.activeMembers) —
  // that is a different quantity on a different book, and deleting this one does
  // not touch it. Net effect: one full pass over the book, computing two
  // expected-loss sums, removed from the pricing path each line-year.
  // fundingAtExpected bypasses the table entirely: "Expected" is CLF = 1.000
  // exactly, at every book size, every year — not an interpolated value that
  // happens to land close (see the LineDecisionSet.fundingAtExpected comment).
  // Property ignores the flag, same as before.
  const selectedFundingCLF = hasStaticClf(line)
    ? (lineDecisions.fundingAtExpected ? 1.0 : staticClf(line, selectedFundingConfidenceLevel))
    : lookupCLF(selectedFundingConfidenceLevel);

  // --- Expected Actuarial Loss-Cost Rate ---
  // Expected losses evolve independently from pricing decisions.
  //
  // CLF-ONLY PRICING: the Rate Change decision was removed (funding confidence
  // is now the sole pricing lever), so rateLevel no longer has anything to move
  // it — it stays at its starting value forever and pricingAdjustment is
  // therefore permanently 1. Both fields are kept (rateLevel is still stored
  // and displayed) rather than deleted, since removing them was not requested
  // and they remain harmlessly accurate: the rate level really is unchanged.
  const newRateLevel = lineState.rateLevel;
  const pricingAdjustment = newRateLevel / 100;

  const lossTrend = instance.lossEnvironment.lossTrend;
  const priorRCEffectiveness = lineState.riskControlEffectiveness;
  const maxRC = RISK_CONTROL_PARAMS.maxEffectiveness;

  const rcGain =
    (lineDecisions.riskControlPct / 0.08) *
    (maxRC / RISK_CONTROL_PARAMS.lagYears);

  const rcDecay =
    priorRCEffectiveness *
    RISK_CONTROL_PARAMS.decayRate *
    (lineDecisions.riskControlPct < 0.01 ? 2 : 1);

  const newRCEffectiveness = Math.max(
    0,
    Math.min(maxRC, priorRCEffectiveness + rcGain - rcDecay)
  );

  // WC and GL price off their claim generators' OWN analytic expectations, so
  // premium and losses share one basis by construction — the finding-6
  // constraint.
  //
  // Derived ONCE from the neutral book (full canonical roster at RQ 5) and
  // then HELD: they do not track the roster year to year, because k_line/k_GL
  // already make the per-year roster/risk-quality-mix correction. Letting
  // both chase enrollment would double-correct and make the loss ratio wander.
  //
  // Risk control is deliberately ABSENT here while multiplying the draws'
  // frequency (finding 17): applying it to both sides would cancel and rebuild
  // the no-op. Instance lossTrend is likewise absent from the claim lines —
  // GL's 7% social inflation acts on the accident-to-settlement lag, which is
  // year-invariant, so its expectation (and held premium) is constant.
  // lossTrend remains Property-only.
  //
  // ⚠ WC'S FREQUENCY TREND IS NOW PRICED, AND IT DID NOT USE TO BE. The draw has
  // always trended frequency at -1.5%/yr with year 1 as the reference; the price
  // was a single held constant that never saw the year. So realized loss ran below
  // the priced level BY CONSTRUCTION and the gap compounded — 93.5% of expected
  // averaged over ten years, which turned an expected 100.0% combined ratio into a
  // measured 93.9% and accounted for essentially all of the pool's underwriting
  // drift. It was documented as deliberate and inherited from the retired model;
  // it is overturned here.
  //
  // THIS DOES NOT BREAK THE HELD-PURE-PREMIUM RULE. The rule exists because
  // RE-DERIVING the pick each year double-corrects against k_line, which already
  // makes the roster/risk-quality-mix correction, and creates a pricing-chases-
  // roster feedback loop. wcFrequencyTrend is a pure function of yearNumber and
  // one constant — it cannot see the roster — so the derivation stays held and
  // only a deterministic factor is applied on top. Note the WC branch reads the
  // HELD CONSTANT, never lineState.purePremiumPer100, so the factor is applied
  // fresh each year rather than compounding off last year's stored value; only
  // Property's branch compounds, and deliberately.
  // WC'S RATE CARRIES THREE DETERMINISTIC FACTORS, and all three must be here or
  // the draw and the price diverge — the defect finding 37 corrected, and it is
  // reintroduced by adding any one of them without the others.
  //
  //   x wcFrequencyTrend    -1.5%/yr   claims per worker fall
  //   x wcSeverityTrend     +3.67%/yr  each claim costs more
  //   / wageFactor          +3.63%/yr  the rate is per $100 of NOMINAL payroll,
  //                                    and the denominator has grown
  //
  //   net: 0.985 x 1.0367 / 1.0363 = 0.98538  ->  -1.462%/yr
  //
  // The severity and wage factors nearly cancel BY CONSTRUCTION (indemnity
  // benefits are a statutory fraction of wage), which is why the rate trend is
  // very close to the frequency trend alone. Dividing by wageFactor is what makes
  // premium growth come out at freqTrend x sevTrend = +2.115%/yr INDEPENDENT of
  // the wage rate — a useful check: if premium growth moves when only
  // WAGE_INFLATION_PER_YEAR changes, one of these three is missing.
  //
  // Still HELD: WC_HELD_PURE_PREMIUM_PER_100 is derived once from the neutral
  // full-roster expectation. All three factors are pure functions of the year and
  // cannot see the roster, so k_line keeps sole responsibility for the
  // roster/risk-quality-mix correction.
  const newPurePremiumPer100 = line === 'WC'
    ? WC_HELD_PURE_PREMIUM_PER_100
      * wcFrequencyTrend(yearNumber)
      * wcSeverityTrend(yearNumber)
      / wageFactor('WC', yearNumber)
    : line === 'GL'
    // GL CARRIES TWO OF THE THREE, and both must be here for the same reason
    // WC's three must (finding 37). GL has NO frequency trend — its frequency is
    // flat by design — so:
    //
    //   x glCappedSeverityTrend  ~+5.48%/yr  each claim costs more
    //   / wageFactor              +3.63%/yr  the rate is per $100 of NOMINAL
    //                                        payroll, and the denominator grew
    //
    // ⚠ THE SEVERITY FACTOR IS glCappedSeverityTrend, NOT glSeverityTrend, AND
    // THAT IS LOAD-BEARING. GL_SEVERITY_CAP is a FIXED $100M ceiling that does
    // not inflate, so the capped expected claim grows strictly slower than the
    // raw trend — 1.6112 rather than 1.6473 by year 10. Pricing on the raw trend
    // would charge for dollars the capped generator cannot produce: +2.24% by
    // year 10, +5.82% by year 20. See glCappedSeverityTrend's own header; it is
    // still a deterministic ROSTER-BLIND function of the year, so it may ride on
    // top of a held pure premium exactly as the raw trend did.
    //
    // Because frequency is flat, PREMIUM growth comes out at the CAPPED severity
    // trend alone, INDEPENDENT of the wage rate — the cheapest available test
    // that both factors are present, and asserted in gl-claim-check. If premium
    // growth moves when only WAGE_INFLATION_PER_YEAR changes, one of these two
    // is missing.
    //
    // Still HELD: GL_HELD_PURE_PREMIUM_PER_100 is derived once at
    // HELD_PURE_PREMIUM_YEAR (= 1) from the neutral full-roster expectation, so
    // the trend rides on top here rather than being baked in twice. Both factors
    // are pure functions of the year and cannot see the roster, so k_GL keeps
    // sole responsibility for the roster/risk-quality-mix correction.
    ? GL_HELD_PURE_PREMIUM_PER_100
      * glCappedSeverityTrend(yearNumber)
      / wageFactor('GL', yearNumber)
    : lineState.purePremiumPer100 *
      (1 + lossTrend) *
      (1 - newRCEffectiveness);

  // Preliminary contribution estimate used only for member movement.
  // Final premium is recalculated after member movement because exposure changes.
  // (currentActiveMembers is now declared above, ahead of the CLF lookup.)
  const estimatedExposure = currentActiveMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);

  // --- THE PRICE SIGNAL MEMBERS RESPOND TO ---------------------------------
  //
  // Members react to what they are CHARGED, which is the total member charge
  // rate — pool premium + admin + reinsurance, per $100 of exposure — not the
  // pool premium rate alone. Two derived quantities go into member movement,
  // and they deliberately drive different things:
  //
  //   RATE CHANGE, vs last year's rate, drives RETENTION and SATISFACTION.
  //     Members notice increases year over year.
  //   RATE LEVEL, as the load over pure premium, drives NEW BUSINESS.
  //     Prospects compare levels. A pool overpriced for five straight years
  //     shows no rate CHANGE at all and would otherwise escape entirely.
  //
  // ⚠ A RATE COMPARISON, NOT A BILL COMPARISON, and that is the whole point.
  // Payroll grows every year, so bills grow every year; a member whose payroll
  // rose 4% and whose bill rose 4% has not been asked for more. The rate has
  // the exposure growth already divided out. This is the same basis and the
  // same field pairing fundingConsequence.ts's derivedRateChangePct uses —
  // this year's total member charge rate against lineState.ratePer100, which
  // IS last year's total member charge rate. It is not a second definition of
  // the quantity; it is the same one, sourced inside the engine where the
  // reinsurance cost is tower-aware. fundingConsequence's own reinsurance term
  // is still the legacy percentage-of-premium one and is therefore blind to
  // layersPlaced — calling it here would have made the tower, the single
  // biggest price event in the game, invisible to the channel built to see it.
  //
  // PRELIMINARY, exactly like estimatedPremium above and for the same reason:
  // movement has to run before the final exposure is known, so it is priced off
  // the book we have. For WC/GL the occurrence tower cost is not an estimate at
  // all — occurrenceProgramCost reads the pre-movement book and the year, so
  // the value hoisted here is bit-identical to the one the final charge uses,
  // and it is reused below rather than recomputed.
  const isWcClaimLine = line === 'WC';
  const isGlClaimLine = line === 'GL';
  const isClaimLine = isWcClaimLine || isGlClaimLine;

  const placedForCost = isClaimLine
    ? normalizeLayersPlaced(line as TowerLine, lineDecisions.layersPlaced)
    : null;
  const towerQuote = isClaimLine && placedForCost
    ? occurrenceProgramCost(line as TowerLine, placedForCost, currentActiveMembers, yearNumber)
    : null;

  const estimatedAdminRatePer100 = newPurePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  // The WC aggregate is the one component that cannot be hoisted exactly — it
  // prices off expectedLoss, which needs the post-movement exposure. Estimated
  // here on the pre-movement book, and inert at defaults (aggregateStopLevel -1).
  //
  // ⚠ IT CEDES EXPECTED LOSS TOO, and its expected recovery comes from a
  // different function than the occurrence layers' — quoteAggregate's own
  // `expectedCeded`. Netting only the occurrence tower would leave the aggregate
  // double-collected, which is the easiest piece of this to miss.
  const estimatedAggregateQuote = isWcClaimLine && placedForCost && lineDecisions.aggregateStopLevel >= 0
    ? quoteAggregate(
        placedForCost, currentActiveMembers,
        estimatedExposure * newPurePremiumPer100 * 10_000,
        lineDecisions.aggregateStopLevel, yearNumber,
      )
    : null;

  // --- NET FUNDING BASIS ----------------------------------------------------
  //
  // The pool premium funds the loss the pool will actually KEEP, so expected
  // ceded comes off the contribution before the CLF is applied.
  //
  // WHAT THIS FIXES. The premium used to fund GROSS expected loss while the P&L
  // charged NET ultimate loss, so the ceded portion was collected twice — once
  // inside the pool premium and again as the reinsurance premium members pay on
  // top — and the pool banked the difference. Measured at bdc98ec, that was
  // $11.84M/yr on GL and $4.22M/yr on WC of margin nobody had decided to charge.
  // It also inverted the reinsurance decision: the more the pool ceded, the more
  // expected ceded it collected and kept, so buying the maximum tower was always
  // correct for the pool regardless of what it cost members.
  //
  // ⚠ IT REFLECTS WHICH LAYERS ARE ACTUALLY PLACED. `towerQuote.expectedCeded`
  // sums only the placed layers, so declining a layer leaves that layer's
  // expected ceded inside the pool premium — correctly, because the pool is then
  // keeping that loss. This is what finally makes declining a layer a real
  // two-sided choice: the member charge falls by the layer's PREMIUM but rises
  // by its EXPECTED CEDED, and the net saving is the risk load alone.
  //
  // ⚠ PROPERTY IS DELIBERATELY NOT NETTED, and this is a known residual rather
  // than an oversight. Property's cover is the legacy percentage-of-premium
  // aggregate from REINSURANCE_PROGRAMS, whose attachment is a multiple of
  // expected loss and whose LIMIT is a percentage of the pool premium — so
  // netting it would make the premium depend on a structure that depends on the
  // premium. It also has no closed-form expected-ceded to read; WC and GL have
  // one only because towerMoments exists for them. Measured residual: Property
  // cedes 2.2% of gross, about $0.14M/yr, against GL's 43.5%.
  const estimatedExpectedCededDollars =
    (towerQuote?.expectedCeded ?? 0) + (estimatedAggregateQuote?.expectedCeded ?? 0);
  const estimatedExpectedCededPer100 =
    estimatedExpectedCededDollars / Math.max(estimatedExposure * 10_000, 1);
  // Floored at zero: a book so small that expected ceded exceeded the whole pure
  // premium would otherwise produce a negative contribution rate.
  const estimatedNetPurePremiumPer100 =
    Math.max(0, newPurePremiumPer100 - estimatedExpectedCededPer100);

  const estimatedRateAtConfidenceLevelPer100 =
    estimatedNetPurePremiumPer100 * selectedFundingCLF * pricingAdjustment;

  const estimatedPremium =
    estimatedExposure * estimatedRateAtConfidenceLevelPer100 * 10_000;

  const estimatedReinsuranceCost = towerQuote !== null
    ? towerQuote.premium + (estimatedAggregateQuote?.premium ?? 0)
    : calculateReinsuranceCost(
        lineDecisions.reinsuranceLevel, estimatedPremium, instance.marketEnvironment.competitivePressure,
      );

  const estimatedTotalMemberRatePer100 =
    estimatedRateAtConfidenceLevelPer100
    + estimatedAdminRatePer100
    + estimatedReinsuranceCost / Math.max(estimatedExposure * 10_000, 1);

  // vs last year's total member charge rate. NULL when there is no usable
  // prior — see priceSignalFor in membershipEngine for how null is treated.
  const priorTotalMemberRatePer100 = lineState.ratePer100 > 0 ? lineState.ratePer100 : null;
  const rateChangePct = priorTotalMemberRatePer100 !== null
    ? (estimatedTotalMemberRatePer100 / priorTotalMemberRatePer100 - 1) * 100
    : null;
  // Scale-free, so it is comparable across lines and years: what the pool
  // charges per dollar of expected loss.
  const rateLoad = newPurePremiumPer100 > 0
    ? estimatedTotalMemberRatePer100 / newPurePremiumPer100
    : null;

  const memberRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('members', line));

  const memberResult = simulateMemberMovement({
    currentMembers: currentActiveMembers,
    allMarketMembers: ctx.allMarketMembers,
    membershipHistory: ctx.membershipHistory,
    decisions: lineDecisions,
    line,
    currentMemberSatisfaction: lineState.memberSatisfaction,
    currentRiskQuality: lineState.averageRiskQuality,
    surplus: lineState.surplus,
    annualPremium: estimatedPremium,
    priorYearLossRatio,
    rateChangePct,
    rateLoad,
    competitivePressure: instance.marketEnvironment.competitivePressure,
    memberSensitivity: instance.marketEnvironment.memberSensitivity,
    yearNumber,
    calendarYear,
    rng: memberRng,
  });

  const activeExposure = memberResult.activeExposure;
  const totalMarketExposure = memberResult.totalMarketExposure;
  const marketShare = activeExposure / Math.max(totalMarketExposure, 0.01);

  const updatedAllMembers: Member[] = ctx.allMarketMembers.map(m => {
    const active = memberResult.activeMembers.find(a => a.id === m.id);
    if (active) return active;

    const withdrawn = memberResult.withdrawnMembers.find(w => w.id === m.id);
    if (withdrawn) return withdrawn;

    return m;
  });

  const writtenExposure = activeExposure;

  // Expected loss is based only on payroll and Pure Premium.
  //
  // ⚠ STAYS GROSS, and every consumer of it depends on that. It is the aggregate
  // stop-loss's attachment basis, the reserve basis, and the finding-6 pricing
  // denominator. The net-funding change moves the PREMIUM basis only — it must
  // not move the loss quantities.
  const expectedLoss = activeExposure * newPurePremiumPer100 * 10_000;

  // The WC aggregate, priced on the REAL post-movement expectedLoss. Its
  // expected ceded is netted out of the pool premium below alongside the
  // occurrence layers'.
  const aggregateQuote = isWcClaimLine && placedForCost && lineDecisions.aggregateStopLevel >= 0
    ? quoteAggregate(
        placedForCost, currentActiveMembers, expectedLoss, lineDecisions.aggregateStopLevel, yearNumber,
      )
    : null;

  // NET FUNDING — see the long note at the preliminary rate above for why the
  // pool premium funds net rather than gross, and for why Property is excluded.
  const expectedCededDollars =
    (towerQuote?.expectedCeded ?? 0) + (aggregateQuote?.expectedCeded ?? 0);
  const expectedCededPer100 = expectedCededDollars / Math.max(activeExposure * 10_000, 1);
  const netPurePremiumPer100 = Math.max(0, newPurePremiumPer100 - expectedCededPer100);

  const rateAtConfidenceLevelPer100 =
    netPurePremiumPer100 * selectedFundingCLF * pricingAdjustment;

  const poolPremiumRatePer100 = rateAtConfidenceLevelPer100;

  const poolPremium =
    activeExposure * rateAtConfidenceLevelPer100 * 10_000;

  // ⚠ ADMIN STAYS ON THE GROSS EXPECTED LOSS, deliberately. The pool adjusts,
  // reserves and pays a ceded claim in full and only then recovers from the
  // reinsurer, so administering it costs exactly what administering a retained
  // claim costs — ceding transfers the LOSS, not the handling. Moving admin to
  // the net basis would understate the pool's real expense by the cession share:
  // worth 0.13 per $100 on GL at the default all-layers placement, which on a
  // $400M book is about $0.5M/yr of expense the pool would stop collecting for
  // work it still has to do.
  const adminExpense = expectedLoss * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  const adminRatePer100 = newPurePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  const poolPremiumAndAdminExpense = poolPremium + adminExpense;

  // isWcClaimLine / isGlClaimLine / isClaimLine are now declared further up,
  // above member movement, because the price signal fed into movement needs the
  // reinsurance cost and therefore needs to know which product this line buys.

  const reinsStructure = getReinsuranceStructure(
    lineDecisions.reinsuranceLevel,
    poolPremium,
    expectedLoss
  );

  // REINSURANCE COST — two products, same seam as the recovery below.
  //
  // WC/GL: sum of the PLACED occurrence layers' premiums, each priced as
  // E[ceded] + lambda x SD[ceded] off the measured per-$100-of-exposure
  // constants, PLUS the WC aggregate's runtime-computed premium. This replaces a
  // flat 37.5% of pool premium, which scaled with the CLF and therefore charged
  // 69% more at 85% confidence than at 60% for IDENTICAL cover — a price with no
  // connection to the risk transferred.
  //
  // Property: unchanged, still a percentage of premium off REINSURANCE_PROGRAMS.
  let reinsuranceCost: number;
  if (towerQuote !== null && placedForCost) {
    // COMPUTED FROM THE BOOK AND THE YEAR, not a frozen per-$100 rate times
    // nominal exposure. The old form charged a premium that grew at the wage rate
    // while the cover's value grew with the severity trend, and it applied one
    // book's SD/E to every book size. See towerMoments.ts.
    //
    // The occurrence component is REUSED from above rather than recomputed: it
    // reads only the pre-movement book and the year, so hoisting it to build the
    // price signal did not change it. The aggregate is quoted once, just above,
    // off the real post-movement expectedLoss, and both its premium and its
    // expected ceded come from that single quote.
    reinsuranceCost = towerQuote.premium + (aggregateQuote?.premium ?? 0);
  } else {
    reinsuranceCost = calculateReinsuranceCost(
      lineDecisions.reinsuranceLevel,
      poolPremium,
      instance.marketEnvironment.competitivePressure
    );
  }

  const totalMemberCharge = poolPremiumAndAdminExpense + reinsuranceCost;
  const totalMemberRatePer100 = totalMemberCharge / Math.max(activeExposure * 10_000, 1);

  // Legacy names remain populated for compatibility with older screens and exports.
  const grossPremium = totalMemberCharge;
  const operatingExpense = adminExpense;
  const riskControlInvestment = poolPremium * lineDecisions.riskControlPct;

  // --- Loss Simulation ---
  // WC and GL generate individual claims (design doc Parts A and B); Property
  // still draws the aggregate member-Gamma below until its generator exists.

  const lossRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('losses', line));

  // The aggregate annual factor for the NON-claim lines.
  //
  // WC IS NOW 1, NOT ctx.gPool. The WC severity rebuild removed the pool-year
  // factor from WC's generation path entirely, so there is no shared factor to
  // report — WC's year-to-year variation comes from its own frequency noise and
  // its severity tail. GL still consumes ctx.gPool, which is why the draw stays
  // (see WC_LOSS_MODEL.poolYearFactor).
  //
  // CONSEQUENCE, DELIBERATE: gPool was the model's ONLY cross-line correlation,
  // so WC is now independent of GL and Property. A bad WC year carries no
  // information about the others.
  const commonLossFactor = isWcClaimLine
    ? 1
    : isClaimLine
    ? ctx.gPool
    : lossRng.lognormal(
        AGGREGATE_LOSS_DISTRIBUTION.logMean,
        AGGREGATE_LOSS_DISTRIBUTION.logSigma
      ) * AGGREGATE_LOSS_DISTRIBUTION.actualLossLevelMultiplier;
  const catastropheThreshold =
    FUNDING_CLF_TABLE[AGGREGATE_LOSS_DISTRIBUTION.catastropheThresholdConfidence];
  const catastropheFactor = 1;

  let generatedClaims: Claim[] | undefined;
  let generatedOccurrences: Occurrence[] | undefined;
  let wcCountsByClass: Record<string, number> | undefined;
  let wcCountsByTier: Record<string, number> | undefined;
  let glClaimCount: number | undefined;
  let memberLossResults: MemberLossResult[];
  let aggregateMemberLoss: number;
  let marketMemberLossResults: MemberLossResult[] | undefined;
  // The mix correction actually applied to the draw — see LineResultSet.kLineApplied.
  let kLineApplied: number | undefined;
  let shockOccurred: boolean;

  // --- MARKETPLACE-WIDE GENERATION -------------------------------------------
  //
  // Claims are generated for ALL 200 canonical members every year. Only the
  // ENROLLED subset feeds pool losses, premium, reserves and reinsurance;
  // prospect claims exist solely as loss HISTORY, so that a prospect arrives
  // with a readable record instead of a blank one and adverse selection becomes
  // something the player can actually read.
  //
  // TWO GENERATOR CALLS, NOT ONE OVER 200, AND THAT IS THE POINT. k_line and
  // riskControlEffectiveness are properties of POOL MEMBERSHIP — k_line is the
  // enrolled book's risk-quality-mix correction, and risk control is a service
  // members buy. Applying either to a prospect would be wrong twice over: it
  // would give non-members free safety consulting, and it would make a
  // prospect's loss history depend on the enrolled book's RQ mix, which is
  // exactly the incoherence the per-member stream keying removed. So prospects
  // generate at kLine/kGl = 1 and rc = 0.
  //
  // Splitting the call costs nothing in draw terms: since stage 1, every
  // member-level stream is keyed on (seed, year, memberId), so a member's claims
  // are identical whether generated alone, with the pool, or with the whole
  // marketplace. Enrolment independence is what makes the split free —
  // asserted in scripts/diagnostics/enrolment-independence-check.ts.
  const enrolledMemberIds = new Set(memberResult.activeMembers.map(m => m.id));
  const marketplaceProspects = ctx.allMarketMembers.filter(m => !enrolledMemberIds.has(m.id));

  // Shock cost, accumulated per shockId by the effect application below and
  // read once at result assembly. Empty when no shock is in force.
  //
  // TWO SEPARATE NUMBERS, ON PURPOSE. An injected claim has an exactly
  // attributable cost. A frequency multiplier does NOT — a multiplied Poisson
  // draw cannot be decomposed into "the base claims" and "the extra ones", and
  // recovering it would need a counterfactual second draw of the whole line. So
  // the exact figure is reported where it exists and the analytic expectation
  // where it does not, and they are never summed into one misleading total.
  const shockAttributableLoss: Record<string, number> = {};
  const shockAttributableClaims: Record<string, number> = {};
  const shockExpectedAdded: Record<string, number> = {};

  if (isWcClaimLine) {
    // k_line is recomputed against the CURRENTLY ENROLLED book, after member
    // movement — it is the roster/risk-quality-mix correction, and the reason
    // purePremiumPer100 can be held constant instead of chasing enrollment.
    //
    // ⚠ ENROLLED BOOK, NOT THE FULL ROSTER. Marketplace-wide generation makes it
    // tempting to hand the 200-member roster to everything below; doing it here
    // would drive k_line to ~1 permanently and silently disable the correction.
    const kLine = computeKLine(memberResult.activeMembers);

    const generated = generateWcClaims({
      members: memberResult.activeMembers,
      yearNumber,
      calendarYear,
      instanceSeed: instance.seed,
      kLine,
      // Current-horizon component arrival-rate multipliers, DRAW ONLY like risk
      // control.
      //
      // ⚠ THEY DO NOT REACH PREMIUM, AND THAT IS THE POINT (ruled). The priced
      // expectedLoss is activeExposure x the HELD purePremiumPer100, not this
      // generator's analytic, so a legislative change raises realized losses
      // while premium stands still. The player must re-rate or bleed — a law
      // that makes claims more expensive does not politely raise your rates for
      // you. Second-order and equally deliberate: the reinsurance attachment is
      // 125% of that same unchanged expectedLoss, so the treaty does not adjust
      // either. Do not "fix" either of these.
      componentFreqMultipliers: ctx.shock?.componentFreqMultipliers,
      // Risk control acts on the DRAW ONLY (finding 17): it reduces realized
      // frequency without touching the pricing expectation, so it genuinely
      // moves the loss ratio instead of cancelling out.
      riskControlEffectiveness: newRCEffectiveness,
      injections: ctx.shock?.injections,
    });
    // PROSPECTS: the rest of the 200-member marketplace, generated at kLine = 1
    // and rc = 0. See the marketplaceProspects note above for why those two are
    // withheld and why this is a SECOND CALL rather than one call over 200.
    const prospectGenerated = marketplaceProspects.length > 0
      ? generateWcClaims({
        members: marketplaceProspects,
        yearNumber,
        calendarYear,
        instanceSeed: instance.seed,
        kLine: 1,
        riskControlEffectiveness: 0,
        // Market-wide conditions DO reach prospects: a statutory change or a bad
        // year is not a pool membership benefit. Pool-specific claim injections
        // do NOT — those are events landing on the pool's own book.
        componentFreqMultipliers: ctx.shock?.componentFreqMultipliers,
      })
      : undefined;
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    wcCountsByClass = generated.claimCountsByGroup;
    wcCountsByTier = generated.claimCountsByComponent;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    marketMemberLossResults = [
      ...generated.memberLossResults,
      ...(prospectGenerated?.memberLossResults ?? []),
    ];
    kLineApplied = kLine;

    // WC's shock flag: a claim from the heavy mixture component large enough to
    // matter. Replaces the retired "a catastrophic-tier claim occurred" test,
    // which named a tier that no longer exists. $1M is the per-occurrence
    // retention, so this reads as "the pool had a claim that pierced retention".
    shockOccurred = generated.claims.some(c => c.grossUltimate >= 1_000_000);

    // EXACT attribution: the engine returns one outcome per requested
    // injection, in order, and ctx.shock.injections carries the shockId that
    // asked for each. No estimation involved — these are specific claims.
    (ctx.shock?.injections ?? []).forEach((injection, i) => {
      const outcome = generated.injectionResults[i];
      if (!outcome) return;
      shockAttributableLoss[injection.shockId] = (shockAttributableLoss[injection.shockId] ?? 0) + outcome.gross;
      shockAttributableClaims[injection.shockId] = (shockAttributableClaims[injection.shockId] ?? 0) + outcome.count;
    });

    // EXPECTED cost of any component multiplier in force, per event, measured
    // against the unshocked book with WC's own analytic. Reconstructing the
    // expectation here would create a second definition of WC's expected loss.
    //
    // PRICING BASIS on both sides: the difference is what the EVENT adds, and
    // measuring it on a basis that includes the risk-quality severity tilt would
    // fold the book's RQ mix into a figure attributed to the shock.
    if (ctx.shock?.componentFreqMultipliers && ctx.shockFirings?.length) {
      const baseline = expectedWcGrossLossForPricing(memberResult.activeMembers, { kLine, yearNumber });
      for (const firing of ctx.shockFirings) {
        const multipliers = ownComponentFreqMultipliers(firing.shockId, 'WC');
        if (!multipliers) continue;
        shockExpectedAdded[firing.shockId] = expectedWcGrossLossForPricing(memberResult.activeMembers, {
          kLine, yearNumber, componentFreqMultipliers: multipliers,
        }) - baseline;
      }
    }
  } else if (isGlClaimLine) {
    // Same discipline as WC: k_GL is the per-year roster/risk-quality-mix
    // correction against the currently enrolled book; the pure premium itself
    // is held (step 6b) rather than chasing enrollment.
    // ⚠ ENROLLED BOOK, NOT THE FULL ROSTER — same trap as WC's k_line above.
    const kGl = computeKGl(memberResult.activeMembers, yearNumber);
    const generated = generateGlClaims({
      members: memberResult.activeMembers,
      yearNumber,
      calendarYear,
      instanceSeed: instance.seed,
      kGl,
      gPool: ctx.gPool,
      // Risk control acts on the DRAW ONLY (finding 17), as in WC.
      riskControlEffectiveness: newRCEffectiveness,
      // Shock frequency multipliers, also DRAW ONLY and for the same reason: a
      // shock is a realized event, not a repricing.
      freqMultipliers: ctx.shock?.freqMultipliers,
      sevMultipliers: ctx.shock?.sevMultipliers,
    });
    // PROSPECTS at kGl = 1, rc = 0 — see the marketplaceProspects note above.
    const prospectGenerated = marketplaceProspects.length > 0
      ? generateGlClaims({
        members: marketplaceProspects,
        yearNumber,
        calendarYear,
        instanceSeed: instance.seed,
        kGl: 1,
        riskControlEffectiveness: 0,
        freqMultipliers: ctx.shock?.freqMultipliers,
        sevMultipliers: ctx.shock?.sevMultipliers,
        gPool: ctx.gPool,
      })
      : undefined;
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    glClaimCount = generated.claimCount;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    marketMemberLossResults = [
      ...generated.memberLossResults,
      ...(prospectGenerated?.memberLossResults ?? []),
    ];
    kLineApplied = kGl;
    // GL's shock event (ruled J11): any single occurrence exceeds $1M.
    // Occurrence == claim for GL now, so this is the largest single claim.
    shockOccurred = generated.maxOccurrenceGross > 1_000_000;

    // The EXPECTED cost of any frequency shock on this line, attributed per
    // event. Computed as the difference between GL's own analytic expectation
    // with and without the multipliers, rather than reconstructed — a second
    // definition of GL's expected loss would drift from the first.
    //
    // PER EVENT INDEPENDENTLY: each firing is priced against the unshocked
    // baseline using only its OWN effects. When two events compound on GL
    // (both are whole-line multipliers now — no sub-coverage left to target)
    // their individual figures therefore do not sum to the combined effect,
    // which is correct — each answers "what did this event add", not "how do
    // we split the interaction".
    if ((ctx.shock?.freqMultipliers || ctx.shock?.sevMultipliers) && ctx.shockFirings?.length) {
      const baseline = expectedGlGrossLossForPricing(memberResult.activeMembers, { yearNumber, kGl });
      for (const firing of ctx.shockFirings) {
        const ownFreq = ownFreqMultipliers(firing.shockId, 'GL');
        const ownSev = ownSevMultipliers(firing.shockId, 'GL');
        if (!ownFreq && !ownSev) continue;
        // A SEVERITY multiplier scales the whole expectation linearly, so it is
        // applied here rather than threaded into the expectation's options: the
        // analytic has no severity-shock parameter, and giving it one would put
        // a shock inside the PRICING function, which is exactly what must not
        // happen. This stays a measurement of the event's cost.
        const sevFactor = ownSev?.[WHOLE_LINE] ?? 1;
        const shocked = expectedGlGrossLossForPricing(memberResult.activeMembers, {
          yearNumber, kGl, ...(ownFreq ? { freqMultipliers: ownFreq } : {}),
        }) * sevFactor;
        shockExpectedAdded[firing.shockId] = shocked - baseline;
      }
    }
  } else {
    shockOccurred = commonLossFactor > catastropheThreshold;
    memberLossResults = memberResult.activeMembers.map(member => {
      const memberExposureAmount = getMemberExposure(member, line, yearNumber);
      const memberExpectedLoss = memberExposureAmount * newPurePremiumPer100 * 10_000;
      const riskQuality = Math.max(1, Math.min(10, member.riskQuality));
      const coefficientOfVariation = MEMBER_LOSS_VOLATILITY.worstRiskCV
        + ((riskQuality - 1) / 9)
          * (MEMBER_LOSS_VOLATILITY.bestRiskCV - MEMBER_LOSS_VOLATILITY.worstRiskCV);
      const standardDeviation = memberExpectedLoss * coefficientOfVariation;
      const shape = 1 / (coefficientOfVariation * coefficientOfVariation);
      const scale = memberExpectedLoss * coefficientOfVariation * coefficientOfVariation;
      const independentLoss = lossRng.gamma(shape, scale);

      return {
        memberId: member.id,
        memberName: member.name,
        exposure: memberExposureAmount,
        riskQuality: member.riskQuality,
        expectedLoss: memberExpectedLoss,
        coefficientOfVariation,
        standardDeviation,
        simulatedLoss: independentLoss * commonLossFactor * catastropheFactor,
      };
    });
    aggregateMemberLoss = memberLossResults.reduce(
      (sum, memberLoss) => sum + memberLoss.simulatedLoss,
      0
    );
  }

  // Claim lines carry their shock inside the drawn claims themselves; the
  // separate shock-amount add-on only exists for the aggregate (Property) path.
  const shockLossAmount = shockOccurred && !isClaimLine
    ? expectedLoss * Math.max(0, commonLossFactor - catastropheThreshold)
    : 0;

  let grossUltimateLoss = aggregateMemberLoss;

  grossUltimateLoss = Math.max(0, grossUltimateLoss);

  // --- REINSURANCE: two products, split at the isClaimLine seam -------------
  //
  // WC and GL run the PER-OCCURRENCE TOWER (cap -> retention -> layers, then WC's
  // aggregate stop-loss on what remains retained). Property runs the LEGACY
  // AGGREGATE QUOTA SHARE, untouched, because it has no Claim/Occurrence objects
  // to layer — it still draws the aggregate member-Gamma above. That is why
  // `reinsuranceLevel` and REINSURANCE_PROGRAMS are still live: they are
  // Property's product now, not dead code.
  let reinsuranceRecovery: number;
  let cededByLayer: number[] = [];
  let retainedAboveTower = 0;
  let aggregateRecoveryAmount = 0;
  let aggregatePremium = 0;
  let aggregateAttachment = 0;
  let attachment: number;

  if (isClaimLine && (isWcClaimLine || isGlClaimLine)) {
    const towerLine = line as TowerLine;
    const placed = normalizeLayersPlaced(towerLine, lineDecisions.layersPlaced);
    const totals = occurrenceTotals(generatedClaims ?? [], generatedOccurrences ?? []);
    const cession = cedeOccurrences(towerLine, totals, placed);
    cededByLayer = cession.cededByLayer;
    retainedAboveTower = cession.retainedAboveTower;

    // The aggregate sits on RETAINED loss, so it applies AFTER the occurrence
    // layers — including loss retained through layers the player DECLINED. That
    // scope is what makes the aggregate respond to the layer selection at all.
    if (towerLine === 'WC' && lineDecisions.aggregateStopLevel >= 0) {
      const quote = quoteAggregate(
        placed,
        currentActiveMembers,
        expectedLoss,
        lineDecisions.aggregateStopLevel,
        yearNumber,
      );
      aggregatePremium = quote.premium;
      aggregateAttachment = quote.attachment;
      aggregateRecoveryAmount = aggregateRecovery(cession.retained, quote);
    }

    reinsuranceRecovery = cession.totalCeded + aggregateRecoveryAmount;
    // The tower's own retention, for the Pool/Excess display split.
    attachment = REINSURANCE_TOWER[towerLine][0].attachment;
  } else {
    reinsuranceRecovery = calculateReinsuranceRecovery(grossUltimateLoss, reinsStructure);
    // Pool Losses / Excess Losses split uses each level's real attachment point
    // (125% of expected loss for Self Fund/Low/Moderate/High, 100% for Full Transfer).
    attachment = reinsStructure.attachment;
  }

  const netUltimateLoss = grossUltimateLoss - reinsuranceRecovery;
  const poolLosses = Math.min(grossUltimateLoss, attachment);
  const excessLosses = Math.max(0, grossUltimateLoss - attachment);
  const quotaShareLosses = excessLosses - reinsuranceRecovery;

  // --- Investment Income ---
  // This line's own segregated portfolio (Stage 2.9): drawn in processYear from
  // this line's own invested assets and its own asset allocation.
  const investedAssets = ctx.investedAssets;
  const investmentIncome = ctx.investmentIncome;
  const investmentReturnRate = ctx.investmentReturnRate;

  // --- Reserve Development ---
  // Process existing reserve cohorts. These are accounting reserve cohorts.
  // CLF does not multiply booked reserves.
  const devRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('dev', line));

  // Legacy compatibility: this currently uses prior premium funding adequacy.
  // Later, this could be renamed or separated from reserve adequacy.
  const priorFundingAdequacyRatio = priorResult?.fundingAdequacyRatio ?? 1.0;

  const {
    developmentImpact,
    updatedCohorts,
    netPaidThisYear,
  } = processReserveDevelopment(
    lineState.reserveCohorts,
    devRng,
    priorFundingAdequacyRatio
  );

  // Current year reserve assumption: 60% unpaid, 40% paid. NET basis —
  // reinsurance recovery cash arrives in lockstep with the claim payments it
  // offsets, so losses enter the reserve rollforward net of recoveries and no
  // separate recoverable receivable exists.
  const currentYearNetReserve = netUltimateLoss * 0.60;
  const netPaidCurrentYear = netUltimateLoss * 0.40;

  const currentYearCohort: ReserveCohort = {
    yearNumber,
    calendarYear,
    netUltimate: netUltimateLoss,
    netPaid: netPaidCurrentYear,
    netUnpaid: currentYearNetReserve,
    paydownPct: LINE_RESERVE_PAYDOWN_PCT[line],
    developmentFactor: 1 + devRng.range(-0.05, 0.08),
    closed: false,
  };

  const allCohorts = [...updatedCohorts, currentYearCohort];

  // ⚠ THE IBNR PROVISION THAT STOOD HERE IS GONE, WITH WC'S REPORT LAG.
  //
  // WHY, so the intent survives the deletion. WC was the only line with a report
  // lag: GL had zero references to one and Property a single comment. That made
  // WC's grossUltimateLoss a CALENDAR-year reported figure while GL's and
  // Property's were ACCIDENT-year — one field meaning two different things
  // depending on the line, which is what surfaced this.
  //
  // ⚠ THIS IS A REPLACEMENT, NOT AN ABANDONMENT. IBNR is retired in favour of
  // IBNER: claims reported immediately but booked at an initial estimate below
  // ultimate, converging over several years. That is the better mechanic on four
  // counts, and each is a reason this removal loses nothing:
  //   it applies to ALL THREE LINES, not to WC alone
  //   it needs no deferral architecture — no inventory, no carry-forward, no
  //     per-claim reportYear, none of the machinery just deleted
  //   it makes reserve development a REAL quantity rather than a random wobble
  //   and it is already open item 9: claims are drawn at ultimate and never
  //     develop, so the reserve cannot currently be wrong in an interesting way
  //
  // What went with it: the per-component p_delayed draw and the lognormal lag,
  // the unreported-claim inventory and its carry-forward, wcIbnr.ts and its
  // chain-ladder, emergedGross / newlyDelayed / delayedGross / delayedCount, and
  // ibnrReserve / ibnrAccrual. currentAccidentYearGross collapsed into
  // grossUltimateLoss because with no deferral they are the same number.
  //
  // ⚠ priorYearDevelopment IS NOW PURE WOBBLE, and it was mostly wobble before.
  // It reads processReserveDevelopment's developmentFactor, 1 + rng.range(-0.05,
  // 0.08) per cohort — it never read emergence. The REAL prior-year quantity was
  // emergedPriorYearLoss (median $1.54M/yr, non-zero in 100% of line-years), and
  // that is what this removal takes away. So reserve development is now a random
  // walk with nothing behind it until IBNER lands, which is precisely the gap
  // IBNER is meant to fill — recorded here rather than left to be rediscovered.

  // --- Accounting Reserves ---
  // These are expected unpaid losses (net of reinsurance) from all accident
  // years. They are the booked balance sheet reserves and are NOT CLF-loaded.
  //
  // Case cohorts only, now that IBNR is gone. Every line's reserve is the same
  // quantity again.
  const endingNetReserve = allCohorts.reduce((s, c) => s + c.netUnpaid, 0);

  const expectedNetUnpaidLoss = endingNetReserve;

  const beginningNetReserve = lineState.reserveCohorts.reduce((s, c) => s + c.netUnpaid, 0);

  // --- Income Statement ---
  // Use reserve-rollforward incurred loss so the income statement and balance sheet tie.
  // This keeps the financial statement logic consistent with the reserve accounting.
  const assessments = poolPremium * lineDecisions.assessmentPct;
  // A line carrying a negative surplus into the year (declined a loan) cannot pay
  // a dividend — the decision is blocked regardless of what was requested.
  const effectiveDividendPct = ctx.dividendBlocked ? 0 : lineDecisions.dividendPct;
  const dividends = poolPremium * effectiveDividendPct;

  // Keep this as a displayed reserve development metric (net basis).
  // Do not add it separately to net income because reserve development is already captured
  // in the incurred loss formula below through the change in unpaid reserves.
  const priorYearDevelopment = developmentImpact;

  const netPaidLossesThisYear = netPaidCurrentYear + netPaidThisYear;

  const netIncurredLoss =
    netPaidLossesThisYear +
    endingNetReserve -
    beginningNetReserve;

  // Underwriting Income excludes investment income: it is the pool's premium/assessment
  // revenue net of losses (incl. reserve development), expenses, risk control, reinsurance,
  // and dividends returned to members. Assessments and dividends are treated as offsets to
  // premium since they are collected/returned through the same member-charge mechanism.
  const underwritingIncome =
    totalMemberCharge +
    assessments -
    netIncurredLoss -
    operatingExpense -
    riskControlInvestment -
    reinsuranceCost -
    dividends;

  const netIncome = underwritingIncome + investmentIncome;

  // --- Balance Sheet ---
  // Balance sheet liabilities use expected unpaid losses, not CLF-loaded targets.
  // To keep the game model clean, written premium is treated as collected and earned in the year.
  // Unearned premium is held at zero rather than creating a separate timing layer.
  const beginingSurplus = lineState.surplus;

  const unearnedPremium = 0;

  const beginningCash = ctx.cash;

  const newCash =
    beginningCash +
    totalMemberCharge +
    assessments -
    netPaidLossesThisYear -
    operatingExpense -
    riskControlInvestment -
    reinsuranceCost -
    dividends;

  const beginningInvestments = ctx.investments;
  const investmentsBeforeSweep = Math.max(0, beginningInvestments + investmentIncome);

  // Sweep cash above the operating target into investments (where it earns a
  // return going forward); draw down investments to cover a cash shortfall
  // instead of letting it silently vanish. Total assets (cash + investments)
  // are conserved by this reallocation, except at the floor below.
  const operatingCashTarget = totalMemberCharge * OPERATING_CASH_PCT_OF_PREMIUM;
  let endingCash: number;
  let endingInvestments: number;
  if (newCash >= operatingCashTarget) {
    endingCash = operatingCashTarget;
    endingInvestments = investmentsBeforeSweep + (newCash - operatingCashTarget);
  } else {
    const shortfall = operatingCashTarget - newCash;
    const drawFromInvestments = Math.min(shortfall, investmentsBeforeSweep);
    endingCash = newCash + drawFromInvestments;
    endingInvestments = investmentsBeforeSweep - drawFromInvestments;
  }
  // No flooring at zero here: a line in deep distress can legitimately carry
  // negative cash (its portfolio is exhausted and it owes more than it holds).
  // Flooring would silently create assets and break the surplus tie-out.
  // Healthy games never reach this state (v4 baselines all tie out at 0).

  const totalAssets =
    endingCash +
    endingInvestments;

  const totalLiabilities =
    endingNetReserve +
    unearnedPremium;

  const endingSurplus = totalAssets - totalLiabilities;

  // --- Surplus Rollforward Validation ---
  const surplusFromIncome = beginingSurplus + netIncome;
  const surplusTieOutDifference = endingSurplus - surplusFromIncome;

  // --- CLF / Funding Confidence Logic ---
  // CLF is used to build the funding rate. It is NOT used to book accounting reserves.
  const clfAdjustedExpectedLoss = expectedLoss * selectedFundingCLF;

  // In this simplified contribution model, the selected CLF produces the contribution rate charged to members.
  // Operating expense, reinsurance, and risk control remain separate expenses.
  const requiredFundingPremium = poolPremiumAndAdminExpense;
  const actualPremium = poolPremiumAndAdminExpense;
  const premiumFundingGap = 0;
  const premiumFundingRatio = 1;
  const premiumFundingAdequacyStatus = 'Funded at Selected Confidence';

  const indicatedFundingRatePer100 = poolPremiumRatePer100 + adminRatePer100;
  const actualRatePer100 = indicatedFundingRatePer100;
  const rateFundingGapPer100 = 0;
  const rateAdequacyRatio = 1;

  // B. Reserve Confidence View
  // This is an indicated confidence-level view, not the booked accounting reserve.
  const netFundingTarget = expectedNetUnpaidLoss * selectedFundingCLF;
  const indicatedNetReserveAtConfidenceLevel = netFundingTarget;

  // Required reserve margin is always measured at the 90% CLF, independent of
  // the player's selected annual pricing confidence level. WC and GL read their
  // own tables here too, for the same reason as selectedFundingCLF above.
  //
  // ⚠ THIS SITE BECAME BASIS-CONSISTENT FOR THE FIRST TIME WITH THE STATIC
  // TABLES, and the effect is large enough to name. expectedNetUnpaidLoss is a
  // NET reserve, and the retired grids' 90% CLF was a percentile of the GROSS
  // annual loss distribution — a net quantity multiplied by a gross-basis
  // loading. The static tables are measured on RETAINED loss, so both sides of
  // this product are now net. GL's 90% CLF falls from ~1.79 to 1.3642 and WC's
  // from ~1.54 to 1.3893 as a result.
  //
  // ⚠ IT NO LONGER MOVES OPENING SURPLUS — and that is a deliberate repair, not
  // an accident of the current numbers. This margin USED to be the pre-game's
  // acceptance basis: runPriorHistory accepted an opening only inside
  // OPENING_MULTIPLE_BAND x THIS quantity, so every change to the reserve, to
  // the reserve-margin CLF, or to the funding basis re-rated every game's
  // starting surplus. It did, three commits running (f328d65, fab85e4, 962ef60);
  // the worst of it moved GL's median opening from $21.29M to $11.72M and needed
  // a MEDIAN OF 28 REDRAWS to land in band. The pre-game now tests against
  // PREMIUM (OPENING_SURPLUS_TO_PREMIUM_BAND), so this margin has no consumer on
  // the opening path at all. KEEP IT THAT WAY: if a future change wants to
  // condition the opening on reserve risk, that is a decision to argue for
  // explicitly, not a side effect to reintroduce.
  const reserveMarginCLF = hasStaticClf(line)
    ? staticClf(line, 0.90)
    : lookupCLF(0.90);
  const reserveRiskMarginNeeded = Math.max(
    0,
    expectedNetUnpaidLoss * (reserveMarginCLF - 1)
  );

  const fundingMarginNeeded = reserveRiskMarginNeeded;

  // C. Capital / Surplus Cushion
  // Surplus is compared to the extra CLF margin, not the full CLF-loaded unpaid loss.
  const availableFunding = endingSurplus;
  const availableSurplus = endingSurplus;

  const capitalFundingGap = availableSurplus - reserveRiskMarginNeeded;
  const excessAvailableSurplus = capitalFundingGap;
  const excessCapitalRatio = reserveRiskMarginNeeded > 0
    ? excessAvailableSurplus / reserveRiskMarginNeeded
    : null;
  const capitalAdequacyRatio = excessCapitalRatio;

  const capitalAdequacyStatus =
    excessCapitalRatio === null
      ? 'N/A'
      : excessCapitalRatio >= 0.25
      ? 'Strong'
      : excessCapitalRatio >= 0
        ? 'Adequate'
        : excessCapitalRatio >= -0.10
          ? 'Thin'
          : 'Deficient';

  // Legacy compatibility fields.
  // Going forward, fundingAdequacyRatio means premium funding adequacy.
  const fundingGap = capitalFundingGap;
  const fundingAdequacyRatio = premiumFundingRatio;
  const fundingAdequacyStatus = premiumFundingAdequacyStatus;
  const fundingCLF = selectedFundingCLF;
  const fundingAdequacyIndicator = premiumFundingAdequacyStatus;

  // --- Ratios ---
  // Use net incurred loss instead of net ultimate loss so the ratios match the accounting income statement.
  //
  // TWO DENOMINATORS EXIST AND THEY ARE NOT INTERCHANGEABLE (finding 6). Every
  // ratio below states which one it uses in its name, because mixing them is
  // the single most repeated error in this project:
  //
  //   PRICING BASIS      poolPremiumAndAdminExpense  = poolPremium + admin
  //                      -> the finding-6 reconciliation basis.
  //   MEMBER-CHARGE BASIS totalMemberCharge          = the above + reinsurance
  //                      -> what members actually pay, and the only basis on
  //                         which a loss ratio and an expense ratio may be
  //                         ADDED, since a combined ratio is meaningless unless
  //                         both terms share a denominator.
  //
  // ⚠ AND A DENOMINATOR IS ONLY HALF OF A BASIS. Both denominators now contain
  // the NET-funded poolPremium, so a GROSS numerator over either of them is
  // mixed even though it names its denominator correctly. That is the defect
  // this block carried from the net-funding change until it was measured: the
  // rule "state your denominator" was followed and was not enough. Both
  // expected-loss ratios below therefore take fundedNetExpectedLoss (see its
  // header for the identity and the inversion), not expectedLoss.
  //
  // ⚠ THE 66.8% TARGET IS OBSOLETE AND IS NOT WHAT THESE MEASURE. It was
  // gross / (gross x 1.346 + 0.15 x gross) — a GROSS-funded pool at the old
  // 75%-confidence default. Funding is net now and the default CLF is exactly
  // 1.000, so neither input survives. The two cutover harnesses still compare
  // their OWN gross numerator against it (gl-cutover-check.ts:156,
  // wc-cutover-check.ts) and read 139.21% on GL; those asserts sit behind a
  // non-default `6b` argv flag, so they never fire. Reported, deliberately NOT
  // silently re-pointed here: re-deriving a reconciliation target is its own
  // decision, and quietly moving the constant to match the code would destroy
  // the only record that the old one ever meant something.
  const expectedLossRatio =
    fundedNetExpectedLoss({ poolPremium, selectedFundingCLF }) / Math.max(poolPremiumAndAdminExpense, 1);
  const expectedLossRatioMemberBasis =
    fundedNetExpectedLoss({ poolPremium, selectedFundingCLF }) / Math.max(totalMemberCharge, 1);
  // Computed from the LIVE expense values, not as 1 - lossRatio. The old form
  // was a residual reverse-engineered to force the combined ratio to 1.000,
  // which is why the display insisted the pool broke even while surplus
  // tripled over five years.
  const expectedExpenseRatio =
    (adminExpense + reinsuranceCost) / Math.max(totalMemberCharge, 1);
  // Both terms on the member-charge basis AND both numerators on the net basis,
  // so this is a real combined ratio.
  //
  // AT CLF 1.000 IT IS EXACTLY 1.0000 — a closed identity, not a coincidence and
  // not an approximation, because poolPremium + adminExpense + reinsuranceCost
  // is identically totalMemberCharge. Above CLF 1.000 the shortfall below
  // 1.0000 IS the funding margin, which is what a confidence level above
  // expected is for. A reading above 1.0000 at CLF 1.000 means a numerator has
  // drifted off the net basis again.
  const expectedCombinedRatio = expectedLossRatioMemberBasis + expectedExpenseRatio;

  const actualLossRatio = netIncurredLoss / Math.max(totalMemberCharge, 1);
  const actualExpenseRatio =
    (adminExpense + reinsuranceCost) / Math.max(totalMemberCharge, 1);
  const actualCombinedRatio = actualLossRatio + actualExpenseRatio;

  const combinedRatio = actualCombinedRatio;
  const lossRatio = actualLossRatio;
  const expenseRatio = actualExpenseRatio;

  const result: LineResultSet = {
    yearNumber,
    calendarYear,
    line,
    decisions: lineDecisions,
    assetAllocation: ctx.assetAllocation,

    activeMembers: memberResult.activeMembers.length,
    newMembers: memberResult.newMembers.length,
    withdrawnMembers: memberResult.withdrawnMembers.length,
    activeExposure: parseFloat(activeExposure.toFixed(2)),
    totalMarketExposure: parseFloat(totalMarketExposure.toFixed(2)),
    marketShare: parseFloat(marketShare.toFixed(4)),
    memberRetentionRate: parseFloat(memberResult.retentionRate.toFixed(3)),
    memberSatisfaction: memberResult.memberSatisfaction,
    averageRiskQuality: memberResult.averageRiskQuality,
    memberList: memberResult.activeMembers,

    rateLevel: parseFloat(newRateLevel.toFixed(2)),
    ratePer100: parseFloat(totalMemberRatePer100.toFixed(4)),
    purePremiumPer100: parseFloat(newPurePremiumPer100.toFixed(4)),
    purePremium: parseFloat(newPurePremiumPer100.toFixed(4)),
    // Unrounded — see the type's comment for why these two skip the toFixed(4)
    // every sibling per-$100 field above gets.
    expectedCededPer100,
    netPurePremiumPer100,
    writtenExposure: parseFloat(writtenExposure.toFixed(2)),

    poolPremium,
    adminExpense,
    poolPremiumAndAdminExpense,
    totalMemberCharge,
    grossPremium,
    assessments,
    dividends,

    kLineApplied,
    memberLossResults,
    aggregateMemberLoss,
    marketMemberLossResults,
    claims: generatedClaims,
    occurrences: generatedOccurrences,
    claimCountsByClass: wcCountsByClass,
    claimCountsByTier: wcCountsByTier,
    claimCount: glClaimCount,
    commonLossFactor,
    catastropheFactor,
    shockLossAmount,
    grossUltimateLoss,
    shockLossIncurred: shockOccurred,
    shockEvents: ctx.shockFirings?.length
      ? ctx.shockFirings.map((f): ShockRecord => ({
          ...f,
          attributableGrossLoss: shockAttributableLoss[f.shockId] ?? 0,
          attributableClaims: shockAttributableClaims[f.shockId] ?? 0,
          expectedGrossLossAdded: shockExpectedAdded[f.shockId] ?? 0,
        }))
      : undefined,
    reinsuranceCost,
    attachment,
    poolLosses,
    excessLosses,
    quotaShareLosses,
    reinsuranceRecovery,
    cededByLayer,
    retainedAboveTower,
    aggregateRecovery: aggregateRecoveryAmount,
    aggregatePremium,
    aggregateAttachment,
    netUltimateLoss,
    netIncurredLoss,

    operatingExpense,
    riskControlInvestment,
    priorYearDevelopment,

    beginningNetReserve,
    currentYearNetReserve,
    netPaidLosses: netPaidLossesThisYear,
    endingNetReserve,

    investmentReturnRate,
    investedAssets,
    investmentIncome,

    // Inter-line loan fields — zero/false here; the loan overlay is applied in
    // processYear's post-pass (repayment) and applyLoanAuthorizations (origination).
    outstandingLoanBalance: 0,
    loanRepaymentApplied: 0,
    loanInterestAccrued: 0,
    loanOriginatedThisYear: 0,
    dividendBlocked: ctx.dividendBlocked,

    // CLF / funding confidence fields
    selectedFundingConfidenceLevel,
    selectedFundingCLF,

    expectedLoss,
    clfAdjustedExpectedLoss,
    requiredFundingPremium,
    actualPremium,
    premiumFundingGap,
    premiumFundingRatio,
    premiumFundingAdequacyStatus,

    indicatedFundingRatePer100,
    actualRatePer100,
    rateFundingGapPer100,
    rateAdequacyRatio,

    expectedNetUnpaidLoss,
    netFundingTarget,
    indicatedNetReserveAtConfidenceLevel,
    reserveRiskMarginNeeded,
    fundingMarginNeeded,

    availableFunding,
    availableSurplus,
    fundingGap,
    capitalFundingGap,
    excessAvailableSurplus,
    excessCapitalRatio,
    capitalAdequacyRatio,
    capitalAdequacyStatus,

    fundingAdequacyRatio,
    fundingAdequacyStatus,

    // Legacy fields
    fundingCLF,
    fundingAdequacyIndicator,

    // Income and balance sheet
    underwritingIncome,
    netIncome,
    beginningCash,
    endingCash,
    beginningInvestments,
    endingInvestments,
    totalAssets,
    unearnedPremium,
    totalLiabilities,
    beginingSurplus,
    endingSurplus,

    // Surplus rollforward validation
    surplusFromIncome,
    surplusTieOutDifference,

    // Ratios
    expectedLossRatio,
    expectedLossRatioMemberBasis,
    expectedExpenseRatio,
    expectedCombinedRatio,
    actualLossRatio,
    actualExpenseRatio,
    actualCombinedRatio,
    combinedRatio,
    lossRatio,
    expenseRatio,

    // Narrative is generated once at the pool level (see processYear), not per line.
    narrativeExplanation: '',
  };

  const updatedLineState: LinePoolState = {
    rateLevel: newRateLevel,
    ratePer100: totalMemberRatePer100,
    purePremiumPer100: newPurePremiumPer100,
    purePremium: newPurePremiumPer100,

    memberSatisfaction: memberResult.memberSatisfaction,
    averageRiskQuality: memberResult.averageRiskQuality,
    riskControlEffectiveness: newRCEffectiveness,

    reserveCohorts: allCohorts,
    members: memberResult.activeMembers,

    netUnpaidReserve: endingNetReserve,
    surplus: endingSurplus,
    investedAssets: endingInvestments,

    totalMarketExposure,
  };

  const updatedShared: LineYearShared = {
    cash: endingCash,
    unearnedPremium,
    allMarketMembers: updatedAllMembers,
  };

  return { updatedLineState, updatedShared, result };
}

// Each active line's share of the shared cash/other-assets pool. The weight is
// exactly what makes the line's allocated slice of the shared pot reproduce its
// own stored surplus (so the surplus rollforward ties out every year):
//   slice_needed = surplus + netReserve − investedAssets
// because surplus = [cash slice] + investedAssets − netReserve.
// Stage 2.9 subtracts investedAssets
// (each line's own portfolio is no longer part of the shared pot); before that,
// the pot included investments and the weight was surplus + netReserve. The sum
// of these weights equals the pot total by balance-sheet identity, so slices are
// exact and the rollforward ties out by construction. A weight may legitimately
// be NEGATIVE (a line whose shared-liabilities slice exceeds its shared-assets
// slice) — no flooring, or the identity breaks and every line's tie-out drifts.
// For a single active line the share is always 1 regardless of the formula, so
// a WC-only game is unaffected.
function computeContributionShares(
  poolState: PoolState,
  activeLines: CoverageLine[]
): Record<CoverageLine, number> {
  const raw = activeLines.map(line => {
    const ls = poolState.lines[line];
    const netReserve = Math.max(0, ls.netUnpaidReserve);
    return ls.surplus + netReserve - ls.investedAssets;
  });
  const total = raw.reduce((s, v) => s + v, 0);
  const shares = {} as Record<CoverageLine, number>;
  if (total === 0) {
    activeLines.forEach(line => { shares[line] = 1 / activeLines.length; });
    return shares;
  }
  activeLines.forEach((line, i) => { shares[line] = raw[i] / total; });
  return shares;
}

// A deficient line at year-end that the player may cover with an inter-line loan.
// Stage 2.9: the loan is a real transfer from specific lending lines' invested
// assets. lenderShares (fixed at origination) says which lines fund it and in
// what proportion. An offer only exists when the other lines can cover the FULL
// deficit without any lender's own surplus going negative — otherwise no offer
// is made and the line simply carries its negative surplus (the player can
// respond with an assessment).
export interface LoanOffer {
  line: CoverageLine;
  deficit: number;              // positive amount needed to bring the line to zero surplus
  rateAtOrigination: number;    // this year's pool return, floored at 0 (see poolReturnRateThisYear).
                                // Genuinely a one-time value for the OFFER — becomes the new loan's
                                // starting InterLineLoan.currentRate, which then re-floats every year.
  lenderShares: Partial<Record<CoverageLine, number>>; // each lender's share of the loan, sums to 1
}

// Full output of a processed year. loanOffers is non-empty only when one or
// more lines ended negative without an existing loan — the caller must resolve
// those (authorize/decline) via applyLoanAuthorizations before committing.
export interface ProcessYearResult {
  updatedPoolState: PoolState;
  result: ResultSet;
  lineResults: Array<{ line: CoverageLine; result: LineResultSet }>;
  loanOffers: LoanOffer[];
  priorPoolResult?: ResultSet;
}

// Stage 1.3: loops over all active lines. Stage 1.6 adds the inter-line loan
// system: an existing loan is serviced (repayment pass) during processing, and
// any line that ends negative without a loan produces a loanOffer for the
// player to resolve. When no line is deficient and no loan is outstanding, all
// of the loan logic is inert — a healthy WC-only game is byte-identical to v3.
export function processYear(
  gameState: GameState,
  rawDecisions: DecisionSet
): ProcessYearResult {
  // Pool-wide decisions (investment allocation, risk-control intensity) are
  // projected into every line's decision slice here — single source of truth
  // at the DecisionSet level, while the engine below and each line's locked
  // result snapshot keep their existing per-line shape untouched.
  const decisions: DecisionSet = {
    ...rawDecisions,
    byLine: Object.fromEntries(
      (Object.keys(rawDecisions.byLine) as CoverageLine[]).map(l => [l, {
        ...rawDecisions.byLine[l],
        assetAllocation: { ...rawDecisions.assetAllocation },
        riskControlPct: rawDecisions.riskControlPct,
      }])
    ) as Record<CoverageLine, LineDecisionSet>,
  };
  const { instance, poolState, currentYearNumber, setup } = gameState;
  const yearNumber = currentYearNumber;
  const calendarYear = setup.startingYear + yearNumber - 1;

  // Stage 2.10: live Year 1 sees the last pre-game year (year 0) as its prior
  // year — the game continues from its simulated history. Inside the pre-game
  // sim itself, priorHistory is empty, so year -2 has no prior (correct).
  const priorPoolResult = gameState.lockedResults[gameState.lockedResults.length - 1]
    ?? gameState.priorHistory[gameState.priorHistory.length - 1];

  const activeLines = setup.activeLines;
  const shares = computeContributionShares(poolState, activeLines);

  // Working copy of the loan ledger — repayments mutate balances / remove
  // paid-off loans below.
  let interLineLoans = poolState.interLineLoans.map(loan => ({ ...loan }));

  // Working copy of the membership-history ledger. Maintained by ROSTER DIFF
  // per line below (prior actives vs updated actives), so it records exactly
  // the transitions that actually happened regardless of internal movement
  // mechanics — a member withdrawn and re-recruited within the same year
  // never leaves the active roster and correctly records no transition.
  const membershipHistory = cloneMembershipHistory(poolState.membershipHistory);
  // Working clone, same contract as the ledger above. Defaulted for saves and
  // bootstrap states that predate stage 3.
  const memberLossHistory = cloneMemberLossHistory(poolState.memberLossHistory ?? {});

  let currentAllMarketMembers = poolState.allMarketMembers;
  const lineResults: Array<{ line: CoverageLine; result: LineResultSet }> = [];
  const updatedLineStates: Partial<Record<CoverageLine, LinePoolState>> = {};
  let sharedCash = 0;
  let sharedUnearnedPremium = 0;
  // Loan repayments owed back to each lending line this year (principal +
  // interest, since interest is embedded in the growing balance). Credited to
  // the lenders after the line loop so processing order doesn't matter.
  const lenderCredits: Partial<Record<CoverageLine, number>> = {};

  // Draw the shared market ONCE per year at the asset-class level (cash, bonds,
  // equities) and apply it to every line. Randomness lives at the asset class,
  // not per line, so two lines with the same allocation earn the same return
  // rate; each line differs only by its allocation and its own asset base. The
  // stream is the unsuffixed 'invest' label (unchanged for a WC-only game).
  const marketReturns = simulateMarketReturns(
    deriveSubRng(instance.seed, yearNumber, 'invest')
  );

  // THIS YEAR'S POOL RETURN RATE, for the inter-line loan (Stage 2.9): each
  // active line's realized return weighted by its BEGINNING invested assets.
  // With the pool-wide allocation every line earns the same rate, so the
  // blend trivially equals that shared rate — kept as a weighted blend so the
  // loan rate stays correct-by-construction either way. Computed in a pre-pass
  // (blendInvestmentReturn is pure — no RNG, no dependency on the main loop's
  // per-line mutations) because the loan's interest accrual, below, runs
  // INSIDE the per-line loop and needs this year's rate before any line has
  // been processed. It is deliberately recomputed from scratch every year,
  // never carried over from a loan's origination year — the loan represents
  // capital the lender could otherwise have invested, and that opportunity
  // cost is a CURRENT-year quantity, not a fact frozen at the moment the loan
  // was struck.
  //
  // FLOORED AT ZERO. A negative blended return is a real possibility (the
  // uploaded WC seed alone showed a year at -1.08%), and letting a loan accrue
  // at a negative rate would mean the debt SHRINKS on its own — the pool
  // paying the borrower for having borrowed, in a bad market year, is wrong
  // under any reading. The floor's worst case is "no interest this year," not
  // "the lenders lose principal to a market downturn that wasn't theirs to
  // absorb." DO NOT REMOVE THIS FLOOR as an unnecessary guard — it is the
  // entire fix for the defect verify/interline-loan@c4a2ecc found.
  const poolReturnRateThisYear = Math.max(0, (() => {
    let invested = 0, income = 0;
    for (const line of activeLines) {
      const r = blendInvestmentReturn(
        poolState.lines[line].investedAssets,
        decisions.byLine[line].assetAllocation,
        marketReturns
      );
      invested += poolState.lines[line].investedAssets;
      income += r.income;
    }
    return invested > 0 ? income / invested : 0;
  })());

  // The pool-wide loss factor for this year: ONE draw, SHARED by every line.
  // It has to live here rather than inside processLineYear because a per-line
  // deriveSubRng cannot express a draw common to all lines. Its own purpose
  // label means it consumes nothing from any existing stream.
  const gPool = deriveSubRng(instance.seed, yearNumber, 'wc_gpool')
    .gamma(WC_LOSS_MODEL.poolYearFactor.shape, WC_LOSS_MODEL.poolYearFactor.scale);

  // Shock resolution — pool level, for the same reason gPool is drawn here: a
  // per-line deriveSubRng cannot express something common to all lines, and a
  // single event can emit into several of them. Per-line effects are projected
  // into each LineYearContext below.
  //
  // CONSUMES NO RANDOMNESS, and returns undefined rather than an empty object
  // when nothing is in force, so a game with no shocks takes exactly the code
  // path it took before shocks existed.
  const shocks = resolveShocks(instance, yearNumber);

  // Sequential fold: each line sees the shared roster as updated by lines
  // already processed this year (a member withdrawing from one line becomes
  // ineligible for new recruitment into the next, but isn't retroactively
  // removed from lines it's already active on).
  for (const line of activeLines) {
    const share = shares[line];
    const lineState = poolState.lines[line];
    const lineDecisions = decisions.byLine[line];
    // A line that carried a negative surplus in from last year (declined a
    // loan) has its dividend blocked this year.
    //
    // KNOWN GAP, RULED NOT WORTH FIXING (verify/interline-loan@c4a2ecc): this
    // checks only the SIGN of last year's surplus, and a line that AUTHORIZED
    // a loan lands at exactly zero, not negative (applyLoanAuthorizations
    // makes endingSurplus = 0 an unconditional assignment) — so a line is NOT
    // dividend-blocked the year immediately after it borrows, even though it
    // is carrying the full loan balance as debt. Confirmed real: a line that
    // borrowed and landed at $0 was not dividend-blocked the following year
    // while still owing the loan. outstandingLoanBalance reaches no decision
    // gate or solvency check anywhere in this file — it is read only for
    // display, in resultMetrics.ts and the two results pages. Left as-is
    // because the repayment skim already takes the money out of net income
    // before a dividend could be declared from it, and a player who chooses
    // to distribute while indebted is choosing to make the line's position
    // worse, not exploiting an unintended path.
    const priorLineSurplus = priorPoolResult?.byLine[line]?.endingSurplus;
    const dividendBlocked = priorLineSurplus !== undefined && priorLineSurplus < 0;

    // Blend this year's shared market by this line's own allocation and asset
    // base (pure, no per-line draw): same allocation -> same rate across lines.
    const invResult = blendInvestmentReturn(
      lineState.investedAssets,
      lineDecisions.assetAllocation,
      marketReturns
    );

    const ctx: LineYearContext = {
      instance,
      yearNumber,
      calendarYear,
      allMarketMembers: currentAllMarketMembers,
      membershipHistory,
      gPool,
      shock: shocks?.byLine[line],
      shockFirings: shocks?.firings.filter(f => f.linesAffected.includes(line)),
      cash: poolState.cash * share,
      investments: lineState.investedAssets,
      assetAllocation: lineDecisions.assetAllocation,
      investedAssets: lineState.investedAssets,
      investmentIncome: invResult.income,
      investmentReturnRate: invResult.returnRate,
      dividendBlocked,
      priorResult: priorPoolResult?.byLine[line],
    };

    const { updatedLineState, updatedShared, result } = processLineYear(
      line,
      lineState,
      lineDecisions,
      ctx
    );

    // Ledger maintenance by roster diff: compare this line's active roster
    // before and after the year. Joins open an interval (active from this
    // year); departures close it (last active year = yearNumber - 1).
    {
      const prevActive = new Set(
        lineState.members.filter(m => m.status === 'active').map(m => m.id)
      );
      const nowActive = new Set(
        updatedLineState.members.filter(m => m.status === 'active').map(m => m.id)
      );
      for (const id of nowActive) {
        if (!prevActive.has(id)) openInterval(membershipHistory, id, line, yearNumber);
      }
      for (const id of prevActive) {
        if (!nowActive.has(id)) closeInterval(membershipHistory, id, line, yearNumber - 1);
      }
    }

    // Rolling loss history for this line — stage 3. Recorded HERE, after
    // processLineYear has returned, reading only the finished result: this is
    // downstream of every draw, so it cannot consume randomness or move a value.
    // That is what keeps both export gates green.
    //
    // MARKETPLACE-WIDE where the line has it. marketMemberLossResults carries
    // all 200 members (enrolled + prospects) for the claim-level lines; it is
    // undefined for Property, which still runs the legacy aggregate path and
    // therefore only produces per-member figures for its ENROLLED book. Falling
    // back to memberLossResults means Property gets real enrolled history now
    // and gains marketplace coverage automatically when its generator cuts over
    // — rather than being silently absent from the store, or forcing a special
    // case here that would have to be removed later.
    //
    // Both legs are read straight off the result. See memberLossHistory.ts for
    // why `expected` includes k_line and excludes risk control, and why that
    // asymmetry is held by invariant 2 rather than by convention.
    for (const mlr of result.marketMemberLossResults ?? result.memberLossResults) {
      recordMemberLossYear(memberLossHistory, mlr.memberId, line, {
        yearNumber,
        actual: mlr.simulatedLoss,
        expected: mlr.expectedLoss,
      });
    }

    // --- Inter-line loan repayment pass (existing loans only) ---
    const loan = interLineLoans.find(l => l.borrowingLine === line);
    if (loan) {
      // Re-blend at THIS year's floored pool return, not whatever rate the
      // loan happened to carry last year — see poolReturnRateThisYear above.
      loan.currentRate = poolReturnRateThisYear;
      const interest = loan.remainingBalance * loan.currentRate;
      loan.remainingBalance += interest;
      const aggressiveness = Math.max(0, Math.min(1, lineDecisions.loanRepaymentAggressiveness));
      const skim = aggressiveness * Math.max(0, result.netIncome);
      // A repayment can't exceed what the line actually holds in liquid assets
      // (investments + cash) — paying more would drive balances negative and
      // fabricate money on next year's balance sheet.
      const liquidAssets = Math.max(0, result.endingInvestments + result.endingCash);
      const applied = Math.min(skim, loan.remainingBalance, liquidAssets);
      loan.remainingBalance -= applied;

      // The skimmed income leaves the borrowing line (diverted to debt
      // service) and flows back to the lending lines in their fixed
      // origination shares; interest is this year's carrying cost. The
      // payment comes out of investments first, then cash.
      const fromInvestments = Math.min(applied, Math.max(0, result.endingInvestments));
      const fromCash = applied - fromInvestments;
      result.loanInterestAccrued = interest;
      result.loanRepaymentApplied = applied;
      result.endingSurplus -= applied;
      result.availableSurplus = result.endingSurplus;
      result.availableFunding = result.endingSurplus;
      result.endingInvestments -= fromInvestments;
      result.endingCash -= fromCash;
      result.totalAssets -= applied;
      updatedShared.cash = result.endingCash;

      for (const [lender, lenderShare] of Object.entries(loan.lenderShares)) {
        lenderCredits[lender as CoverageLine] =
          (lenderCredits[lender as CoverageLine] ?? 0) + applied * (lenderShare ?? 0);
      }

      updatedLineState.surplus = result.endingSurplus;
      updatedLineState.investedAssets = result.endingInvestments;

      // Close the loan once effectively repaid.
      if (loan.remainingBalance <= 1) {
        interLineLoans = interLineLoans.filter(l => l.borrowingLine !== line);
        result.outstandingLoanBalance = 0;
      } else {
        result.outstandingLoanBalance = loan.remainingBalance;
      }
    }

    currentAllMarketMembers = updatedShared.allMarketMembers;
    updatedLineStates[line] = updatedLineState;
    lineResults.push({ line, result });

    sharedCash += updatedShared.cash;
    sharedUnearnedPremium += updatedShared.unearnedPremium;
  }

  // --- Credit this year's loan repayments back to the lending lines ---
  // Applied after the loop so it works regardless of the order the borrower
  // and lenders were processed in.
  for (const [lenderKey, credit] of Object.entries(lenderCredits)) {
    const lender = lenderKey as CoverageLine;
    if (!credit) continue;
    const entry = lineResults.find(lr => lr.line === lender);
    const lenderState = updatedLineStates[lender];
    if (!entry || !lenderState) continue;
    entry.result.endingSurplus += credit;
    entry.result.availableSurplus = entry.result.endingSurplus;
    entry.result.availableFunding = entry.result.endingSurplus;
    entry.result.endingInvestments += credit;
    entry.result.totalAssets += credit;
    lenderState.surplus = entry.result.endingSurplus;
    lenderState.investedAssets = entry.result.endingInvestments;
  }

  const updatedPoolState: PoolState = {
    cash: sharedCash,
    unearnedPremium: sharedUnearnedPremium,
    allMarketMembers: currentAllMarketMembers,
    lines: {
      ...poolState.lines,
      ...updatedLineStates,
    },
    interLineLoans,
    membershipHistory,
    memberLossHistory,
  };

  // Detect deficient lines that don't already carry a loan — these become
  // offers the player resolves before the year is committed. Stage 2.9: an
  // offer only exists when the OTHER lines can fund the full deficit without
  // any lender's own surplus (or portfolio) going negative. Lending capacity
  // is consumed offer-by-offer so that authorizing every offer can never
  // overdraw a lender. A deficit no one can cover gets no offer — the line
  // carries its negative surplus (dividend blocked next year) and the player
  // can respond with an assessment.
  const lendingCapacity: Partial<Record<CoverageLine, number>> = {};
  for (const { line, result } of lineResults) {
    lendingCapacity[line] = Math.max(0, Math.min(result.endingSurplus, result.endingInvestments));
  }

  const loanOffers: LoanOffer[] = [];
  for (const { line, result } of lineResults) {
    if (result.endingSurplus >= 0 || interLineLoans.some(l => l.borrowingLine === line)) continue;
    const deficit = -result.endingSurplus;

    const lenders = activeLines.filter(l => l !== line && (lendingCapacity[l] ?? 0) > 0);
    const totalCapacity = lenders.reduce((s, l) => s + (lendingCapacity[l] ?? 0), 0);
    if (totalCapacity < deficit) continue; // no viable loan — auto-declined

    const lenderShares: Partial<Record<CoverageLine, number>> = {};
    for (const l of lenders) {
      const lenderShare = (lendingCapacity[l] ?? 0) / totalCapacity;
      lenderShares[l] = lenderShare;
      lendingCapacity[l] = (lendingCapacity[l] ?? 0) - deficit * lenderShare;
    }

    loanOffers.push({
      line,
      deficit,
      rateAtOrigination: poolReturnRateThisYear,
      lenderShares,
    });
  }

  const result = aggregateLineResults(lineResults, priorPoolResult);

  return { updatedPoolState, result, lineResults, loanOffers, priorPoolResult };
}

// Finalize a processed year after the player has chosen which loan offers to
// authorize. Stage 2.9: authorization is a REAL transfer — each lending line's
// invested assets are debited by its share of the deficit (its surplus drops
// accordingly, never below zero by construction of the offer), and the
// borrowing line's invested assets are credited by the full deficit, which
// brings its surplus to zero by balance-sheet identity. Declined lines keep
// their negative surplus. Re-aggregates the pool result so pool-level totals
// reflect the authorizations.
export function applyLoanAuthorizations(
  processed: ProcessYearResult,
  yearNumber: number,
  authorizedLines: CoverageLine[]
): { updatedPoolState: PoolState; result: ResultSet } {
  const authorized = new Set(authorizedLines);
  const newLoans = [...processed.updatedPoolState.interLineLoans];
  const updatedLines = { ...processed.updatedPoolState.lines };

  for (const offer of processed.loanOffers) {
    if (!authorized.has(offer.line)) continue;

    newLoans.push({
      borrowingLine: offer.line,
      principal: offer.deficit,
      remainingBalance: offer.deficit,
      currentRate: offer.rateAtOrigination,
      yearOriginated: yearNumber,
      lenderShares: offer.lenderShares,
    });

    // Debit each lending line by its share of the deficit.
    for (const [lenderKey, lenderShare] of Object.entries(offer.lenderShares)) {
      const lender = lenderKey as CoverageLine;
      const amount = offer.deficit * (lenderShare ?? 0);
      if (amount <= 0) continue;
      const lenderEntry = processed.lineResults.find(lr => lr.line === lender);
      if (lenderEntry) {
        lenderEntry.result.endingSurplus -= amount;
        lenderEntry.result.availableSurplus = lenderEntry.result.endingSurplus;
        lenderEntry.result.availableFunding = lenderEntry.result.endingSurplus;
        lenderEntry.result.endingInvestments -= amount;
        lenderEntry.result.totalAssets -= amount;
      }
      updatedLines[lender] = {
        ...updatedLines[lender],
        surplus: updatedLines[lender].surplus - amount,
        investedAssets: updatedLines[lender].investedAssets - amount,
      };
    }

    // Credit the borrowing line with the full deficit.
    const entry = processed.lineResults.find(lr => lr.line === offer.line);
    if (entry) {
      entry.result.endingSurplus = 0;
      entry.result.availableSurplus = 0;
      entry.result.availableFunding = 0;
      entry.result.endingInvestments += offer.deficit;
      entry.result.totalAssets += offer.deficit;
      entry.result.outstandingLoanBalance = offer.deficit;
      entry.result.loanOriginatedThisYear = offer.deficit;
    }
    updatedLines[offer.line] = {
      ...updatedLines[offer.line],
      surplus: 0,
      investedAssets: updatedLines[offer.line].investedAssets + offer.deficit,
    };
  }

  const updatedPoolState: PoolState = {
    ...processed.updatedPoolState,
    lines: updatedLines,
    interLineLoans: newLoans,
  };

  const result = aggregateLineResults(processed.lineResults, processed.priorPoolResult);

  return { updatedPoolState, result };
}

// Combines each active line's own LineResultSet into the pool-level ResultSet.
// Dollar/count fields are summed across lines; ratios are recomputed from the
// summed components (never summed directly); a handful of line-ambiguous
// descriptive/rate fields (rate level, CLF, decisions echo, status strings)
// show the first active line's value as a placeholder until Stage 2.1 adds a
// real per-line view. byLine always carries the full accurate per-line data.
export function aggregateLineResults(
  lineResults: Array<{ line: CoverageLine; result: LineResultSet }>,
  priorPoolResult: ResultSet | undefined
): ResultSet {
  const results = lineResults.map(r => r.result);
  const first = results[0];

  const sum = (key: keyof LineResultSet): number =>
    results.reduce((total, r) => total + (r[key] as unknown as number), 0);

  const activeMembersSum = sum('activeMembers');
  const totalMarketExposureSum = sum('totalMarketExposure');
  const activeExposureSum = sum('activeExposure');

  // Recompute pool-wide retention from each line's implied prior-active count
  // rather than averaging the per-line ratios.
  let retainedSum = 0;
  let priorActiveSum = 0;
  for (const r of results) {
    const retained = r.activeMembers - r.newMembers;
    retainedSum += retained;
    priorActiveSum += retained + r.withdrawnMembers;
  }
  const memberRetentionRate = priorActiveSum > 0
    ? parseFloat((retainedSum / priorActiveSum).toFixed(3))
    : 1;

  const memberSatisfaction = activeMembersSum > 0
    ? results.reduce((s, r) => s + r.memberSatisfaction * r.activeMembers, 0) / activeMembersSum
    : first.memberSatisfaction;
  const averageRiskQuality = activeMembersSum > 0
    ? results.reduce((s, r) => s + r.averageRiskQuality * r.activeMembers, 0) / activeMembersSum
    : first.averageRiskQuality;

  const seenMemberIds = new Set<string>();
  const memberList: Member[] = [];
  for (const r of results) {
    for (const m of r.memberList) {
      if (!seenMemberIds.has(m.id)) {
        seenMemberIds.add(m.id);
        memberList.push(m);
      }
    }
  }
  const memberLossResults = results.flatMap(r => r.memberLossResults);

  const poolPremiumAndAdminExpenseSum = sum('poolPremiumAndAdminExpense');
  const expectedLossSum = sum('expectedLoss');
  const totalMemberChargeSum = sum('totalMemberCharge');
  const netIncurredLossSum = sum('netIncurredLoss');
  const adminExpenseSum = sum('adminExpense');
  const reinsuranceCostSum = sum('reinsuranceCost');
  const reserveRiskMarginNeededSum = sum('reserveRiskMarginNeeded');
  const excessAvailableSurplusSum = sum('excessAvailableSurplus');

  // Same two-denominator AND same net-numerator discipline as the line level
  // (see the block there, and fundedNetExpectedLoss's header).
  //
  // ⚠ SUMMED PER LINE, NOT DIVIDED ONCE. Each line carries its own CLF, so
  // poolPremiumSum / someCLF is not the pool's funded net loss for any choice
  // of someCLF once two lines price at different confidence levels. Reducing
  // over the line results is the only inversion that stays correct in a mixed
  // book — and at pool scope `first.selectedFundingCLF` is a placeholder, which
  // is exactly the trap this avoids.
  const fundedNetExpectedLossSum = results.reduce((a, r) => a + fundedNetExpectedLoss(r), 0);
  const expectedLossRatio = fundedNetExpectedLossSum / Math.max(poolPremiumAndAdminExpenseSum, 1);
  const expectedLossRatioMemberBasis = fundedNetExpectedLossSum / Math.max(totalMemberChargeSum, 1);
  const expectedExpenseRatio =
    (adminExpenseSum + reinsuranceCostSum) / Math.max(totalMemberChargeSum, 1);
  const expectedCombinedRatio = expectedLossRatioMemberBasis + expectedExpenseRatio;
  const actualLossRatio = netIncurredLossSum / Math.max(totalMemberChargeSum, 1);
  const actualExpenseRatio = (adminExpenseSum + reinsuranceCostSum) / Math.max(totalMemberChargeSum, 1);
  const actualCombinedRatio = actualLossRatio + actualExpenseRatio;

  const excessCapitalRatio = reserveRiskMarginNeededSum > 0
    ? excessAvailableSurplusSum / reserveRiskMarginNeededSum
    : null;
  const capitalAdequacyStatus =
    excessCapitalRatio === null
      ? 'N/A'
      : excessCapitalRatio >= 0.25
      ? 'Strong'
      : excessCapitalRatio >= 0
        ? 'Adequate'
        : excessCapitalRatio >= -0.10
          ? 'Thin'
          : 'Deficient';

  const byLine = {} as Record<CoverageLine, LineResultSet>;
  for (const { line, result } of lineResults) {
    byLine[line] = result;
  }

  const pooled: ResultSet = {
    yearNumber: first.yearNumber,
    calendarYear: first.calendarYear,
    decisions: first.decisions,
    assetAllocation: first.assetAllocation,

    activeMembers: activeMembersSum,
    newMembers: sum('newMembers'),
    withdrawnMembers: sum('withdrawnMembers'),
    activeExposure: activeExposureSum,
    totalMarketExposure: totalMarketExposureSum,
    marketShare: activeExposureSum / Math.max(totalMarketExposureSum, 0.01),
    memberRetentionRate,
    memberSatisfaction,
    averageRiskQuality,
    memberList,

    rateLevel: first.rateLevel,
    ratePer100: first.ratePer100,
    purePremiumPer100: first.purePremiumPer100,
    purePremium: first.purePremium,
    // Same one-line placeholder as the per-100 fields above, for the same
    // reason: a per-100 RATE cannot be summed across lines, and blending it
    // needs an exposure weighting sum() does not do. Do not read these at pool
    // scope; each line's own value is exact and is what the identity in
    // fundedNetExpectedLoss's header is asserted against.
    expectedCededPer100: first.expectedCededPer100,
    netPurePremiumPer100: first.netPurePremiumPer100,
    writtenExposure: sum('writtenExposure'),

    poolPremium: sum('poolPremium'),
    adminExpense: adminExpenseSum,
    poolPremiumAndAdminExpense: poolPremiumAndAdminExpenseSum,
    totalMemberCharge: totalMemberChargeSum,
    grossPremium: sum('grossPremium'),
    assessments: sum('assessments'),
    dividends: sum('dividends'),

    memberLossResults,
    aggregateMemberLoss: sum('aggregateMemberLoss'),
    commonLossFactor: results.reduce((s, r) => s + r.commonLossFactor, 0) / results.length,
    catastropheFactor: first.catastropheFactor,
    shockLossAmount: sum('shockLossAmount'),
    grossUltimateLoss: sum('grossUltimateLoss'),
    shockLossIncurred: results.some(r => r.shockLossIncurred),
    // ONE ROW PER EVENT, costs summed across the lines it hit — not one row per
    // line. A cross-line event like #28 is a single cause, and showing it twice
    // would read as two events.
    shockEvents: mergeShockRecords(results),
    reinsuranceCost: reinsuranceCostSum,
    attachment: sum('attachment'),
    poolLosses: sum('poolLosses'),
    excessLosses: sum('excessLosses'),
    // Tower outputs pooled across lines. cededByLayer is summed ELEMENTWISE and
    // is only meaningful because WC and GL share identical attachments and limits
    // on their first three layers; WC's fourth has no GL counterpart and simply
    // carries WC's own figure. At pool scope this is a display convenience — the
    // per-line arrays are the authoritative ones.
    cededByLayer: (() => {
      const width = Math.max(0, ...lineResults.map(r => r.result.cededByLayer.length));
      const out = new Array(width).fill(0);
      for (const { result } of lineResults)
        result.cededByLayer.forEach((v, i) => { out[i] += v; });
      return out;
    })(),
    retainedAboveTower: sum('retainedAboveTower'),
    aggregateRecovery: sum('aggregateRecovery'),
    aggregatePremium: sum('aggregatePremium'),
    aggregateAttachment: sum('aggregateAttachment'),
    quotaShareLosses: sum('quotaShareLosses'),
    reinsuranceRecovery: sum('reinsuranceRecovery'),
    netUltimateLoss: sum('netUltimateLoss'),
    netIncurredLoss: netIncurredLossSum,

    operatingExpense: sum('operatingExpense'),
    riskControlInvestment: sum('riskControlInvestment'),
    priorYearDevelopment: sum('priorYearDevelopment'),

    beginningNetReserve: sum('beginningNetReserve'),
    currentYearNetReserve: sum('currentYearNetReserve'),
    // Pooled elementwise like every other reserve figure. Non-WC lines
    // contribute 0, so the pool total IS WC's — correct, since only WC has a
    // report lag.
    netPaidLosses: sum('netPaidLosses'),
    endingNetReserve: sum('endingNetReserve'),

    // Stage 2.9: per-line portfolios make the pool return an asset-weighted
    // blend of each line's own realized return, not any single line's rate.
    investmentReturnRate: sum('investedAssets') > 0
      ? sum('investmentIncome') / sum('investedAssets')
      : first.investmentReturnRate,
    investedAssets: sum('investedAssets'),
    investmentIncome: sum('investmentIncome'),

    outstandingLoanBalance: sum('outstandingLoanBalance'),
    loanRepaymentApplied: sum('loanRepaymentApplied'),
    loanInterestAccrued: sum('loanInterestAccrued'),
    loanOriginatedThisYear: sum('loanOriginatedThisYear'),
    dividendBlocked: results.some(r => r.dividendBlocked),

    selectedFundingConfidenceLevel: first.selectedFundingConfidenceLevel,
    selectedFundingCLF: first.selectedFundingCLF,

    expectedLoss: expectedLossSum,
    clfAdjustedExpectedLoss: sum('clfAdjustedExpectedLoss'),
    requiredFundingPremium: sum('requiredFundingPremium'),
    actualPremium: sum('actualPremium'),
    premiumFundingGap: sum('premiumFundingGap'),
    premiumFundingRatio: first.premiumFundingRatio,
    premiumFundingAdequacyStatus: first.premiumFundingAdequacyStatus,

    indicatedFundingRatePer100: first.indicatedFundingRatePer100,
    actualRatePer100: first.actualRatePer100,
    rateFundingGapPer100: first.rateFundingGapPer100,
    rateAdequacyRatio: first.rateAdequacyRatio,

    expectedNetUnpaidLoss: sum('expectedNetUnpaidLoss'),
    netFundingTarget: sum('netFundingTarget'),
    indicatedNetReserveAtConfidenceLevel: sum('indicatedNetReserveAtConfidenceLevel'),
    reserveRiskMarginNeeded: reserveRiskMarginNeededSum,
    fundingMarginNeeded: sum('fundingMarginNeeded'),

    availableFunding: sum('availableFunding'),
    availableSurplus: sum('availableSurplus'),
    fundingGap: sum('fundingGap'),
    capitalFundingGap: sum('capitalFundingGap'),
    excessAvailableSurplus: excessAvailableSurplusSum,
    excessCapitalRatio,
    capitalAdequacyRatio: excessCapitalRatio,
    capitalAdequacyStatus,

    fundingAdequacyRatio: first.fundingAdequacyRatio,
    fundingAdequacyStatus: first.fundingAdequacyStatus,

    fundingCLF: first.fundingCLF,
    fundingAdequacyIndicator: first.fundingAdequacyIndicator,

    underwritingIncome: sum('underwritingIncome'),
    netIncome: sum('netIncome'),
    beginningCash: sum('beginningCash'),
    endingCash: sum('endingCash'),
    beginningInvestments: sum('beginningInvestments'),
    endingInvestments: sum('endingInvestments'),
    totalAssets: sum('totalAssets'),
    unearnedPremium: sum('unearnedPremium'),
    totalLiabilities: sum('totalLiabilities'),
    beginingSurplus: sum('beginingSurplus'),
    endingSurplus: sum('endingSurplus'),

    surplusFromIncome: sum('surplusFromIncome'),
    surplusTieOutDifference: sum('surplusTieOutDifference'),

    expectedLossRatio,
    expectedLossRatioMemberBasis,
    expectedExpenseRatio,
    expectedCombinedRatio,
    actualLossRatio,
    actualExpenseRatio,
    actualCombinedRatio,
    combinedRatio: actualCombinedRatio,
    lossRatio: actualLossRatio,
    expenseRatio: actualExpenseRatio,

    narrativeExplanation: '',
    byLine,
  };

  pooled.narrativeExplanation = generateNarrative(pooled, priorPoolResult);

  return pooled;
}

function processReserveDevelopment(
  cohorts: ReserveCohort[],
  rng: SeededRandom,
  priorFundingAdequacyRatio: number
): {
  developmentImpact: number;
  updatedCohorts: ReserveCohort[];
  netPaidThisYear: number;
} {
  let developmentImpact = 0;
  let netPaidThisYear = 0;

  // Reserve development is affected by prior year funding adequacy.
  // When prior funding adequacy was low, there is pressure toward adverse development.
  // When prior funding adequacy was high, development is more likely favorable or neutral.
  const fundingImpactOnDevelopment = (priorFundingAdequacyRatio - 1.0) * 0.05;

  const updatedCohorts = cohorts
    .filter(c => !c.closed)
    .map(c => {
      let devMin = 0.92 - fundingImpactOnDevelopment;
      let devMax = 1.10 - fundingImpactOnDevelopment;

      devMin = Math.max(0.85, Math.min(1.05, devMin));
      devMax = Math.max(0.95, Math.min(1.20, devMax));

      const devFactor = rng.range(devMin, devMax);
      const devAdjustedUnpaid = c.netUnpaid * devFactor;
      const devImpact = c.netUnpaid - devAdjustedUnpaid;

      const paydown = devAdjustedUnpaid * c.paydownPct;
      netPaidThisYear += paydown;

      const newUnpaid = devAdjustedUnpaid - paydown;

      developmentImpact += devImpact;

      return {
        ...c,
        netUnpaid: Math.max(0, newUnpaid),
        netPaid: c.netPaid + paydown,
        closed: newUnpaid < 1000,
      };
    });

  return {
    developmentImpact,
    updatedCohorts,
    netPaidThisYear,
  };
}
