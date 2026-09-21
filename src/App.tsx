import React, { useState, useCallback } from 'react';
import { DEFAULT_LAYERS_PLACED } from './data/reinsuranceTower';
import type { TowerLine } from './data/reinsuranceTower';
import { normalizeAggregateStopLevel, normalizeLayersPlaced } from './utils/reinsuranceTower';

import type { GameState, GameSetupSettings, DecisionSet, StartingFinancials, Member, LinePoolState, CoverageLine, LineView } from './types/simulation';
import { getPredefinedMarketMembers } from './data/memberCatalog';
import { generateGameInstance } from './utils/instanceGenerator';
import { processYear, applyLoanAuthorizations, type ProcessYearResult } from './utils/simulationEngine';
import { runPriorHistory } from './utils/priorHistoryEngine';
import { defaultDecisionSet } from './utils/decisionDefaults';
import { SAVE_KEY, unpackSave, writeSave, type SaveEnvelope, type SaveOutcome } from './utils/gameSave';
import { createSaveScheduler, type SaveScheduler } from './utils/saveScheduler';
import { seedFromInstanceId } from './seedHash';
import LoanPromptModal from './components/LoanPromptModal';
import type { TabId } from './components/TabNav';
import SetupPage from './pages/SetupPage';

// ⚠ THE TAB LIST, THE LINE-VIEW BAR, THE PAGE WIRING AND THE THIRTEEN
// DECISION-PAGE PROPS ALL MOVED TO src/game/. This file is now the SOLO CALLER
// of that shell: it owns the save, the setup screen, and an advance that
// processes the year immediately. The session player screen is the second
// caller and owns a different advance. Neither owns a copy of the game.
import GameShell from './game/GameShell';

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
  // The last failed save, or null. Rendered as a banner that does not dismiss —
  // see the note on persistState and gameSave.ts.
  const [saveFailure, setSaveFailure] = useState<Extract<SaveOutcome, { ok: false }> | null>(null);

  // Load persisted game from localStorage if available.
  //
  // ⚠ THE KEY IS `SAVE_KEY` NOW, AND THE PARAGRAPH THAT STOOD HERE IS WHY. It
  // said the key must not be renamed — true, and it now lives beside the
  // constant in gameSave.ts — and then asked the reader to keep FOUR STRING
  // LITERALS in step by hand: this load, its two removeItem paths, and the
  // write. A comment requesting manual consistency across four sites is the
  // keyed-lookup defect with extra steps. The constant is the fix.
  //
  // ⚠ A RESTORED GAME HAS NO PER-CLAIM DETAIL. gameSave strips `claims`,
  // `occurrences` and `marketMemberLossResults` on the way out — see its header
  // for why, and save-round-trip-check for what that costs. Nothing here
  // backfills them: they are absent, and every consumer already has to handle
  // absence because the aggregate Property path never produced them either.
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) {
        // ⚠ unpackSave THROWS ON A SAVE WRITTEN BEFORE COMPRESSION, AND THE
        // catch BELOW CLEARING THE KEY IS THE DESIGNED OUTCOME RATHER THAN
        // DAMAGE CONTROL. There is deliberately no format detection and no
        // dual-path loader — see gameSave.ts. An old raw-JSON save is not
        // base64, atob rejects it, and the player starts a new game.
        const { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd } =
          unpackSave(saved) as {
            gameState: GameState; startingFinancials: StartingFinancials;
            initialMembers: Member[]; currentDecisions: DecisionSet;
          };

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
          localStorage.removeItem(SAVE_KEY);
        }
      }
    } catch {
      // ignore parse errors - clear corrupted data
      localStorage.removeItem(SAVE_KEY);
    }
  }, []);

  // ⚠ THE WRITE LIVES IN gameSave.ts NOW, AND THE FAILURE IS SURFACED.
  // This was a bare JSON.stringify in a bare catch {}, which meant the game
  // silently stopped saving at year 4 once the payload passed the ~5 MiB
  // localStorage quota. gameSave strips the per-claim flow that made up 65-70%
  // of it and reports what happened; this turns a failure into a banner the
  // player cannot miss. See gameSave.ts for the measurement and the budget.
  //
  // ⚠ AND *WHEN* IT IS WRITTEN LIVES IN saveScheduler.ts, FOR THE SAME REASON.
  // The decision path fires per slider STEP, not per interaction; the scheduler
  // coalesces a drag into one write and is a pure module so a gate can prove it
  // never drops a value. See its header.
  const scheduler = React.useRef<SaveScheduler<SaveEnvelope> | null>(null);
  if (scheduler.current === null) {
    scheduler.current = createSaveScheduler<SaveEnvelope>(
      // ⚠ THE WRITE IS OUTSIDE setSaveFailure, not inside an updater. A state
      // updater must be pure — React invokes it twice under StrictMode — and a
      // write in there would run twice per save in development.
      env => {
        const outcome = writeSave(env, window.localStorage);
        setSaveFailure(outcome.ok ? null : outcome);
      },
      { setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: id => window.clearTimeout(id) },
    );
  }

  // ⚠ THE LIFECYCLE FLUSH IS WHAT MAKES THE DEBOUNCE SAFE, not an extra. A
  // trailing debounce leaves the last value in memory for up to
  // SAVE_DEBOUNCE_MS; these two events are where a tab that is about to stop
  // existing says so. visibilitychange covers mobile backgrounding (where the
  // tab can be killed with no further event); pagehide covers navigation and
  // close. Neither alone is sufficient — see saveScheduler.ts. The unmount
  // cleanup flushes too, so no path out of this component leaves a write owed.
  React.useEffect(() => {
    const s = scheduler.current!;
    const onFlush = () => s.flush();
    const onVisibility = () => { if (document.visibilityState === 'hidden') s.flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onFlush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onFlush);
      s.flush();
    };
  }, []);

  /** Write now. For the once-a-turn events: starting a game, committing a year. */
  function persistState(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    scheduler.current!.now(
      { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd },
    );
  }

  /**
   * Write once the player stops moving. For the per-step decision path ONLY.
   *
   * ⚠ THIS IS THE ONLY CALLER THAT MAY DEBOUNCE, and the reason is a frequency
   * measurement rather than a category: handleDecisionsChange is the only
   * persistState caller on a path that fires more than once per turn, because
   * SliderInput is the only continuous input in the decision tree and
   * DecisionsPage's onChange is its only sink. A second high-frequency caller
   * appearing later belongs here too; a once-a-turn one does not, because
   * delaying it buys nothing and widens the window above for no reason.
   */
  function persistStateSoon(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    scheduler.current!.soon(
      { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd },
    );
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
    // ⚠ DISCARD BEFORE REMOVING, OR THE OLD GAME COMES BACK. A decision write
    // pending from the last few hundred milliseconds would fire after this
    // removeItem and write the abandoned game straight back into the key the
    // player just cleared. See SaveScheduler.discard.
    scheduler.current!.discard();
    localStorage.removeItem(SAVE_KEY);
    setActiveTab('setup');
  }, []);

  // ⚠ DEBOUNCED, AND THIS IS THE ONLY CALLER THAT IS. SliderInput's onChange is
  // a bare <input type="range">, which emits one event per STEP: the Dividend /
  // Assessment slider's 80 steps wrote the whole save 80 times for one drag.
  // See persistStateSoon and saveScheduler.ts.
  const handleDecisionsChange = useCallback((d: DecisionSet) => {
    setCurrentDecisions(d);
    if (gameState && startingFinancials) {
      persistStateSoon(gameState, startingFinancials, initialMembers, d);
    }
  }, [gameState, startingFinancials, initialMembers]);

  const isStarted = gameState?.isStarted ?? false;
  const activeLines = gameState?.setup.activeLines ?? [];

  // Guard against a stale selection (e.g. a loaded save with fewer active
  // lines than were selected before) by falling back to 'pool'.
  const lineView: LineView = lineViewRaw === 'pool' || activeLines.includes(lineViewRaw as CoverageLine)
    ? lineViewRaw
    : 'pool';

  return (
    <GameShell
      gameState={gameState}
      startingFinancials={startingFinancials}
      initialMembers={initialMembers}
      currentDecisions={currentDecisions}
      onDecisionsChange={handleDecisionsChange}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      lineView={lineView}
      onSelectLineView={setLineView}
      onNewGame={handleNewGame}
      onAdvanceYear={handleAdvanceYear}
      canAdvance={isStarted && !gameState?.isComplete}
      setupPage={<SetupPage onStart={handleStartGame} />}
      loanPrompt={pendingYear
        ? <LoanPromptModal offers={pendingYear.loanOffers} onResolve={handleResolveLoans} />
        : undefined}
      banner={saveFailure ? (
        /*
          ⚠ THE SAVE-FAILURE BANNER, AND IT IS DELIBERATELY NOT DISMISSABLE.
          The defect this replaces was a swallowed QuotaExceededError: the game
          stopped being written at year 4 and said nothing, so the loss only
          surfaced on reload, by which time the session was over. This sits above
          the header, stays for the rest of the session, and names the remedy the
          player can actually act on — finish and export, rather than reload.
          A dismissable toast would be the same defect with a longer fuse.
        */
        <div role="alert" className="bg-red-700 text-white px-4 py-3 text-sm font-medium">
          <span className="font-bold">This game is no longer being saved.</span>{' '}
          {saveFailure.reason === 'quota'
            ? `The browser refused a ${saveFailure.chars.toLocaleString()}-character save (storage full).`
            : `The browser refused the save (${saveFailure.detail}).`}{' '}
          Keep playing — the session in this tab is intact — but do NOT reload or close
          this tab, and export your results before you finish.
        </div>
      ) : undefined}
    />
  );
}
