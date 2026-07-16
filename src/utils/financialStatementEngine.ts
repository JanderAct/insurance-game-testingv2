// Financial Statement engine for Risk Pool Simulation v1

import type { ResultSet, StartingFinancials, HistoricalYear } from '../types/simulation';
import { SLIDER_RANGES } from '../data/defaultAssumptions';

export interface IncomeStatement {
  poolPremium: number;
  adminExpense: number;
  poolPremiumAndAdminExpense: number;
  totalMemberCharge: number;
  grossPremium: number;
  assessments: number;
  grossUltimateLoss: number;
  attachment: number;
  poolLosses: number;
  excessLosses: number;
  quotaShareLosses: number;
  reinsuranceRecovery: number;
  netUltimateLoss: number;
  netIncurredLoss: number;
  operatingExpense: number;
  riskControlInvestment: number;
  reinsuranceCost: number;
  dividends: number;
  priorYearDevelopment: number;
  underwritingIncome: number;
  investmentIncome: number;
  netIncome: number;
}

export interface BalanceSheet {
  cash: number;
  investments: number;
  reinsuranceRecoverable: number;
  otherAssets: number;
  totalAssets: number;
  grossUnpaidReserve: number;
  unearnedPremium: number;
  otherLiabilities: number;
  totalLiabilities: number;
  surplus: number;
}

export interface SurplusRollforward {
  beginingSurplus: number;
  netIncome: number;
  endingSurplus: number;
  change: number;
  changePct: number;
  surplusFromIncome: number;         // Computed: beginingSurplus + netIncome
  tieOutDifference: number;          // endingSurplus - surplusFromIncome (should be ~0)
}

export interface ReinsuranceDetail {
  level: number;
  levelLabel: string;
  attachment: number;
  limit: number;
  recoveryPct: number;
  reinsuranceCost: number;
  grossLoss: number;
  reinsuranceRecovery: number;
  netLoss: number;
  cessionRatio: number;
}

export interface ReserveDetail {
  beginningGrossReserve: number;
  currentYearUltimate: number;
  grossPaidLosses: number;
  priorYearDevelopment: number;
  endingGrossReserve: number;
  beginningReinsRecoverable: number;
  currentYearReinsRecovery: number;
  reinsReceived: number;
  endingReinsRecoverable: number;
  netUnpaidReserve: number;
}

// Funding Target & Adequacy detail
// The CLF is used to calculate a funding target, NOT an accounting reserve.
export interface FundingDetail {
  selectedFundingConfidenceLevel: number;  // Player-facing selection (e.g., 75%)
  selectedFundingCLF: number;              // Backend actuarial factor
  expectedGrossUnpaidLoss: number;         // Expected unpaid losses (gross)
  expectedReinsuranceRecoverable: number;  // Reinsurance on unpaid losses
  expectedNetUnpaidLoss: number;           // Net of reinsurance
  grossFundingTarget: number;             // expectedGross × CLF
  netFundingTarget: number;               // expectedNet × CLF
  fundingMarginNeeded: number;            // netFundingTarget - expectedNetUnpaid
  availableFunding: number;               // endingSurplus (capital available)
  fundingGap: number;                    // availableFunding - netFundingTarget
  fundingAdequacyRatio: number;          // available / target
  fundingAdequacyStatus: string;         // "Strong" | "Adequate" | "Thin" | "Deficient"
  requiredReserveMargin: number;
  excessAvailableSurplus: number;
  excessCapitalRatio: number | null;
  excessCapitalStatus: string;
}

export interface AnnualFinancialStatement {
  yearNumber: number;
  calendarYear: number;
  isHistorical: boolean;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  surplusRollforward: SurplusRollforward;
  reinsuranceDetail: ReinsuranceDetail;
  reserveDetail: ReserveDetail;
  fundingDetail: FundingDetail | null;  // null for historical years — no player-selected funding confidence exists pre-game
}

