// ============================================================================
// THE localStorage IMPLEMENTATION of SessionTransport.
//
// ⚠ THE FIRST IMPLEMENTATION, NOT THE DESIGN. Everything specific to
// localStorage is below this line and nothing above it (see contract.ts) knows
// this file exists. Screens import the interface and are handed an instance;
// none of them can tell what is underneath, which is the property the whole
// layer is for.
//
// WHY IT IS STILL ASYNC WHEN localStorage IS SYNCHRONOUS. Because the point is
// to build the client against the shape a network actually has. A synchronous
// API here would compile, work, and then require every call site to be rewritten
// the first time a request took 40ms and sometimes failed. The fake latency and
// the injectable fault are how the loading spinner and the error state get
// written and walked NOW, while the cost of getting them wrong is nothing.
//
// ⚠ MUTATIONS TAKE A CROSS-TAB LOCK, AND THIS WAS A BUG BEFORE THEY DID. Four
// tabs share one localStorage and there is no transaction. The first version of
// this file kept each read-modify-write in one synchronous block and argued that
// JavaScript being single-threaded made it un-interleavable. THAT ARGUMENT IS
// WRONG, and the four-tab run proved it within minutes: single-threadedness
// holds WITHIN a tab, but separate tabs are genuinely parallel, so tab A could
// read, tab B read, tab A write and tab B write — losing A's update entirely. It
// showed up as a team whose posted result silently never arrived, with the host
// table reporting it a year behind while its own screen showed the year computed
// and posted.
//
// navigator.locks is the right primitive: per ORIGIN, honoured across every tab,
// and it releases if a tab dies mid-hold. Every mutating endpoint runs its whole
// read-modify-write inside it. READS ARE DELIBERATELY NOT LOCKED — a poll is
// harmless against a half-finished sequence because each localStorage write is
// itself atomic, and serialising four pollers behind every write would make the
// lock the bottleneck it exists to avoid.
//
// Where the API is absent (the Node contract harness, an old browser) the work
// runs unlocked — correct there, because there is exactly one thread to race.
//
// The artificial latency is awaited BEFORE the lock is taken, never inside it,
// so a fake round trip cannot widen the window it is meant to be testing. A
// hosted implementation gets all of this from the server for free.
// ============================================================================

import type {
  AdvanceRequest, AdvanceResponse,
  CallerRole, CallerView,
  CreateRoomRequest, CreateRoomResponse,
  JoinRequest, JoinResponse,
  JsonValue,
  ReadRequest, ReadResponse,
  RoomStatus, RoomView,
  ScheduledShockSpec,
  SessionTransport,
  TeamYearSummary,
  SubmitRequest, SubmitResponse,
  TeamView,
} from './contract';
import { SessionError, SESSION_TOKEN_PATTERN, newSessionToken } from './contract';
import { Faults } from './faults';
import type { CoverageLine } from '../types/simulation';

// ⚠ EXPORTED BECAUSE THE STORE NOW HOLDS MORE THAN ROOMS. The stub server's
// /health used to report `store.length` as the room count, which was true while
// a room was the only thing written. The createRoom idempotency index below put
// a second key in the same store per room, and the two-contexts driver caught
// it immediately — "the SERVER holds the room (2)" after one create. Anything
// counting rooms filters on this.
export const ROOM_KEY_PREFIX = 'ripple.session.v1.room.';
const KEY_PREFIX = ROOM_KEY_PREFIX;
// ⚠ THE IDEMPOTENCY INDEX FOR createRoom: host token -> room code. Keyed on the
// token itself here, which is no worse than the room record beside it — that
// already holds the token in the clear in the same localStorage. A HOSTED
// implementation must key on a HASH so no plaintext bearer token is written to
// the table; that is the server's side of the wire and the contract does not
// constrain it.
const IDEMPOTENCY_PREFIX = 'ripple.session.v1.create.';

// No O/0/I/1 — a room code gets read aloud across a room and written on a
// whiteboard, and those are the four characters that come back wrong.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------- records

// What is actually stored. Holds the SECRETS (host token, team tokens) and every
// team's decisions; `read` projects a redacted view out of it and never returns
// this shape directly.
interface TeamRecord {
  name: string;
  // Chosen at join, never written again. See the LINES_LOCKED path below.
  lines: CoverageLine[];
  token: string | null;
  joined: boolean;
  lockedYear: number | null;
  // Year number (as a string key, per JSON) -> that year's submitted decisions.
  decisionsByYear: Record<string, JsonValue>;
  // Year number (as a string key, per JSON) -> that year's posted summary.
  resultsByYear: Record<string, TeamYearSummary>;
}

