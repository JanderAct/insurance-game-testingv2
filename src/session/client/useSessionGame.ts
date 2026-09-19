// ============================================================================
// THE TURN CYCLE — where a room's year change becomes a played year.
//
// ⚠ THE ENGINE IS NOT TOUCHED, AND THIS IS THE FILE THAT DEMONSTRATES IT.
// processYear is already a pure function of (GameState, DecisionSet). The only
// difference between solo and multiplayer is WHAT TRIGGERS IT: solo, a button in
// App.tsx; here, the host's advance arriving through a poll. Everything below is
// trigger and transport. No engine call is different, no engine argument is
// synthesised, and the same GameState construction the solo game does at start
// is reused verbatim.
//
// ⚠ EVERY BROWSER COMPUTES ITS OWN YEAR. Nothing central runs the simulation and
// no result is trusted from the wire. The instance is a pure function of the
// seed, so every client that builds from the same seed gets the same instance;
// each then applies ITS OWN decisions. A result posted by a team is a
// scoreboard entry, not an input — a tampered one changes that team's reported
// figures and nothing about anybody else's game.
//
// ⚠ CARRY-FORWARD IS THE DEFAULT, NOT AN EXCEPTION. A team that did not lock is
// processed on its LAST SUBMITTED decisions. Some of those fields are standing
// policy set once on purpose — Renew All, No New Business, funding at expected —
// and resetting them to engine defaults because somebody missed a deadline would
// silently undo a deliberate choice and then attribute the consequences to the
// team that did not make it. decisionsForYear re-stamps the year and changes
// nothing else.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { seedFromInstanceId } from '../../seedHash';
import { generateGameInstance } from '../../utils/instanceGenerator';
import { runPriorHistory } from '../../utils/priorHistoryEngine';
import { applyLoanAuthorizations, processYear } from '../../utils/simulationEngine';
import { defaultDecisionSet } from '../../utils/decisionDefaults';
import type { GameSetupSettings, GameState, ResultSet } from '../../types/simulation';
import { sessionTransport, type CallerView, type RoomView } from '../index';
import { decisionsForYear } from './decisions';
import { summarize, summaryToJson } from './results';

export type GamePhase = 'idle' | 'building' | 'ready' | 'processing' | 'failed';

export interface SessionGame {
  phase: GamePhase;
  // The last year this browser actually processed, or null.
  processedYear: number | null;
  lastResult: ResultSet | null;
  error: string | null;
}

