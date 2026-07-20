// Core simulation engine for Risk Pool Simulation v1
// Premium formula: Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { GameState, PoolState, DecisionSet, LinePoolState, LineDecisionSet, ResultSet, LineResultSet, ReserveCohort, Member, MemberLossResult, CoverageLine, GameInstance, AssetAllocation } from '../types/simulation';
import { SeededRandom, deriveSubRng } from './random';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, AGGREGATE_LOSS_DISTRIBUTION, FUNDING_CLF_TABLE, MEMBER_LOSS_VOLATILITY, RISK_CONTROL_PARAMS, LINE_RESERVE_PAYDOWN_PCT, OPERATING_CASH_PCT_OF_PREMIUM, FULL_TRANSFER_COST_PCT_OF_PREMIUM, SELF_FUNDED_DISCOUNT_PCT } from '../data/defaultAssumptions';
import { getReinsuranceStructure, calculateReinsuranceCost, calculateReinsuranceRecovery } from './reinsuranceEngine';
import { simulateInvestmentReturn } from './investmentEngine';
import { simulateMemberMovement } from './membershipEngine';
import { generateNarrative } from './narrativeEngine';
import { getMemberExposure } from './lineHelpers';

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

// Line-specific label for a seeded sub-RNG stream. WC keeps its original,
// unsuffixed label so a WC-only game's random draws (and therefore the Stage
// 1.2 regression baseline) are completely unaffected by other lines existing.
// Every other line gets its own independent stream via a suffixed label.
function lineRngLabel(base: string, line: CoverageLine): string {
  return line === 'WC' ? base : `${base}_${line}`;
}

// Shared (pool-level, cross-line) context needed to process a single line's year.
// cash/investments/otherAssets/otherLiabilities are this line's allocated SHARE
// of the pool's shared balance sheet (see processYear); investedAssets/
// investmentIncome/investmentReturnRate come from one pool-level investment
// draw, likewise split by share, so a single commingled portfolio isn't
// independently re-rolled per line.
interface LineYearContext {
  instance: GameInstance;
  yearNumber: number;
  calendarYear: number;
  allMarketMembers: Member[];
  cash: number;
  investments: number;
  otherAssets: number;
  otherLiabilities: number;
  assetAllocation: AssetAllocation;
  investedAssets: number;
  investmentIncome: number;
  investmentReturnRate: number;
  priorResult?: LineResultSet;
}

// Shared fields this line's year processing updates.
interface LineYearShared {
  cash: number;
  investments: number;
  otherAssets: number;
  unearnedPremium: number;
  otherLiabilities: number;
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

  const newPurePremiumPer100 =
    lineState.purePremiumPer100 *
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

  // The pool's retained (non-ceded) share of the excess layer is billed to members
  // at a discount off its full-transfer-equivalent notional cost, taken immediately.
  const retainedSharePct = 1 - reinsStructure.recoveryPct;
  const selfFundedNotional = retainedSharePct * FULL_TRANSFER_COST_PCT_OF_PREMIUM * poolPremium;
  const selfFundedDiscount = selfFundedNotional * SELF_FUNDED_DISCOUNT_PCT;

  const totalMemberCharge = poolPremiumAndAdminExpense + reinsuranceCost - selfFundedDiscount;
  const totalMemberRatePer100 = totalMemberCharge / Math.max(activeExposure * 10_000, 1);

  // Legacy names remain populated for compatibility with older screens and exports.
  const grossPremium = totalMemberCharge;
  const operatingExpense = adminExpense;
  const riskControlInvestment = poolPremium * lineDecisions.riskControlPct;

