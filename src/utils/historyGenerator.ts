import type { GameInstance, HistoricalYear, StartingFinancials } from '../types/simulation';
import {
  ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM,
  AGGREGATE_LOSS_DISTRIBUTION,
  FUNDING_CLF_TABLE,
  SLIDER_RANGES,
} from '../data/defaultAssumptions';
import { SeededRandom, deriveSubRng } from './random';
import {
  calculateReinsuranceCost,
  calculateReinsuranceRecovery,
  getReinsuranceStructure,
} from './reinsuranceEngine';

const HISTORY_YEARS = 4;
const RESERVE_MARGIN_CLF = FUNDING_CLF_TABLE[0.90];

type CandidateYear = Omit<
  HistoricalYear,
  | 'endingGrossReserve'
  | 'endingReinsuranceRecoverable'
  | 'endingNetReserve'
  | 'endingSurplus'
  | 'requiredReserveMargin'
  | 'excessCapitalRatio'
  | 'capitalAdequacyStatus'
>;

function capitalStatus(excessCapitalRatio: number | null): string {
  if (excessCapitalRatio === null) return 'N/A';
  if (excessCapitalRatio >= 0.25) return 'Strong';
  if (excessCapitalRatio >= 0) return 'Adequate';
  if (excessCapitalRatio >= -0.10) return 'Thin';
  return 'Deficient';
}

function buildCandidate(
  instance: GameInstance,
  startingFinancials: StartingFinancials,
  startingYear: number,
  attempt: number,
): CandidateYear[] {
  const rng = deriveSubRng(instance.seed + attempt * 997, 0, 'history-losses');
  const shapeRng = new SeededRandom(instance.seed + 41_771);
  const exposureGrowth = Math.max(0.01, Math.min(0.06,
    instance.marketEnvironment.totalMarketGrowthRate + shapeRng.range(-0.005, 0.015)
  ));
  const memberAnnualGrowth = shapeRng.pick([0, 0, 1]);
  const finalExpectedLoss = Math.max(
    startingFinancials.activeExposure * startingFinancials.purePremiumPer100 * 10_000,
    1
  );

  return Array.from({ length: HISTORY_YEARS }, (_, index) => {
    const yearsBeforeOpening = HISTORY_YEARS - 1 - index;
    const activeExposure = startingFinancials.activeExposure
      / Math.pow(1 + exposureGrowth, yearsBeforeOpening);
    const totalMarketExposure = startingFinancials.totalMarketExposure
      / Math.pow(1 + instance.marketEnvironment.totalMarketGrowthRate, yearsBeforeOpening);
    const activeMembers = Math.max(
      1,
      startingFinancials.activeMembers - memberAnnualGrowth * yearsBeforeOpening
    );
    const purePremiumPer100 = startingFinancials.purePremiumPer100
      / Math.pow(1 + instance.lossEnvironment.lossTrend, yearsBeforeOpening);
    const expectedLoss = activeExposure * purePremiumPer100 * 10_000;
    const scaleToOpening = expectedLoss / finalExpectedLoss;
    const poolPremiumAndAdminExpense = startingFinancials.annualPremium * scaleToOpening;
    const adminExpense = expectedLoss * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
    const poolPremium = Math.max(0, poolPremiumAndAdminExpense - adminExpense);
    const reinsuranceLevel = SLIDER_RANGES.reinsuranceLevel.default;
    const reinsuranceCost = calculateReinsuranceCost(
      reinsuranceLevel,
      poolPremium,
      instance.marketEnvironment.competitivePressure
    );
    const totalMemberCharge = poolPremiumAndAdminExpense + reinsuranceCost;

    const memberAggregateSigma = 0.08;
    const memberAggregateFactor = rng.lognormal(
      -0.5 * memberAggregateSigma * memberAggregateSigma,
      memberAggregateSigma
    );
    const annualLossFactor = rng.lognormal(
      AGGREGATE_LOSS_DISTRIBUTION.logMean,
      AGGREGATE_LOSS_DISTRIBUTION.logSigma
    ) * AGGREGATE_LOSS_DISTRIBUTION.actualLossLevelMultiplier;
    const grossUltimateLoss = Math.max(
      0,
      expectedLoss * memberAggregateFactor * annualLossFactor
    );
    const reinsuranceStructure = getReinsuranceStructure(
      reinsuranceLevel,
      poolPremium,
      expectedLoss
    );
    const reinsuranceRecovery = calculateReinsuranceRecovery(
      grossUltimateLoss,
      reinsuranceStructure
    );
    const netUltimateLoss = grossUltimateLoss - reinsuranceRecovery;
    const grossPaidLosses = grossUltimateLoss * 0.40;

    const investedAssets = startingFinancials.investments * scaleToOpening;
    const investmentReturn = Math.max(
      -0.02,
      Math.min(0.05, rng.normal(instance.investmentEnvironment.baseReturn * 0.55, 0.012))
    );
    const investmentIncome = investedAssets * investmentReturn;
    const netIncome =
      totalMemberCharge
      + investmentIncome
      - netUltimateLoss
      - adminExpense
      - reinsuranceCost;
    const actualLossRatio = netUltimateLoss / Math.max(totalMemberCharge, 1);
    const actualExpenseRatio =
      (adminExpense + reinsuranceCost) / Math.max(totalMemberCharge, 1);

    return {
      historyYearNumber: index - (HISTORY_YEARS - 1),
      calendarYear: startingYear - HISTORY_YEARS + index,
      activeMembers,
      activeExposure: Number(activeExposure.toFixed(2)),
      totalMarketExposure: Number(totalMarketExposure.toFixed(2)),
      marketShare: activeExposure / Math.max(totalMarketExposure, 0.01),
      purePremiumPer100,
      poolPremiumRatePer100: poolPremium / Math.max(activeExposure * 10_000, 1),
      expectedLoss,
      poolPremium,
      adminExpense,
      poolPremiumAndAdminExpense,
      reinsuranceCost,
      totalMemberCharge,
      grossUltimateLoss,
      reinsuranceRecovery,
      netUltimateLoss,
      grossPaidLosses,
      actualLossRatio,
      actualExpenseRatio,
      actualCombinedRatio: actualLossRatio + actualExpenseRatio,
      investmentIncome,
      netIncome,
    };
  });
}

