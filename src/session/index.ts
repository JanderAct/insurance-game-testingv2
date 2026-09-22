// ============================================================================
// WHERE THE SWAP HAPPENS — and the only place it happens.
//
// ⚠ NO SCREEN MAY IMPORT A CONCRETE TRANSPORT. Every client calls
// sessionTransport() and gets something typed as the interface, so the choice of
// implementation exists at exactly one line of code. That is the whole claim
// being made by this layer, and it is checkable: if swapping to a hosted backend
// ever requires touching a file under src/session/screens or a page component,
// the contract leaked and the fix belongs here.
//
// ⚠ THE CLAIM HELD, AND HERE IS THE ACCOUNT. The HTTP implementation is one new
// file (httpTransport.ts) and the one line below. Nothing under screens/, no
// hook, no page, no type and no call site changed to make it work — the same
// build now runs against either. What ELSE this commit touched, so the claim is
// not overstated: the fault injector moved to its own file so both
// implementations expose the same handle to the contract harness, and the
// resolver below is a dozen lines instead of a literal so one build can be
// pointed either way from a driver. Both are testing affordances. Neither is
// something a deployment would need: a deployment sets VITE_SESSION_API and gets
// exactly the one-line version.
// ============================================================================

import type { SessionTransport } from './contract';
import { LocalSessionTransport } from './localTransport';
import { HttpSessionTransport } from './httpTransport';

export * from './contract';
export { LocalSessionTransport } from './localTransport';
export { HttpSessionTransport } from './httpTransport';

let instance: SessionTransport | null = null;

// Where a chosen API base is remembered for THIS TAB. Per tab rather than per
// browser, because the two-context driver points one context at a server while
// another may be on localStorage, and because a stale base url in localStorage
// would silently outlive the session it was for.
const API_KEY = 'ripple.session.v1.api';

/**
 * The base url of a session service, or null for the in-browser one.
 *
 * ⚠ THREE WAYS IN, AND ONLY ONE OF THEM IS FOR PRODUCTION. A build sets
 * VITE_SESSION_API and every tab talks to it. `?api=<url>` is for driving a
 * stub from a test, and sessionStorage is only how that survives the app's own
 * navigation from /join/CODE to the game.
 */
function configuredApi(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('api');
    if (fromQuery) window.sessionStorage.setItem(API_KEY, fromQuery);
    const remembered = window.sessionStorage.getItem(API_KEY);
    if (remembered) return remembered;
  } catch {
    // A browser blocking storage still gets the build-time value below.
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SESSION_API ?? null;
}

export function sessionTransport(): SessionTransport {
  if (!instance) {
    // ⚠ THE SWAP LINE.
    const api = configuredApi();
    instance = api ? new HttpSessionTransport({ baseUrl: api }) : new LocalSessionTransport();
  }
  return instance;
}

// Exposed for the failure-state walkthrough: with four tabs open, reach for
// `__ripple.faults.failNext()` in a console and watch that tab's next call take
// its error path for real. Kept out of the screens so no production path can
// depend on it.
//
// ⚠ IT WORKS ON EITHER IMPLEMENTATION NOW. The handle used to be conditional on
// the instance being the localStorage one; both carry the same injector, and a
// failure walkthrough that only worked on the implementation being replaced
// would be the wrong one to keep.
export function installFaultHandle(): void {
  if (typeof window === 'undefined') return;
  const t = sessionTransport() as { faults?: unknown };
  if (t.faults) {
    (window as unknown as { __ripple?: unknown }).__ripple = { faults: t.faults };
  }
}
