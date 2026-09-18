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
  joined: boolean;
  // The last year this team locked decisions for, or null if it never has.
  lockedYear: number | null;
  // Locked for the room's CURRENT year specifically — what the host's table and
  // the advance control actually key on.
  locked: boolean;
  // The last year this team posted a result for, or null.
  resultYear: number | null;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  seed: string;
  poolName: string;
  yearCount: number;
  startingYear: number;
  activeLines: CoverageLine[];
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
  // This caller's own last submitted decisions. The carry-forward source: a team
  // that does not lock in time is processed on THIS, not on engine defaults.
  lastDecisions?: JsonValue;
  lastDecisionsYear?: number;
  // This caller's own last posted result.
  lastResult?: JsonValue;
  lastResultYear?: number;
}

// ---------------------------------------------------------------- requests

export interface CreateRoomRequest {
  seed: string;
  yearCount: number;
  startingYear: number;
  poolName: string;
  activeLines: CoverageLine[];
  // Pre-registered. The host types the names; players pick from them rather
  // than inventing their own, so the host's table is a fixed roster from the
  // moment the room exists instead of growing whatever people type.
  teamNames: string[];
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
  teamName: string;
  role: 'player' | 'viewer';
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
  decisions?: JsonValue;
  result?: JsonValue;
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
