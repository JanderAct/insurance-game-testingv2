import { useState } from 'react';
import type { GameState } from '../types/simulation';
import { getMemberExposure } from '../utils/lineHelpers';
import { formatMillions, formatCurrency } from '../utils/formatters';
import { LINE_FULL_NAME } from '../utils/lineDisplay';
import { applyTemplate } from '../utils/renderMarkdown';
import DocumentReader, { type DocumentEntry } from '../components/DocumentReader';
import welcomeMemoRaw from '../data/documents/welcomeMemo.md?raw';
import howToPlayRaw from '../data/documents/howToPlay.md?raw';

interface IntroductionPageProps {
  gameState: GameState;
}

// "A", "A and B", or "A, B, and C" — Intl.ListFormat needs a newer lib target
// than this project's tsconfig carries, so joined by hand instead of pulling
// that in for one call site.
function formatConjunctionList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// The Welcome Memorandum is dated Year 1 and addressed to an incoming team —
// it must always describe the Pool's OPENING position, not whatever year the
// player has actually reached. priorHistory's last entry (year 0's ending
// state) IS that opening position (see Stage 2.10 in App.tsx), so this reads
// from priorHistory rather than lockedResults regardless of current year.
//
// ⚠ THE ROSTER FIELDS READ `opening.memberList`, NOT `poolState`, AND THAT IS
// THE WHOLE POINT OF THIS FUNCTION. They used to come from
// poolState.allMarketMembers — LIVE state — so the three of them tracked
// attrition and joining while the six around them stayed pinned. A memo dated
// Year 1 then told an incoming team the Pool "currently serves 133 of 200" when
// 141 were enrolled at the opening: measured at 141 -> 133 members,
// $849.87M -> $813.58M payroll and $39.91B -> $36.88B TIV over eight years.
// priorHistory is frozen once written, so reading the roster from it makes the
// memo read identically in year 9 as in year 1.
//
// ⚠ NOT `opening.activeMembers`, which is a DIFFERENT QUANTITY. That field sums
// per-line enrolments, so a member carrying two lines counts twice — it read 191
// against a 131-member roster on the seed this was checked on. `memberList` is
// the distinct roster and is what the live computation it replaces agreed with.
//
// `totalMemberCount` stays on poolState because the marketplace is a fixed
// 200-member roster whose length never changes — members change STATUS, none are
// added or removed (verified constant at 200 across 12 years and three seeds).
// There is no equivalent field on ResultSet to move it to.
function buildWelcomeMemoValues(gameState: GameState): Record<string, string> {
  const { setup, poolState, priorHistory } = gameState;
  const opening = priorHistory[priorHistory.length - 1];

  // Filtered rather than taken wholesale: memberList is all-active as written
  // today, and this keeps the semantics correct if that ever stops being true.
  const enrolledMembers = opening.memberList.filter(m => m.status === 'active');
  const enrolledPayrollM = enrolledMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC', 1), 0);
  const enrolledTIVM = enrolledMembers.reduce((sum, m) => sum + getMemberExposure(m, 'Property', 1), 0);

  return {
    poolName: setup.poolName,
    startingYear: String(setup.startingYear),
    enrolledMemberCount: String(enrolledMembers.length),
    totalMemberCount: String(poolState.allMarketMembers.length),
    enrolledPayroll: formatMillions(enrolledPayrollM),
    enrolledTIV: formatMillions(enrolledTIVM),
    latestEndingSurplus: formatCurrency(opening.endingSurplus, true),
    premiumToSurplusRatio: (opening.totalMemberCharge / opening.endingSurplus).toFixed(2),
    selectedCoverageLines: formatConjunctionList(setup.activeLines.map(l => LINE_FULL_NAME[l])),
  };
}

export default function IntroductionPage({ gameState }: IntroductionPageProps) {
  const [selectedId, setSelectedId] = useState('welcome');

  const welcomeMemoContent = applyTemplate(welcomeMemoRaw, buildWelcomeMemoValues(gameState));

  const documents: DocumentEntry[] = [
    {
      id: 'welcome',
      title: 'Welcome Memorandum',
      summary: `From the Board of Governors, Year ${gameState.setup.startingYear}`,
      content: welcomeMemoContent,
    },
    {
      id: 'howToPlay',
      title: 'How to Play',
      summary: 'The mechanical reference — decisions, reports, and the yearly cycle',
      content: howToPlayRaw,
    },
  ];

  return <DocumentReader documents={documents} selectedId={selectedId} onSelect={setSelectedId} />;
}
