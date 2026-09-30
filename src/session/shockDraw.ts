// ============================================================================
// THE HOST'S RANDOMISED SHOCK SCHEDULE — drawn ONCE, at room creation, by the
// host's client, and written into the room as concrete entries.
//
// ⚠ THIS IS THE ONE PLACE A SHOCK SCHEDULE IS EVER DRAWN, AND WHERE IT IS
// CALLED FROM IS THE WHOLE RULE. HostCreateScreen calls it; nothing else may.
// Not a player's client, not the engine, not per year. The room record carries
// the result as a plain list and every team's build reads THAT list
// (buildGame.ts -> generateGameInstance), so every team faces the same
// schedule because they all read the same record — not because they all ran the
// same draw. A draw anywhere downstream of the room would make agreement a
// matter of every client computing identically, which is the property this
// design exists not to depend on.
//
// ⚠ AND IT IS STILL REPRODUCIBLE. The draw is a pure function of the room's
// seed and year count, both of which the room record holds, so the schedule a
// room carries can be re-derived from the record alone and checked against it.
// It is keyed on its own purpose label, so it shares no stream with the game:
// the seed that builds the instance also seeds this, without either moving the
// other.
// ============================================================================

import type { ShockBand, ShockDefinition } from '../types/shocks';
import { IMPLEMENTED_EFFECTS } from '../types/shocks';
import { SHOCK_CATALOG } from '../data/shockCatalog';
import { deriveSubRng } from '../utils/random';
import { seedFromInstanceId } from '../seedHash';
import type { ScheduledShockSpec } from './contract';

// ⚠ WEIGHTED TOWARD THE MILDER BANDS, so a severe event is the rarer draw — the
// same ordering the matrix's severity grades express. 3 : 2 : 1.
export const SHOCK_DRAW_WEIGHT: Record<ShockBand, number> = { moderate: 3, high: 2, severe: 1 };

// Every event that can actually run, in a FIXED order (by id) so the draw does
// not depend on how the catalog object happens to be ordered.
export function drawableShocks(): ShockDefinition[] {
  return Object.values(SHOCK_CATALOG)
    .filter(def => def.effects.every(e => IMPLEMENTED_EFFECTS.has(e.kind)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ONE EVENT PER THREE YEARS, rounded, and never none: 3 years -> 1, 5 -> 2,
// 10 -> 3, 20 -> 7. A randomise that could return an empty schedule would read
// to a host as a button that did nothing.
export function shockDrawCount(yearCount: number): number {
  return yearCount >= 1 ? Math.max(1, Math.round(yearCount / 3)) : 0;
}

export function drawShockSchedule(roomSeed: string, yearCount: number): ScheduledShockSpec[] {
  const rng = deriveSubRng(seedFromInstanceId(roomSeed), yearCount, 'host_shock_schedule');

  // YEARS: distinct — at most one event per year, the rule in docs/PHASES.md —
  // and never year 1 when the game has another, so every team makes one full
  // round of decisions before anything lands on it.
  const years = yearCount >= 2
    ? Array.from({ length: yearCount - 1 }, (_, i) => i + 2)
    : yearCount === 1 ? [1] : [];
  const events = drawableShocks();
  const count = Math.min(shockDrawCount(yearCount), years.length, events.length);

  // Partial Fisher-Yates on the years.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng.next() * (years.length - i));
    [years[i], years[j]] = [years[j], years[i]];
  }
  const chosenYears = years.slice(0, count).sort((a, b) => a - b);

  // EVENTS: weighted by band, WITHOUT replacement — no event twice in one
  // schedule. A repeat of the same named event inside a short game reads as a
  // bug to a room, and with eight drawable events and at most seven draws (a
  // 20-year game) there is always a fresh one to take.
  const pool = events.map(def => ({ def, w: SHOCK_DRAW_WEIGHT[def.band] }));
  const chosen: ShockDefinition[] = [];
  for (let i = 0; i < count; i++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let u = rng.next() * total;
    let k = 0;
    for (; k < pool.length - 1; k++) { u -= pool[k].w; if (u < 0) break; }
    chosen.push(pool[k].def);
    pool.splice(k, 1);
  }

  return chosenYears.map((yearNumber, i) => ({ shockId: chosen[i].id, yearNumber }));
}
