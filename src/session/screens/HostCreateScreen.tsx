// ============================================================================
// THE GAME SETUP TAB — what the host sets, and only what the host sets.
//
// ⚠ WHAT THE HOST OWNS HAS NARROWED TO WHAT NOTHING ELSE CAN SET: the seed, the
// year count, the starting year and the shock schedule. Those are properties of
// the EVENT and every team must share them or the session is not one session.
//
// ⚠ COVERAGE LINES CAME OFF, AND THE MENU WENT WITH THEM. All three are
// available in every room; each team picks its own at join. The host constrained
// nothing with that control — a "menu" that always listed everything was a
// setting that could only be used to take something away, and nobody wanted to.
//
// ⚠ THE TEAM LIST IS A COUNT, NOT NAMES, AND NOT A NUMBERED PLACEHOLDER LIST.
// Players name their own teams, so host-typed names were dead. A numbered list
// ("Team 1", "Team 2") would have been the pre-registered roster wearing a
// different hat: it implies the host reserved a slot that a player then fills,
// and the table would inherit rows describing teams that do not exist. A plain
// count claims only what the host actually knows before the room opens — how
// many to expect — and it BINDS NOTHING (see the transport).
// ============================================================================

import { useState } from 'react';
import { Trash2, Zap } from 'lucide-react';
import { SHOCK_CATALOG } from '../../data/shockCatalog';
import { IMPLEMENTED_EFFECTS } from '../../types/shocks';
import { sessionTransport, isSessionError, type ScheduledShockSpec, type SessionError } from '../index';
import { rememberHostToken, saveActive } from '../client/identity';
import { navigate } from '../client/navigation';

// A shock whose effects the generators cannot execute throws inside the
// resolver rather than quietly doing nothing (see shockResolver.ts). Offering it
// in a dropdown would let a host schedule a room that breaks on the year it
// fires, so the unbuildable ones are listed and disabled with the reason shown.
const SCHEDULABLE = Object.values(SHOCK_CATALOG).map(def => ({
  id: def.id,
  name: def.name,
  buildable: def.effects.every(e => IMPLEMENTED_EFFECTS.has(e.kind)),
}));

function randomSeed(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default function HostCreateScreen() {
  const [eventName, setEventName] = useState('Ripple Game');
  const [seed, setSeed] = useState(() => randomSeed());
  const [yearCount, setYearCount] = useState(5);
  const [startingYear, setStartingYear] = useState(2026);
  const [expectedTeams, setExpectedTeams] = useState(3);
  const [shocks, setShocks] = useState<ScheduledShockSpec[]>([]);
  const [shockId, setShockId] = useState(SCHEDULABLE.find(s => s.buildable)?.id ?? '');
  const [shockYear, setShockYear] = useState(2);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);

  const canCreate = yearCount >= 1 && expectedTeams >= 1 && !busy;

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await sessionTransport().createRoom({
        seed: seed.trim() || randomSeed(),
        yearCount,
        startingYear,
        eventName: eventName.trim() || 'Ripple Game',
        expectedTeams,
        shocks,
      });
      // ⚠ PERSIST THE HOST TOKEN BEFORE NAVIGATING. The room exists the moment
      // createRoom resolves; a navigation that happened first and then failed to
      // store would leave a live room nobody can drive.
      saveActive(res.code, { hostToken: res.hostToken });
      rememberHostToken(res.code, res.hostToken);
      navigate(`/host/${res.code}`);
    } catch (e) {
      setError(isSessionError(e) ? e : null);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="w-full">
        <p className="text-sm text-slate-500">
          Every team plays the same instance. Teams name themselves and choose their own lines when they join.
        </p>

        {error && (
          <div data-testid="create-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.message}
          </div>
        )}

        <div className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Event</span>
              <input
                data-testid="event-name"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={eventName}
                onChange={e => setEventName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Seed</span>
              <input
                data-testid="seed"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                value={seed}
                onChange={e => setSeed(e.target.value.toUpperCase())}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Years</span>
              <input
                data-testid="year-count"
                type="number" min={1} max={20}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={yearCount}
                onChange={e => setYearCount(Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Starting year</span>
              <input
                type="number" min={2000} max={2100}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={startingYear}
                onChange={e => setStartingYear(Number(e.target.value))}
              />
            </label>
          </div>

          <div>
            <label className="block max-w-[220px]">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Teams expected</span>
              <input
                data-testid="expected-teams"
                type="number" min={1} max={40}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={expectedTeams}
                onChange={e => setExpectedTeams(Number(e.target.value))}
              />
            </label>
            {/* ⚠ SAID ON SCREEN BECAUSE A NUMBER FIELD LOOKS LIKE A LIMIT. It is
                not one: the room does not turn anyone away, and the count exists
                so the host knows when everybody has arrived. */}
            <p className="mt-1.5 text-xs text-slate-400">
              How many to expect, so you know when everyone has arrived. It does not limit who can join, and
              teams name themselves and pick their own coverage lines at join.
            </p>
          </div>

          {/* ---- shocks ---- */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Shock schedule</span>
            <p className="mt-1 text-xs text-slate-400">
              Read as a list, never drawn. The same schedule reaches every team.
            </p>
            <div className="mt-2 flex gap-2">
              <select
                data-testid="shock-id"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={shockId}
                onChange={e => setShockId(e.target.value)}
              >
                {SCHEDULABLE.map(s => (
                  <option key={s.id} value={s.id} disabled={!s.buildable}>
                    {s.id} — {s.name}{s.buildable ? '' : ' (not implemented)'}
                  </option>
                ))}
              </select>
              <input
                data-testid="shock-year"
                type="number" min={1} max={yearCount}
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={shockYear}
                onChange={e => setShockYear(Number(e.target.value))}
              />
              <button
                type="button"
                data-testid="add-shock"
                onClick={() => setShocks(prev => [...prev, { shockId, yearNumber: shockYear }])}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
              >
                Add
              </button>
            </div>
            {shocks.length > 0 && (
              <ul data-testid="shock-list" className="mt-2 space-y-1">
                {shocks.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-slate-600">
                    <Zap size={13} className="text-amber-500" />
                    <span className="font-mono">{s.shockId}</span>
                    <span className="text-slate-400">year {s.yearNumber}</span>
                    <button
                      type="button"
                      onClick={() => setShocks(prev => prev.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Remove shock ${i + 1}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            data-testid="create-room"
            disabled={!canCreate}
            onClick={() => { void handleCreate(); }}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
          >
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </div>
    </>
  );
}
