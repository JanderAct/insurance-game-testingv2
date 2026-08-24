import React, { useState, useCallback } from 'react';
import { DEFAULT_LAYERS_PLACED } from './data/reinsuranceTower';
import type { TowerLine } from './data/reinsuranceTower';
import { normalizeAggregateStopLevel, normalizeLayersPlaced } from './utils/reinsuranceTower';
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

import type { GameState, GameSetupSettings, DecisionSet, StartingFinancials, Member, LinePoolState, CoverageLine, LineView } from './types/simulation';
import { getPredefinedMarketMembers } from './data/memberCatalog';
import { generateGameInstance } from './utils/instanceGenerator';
import { processYear, applyLoanAuthorizations, type ProcessYearResult } from './utils/simulationEngine';
import { runPriorHistory, toHistoricalYear } from './utils/priorHistoryEngine';
import { defaultDecisionSet } from './utils/decisionDefaults';
import { getMemberExposure, selectResultView } from './utils/lineHelpers';
import { computeFundingConsequence } from './utils/fundingConsequence';
import { LINE_FULL_NAME } from './utils/lineDisplay';
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

// Pages that support the Pool / per-line view toggle (Stage 2.1; 'history'
// added in Stage 2.10 — each line now has its own real pre-game history).
const LINE_VIEW_PAGES: TabId[] = ['history', 'dashboard', 'decisions', 'decisionHistory', 'financials', 'results', 'audit'];


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
  const [currentDecisions, setCurrentDecisions] = useState<DecisionSet>(defaultDecisionSet(1));
  // A year that has been processed but is awaiting the player's loan decisions
  // before it can be committed (see handleAdvanceYear / handleResolveLoans).
  const [pendingYear, setPendingYear] = useState<ProcessYearResult | null>(null);
  // Stage 2.1 Pool/line view toggle. Display-only — not persisted to
  // localStorage, and not part of GameState/DecisionSet.
  const [lineViewRaw, setLineView] = useState<LineView>('pool');

  // Load persisted game from localStorage if available
  //
  // THE KEY STAYS 'riskpool_gamestate_v10' ACROSS THE RIPPLE RENAME, on
  // purpose. It is a persisted identifier, not a display string — renaming it
  // to match the new product name would orphan every existing saved game
  // (a fresh key means `localStorage.getItem` finds nothing, indistinguishable
  // from never having played). The four sites using this literal (the load
  // here, its two removeItem cleanup paths below, and persistState's setItem)
  // must all keep using the same string. A version bump belongs to a real save
  // schema change, not to the app's name.
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('riskpool_gamestate_v10');
      if (saved) {
        const { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd } = JSON.parse(saved);

        // Validate critical fields exist before restoring
        if (gs && sf && Array.isArray(gs.priorHistory) && sf.totalMarketExposure !== undefined && sf.surplus !== undefined) {
          // Saves from before the membership-history ledger lack the field;
          // default to an empty ledger (cooldown then treats everyone as
          // never-enrolled, which only affects stale dev saves).
          if (gs.poolState && !gs.poolState.membershipHistory) {
            gs.poolState.membershipHistory = {};
          }
          // Same for the rolling loss record (stage 3). Defaulted rather than
          // bumping the save key: the field is purely additive, so an old save
          // stays playable and simply starts accumulating history from the next
          // processed year. The experience modifier reads a short window, so it
          // recovers on its own within a few turns — whereas discarding the save
          // would throw away the whole game to gain the same thing.
          if (gs.poolState && !gs.poolState.memberLossHistory) {
            gs.poolState.memberLossHistory = {};
          }
          // PER-OCCURRENCE TOWER: saves written before it carry only
          // `reinsuranceLevel` (now removed — see the delete below), and there
          // is NO honest mapping from a quota-share level to a set of layer
          // placements — they are different products, not two settings of
          // one. So the default is every purchasable layer placed and no
          // aggregate, and an old save silently adopts that rather than
          // pretending its old program survived the change. The save KEY is
          // unchanged; only this defaulting is new.
          // Patch the LIVE decision set (`cd`), which is what the next turn
          // reads. lockedResults keep their own historical decisions untouched —
          // those are a record of what was played, not an input.
          const byLine = (cd as DecisionSet | undefined)?.byLine as
            Record<string, { layersPlaced?: boolean[]; aggregateStopLevel?: number; reinsuranceLevel?: number }> | undefined;
          if (byLine) {
            // KEYED BY LINE — DEFAULT_LAYERS_PLACED is now a Record<TowerLine,
            // boolean[]>, not one flat array, because Property's one-layer
            // tower and WC/GL's three-layer towers must not share a default.
            for (const [line, ld] of Object.entries(byLine)) {
              if (!ld) continue;
              if (!Array.isArray(ld.layersPlaced)) ld.layersPlaced = [...DEFAULT_LAYERS_PLACED[line as CoverageLine]];
              if (typeof ld.aggregateStopLevel !== 'number') ld.aggregateStopLevel = -1;
              // REINSURANCE_PROGRAMS RETIRED: a save from before this commit
              // carries `reinsuranceLevel`. Nothing reads it any more — no
              // validation walks LineDecisionSet's shape, so it would sit
              // inert rather than throw — but discarded on load anyway so a
              // resaved game does not keep writing a field that no longer
              // means anything.
              delete ld.reinsuranceLevel;
              // AGGREGATE-OVER-DECLINED-TOWER: reachable in any save written
              // before the gate existed. Cleared to none rather than rejected —
              // the save is otherwise valid and the state is now simply not
              // purchasable, so the honest migration is to drop the purchase.
              // Only lines with an aggregate at all reach the normalizer; GL
              // and any non-tower key pass through untouched.
              if (line === 'WC' || line === 'Property') {
                const l = line as TowerLine;
                ld.aggregateStopLevel = normalizeAggregateStopLevel(
                  l, normalizeLayersPlaced(l, ld.layersPlaced), ld.aggregateStopLevel,
                );
              }
            }
          }
          // WC SEVERITY REBUILD: wcRatingGroup re-stamped onto every member from
          // the canonical catalog. It is roster data, not game state, so
          // rebuilding it is exact rather than a guess — and wcClaimEngine THROWS
          // on a member without one. Defaulted rather than bumping the save key,
          // same precedent as membershipHistory and memberLossHistory.
          //
          // ⚠ THE unreportedClaims / wcAccidentYearReported BACKFILL THAT STOOD
          // HERE IS GONE, and old saves are fine WITHOUT a migration. Both fields
          // were removed with WC's report lag. A save written before this commit
          // still carries them, and they are simply ignored: nothing reads them,
          // TypeScript does not police excess properties on a parsed JSON object,
          // and they cost a few KB of localStorage until the next save overwrites
          // them. Deleting them on load would be busywork with a failure mode
          // (mutating a save the user might open in an older build) and no
          // benefit. The one thing that would break a save is a field the engine
          // now REQUIRES and the save lacks; this change removes fields, so there
          // is none.
          {
            const groupByName = new Map(
              getPredefinedMarketMembers().map(m => [m.name, m.wcRatingGroup]),
            );
            const repair = (m: Member | undefined) => {
              if (m && !m.wcRatingGroup) m.wcRatingGroup = groupByName.get(m.name);
            };
            (gs.poolState?.allMarketMembers ?? []).forEach(repair);
            const lines = (gs.poolState?.lines ?? {}) as Record<string, LinePoolState | undefined>;
            for (const ls of Object.values(lines)) {
              (ls?.members ?? []).forEach(repair);
            }
            (im ?? []).forEach(repair);
          }
          setGameState(gs);
          setStartingFinancials(sf);
          setInitialMembers(im ?? []);
          setCurrentDecisions(cd ?? defaultDecisionSet(gs.currentYearNumber));
          setActiveTab('dashboard');
        } else {
          // Bad saved state - clear it
          localStorage.removeItem('riskpool_gamestate_v10');
        }
      }
    } catch {
      // ignore parse errors - clear corrupted data
      localStorage.removeItem('riskpool_gamestate_v10');
    }
  }, []);

  function persistState(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    try {
      localStorage.setItem(
        'riskpool_gamestate_v10',
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
    // Stage 2.10: each active line simulates its own 3-year pre-game past
    // through the real engine; the ending state is the Year 1 opening position.
    const { poolState, startingFinancials: sf, priorHistory } = runPriorHistory(instance, settings);

    const initMembers = poolState.lines.WC.members.filter(m => m.status === 'active');

    const gs: GameState = {
      setup: settings,
      instance,
      currentYearNumber: 1,
      isStarted: true,
      isComplete: false,
      poolState,
      lockedResults: [],
      currentDecisions: defaultDecisionSet(1),
      priorHistory,
    };

    const cd = defaultDecisionSet(1);

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
    const nextDecisions = defaultDecisionSet(nextYearNumber);

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
    setCurrentDecisions(defaultDecisionSet(1));
    setLineView('pool');
    localStorage.removeItem('riskpool_gamestate_v10');
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

  // Decision pages regained their Pool tab (pool-wide allocation + risk
  // control decisions live there); every line-view page now honors 'pool'.
  const effectiveLineView: LineView = lineView;

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

  // Stage 2.10: the pre-game history is real per-line engine output. Filter it
  // to the current view (pool aggregate or a single line), then adapt to the
  // HistoricalYear display shape the history-aware pages render.
  const viewPriorResults = React.useMemo(() => {
    if (!gameState) return [];
    return selectResultView(gameState.priorHistory, lineView);
  }, [gameState, lineView]);

  const historicalYears = React.useMemo(
    () => viewPriorResults.map(toHistoricalYear),
    [viewPriorResults]
  );

  // Tabs are disabled before game starts (except setup)
  const tabs = TABS.map(t => ({
    ...t,
    disabled: !isStarted && t.id !== 'setup',
  }));

  // Decisions-page reinsurance preview estimates, scoped to the line currently
  // being edited (Stage 2.7). Uses that line's own exposure basis — payroll for
  // WC/GL, TIV for Property — and its own ratePer100 / purePremiumPer100.
  // These are intentionally simple previews; the real premium is recomputed per
  // line in simulationEngine.ts at lock.
  //
  // The (1 + rateChange) factor this used to carry is GONE — CLF-only pricing
  // removed the Rate Change decision, so lineState.ratePer100 (last year's
  // total member charge rate) is used directly.
  const decisionLine = effectiveLineView === 'pool' ? 'WC' : (effectiveLineView as CoverageLine);

  // (The `estimatedExposure` memo that used to live here is gone. It existed
  // solely to feed the reinsurance tower a per-$100 exposure base; the tower now
  // prices off `decisionLineActiveMembers` and the year directly, so a nominal
  // exposure figure is no longer an input to any price.)

  const estimatedExpectedLoss = React.useMemo(() => {
    if (!gameState) return 3_500_000;

    const lineState = gameState.poolState.lines[decisionLine];
    const exposure = lineState.members
      .filter(m => m.status === 'active')
      .reduce((s, m) => s + getMemberExposure(m, decisionLine, gameState.currentYearNumber), 0);

    return exposure * lineState.purePremiumPer100 * 10_000;
  }, [gameState, decisionLine]);

  // The last computed result for the line currently being edited — pool
  // accounting fields the consequence panel surfaces are not carried on
  // LinePoolState itself (excessCapitalRatio, capitalAdequacyStatus), only on
  // the LineResultSet each processed year returns. Falls back to the last
  // pre-game year when no year has been locked yet (mirrors lineLoanInfo's
  // pattern, but that one only reads lockedResults since it does not need to
  // cover the pre-Year-1 gap).
  const lastLineResult = React.useMemo(() => {
    if (!gameState) return undefined;
    if (gameState.lockedResults.length > 0) {
      return gameState.lockedResults[gameState.lockedResults.length - 1].byLine[decisionLine];
    }
    if (gameState.priorHistory.length > 0) {
      return gameState.priorHistory[gameState.priorHistory.length - 1].byLine[decisionLine];
    }
    return undefined;
  }, [gameState, decisionLine]);

  // CLF-only pricing consequence panel (Decisions page). lineState.ratePer100
  // is already last year's totalMemberChargeRatePer100, so it doubles as the
  // "vs last year" basis with no separate lookup. Narrow deps (not all of
  // currentDecisions) so this does not recompute when an unrelated line's or
  // pool decision changes.
  // The decision line's active book. Shared by the funding-consequence panel and
  // by the reinsurance tower, which now prices off the members themselves rather
  // than off a frozen per-$100 rate card times exposure.
  const decisionLineActiveMembers = React.useMemo(() => {
    if (!gameState) return [];
    return gameState.poolState.lines[decisionLine].members.filter(m => m.status === 'active');
  }, [gameState, decisionLine]);

  const decisionLineFundingLevel = currentDecisions.byLine[decisionLine].fundingConfidenceLevel;
  const decisionLineFundingAtExpected = currentDecisions.byLine[decisionLine].fundingAtExpected;
  const fundingConsequence = React.useMemo(() => {
    if (!gameState) return null;
    const lineState = gameState.poolState.lines[decisionLine];
    const d = currentDecisions.byLine[decisionLine];
    return computeFundingConsequence(
      decisionLineFundingLevel,
      lineState.ratePer100,
      decisionLine,
      decisionLineFundingAtExpected,
      {
        yearNumber: gameState.currentYearNumber,
        // The tower prices off the book itself, so the panel needs the members
        // and the year, not just an exposure total.
        members: decisionLineActiveMembers,
        exposure: decisionLineActiveMembers.reduce(
          (sum, m) => sum + getMemberExposure(m, decisionLine, gameState.currentYearNumber), 0,
        ),
        layersPlaced: d.layersPlaced,
        aggregateStopLevel: d.aggregateStopLevel,
        pricingAdjustment: lineState.rateLevel / 100,
        priorPurePremiumPer100: lineState.purePremiumPer100,
        lossTrend: gameState.instance.lossEnvironment.lossTrend,
        priorRcEffectiveness: lineState.riskControlEffectiveness,
        riskControlPct: d.riskControlPct,
      },
    );
  }, [gameState, decisionLine, decisionLineFundingLevel, decisionLineFundingAtExpected, decisionLineActiveMembers, currentDecisions]);

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
            { id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool },
            ...activeLines.map(line => ({ id: line as LineView, label: LINE_FULL_NAME[line], icon: LINE_VIEW_ICONS[line] })),
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
            lineView={lineView}
          />
        )}

        {activeTab === 'history' && gameState && startingFinancials && (
          <HistoryPage
            historicalYears={historicalYears}
            lineView={lineView}
          />
        )}

        {activeTab === 'decisions' && gameState && (
          <DecisionsPage
            decisions={currentDecisions}
            onChange={handleDecisionsChange}
            yearNumber={gameState.currentYearNumber}
            estimatedExpectedLoss={estimatedExpectedLoss}
            disabled={gameState.isComplete}
            lineView={effectiveLineView}
            lineLoanInfo={lineLoanInfo}
            lastLineResult={lastLineResult}
            fundingConsequence={fundingConsequence}
            activeMembers={decisionLineActiveMembers}
          />
        )}

        {activeTab === 'decisionHistory' && gameState && (
          <DecisionHistoryPage lockedResults={viewResults} lineView={effectiveLineView} />
        )}

        {activeTab === 'financials' && gameState && startingFinancials && (
          <FinancialsPage
            lockedResults={viewResults}
            priorResults={viewPriorResults}
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
          <CalculationAuditPage
            lockedResults={gameState.lockedResults}
            priorHistory={gameState.priorHistory}
            instanceSeed={gameState.instance.seed}
            lineView={effectiveLineView}
          />
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
