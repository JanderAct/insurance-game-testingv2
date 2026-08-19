// DOES THE REINSURANCE TOWER HAVE A DOWNSIDE NOW?
//
// Run: npx tsx scripts/diagnostics/tower-downside-check.ts
//
// THE PROBLEM THIS TESTS. Buying GL's full occurrence tower raises the total
// member charge rate about 65%, from ~7.01 to ~11.57 per $100. Before the price
// channel was reconnected that increase was INVISIBLE: the pool kept the
// recoveries, members absorbed the cost, and nothing in the model responded. A
// 50-game run with the full tower showed underwriting improve by 3.2 of
// starting surplus with ZERO games ending below start, against 11 of 50
// without. Free downside protection, paid for by members who could not react.
//
// ⚠ THE DEFAULT DECISION SET IS ALREADY THE FULL TOWER — DEFAULT_LAYERS_PLACED
// places every purchasable layer. So arm B is the default and arm A is the one
// that has to be constructed by stripping every layer. Getting this backwards
// makes the two arms identical and the whole test vacuous.
//
// WHICH CHANNEL SHOULD FIRE. The tower is bought once and held, including
// through the pre-game, so in arm B there is never a one-off +65% rate CHANGE
// event to punish — the level is simply permanently high. The retention channel
// keys off rate CHANGE and will therefore see almost nothing. The whole of the
// tower's cost signal has to come through the rate LEVEL channel into new
// business. That is precisely why level and change drive different things, and
// this run is the test of that design decision, not just of the magnitude.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import { wageFactor } from '../../src/data/exposureTrend';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = 50, YEARS = 10;
const LINES: CoverageLine[] = ['GL'];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface Y { members: number; realExp: number; rate: number; joined: number; left: number; sat: number; }
interface G { s0: number; end: number; uw: number; inv: number; years: Y[]; }

function run(tower: boolean): G[] {
  const out: G[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `TDS${g}`;
    const inst = generateGameInstance(id, 4_600_000 + g * 5849);
    const setup = { poolName: 'T', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    } as never as GameState;
    const s0 = (poolState as never as { lines: Record<string, { surplus: number }> }).lines.GL.surplus;
    const years: Y[] = [];
    let uw = 0, inv = 0;
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y);
      d.byLine.GL.layersPlaced = REINSURANCE_TOWER.GL.map(() => tower);
      const p = processYear(gs, d);
      const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine.GL;
      years.push({
        members: r.activeMembers, realExp: r.activeExposure / wageFactor('GL', y),
        rate: r.ratePer100, joined: r.newMembers, left: r.withdrawnMembers, sat: r.memberSatisfaction,
      });
      uw += r.underwritingIncome; inv += r.investmentIncome;
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    out.push({ s0, end: years[YEARS - 1] ? (gs.poolState as never as { lines: Record<string, { surplus: number }> }).lines.GL.surplus : s0, uw, inv, years });
    if ((g + 1) % 10 === 0) console.log(`    ...${g + 1}/${GAMES}`);
  }
  return out;
}

console.log('=== TOWER DOWNSIDE CHECK — GL only, 50 games x 10 years, all other decisions default ===');
console.log('ENROLLED BASIS. Real exposure deflated by GL\'s wageFactor. Reported, not gated.\n');
console.log('--- arm A: NO reinsurance (every layer stripped) ---');
const armA = run(false);
console.log('--- arm B: FULL tower (which is the DEFAULT placement) ---');
const armB = run(true);

