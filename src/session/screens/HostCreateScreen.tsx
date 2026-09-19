// ============================================================================
// /host — CREATE A ROOM.
//
// Setup writes the four things a room is: seed, year count, shock list and the
// team list. It is the solo game's Game Setup plus a roster.
//
// ⚠ THE TEAM LIST IS PRE-REGISTERED, AND THAT IS THE POINT. The host types the
// names and players PICK FROM THEM. A room where players invent their own names
// has a roster the host cannot read at a glance, two teams one character apart,
// and no way to tell "nobody has joined as Cedar Valley yet" from "Cedar Valley
// is here under a name I do not recognise". Fixing the roster at creation makes
// the host's table a checklist against a list the host wrote.
// ============================================================================

import { useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
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
  const [activeLines, setActiveLines] = useState<CoverageLine[]>(['WC']);
  const [teamNames, setTeamNames] = useState<string[]>(['Harbour Mutual', 'Cedar Valley', 'Tri-County']);
  const [shocks, setShocks] = useState<ScheduledShockSpec[]>([]);
  const [shockId, setShockId] = useState(SCHEDULABLE.find(s => s.buildable)?.id ?? '');
  const [shockYear, setShockYear] = useState(2);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);

  const trimmed = teamNames.map(n => n.trim()).filter(n => n.length > 0);
  const duplicate = new Set(trimmed).size !== trimmed.length;
  const canCreate = trimmed.length > 0 && !duplicate && activeLines.length > 0 && yearCount >= 1 && !busy;

  function toggleLine(line: CoverageLine) {
    setActiveLines(prev => prev.includes(line) ? prev.filter(l => l !== line) : [...prev, line]);
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
        activeLines: COVERAGE_LINES.map(l => l.value).filter(l => activeLines.includes(l)),
        teamNames: trimmed,
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
          Every team plays the same instance. The seed and the shock schedule are fixed here, once.
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
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage lines</span>
            <div className="mt-2 flex gap-2">
              {COVERAGE_LINES.map(l => (
                <button
                  key={l.value}
                  type="button"
                  data-testid={`line-${l.value}`}
                  onClick={() => toggleLine(l.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    activeLines.includes(l.value)
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-300 text-slate-600'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* ---- teams ---- */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Teams</span>
              <button
                type="button"
                data-testid="add-team"
                onClick={() => setTeamNames(prev => [...prev, ''])}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                <Plus size={14} /> Add team
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {teamNames.map((name, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    data-testid={`team-name-${i}`}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder={`Team ${i + 1}`}
                    value={name}
                    onChange={e => setTeamNames(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                  />
                  <button
                    type="button"
                    aria-label={`Remove team ${i + 1}`}
                    onClick={() => setTeamNames(prev => prev.filter((_, j) => j !== i))}
                    className="rounded-lg border border-slate-200 px-2 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            {duplicate && (
              <p className="mt-2 text-xs text-red-600">Team names must be distinct — players pick from this list.</p>
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