interface ViewerRecord {
  token: string;
  teamName: string;
}

interface RoomRecord {
  code: string;
  hostToken: string;
  seed: string;
  eventName: string;
  yearCount: number;
  startingYear: number;
  expectedTeams: number;
  currentYear: number;
  shocks: ScheduledShockSpec[];
  teams: TeamRecord[];
  viewers: ViewerRecord[];
  createdAt: number;
  updatedAt: number;
  rev: number;
}

// ---------------------------------------------------------------- ids

function randomFrom(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ⚠ ONE MINT, SHARED WITH THE CLIENTS. It lives in the contract now because a
// client mints its own token for join and createRoom — see newSessionToken.
const newToken = newSessionToken;

/**
 * A token a CALLER supplied, checked before it is allowed to own anything.
 *
 * ⚠ TWO SEPARATE REFUSALS, AND THE SECOND IS THE ONE THAT MATTERS. Shape keeps
 * a malformed or trivially short string out of the credential space. COLLISION
 * is what stops a client claiming somebody else's seat: a supplied token that
 * already belongs to a different team, a viewer or the host is refused outright
 * rather than quietly accepted, so moving the mint to the client cannot be used
 * to take a team by presenting its token. A caller re-presenting its OWN token
 * is the rejoin path and never reaches here.
 */
function assertTokenFree(room: RoomRecord, token: string): void {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new SessionError('INVALID_REQUEST', 'That token is not a valid session token.');
  }
  if (token === room.hostToken
    || room.teams.some(t => t.token === token)
    || room.viewers.some(v => v.token === token)) {
    throw new SessionError('BAD_TOKEN', 'That token is already in use in this room.');
  }
}

// ---------------------------------------------------------------- storage

function storage(): Storage {
  // Private-mode browsers throw on access rather than returning null, so this
  // is a try/catch and not a truthiness check.
  try {
    const s = globalThis.localStorage;
    if (!s) throw new Error('no localStorage');
    return s;
  } catch {
    throw new SessionError(
      'TRANSPORT_FAILURE',
      'This browser is blocking local storage, so the session cannot be reached.',
      true,
    );
  }
}

function loadRoom(code: string): RoomRecord {
  const raw = storage().getItem(KEY_PREFIX + code);
  if (raw === null) {
    throw new SessionError('ROOM_NOT_FOUND', `No room with code ${code}.`);
  }
  try {
    return JSON.parse(raw) as RoomRecord;
  } catch {
    throw new SessionError('TRANSPORT_FAILURE', `The stored room ${code} is unreadable.`);
  }
}

function saveRoom(room: RoomRecord): void {
  room.updatedAt = Date.now();
  room.rev += 1;
  storage().setItem(KEY_PREFIX + room.code, JSON.stringify(room));
}

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

/**
 * ⚠ THE HIGHEST PLAYED YEAR, WHICH IS NOT THE HIGHEST KEY. Year 0 is the
 * opening position, posted when a team builds its game and before it has
 * decided anything; counting it would report a team that has played nothing as
 * having reported.
 */
function highestPlayedYear(t: TeamRecord): number | null {
  let best: number | null = null;
  for (const k of Object.keys(t.resultsByYear)) {
    const y = Number(k);
    if (Number.isFinite(y) && y >= 1 && (best === null || y > best)) best = y;
  }
  return best;
}