  // --- Member-Level Loss Simulation ---
  // Each member's Gamma distribution has a mean equal to expected loss. Risk
  // quality affects the coefficient of variation and therefore standard deviation.
  const lossRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('losses', line));

  // Continuous aggregate annual factor calibrated against stock-decision game
  // outcomes. It replaces the old two-state normal/shock mixture, which made
  // most ordinary years unrealistically low and occasional years too extreme.
  const commonLossFactor = lossRng.lognormal(
    AGGREGATE_LOSS_DISTRIBUTION.logMean,
    AGGREGATE_LOSS_DISTRIBUTION.logSigma
  ) * AGGREGATE_LOSS_DISTRIBUTION.actualLossLevelMultiplier;
  const catastropheThreshold =
    FUNDING_CLF_TABLE[AGGREGATE_LOSS_DISTRIBUTION.catastropheThresholdConfidence];
  const shockOccurred = commonLossFactor > catastropheThreshold;
  const catastropheFactor = 1;

  const memberLossResults: MemberLossResult[] = memberResult.activeMembers.map(member => {
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

  const aggregateMemberLoss = memberLossResults.reduce(
    (sum, memberLoss) => sum + memberLoss.simulatedLoss,
    0
  );

  const shockLossAmount = shockOccurred
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
  // Drawn once for the whole pool (see processYear) and passed in already
  // split by this line's share of the shared, commingled portfolio.
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
    grossPaidThisYear,
    reinsReceivedThisYear,
  } = processReserveDevelopment(
    lineState.reserveCohorts,
    devRng,
    priorFundingAdequacyRatio
  );

  // Current year reserve assumption: 60% unpaid, 40% paid.
  const currentYearGrossReserve = grossUltimateLoss * 0.60;
  const grossPaidCurrentYear = grossUltimateLoss * 0.40;

  const currentYearCohort: ReserveCohort = {
    yearNumber,
    calendarYear,
    grossUltimate: grossUltimateLoss,
    grossPaid: grossPaidCurrentYear,
    grossUnpaid: currentYearGrossReserve,
    reinsuranceRecoverable: reinsuranceRecovery * 0.60,
    reinsuranceReceived: reinsuranceRecovery * 0.40,
    paydownPct: LINE_RESERVE_PAYDOWN_PCT[line],
    developmentFactor: 1 + devRng.range(-0.05, 0.08),
    closed: false,
  };

  const allCohorts = [...updatedCohorts, currentYearCohort];

  // --- Accounting Reserves ---
  // These are expected unpaid losses from all accident years.
  // They are the booked balance sheet reserves and are NOT CLF-loaded.
  const endingGrossReserve = allCohorts.reduce((s, c) => s + c.grossUnpaid, 0);

  const endingReinsRecoverable = allCohorts.reduce(
    (s, c) => s + c.reinsuranceRecoverable,
    0
  );

  const expectedGrossUnpaidLoss = endingGrossReserve;

  const expectedReinsuranceRecoverable = endingReinsRecoverable;

  const expectedNetUnpaidLoss = Math.max(
    0,
    expectedGrossUnpaidLoss - expectedReinsuranceRecoverable
  );

  const beginningGrossReserve = lineState.reserveCohorts.reduce(
    (s, c) => s + c.grossUnpaid,
    0
  );

  const beginningReinsRecoverable = lineState.reserveCohorts.reduce(
    (s, c) => s + c.reinsuranceRecoverable,
    0
  );

  // --- Income Statement ---
  // Use reserve-rollforward incurred loss so the income statement and balance sheet tie.
  // This keeps the financial statement logic consistent with the reserve accounting.
  const assessments = poolPremium * lineDecisions.assessmentPct;
  const dividends = poolPremium * lineDecisions.dividendPct;

  // Keep this as a displayed reserve development metric.
  // Do not add it separately to net income because reserve development is already captured
  // in the incurred loss formula below through the change in unpaid reserves.
  const priorYearDevelopment = developmentImpact;

  const grossPaidLossesThisYear = grossPaidCurrentYear + grossPaidThisYear;

  const reinsuranceReceivedThisYear =
    reinsuranceRecovery * 0.40 + reinsReceivedThisYear;

  const grossIncurredLoss =
    grossPaidLossesThisYear +
    endingGrossReserve -
    beginningGrossReserve;

  const cededIncurredRecovery =
    reinsuranceReceivedThisYear +
    endingReinsRecoverable -
    beginningReinsRecoverable;

  const netIncurredLoss =
    grossIncurredLoss -
    cededIncurredRecovery;

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
  const otherLiabilities = ctx.otherLiabilities;

  const beginningCash = ctx.cash;

  const newCash =
    beginningCash +
    totalMemberCharge +
    assessments -
    grossPaidLossesThisYear +
    reinsuranceReceivedThisYear -
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
  endingCash = Math.max(0, endingCash);
  endingInvestments = Math.max(0, endingInvestments);

  const totalAssets =
    endingCash +
    endingInvestments +
    endingReinsRecoverable +
    ctx.otherAssets;

  const totalLiabilities =
    expectedGrossUnpaidLoss +
    unearnedPremium +
    otherLiabilities;

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
  const grossFundingTarget = expectedGrossUnpaidLoss * selectedFundingCLF;
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
    selfFundedDiscount,
    totalMemberCharge,
    grossPremium,
    assessments,
    dividends,

    memberLossResults,
    aggregateMemberLoss,
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

    beginningGrossReserve,
    currentYearGrossReserve,
    grossPaidLosses: grossPaidLossesThisYear,
    endingGrossReserve,
    beginningReinsRecoverable,
    endingReinsRecoverable,

    investmentReturnRate,
    investedAssets,
    investmentIncome,

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

    expectedGrossUnpaidLoss,
    expectedReinsuranceRecoverable,
    expectedNetUnpaidLoss,
    grossFundingTarget,
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
    otherAssets: ctx.otherAssets,
    totalAssets,
    unearnedPremium,
    otherLiabilities,
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

    grossUnpaidReserve: endingGrossReserve,
    reinsuranceRecoverable: endingReinsRecoverable,
    surplus: endingSurplus,

    totalMarketExposure,
  };

  const updatedShared: LineYearShared = {
    cash: endingCash,
    investments: endingInvestments,
    otherAssets: ctx.otherAssets,
    unearnedPremium,
    otherLiabilities,
    allMarketMembers: updatedAllMembers,
  };

  return { updatedLineState, updatedShared, result };
}

