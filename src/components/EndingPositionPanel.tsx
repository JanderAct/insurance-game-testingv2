import { Scale } from 'lucide-react';
import type { EndingPositionRow } from '../utils/endingPosition';
import { formatCurrency } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';
import type { CoverageLine } from '../types/simulation';

// ============================================================================
// THE ENDING POSITION — surplus beside what is still owed against it.
//
// ⚠ THIS IS NOT FILTERED BY THE LINE VIEW, AND THAT IS THE POINT. Every other
// panel on this page shows the line the player has selected. This one always
// shows all three plus the pool, because the CONTRAST is the lesson — measured
// at year 5, the share of everything booked that is still unpaid runs WC 50%,
// GL 50%, Property 22%. Filtering to one line would show a player their
// long-tail reserve with nothing to compare it against.
//
// ⚠ SURPLUS AND THE NET FIGURE ARE BOTH SHOWN, DELIBERATELY. The surplus is what
// the balance sheet says; the net figure is what it means. A player has to see
// them disagree — replacing the first with the second would teach that the game
// simply reports a different number than they thought, rather than that the
// number they were watching was incomplete.
// ============================================================================

interface Props {
  rows: EndingPositionRow[];
  /** True once the final year is locked — gates the deficiency row. */
  complete: boolean;
}

export default function EndingPositionPanel({ rows, complete }: Props) {
  if (rows.length === 0) return null;
  const anyDeficiency = rows.some(r => r.deficiency !== null && r.deficiency !== 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <Scale size={18} className="text-blue-600" />
        <h3 className="font-bold text-gray-900">
          {complete ? 'Ending Position' : 'Position to Date'}
        </h3>
        <span className="text-xs text-gray-400 font-normal">
          — surplus against what is still owed, every line
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Line</th>
              {['Ending surplus', 'Outstanding claim liability',
                ...(anyDeficiency ? ['Reserve deficiency not yet emerged'] : []),
                'Surplus net of outstanding', 'Outstanding ÷ premium', 'Still open, of all booked'].map(h => (
                <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const pool = r.key === 'pool';
              return (
                <tr key={r.key} className={pool ? 'bg-gray-50 font-semibold' : ''}>
                  <td className="px-4 py-2.5 text-gray-900 whitespace-nowrap">
                    {pool ? 'Pool' : lineDisplayName(r.key as CoverageLine)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                    {formatCurrency(r.endingSurplus, true)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    ({formatCurrency(r.outstanding, true)})
                  </td>
                  {anyDeficiency && (
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                      {r.deficiency === null ? '—' : `(${formatCurrency(r.deficiency, true)})`}
                    </td>
                  )}
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                    r.netOfOutstanding >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {formatCurrency(r.netOfOutstanding, true)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {r.outstandingToPremium === null ? '—' : `${r.outstandingToPremium.toFixed(2)}x`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                    {r.outstandingToBooked === null ? '—' : `${(100 * r.outstandingToBooked).toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 space-y-1.5">
        <p>
          <span className="font-semibold">Outstanding claim liability</span> is the booked reserve — claims
          already incurred and not yet paid, net of reinsurance. It is a real obligation, not a forecast, and
          the surplus above it has not been earned until it runs off. A short-tail line settles most of it
          within a year or two; a long-tail line can carry several years of premium in it indefinitely, which
          is why the last two columns differ so much between lines.
        </p>
        <p>
          The two ratios answer different questions.{' '}
          <span className="font-semibold">Outstanding ÷ premium</span> is how many years of income the
          liability is worth — but it moves with your own funding choice, since underpricing shrinks the
          denominator.{' '}
          <span className="font-semibold">Still open, of all booked</span> is the share of every loss booked
          so far that has not yet been paid. That one is independent of pricing, so it is the one that
          measures the tail rather than the decision.
        </p>
        {anyDeficiency && (
          <p>
            <span className="font-semibold text-amber-700">Reserve deficiency not yet emerged</span> is what the
            booked reserve is still short by because an optimistic funding choice has not finished unwinding.
            It is a stated estimate of scheduled emergence, not a reveal of the true ultimate — actual
            development on top of it may be better or worse and is not implied to be zero.
          </p>
        )}
        {!complete && (
          <p className="text-gray-500">
            The deficiency line is disclosed when the game ends.
          </p>
        )}
      </div>
    </div>
  );
}
