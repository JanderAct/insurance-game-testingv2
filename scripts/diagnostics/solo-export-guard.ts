// Byte-identity guard across engine commits.
//
// Plays full 5-year games in four line configurations (WC-solo, GL-solo,
// Property-solo, and all three together) across three seeds, exports each
// through the real results workbook, and SHA-256s the PARSED CELL DATA rather
// than the .xlsx wrapper — the wrapper carries timestamps and zip ordering
// that change without the numbers changing, so hashing it would be noise.
//
// Purpose: when a change is supposed to touch only one line, the other lines'
// solo hashes must not move. That is the strongest available proof a
// restructure did not leak into the math (see docs/WORKING_PRACTICES.md,
// "Baseline-neutrality is the strongest test for a structural change").
//
//   npx tsx scripts/diagnostics/solo-export-guard.ts            # compare to baseline
//   npx tsx scripts/diagnostics/solo-export-guard.ts --write    # re-capture baseline
//
// Baseline: baselines/SOLO_EXPORT_GUARD_v3.json, captured at roster v3 after
// the WC and GL recalibration. Baselines are RETIRED at every roster version —
// v2 moved payroll, TIV and Region; v3 decorrelated risk quality from member
// type, raised TIV to $6,993.3M and added the Locations / Primary Asset Share
// columns. Every line's numbers legitimately changed, so no pre-v3 hash can
// ever match again. Property moves too, even though its CODE is untouched,
// because its exposure base IS the TIV column.
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { buildResultsWorkbook } from '../../src/utils/resultsExport';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import type { GameState, CoverageLine, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(__dirname, '../../baselines/SOLO_EXPORT_GUARD_v3.json');

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function play(id: string, lines: CoverageLine[], years: number): ResultSet[] {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}

const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

const out: Record<string, string> = {};
for (const id of SEEDS) {
  for (const { lines, name } of CONFIGS) {
    const wb = buildResultsWorkbook(play(id, lines, 5), lines, RESULT_METRICS);
    const csv = wb.SheetNames.map(s => XLSX.utils.sheet_to_csv(wb.Sheets[s])).join('\n#SHEET#\n');
    out[`${id}|${name}`] = sha(Buffer.from(csv, 'utf8'));
  }
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
  console.log(`Captured ${Object.keys(out).length} hashes -> ${BASELINE}`);
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(22)} ${v.slice(0, 16)}`);
} else {
  const base: Record<string, string> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let diffs = 0;
  for (const k of Object.keys(out)) {
    const match = base[k] === out[k];
    if (!match) diffs++;
    console.log(`  ${k.padEnd(22)} ${match ? 'MATCH' : `DIFF  baseline ${String(base[k]).slice(0, 12)} != now ${out[k].slice(0, 12)}`}`);
  }
  console.log(diffs === 0
    ? `\nALL ${Object.keys(out).length} EXPORTS BYTE-IDENTICAL TO BASELINE.`
    : `\n${diffs} EXPORT(S) CHANGED — intended? If yes, re-run with --write.`);
  process.exitCode = diffs === 0 ? 0 : 1;
}
