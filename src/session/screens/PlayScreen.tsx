// ============================================================================
// /join/CODE AND /view/CODE — ONE SCREEN, TWO ROLES.
//
// ⚠ THEY ARE THE SAME SCREEN BECAUSE THEY ARE THE SAME DATA. A viewer builds the
// same game from the same room, plays the same years through the same engine and
// renders the same GameShell — eleven tabs, the decisions page, results,
// financials, audit, spreadsheet, membership. A second component rendering the
// same state read-only would be a second rendering path for one dataset, which
// is precisely the hazard the GameShell extraction existed to remove. The role
// is a parameter, not a fork.
//
// WHAT THE ROLE ACTUALLY CHANGES, AND IT IS ALL OF IT:
//
//   joining    a player NAMES its team and CHOOSES ITS COVERAGE LINES, and that
//              join is the moment the team comes into being. A viewer picks from
//              the teams that already exist, claims nothing, and any number may
//              watch the same one.
//   submitting a player's header button submits and locks. A viewer HAS NO
//              BUTTON — not a disabled one, because a disabled control still
//              invites the click and still implies the screen might write.
//   decisions  read-only for a viewer, always. The controls RENDER rather than
//              disappear: the table is discussing what the driver chose, so the
//              watcher needs to see the settings, not an empty panel.
//
// ⚠ WHAT A VIEWER SEES IN THE DECISION CONTROLS IS THE LAST SUBMITTED SET, NOT
// THE DRIVER'S LIVE EDITS, AND THAT IS A PROPERTY OF THE ROOM RATHER THAN OF
// THIS SCREEN. Decisions reach the room on submit; there is no per-keystroke
// write and deliberately so — a post per slider drag is the thing the save
// debounce exists to avoid. So while a driver is still deciding, its watchers
// see what that team locked LAST time, and the moment it locks, the next poll
// shows this year's real choices. Live mirroring would need a presence channel
// that does not exist and that nothing else wants.
//
// ⚠ A VIEWER'S NUMBERS ARE THE DRIVER'S NUMBERS BY CONSTRUCTION. Same seed, same
// LINES, same decisions, same engine, so the same results — not copied over the
// wire, and not trusted from it. The viewer never posts (see useSessionGame):
// the scoreboard belongs to the team that drives it.
//
// ⚠ COVERAGE LINES ARE CHOSEN ONCE AND THE SCREEN SAYS SO TWICE. Before the
// choice, the form states that it is permanent; after it, the status strip shows
// the set with no control to change it. Behind both, the transport refuses a
// rejoin asking for a different set — because a team's pre-game, its roster and
// its whole claim history are a function of the lines it opened with, so
// changing them mid-game would restart its book rather than adjust it.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Eye, Loader2 } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { clearActive, forgetTeamCredential, loadActive, loadHeld, rememberTeamCredential, saveActive } from '../client/identity';
import { useRoom } from '../client/useRoom';
import { decisionsForYear, decisionsToJson } from '../client/decisions';
import { useSessionGame } from '../client/useSessionGame';
import GameShell from '../../game/GameShell';
import type { TabId } from '../../components/TabNav';
import type { CoverageLine, DecisionSet, LineView } from '../../types/simulation';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';

export type PlayRole = 'player' | 'viewer';

interface Props {
  code: string;
  role: PlayRole;
}