export function generateHistoricalYears(
  instance: GameInstance,
  startingFinancials: StartingFinancials,
  startingYear: number,
): HistoricalYear[] {
  let candidate = buildCandidate(instance, startingFinancials, startingYear, 0);

  // Choose a deterministic set whose implied opening surplus remains positive.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const attemptCandidate = buildCandidate(instance, startingFinancials, startingYear, attempt);
    const totalNetIncome = attemptCandidate.reduce((sum, year) => sum + year.netIncome, 0);
    const impliedOpeningSurplus = startingFinancials.surplus - totalNetIncome;
    let runningSurplus = impliedOpeningSurplus;
    let minimumSurplus = runningSurplus;
    for (const year of attemptCandidate) {
      runningSurplus += year.netIncome;
      minimumSurplus = Math.min(minimumSurplus, runningSurplus);
    }

    candidate = attemptCandidate;
    if (impliedOpeningSurplus >= 500_000 && minimumSurplus >= 250_000) break;
  }

  const totalNetIncome = candidate.reduce((sum, year) => sum + year.netIncome, 0);
  let runningSurplus = startingFinancials.surplus - totalNetIncome;
  const reserveRng = new SeededRandom(instance.seed + 88_921);
  const finalExpectedLoss = Math.max(candidate[candidate.length - 1].expectedLoss, 1);

  return candidate.map((year, index) => {
    runningSurplus += year.netIncome;
    const isOpeningYear = index === candidate.length - 1;
    const reserveScale = year.expectedLoss / finalExpectedLoss;
    const endingGrossReserve = isOpeningYear
      ? startingFinancials.grossUnpaidReserve
      : startingFinancials.grossUnpaidReserve
        * reserveScale
        * reserveRng.range(0.92, 1.08);
    const endingReinsuranceRecoverable = isOpeningYear
      ? startingFinancials.reinsuranceRecoverable
      : Math.min(
          endingGrossReserve,
          startingFinancials.reinsuranceRecoverable
            * reserveScale
            * reserveRng.range(0.85, 1.15)
        );
    const endingNetReserve = Math.max(
      0,
      endingGrossReserve - endingReinsuranceRecoverable
    );
    const requiredReserveMargin = endingNetReserve * (RESERVE_MARGIN_CLF - 1);
    const endingSurplus = isOpeningYear ? startingFinancials.surplus : runningSurplus;
    const excessCapitalRatio = requiredReserveMargin > 0
      ? (endingSurplus - requiredReserveMargin) / requiredReserveMargin
      : null;

    return {
      ...year,
      endingGrossReserve,
      endingReinsuranceRecoverable,
      endingNetReserve,
      endingSurplus,
      requiredReserveMargin,
      excessCapitalRatio,
      capitalAdequacyStatus: capitalStatus(excessCapitalRatio),
    };
  });
}
