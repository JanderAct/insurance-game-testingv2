// Core simulation engine for Risk Pool Simulation v1
// Premium formula: Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { GameState, PoolState, DecisionSet, ResultSet, ReserveCohort, Member, MemberLossResult } from '../types/simulation';
import { SeededRandom, deriveSubRng } from './random';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, AGGREGATE_LOSS_DISTRIBUTION, FUNDING_CLF_TABLE, MEMBER_LOSS_VOLATILITY, RISK_CONTROL_PARAMS, RESERVE_PAYDOWN_PCT, OPERATING_CASH_PCT_OF_PREMIUM } from '../data/defaultAssumptions';
import { getReinsuranceStructure, calculateReinsuranceCost, calculateReinsuranceRecovery } from './reinsuranceEngine';
import { simulateInvestmentReturn } from './investmentEngine';
import { simulateMemberMovement } from './membershipEngine';
import { generateNarrative } from './narrativeEngine';

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

export function processYear(
  gameState: GameState,
  decisions: DecisionSet
): { updatedPoolState: PoolState; result: ResultSet } {
  const { instance, poolState, currentYearNumber, setup } = gameState;
  const yearNumber = currentYearNumber;
  const calendarYear = setup.startingYear + yearNumber - 1;

  const priorResult = gameState.lockedResults[gameState.lockedResults.length - 1];
  const priorYearLossRatio = priorResult
    ? priorResult.grossUltimateLoss / Math.max(priorResult.grossPremium, 1)
    : undefined;

  // --- Selected Funding Confidence ---
  // CLF is selected by the player and applied after the expected actuarial loss-cost rate is calculated.
  const selectedFundingConfidenceLevel = decisions.fundingConfidenceLevel;
  const selectedFundingCLF = lookupCLF(selectedFundingConfidenceLevel);

  // --- Expected Actuarial Loss-Cost Rate ---
  // Expected losses evolve independently from pricing decisions. The player's
  // rate change affects the charged Pool Premium rate, not Pure Premium.
  const newRateLevel = poolState.rateLevel * (1 + decisions.rateChange);
  const pricingAdjustment = newRateLevel / 100;

  const lossTrend = instance.lossEnvironment.lossTrend;
  const priorRCEffectiveness = poolState.riskControlEffectiveness;
  const maxRC = RISK_CONTROL_PARAMS.maxEffectiveness;

  const rcGain =
    (decisions.riskControlPct / 0.08) *
    (maxRC / RISK_CONTROL_PARAMS.lagYears);

  const rcDecay =
    priorRCEffectiveness *
    RISK_CONTROL_PARAMS.decayRate *
    (decisions.riskControlPct < 0.01 ? 2 : 1);

  const newRCEffectiveness = Math.max(
    0,
    Math.min(maxRC, priorRCEffectiveness + rcGain - rcDecay)
  );

  const newPurePremiumPer100 =
    poolState.purePremiumPer100 *
    (1 + lossTrend) *
    (1 - newRCEffectiveness);

  // Preliminary contribution estimate used only for member movement.
  // Final premium is recalculated after member movement because exposure changes.
  const currentActiveMembers = poolState.members.filter(m => m.status === 'active');
  const estimatedExposure = currentActiveMembers.reduce((s, m) => s + m.exposure, 0);

  const estimatedRateAtConfidenceLevelPer100 =
    newPurePremiumPer100 * selectedFundingCLF * pricingAdjustment;

  const estimatedPremium =
    estimatedExposure * estimatedRateAtConfidenceLevelPer100 * 10_000;

  const memberRng = deriveSubRng(instance.seed, yearNumber, 'members');

  const memberResult = simulateMemberMovement({
    currentMembers: currentActiveMembers,
    allMarketMembers: poolState.allMarketMembers,
    decisions,
    currentMemberSatisfaction: poolState.memberSatisfaction,
    currentRiskQuality: poolState.averageRiskQuality,
    surplus: poolState.surplus,
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

  const updatedAllMembers: Member[] = poolState.allMarketMembers.map(m => {
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

  const reinsuranceCost = calculateReinsuranceCost(
    decisions.reinsuranceLevel,
    poolPremium,
    instance.marketEnvironment.competitivePressure
  );

  const totalMemberCharge = poolPremiumAndAdminExpense + reinsuranceCost;
  const totalMemberRatePer100 = totalMemberCharge / Math.max(activeExposure * 10_000, 1);

  // Legacy names remain populated for compatibility with older screens and exports.
  const grossPremium = totalMemberCharge;
  const operatingExpense = adminExpense;
  const riskControlInvestment = poolPremium * decisions.riskControlPct;

  const reinsStructure = getReinsuranceStructure(
    decisions.reinsuranceLevel,
    poolPremium,
    expectedLoss
  );

  // --- Member-Level Loss Simulation ---
  // Each member's Gamma distribution has a mean equal to expected loss. Risk
  // quality affects the coefficient of variation and therefore standard deviation.
  const lossRng = deriveSubRng(instance.seed, yearNumber, 'losses');

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
    const memberExpectedLoss = member.exposure * newPurePremiumPer100 * 10_000;
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
      exposure: member.exposure,
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

  // Pool Losses / Excess Losses split uses 100% of expected loss as the boundary
  // for every reinsurance level (including Self Fund), since it represents the
  // pool's own funded layer regardless of whether external reinsurance sits above it.
  const attachment = expectedLoss;
  const poolLosses = Math.min(grossUltimateLoss, attachment);
  const excessLosses = Math.max(0, grossUltimateLoss - attachment);
  const quotaShareLosses = excessLosses - reinsuranceRecovery;

  // --- Investment Income ---
  const investRng = deriveSubRng(instance.seed, yearNumber, 'invest');
  const investedAssets = poolState.investments;

  const invResult = simulateInvestmentReturn(
    investedAssets,
    decisions.investmentRisk,
    instance.investmentEnvironment.baseReturn,
    instance.investmentEnvironment.volatility,
    instance.investmentEnvironment.downsideRisk,
    investRng
  );

  const investmentIncome = invResult.income;
  const investmentReturnRate = invResult.returnRate;

  // --- Reserve Development ---
  // Process existing reserve cohorts. These are accounting reserve cohorts.
  // CLF does not multiply booked reserves.
  const devRng = deriveSubRng(instance.seed, yearNumber, 'dev');

  // Legacy compatibility: this currently uses prior premium funding adequacy.
  // Later, this could be renamed or separated from reserve adequacy.
  const priorFundingAdequacyRatio = priorResult?.fundingAdequacyRatio ?? 1.0;

  const {
    developmentImpact,
    updatedCohorts,
    grossPaidThisYear,
    reinsReceivedThisYear,
  } = processReserveDevelopment(
    poolState.reserveCohorts,
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
    paydownPct: RESERVE_PAYDOWN_PCT,
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

  const beginningGrossReserve = poolState.reserveCohorts.reduce(
    (s, c) => s + c.grossUnpaid,
    0
  );

  const beginningReinsRecoverable = poolState.reserveCohorts.reduce(
    (s, c) => s + c.reinsuranceRecoverable,
    0
  );

  // --- Income Statement ---
  // Use reserve-rollforward incurred loss so the income statement and balance sheet tie.
  // This keeps the financial statement logic consistent with the reserve accounting.
  const assessments = poolPremium * decisions.assessmentPct;
  const dividends = poolPremium * decisions.dividendPct;

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
  const beginingSurplus = poolState.surplus;

  const unearnedPremium = 0;
  const otherLiabilities = poolState.otherLiabilities;

  const beginningCash = poolState.cash;

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

  const beginningInvestments = poolState.investments;
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
    poolState.otherAssets;

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

  const result: ResultSet = {
    yearNumber,
    calendarYear,
    decisions,

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
    otherAssets: poolState.otherAssets,
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

    narrativeExplanation: '',
  };

  result.narrativeExplanation = generateNarrative(result, priorResult);

  const updatedPoolState: PoolState = {
    rateLevel: newRateLevel,
    ratePer100: totalMemberRatePer100,
    purePremiumPer100: newPurePremiumPer100,
    purePremium: newPurePremiumPer100,

    memberSatisfaction: memberResult.memberSatisfaction,
    averageRiskQuality: memberResult.averageRiskQuality,
    riskControlEffectiveness: newRCEffectiveness,

    reserveCohorts: allCohorts,
    members: memberResult.activeMembers,

    cash: endingCash,
    investments: endingInvestments,
    otherAssets: poolState.otherAssets,
    grossUnpaidReserve: endingGrossReserve,
    reinsuranceRecoverable: endingReinsRecoverable,
    unearnedPremium,
    otherLiabilities,
    surplus: endingSurplus,

    totalMarketExposure,
    allMarketMembers: updatedAllMembers,
  };

  return { updatedPoolState, result };
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
