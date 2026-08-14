// Core simulation engine for Risk Pool Simulation v1
// Premium formula: Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { Claim, WcUnreportedClaim, GameState, Occurrence, PoolState, DecisionSet, LinePoolState, LineDecisionSet, ResultSet, LineResultSet, ReserveCohort, Member, MemberLossResult, MembershipHistory, CoverageLine, GameInstance, AssetAllocation } from '../types/simulation';
import type { LineShockEffects, ShockFiring, ShockRecord } from '../types/shocks';
import { resolveShocks, ownFreqMultipliers, ownComponentFreqMultipliers } from './shockResolver';

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
import { computeKLine, deriveNeutralPurePremiumPer100, expectedWcGrossLossForPricing, generateWcClaims, wcFrequencyTrend } from './wcClaimEngine';
import { dollarWeightedPDelayed, ldfToUltimate, wcIbnrBalance } from './wcIbnr';
import { computeWcClf } from './wcLossDistribution';
import { computeKGl, deriveNeutralGlPurePremiumPer100, expectedGlGrossLoss, generateGlClaims } from './glClaimEngine';
import { generateNarrative } from './narrativeEngine';
import { getMemberExposure } from './lineHelpers';
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
  // WC READS ITS OWN DERIVED DISTRIBUTION, NOT FUNDING_CLF_TABLE (finding 38).
  // FUNDING_CLF_TABLE is the real pool's measured curve at $20-30B of payroll,
  // where process risk gives an annual CV near 0.063 against the table's
  // implied ~0.80 — the table is measuring parameter/trend uncertainty this
  // model has no channel for, not claim variance, and cannot validate this
  // model's own distribution (see src/data/wcClfGrid.ts). GL and Property are
  // unaffected: GL's severity is Pareto (infinite variance, no finite-cumulant
  // treatment applies) and gets its own derivation in a later commit;
  // Property has no Claim/Occurrence objects and was never in scope.
  const selectedFundingConfidenceLevel = lineDecisions.fundingConfidenceLevel;
  const wcClfBookKLine = line === 'WC' ? computeKLine(currentActiveMembers) : 1;
  const selectedFundingCLF = line === 'WC'
    ? computeWcClf(selectedFundingConfidenceLevel, currentActiveMembers, wcClfBookKLine, yearNumber)
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
  const newPurePremiumPer100 = line === 'WC'
    ? WC_HELD_PURE_PREMIUM_PER_100 * wcFrequencyTrend(yearNumber)
    : line === 'GL'
    ? GL_HELD_PURE_PREMIUM_PER_100
    : lineState.purePremiumPer100 *
      (1 + lossTrend) *
      (1 - newRCEffectiveness);

  // Preliminary contribution estimate used only for member movement.
  // Final premium is recalculated after member movement because exposure changes.
  // (currentActiveMembers is now declared above, ahead of the CLF lookup.)
  const estimatedExposure = currentActiveMembers.reduce((s, m) => s + getMemberExposure(m, line), 0);

  const estimatedRateAtConfidenceLevelPer100 =
    newPurePremiumPer100 * selectedFundingCLF * pricingAdjustment;

  const estimatedPremium =
    estimatedExposure * estimatedRateAtConfidenceLevelPer100 * 10_000;

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
  const expectedLoss = activeExposure * newPurePremiumPer100 * 10_000;

  const rateAtConfidenceLevelPer100 =
    newPurePremiumPer100 * selectedFundingCLF * pricingAdjustment;

  const poolPremiumRatePer100 = rateAtConfidenceLevelPer100;

  const poolPremium =
    activeExposure * rateAtConfidenceLevelPer100 * 10_000;

  const adminExpense = expectedLoss * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  const adminRatePer100 = newPurePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  const poolPremiumAndAdminExpense = poolPremium + adminExpense;

  // Hoisted above the pricing block: these are pure derivations from `line` and
  // the reinsurance COST now branches on them, which happens before the loss
  // simulation where they used to be declared.
  const isWcClaimLine = line === 'WC';
  const isGlClaimLine = line === 'GL';
  const isClaimLine = isWcClaimLine || isGlClaimLine;

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
  if (isClaimLine && (isWcClaimLine || isGlClaimLine)) {
    const towerLine = line as TowerLine;
    const placedForCost = normalizeLayersPlaced(towerLine, lineDecisions.layersPlaced);
    reinsuranceCost = occurrenceProgramCost(towerLine, placedForCost, activeExposure * 10_000);
    if (towerLine === 'WC' && lineDecisions.aggregateStopLevel >= 0) {
      reinsuranceCost += quoteAggregate(
        placedForCost, activeExposure, expectedLoss, lineDecisions.aggregateStopLevel,
      ).premium;
    }
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
  let glCountsBySub: Record<string, number> | undefined;
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
  // WC report-lag / IBNR outputs. Left at their empty values on GL and Property,
  // which draw every claim as reported in its accident year.
  let nextUnreportedClaims: WcUnreportedClaim[] = [];
  let unreportedClaimCount = 0;
  // Gross loss from THIS accident year reported this year, and gross loss from
  // PRIOR accident years reported this year. They sum to aggregateMemberLoss.
  let currentAccidentYearGross = 0;
  let emergedPriorYearLoss = 0;

  if (isWcClaimLine) {
    // k_line is recomputed against the CURRENTLY ENROLLED book, after member
    // movement — it is the roster/risk-quality-mix correction, and the reason
    // purePremiumPer100 can be held constant instead of chasing enrollment.
    //
    // ⚠ ENROLLED BOOK, NOT THE FULL ROSTER. Marketplace-wide generation makes it
    // tempting to hand the 200-member roster to everything below; doing it here
    // would drive k_line to ~1 permanently and silently disable the correction.
    const kLine = computeKLine(memberResult.activeMembers);

    // THE UNREPORTED INVENTORY. Claims drawn in an earlier accident year whose
    // reportYear is now. Split rather than filtered-twice so the carry-forward
    // and the emergence are visibly complementary.
    //
    // ⚠ THE INVENTORY IS FULL-MARKET (all 200 members); the pool's own figures
    // must use the ENROLLED slice. Splitting on reportYear first and enrolment
    // second keeps a prospect's claim in the inventory when it emerges while it
    // is still a prospect, rather than dropping it on the floor.
    const inventory = lineState.unreportedClaims ?? [];
    const emergingAll = inventory.filter(u => u.reportYear <= yearNumber);
    const stillUnreported = inventory.filter(u => u.reportYear > yearNumber);
    const enrolledIds = new Set(memberResult.activeMembers.map(m => m.id));
    const emergingEnrolled = emergingAll.filter(u => enrolledIds.has(u.memberId));
    const emergingProspect = emergingAll.filter(u => !enrolledIds.has(u.memberId));

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
      emerging: emergingEnrolled,
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
        emerging: emergingProspect,
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

    // CARRY THE INVENTORY FORWARD: what did not emerge, plus what was drawn this
    // year and deferred, across BOTH calls so prospects keep their own pipeline.
    nextUnreportedClaims = [
      ...stillUnreported,
      ...generated.newlyDelayed,
      ...(prospectGenerated?.newlyDelayed ?? []),
    ];
    // ENROLLED ONLY — this is a pool figure. See the field comment on
    // LinePoolState.unreportedClaims.
    unreportedClaimCount = nextUnreportedClaims.filter(u => enrolledIds.has(u.memberId)).length;
    currentAccidentYearGross = generated.currentAccidentYearGross;
    emergedPriorYearLoss = generated.emergedGross;

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
    const kGl = computeKGl(memberResult.activeMembers);
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
        gPool: ctx.gPool,
      })
      : undefined;
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    glCountsBySub = generated.claimCountsBySub;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    marketMemberLossResults = [
      ...generated.memberLossResults,
      ...(prospectGenerated?.memberLossResults ?? []),
    ];
    kLineApplied = kGl;
    // GL's shock event (ruled J11): any single occurrence whose gross total
    // (indemnity + ALAE, all claimants of an abuse batch combined) exceeds $1M.
    shockOccurred = generated.maxOccurrenceGross > 1_000_000;

    // The EXPECTED cost of any frequency shock on this line, attributed per
    // event. Computed as the difference between GL's own analytic expectation
    // with and without the multipliers, rather than reconstructed — a second
    // definition of GL's expected loss would drift from the first.
    //
    // PER EVENT INDEPENDENTLY: each firing is priced against the unshocked
    // baseline using only its OWN effects. When two events compound on the same
    // sub-coverage their individual figures therefore do not sum to the
    // combined effect, which is correct — each answers "what did this event
    // add", not "how do we split the interaction".
    if (ctx.shock?.freqMultipliers && ctx.shockFirings?.length) {
      const baseline = expectedGlGrossLoss(memberResult.activeMembers, { kGl });
      for (const firing of ctx.shockFirings) {
        const own = ownFreqMultipliers(firing.shockId, 'GL');
        if (!own) continue;
        shockExpectedAdded[firing.shockId] =
          expectedGlGrossLoss(memberResult.activeMembers, { kGl, freqMultipliers: own }) - baseline;
      }
    }
  } else {
    shockOccurred = commonLossFactor > catastropheThreshold;
    memberLossResults = memberResult.activeMembers.map(member => {
      const memberExposureAmount = getMemberExposure(member, line);
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
  // Hoisted so the IBNR provision below can net against the SAME placement the
  // cession used. Empty on Property, which has no tower.
  let placedLayers: boolean[] = [];

  if (isClaimLine && (isWcClaimLine || isGlClaimLine)) {
    const towerLine = line as TowerLine;
    const placed = normalizeLayersPlaced(towerLine, lineDecisions.layersPlaced);
    placedLayers = placed;
    const totals = occurrenceTotals(generatedClaims ?? [], generatedOccurrences ?? [], towerLine);
    const cession = cedeOccurrences(towerLine, totals, placed);
    cededByLayer = cession.cededByLayer;
    retainedAboveTower = cession.retainedAboveTower;

    // The aggregate sits on RETAINED loss, so it applies AFTER the occurrence
    // layers — including loss retained through layers the player DECLINED. That
    // scope is what makes the aggregate respond to the layer selection at all.
    if (towerLine === 'WC' && lineDecisions.aggregateStopLevel >= 0) {
      const quote = quoteAggregate(
        placed,
        activeExposure,
        expectedLoss,
        lineDecisions.aggregateStopLevel,
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

  // --- IBNR (WC only) --------------------------------------------------------
  //
  // THE CHAIN-LADDER PROVISION: for each open accident year,
  // `net reported to date x (LDF(age) - 1)`.
  //
  // WHY CHAIN-LADDER RATHER THAN "EXPECTED UNREPORTED DOLLARS" (which is
  // algebraically identical IN EXPECTATION): it conditions on what ACTUALLY
  // reported, so a year that reports heavy books a heavier IBNR. The reserve
  // becomes responsive to experience instead of a fixed fraction of an assumed
  // ultimate — which is what a real reserve does, and is the shape that
  // accommodates IBNER later without rework. See src/utils/wcIbnr.ts.
  //
  // NET, and computable HERE rather than after the tower re-derivation: the
  // netting depends only on the layer STRUCTURE (attachments and limits), which
  // this change does not touch, not on the tower's measured expectedCededPer100
  // constants, which it does invalidate.
  //
  // GL AND PROPERTY HAVE NO REPORT LAG, so every claim reports in its accident
  // year and their IBNR is 0 by construction, not by omission.
  let ibnrReserve = 0;
  let ibnrAccrual = 0;
  let nextAccidentYearReported = lineState.wcAccidentYearReported ?? [];
  if (isWcClaimLine) {
    // The share of THIS year's net loss that will report late, on the book and
    // the reinsurance placement as they actually are this year. Stored with the
    // accident year rather than recomputed later, because both change.
    const pDelayedNet = dollarWeightedPDelayed(memberResult.activeMembers, placedLayers);
    // Net-down this accident year's own reported gross by the year's realized
    // cession ratio. Using the realized ratio rather than re-deriving the
    // waterfall keeps ONE definition of what was ceded.
    const cessionRatio = aggregateMemberLoss > 0 ? netUltimateLoss / aggregateMemberLoss : 1;
    const currentNetReported = currentAccidentYearGross * cessionRatio;
    const emergedNetByYear = new Map<number, number>();
    for (const c of generatedClaims ?? []) {
      if (c.accidentYear >= yearNumber) continue;
      emergedNetByYear.set(c.accidentYear, (emergedNetByYear.get(c.accidentYear) ?? 0) + c.grossUltimate * cessionRatio);
    }

    const merged = lineState.wcAccidentYearReported
      ? lineState.wcAccidentYearReported.map(e => ({
        ...e,
        netReported: e.netReported + (emergedNetByYear.get(e.yearNumber) ?? 0),
      }))
      : [];
    // An accident year that has emerged but was never opened (an old save, or a
    // backdated shock injection reaching further back than the ledger goes) is
    // opened now at this year's pattern rather than dropped.
    for (const [ay, amount] of emergedNetByYear) {
      if (!merged.some(e => e.yearNumber === ay)) merged.push({ yearNumber: ay, netReported: amount, pDelayedNet });
    }
    merged.push({ yearNumber, netReported: currentNetReported, pDelayedNet });
    nextAccidentYearReported = merged;

    ibnrReserve = wcIbnrBalance(nextAccidentYearReported, yearNumber);
    // ⚠ THE ACCRUAL IS THIS YEAR'S ADDITION; ibnrReserve IS THE BALANCE. They
    // differ by the mean report lag (~3.5 years) and swapping them is a 3.5x
    // reserve error in either direction, silent both ways. The relationship is
    // Little's Law and is asserted, not hoped for — see littlesLawRatio.
    ibnrAccrual = currentNetReported * (ldfToUltimate(0, pDelayedNet) - 1);
  }

  // --- Accounting Reserves ---
  // These are expected unpaid losses (net of reinsurance) from all accident
  // years. They are the booked balance sheet reserves and are NOT CLF-loaded.
  //
  // IBNR SITS ALONGSIDE THE COHORTS, NOT INSIDE THEM. The cohort rollforward
  // pays down CASE reserves on a per-line percentage; IBNR is a different
  // quantity with a different runoff (the reporting pattern), and folding it
  // into netUnpaid would put it on the wrong paydown curve.
  const endingNetReserve = allCohorts.reduce((s, c) => s + c.netUnpaid, 0) + ibnrReserve;

  const expectedNetUnpaidLoss = endingNetReserve;

  const beginningNetReserve = lineState.reserveCohorts.reduce(
    (s, c) => s + c.netUnpaid,
    0
  ) + wcIbnrBalance(lineState.wcAccidentYearReported ?? [], yearNumber - 1);

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
  // the player's selected annual pricing confidence level. WC uses its own
  // derived distribution here too, for the same reason as selectedFundingCLF
  // above — leaving this on FUNDING_CLF_TABLE while pricing used the derived
  // curve would silently misstate WC's own reserve confidence view.
  const reserveMarginCLF = line === 'WC'
    ? computeWcClf(0.90, currentActiveMembers, wcClfBookKLine, yearNumber)
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
  //                      -> the finding-6 reconciliation basis. Gross ultimate
  //                         over this is what the WC/GL 6b harness checks
  //                         assert against 66.8%. DO NOT CHANGE IT.
  //   MEMBER-CHARGE BASIS totalMemberCharge          = the above + reinsurance
  //                      -> what members actually pay, and the only basis on
  //                         which a loss ratio and an expense ratio may be
  //                         ADDED, since a combined ratio is meaningless unless
  //                         both terms share a denominator.
  const expectedLossRatio = expectedLoss / Math.max(poolPremiumAndAdminExpense, 1);
  const expectedLossRatioMemberBasis = expectedLoss / Math.max(totalMemberCharge, 1);
  // Computed from the LIVE expense values, not as 1 - lossRatio. The old form
  // was a residual reverse-engineered to force the combined ratio to 1.000,
  // which is why the display insisted the pool broke even while surplus
  // tripled over five years.
  const expectedExpenseRatio =
    (adminExpense + reinsuranceCost) / Math.max(totalMemberCharge, 1);
  // Both terms on the member-charge basis, so this is a real combined ratio.
  // It is NOT 1.000 except by coincidence: at CLF 1.0 the pool charges exactly
  // its expected cost and the ratio lands at 100%, while at the default CLF
  // 1.346 it is ~82.7% — 17.3 points of intended underwriting margin, which is
  // what a 75%-confidence funding level is FOR. The margin is correct
  // behaviour; the old 1.000 display was what hid it.
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
    claimCountsBySub: glCountsBySub,
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
    ibnrReserve,
    ibnrAccrual,
    emergedPriorYearLoss,
    unreportedClaimCount,
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
    // WC's report-lag state, carried to next year. Empty on GL and Property.
    // FULL-MARKET inventory (see the field comment); ENROLLED, NET reported
    // ledger.
    unreportedClaims: nextUnreportedClaims,
    wcAccidentYearReported: nextAccidentYearReported,
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
  rateAtOrigination: number;    // the pool's asset-weighted blended investment return this year
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
  // For the asset-weighted blended pool return (the Stage 2.9 loan rate):
  // each line's realized return weighted by its beginning invested assets.
  // With the pool-wide allocation every line earns the same rate, so the
  // blend trivially equals that shared rate — kept as a weighted blend so
  // the loan rate stays correct-by-construction either way.
  let totalInvestedForBlend = 0;
  let totalInvestmentIncomeForBlend = 0;

  // Draw the shared market ONCE per year at the asset-class level (cash, bonds,
  // equities) and apply it to every line. Randomness lives at the asset class,
  // not per line, so two lines with the same allocation earn the same return
  // rate; each line differs only by its allocation and its own asset base. The
  // stream is the unsuffixed 'invest' label (unchanged for a WC-only game).
  const marketReturns = simulateMarketReturns(
    deriveSubRng(instance.seed, yearNumber, 'invest')
  );

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
    const priorLineSurplus = priorPoolResult?.byLine[line]?.endingSurplus;
    const dividendBlocked = priorLineSurplus !== undefined && priorLineSurplus < 0;

    // Blend this year's shared market by this line's own allocation and asset
    // base (pure, no per-line draw): same allocation -> same rate across lines.
    const invResult = blendInvestmentReturn(
      lineState.investedAssets,
      lineDecisions.assetAllocation,
      marketReturns
    );
    totalInvestedForBlend += lineState.investedAssets;
    totalInvestmentIncomeForBlend += invResult.income;

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
      const interest = loan.remainingBalance * loan.rateAtOrigination;
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

  const blendedReturnRate = totalInvestedForBlend > 0
    ? totalInvestmentIncomeForBlend / totalInvestedForBlend
    : 0;

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
      rateAtOrigination: blendedReturnRate,
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
      rateAtOrigination: offer.rateAtOrigination,
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

  // Same two-denominator discipline as the line level (see the block there).
  const expectedLossRatio = expectedLossSum / Math.max(poolPremiumAndAdminExpenseSum, 1);
  const expectedLossRatioMemberBasis = expectedLossSum / Math.max(totalMemberChargeSum, 1);
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
    ibnrReserve: sum('ibnrReserve'),
    ibnrAccrual: sum('ibnrAccrual'),
    emergedPriorYearLoss: sum('emergedPriorYearLoss'),
    unreportedClaimCount: sum('unreportedClaimCount'),
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
