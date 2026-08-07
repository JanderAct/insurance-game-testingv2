// VALUE-IDENTITY CHECK — did any simulated VALUE move?
//
//   npx tsx scripts/diagnostics/value-identity-check.ts            # compare
//   npx tsx scripts/diagnostics/value-identity-check.ts --write    # re-capture
//
// ============================================================================
// THE DIVISION OF LABOUR — read before "improving" either gate.
//
// There are TWO export guards and they answer DIFFERENT questions. Neither
// subsumes the other, and collapsing them is the mistake this comment exists
// to prevent.
//
//   THIS SCRIPT (value identity)      solo-export-guard.ts (shape identity)
//   -----------------------------     ------------------------------------
//   "did any VALUE move?"             "did the export SHAPE change?"
//   keyed by FIELD NAME               SHA-256 of the exported CSV
//   order-independent                 order-sensitive
//   label-independent                 label-sensitive
//   new fields are reported,          any new row, renamed label or
//     NOT a failure                     reordering turns it red
//
// A DISPLAY-LAYER FIX should be GREEN here and RED on the hash guard: it
// corrects what is shown without touching what is computed.
// AN ENGINE REGRESSION should be RED here — that is the signal that matters.
//
// This distinction is not theoretical. The expected-combined-ratio fix
// corrected two exported metric values, added one metric and renamed six
// labels. The hash guard went red on all 12 exports, which by its construction
// it HAD to, and that told us nothing about whether the engine had moved.
// This check answered it in one run: 14,400 numeric fields bit-identical, with
// movement confined to the two metrics the fix targeted plus the one it added.
//
// So: THIS is the primary gate for display-layer work. The hash guard is the
// shape check — still valuable, because an unintended column reorder or a
// dropped row is invisible here. Do NOT "fix" a red hash guard by re-hashing
// without first confirming this check is green, and do NOT delete the hash
// guard because this one is stricter about values. They are complementary.
// ============================================================================
//
// Coverage matches the hash guard exactly — same 3 seeds x 4 line
// configurations x 5 years — so the two are directly comparable. Every finite
// numeric field on every line result AND on the pool result is captured, which
// is roughly 14,850 values.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, '../../baselines/VALUE_IDENTITY_v4.json');

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}

const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

const out: Record<string, number> = {};
for (const id of SEEDS) {
  for (const { lines, name } of CONFIGS) {
    const instance = generateGameInstance(id, seedOf(id));
    const setup = { poolName: 'G', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: lines };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= 5; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const scopes: [string, ResultSet | LineResultSet][] = [
        ['pool', p.result],
        ...lines.map(l => [l, p.result.byLine[l]] as [string, LineResultSet]),
      ];
      for (const [scope, r] of scopes) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'number' && Number.isFinite(v)) out[`${id}|${name}|Y${y}|${scope}|${k}`] = v;
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 0) + '\n');
  console.log(`Captured ${Object.keys(out).length} numeric fields -> ${BASELINE}`);
  process.exit(0);
}

const base: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const baseKeys = new Set(Object.keys(base));
const nowKeys = new Set(Object.keys(out));
const added = [...nowKeys].filter(k => !baseKeys.has(k));
const removed = [...baseKeys].filter(k => !nowKeys.has(k));
const changed = [...nowKeys].filter(k => baseKeys.has(k) && base[k] !== out[k]);

const fieldNames = (keys: string[]) => [...new Set(keys.map(k => k.split('|').pop()!))].sort();

console.log(`fields: baseline ${baseKeys.size}, now ${nowKeys.size}`);
console.log(`\nSHAPE (informational — new or dropped fields are not a value change):`);
console.log(`  added   ${added.length}${added.length ? `  fields: ${fieldNames(added).join(', ')}` : ''}`);
console.log(`  removed ${removed.length}${removed.length ? `  fields: ${fieldNames(removed).join(', ')}` : ''}`);

console.log(`\nVALUES — THE GATE:`);
if (changed.length === 0) {
  console.log(`  0 changed. Every field present in both is bit-identical.`);
} else {
  const byField = new Map<string, string[]>();
  for (const k of changed) {
    const f = k.split('|').pop()!;
    if (!byField.has(f)) byField.set(f, []);
    byField.get(f)!.push(k);
  }
  console.log(`  ${changed.length} changed across ${byField.size} field(s):`);
  for (const [f, keys] of [...byField.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const ex = keys[0];
    console.log(`    ${f.padEnd(34)} ${String(keys.length).padStart(4)} instances   e.g. ${base[ex]} -> ${out[ex]}`);
  }
}

if (changed.length === 0) {
  console.log(`\nVALUE IDENTITY HOLDS${added.length || removed.length ? ' (shape changed — expected for a display-layer fix)' : ''}.`);
} else {
  console.log(`\nVALUES MOVED — if this was meant to be a display-only change, it was not one.`);
}
process.exitCode = changed.length === 0 ? 0 : 1;
