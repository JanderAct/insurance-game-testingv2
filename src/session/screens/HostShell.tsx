// ============================================================================
// THE HOST SCREEN'S TAB CHROME.
//
// ⚠ BUILT FOR THE TABS THAT ARE NOT HERE YET. Today there is exactly one —
// Game Setup — and a single tab is not worth a component. The point is that the
// NEXT one is a row in HOST_TABS and a case in the caller's switch, rather than
// a restructure of a screen that had grown around the assumption of being
// alone. Retrofitting tabs onto a settled layout is how a screen ends up with
// one privileged view and several afterthoughts.
//
// ⚠ IT SPANS BOTH HOST ROUTES DELIBERATELY. /host (no room yet) and /host/CODE
// (a room running) are two states of one screen, not two screens: the host
// configures, creates, and then runs, without the chrome changing under them.
// The tab strip is disabled before a room exists for the tabs that need one,
// which is the same pattern GameShell already uses for the player's tabs before
// a game is started.
// ============================================================================

import React from 'react';
import { HOST_TABS, type HostTabId } from './hostTabs';

interface Props {
  activeTab: HostTabId;
  onSelectTab: (t: HostTabId) => void;
  /** False on /host, where no room has been created yet. */
  hasRoom: boolean;
  /** The room code, shown in the bar once there is one. */
  code?: string;
  eventName?: string;
  children: React.ReactNode;
}

export default function HostShell({ activeTab, onSelectTab, hasRoom, code, eventName, children }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-baseline gap-x-3 gap-y-1 px-6 pt-5">
          <h1 className="text-lg font-semibold text-slate-800">
            {eventName || 'Host a session'}
          </h1>
          {code && (
            <span className="text-sm text-slate-400">
              room <span className="font-mono font-medium text-slate-600">{code}</span>
            </span>
          )}
        </div>
        <nav className="mx-auto flex max-w-[960px] gap-1 px-6 pt-3">
          {HOST_TABS.map(t => {
            const disabled = !!t.needsRoom && !hasRoom;
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`host-tab-${t.id}`}
                disabled={disabled}
                onClick={() => onSelectTab(t.id)}
                className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : disabled
                      ? 'border-transparent text-slate-300'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className={active ? 'text-blue-600' : 'text-slate-400'}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[960px] px-6 py-6">{children}</main>
    </div>
  );
}
