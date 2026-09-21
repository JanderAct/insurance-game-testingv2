// ============================================================================
// THE GAME, AS A PLAYER SEES IT — every tab, every page, both callers.
//
// ⚠ THIS IS App.tsx's RENDER BLOCK, MOVED. The tab list, the line-view bar, the
// page wiring and the loan modal slot are the ones that stood in App.tsx, with
// the same props and the same conditions. App.tsx is now the solo caller of it
// and the session player screen is the second; neither owns a copy.
//
// ⚠ EXTRACTING THE DERIVATION WITHOUT EXTRACTING THIS WOULD HAVE MISSED THE
// POINT. A session screen that called useGameDerivations and then wrote its own
// JSX would have a second copy of the page wiring instead of a second copy of
// the arithmetic — the same hazard one level up, and the harder one to spot,
// because it fails as a missing tab rather than a wrong number.
//
// WHAT THE TWO CALLERS DIFFER ON, AND ALL OF IT IS A PROP:
//
//   setupPage       solo passes SetupPage and gets the Game Setup tab; a
//                   session player has no setup because the ROOM owns the seed,
//                   the year count, the lines and the shock schedule. A player
//                   choosing any of them would fork their instance away from
//                   everyone else's.
//   onNewGame       absent in a session. The host owns the lifecycle.
//   onAdvanceYear   solo processes the year immediately; a session locks and
//                   waits for the host. Same button, same words, different verb
//                   underneath — which is the whole of the difference the
//                   session layer exists to make.
//   loanPrompt      solo blocks on the modal; a session cannot (see JoinScreen).
//   banner          the save-failure banner, which is solo-only because a
//                   session player does not write the save at all.
// ============================================================================

import React from 'react';
import {
  LayoutDashboard, ClipboardList, FileText, Users, Settings, BarChart2,
  Calculator, Table, History as HistoryIcon, Layers, HardHat, Scale,
  Building2, ScrollText, BookOpen, Landmark,
} from 'lucide-react';

import type {
  CoverageLine, DecisionSet, GameState, LineView, Member, StartingFinancials,
} from '../types/simulation';
import { endingPosition } from '../utils/endingPosition';
import { LINE_FULL_NAME } from '../utils/lineDisplay';
import { useGameDerivations } from './derivations';

import Header from '../components/Header';
import TabNav, { type TabId } from '../components/TabNav';
import DashboardPage from '../pages/DashboardPage';
import DecisionsPage from '../pages/DecisionsPage';
import DecisionHistoryPage from '../pages/DecisionHistoryPage';
import FinancialsPage from '../pages/FinancialsPage';
import ResultsPage from '../pages/ResultsPage';
import MembershipPage from '../pages/MembershipPage';
import CalculationAuditPage from '../pages/CalculationAuditPage';
import ResultSpreadsheetPage from '../pages/ResultSpreadsheetPage';
import HistoryPage from '../pages/HistoryPage';
import IntroductionPage from '../pages/IntroductionPage';
import DepartmentsPage from '../pages/DepartmentsPage';

const AUDIT_TAB: TabId = 'audit';
const SPREADSHEET_TAB: TabId = 'spreadsheet';