export function deriveAnnualStatement(result: ResultSet): AnnualFinancialStatement {
  const incomeStatement: IncomeStatement = {
    poolPremium: result.poolPremium,
    adminExpense: result.adminExpense,
    poolPremiumAndAdminExpense: result.poolPremiumAndAdminExpense,
    totalMemberCharge: result.totalMemberCharge,
    grossPremium: result.grossPremium,
    assessments: result.assessments,
    grossUltimateLoss: result.grossUltimateLoss,
    attachment: result.attachment,
    poolLosses: result.poolLosses,
    excessLosses: result.excessLosses,
    quotaShareLosses: result.quotaShareLosses,
    reinsuranceRecovery: result.reinsuranceRecovery,
    netUltimateLoss: result.netUltimateLoss,
    netIncurredLoss: result.netIncurredLoss,
    operatingExpense: result.operatingExpense,
    riskControlInvestment: result.riskControlInvestment,
    reinsuranceCost: result.reinsuranceCost,
    dividends: result.dividends,
    priorYearDevelopment: result.priorYearDevelopment,
    underwritingIncome: result.underwritingIncome,
    investmentIncome: result.investmentIncome,
    netIncome: result.netIncome,
  };

  const balanceSheet: BalanceSheet = {
    cash: result.endingCash,
    investments: result.endingInvestments,
    reinsuranceRecoverable: result.endingReinsRecoverable,
    otherAssets: result.otherAssets,
    totalAssets: result.totalAssets,
    grossUnpaidReserve: result.endingGrossReserve,
    unearnedPremium: result.unearnedPremium,
    otherLiabilities: result.otherLiabilities,
    totalLiabilities: result.totalLiabilities,
    surplus: result.endingSurplus,
  };

  const surplusRollforward: SurplusRollforward = {
    beginingSurplus: result.beginingSurplus,
    netIncome: result.netIncome,
    endingSurplus: result.endingSurplus,
    change: result.endingSurplus - result.beginingSurplus,
    changePct: (result.endingSurplus - result.beginingSurplus) / Math.max(Math.abs(result.beginingSurplus), 1),
    surplusFromIncome: result.surplusFromIncome,
    tieOutDifference: result.surplusTieOutDifference,
  };

  const reinsLabels = ['Self Fund', 'Low', 'Moderate', 'High', 'Full Transfer'];
  const reinsLevel = result.decisions.reinsuranceLevel;

  const reinsuranceDetail: ReinsuranceDetail = {
    level: reinsLevel,
    levelLabel: reinsLabels[reinsLevel] ?? 'Unknown',
    attachment: result.attachment,
    limit: Infinity,
    recoveryPct: result.excessLosses > 0 ? result.reinsuranceRecovery / result.excessLosses : 0,
    reinsuranceCost: result.reinsuranceCost,
    grossLoss: result.grossUltimateLoss,
    reinsuranceRecovery: result.reinsuranceRecovery,
    netLoss: result.netUltimateLoss,
    cessionRatio: result.reinsuranceRecovery / Math.max(result.grossUltimateLoss, 1),
  };

  const reserveDetail: ReserveDetail = {
    beginningGrossReserve: result.beginningGrossReserve,
    currentYearUltimate: result.grossUltimateLoss,
    grossPaidLosses: result.grossPaidLosses,
    priorYearDevelopment: result.priorYearDevelopment,
    endingGrossReserve: result.endingGrossReserve,
    beginningReinsRecoverable: result.beginningReinsRecoverable,
    currentYearReinsRecovery: result.reinsuranceRecovery,
    reinsReceived: result.reinsuranceRecovery * 0.40,
    endingReinsRecoverable: result.endingReinsRecoverable,
    netUnpaidReserve: result.endingGrossReserve - result.endingReinsRecoverable,
  };

  // Funding detail - CLF is used for funding target, NOT accounting reserve
  const fundingDetail: FundingDetail = {
    selectedFundingConfidenceLevel: result.selectedFundingConfidenceLevel,
    selectedFundingCLF: result.selectedFundingCLF,
    expectedGrossUnpaidLoss: result.expectedGrossUnpaidLoss,
    expectedReinsuranceRecoverable: result.expectedReinsuranceRecoverable,
    expectedNetUnpaidLoss: result.expectedNetUnpaidLoss,
    grossFundingTarget: result.grossFundingTarget,
    netFundingTarget: result.netFundingTarget,
    fundingMarginNeeded: result.fundingMarginNeeded,
    availableFunding: result.availableFunding,
    fundingGap: result.fundingGap,
    fundingAdequacyRatio: result.fundingAdequacyRatio,
    fundingAdequacyStatus: result.fundingAdequacyStatus,
    requiredReserveMargin: result.reserveRiskMarginNeeded,
    excessAvailableSurplus: result.excessAvailableSurplus,
    excessCapitalRatio: result.excessCapitalRatio,
    excessCapitalStatus: result.capitalAdequacyStatus,
  };

  return {
    yearNumber: result.yearNumber,
    calendarYear: result.calendarYear,
    isHistorical: false,
    incomeStatement,
    balanceSheet,
    surplusRollforward,
    reinsuranceDetail,
    reserveDetail,
    fundingDetail,
  };
}