export function useSessionGame(
  code: string,
  room: RoomView | null,
  you: CallerView | null,
  token: string | undefined,
): SessionGame {
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [processedYear, setProcessedYear] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<ResultSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The GameState lives in a ref rather than state: it is large, it is mutated
  // once per turn, and nothing renders from it directly. Keeping it out of state
  // avoids re-rendering every screen on a change only this file reads.
  const game = useRef<GameState | null>(null);
  const busy = useRef(false);

  // The room fields the instance is built from. If any of them changed the game
  // would be a different game, so the build is keyed on them rather than on the
  // room object's identity, which changes on every poll.
  const buildKey = room
    ? `${room.seed}|${room.yearCount}|${room.startingYear}|${room.activeLines.join(',')}|${room.poolName}`
    : null;
  const builtKey = useRef<string | null>(null);

  const build = useCallback((r: RoomView) => {
    const settings: GameSetupSettings = {
      poolName: r.poolName,
      gameLength: r.yearCount,
      startingYear: r.startingYear,
      instanceId: r.seed,
      activeLines: [...r.activeLines],
    };

    const instance = generateGameInstance(r.seed, seedFromInstanceId(r.seed));

    // ⚠ THE SHOCK SEAM, AND IT IS THE ONLY THING THIS LAYER CANNOT FINISH.
    // r.shocks is carried all the way here from the host's setup form, and the
    // engine's consuming half already exists: resolveShocks reads
    // instance.scheduledShocks as a deterministic sorted list and consumes no
    // randomness doing it. What is missing is the population step —
    // generateGameInstance takes (instanceId, seed) and never writes the field.
    //
    // Attaching it here would be a one-line spread, and it is deliberately NOT
    // done: instanceGenerator is engine code, that work is happening elsewhere,
    // and a session layer quietly assembling an instance a different way than
    // the engine's own constructor is exactly the kind of second opinion that
    // makes two code paths disagree later. When generateGameInstance accepts a
    // schedule, it is passed r.shocks here and nothing else in this file moves.
    // Until then a room's shock list is carried, displayed and ignored, which
    // leaves the game byte-identical to one with no shocks at all.

    const { poolState, priorHistory } = runPriorHistory(instance, settings);

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
    game.current = gs;
  }, []);

  // ---- build once per room identity ---------------------------------------
  useEffect(() => {
    if (!room || !buildKey || builtKey.current === buildKey) return;
    builtKey.current = buildKey;
    setPhase('building');
    setError(null);
    // Yielding first keeps the pre-game simulation off the paint that reveals
    // the screen — runPriorHistory plays three years through the real engine.
    const id = window.setTimeout(() => {
      try {
        build(room);
        setPhase('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('failed');
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [room, buildKey, build]);

  // ---- process when the room's year moves ahead of ours --------------------
  useEffect(() => {
    if (phase !== 'ready' || busy.current) return;
    if (!room || !token || you?.role !== 'player') return;

    const gs = game.current;
    if (!gs || gs.isComplete) return;
    if (gs.currentYearNumber >= room.currentYear) return;

    busy.current = true;
    setPhase('processing');

    // Kept synchronous through the engine calls, then awaited once to post.
    void (async () => {
      try {
        let state = gs;
        let produced: ResultSet | null = null;

        // A loop rather than a single step: a tab that joined late, or was
        // asleep while the host advanced twice, has more than one year to catch
        // up on and must play them in order rather than skipping to the front.
        while (state.currentYearNumber < room.currentYear && !state.isComplete) {
          const year = state.currentYearNumber;
          const decisions = decisionsForYear(year, you.lastDecisions);
          const processed = processYear(state, decisions);

          // ⚠ AN UNRESOLVED LOAN OFFER IS DECLINED, AND THAT IS A REAL
          // SIMPLIFICATION TO FLAG. Solo play pauses on a loan offer and asks
          // the player to authorize or decline it. A session year is triggered
          // by the host, not by the team, so there is nobody to ask at the
          // moment it arises — the team may not even have the tab focused.
          // Declining is the choice that changes nothing on its own initiative,
          // matching the same reasoning as the renewal and appetite defaults.
          // An interactive loan step belongs in the turn cycle later, before a
          // deficient line is a realistic outcome in a taught session.
          const settled = processed.loanOffers.length > 0
            ? applyLoanAuthorizations(processed, year, [])
            : { updatedPoolState: processed.updatedPoolState, result: processed.result };

          const nextYear = year + 1;
          state = {
            ...state,
            currentYearNumber: nextYear,
            isComplete: nextYear > state.setup.gameLength,
            poolState: settled.updatedPoolState,
            lockedResults: [...state.lockedResults, settled.result],
            currentDecisions: defaultDecisionSet(nextYear),
          };
          produced = settled.result;
        }

        game.current = state;

        if (produced) {
          setLastResult(produced);
          setProcessedYear(produced.yearNumber);
          // Posting is best-effort: the year is played and held locally whether
          // or not the scoreboard entry lands, so a failed post must not roll
          // back a computed year. It is retried by the next year's post.
          await sessionTransport().submit({
            code,
            token,
            yearNumber: produced.yearNumber,
            result: summaryToJson(summarize(produced)),
          });
        }
        setError(null);
        setPhase('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('ready');
      } finally {
        busy.current = false;
      }
    })();
  }, [phase, room, you, token, code]);

  return { phase, processedYear, lastResult, error };
}
