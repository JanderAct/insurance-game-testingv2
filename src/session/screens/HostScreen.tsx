// ============================================================================
// THE HOST SCREEN — the tab shell, and which tab is showing.
//
// ⚠ ONE SCREEN, TWO STATES, NOT TWO SCREENS. /host has no room yet and
// /host/CODE has one; the chrome does not change under the host as they move
// between them, because configuring and then running is one task. This is the
// component that will grow a switch as tabs land — today it has one case, and
// that is the point: the next tab is a row in HOST_TABS and a case here.
// ============================================================================

import { useState } from 'react';
import HostShell from './HostShell';
import { type HostTabId } from './hostTabs';
import HostCreateScreen from './HostCreateScreen';
import HostRoomScreen from './HostRoomScreen';
import HostTeamsTab from './HostTeamsTab';
import { useRoom } from '../client/useRoom';
import { loadActive, loadHeld } from '../client/identity';

interface Props {
  /** Absent on /host, where the room does not exist yet. */
  code?: string;
}

export default function HostScreen({ code }: Props) {
  const [activeTab, setActiveTab] = useState<HostTabId>('setup');

  // Read only to title the bar; HostRoomScreen does its own polling and owns
  // every action. A second reader is cheap (the poll is shared per code) and
  // keeps the chrome from having to be told what the room is called.
  const hostToken = code ? (loadActive(code).hostToken ?? loadHeld(code).hostToken) : undefined;
  const { room } = useRoom(code ?? '', hostToken, code ? 3000 : 3_600_000);

  return (
    <HostShell
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      hasRoom={!!code}
      code={code}
      eventName={code ? room?.eventName : undefined}
    >
      {activeTab === 'setup' && (code ? <HostRoomScreen code={code} /> : <HostCreateScreen />)}
      {activeTab === 'teams' && (
        room
          ? <HostTeamsTab room={room} />
          : <p className="text-sm text-slate-400">Loading room…</p>
      )}
    </HostShell>
  );
}
