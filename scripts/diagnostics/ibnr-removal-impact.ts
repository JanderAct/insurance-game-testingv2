// RESERVE IMPACT OF REMOVING WC'S REPORT LAG AND IBNR.
//
// Run: npx tsx scripts/diagnostics/ibnr-removal-impact.ts
//
// Run at the PARENT commit it reports the before-state; run after the removal it
// reports the after-state. The two are compared in the commit message.
//
// WHAT MATTERS. IBNR sat alongside the case cohorts in endingNetReserve, so
// removing it lowers the reserve balance directly — and reserves-to-surplus is
// one of the two leverage ratios the player is told to watch. This measures that
// ratio, not just the IBNR balance, because the balance alone does not say
// whether the change is material to anything the player sees.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 200);
const YEARS = 10;
const M = 1e6;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

interface Row {
  year: number; ibnr: number; endingNetReserve: number; endingSurplus: number;
  grossUltimateLoss: number; netIncurredLoss: number; priorYearDevelopment: number;
  emergedPriorYearLoss: number; unreportedClaimCount: number;
}
const rows: Row[] = [];

for (let g = 0; g < GAMES; g++) {
  const id = `IBNR${g}`;
  const inst = generateGameInstance(id, 7_300_000 + g * 6421);
  const setup = { poolName: 'I', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: ['WC'] as CoverageLine[] };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as GameState;
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine.WC;
    if (r) {
      rows.push({
        year: y,
        ibnr: r.ibnrReserve ?? 0,
        endingNetReserve: r.expectedNetUnpaidLoss ?? 0,
        endingSurplus: r.endingSurplus,
        grossUltimateLoss: r.grossUltimateLoss,
        netIncurredLoss: r.netIncurredLoss,
        priorYearDevelopment: r.priorYearDevelopment ?? 0,
        emergedPriorYearLoss: r.emergedPriorYearLoss ?? 0,
        unreportedClaimCount: r.unreportedClaimCount ?? 0,
      });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

console.log(`=== IBNR / REPORT-LAG IMPACT — WC solo, ${GAMES} games x ${YEARS} years, all defaults ===\n`);
console.log('  year   IBNR $M   IBNR/annual loss   net reserve $M   surplus $M   reserves/surplus');
for (let y = 1; y <= YEARS; y++) {
  const yr = rows.filter(r => r.year === y);
  const ibnr = q(yr.map(r => r.ibnr), 0.5);
  const loss = q(yr.map(r => r.grossUltimateLoss), 0.5);
  const res = q(yr.map(r => r.endingNetReserve), 0.5);
  const rts = q(yr.map(r => r.endingNetReserve / Math.max(r.endingSurplus, 1)), 0.5);
  const sur = q(yr.map(r => r.endingSurplus), 0.5);
  console.log(`  Y${String(y).padStart(2)}   ${(ibnr / M).toFixed(3).padStart(7)}   ${(ibnr / Math.max(loss, 1)).toFixed(3).padStart(16)}   ` +
    `${(res / M).toFixed(2).padStart(14)}   ${(sur / M).toFixed(2).padStart(13)}   ${rts.toFixed(3).padStart(16)}`);
}

console.log('\n  --- prior-year quantities: is there anything real behind them? ---');
{
  const emerged = rows.map(r => r.emergedPriorYearLoss);
  const dev = rows.map(r => r.priorYearDevelopment);
  const nonZeroEmerged = emerged.filter(v => v !== 0).length;
  console.log(`  emergedPriorYearLoss   median $${(q(emerged, 0.5) / M).toFixed(3)}M, p90 $${(q(emerged, 0.9) / M).toFixed(3)}M, ` +
    `non-zero in ${((nonZeroEmerged / emerged.length) * 100).toFixed(0)}% of line-years`);
  console.log(`  priorYearDevelopment   median $${(q(dev, 0.5) / M).toFixed(3)}M, p10 $${(q(dev, 0.1) / M).toFixed(3)}M, ` +
    `p90 $${(q(dev, 0.9) / M).toFixed(3)}M`);
  console.log('\n  ⚠ THESE TWO ARE INDEPENDENT QUANTITIES, which is the point of measuring both.');
  console.log('  emergedPriorYearLoss is real: claims drawn in an earlier accident year, reported now.');
  console.log('  priorYearDevelopment comes from IBNER: a per-cohort martingale step plus a');
  console.log('  deterministic unwind of the booking bias. It does not read emergence either.');
  console.log('  So removing the lag removes the REAL one and leaves development untouched.');
  console.log('');
  console.log('  ⚠ THIS SCRIPT IS A SPENT ONE-SHOT, kept for its reserve/surplus ratios only.');
  console.log('  It was written to be run at the parent and again after the report-lag/IBNR');
  console.log('  removal, with the two compared in that commit message — a comparison long');
  console.log('  since made. The three lines above USED to name processReserveDevelopment and');
  console.log('  its 1 + rng.range(-0.05, 0.08) wobble, which IBNER has since replaced; they');
  console.log('  were describing code that no longer exists. Read any figure here as a');
  console.log('  measurement of the CURRENT engine, not as the before-state it was built for.');
}
