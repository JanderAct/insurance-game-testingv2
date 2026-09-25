// ============================================================================
// WHAT THE GL ANALYTICS PROGRAM IS WORTH — a READING, not a gate.
//
//   GAMES=24 YEARS=5 npx tsx scripts/diagnostics/gl-program-value.ts
//
// PAIRED ON SEEDS. Both arms play identical games from identical instances and
// identical decisions; the ONLY difference is whether
// `gl-law-enforcement-analytics` is committed. Everything the program does not
// touch therefore cancels exactly, and the difference is the program.
//
// ⚠ THE COST IS NOW CHARGED BY THE ENGINE, so every surplus figure below is NET
// of it. $1M a year for the three build years, then $100k a year to maintain —
// see riskControlPrograms.ts. The paired surplus delta is therefore the whole
// answer: benefit, cost, development timing and premium feedback together.
//
// The loss figures are still gross of cost, because a loss is not a cost.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  GL_ANALYTICS_FREQUENCY_REDUCTION, PROGRAM_RAMP, rampFraction, programFreqMultiplier,
} from '../../src/utils/riskControlPrograms';
import {
  GL_ANALYTICS_BUILD_ANNUAL_COST, GL_ANALYTICS_BUILD_YEARS, GL_ANALYTICS_MAINTENANCE_ANNUAL_COST,
} from '../../src/utils/riskControlPrograms';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 24);
const YEARS = Number(process.env.YEARS ?? 5);
const LINES = (process.env.LINES ?? 'GL').split(',') as CoverageLine[];
const PROGRAM = 'gl-law-enforcement-analytics';
const M = 1e6;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
};

interface Row {
  gross: number[]; net: number[]; lr: number[]; res: number[]; sur: number[]; n: number[];
}
const blank = (): Row => ({ gross: [], net: [], lr: [], res: [], sur: [], n: [] });

function play(withProgram: boolean) {
  const byYear: Record<number, Row> = {};
  for (let y = 1; y <= YEARS; y++) byYear[y] = blank();
  const finalSurplus: number[] = [];

  for (let g = 0; g < GAMES; g++) {
    const id = `GPV${g}`;
    const inst = generateGameInstance(id, 4_400_000 + g * 6379);
    const setup = { poolName: 'V', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const base = defaultDecisionSet(y);
      const d: DecisionSet = withProgram ? { ...base, riskControlProgramIds: [PROGRAM] } : base;
      const p = processYear(gs, d);
      const gl = (p.result as never as {
        byLine: Record<string, {
          grossUltimateLoss: number; netUltimateLoss: number; actualLossRatio: number;
          endingNetReserve: number; endingSurplus: number; claimCount?: number;
        }>
      }).byLine.GL;
      if (gl) {
        byYear[y].gross.push(gl.grossUltimateLoss);
        byYear[y].net.push(gl.netUltimateLoss);
        byYear[y].lr.push(gl.actualLossRatio);
        byYear[y].res.push(gl.endingNetReserve);
        byYear[y].sur.push(gl.endingSurplus);
        byYear[y].n.push(gl.claimCount ?? 0);
        if (y === YEARS) finalSurplus.push(gl.endingSurplus);
      }
      gs = {
        ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
      };
    }
  }
  return { byYear, finalSurplus };
}

console.log('='.repeat(78));
console.log('GL ANALYTICS PROGRAM — WHAT IT IS WORTH');
console.log('='.repeat(78));
console.log(`${GAMES} games x ${YEARS} years, lines ${LINES.join('+')}, PAIRED on seeds.`);
console.log(`full-ramp frequency reduction ${(100 * GL_ANALYTICS_FREQUENCY_REDUCTION).toFixed(1)}%, `
  + `ramp [${PROGRAM_RAMP.join(', ')}]\n`);

console.log('--- 0. THE MULTIPLIER THE ENGINE WILL APPLY, by tenure ---');
console.log('  tenure   ramp    multiplier   effective cut');
for (let t = 1; t <= 4; t++) {
  const prior = Array.from({ length: t - 1 }, () => [PROGRAM]);
  const mult = programFreqMultiplier('GL', [PROGRAM], prior);
  console.log(`     ${t}     ${rampFraction(t).toFixed(2)}     ${mult.toFixed(4)}       `
    + `${(100 * (1 - mult)).toFixed(2)}%`);
}
console.log(`  a line that is not GL: ${programFreqMultiplier('WC', [PROGRAM], []).toFixed(4)} (untouched)`);
console.log(`  GL with nothing committed: ${programFreqMultiplier('GL', [], []).toFixed(4)} (untouched)`);

const off = play(false);
const on = play(true);

console.log('\n--- 1. GL, ARM BY ARM, and the paired difference ---');
console.log('  yr        gross loss            net retained          claims     surplus');
console.log('            off      on   delta   off     on   delta   off   on    delta');
for (let y = 1; y <= YEARS; y++) {
  const a = off.byYear[y], b = on.byYear[y];
  console.log(`  ${String(y).padStart(2)}  ${(mean(a.gross) / M).toFixed(2).padStart(7)} `
    + `${(mean(b.gross) / M).toFixed(2).padStart(7)} ${((mean(b.gross) - mean(a.gross)) / M).toFixed(2).padStart(7)}  `
    + `${(mean(a.net) / M).toFixed(2).padStart(6)} ${(mean(b.net) / M).toFixed(2).padStart(6)} `
    + `${((mean(b.net) - mean(a.net)) / M).toFixed(2).padStart(7)}  `
    + `${mean(a.n).toFixed(0).padStart(4)} ${mean(b.n).toFixed(0).padStart(4)} `
    + `${((mean(b.sur) - mean(a.sur)) / M).toFixed(2).padStart(7)}`);
}
console.log('  (all figures $M; delta is ON minus OFF, so negative loss = the program working)');

