// ============================================================================
// /join/CODE — CLAIM A TEAM AND PLAY IT.
//
// ⚠ THE ROLE IS IN THE PATH, NOT BEHIND A BUTTON, BECAUSE THE FAILURE MODES ARE
// NOT SYMMETRIC. Landing here by accident CLAIMS A TEAM and locks out the person
// who was supposed to drive it — recoverable only by the host. Landing on
// /view/CODE by accident affects nobody. A single landing page with a
// player/viewer toggle makes the damaging mistake exactly as easy as the
// harmless one, so the two are different URLs and the host hands out whichever
// one it means.
//
// ⚠ REJOIN BY TOKEN. The same browser returning to the same code presents the
// token it already holds and is the SAME player — not a second one claiming a
// team that is already taken. Without this a refresh would lock the real driver
// out of their own game for the rest of the session, and the only fix would be
// the host rebuilding the room.
//
// THE ADVANCE BUTTON BECOMES SUBMIT-AND-WAIT. A player does not advance time;
// the host does. Decisions post and lock, and the screen then says plainly that
// it is waiting — because a locked screen that looked the same as an unlocked
// one is a team that resubmits, and a blank one is a team that thinks it broke.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { clearActive, forgetTeamCredential, loadActive, loadHeld, rememberTeamCredential, saveActive } from '../client/identity';
import { useRoom } from '../client/useRoom';
import { decisionsForYear, decisionsToJson } from '../client/decisions';
import DecisionPanel from '../components/DecisionPanel';
import { useSessionGame } from '../client/useSessionGame';
import TeamResultCard from '../components/TeamResultCard';
import type { DecisionSet } from '../../types/simulation';

interface Props {
  code: string;
}

