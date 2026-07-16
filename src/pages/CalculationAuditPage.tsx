import React, { useState } from 'react';
import {
  Calculator,
  ClipboardList,
  DollarSign,
  Shield,
  TrendingUp,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import type { ResultSet } from '../types/simulation';
import { formatCurrency, formatPct } from '../utils/formatters';
import {
  ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM,
  AGGREGATE_LOSS_DISTRIBUTION,
  LOSS_TREND,
  MEMBER_LOSS_VOLATILITY,
  BASE_RETENTION,
  BASE_NEW_MEMBERS_PER_YEAR,
  MAX_NEW_MEMBERS_PER_YEAR,
  MAX_WITHDRAWN_PER_YEAR,
  FUNDING_CLF_TABLE,
  INVESTMENT_RISK_PARAMS,
  REINSURANCE_PROGRAMS,
  MEMBER_MOVEMENT_WEIGHTS,
  RISK_CONTROL_PARAMS,
  EXPOSURE_RANGES,
  SIZE_WEIGHTS,
  STARTING_POOL_EXPOSURE,
  TOTAL_MARKET_EXPOSURE,
  STARTING_RATE_PER_100,
  STARTING_FINANCIALS,
  SLIDER_RANGES,
  STARTING_MEMBER_RANGE,
  TOTAL_MARKET_MEMBERS,
  RESERVE_PAYDOWN_PCT,
} from '../data/defaultAssumptions';

interface CalculationAuditPageProps {
  lockedResults: ResultSet[];
}

interface AuditRow {
  metric: string;
  value: string;
  formula: string;
  note?: string;
}

interface AuditSectionProps {
  title: string;
  icon: React.ReactNode;
  rows: AuditRow[];
}

export default function CalculationAuditPage({ lockedResults }: CalculationAuditPageProps) {
  const [selectedYear, setSelectedYear] = useState<number>(
    lockedResults.length > 0 ? lockedResults[lockedResults.length - 1].yearNumber : 1
  );

  const result = lockedResults.find(r => r.yearNumber === selectedYear);

  if (lockedResults.length === 0 || !result) {
    return (
      <div className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="text-center py-20 text-gray-400">
          <Calculator size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium text-lg">No calculation audit available yet</p>
          <p className="text-sm mt-1">Complete a year to see calculation details.</p>
        </div>
      </div>
    );
  }

  const payrollUnits = Math.max(result.activeExposure * 10_000, 1);
  const rateAtConfidenceLevel = result.poolPremium / payrollUnits;
  const grossPremiumCheck = result.activeExposure * result.ratePer100 * 10_000;
  const grossPremiumDifference = result.grossPremium - grossPremiumCheck;

  const expectedLossCheck = result.activeExposure * result.purePremiumPer100 * 10_000;
  const expectedLossDifference = result.expectedLoss - expectedLossCheck;

  const clfAdjustedExpectedLossCheck = result.expectedLoss * result.selectedFundingCLF;
  const clfAdjustedExpectedLossDifference =
    result.clfAdjustedExpectedLoss - clfAdjustedExpectedLossCheck;

  const netUltimateLossCheck = result.grossUltimateLoss - result.reinsuranceRecovery;
  const netUltimateLossDifference = result.netUltimateLoss - netUltimateLossCheck;

  const netAccountingReserveCheck =
    result.expectedGrossUnpaidLoss - result.expectedReinsuranceRecoverable;

  const netAccountingReserveDifference =
    result.expectedNetUnpaidLoss - netAccountingReserveCheck;

  const indicatedNetReserveCheck =
    result.expectedNetUnpaidLoss * result.selectedFundingCLF;

  const indicatedNetReserveDifference =
    result.indicatedNetReserveAtConfidenceLevel - indicatedNetReserveCheck;

  const reserveRiskMarginCheck =
    result.expectedNetUnpaidLoss * (FUNDING_CLF_TABLE[0.90] - 1);

  const reserveRiskMarginDifference =
    result.reserveRiskMarginNeeded - reserveRiskMarginCheck;

  const grossIncurredLoss =
    result.grossPaidLosses +
    result.endingGrossReserve -
    result.beginningGrossReserve;

  const netIncurredLossFromIncome =
    result.grossPremium +
    result.assessments +
    result.investmentIncome -
    result.operatingExpense -
    result.riskControlInvestment -
    result.reinsuranceCost -
    result.dividends -
    result.netIncome;

  const impliedCededIncurredRecovery =
    grossIncurredLoss - netIncurredLossFromIncome;

  const netIncomeCheck =
    result.grossPremium +
    result.assessments +
    result.investmentIncome -
    netIncurredLossFromIncome -
    result.operatingExpense -
    result.riskControlInvestment -
    result.reinsuranceCost -
    result.dividends;

  const netIncomeDifference = result.netIncome - netIncomeCheck;

  const endingCashCheck =
    result.beginningCash +
    result.grossPremium +
    result.assessments -
    result.grossPaidLosses +
    impliedCededIncurredRecovery -
    result.operatingExpense -
    result.riskControlInvestment -
    result.reinsuranceCost -
    result.dividends -
    (result.endingReinsRecoverable - result.beginningReinsRecoverable);

  const endingInvestmentsCheck =
    result.beginningInvestments + result.investmentIncome;

  const totalAssetsCheck =
    result.endingCash +
    result.endingInvestments +
    result.endingReinsRecoverable +
    result.otherAssets;

  const totalAssetsDifference = result.totalAssets - totalAssetsCheck;

  const totalLiabilitiesCheck =
    result.expectedGrossUnpaidLoss +
    result.unearnedPremium +
    result.otherLiabilities;

  const totalLiabilitiesDifference =
    result.totalLiabilities - totalLiabilitiesCheck;

  const endingSurplusCheck =
    result.totalAssets - result.totalLiabilities;

  const endingSurplusDifference =
    result.endingSurplus - endingSurplusCheck;

  const surplusFromIncomeCheck =
    result.beginingSurplus + result.netIncome;

  const surplusFromIncomeDifference =
    result.surplusFromIncome - surplusFromIncomeCheck;

  const tieOutDifferenceCheck =
    result.endingSurplus - result.surplusFromIncome;

  const tieOutDifferenceDifference =
    result.surplusTieOutDifference - tieOutDifferenceCheck;

  const combinedRatioCheck =
    (netIncurredLossFromIncome + result.adminExpense + result.reinsuranceCost) /
    Math.max(result.totalMemberCharge, 1);

  const lossRatioCheck =
    netIncurredLossFromIncome / Math.max(result.totalMemberCharge, 1);

  const expenseRatioCheck =
    (result.adminExpense + result.reinsuranceCost) /
    Math.max(result.totalMemberCharge, 1);

  const capitalFundingGapCheck =
    result.availableSurplus - result.reserveRiskMarginNeeded;

  const capitalAdequacyRatioCheck = result.reserveRiskMarginNeeded > 0
    ? capitalFundingGapCheck / result.reserveRiskMarginNeeded
    : null;

  const exposureRows: AuditRow[] = [
    {
      metric: 'Active Members',
      value: String(result.activeMembers),
      formula: 'Count of members active at the end of the year.',
    },
    {
      metric: 'New Members',
      value: String(result.newMembers),
      formula: 'Count of members added during the year.',
    },
    {
      metric: 'Withdrawn Members',
      value: String(result.withdrawnMembers),
      formula: 'Count of members that left during the year.',
    },
    {
      metric: 'Written Payroll Exposure',
      value: `${result.writtenExposure.toFixed(2)}M`,
      formula: 'Active payroll exposure after member movement.',
    },
    {
      metric: 'Total Market Payroll Exposure',
      value: `${result.totalMarketExposure.toFixed(2)}M`,
      formula: 'Total payroll exposure in the full market.',
    },
    {
      metric: 'Market Share',
      value: formatPct(result.marketShare),
      formula: `${result.activeExposure.toFixed(2)}M / ${result.totalMarketExposure.toFixed(2)}M`,
    },
  ];

  const rateRows: AuditRow[] = [
    {
      metric: 'Pure Premium Rate per $100 Payroll',
      value: dollars(result.purePremiumPer100),
      formula: 'Prior expected loss rate adjusted by selected rate change, underwriting quality, and risk-control effect.',
    },
    {
      metric: 'Selected Funding Confidence',
      value: formatPct(result.selectedFundingConfidenceLevel, 0),
      formula: 'Player-selected confidence level.',
    },
    {
      metric: 'Selected CLF',
      value: result.selectedFundingCLF.toFixed(3),
      formula: 'CLF lookup from selected funding confidence level.',
    },
    {
      metric: `Pool Premium Rate at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}% CLF`,
      value: dollars(rateAtConfidenceLevel),
      formula: `${dollars(result.purePremiumPer100)} × ${result.selectedFundingCLF.toFixed(3)} × rate level adjustment`,
    },
    {
      metric: 'Gross Premium & Admin Expense Rate per $100',
      value: dollars(result.ratePer100),
      formula: 'Pool premium rate + admin rate + separately stated reinsurance rate.',
    },
    {
      metric: 'Payroll Units',
      value: payrollUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      formula: `${result.activeExposure.toFixed(2)}M payroll × 10,000`,
    },
    {
      metric: 'Gross Premium & Admin Expense',
      value: formatCurrency(result.totalMemberCharge),
      formula: `${result.activeExposure.toFixed(2)}M × ${dollars(result.ratePer100)} × 10,000`,
    },
    {
      metric: 'Gross Premium & Admin Expense Check Difference',
      value: formatCurrency(grossPremiumDifference),
      formula: 'Stored gross premium - recalculated gross premium.',
      note: nearZero(grossPremiumDifference),
    },
  ];

  const lossRows: AuditRow[] = [
    {
      metric: 'Pure Premium',
      value: formatCurrency(result.expectedLoss),
      formula: `${result.activeExposure.toFixed(2)}M × ${dollars(result.purePremiumPer100)} × 10,000`,
    },
    {
      metric: 'Expected Loss Check Difference',
      value: formatCurrency(expectedLossDifference),
      formula: 'Stored expected loss - recalculated expected loss.',
      note: nearZero(expectedLossDifference),
    },
    {
      metric: `Pool Premium at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}% CLF`,
      value: formatCurrency(result.clfAdjustedExpectedLoss),
      formula: `${formatCurrency(result.expectedLoss)} × ${result.selectedFundingCLF.toFixed(3)}`,
    },
    {
      metric: `Pool Premium at ${(result.selectedFundingConfidenceLevel * 100).toFixed(0)}% CLF Check Difference`,
      value: formatCurrency(clfAdjustedExpectedLossDifference),
      formula: 'Stored CLF-adjusted expected loss - recalculated value.',
      note: nearZero(clfAdjustedExpectedLossDifference),
    },
    {
      metric: 'Gross Ultimate Loss + LAE',
      value: formatCurrency(result.grossUltimateLoss),
      formula: 'Simulated annual gross ultimate loss including LAE.',
    },
    {
      metric: 'Reinsurance Recovery',
      value: formatCurrency(result.reinsuranceRecovery),
      formula: 'Recovery from selected reinsurance structure.',
    },
    {
      metric: 'Net Ultimate Loss + LAE',
      value: formatCurrency(result.netUltimateLoss),
      formula: 'Gross ultimate loss - reinsurance recovery.',
    },
    {
      metric: 'Net Ultimate Loss Check Difference',
      value: formatCurrency(netUltimateLossDifference),
      formula: 'Stored net ultimate loss - recalculated value.',
      note: nearZero(netUltimateLossDifference),
    },
    {
      metric: 'Reinsurance Cost',
      value: formatCurrency(result.reinsuranceCost),
      formula: 'Cost of selected reinsurance program.',
    },
  ];

  const reserveRows: AuditRow[] = [
    {
      metric: 'Beginning Gross Reserve',
      value: formatCurrency(result.beginningGrossReserve),
      formula: 'Prior unpaid gross reserve carried into the year.',
    },
    {
      metric: 'Current-Year Gross Reserve',
      value: formatCurrency(result.currentYearGrossReserve),
      formula: 'Current-year gross ultimate loss × unpaid percentage assumption.',
    },
    {
      metric: 'Gross Paid Losses',
      value: formatCurrency(result.grossPaidLosses),
      formula: 'Current-year paid losses + prior-year reserve cohort paydowns.',
    },
    {
      metric: 'Ending Gross Accounting Reserve',
      value: formatCurrency(result.endingGrossReserve),
      formula: 'Remaining unpaid gross reserve across all open cohorts.',
    },
    {
      metric: 'Beginning Reinsurance Recoverable',
      value: formatCurrency(result.beginningReinsRecoverable),
      formula: 'Prior reinsurance recoverable carried into the year.',
    },
    {
      metric: 'Ending Reinsurance Recoverable',
      value: formatCurrency(result.endingReinsRecoverable),
      formula: 'Remaining recoverable on unpaid losses.',
    },
    {
      metric: 'Expected Gross Unpaid Loss',
      value: formatCurrency(result.expectedGrossUnpaidLoss),
      formula: 'Same as ending gross accounting reserve.',
    },
    {
      metric: 'Expected Reinsurance Recoverable',
      value: formatCurrency(result.expectedReinsuranceRecoverable),
      formula: 'Same as ending reinsurance recoverable.',
    },
    {
      metric: 'Expected Net Unpaid Loss',
      value: formatCurrency(result.expectedNetUnpaidLoss),
      formula: 'Expected gross unpaid loss - expected reinsurance recoverable.',
    },
    {
      metric: 'Expected Net Unpaid Loss Check Difference',
      value: formatCurrency(netAccountingReserveDifference),
      formula: 'Stored expected net unpaid loss - recalculated value.',
      note: nearZero(netAccountingReserveDifference),
    },
    {
      metric: 'Gross Incurred Loss',
      value: formatCurrency(grossIncurredLoss),
      formula: 'Gross paid losses + ending gross reserve - beginning gross reserve.',
    },
    {
      metric: 'Net Incurred Loss',
      value: formatCurrency(netIncurredLossFromIncome),
      formula: 'Derived from income statement because detailed reinsurance received is not currently stored in ResultSet.',
    },
    {
      metric: 'Implied Ceded Incurred Recovery',
      value: formatCurrency(impliedCededIncurredRecovery),
      formula: 'Gross incurred loss - net incurred loss.',
    },
    {
      metric: 'Prior-Year Development',
      value: formatCurrency(result.priorYearDevelopment),
      formula: 'Reserve development display metric. Not added separately to net income because it is captured through incurred loss.',
    },
  ];

  const incomeRows: AuditRow[] = [
    {
      metric: 'Gross Premium & Admin Expense',
      value: formatCurrency(result.totalMemberCharge),
      formula: 'Pool premium + admin charge + reinsurance charge.',
    },
    {
      metric: 'Assessments',
      value: formatCurrency(result.assessments),
      formula: 'Gross premium × selected assessment percentage.',
    },
    {
      metric: 'Investment Income',
      value: formatCurrency(result.investmentIncome),
      formula: `${formatCurrency(result.investedAssets)} × ${formatPct(result.investmentReturnRate)}`,
    },
    {
      metric: 'Net Incurred Loss',
      value: formatCurrency(netIncurredLossFromIncome),
      formula: 'Gross incurred loss - ceded incurred recovery.',
    },
    {
      metric: 'Admin Expense',
      value: formatCurrency(result.adminExpense),
      formula: 'Pure Premium × 15%.',
    },
    {
      metric: 'Risk Control Investment',
      value: formatCurrency(result.riskControlInvestment),
      formula: 'Gross premium × selected risk-control percentage.',
    },
    {
      metric: 'Reinsurance Cost',
      value: formatCurrency(result.reinsuranceCost),
      formula: 'Selected reinsurance program cost.',
    },
    {
      metric: 'Dividends / Returned Pool Premium',
      value: formatCurrency(result.dividends),
      formula: 'Gross premium × selected dividend percentage.',
    },
    {
      metric: 'Net Income',
      value: formatCurrency(result.netIncome),
      formula:
        'Premium + assessments + investment income - net incurred loss - operating expense - risk control - reinsurance cost - dividends.',
    },
    {
      metric: 'Net Income Check Difference',
      value: formatCurrency(netIncomeDifference),
      formula: 'Stored net income - recalculated net income.',
      note: nearZero(netIncomeDifference),
    },
  ];

  const balanceRows: AuditRow[] = [
    {
      metric: 'Beginning Cash',
      value: formatCurrency(result.beginningCash),
      formula: 'Cash carried into the year.',
    },
    {
      metric: 'Ending Cash',
      value: formatCurrency(result.endingCash),
      formula:
        'Beginning cash + premium + assessments - paid losses + reinsurance received - expenses - reinsurance cost - dividends.',
    },
    {
      metric: 'Ending Cash Approximation Check',
      value: formatCurrency(result.endingCash - endingCashCheck),
      formula:
        'Stored ending cash - approximate recalculation. This may not be exact because detailed reinsurance received is not stored separately.',
      note: nearZero(result.endingCash - endingCashCheck),
    },
    {
      metric: 'Beginning Investments',
      value: formatCurrency(result.beginningInvestments),
      formula: 'Investments carried into the year.',
    },
    {
      metric: 'Ending Investments',
      value: formatCurrency(result.endingInvestments),
      formula: 'Beginning investments + investment income.',
    },
    {
      metric: 'Ending Investments Check Difference',
      value: formatCurrency(result.endingInvestments - endingInvestmentsCheck),
      formula: 'Stored ending investments - recalculated ending investments.',
      note: nearZero(result.endingInvestments - endingInvestmentsCheck),
    },
    {
      metric: 'Other Assets',
      value: formatCurrency(result.otherAssets),
      formula: 'Other assets carried from pool state.',
    },
    {
      metric: 'Total Assets',
      value: formatCurrency(result.totalAssets),
      formula: 'Ending cash + ending investments + reinsurance recoverable + other assets.',
    },
    {
      metric: 'Total Assets Check Difference',
      value: formatCurrency(totalAssetsDifference),
      formula: 'Stored total assets - recalculated total assets.',
      note: nearZero(totalAssetsDifference),
    },
    {
      metric: 'Unearned Premium',
      value: formatCurrency(result.unearnedPremium),
      formula: 'Current simplified model sets unearned premium to zero.',
    },
    {
      metric: 'Other Liabilities',
      value: formatCurrency(result.otherLiabilities),
      formula: 'Other liabilities carried from pool state.',
    },
    {
      metric: 'Total Liabilities',
      value: formatCurrency(result.totalLiabilities),
      formula: 'Expected gross unpaid loss + unearned premium + other liabilities.',
    },
    {
      metric: 'Total Liabilities Check Difference',
      value: formatCurrency(totalLiabilitiesDifference),
      formula: 'Stored total liabilities - recalculated total liabilities.',
      note: nearZero(totalLiabilitiesDifference),
    },
    {
      metric: 'Ending Surplus',
      value: formatCurrency(result.endingSurplus),
      formula: 'Total assets - total liabilities.',
    },
    {
      metric: 'Ending Surplus Check Difference',
      value: formatCurrency(endingSurplusDifference),
      formula: 'Stored ending surplus - recalculated ending surplus.',
      note: nearZero(endingSurplusDifference),
    },
    {
      metric: 'Surplus from Income',
      value: formatCurrency(result.surplusFromIncome),
      formula: 'Beginning surplus + net income.',
    },
    {
      metric: 'Surplus from Income Check Difference',
      value: formatCurrency(surplusFromIncomeDifference),
      formula: 'Stored surplus from income - recalculated value.',
      note: nearZero(surplusFromIncomeDifference),
    },
    {
      metric: 'Tie-Out Difference',
      value: formatCurrency(result.surplusTieOutDifference),
      formula: 'Ending surplus - surplus from income.',
    },
    {
      metric: 'Tie-Out Difference Check Difference',
      value: formatCurrency(tieOutDifferenceDifference),
      formula: 'Stored tie-out difference - recalculated tie-out difference.',
      note: nearZero(tieOutDifferenceDifference),
    },
  ];

  const ratioRows: AuditRow[] = [
    {
      metric: 'Expected Loss Ratio',
      value: formatPct(result.expectedLossRatio),
      formula: 'Expected pool loss / collected pool premium and admin expense.',
    },
    {
      metric: 'Expected Expense Ratio',
      value: formatPct(result.expectedExpenseRatio),
      formula: '1.0 - expected loss ratio.',
    },
    {
      metric: 'Expected Combined Ratio',
      value: formatPct(result.expectedCombinedRatio),
      formula: 'Expected loss ratio + expected expense ratio; designed to equal 100%.',
    },
    {
      metric: 'Actual Loss Ratio',
      value: formatPct(result.lossRatio),
      formula: 'Net incurred loss / gross premium.',
    },
    {
      metric: 'Loss Ratio Check Difference',
      value: formatPct(result.lossRatio - lossRatioCheck),
      formula: 'Stored loss ratio - recalculated loss ratio.',
      note: nearZero(result.lossRatio - lossRatioCheck, 0.0001),
    },
    {
      metric: 'Actual Expense Ratio',
      value: formatPct(result.expenseRatio),
      formula: '(Actual admin expense + reinsurance cost) / collected gross premium and admin expense.',
    },
    {
      metric: 'Expense Ratio Check Difference',
      value: formatPct(result.expenseRatio - expenseRatioCheck),
      formula: 'Stored expense ratio - recalculated expense ratio.',
      note: nearZero(result.expenseRatio - expenseRatioCheck, 0.0001),
    },
    {
      metric: 'Actual Combined Ratio',
      value: formatPct(result.combinedRatio),
      formula: 'Actual loss ratio + actual expense ratio.',
    },
    {
      metric: 'Combined Ratio Check Difference',
      value: formatPct(result.combinedRatio - combinedRatioCheck),
      formula: 'Stored combined ratio - recalculated combined ratio.',
      note: nearZero(result.combinedRatio - combinedRatioCheck, 0.0001),
    },
  ];

  const capitalRows: AuditRow[] = [
    {
      metric: 'Expected Net Unpaid Loss',
      value: formatCurrency(result.expectedNetUnpaidLoss),
      formula: 'Expected gross unpaid loss - expected reinsurance recoverable.',
    },
    {
      metric: 'Indicated Net Reserve at Confidence Level',
      value: formatCurrency(result.indicatedNetReserveAtConfidenceLevel),
      formula: `${formatCurrency(result.expectedNetUnpaidLoss)} × ${result.selectedFundingCLF.toFixed(3)}`,
    },
    {
      metric: 'Indicated Net Reserve Check Difference',
      value: formatCurrency(indicatedNetReserveDifference),
      formula: 'Stored indicated reserve - recalculated indicated reserve.',
      note: nearZero(indicatedNetReserveDifference),
    },
    {
      metric: 'Reserve Risk Margin Needed',
      value: formatCurrency(result.reserveRiskMarginNeeded),
      formula: 'Expected net unpaid loss × required reserve margin factor.',
    },
    {
      metric: 'Reserve Risk Margin Check Difference',
      value: formatCurrency(reserveRiskMarginDifference),
      formula: 'Stored reserve risk margin - recalculated reserve risk margin.',
      note: nearZero(reserveRiskMarginDifference),
    },
    {
      metric: 'Surplus',
      value: formatCurrency(result.availableSurplus),
      formula: 'Ending surplus.',
    },
    {
      metric: 'Excess Available Surplus',
      value: formatCurrency(result.capitalFundingGap),
      formula: 'Available surplus - reserve risk margin needed.',
    },
    {
      metric: 'Excess Available Surplus Check Difference',
      value: formatCurrency(result.capitalFundingGap - capitalFundingGapCheck),
      formula: 'Stored capital funding gap - recalculated capital funding gap.',
      note: nearZero(result.capitalFundingGap - capitalFundingGapCheck),
    },
    {
      metric: 'Excess Capital Ratio',
      value: result.excessCapitalRatio === null ? 'N/A' : formatPct(result.excessCapitalRatio),
      formula: 'Excess available surplus / required reserve margin.',
    },
    {
      metric: 'Excess Capital Ratio Check Difference',
      value: result.excessCapitalRatio === null || capitalAdequacyRatioCheck === null
        ? 'N/A'
        : (result.excessCapitalRatio - capitalAdequacyRatioCheck).toFixed(4),
      formula: 'Stored excess capital ratio - recalculated ratio.',
      note: result.excessCapitalRatio === null || capitalAdequacyRatioCheck === null
        ? 'No required margin; ratio is not applicable.'
        : nearZero(result.excessCapitalRatio - capitalAdequacyRatioCheck, 0.0001),
    },
    {
      metric: 'Excess Capital Status',
      value: result.capitalAdequacyStatus,
      formula: 'Status based on excess capital ratio thresholds.',
    },
  ];

  const assumptionRows: AuditRow[] = buildAssumptionRows();

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Calculation Audit</h2>
          <p className="text-gray-500 text-sm">
            Temporary debug page showing result values, formulas, calculation checks, and model assumptions.
          </p>
        </div>

        <select
          value={selectedYear}
          onChange={e => setSelectedYear(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {lockedResults.map(r => (
            <option key={r.yearNumber} value={r.yearNumber}>
              Year {r.yearNumber} / {r.calendarYear}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
        <div>
          <p className="font-bold text-amber-800">Temporary Debug Page</p>
          <p className="text-amber-700 text-sm">
            This page is intended for model review only. It should be removed or hidden before the final player version.
          </p>
        </div>
      </div>

      <AuditSection title="Exposure and Membership" icon={<TrendingUp size={16} />} rows={exposureRows} />
      <AuditSection title="Funding Rate Build-Up" icon={<Calculator size={16} />} rows={rateRows} />
      <AuditSection title="Losses and Reinsurance" icon={<Shield size={16} />} rows={lossRows} />
      <AuditSection title="Reserve Rollforward" icon={<ClipboardList size={16} />} rows={reserveRows} />
      <AuditSection title="Income Statement Calculation" icon={<DollarSign size={16} />} rows={incomeRows} />
      <AuditSection title="Balance Sheet and Surplus Tie-Out" icon={<DollarSign size={16} />} rows={balanceRows} />
      <AuditSection title="Ratios" icon={<Calculator size={16} />} rows={ratioRows} />
      <AuditSection title="Capital and Reserve Confidence" icon={<Shield size={16} />} rows={capitalRows} />
      <AuditSection title="Default Assumptions / Parameters" icon={<Settings size={16} />} rows={assumptionRows} />
    </div>
  );
}

function AuditSection({ title, icon, rows }: AuditSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-gray-600 w-1/4">Metric</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600 w-1/6">Value</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Formula / Source</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600 w-1/6">Check / Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.metric}-${index}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-3 font-medium text-gray-700 align-top">{row.metric}</td>
                <td className="px-5 py-3 font-mono text-right text-gray-900 align-top whitespace-pre-line">{row.value}</td>
                <td className="px-5 py-3 text-gray-600 align-top whitespace-pre-line">{row.formula}</td>
                <td className="px-5 py-3 text-gray-500 align-top whitespace-pre-line">{row.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildAssumptionRows(): AuditRow[] {
  const rows: AuditRow[] = [
    {
      metric: 'Admin Expense as % of Pure Premium',
      value: formatPct(ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM),
      formula: 'Pure Premium × 15%. Added after selected CLF and not multiplied by CLF.',
      note:
        'Higher values make it harder to generate underwriting income. This is separate from LAE, so avoid double counting claim adjustment expenses.',
    },
    {
      metric: 'Member Actual Loss Distribution',
      value: MEMBER_LOSS_VOLATILITY.distribution,
      formula: 'Expected member loss = payroll x Pure Premium Rate; actual loss is a nonnegative Gamma draw.',
      note: 'The Gamma mean equals expected loss. Risk quality changes standard deviation, not expected loss.',
    },
    {
      metric: 'Member Loss Coefficient of Variation',
      value: `${formatPct(MEMBER_LOSS_VOLATILITY.worstRiskCV)} to ${formatPct(MEMBER_LOSS_VOLATILITY.bestRiskCV)}`,
      formula: 'Linear interpolation from risk quality 1 (most volatile) to risk quality 10 (least volatile).',
      note: 'Standard deviation = expected member loss x coefficient of variation.',
    },
    {
      metric: 'Aggregate Annual Loss Distribution',
      value: AGGREGATE_LOSS_DISTRIBUTION.distribution,
      formula: `Log mean ${AGGREGATE_LOSS_DISTRIBUTION.logMean.toFixed(6)}; log sigma ${AGGREGATE_LOSS_DISTRIBUTION.logSigma.toFixed(6)}.`,
      note: 'A continuous shared annual factor calibrated to stock-decision gameplay affects all members. The CLF table remains the separate funding and pricing reference.',
    },
    {
      metric: 'Actual Loss Level Multiplier',
      value: AGGREGATE_LOSS_DISTRIBUTION.actualLossLevelMultiplier.toFixed(2),
      formula: 'Member Gamma loss x shared annual factor x actual loss level multiplier.',
      note: 'Raises the center of the actual-loss distribution so default decisions do not automatically produce large annual gains. Member risk-quality volatility is preserved.',
    },
    {
      metric: 'Catastrophe Classification Threshold',
      value: `${formatPct(AGGREGATE_LOSS_DISTRIBUTION.catastropheThresholdConfidence)} CLF`,
      formula: 'An annual shared factor above the selected CLF-table threshold is classified as a catastrophe for reporting.',
    },
    {
      metric: 'Loss Trend',
      value: formatPct(LOSS_TREND),
      formula: 'Default annual claim inflation assumption.',
      note:
        'Current engine applies trend to simulated actual losses, not to the displayed expected rate when the player selects 0% rate change.',
    },
    {
      metric: 'Base Retention',
      value: formatPct(BASE_RETENTION),
      formula: 'Base annual member retention probability before satisfaction, pricing, assessment, and financial strength adjustments.',
      note:
        'Public entity pools usually have high retention. If too high, membership becomes too stable; if too low, the pool churns unrealistically.',
    },
    {
      metric: 'Base New Members Per Year',
      value: BASE_NEW_MEMBERS_PER_YEAR.toFixed(2),
      formula: 'Expected new members in a neutral year before movement adjustments and hard caps.',
      note:
        'Keeps growth modest. This should prevent the game from adding too many members in a single year under normal conditions.',
    },
    {
      metric: 'Max New Members Per Year',
      value: String(MAX_NEW_MEMBERS_PER_YEAR),
      formula: 'Hard cap on new members added in one year.',
      note:
        'Important gameplay control. Prevents unrealistic sudden growth even if the pool is financially strong or competitively priced.',
    },
    {
      metric: 'Max Withdrawn Members Per Year',
      value: String(MAX_WITHDRAWN_PER_YEAR),
      formula: 'Hard cap on members withdrawn in one year.',
      note:
        'Prevents the pool from collapsing too quickly from a single bad year. If set too low, retention risk may feel muted.',
    },
    {
      metric: 'Reserve Paydown Percent',
      value: formatPct(RESERVE_PAYDOWN_PCT),
      formula: 'Percent of open reserve cohorts paid down each year.',
      note:
        'Controls reserve runoff speed. Higher paydown means claims close faster and cash paid losses are higher sooner.',
    },
    {
      metric: 'Total Market Members',
      value: String(TOTAL_MARKET_MEMBERS),
      formula: 'Total simulated market member count.',
      note:
        'Used to create the pool’s competitive universe. Does not mean all members are active in the player pool.',
    },
    {
      metric: 'Starting Member Range',
      value: `${STARTING_MEMBER_RANGE.min} to ${STARTING_MEMBER_RANGE.max}`,
      formula: 'Starting active member count range.',
      note:
        'Controls initial pool size. A larger starting pool is usually more stable because exposure is spread across more members.',
    },
    {
      metric: 'Starting Pool Exposure Range',
      value: `${STARTING_POOL_EXPOSURE.min}M to ${STARTING_POOL_EXPOSURE.max}M`,
      formula: 'Starting pool payroll exposure range.',
      note:
        'Payroll exposure is the rating base. This drives premium volume and expected loss volume.',
    },
    {
      metric: 'Total Market Exposure Range',
      value: `${TOTAL_MARKET_EXPOSURE.min}M to ${TOTAL_MARKET_EXPOSURE.max}M`,
      formula: 'Total market payroll exposure range.',
      note:
        'Used to calculate market share. If total market exposure is too small, the starting pool may appear to have unrealistic market share.',
    },
    {
      metric: 'Starting Rate per $100 Range',
      value: `${dollars(STARTING_RATE_PER_100.min)} to ${dollars(STARTING_RATE_PER_100.max)}`,
      formula: 'Starting expected loss rate / rate base range before annual player decisions.',
      note:
        'A wider range creates more varied game starts. A narrower range makes testing easier and improves consistency across seeds.',
    },
    {
      metric: 'Size Weights',
      value: SIZE_WEIGHTS.map((w, i) => `${sizeLabel(i)}: ${formatPct(w)}`).join('\n'),
      formula: 'Probability weights used when assigning market member size categories.',
      note:
        'Controls the mix of small, medium, large, and very large entities. More large members can create concentration risk.',
    },
    {
      metric: 'Exposure Ranges',
      value: Object.entries(EXPOSURE_RANGES)
        .map(([k, v]) => `${k}: ${v.min}M to ${v.max}M`)
        .join('\n'),
      formula: 'Payroll exposure range by member size category.',
      note:
        'Used to generate member payroll exposure. This directly affects premium, expected losses, and market share.',
    },
    {
      metric: 'Risk Control Parameters',
      value:
        `Max Effectiveness: ${formatPct(RISK_CONTROL_PARAMS.maxEffectiveness)}\n` +
        `Lag Years: ${RISK_CONTROL_PARAMS.lagYears}\n` +
        `Decay Rate: ${formatPct(RISK_CONTROL_PARAMS.decayRate)}`,
      formula: 'Risk-control investment gradually reduces expected losses, subject to max effectiveness and decay.',
      note:
        'Creates a delayed payoff. This should reward sustained investment, not one-year spending. Watch for it becoming too powerful over time.',
    },
    {
      metric: 'Funding CLF Table',
      value: Object.entries(FUNDING_CLF_TABLE)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([confidence, clf]) => `${formatPct(Number(confidence), 0)}: ${Number(clf).toFixed(3)}`)
        .join('\n'),
      formula: 'Confidence level factor used to convert expected loss rate into selected confidence-level contribution rate.',
      note:
        'Higher confidence levels produce materially higher contribution rates. This is a pricing/funding target, not the booked accounting reserve.',
    },
    {
      metric: 'Investment Risk Assumptions',
      value: INVESTMENT_RISK_PARAMS.baseReturnByLevel
        .map((base, i) => {
          const vol = INVESTMENT_RISK_PARAMS.volatilityByLevel[i];
          const shock = INVESTMENT_RISK_PARAMS.downsideShockProbByLevel[i];
          return `Risk ${i}: Return ${formatPct(base)}, Vol ${formatPct(vol)}, Shock ${formatPct(shock)}`;
        })
        .join('\n'),
      formula: 'Default investment assumptions by risk level.',
      note:
        'Investment income should be secondary to underwriting results. If surplus grows too easily in bad underwriting years, review these assumptions first.',
    },
    {
      metric: 'Reinsurance Programs',
      value: REINSURANCE_PROGRAMS.map(program =>
        `Level ${program.level} - ${program.label}: ` +
        `Attach ${program.attachmentMultiplierOfExpectedLoss.toFixed(2)}x expected loss, ` +
        `Quota Share ${formatPct(program.recoveryPct)} (uncapped), ` +
        `Cost ${formatPct(program.costPctOfPremiumMin)} to ${formatPct(program.costPctOfPremiumMax)}`
      ).join('\n'),
      formula: 'Default reinsurance program structure by selected level.',
      note:
        'Higher levels should reduce severe loss volatility but cost more. If reinsurance almost never pays, players will avoid it; if it pays too often, it may be too valuable.',
    },
    {
      metric: 'Member Retention Weights',
      value: Object.entries(MEMBER_MOVEMENT_WEIGHTS.retention)
        .map(([k, v]) => `${labelize(k)}: ${formatPct(v)}`)
        .join('\n'),
      formula: 'Weights used in member retention scoring.',
      note:
        'Controls why existing members stay or leave. Rate increases, assessments, satisfaction, and financial strength all affect retention.',
    },
    {
      metric: 'Member Attraction Weights',
      value: Object.entries(MEMBER_MOVEMENT_WEIGHTS.attraction)
        .map(([k, v]) => `${labelize(k)}: ${formatPct(v)}`)
        .join('\n'),
      formula: 'Weights used in new member attraction scoring.',
      note:
        'Controls why new members join. If growth is too easy, reduce attraction weights or lower max new members per year.',
    },
    {
      metric: 'Starting Financial Ranges',
      value:
        `Annual Premium: ${formatRangeCurrency(STARTING_FINANCIALS.annualPremium)}\n` +
        `Expected Loss Ratio: ${formatRangePct(STARTING_FINANCIALS.expectedLossRatio)}\n` +
        `Member Satisfaction: ${formatRangeNumber(STARTING_FINANCIALS.memberSatisfaction)}\n` +
        `Risk Quality: ${formatRangeNumber(STARTING_FINANCIALS.riskQuality)}\n` +
        `Surplus to Premium Ratio: ${formatRangePct(STARTING_FINANCIALS.surplusToPremiumRatio)}\n` +
        `Cash: ${formatRangeCurrency(STARTING_FINANCIALS.cash)}\n` +
        `Investments: ${formatRangeCurrency(STARTING_FINANCIALS.investments)}\n` +
        `Reinsurance Recoverable: ${formatRangeCurrency(STARTING_FINANCIALS.reinsuranceRecoverable)}\n` +
        `Other Assets: ${formatRangeCurrency(STARTING_FINANCIALS.otherAssets)}\n` +
        `Gross Unpaid Reserve: ${formatRangeCurrency(STARTING_FINANCIALS.grossUnpaidReserve)}\n` +
        `Unearned Premium %: ${formatRangePct(STARTING_FINANCIALS.unearnedPremiumPct)}\n` +
        `Other Liabilities: ${formatRangeCurrency(STARTING_FINANCIALS.otherLiabilities)}\n` +
        `Starting Surplus: ${formatRangeCurrency(STARTING_FINANCIALS.startingSurplus)}`,
      formula: 'Starting financial assumption ranges used by instance generation.',
      note:
        'These shape initial difficulty. High surplus and investments make the game more forgiving; low surplus creates more pressure from losses and reserve risk.',
    },
    {
      metric: 'Slider Ranges',
      value:
        `Rate Change: ${formatSliderPct(SLIDER_RANGES.rateChange)}\n` +
        `Funding Confidence Level: ${formatSliderPct(SLIDER_RANGES.fundingConfidenceLevel)}\n` +
        `Dividend %: ${formatSliderPct(SLIDER_RANGES.dividendPct)}\n` +
        `Assessment %: ${formatSliderPct(SLIDER_RANGES.assessmentPct)}\n` +
        `Underwriting Strictness: ${formatSliderNumber(SLIDER_RANGES.underwritingStrictness)}\n` +
        `Risk Control %: ${formatSliderPct(SLIDER_RANGES.riskControlPct)}\n` +
        `Reinsurance Level: ${formatSliderNumber(SLIDER_RANGES.reinsuranceLevel)}\n` +
        `Investment Risk: ${formatSliderNumber(SLIDER_RANGES.investmentRisk)}`,
      formula: 'Player decision slider configuration.',
      note:
        'Defines the choices available to the player. Wide ranges increase strategic flexibility but can make results harder to balance.',
    },
  ];

  return rows;
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

function nearZero(value: number, threshold = 1): string {
  return Math.abs(value) <= threshold ? 'OK' : 'Review';
}

function sizeLabel(index: number): string {
  if (index === 0) return 'Small';
  if (index === 1) return 'Medium';
  if (index === 2) return 'Large';
  if (index === 3) return 'Very Large';
  return `Index ${index}`;
}

function labelize(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, char => char.toUpperCase());
}

function formatRangeCurrency(range: { min: number; max: number }): string {
  return `${formatCurrency(range.min)} to ${formatCurrency(range.max)}`;
}

function formatRangePct(range: { min: number; max: number }): string {
  return `${formatPct(range.min)} to ${formatPct(range.max)}`;
}

function formatRangeNumber(range: { min: number; max: number }): string {
  return `${range.min} to ${range.max}`;
}

function formatSliderPct(range: { min: number; max: number; step: number; default: number }): string {
  return `Min ${formatPct(range.min)}, Max ${formatPct(range.max)}, Step ${formatPct(range.step)}, Default ${formatPct(range.default)}`;
}

function formatSliderNumber(range: { min: number; max: number; step: number; default: number }): string {
  return `Min ${range.min}, Max ${range.max}, Step ${range.step}, Default ${range.default}`;
}