console.log('\n--- 2. THE VALUE AT FULL RAMP (years 3+, where the ramp is 1.0) ---');
const fullYears = [3, 4, 5].filter(y => y <= YEARS);
const dGross = mean(fullYears.map(y => mean(off.byYear[y].gross) - mean(on.byYear[y].gross)));
const dNet = mean(fullYears.map(y => mean(off.byYear[y].net) - mean(on.byYear[y].net)));
console.log(`  gross loss avoided per year   $${(dGross / M).toFixed(3)}M`);
console.log(`  NET retained loss avoided     $${(dNet / M).toFixed(3)}M   <- what the pool keeps`);
console.log(`  the tower absorbs             ${(100 * (1 - dNet / dGross)).toFixed(1)}% of the gross saving`);
console.log(`  placeholder cost              $${(GL_ANALYTICS_BUILD_ANNUAL_COST / M).toFixed(3)}M per year`);
const ratio = dNet / GL_ANALYTICS_BUILD_ANNUAL_COST;
console.log(`  NET BENEFIT / COST            ${ratio.toFixed(2)}x`);
console.log(`  break-even full-ramp cut      `
  + `${(100 * GL_ANALYTICS_FREQUENCY_REDUCTION / Math.max(ratio, 1e-9)).toFixed(2)}%  `
  + `(the reduction at which net saving = $1M)`);

console.log('\n--- 3. FIVE-YEAR TOTALS, GL ---');
const tGross = fullYearsTotal(off, on, 'gross');
const tNet = fullYearsTotal(off, on, 'net');
function fullYearsTotal(a: typeof off, b: typeof on, key: 'gross' | 'net') {
  let s = 0;
  for (let y = 1; y <= YEARS; y++) s += mean(a.byYear[y][key]) - mean(b.byYear[y][key]);
  return s;
}
console.log(`  gross loss avoided over ${YEARS} years   $${(tGross / M).toFixed(3)}M`);
console.log(`  net loss avoided over ${YEARS} years     $${(tNet / M).toFixed(3)}M`);
console.log(`  cost over ${YEARS} years at the placeholder  $${(YEARS * GL_ANALYTICS_BUILD_ANNUAL_COST / M).toFixed(3)}M`);
console.log(`  net of cost                        $${((tNet - YEARS * GL_ANALYTICS_BUILD_ANNUAL_COST) / M).toFixed(3)}M`);

console.log('\n--- 4. LOSS RATIO, RESERVES AND ENDING SURPLUS ---');
console.log('  yr    loss ratio off/on      reserve off/on        surplus off/on');
for (let y = 1; y <= YEARS; y++) {
  const a = off.byYear[y], b = on.byYear[y];
  console.log(`  ${String(y).padStart(2)}    ${(100 * mean(a.lr)).toFixed(1).padStart(5)}% ${(100 * mean(b.lr)).toFixed(1).padStart(6)}%  `
    + `(${(100 * (mean(b.lr) - mean(a.lr))).toFixed(2).padStart(6)}pp)   `
    + `${(mean(a.res) / M).toFixed(1).padStart(5)} ${(mean(b.res) / M).toFixed(1).padStart(5)}  `
    + `(${((mean(b.res) - mean(a.res)) / M).toFixed(2).padStart(6)})   `
    + `${(mean(a.sur) / M).toFixed(1).padStart(5)} ${(mean(b.sur) / M).toFixed(1).padStart(5)}  `
    + `(${((mean(b.sur) - mean(a.sur)) / M).toFixed(2).padStart(6)})`);
}

console.log('\n--- 5. IS THE DIFFERENCE BIGGER THAN THE NOISE? paired, final-year surplus ---');
const diffs = off.finalSurplus.map((v, i) => on.finalSurplus[i] - v);
const se = sd(diffs) / Math.sqrt(diffs.length);
console.log(`  paired mean surplus difference $${(mean(diffs) / M).toFixed(3)}M, SE $${(se / M).toFixed(3)}M, `
  + `t = ${(mean(diffs) / Math.max(se, 1e-9)).toFixed(2)} over ${diffs.length} games`);
console.log('\nREADING ONLY — no pass condition.');

console.log('\n--- 6. NET OF THE REAL COST SHAPE — the engine charged it, so this is the answer ---');
const cumCost = (n: number) => Math.min(n, GL_ANALYTICS_BUILD_YEARS) * GL_ANALYTICS_BUILD_ANNUAL_COST
  + Math.max(0, n - GL_ANALYTICS_BUILD_YEARS) * GL_ANALYTICS_MAINTENANCE_ANNUAL_COST;
console.log('  yr   cumulative charge   GL ending-surplus delta (NET)   paired t');
for (let y = 1; y <= YEARS; y++) {
  const d = off.byYear[y].sur.map((v, i) => (on.byYear[y].sur[i] ?? v) - v);
  const se = sd(d) / Math.sqrt(Math.max(1, d.length));
  console.log(`  ${String(y).padStart(2)}   $${(cumCost(y) / M).toFixed(2).padStart(6)}M            `
    + `$${(mean(d) / M).toFixed(3).padStart(7)}M                    ${(mean(d) / Math.max(se, 1e-9)).toFixed(1)}`);
}
console.log('\n  (negative = the program has cost more than it has returned so far)');