export default function JoinScreen({ code }: Props) {
  // ⚠ THIS TAB'S identity, not the browser's. sessionStorage is per-tab, so
  // four tabs are four players; it survives a reload, which is the case rejoin
  // has to cover. What the BROWSER has ever held is offered below as a resume
  // choice instead of being applied silently — applying it silently is what made
  // the second tab think it was already the first.
  const active = loadActive(code);
  const [teamToken, setTeamToken] = useState<string | undefined>(
    active.role === 'player' ? active.teamToken : undefined,
  );
  const heldPlayerCreds = loadHeld(code).teams.filter(c => c.role === 'player');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<SessionError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decisions, setDecisions] = useState<DecisionSet | null>(null);

  const { room, you, error, loading, refresh } = useRoom(code, teamToken);

  // ⚠ THE TURN CYCLE. This browser builds its own game from the room's seed and
  // plays its own year the moment the host's advance shows up in a poll. Nothing
  // central simulates anything.
  const game = useSessionGame(code, room, you, teamToken);

  // A stored token the room rejects is a token for a room that no longer
  // exists. Drop it and fall back to the picker rather than showing an error
  // the player cannot act on.
  useEffect(() => {
    if (error?.code === 'BAD_TOKEN' && teamToken) {
      clearActive(code);
      forgetTeamCredential(code, teamToken);
      setTeamToken(undefined);
    }
  }, [error, teamToken, code]);

  // ⚠ RESEED ON YEAR CHANGE, FROM THE LAST SUBMITTED SET. The host advancing is
  // what starts a new turn for this team, and what the team should find in front
  // of it is what it chose last time — not engine defaults. seededYear guards
  // the reseed so that editing during a year is never clobbered by a poll.
  const seededYear = useRef<number | null>(null);
  useEffect(() => {
    if (!room || you?.role !== 'player') return;
    if (seededYear.current === room.currentYear) return;
    seededYear.current = room.currentYear;
    setDecisions(decisionsForYear(room.currentYear, you.lastDecisions));
  }, [room, you]);

  async function claim(teamName: string) {
    setClaiming(teamName);
    setClaimError(null);
    try {
      // The token passed is the one THIS BROWSER already holds for THIS team, if
      // any — that is what turns a re-claim into a rejoin rather than a refusal.
      const held = heldPlayerCreds.find(c => c.teamName === teamName);
      const res = await sessionTransport().join({
        code,
        teamName,
        role: 'player',
        token: held?.teamToken,
      });
      saveActive(code, { teamToken: res.teamToken, teamName: res.teamName, role: 'player' });
      rememberTeamCredential(code, { teamToken: res.teamToken, teamName: res.teamName, role: 'player' });
      setTeamToken(res.teamToken);
      seededYear.current = null;
      refresh();
    } catch (e) {
      setClaimError(isSessionError(e) ? e : null);
    } finally {
      setClaiming(null);
    }
  }

  async function submit() {
    if (!room || !decisions) return;
    setSubmitting(true);
    setClaimError(null);
    try {
      await sessionTransport().submit({
        code,
        token: teamToken!,
        yearNumber: room.currentYear,
        decisions: decisionsToJson(decisions),
      });
      refresh();
    } catch (e) {
      setClaimError(isSessionError(e) ? e : null);
    } finally {
      setSubmitting(false);
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

  // ---- not yet claimed: pick from the pre-registered roster ----------------
  if (you?.role !== 'player') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
        <div className="mx-auto w-full max-w-[480px] pt-10">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room {code}</p>
          <h1 className="text-2xl font-semibold text-slate-800">{room.poolName}</h1>
          <p className="mt-1 text-sm text-slate-500">Choose your team.</p>

          {claimError && (
            <div data-testid="claim-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {claimError.message}
            </div>
          )}

          {heldPlayerCreds.length > 0 && (
            <div data-testid="resume-teams" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-800">This browser has driven a team in this room before.</p>
              <div className="mt-2 space-y-1.5">
                {heldPlayerCreds.map(c => (
                  <button
                    key={c.teamToken}
                    type="button"
                    data-testid={`resume-${c.teamName}`}
                    onClick={() => {
                      saveActive(code, { teamToken: c.teamToken, teamName: c.teamName, role: 'player' });
                      setTeamToken(c.teamToken);
                      seededYear.current = null;
                    }}
                    className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-left text-sm text-blue-800"
                  >
                    Resume as {c.teamName}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div data-testid="team-picker" className="mt-4 space-y-2">
            {room.teams.map(t => (
              <button
                key={t.name}
                type="button"
                data-testid={`claim-${t.name}`}
                disabled={t.joined || claiming !== null}
                onClick={() => { void claim(t.name); }}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm ${
                  t.joined
                    ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50'
                }`}
              >
                <span className="font-medium">{t.name}</span>
                <span className="text-xs">
                  {claiming === t.name ? 'Joining…' : t.joined ? 'taken' : 'available'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- claimed ------------------------------------------------------------
  const locked = room.teams.find(t => t.name === you.teamName)?.locked ?? false;
  const complete = room.status === 'complete';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room {code}</p>
            <h1 data-testid="my-team" className="text-2xl font-semibold text-slate-800">{you.teamName}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Year</p>
            <p data-testid="player-year" className="text-2xl font-semibold text-slate-800">
              {complete ? '—' : room.currentYear}
            </p>
          </div>
        </div>

        {error && error.code !== 'BAD_TOKEN' && (
          <div data-testid="player-poll-error" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            Last refresh failed ({error.code}). Showing the last known state.
          </div>
        )}

        {claimError && (
          <div data-testid="submit-error" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {claimError.message}
          </div>
        )}

        {complete ? (
          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p data-testid="player-complete" className="text-sm text-slate-600">The session is complete.</p>
          </div>
        ) : locked ? (
          // ⚠ SUBMIT-AND-WAIT, SAID OUT LOUD. The team has done its part and
          // cannot do more until the host moves; a screen that did not say so
          // is a team that either resubmits or assumes it is broken.
          <div data-testid="waiting" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <CheckCircle2 className="mx-auto text-emerald-600" size={22} />
            <p className="mt-2 text-sm font-medium text-emerald-800">
              Locked in for year {room.currentYear}.
            </p>
            <p className="mt-1 text-xs text-emerald-700">
              Waiting for the host to advance the year.
            </p>
            <p className="mt-3 text-xs text-emerald-600">
              {room.teams.filter(t => t.joined && !t.locked).length === 0
                ? 'Every team is in.'
                : `Still waiting on ${room.teams.filter(t => t.joined && !t.locked).map(t => t.name).join(', ')}.`}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-5">
              {decisions && (
                <DecisionPanel
                  decisions={decisions}
                  activeLines={room.activeLines}
                  disabled={submitting}
                  onChange={setDecisions}
                />
              )}
            </div>
            <button
              type="button"
              data-testid="submit-lock"
              disabled={submitting || !decisions}
              onClick={() => { void submit(); }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white disabled:bg-slate-300"
            >
              <Lock size={15} />
              {submitting ? 'Submitting…' : `Submit and lock year ${room.currentYear}`}
            </button>
          </>
        )}

        {/* ---- what this browser computed ---- */}
        {game.phase === 'building' && (
          <p data-testid="game-building" className="mt-4 text-center text-xs text-slate-400">
            Building the pool's opening position…
          </p>
        )}
        {game.phase === 'processing' && (
          <p data-testid="game-processing" className="mt-4 text-center text-xs text-slate-500">
            Running year {game.processedYear === null ? room.currentYear - 1 : game.processedYear + 1}…
          </p>
        )}
        {game.error && (
          <p data-testid="game-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {game.error}
          </p>
        )}
        {game.lastResult && <TeamResultCard result={game.lastResult} />}
      </div>
    </div>
  );
}
