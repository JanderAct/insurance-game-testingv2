import { TrendingUp, Users, Shield, DollarSign, Activity, BarChart2, Globe, Star } from 'lucide-react';
import type { LineResultSet, StartingFinancials, HistoricalYear, LineView } from '../types/simulation';
import StatCard from '../components/StatCard';
import { formatCurrency, formatPct, colorForRatio, colorForSurplus } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';

interface DashboardPageProps {
  lockedResults: LineResultSet[];
  historicalYears: HistoricalYear[];
  startingFinancials: StartingFinancials;
  currentYearNumber: number;
  lineView: LineView;
}

export default function DashboardPage({ lockedResults, historicalYears, startingFinancials, currentYearNumber, lineView }: DashboardPageProps) {
  // Stage 2.10: the last historical entry is the real year 0 — the simulated
  // pre-game year whose ending position IS the Year 1 opening. It renders as
  // the highlighted Year 0 row; earlier entries (-2, -1) render above it.
  const priorHistoricalYears = historicalYears.slice(0, -1);
  const openingYear = historicalYears[historicalYears.length - 1];
  const last = lockedResults[lockedResults.length - 1];

  // Fallbacks before any live year is locked come from the view-filtered
  // year-0 history entry (per-line correct), then pool-level startingFinancials.
  const displaySurplus = last?.endingSurplus ?? openingYear?.endingSurplus ?? startingFinancials.surplus;
  const displayPremium = last?.totalMemberCharge ?? openingYear?.totalMemberCharge ?? startingFinancials.annualPremium;
  const displayLossRatio = last ? last.poolLosses / Math.max(last.poolPremium, 1) : undefined;
  const displayUnderwritingIncome = last?.underwritingIncome;
  const displayInvestmentIncome = last?.investmentIncome;
  const displayMembers = last?.activeMembers ?? openingYear?.activeMembers ?? startingFinancials.activeMembers;
  const displayExposure = last?.activeExposure ?? openingYear?.activeExposure ?? startingFinancials.activeExposure;
  const displayMarketShare = last?.marketShare ?? openingYear?.marketShare ?? startingFinancials.marketShare;
  const displaySatisfaction = last?.memberSatisfaction ?? startingFinancials.memberSatisfaction;
  const displayFunding = last?.capitalAdequacyStatus ?? openingYear?.capitalAdequacyStatus ?? 'Not yet calculated';

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Dashboard{lineView !== 'pool' ? ` — ${lineDisplayName(lineView)}` : ''}</h2>
        <p className="text-gray-500 text-sm">
          {lockedResults.length === 0
            ? 'Starting position — no years completed yet.'
            : `Through Year ${currentYearNumber - 1} — ${lockedResults.length} year${lockedResults.length !== 1 ? 's' : ''} completed`}
        </p>
        {lineView !== 'pool' && (
          <p className="text-xs text-amber-600 mt-1">
            Showing the {lineDisplayName(lineView)} line's own figures — including its own simulated pre-game history (Stage 2.10).
          </p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Surplus"
          value={formatCurrency(displaySurplus, true)}
          valueColor={colorForSurplus(displaySurplus)}
          icon={<DollarSign size={16} />}
          sub={last ? `Prior: ${formatCurrency(last.beginingSurplus, true)}` : 'Starting position'}
        />
        <StatCard
          label="Gross Premium & Admin Expense"
          value={formatCurrency(displayPremium, true)}
          icon={<TrendingUp size={16} />}
          sub={`$${formatNumber(displayExposure, 2)}M payroll`}
        />
        <StatCard
          label="Pool Loss Ratio"
          value={displayLossRatio !== undefined ? formatPct(displayLossRatio) : '—'}
          valueColor={displayLossRatio !== undefined ? colorForRatio(displayLossRatio) : 'text-gray-400'}
          icon={<Activity size={16} />}
          sub="Pool losses ÷ pool premium"
        />
        <StatCard
          label="Underwriting Income"
          value={displayUnderwritingIncome !== undefined ? formatCurrency(displayUnderwritingIncome, true) : '—'}
          valueColor={displayUnderwritingIncome !== undefined ? (displayUnderwritingIncome >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-400'}
          icon={<Activity size={16} />}
          sub="Excl. investment income"
        />
        <StatCard
          label="Investment Income"
          value={displayInvestmentIncome !== undefined ? formatCurrency(displayInvestmentIncome, true) : '—'}
          valueColor={displayInvestmentIncome !== undefined ? (displayInvestmentIncome >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-gray-400'}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="Market Share"
          value={formatPct(displayMarketShare)}
          valueColor="text-sky-600"
          icon={<Globe size={16} />}
          sub="Exposure-based"
        />
        <StatCard
          label="Active Members"
          value={String(displayMembers)}
          icon={<Users size={16} />}
          sub={`of 100 market members`}
        />
        <StatCard
          label="Member Satisfaction"
          value={`${displaySatisfaction.toFixed(1)} / 10`}
          icon={<Star size={16} />}
          valueColor={displaySatisfaction >= 7 ? 'text-emerald-600' : displaySatisfaction >= 5 ? 'text-amber-600' : 'text-red-600'}
        />
        <StatCard
          label="Excess Capital Status"
          value={displayFunding}
          valueColor={
            displayFunding === 'Strong' || displayFunding === 'Adequate' ? 'text-emerald-600' :
            displayFunding === 'Thin' ? 'text-amber-600' :
            displayFunding === 'Not yet calculated' ? 'text-gray-500' : 'text-red-600'
          }
          icon={<Shield size={16} />}
        />
        <StatCard
          label="Payroll Exposure ($M)"
          value={`$${formatNumber(displayExposure, 2)}M`}
          icon={<BarChart2 size={16} />}
          sub={`Market total: $${formatNumber(startingFinancials.totalMarketExposure, 2)}M`}
        />
      </div>

      {/* Locked Year Summary Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <BarChart2 size={18} className="text-blue-600" />
          <h3 className="font-bold text-gray-900">Annual Summary</h3>
          {priorHistoricalYears.length > 0 && (
            <span className="text-xs text-gray-400 font-normal">— years before 0 are pre-game history (see Pool History tab)</span>
          )}
        </div>

        <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Yr', 'Calendar', 'Gross Premium & Admin Expense', 'Gross Loss', 'Net Loss', 'Pool Loss Ratio', 'Underwriting Income', 'Investment Income', 'Total Income', 'Ending Surplus', 'Members', 'Mkt Share'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {priorHistoricalYears.map(year => (
                  <tr key={year.historyYearNumber} className="hover:bg-gray-50 transition-colors text-gray-500">
                    <td className="px-4 py-3 font-bold">{year.historyYearNumber}</td>
                    <td className="px-4 py-3">{year.calendarYear}</td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(year.totalMemberCharge, true)}</td>
                    <td className="px-4 py-3">{formatCurrency(year.grossUltimateLoss, true)}</td>
                    <td className="px-4 py-3">{formatCurrency(year.netUltimateLoss, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${colorForRatio(year.poolLosses / Math.max(year.poolPremium, 1))}`}>{formatPct(year.poolLosses / Math.max(year.poolPremium, 1))}</td>
                    <td className={year.underwritingIncome >= 0 ? 'px-4 py-3 text-emerald-600/70' : 'px-4 py-3 text-red-600/70'}>{formatCurrency(year.underwritingIncome, true)}</td>
                    <td className="px-4 py-3">{formatCurrency(year.investmentIncome, true)}</td>
                    <td className={year.netIncome >= 0 ? 'px-4 py-3 font-semibold text-emerald-600/70' : 'px-4 py-3 font-semibold text-red-600/70'}>{formatCurrency(year.netIncome, true)}</td>
                    <td className="px-4 py-3 font-bold">{formatCurrency(year.endingSurplus, true)}</td>
                    <td className="px-4 py-3">{year.activeMembers}</td>
                    <td className="px-4 py-3 text-sky-600/70 font-medium">{formatPct(year.marketShare)}</td>
                  </tr>
                ))}
                {openingYear && (
                  <tr className="bg-blue-50/40 hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-gray-900">0</td>
                    <td className="px-4 py-3 text-gray-600">{openingYear.calendarYear}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(openingYear.totalMemberCharge, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(openingYear.grossUltimateLoss, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(openingYear.netUltimateLoss, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${colorForRatio(openingYear.poolLosses / Math.max(openingYear.poolPremium, 1))}`}>{formatPct(openingYear.poolLosses / Math.max(openingYear.poolPremium, 1))}</td>
                    <td className={openingYear.underwritingIncome >= 0 ? 'px-4 py-3 text-emerald-600/70' : 'px-4 py-3 text-red-600/70'}>{formatCurrency(openingYear.underwritingIncome, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(openingYear.investmentIncome, true)}</td>
                    <td className={openingYear.netIncome >= 0 ? 'px-4 py-3 font-semibold text-emerald-600/70' : 'px-4 py-3 font-semibold text-red-600/70'}>{formatCurrency(openingYear.netIncome, true)}</td>
                    <td className={`px-4 py-3 font-bold ${colorForSurplus(openingYear.endingSurplus)}`}>{formatCurrency(openingYear.endingSurplus, true)}</td>
                    <td className="px-4 py-3 text-gray-600">{openingYear.activeMembers}</td>
                    <td className="px-4 py-3 text-sky-600 font-medium">{formatPct(openingYear.marketShare)}</td>
                  </tr>
                )}
                {lockedResults.map(r => (
                  <tr key={r.yearNumber} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-gray-900">{r.yearNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{r.calendarYear}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatCurrency(r.totalMemberCharge, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(r.grossUltimateLoss, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(r.netUltimateLoss, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${colorForRatio(r.poolLosses / Math.max(r.poolPremium, 1))}`}>{formatPct(r.poolLosses / Math.max(r.poolPremium, 1))}</td>
                    <td className={`px-4 py-3 font-medium ${r.underwritingIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(r.underwritingIncome, true)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(r.investmentIncome, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${r.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(r.netIncome, true)}
                    </td>
                    <td className={`px-4 py-3 font-bold ${colorForSurplus(r.endingSurplus)}`}>
                      {formatCurrency(r.endingSurplus, true)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.activeMembers}</td>
                    <td className="px-4 py-3 text-sky-600 font-medium">{formatPct(r.marketShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}

function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
