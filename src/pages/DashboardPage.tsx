import { TrendingUp, Users, Shield, DollarSign, Activity, BarChart2, Globe, Star } from 'lucide-react';
import type { LineResultSet, StartingFinancials, HistoricalYear, LineView } from '../types/simulation';
import StatCard from '../components/StatCard';
import { formatCurrency, formatMillions, formatPct, colorForRatio, colorForSurplus } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';
import EndingPositionPanel from '../components/EndingPositionPanel';
import type { EndingPositionRow } from '../utils/endingPosition';

interface DashboardPageProps {
  lockedResults: LineResultSet[];
  historicalYears: HistoricalYear[];
  startingFinancials: StartingFinancials;
  currentYearNumber: number;
  lineView: LineView;
  // Every line plus the pool, unfiltered by lineView — see EndingPositionPanel.
  endingPositionRows: EndingPositionRow[];
  gameComplete: boolean;
}

/** The pricing-basis loss ratio for a seeded history year.
 *
 *  ⚠ RECOMPUTED WHEN THE FIELD IS ABSENT, NOT DEFAULTED TO ZERO. A save written
 *  before `actualLossRatioPricingBasis` existed carries the dollar fields but
 *  not the ratio, and a `?? 0` there would print a confident 0.0% for every
 *  pre-game year. Both inputs are present in every save, so the fallback is the
 *  same division the engine does rather than a placeholder. */
function historicalPricingBasisLR(y: HistoricalYear): number {
  return y.actualLossRatioPricingBasis
    ?? y.netUltimateLoss / Math.max(y.poolPremiumAndAdminExpense, 1);
}

export default function DashboardPage({ lockedResults, historicalYears, startingFinancials, currentYearNumber, lineView, endingPositionRows, gameComplete }: DashboardPageProps) {
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
  // PRICING BASIS — see the display note at Header.tsx for why the
  // member-charge figure cannot carry a headline. Still on the result, still
  // exported, still shown with its basis spelled out on the Results detail.
  const displayLossRatio = last?.actualLossRatioPricingBasis;
  const displayLossRatioRetained = last?.actualLossRatioRetainedPremium;
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
        {/* ⚠ THE LABEL NAMED THE OTHER DENOMINATOR. This card renders
            totalMemberCharge — pool premium + admin + REINSURANCE — under a
            label that reads exactly like `poolPremiumAndAdminExpense`, the
            field beside it. With the loss-ratio card now on the pricing basis,
            a reader who divided the two numbers shown here would have got a
            third answer again. */}
        <StatCard
          label="Total Member Charge"
          value={formatCurrency(displayPremium, true)}
          icon={<TrendingUp size={16} />}
          sub={`Premium + admin + reinsurance · ${formatMillions(displayExposure)} payroll`}
        />
        <StatCard
          label="Loss Ratio (prem + admin)"
          value={displayLossRatio !== undefined ? formatPct(displayLossRatio) : '—'}
          valueColor={displayLossRatio !== undefined ? colorForRatio(displayLossRatio) : 'text-gray-400'}
          icon={<Activity size={16} />}
          sub={displayLossRatioRetained !== undefined
            ? `Net loss ÷ premium + admin · ${formatPct(displayLossRatioRetained)} of retained premium`
            : 'Net incurred loss ÷ pool premium + admin expense'}
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
          value={formatMillions(displayExposure)}
          icon={<BarChart2 size={16} />}
          sub={`Market total: ${formatMillions(startingFinancials.totalMarketExposure)}`}
        />
      </div>

      {/* ⚠ ABOVE THE ANNUAL SUMMARY, NOT BELOW IT. Ending surplus is the last
          figure a player reads and the one they carry away; the reserve standing
          against it has to be in the same eyeline, not underneath a table they
          have already stopped scrolling through. */}
      <EndingPositionPanel rows={endingPositionRows} complete={gameComplete} />

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
                  {['Yr', 'Calendar', 'Total Member Charge', 'Prem + Admin', 'Gross Loss', 'Net Loss', 'Loss Ratio (prem + admin)', 'Underwriting Income', 'Investment Income', 'Total Income', 'Ending Surplus', 'Members', 'Mkt Share'].map(h => (
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
                    <td className="px-4 py-3">{formatCurrency(year.poolPremiumAndAdminExpense, true)}</td>
                    <td className="px-4 py-3">{formatCurrency(year.grossUltimateLoss, true)}</td>
                    <td className="px-4 py-3">{formatCurrency(year.netUltimateLoss, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${colorForRatio(historicalPricingBasisLR(year))}`}>{formatPct(historicalPricingBasisLR(year))}</td>
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
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(openingYear.poolPremiumAndAdminExpense, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(openingYear.grossUltimateLoss, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(openingYear.netUltimateLoss, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${colorForRatio(historicalPricingBasisLR(openingYear))}`}>{formatPct(historicalPricingBasisLR(openingYear))}</td>
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
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(r.poolPremiumAndAdminExpense, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(r.grossUltimateLoss, true)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(r.netUltimateLoss, true)}</td>
                    <td className={`px-4 py-3 font-semibold ${colorForRatio(r.actualLossRatioPricingBasis)}`}>{formatPct(r.actualLossRatioPricingBasis)}</td>
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
