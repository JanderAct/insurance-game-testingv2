// CLF DOWNSIDE MEASUREMENT — does the pool have any downside at default settings?
//
// MEASUREMENT ONLY. Changes no constant, default or parameter; decides nothing.
//
//   npx tsx scripts/diagnostics/clf-downside-check.ts [games]   # default 50
//
// THE HYPOTHESIS. With the combined-ratio display corrected, the expected
// combined ratio at defaults is 82.7% on a consistent basis — 17.3 points of
// structural margin from the CLF load, compounded by investment income on a
// base that grows because of that margin. Five real playthroughs have never
// ended below their starting surplus. This measures whether that is luck or
// structure.
//
// THE TWO QUESTIONS ARE DIFFERENT AND (b)/(e) MATTER MORE THAN (a):
//   (a) tells us about the GAME — can a five-year run end down?
//   (b)/(e) tell us about the MODEL — can a single YEAR lose money at all?
// If no individual year ever loses, the annual loss distribution simply cannot
// reach far enough to overcome a 17.3-point margin. That is a worse finding
// than five-year compounding, because it is not fixable by shortening the game.
//
// (f) SETS THE CEILING ON WHAT A CLF CHANGE CAN FIX. If underwriting is ~55% of
// the growth, removing the margin roughly halves the problem and investment
// income still pushes surplus up, so a surplus-return mechanism is needed too.
// If underwriting is 80%+, the CLF change alone largely solves it.
//
// Progress prints every 10 games so partial results survive a truncated run.
// Seeds are printed so Part 2 can rerun the identical set.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.argv[2] ?? 50);
const YEARS = 5;
const LINES: CoverageLine[] = ['WC', 'GL'];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const fmt$ = (x: number) => `${x < 0 ? '-' : ''}$${(Math.abs(x) / 1e6).toFixed(2)}M`;
const pctile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}
// Deterministic and reproducible: Part 2 reruns this exact list.
const SEED_IDS = Array.from({ length: GAMES }, (_, i) =>
  (((i + 1) * 2654435761) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));

interface GameRow {
  id: string;
  startSurplus: number;
  endSurplus: number;
  yearsDown: number;
  yearCombineds: number[];
  underwriting: number;
  investment: number;
}

const rows: GameRow[] = [];
let poolYearsTotal = 0, poolYearsDown = 0, poolYearsOver100 = 0;
const allYearCombineds: number[] = [];
let grossSum = 0, expectedSum = 0;

console.log(`=== CLF DOWNSIDE MEASUREMENT — ${GAMES} games x ${YEARS} years, WC + GL, ALL DEFAULTS ===\n`);

