// Financial Statement engine for Risk Pool Simulation v1

import type { LineResultSet } from '../types/simulation';

export interface IncomeStatement {
  poolPremium: number;
  adminExpense: number;
  poolPremiumAndAdminExpense: number;
  selfFundedDiscount: number;
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
  totalAssets: number;
  netUnpaidReserve: number;
  unearnedPremium: number;
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
  beginningNetReserve: number;
  currentYearUltimate: number;
  netPaidLosses: number;
  priorYearDevelopment: number;
  endingNetReserve: number;
  currentYearReinsRecovery: number;
}

// Funding Target & Adequacy detail
// The CLF is used to calculate a funding target, NOT an accounting reserve.
export interface FundingDetail {
  selectedFundingConfidenceLevel: number;  // Player-facing selection (e.g., 75%)
  selectedFundingCLF: number;              // Backend actuarial factor
  expectedNetUnpaidLoss: number;           // Expected unpaid losses, net of reinsurance
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

export function deriveAnnualStatement(result: LineResultSet): AnnualFinancialStatement {
  const incomeStatement: IncomeStatement = {
    poolPremium: result.poolPremium,
    adminExpense: result.adminExpense,
    poolPremiumAndAdminExpense: result.poolPremiumAndAdminExpense,
    selfFundedDiscount: result.selfFundedDiscount,
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
    totalAssets: result.totalAssets,
    netUnpaidReserve: result.endingNetReserve,
    unearnedPremium: result.unearnedPremium,
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
    beginningNetReserve: result.beginningNetReserve,
    currentYearUltimate: result.grossUltimateLoss,
    netPaidLosses: result.netPaidLosses,
    priorYearDevelopment: result.priorYearDevelopment,
    endingNetReserve: result.endingNetReserve,
    currentYearReinsRecovery: result.reinsuranceRecovery,
  };

  // Funding detail - CLF is used for funding target, NOT accounting reserve
  const fundingDetail: FundingDetail = {
    selectedFundingConfidenceLevel: result.selectedFundingConfidenceLevel,
    selectedFundingCLF: result.selectedFundingCLF,
    expectedNetUnpaidLoss: result.expectedNetUnpaidLoss,
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
