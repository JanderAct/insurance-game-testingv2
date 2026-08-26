// ============================================================================
// ACTUARIAL MEMORANDUM CHECK — the reserve development exhibit, guarded.
//
// Modelled directly on audit-formula-check, and for a stated reason: that page
// reached exit 0 by fixing two classes of defect this exhibit is equally
// exposed to, and both were invisible to the checks that existed at the time.
//
//   A ROW WHOSE NUMBER IS RIGHT AND WHOSE SENTENCE IS WRONG. Reinsurance
//   Recovery's layer count passed the formula check, the hand check and all
//   four arms, because the number was correct and only its prose was not. So
//   every derivable number this memo states in a sentence is registered below
//   as a PROSE CLAIM and evaluated against the data the memo had.
//
//   A ROW CORRECT ONLY BECAUSE THE DEFAULT ZEROED THE TERM IT OMITTED. Six of
//   seven formula defects on that page were invisible at default decisions,
//   because the default pins every CLF to 1.000 and switches the booking bias
//   off. THIS EXHIBIT'S ENTIRE SUBJECT IS WHAT THE BIAS DOES, so a memo built
//   and eyeballed at defaults is a memo tested in the one configuration where
//   the interesting quantity does not exist. Hence the squeezed arm, and hence
//   the coverage assertions at the bottom that FAIL if an arm never produced a
//   settled row, a seeded row, adverse development or a non-zero deficiency.
//
// THREE KINDS OF CHECK, mirroring that page:
//   ARITHMETIC   the row identities, on the RENDERED strings
//   PRINTING     empty-vs-zero discipline, and settled-vs-still-moving
//   PROSE        registered derivable claims
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import {
  buildActuarialMemo, exhibitRows, poolExhibitRows, unEmergedDeficiency, type ExhibitRow,
} from '../../src/utils/actuarialMemo';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 10);

// Each line's OWN minimum stop. Driving all three to 0.10 would squeeze
// Property to a booking bias the UI cannot produce, which overstates the
// exercise and tests nothing a player can reach — the same reasoning as
// audit-formula-check's MIN_STOP.
const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};

interface Arm { name: string; why: string; decisions: (d: DecisionSet, lines: CoverageLine[]) => DecisionSet }
const ARMS: Arm[] = [
  {
    name: 'defaults',
    why: 'fundingAtExpected everywhere: bookingBias 0, so development is pure noise and the deficiency is nil',
    decisions: d => d,
  },
  {
    name: 'squeezed',
    why: 'every line at its own minimum stop: bookingBias live, so the unwind is what the exhibit shows',
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }],
      )) as never,
    }),
  },
];

const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

interface Finding { arm: string; config: string; scope: string; year: number; what: string; detail: string }
const findings: Finding[] = [];
function fail(ctx: { arm: string; config: string; scope: string; year: number }, what: string, detail: string) {
  findings.push({ ...ctx, what, detail });
}

// ============================================================================
// THE RENDERED TABLE, PARSED BACK AS A READER SEES IT.
//
// ⚠ CHECKS RUN ON THE PRINTED STRINGS, NOT ON THE STRUCTS THAT PRODUCED THEM.
// Re-deriving a cell from the same object the renderer used would be a value
// minus itself — the Expense Ratio Check tautology, which read exactly 0.0 on
// 480 of 480 scope-years while looking like a passing identity. Parsing the
// markdown back means the formatter, the empty-cell rule and the rounding are
// all inside the check rather than assumed by it.
// ============================================================================
interface ParsedRow { label: string; cells: string[] }

function parseTables(md: string): { heading: string; rows: ParsedRow[] }[] {
  const out: { heading: string; rows: ParsedRow[] }[] = [];
  let heading = '';
  let current: { heading: string; rows: ParsedRow[] } | null = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { heading = h[1].trim(); current = null; continue; }
    // ⚠ NOT startsWith('| ') — the GFM alignment row is `|---|---:|...` with no
    // space, and testing for one silently ended every table at its second line.
    // The check then compared 0 parsed rows against a populated exhibit and
    // reported 224 findings that were all this bug.
    if (!line.startsWith('|')) { current = null; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells[0] === 'Accident year' || /^:?-{3,}:?$/.test(cells[0])) {
      if (cells[0] === 'Accident year') { current = { heading, rows: [] }; out.push(current); }
      continue;
    }
    if (current) current.rows.push({ label: cells[0], cells: cells.slice(1) });
  }
  return out;
}

