// ============================================================================
// /host/CODE — RUN THE ROOM.
//
// ⚠ THE CODE IS IN THE PATH AND THE TOKEN IS IN THE BROWSER, and the split is
// the whole authority model. The path is shareable — it is meant to be, it is
// what the host puts on the projector — so it cannot be what grants control. The
// token never appears in a URL, is never returned by `read`, and is the only
// thing that makes `advance` work.
//
// ⚠ THE RESUME CODE IS PRINTED AT CREATION BECAUSE A CLOSED LAPTOP OTHERWISE
// ENDS THE SESSION. The host token lives in one browser's storage; lose that
// browser — a crash, a cleared cache, a machine swap between sessions — and the
// room is live, every team is still in it, and nobody can advance the year
// again. Showing the token as a resume code, and accepting it back in the form
// below, is the two lines that make that recoverable.
// ============================================================================

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Copy, KeyRound, Loader2 } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { loadActive, loadHeld, rememberHostToken, saveActive } from '../client/identity';
import { useRoom } from '../client/useRoom';

interface Props {
  code: string;
}

export default function HostRoomScreen({ code }: Props) {
  // ⚠ A ROOM HAS EXACTLY ONE HOST, so a second tab on the same browser is the
  // same host and may resume from the browser-wide store automatically. That is
  // the one credential for which this is safe — a team is the opposite case.
  const [hostToken, setHostToken] = useState<string | undefined>(
    () => loadActive(code).hostToken ?? loadHeld(code).hostToken,
  );
  const [resumeInput, setResumeInput] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [actionError, setActionError] = useState<SessionError | null>(null);
  const [showToken, setShowToken] = useState(false);

  const { room, you, error, loading, refresh } = useRoom(code, hostToken);

  // A stored token that the room rejects is a token from a room that no longer
  // exists, or from a different one. Drop it so the resume form appears rather
  // than leaving the screen stuck reporting an error it cannot clear.
  useEffect(() => {
    if (error?.code === 'BAD_TOKEN' && hostToken) setHostToken(undefined);
  }, [error, hostToken]);

  async function handleAdvance() {
    if (!hostToken) return;
    setAdvancing(true);
    setActionError(null);
    try {
      await sessionTransport().advance({ code, token: hostToken });
      refresh();
    } catch (e) {
      setActionError(isSessionError(e) ? e : null);
    } finally {
      setAdvancing(false);
    }
  }

  function handleResume() {
    const t = resumeInput.trim();
    if (!t) return;
    saveActive(code, { hostToken: t });
    rememberHostToken(code, t);
    setHostToken(t);
    setResumeInput('');
  }

  if (loading && !room) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        <span className="ml-2 text-sm">Loading room {code}…</span>
      </div>
    );
  }

  if (error?.code === 'ROOM_NOT_FOUND') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-600">No room with code <span className="font-mono font-semibold">{code}</span>.</p>
        </div>
      </div>
    );
  }

  const isHost = you?.role === 'host';
  const teams = room?.teams ?? [];
  const joined = teams.filter(t => t.joined);
  const outstanding = joined.filter(t => !t.locked);
  const complete = room?.status === 'complete';

  // ⚠ RESULTS ARE FOR THE YEAR JUST PLAYED, WHICH IS THE ONE BEHIND THE ROOM.
  // The host advances to year N+1; every browser then computes year N and posts
  // it. So "reported" always trails the current year by one, and before the
  // first advance there is no year to have reported on at all.
  const reportingYear = (room?.currentYear ?? 1) - 1;
  const awaitingResults = reportingYear >= 1
    ? joined.filter(t => (t.resultYear ?? 0) < reportingYear)
    : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
      <div className="mx-auto w-full max-w-[860px]">

        {/* ---- the code, for the projector ---- */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room code</p>
              <p data-testid="room-code" className="font-mono text-4xl font-semibold tracking-[0.2em] text-slate-800">
                {code}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {room?.poolName} · seed <span className="font-mono">{room?.seed}</span> · {room?.yearCount} years
                {' · offering '}<span className="font-mono">{(room?.availableLines ?? []).join(' + ')}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current year</p>
              <p data-testid="current-year" className="text-4xl font-semibold text-slate-800">
                {complete ? '—' : room?.currentYear}
              </p>
              {room && !complete && (
                <p className="text-xs text-slate-400">of {room.yearCount}</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <span>Players join at <span className="font-mono text-slate-700">/join/{code}</span></span>
            <span>Watchers at <span className="font-mono text-slate-700">/view/{code}</span></span>
          </div>
        </div>

        {/* ---- resume ---- */}
        {!isHost && (
          <div data-testid="resume-form" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center gap-2 text-amber-800">
              <KeyRound size={15} />
              <p className="text-sm font-medium">This browser does not hold the host key for this room.</p>
            </div>
            <p className="mt-1 text-xs text-amber-700">
              Paste the resume code shown when the room was created. Without it the room can be watched but not advanced.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                data-testid="resume-input"
                className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm"
                placeholder="host resume code"
                value={resumeInput}
                onChange={e => setResumeInput(e.target.value)}
              />
              <button
                type="button"
                data-testid="resume-submit"
                onClick={handleResume}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white"
              >
                Resume as host
              </button>
            </div>
          </div>
        )}

        {/* ---- the resume code itself ---- */}
        {isHost && hostToken && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Host resume code</p>
                <p className="text-xs text-slate-400">
                  Write this down. It is the only way back into this room from another browser.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code data-testid="host-resume-code" className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                  {showToken ? hostToken : '•'.repeat(16)}
                </code>
                <button
                  type="button"
                  data-testid="reveal-resume-code"
                  onClick={() => setShowToken(v => !v)}
                  className="text-xs text-blue-600"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(hostToken); }}
                  className="text-slate-400 hover:text-slate-600"
                  aria-label="Copy resume code"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---- a failed poll, reported without clearing the table ---- */}
        {error && error.code !== 'BAD_TOKEN' && (
          <div data-testid="poll-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            Last refresh failed ({error.code}). Showing the last known state.
          </div>
        )}

        {/* ---- the table ---- */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <p className="text-sm font-medium text-slate-700">Teams</p>
            <p className="text-xs text-slate-400">
              {teams.length === 0 ? 'none yet' : `${teams.length} joined`}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2 font-medium">Team</th>
                <th className="px-5 py-2 font-medium">Lines</th>
                <th className="px-5 py-2 font-medium">Joined</th>
                <th className="px-5 py-2 font-medium">Locked</th>
                <th className="px-5 py-2 font-medium">Reported</th>
              </tr>
            </thead>
            <tbody data-testid="team-table">
              {teams.length === 0 && (
                <tr>
                  <td colSpan={4} data-testid="no-teams-yet" className="px-5 py-6 text-center text-sm text-slate-400">
                    Waiting for teams to join at /join/{code}. Each names itself and picks its own lines.
                  </td>
                </tr>
              )}
              {teams.map(t => (
                <tr key={t.name} data-testid={`team-row-${t.name}`} className="border-t border-slate-50">
                  <td className="px-5 py-2.5 text-slate-700">{t.name}</td>
                  {/* ⚠ THE HOST IS NOW READING A TABLE OF DIFFERENT GAMES, not
                      of seats at one. Two teams' numbers are not comparable
                      unless this column matches, so it sits beside the name
                      rather than behind a hover. */}
                  <td className="px-5 py-2.5">
                    <span data-testid={`lines-${t.name}`} className="font-mono text-xs text-slate-600">
                      {t.lines.join(' + ')}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    {t.joined
                      ? <span data-testid={`joined-${t.name}`} className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 size={14} /> in</span>
                      : <span className="flex items-center gap-1.5 text-slate-300"><Circle size={14} /> waiting</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    {t.locked
                      ? <span data-testid={`locked-${t.name}`} className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 size={14} /> locked</span>
                      : <span className="flex items-center gap-1.5 text-slate-300"><Circle size={14} /> open</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    {t.resultYear !== null
                      ? <span data-testid={`reported-${t.name}`} className="flex items-center gap-1.5 text-slate-600">
                          <CheckCircle2 size={14} className="text-emerald-600" /> year {t.resultYear}
                        </span>
                      : <span className="flex items-center gap-1.5 text-slate-300"><Circle size={14} /> —</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- advance ---- */}
        {isHost && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            {actionError && (
              <p data-testid="advance-error" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {actionError.message}
              </p>
            )}
            {reportingYear >= 1 && (
              <p className="mb-3 text-xs text-slate-500">
                {/* ⚠ BY NAME, NOT BY COUNT — the names are who gets chased. */}
                {awaitingResults.length === 0
                  ? <>Year {reportingYear} results are in from every team.</>
                  : <>Year {reportingYear} results outstanding from <span data-testid="awaiting-results" className="font-medium text-slate-700">{awaitingResults.map(t => t.name).join(', ')}</span></>}
              </p>
            )}
            {complete ? (
              <p data-testid="room-complete" className="text-sm text-slate-600">
                All {room?.yearCount} years are complete.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  {/* ⚠ BY NAME, NOT BY COUNT. "2 outstanding" makes the host read
                      the table to find out who; the names are the actionable thing
                      — they are who gets chased. */}
                  {outstanding.length === 0
                    ? joined.length === 0
                      ? 'No teams have joined yet.'
                      : 'Every team that has joined is locked in.'
                    : <>Waiting on <span data-testid="outstanding" className="font-medium text-slate-700">{outstanding.map(t => t.name).join(', ')}</span></>}
                </p>
                <button
                  type="button"
                  data-testid="advance"
                  disabled={advancing}
                  onClick={() => { void handleAdvance(); }}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
                >
                  {advancing ? 'Advancing…' : `Advance to year ${(room?.currentYear ?? 1) + 1}`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
