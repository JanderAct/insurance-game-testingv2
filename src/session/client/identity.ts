// ============================================================================
// WHAT THIS BROWSER HOLDS — and, separately, what THIS TAB is.
//
// ⚠ THIS SPLIT IS NOT DECORATION. It was a bug, found the first time four tabs
// were driven against one browser. Credentials keyed only by room code in
// localStorage are shared by every tab in the browser, so the second tab to open
// /join/CODE read the first tab's token, decided it was already Harbour Mutual,
// and never showed the picker. One browser could only ever be one participant.
// Four ISOLATED browser contexts would have passed that test cheerfully, which
// is exactly why the four-tab check is run in one.
//
// SO THERE ARE TWO STORES, AND THEY ANSWER TWO DIFFERENT QUESTIONS:
//
//   ACTIVE (sessionStorage, per tab) — "who is this tab?" sessionStorage is
//   per-tab by definition and survives a RELOAD, which is the case that matters:
//   a refresh must return the same player to the same team rather than reading
//   as a second person claiming it. Four tabs get four answers.
//
//   HELD (localStorage, per browser) — "what has this browser ever been handed
//   for this room?" This survives the tab closing, and is what makes a team
//   recoverable after a crash: the credential is offered back as a RESUME
//   CHOICE, never applied silently. Auto-applying it is the bug above.
//
// THE HOST IS THE ONE EXCEPTION AND IT IS PRINCIPLED: a room has exactly one
// host, so a second tab opening /host/CODE on the same browser is the same host
// and may resume automatically. There is no other host for it to collide with.
// A team is the opposite — the whole point is that several of them coexist.
// ============================================================================

const ACTIVE_PREFIX = 'ripple.session.v1.active.';
const HELD_PREFIX = 'ripple.session.v1.held.';

export interface RoomIdentity {
  hostToken?: string;
  teamToken?: string;
  teamName?: string;
  role?: 'player' | 'viewer';
}

export interface HeldCredential {
  teamToken: string;
  teamName: string;
  role: 'player' | 'viewer';
}

export interface HeldCredentials {
  hostToken?: string;
  teams: HeldCredential[];
}

// A browser blocking storage is a browser that cannot rejoin. That is a real
// limitation to surface where it bites, not a crash here.
function readJson<T>(store: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(store: Storage | undefined, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // Ignored deliberately: the caller already holds the token in memory, so the
    // session works for as long as the tab stays open. Failing the join outright
    // because persistence is unavailable would be the worse outcome.
  }
}

// ---------------------------------------------------------------- active

export function loadActive(code: string): RoomIdentity {
  return readJson<RoomIdentity>(globalThis.sessionStorage, ACTIVE_PREFIX + code, {});
}

export function saveActive(code: string, patch: RoomIdentity): RoomIdentity {
  const merged = { ...loadActive(code), ...patch };
  writeJson(globalThis.sessionStorage, ACTIVE_PREFIX + code, merged);
  return merged;
}

export function clearActive(code: string): void {
  try {
    globalThis.sessionStorage?.removeItem(ACTIVE_PREFIX + code);
  } catch { /* nothing to clear if storage is unreachable */ }
}

// ---------------------------------------------------------------- held

export function loadHeld(code: string): HeldCredentials {
  return readJson<HeldCredentials>(globalThis.localStorage, HELD_PREFIX + code, { teams: [] });
}

export function rememberHostToken(code: string, hostToken: string): void {
  const held = loadHeld(code);
  writeJson(globalThis.localStorage, HELD_PREFIX + code, { ...held, hostToken });
}

export function rememberTeamCredential(code: string, cred: HeldCredential): void {
  const held = loadHeld(code);
  // Keyed by team AND role: one browser may legitimately have driven a team and
  // also watched another, and neither should evict the other.
  const teams = held.teams.filter(t => !(t.teamName === cred.teamName && t.role === cred.role));
  teams.push(cred);
  writeJson(globalThis.localStorage, HELD_PREFIX + code, { ...held, teams });
}

export function forgetTeamCredential(code: string, token: string): void {
  const held = loadHeld(code);
  writeJson(globalThis.localStorage, HELD_PREFIX + code, {
    ...held,
    teams: held.teams.filter(t => t.teamToken !== token),
  });
}