// Each active line's share of the shared cash/investments/other-assets pool,
// proportional to what that line itself has contributed to the pool's net
// worth (its own surplus plus its own net unpaid reserve, floored above
// zero so a deeply negative line still gets a minimal, not negative, share).
// For a single active line this is always 1 regardless of the formula, so
// a WC-only game's non-investment numbers are unaffected by this change.
function computeContributionShares(
  poolState: PoolState,
  activeLines: CoverageLine[]
): Record<CoverageLine, number> {
  const raw = activeLines.map(line => {
    const ls = poolState.lines[line];
    const netReserve = Math.max(0, ls.grossUnpaidReserve - ls.reinsuranceRecoverable);
    return Math.max(1, ls.surplus + netReserve);
  });
  const total = raw.reduce((s, v) => s + v, 0);
  const shares = {} as Record<CoverageLine, number>;
  activeLines.forEach((line, i) => { shares[line] = raw[i] / total; });
  return shares;
}

// Stage 1.3: loops over all active lines (WC and, once wired, GL). Property
// stays inert (Stage 1.4). For a single active line this reduces to exactly
// Stage 1.2's behavior — the WC-only regression baseline is unaffected.
export function processYear(
  gameState: GameState,
  decisions: DecisionSet
): { updatedPoolState: PoolState; result: ResultSet } {
  const { instance, poolState, currentYearNumber, setup } = gameState;
  const yearNumber = currentYearNumber;
  const calendarYear = setup.startingYear + yearNumber - 1;

  const priorPoolResult = gameState.lockedResults[gameState.lockedResults.length - 1];

  const activeLines = setup.activeLines;
  const shares = computeContributionShares(poolState, activeLines);

  // Investment income is drawn ONCE for the whole shared, commingled
  // portfolio (same seeded call site as before, unkeyed by line — a WC-only
  // game draws exactly what it always did), then split across active lines
  // by their contribution share below.
  const investRng = deriveSubRng(instance.seed, yearNumber, 'invest');
  const poolInvestedAssets = poolState.investments;
  const invResult = simulateInvestmentReturn(
    poolInvestedAssets,
    decisions.assetAllocation,
    investRng
  );

  let currentAllMarketMembers = poolState.allMarketMembers;
  const lineResults: Array<{ line: CoverageLine; result: LineResultSet }> = [];
  const updatedLineStates: Partial<Record<CoverageLine, LinePoolState>> = {};
  let sharedCash = 0;
  let sharedInvestments = 0;
  let sharedOtherAssets = 0;
  let sharedOtherLiabilities = 0;
  let sharedUnearnedPremium = 0;

  // Sequential fold: each line sees the shared roster as updated by lines
  // already processed this year (a member withdrawing from one line becomes
  // ineligible for new recruitment into the next, but isn't retroactively
  // removed from lines it's already active on).
  for (const line of activeLines) {
    const share = shares[line];
    const ctx: LineYearContext = {
      instance,
      yearNumber,
      calendarYear,
      allMarketMembers: currentAllMarketMembers,
      cash: poolState.cash * share,
      investments: poolState.investments * share,
      otherAssets: poolState.otherAssets * share,
      otherLiabilities: poolState.otherLiabilities * share,
      assetAllocation: decisions.assetAllocation,
      investedAssets: poolInvestedAssets * share,
      investmentIncome: invResult.income * share,
      investmentReturnRate: invResult.returnRate,
      priorResult: priorPoolResult?.byLine[line],
    };

    const { updatedLineState, updatedShared, result } = processLineYear(
      line,
      poolState.lines[line],
      decisions.byLine[line],
      ctx
    );

    currentAllMarketMembers = updatedShared.allMarketMembers;
    updatedLineStates[line] = updatedLineState;
    lineResults.push({ line, result });

    sharedCash += updatedShared.cash;
    sharedInvestments += updatedShared.investments;
    sharedOtherAssets += updatedShared.otherAssets;
    sharedOtherLiabilities += updatedShared.otherLiabilities;
    sharedUnearnedPremium += updatedShared.unearnedPremium;
  }

  const updatedPoolState: PoolState = {
    cash: sharedCash,
    investments: sharedInvestments,
    otherAssets: sharedOtherAssets,
    unearnedPremium: sharedUnearnedPremium,
    otherLiabilities: sharedOtherLiabilities,
    allMarketMembers: currentAllMarketMembers,
    lines: {
      ...poolState.lines,
      ...updatedLineStates,
    },
  };

  const result = aggregateLineResults(lineResults, priorPoolResult);

  return { updatedPoolState, result };
}

