// Financial Statement engine for Risk Pool Simulation v1

import { isPoolRow } from './lineHelpers';
import type { LineResultSet , ResultSet} from '../types/simulation';

export interface IncomeStatement {
  poolPremium: number;
  adminExpense: number;
  poolPremiumAndAdminExpense: number;
  totalMemberCharge: number;
  grossPremium: number;
  assessments: number;
  grossUltimateLoss: number;
  reinsuranceRecovery: number;
  priorYearDevelopmentCeded: number;
  bookingGiveBack: number;
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
  /** ⚠ ABSENT ON A POOL ROW — each line picks its own stop. See the construction. */
  selectedFundingConfidenceLevel?: number; // Player-facing selection (e.g., 75%)
  /** ⚠ ABSENT ON A POOL ROW — follows the selection above. */
  selectedFundingCLF?: number;             // Backend actuarial factor
  expectedNetUnpaidLoss: number;           // Expected unpaid losses, net of reinsurance
  netFundingTarget: number;               // expectedNet × CLF
  fundingMarginNeeded: number;            // netFundingTarget - expectedNetUnpaid
  availableFunding: number;               // endingSurplus (capital available)
  fundingGap: number;                    // availableFunding - netFundingTarget
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
  // ⚠ WAS a 12-field `reinsuranceDetail: ReinsuranceDetail` object. Eleven of
  // those fields (level, levelLabel, attachment, limit, recoveryPct,
  // reinsuranceCost, grossLoss, reinsuranceRecovery, netLoss, cessionRatio,
  // hasTractableCeded) fed the Reinsurance Detail card and died with it at 1e7d3fb; they
  // were computed every year and read by nothing for months.
  //
  // THE TWELFTH IS LIVE and is why the object was not deleted outright: the
  // income statement discloses the band retained above the top of the tower.
  // Collapsed to the one surviving number rather than kept as an object with a
  // single field.
  retainedAboveTower: number;
  reserveDetail: ReserveDetail;
  fundingDetail: FundingDetail | null;  // null for historical years — no player-selected funding confidence exists pre-game
}

export function deriveAnnualStatement(result: ResultSet | LineResultSet): AnnualFinancialStatement {
  const incomeStatement: IncomeStatement = {
    poolPremium: result.poolPremium,
    adminExpense: result.adminExpense,
    poolPremiumAndAdminExpense: result.poolPremiumAndAdminExpense,
    totalMemberCharge: result.totalMemberCharge,
    grossPremium: result.grossPremium,
    assessments: result.assessments,
    grossUltimateLoss: result.grossUltimateLoss,
    reinsuranceRecovery: result.reinsuranceRecovery,
    priorYearDevelopmentCeded: result.priorYearDevelopmentCeded,
    bookingGiveBack: result.bookingGiveBack,
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

  const reserveDetail: ReserveDetail = {
    beginningNetReserve: result.beginningNetReserve,
    currentYearUltimate: result.grossUltimateLoss,
    netPaidLosses: result.netPaidLosses,
    priorYearDevelopment: result.priorYearDevelopment,
    endingNetReserve: result.endingNetReserve,
    currentYearReinsRecovery: result.reinsuranceRecovery,
  };

  // Funding detail - CLF is used for funding target, NOT accounting reserve
  //
  // ⚠ THE TWO SELECTION FIELDS ARE OMITTED ON A POOL ROW, AND THE REST OF THE
  // CARD IS NOT. The dollar figures below — expected net unpaid loss, funding
  // target, margin, gap — are genuine sums and are right at pool scale. The
  // confidence level and the CLF are not: each line picks its own stop, so the
  // pool row never had one and used to display the first active line's. Nulling
  // the whole card would have thrown away four true numbers to suppress two
  // false ones.
  const selections = isPoolRow(result)
    ? {}
    : {
      selectedFundingConfidenceLevel: result.selectedFundingConfidenceLevel,
      selectedFundingCLF: result.selectedFundingCLF,
    };
  const fundingDetail: FundingDetail = {
    ...selections,
    expectedNetUnpaidLoss: result.expectedNetUnpaidLoss,
    netFundingTarget: result.netFundingTarget,
    fundingMarginNeeded: result.fundingMarginNeeded,
    availableFunding: result.availableFunding,
    fundingGap: result.fundingGap,
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
    // Disclosed, never deducted — see the income statement's own comment.
    retainedAboveTower: result.retainedAboveTower ?? 0,
    reserveDetail,
    fundingDetail,
  };
}
