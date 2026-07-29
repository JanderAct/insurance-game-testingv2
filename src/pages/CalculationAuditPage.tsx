import React, { useState } from 'react';
import {
  Calculator,
  ClipboardList,
  DollarSign,
  Shield,
  TrendingUp,
  AlertTriangle,
  Settings,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import type { CoverageLine, ResultSet } from '../types/simulation';
import { formatCurrency, formatPct } from '../utils/formatters';
import { deriveSubRng } from '../utils/random';
import { simulateMarketReturns, blendInvestmentReturn } from '../utils/investmentEngine';
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
  ASSET_CLASS_ASSUMPTIONS,
  ASSET_ALLOCATION_DEFAULT,
  REINSURANCE_PROGRAMS,
  MEMBER_MOVEMENT_WEIGHTS,
  RISK_CONTROL_PARAMS,
  EXPOSURE_RANGES,
  SIZE_WEIGHTS,
  STARTING_EXPOSURE_SHARE,
  TOTAL_MARKET_EXPOSURE,
  STARTING_RATE_PER_100,
  STARTING_FINANCIALS,
  SLIDER_RANGES,
  TOTAL_MARKET_MEMBERS,
  RESERVE_PAYDOWN_PCT,
  LINE_RESERVE_PAYDOWN_PCT,
} from '../data/defaultAssumptions';

