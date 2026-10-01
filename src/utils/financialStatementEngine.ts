// Financial Statement engine for Risk Pool Simulation v1

import { isPoolRow } from './lineHelpers';
import type { CoverageLine, LineResultSet, ResultSet } from '../types/simulation';

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

/**
 * THE PRESENTATION SUBTOTALS, DERIVED ONCE.
 *
 * ⚠ EVERY FIGURE BELOW WAS BUILT TWICE — once in FinancialsPage and once in
 * CalculationAuditPage, from the same fields, with no shared helper. They agreed,
 * and nothing made them agree: a change to one surface moved that surface only,
 * which is the symptom this exists to end. Two of them were also WRONG in both
 * places, identically, which is what a single definition would have prevented.
 *
 * ⚠ WHY A SEPARATE FUNCTION AND NOT MORE FIELDS ON AnnualFinancialStatement.
 * deriveAnnualStatement is a pure field MAP — every line of it copies a stored
 * engine value under a presentation name, and that is worth keeping readable as
 * exactly that. These are DERIVATIONS: sums, splits and sign flips that exist
 * only because a statement has subtotals. Keeping the two apart means a reader
 * can tell at a glance which numbers the engine produced and which this file
 * computed, which is the distinction the audit page exists to expose.
 *
 * ⚠ AND IT RETURNS THE OPERANDS, NOT ONLY THE SUBTOTALS. The audit page renders
 * the build-up of each figure, so it needs the parts; if it took the subtotal and
 * re-derived the parts to display them, the duplication would be back in the
 * place that matters most. One call, every term.
 */
export interface StatementLines {
  /** Pass-throughs shown GROSS: reinsurance and admin are both revenue and expense. */
  totalOperatingRevenues: number;
  totalOperatingExpenses: number;
  /**
   * ⚠ BOOKED, NOT DRAWN, AND THIS IS THE ONE PLAYER-VISIBLE CHANGE. The provision
   * subtotal must tie to netIncurredLoss, which the engine builds from the BOOKED
   * register; `grossUltimateLoss` is the register as DRAWN, before forward
   * booking contracts it. Showing the drawn figure against a booked subtotal is a
   * basis mismatch, and it is why the audit page's provision check failed every
   * year at every scope.
   */
  currentYearClaims: number;
  /**
   * ⚠ READ FROM priorYearDevelopment, NOT RECONSTRUCTED. Both pages computed
   * `netIncurredLoss - netUltimateLoss`, which is the same quantity ONLY when the
   * booked and pre-bias ultimates agree — that is, only at or above break-even.
   * Below it the reconstruction absorbed the booking bias and the give-back, so
   * the prior-year line silently carried a current-year item. The engine already
   * emits the figure; the sign is flipped because the engine signs development
   * positive-is-favourable and the statement presents it as an expense.
   */
  priorYearClaims: number;
  /**
   * THE IBNER BOOKING MARKDOWN — negative, and the line the statement was missing.
   *
   * ⚠ THE PROVISION SUBTOTAL ONLY EVER TIED BECAUSE TWO ERRORS CANCELLED. The
   * statement shows the give-back (`Recovery deferred by optimistic booking`) but
   * never showed the bias markdown beside it, even though both are parts of the
   * same optimistic booking. The chain was therefore short by this term — and the
   * old prior-year line, reconstructed as `netIncurredLoss - netUltimateLoss`,
   * was absorbing exactly it. Correcting the prior-year line on its own exposed
   * the hole rather than creating it.
   *
   * Measured at confidence 0.30, residual 0.000000 on every line-year:
   * `bookedNetUltimate - netUltimateLoss = -netUltimateLoss x bias - giveBack`.
   *
   * ⚠ DERIVED FROM STORED FIELDS, NOT FROM THE BIAS FUNCTION, so it is computable
   * at POOL scope. `ibnerBookingBias(selectedFundingCLF)` needs a CLF the pool row
   * does not have; this rearrangement needs only figures both scopes carry.
   */
  bookingBiasMarkdown: number;
  cashAndEquivalents: number;
  noncurrentInvestments: number;
  currentUnpaidPortion: number;
  noncurrentUnpaidPortion: number;
}

export function statementLines(result: ResultSet | LineResultSet): StatementLines {
  const totalOperatingRevenues =
    result.reinsuranceCost + result.poolPremium + result.adminExpense + result.assessments;
  const totalOperatingExpenses =
    result.reinsuranceCost + result.netIncurredLoss + result.operatingExpense
    + result.riskControlInvestment + result.dividends;

  // The cash-equivalents slice comes off the allocation the pool actually chose.
  // assetAllocation is pool-wide and projected identically into every line, so it
  // reads the same at either scope.
  const cashSlice = result.endingInvestments * (result.assetAllocation.cashPct / 100);

  // ⚠ THE CURRENT PORTION IS RESERVE-WEIGHTED PER LINE AND CANNOT BE A SINGLE
  // MULTIPLICATION AT POOL SCOPE. Each line's nextYearPaydownRate is the engine's
  // own weighting over the cohorts that line holds, and under a payout pattern
  // the rate depends on each cohort's age. Both pages already walked byLine to do
  // this, identically; that walk lives here now.
  const currentUnpaidPortion = isPoolRow(result)
    ? (Object.keys(result.byLine) as CoverageLine[])
      .reduce((s, l) => s + result.byLine[l].endingNetReserve * result.byLine[l].nextYearPaydownRate, 0)
    : result.endingNetReserve * result.nextYearPaydownRate;

  return {
    totalOperatingRevenues,
    totalOperatingExpenses,
    currentYearClaims: result.bookedGrossUltimate ?? result.grossUltimateLoss,
    priorYearClaims: -result.priorYearDevelopment,
    bookingBiasMarkdown:
      (result.bookedNetUltimate ?? result.netUltimateLoss) - result.netUltimateLoss
      + (result.bookingGiveBack ?? 0),
    cashAndEquivalents: result.endingCash + cashSlice,
    noncurrentInvestments: result.endingInvestments - cashSlice,
    currentUnpaidPortion,
    noncurrentUnpaidPortion: result.endingNetReserve - currentUnpaidPortion,
  };
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
