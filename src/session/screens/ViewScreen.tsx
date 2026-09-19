// ============================================================================
// /view/CODE — WATCH A TEAM.
//
// ⚠ A VIEWER NEVER CLAIMS. That is the whole reason this is a separate URL from
// /join/CODE rather than a toggle on one: a viewer token does not take the team,
// does not mark it joined, cannot submit, and any number of people may watch the
// same team at once. Somebody who opens the wrong link here costs nobody
// anything, which is exactly what could not be said of the other direction.
//
// Enforced at the transport, not here — a viewer token is refused by submit
// (see localTransport's submit) rather than merely lacking a button.
// ============================================================================

import { useState } from 'react';
import { CheckCircle2, Circle, Eye, Loader2 } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { loadActive, loadHeld, rememberTeamCredential, saveActive } from '../client/identity';
import { useRoom } from '../client/useRoom';

interface Props {
  code: string;
}

export default function ViewScreen({ code }: Props) {
  const active = loadActive(code);
  const [viewerToken, setViewerToken] = useState<string | undefined>(
    active.role === 'viewer' ? active.teamToken : undefined,
  );
  const heldViewerCreds = loadHeld(code).teams.filter(c => c.role === 'viewer');
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<SessionError | null>(null);

  const { room, you, error, loading, refresh } = useRoom(code, viewerToken);

  async function watch(teamName: string) {
    setPicking(teamName);
    setPickError(null);
    try {
      const held = heldViewerCreds.find(c => c.teamName === teamName);
      const res = await sessionTransport().join({ code, teamName, role: 'viewer', token: held?.teamToken });
      saveActive(code, { teamToken: res.teamToken, teamName: res.teamName, role: 'viewer' });
      rememberTeamCredential(code, { teamToken: res.teamToken, teamName: res.teamName, role: 'viewer' });
      setViewerToken(res.teamToken);
      refresh();
    } catch (e) {
      setPickError(isSessionError(e) ? e : null);
    } finally {
      setPicking(null);
    }
  }

  if (loading && !room) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        <span className="ml-2 text-sm">Finding room {code}…</span>
      </div>
    );
  }

  if (error?.code === 'ROOM_NOT_FOUND' || !room) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-600">
          No room with code <span className="font-mono font-semibold">{code}</span>.
        </p>
      </div>
    );
  }

  if (you?.role !== 'viewer') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
        <div className="mx-auto w-full max-w-[480px] pt-10">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room {code}</p>
          <h1 className="text-2xl font-semibold text-slate-800">{room.poolName}</h1>
          <p className="mt-1 text-sm text-slate-500">Choose a team to watch. Watching claims nothing.</p>

          {pickError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {pickError.message}
            </div>
          )}

          <div data-testid="viewer-picker" className="mt-4 space-y-2">
            {room.teams.map(t => (
              <button
                key={t.name}
                type="button"
                data-testid={`watch-${t.name}`}
                disabled={picking !== null}
                onClick={() => { void watch(t.name); }}
                className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm text-slate-700 hover:border-blue-400 hover:bg-blue-50"
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-slate-400">{picking === t.name ? 'Opening…' : 'watch'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const team = room.teams.find(t => t.name === you.teamName);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="flex items-end justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
              <Eye size={12} /> Watching · room {code}
            </p>
            <h1 data-testid="watched-team" className="text-2xl font-semibold text-slate-800">{you.teamName}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Year</p>
            <p data-testid="viewer-year" className="text-2xl font-semibold text-slate-800">
              {room.status === 'complete' ? '—' : room.currentYear}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm">
            {team?.locked
              ? <span data-testid="viewer-locked" className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 size={15} /> Locked in for year {room.currentYear}</span>
              : <span data-testid="viewer-open" className="flex items-center gap-1.5 text-slate-400"><Circle size={15} /> Still deciding year {room.currentYear}</span>}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
          <p className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">Room</p>
          <ul className="divide-y divide-slate-50">
            {room.teams.map(t => (
              <li key={t.name} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className={t.name === you.teamName ? 'font-medium text-slate-800' : 'text-slate-600'}>{t.name}</span>
                <span className="text-xs text-slate-400">
                  {!t.joined ? 'not joined' : t.locked ? 'locked' : 'deciding'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
