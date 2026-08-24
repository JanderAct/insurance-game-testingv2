// PRE-GAME COHORTS UNDER IBNER — do the exhibit's opening rows actually move?
//
//   npx tsx scripts/diagnostics/ibner-pregame-report.ts
//   GAMES=200 npx tsx scripts/diagnostics/ibner-pregame-report.ts
//
// REPORTS. Gates nothing.
//
// ============================================================================
// THE TWO QUESTIONS THIS ANSWERS.
//
// 1. IS THE HORIZON COUNTED FROM THE ACCIDENT YEAR OR FROM GAME START?
//    From the ACCIDENT YEAR, and this measures it rather than asserting it.
//    generateStartingReserveCohorts draws the FULL runoff length and seeds
//    `age` to the cohort's real age, and processIbner tests `age < horizon`.
//    So a four-year-old WC cohort with H=10 has six steps left, not ten. Counting from game start instead would let a
//    five-year-old cohort develop for another twelve years on a 5-12 line —
//    more remaining uncertainty than a brand-new accident year, which is
//    backwards.
//
//    ⚠ THE H <= age CASE PRODUCES NO NEGATIVE HORIZON because nothing ever
//    computes H - age; the code COMPARES. A cohort drawn shorter than its own
//    age simply fails `age < horizon` on its first pass and is inert from
//    generation. It stays OPEN and keeps paying down — maturity governs
//    DEVELOPMENT, closure governs PAYMENT, and they are separate clocks. The
//    born-mature rate is reported below because on Property (H 2-4 against
//    ages 1-5) it is most of them, and that is a fact about the exhibit's
//    opening rows rather than a defect.
//
// 2. DO THE PRE-GAME ROWS MOVE IN A PLAYED GAME?
//    Section 2 walks a five-year game and prints EVERY pre-game accident year
//    exactly as the exhibit will, marked by origin, so the answer is visible
//    rather than inferred.
//
// ⚠ THERE ARE TWO KINDS OF PRE-GAME COHORT AND THEY ARE NOT INTERCHANGEABLE.
// This was mis-stated in the IBNER plan as "pre-game cohorts are synthetic and
// have no claim register behind them". Half of that is wrong:
//
//   REAL, years -2 / -1 / 0.  runPriorHistory PLAYS three pre-game years
//     (PRE_GAME_YEARS = 3) through processLineYear, so these carry a genuine
//     drawn claim register, a real registerSum, and a real booking. They are
//     ordinary accident years that happen to precede year 1.
//
//   SYNTHETIC, years -4 and older.  generateStartingReserveCohorts apportions
//     these from a drawn opening reserve TOTAL. runPriorHistory then relabels
//     them PRE_GAME_YEARS older so they cannot collide with the played years,
//     which is why they start at -4 rather than -1. registerSum is set to their
//     generated netUltimate, so their provision is zero at game start.
//
// ⚠ THERE IS NO ACCIDENT YEAR -3. The played years stop at -2 and the
// relabelled seed cohorts start at -4. Any exhibit that assumes a contiguous
// -3..0 block will render an empty row.
//
// THE COLUMN LABEL. For the SYNTHETIC rows "initial ultimate" would be a lie —
// there was no booking at their accident year and no claims behind them, so
// inception-to-date development is undefined and only game-start-to-date is
// real. The REAL rows do have an inception figure, but showing one basis for
// three rows and a different basis for the rest, in one column, is worse than
// showing the weaker basis for all of them. The exhibit must label the column
// "as at game start" and mean it for every row.

import { generateGameInstance, generateStartingPoolState } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { IBNER_HORIZON } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 200);
const YEARS = Number(process.env.YEARS ?? 5);

