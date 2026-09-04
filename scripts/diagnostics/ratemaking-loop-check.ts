// THE RATEMAKING LOOP — THE ACCEPTANCE TEST. Play a year; all four must hold.
//
//   1. the triangle the pool priced that year off now CONTAINS that year, age 1
//   2. the oldest accident year is GONE
//   3. every remaining accident year has developed one step, ON INCURRED
//   4. the next year is priced off the UPDATED triangle
//
// ============================================================================
// ⚠ WRITTEN BEFORE THE LOOP EXISTS, DELIBERATELY, AND IT FAILS ON PURPOSE.
// This gate is the deliverable's definition, not a report on a component. Four
// components have each passed their own gate while the loop stayed unbuilt, so
// this one is written first and made to pass last.
//
// WHAT IT ASSERTS AGAINST: LinePoolState.pricingTriangle, a PERSISTENT rolling
// window that is seeded at game start and extended by play. That object does not
// exist at e9b127a and its absence is the first thing this gate reports —
// S3 derives factors on the fly from reserveDevelopment and stores nothing, so
// "the triangle the pool priced off" has no referent to assert about.
//
// ⚠ CONDITION 3 IS THE ONE THAT NEEDS A MECHANISM, NOT WIRING. Booked incurred
// does not develop: a claim is drawn AT its ultimate and the revision law is
// mean-one, so E[terminal] = E[initial]. Measured on the shipped engine, played
// incurred age-to-age is 0.997 / 0.995 / 1.000 with cumulative 0.9857 / 0.9912 /
// 1.0005. Conditions 1, 2 and 4 are wiring; 3 is the engine change.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { TRIANGLE_HISTORY_YEARS } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 12);
// Play far enough in that every window slot is a PLAYED accident year, so
// condition 3 is asserted against the engine rather than against the generator's
// seeded years. One window depth plus two.
const YEARS = Number(process.env.YEARS ?? TRIANGLE_HISTORY_YEARS + 2);

/** The shape condition 1-4 are about. Absent today; see the header. */
interface PricingCell { accidentYear: number; age: number; incurred: number; paid: number }
interface PricingTriangleState {
  years: number;
  cells: PricingCell[];
  exposureByYear: Record<string, number>;
  /** The rate this triangle produced, so condition 4 can be checked rather
   *  than assumed — a rate recomputed by the harness would prove nothing. */
  ratePer100?: number;
}

const failures: string[] = [];
const counts = { c1: 0, c2: 0, c3: 0, c4: 0, checked: 0, absent: 0 };
const devSamples: number[] = [];

function triangleOf(st: unknown, line: CoverageLine): PricingTriangleState | undefined {
  const s = st as { lines?: Record<string, { pricingTriangle?: PricingTriangleState }> };
  return s.lines?.[line]?.pricingTriangle;
}
const cellAt = (t: PricingTriangleState, ay: number, age: number) =>
  t.cells.find(c => c.accidentYear === ay && c.age === age);

