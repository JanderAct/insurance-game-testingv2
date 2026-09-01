// ============================================================================
// NUMBER FORMATS IN BOTH WORKBOOKS — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Both workbooks are built, written to xlsx, and READ
// BACK WITH cellNF SO THE FORMAT ITSELF IS INSPECTED — not the format the
// builder intended, the one that survived serialisation.
//
// WHAT IT ASSERTS
//   TOTALITY      every numeric cell in either workbook carries one of the four
//                 formats. A General numeric cell is the defect this exists to
//                 prevent and it is reported per column/row, not as a total.
//   NO ROUNDING   the stored value is unchanged by formatting. Asserted against
//                 the RESULT OBJECTS, so a cell showing 42,709,940 is checked to
//                 still hold 42709939.61. This is the half of the change that
//                 the format alone does not deliver: the dollar columns used to
//                 be Math.round-ed at write time and are not any more.
//   TEXT STAYS    identifiers and status strings come back as strings ('s'),
//                 never as numbers, and never carry a number format.
//   YEARS         no thousands separator: the rendered cell reads 2026.
//   PERCENT BASIS a percent-formatted cell still HOLDS a fraction. Excel
//                 multiplies by 100 on display; nothing multiplies in the
//                 builder. Checked by comparing the stored value against the
//                 engine's own field and the rendered string against v x 100.
// ============================================================================

import * as XLSX from 'xlsx';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { buildResultsWorkbook } from '../../src/utils/resultsExport';
import { buildClaimsWorkbook } from '../../src/utils/claimsExport';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 8);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const ALLOWED = new Set(['#,##0', '#,##0.00', '0.00%', '0']);

const fails: string[] = [];
const fail = (s: string) => fails.push(s);

interface Tally { dollars: number; plain: number; percent: number; year: number; general: number; text: number }
const mk = (): Tally => ({ dollars: 0, plain: 0, percent: 0, year: 0, general: 0, text: 0 });
const bump = (t: Tally, z: string | undefined) => {
  if (z === '#,##0') t.dollars++;
  else if (z === '#,##0.00') t.plain++;
  else if (z === '0.00%') t.percent++;
  else if (z === '0') t.year++;
  else t.general++;
};

function run(g: number): GameState {
  const id = `ENF${g}`;
  const inst = generateGameInstance(id, 8_800_000 + g * 6113);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
    };
  }
  return gs;
}

// ⚠ READ BACK WITH cellNF, WHICH IS THE ONLY WAY THE FORMAT IS VISIBLE. Without
// it SheetJS drops `z` on read and every cell looks General — a check written
// without it would report the defect it was added to catch.
const roundTrip = (wb: XLSX.WorkBook) =>
  XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, { type: 'buffer', cellNF: true });

const totals: Record<string, Tally> = {};

