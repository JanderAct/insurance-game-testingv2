import { useMemo, useState } from 'react';
import type { DecisionSet, GameState } from '../types/simulation';
import DocumentReader, { type DocumentEntry } from '../components/DocumentReader';
import investmentMemoRaw from '../data/documents/investmentMemo.md?raw';
import { buildActuarialMemo } from '../utils/actuarialMemo';
import { buildClaimsMemo } from '../utils/claimsMemo';
import { buildRiskControlMemo } from '../utils/riskControlMemo';
import { buildUnderwritingMemo } from '../utils/underwritingMemo';

interface DepartmentsPageProps {
  gameState: GameState;
  /** The decisions the player is editing NOW — not gameState.currentDecisions,
   *  which resets to defaults the moment a year locks. See buildUnderwritingMemo. */
  currentDecisions: DecisionSet;
}

// Actuarial and Claims memos will be regenerated every year, so the year
// selector is built now even though Investment (this pass's only occupant) is
// static and does not yet vary by year — retrofitting a selector once those
// two exist would mean reworking this tab's shape, not just adding rows.
export default function DepartmentsPage({ gameState, currentDecisions }: DepartmentsPageProps) {
  const [selectedYear, setSelectedYear] = useState(gameState.currentYearNumber);
  const [selectedId, setSelectedId] = useState('investment');

  const years = Array.from({ length: gameState.currentYearNumber }, (_, i) => i + 1);

  // Rebuilt only when the year or the underlying state moves. The exhibit walks
  // every accident year's whole valuation history for every line, so it is not
  // work to redo on an unrelated re-render.
  const actuarialMemo = useMemo(
    () => buildActuarialMemo({ gameState, asAtYear: selectedYear }),
    [gameState, selectedYear],
  );

  // Memoised on the same rule as the other two: it walks the whole marketplace
  // and every member's stored history for each active line.
  const underwritingMemo = useMemo(
    () => buildUnderwritingMemo(gameState, currentDecisions),
    [gameState, currentDecisions],
  );

  // ⚠ NOT KEYED TO selectedYear, AND IT USED TO BE. The listing is struck at a
  // valuation and it resolves that valuation itself — see ClaimsMemoInput for
  // why the selected year could not be honoured: claim status would move with
  // the selection while Paid and Incurred, which come from live cohort state,
  // would not. Passing the year in was what made the two disagree, so the year
  // is no longer passed in. The selector still drives the actuarial memorandum,
  // which keeps a real valuation history, and that document says so.
  //
  // It rebuilds the whole book to split paid per accident year, which is 41 ms
  // on a reloaded game, so it is still memoised.
  const claimsMemo = useMemo(
    () => buildClaimsMemo({ gameState }),
    [gameState],
  );

  const documents: DocumentEntry[] = [
    {
      id: 'actuarial',
      title: 'Actuarial',
      summary: 'Reserve development by accident year',
      content: actuarialMemo,
    },
    {
      id: 'claims',
      title: 'Claims',
      summary: 'Large loss listing by member and status',
      content: claimsMemo,
    },
    {
      // ⚠ GATED BY activeLines, WHICH IS WHY IT IS BUILT AND NOT A STATIC .md.
      // Its own second paragraph promises that line-specific programs appear
      // only if the pool writes that coverage, so the list has to honour it.
      id: 'riskControl',
      title: 'Risk Control',
      summary: 'Programs available for management consideration',
      content: buildRiskControlMemo(gameState.setup.activeLines),
    },
    {
      // ⚠ THE ONLY DOCUMENT WHOSE CONTENT IS A FUNCTION OF THE YEAR. Risk
      // Control is prose; Actuarial and Claims are generated but describe the
      // pool. This lists a SET that turns over every year — different
      // candidates, different members over the bar — so its fingerprint differs
      // between year points by design, where the others mostly do not.
      id: 'underwriting',
      title: 'Underwriting',
      summary: 'Membership, applicants, and risk profile',
      content: underwritingMemo,
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
