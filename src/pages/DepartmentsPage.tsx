import { useState } from 'react';
import type { GameState } from '../types/simulation';
import DocumentReader, { type DocumentEntry } from '../components/DocumentReader';
import investmentMemoRaw from '../data/documents/investmentMemo.md?raw';

interface DepartmentsPageProps {
  gameState: GameState;
}

// Actuarial and Claims memos will be regenerated every year, so the year
// selector is built now even though Investment (this pass's only occupant) is
// static and does not yet vary by year — retrofitting a selector once those
// two exist would mean reworking this tab's shape, not just adding rows.
export default function DepartmentsPage({ gameState }: DepartmentsPageProps) {
  const [selectedYear, setSelectedYear] = useState(gameState.currentYearNumber);
  const [selectedId, setSelectedId] = useState('investment');

  const years = Array.from({ length: gameState.currentYearNumber }, (_, i) => i + 1);

  const documents: DocumentEntry[] = [
    {
      id: 'actuarial',
      title: 'Actuarial',
      summary: 'Loss trends and funding adequacy',
      notBuiltNote: 'The Actuarial Department has not filed a memorandum yet.',
    },
    {
      id: 'claims',
      title: 'Claims',
      summary: 'Recent losses and reserve development',
      notBuiltNote: 'The Claims Department has not filed a memorandum yet.',
    },
    {
      id: 'underwriting',
      title: 'Underwriting',
      summary: 'Membership, applicants, and risk profile',
      notBuiltNote: 'The Underwriting Department has not filed a memorandum yet.',
    },
    {
      id: 'investment',
      title: 'Investment',
      summary: 'Strategy, asset allocation, and liquidity',
      content: investmentMemoRaw,
    },
  ];

  const listHeader = (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Year</label>
      <select
        value={selectedYear}
        onChange={e => setSelectedYear(parseInt(e.target.value))}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
      >
        {years.map(y => (
          <option key={y} value={y}>Year {y}</option>
        ))}
      </select>
    </div>
  );

  return (
    <DocumentReader
      documents={documents}
      selectedId={selectedId}
      onSelect={setSelectedId}
      listHeader={listHeader}
    />
  );
}