const EMPTY = '—';
const num = (s: string) => Number(s);

// A printed sum, to the precision the cells are printed at. Both operands carry
// up to half a cent of rounding in $M terms, so the bound is one printing
// quantum and nothing looser.
const PRINT_QUANTUM = 0.01;

function checkTable(
  ctx: { arm: string; config: string; scope: string; year: number },
  rows: ParsedRow[],
) {
  let sawSettled = 0, sawSeeded = 0, sawAdverse = 0, sawFavourable = 0, sawEmptyTriplet = 0;

  for (const r of rows) {
    const [initial, prior, current, oneYear, total] = r.cells;
    const where = `accident year ${r.label}`;

    // --- ARITHMETIC: initial + total === current --------------------------
    if (total !== EMPTY) {
      const lhs = num(initial) + num(total);
      if (Math.abs(lhs - num(current)) > 2 * PRINT_QUANTUM) {
        fail(ctx, 'initial + total !== current', `${where}: ${initial} + ${total} = ${lhs.toFixed(2)}, printed current ${current}`);
      }
    }

    // --- ARITHMETIC: prior + 1yr === current ------------------------------
    if (prior !== EMPTY && oneYear !== EMPTY && oneYear !== 'settled') {
      const lhs = num(prior) + num(oneYear);
      if (Math.abs(lhs - num(current)) > 2 * PRINT_QUANTUM) {
        fail(ctx, 'prior + 1yr !== current', `${where}: ${prior} + ${oneYear} = ${lhs.toFixed(2)}, printed current ${current}`);
      }
    }

    // --- PRINTING: the newest year's three cells are EMPTY, not zeros -----
    // "no prior valuation" and "developed by exactly nothing" are different
    // facts and the exhibit must not render them the same way.
    const emptyCount = [prior, oneYear, total].filter(c => c === EMPTY).length;
    if (emptyCount !== 0 && emptyCount !== 3) {
      fail(ctx, 'partial empty triplet', `${where}: prior/1yr/total = ${prior}/${oneYear}/${total} — a year either has a prior valuation or it does not`);
    }
    if (emptyCount === 3) sawEmptyTriplet++;

    // --- PRINTING: a settled year must not also print a movement ----------
    if (oneYear === 'settled') {
      sawSettled++;
      if (prior !== EMPTY && Math.abs(num(prior) - num(current)) > 2 * PRINT_QUANTUM) {
        fail(ctx, 'settled year moved', `${where}: marked settled but prior ${prior} != current ${current}`);
      }
    }

    // --- PRINTING: negative zero is never emitted -------------------------
    for (const [name, c] of [['initial', initial], ['prior', prior], ['current', current], ['1yr', oneYear], ['total', total]] as const) {
      if (c === '-0.00') fail(ctx, 'negative zero printed', `${where}: ${name} printed -0.00, which implies a direction the precision cannot support`);
    }

    if (r.label.includes('†')) sawSeeded++;
    if (oneYear !== EMPTY && oneYear !== 'settled') {
      if (num(oneYear) > 0) sawAdverse++;
      if (num(oneYear) < 0) sawFavourable++;
    }
  }

  // Exactly one year — the newest — may carry the empty triplet.
  if (sawEmptyTriplet > 1) {
    fail(ctx, 'more than one year without a prior', `${sawEmptyTriplet} rows carry an empty prior/1yr/total; only the newest accident year can`);
  }
  return { sawSettled, sawSeeded, sawAdverse, sawFavourable };
}

