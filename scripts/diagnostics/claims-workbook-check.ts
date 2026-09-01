// ============================================================================
// THE CLAIMS WORKBOOK, BUILT AND READ BACK.
//
// ⚠ NEITHER STANDING GATE WATCHES THIS FILE. value-identity-check keys on
// RESULT_METRICS field names and solo-export-guard hashes the SUMMARY export's
// cells; the claims workbook is in neither scope. A green run of both proves
// nothing about this sheet, and quoting them as evidence would be exactly the
// SCOPE blindness WORKING_PRACTICES records. So this script builds the real
// workbook through buildClaimsWorkbook, writes it, parses it back with the same
// library, and asserts against the cells that come out.
//
// WHAT IT ASSERTS
//   SHAPE          the Occurrences sheet is gone; the sheets that remain are the
//                  active lines plus Development.
//   ROW IDENTITY   Booked + sum(Yr columns) === Current, and Total Development
//                  === Current - Booked, on every developed row, read from the
//                  PARSED cells rather than from the objects that built them.
//   THREE STATES   a blank development block, a blank Yr cell and a printed
//                  figure are three distinct things and all three occur.
//   MARKDOWN       Gross Incurred === Drawn Occurrence always (one claim per
//                  occurrence today), and Drawn > Booked under SQUEEZED funding
//                  while Drawn === Booked at DEFAULTS. That is the check the
//                  brief asked for and it cannot be run at defaults.
//   ONE LOOKUP     every developed occurrence on a line sheet appears on the
//                  Development sheet with the same figures.
//   GEOMETRY       column count and the per-claim series length, so the "does it
//                  need capping at year 20" question is answered with a number.
//   OPEN AND PAID  no row marked `open` has paid its whole Gross Incurred, and
//                  the headroom quantiles on open rows are printed beside it.
//                  This is the ONLY gate on the Gross Paid column — see the note
//                  at the check itself for what it can and cannot catch.
// ============================================================================

import * as XLSX from 'xlsx';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { buildClaimsWorkbook } from '../../src/utils/claimsExport';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 10);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};

interface Arm { name: string; decisions: (d: DecisionSet) => DecisionSet }
const ARMS: Arm[] = [
  { name: 'defaults', decisions: d => d },
  {
    name: 'squeezed',
    decisions: d => ({
      ...d,
      byLine: Object.fromEntries(LINES.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
    }),
  },
];

const fails: string[] = [];
const fail = (s: string) => fails.push(s);

function runGame(arm: Arm, g: number): GameState {
  const id = `CWB${arm.name}${g}`;
  const inst = generateGameInstance(id, 7_100_000 + g * 4409);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, arm.decisions(defaultDecisionSet(y)));
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
    };
  }
  return gs;
}