// Combines each active line's own LineResultSet into the pool-level ResultSet.
// Dollar/count fields are summed across lines; ratios are recomputed from the
// summed components (never summed directly); a handful of line-ambiguous
// descriptive/rate fields (rate level, CLF, decisions echo, status strings)
// show the first active line's value as a placeholder until Stage 2.1 adds a
// real per-line view. byLine always carries the full accurate per-line data.
function aggregateLineResults(
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
    selfFundedDiscount: sum('selfFundedDiscount'),
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

    beginningGrossReserve: sum('beginningGrossReserve'),
    currentYearGrossReserve: sum('currentYearGrossReserve'),
    grossPaidLosses: sum('grossPaidLosses'),
    endingGrossReserve: sum('endingGrossReserve'),
    beginningReinsRecoverable: sum('beginningReinsRecoverable'),
    endingReinsRecoverable: sum('endingReinsRecoverable'),

    investmentReturnRate: first.investmentReturnRate,
    investedAssets: sum('investedAssets'),
    investmentIncome: sum('investmentIncome'),

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

    expectedGrossUnpaidLoss: sum('expectedGrossUnpaidLoss'),
    expectedReinsuranceRecoverable: sum('expectedReinsuranceRecoverable'),
    expectedNetUnpaidLoss: sum('expectedNetUnpaidLoss'),
    grossFundingTarget: sum('grossFundingTarget'),
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
    otherAssets: sum('otherAssets'),
    totalAssets: sum('totalAssets'),
    unearnedPremium: sum('unearnedPremium'),
    otherLiabilities: sum('otherLiabilities'),
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
  grossPaidThisYear: number;
  reinsReceivedThisYear: number;
} {
  let developmentImpact = 0;
  let grossPaidThisYear = 0;
  let reinsReceivedThisYear = 0;

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
      const devAdjustedUnpaid = c.grossUnpaid * devFactor;
      const devImpact = c.grossUnpaid - devAdjustedUnpaid;

      const paydown = devAdjustedUnpaid * c.paydownPct;
      grossPaidThisYear += paydown;

      const newUnpaid = devAdjustedUnpaid - paydown;

      const reinsRatio =
        c.reinsuranceRecoverable / Math.max(c.grossUnpaid, 1);

      const reinsReceived = paydown * reinsRatio;
      reinsReceivedThisYear += reinsReceived;

      const newReinsRecoverable = newUnpaid * reinsRatio;

      developmentImpact += devImpact;

      return {
        ...c,
        grossUnpaid: Math.max(0, newUnpaid),
        grossPaid: c.grossPaid + paydown,
        reinsuranceRecoverable: Math.max(0, newReinsRecoverable),
        reinsuranceReceived: c.reinsuranceReceived + reinsReceived,
        closed: newUnpaid < 1000,
      };
    });

  return {
    developmentImpact,
    updatedCohorts,
    grossPaidThisYear,
    reinsReceivedThisYear,
  };
}
