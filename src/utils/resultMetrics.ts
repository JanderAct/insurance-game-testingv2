// The full year-by-year result metric list — the SINGLE source of truth for
// both the on-screen Result Spreadsheet table and the .xlsx export. Kept here
// (not inline in the page component) so every consumer — including baseline
// generation scripts — uses the same list and cannot silently drift from what
// the app actually exports.
import type { SpreadsheetMetric } from './resultsExport';
import { formatCurrency, formatPct } from './formatters';
import { REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';
import { placementCode, placementSummary, resultUsesTower } from './reinsuranceDisplay';
import type { CoverageLine } from '../types/simulation';

// Which tower line a result row belongs to, inferred from the layer-count the
// engine populated: WC's tower has 4 layers, GL's has 3. Only reached when
// resultUsesTower is already true, so Property never lands here.
const towerLineOf = (r: { cededByLayer?: number[] }): CoverageLine =>
  (r.cededByLayer?.length ?? 0) >= 4 ? 'WC' : 'GL';

const dollars = (value: number) => `$${value.toFixed(2)}`;
const roundDollars = (value: number) => Math.round(value);

export const RESULT_METRICS: SpreadsheetMetric[] = [
    {
      key: 'yearNumber',
      category: 'Year',
      label: 'Year Number',
      value: r => r.yearNumber,
    },
    {
      key: 'calendarYear',
      category: 'Year',
      label: 'Calendar Year',
      value: r => r.calendarYear,
    },

    // Decisions
    // 'rateChange' REMOVED — the decision field it exported is gone
    // (CLF-only pricing). Removing an export field is a SHAPE change (the
    // hash guard will move); it is not a value change on any remaining field.
    {
      key: 'fundingConfidenceLevel',
      category: 'Decisions',
      label: 'Funding Confidence Level',
      value: r => formatPct(r.selectedFundingConfidenceLevel, 0),
      csvValue: r => r.selectedFundingConfidenceLevel,
    },
    {
      key: 'selectedFundingCLF',
      category: 'Decisions',
      label: 'Selected CLF',
      value: r => r.selectedFundingCLF.toFixed(3),
      csvValue: r => r.selectedFundingCLF,
    },
    {
      key: 'dividendPct',
      category: 'Decisions',
      label: 'Dividend %',
      value: r => formatPct(r.decisions.dividendPct, 1),
      csvValue: r => r.decisions.dividendPct,
    },
    {
      key: 'assessmentPct',
      category: 'Decisions',
      label: 'Assessment %',
      value: r => formatPct(r.decisions.assessmentPct, 1),
      csvValue: r => r.decisions.assessmentPct,
    },
    {
      key: 'underwritingStrictness',
      category: 'Decisions',
      label: 'Underwriting Strictness',
      value: r => r.decisions.underwritingStrictness,
    },
    {
      key: 'riskControlPct',
      category: 'Decisions',
      label: 'Risk Control %',
      value: r => formatPct(r.decisions.riskControlPct, 1),
      csvValue: r => r.decisions.riskControlPct,
    },
    {
      // TWO PRODUCTS SHARE THIS ROW. WC/GL export their layer placement; Property
      // exports its quota-share level. Exporting a level for a tower line would
      // put a meaningless "2 - Moderate" in every WC and GL spreadsheet.
      //
      // csvValue is now a STRING for tower lines (a placement code like
      // "L1+L2+L3+AGG1"), so value-identity — which is numeric-only — no longer
      // sees a numeric field here on WC/GL. That is correct: a placement is not a
      // magnitude, and pretending it is one is what the old column did.
      //
      // ⚠ THE LABEL IS STILL "Reinsurance Level", WHICH IS WRONG FOR WC AND GL.
      // It is left wrong DELIBERATELY and only here. `label` is a static string
      // shared by every line's export, so any rename also rewrites PROPERTY's
      // header row — and PR-solo staying byte-identical is the leak check that
      // proves this work did not touch Property. Renaming it, or adding a
      // Retained Above Tower column (which would likewise appear on Property at
      // 0), both moved PR-solo when tried. The VALUE is correct for every line;
      // only this header is stale, and fixing it needs a deliberate re-baseline.
      key: 'reinsuranceLevel',
      category: 'Decisions',
      label: 'Reinsurance Level',
      value: r => resultUsesTower(r) ? placementSummary(towerLineOf(r), r.decisions) : `${r.decisions.reinsuranceLevel} - ${REINSURANCE_PROGRAMS[r.decisions.reinsuranceLevel]?.label ?? ''}`,
      csvValue: r => resultUsesTower(r) ? placementCode(towerLineOf(r), r.decisions) : r.decisions.reinsuranceLevel,
    },
    {
      key: 'assetAllocation',
      category: 'Decisions',
      label: 'Asset Allocation',
      value: r => `Cash ${r.assetAllocation.cashPct.toFixed(0)}% / Bonds ${r.assetAllocation.bondsPct.toFixed(0)}% / Equities ${r.assetAllocation.equitiesPct.toFixed(0)}%`,
    },

    // Membership
    {
      key: 'activeMembers',
      category: 'Membership',
      label: 'Active Members',
      value: r => r.activeMembers,
    },
    {
      key: 'newMembers',
      category: 'Membership',
      label: 'New Members',
      value: r => r.newMembers,
    },
    {
      key: 'withdrawnMembers',
      category: 'Membership',
      label: 'Withdrawn Members',
      value: r => r.withdrawnMembers,
    },
    {
      key: 'memberRetentionRate',
      category: 'Membership',
      label: 'Member Retention Rate',
      value: r => formatPct(r.memberRetentionRate),
      csvValue: r => r.memberRetentionRate,
    },
    {
      key: 'memberSatisfaction',
      category: 'Membership',
      label: 'Member Satisfaction',
      value: r => r.memberSatisfaction.toFixed(2),
      csvValue: r => r.memberSatisfaction,
    },
    {
      key: 'averageRiskQuality',
      category: 'Membership',
      label: 'Average Risk Quality',
      value: r => r.averageRiskQuality.toFixed(2),
      csvValue: r => r.averageRiskQuality,
    },
    {
      key: 'activeExposure',
      category: 'Membership',
      label: 'Active Payroll Exposure ($M)',
      value: r => r.activeExposure.toFixed(2),
      csvValue: r => r.activeExposure,
    },
    {
      key: 'totalMarketExposure',
      category: 'Membership',
      label: 'Total Market Payroll ($M)',
      value: r => r.totalMarketExposure.toFixed(2),
      csvValue: r => r.totalMarketExposure,
    },
    {
      key: 'marketShare',
      category: 'Membership',
      label: 'Market Share',
      value: r => formatPct(r.marketShare),
      csvValue: r => r.marketShare,
    },

    // Rate and premium
    {
      key: 'rateLevel',
      category: 'Rate and Premium',
      label: 'Rate Level Index',
      value: r => r.rateLevel.toFixed(3),
      csvValue: r => r.rateLevel,
    },
    {
      key: 'purePremiumRatePer100',
      category: 'Rate and Premium',
      label: 'Pure Premium Rate per $100 Payroll',
      value: r => dollars(r.purePremiumPer100),
      csvValue: r => r.purePremiumPer100,
    },
    {
      key: 'poolPremiumRateAtSelectedClf',
      category: 'Rate and Premium',
      label: 'Pool Premium Rate at Selected CLF',
      value: r => dollars(r.poolPremium / Math.max(r.activeExposure * 10_000, 1)),
      csvValue: r => r.poolPremium / Math.max(r.activeExposure * 10_000, 1),
    },
    {
      key: 'totalMemberRatePer100',
      category: 'Rate and Premium',
      label: 'Gross Premium & Admin Expense Rate per $100',
      value: r => dollars(r.ratePer100),
      csvValue: r => r.ratePer100,
    },
    {
      key: 'writtenExposure',
      category: 'Rate and Premium',
      label: 'Written Payroll ($M)',
      value: r => r.writtenExposure.toFixed(2),
      csvValue: r => r.writtenExposure,
    },
    {
      key: 'purePremiumAtOne',
      category: 'Rate and Premium',
      label: 'Pure Premium',
      value: r => formatCurrency(r.expectedLoss),
      csvValue: r => roundDollars(r.expectedLoss),
    },
    {
      key: 'poolPremium',
      category: 'Rate and Premium',
      label: 'Pool Premium at Selected CLF',
      value: r => formatCurrency(r.poolPremium),
      csvValue: r => roundDollars(r.poolPremium),
    },
    {
      key: 'adminExpense',
      category: 'Rate and Premium',
      label: 'Admin Expense',
      value: r => formatCurrency(r.adminExpense),
      csvValue: r => roundDollars(r.adminExpense),
    },
    {
      key: 'totalMemberCharge',
      category: 'Rate and Premium',
      label: 'Gross Premium & Admin Expense',
      value: r => formatCurrency(r.totalMemberCharge),
      csvValue: r => roundDollars(r.totalMemberCharge),
    },
    {
      key: 'assessments',
      category: 'Rate and Premium',
      label: 'Assessments',
      value: r => formatCurrency(r.assessments),
      csvValue: r => roundDollars(r.assessments),
    },
    {
      key: 'dividends',
      category: 'Rate and Premium',
      label: 'Dividends / Returned Pool Premium',
      value: r => formatCurrency(r.dividends),
      csvValue: r => roundDollars(r.dividends),
    },

    // Losses
    {
      key: 'expectedLoss',
      category: 'Losses',
      label: 'Pure Premium',
      value: r => formatCurrency(r.expectedLoss),
      csvValue: r => roundDollars(r.expectedLoss),
    },
    {
      key: 'clfAdjustedExpectedLoss',
      category: 'Losses',
      label: 'Pool Premium at Selected CLF',
      value: r => formatCurrency(r.clfAdjustedExpectedLoss),
      csvValue: r => roundDollars(r.clfAdjustedExpectedLoss),
    },
    {
      key: 'aggregateMemberLoss',
      category: 'Losses',
      label: 'Member-Level Simulated Loss incl. Shared Events',
      value: r => formatCurrency(r.aggregateMemberLoss ?? r.grossUltimateLoss),
      csvValue: r => roundDollars(r.aggregateMemberLoss ?? r.grossUltimateLoss),
    },
    {
      key: 'commonLossFactor',
      category: 'Losses',
      label: 'Shared Annual Loss Factor',
      value: r => (r.commonLossFactor ?? 1).toFixed(4),
      csvValue: r => r.commonLossFactor ?? 1,
    },
    {
      key: 'catastropheFactor',
      category: 'Losses',
      label: 'Catastrophe Factor',
      value: r => (r.catastropheFactor ?? 1).toFixed(4),
      csvValue: r => r.catastropheFactor ?? 1,
    },
    {
      key: 'shockLossAmount',
      category: 'Losses',
      label: 'Shock Uplift (included in simulated loss)',
      value: r => formatCurrency(r.shockLossAmount ?? 0),
      csvValue: r => roundDollars(r.shockLossAmount ?? 0),
    },
    {
      key: 'grossUltimateLoss',
      category: 'Losses',
      label: 'Gross Ultimate Loss + LAE',
      value: r => formatCurrency(r.grossUltimateLoss),
      csvValue: r => roundDollars(r.grossUltimateLoss),
    },
    {
      key: 'shockLossIncurred',
      category: 'Losses',
      label: 'Shock Loss Incurred',
      value: r => (r.shockLossIncurred ? 'Yes' : 'No'),
    },
    {
      key: 'reinsuranceRecovery',
      category: 'Losses',
      label: 'Reinsurance Recovery',
      value: r => formatCurrency(r.reinsuranceRecovery),
      csvValue: r => roundDollars(r.reinsuranceRecovery),
    },
    {
      key: 'netUltimateLoss',
      category: 'Losses',
      label: 'Net Ultimate Loss + LAE',
      value: r => formatCurrency(r.netUltimateLoss),
      csvValue: r => roundDollars(r.netUltimateLoss),
    },

    // Expenses and income
    {
      key: 'operatingExpense',
      category: 'Expenses and Income',
      label: 'Operating Expense',
      value: r => formatCurrency(r.operatingExpense),
      csvValue: r => roundDollars(r.operatingExpense),
    },
    {
      key: 'riskControlInvestment',
      category: 'Expenses and Income',
      label: 'Risk Control Investment',
      value: r => formatCurrency(r.riskControlInvestment),
      csvValue: r => roundDollars(r.riskControlInvestment),
    },
    {
      key: 'reinsuranceCost',
      category: 'Expenses and Income',
      label: 'Reinsurance Cost',
      value: r => formatCurrency(r.reinsuranceCost),
      csvValue: r => roundDollars(r.reinsuranceCost),
    },
    {
      key: 'investedAssets',
      category: 'Expenses and Income',
      label: 'Invested Assets',
      value: r => formatCurrency(r.investedAssets),
      csvValue: r => roundDollars(r.investedAssets),
    },
    {
      key: 'investmentReturnRate',
      category: 'Expenses and Income',
      label: 'Investment Return Rate',
      value: r => formatPct(r.investmentReturnRate),
      csvValue: r => r.investmentReturnRate,
    },
    {
      key: 'investmentIncome',
      category: 'Expenses and Income',
      label: 'Investment Income',
      value: r => formatCurrency(r.investmentIncome),
      csvValue: r => roundDollars(r.investmentIncome),
    },
    {
      key: 'netIncome',
      category: 'Expenses and Income',
      label: 'Net Income',
      value: r => formatCurrency(r.netIncome),
      csvValue: r => roundDollars(r.netIncome),
    },

    // Reserves
    {
      key: 'priorYearDevelopment',
      category: 'Reserves',
      label: 'Prior-Year Development',
      value: r => formatCurrency(r.priorYearDevelopment),
      csvValue: r => roundDollars(r.priorYearDevelopment),
    },
    {
      key: 'beginningNetReserve',
      category: 'Reserves',
      label: 'Beginning Net Reserve',
      value: r => formatCurrency(r.beginningNetReserve),
      csvValue: r => roundDollars(r.beginningNetReserve),
    },
    {
      key: 'currentYearNetReserve',
      category: 'Reserves',
      label: 'Current-Year Net Reserve',
      value: r => formatCurrency(r.currentYearNetReserve),
      csvValue: r => roundDollars(r.currentYearNetReserve),
    },
    {
      key: 'netPaidLosses',
      category: 'Reserves',
      label: 'Net Paid Losses',
      value: r => formatCurrency(r.netPaidLosses),
      csvValue: r => roundDollars(r.netPaidLosses),
    },
    {
      key: 'endingNetReserve',
      category: 'Reserves',
      label: 'Ending Net Reserve',
      value: r => formatCurrency(r.endingNetReserve),
      csvValue: r => roundDollars(r.endingNetReserve),
    },
    {
      key: 'expectedNetUnpaidLoss',
      category: 'Reserves',
      label: 'Expected Net Unpaid Loss',
      value: r => formatCurrency(r.expectedNetUnpaidLoss),
      csvValue: r => roundDollars(r.expectedNetUnpaidLoss),
    },
    {
      key: 'indicatedNetReserveAtConfidenceLevel',
      category: 'Reserves',
      label: 'Indicated Net Reserve at Confidence',
      value: r => formatCurrency(r.indicatedNetReserveAtConfidenceLevel),
      csvValue: r => roundDollars(r.indicatedNetReserveAtConfidenceLevel),
    },
    {
      key: 'reserveRiskMarginNeeded',
      category: 'Reserves',
      label: 'Reserve Risk Margin Needed',
      value: r => formatCurrency(r.reserveRiskMarginNeeded),
      csvValue: r => roundDollars(r.reserveRiskMarginNeeded),
    },

    // Balance sheet and surplus
    {
      key: 'beginningCash',
      category: 'Balance Sheet and Surplus',
      label: 'Beginning Cash',
      value: r => formatCurrency(r.beginningCash),
      csvValue: r => roundDollars(r.beginningCash),
    },
    {
      key: 'endingCash',
      category: 'Balance Sheet and Surplus',
      label: 'Ending Cash',
      value: r => formatCurrency(r.endingCash),
      csvValue: r => roundDollars(r.endingCash),
    },
    {
      key: 'beginningInvestments',
      category: 'Balance Sheet and Surplus',
      label: 'Beginning Investments',
      value: r => formatCurrency(r.beginningInvestments),
      csvValue: r => roundDollars(r.beginningInvestments),
    },
    {
      key: 'endingInvestments',
      category: 'Balance Sheet and Surplus',
      label: 'Ending Investments',
      value: r => formatCurrency(r.endingInvestments),
      csvValue: r => roundDollars(r.endingInvestments),
    },
    {
      key: 'totalAssets',
      category: 'Balance Sheet and Surplus',
      label: 'Total Assets',
      value: r => formatCurrency(r.totalAssets),
      csvValue: r => roundDollars(r.totalAssets),
    },
    {
      key: 'unearnedPremium',
      category: 'Balance Sheet and Surplus',
      label: 'Unearned Premium',
      value: r => formatCurrency(r.unearnedPremium),
      csvValue: r => roundDollars(r.unearnedPremium),
    },
    {
      key: 'totalLiabilities',
      category: 'Balance Sheet and Surplus',
      label: 'Total Liabilities',
      value: r => formatCurrency(r.totalLiabilities),
      csvValue: r => roundDollars(r.totalLiabilities),
    },
    {
      key: 'beginingSurplus',
      category: 'Balance Sheet and Surplus',
      label: 'Beginning Surplus',
      value: r => formatCurrency(r.beginingSurplus),
      csvValue: r => roundDollars(r.beginingSurplus),
    },
    {
      key: 'surplusFromIncome',
      category: 'Balance Sheet and Surplus',
      label: 'Surplus from Income',
      value: r => formatCurrency(r.surplusFromIncome),
      csvValue: r => roundDollars(r.surplusFromIncome),
    },
    {
      key: 'endingSurplus',
      category: 'Balance Sheet and Surplus',
      label: 'Ending Surplus',
      value: r => formatCurrency(r.endingSurplus),
      csvValue: r => roundDollars(r.endingSurplus),
    },
    {
      key: 'surplusTieOutDifference',
      category: 'Balance Sheet and Surplus',
      label: 'Surplus Tie-Out Difference',
      value: r => formatCurrency(r.surplusTieOutDifference),
      csvValue: r => roundDollars(r.surplusTieOutDifference),
    },

    // Inter-line loan
    {
      key: 'loanOriginatedThisYear',
      category: 'Inter-Line Loan',
      label: 'Loan Originated This Year',
      value: r => formatCurrency(r.loanOriginatedThisYear),
      csvValue: r => roundDollars(r.loanOriginatedThisYear),
    },
    {
      key: 'loanInterestAccrued',
      category: 'Inter-Line Loan',
      label: 'Loan Interest Accrued',
      value: r => formatCurrency(r.loanInterestAccrued),
      csvValue: r => roundDollars(r.loanInterestAccrued),
    },
    {
      key: 'loanRepaymentApplied',
      category: 'Inter-Line Loan',
      label: 'Loan Repayment Applied',
      value: r => formatCurrency(r.loanRepaymentApplied),
      csvValue: r => roundDollars(r.loanRepaymentApplied),
    },
    {
      key: 'outstandingLoanBalance',
      category: 'Inter-Line Loan',
      label: 'Outstanding Loan Balance',
      value: r => formatCurrency(r.outstandingLoanBalance),
      csvValue: r => roundDollars(r.outstandingLoanBalance),
    },

    // Ratios and capital
    {
      key: 'expectedLossRatio',
      category: 'Ratios and Capital',
      // PRICING basis (poolPremium + admin). This is the finding-6
      // reconciliation figure the WC/GL 6b harness checks assert against
      // 66.8% — it is NOT a component of the combined ratio and must not be
      // added to an expense ratio.
      label: 'Expected Loss Ratio (pricing basis)',
      value: r => formatPct(r.expectedLossRatio),
      csvValue: r => r.expectedLossRatio,
    },
    {
      key: 'expectedLossRatioMemberBasis',
      category: 'Ratios and Capital',
      // MEMBER-CHARGE basis (adds reinsurance cost to the denominator). This
      // is the one that pairs with the expense ratio below.
      label: 'Expected Loss Ratio (member charge basis)',
      value: r => formatPct(r.expectedLossRatioMemberBasis),
      csvValue: r => r.expectedLossRatioMemberBasis,
    },
    {
      key: 'expectedExpenseRatio',
      category: 'Ratios and Capital',
      label: 'Expected Expense Ratio (member charge basis)',
      value: r => formatPct(r.expectedExpenseRatio),
      csvValue: r => r.expectedExpenseRatio,
    },
    {
      key: 'expectedCombinedRatio',
      category: 'Ratios and Capital',
      // Both terms on the member-charge basis. ~82.7% at the default CLF
      // 1.346, i.e. 17.3 points of intended underwriting margin; 100.0% at
      // CLF 1.0. It formerly read a hardcoded 1.000.
      label: 'Expected Combined Ratio (member charge basis)',
      value: r => formatPct(r.expectedCombinedRatio),
      csvValue: r => r.expectedCombinedRatio,
    },
    {
      key: 'actualLossRatio',
      category: 'Ratios and Capital',
      label: 'Actual Loss Ratio (member charge basis)',
      value: r => formatPct(r.actualLossRatio),
      csvValue: r => r.actualLossRatio,
    },
    {
      key: 'actualExpenseRatio',
      category: 'Ratios and Capital',
      label: 'Actual Expense Ratio (member charge basis)',
      value: r => formatPct(r.actualExpenseRatio),
      csvValue: r => r.actualExpenseRatio,
    },
    {
      key: 'actualCombinedRatio',
      category: 'Ratios and Capital',
      label: 'Actual Combined Ratio (member charge basis)',
      value: r => formatPct(r.actualCombinedRatio),
      csvValue: r => r.actualCombinedRatio,
    },
    {
      key: 'availableSurplus',
      category: 'Ratios and Capital',
      label: 'Surplus',
      value: r => formatCurrency(r.availableSurplus),
      csvValue: r => roundDollars(r.availableSurplus),
    },
    {
      key: 'excessAvailableSurplus',
      category: 'Ratios and Capital',
      label: 'Excess Available Surplus',
      value: r => formatCurrency(r.excessAvailableSurplus),
      csvValue: r => roundDollars(r.excessAvailableSurplus),
    },
    {
      key: 'excessCapitalRatio',
      category: 'Ratios and Capital',
      label: 'Excess Capital Ratio',
      value: r => r.excessCapitalRatio === null ? 'N/A' : r.excessCapitalRatio.toFixed(3),
      csvValue: r => r.excessCapitalRatio ?? '',
    },
    {
      key: 'capitalAdequacyStatus',
      category: 'Ratios and Capital',
      label: 'Excess Capital Status',
      value: r => r.capitalAdequacyStatus,
    },
];
