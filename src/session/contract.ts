// ============================================================================
// THE SESSION CONTRACT — five endpoints, one interface, no implementation.
//
// ⚠ THIS FILE IS THE DELIVERABLE. localStorage is the FIRST implementation of
// it, not the design. A second implementation against HTTP must drop in with no
// client change, and everything in this file exists to make that true. If a
// swap to a hosted backend turns out to touch anything above this layer, the
// fault is here, not there.
//
// THREE RULES THAT MAKE THE SWAP A BASE-URL CHANGE RATHER THAN A REWRITE:
//
//   1. EVERY PAYLOAD IS PLAIN JSON. No class instances, no Date objects, no
//      functions, no Map/Set. Timestamps are epoch millis. A request object is
//      exactly what a POST body would carry and a response object is exactly
//      what one would return, so `JSON.stringify(req)` over `fetch` is the
//      whole of the HTTP implementation's marshalling.
//
//   2. AUTHORITY TRAVELS AS A TOKEN FIELD ON THE REQUEST. Not as connection
//      state, not as a module-level "current user", not as something the
//      transport remembers between calls. Every call that needs authority
//      carries it explicitly, so the HTTP implementation lifts that field into
//      an `Authorization` header and changes nothing else. A transport that
//      remembered who you were would be a transport that could not be
//      statelessly re-pointed.
//
//   3. THE ENGINE'S DATA IS OPAQUE. `decisions` and `result` are JsonValue and
//      this layer NEVER looks inside them. It stores them, hands them back, and
//      carries the last one forward. That is what keeps the session layer from
//      growing a second, divergent opinion about what a decision is — and it is
//      why nothing in src/utils had to change to make multiplayer work.
//
// ASYNC AND FALLIBLE FROM DAY ONE. Every method returns a promise and every
// method can reject. That is not defensive padding: the localStorage
// implementation is synchronous underneath and could have exposed a synchronous
// API, which would have compiled fine and then needed every call site rewritten
// the first time a real network appeared. Loading and failure states get built
// and exercised now, against a fake latency and an injectable fault, rather than
// discovered against the first real network.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

// ---------------------------------------------------------------- json

// What may cross the boundary. Deliberately narrow: if a payload cannot be
// expressed in this type it cannot survive a real HTTP hop either, so the
// compiler refuses it here rather than the network refusing it later.
export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ---------------------------------------------------------------- shocks

// The shock schedule the room carries.
//
// ⚠ CARRIED, NOT CONSUMED — AND THE CONSUMING HALF IS ALREADY BUILT. The engine
// reads its schedule as a deterministic list already: resolveShocks (see
// src/utils/shockResolver.ts) filters `instance.scheduledShocks` by fire year,
// sorts by (year, catalog id), and CONSUMES NO RANDOMNESS doing it — that is the
// byte-identity guarantee stated in its own header. `ScheduledShock` in
// src/types/shocks.ts is structurally identical to this type.
//
// WHAT IS STILL MISSING is only the population step: generateGameInstance
// (src/utils/instanceGenerator.ts) takes (instanceId, seed) and never writes
// the `scheduledShocks` field, so nothing today can get a list from setup into
// the instance the engine reads. That single seam is the entire remaining gap,
// it lives in engine code this work does not touch, and it is being done
// elsewhere. The room record below carries the list so that when the seam lands
// the schedule is already flowing to every client.
export interface ScheduledShockSpec {
  shockId: string;
  yearNumber: number;
}

// ---------------------------------------------------------------- errors

export type SessionErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_TAKEN'
  | 'BAD_TOKEN'
  | 'NOT_HOST'
  | 'WRONG_YEAR'
  | 'GAME_COMPLETE'
  | 'INVALID_REQUEST'
  // A rejoin asked for different coverage lines than the team already holds.
  // Lines are that team's game setup, chosen once; changing them mid-game would
  // restart its book, so the transport refuses rather than the screen merely
  // hiding the control.
  | 'LINES_LOCKED'
  | 'TRANSPORT_FAILURE';

