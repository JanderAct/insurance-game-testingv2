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
} from 'lucide-react';

import type { GameState, GameSetupSettings, DecisionSet, StartingFinancials, Member } from './types/simulation';
import { SLIDER_RANGES } from './data/defaultAssumptions';
import { generateGameInstance, generateStartingPoolState } from './utils/instanceGenerator';
import { processYear } from './utils/simulationEngine';
import { generateHistoricalYears } from './utils/historyGenerator';

import Header from './components/Header';
import TabNav, { type TabId } from './components/TabNav';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import DecisionsPage from './pages/DecisionsPage';
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
  return {
    yearNumber,
    rateChange: SLIDER_RANGES.rateChange.default,
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    underwritingStrictness: SLIDER_RANGES.underwritingStrictness.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    reinsuranceLevel: SLIDER_RANGES.reinsuranceLevel.default,
    investmentRisk: SLIDER_RANGES.investmentRisk.default,
  };
}

const TABS = [
  { id: 'setup' as TabId, label: 'Game Setup', icon: <Settings size={16} /> },
  { id: 'history' as TabId, label: 'Pool History', icon: <HistoryIcon size={16} /> },
  { id: 'dashboard' as TabId, label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { id: 'decisions' as TabId, label: 'Decisions', icon: <ClipboardList size={16} /> },
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

  // Load persisted game from localStorage if available
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('riskpool_gamestate');
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
          localStorage.removeItem('riskpool_gamestate');
        }
      }
    } catch {
      // ignore parse errors - clear corrupted data
      localStorage.removeItem('riskpool_gamestate');
    }
  }, []);

  function persistState(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    try {
      localStorage.setItem(
        'riskpool_gamestate',
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
    const { poolState, startingFinancials: sf } = generateStartingPoolState(instance, settings.startingYear);

    const initMembers = poolState.members.filter(m => m.status === 'active');

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
    persistState(gs, sf, initMembers, cd);
    setActiveTab('history');
  }, []);

  const handleAdvanceYear = useCallback(() => {
    if (!gameState || gameState.isComplete) return;

    const { updatedPoolState, result } = processYear(gameState, currentDecisions);

    const nextYearNumber = gameState.currentYearNumber + 1;
    const isComplete = nextYearNumber > gameState.setup.gameLength;

    const nextDecisions = defaultDecisions(nextYearNumber);

    const newGs: GameState = {
      ...gameState,
      currentYearNumber: nextYearNumber,
      isComplete,
      poolState: updatedPoolState,
      lockedResults: [...gameState.lockedResults, result],
      currentDecisions: nextDecisions,
    };

    setGameState(newGs);
    setCurrentDecisions(nextDecisions);
    persistState(newGs, startingFinancials!, initialMembers, nextDecisions);

    // Navigate to results after locking
    setActiveTab('results');
  }, [gameState, currentDecisions, startingFinancials, initialMembers]);

  const handleNewGame = useCallback(() => {
    setGameState(null);
    setStartingFinancials(null);
    setInitialMembers([]);
    setCurrentDecisions(defaultDecisions(1));
    localStorage.removeItem('riskpool_gamestate');
    setActiveTab('setup');
  }, []);

  const handleDecisionsChange = useCallback((d: DecisionSet) => {
    setCurrentDecisions(d);
    if (gameState && startingFinancials) {
      persistState(gameState, startingFinancials, initialMembers, d);
    }
  }, [gameState, startingFinancials, initialMembers]);

  const isStarted = gameState?.isStarted ?? false;

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

  const estimatedPremium = React.useMemo(() => {
    if (!gameState) return 5_000_000;

    const activeMembers = gameState.poolState.members.filter(m => m.status === 'active');
    const exposure = activeMembers.reduce((s, m) => s + m.exposure, 0);

    // Current estimate is intentionally simple for the Decisions page preview.
    // Actual premium is calculated in simulationEngine.ts when the year is processed.
    return exposure * gameState.poolState.ratePer100 * (1 + currentDecisions.rateChange) * 10_000;
  }, [gameState, currentDecisions.rateChange]);

  const estimatedExpectedLoss = React.useMemo(() => {
    if (!gameState) return 3_500_000;

    const activeMembers = gameState.poolState.members.filter(m => m.status === 'active');
    const exposure = activeMembers.reduce((s, m) => s + m.exposure, 0);

    return exposure * gameState.poolState.purePremiumPer100 * 10_000;
  }, [gameState]);

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

      <main>
        {activeTab === 'setup' && (
          <SetupPage onStart={handleStartGame} />
        )}

        {activeTab === 'dashboard' && gameState && startingFinancials && (
          <DashboardPage
            lockedResults={gameState.lockedResults}
            startingFinancials={startingFinancials}
            currentYearNumber={gameState.currentYearNumber}
            startingYear={gameState.setup.startingYear}
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
          />
        )}

        {activeTab === 'financials' && gameState && startingFinancials && (
          <FinancialsPage
            lockedResults={gameState.lockedResults}
            startingFinancials={startingFinancials}
            startingYear={gameState.setup.startingYear}
          />
        )}

        {activeTab === 'results' && gameState && (
          <ResultsPage lockedResults={gameState.lockedResults} />
        )}

        {activeTab === SPREADSHEET_TAB && gameState && (
          <ResultSpreadsheetPage lockedResults={gameState.lockedResults} />
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
    </div>
  );
}