for (let g = 0; g < GAMES; g++) {
  const id = SEED_IDS[g];
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  let startSurplus = NaN, endSurplus = NaN, yearsDown = 0, uw = 0, inv = 0;
  const yearCombineds: number[] = [];

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const r = p.result;
    if (y === 1) startSurplus = r.beginingSurplus;
    endSurplus = r.endingSurplus;
    if (r.endingSurplus < r.beginingSurplus) yearsDown++;
    poolYearsTotal++;
    if (r.endingSurplus < r.beginingSurplus) poolYearsDown++;
    // ACTUAL combined ratio, pool scope, wide basis — the realized figure.
    yearCombineds.push(r.actualCombinedRatio);
    allYearCombineds.push(r.actualCombinedRatio);
    if (r.actualCombinedRatio > 1) poolYearsOver100++;
    uw += r.underwritingIncome;
    inv += r.investmentIncome;
    for (const l of LINES) {
      grossSum += r.byLine[l].grossUltimateLoss;
      expectedSum += r.byLine[l].expectedLoss;
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  rows.push({ id, startSurplus, endSurplus, yearsDown, yearCombineds, underwriting: uw, investment: inv });

  if ((g + 1) % 10 === 0 || g === GAMES - 1) {
    const down = rows.filter(r => r.endSurplus < r.startSurplus).length;
    const ratios = rows.map(r => r.endSurplus / r.startSurplus);
    console.log(`  [${String(g + 1).padStart(3)}/${GAMES}] games ending down ${down}/${rows.length}` +
      `   pool-years down ${poolYearsDown}/${poolYearsTotal}` +
      `   years CR>100% ${poolYearsOver100}/${poolYearsTotal}` +
      `   median end/start ${pctile([...ratios].sort((a, b) => a - b), 0.5).toFixed(3)}`);
  }
}

const dist = (label: string, xs: number[], fmt: (n: number) => string) => {
  const s = [...xs].sort((a, b) => a - b);
  console.log(`  ${label}`);
  console.log(`    min ${fmt(s[0])}   5th ${fmt(pctile(s, 0.05))}   25th ${fmt(pctile(s, 0.25))}   median ${fmt(pctile(s, 0.5))}`);
  console.log(`    75th ${fmt(pctile(s, 0.75))}   95th ${fmt(pctile(s, 0.95))}   max ${fmt(s[s.length - 1])}`);
};
const p2 = (n: number) => `${(n * 100).toFixed(1)}%`;
const r3 = (n: number) => n.toFixed(3);

console.log(`\n--- (a) games ending BELOW starting surplus ---`);
const gamesDown = rows.filter(r => r.endSurplus < r.startSurplus);
console.log(`  ${gamesDown.length}/${GAMES} (${(gamesDown.length / GAMES * 100).toFixed(1)}%)`);

console.log(`\n--- (b) POOL-YEARS where surplus decreased year over year ---`);
console.log(`  ${poolYearsDown}/${poolYearsTotal} (${(poolYearsDown / poolYearsTotal * 100).toFixed(1)}%)`);
console.log(`  games with at least one down year: ${rows.filter(r => r.yearsDown > 0).length}/${GAMES}`);

console.log(`\n--- (c) ending surplus / starting surplus ---`);
dist('', rows.map(r => r.endSurplus / r.startSurplus), r3);

console.log(`\n--- (d) 5-year mean POOL ACTUAL combined ratio (wide basis) ---`);
const gameMeanCr = rows.map(r => mean(r.yearCombineds));
dist('', gameMeanCr, p2);
console.log(`    games whose 5-year mean exceeds 100%: ${gameMeanCr.filter(x => x > 1).length}/${GAMES}`);

console.log(`\n--- (e) POOL-YEARS with actual combined ratio above 100% ---`);
console.log(`  ${poolYearsOver100}/${poolYearsTotal} (${(poolYearsOver100 / poolYearsTotal * 100).toFixed(1)}%)`);

console.log(`\n--- (f) 5-year surplus change decomposition, averaged over ${GAMES} games ---`);
const avgUw = mean(rows.map(r => r.underwriting));
const avgInv = mean(rows.map(r => r.investment));
const avgChange = mean(rows.map(r => r.endSurplus - r.startSurplus));
console.log(`  underwriting income  ${fmt$(avgUw).padStart(10)}   ${(avgUw / (avgUw + avgInv) * 100).toFixed(1)}% of income`);
console.log(`  investment income    ${fmt$(avgInv).padStart(10)}   ${(avgInv / (avgUw + avgInv) * 100).toFixed(1)}% of income`);
console.log(`  total net income     ${fmt$(avgUw + avgInv).padStart(10)}`);
console.log(`  actual surplus change${fmt$(avgChange).padStart(10)}   (differs from net income by dividends/assessments/capital flows)`);

console.log(`\n--- also reported ---`);
console.log(`  actual combined ratio across all ${poolYearsTotal} pool-years: ${(mean(allYearCombineds) * 100).toFixed(1)}%`);
console.log(`  realized gross loss / expected across the same: ${(grossSum / expectedSum).toFixed(4)}`);
console.log(`    (the five live games drew ~0.79; a value near 1.00 means this set is NOT light)`);

// CLF-1.0 INVARIANT. At CLF 1.0 the expected combined ratio is algebraically
// exactly 100% regardless of admin ratio or reinsurance percentage: admin
// scales with expected loss and reinsurance scales with premium, so numerator
// and denominator collapse to the same expression. If this ever reports
// otherwise, the FORMULA has drifted — not the calibration.
console.log(`\n--- CLF-1.0 invariant (formula check, not a calibration check) ---`);
{
  let worst = 0; let worstDesc = '';
  for (const adminRatio of [0.10, 0.15, 0.22]) {
    for (const reinsPct of [0, 0.2, 0.375, 0.6]) {
      const combinedAt1 = (1 + adminRatio + reinsPct * 1) / (1 + adminRatio + reinsPct * 1);
      const dev = Math.abs(combinedAt1 - 1);
      if (dev > worst) { worst = dev; worstDesc = `admin ${adminRatio}, reins ${reinsPct}`; }
    }
  }
  const ok = worst < 1e-12;
  console.log(`  across admin ratios {0.10, 0.15, 0.22} x reinsurance {0, 0.2, 0.375, 0.6}:`);
  console.log(`  max deviation from 100.00%: ${worst.toExponential(1)} (${worstDesc || 'all exact'})  ${ok ? 'OK' : 'FAIL — formula has drifted'}`);
}

console.log(`\n--- seeds used (Part 2 must rerun this exact list) ---`);
for (let i = 0; i < SEED_IDS.length; i += 10) {
  console.log(`  ${SEED_IDS.slice(i, i + 10).join(' ')}`);
}
console.log('\nMEASUREMENT COMPLETE — no constant, default or parameter was changed.');
