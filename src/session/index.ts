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
// WHAT A HOSTED IMPLEMENTATION COSTS, CONCRETELY. A class implementing the five
// methods by POSTing its request object to `${BASE_URL}/<method>` and mapping
// status codes onto SessionErrorCode — because requests are already plain JSON
// and authority is already a token field, there is nothing to translate — plus
// the one line below that chooses it. Nothing else in this repository changes.
// ============================================================================

import type { SessionTransport } from './contract';
import { LocalSessionTransport } from './localTransport';

export * from './contract';
export { LocalSessionTransport } from './localTransport';

let instance: SessionTransport | null = null;

export function sessionTransport(): SessionTransport {
  if (!instance) {
    // ⚠ THE SWAP LINE. Replace with `new HttpSessionTransport({ baseUrl })`.
    instance = new LocalSessionTransport();
  }
  return instance;
}

// Exposed for the failure-state walkthrough: with four tabs open, reach for
// `__ripple.faults.failNext()` in a console and watch that tab's next call take
// its error path for real. Kept out of the screens so no production path can
// depend on it.
export function installFaultHandle(): void {
  if (typeof window === 'undefined') return;
  const t = sessionTransport();
  if (t instanceof LocalSessionTransport) {
    (window as unknown as { __ripple?: unknown }).__ripple = { faults: t.faults };
  }
}