// ⚠ ONE ERROR TYPE FOR EVERY IMPLEMENTATION, and `code` is what callers branch
// on — never the message. An HTTP implementation maps status codes onto these
// same codes (404 -> ROOM_NOT_FOUND, 403 -> BAD_TOKEN/NOT_HOST, 409 ->
// WRONG_YEAR, anything else -> TRANSPORT_FAILURE) and every existing catch block
// keeps working untouched.
//
// `retryable` separates "the call was wrong" from "the pipe was" — a UI retries
// the second and reports the first. That distinction is invisible while the
// pipe is localStorage and load-bearing the moment it is not.
export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly retryable: boolean;

  constructor(code: SessionErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isSessionError(e: unknown): e is SessionError {
  return e instanceof SessionError;
}

// ---------------------------------------------------------------- results

/**
 * The five figures the host's Teams tab scans, for one scope of one team-year.
 *
 * ⚠ EVERY ONE IS A RESULT_METRICS KEY, AND THAT IS THE POINT. The on-screen
 * spreadsheet and the .xlsx export share one list precisely because two copies
 * drifted twice; a host table quoting figures from a list of its own would be
 * the third copy. Field for field:
 *
 *   endingSurplus                  <- RESULT_METRICS 'endingSurplus'
 *   actualLossRatioPricingBasis    <- 'actualLossRatioPricingBasis'
 *   poolPremium                    <- 'poolPremium'
 *   activeMembers                  <- 'activeMembers'
 *   selectedFundingConfidenceLevel <- 'fundingConfidenceLevel' (the metric reads
 *                                     this field; the key is named for the
 *                                     decision, the field for what was selected)
 *   netUltimateLoss                <- 'netUltimateLoss' ("Net Ultimate Loss +
 *                                     LAE"), added for the Charts tab
 *
 * ⚠ netUltimateLoss AND NOT netIncurredLoss, AND THE NEAR MISS IS WORTH
 * RECORDING. netIncurredLoss is a real ResultSet field and is NOT in
 * RESULT_METRICS — picking it would have been grossPremium a second time, a
 * figure published to a second party from a list nobody curated. Of the two,
 * netUltimateLoss is also the one the chart wants: it is this year's losses
 * after reinsurance recovery, which is what reaches surplus, where
 * netIncurredLoss folds in prior-year reserve development and so moves for
 * reasons that did not happen this year.
 *
 * ⚠ AND poolPremium REPLACES grossPremium, WHICH WAS NEVER IN THE LIST. The
 * first version of this summary posted grossPremium — a real ResultSet field,
 * but not a metric anybody had chosen to publish. It had already forked, quietly
 * and by one field. It reads as Pool Premium at Selected CLF now, the same thing
 * the Result Spreadsheet calls it.
 */
export interface TeamYearFigures {
  endingSurplus: number;
  actualLossRatioPricingBasis: number;
  poolPremium: number;
  activeMembers: number;
  selectedFundingConfidenceLevel: number;
  netUltimateLoss: number;
}

/**
 * What a team posts at the end of a year, and the ONE payload in this contract
 * that is typed rather than opaque.
 *
 * ⚠ DECISIONS STAY OPAQUE; RESULTS DO NOT, AND THE SPLIT IS PRINCIPLED RATHER
 * THAN CONVENIENT. A team's decisions are read by exactly one client — the one
 * that wrote them — so this layer never needs to know their shape and is better
 * off not knowing. A result is read by a SECOND PARTY: the host renders it in a
 * table. A payload a second party renders has to have an agreed shape, or the
 * agreement lives in two places and drifts.
 *
 * ⚠ byLine CARRIES ONLY THE LINES THE TEAM WRITES. A team that does not write GL
 * has no GL entry — not a zeroed one. That absence is what lets the host's table
 * say "does not write GL" instead of showing a surplus of $0, and it is the
 * distinction the whole Teams tab turns on.
 */
/**
 * ⚠ THE DEVELOPED TRIANGLE'S CURRENT COLUMN: one accident year's NET ULTIMATE AT
 * THIS VALUATION, keyed by accident year as a string. Posted afresh every year,
 * because that is what makes it the current column rather than a frozen one.
 *
 * ⚠ AND IT IS NOT A RESULT_METRICS KEY, WHICH IS A STATEMENT AND NOT AN
 * OVERSIGHT. A RESULT_METRICS entry maps ONE ResultSet to ONE value; this is a
 * value per accident year per valuation, and it does not live on a ResultSet at
 * all — it lives on LinePoolState.reserveDevelopment, the append-only ledger.
 * Inventing a metric key for it would be the grossPremium mistake in reverse:
 * not a figure published from outside the list, but a quantity forced into a
 * list it does not fit. What this DOES reuse is the ledger's existing reader —
 * actuarialMemo's exhibitRows/poolExhibitRows, the same functions the Actuarial
 * memorandum's development exhibit is built from, clamping rule included. One
 * field, one derivation, two readers.
 */
export type DevelopedUltimates = Record<string, number>;

export interface TeamYearSummary {
  /**
   * ⚠ 0 IS A LEGITIMATE YEAR HERE, AND IT IS THE OPENING POSITION. The pre-game
   * runs real engine years before year 1 — that is why an opening reserve, an
   * opening roster and an opening surplus exist at all — and its last year is
   * numbered 0. Posting it is what lets a chart start where the game starts
   * rather than at the first decision. A negative year is refused: the earlier
   * pre-game years are the scaffolding that built the opening position, not part
   * of the session the host is running.
   */
  yearNumber: number;
  calendarYear: number;
  /** The pooled row — the aggregate, meaning what it means everywhere else. */
  pool: TeamYearFigures;
  byLine: Partial<Record<CoverageLine, TeamYearFigures>>;
  /**
   * ⚠ EVERY ACCIDENT YEAR SO FAR, RE-REPORTED AT THIS YEAR'S VALUATION — a
   * TRIANGLE COLUMN, not a line. pool.netUltimateLoss above is the accident
   * year as BOOKED when it happened and is frozen forever; this says what every
   * accident year is thought to cost NOW. Under forward booking those are very
   * different numbers — measured on a ten-year WC game, an accident year's
   * latest valuation runs 1.2x its booked figure at age 2 and 1.85x by age 12 —
   * and a chart with only the first can never show the second happening.
   *
   * ⚠ IT IS THE ONLY PART OF THIS PAYLOAD THAT RESTATES THE PAST, and that is
   * the cost of the thing: each post carries a number per accident year per
   * scope rather than one number. Accident years BELOW 0 are dropped — the
   * pre-game's own years and the seeded cohorts are off the chart's axis, and
   * carrying fourteen of them in every post forever is a payload nothing reads.
   */
  developed?: {
    pool: DevelopedUltimates;
    byLine: Partial<Record<CoverageLine, DevelopedUltimates>>;
  };
}

// ---------------------------------------------------------------- views

export type RoomStatus = 'lobby' | 'running' | 'complete';
export type CallerRole = 'host' | 'player' | 'viewer' | 'anonymous';

// What a team looks like to anyone allowed to see the table.
//
// ⚠ PRESENCE AND PROGRESS ONLY — NEVER ANOTHER TEAM'S DECISIONS. The host runs
// the room; the host does not need to see what a team chose before that team's
// year is processed, and a host screen that could show it would be one
// accidental render away from projecting it. `read` enforces this rather than
// trusting the caller to look away.
export interface TeamView {
  name: string;
  // ⚠ THE TEAM'S OWN COVERAGE LINES, CHOSEN AT JOIN AND FIXED FOR THE SESSION.
  // Teams in one room now play different books, so the host is reading a table
  // of games rather than a table of seats — which is why this belongs in the
  // view rather than being inferable from the room.
  lines: CoverageLine[];
  joined: boolean;
  // The last year this team locked decisions for, or null if it never has.
  lockedYear: number | null;
  // Locked for the room's CURRENT year specifically — what the host's table and
  // the advance control actually key on.
  locked: boolean;
  /**
   * The highest PLAYED year this team has posted a result for, or null — a
   * convenience over resultsByYear for the Game Setup tab's Reported column.
   *
   * ⚠ IT IGNORES YEAR 0, AND THE ASYMMETRY IS THE POINT. The opening position
   * is posted as year 0 the moment a team builds its game, before anybody has
   * decided anything. It belongs on a chart's x-axis and it is NOT a year the
   * team has played, so a host's "Reported: year 0" against a team that has done
   * nothing yet would be a tick for turning up.
   */
  resultYear: number | null;
  /**
   * ⚠ THE SCOREBOARD, AND THE HOST IS MEANT TO SEE IT. The redaction rule next
   * to callerView still holds for DECISIONS — presence and progress, never
   * content — because a host who could read what a team chose before the year is
   * processed is one render away from projecting it. A posted RESULT is the
   * opposite: it is the thing the room exists to compare, it describes a year
   * already played, and the host's Teams tab is where it is read.
   *
   * ⚠ EVERY YEAR, NOT THE LATEST ONE, AND IT WAS A SLOT UNTIL THE CHARTS TAB
   * NEEDED OTHERWISE. This is the same defect the decision history fixed, in a
   * different field: one slot per team can serve a table of the last completed
   * year and cannot serve a line over time, because the host's record only ever
   * held the most recent year. Keyed by year as a STRING, per JSON.
   *
   * ⚠ YEAR "0" IS THE OPENING POSITION, NOT A PLAYED YEAR. See TeamYearSummary.
   */
  resultsByYear?: Record<string, TeamYearSummary>;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  seed: string;
  /**
   * ⚠ THE EVENT, NOT A POOL. The host is running a SESSION — a class, a
   * workshop — and each team runs its own pool inside it. Naming the room after
   * a pool made sense only while every team shared one.
   */
  eventName: string;
  yearCount: number;
  startingYear: number;
  /**
   * ⚠ HOW MANY TEAMS THE HOST EXPECTS, AND IT BINDS NOTHING. It exists for one
   * question — is everyone here yet — which is what decides when to advance
   * year 1. The transport does NOT refuse an extra team: the number is the
   * host's estimate before the room opens, and a room where four turn up
   * instead of five must not be stuck forever because of a guess.
   */
  expectedTeams: number;
  currentYear: number;
  shocks: ScheduledShockSpec[];
  teams: TeamView[];
  createdAt: number;
  updatedAt: number;
  // Monotonic per write. A poller compares this to know something moved without
  // diffing the whole record, and an HTTP implementation can serve it as an
  // ETag for free.
  rev: number;
}

// What the CALLER may see of their own slice — the part `read` redacts by token.
export interface CallerView {
  role: CallerRole;
  teamName?: string;
  // The caller's own team's lines — the set its GameState is built from. A
  // viewer gets the watched team's, which is what lets it build the same game.
  lines?: CoverageLine[];
  /**
   * ⚠ THE CALLER'S OWN DECISIONS, PER YEAR, AND IT REPLACED A SINGLE SLOT.
   * The room used to hold one `lastDecisions` per team, overwritten on every
   * submit. That made the record flat in the year count — pleasingly cheap, and
   * wrong: a client rebuilding from the seed after a reload had only the LATEST
   * set to replay every prior year with, so a team that varied its choices was
   * shown numbers it never played, and the host's table (built from what was
   * posted at the time) disagreed with the team's own screen. Viewers replayed
   * identically wrong.
   *
   * ⚠ KEYED BY YEAR AS A STRING, BECAUSE THAT IS WHAT JSON DOES. A numeric key
   * survives JSON.stringify as "3"; typing it as a number here would be a lie
   * the first time this crossed a real network.
   *
   * ⚠ CARRY-FORWARD NOW MEANS "THE MOST RECENT YEAR THAT HAS ONE", not "the
   * single slot". A team that did not lock year 3 is still processed on what it
   * last chose — that is unchanged and still the point — but "what it last
   * chose" is now answered per target year rather than globally. See
   * decisionsForYear.
   */
  decisionsByYear?: Record<string, JsonValue>;
  // This caller's own last posted result — the same typed summary the host
  // reads, so a team and the host are never looking at two shapes of one thing.
  lastResult?: TeamYearSummary;
  lastResultYear?: number;
}

// ---------------------------------------------------------------- requests

export interface CreateRoomRequest {
  seed: string;
  yearCount: number;
  startingYear: number;
  eventName: string;
  /** Non-binding — see RoomView.expectedTeams. */
  expectedTeams: number;
  shocks: ScheduledShockSpec[];
}

export interface CreateRoomResponse {
  code: string;
  // ⚠ RETURNED ONCE AND NEVER READABLE AGAIN. This is what makes the host the
  // host; `read` never discloses it. It is shown at creation as the resume code
  // precisely because a closed laptop otherwise ends the session.
  hostToken: string;
  room: RoomView;
}

export interface JoinRequest {
  code: string;
  /**
   * A PLAYER NAMES ITS OWN TEAM HERE and the name must be free in this room; a
   * VIEWER names an existing team to watch. The host no longer pre-registers a
   * roster, because the name is part of the team's own game setup — the same
   * act as choosing its lines, and set at the same single moment.
   */
  teamName: string;
  role: 'player' | 'viewer';
  /**
   * ⚠ THE TEAM'S COVERAGE LINES, REQUIRED FOR A PLAYER'S FIRST JOIN AND FIXED
   * FROM THAT MOMENT. The set may not be empty and every entry must be a real
   * coverage line, but there is no room-level MENU any more: all three are
   * available in every room and the host does not constrain the choice. (A
   * menu, if one is ever wanted, is a field on the room record and a filter
   * here — it was removed because nothing was using it to say no.) On a REJOIN this may be omitted; if it is supplied and
   * differs from what the team already holds, the call is refused with
   * LINES_LOCKED rather than quietly honoured or quietly ignored. Changing them
   * mid-game would restart that team's book — its pre-game, its roster and its
   * whole claim history are a function of the lines it opened with.
   */
  lines?: CoverageLine[];
  // ⚠ REJOIN, NOT A SECOND CLAIM. The same browser returning to the same code
  // presents the token it already holds and gets its own seat back. Without
  // this, a refresh reads as a different person trying to take a team that is
  // already taken, and the real driver is locked out of their own game.
  token?: string;
}

export interface JoinResponse {
  teamToken: string;
  teamName: string;
  role: 'player' | 'viewer';
  /** What the team actually holds — authoritative, and on a rejoin this is the
   *  set chosen originally rather than anything the caller asked for. */
  lines: CoverageLine[];
  rejoined: boolean;
  room: RoomView;
}

// Decisions for a year, a result for a year, or both.
//
// ⚠ ONE ENDPOINT, TWO SLOTS, AND THAT IS DELIBERATE. Posting a computed result
// is the same act as posting decisions — a team saying "here is my year" — and
// giving it a sixth endpoint would have widened the contract for a payload
// difference rather than an authority difference. Both slots are authorised
// identically and both are opaque.
export interface SubmitRequest {
  code: string;
  token: string;
  yearNumber: number;
  /** Opaque by design — see TeamYearSummary's note on why results are not. */
  decisions?: JsonValue;
  result?: TeamYearSummary;
}

export interface SubmitResponse {
  room: RoomView;
  you: CallerView;
}

export interface AdvanceRequest {
  code: string;
  // Host token only. Enforced by the implementation, not by hiding the button.
  token: string;
}

export interface AdvanceResponse {
  room: RoomView;
  currentYear: number;
}

export interface ReadRequest {
  code: string;
  // Absent is legal and yields role 'anonymous' with the public room view — a
  // join screen needs the team roster before it holds any token at all.
  token?: string;
}

export interface ReadResponse {
  room: RoomView;
  you: CallerView;
}

// ---------------------------------------------------------------- interface

// ⚠ THE WHOLE SURFACE. Five methods. Anything a client needs that is not here is
// a gap in this interface to be closed here, not a reach around it into an
// implementation — the moment a screen imports from a concrete transport, the
// swap stops being a swap.
export interface SessionTransport {
  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse>;
  join(req: JoinRequest): Promise<JoinResponse>;
  submit(req: SubmitRequest): Promise<SubmitResponse>;
  advance(req: AdvanceRequest): Promise<AdvanceResponse>;
  read(req: ReadRequest): Promise<ReadResponse>;
}

// ---------------------------------------------------------------- faults

// Deliberate failure injection, so loading and error states are exercised now.
//
// ⚠ THIS IS PART OF THE CONTRACT, NOT OF THE localStorage IMPLEMENTATION. A
// hosted implementation implements it too (by failing requests before they are
// sent) so the same error-path walkthrough can be run against a real backend
// without a special build.
export interface FaultController {
  // Fail the next call only.
  failNext(code?: SessionErrorCode, message?: string): void;
  // Fail every call until cleared — for holding a screen in its error state.
  failAll(code?: SessionErrorCode, message?: string): void;
  // Added latency in ms for every call.
  setLatency(ms: number): void;
  clear(): void;
}
