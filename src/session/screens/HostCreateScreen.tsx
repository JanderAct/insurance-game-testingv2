// ============================================================================
// /host — CREATE A ROOM.
//
// Setup writes the four things a room is: seed, year count, shock list and the
// team list. It is the solo game's Game Setup plus a roster.
//
// ⚠ THE HOST SETS A MENU, NOT A SEATING PLAN. Coverage lines here are what this
// room OFFERS; each team chooses its own subset when it joins, and that choice
// plus its name is the team's own game setup. The room therefore opens with no
// teams at all and the host's table fills as they arrive.
//
// ⚠ THE PRE-REGISTERED ROSTER THAT STOOD HERE IS GONE, and the argument that put
// it there is worth recording because it was not wrong — a fixed roster makes
// the host's table a checklist against a list the host wrote, and it rules out
// two teams a character apart. What outweighs it: a team's name and its lines
// are one act of setup performed once, by the team, and splitting them so the
// host owns one half and the team the other made the name the only thing a team
// could not decide about its own game. Name collisions are refused at the
// transport instead (TEAM_TAKEN), which costs a retry rather than a design.
// ============================================================================

import { useState } from 'react';
import { Trash2, Zap } from 'lucide-react';
import type { CoverageLine } from '../../types/simulation';
import { SHOCK_CATALOG } from '../../data/shockCatalog';
import { IMPLEMENTED_EFFECTS } from '../../types/shocks';
import { sessionTransport, isSessionError, type ScheduledShockSpec, type SessionError } from '../index';
import { rememberHostToken, saveActive } from '../client/identity';
import { navigate } from '../client/navigation';

const COVERAGE_LINES: { value: CoverageLine; label: string }[] = [
  { value: 'WC', label: "Workers' Compensation" },
  { value: 'GL', label: 'General Liability' },
  { value: 'Property', label: 'Property' },
];

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
  const [poolName, setPoolName] = useState('Clearwater Public Entity Pool');
  const [seed, setSeed] = useState(() => randomSeed());
  const [yearCount, setYearCount] = useState(5);
  const [startingYear, setStartingYear] = useState(2026);
  const [availableLines, setAvailableLines] = useState<CoverageLine[]>(['WC', 'GL', 'Property']);
  const [shocks, setShocks] = useState<ScheduledShockSpec[]>([]);
  const [shockId, setShockId] = useState(SCHEDULABLE.find(s => s.buildable)?.id ?? '');
  const [shockYear, setShockYear] = useState(2);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);

  const canCreate = availableLines.length > 0 && yearCount >= 1 && !busy;

  function toggleLine(line: CoverageLine) {
    setAvailableLines(prev => prev.includes(line) ? prev.filter(l => l !== line) : [...prev, line]);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await sessionTransport().createRoom({
        seed: seed.trim() || randomSeed(),
        yearCount,
        startingYear,
        poolName: poolName.trim() || 'Pool',
        availableLines: COVERAGE_LINES.map(l => l.value).filter(l => availableLines.includes(l)),
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
      <div className="mx-auto w-full max-w-[720px]">
        <h1 className="text-2xl font-semibold text-slate-800">Host a session</h1>
        <p className="mt-1 text-sm text-slate-500">
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
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Pool name</span>
              <input
                data-testid="pool-name"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={poolName}
                onChange={e => setPoolName(e.target.value)}
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
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage lines available</span>
            <p className="mt-1 text-xs text-slate-400">
              What teams may choose from. Each team picks its own subset at join, and teams in one room may play different books.
            </p>
            <div className="mt-2 flex gap-2">
              {COVERAGE_LINES.map(l => (
                <button
                  key={l.value}
                  type="button"
                  data-testid={`line-${l.value}`}
                  onClick={() => toggleLine(l.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    availableLines.includes(l.value)
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-300 text-slate-600'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {availableLines.length === 0 && (
              <p className="mt-2 text-xs text-red-600">A room must offer at least one line.</p>
            )}
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
    </div>
  );
}
