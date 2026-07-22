import React, { useState, useCallback } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  Users,
  Settings,
  BarChart2,
  Calculator,
  Table,
  History as HistoryIcon,
  Layers,
  HardHat,
  Scale,
  Building2,
  ScrollText,
} from 'lucide-react';

import type { GameState, GameSetupSettings, DecisionSet, StartingFinancials, Member, CoverageLine, LineView } from './types/simulation';
import { SLIDER_RANGES, ASSET_ALLOCATION_DEFAULT } from './data/defaultAssumptions';
import { generateGameInstance, generateStartingPoolState } from './utils/instanceGenerator';
import { processYear, applyLoanAuthorizations, type ProcessYearResult } from './utils/simulationEngine';
import { generateHistoricalYears } from './utils/historyGenerator';
import { getMemberExposure, selectResultView } from './utils/lineHelpers';
import LoanPromptModal from './components/LoanPromptModal';
import type { LineLoanInfo } from './pages/DecisionsPage';

import Header from './components/Header';
import TabNav, { type TabId } from './components/TabNav';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import DecisionsPage from './pages/DecisionsPage';
import DecisionHistoryPage from './pages/DecisionHistoryPage';
import FinancialsPage from './pages/FinancialsPage';
import ResultsPage from './pages/ResultsPage';
import MembershipPage from './pages/MembershipPage';
import CalculationAuditPage from './pages/CalculationAuditPage';
import ResultSpreadsheetPage from './pages/ResultSpreadsheetPage';
import HistoryPage from './pages/HistoryPage';

const AUDIT_TAB: TabId = 'audit';
const SPREADSHEET_TAB: TabId = 'spreadsheet';

// Derive numeric seed from instance ID string
function seedFromInstanceId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash;
}

function defaultDecisions(yearNumber: number): DecisionSet {
  // Fresh object per line (allocation is nested, so lines must not share a reference).
  const lineDefaults = () => ({
    rateChange: SLIDER_RANGES.rateChange.default,
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    underwritingStrictness: SLIDER_RANGES.underwritingStrictness.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    reinsuranceLevel: SLIDER_RANGES.reinsuranceLevel.default,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  });
  return {
    yearNumber,
    byLine: {
      WC: lineDefaults(),
      GL: lineDefaults(),
      Property: lineDefaults(),
    },
  };
}

// Pages that support the Pool / per-line view toggle (Stage 2.1).
const LINE_VIEW_PAGES: TabId[] = ['dashboard', 'decisions', 'decisionHistory', 'financials', 'results'];

