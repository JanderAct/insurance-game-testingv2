import { useState } from 'react';
import { ScrollText, ArrowUpDown } from 'lucide-react';
import type { LineResultSet, LineView } from '../types/simulation';
import { REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';

interface DecisionHistoryPageProps {
  lockedResults: LineResultSet[];
  lineView: LineView;
}

function pctDisplay(v: number, decimals = 1): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

function rateDisplay(v: number): string {
  return v >= 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`;
}

export default function DecisionHistoryPage({ lockedResults, lineView }: DecisionHistoryPageProps) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const rows = [...lockedResults].sort((a, b) =>
    sortDir === 'asc' ? a.yearNumber - b.yearNumber : b.yearNumber - a.yearNumber
  );

  // Only show the loan repayment column at all if this line ever had loan
  // activity — avoids a permanently-empty column for the common no-loan case.
  const showLoanColumn = lineView !== 'pool' && lockedResults.some(
    r => r.outstandingLoanBalance > 0 || r.loanOriginatedThisYear > 0
  );

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Decision History{lineView !== 'pool' ? ` — ${lineView}` : ''}</h2>
          <p className="text-gray-500 text-sm">
            {lineView === 'pool'
              ? 'Every locked year\'s pool-level asset allocation.'
              : `Every locked year's decisions for the ${lineView} line.`}
          </p>
        </div>
        {rows.length > 1 && (
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 border border-gray-200"
          >
            <ArrowUpDown size={14} /> {sortDir === 'asc' ? 'Oldest First' : 'Newest First'}
          </button>
        )}
      </div>

      {lineView !== 'pool' && lineView !== 'WC' && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Per-line decision editing for {lineView} isn't available yet — every year below reflects that line's fixed default decisions, not a player choice.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <ScrollText size={48} className="mx-auto mb-4 opacity-30" />
          <p className="font-medium text-lg">No decision history yet</p>
          <p className="text-sm mt-1">Lock a year to start building the history for this view.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {(lineView === 'pool'
                    ? ['Yr', 'Calendar', 'Cash %', 'Bonds %', 'Equities %']
                    : [
                        'Yr', 'Calendar', 'Rate Change', 'Funding Confidence', 'Dividend %', 'Assessment %',
                        'Underwriting Strictness', 'Risk Control %', 'Reinsurance Level',
                        ...(showLoanColumn ? ['Loan Repayment Aggressiveness'] : []),
                      ]
                  ).map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.yearNumber} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-gray-900">{r.yearNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{r.calendarYear}</td>
                    {lineView === 'pool' ? (
                      <>
                        <td className="px-4 py-3">{r.assetAllocation.cashPct.toFixed(0)}%</td>
                        <td className="px-4 py-3">{r.assetAllocation.bondsPct.toFixed(0)}%</td>
                        <td className="px-4 py-3">{r.assetAllocation.equitiesPct.toFixed(0)}%</td>
                      </>
                    ) : (
                      <>
                        <td className={`px-4 py-3 font-medium ${r.decisions.rateChange > 0.05 ? 'text-amber-600' : r.decisions.rateChange < -0.05 ? 'text-blue-600' : 'text-gray-700'}`}>
                          {rateDisplay(r.decisions.rateChange)}
                        </td>
                        <td className="px-4 py-3">{pctDisplay(r.decisions.fundingConfidenceLevel, 0)}</td>
                        <td className="px-4 py-3">
                          {pctDisplay(r.decisions.dividendPct)}
                          {r.dividendBlocked && <span className="text-red-600 text-xs ml-1">(blocked)</span>}
                        </td>
                        <td className="px-4 py-3">{pctDisplay(r.decisions.assessmentPct)}</td>
                        <td className="px-4 py-3">{r.decisions.underwritingStrictness} / 10</td>
                        <td className="px-4 py-3">{pctDisplay(r.decisions.riskControlPct)}</td>
                        <td className="px-4 py-3">
                          {r.decisions.reinsuranceLevel} — {REINSURANCE_PROGRAMS[r.decisions.reinsuranceLevel]?.label ?? ''}
                        </td>
                        {showLoanColumn && (
                          <td className="px-4 py-3">
                            {(r.outstandingLoanBalance > 0 || r.loanOriginatedThisYear > 0)
                              ? pctDisplay(r.decisions.loanRepaymentAggressiveness, 0)
                              : <span className="text-gray-400">—</span>}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