// ============================================================================
// PROSE CLAIMS — every derivable number the memo states in a sentence.
// ============================================================================
interface ProseClaim {
  what: string;
  extract: RegExp;
  truth: (rows: ExhibitRow[]) => number;
}
const PROSE_CLAIMS: ProseClaim[] = [
  {
    what: 'accident years on the exhibit',
    extract: /(\d+) accident year\(s\) on this exhibit/,
    truth: rows => rows.length,
  },
  {
    what: 'settled accident years',
    extract: /on this exhibit; (\d+) settled/,
    truth: rows => rows.filter(r => r.settled).length,
  },
  {
    what: 'still-developing accident years',
    extract: /settled and (\d+) still developing/,
    truth: rows => rows.length - rows.filter(r => r.settled).length,
  },
  {
    what: 'accident years carried in at game start',
    extract: /(\d+) carried in at game start/,
    truth: rows => rows.filter(r => r.seeded).length,
  },
];

let proseChecked = 0;
const proseNoMatch: Record<string, number> = {};

function proseAudit(
  ctx: { arm: string; config: string; scope: string; year: number },
  sentence: string,
  rows: ExhibitRow[],
) {
  for (const claim of PROSE_CLAIMS) {
    const m = sentence.match(claim.extract);
    if (!m) { proseNoMatch[claim.what] = (proseNoMatch[claim.what] ?? 0) + 1; continue; }
    proseChecked++;
    const stated = Number(m[1]);
    const truth = claim.truth(rows);
    if (stated !== truth) {
      fail(ctx, `prose: ${claim.what}`, `states ${stated}, data says ${truth}`);
    }
  }
}

// The memo's own structural claim: accident year -3 exists on no line, ever.
// Derivable, stated in prose, and therefore registered rather than trusted.
function checkMinusThreeClaim(
  ctx: { arm: string; config: string; scope: string; year: number },
  md: string,
  rows: ExhibitRow[],
) {
  if (!md.includes('Accident year -3 is absent on every line, always')) return false;
  if (rows.some(r => r.yearNumber === -3)) {
    fail(ctx, 'prose: accident year -3', 'the memo states -3 never exists, but the exhibit carries a row for it');
  }
  return true;
}

// ============================================================================

console.log('=== ACTUARIAL MEMORANDUM CHECK ===\n');

let memosBuilt = 0;
const coverage = { settled: 0, seeded: 0, adverse: 0, favourable: 0, deficiencyNonZero: 0, finalSections: 0 };
const perArmCoverage: Record<string, { adverse: number; deficiency: number; settled: number; seeded: number }> = {};
let minusThreeChecked = 0;