export default function PlayScreen({ code, role }: Props) {
  const isViewer = role === 'viewer';

  const active = loadActive(code);
  const [token, setToken] = useState<string | undefined>(
    active.role === role ? active.teamToken : undefined,
  );
  const heldCreds = loadHeld(code).teams.filter(c => c.role === role);

  const [claiming, setClaiming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [lineDraft, setLineDraft] = useState<CoverageLine[]>([]);
  const [actionError, setActionError] = useState<SessionError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decisions, setDecisions] = useState<DecisionSet | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('decisions');
  const [lineView, setLineView] = useState<LineView>('pool');

  const { room, you, error, loading, refresh } = useRoom(code, token);
  const game = useSessionGame(code, room, you, token);

  useEffect(() => {
    if (error?.code === 'BAD_TOKEN' && token) {
      clearActive(code);
      forgetTeamCredential(code, token);
      setToken(undefined);
    }
  }, [error, token, code]);

  // Reseed on year change, from the last submitted set. For a player that is
  // carry-forward; for a viewer it is simply what the team it watches last
  // locked, which is the most recent thing there is to show.
  const seededYear = useRef<number | null>(null);
  useEffect(() => {
    if (!room || you?.role !== role) return;
    if (seededYear.current === room.currentYear) return;
    seededYear.current = room.currentYear;
    setDecisions(decisionsForYear(room.currentYear, you.lastDecisions));
  }, [room, you, role]);

  async function enter(teamName: string, lines?: CoverageLine[]) {
    setClaiming(teamName);
    setActionError(null);
    try {
      const held = heldCreds.find(c => c.teamName === teamName);
      // ⚠ NO `lines` ON A REJOIN. The team already holds its set and the
      // transport refuses a rejoin that asks for a different one (LINES_LOCKED);
      // sending the form's current state would turn a refresh into that refusal.
      const res = await sessionTransport().join({
        code, teamName, role,
        token: held?.teamToken,
        lines: held ? undefined : lines,
      });
      saveActive(code, { teamToken: res.teamToken, teamName: res.teamName, role });
      rememberTeamCredential(code, { teamToken: res.teamToken, teamName: res.teamName, role });
      setToken(res.teamToken);
      seededYear.current = null;
      refresh();
    } catch (e) {
      setActionError(isSessionError(e) ? e : null);
    } finally {
      setClaiming(null);
    }
  }

  async function submit() {
    if (isViewer || !room || !decisions || !token) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await sessionTransport().submit({
        code, token, yearNumber: room.currentYear,
        decisions: decisionsToJson(decisions),
      });
      refresh();
    } catch (e) {
      setActionError(isSessionError(e) ? e : null);
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

  // ---- not yet in: pick from the pre-registered roster --------------------
  if (you?.role !== role) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
        <div className="mx-auto w-full max-w-[480px] pt-10">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room {code}</p>
          <h1 className="text-2xl font-semibold text-slate-800">{room.poolName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isViewer ? 'Choose a team to watch. Watching claims nothing.' : 'Name your team and choose the lines you will write.'}
          </p>

          {actionError && (
            <div data-testid="claim-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {actionError.message}
            </div>
          )}

          {heldCreds.length > 0 && !isViewer && (
            <div data-testid="resume-teams" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-800">This browser has driven a team in this room before.</p>
              <div className="mt-2 space-y-1.5">
                {heldCreds.map(c => (
                  <button
                    key={c.teamToken}
                    type="button"
                    data-testid={`resume-${c.teamName}`}
                    onClick={() => {
                      saveActive(code, { teamToken: c.teamToken, teamName: c.teamName, role });
                      setToken(c.teamToken);
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

          {isViewer ? (
            // A viewer picks from the teams that EXIST. Before anyone has
            // joined there is nothing to watch, and saying so beats an empty box.
            <div data-testid="viewer-picker" className="mt-4 space-y-2">
              {room.teams.length === 0 && (
                <p data-testid="no-teams" className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">
                  No teams have joined yet.
                </p>
              )}
              {room.teams.map(t => (
                <button
                  key={t.name}
                  type="button"
                  data-testid={`watch-${t.name}`}
                  disabled={claiming !== null}
                  onClick={() => { void enter(t.name); }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm text-slate-700 hover:border-blue-400 hover:bg-blue-50"
                >
                  <span>
                    <span className="font-medium">{t.name}</span>
                    <span className="ml-2 text-xs text-slate-400">{t.lines.join(' + ')}</span>
                  </span>
                  <span className="text-xs">{claiming === t.name ? 'Opening…' : 'watch'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div data-testid="team-picker" className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Team name</span>
                <input
                  data-testid="team-name"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Harbour Mutual"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                />
              </label>

              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Your coverage lines</span>
                {/* ⚠ SAID BEFORE THE CHOICE IS MADE, not discovered after. The
                    transport refuses a later change, so the screen must not
                    imply one is possible. */}
                <p className="mt-1 text-xs text-amber-700">
                  Chosen once. Your pool's history and claims are built from these, so they cannot be changed after you join.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {room.availableLines.map(l => (
                    <button
                      key={l}
                      type="button"
                      data-testid={`pick-line-${l}`}
                      onClick={() => setLineDraft(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        lineDraft.includes(l)
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      {LINE_FULL_NAME[l]}
                    </button>
                  ))}
                </div>
                {lineDraft.length === 0 && (
                  <p className="mt-2 text-xs text-slate-400">Pick at least one line.</p>
                )}
              </div>

              <button
                type="button"
                data-testid="join-team"
                disabled={nameDraft.trim().length === 0 || lineDraft.length === 0 || claiming !== null}
                onClick={() => { void enter(nameDraft.trim(), lineDraft); }}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
              >
                {claiming !== null ? 'Joining…' : 'Join as this team'}
              </button>

              {room.teams.length > 0 && (
                <p className="text-xs text-slate-400">
                  Already in: {room.teams.map(t => `${t.name} (${t.lines.join('+')})`).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- in, but the pre-game is still running ------------------------------
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
      onDecisionsChange={isViewer ? () => {} : setDecisions}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      lineView={lineView}
      onSelectLineView={setLineView}
      // A viewer passes no advance handler at all, so no button renders.
      onAdvanceYear={isViewer ? undefined : () => { void submit(); }}
      canAdvance={!locked && !submitting && !complete && !processing}
      advanceLabel={
        submitting ? 'Submitting…'
          : locked ? 'Waiting for host'
          : `Lock Year ${room.currentYear}`
      }
      // ⚠ DISABLED, NOT ABSENT. The controls still render the team's settings
      // because that is what the room is discussing.
      decisionsDisabled={isViewer || locked}
      statusStrip={
        <div data-testid="session-strip" className="border-b border-slate-200 bg-white px-4 py-2">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            {isViewer && (
              <span className="flex items-center gap-1.5 font-medium text-slate-500">
                <Eye size={13} /> Watching
              </span>
            )}
            <span
              className="font-medium text-slate-700"
              data-testid={isViewer ? 'watched-team' : 'my-team'}
            >
              {you.teamName}
            </span>
            {/* ⚠ SHOWN, WITH NO CONTROL BESIDE IT. After the join the lines are
                a fact about this team rather than a setting, so the strip states
                them and offers nothing to change. */}
            <span className="text-slate-500" data-testid="my-lines">
              {(you.lines ?? []).join(' + ')}
              <span className="ml-1 text-slate-400">(fixed)</span>
            </span>
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
              <span data-testid={isViewer ? 'viewer-locked' : 'waiting'} className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 size={13} />
                {isViewer ? `Locked in for year ${room.currentYear}` : 'Locked in — waiting for the host'}
              </span>
            ) : (
              <span data-testid={isViewer ? 'viewer-open' : undefined} className="flex items-center gap-1.5 text-slate-500">
                <Clock size={13} /> {isViewer ? `Still deciding year ${room.currentYear}` : 'Open for decisions'}
              </span>
            )}

            {isViewer && (
              <span className="text-slate-400" data-testid="viewer-basis">
                decisions as last locked
              </span>
            )}

            {!complete && outstanding.length > 0 && (
              <span className="text-slate-400">
                still deciding: <span data-testid="outstanding">{outstanding.join(', ')}</span>
              </span>
            )}

            {game.processedYear !== null && (
              <span className="text-slate-400" data-testid="posted-year">
                year {game.processedYear} result {isViewer ? 'computed' : 'posted'}
              </span>
            )}

            {actionError && (
              <span data-testid="submit-error" className="text-red-600">{actionError.message}</span>
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
