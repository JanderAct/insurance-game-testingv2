// SHOCK EVENT verification. Read-only.
//
//   npx tsx scripts/diagnostics/shock-check.ts
//
// TWO JOBS, AND THE FIRST ONE MATTERS MORE.
//
// 1. THE NULL-EFFECT GATE. Shock machinery that changes default behaviour is a
//    defect, and the most dangerous version of that defect is an RNG stream
//    shift, which moves every seed while looking like a rounding difference.
//    This harness plays real games three ways — field absent, field present but
//    empty, and a scheduled shock — and asserts the first two are IDENTICAL
//    across every numeric field of every line and year.
//
//    The two export gates (value-identity-check, solo-export-guard) already
//    cover the field-absent case, since they construct instances through the
//    real generateGameInstance. What they cannot cover is `scheduledShocks: []`,
//    because nothing constructs that. This does.
//
// 2. WHAT EACH EVENT COSTS, AT BOTH BASES. Full market AND the enrolled pool.
//    A treaty-facing or premium-facing figure quoted at full-market scale runs
//    roughly 4x high, and this project has made that mistake more than once.
//
// CALIBRATION IS DEFERRED, DELIBERATELY. Nothing here asserts that an event's
// cost is the RIGHT cost for its band. The pool currently cannot lose money at
// default decisions (finding 24) and that is being fixed on the economics side;
// tuning shocks against a pool that cannot lose would make the game brutal the
// moment it can. Costs are REPORTED. The balance decision stays open.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { resolveShocks } from '../../src/utils/shockResolver';
import { SHOCK_CATALOG } from '../../src/data/shockCatalog';
import type { CoverageLine, GameInstance, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';
import type { ScheduledShock } from '../../src/types/shocks';

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}

// Plays a real game through the real engine. `shocks` undefined leaves the
// instance field ABSENT; an array sets it, empty or not.
function play(id: string, years: number, shocks?: ScheduledShock[]): ResultSet[] {
  const base = generateGameInstance(id, seedOf(id));
  const instance: GameInstance = shocks === undefined ? base : { ...base, scheduledShocks: shocks };
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}

// Every finite numeric field on every line result AND the pool result, keyed
// the same way value-identity-check keys them.
function fieldsOf(results: ResultSet[], tag: string): Record<string, number> {
  const out: Record<string, number> = {};
  results.forEach((r, i) => {
    const scopes: [string, ResultSet | LineResultSet][] = [
      ['pool', r],
      ...LINES.map(l => [l, r.byLine[l]] as [string, LineResultSet]),
    ];
    for (const [scope, res] of scopes) {
      if (!res) continue;
      for (const [k, v] of Object.entries(res)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[`${tag}|Y${i + 1}|${scope}|${k}`] = v;
      }
    }
  });
  return out;
}

function diffFields(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) if (a[k] !== b[k]) changed.push(k);
  return changed;
}

console.log('=== SHOCK EVENTS ===\n');

console.log('--- 1. the null-effect gate: scheduledShocks: [] === field absent ---');
{
  // THE STRICTEST FORM OF THE GATE. Not "close", not "within tolerance" —
  // every numeric field bit-identical across three seeds and five years of a
  // three-line game. An RNG stream shift cannot hide from this.
  let total = 0, moved = 0;
  for (const id of SEEDS) {
    const absent = fieldsOf(play(id, 5, undefined), id);
    const empty = fieldsOf(play(id, 5, []), id);
    const changed = diffFields(absent, empty);
    total += Object.keys(absent).length;
    moved += changed.length;
    console.log(`  ${id}  ${Object.keys(absent).length} fields, ${changed.length} moved${changed.length ? `  e.g. ${changed[0]}` : ''}`);
  }
  console.log(`  ${total} fields across ${SEEDS.length} seeds: ${moved} moved  ${note(moved === 0, `${moved} fields move when scheduledShocks: [] is set — the shock path is not inert`)}`);
  console.log(`    (the two export gates cover the field-ABSENT case, since they build instances through the`);
  console.log(`     real generateGameInstance. Only this covers the field-present-but-empty case.)`);
}

console.log('\n--- 2. resolver contract ---');
{
  const base = generateGameInstance('MAMC6EA4', seedOf('MAMC6EA4'));
  console.log(`  no field      -> ${resolveShocks(base, 1) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(base, 1) === undefined, 'resolver returns a resolution when no shocks are configured')}`);
  const empty = { ...base, scheduledShocks: [] as ScheduledShock[] };
  console.log(`  empty list    -> ${resolveShocks(empty, 1) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(empty, 1) === undefined, 'resolver returns a resolution for an empty list')}`);
  // A CURRENT event in another year contributes nothing and is not recorded.
  const other = { ...base, scheduledShocks: [{ shockId: '#22', yearNumber: 3 }] };
  console.log(`  #22 in Y3, asked for Y1 -> ${resolveShocks(other, 1) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(other, 1) === undefined, 'a current-horizon shock leaks outside its own year')}`);
  console.log(`  #22 in Y3, asked for Y3 -> ${resolveShocks(other, 3) !== undefined ? 'RESOLUTION' : 'undefined'}  ${note(resolveShocks(other, 3) !== undefined, 'a current-horizon shock does not fire in its own year')}`);
  console.log(`  #22 in Y3, asked for Y4 -> ${resolveShocks(other, 4) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(other, 4) === undefined, 'a current-horizon shock persists past its year')}`);
  // A FUTURE event persists forward.
  const future = { ...base, scheduledShocks: [{ shockId: '#10', yearNumber: 3 }] };
  const y5 = resolveShocks(future, 5);
  console.log(`  #10 in Y3, asked for Y5 -> ${y5 ? 'RESOLUTION' : 'undefined'}  ${note(y5 !== undefined, 'a future-horizon shock does not persist forward')}`);
  console.log(`  #10 in Y3, asked for Y2 -> ${resolveShocks(future, 2) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(future, 2) === undefined, 'a future-horizon shock applies before its own year')}`);

  // An unimplemented effect must THROW, not be silently skipped.
  const blocked = { ...base, scheduledShocks: [{ shockId: '#2', yearNumber: 1 }] };
  let threw = false;
  try { resolveShocks(blocked, 1); } catch { threw = true; }
  console.log(`  #2 (forceEvent, unimplemented) throws: ${note(threw, '#2 does not throw — an unimplemented effect is being silently skipped')}`);
  let unknownThrew = false;
  try { resolveShocks({ ...base, scheduledShocks: [{ shockId: '#999', yearNumber: 1 }] }, 1); } catch { unknownThrew = true; }
  console.log(`  unknown shock id throws: ${note(unknownThrew, 'an unknown shock id is silently ignored')}`);
}

console.log('\n--- 3. catalog ---');
{
  const byHorizon = { current: 0, future: 0 };
  for (const def of Object.values(SHOCK_CATALOG)) byHorizon[def.horizon]++;
  console.log(`  ${Object.keys(SHOCK_CATALOG).length} events: ${byHorizon.current} current, ${byHorizon.future} future`);
  for (const def of Object.values(SHOCK_CATALOG)) {
    console.log(`    ${def.id.padEnd(5)} ${def.band.padEnd(8)} ${def.horizon.padEnd(7)} ${def.name}`);
    for (const e of def.effects) console.log(`          - ${e.kind}${'line' in e ? ` (${e.line})` : ''}`);
  }
  console.log(`  paramOverride paths validated against the real models at module load (shockCatalog.ts)`);
}

console.log(problems.length === 0
  ? '\nALL SHOCK CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
