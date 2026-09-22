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
  FaultController,
  JoinRequest, JoinResponse,
  JsonValue,
  ReadRequest, ReadResponse,
  RoomStatus, RoomView,
  ScheduledShockSpec,
  SessionErrorCode,
  SessionTransport,
  TeamYearSummary,
  SubmitRequest, SubmitResponse,
  TeamView,
} from './contract';
import { SessionError } from './contract';
import type { CoverageLine } from '../types/simulation';

const KEY_PREFIX = 'ripple.session.v1.room.';

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

function newToken(): string {
  return randomFrom('abcdefghijklmnopqrstuvwxyz0123456789', 32);
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

// ---------------------------------------------------------------- faults

interface PendingFault {
  code: SessionErrorCode;
  message: string;
}

class LocalFaults implements FaultController {
  next: PendingFault | null = null;
  all: PendingFault | null = null;
  latencyMs: number;

  constructor(latencyMs: number) {
    this.latencyMs = latencyMs;
  }

  failNext(code: SessionErrorCode = 'TRANSPORT_FAILURE', message = 'Injected failure.'): void {
    this.next = { code, message };
  }

  failAll(code: SessionErrorCode = 'TRANSPORT_FAILURE', message = 'Injected failure.'): void {
    this.all = { code, message };
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  clear(): void {
    this.next = null;
    this.all = null;
  }

  // Consumed once per call, before the call does anything.
  take(): PendingFault | null {
    if (this.next) {
      const f = this.next;
      this.next = null;
      return f;
    }
    return this.all;
  }
}

// ---------------------------------------------------------------- transport

export interface LocalTransportOptions {
  // Fake round-trip time. Small enough not to annoy, large enough that a
  // loading state which was never rendered is visible as a bug.
  latencyMs?: number;
}

export class LocalSessionTransport implements SessionTransport {
  readonly faults: LocalFaults;

  constructor(opts: LocalTransportOptions = {}) {
    this.faults = new LocalFaults(opts.latencyMs ?? 120);
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

      const store = storage();
      let code = randomFrom(CODE_ALPHABET, 6);
      // Collision is ~1 in 10^9 per pair, but a collision would silently hand two
      // sessions the same room, so it is cheap to just not allow it.
      for (let i = 0; store.getItem(KEY_PREFIX + code) !== null && i < 50; i++) {
        code = randomFrom(CODE_ALPHABET, 6);
      }

      const now = Date.now();
      const room: RoomRecord = {
        code,
        hostToken: newToken(),
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
      return { code, hostToken: room.hostToken, room: roomView(room) };
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
        const token = newToken();
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

      const token = newToken();
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

  advance(req: AdvanceRequest): Promise<AdvanceResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const { role } = callerOf(room, req.token);
      if (role !== 'host') {
        throw new SessionError('NOT_HOST', 'Only the host may advance the year.');
      }
      if (room.currentYear > room.yearCount) {
        throw new SessionError('GAME_COMPLETE', 'The game is already complete.');
      }

      room.currentYear += 1;
      saveRoom(room);
      return { room: roomView(room), currentYear: room.currentYear };
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
