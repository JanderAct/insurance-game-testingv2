import { Activity, DollarSign, Shield, Users } from 'lucide-react';
import type { HistoricalYear, LineView } from '../types/simulation';
import { colorForRatio, formatCurrency, formatMillions, formatPct } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';

interface HistoryPageProps {
  // Stage 2.10: real simulated pre-game years (already filtered to the current
  // view — pool aggregate or a single line — and adapted for display).
  historicalYears: HistoricalYear[];
  lineView: LineView;
}

interface HistoryRow {
  label: string;
  value: (year: HistoricalYear) => string;
  className?: (year: HistoricalYear) => string;
}

export default function HistoryPage({ historicalYears, lineView }: HistoryPageProps) {
  if (historicalYears.length === 0) return null;

  const first = historicalYears[0];
  const last = historicalYears[historicalYears.length - 1];
  const combinedChange = last.actualCombinedRatio - first.actualCombinedRatio;
  const surplusChange = last.endingSurplus - first.endingSurplus;
  const memberChange = last.activeMembers - first.activeMembers;
  const exposureLabel = lineView === 'Property' ? 'TIV Exposure' : 'Payroll Exposure';

  const operatingRows: HistoryRow[] = [
    { label: 'Active Members', value: year => String(year.activeMembers) },
    { label: exposureLabel, value: year => formatMillions(year.activeExposure) },
    { label: 'Market Share (% of Exposure)', value: year => formatPct(year.marketShare) },
    { label: 'Pool Premium Rate per $100 Payroll', value: year => `$${year.poolPremiumRatePer100.toFixed(2)}` },
  ];

  const performanceRows: HistoryRow[] = [
    { label: 'Pool Premium', value: year => formatCurrency(year.poolPremium) },
    { label: 'Admin Expense', value: year => formatCurrency(year.adminExpense) },
    { label: 'Pool Premium & Admin Expense', value: year => formatCurrency(year.poolPremiumAndAdminExpense) },
    { label: 'Reinsurance Cost', value: year => formatCurrency(year.reinsuranceCost) },
    { label: 'Gross Premium & Admin Expense', value: year => formatCurrency(year.totalMemberCharge) },
    { label: 'Ultimate Losses', value: year => formatCurrency(year.grossUltimateLoss) },
    { label: 'Pool Losses', value: year => formatCurrency(year.poolLosses) },
    { label: 'Excess Losses', value: year => formatCurrency(year.excessLosses) },
    { label: 'Quota Share Losses', value: year => formatCurrency(year.quotaShareLosses) },
    { label: 'Reinsurance Losses', value: year => formatCurrency(year.reinsuranceRecovery) },
    { label: 'Net Ultimate Loss', value: year => formatCurrency(year.netUltimateLoss) },
    {
      label: 'Actual Combined Ratio',
      value: year => formatPct(year.actualCombinedRatio),
      className: year => colorForRatio(year.actualCombinedRatio),
    },
    {
      label: 'Underwriting Income',
      value: year => formatCurrency(year.underwritingIncome),
      className: year => year.underwritingIncome >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
    { label: 'Investment Income', value: year => formatCurrency(year.investmentIncome) },
    {
      label: 'Total Income',
      value: year => formatCurrency(year.netIncome),
      className: year => year.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
  ];

  const capitalRows: HistoryRow[] = [
    { label: 'Unpaid Claims Outstanding (net)', value: year => formatCurrency(year.endingNetReserve) },
    { label: 'Required Reserve Margin', value: year => formatCurrency(year.requiredReserveMargin) },
    {
      label: 'Ending Surplus',
      value: year => formatCurrency(year.endingSurplus),
      className: year => year.endingSurplus >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
    {
      label: 'Excess Capital Status',
      value: year => year.capitalAdequacyStatus,
      className: year => capitalStatusColor(year.capitalAdequacyStatus),
    },
  ];

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900">Three-Year {lineDisplayName(lineView)} History</h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Activity size={17} />}
          label="Latest Actual Combined Ratio"
          value={formatPct(last.actualCombinedRatio)}
          detail={`${combinedChange >= 0 ? 'Up' : 'Down'} ${formatPct(Math.abs(combinedChange))} over the history`}
          valueClass={colorForRatio(last.actualCombinedRatio)}
        />
        <SummaryCard
          icon={<DollarSign size={17} />}
          label="Opening Surplus"
          value={formatCurrency(last.endingSurplus, true)}
          detail={`${surplusChange >= 0 ? 'Increased' : 'Decreased'} ${formatCurrency(Math.abs(surplusChange), true)} over history`}
          valueClass={last.endingSurplus >= 0 ? 'text-emerald-600' : 'text-red-600'}
        />
        <SummaryCard
          icon={<Users size={17} />}
          label="Opening Membership"
          value={String(last.activeMembers)}
          detail={`${memberChange >= 0 ? '+' : ''}${memberChange} members over history`}
          valueClass="text-gray-900"
        />
        <SummaryCard
          icon={<Shield size={17} />}
          label="Opening Excess Capital Status"
          value={last.capitalAdequacyStatus}
          detail={`Required margin ${formatCurrency(last.requiredReserveMargin, true)}`}
          valueClass={capitalStatusColor(last.capitalAdequacyStatus)}
        />
      </div>

      <HistoryTable title="Membership & Rates" icon={<Users size={17} />} years={historicalYears} rows={operatingRows} />
      <HistoryTable title="Premium, Losses & Income" icon={<Activity size={17} />} years={historicalYears} rows={performanceRows} />
      <HistoryTable title="Reserves & Capital" icon={<Shield size={17} />} years={historicalYears} rows={capitalRows} />

      <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-600">
        This history is read-only, simulated through the real engine at default decisions before play begins
        (each line runs its own past), and does not consume any of the player’s decision years.
      </div>
    </div>
  );
}

function HistoryTable({
  title,
  icon,
  years,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  years: HistoricalYear[];
  rows: HistoryRow[];
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[260px]"></th>
              {years.map((year, index) => (
                <th key={year.calendarYear} className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[150px]">
                  {year.calendarYear}
                  {index === years.length - 1 && (
                    <span className="block text-[10px] text-blue-600 normal-case tracking-normal mt-0.5">Opening / Year 0</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.label} className="hover:bg-gray-50">
                <td className="px-5 py-3 text-gray-600">{row.label}</td>
                {years.map((year, index) => (
                  <td
                    key={`${row.label}-${year.calendarYear}`}
                    className={`px-5 py-3 text-right font-medium ${index === years.length - 1 ? 'bg-blue-50/40' : ''} ${row.className?.(year) ?? 'text-gray-900'}`}
                  >
                    {row.value(year)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  valueClass: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <span className="text-blue-600">{icon}</span>
        {label}
      </div>
      <div className={`text-2xl font-bold mt-2 ${valueClass}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{detail}</div>
    </div>
  );
}

function capitalStatusColor(status: string): string {
  if (status === 'Strong' || status === 'Adequate') return 'text-emerald-600';
  if (status === 'Thin') return 'text-amber-600';
  if (status === 'Deficient') return 'text-red-600';
  return 'text-gray-500';
}