export function deriveHistoricalStatement(year: HistoricalYear): AnnualFinancialStatement {
  const incomeStatement: IncomeStatement = {
    poolPremium: year.poolPremium,
    adminExpense: year.adminExpense,
    poolPremiumAndAdminExpense: year.poolPremiumAndAdminExpense,
    totalMemberCharge: year.totalMemberCharge,
    grossPremium: year.totalMemberCharge,
    assessments: 0,
    grossUltimateLoss: year.grossUltimateLoss,
    attachment: year.attachment,
    poolLosses: year.poolLosses,
    excessLosses: year.excessLosses,
    quotaShareLosses: year.quotaShareLosses,
    reinsuranceRecovery: year.reinsuranceRecovery,
    netUltimateLoss: year.netUltimateLoss,
    netIncurredLoss: year.netUltimateLoss,
    operatingExpense: year.adminExpense,
    riskControlInvestment: 0,
    reinsuranceCost: year.reinsuranceCost,
    dividends: 0,
    priorYearDevelopment: 0,
    underwritingIncome: year.underwritingIncome,
    investmentIncome: year.investmentIncome,
    netIncome: year.netIncome,
  };

  const balanceSheet: BalanceSheet = {
    cash: 0,
    investments: 0,
    reinsuranceRecoverable: year.endingReinsuranceRecoverable,
    otherAssets: 0,
    totalAssets: year.endingSurplus + year.endingGrossReserve,
    grossUnpaidReserve: year.endingGrossReserve,
    unearnedPremium: 0,
    otherLiabilities: 0,
    totalLiabilities: year.endingGrossReserve,
    surplus: year.endingSurplus,
  };

  const surplusRollforward: SurplusRollforward = {
    beginingSurplus: year.endingSurplus - year.netIncome,
    netIncome: year.netIncome,
    endingSurplus: year.endingSurplus,
    change: year.netIncome,
    changePct: year.netIncome / Math.max(Math.abs(year.endingSurplus - year.netIncome), 1),
    surplusFromIncome: year.endingSurplus,
    tieOutDifference: 0,
  };

  const reinsLabels = ['Self Fund', 'Low', 'Moderate', 'High', 'Full Transfer'];
  const reinsLevel = SLIDER_RANGES.reinsuranceLevel.default;

  const reinsuranceDetail: ReinsuranceDetail = {
    level: reinsLevel,
    levelLabel: reinsLabels[reinsLevel] ?? 'Unknown',
    attachment: year.attachment,
    limit: Infinity,
    recoveryPct: year.excessLosses > 0 ? year.reinsuranceRecovery / year.excessLosses : 0,
    reinsuranceCost: year.reinsuranceCost,
    grossLoss: year.grossUltimateLoss,
    reinsuranceRecovery: year.reinsuranceRecovery,
    netLoss: year.netUltimateLoss,
    cessionRatio: year.reinsuranceRecovery / Math.max(year.grossUltimateLoss, 1),
  };

  const reserveDetail: ReserveDetail = {
    beginningGrossReserve: 0,
    currentYearUltimate: year.grossUltimateLoss,
    grossPaidLosses: year.grossPaidLosses,
    priorYearDevelopment: 0,
    endingGrossReserve: year.endingGrossReserve,
    beginningReinsRecoverable: 0,
    currentYearReinsRecovery: year.reinsuranceRecovery,
    reinsReceived: year.reinsuranceRecovery * 0.40,
    endingReinsRecoverable: year.endingReinsuranceRecoverable,
    netUnpaidReserve: year.endingNetReserve,
  };

  return {
    yearNumber: year.historyYearNumber,
    calendarYear: year.calendarYear,
    isHistorical: true,
    incomeStatement,
    balanceSheet,
    surplusRollforward,
    reinsuranceDetail,
    reserveDetail,
    fundingDetail: null,
  };
}

// The opening year (Year 0) is the last historical year, anchored to end exactly at
// startingFinancials. It gets the same full income-statement detail as the other
// historical years, but its balance sheet uses the real starting cash/investments/
// other-assets/other-liabilities breakdown instead of the zeroed placeholders used
// for the earlier historical years (which don't track those separately per year).
export function deriveOpeningStatement(openingYear: HistoricalYear, sf: StartingFinancials): AnnualFinancialStatement {
  const historical = deriveHistoricalStatement(openingYear);
  const balanceSheet: BalanceSheet = {
    cash: sf.cash,
    investments: sf.investments,
    reinsuranceRecoverable: sf.reinsuranceRecoverable,
    otherAssets: sf.otherAssets,
    totalAssets: sf.totalAssets,
    grossUnpaidReserve: sf.grossUnpaidReserve,
    unearnedPremium: sf.unearnedPremium,
    otherLiabilities: sf.otherLiabilities,
    totalLiabilities: sf.totalLiabilities,
    surplus: sf.surplus,
  };
  const surplusRollforward: SurplusRollforward = {
    ...historical.surplusRollforward,
    endingSurplus: sf.surplus,
    surplusFromIncome: sf.surplus,
    beginingSurplus: sf.surplus - openingYear.netIncome,
  };
  return {
    ...historical,
    balanceSheet,
    surplusRollforward,
  };
}

export function deriveStartingStatement(sf: StartingFinancials): BalanceSheet {
  return {
    cash: sf.cash,
    investments: sf.investments,
    reinsuranceRecoverable: sf.reinsuranceRecoverable,
    otherAssets: sf.otherAssets,
    totalAssets: sf.totalAssets,
    grossUnpaidReserve: sf.grossUnpaidReserve,
    unearnedPremium: sf.unearnedPremium,
    otherLiabilities: sf.otherLiabilities,
    totalLiabilities: sf.totalLiabilities,
    surplus: sf.surplus,
  };
}