for (let g = 0; g < GAMES; g++) {
  const id = `RL${g}`;
  const instance = generateGameInstance(id, 9_100_000 + g * 7919);
  const setup = { poolName: 'L', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let st: unknown = poolState;

  for (let y = 1; y <= YEARS; y++) {
    const before: Partial<Record<CoverageLine, PricingTriangleState>> = {};
    for (const line of LINES) {
      const t = triangleOf(st, line);
      if (t) before[line] = JSON.parse(JSON.stringify(t)) as PricingTriangleState;
    }

    const p = processYear(gs, defaultDecisionSet(y));
    st = p.updatedPoolState;
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };

    // Only assert once the window is full of PLAYED years.
    if (y <= TRIANGLE_HISTORY_YEARS) continue;

    for (const line of LINES) {
      const b = before[line];
      const a = triangleOf(st, line);
      counts.checked++;
      if (!b || !a) {
        counts.absent++;
        continue;
      }

      // --- 1. the played year is in the triangle at age 1 -------------------
      const fresh = cellAt(a, y, 1);
      if (fresh && fresh.incurred > 0) counts.c1++;
      else failures.push(`${line} y${y}: condition 1 — accident year ${y} is not in the triangle at age 1`);

      // --- 2. the oldest accident year is gone -----------------------------
      const oldestBefore = Math.min(...b.cells.map(c => c.accidentYear));
      const stillThere = a.cells.some(c => c.accidentYear === oldestBefore);
      const depth = new Set(a.cells.map(c => c.accidentYear)).size;
      if (!stillThere && depth === b.years) counts.c2++;
      else failures.push(`${line} y${y}: condition 2 — oldest accident year ${oldestBefore} `
        + `${stillThere ? 'is still present' : 'went, but the window is ' + depth + ' deep not ' + b.years}`);

      // --- 3. every carried-over accident year developed one step, INCURRED -
      // ⚠ ASSERTED PER ACCIDENT YEAR, NOT ON THE TOTAL. A total can rise
      // because the new year was added while every carried year sat still,
      // which is exactly the failure this condition exists to catch.
      let moved = 0, carried = 0;
      for (const ay of new Set(b.cells.map(c => c.accidentYear))) {
        if (ay === oldestBefore) continue;
        const wasAt = Math.max(...b.cells.filter(c => c.accidentYear === ay).map(c => c.age));
        const prevCell = cellAt(b, ay, wasAt);
        const nowCell = cellAt(a, ay, wasAt + 1);
        if (!prevCell || !nowCell) continue;
        carried++;
        if (prevCell.incurred > 0) devSamples.push(nowCell.incurred / prevCell.incurred);
        if (nowCell.incurred !== prevCell.incurred) moved++;
      }
      if (carried > 0 && moved === carried) counts.c3++;
      else failures.push(`${line} y${y}: condition 3 — ${carried - moved} of ${carried} carried accident `
        + 'years did not move on the incurred basis');

      // --- 4. the next year is priced off the UPDATED triangle --------------
      if (a.ratePer100 !== undefined && a.ratePer100 > 0 && a.ratePer100 !== b.ratePer100) counts.c4++;
      else failures.push(`${line} y${y}: condition 4 — the stored rate did not move with the triangle`);
    }
  }
}

console.log(RULE);
console.log('RATEMAKING LOOP — ACCEPTANCE TEST');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years; asserted from year ${TRIANGLE_HISTORY_YEARS + 1} so every`);
console.log(`window slot is a PLAYED accident year.\n`);
console.log(`  line-years checked            ${counts.checked}`);
console.log(`  with no pricingTriangle       ${counts.absent}`);
console.log(`  1. played year at age 1       ${counts.c1}`);
console.log(`  2. oldest year gone           ${counts.c2}`);
console.log(`  3. carried years developed    ${counts.c3}`);
console.log(`  4. rate moved with triangle   ${counts.c4}`);
if (devSamples.length > 0) {
  const s = [...devSamples].sort((x, y) => x - y);
  const mean = s.reduce((x, y) => x + y, 0) / s.length;
  console.log(`\n  incurred one-step development, when observable: mean ${mean.toFixed(4)}  `
    + `median ${s[Math.floor(s.length / 2)].toFixed(4)}  n ${s.length}`);
  console.log('  (1.0000 is the failure mode — a mean-one law produces no development)');
}

console.log('');
console.log(RULE);
if (counts.absent === counts.checked && counts.checked > 0) {
  console.log('NOT BUILT — LinePoolState.pricingTriangle does not exist, so none of the four');
  console.log('conditions has anything to assert against. S3 derives factors on the fly from');
  console.log('reserveDevelopment and stores no triangle.');
  console.log(RULE);
  process.exitCode = 1;
} else if (failures.length > 0) {
  const byCondition = [1, 2, 3, 4].map(n => failures.filter(f => f.includes(`condition ${n}`)).length);
  console.log(`FAILING: condition 1 x${byCondition[0]}, 2 x${byCondition[1]}, 3 x${byCondition[2]}, 4 x${byCondition[3]}`);
  for (const f of failures.slice(0, 8)) console.log(`  - ${f}`);
  if (failures.length > 8) console.log(`  ... and ${failures.length - 8} more`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE RATEMAKING LOOP HOLDS — all four conditions, every line, every year');
  console.log('past the window depth.');
  console.log(RULE);
}
