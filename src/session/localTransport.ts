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
// ⚠ THE READ-MODIFY-WRITE IS SYNCHRONOUS AND THAT IS LOAD-BEARING. Four tabs
// share one localStorage and there is no transaction, so a mutation that read
// the room, awaited anything, and then wrote it back would be a lost-update race
// between tabs — two teams locking in the same second and one of them silently
// vanishing from the host's table. Every mutator below does its read, its
// change, and its write inside ONE synchronous block with no await anywhere in
// the middle. JavaScript is single-threaded per tab and localStorage writes are
// synchronous and immediately visible to other tabs, so that block cannot be
// interleaved. The artificial latency is awaited BEFORE the block, never inside
// it. A hosted implementation gets this property from the server for free; this
// one has to arrange it, and arranging it is why the delay sits where it does.
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
  token: string | null;
  joined: boolean;
  lockedYear: number | null;
  decisions: JsonValue | null;
  decisionsYear: number | null;
  result: JsonValue | null;
  resultYear: number | null;
}

interface ViewerRecord {
  token: string;
  teamName: string;
}

interface RoomRecord {
  code: string;
  hostToken: string;
  seed: string;
  poolName: string;
  yearCount: number;
  startingYear: number;
  activeLines: CoverageLine[];
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

// ---------------------------------------------------------------- views

function statusOf(room: RoomRecord): RoomStatus {
  if (room.currentYear > room.yearCount) return 'complete';
  return room.teams.some(t => t.joined) ? 'running' : 'lobby';
}

function teamView(t: TeamRecord, currentYear: number): TeamView {
  return {
    name: t.name,
    joined: t.joined,
    lockedYear: t.lockedYear,
    locked: t.lockedYear === currentYear,
    resultYear: t.resultYear,
  };
}

function roomView(room: RoomRecord): RoomView {
  return {
    code: room.code,
    status: statusOf(room),
    seed: room.seed,
    poolName: room.poolName,
    yearCount: room.yearCount,
    startingYear: room.startingYear,
    activeLines: [...room.activeLines],
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
  // ⚠ OWN SLICE ONLY. A player and the viewer watching that player get that
  // team's decisions and results; nobody gets anybody else's, and the host gets
  // no team's. The host runs the room from the table in RoomView, which carries
  // presence and progress and no content.
  if (team.decisions !== null) {
    view.lastDecisions = team.decisions;
    view.lastDecisionsYear = team.decisionsYear ?? undefined;
  }
  if (team.result !== null) {
    view.lastResult = team.result;
    view.lastResultYear = team.resultYear ?? undefined;
  }
  return view;
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
  // ⚠ THE AWAIT HAPPENS HERE, BEFORE `work` RUNS, AND `work` IS SYNCHRONOUS.
  // That is what keeps every read-modify-write below un-interleavable across
  // tabs. Do not make a `work` callback async.
  private async call<T>(work: () => T): Promise<T> {
    const fault = this.faults.take();
    const delay = this.faults.latencyMs;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    if (fault) throw new SessionError(fault.code, fault.message, true);
    return work();
  }

  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.call(() => {
      const names = req.teamNames.map(n => n.trim()).filter(n => n.length > 0);
      if (names.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A room needs at least one team.');
      }
      if (new Set(names).size !== names.length) {
        throw new SessionError('INVALID_REQUEST', 'Team names must be distinct.');
      }
      if (!Number.isInteger(req.yearCount) || req.yearCount < 1) {
        throw new SessionError('INVALID_REQUEST', 'Year count must be a positive whole number.');
      }
      if (req.activeLines.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A room needs at least one coverage line.');
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
        poolName: req.poolName,
        yearCount: req.yearCount,
        startingYear: req.startingYear,
        activeLines: [...req.activeLines],
        currentYear: 1,
        shocks: req.shocks.map(s => ({ ...s })),
        teams: names.map(name => ({
          name,
          token: null,
          joined: false,
          lockedYear: null,
          decisions: null,
          decisionsYear: null,
          result: null,
          resultYear: null,
        })),
        viewers: [],
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };

      store.setItem(KEY_PREFIX + code, JSON.stringify(room));
      return { code, hostToken: room.hostToken, room: roomView(room) };
    });
  }

  join(req: JoinRequest): Promise<JoinResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const team = room.teams.find(t => t.name === req.teamName);
      if (!team) {
        throw new SessionError('TEAM_NOT_FOUND', `${req.teamName} is not a team in this room.`);
      }

      if (req.role === 'viewer') {
        // A viewer never claims the team, so any number of them may watch and
        // none of them can block the driver.
        const existing = req.token
          ? room.viewers.find(v => v.token === req.token && v.teamName === team.name)
          : undefined;
        if (existing) {
          return { teamToken: existing.token, teamName: team.name, role: 'viewer' as const, rejoined: true, room: roomView(room) };
        }
        const token = newToken();
        room.viewers.push({ token, teamName: team.name });
        saveRoom(room);
        return { teamToken: token, teamName: team.name, role: 'viewer' as const, rejoined: false, room: roomView(room) };
      }

      // ⚠ REJOIN BEFORE TAKEN. The same browser coming back to the same code
      // presents the token it already holds, and that is a rejoin — not a second
      // person claiming a team that is already claimed. Checking TEAM_TAKEN
      // first would lock the real driver out of their own team on a refresh.
      if (req.token && team.token === req.token) {
        return { teamToken: team.token, teamName: team.name, role: 'player' as const, rejoined: true, room: roomView(room) };
      }
      if (team.token !== null) {
        throw new SessionError('TEAM_TAKEN', `${team.name} has already been claimed.`);
      }

      const token = newToken();
      team.token = token;
      team.joined = true;
      saveRoom(room);
      return { teamToken: token, teamName: team.name, role: 'player' as const, rejoined: false, room: roomView(room) };
    });
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
        team.decisions = req.decisions;
        team.decisionsYear = req.yearNumber;
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
        team.result = req.result;
        team.resultYear = req.yearNumber;
      }

      saveRoom(room);
      return { room: roomView(room), you: callerView(role, team) };
    });
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
    });
  }

  read(req: ReadRequest): Promise<ReadResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const { role, team } = callerOf(room, req.token);
      return { room: roomView(room), you: callerView(role, team) };
    });
  }
}
