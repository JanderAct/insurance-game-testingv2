// Core simulation engine for Risk Pool Simulation v1
// Premium formula: Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { Claim, GameState, Occurrence, PoolState, DecisionSet, LinePoolState, LineDecisionSet, ResultSet, LineResultSet, ReserveCohort, Member, MemberLossResult, MembershipHistory, CoverageLine, GameInstance, AssetAllocation } from '../types/simulation';
import { SeededRandom, deriveSubRng } from './random';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, AGGREGATE_LOSS_DISTRIBUTION, FUNDING_CLF_TABLE, MEMBER_LOSS_VOLATILITY, RISK_CONTROL_PARAMS, LINE_RESERVE_PAYDOWN_PCT, OPERATING_CASH_PCT_OF_PREMIUM, WC_LOSS_MODEL } from '../data/defaultAssumptions';
import { getReinsuranceStructure, calculateReinsuranceCost, calculateReinsuranceRecovery } from './reinsuranceEngine';
import { simulateMarketReturns, blendInvestmentReturn } from './investmentEngine';
import { simulateMemberMovement } from './membershipEngine';
import { cloneMembershipHistory, openInterval, closeInterval } from './membershipHistory';
import { computeKLine, deriveNeutralPurePremiumPer100, generateWcClaims } from './wcClaimEngine';
import { computeKGl, generateGlClaims } from './glClaimEngine';
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

