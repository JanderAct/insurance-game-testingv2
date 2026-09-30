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
import type { CoverageLine, GameState, Member, PoolState, ResultSet, StartingFinancials } from '../../types/simulation';
import { sessionTransport, type CallerView, type RoomView } from '../index';
import { summarize } from './results';
import { buildTeamGame, replayTeamYears } from './buildGame';

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
  // assembled for a different book. So is the shock schedule, for the same
  // reason: it is fixed at room creation and never edited, so the key never
  // moves on it in play — it is in the key so that nothing could reuse a game
  // built for a different schedule if that ever stopped being true.
  const myLines = you?.lines;
  const buildKey = room && myLines && myLines.length > 0
    ? `${room.seed}|${room.yearCount}|${room.startingYear}|${myLines.join(',')}|${room.eventName}|${JSON.stringify(room.shocks)}`
    : null;
  const builtKey = useRef<string | null>(null);

  // ⚠ THE BUILD IS buildTeamGame's, AND THE ROOM'S SHOCK SCHEDULE REACHES THE
  // ENGINE'S OWN CONSTRUCTOR THROUGH IT. This was the seam: the room carried the
  // list all the way here and the instance was built without it, so a
  // scheduled wildfire never fired. It is closed in generateGameInstance, which
  // now takes the schedule as an argument from both callers, rather than by this
  // layer attaching it to an instance assembled some other way.
  const build = useCallback((r: RoomView, lines: CoverageLine[]) => {
    const built = buildTeamGame(r, lines);
    setGameState(built.gameState);
    setStartingFinancials(built.startingFinancials);
    setInitialMembers(built.initialMembers);
    opening.current = built.opening;
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
        // ⚠ THE REPLAY IS replayTeamYears', the same function the session proof
        // in shock-check runs — see buildGame.ts for the rules it carries: every
        // year produced, the year's own decisions, loan offers declined.
        const { state, produced } = replayTeamYears(gs, room.currentYear, you.decisionsByYear);

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