const fmt$ = (x: number) => Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(0)}k`;
const pct = (x: number) => `${(x >= 0 ? '+' : '')}${(x * 100).toFixed(2)}%`;

// --- 1. HOW THE HORIZON IS SEEDED, MEASURED --------------------------------
console.log('=== 1. HORIZON IS COUNTED FROM THE ACCIDENT YEAR (measured, not asserted) ===\n');
console.log('  If it were counted from GAME START every pre-game cohort would show');
console.log('  remaining = horizon regardless of age. It does not: remaining = horizon - age.\n');
console.log('line      | pre-game cohorts | born mature (H <= age) | mean H | mean age | mean remaining');
{
  for (const line of LINES) {
    let n = 0, mature = 0, sumH = 0, sumAge = 0, sumRem = 0;
    let mismatched = 0;
    for (let g = 0; g < GAMES; g++) {
      const id = `PG${g}`;
      const inst = generateGameInstance(id, 3_300_000 + g * 7237);
      const { poolState } = generateStartingPoolState(inst, 2026, LINES, -2);
      for (const c of poolState.lines[line].reserveCohorts) {
        if (c.yearNumber >= 1) continue;
        n++; sumH += c.horizon; sumAge += c.age;
        const remaining = Math.max(0, c.horizon - c.age);
        sumRem += remaining;
        if (c.horizon <= c.age) mature++;
        // The falsifier: a cohort whose horizon was drawn OUTSIDE the line's
        // own band would mean the draw is not the line's runoff at all.
        if (c.horizon < IBNER_HORIZON[line].min || c.horizon > IBNER_HORIZON[line].max) mismatched++;
      }
    }
    console.log(`${line.padEnd(9)} | ${String(n).padStart(16)} | ${`${mature} (${(100 * mature / n).toFixed(1)}%)`.padStart(22)} | ` +
      `${(sumH / n).toFixed(2).padStart(6)} | ${(sumAge / n).toFixed(2).padStart(8)} | ${(sumRem / n).toFixed(2).padStart(14)}`);
    if (mismatched) console.log(`  ⚠ ${mismatched} cohorts drew a horizon outside ${line}'s ${IBNER_HORIZON[line].min}-${IBNER_HORIZON[line].max} band`);
  }
  console.log('\n  mean remaining < mean H on every line is the signature of accident-year counting.');
  console.log('  Property is mostly born mature by construction: H is 2-4 against ages 1-5.');
}

// --- 2. THE EXHIBIT'S OPENING ROWS, WALKED ---------------------------------
console.log('\n=== 2. EVERY PRE-GAME ACCIDENT YEAR IN A PLAYED GAME — the exhibit rows ===\n');

function walk(id: string, seed: number) {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  // As-at-game-start estimate per pre-game accident year, and the series after.
  const atStart: Record<string, Map<number, number>> = { WC: new Map(), GL: new Map(), Property: new Map() };
  const series: Record<string, Map<number, ReserveCohort[]>> = { WC: new Map(), GL: new Map(), Property: new Map() };
  for (const l of LINES) {
    for (const c of gs.poolState.lines[l].reserveCohorts) {
      if (c.yearNumber < 1) { atStart[l].set(c.yearNumber, c.netUltimate); series[l].set(c.yearNumber, []); }
    }
  }
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      for (const c of p.updatedPoolState.lines[l].reserveCohorts) {
        if (c.yearNumber < 1 && series[l].has(c.yearNumber)) series[l].get(c.yearNumber)!.push(c);
      }
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { atStart, series };
}

{
  const w = walk('PGWALK', 3_300_000);
  for (const line of LINES) {
    console.log(`  --- ${line} ---`);
    console.log('  accident yr | origin | as at game start |    y1    |    y3    |    y5    | total dev | H / age@start | dev at y5');
    const years = [...w.series[line].keys()].sort((a, b) => b - a);
    for (const ay of years) {
      const s = w.series[line].get(ay)!;
      const start = w.atStart[line].get(ay)!;
      const at = (i: number) => s[i] ? fmt$(s[i].netUltimate) : '—';
      const lastSeen = s[s.length - 1];
      const dev = lastSeen && start > 0 ? lastSeen.netUltimate / start - 1 : 0;
      const h0 = s[0];
      const origin = ay >= -(3 - 1) ? 'played' : 'seed  ';
      console.log(`  ${String(ay).padStart(11)} | ${origin} | ${fmt$(start).padStart(16)} | ${at(0).padStart(8)} | ${at(2).padStart(8)} | ${at(4).padStart(8)} | ` +
        `${pct(dev).padStart(9)} | ${h0 ? `${h0.horizon} / ${h0.age - 1}`.padStart(13) : '—'.padStart(13)} | ` +
        `${lastSeen ? (lastSeen.age < lastSeen.horizon ? 'yes' : 'no') : '—'}`);
    }
    console.log();
  }
  console.log('  ⚠ "as at game start" is the honest label — see this file\'s header. A blank in a');
  console.log('    later column means the cohort CLOSED (fully paid), not that it stopped moving.');
}

