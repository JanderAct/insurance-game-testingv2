// ============================================================================
// A TEAM'S GAME, BUILT FROM THE ROOM — AND REPLAYED FROM IT.
//
// Pure: no React, no transport, no storage. useSessionGame calls these two
// functions and nothing else to build and advance a team's game, and the
// session proof in scripts/diagnostics/shock-check.ts calls the same two. That
// is what lets "a reloaded player rebuilds the same year" be PROVEN in node,
// against the code a reloading browser actually runs, rather than argued from
// a reading of the hook.
//
// ⚠ THE ROOM'S SHOCK SCHEDULE GOES THROUGH THE ENGINE'S OWN CONSTRUCTOR. It is
// passed to generateGameInstance as an argument, exactly as solo passes its
// (empty) list — this module does not attach it to an instance it built some
// other way. A second instance-assembly path is how two callers come to
// disagree, and this seam was left open until the constructor could take it.
//
// ⚠ A RELOAD IS A REBUILD. A session player keeps no save: every browser builds
// from the room's seed and schedule and replays each year on that team's own
// recorded decisions. So the schedule has to be in the room record, which it
// is, and has to reach the constructor on EVERY build, which is the line below.
// A rebuild that dropped it would replay the year without the wildfire and post
// numbers the team never played — the decisions-history defect's class.
// ============================================================================

import { seedFromInstanceId } from '../../seedHash';
import { openingRoster } from '../../game/openingRoster';
import { generateGameInstance } from '../../utils/instanceGenerator';
import { runPriorHistory } from '../../utils/priorHistoryEngine';
import { applyLoanAuthorizations, processYear } from '../../utils/simulationEngine';
import { defaultDecisionSet } from '../../utils/decisionDefaults';
import type { CoverageLine, GameSetupSettings, GameState, Member, PoolState, ResultSet, StartingFinancials } from '../../types/simulation';
import type { JsonValue, RoomView } from '../contract';
import { decisionsForYear } from './decisions';

export type RoomBuildInputs = Pick<RoomView, 'seed' | 'yearCount' | 'startingYear' | 'eventName' | 'shocks'>;

export interface BuiltTeamGame {
  gameState: GameState;
  startingFinancials: StartingFinancials;
  initialMembers: Member[];
  opening: { result: ResultSet; poolState: PoolState } | null;
}

export function buildTeamGame(r: RoomBuildInputs, lines: readonly CoverageLine[]): BuiltTeamGame {
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

  // THE ROOM'S SCHEDULE, THROUGH THE CONSTRUCTOR. An empty one writes no field.
  const instance = generateGameInstance(r.seed, seedFromInstanceId(r.seed), r.shocks);

  const { poolState, startingFinancials, priorHistory } = runPriorHistory(instance, settings);

  const gameState: GameState = {
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

  const openingResult = priorHistory.find(res => res.yearNumber === 0) ?? null;
  return {
    gameState,
    startingFinancials,
    // The same openingRoster the solo path calls, over THIS TEAM's lines. The
    // lines.WC read that stood here — mirroring App.tsx's own — is gone from
    // both callers at once, which is the only way to fix it without the session
    // assembling a GameState differently from solo.
    initialMembers: openingRoster(poolState, settings.activeLines),
    opening: openingResult ? { result: openingResult, poolState } : null,
  };
}

// Advance a team's game to `targetYear` (exclusive) on its own recorded
// decisions — the carry-forward rule is decisionsForYear's. Returns the new
// state and every year it produced, oldest first.
export function replayTeamYears(
  start: GameState,
  targetYear: number,
  decisionsByYear: Record<string, JsonValue> | undefined,
): { state: GameState; produced: Array<{ result: ResultSet; poolState: PoolState }> } {
  let state = start;
  const produced: Array<{ result: ResultSet; poolState: PoolState }> = [];

  // ⚠ EVERY YEAR THE LOOP PRODUCES, NOT THE LAST ONE, each with its own pool
  // state — the caller posts all of them. See useSessionGame for the defect a
  // single slot caused.
  //
  // A loop rather than a single step: a tab that joined late, or was asleep
  // while the host advanced twice, has more than one year to catch up on and
  // must play them in order rather than skipping to the front.
  while (state.currentYearNumber < targetYear && !state.isComplete) {
    const year = state.currentYearNumber;
    // ⚠ THE YEAR'S OWN SET, NOT THE LATEST ONE. This loop is the whole reason
    // the room stores a history: it runs on a reload, replaying every year from
    // the seed, and reading one slot for all of them produced results the team
    // never played.
    const decisions = decisionsForYear(year, decisionsByYear);
    const processed = processYear(state, decisions);

    // ⚠ AN UNRESOLVED LOAN OFFER IS DECLINED, AND THAT IS A REAL
    // SIMPLIFICATION TO FLAG. Solo play pauses on a loan offer and asks the
    // player to authorize or decline it. A session year is triggered by the
    // host, not by the team, so there is nobody to ask at the moment it arises —
    // the team may not even have the tab focused. Declining is the choice that
    // changes nothing on its own initiative, matching the same reasoning as the
    // renewal and appetite defaults. An interactive loan step belongs in the
    // turn cycle later, before a deficient line is a realistic outcome in a
    // taught session.
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
  return { state, produced };
}
