// ============================================================================
// THE HOST SCREEN'S TAB LIST.
//
// ⚠ ITS OWN FILE SO ADDING A TAB TOUCHES A LIST, NOT A COMPONENT. It also keeps
// HostShell exporting nothing but a component, which is what the react-refresh
// rule asks for — the same reason seedHash.ts sits outside App.tsx.
// ============================================================================

import React from 'react';
import { Settings, Users, LineChart } from 'lucide-react';

export type HostTabId = 'setup' | 'teams' | 'charts';

export interface HostTab {
  id: HostTabId;
  label: string;
  icon: React.ReactNode;
  /** Tabs with nothing to show until a room exists render disabled on /host. */
  needsRoom?: boolean;
}

export const HOST_TABS: HostTab[] = [
  { id: 'setup', label: 'Game Setup', icon: <Settings size={15} /> },
  // Nothing to scan until a room exists and teams are in it.
  { id: 'teams', label: 'Teams', icon: <Users size={15} />, needsRoom: true },
  // Nothing to plot until there is a room with years in it.
  { id: 'charts', label: 'Charts', icon: <LineChart size={15} />, needsRoom: true },
  // The next tabs land here. Each needs a case in HostScreen's switch and, if it
  // only makes sense once the room is live, needsRoom: true.
];