// Pages that support the Pool / per-line view toggle (Stage 2.1; 'history'
// added in Stage 2.10 — each line now has its own real pre-game history).
// ⚠ 'membership' JOINED THIS LIST, AND IT IS THE REASON THE PAGE CAN BE HONEST.
// Its per-member experience columns are PER LINE — a member has one loss ratio
// on WC and another on GL, not one ratio — and until the bar existed the page
// read WC unconditionally whatever the pool wrote. The selector is what lets the
// three per-line columns name their line instead of assuming one.
const LINE_VIEW_PAGES: TabId[] = ['history', 'dashboard', 'decisions', 'decisionHistory', 'financials', 'results', 'audit', 'membership'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

const SETUP_TAB = { id: 'setup' as TabId, label: 'Game Setup', icon: <Settings size={16} /> };

const PLAY_TABS = [
  { id: 'introduction' as TabId, label: 'Introduction', icon: <BookOpen size={16} /> },
  { id: 'departments' as TabId, label: 'Departments', icon: <Landmark size={16} /> },
  { id: 'history' as TabId, label: 'Pool History', icon: <HistoryIcon size={16} /> },
  { id: 'dashboard' as TabId, label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { id: 'decisions' as TabId, label: 'Decisions', icon: <ClipboardList size={16} /> },
  { id: 'decisionHistory' as TabId, label: 'Decision History', icon: <ScrollText size={16} /> },
  { id: 'financials' as TabId, label: 'Financial Statements', icon: <FileText size={16} /> },
  { id: 'results' as TabId, label: 'Results', icon: <BarChart2 size={16} /> },
  { id: SPREADSHEET_TAB, label: 'Result Spreadsheet', icon: <Table size={16} /> },
  { id: AUDIT_TAB, label: 'Calculation Audit', icon: <Calculator size={16} /> },
  { id: 'membership' as TabId, label: 'Membership', icon: <Users size={16} /> },
];

export interface GameShellProps {
  gameState: GameState | null;
  startingFinancials: StartingFinancials | null;
  initialMembers: Member[];
  currentDecisions: DecisionSet;
  onDecisionsChange: (d: DecisionSet) => void;

  activeTab: TabId;
  onSelectTab: (t: TabId) => void;
  lineView: LineView;
  onSelectLineView: (v: LineView) => void;

  /** Omitted by a viewer — see Header. */
  onAdvanceYear?: () => void;
  canAdvance?: boolean;
  advanceLabel?: string;
  onNewGame?: () => void;

  /** Rendered in the Game Setup tab. Omitting it removes the tab entirely. */
  setupPage?: React.ReactNode;
  /** Solo's loan modal. A session declines automatically and passes nothing. */
  loanPrompt?: React.ReactNode;
  /** Solo's save-failure banner, above the header. */
  banner?: React.ReactNode;
  /**
   * An extra reason the decisions page is read-only, on top of the game being
   * complete. A session player is locked out once they have submitted the
   * current year — that is what lock-and-wait means on this screen.
   */
  decisionsDisabled?: boolean;
  /** Rendered under the tab bar. The session's lock/waiting strip lives here. */
  statusStrip?: React.ReactNode;
}

export default function GameShell({
  gameState, startingFinancials, initialMembers, currentDecisions, onDecisionsChange,
  activeTab, onSelectTab, lineView, onSelectLineView,
  onAdvanceYear, canAdvance, advanceLabel, onNewGame,
  setupPage, loanPrompt, banner, decisionsDisabled, statusStrip,
}: GameShellProps) {
  const isStarted = gameState?.isStarted ?? false;
  const activeLines = gameState?.setup.activeLines ?? [];

  const d = useGameDerivations(gameState, lineView, currentDecisions);

  const tabs = React.useMemo(() => {
    const list = setupPage !== undefined ? [SETUP_TAB, ...PLAY_TABS] : PLAY_TABS;
    return list.map(t => ({ ...t, disabled: !isStarted && t.id !== 'setup' }));
  }, [isStarted, setupPage]);

  return (
    <div className="min-h-screen bg-gray-50">
      {banner}
      <Header
        gameState={gameState}
        startingFinancials={startingFinancials}
        onNewGame={onNewGame}
        onAdvanceYear={onAdvanceYear}
        canAdvance={canAdvance}
        advanceLabel={advanceLabel}
      />

      {isStarted && (
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onSelect={onSelectTab}
        />
      )}

      {isStarted && LINE_VIEW_PAGES.includes(activeTab) && (
        <TabNav<LineView>
          tabs={[
            { id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool },
            ...activeLines.map(line => ({ id: line as LineView, label: LINE_FULL_NAME[line], icon: LINE_VIEW_ICONS[line] })),
          ]}
          activeTab={lineView}
          onSelect={onSelectLineView}
          stickyTop={108}
          zIndex={20}
        />
      )}

      {statusStrip}

      <main>
        {activeTab === 'setup' && setupPage}

        {activeTab === 'introduction' && gameState && (
          <IntroductionPage gameState={gameState} />
        )}

        {activeTab === 'departments' && gameState && (
          <DepartmentsPage gameState={gameState} />
        )}

        {activeTab === 'dashboard' && gameState && startingFinancials && (
          <DashboardPage
            lockedResults={d.viewResults}
            historicalYears={d.historicalYears}
            startingFinancials={startingFinancials}
            currentYearNumber={gameState.currentYearNumber}
            lineView={lineView}
            // ⚠ COMPUTED FROM THE WHOLE GAME STATE, NOT FROM `viewResults`, and
            // passed in rather than derived inside the page. The panel shows
            // every line at once whatever the line view is set to — the contrast
            // between a short-tail and a long-tail runoff is the lesson — and
            // DashboardPage only ever receives the filtered slice.
            endingPositionRows={endingPosition(gameState)}
            gameComplete={gameState.isComplete}
          />
        )}

        {activeTab === 'history' && gameState && startingFinancials && (
          <HistoryPage
            historicalYears={d.historicalYears}
            lineView={lineView}
          />
        )}

        {activeTab === 'decisions' && gameState && (
          <DecisionsPage
            memberLossHistory={gameState.poolState.memberLossHistory ?? {}}
            allMarketMembers={gameState.poolState.allMarketMembers}
            membershipHistory={gameState.poolState.membershipHistory}
            decisions={currentDecisions}
            onChange={onDecisionsChange}
            yearNumber={gameState.currentYearNumber}
            estimatedExpectedLoss={d.estimatedExpectedLoss}
            estimatedAggregateTermsRetained={d.estimatedAggregateTermsRetained}
            disabled={gameState.isComplete || decisionsDisabled}
            lineView={lineView}
            lineLoanInfo={d.lineLoanInfo}
            lastLineResult={d.lastLineResult}
            fundingConsequence={d.fundingConsequence}
            activeMembers={d.decisionLineActiveMembers}
          />
        )}

        {activeTab === 'decisionHistory' && gameState && (
          <DecisionHistoryPage lockedResults={d.viewResults} lineView={lineView} />
        )}

        {activeTab === 'financials' && gameState && startingFinancials && (
          <FinancialsPage
            lockedResults={d.viewResults}
            priorResults={d.viewPriorResults}
            lineView={lineView}
          />
        )}

        {activeTab === 'results' && gameState && (
          <ResultsPage lockedResults={d.viewResults} lineView={lineView} />
        )}

        {activeTab === SPREADSHEET_TAB && gameState && (
          <ResultSpreadsheetPage
            lockedResults={gameState.lockedResults}
            priorHistory={gameState.priorHistory}
            instance={gameState.instance}
            activeLines={gameState.setup.activeLines}
            instanceId={gameState.setup.instanceId}
            poolState={gameState.poolState}
          />
        )}

        {activeTab === AUDIT_TAB && gameState && (
          <CalculationAuditPage
            lockedResults={gameState.lockedResults}
            priorHistory={gameState.priorHistory}
            instanceSeed={gameState.instance.seed}
            lineView={lineView}
          />
        )}

        {activeTab === 'membership' && gameState && startingFinancials && (
          <MembershipPage
            lockedResults={gameState.lockedResults}
            startingFinancials={startingFinancials}
            initialMembers={initialMembers}
            startingYear={gameState.setup.startingYear}
            memberLossHistory={gameState.poolState.memberLossHistory ?? {}}
            lineView={lineView}
          />
        )}
      </main>

      {loanPrompt}
    </div>
  );
}

export type { CoverageLine };
