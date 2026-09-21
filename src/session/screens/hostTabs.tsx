// ============================================================================
// THE HOST SCREEN'S TAB LIST.
//
// ⚠ ITS OWN FILE SO ADDING A TAB TOUCHES A LIST, NOT A COMPONENT. It also keeps
// HostShell exporting nothing but a component, which is what the react-refresh
// rule asks for — the same reason seedHash.ts sits outside App.tsx.
// ============================================================================

import React from 'react';
import { Settings } from 'lucide-react';

export type HostTabId = 'setup';

export interface HostTab {
  id: HostTabId;
  label: string;
  icon: React.ReactNode;
  /** Tabs with nothing to show until a room exists render disabled on /host. */
  needsRoom?: boolean;
}

export const HOST_TABS: HostTab[] = [
  { id: 'setup', label: 'Game Setup', icon: <Settings size={15} /> },
  // The next tabs land here. Each needs a case in HostScreen's switch and, if it
  // only makes sense once the room is live, needsRoom: true.
];