function report(label: string, games: G[]) {
  const mult = games.map(g => g.end / g.s0);
  const below = games.filter(g => g.end < g.s0).length;
  console.log(`\n=== ${label} ===`);
  console.log(`  surplus multiple   min ${q(mult, 0).toFixed(2)}, p10 ${q(mult, 0.1).toFixed(2)}, ` +
    `median ${q(mult, 0.5).toFixed(2)}, p90 ${q(mult, 0.9).toFixed(2)}, max ${q(mult, 1).toFixed(2)}`);
  console.log(`  games ending below start: ${below}/${GAMES} = ${pct(below / GAMES)}`);
  console.log(`  underwriting / S0  median ${q(games.map(g => g.uw / g.s0), 0.5).toFixed(3)}`);
  console.log(`  investment / S0    median ${q(games.map(g => g.inv / g.s0), 0.5).toFixed(3)}`);
  const r1 = games.map(g => g.years[0].rate), rN = games.map(g => g.years[YEARS - 1].rate);
  console.log(`  rate per $100      Y1 median ${q(r1, 0.5).toFixed(2)}, Y10 median ${q(rN, 0.5).toFixed(2)}`);
  const m1 = games.map(g => g.years[0].members), mN = games.map(g => g.years[YEARS - 1].members);
  const e1 = games.map(g => g.years[0].realExp), eN = games.map(g => g.years[YEARS - 1].realExp);
  console.log(`  members            Y1 median ${q(m1, 0.5)}, Y10 median ${q(mN, 0.5)}`);
  console.log(`  REAL exposure $M   Y1 median ${q(e1, 0.5).toFixed(1)}, Y10 median ${q(eN, 0.5).toFixed(1)}`);
  const eRatio = e1.map((v, i) => eN[i] / Math.max(v, 1));
  console.log(`  REAL exposure Y1->Y10, median of per-game ratios: ${pct(q(eRatio, 0.5) - 1)}`);
  console.log(`  joins/yr ${mean(games.flatMap(g => g.years.map(y => y.joined))).toFixed(2)}, ` +
    `departures/yr ${mean(games.flatMap(g => g.years.map(y => y.left))).toFixed(2)}, ` +
    `satisfaction Y10 median ${q(games.map(g => g.years[YEARS - 1].sat), 0.5).toFixed(2)}`);
  return { mult, below, eRatio };
}

const A = report('ARM A — no reinsurance', armA);
const B = report('ARM B — full tower (the default)', armB);

console.log('\n\n=== DOES THE TOWER NOW HAVE A DOWNSIDE? ===');
console.log('  Before the price channel: underwriting improved by ~3.2 of S0 with the tower and');
console.log('  ZERO games ended below start, against 11/50 without. Pure upside, no cost anyone felt.\n');
console.log(`  games below start   A ${A.below}/${GAMES}   B ${B.below}/${GAMES}`);
console.log(`  median multiple     A ${q(A.mult, 0.5).toFixed(2)}   B ${q(B.mult, 0.5).toFixed(2)}`);
console.log(`  median joins/yr     A ${mean(armA.flatMap(g => g.years.map(y => y.joined))).toFixed(2)}   ` +
  `B ${mean(armB.flatMap(g => g.years.map(y => y.joined))).toFixed(2)}`);
const aE = q(A.eRatio, 0.5) - 1, bE = q(B.eRatio, 0.5) - 1;
console.log(`  REAL exposure drift A ${pct(aE)}   B ${pct(bE)}   difference ${pct(bE - aE)}`);
console.log(`  Y10 members         A ${q(armA.map(g => g.years[YEARS - 1].members), 0.5)}   ` +
  `B ${q(armB.map(g => g.years[YEARS - 1].members), 0.5)}`);

console.log('\n  by year, arm B minus arm A (median members, and median rate per $100):');
console.log('  year   members A   members B   diff    rate A   rate B');
for (let y = 0; y < YEARS; y++) {
  const ma = q(armA.map(g => g.years[y].members), 0.5), mb = q(armB.map(g => g.years[y].members), 0.5);
  const ra = q(armA.map(g => g.years[y].rate), 0.5), rb = q(armB.map(g => g.years[y].rate), 0.5);
  console.log(`  Y${String(y + 1).padStart(2)}   ${String(ma).padStart(9)}   ${String(mb).padStart(9)}   ` +
    `${String(mb - ma).padStart(4)}   ${ra.toFixed(2).padStart(6)}   ${rb.toFixed(2).padStart(6)}`);
}

console.log('\nDONE — reported, not gated.');
