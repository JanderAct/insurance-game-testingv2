// The year this browser just played, shown to the team that played it.
//
// Read from the LOCAL ResultSet rather than from the posted summary: this
// browser computed the full result and holds all of it, so there is no reason to
// render the compacted scoreboard copy back to the team that produced it.

import type { ResultSet } from '../../types/simulation';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function TeamResultCard({ result }: { result: ResultSet }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Gross premium', value: money(result.grossPremium) },
    { label: 'Net incurred loss', value: money(result.netIncurredLoss) },
    { label: 'Net income', value: money(result.netIncome) },
    { label: 'Ending surplus', value: money(result.endingSurplus) },
    { label: 'Active members', value: String(result.activeMembers) },
  ];

  return (
    <div data-testid="result-card" className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Year {result.yearNumber} result · {result.calendarYear}
      </p>
      <dl className="mt-3 space-y-1.5">
        {rows.map(r => (
          <div key={r.label} className="flex justify-between text-sm">
            <dt className="text-slate-500">{r.label}</dt>
            <dd data-testid={`result-${r.label.replace(/\s+/g, '-').toLowerCase()}`} className="font-medium text-slate-800">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