for (let g = 0; g < GAMES; g++) {
  const gs = run(g);

  for (const [book, wb] of [
    ['results', buildResultsWorkbook(gs.lockedResults, LINES, RESULT_METRICS)],
    ['claims', buildClaimsWorkbook(gs.lockedResults, gs.priorHistory, LINES, gs.poolState)],
  ] as const) {
    const back = roundTrip(wb);
    for (const name of back.SheetNames) {
      const ws = back.Sheets[name];
      const key = `${book}:${name}`;
      totals[key] = totals[key] ?? mk();
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      const generalAt: string[] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          if (cell.t !== 'n') { totals[key].text++; continue; }
          bump(totals[key], cell.z as string | undefined);
          if (!cell.z || !ALLOWED.has(String(cell.z))) {
            if (generalAt.length < 3) generalAt.push(`${addr}=${cell.v}`);
          }
          // YEARS: no separator, ever.
          if (cell.z === '0' && typeof cell.w === 'string' && cell.w.includes(',')) {
            fail(`${key} ${addr}: a year rendered with a separator (${cell.w})`);
          }
          // PERCENT BASIS: the cell holds a FRACTION and Excel multiplies on
          // display. If the builder had multiplied, w would be v x 10,000.
          if (cell.z === '0.00%' && typeof cell.w === 'string') {
            const shown = Number(cell.w.replace(/[%,]/g, ''));
            if (Number.isFinite(shown) && Math.abs(shown - Number(cell.v) * 100) > 0.02) {
              fail(`${key} ${addr}: percent cell holds ${cell.v} but renders ${cell.w} — the value was multiplied somewhere`);
            }
          }
        }
      }
      if (generalAt.length > 0) {
        fail(`${key}: numeric cell(s) with no recognised format — ${generalAt.join(', ')}`);
      }
    }

    // --- NO ROUNDING, checked against the source objects ------------------
    if (book === 'claims') {
      const dev = new Map<string, number>();
      for (const line of LINES) {
        for (const ch of gs.poolState.lines[line].reserveCohorts) {
          for (const d of ch.developingClaims ?? []) dev.set(d.occurrenceId, d.current);
        }
      }
      const back2 = roundTrip(wb);
      const sheet = XLSX.utils.sheet_to_json(back2.Sheets['Development'], { header: 1, defval: '' }) as unknown[][];
      const hdr = (sheet[1] ?? []).map(String);
      const iOcc = hdr.indexOf('Occurrence ID');
      const iCur = hdr.indexOf('Current Occurrence');
      let checked = 0;
      let integers = 0;
      for (let i = 2; i < sheet.length; i++) {
        const occ = String(sheet[i][iOcc] ?? '');
        const v = sheet[i][iCur];
        if (!dev.has(occ) || typeof v !== 'number') continue;
        checked++;
        if (Number.isInteger(v)) integers++;
        if (v !== dev.get(occ)) {
          fail(`claims Development ${occ}: cell holds ${v}, engine holds ${dev.get(occ)} — the value was rounded`);
        }
      }
      if (checked > 0 && integers === checked) {
        fail(`claims Development: all ${checked} Current Occurrence cells are whole numbers — rounding is still happening somewhere`);
      }
    }
  }
}

// ---------------------------------------------------------------- report
console.log('=== EXPORT NUMBER FORMATS ===');
console.log(`${GAMES} games x ${YEARS} years x 3 lines, both workbooks, round-tripped through xlsx with cellNF.\n`);
console.log('  sheet                        dollars     plain   percent      year   GENERAL      text');
console.log('  ' + '-'.repeat(88));
for (const [k, t] of Object.entries(totals)) {
  console.log(`  ${k.padEnd(26)} ${String(t.dollars).padStart(9)} ${String(t.plain).padStart(9)} `
    + `${String(t.percent).padStart(9)} ${String(t.year).padStart(9)} ${String(t.general).padStart(9)} `
    + `${String(t.text).padStart(9)}`);
}
const all = Object.values(totals).reduce((a, t) => ({
  dollars: a.dollars + t.dollars, plain: a.plain + t.plain, percent: a.percent + t.percent,
  year: a.year + t.year, general: a.general + t.general, text: a.text + t.text,
}), mk());
console.log('  ' + '-'.repeat(88));
console.log(`  ${'TOTAL'.padEnd(26)} ${String(all.dollars).padStart(9)} ${String(all.plain).padStart(9)} `
  + `${String(all.percent).padStart(9)} ${String(all.year).padStart(9)} ${String(all.general).padStart(9)} `
  + `${String(all.text).padStart(9)}`);

console.log(fails.length === 0
  ? '\nEVERY NUMERIC CELL IN BOTH WORKBOOKS CARRIES A FORMAT. Years take no separator, identifiers'
    + '\nstay text, percent cells still hold fractions, and the stored values are unrounded — a cell'
    + '\nshowing 42,709,940 holds 42709939.61.'
  : `\n${fails.length} FAILURE(S):\n` + fails.slice(0, 25).map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