function sameLines(a: CoverageLine[], b: CoverageLine[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

// ---------------------------------------------------------------- views

function statusOf(room: RoomRecord): RoomStatus {
  if (room.currentYear > room.yearCount) return 'complete';
  return room.teams.some(t => t.joined) ? 'running' : 'lobby';
}

function teamView(t: TeamRecord, currentYear: number): TeamView {
  return {
    name: t.name,
    lines: [...t.lines],
    joined: t.joined,
    lockedYear: t.lockedYear,
    locked: t.lockedYear === currentYear,
    resultYear: highestPlayedYear(t),
    // The scoreboard the host's Teams and Charts tabs read. A year with no entry
    // is a year not reported — which is a DIFFERENT state from a line the team
    // does not write, and the two must not be allowed to look alike.
    resultsByYear: Object.keys(t.resultsByYear).length > 0 ? { ...t.resultsByYear } : undefined,
  };
}

function roomView(room: RoomRecord): RoomView {
  return {
    code: room.code,
    status: statusOf(room),
    seed: room.seed,
    eventName: room.eventName,
    yearCount: room.yearCount,
    startingYear: room.startingYear,
    expectedTeams: room.expectedTeams,
    currentYear: room.currentYear,
    shocks: room.shocks.map(s => ({ ...s })),
    teams: room.teams.map(t => teamView(t, room.currentYear)),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    rev: room.rev,
  };
}

// Resolve a token to who is calling.
//
// ⚠ AUTHORITY IS DECIDED HERE AND ONLY HERE. Every endpoint that needs it calls
// this rather than checking tokens itself, so there is one place to read to know
// what any token can do — and one place for an HTTP implementation to replace
// with its own middleware.
function callerOf(room: RoomRecord, token: string | undefined): { role: CallerRole; team: TeamRecord | null } {
  if (!token) return { role: 'anonymous', team: null };
  if (token === room.hostToken) return { role: 'host', team: null };

  const player = room.teams.find(t => t.token !== null && t.token === token);
  if (player) return { role: 'player', team: player };

  const viewer = room.viewers.find(v => v.token === token);
  if (viewer) {
    const watched = room.teams.find(t => t.name === viewer.teamName) ?? null;
    return { role: 'viewer', team: watched };
  }

  throw new SessionError('BAD_TOKEN', 'That token does not belong to this room.');
}

function callerView(role: CallerRole, team: TeamRecord | null): CallerView {
  const view: CallerView = { role };
  if (!team) return view;

  view.teamName = team.name;
  view.lines = [...team.lines];
  // ⚠ OWN SLICE ONLY. A player and the viewer watching that player get that
  // team's decisions and results; nobody gets anybody else's, and the host gets
  // no team's. The host runs the room from the table in RoomView, which carries
  // presence and progress and no content.
  if (Object.keys(team.decisionsByYear).length > 0) {
    view.decisionsByYear = { ...team.decisionsByYear };
  }
  const postedYears = Object.keys(team.resultsByYear)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (postedYears.length > 0) view.postedYears = postedYears;

  const played = highestPlayedYear(team);
  if (played !== null) {
    view.lastResult = team.resultsByYear[String(played)];
    view.lastResultYear = played;
  }
  return view;
}

// ---------------------------------------------------------------- locking

const LOCK_NAME = 'ripple.session.v1.rooms';

// navigator.locks is typed in lib.dom, but the harness runs under a DOM-less
// Node, so this reads it defensively rather than assuming the global shape.
interface LockManagerLike {
  request<T>(name: string, cb: () => T | Promise<T>): Promise<T>;
}

function lockManager(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks ?? null;
}

async function withRoomLock<T>(work: () => T): Promise<T> {
  const locks = lockManager();
  if (!locks) return work();
  return locks.request(LOCK_NAME, work);
}

// ---------------------------------------------------------------- transport

export interface LocalTransportOptions {
  // Fake round-trip time. Small enough not to annoy, large enough that a
  // loading state which was never rendered is visible as a bug.
  latencyMs?: number;
}

export class LocalSessionTransport implements SessionTransport {
  readonly faults: Faults;

  constructor(opts: LocalTransportOptions = {}) {
    this.faults = new Faults(opts.latencyMs ?? 120);
  }

  // The one place latency and injected failure are applied.
  //
  // ⚠ `work` MUST STAY SYNCHRONOUS. The lock below guarantees only that no other
  // TAB is inside the critical section; an await inside `work` would reopen the
  // same lost-update window within this one.
  private async call<T>(work: () => T, exclusive = false): Promise<T> {
    const fault = this.faults.take();
    const delay = this.faults.latencyMs;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    if (fault) throw new SessionError(fault.code, fault.message, true);
    if (!exclusive) return work();
    return withRoomLock(work);
  }

  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.call(() => {
      if (!Number.isInteger(req.yearCount) || req.yearCount < 1) {
        throw new SessionError('INVALID_REQUEST', 'Year count must be a positive whole number.');
      }
      // ⚠ NOT VALIDATED AGAINST A CEILING, ON PURPOSE. expectedTeams is the
      // host's estimate of attendance, not a capacity — see the contract. A
      // zero or negative expectation is still nonsense, so that much is checked.
      if (!Number.isInteger(req.expectedTeams) || req.expectedTeams < 1) {
        throw new SessionError('INVALID_REQUEST', 'Expected teams must be a positive whole number.');
      }

      if (!SESSION_TOKEN_PATTERN.test(req.hostToken)) {
        throw new SessionError('INVALID_REQUEST', 'A room needs a valid host token.');
      }

      const store = storage();

      // ⚠ THE RETRY PATH, AND IT RETURNS SUCCESS RATHER THAN AN ERROR. A
      // createRoom whose response was lost used to make a SECOND room on retry,
      // leaving an orphan with its own code that teams could still join. The
      // same host token means the same request; hand back the room it already
      // made.
      const seen = store.getItem(IDEMPOTENCY_PREFIX + req.hostToken);
      if (seen !== null) {
        const existing = loadRoom(seen);
        return { code: existing.code, hostToken: req.hostToken, room: roomView(existing), reused: true };
      }

      let code = randomFrom(CODE_ALPHABET, 6);
      // Collision is ~1 in 10^9 per pair, but a collision would silently hand two
      // sessions the same room, so it is cheap to just not allow it.
      for (let i = 0; store.getItem(KEY_PREFIX + code) !== null && i < 50; i++) {
        code = randomFrom(CODE_ALPHABET, 6);
      }

      const now = Date.now();
      const room: RoomRecord = {
        code,
        hostToken: req.hostToken,
        seed: req.seed,
        eventName: req.eventName,
        yearCount: req.yearCount,
        startingYear: req.startingYear,
        expectedTeams: req.expectedTeams,
        currentYear: 1,
        shocks: req.shocks.map(s => ({ ...s })),
        // ⚠ A ROOM OPENS EMPTY. Teams are created by JOINING, not registered in
        // advance, because a team's name and its coverage lines are one act of
        // setup performed by the team itself.
        teams: [],
        viewers: [],
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };

      store.setItem(KEY_PREFIX + code, JSON.stringify(room));
      // The index AFTER the room, so a failure between the two leaves no index
      // pointing at a room that was never written.
      store.setItem(IDEMPOTENCY_PREFIX + req.hostToken, code);
      return { code, hostToken: room.hostToken, room: roomView(room), reused: false };
    }, true);
  }

  join(req: JoinRequest): Promise<JoinResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const name = req.teamName.trim();
      if (name.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A team needs a name.');
      }
      const team = room.teams.find(t => t.name === name);

      // ⚠ A VIEWER WATCHES SOMETHING THAT EXISTS; A PLAYER MAY CREATE IT. That
      // is the whole asymmetry now that the roster is not pre-registered — the
      // player's join is the moment the team comes into being, so "not found"
      // is an error for one role and the normal case for the other.
      if (req.role === 'viewer' && !team) {
        throw new SessionError('TEAM_NOT_FOUND', `${name} is not a team in this room.`);
      }

      if (req.role === 'viewer' && team) {
        // A viewer never claims the team, so any number of them may watch and
        // none of them can block the driver.
        const existing = req.token
          ? room.viewers.find(v => v.token === req.token && v.teamName === team.name)
          : undefined;
        if (existing) {
          return { teamToken: existing.token, teamName: team.name, lines: [...team.lines], role: 'viewer' as const, rejoined: true, room: roomView(room) };
        }
        // ⚠ THE CALLER'S OWN TOKEN WHEN IT SUPPLIED ONE, so a retried viewer
        // join lands on the `existing` branch above instead of stacking a
        // second viewer record per lost response.
        const token = req.token ?? newToken();
        if (req.token) assertTokenFree(room, req.token);
        room.viewers.push({ token, teamName: team.name });
        saveRoom(room);
        return { teamToken: token, teamName: team.name, lines: [...team.lines], role: 'viewer' as const, rejoined: false, room: roomView(room) };
      }

      // ---- a player, on a team that already exists ------------------------
      if (team) {
        // ⚠ REJOIN BEFORE TAKEN. The same browser coming back to the same code
        // presents the token it already holds, and that is a rejoin — not a
        // second person claiming a team that is already claimed. Checking
        // TEAM_TAKEN first would lock the real driver out on a refresh.
        if (req.token && team.token === req.token) {
          // ⚠ LINES ARE FIXED, AND THE REFUSAL IS THE POINT. A rejoin that asks
          // for a different set is not honoured and not silently ignored: the
          // team's pre-game, its roster and its whole claim history are a
          // function of the lines it opened with, so changing them would
          // restart its book while looking like a preference change.
          if (req.lines && !sameLines(req.lines, team.lines)) {
            throw new SessionError(
              'LINES_LOCKED',
              `${team.name} plays ${team.lines.join(' + ')}. Coverage lines are chosen once, when a team joins.`,
            );
          }
          return { teamToken: team.token, teamName: team.name, lines: [...team.lines], role: 'player' as const, rejoined: true, room: roomView(room) };
        }
        // The name is the identity now, so a second person arriving with a name
        // already in the room is a COLLISION rather than a claim on a seat.
        throw new SessionError('TEAM_TAKEN', `A team called ${team.name} is already in this room.`);
      }

      // ---- a player creating its team -------------------------------------
      const lines = req.lines ?? [];
      if (lines.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A team must play at least one coverage line.');
      }
      // ⚠ VALIDATED AGAINST THE REAL LINES, NOT AGAINST A ROOM MENU. Every room
      // offers all three and the host does not constrain it, so the only wrong
      // answer here is one that is not a coverage line at all.
      const notALine = lines.filter(l => !LINE_ORDER.includes(l));
      if (notALine.length > 0) {
        throw new SessionError('INVALID_REQUEST', `${notALine.join(', ')} is not a coverage line.`);
      }

      // ⚠ THE CLIENT'S TOKEN, WHICH IS WHAT MAKES THE FIRST JOIN REPLAYABLE.
      // The team is created owning a secret the caller ALREADY HOLDS, so if the
      // response is lost the retry presents the same token, matches on the
      // rejoin path above and gets its seat back. While the server minted it,
      // the only copy went down a socket nobody was listening on and the retry
      // read as a second person taking a claimed name — TEAM_TAKEN, in front of
      // a room. assertTokenFree is what stops this being a way to CLAIM a seat:
      // a token already owned by anyone else in the room is refused.
      const token = req.token ?? newToken();
      if (req.token) assertTokenFree(room, req.token);
      const created: TeamRecord = {
        name,
        // Canonical WC/GL/Property order regardless of click sequence, so two
        // teams with the same choice compare equal everywhere they are shown.
        lines: LINE_ORDER.filter(l => lines.includes(l)),
        token,
        joined: true,
        lockedYear: null,
        decisionsByYear: {},
        resultsByYear: {},
      };
      room.teams.push(created);
      saveRoom(room);
      return { teamToken: token, teamName: created.name, lines: [...created.lines], role: 'player' as const, rejoined: false, room: roomView(room) };
    }, true);
  }

  submit(req: SubmitRequest): Promise<SubmitResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const { role, team } = callerOf(room, req.token);
      if (role !== 'player' || !team) {
        throw new SessionError('BAD_TOKEN', 'Only a team player may submit.');
      }
      if (req.decisions === undefined && req.result === undefined) {
        throw new SessionError('INVALID_REQUEST', 'Nothing to submit.');
      }

      if (req.decisions !== undefined) {
        // Decisions are for the room's current year or they are stale — a tab
        // that sat on a screen while the host advanced must not overwrite the
        // new year with the old one's choices.
        if (req.yearNumber !== room.currentYear) {
          throw new SessionError(
            'WRONG_YEAR',
            `The room is on year ${room.currentYear}; those decisions are for year ${req.yearNumber}.`,
          );
        }
        // ⚠ RECORDED AGAINST ITS YEAR, NOT INTO A SLOT. Re-submitting the same
        // year overwrites that year and leaves every other year alone, which is
        // what makes a reload able to replay what was actually played.
        team.decisionsByYear[String(req.yearNumber)] = req.decisions;
        team.lockedYear = req.yearNumber;
      }

      if (req.result !== undefined) {
        // ⚠ A RESULT IS FOR A YEAR ALREADY PROCESSED, so it legitimately arrives
        // for a year BEHIND the room's current one: the host advances, the
        // clients then compute, and they post what they computed. Only a result
        // from the FUTURE is incoherent.
        if (req.yearNumber > room.currentYear) {
          throw new SessionError(
            'WRONG_YEAR',
            `Cannot post a result for year ${req.yearNumber}; the room is on year ${room.currentYear}.`,
          );
        }
        // ⚠ YEAR 0 IS ALLOWED AND IS THE OPENING POSITION; BELOW IT IS NOT. The
        // pre-game's earlier years built that position and are not part of the
        // session — a room that accepted them would be holding scaffolding it
        // has no screen for.
        if (req.yearNumber < 0) {
          throw new SessionError(
            'WRONG_YEAR',
            `Year ${req.yearNumber} is before the opening position; results start at year 0.`,
          );
        }
        // ⚠ RECORDED AGAINST ITS YEAR. A re-post of the same year (which a
        // reloaded tab does) replaces that year and leaves every other alone.
        team.resultsByYear[String(req.yearNumber)] = req.result;
      }

      saveRoom(room);
      return { room: roomView(room), you: callerView(role, team) };
    }, true);
  }

  /**
   * ⚠ A COMPARE-AND-SWAP ON THE ROOM'S CURRENT YEAR, AND THE ORDER OF THE FOUR
   * CASES BELOW IS LOAD-BEARING.
   *
   * `advance` increments, so a retried request — which is what a client sends
   * when a response is lost — used to SKIP A YEAR, and every team then reported
   * against a year nobody played. The two requests are byte-identical from the
   * server's side; `expectedYear` is what makes them distinguishable.
   *
   * ⚠ WRITTEN SO THE LAMBDA INHERITS IT. On DynamoDB this is one conditional
   * update on the HEADER item and only there: condition `currentYear = the
   * expected year`, still inside the year count, host token matches. On a
   * failed condition the handler reads the header back and distinguishes
   * exactly the four cases below. Here the lock makes the read-modify-write
   * atomic so the "readback" is just the record in hand — but the CASES are the
   * contract, and they are written out rather than collapsed so the hosted
   * implementation has something to match.
   *
   *   1. token mismatch            NOT_HOST   (BAD_TOKEN if it is nobody's)
   *   2. already at expected + 1   A RETRY — success, no write
   *   3. past the year count       GAME_COMPLETE
   *   4. anything else             WRONG_YEAR
   *
   * ⚠ CASE 2 PRECEDES CASE 3, AND SWAPPING THEM BREAKS THE LAST ADVANCE OF
   * EVERY GAME. Take yearCount 3 with the room on 4: a retry carrying
   * expectedYear 3 is a retry of the advance that COMPLETED the game and must
   * return success, while a fresh call carrying expectedYear 4 is a genuine
   * attempt to advance past the end and must be GAME_COMPLETE. Both see
   * `currentYear > yearCount`; only the expectation tells them apart.
   *
   * ⚠ AND A RETRY SUCCEEDS RATHER THAN FAILING POLITELY. Returning an error
   * saying "it already happened" would report a failure for an operation that
   * worked, to a host who can do nothing about it. `advanced` says which path
   * ran, so a caller that cares can tell.
   *
   * ⚠ THE WINDOW IS ONE YEAR WIDE, WHICH IS A REAL LIMIT AND NOT A BUG. A host
   * on a stale screen whose room has moved on by exactly one gets a success and
   * no second advance — indistinguishable from a retry, by construction, and
   * the safe failure of the two. Two or more years stale is WRONG_YEAR.
   */
  advance(req: AdvanceRequest): Promise<AdvanceResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      if (!Number.isInteger(req.expectedYear)) {
        throw new SessionError('INVALID_REQUEST', 'advance needs the year the caller expects the room to be on.');
      }
      // 1. Authority first: a non-host must not learn the room's year from the
      //    shape of the refusal.
      const { role } = callerOf(room, req.token);
      if (role !== 'host') {
        throw new SessionError('NOT_HOST', 'Only the host may advance the year.');
      }
      // 2. The retry. No write, and success.
      if (room.currentYear === req.expectedYear + 1) {
        return { room: roomView(room), currentYear: room.currentYear, advanced: false };
      }
      // 3. Past the end.
      if (room.currentYear > room.yearCount) {
        throw new SessionError('GAME_COMPLETE', 'The game is already complete.');
      }
      // 4. A stale or invented expectation.
      if (room.currentYear !== req.expectedYear) {
        throw new SessionError(
          'WRONG_YEAR',
          `The room is on year ${room.currentYear}; that request expected year ${req.expectedYear}.`,
        );
      }

      room.currentYear += 1;
      saveRoom(room);
      return { room: roomView(room), currentYear: room.currentYear, advanced: true };
    }, true);
  }

  read(req: ReadRequest): Promise<ReadResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const { role, team } = callerOf(room, req.token);
      return { room: roomView(room), you: callerView(role, team) };
    });
  }
}