for (const arm of ARMS) {
  perArmCoverage[arm.name] = { adverse: 0, deficiency: 0, settled: 0, seeded: 0 };
  for (const { lines, name } of CONFIGS) {
    for (let g = 0; g < GAMES; g++) {
      const id = `AMC${name}${g}`;
      const inst = generateGameInstance(id, 1_700_000 + g * 9173);
      const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: lines };
      const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
      let gs: GameState = {
        setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      for (let y = 1; y <= YEARS; y++) {
        const processed = processYear(gs, arm.decisions(defaultDecisionSet(y), lines));
        gs = {
          ...gs, currentYearNumber: y + 1, poolState: processed.updatedPoolState,
          lockedResults: [...gs.lockedResults, processed.result], isComplete: y === YEARS,
        };
      }

      // EVERY valuation year, not only the last. The year selector reaches all
      // of them, and a cohort that is settled in year 10 was developing in
      // year 4 — checking only the endpoint would never see a live row on a
      // short-tail line.
      for (let asAt = 1; asAt <= YEARS; asAt++) {
        const md = buildActuarialMemo({ gameState: gs, asAtYear: asAt });
        memosBuilt++;
        const tables = parseTables(md);
        const perLineRows = lines.map(l => exhibitRows(gs.poolState.lines[l]?.reserveDevelopment ?? [], asAt));

        for (let i = 0; i < lines.length; i++) {
          const ctx = { arm: arm.name, config: name, scope: lines[i], year: asAt };
          const table = tables.find(t => t.heading === lines[i]);
          if (!table) { fail(ctx, 'missing section', `no table under heading "${lines[i]}"`); continue; }
          const seen = checkTable(ctx, table.rows);
          coverage.settled += seen.sawSettled; coverage.seeded += seen.sawSeeded;
          coverage.adverse += seen.sawAdverse; coverage.favourable += seen.sawFavourable;
          perArmCoverage[arm.name].adverse += seen.sawAdverse;
          perArmCoverage[arm.name].settled += seen.sawSettled;
          perArmCoverage[arm.name].seeded += seen.sawSeeded;

          if (table.rows.length !== perLineRows[i].length) {
            fail(ctx, 'row count', `table has ${table.rows.length} rows, exhibitRows says ${perLineRows[i].length}`);
          }
          const sentence = md.split(`## ${lines[i]}`)[1]?.split('##')[0] ?? '';
          proseAudit(ctx, sentence, perLineRows[i]);
          if (checkMinusThreeClaim(ctx, md, perLineRows[i])) minusThreeChecked++;
        }

        if (lines.length > 1) {
          const ctx = { arm: arm.name, config: name, scope: 'pool', year: asAt };
          const table = tables.find(t => t.heading === 'Pool total');
          const poolRows = poolExhibitRows(perLineRows);
          if (!table) { fail(ctx, 'missing section', 'no Pool total table'); }
          else {
            checkTable(ctx, table.rows);
            if (table.rows.length !== poolRows.length) {
              fail(ctx, 'pool row count', `table has ${table.rows.length} rows, poolExhibitRows says ${poolRows.length}`);
            }
            // THE POOL IS THE SUM OF THE LINES, asserted on the PRINTED cells.
            // Summing is legitimate here and the check says so out loud: the
            // pool-scope aggregation defects this project fixed at 9ace082 were
            // all a scope reading one line's placeholder as a pool figure.
            for (const pr of table.rows) {
              const year = Number(pr.label.split(' ')[0]);
              const contributing = perLineRows.flat().filter(r => r.yearNumber === year);
              const expect = contributing.reduce((s, r) => s + r.current, 0) / 1e6;
              if (Math.abs(num(pr.cells[2]) - expect) > lines.length * PRINT_QUANTUM) {
                fail(ctx, 'pool current !== sum of lines', `accident year ${year}: pool prints ${pr.cells[2]}, lines sum to ${expect.toFixed(2)}`);
              }
            }
            const sentence = md.split('## Pool total')[1]?.split('###')[0] ?? '';
            proseAudit(ctx, sentence, poolRows);
          }
        }

        // The final-position block, at game end only.
        const ctxF = { arm: arm.name, config: name, scope: 'final', year: asAt };
        const hasFinal = md.includes('### Final position');
        const shouldHaveFinal = gs.isComplete && asAt === YEARS;
        if (hasFinal !== shouldHaveFinal) {
          fail(ctxF, 'final position gating', `section ${hasFinal ? 'present' : 'absent'} but game-end is ${shouldHaveFinal}`);
        }
        if (hasFinal) {
          coverage.finalSections++;
          const deficiency = lines.reduce((s, l) => s + unEmergedDeficiency(gs.poolState.lines[l]), 0);
          if (deficiency > 0) { coverage.deficiencyNonZero++; perArmCoverage[arm.name].deficiency++; }
          if (deficiency < 0) fail(ctxF, 'negative deficiency', `un-emerged deficiency is ${deficiency}`);
          // The three-line block must reconcile as printed.
          const surplus = Number(md.match(/\| Ending surplus \| (-?[\d.]+) \|/)?.[1]);
          const def = Number(md.match(/\| Reserve deficiency not yet emerged \| (-?[\d.]+) \|/)?.[1]);
          const net = Number(md.match(/\| Ending surplus, net of it \| (-?[\d.]+) \|/)?.[1]);
          if ([surplus, def, net].some(Number.isNaN)) {
            fail(ctxF, 'final position unparseable', 'one of the three lines did not render a number');
          } else if (Math.abs((surplus - def) - net) > 2 * PRINT_QUANTUM) {
            fail(ctxF, 'final position does not reconcile', `${surplus} - ${def} = ${(surplus - def).toFixed(2)}, printed ${net}`);
          }
          // The bias itself is never disclosed before this point, and the true
          // ultimate never at all.
          if (md.includes('registerSum') || /booking bias/i.test(md)) {
            fail(ctxF, 'disclosure', 'the memo names the booking bias or the register sum, which it must not');
          }
        }
      }
    }
  }
}

