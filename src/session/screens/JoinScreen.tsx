// ============================================================================
// /join/CODE — CLAIM A TEAM AND PLAY THE GAME.
//
// ⚠ THE PLAYER GETS THE WHOLE GAME, NOT A SESSION-SHAPED VERSION OF IT. This
// screen renders GameShell — the same tab list, the same decisions page with the
// same thirteen props, the same results, financials, audit, spreadsheet and
// membership pages that a solo player sees at '/'. It is the second caller of
// one implementation, not a second implementation.
//
// FOUR THINGS DIFFER, AND EVERY ONE OF THEM IS A PROP ON THAT SHELL:
//
//   the year advances when the HOST says so. The header's Lock Year button
//   submits and locks instead of processing, and then reads as waiting.
//   there is no Game Setup tab. The ROOM owns the seed, the year count, the
//   lines and the shock schedule; a player choosing any of them would fork
//   their instance away from every other team's.
//   there is no New Game. The host owns the lifecycle.
//   results post at year end, from the turn cycle in useSessionGame.
//
// ⚠ AND ONE THING IS ABSENT RATHER THAN DIFFERENT: THE LOAN STEP. Solo play
// blocks on LoanPromptModal until the player authorises or declines. A session
// year is processed when the host advances — the player may not have the tab
// focused, and the host cannot wait on three modals. The offer is declined
// automatically (see useSessionGame), which is the choice that changes nothing
// on its own initiative. That is a real capability gap, stated rather than
// papered over: it is not a session-flavoured loan step, it is no loan step.
//
// ⚠ THE ROLE IS IN THE PATH, NOT BEHIND A BUTTON, BECAUSE THE FAILURE MODES ARE
// NOT SYMMETRIC. Landing here by accident CLAIMS A TEAM and locks out the person
// who was supposed to drive it. Landing on /view/CODE by accident affects nobody.
//
// ⚠ REJOIN BY TOKEN, AND WHAT IT COSTS. The same browser returning to the same
// code is the same player. But a session player does NOT write the solo save —
// four tabs on one origin share one key and would clobber each other and the
// solo game — so a reload rebuilds from the seed and REPLAYS. The replay uses
// the team's last submitted decisions for every year it catches up on, because
// the room stores one decision slot per team rather than a per-year history. A
// team that varied its decisions and then reloads can see numbers that differ
// from the ones it originally posted. Pre-existing, and far more visible now
// that the decisions are the real ones.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { clearActive, forgetTeamCredential, loadActive, loadHeld, rememberTeamCredential, saveActive } from '../client/identity';
import { useRoom } from '../client/useRoom';
import { decisionsForYear, decisionsToJson } from '../client/decisions';
import { useSessionGame } from '../client/useSessionGame';
import GameShell from '../../game/GameShell';
import type { TabId } from '../../components/TabNav';
import type { DecisionSet, LineView } from '../../types/simulation';

interface Props {
  code: string;
}

export default function JoinScreen({ code }: Props) {
  const active = loadActive(code);
  const [teamToken, setTeamToken] = useState<string | undefined>(
    active.role === 'player' ? active.teamToken : undefined,
  );
  const heldPlayerCreds = loadHeld(code).teams.filter(c => c.role === 'player');

  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<SessionError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decisions, setDecisions] = useState<DecisionSet | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('decisions');
  const [lineView, setLineView] = useState<LineView>('pool');

  const { room, you, error, loading, refresh } = useRoom(code, teamToken);
  const game = useSessionGame(code, room, you, teamToken);

  useEffect(() => {
    if (error?.code === 'BAD_TOKEN' && teamToken) {
      clearActive(code);
      forgetTeamCredential(code, teamToken);
      setTeamToken(undefined);
    }
  }, [error, teamToken, code]);

  // ⚠ RESEED ON YEAR CHANGE, FROM THE LAST SUBMITTED SET. The host advancing is
  // what starts a new turn for this team, and what it should find in front of it
  // is what it chose last time — not engine defaults. seededYear guards the
  // reseed so editing during a year is never clobbered by a poll.
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
      const held = heldPlayerCreds.find(c => c.teamName === teamName);
      const res = await sessionTransport().join({ code, teamName, role: 'player', token: held?.teamToken });
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
    if (!room || !decisions || !teamToken) return;
    setSubmitting(true);
    setClaimError(null);
    try {
      await sessionTransport().submit({
        code, token: teamToken, yearNumber: room.currentYear,
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

  // ---- claimed, but the pre-game is still running -------------------------
  if (!game.gameState || !decisions) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center text-slate-500">
        <Loader2 className="animate-spin" size={20} />
        <p className="mt-3 text-sm font-medium" data-testid="game-building">
          Building {you.teamName}'s opening position…
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Three pre-game years are simulated in this browser, from the room's seed.
        </p>
        {game.error && (
          <p data-testid="game-error" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {game.error}
          </p>
        )}
      </div>
    );
  }

  const myTeam = room.teams.find(t => t.name === you.teamName);
  const locked = myTeam?.locked ?? false;
  const complete = room.status === 'complete';
  const outstanding = room.teams.filter(t => t.joined && !t.locked).map(t => t.name);
  const processing = game.phase === 'processing';

  return (
    <GameShell
      gameState={game.gameState}
      startingFinancials={game.startingFinancials}
      initialMembers={game.initialMembers}
      currentDecisions={decisions}
      onDecisionsChange={setDecisions}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      lineView={lineView}
      onSelectLineView={setLineView}
      onAdvanceYear={() => { void submit(); }}
      canAdvance={!locked && !submitting && !complete && !processing}
      advanceLabel={
        submitting ? 'Submitting…'
          : locked ? 'Waiting for host'
          : `Lock Year ${room.currentYear}`
      }
      decisionsDisabled={locked}
      // No setupPage (the room owns setup), no onNewGame (the host owns the
      // lifecycle), no loanPrompt (see the header note).
      statusStrip={
        <div data-testid="session-strip" className="border-b border-slate-200 bg-white px-4 py-2">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="font-medium text-slate-700" data-testid="my-team">{you.teamName}</span>
            <span className="text-slate-400">room <span className="font-mono">{code}</span></span>
            <span className="text-slate-500">
              Year <span data-testid="player-year" className="font-medium text-slate-700">{complete ? '—' : room.currentYear}</span>
              {' '}of {room.yearCount}
            </span>

            {complete ? (
              <span data-testid="player-complete" className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 size={13} /> Session complete
              </span>
            ) : processing ? (
              <span data-testid="game-processing" className="flex items-center gap-1.5 text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Running year {game.gameState.currentYearNumber}…
              </span>
            ) : locked ? (
              <span data-testid="waiting" className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 size={13} /> Locked in — waiting for the host
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-500">
                <Clock size={13} /> Open for decisions
              </span>
            )}

            {!complete && outstanding.length > 0 && (
              <span className="text-slate-400">
                still deciding: <span data-testid="outstanding">{outstanding.join(', ')}</span>
              </span>
            )}

            {game.processedYear !== null && (
              <span className="text-slate-400" data-testid="posted-year">
                year {game.processedYear} result posted
              </span>
            )}

            {claimError && (
              <span data-testid="submit-error" className="text-red-600">{claimError.message}</span>
            )}
            {error && error.code !== 'BAD_TOKEN' && (
              <span data-testid="player-poll-error" className="text-red-600">
                refresh failed ({error.code})
              </span>
            )}
            {game.error && (
              <span data-testid="game-error" className="text-red-600">{game.error}</span>
            )}
          </div>
        </div>
      }
    />
  );
}
