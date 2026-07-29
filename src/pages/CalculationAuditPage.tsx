import React, { useState } from 'react';
import {
  Calculator,
  ClipboardList,
  DollarSign,
  Shield,
  TrendingUp,
  AlertTriangle,
  Settings,
  Layers,
} from 'lucide-react';
import type { CoverageLine, LineResultSet, LineView, ResultSet } from '../types/simulation';
import { lineDisplayName } from '../utils/lineDisplay';
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
  OPERATING_CASH_PCT_OF_PREMIUM,
} from '../data/defaultAssumptions';

interface CalculationAuditPageProps {
  // Pool-level results, UNFILTERED by line view: the page selects its own
  // scope below, because the "Pool = Sum of Active Lines" card needs .byLine.
  lockedResults: ResultSet[];
  // Pre-game years (yearNumbers <= 0) are real engine results, so every card
  // on this page can run against them too, not just locked live years.
  priorHistory: ResultSet[];
  // Needed to re-derive a year's investment-return draw rather than reading
  // the engine's own stored echo of it.
  instanceSeed: number;
  lineView: LineView;
}

// Three-state check outcome. 'variance' is a DOCUMENTED, bounded modelling
// effect (kept distinct so a permanent known variance never reads the same as
// a genuine new regression); 'na' means the check has no meaning at the
// selected scope/year and was not evaluated.
type CheckStatus = 'pass' | 'variance' | 'fail' | 'na';

interface AuditRow {
  metric: string;
  value: string;
  formula: string;
  note?: string;
  // Present only on rows that actually verify something. The page-level status
  // line counts these; descriptive rows carry no status and are not counted.
  status?: CheckStatus;
  // Presentation, so the statement-mirroring cards can reproduce the
  // statements' own visual hierarchy: 'section' is a full-width subheading,
  // emphasis bolds a subtotal (a rule above it for a statement total), and
  // indent nests a line under its group the way the statement indents it.
  kind?: 'section';
  emphasis?: 'subtotal' | 'total';
  indent?: 1 | 2;
}

interface AuditSectionProps {
  title: string;
  icon: React.ReactNode;
  rows: AuditRow[];
}

const CHECK_TOLERANCE = 0.01;

// Renders the Check / Notes column text AND classifies the row, so the column
// wording and the page-level tally can never disagree.
function checkNote(
  diff: number,
  opts: { tolerance?: number; varianceCap?: number; varianceReason?: string; isPct?: boolean } = {}
): { note: string; status: CheckStatus } {
  const tolerance = opts.tolerance ?? CHECK_TOLERANCE;
  const abs = Math.abs(diff);
  const shown = opts.isPct ? diff.toFixed(6) : formatCurrency(diff);
  if (abs <= tolerance) return { note: 'OK', status: 'pass' };
  if (opts.varianceCap !== undefined && abs <= opts.varianceCap) {
    return { note: `Known variance ${shown} — ${opts.varianceReason}`, status: 'variance' };
  }
  return { note: `DIFFERENCE ${shown} — unexpected, investigate`, status: 'fail' };
}

function naNote(reason: string): { note: string; status: CheckStatus } {
  return { note: `n/a — ${reason}`, status: 'na' };
}

// The long-standing recalculation checks on this page. Keeps their original
// tolerances (a dollar for currency, 1e-4 for ratios — deliberately looser
// than CHECK_TOLERANCE) and their original 'OK' / 'Review' wording, while
// also classifying them so they count toward the page-level status line.
function legacyCheck(value: number, threshold = 1): { note: string; status: CheckStatus } {
  return Math.abs(value) <= threshold
    ? { note: 'OK', status: 'pass' }
    : { note: 'Review', status: 'fail' };
}

// A prior-year reserve cohort can close this year and have its residual
// balance floored to zero (Math.max(0, newUnpaid) in the reserve rollforward)
// rather than fully absorbed into the simulated development figure. That
// produces a small, bounded gap between the "gross - recoveries -
// development" path and the "paid + reserve change" path — a known, bounded
// modelling effect, not a defect. Capped far below the scale a real systemic
// bug would produce.
const CLAIMS_VARIANCE_CAP = 10_000;
const CLAIMS_VARIANCE_REASON =
  'a prior-year reserve cohort closed and its residual balance was floored to zero in the rollforward rather than absorbed into the development figure';

