// ============================================================================
// THE ROUTE TABLE.
//
// ⚠ THE SOLO GAME IS THE DEFAULT AND IS RENDERED UNCHANGED. Every path that is
// not a session path falls through to App exactly as before, so the existing
// single-player game is reachable, unmodified, and unaffected by any of this.
// The session layer is additive — nothing above it had to be rewritten to make
// room for it.
// ============================================================================

import { useEffect, useState } from 'react';
import App from '../App';
import { onRouteChange, parseRoute, type Route } from './client/navigation';
import HostCreateScreen from './screens/HostCreateScreen';
import HostRoomScreen from './screens/HostRoomScreen';
import JoinScreen from './screens/JoinScreen';
import ViewScreen from './screens/ViewScreen';

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => onRouteChange(() => setRoute(parseRoute(window.location.pathname))), []);
  return route;
}

export default function SessionRouter() {
  const route = useRoute();

  switch (route.kind) {
    case 'host-create':
      return <HostCreateScreen />;
    case 'host-room':
      return <HostRoomScreen code={route.code} />;
    case 'join':
      return <JoinScreen code={route.code} />;
    case 'view':
      return <ViewScreen code={route.code} />;
    case 'solo':
      return <App />;
  }
}