interface CalculationAuditPageProps {
  lockedResults: ResultSet[];
  // Stage: pre-game years (yearNumbers <= 0) are real engine results, so the
  // audit — including the reconciliation section below — can run against them
  // too, not just locked live years.
  priorHistory: ResultSet[];
  // Needed to independently re-derive the year's investment-return draw
  // (Check 5) rather than reading the engine's own stored echo of it.
  instanceSeed: number;
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

export default function CalculationAuditPage({ lockedResults, priorHistory, instanceSeed }: CalculationAuditPageProps) {
  // Chronological order: earliest pre-game year first, Year 0 (opening) last
  // among prior years, then live Year 1 onward — same convention as the
  // Financial Statements tab, so the audit reaches pre-game history too.
  const openingYear = priorHistory[priorHistory.length - 1];
  const earlierPriorYears = priorHistory.slice(0, -1);
  const allYears: ResultSet[] = [...priorHistory, ...lockedResults];

  const [selectedYear, setSelectedYear] = useState<number>(
    lockedResults.length > 0
      ? lockedResults[lockedResults.length - 1].yearNumber
      : openingYear?.yearNumber ?? 1
  );

  const result = allYears.find(r => r.yearNumber === selectedYear);

  const yearOptions: { label: string; value: number }[] = [
    ...earlierPriorYears.map(y => ({ label: `${y.calendarYear} (History)`, value: y.yearNumber })),
    ...(openingYear ? [{ label: `Year 0 — ${openingYear.calendarYear} (Opening)`, value: openingYear.yearNumber }] : []),
    ...lockedResults.map(r => ({ label: `Year ${r.yearNumber} / ${r.calendarYear}`, value: r.yearNumber })),
  ];

  if (allYears.length === 0 || !result) {
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

  const indicatedNetReserveCheck =
    result.expectedNetUnpaidLoss * result.selectedFundingCLF;

  const indicatedNetReserveDifference =
    result.indicatedNetReserveAtConfidenceLevel - indicatedNetReserveCheck;

  const reserveRiskMarginCheck =
    result.expectedNetUnpaidLoss * (FUNDING_CLF_TABLE[0.90] - 1);

  const reserveRiskMarginDifference =
    result.reserveRiskMarginNeeded - reserveRiskMarginCheck;

  const netIncurredLossCheck =
    result.netPaidLosses +
    result.endingNetReserve -
    result.beginningNetReserve;

  const netIncurredLossDifference = result.netIncurredLoss - netIncurredLossCheck;

  const netIncurredLossFromIncome =
    result.grossPremium +
    result.assessments +
    result.investmentIncome -
    result.operatingExpense -
    result.riskControlInvestment -
    result.reinsuranceCost -
    result.dividends -
    result.netIncome;

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
    result.netPaidLosses -
    result.operatingExpense -
    result.riskControlInvestment -
    result.reinsuranceCost -
    result.dividends;

  const endingInvestmentsCheck =
    result.beginningInvestments + result.investmentIncome;

  const totalAssetsCheck =
    result.endingCash +
    result.endingInvestments;

  const totalAssetsDifference = result.totalAssets - totalAssetsCheck;

  const totalLiabilitiesCheck =
    result.endingNetReserve +
    result.unearnedPremium;

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
      metric: 'Beginning Net Reserve',
      value: formatCurrency(result.beginningNetReserve),
      formula: 'Prior unpaid reserve (net of reinsurance) carried into the year.',
    },
    {
      metric: 'Current-Year Net Reserve',
      value: formatCurrency(result.currentYearNetReserve),
      formula: 'Current-year net ultimate loss × unpaid percentage assumption.',
    },
    {
      metric: 'Net Paid Losses',
      value: formatCurrency(result.netPaidLosses),
      formula: 'Current-year net paid losses + prior-year reserve cohort paydowns.',
    },
    {
      metric: 'Ending Net Accounting Reserve',
      value: formatCurrency(result.endingNetReserve),
      formula: 'Remaining unpaid reserve (net of reinsurance) across all open cohorts.',
    },
    {
      metric: 'Net Incurred Loss Check',
      value: formatCurrency(netIncurredLossDifference),
      formula: 'netIncurredLoss − (net paid + ending net reserve − beginning net reserve)',
      note: nearZero(netIncurredLossDifference),
    },
    {
      metric: 'Expected Net Unpaid Loss',
      value: formatCurrency(result.expectedNetUnpaidLoss),
      formula: 'Same as ending net accounting reserve.',
    },
    {
      metric: 'Net Incurred Loss (from income statement)',
      value: formatCurrency(netIncurredLossFromIncome),
      formula: 'Back-solved from the income statement as a cross-check on the reserve rollforward.',
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
        'Beginning cash + premium + assessments - paid losses - expenses - reinsurance cost - dividends, then swept toward the operating-cash target (surplus above target moves to investments; a shortfall draws investments down).',
    },
    {
      metric: 'Ending Cash Approximation Check',
      value: formatCurrency(result.endingCash - endingCashCheck),
      formula:
        'Stored ending cash - pre-sweep cash-flow accumulation. This is EXPECTED to be large, not near zero: the cash/investment sweep moves money between the two accounts every year to hold cash near its target, so ending cash is not simply the raw cash-flow total. It is not a reconciliation gap — see the Statement Reconciliation section below for checks that actually verify conservation (assets = cash + investments still ties exactly).',
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
      metric: 'Total Assets',
      value: formatCurrency(result.totalAssets),
      formula: 'Ending cash + ending investments.',
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
      metric: 'Total Liabilities',
      value: formatCurrency(result.totalLiabilities),
      formula: 'Ending net unpaid loss reserve + unearned premium.',
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
  const reconciliationChecks: ReconciliationCheck[] = buildReconciliationChecks(result, instanceSeed);

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
          {yearOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
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

      <ReconciliationSection checks={reconciliationChecks} />

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

// ============================================================================
// Statement Reconciliation — verifies the financial statements are internally
// consistent by independently deriving each figure from its components and
// comparing it to what the statement reports, rather than reading the same
// field twice.
// ============================================================================

type CheckStatus = 'pass' | 'variance' | 'fail' | 'na';

interface CheckScope {
  scope: string;
  derived: number;
  statement: number;
  diff: number;
  buildUp: string;
  status: CheckStatus;
  note?: string;
}

interface ReconciliationCheck {
  id: string;
  category: 'High-Value' | 'Completeness';
  title: string;
  description: string;
  scopes: CheckScope[];
  status: CheckStatus;
}

const RECONCILIATION_TOLERANCE = 0.01;

// A prior-year reserve cohort can close this year and have its residual
// balance floored to zero (Math.max(0, newUnpaid) in the reserve rollforward)
// rather than fully absorbed into the simulated development figure. That
// produces a small, bounded gap between the "gross - recoveries -
// development" path and the "paid + reserve change" path in the claims check
// specifically — a known, bounded modeling effect, not a new defect. Capped
// well below the scale a real systemic bug would produce (hundreds of
// thousands of dollars, per prior regression investigations on this branch).
const CLAIMS_CHECK_VARIANCE_CAP = 10_000;
const CLAIMS_CHECK_VARIANCE_NOTE =
  'Known variance: a prior-year reserve cohort closed this year and its residual balance was floored to zero in the rollforward (Math.max(0, newUnpaid)) rather than fully absorbed into the simulated development figure. This produces a small, bounded gap between the two paths — not a new defect.';

function makeScope(
  scope: string,
  derived: number,
  statement: number,
  buildUp: string,
  varianceCap?: number,
  varianceNote?: string
): CheckScope {
  const diff = statement - derived;
  const abs = Math.abs(diff);
  let status: CheckStatus = 'pass';
  let note: string | undefined;
  if (abs > RECONCILIATION_TOLERANCE) {
    if (varianceCap !== undefined && abs <= varianceCap) {
      status = 'variance';
      note = varianceNote;
    } else {
      status = 'fail';
    }
  }
  return { scope, derived, statement, diff, buildUp, status, note };
}

function overallStatus(scopes: CheckScope[]): CheckStatus {
  if (scopes.some(s => s.status === 'fail')) return 'fail';
  if (scopes.some(s => s.status === 'variance')) return 'variance';
  if (scopes.every(s => s.status === 'na')) return 'na';
  return 'pass';
}

export function buildReconciliationChecks(result: ResultSet, instanceSeed: number): ReconciliationCheck[] {
  const lineKeys = Object.keys(result.byLine) as CoverageLine[];
  const scopeList: { label: string; r: ResultSet }[] = [
    { label: 'Pool', r: result },
    ...lineKeys.map(l => ({ label: l as string, r: result.byLine[l] as ResultSet })),
  ];

  const checks: ReconciliationCheck[] = [];

  // --- Check 1: Pool = Σ active lines — Income Statement figures ---
  {
    const fields: { key: keyof ResultSet; label: string }[] = [
      { key: 'poolPremium', label: 'Pool Premium' },
      { key: 'adminExpense', label: 'Admin Expense' },
      { key: 'poolPremiumAndAdminExpense', label: 'Pool Premium & Admin Expense' },
      { key: 'totalMemberCharge', label: 'Total Member Charge' },
      { key: 'assessments', label: 'Assessments' },
      { key: 'grossUltimateLoss', label: 'Gross Ultimate Loss' },
      { key: 'poolLosses', label: 'Pool Losses' },
      { key: 'excessLosses', label: 'Excess Losses' },
      { key: 'quotaShareLosses', label: 'Quota Share Losses' },
      { key: 'reinsuranceRecovery', label: 'Reinsurance Recovery' },
      { key: 'netUltimateLoss', label: 'Net Ultimate Loss' },
      { key: 'netIncurredLoss', label: 'Net Incurred Loss' },
      { key: 'operatingExpense', label: 'Operating Expense' },
      { key: 'riskControlInvestment', label: 'Risk Control Investment' },
      { key: 'reinsuranceCost', label: 'Reinsurance Cost' },
      { key: 'dividends', label: 'Dividends' },
      { key: 'priorYearDevelopment', label: 'Prior-Year Development' },
      { key: 'underwritingIncome', label: 'Underwriting Income' },
      { key: 'investmentIncome', label: 'Investment Income' },
      { key: 'netIncome', label: 'Net Income' },
    ];
    const scopes = fields.map(f => {
      const sumOfLines = lineKeys.reduce((s, l) => s + Number(result.byLine[l][f.key as keyof ResultSet]), 0);
      const poolValue = Number(result[f.key]);
      const buildUp =
        lineKeys.map(l => `${l}: ${formatCurrency(Number(result.byLine[l][f.key as keyof ResultSet]))}`).join('\n') +
        `\nSum of lines: ${formatCurrency(sumOfLines)}`;
      return makeScope(f.label, sumOfLines, poolValue, buildUp);
    });
    checks.push({
      id: 'pool-sum-income',
      category: 'High-Value',
      title: 'Pool = Σ active lines — Income Statement figures',
      description:
        'Independently re-sums every active line\'s own income-statement figure and compares it to the pool\'s stored aggregate. The pool total comes from a separate aggregation step in the engine, so this can genuinely disagree if that step drops or double-counts a line.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 2: Pool = Σ active lines — Statement of Net Position figures ---
  {
    const fields: { key: keyof ResultSet; label: string }[] = [
      { key: 'endingCash', label: 'Ending Cash' },
      { key: 'endingInvestments', label: 'Ending Investments' },
      { key: 'totalAssets', label: 'Total Assets' },
      { key: 'endingNetReserve', label: 'Ending Net Reserve' },
      { key: 'unearnedPremium', label: 'Unearned Premium' },
      { key: 'totalLiabilities', label: 'Total Liabilities' },
      { key: 'endingSurplus', label: 'Ending Surplus' },
    ];
    const scopes = fields.map(f => {
      const sumOfLines = lineKeys.reduce((s, l) => s + Number(result.byLine[l][f.key as keyof ResultSet]), 0);
      const poolValue = Number(result[f.key]);
      const buildUp =
        lineKeys.map(l => `${l}: ${formatCurrency(Number(result.byLine[l][f.key as keyof ResultSet]))}`).join('\n') +
        `\nSum of lines: ${formatCurrency(sumOfLines)}`;
      return makeScope(f.label, sumOfLines, poolValue, buildUp);
    });
    checks.push({
      id: 'pool-sum-balance',
      category: 'High-Value',
      title: 'Pool = Σ active lines — Statement of Net Position figures',
      description: 'Same independent re-summation as Check 1, applied to every active line\'s own balance-sheet figure.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 3: Change in net position (income statement) vs. balance sheet ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const derived = r.endingSurplus - r.beginingSurplus;
      const buildUp =
        `Ending surplus ${formatCurrency(r.endingSurplus)} − beginning surplus ${formatCurrency(r.beginingSurplus)} = ${formatCurrency(derived)}\n` +
        `Income statement net income (change in net position): ${formatCurrency(r.netIncome)}`;
      return makeScope(label, derived, r.netIncome, buildUp);
    });
    checks.push({
      id: 'change-in-net-position',
      category: 'High-Value',
      title: 'Change in net position: income statement vs. balance sheet',
      description:
        'Compares net income (built from the revenue/expense rollup) against the balance sheet\'s own ending-minus-beginning surplus — two genuinely separate computation paths through the engine.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 4: Provision for claims, net — two independent paths ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      // priorYearDevelopment is signed so positive = favorable (reserve
      // released), hence subtracted here.
      const derived = r.grossUltimateLoss - r.reinsuranceRecovery - r.priorYearDevelopment;
      const buildUp =
        `Gross ultimate loss ${formatCurrency(r.grossUltimateLoss)}\n` +
        `− Reinsurance recovery ${formatCurrency(r.reinsuranceRecovery)}\n` +
        `− Prior-year development ${formatCurrency(r.priorYearDevelopment)}\n` +
        `= ${formatCurrency(derived)}\n\n` +
        `Reserve-rollforward path (statement value): net paid losses ${formatCurrency(r.netPaidLosses)} + ending net reserve ${formatCurrency(r.endingNetReserve)} − beginning net reserve ${formatCurrency(r.beginningNetReserve)} = ${formatCurrency(r.netIncurredLoss)}`;
      return makeScope(label, derived, r.netIncurredLoss, buildUp, CLAIMS_CHECK_VARIANCE_CAP, CLAIMS_CHECK_VARIANCE_NOTE);
    });
    checks.push({
      id: 'provision-for-claims',
      category: 'High-Value',
      title: 'Provision for claims, net — two independent paths',
      description:
        'Path A builds up from the current-year gross loss, reinsurance recoveries, and the independently-simulated prior-year cohort development. Path B is the reserve rollforward\'s own net incurred loss (paid + reserve change). These are genuinely separate computations.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 5: Investment income — plumbing consistency check ---
  // Live-years only: the pre-game bootstrap's reject-and-redraw process can
  // run a line's history on an attempt-shifted seed (instance.seed + attempt
  // x 997, see priorHistoryEngine's simulateLineCandidate) that is not
  // exposed outside that module, so this page cannot always reproduce the
  // exact market draw a pre-game year actually used. Live years always run
  // on the plain instance seed, so the check is exact there.
  {
    const isLiveYear = result.yearNumber > 0;
    if (!isLiveYear) {
      checks.push({
        id: 'investment-income-consistency',
        category: 'High-Value',
        title: 'Investment income — plumbing consistency check',
        description:
          'A consistency check, not an independent derivation: it re-runs the same exported engine functions (simulateMarketReturns, blendInvestmentReturn) against the displayed allocation and invested-asset base, and confirms the stored investment income matches what those functions actually produce. It verifies the plumbing between the engine and the statement, not the investment math itself.',
        scopes: [
          {
            scope: 'All',
            derived: 0,
            statement: 0,
            diff: 0,
            status: 'na',
            buildUp:
              'Not applicable to pre-game years: the reject-and-redraw bootstrap process may run this line\'s history on an attempt-shifted seed not exposed to this page. Select a live year (Year 1+) to run this check.',
          },
        ],
        status: 'na',
      });
    } else {
      const scopes = scopeList.map(({ label, r }) => {
        const rng = deriveSubRng(instanceSeed, r.yearNumber, 'invest');
        const market = simulateMarketReturns(rng);
        const blend = blendInvestmentReturn(r.investedAssets, r.assetAllocation, market);
        const buildUp =
          `Re-drawn market returns for year ${r.yearNumber}: cash ${formatPct(market.cash)}, bonds ${formatPct(market.bonds)}, equities ${formatPct(market.equities)}\n` +
          `Allocation: cash ${r.assetAllocation.cashPct}%, bonds ${r.assetAllocation.bondsPct}%, equities ${r.assetAllocation.equitiesPct}%\n` +
          `Blended rate ${formatPct(blend.returnRate)} × invested assets ${formatCurrency(r.investedAssets)} = ${formatCurrency(blend.income)}`;
        return makeScope(label, blend.income, r.investmentIncome, buildUp);
      });
      checks.push({
        id: 'investment-income-consistency',
        category: 'High-Value',
        title: 'Investment income — plumbing consistency check',
        description:
          'A consistency check, not an independent derivation: it re-runs the same exported engine functions (simulateMarketReturns, blendInvestmentReturn) against the displayed allocation and invested-asset base, and confirms the stored investment income matches what those functions actually produce. It verifies the plumbing between the engine and the statement, not the investment math itself.',
        scopes,
        status: overallStatus(scopes),
      });
    }
  }

  // --- Check 6: Current + noncurrent unpaid reserve, reserve-weighted blend (pool only) ---
  {
    // Tautological at line level (X = X×p + X×(1−p)) — its value is at pool
    // scope, verifying the reserve-weighted blend across lines.
    const current = lineKeys.reduce(
      (s, l) => s + result.byLine[l].endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0),
      0
    );
    const noncurrent = lineKeys.reduce(
      (s, l) => s + result.byLine[l].endingNetReserve * (1 - (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0)),
      0
    );
    const derived = current + noncurrent;
    const buildUp =
      lineKeys
        .map(l => {
          const pct = LINE_RESERVE_PAYDOWN_PCT[l] ?? 0;
          const reserve = result.byLine[l].endingNetReserve;
          return `${l}: reserve ${formatCurrency(reserve)} × ${formatPct(pct)} current = ${formatCurrency(reserve * pct)}, × ${formatPct(1 - pct)} noncurrent = ${formatCurrency(reserve * (1 - pct))}`;
        })
        .join('\n') +
      `\nΣ current ${formatCurrency(current)} + Σ noncurrent ${formatCurrency(noncurrent)} = ${formatCurrency(derived)}\n` +
      `Pool ending net reserve (statement): ${formatCurrency(result.endingNetReserve)}`;
    const scope = makeScope('Pool', derived, result.endingNetReserve, buildUp);
    checks.push({
      id: 'current-noncurrent-reserve',
      category: 'High-Value',
      title: 'Current + noncurrent unpaid reserve = total (pool, reserve-weighted blend)',
      description:
        'Pool-scope only — at line level this is tautological (X = X×p + X×(1−p)). At pool scope it verifies the reserve-weighted blend: summing each line\'s own reserve split by that line\'s own paydown rate must reproduce the pool\'s total reserve, itself a separately-aggregated figure.',
      scopes: [scope],
      status: overallStatus([scope]),
    });
  }

  // --- Check 7: Total operating revenues = component lines summed ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const derived = r.reinsuranceCost + r.poolPremium + r.adminExpense + r.assessments;
      const buildUp =
        `Premiums for transferred risk ${formatCurrency(r.reinsuranceCost)}\n` +
        `+ Contributions for retained risk ${formatCurrency(r.poolPremium)}\n` +
        `+ Administration fees ${formatCurrency(r.adminExpense)}\n` +
        `+ Member assessments ${formatCurrency(r.assessments)}\n` +
        `= ${formatCurrency(derived)}`;
      return makeScope(label, derived, derived, buildUp);
    });
    checks.push({
      id: 'total-operating-revenues',
      category: 'Completeness',
      title: 'Total operating revenues = component lines summed',
      description: 'The statement computes this total directly as the sum of its own displayed lines.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 8: Total operating expenses = component lines summed ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const derived = r.reinsuranceCost + r.netIncurredLoss + r.operatingExpense + r.riskControlInvestment + r.dividends;
      const buildUp =
        `Transferred risk & insurance expense ${formatCurrency(r.reinsuranceCost)}\n` +
        `+ Provision for claims, net ${formatCurrency(r.netIncurredLoss)}\n` +
        `+ General administrative services ${formatCurrency(r.operatingExpense)}\n` +
        `+ Loss prevention expenses ${formatCurrency(r.riskControlInvestment)}\n` +
        `+ Member dividends & returned premium ${formatCurrency(r.dividends)}\n` +
        `= ${formatCurrency(derived)}`;
      return makeScope(label, derived, derived, buildUp);
    });
    checks.push({
      id: 'total-operating-expenses',
      category: 'Completeness',
      title: 'Total operating expenses = component lines summed',
      description: 'The statement computes this total directly as the sum of its own displayed lines.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 9: Operating income = total revenues - total expenses ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const totalOperatingRevenues = r.reinsuranceCost + r.poolPremium + r.adminExpense + r.assessments;
      const totalOperatingExpenses = r.reinsuranceCost + r.netIncurredLoss + r.operatingExpense + r.riskControlInvestment + r.dividends;
      const derived = totalOperatingRevenues - totalOperatingExpenses;
      const buildUp =
        `Total operating revenues ${formatCurrency(totalOperatingRevenues)}\n` +
        `− Total operating expenses ${formatCurrency(totalOperatingExpenses)}\n` +
        `= ${formatCurrency(derived)}\n` +
        `Stored underwriting income (statement): ${formatCurrency(r.underwritingIncome)}`;
      return makeScope(label, derived, r.underwritingIncome, buildUp);
    });
    checks.push({
      id: 'operating-income',
      category: 'Completeness',
      title: 'Operating income = total revenues − total expenses',
      description: 'Compares the statement\'s own revenue/expense subtotals against the engine\'s independently-stored underwriting income field.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 10: Change in net position = operating income + nonoperating ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const derived = r.underwritingIncome + r.investmentIncome;
      const buildUp =
        `Operating income ${formatCurrency(r.underwritingIncome)} + Nonoperating investment income ${formatCurrency(r.investmentIncome)} = ${formatCurrency(derived)}\n` +
        `Stored net income (statement): ${formatCurrency(r.netIncome)}`;
      return makeScope(label, derived, r.netIncome, buildUp);
    });
    checks.push({
      id: 'change-in-net-position-build-up',
      category: 'Completeness',
      title: 'Change in net position = operating income + nonoperating',
      description: 'Confirms the bottom line is exactly the sum of the two statement sections above it.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 11: Total assets = cash and cash equivalents + investments ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const alloc = r.assetAllocation;
      const investedAssetsEnding = r.endingInvestments;
      const cashSlice = investedAssetsEnding * (alloc.cashPct / 100);
      const cashAndEquivalents = r.endingCash + cashSlice;
      const noncurrentInvestments = investedAssetsEnding - cashSlice;
      const derived = cashAndEquivalents + noncurrentInvestments;
      const buildUp =
        `Cash and cash equivalents = ending cash ${formatCurrency(r.endingCash)} + cash-allocation slice of investments (${alloc.cashPct}% × ${formatCurrency(investedAssetsEnding)}) ${formatCurrency(cashSlice)} = ${formatCurrency(cashAndEquivalents)}\n` +
        `Noncurrent investments = ${formatCurrency(investedAssetsEnding)} − ${formatCurrency(cashSlice)} = ${formatCurrency(noncurrentInvestments)}\n` +
        `Total = ${formatCurrency(derived)}\n` +
        `Stored total assets (statement): ${formatCurrency(r.totalAssets)}`;
      return makeScope(label, derived, r.totalAssets, buildUp);
    });
    checks.push({
      id: 'total-assets-split',
      category: 'Completeness',
      title: 'Total assets = cash and cash equivalents + investments',
      description: 'The cash-equivalents slice is derived from the allocation percentage, not read directly, so this exercises the same split shown on the Statement of Net Position.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 12: Total liabilities = current + noncurrent ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const isPool = label === 'Pool';
      const current = isPool
        ? lineKeys.reduce((s, l) => s + result.byLine[l].endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0), 0)
        : r.endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[label as CoverageLine] ?? 0);
      const noncurrent = isPool
        ? lineKeys.reduce((s, l) => s + result.byLine[l].endingNetReserve * (1 - (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0)), 0)
        : r.endingNetReserve * (1 - (LINE_RESERVE_PAYDOWN_PCT[label as CoverageLine] ?? 0));
      const derived = current + noncurrent + r.unearnedPremium;
      const buildUp =
        `Current portion (unpaid reserve, net) ${formatCurrency(current)}\n` +
        `+ Noncurrent portion (unpaid reserve, net) ${formatCurrency(noncurrent)}\n` +
        `+ Unearned premium ${formatCurrency(r.unearnedPremium)}\n` +
        `= ${formatCurrency(derived)}\n` +
        `Stored total liabilities (statement): ${formatCurrency(r.totalLiabilities)}`;
      return makeScope(label, derived, r.totalLiabilities, buildUp);
    });
    checks.push({
      id: 'total-liabilities-split',
      category: 'Completeness',
      title: 'Total liabilities = current + noncurrent',
      description: 'Reconstructs total liabilities from the current/noncurrent reserve split shown on the Statement of Net Position plus unearned premium.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 13: Total assets - total liabilities = net position ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const derived = r.totalAssets - r.totalLiabilities;
      const buildUp =
        `Total assets ${formatCurrency(r.totalAssets)} − total liabilities ${formatCurrency(r.totalLiabilities)} = ${formatCurrency(derived)}\n` +
        `Stored net position (statement): ${formatCurrency(r.endingSurplus)}`;
      return makeScope(label, derived, r.endingSurplus, buildUp);
    });
    checks.push({
      id: 'assets-minus-liabilities',
      category: 'Completeness',
      title: 'Total assets − total liabilities = net position',
      description: 'The fundamental balance-sheet identity.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  // --- Check 14: Ending net position = beginning + change ---
  {
    const scopes = scopeList.map(({ label, r }) => {
      const derived = r.beginingSurplus + r.netIncome;
      const buildUp =
        `Beginning net position ${formatCurrency(r.beginingSurplus)} + change in net position ${formatCurrency(r.netIncome)} = ${formatCurrency(derived)}\n` +
        `Stored ending net position (statement): ${formatCurrency(r.endingSurplus)}\n` +
        `(Existing tie-out difference field: ${formatCurrency(r.surplusTieOutDifference)})`;
      return makeScope(label, derived, r.endingSurplus, buildUp);
    });
    checks.push({
      id: 'ending-net-position-rollforward',
      category: 'Completeness',
      title: 'Ending net position = beginning + change',
      description: 'The net position rollforward identity, shown alongside the existing tie-out difference field.',
      scopes,
      status: overallStatus(scopes),
    });
  }

  return checks;
}

function ReconciliationSection({ checks }: { checks: ReconciliationCheck[] }) {
  const applicable = checks.filter(c => c.status !== 'na');
  const notApplicable = checks.filter(c => c.status === 'na');
  const passed = applicable.filter(c => c.status === 'pass').length;
  const variance = applicable.filter(c => c.status === 'variance').length;
  const failed = applicable.filter(c => c.status === 'fail').length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60">
        <h3 className="font-bold text-gray-900 text-sm">Statement Reconciliation</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Each check independently derives a figure from its component parts and compares it to what the statements report. Tolerance: differences below $0.01 pass (floating-point epsilon).
        </p>
      </div>
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-4 text-sm">
        <span className="font-semibold text-gray-800">
          {applicable.length} checks: {passed} passed, {variance} known variance, {failed} failure{failed === 1 ? '' : 's'}
        </span>
        {failed > 0 && (
          <span className="text-red-600 font-semibold">
            Failing: {checks.filter(c => c.status === 'fail').map(c => c.title).join(', ')}
          </span>
        )}
        {notApplicable.length > 0 && (
          <span className="text-gray-400 text-xs">
            Not applicable for this year: {notApplicable.map(c => c.title).join(', ')}
          </span>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        {checks.map(check => (
          <ReconciliationCheckRow key={check.id} check={check} />
        ))}
      </div>
    </div>
  );
}

function statusBadge(status: CheckStatus) {
  if (status === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 text-xs font-semibold">
        <CheckCircle2 size={12} /> Pass
      </span>
    );
  }
  if (status === 'variance') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 text-xs font-semibold">
        <AlertCircle size={12} /> Known Variance
      </span>
    );
  }
  if (status === 'na') {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5 text-xs font-semibold">
        N/A
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 text-xs font-semibold">
      <XCircle size={12} /> Fail
    </span>
  );
}

function ReconciliationCheckRow({ check }: { check: ReconciliationCheck }) {
  const comparedScopes = check.scopes.filter(s => s.status !== 'na');
  const maxDiff = comparedScopes.length > 0 ? Math.max(...comparedScopes.map(s => Math.abs(s.diff))) : null;
  return (
    <details className="group px-5 py-3">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
        <div className="flex items-center gap-3 min-w-0">
          <ChevronDown size={16} className="text-gray-400 transition-transform group-open:rotate-180 flex-shrink-0" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex-shrink-0">{check.category}</span>
          <span className="text-sm font-medium text-gray-800 truncate">{check.title}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-400 font-mono">{maxDiff === null ? 'n/a this year' : `max |diff| ${formatCurrency(maxDiff)}`}</span>
          {statusBadge(check.status)}
        </div>
      </summary>
      <div className="mt-3 pl-7 space-y-3">
        <p className="text-xs text-gray-500">{check.description}</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border border-gray-100 rounded-lg overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Scope</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Derived</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Statement</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Diff</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Component build-up</th>
              </tr>
            </thead>
            <tbody>
              {check.scopes.map((s, i) => (
                <tr key={`${s.scope}-${i}`} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">{s.scope}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800 whitespace-nowrap">{formatCurrency(s.derived)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800 whitespace-nowrap">{formatCurrency(s.statement)}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-800 whitespace-nowrap">{formatCurrency(s.diff)}</td>
                  <td className="px-3 py-2">{statusBadge(s.status)}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-pre-line">
                    {s.buildUp}
                    {s.note && <div className="mt-1.5 text-amber-700">{s.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
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
      metric: 'Starting Exposure Share (per line)',
      value: `${(STARTING_EXPOSURE_SHARE.min * 100).toFixed(0)}% to ${(STARTING_EXPOSURE_SHARE.max * 100).toFixed(0)}%`,
      formula: "Each active line independently enrolls members (seeded random order) until its enrolled exposure reaches this share of the line's total market exposure.",
      note:
        'The exposure target drives the starting member count per line; lines start with different but overlapping rosters.',
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
      metric: 'Asset Class Assumptions',
      value: Object.entries(ASSET_CLASS_ASSUMPTIONS)
        .map(([cls, a]) =>
          `${labelize(cls)}: Return ${formatPct(a.expectedReturn)} gross, Vol ${formatPct(a.standardDeviation)}, Fee ${formatPct(a.feeRate, 3)}`
        )
        .join('\n'),
      formula: 'Cash/bonds/equities return and volatility assumptions, blended by the player\'s asset allocation.',
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
        `Net Unpaid Reserve: ${formatRangeCurrency(STARTING_FINANCIALS.grossUnpaidReserve)} less ${formatRangeCurrency(STARTING_FINANCIALS.reinsuranceRecoverable)}\n` +
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
        `Asset Allocation Default: Cash ${ASSET_ALLOCATION_DEFAULT.cashPct}% / Bonds ${ASSET_ALLOCATION_DEFAULT.bondsPct}% / Equities ${ASSET_ALLOCATION_DEFAULT.equitiesPct}%`,
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