// --- 3. HOW MANY OPENING ROWS ARE STILL LIVE, ACROSS MANY GAMES ------------
console.log('=== 3. SHARE OF ALL PRE-GAME ROWS STILL DEVELOPING, at game years 1 / 3 / 5 ===\n');
console.log('  the exhibit needs these rows to MOVE, so this is the number that matters.\n');
console.log('line      | rows | developing at y1 | at y3 | at y5 | mean |dev| by y5 | rows that moved >1%');
{
  for (const line of LINES) {
    let rows = 0, d1 = 0, d3 = 0, d5 = 0, moved = 0, sumAbs = 0;
    for (let g = 0; g < GAMES; g++) {
      const w = walk(`PGW${g}`, 3_300_000 + g * 7237);
      for (const [ay, s] of w.series[line]) {
        if (s.length === 0) continue;
        const start = w.atStart[line].get(ay)!;
        if (start <= 0) continue;
        rows++;
        if (s[0] && s[0].age < s[0].horizon) d1++;
        if (s[2] && s[2].age < s[2].horizon) d3++;
        if (s[4] && s[4].age < s[4].horizon) d5++;
        const lastSeen = s[s.length - 1];
        const dev = Math.abs(lastSeen.netUltimate / start - 1);
        sumAbs += dev;
        if (dev > 0.01) moved++;
      }
    }
    const sh = (x: number) => `${(100 * x / rows).toFixed(1)}%`;
    console.log(`${line.padEnd(9)} | ${String(rows).padStart(4)} | ${sh(d1).padStart(16)} | ${sh(d3).padStart(5)} | ${sh(d5).padStart(5)} | ` +
      `${(100 * sumAbs / rows).toFixed(2)}%`.padStart(15) + ` | ${sh(moved).padStart(19)}`);
  }
}

// --- 4. PROPERTY'S WHOLE EXHIBIT, REPORT ONLY ------------------------------
// ⚠ REPORTED, NOT FIXED. A 2-4 horizon is defensible for a short-tail line;
// whether "short-tail lines do not develop" should be the lesson, or whether
// the horizon should be lengthened against realism, is a ruling and not a bug.
console.log(`\n=== 4. PROPERTY'S EXHIBIT ACROSS ${YEARS} YEARS — every accident year ===\n`);
{
  const inst = generateGameInstance('PROPEX', 3_300_000);
  const setup = { poolName: 'X', gameLength: YEARS, startingYear: 2026, instanceId: 'PROPEX', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const first = new Map<number, number>();
  const latest = new Map<number, ReserveCohort>();
  const steps = new Map<number, number>();
  for (const c of gs.poolState.lines.Property.reserveCohorts) {
    if (c.yearNumber < 1) { first.set(c.yearNumber, c.netUltimate); latest.set(c.yearNumber, c); }
  }
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const c of p.updatedPoolState.lines.Property.reserveCohorts) {
      if (!first.has(c.yearNumber)) first.set(c.yearNumber, c.netUltimate);
      latest.set(c.yearNumber, c);
      if (c.age < c.horizon) steps.set(c.yearNumber, (steps.get(c.yearNumber) ?? 0) + 1);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  console.log('  accident yr | origin | first seen |    final   | total dev | H | yrs it actually developed');
  for (const ay of [...latest.keys()].sort((a, b) => a - b)) {
    const c = latest.get(ay)!, f = first.get(ay)!;
    const origin = ay >= 1 ? 'in-game' : (ay >= -2 ? 'played ' : 'seed   ');
    console.log(`  ${String(ay).padStart(11)} | ${origin} | ${fmt$(f).padStart(10)} | ${fmt$(c.netUltimate).padStart(10)} | ` +
      `${pct(f > 0 ? c.netUltimate / f - 1 : 0).padStart(9)} | ${String(c.horizon)} | ${steps.get(ay) ?? 0}`);
  }
  console.log('\n  ⚠ A PROPERTY ROW IS DONE MOVING BY ITS THIRD OR FOURTH APPEARANCE, and the');
  console.log('    exhibit will show that as a column of repeated identical numbers for every');
  console.log('    accident year older than about three. That follows from the 2-4 horizon, not');
  console.log('    from anything IBNER does: with an 8% total SD spread over 2-4 steps there is');
  console.log('    very little to show even while a row IS developing.');
}

console.log('\nREPORT ONLY — nothing above is asserted.');
