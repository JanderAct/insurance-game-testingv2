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
import { openingRoster } from '../../game/openingRoster';
import { generateGameInstance } from '../../utils/instanceGenerator';
import { runPriorHistory } from '../../utils/priorHistoryEngine';
import { applyLoanAuthorizations, processYear } from '../../utils/simulationEngine';
import { defaultDecisionSet } from '../../utils/decisionDefaults';
import type { CoverageLine, GameSetupSettings, GameState, Member, PoolState, ResultSet, StartingFinancials } from '../../types/simulation';
import { sessionTransport, type CallerView, type RoomView } from '../index';
import { decisionsForYear } from './decisions';
import { summarize } from './results';

export type GamePhase = 'idle' | 'building' | 'ready' | 'processing' | 'failed';

export interface SessionGame {
  phase: GamePhase;
  // ⚠ THE GAME ITSELF, BECAUSE THE PLAYER NOW RENDERS IT. This used to be a ref
  // on the grounds that "nothing renders from it directly" — true when the
  // player had a four-slider panel, and false the moment they get the real game.
  // The shell reads every tab off this, so it is state.
  gameState: GameState | null;
  // The Year 1 opening position, out of the same runPriorHistory call that
  // builds the pool. The solo path takes it from there too.
  startingFinancials: StartingFinancials | null;
  // The year-0 roster, from the shared openingRoster the solo path also calls —
  // every active line's members, deduplicated. This was `lines.WC` in BOTH
  // callers until the fix landed in one place for both; mirroring the defect was
  // deliberate while it was only fixable in one of them.
  initialMembers: Member[];
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

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [startingFinancials, setStartingFinancials] = useState<StartingFinancials | null>(null);
  const [initialMembers, setInitialMembers] = useState<Member[]>([]);
  const busy = useRef(false);
  // ⚠ HELD SO THE OPENING POST CAN BE RETRIED, WHICH A FIRE-ONCE POST AT BUILD
  // CANNOT BE. The build effect runs once per room identity; if its post does
  // not land — a transport blip, or a token that had not resolved at that
  // instant — nothing ever tries again and the team is permanently missing its
  // year-0 point while every later year arrives normally.
  const opening = useRef<{ result: ResultSet; poolState: PoolState } | null>(null);

  // ⚠ THE TEAM'S OWN LINES, NOT THE ROOM'S MENU. Teams in one room now play
  // different books: the room offers a set and each team chose a subset of it at
  // join. Building from room.availableLines would hand every team every line the
  // host listed and quietly undo the choice.
  //
  // ⚠ AND THE LINE SET IS PART OF THE BUILD KEY. Two different subsets are two
  // different games, so a key that omitted them would let a rebuild reuse a game
  // assembled for a different book.
  const myLines = you?.lines;
  const buildKey = room && myLines && myLines.length > 0
    ? `${room.seed}|${room.yearCount}|${room.startingYear}|${myLines.join(',')}|${room.eventName}`
    : null;
  const builtKey = useRef<string | null>(null);