// ============================================================================
// REPORT
// ============================================================================
console.log(`${memosBuilt.toLocaleString()} memoranda built across ${ARMS.length} arms x ${CONFIGS.length} configs x ${GAMES} games x ${YEARS} valuation years.\n`);
for (const arm of ARMS) console.log(`  ${arm.name.padEnd(9)} ${arm.why}`);

console.log('\n--- COVERAGE: DID THE CHECK REACH THE INTERESTING STATES? ---');
console.log('  A green run over rows that never settled, never developed adversely and never');
console.log('  carried a deficiency would be a check passing while unable to fail.\n');
console.log(`  settled rows seen        ${coverage.settled.toLocaleString()}`);
console.log(`  carried-in rows seen     ${coverage.seeded.toLocaleString()}`);
console.log(`  adverse developments     ${coverage.adverse.toLocaleString()}`);
console.log(`  favourable developments  ${coverage.favourable.toLocaleString()}`);
console.log(`  final-position sections  ${coverage.finalSections.toLocaleString()}`);
console.log(`  of those, deficiency > 0 ${coverage.deficiencyNonZero.toLocaleString()}`);
console.log(`  accident-year -3 claim   ${minusThreeChecked.toLocaleString()} evaluations`);

console.log('\n  per arm:');
for (const arm of ARMS) {
  const c = perArmCoverage[arm.name];
  console.log(`    ${arm.name.padEnd(9)} adverse ${String(c.adverse).padStart(5)}   settled ${String(c.settled).padStart(5)}   carried-in ${String(c.seeded).padStart(5)}   deficiency>0 ${c.deficiency}`);
}

// ⚠ THE ARMS MUST DIFFER, AND THIS IS ASSERTED RATHER THAN EYEBALLED. The whole
// argument for a squeezed arm is that the default switches the booking bias off.
// If the defaults arm ever produced a deficiency, or the squeezed arm produced
// none, the arms are not doing what their names say and every conclusion drawn
// from the split is void.
const armErrors: string[] = [];
if (perArmCoverage['defaults'].deficiency !== 0) {
  armErrors.push(`defaults arm produced a non-zero deficiency in ${perArmCoverage['defaults'].deficiency} game(s) — bookingBias should be identically 0 there`);
}
if (perArmCoverage['squeezed'].deficiency === 0) {
  armErrors.push('squeezed arm produced NO deficiency anywhere — the arm is not squeezing, and the exhibit is untested where its subject exists');
}
for (const arm of ARMS) {
  const c = perArmCoverage[arm.name];
  if (c.adverse === 0) armErrors.push(`${arm.name} arm saw no adverse development at all`);
  if (c.settled === 0) armErrors.push(`${arm.name} arm saw no settled accident year at all`);
  if (c.seeded === 0) armErrors.push(`${arm.name} arm saw no carried-in accident year at all`);
}
if (coverage.finalSections === 0) armErrors.push('the final-position section never rendered');
if (proseChecked === 0) armErrors.push('no prose claim was ever evaluated');

console.log('\n--- DOES THE PROSE STATE A TRUE FACT? ---');
console.log(`  ${proseChecked.toLocaleString()} prose claim(s) evaluated across ${PROSE_CLAIMS.length + 1} registered claim(s).`);
for (const [what, n] of Object.entries(proseNoMatch)) {
  console.log(`  ⚠ "${what}" did not render in ${n} memoranda — a claim that stops appearing shows here, it is not silently passed.`);
}

console.log('\n--- FINDINGS ---');
if (findings.length === 0 && armErrors.length === 0) {
  console.log('\nEVERY ROW IDENTITY RECONCILES from its printed cells, in both arms; empty cells and');
  console.log('settled markers are used exactly where they mean what they say; the pool total is the');
  console.log('sum of its lines; every registered prose claim matches the data; and both arms reached');
  console.log('the states that make those checks capable of failing.');
  process.exit(0);
}
for (const f of findings.slice(0, 40)) {
  console.log(`  [${f.arm}/${f.config}/${f.scope} y${f.year}] ${f.what}: ${f.detail}`);
}
if (findings.length > 40) console.log(`  ... and ${findings.length - 40} more`);
for (const e of armErrors) console.log(`  COVERAGE: ${e}`);
console.log(`\n${findings.length} finding(s), ${armErrors.length} coverage failure(s).`);
process.exit(1);