// WC's pure premium: derived ONCE, at module load, from the claim generator's
// analytic expectation over the FULL canonical roster at neutral risk quality,
// then held for every line-year of every game. This is the finding-6 fix —
// losses and premium are two views of the same model rather than two
// independent assertions that drift apart. Computed rather than hardcoded so
// it can never fall out of step with the generator's parameters.
const WC_HELD_PURE_PREMIUM_PER_100 = deriveNeutralPurePremiumPer100(getPredefinedMarketMembers());

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

  // --- Selected Funding Confidence ---
  // CLF is selected by the player and applied after the expected actuarial loss-cost rate is calculated.
  const selectedFundingConfidenceLevel = lineDecisions.fundingConfidenceLevel;
  const selectedFundingCLF = lookupCLF(selectedFundingConfidenceLevel);

  // --- Expected Actuarial Loss-Cost Rate ---
  // Expected losses evolve independently from pricing decisions. The player's
  // rate change affects the charged Pool Premium rate, not Pure Premium.
  const newRateLevel = lineState.rateLevel * (1 + lineDecisions.rateChange);
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

  // WC prices off the claim generator's OWN analytic expectation, so premium
  // and losses share one basis by construction — the finding-6 constraint.
  //
  // Derived ONCE from the neutral book (full canonical roster at RQ 5) and
  // then HELD: it does not track the roster year to year, because k_line
  // already makes the per-year roster/risk-quality-mix correction. Letting
  // both chase enrollment would double-correct and make the loss ratio wander.
  //
  // Risk control is deliberately ABSENT here while multiplying the draw's
  // frequency (finding 17): applying it to both sides would cancel and rebuild
  // the no-op. Instance lossTrend is likewise absent — WC trends frequency at
  // its own -1.5%/yr inside the generator, and severity carries no general
  // trend (accident-year dollars). lossTrend remains GL/Property-only.
  const newPurePremiumPer100 = line === 'WC'
    ? WC_HELD_PURE_PREMIUM_PER_100
    : lineState.purePremiumPer100 *
      (1 + lossTrend) *
      (1 - newRCEffectiveness);

  // Preliminary contribution estimate used only for member movement.
  // Final premium is recalculated after member movement because exposure changes.
  const currentActiveMembers = lineState.members.filter(m => m.status === 'active');
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

  const reinsStructure = getReinsuranceStructure(
    lineDecisions.reinsuranceLevel,
    poolPremium,
    expectedLoss
  );

  const reinsuranceCost = calculateReinsuranceCost(
    lineDecisions.reinsuranceLevel,
    poolPremium,
    instance.marketEnvironment.competitivePressure
  );

  const totalMemberCharge = poolPremiumAndAdminExpense + reinsuranceCost;
  const totalMemberRatePer100 = totalMemberCharge / Math.max(activeExposure * 10_000, 1);

  // Legacy names remain populated for compatibility with older screens and exports.
  const grossPremium = totalMemberCharge;
  const operatingExpense = adminExpense;
  const riskControlInvestment = poolPremium * lineDecisions.riskControlPct;

  // --- Loss Simulation ---
  // WC and GL generate individual claims (design doc Parts A and B); Property
  // still draws the aggregate member-Gamma below until its generator exists.
  const isWcClaimLine = line === 'WC';
  const isGlClaimLine = line === 'GL';
  const isClaimLine = isWcClaimLine || isGlClaimLine;

  const lossRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('losses', line));

  // The aggregate annual factor for the NON-claim lines. WC and GL do not draw
  // it: their cross-line correlation now comes from the shared ctx.gPool, and
  // applying both would double-count the aggregate shock.
  const commonLossFactor = isClaimLine
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
  let shockOccurred: boolean;

  if (isWcClaimLine) {
    // k_line is recomputed against the CURRENTLY ENROLLED book, after member
    // movement — it is the roster/risk-quality-mix correction, and the reason
    // purePremiumPer100 can be held constant instead of chasing enrollment.
    const kLine = computeKLine(memberResult.activeMembers);
    const generated = generateWcClaims({
      members: memberResult.activeMembers,
      yearNumber,
      calendarYear,
      instanceSeed: instance.seed,
      kLine,
      gPool: ctx.gPool,
      // Risk control acts on the DRAW ONLY (finding 17): it reduces realized
      // frequency without touching the pricing expectation, so it genuinely
      // moves the loss ratio instead of cancelling out.
      riskControlEffectiveness: newRCEffectiveness,
    });
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    wcCountsByClass = generated.claimCountsByClass;
    wcCountsByTier = generated.claimCountsByTier;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    // A catastrophic-tier claim is WC's shock event, replacing the old
    // "aggregate factor exceeded a threshold" definition.
    shockOccurred = (generated.claimCountsByTier.catastrophic ?? 0) > 0;
  } else if (isGlClaimLine) {
    // Same discipline as WC: k_GL is the per-year roster/risk-quality-mix
    // correction against the currently enrolled book; the pure premium itself
    // is held (step 6b) rather than chasing enrollment.
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
    });
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    glCountsBySub = generated.claimCountsBySub;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    // GL's shock event (ruled J11): any single occurrence whose gross total
    // (indemnity + ALAE, all claimants of an abuse batch combined) exceeds $1M.
    shockOccurred = generated.maxOccurrenceGross > 1_000_000;
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

  const reinsuranceRecovery = calculateReinsuranceRecovery(
    grossUltimateLoss,
    reinsStructure
  );

  const netUltimateLoss = grossUltimateLoss - reinsuranceRecovery;

  // Pool Losses / Excess Losses split uses each level's real attachment point
  // (125% of expected loss for Self Fund/Low/Moderate/High, 100% for Full Transfer).
  const attachment = reinsStructure.attachment;
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

  // --- Accounting Reserves ---
  // These are expected unpaid losses (net of reinsurance) from all accident
  // years. They are the booked balance sheet reserves and are NOT CLF-loaded.
  const endingNetReserve = allCohorts.reduce((s, c) => s + c.netUnpaid, 0);

  const expectedNetUnpaidLoss = endingNetReserve;

  const beginningNetReserve = lineState.reserveCohorts.reduce(
    (s, c) => s + c.netUnpaid,
    0
  );

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
  // the player's selected annual pricing confidence level.
  const reserveMarginCLF = lookupCLF(0.90);
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
  const expectedLossRatio = expectedLoss / Math.max(poolPremiumAndAdminExpense, 1);
  const expectedExpenseRatio = 1 - expectedLossRatio;
  const expectedCombinedRatio = 1;

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

    memberLossResults,
    aggregateMemberLoss,
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
    reinsuranceCost,
    attachment,
    poolLosses,
    excessLosses,
    quotaShareLosses,
    reinsuranceRecovery,
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

  const expectedLossRatio = expectedLossSum / Math.max(poolPremiumAndAdminExpenseSum, 1);
  const expectedExpenseRatio = 1 - expectedLossRatio;
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
    reinsuranceCost: reinsuranceCostSum,
    attachment: sum('attachment'),
    poolLosses: sum('poolLosses'),
    excessLosses: sum('excessLosses'),
    quotaShareLosses: sum('quotaShareLosses'),
    reinsuranceRecovery: sum('reinsuranceRecovery'),
    netUltimateLoss: sum('netUltimateLoss'),
    netIncurredLoss: netIncurredLossSum,

    operatingExpense: sum('operatingExpense'),
    riskControlInvestment: sum('riskControlInvestment'),
    priorYearDevelopment: sum('priorYearDevelopment'),

    beginningNetReserve: sum('beginningNetReserve'),
    currentYearNetReserve: sum('currentYearNetReserve'),
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
    expectedExpenseRatio,
    expectedCombinedRatio: first.expectedCombinedRatio,
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