  const build = useCallback((r: RoomView, lines: CoverageLine[]) => {
    const settings: GameSetupSettings = {
      // ⚠ THE EVENT'S NAME, DELIBERATELY UNCHANGED IN MEANING. The engine's
      // GameSetupSettings.poolName is display-only (the Header chip), and it has
      // always carried the room's name for every team. Renaming the room field
      // does not change what the engine is handed. Naming each team's pool after
      // the TEAM would read better and is a separate decision — it would change
      // what every session player sees in the header.
      poolName: r.eventName,
      gameLength: r.yearCount,
      startingYear: r.startingYear,
      instanceId: r.seed,
      activeLines: [...lines],
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

    const { poolState, startingFinancials: sf, priorHistory } = runPriorHistory(instance, settings);

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
    setGameState(gs);
    setStartingFinancials(sf);
    // The same openingRoster the solo path calls, over THIS TEAM's lines. The
    // lines.WC read that stood here — mirroring App.tsx's own — is gone from
    // both callers at once, which is the only way to fix it without the session
    // assembling a GameState differently from solo.
    setInitialMembers(openingRoster(poolState, settings.activeLines));

    // ⚠ THE OPENING POSITION IS A REAL ENGINE YEAR, WHICH IS WHY IT CAN BE
    // POSTED AT ALL. runPriorHistory plays the pre-game through processYear and
    // numbers its last year 0; that year's ResultSet is where the opening
    // surplus, the opening roster and the opening reserve come from. So the
    // chart's year-0 point is not assembled from three loose fields — it is the
    // same summarize() over the same shape, one year earlier.
    //
    // ⚠ THE POOL STATE COMES BACK WITH IT, because the summary needs BOTH: the
    // ResultSet is the year's own news and the reserve ledger on the pool state
    // is every prior accident year restated as at that year. At year 0 the
    // ledger already exists — the pre-game wrote it — so the opening post
    // carries a developed column like every other post.
    const openingResult = priorHistory.find(r => r.yearNumber === 0) ?? null;
    opening.current = openingResult ? { result: openingResult, poolState } : null;
    return opening.current;
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
        const built = build(room, myLines!);
        setPhase('ready');

        // ⚠ POSTED ONCE, AT BUILD, BECAUSE THE HOST CANNOT DERIVE IT. The room
        // holds a seed and no engine; the host never runs the simulation, and
        // the opening position is not even the same for every team, since each
        // team's is the sum over the LINES IT CHOSE. Either the host runs a
        // pre-game per team's line set — a second path computing what the teams
        // already computed — or the teams post what they built. This is the
        // second, and it is the same summarize() the played years use.
        //
        // Best-effort, like the year posts: a game that is built and playable
        // must not fail because a scoreboard write did not land, and a reload
        // re-posts the identical entry over itself.
        if (built && token && you?.role === 'player') {
          void sessionTransport()
            .submit({ code, token, yearNumber: 0, result: summarize(built.result, myLines!, built.poolState) })
            .catch(() => { /* the opening point is missing until the next build; the game is not */ });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('failed');
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [room, buildKey, build, myLines, code, token, you?.role]);

  // ---- process when the room's year moves ahead of ours --------------------
  useEffect(() => {
    if (phase !== 'ready' || busy.current) return;
    // ⚠ A VIEWER RUNS THE SAME TURN CYCLE, AND THAT IS THE WHOLE OF WHAT MAKES
    // /view A FLAG RATHER THAN A SCREEN. callerOf resolves a viewer to the team
    // it watches and callerView hands back THAT TEAM's decisions, so a viewer
    // builds the same game from the same seed and plays the same years with the
    // same choices. Its numbers are the driver's numbers because they are the
    // same computation, not because anything was copied across.
    const plays = you?.role === 'player' || you?.role === 'viewer';
    if (!room || !token || !plays) return;

    const gs = gameState;
    if (!gs || gs.isComplete) return;
    if (gs.currentYearNumber >= room.currentYear) return;

    busy.current = true;
    setPhase('processing');

    // Kept synchronous through the engine calls, then awaited once to post.
    void (async () => {
      try {
        let state = gs;
        // ⚠ EVERY YEAR THE LOOP PRODUCES, NOT THE LAST ONE. This was a single
        // `produced` slot, and that made the room's record depend on how far
        // behind a tab happened to be: a tab catching up three years computed
        // all three and posted only the third, so the host's charts lost the two
        // in between FOREVER. Measured before the fix — a tab three years behind
        // left the room holding years [0, 3] with 1 and 2 simply absent.
        //
        // ⚠ AND EACH CARRIES ITS OWN POOL STATE, because the developed column is
        // a VALUATION. Posting three years against the newest pool state would
        // back-date today's reserve estimates onto years that had not seen them.
        const produced: Array<{ result: ResultSet; poolState: PoolState }> = [];

        // A loop rather than a single step: a tab that joined late, or was
        // asleep while the host advanced twice, has more than one year to catch
        // up on and must play them in order rather than skipping to the front.
        while (state.currentYearNumber < room.currentYear && !state.isComplete) {
          const year = state.currentYearNumber;
          // ⚠ THE YEAR'S OWN SET, NOT THE LATEST ONE. This loop is the whole
          // reason the room stores a history: it runs on a reload, replaying
          // every year from the seed, and reading one slot for all of them
          // produced results the team never played.
          const decisions = decisionsForYear(year, you.decisionsByYear);
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
          produced.push({ result: settled.result, poolState: settled.updatedPoolState });
        }

        setGameState(state);

        if (produced.length > 0) {
          const newest = produced[produced.length - 1].result;
          setLastResult(newest);
          setProcessedYear(newest.yearNumber);
          // ⚠ A VIEWER COMPUTES BUT DOES NOT POST, AND SUPPRESSING IT HERE IS
          // NOT BELT-AND-BRACES. The transport already refuses — submit requires
          // a player token and a viewer's raises BAD_TOKEN — so attempting the
          // post would put a transport error on a read-only screen every single
          // year, for a write that was never wanted. The scoreboard belongs to
          // the team that drives it; a watcher adds nothing to it.
          if (you.role === 'player') {
            // ⚠ THE OPENING POSITION IS RE-POSTED IF THE ROOM IS MISSING IT, and
            // this is the only retry it has. `you` is the last poll's view of the
            // room, so the test is occasionally stale; a re-post writes the same
            // year with the same values, which is why being wrong here is free
            // and being right matters.
            if (opening.current && !(you.postedYears ?? []).includes(0)) {
              await sessionTransport().submit({
                code, token, yearNumber: 0,
                result: summarize(opening.current.result, state.setup.activeLines, opening.current.poolState),
              });
            }
            // Posting is best-effort: the years are played and held locally
            // whether or not the scoreboard entries land, so a failed post must
            // not roll back a computed year. In order, oldest first, so a partial
            // failure leaves a prefix rather than a hole.
            for (const p of produced) {
              await sessionTransport().submit({
                code,
                token,
                yearNumber: p.result.yearNumber,
                result: summarize(p.result, state.setup.activeLines, p.poolState),
              });
            }
          }
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
  }, [phase, room, you, token, code, gameState]);

  return { phase, gameState, startingFinancials, initialMembers, processedYear, lastResult, error };
}