export default function CalculationAuditPage({ lockedResults, priorHistory, instanceSeed, lineView }: CalculationAuditPageProps) {
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

  const poolResult = allYears.find(r => r.yearNumber === selectedYear);

  const yearOptions: { label: string; value: number }[] = [
    ...earlierPriorYears.map(y => ({ label: `${y.calendarYear} (History)`, value: y.yearNumber })),
    ...(openingYear ? [{ label: `Year 0 — ${openingYear.calendarYear} (Opening)`, value: openingYear.yearNumber }] : []),
    ...lockedResults.map(r => ({ label: `Year ${r.yearNumber} / ${r.calendarYear}`, value: r.yearNumber })),
  ];

  if (allYears.length === 0 || !poolResult) {
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

  // Every card below reads `result`, so selecting a line re-scopes the whole
  // page. The Pool = Sum card is the one exception — it needs poolResult.byLine.
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const checks = computeAuditChecks(poolResult, lineView, instanceSeed);

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

  // The former net-income, ending-investments, total-assets, total-liabilities
  // and ending-surplus recalculation checks lived here. They are now covered by
  // the two statement-mirroring cards (change in net position, the ending
  // investments sweep, and the asset / liability / net position identities), so
  // the duplicates are gone rather than stated twice with different wording.

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
      ...legacyCheck(grossPremiumDifference),
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
      ...legacyCheck(expectedLossDifference),
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
      ...legacyCheck(clfAdjustedExpectedLossDifference),
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
      ...legacyCheck(netUltimateLossDifference),
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
      ...legacyCheck(netIncurredLossDifference),
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

  // The two statement-mirroring cards, built from exported pure functions so a
  // regression script can assert their correspondence to the statements.
  const revExpRows = buildRevExpRows(poolResult, lineView, checks);
  const netPositionRows = buildNetPositionRows(poolResult, lineView, checks);
  const cashInvestmentRows = buildCashInvestmentRows(poolResult, lineView, checks);

  // Pool = sum of active lines, plus the reserve-weighted current/noncurrent
  // blend. Pool scope only — at line scope the sum is a single term and the
  // reserve split is definitional (X x p + X x (1-p) = X).
  const poolSumRows: AuditRow[] = isPoolView
    ? [
        ...checks.poolSum.map(({ metric, check }) => ({
          metric,
          value: formatCurrency(check.statement),
          formula: check.buildUp ?? '',
          note: check.note,
          status: check.status,
        })),
        ...(checks.reserveCurrentNoncurrent
          ? [{
              metric: 'Reserve Current + Noncurrent (reserve-weighted)',
              value: formatCurrency(result.endingNetReserve),
              formula: checks.reserveCurrentNoncurrent.buildUp ?? '',
              note: checks.reserveCurrentNoncurrent.note,
              status: checks.reserveCurrentNoncurrent.status,
            }]
          : []),
      ]
    : [];

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
      ...legacyCheck(result.lossRatio - lossRatioCheck, 0.0001),
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
      ...legacyCheck(result.expenseRatio - expenseRatioCheck, 0.0001),
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
      ...legacyCheck(result.combinedRatio - combinedRatioCheck, 0.0001),
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
      ...legacyCheck(indicatedNetReserveDifference),
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
      ...legacyCheck(reserveRiskMarginDifference),
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
      ...legacyCheck(result.capitalFundingGap - capitalFundingGapCheck),
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
      ...(result.excessCapitalRatio === null || capitalAdequacyRatioCheck === null
        ? naNote('no required reserve margin, so the ratio is undefined')
        : legacyCheck(result.excessCapitalRatio - capitalAdequacyRatioCheck, 0.0001)),
    },
    {
      metric: 'Excess Capital Status',
      value: result.capitalAdequacyStatus,
      formula: 'Status based on excess capital ratio thresholds.',
    },
  ];

  const assumptionRows: AuditRow[] = buildAssumptionRows();

  const allCheckRows = [
    ...revExpRows, ...netPositionRows, ...cashInvestmentRows, ...poolSumRows,
    ...exposureRows, ...rateRows, ...lossRows, ...reserveRows,
    ...ratioRows, ...capitalRows,
  ];
  const status = statusLine(allCheckRows);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Calculation Audit{isPoolView ? '' : ` — ${lineDisplayName(lineView)}`}
          </h2>
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

      <div className={`border rounded-xl px-4 py-3 text-sm font-semibold ${status.tone}`}>
        {status.text}
        <span className="font-normal opacity-75"> — differences under {formatCurrency(CHECK_TOLERANCE)} pass as floating-point epsilon; detail is in the Check / Notes column of each card.</span>
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

      {/* The two statement-mirroring cards first: same line items, names, order
          and subtotals as the Financial Statements tab, each line showing its
          derivation and its check. */}
      <AuditSection title="Statement of Revenues, Expenses & Changes in Net Position" icon={<DollarSign size={16} />} rows={revExpRows} />
      <AuditSection title="Statement of Net Position" icon={<DollarSign size={16} />} rows={netPositionRows} />
      {isPoolView && (
        <AuditSection title="Pool = Sum of Active Lines" icon={<Layers size={16} />} rows={poolSumRows} />
      )}

      {/* Supporting detail behind the statement lines. */}
      <AuditSection title="Cash & Investments Rollforward" icon={<DollarSign size={16} />} rows={cashInvestmentRows} />
      <AuditSection title="Exposure and Membership" icon={<TrendingUp size={16} />} rows={exposureRows} />
      <AuditSection title="Funding Rate Build-Up" icon={<Calculator size={16} />} rows={rateRows} />
      <AuditSection title="Losses and Reinsurance" icon={<Shield size={16} />} rows={lossRows} />
      <AuditSection title="Reserve Rollforward" icon={<ClipboardList size={16} />} rows={reserveRows} />
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
            {rows.map((row, index) => {
              if (row.kind === 'section') {
                return (
                  <tr key={`${row.metric}-${index}`} className="bg-gray-50/70 border-y border-gray-100">
                    <td colSpan={4} className="px-5 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {row.metric}
                    </td>
                  </tr>
                );
              }
              const bold = row.emphasis !== undefined;
              return (
                <tr
                  key={`${row.metric}-${index}`}
                  className={`border-b border-gray-50 hover:bg-gray-50/50 ${row.emphasis === 'total' ? 'border-t-2 border-t-gray-300 bg-blue-50/40' : ''}`}
                >
                  <td className={`px-5 py-3 align-top ${bold ? 'font-bold text-gray-900' : 'font-medium text-gray-700'} ${row.indent === 2 ? 'pl-14' : row.indent === 1 ? 'pl-9' : ''}`}>
                    {row.metric}
                  </td>
                  <td className={`px-5 py-3 font-mono text-right align-top whitespace-pre-line ${bold ? 'font-bold text-gray-900' : 'text-gray-900'}`}>{row.value}</td>
                  <td className="px-5 py-3 text-gray-600 align-top whitespace-pre-line">{row.formula}</td>
                  <td className="px-5 py-3 text-gray-500 align-top whitespace-pre-line">{row.note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Statement reconciliation checks.
//
// Each entry independently DERIVES a figure from its component parts and
// compares it against what the statement reports — it never reads the same
// field twice, which would only prove a number equals itself.
//
// Computed here in one place and consumed as rows by the cards below, so the
// arithmetic has a single source of truth and stays scriptable for regression
// tests. `lineView` selects the scope: a coverage line evaluates that line's
// own figures, 'pool' evaluates the aggregate.
// ============================================================================

export interface AuditCheck {
  derived: number;
  statement: number;
  diff: number;
  note: string;
  status: CheckStatus;
  // Per-line build-up, used as the Formula / Source text on the pool-sum card.
  buildUp?: string;
}

export interface AuditCheckSet {
  // Statement of Revenues, Expenses & Changes in Net Position
  totalOperatingRevenues: AuditCheck;
  totalOperatingExpenses: AuditCheck;
  operatingIncome: AuditCheck;
  changeInNetPosition: AuditCheck;
  priorYearClaims: AuditCheck;
  provisionForClaims: AuditCheck;
  investmentIncome: AuditCheck;
  netPositionRollforward: AuditCheck;
  // Statement of Net Position
  totalAssetsSplit: AuditCheck;
  totalLiabilitiesSplit: AuditCheck;
  assetsMinusLiabilities: AuditCheck;
  // Cash & investments rollforward (no statement line of their own)
  endingCashSweep: AuditCheck;
  endingInvestmentsSweep: AuditCheck;
  // Pool-only: one entry per summable metric, plus the reserve-weighted split.
  poolSum: { metric: string; check: AuditCheck }[];
  reserveCurrentNoncurrent: AuditCheck | null;
  // Derived display values the cards also need.
  totalOperatingRevenuesValue: number;
  totalOperatingExpensesValue: number;
  priorYearClaimsValue: number;
  currentUnpaidPortion: number;
  noncurrentUnpaidPortion: number;
  cashAndEquivalents: number;
  cashSliceOfInvestments: number;
  noncurrentInvestments: number;
  operatingCashTarget: number;
  investmentsBeforeSweep: number;
  sweepTransfer: number;
  investmentsFloorBound: boolean;
  liquidityFloorBound: boolean;
}

function mkCheck(
  derived: number,
  statement: number,
  opts: { varianceCap?: number; varianceReason?: string; buildUp?: string } = {}
): AuditCheck {
  const diff = statement - derived;
  const { note, status } = checkNote(diff, {
    varianceCap: opts.varianceCap,
    varianceReason: opts.varianceReason,
  });
  return { derived, statement, diff, note, status, buildUp: opts.buildUp };
}

// Every metric where the pool figure must equal the sum of its active lines.
const POOL_SUM_METRICS: { key: keyof LineResultSet; label: string }[] = [
  { key: 'poolPremium', label: 'Pool Premium' },
  { key: 'adminExpense', label: 'Admin Expense' },
  { key: 'poolPremiumAndAdminExpense', label: 'Pool Premium & Admin Expense' },
  { key: 'totalMemberCharge', label: 'Gross Premium & Admin Expense' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'grossUltimateLoss', label: 'Gross Ultimate Loss' },
  { key: 'poolLosses', label: 'Pool Losses' },
  { key: 'excessLosses', label: 'Excess Losses' },
  { key: 'quotaShareLosses', label: 'Quota Share Losses' },
  { key: 'reinsuranceRecovery', label: 'Reinsurance Recovery' },
  { key: 'netUltimateLoss', label: 'Net Ultimate Loss' },
  { key: 'netIncurredLoss', label: 'Net Incurred Loss' },
  { key: 'netPaidLosses', label: 'Net Paid Losses' },
  { key: 'operatingExpense', label: 'Operating Expense' },
  { key: 'riskControlInvestment', label: 'Risk Control Investment' },
  { key: 'reinsuranceCost', label: 'Reinsurance Cost' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'priorYearDevelopment', label: 'Prior-Year Development' },
  { key: 'underwritingIncome', label: 'Underwriting Income' },
  { key: 'investmentIncome', label: 'Investment Income' },
  { key: 'netIncome', label: 'Net Income' },
  { key: 'beginningCash', label: 'Beginning Cash' },
  { key: 'endingCash', label: 'Ending Cash' },
  { key: 'beginningInvestments', label: 'Beginning Investments' },
  { key: 'endingInvestments', label: 'Ending Investments' },
  { key: 'totalAssets', label: 'Total Assets' },
  { key: 'beginningNetReserve', label: 'Beginning Net Reserve' },
  { key: 'endingNetReserve', label: 'Ending Net Reserve' },
  { key: 'unearnedPremium', label: 'Unearned Premium' },
  { key: 'totalLiabilities', label: 'Total Liabilities' },
  { key: 'beginingSurplus', label: 'Beginning Surplus' },
  { key: 'endingSurplus', label: 'Ending Surplus' },
];

// Reconstructs one line's year-end cash/investment sweep exactly as the engine
// performs it: the year's flows accumulate to a pre-sweep cash total, then cash
// above the operating-cash target is swept into investments, or a shortfall is
// drawn back out of investments (limited to what is actually there). Both
// floors are reported so a genuine liquidity or wipe-out event is
// distinguishable from a reconciliation gap.
function reconstructSweep(x: LineResultSet) {
  const preSweepCash =
    x.beginningCash + x.totalMemberCharge + x.assessments - x.netPaidLosses -
    x.operatingExpense - x.riskControlInvestment - x.reinsuranceCost - x.dividends;
  const rawInvestments = x.beginningInvestments + x.investmentIncome;
  const investmentsBeforeSweep = Math.max(0, rawInvestments);
  const investmentsFloorBound = rawInvestments < -CHECK_TOLERANCE;
  const operatingCashTarget = x.totalMemberCharge * OPERATING_CASH_PCT_OF_PREMIUM;

  let cash: number;
  let investments: number;
  let liquidityFloorBound = false;
  if (preSweepCash >= operatingCashTarget) {
    cash = operatingCashTarget;
    investments = investmentsBeforeSweep + (preSweepCash - operatingCashTarget);
  } else {
    const shortfall = operatingCashTarget - preSweepCash;
    const drawn = Math.min(shortfall, investmentsBeforeSweep);
    cash = preSweepCash + drawn;
    investments = investmentsBeforeSweep - drawn;
    liquidityFloorBound = drawn < shortfall - CHECK_TOLERANCE;
  }
  return {
    cash,
    investments,
    preSweepCash,
    operatingCashTarget,
    investmentsBeforeSweep,
    sweepTransfer: investments - investmentsBeforeSweep,
    liquidityFloorBound,
    investmentsFloorBound,
  };
}

export function computeAuditChecks(
  poolResult: ResultSet,
  lineView: LineView,
  instanceSeed: number
): AuditCheckSet {
  const isPoolView = lineView === 'pool';
  const r: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const lineKeys = Object.keys(poolResult.byLine) as CoverageLine[];
  const isLiveYear = r.yearNumber > 0;

  // --- Income statement ---
  // Pass-throughs are shown GROSS: reinsurance and admin appear as both
  // revenue (collected from members) and expense (paid out).
  const totalOperatingRevenuesValue =
    r.reinsuranceCost + r.poolPremium + r.adminExpense + r.assessments;
  const totalOperatingExpensesValue =
    r.reinsuranceCost + r.netIncurredLoss + r.operatingExpense + r.riskControlInvestment + r.dividends;

  const totalOperatingRevenues = mkCheck(totalOperatingRevenuesValue, totalOperatingRevenuesValue);
  const totalOperatingExpenses = mkCheck(totalOperatingExpensesValue, totalOperatingExpensesValue);
  const operatingIncome = mkCheck(
    totalOperatingRevenuesValue - totalOperatingExpensesValue,
    r.underwritingIncome
  );
  const changeInNetPosition = mkCheck(r.underwritingIncome + r.investmentIncome, r.netIncome);

  // Prior accident years' NET incurred, as the statement presents it: net paid
  // plus the change in net unpaid on prior cohorts. The two INDEPENDENT paths
  // meet on this line — the statement's presentation figure (net incurred less
  // this year's net ultimate) against the reserve rollforward's own separately
  // simulated cohort development (signed so positive = favourable, hence
  // negated). A failure here points at the reserve development, not a subtotal.
  const priorYearClaimsValue = r.netIncurredLoss - r.netUltimateLoss;
  const priorYearClaims = mkCheck(-r.priorYearDevelopment, priorYearClaimsValue, {
    varianceCap: CLAIMS_VARIANCE_CAP,
    varianceReason: CLAIMS_VARIANCE_REASON,
  });

  // The subtotal's own identity: current year claims less ceded recoveries plus
  // prior year claims must equal the net provision. Exact by construction.
  const provisionForClaims = mkCheck(
    r.grossUltimateLoss - r.reinsuranceRecovery + priorYearClaimsValue,
    r.netIncurredLoss
  );

  // --- Statement of net position ---
  // The cash-equivalents slice is DERIVED from the allocation percentage
  // rather than read directly, exercising the same split the statement shows.
  const cashSlice = r.endingInvestments * (r.assetAllocation.cashPct / 100);
  const cashAndEquivalents = r.endingCash + cashSlice;
  const noncurrentInvestments = r.endingInvestments - cashSlice;
  const totalAssetsSplit = mkCheck(cashAndEquivalents + noncurrentInvestments, r.totalAssets);

  // Current portion = the share of each line's own net unpaid reserve expected
  // to pay within 12 months, at that line's own paydown rate. Pool view sums
  // each active line's own reserve x its own rate (a reserve-weighted blend).
  const currentUnpaidPortion = isPoolView
    ? lineKeys.reduce((s, l) => s + poolResult.byLine[l].endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[l] ?? 0), 0)
    : r.endingNetReserve * (LINE_RESERVE_PAYDOWN_PCT[lineView as CoverageLine] ?? 0);
  const noncurrentUnpaidPortion = r.endingNetReserve - currentUnpaidPortion;

  const totalLiabilitiesSplit = mkCheck(
    currentUnpaidPortion + noncurrentUnpaidPortion + r.unearnedPremium,
    r.totalLiabilities
  );
  const assetsMinusLiabilities = mkCheck(r.totalAssets - r.totalLiabilities, r.endingSurplus);
  // One identity, both directions: ending = beginning + change, equivalently
  // change = ending - beginning. (These were previously two separate rows.)
  const netPositionRollforward = mkCheck(r.beginingSurplus + r.netIncome, r.endingSurplus);

  // The sweep runs PER LINE inside the engine, so at pool scope the correct
  // reconstruction is the sum of each line's own reconstruction — applying the
  // formula to pool aggregates only coincides when no line hits either floor.
  const sweepParts = (isPoolView ? lineKeys.map(l => poolResult.byLine[l]) : [r]).map(reconstructSweep);
  const sweep = sweepParts.reduce(
    (a, b) => ({
      cash: a.cash + b.cash,
      investments: a.investments + b.investments,
      operatingCashTarget: a.operatingCashTarget + b.operatingCashTarget,
      investmentsBeforeSweep: a.investmentsBeforeSweep + b.investmentsBeforeSweep,
      sweepTransfer: a.sweepTransfer + b.sweepTransfer,
      liquidityFloorBound: a.liquidityFloorBound || b.liquidityFloorBound,
      investmentsFloorBound: a.investmentsFloorBound || b.investmentsFloorBound,
    }),
    { cash: 0, investments: 0, operatingCashTarget: 0, investmentsBeforeSweep: 0, sweepTransfer: 0, liquidityFloorBound: false, investmentsFloorBound: false }
  );

  const endingCashSweep: AuditCheck = sweep.liquidityFloorBound
    ? {
        derived: sweep.cash,
        statement: r.endingCash,
        diff: r.endingCash - sweep.cash,
        status: 'variance',
        note:
          `Known variance — LIQUIDITY FLOOR BOUND: available investments could not fully cover the cash ` +
          `shortfall, so the operating-cash target was not met. A real balance-sheet event, not a ` +
          `reconciliation gap.`,
      }
    : mkCheck(sweep.cash, r.endingCash);

  const endingInvestmentsSweep: AuditCheck = sweep.investmentsFloorBound
    ? {
        derived: sweep.investments,
        statement: r.endingInvestments,
        diff: r.endingInvestments - sweep.investments,
        status: 'variance',
        note:
          `Known variance — INVESTMENTS FLOOR BOUND: an investment loss exceeded the opening portfolio, ` +
          `so the balance was clamped at zero before the sweep. A real balance-sheet event, not a ` +
          `reconciliation gap.`,
      }
    : mkCheck(sweep.investments, r.endingInvestments);

  // --- Investment income: plumbing consistency, not an independent derivation ---
  // Live years draw one shared market from the plain instance seed. Pre-game
  // years are simulated PER LINE in isolation on attempt-shifted seeds
  // (instance.seed + pregameAttempt x 997), so each line saw a DIFFERENT
  // market in the same pre-game year — there is no single pool-level market
  // draw to check, only per-line ones.
  let investmentIncome: AuditCheck;
  if (isPoolView && !isLiveYear) {
    const { note, status } = naNote(
      'no single pool-level market draw exists for a pre-game year — each line pre-games on its own ' +
      'attempt-shifted seed and drew a different market. Select a line tab to check it.'
    );
    investmentIncome = { derived: 0, statement: r.investmentIncome, diff: 0, note, status };
  } else {
    const attempt = isLiveYear ? 0 : (r.pregameAttempt ?? 0);
    const effectiveSeed = attempt === 0 ? instanceSeed : (instanceSeed + attempt * 997) >>> 0;
    const market = simulateMarketReturns(deriveSubRng(effectiveSeed, r.yearNumber, 'invest'));
    const blend = blendInvestmentReturn(r.investedAssets, r.assetAllocation, market);
    investmentIncome = mkCheck(blend.income, r.investmentIncome);
  }

  // --- Pool = sum of active lines (pool scope only) ---
  const poolSum = isPoolView
    ? POOL_SUM_METRICS.map(({ key, label }) => {
        const sumOfLines = lineKeys.reduce(
          (s, l) => s + Number(poolResult.byLine[l][key]),
          0
        );
        const buildUp = lineKeys
          .map(l => `${l} ${formatCurrency(Number(poolResult.byLine[l][key]))}`)
          .join(' + ') + ` = ${formatCurrency(sumOfLines)}`;
        return { metric: label, check: mkCheck(sumOfLines, Number(poolResult[key]), { buildUp }) };
      })
    : [];

  // Tautological at line scope (X x p + X x (1-p) = X), so pool-only: there it
  // verifies that summing each line's own reserve split by that line's own
  // paydown rate reproduces the separately-aggregated pool reserve.
  const reserveCurrentNoncurrent = isPoolView
    ? mkCheck(currentUnpaidPortion + noncurrentUnpaidPortion, r.endingNetReserve, {
        buildUp:
          lineKeys
            .map(l => {
              const pct = LINE_RESERVE_PAYDOWN_PCT[l] ?? 0;
              const res = poolResult.byLine[l].endingNetReserve;
              return `${l} ${formatCurrency(res)} x ${formatPct(pct)}`;
            })
            .join(' + ') +
          ` = ${formatCurrency(currentUnpaidPortion)} current; remainder ${formatCurrency(noncurrentUnpaidPortion)} noncurrent`,
      })
    : null;

  return {
    totalOperatingRevenues,
    totalOperatingExpenses,
    operatingIncome,
    changeInNetPosition,
    priorYearClaims,
    provisionForClaims,
    investmentIncome,
    netPositionRollforward,
    totalAssetsSplit,
    totalLiabilitiesSplit,
    assetsMinusLiabilities,
    endingCashSweep,
    endingInvestmentsSweep,
    poolSum,
    reserveCurrentNoncurrent,
    totalOperatingRevenuesValue,
    totalOperatingExpensesValue,
    priorYearClaimsValue,
    currentUnpaidPortion,
    noncurrentUnpaidPortion,
    cashAndEquivalents,
    cashSliceOfInvestments: cashSlice,
    noncurrentInvestments,
    operatingCashTarget: sweep.operatingCashTarget,
    investmentsBeforeSweep: sweep.investmentsBeforeSweep,
    sweepTransfer: sweep.sweepTransfer,
    investmentsFloorBound: sweep.investmentsFloorBound,
    liquidityFloorBound: sweep.liquidityFloorBound,
  };
}

// Every row that verifies something, for the page-level status line.
function statusLine(rows: AuditRow[]): { text: string; tone: string } {
  const checked = rows.filter(row => row.status !== undefined);
  const failed = checked.filter(row => row.status === 'fail').length;
  const variance = checked.filter(row => row.status === 'variance').length;
  const na = checked.filter(row => row.status === 'na').length;
  const passed = checked.filter(row => row.status === 'pass').length;

  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} difference${failed === 1 ? '' : 's'} found`);
  if (variance > 0) parts.push(`${variance} known variance${variance === 1 ? '' : 's'}`);
  if (na > 0) parts.push(`${na} not applicable`);

  if (failed === 0 && variance === 0 && na === 0) {
    return { text: `All ${passed} checks OK`, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  }
  const summary = `${passed} of ${checked.length} checks OK — ${parts.join(', ')}`;
  return {
    text: summary,
    tone: failed > 0
      ? 'text-red-700 bg-red-50 border-red-200'
      : 'text-amber-700 bg-amber-50 border-amber-200',
  };
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

// ============================================================================
// Statement-mirroring row builders.
//
// Each returns the audit rows for one card, in the SAME order, with the SAME
// labels and values as the corresponding statement on the Financial Statements
// tab — every line additionally carrying its derivation and its check. Exported
// as pure functions so a regression script can assert that correspondence
// directly.
// ============================================================================

export function buildRevExpRows(
  poolResult: ResultSet,
  lineView: LineView,
  checks: AuditCheckSet
): AuditRow[] {
  const result: LineResultSet = lineView === 'pool' ? poolResult : poolResult.byLine[lineView];
  // Mirrors the statement: neither is modelled yet, so both are zero and the
  // rows they gate stay hidden.
  const additionalPaidInCapital = 0;
  const restatements = 0;
  return [

    { kind: 'section', metric: 'Operating revenues', value: '', formula: '' },
    {
      metric: 'Premiums for transferred risk',
      value: formatCurrency(result.reinsuranceCost),
      formula: 'Cost of the selected reinsurance program, billed through to members. Shown gross: it appears again below as an operating expense when paid to the reinsurer.',
      indent: 1,
    },
    {
      metric: 'Contributions for retained risk',
      value: formatCurrency(result.poolPremium),
      formula: 'Pool premium — expected loss at the selected confidence level factor, after the rate-level adjustment.',
      indent: 1,
    },
    {
      metric: 'Administration fees',
      value: formatCurrency(result.adminExpense),
      formula: `Pure premium × ${formatPct(ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM)}, added after the CLF and not multiplied by it. Shown gross: it appears again below as general administrative services.`,
      indent: 1,
    },
    {
      metric: 'Member assessments',
      value: formatCurrency(result.assessments),
      formula: 'Pool premium × the selected assessment percentage — additional calls on members beyond premium.',
      indent: 1,
    },
    {
      metric: 'Total operating revenues',
      value: formatCurrency(checks.totalOperatingRevenuesValue),
      formula: 'Premiums for transferred risk + contributions for retained risk + administration fees + member assessments.',
      emphasis: 'subtotal',
      note: checks.totalOperatingRevenues.note,
      status: checks.totalOperatingRevenues.status,
    },

    { kind: 'section', metric: 'Operating expenses', value: '', formula: '' },
    {
      metric: 'Transferred risk & insurance expense',
      value: formatCurrency(result.reinsuranceCost),
      formula: 'The reinsurance premium paid out — the same figure collected above, passed straight through.',
      indent: 1,
    },
    {
      metric: 'Provision for claims:',
      value: '',
      formula: 'Grouping header for the three claim components below.',
      indent: 1,
    },
    {
      metric: 'Current year claims',
      value: formatCurrency(result.grossUltimateLoss),
      formula: 'This accident year\'s simulated gross ultimate loss including LAE, before any reinsurance.',
      indent: 2,
    },
    ...(result.reinsuranceRecovery !== 0
      ? [{
          metric: 'Less: reinsurance recoveries',
          value: `(${formatCurrency(result.reinsuranceRecovery)})`,
          formula: 'The reinsurer\'s quota share of losses above the attachment point. Shown only when non-zero, as on the statement.',
          indent: 2 as const,
        }]
      : []),
    {
      metric: 'Prior year claims',
      value: formatCurrency(checks.priorYearClaimsValue),
      formula: 'Prior accident years\' net incurred: net incurred loss less this year\'s net ultimate loss — i.e. paid plus the change in unpaid on prior cohorts, including closed-cohort runoff. Independently derived by negating the separately simulated prior-year cohort development, and the two must meet.',
      indent: 2,
      note: checks.priorYearClaims.note,
      status: checks.priorYearClaims.status,
    },
    {
      metric: 'Provision for claims, net',
      value: formatCurrency(result.netIncurredLoss),
      formula: 'Current year claims less reinsurance recoveries plus prior year claims.',
      indent: 2,
      emphasis: 'subtotal',
      note: checks.provisionForClaims.note,
      status: checks.provisionForClaims.status,
    },
    {
      metric: 'General administrative services',
      value: formatCurrency(result.operatingExpense),
      formula: 'The administration fees collected above, paid out as operating expense.',
      indent: 1,
    },
    {
      metric: 'Loss prevention expenses',
      value: formatCurrency(result.riskControlInvestment),
      formula: 'Pool premium × the selected risk-control percentage.',
      indent: 1,
    },
    {
      metric: 'Member dividends & returned premium',
      value: formatCurrency(result.dividends),
      formula: 'Pool premium × the selected dividend percentage. Blocked when the line carried a negative surplus into the year.',
      indent: 1,
    },
    {
      metric: 'Total operating expenses',
      value: formatCurrency(checks.totalOperatingExpensesValue),
      formula: 'Transferred risk & insurance expense + provision for claims net + general administrative services + loss prevention expenses + member dividends & returned premium.',
      emphasis: 'subtotal',
      note: checks.totalOperatingExpenses.note,
      status: checks.totalOperatingExpenses.status,
    },

    {
      metric: 'Operating income (loss)',
      value: formatCurrency(result.underwritingIncome),
      formula: 'Total operating revenues less total operating expenses, compared against the separately stored underwriting income.',
      emphasis: 'total',
      note: checks.operatingIncome.note,
      status: checks.operatingIncome.status,
    },

    { kind: 'section', metric: 'Nonoperating revenues (expenses)', value: '', formula: '' },
    {
      metric: 'Investment income, net of investment expense',
      value: formatCurrency(result.investmentIncome),
      formula: `Invested assets ${formatCurrency(result.investedAssets)} × the blended return rate from this year's cash / bond / equity draws, net of fees. Re-running the engine's own market draw and blend for this year confirms the stored figure — this verifies the plumbing between engine and statement, not the investment maths itself.`,
      indent: 1,
      note: checks.investmentIncome.note,
      status: checks.investmentIncome.status,
    },
    {
      metric: 'Total nonoperating revenues (expenses)',
      value: formatCurrency(result.investmentIncome),
      formula: 'Investment income is currently the only nonoperating item.',
      emphasis: 'subtotal',
    },

    {
      metric: 'Change in net position',
      value: formatCurrency(result.netIncome),
      formula: 'Operating income plus total nonoperating revenues — confirms the bottom line is exactly the sum of the two sections above it.',
      emphasis: 'total',
      note: checks.changeInNetPosition.note,
      status: checks.changeInNetPosition.status,
    },

    { kind: 'section', metric: 'Net position', value: '', formula: '' },
    {
      metric: 'Beginning of year',
      value: formatCurrency(result.beginingSurplus),
      formula: 'Prior year\'s ending net position, carried in.',
      indent: 1,
    },
    // Mirrors the statement's conditional block: rendered only when non-zero,
    // so hidden today because neither is modelled yet.
    ...(additionalPaidInCapital !== 0 || restatements !== 0
      ? [
          {
            metric: 'Additional paid in capital',
            value: formatCurrency(additionalPaidInCapital),
            formula: 'Capital contributed by members beyond premium. Not modelled yet.',
            indent: 1 as const,
          },
          {
            metric: 'Restatements',
            value: formatCurrency(restatements),
            formula: 'Prior-period restatements. Not modelled yet.',
            indent: 1 as const,
          },
          {
            metric: 'Beginning of year, as restated',
            value: formatCurrency(result.beginingSurplus + additionalPaidInCapital + restatements),
            formula: 'Beginning of year plus additional paid in capital plus restatements.',
            indent: 1 as const,
          },
        ]
      : []),
    {
      metric: 'Net position, end of year',
      value: formatCurrency(result.endingSurplus),
      formula: `Beginning of year plus the change in net position. Stored tie-out difference: ${formatCurrency(result.surplusTieOutDifference)}.`,
      emphasis: 'total',
      note: checks.netPositionRollforward.note,
      status: checks.netPositionRollforward.status,
    },
  ];
}

export function buildNetPositionRows(
  poolResult: ResultSet,
  lineView: LineView,
  checks: AuditCheckSet
): AuditRow[] {
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const lineKeysForDisplay = Object.keys(poolResult.byLine) as CoverageLine[];
  return [

    { kind: 'section', metric: 'Current assets', value: '', formula: '' },
    {
      metric: 'Cash and cash equivalents',
      value: formatCurrency(checks.cashAndEquivalents),
      formula: `Ending operating cash ${formatCurrency(result.endingCash)} plus the cash-allocation slice of the investment portfolio (${result.assetAllocation.cashPct}% × ${formatCurrency(result.endingInvestments)} = ${formatCurrency(checks.cashSliceOfInvestments)}). The slice is derived from the allocation percentage rather than read directly.`,
      indent: 1,
    },
    {
      metric: 'Total current assets',
      value: formatCurrency(checks.cashAndEquivalents),
      formula: 'Cash and cash equivalents is currently the only current asset.',
      emphasis: 'subtotal',
    },

    { kind: 'section', metric: 'Noncurrent assets', value: '', formula: '' },
    {
      metric: 'Investments',
      value: formatCurrency(checks.noncurrentInvestments),
      formula: `The portfolio less its cash-equivalent slice: ${formatCurrency(result.endingInvestments)} − ${formatCurrency(checks.cashSliceOfInvestments)} — the bond and equity allocations.`,
      indent: 1,
    },
    {
      metric: 'Total noncurrent assets',
      value: formatCurrency(checks.noncurrentInvestments),
      formula: 'Investments are currently the only noncurrent asset.',
      emphasis: 'subtotal',
    },

    {
      metric: 'Total assets',
      value: formatCurrency(result.totalAssets),
      formula: 'Total current assets plus total noncurrent assets, compared against the stored total. The current/noncurrent split reallocates the portfolio but must conserve the total.',
      emphasis: 'total',
      note: checks.totalAssetsSplit.note,
      status: checks.totalAssetsSplit.status,
    },

    { kind: 'section', metric: 'Current liabilities', value: '', formula: '' },
    {
      metric: 'Unpaid loss and LAE reserve, net of reinsurance — current portion',
      value: formatCurrency(checks.currentUnpaidPortion),
      formula: isPoolView
        ? `The share of each line's own net unpaid reserve expected to pay within twelve months, at that line's own paydown rate, summed: ${lineKeysForDisplay.map(l => `${l} ${formatCurrency(poolResult.byLine[l].endingNetReserve)} × ${formatPct(LINE_RESERVE_PAYDOWN_PCT[l] ?? 0)}`).join(' + ')}.`
        : `Net unpaid reserve ${formatCurrency(result.endingNetReserve)} × this line's own reserve paydown rate ${formatPct(LINE_RESERVE_PAYDOWN_PCT[lineView as CoverageLine] ?? 0)} — the same rate the engine applies to every cohort each year.`,
      indent: 1,
    },
    {
      metric: 'Total current liabilities',
      value: formatCurrency(checks.currentUnpaidPortion),
      formula: 'The current portion of the unpaid loss reserve is currently the only current liability.',
      emphasis: 'subtotal',
    },

    { kind: 'section', metric: 'Noncurrent liabilities', value: '', formula: '' },
    {
      metric: 'Unpaid loss and LAE reserve, net of reinsurance — noncurrent portion',
      value: formatCurrency(checks.noncurrentUnpaidPortion),
      formula: `The remainder of the net unpaid reserve: ${formatCurrency(result.endingNetReserve)} − ${formatCurrency(checks.currentUnpaidPortion)} — expected to pay beyond twelve months.`,
      indent: 1,
    },
    {
      metric: 'Total noncurrent liabilities',
      value: formatCurrency(checks.noncurrentUnpaidPortion),
      formula: 'The noncurrent portion of the unpaid loss reserve is currently the only noncurrent liability.',
      emphasis: 'subtotal',
    },

    {
      metric: 'Total liabilities',
      value: formatCurrency(result.totalLiabilities),
      formula: `Total current plus total noncurrent liabilities, compared against the stored total. Unearned premium (${formatCurrency(result.unearnedPremium)}) is held at zero because written premium is treated as earned in the year written, so the statement does not present it as a line.`,
      emphasis: 'total',
      note: checks.totalLiabilitiesSplit.note,
      status: checks.totalLiabilitiesSplit.status,
    },

    {
      metric: 'Net position — unrestricted',
      value: formatCurrency(result.endingSurplus),
      formula: 'Total assets less total liabilities — the fundamental balance-sheet identity, compared against the stored ending net position.',
      emphasis: 'total',
      note: checks.assetsMinusLiabilities.note,
      status: checks.assetsMinusLiabilities.status,
    },
  ];
}

export function buildCashInvestmentRows(
  poolResult: ResultSet,
  lineView: LineView,
  checks: AuditCheckSet
): AuditRow[] {
  const isPoolView = lineView === 'pool';
  const result: LineResultSet = isPoolView ? poolResult : poolResult.byLine[lineView];
  const surplusFromIncomeDifference =
    result.surplusFromIncome - (result.beginingSurplus + result.netIncome);
  const tieOutDifferenceDifference =
    result.surplusTieOutDifference - (result.endingSurplus - result.surplusFromIncome);
  return [

    {
      metric: 'Beginning Cash',
      value: formatCurrency(result.beginningCash),
      formula: 'Operating cash carried into the year.',
    },
    {
      metric: 'Beginning Investments',
      value: formatCurrency(result.beginningInvestments),
      formula: 'Investment portfolio carried into the year.',
    },
    {
      metric: 'Investment Income',
      value: formatCurrency(result.investmentIncome),
      formula: 'Applied to the portfolio before the sweep. Can be negative in a down market.',
    },
    {
      metric: 'Investments Before Sweep',
      value: formatCurrency(checks.investmentsBeforeSweep),
      formula: 'Beginning investments plus investment income, floored at zero (a loss cannot drive the portfolio negative).',
    },
    {
      metric: 'Operating Cash Target',
      value: formatCurrency(checks.operatingCashTarget),
      formula: `Gross premium & admin expense × ${formatPct(OPERATING_CASH_PCT_OF_PREMIUM)}${isPoolView ? ', summed across lines (the sweep runs per line)' : ''}. Cash is swept toward this level each year end.`,
    },
    {
      metric: 'Sweep Transfer',
      value: formatCurrency(checks.sweepTransfer),
      formula: 'Net movement into the portfolio from the sweep: positive when cash above target was swept in, negative when investments were drawn down to cover a cash shortfall.',
    },
    {
      metric: 'Ending Cash / Operating Cash Sweep',
      value: formatCurrency(result.endingCash),
      formula: 'Reconstructs the sweep: the year\'s flows accumulate to a pre-sweep cash total, then cash is either capped at the operating-cash target with the surplus swept into investments, or topped up from investments to reach it. Flags a known variance if investments run out first — a genuine liquidity shortfall rather than a modelling gap.',
      note: checks.endingCashSweep.note,
      status: checks.endingCashSweep.status,
    },
    {
      metric: 'Ending Investments / Sweep',
      value: formatCurrency(result.endingInvestments),
      formula: 'Investments before sweep plus the sweep transfer. The mirror image of the cash reconstruction above — the sweep conserves total assets, moving money between the two accounts.',
      note: checks.endingInvestmentsSweep.note,
      status: checks.endingInvestmentsSweep.status,
    },
    {
      metric: 'Unearned Premium',
      value: formatCurrency(result.unearnedPremium),
      formula: 'Held at zero: written premium is treated as collected and earned in the year it is written, with no separate timing layer.',
    },
    {
      metric: 'Surplus from Income',
      value: formatCurrency(result.surplusFromIncome),
      formula: 'Beginning surplus plus net income — the stored rollforward figure.',
      ...legacyCheck(surplusFromIncomeDifference),
    },
    {
      metric: 'Tie-Out Difference',
      value: formatCurrency(result.surplusTieOutDifference),
      formula: 'Ending surplus less surplus from income. Zero when the balance sheet and income statement agree.',
      ...legacyCheck(tieOutDifferenceDifference),
    },
  ];
}
