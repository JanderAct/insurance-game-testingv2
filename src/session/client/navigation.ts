// ============================================================================
// A ROUTER, KEPT DELIBERATELY SMALL.
//
// Four paths and no nesting, so this is roughly forty lines against a
// dependency, a lockfile change and a bundle. The existing app is a tab-based
// single page that does not route at all; adding a routing library to serve four
// session URLs would put a framework in the tree for one screen's worth of need.
//
// ⚠ THE PATH CARRIES THE ROOM CODE AND THE ROLE, AND BOTH ARE DELIBERATE. The
// code in the path is what makes a refresh return to the same room instead of a
// lobby. The role in the path — /join/CODE against /view/CODE — rather than a
// button on a shared landing page is because THE FAILURE MODES ARE NOT
// SYMMETRIC: landing as a player by accident claims a team and blocks the person
// who was supposed to drive it, while landing as a viewer by accident affects
// nobody. A single link with a role toggle makes the damaging mistake exactly as
// easy as the harmless one.
// ============================================================================

export type Route =
  | { kind: 'solo' }
  | { kind: 'host-create' }
  | { kind: 'host-room'; code: string }
  | { kind: 'join'; code: string }
  | { kind: 'view'; code: string };

const NAV_EVENT = 'ripple:navigate';

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(p => p.length > 0);

  if (parts[0] === 'host') {
    // Codes are uppercased on the way in so a link typed in lower case still
    // finds the room — the alphabet has no lower-case members.
    if (parts.length === 1) return { kind: 'host-create' };
    return { kind: 'host-room', code: parts[1].toUpperCase() };
  }
  if (parts[0] === 'join' && parts.length >= 2) return { kind: 'join', code: parts[1].toUpperCase() };
  if (parts[0] === 'view' && parts.length >= 2) return { kind: 'view', code: parts[1].toUpperCase() };

  // Anything else is the existing single-player game, untouched.
  return { kind: 'solo' };
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

// Both events matter: popstate for the back button, the custom one for our own
// pushes (pushState deliberately does not fire popstate).
export function onRouteChange(fn: () => void): () => void {
  window.addEventListener('popstate', fn);
  window.addEventListener(NAV_EVENT, fn);
  return () => {
    window.removeEventListener('popstate', fn);
    window.removeEventListener(NAV_EVENT, fn);
  };
}