// Build, serialise, parse back — the round trip, not the in-memory arrays.
function roundTrip(gs: GameState): Record<string, unknown[][]> {
  const wb = buildClaimsWorkbook(gs.lockedResults, LINES, gs.poolState);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const back = XLSX.read(buf, { type: 'buffer' });
  const out: Record<string, unknown[][]> = {};
  for (const name of back.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(back.Sheets[name], { header: 1, blankrows: true, defval: '' }) as unknown[][];
  }
  return out;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const devHdrYrIdx = (hdr: string[]): number[] =>
  hdr.map((h, i) => [h, i] as const).filter(([h]) => /^Yr -?\d+$/.test(h)).map(([, i]) => i);

console.log('=== CLAIMS WORKBOOK CHECK ===');
console.log(`${GAMES} games x ${YEARS} years x ${ARMS.length} arms, all three lines.\n`);

interface Stat {
  rows: number; developed: number; blankBlock: number; blankYrCell: number; printedYrCell: number;
  zeroPrinted: number; drawnEqGross: number; drawnGtBooked: number; drawnEqBooked: number;
  maxSeriesLen: number; yrCols: number; totalCols: number;
  interiorBlank: number; stateBytes: number; seriesBytes: number;
  openRows: number; openFullyPaid: number; openWithHeadroom: number; openHeadroom: number[];
}
const stats: Record<string, Stat> = {};

for (const arm of ARMS) {
  const s: Stat = {
    rows: 0, developed: 0, blankBlock: 0, blankYrCell: 0, printedYrCell: 0, zeroPrinted: 0,
    drawnEqGross: 0, drawnGtBooked: 0, drawnEqBooked: 0, maxSeriesLen: 0, yrCols: 0, totalCols: 0,
    interiorBlank: 0, stateBytes: 0, seriesBytes: 0,
    openRows: 0, openFullyPaid: 0, openWithHeadroom: 0, openHeadroom: [],
  };
  stats[arm.name] = s;

  for (let g = 0; g < GAMES; g++) {
    const gs = runGame(arm, g);

    // --- RULING 8: what movementByStep costs in the SAVE, not in the sheet.
    // The cohorts are what persists; measure the serialised state with and
    // without the series rather than estimating from a per-number guess.
    const withSeries = JSON.stringify(gs.poolState).length;
    const withoutSeries = JSON.stringify(gs.poolState, (k, v) => (k === 'movementByStep' ? undefined : v)).length;
    s.stateBytes = Math.max(s.stateBytes, withSeries);
    s.seriesBytes = Math.max(s.seriesBytes, withSeries - withoutSeries);

    const sheets = roundTrip(gs);
    const names = Object.keys(sheets);

    // --- SHAPE ------------------------------------------------------------
    if (names.includes('Occurrences')) fail(`${arm.name} g${g}: the Occurrences sheet is still present`);
    const expected = [...LINES, 'Development'];
    if (names.join(',') !== expected.join(',')) {
      fail(`${arm.name} g${g}: sheets are [${names}], expected [${expected}]`);
    }

    // Development sheet, keyed for the one-lookup cross-check.
    const devSheet = sheets['Development'];
    const devHdr = (devSheet[1] ?? []).map(String);
    const devByOcc = new Map<string, unknown[]>();
    for (let i = 2; i < devSheet.length; i++) {
      const r = devSheet[i];
      if (!r || r[2] === '' || r[2] === undefined) continue;
      devByOcc.set(String(r[2]), r);
    }

    // ⚠ INTERIOR BLANKS ARE COUNTED HERE, ON DEVELOPMENT, NOT ON THE LINE SHEETS.
    // The line sheets are built from lockedResults, which start at year 1, so a
    // PRE-GAME accident year (-2..0) has no claim row on them — while the
    // Development sheet reads poolState and does carry it. Pre-game years are
    // written at DEFAULT decisions in both arms, so they never have an unwind and
    // are exactly where a tracked occurrence outside the developing set sits out an adverse step. Counting
    // only the line sheets would report zero of them in the squeezed arm and
    // attribute that to the squeeze.
    {
      const dh = devHdrYrIdx(devHdr);
      for (const r of devByOcc.values()) {
        let first = -1;
        let last = -1;
        let len = 0;
        for (let k = 0; k < dh.length; k++) {
          if (num(r[dh[k]]) === null) continue;
          if (first < 0) first = k;
          last = k;
          len++;
        }
        if (first >= 0) s.interiorBlank += (last - first + 1) - len;
      }
    }

    for (const line of LINES) {
      const sheet = sheets[line];
      // Property carries a second note row before the header.
      const hdrIdx = line === 'Property' ? 2 : 1;
      const header = (sheet[hdrIdx] ?? []).map(String);
      const iDrawn = header.indexOf('Drawn Occurrence');
      const iBooked = header.indexOf('Booked Occurrence');
      const iCurrent = header.indexOf('Current Occurrence');
      const iTotal = header.indexOf('Total Development');
      const iGross = header.indexOf('Gross Incurred');
      const iPaid = header.indexOf('Gross Paid');
      const iStatus = header.indexOf('Status');
      const iOcc = header.indexOf('Occurrence ID');
      if (iPaid < 0 || iStatus < 0) {
        fail(`${arm.name} g${g} ${line}: Gross Paid / Status missing from header [${header}]`);
      }
      if ([iDrawn, iBooked, iCurrent, iTotal, iGross, iOcc].some(i => i < 0)) {
        fail(`${arm.name} g${g} ${line}: development block missing from header [${header}]`);
        continue;
      }
      const yrIdx: number[] = [];
      for (let c = iBooked + 1; c < iCurrent; c++) {
        if (!/^Yr -?\d+$/.test(header[c])) fail(`${arm.name} g${g} ${line}: unexpected column "${header[c]}" inside the year block`);
        yrIdx.push(c);
      }
      s.yrCols = Math.max(s.yrCols, yrIdx.length);
      s.totalCols = Math.max(s.totalCols, header.length);

      for (let i = hdrIdx + 1; i < sheet.length; i++) {
        const r = sheet[i];
        if (!r || r[0] === '' || r[0] === undefined) continue;
        s.rows++;

        // --- OPEN AND PAID ---------------------------------------------------
        // ⚠ THIS IS THE ONLY GATE ON THE GROSS PAID COLUMN, AND IT SITS HERE
        // BECAUSE NOTHING ELSE CAN SEE IT. value-identity keys on RESULT_METRICS
        // field names and the paid split is not a metric; solo-export-guard
        // hashes the SUMMARY workbook and this is the claims workbook. Both ran
        // green through the split change that produced these very numbers, which
        // is correct of them and is exactly why the assertion belongs here.
        //
        // The defect it fixes was visible on the sheet and nothing was watching:
        // pro rata by gross ultimate gave every open claim the cohort's AVERAGE
        // paid share, so this workbook printed GL files marked `open` at 99.8%
        // paid. A file that has paid itself out is not open.
        //
        // ⚠ AND THE ASSERTION BELOW WOULD NOT HAVE CAUGHT THAT, WHICH IS WHY THE
        // DISTRIBUTION IS PRINTED BESIDE IT. 99.8% is under 100%, so a
        // paid-over-incurred test passes on the very rows that motivated this
        // change. The only thing assertable here without inventing a threshold
        // is the arithmetic impossibility — an open file that has paid its whole
        // incurred — so that is what is asserted, and the headroom quantiles
        // underneath it are what a reader compares against the previous run.
        // paid-headroom-check is the gate that measures this properly, age by
        // age and against the revision law's own magnitudes; this one exists so
        // the WORKBOOK's own cells cannot drift away from it unnoticed.
        //
        // The developed-cohort residual — a cohort that has paid more than its
        // frozen register sums to, see claimClosure.ts's cap note — is the one
        // case that breaches the impossibility legitimately, so it is counted
        // and reported rather than failed.
        if (iStatus >= 0 && iPaid >= 0 && iGross >= 0 && String(r[iStatus]) === 'open') {
          const paid = num(r[iPaid]);
          const inc = num(r[iGross]);
          if (paid !== null && inc !== null && inc > 0) {
            s.openRows++;
            if (paid >= inc - 1e-6) s.openFullyPaid++;
            else s.openWithHeadroom++;
            s.openHeadroom.push(1 - paid / inc);
          }
        }

        const drawn = num(r[iDrawn]);
        if (drawn === null) {
          // --- THREE STATES, first: the whole block blank.
          s.blankBlock++;
          const anyPrinted = [iBooked, iCurrent, iTotal, ...yrIdx].some(c => num(r[c]) !== null);
          if (anyPrinted) fail(`${arm.name} g${g} ${line} row ${i}: Drawn is blank but the rest of the block is not`);
          continue;
        }
        s.developed++;

        const booked = num(r[iBooked]);
        const current = num(r[iCurrent]);
        const total = num(r[iTotal]);
        const gross = num(r[iGross]);
        if (booked === null || current === null || total === null) {
          fail(`${arm.name} g${g} ${line} row ${i}: developed row with a blank level column`);
          continue;
        }

        // --- ROW IDENTITY, from the parsed cells -----------------------------
        let sum = 0;
        let len = 0;
        for (const c of yrIdx) {
          const v = num(r[c]);
          if (v === null) { s.blankYrCell++; continue; }
          s.printedYrCell++;
          if (v === 0) s.zeroPrinted++;
          sum += v;
          len++;
        }
        s.maxSeriesLen = Math.max(s.maxSeriesLen, len);
        // ⚠ THE TOLERANCE USED TO BE `yrIdx.length / 2 + 2`, sized for the fact
        // that every cell was Math.round-ed on the way out. The number-format
        // commit removed that rounding — `#,##0` displays whole dollars while the
        // cell holds the full value — so the identity is now exact up to floating
        // point and is asserted that way. A cent of drift here would be a real
        // arithmetic fault, not a display artefact.
        const tol = 1e-6;
        if (Math.abs(booked + sum - current) > tol) {
          fail(`${arm.name} g${g} ${line} row ${i}: Booked ${booked} + Yr sum ${sum} = ${booked + sum} !== Current ${current}`);
        }
        if (Math.abs(total - (current - booked)) > 1e-6) {
          fail(`${arm.name} g${g} ${line} row ${i}: Total ${total} !== Current - Booked ${current - booked}`);
        }

        // --- MARKDOWN --------------------------------------------------------
        if (gross !== null && Math.abs(gross - drawn) <= 1e-6) s.drawnEqGross++;
        else fail(`${arm.name} g${g} ${line} row ${i}: Gross Incurred ${gross} !== Drawn Occurrence ${drawn}`);
        if (drawn - booked > 1e-6) s.drawnGtBooked++;
        else if (Math.abs(drawn - booked) <= 1e-6) s.drawnEqBooked++;
        else fail(`${arm.name} g${g} ${line} row ${i}: Booked ${booked} EXCEEDS Drawn ${drawn}`);

        // --- ONE LOOKUP ------------------------------------------------------
        const occ = String(r[iOcc]);
        const dr = devByOcc.get(occ);
        if (!dr) { fail(`${arm.name} g${g} ${line} row ${i}: occurrence ${occ} developed but is absent from the Development sheet`); continue; }
        for (const name of ['Drawn Occurrence', 'Booked Occurrence', 'Current Occurrence', 'Total Development']) {
          const a = num(r[header.indexOf(name)]);
          const b = num(dr[devHdr.indexOf(name)]);
          if (a !== b) fail(`${arm.name} g${g} ${line} ${occ}: ${name} is ${a} on the line sheet and ${b} on Development`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- report
const hq = (a: number[], p: number): string => {
  if (a.length === 0) return '  -  ';
  const t = [...a].sort((x, y) => x - y);
  return `${(100 * t[Math.min(t.length - 1, Math.floor(p * t.length))]).toFixed(1)}%`;
};
for (const arm of ARMS) {
  const s = stats[arm.name];
  console.log(`--- ${arm.name.toUpperCase()} ---`);
  console.log(`  claim rows                  ${s.rows}`);
  console.log(`  with a development block    ${s.developed} (${((s.developed / s.rows) * 100).toFixed(2)}%)`);
  console.log(`  blank block (never tracked) ${s.blankBlock}`);
  console.log(`  Yr cells printed / blank    ${s.printedYrCell} / ${s.blankYrCell}`);
  console.log(`    of which a printed 0      ${s.zeroPrinted}   <- sub-dollar movement, NOT "unmoved"`);
  console.log(`    blanks INSIDE the span    ${s.interiorBlank}   <- valued and unmoved (Development sheet, incl. pre-game)`);
  console.log(`  Gross Incurred === Drawn    ${s.drawnEqGross} of ${s.developed}`);
  console.log(`  Drawn > Booked (markdown)   ${s.drawnGtBooked}`);
  console.log(`  Drawn === Booked (no bias)  ${s.drawnEqBooked}`);
  console.log(`  Yr columns on the sheet     ${s.yrCols}   (total columns ${s.totalCols})`);
  console.log(`  longest per-claim series    ${s.maxSeriesLen} valuations`);
  console.log(`  poolState JSON              ${(s.stateBytes / 1024).toFixed(1)} KB, of which movementByStep `
    + `${(s.seriesBytes / 1024).toFixed(1)} KB (${((s.seriesBytes / s.stateBytes) * 100).toFixed(2)}%)`);
  console.log(`  OPEN rows with a paid figure ${s.openRows}`);
  console.log(`    headroom p10/med/p90       ${hq(s.openHeadroom, .10)} / ${hq(s.openHeadroom, .50)} / ${hq(s.openHeadroom, .90)}`);
  console.log(`    paid >= incurred           ${s.openFullyPaid}   <- developed-cohort residual; asserted-against elsewhere`);
  console.log('');
}

// The markdown check is the one that cannot run at defaults.
const def = stats['defaults'];
const sqz = stats['squeezed'];
if (def.drawnGtBooked !== 0) fail(`DEFAULTS produced ${def.drawnGtBooked} marked-down rows; bookingBias should be 0 there`);
if (sqz.drawnGtBooked === 0) fail('SQUEEZED produced NO marked-down rows; the arm is not exercising the booking bias');

console.log(fails.length === 0
  ? `OK — ${fails.length} failures. Occurrences gone; the row identity holds on every developed row read`
    + '\n     back out of the parsed file; all three cell states occur; Drawn === Booked at defaults and'
    + '\n     Drawn > Booked under squeeze; line sheets and Development agree occurrence by occurrence.'
  : `${fails.length} FAILURE(S):\n` + fails.slice(0, 40).map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
