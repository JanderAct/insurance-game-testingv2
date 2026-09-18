// ============================================================================
// WHAT THIS BROWSER HOLDS — the credential store, keyed by room code.
//
// ⚠ THIS IS THE ONE localStorage USE THAT SURVIVES THE SWAP, and it is worth
// being clear about why it is not a contradiction. The ROOM lives in
// localStorage only because LocalSessionTransport puts it there; move to a
// hosted backend and the room moves with it. WHO THIS BROWSER IS does not move:
// a token identifying the caller has to live on the client in any architecture,
// and this is that. It is the cookie jar, not the database.
//
// ⚠ KEYED BY ROOM CODE, NOT GLOBAL. The code is in the URL so a refresh returns
// to the same room; the token is here so the browser that already claimed a team
// gets that team back rather than being read as a second person claiming it. One
// machine may legitimately hold a host token for one room and a team token for
// another — an instructor demonstrating on the projector while a laptop drives a
// team — and a single global "current token" would make those two overwrite each
// other.
// ============================================================================

const KEY_PREFIX = 'ripple.session.v1.identity.';

export interface RoomIdentity {
  // Present only in the browser that created the room, or one that has been
  // given the resume code.
  hostToken?: string;
  teamToken?: string;
  teamName?: string;
  role?: 'player' | 'viewer';
}

export function loadIdentity(code: string): RoomIdentity {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + code);
    return raw ? (JSON.parse(raw) as RoomIdentity) : {};
  } catch {
    // A browser blocking storage is a browser that cannot rejoin. That is a
    // real limitation to surface at the point of use, not a crash here.
    return {};
  }
}

export function saveIdentity(code: string, patch: RoomIdentity): RoomIdentity {
  const merged = { ...loadIdentity(code), ...patch };
  try {
    window.localStorage.setItem(KEY_PREFIX + code, JSON.stringify(merged));
  } catch {
    // Ignored deliberately: the caller already holds the token in memory and
    // the session works for as long as the tab stays open. Failing the join
    // outright because persistence is unavailable would be worse.
  }
  return merged;
}

export function clearIdentity(code: string): void {
  try {
    window.localStorage.removeItem(KEY_PREFIX + code);
  } catch { /* nothing to clear if storage is unreachable */ }
}