// Decision-scoped pages (Stage 2.9): every decision is now per-line, so these
// pages have no Pool tab — 'Pool' remains only where it means combined RESULTS.
const DECISION_SCOPE_PAGES: TabId[] = ['decisions', 'decisionHistory'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

const TABS = [
  { id: 'setup' as TabId, label: 'Game Setup', icon: <Settings size={16} /> },
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

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('setup');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [startingFinancials, setStartingFinancials] = useState<StartingFinancials | null>(null);
  const [initialMembers, setInitialMembers] = useState<Member[]>([]);
  const [currentDecisions, setCurrentDecisions] = useState<DecisionSet>(defaultDecisions(1));
  // A year that has been processed but is awaiting the player's loan decisions
  // before it can be committed (see handleAdvanceYear / handleResolveLoans).
  const [pendingYear, setPendingYear] = useState<ProcessYearResult | null>(null);
  // Stage 2.1 Pool/line view toggle. Display-only — not persisted to
  // localStorage, and not part of GameState/DecisionSet.
  const [lineViewRaw, setLineView] = useState<LineView>('pool');

  // Load persisted game from localStorage if available
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('riskpool_gamestate_v5');
      if (saved) {
        const { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd } = JSON.parse(saved);

        // Validate critical fields exist before restoring
        if (gs && sf && sf.totalMarketExposure !== undefined && sf.surplus !== undefined) {
          setGameState(gs);
          setStartingFinancials(sf);
          setInitialMembers(im ?? []);
          setCurrentDecisions(cd ?? defaultDecisions(gs.currentYearNumber));
          setActiveTab('dashboard');
        } else {
          // Bad saved state - clear it
          localStorage.removeItem('riskpool_gamestate_v5');
        }
      }
    } catch {
      // ignore parse errors - clear corrupted data
      localStorage.removeItem('riskpool_gamestate_v5');
    }
  }, []);

  function persistState(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    try {
      localStorage.setItem(
        'riskpool_gamestate_v5',
        JSON.stringify({
          gameState: gs,
          startingFinancials: sf,
          initialMembers: im,
          currentDecisions: cd,
        })
      );
    } catch {
      // ignore storage errors
    }
  }

  const handleStartGame = useCallback((settings: GameSetupSettings) => {
    const seed = seedFromInstanceId(settings.instanceId);
    const instance = generateGameInstance(settings.instanceId, seed);
    const { poolState, startingFinancials: sf } = generateStartingPoolState(instance, settings.startingYear, settings.activeLines);

    const initMembers = poolState.lines.WC.members.filter(m => m.status === 'active');

    const gs: GameState = {
      setup: settings,
      instance,
      currentYearNumber: 1,
      isStarted: true,
      isComplete: false,
      poolState,
      lockedResults: [],
      currentDecisions: defaultDecisions(1),
    };

    const cd = defaultDecisions(1);

    setGameState(gs);
    setStartingFinancials(sf);
    setInitialMembers(initMembers);
    setCurrentDecisions(cd);
    setLineView('pool');
    persistState(gs, sf, initMembers, cd);
    setActiveTab('history');
  }, []);

  // Commit a fully-resolved processed year (loan offers, if any, already handled).
  const commitYear = useCallback((baseGs: GameState, updatedPoolState: GameState['poolState'], result: GameState['lockedResults'][number]) => {
    const nextYearNumber = baseGs.currentYearNumber + 1;
    const isComplete = nextYearNumber > baseGs.setup.gameLength;
    const nextDecisions = defaultDecisions(nextYearNumber);

    const newGs: GameState = {
      ...baseGs,
      currentYearNumber: nextYearNumber,
      isComplete,
      poolState: updatedPoolState,
      lockedResults: [...baseGs.lockedResults, result],
      currentDecisions: nextDecisions,
    };

    setGameState(newGs);
    setCurrentDecisions(nextDecisions);
    persistState(newGs, startingFinancials!, initialMembers, nextDecisions);
    setActiveTab('results');
  }, [startingFinancials, initialMembers]);

  const handleAdvanceYear = useCallback(() => {
    if (!gameState || gameState.isComplete) return;

    const processed = processYear(gameState, currentDecisions);

    // If any line ended negative without a loan, pause to let the player
    // authorize/decline before committing the year.
    if (processed.loanOffers.length > 0) {
      setPendingYear(processed);
      return;
    }

    commitYear(gameState, processed.updatedPoolState, processed.result);
  }, [gameState, currentDecisions, commitYear]);

  const handleResolveLoans = useCallback((authorizedLines: string[]) => {
    if (!gameState || !pendingYear) return;
    const { updatedPoolState, result } = applyLoanAuthorizations(
      pendingYear,
      gameState.currentYearNumber,
      authorizedLines as CoverageLine[]
    );
    setPendingYear(null);
    commitYear(gameState, updatedPoolState, result);
  }, [gameState, pendingYear, commitYear]);

  const handleNewGame = useCallback(() => {
    setGameState(null);
    setStartingFinancials(null);
    setInitialMembers([]);
    setCurrentDecisions(defaultDecisions(1));
    setLineView('pool');
    localStorage.removeItem('riskpool_gamestate_v5');
    setActiveTab('setup');
  }, []);

  const handleDecisionsChange = useCallback((d: DecisionSet) => {
    setCurrentDecisions(d);
    if (gameState && startingFinancials) {
      persistState(gameState, startingFinancials, initialMembers, d);
    }
  }, [gameState, startingFinancials, initialMembers]);

  const isStarted = gameState?.isStarted ?? false;
  const activeLines = gameState?.setup.activeLines ?? [];

  // Guard against a stale selection (e.g. a loaded save with fewer active
  // lines than were selected before) by falling back to 'pool'.
  const lineView: LineView = lineViewRaw === 'pool' || activeLines.includes(lineViewRaw as CoverageLine)
    ? lineViewRaw
    : 'pool';

  // Decision-scoped pages have no Pool view (Stage 2.9): if the shared line
  // selection is 'pool' while one of those pages is open, show the first
  // active line instead. Results pages keep 'pool' untouched.
  const isDecisionScopePage = DECISION_SCOPE_PAGES.includes(activeTab);
  const effectiveLineView: LineView = isDecisionScopePage && lineView === 'pool'
    ? (activeLines[0] ?? 'WC')
    : lineView;

  const viewResults = React.useMemo(() => {
    if (!gameState) return [];
    return selectResultView(gameState.lockedResults, effectiveLineView);
  }, [gameState, effectiveLineView]);

  const lineLoanInfo = React.useMemo(() => {
    const lastResult = gameState?.lockedResults[gameState.lockedResults.length - 1];
    const info: Record<CoverageLine, LineLoanInfo> = { WC: { balance: 0, dividendBlocked: false }, GL: { balance: 0, dividendBlocked: false }, Property: { balance: 0, dividendBlocked: false } };
    for (const line of (['WC', 'GL', 'Property'] as CoverageLine[])) {
      info[line] = {
        balance: gameState?.poolState.interLineLoans.find(l => l.borrowingLine === line)?.remainingBalance ?? 0,
        dividendBlocked: (lastResult?.byLine[line]?.endingSurplus ?? 0) < 0,
      };
    }
    return info;
  }, [gameState]);

  const historicalYears = React.useMemo(() => {
    if (!gameState || !startingFinancials) return [];
    return generateHistoricalYears(
      gameState.instance,
      startingFinancials,
      gameState.setup.startingYear
    );
  }, [gameState?.instance, gameState?.setup.startingYear, startingFinancials]);

  // Tabs are disabled before game starts (except setup)
  const tabs = TABS.map(t => ({
    ...t,
    disabled: !isStarted && t.id !== 'setup',
  }));

  // Decisions-page reinsurance preview estimates, scoped to the line currently
  // being edited (Stage 2.7). Uses that line's own exposure basis — payroll for
  // WC/GL, TIV for Property — its own ratePer100 / purePremiumPer100, and its
  // own rateChange. These are intentionally simple previews; the real premium
  // is recomputed per line in simulationEngine.ts at lock.
  const decisionLine = effectiveLineView === 'pool' ? 'WC' : (effectiveLineView as CoverageLine);
  const decisionLineRateChange = currentDecisions.byLine[decisionLine].rateChange;

  const estimatedPremium = React.useMemo(() => {
    if (!gameState) return 5_000_000;

    const lineState = gameState.poolState.lines[decisionLine];
    const exposure = lineState.members
      .filter(m => m.status === 'active')
      .reduce((s, m) => s + getMemberExposure(m, decisionLine), 0);

    return exposure * lineState.ratePer100 * (1 + decisionLineRateChange) * 10_000;
  }, [gameState, decisionLine, decisionLineRateChange]);

  const estimatedExpectedLoss = React.useMemo(() => {
    if (!gameState) return 3_500_000;

    const lineState = gameState.poolState.lines[decisionLine];
    const exposure = lineState.members
      .filter(m => m.status === 'active')
      .reduce((s, m) => s + getMemberExposure(m, decisionLine), 0);

    return exposure * lineState.purePremiumPer100 * 10_000;
  }, [gameState, decisionLine]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        gameState={gameState}
        startingFinancials={startingFinancials}
        onNewGame={handleNewGame}
        onAdvanceYear={handleAdvanceYear}
        canAdvance={isStarted && !gameState?.isComplete}
      />

      {isStarted && (
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onSelect={setActiveTab}
        />
      )}

      {isStarted && LINE_VIEW_PAGES.includes(activeTab) && (
        <TabNav<LineView>
          tabs={[
            // No Pool tab on decision-scoped pages — all decisions are per-line (Stage 2.9).
            ...(isDecisionScopePage ? [] : [{ id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool }]),
            ...activeLines.map(line => ({ id: line as LineView, label: line, icon: LINE_VIEW_ICONS[line] })),
          ]}
          activeTab={effectiveLineView}
          onSelect={setLineView}
          stickyTop={108}
          zIndex={20}
        />
      )}

      <main>
        {activeTab === 'setup' && (
          <SetupPage onStart={handleStartGame} />
        )}

        {activeTab === 'dashboard' && gameState && startingFinancials && (
          <DashboardPage
            lockedResults={viewResults}
            historicalYears={historicalYears}
            startingFinancials={startingFinancials}
            currentYearNumber={gameState.currentYearNumber}
            startingYear={gameState.setup.startingYear}
            lineView={lineView}
          />
        )}

        {activeTab === 'history' && gameState && startingFinancials && (
          <HistoryPage
            historicalYears={historicalYears}
            scenarioId={gameState.setup.instanceId}
            startingYear={gameState.setup.startingYear}
          />
        )}

        {activeTab === 'decisions' && gameState && (
          <DecisionsPage
            decisions={currentDecisions}
            onChange={handleDecisionsChange}
            yearNumber={gameState.currentYearNumber}
            estimatedPremium={estimatedPremium}
            estimatedExpectedLoss={estimatedExpectedLoss}
            disabled={gameState.isComplete}
            lineView={effectiveLineView as CoverageLine}
            lineLoanInfo={lineLoanInfo}
          />
        )}

        {activeTab === 'decisionHistory' && gameState && (
          <DecisionHistoryPage lockedResults={viewResults} lineView={effectiveLineView as CoverageLine} />
        )}

        {activeTab === 'financials' && gameState && startingFinancials && (
          <FinancialsPage
            lockedResults={viewResults}
            historicalYears={historicalYears}
            startingFinancials={startingFinancials}
            lineView={lineView}
          />
        )}

        {activeTab === 'results' && gameState && (
          <ResultsPage lockedResults={viewResults} lineView={lineView} />
        )}

        {activeTab === SPREADSHEET_TAB && gameState && (
          <ResultSpreadsheetPage
            lockedResults={gameState.lockedResults}
            activeLines={gameState.setup.activeLines}
            instanceId={gameState.setup.instanceId}
          />
        )}

        {activeTab === AUDIT_TAB && gameState && (
          <CalculationAuditPage lockedResults={gameState.lockedResults} />
        )}

        {activeTab === 'membership' && gameState && startingFinancials && (
          <MembershipPage
            lockedResults={gameState.lockedResults}
            startingFinancials={startingFinancials}
            initialMembers={initialMembers}
            startingYear={gameState.setup.startingYear}
          />
        )}
      </main>

      {pendingYear && (
        <LoanPromptModal offers={pendingYear.loanOffers} onResolve={handleResolveLoans} />
      )}
    </div>
  );
}
