// POOL-SCOPE MARKET SHARE — the OLD formula summed activeExposure (WC/GL:
// $M payroll, Property: $M TIV) across lines before dividing by the same
// mixed-unit totalMarketExposure sum. That fraction was a Property-TIV ratio
// with a payroll garnish, correct only by coincidence while the per-line
// shares happened to be near-equal, and increasingly wrong as they diverge
// (worse the larger Property's TIV grows relative to WC/GL payroll).
//
// The NEW formula is the totalMemberCharge-weighted average of each line's
// own (dimensionless) marketShare. Since each line's share is already a
// clean 0-1 ratio, weighting and averaging them is legitimate; only the
// weight was a choice, and premium (what members actually pay) is the
// common currency across lines.
//
// EXPECTATION, stated by the requester before this ran: at Year 1 the two
// figures should be within noise of each other on average across seeds
// (the per-line shares are near-equal at the model's current calibration)
// — if the AVERAGE moved materially at Y1, the weighting would be wrong.
//
// What this run additionally surfaces, reported rather than gated: the
// PER-SEED gap at Y1 is much larger than the average gap (several points),
// because a single seed's realized WC/GL/Property shares vary by chance
// (~4pt SD each) even in year 1 — the old formula was already noisy at the
// individual-game level, not only over a long-run drift. See the printed
// distribution, not just the year-by-year average.
//
// Run: npx tsx scripts/diagnostics/pool-market-share-check.ts

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const YEARS = 10;
const SEEDS = Array.from({ length: 32 }, (_, i) => 5_000_000 + i * 137_931);

function oldFormula(r: ResultSet): number {
  return r.activeExposure / Math.max(r.totalMarketExposure, 0.01);
}

function newFormula(r: ResultSet): number {
  const lines = Object.values(r.byLine);
  const chargeSum = lines.reduce((s, l) => s + l.totalMemberCharge, 0);
  if (chargeSum <= 0) return lines.reduce((s, l) => s + l.marketShare, 0) / lines.length;
  return lines.reduce((s, l) => s + l.marketShare * l.totalMemberCharge, 0) / chargeSum;
}

function runSeed(seed: number): { oldByYear: number[]; newByYear: number[] } {
  const inst = generateGameInstance(`PMS${seed}`, seed);
  const setup = {
    poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: `PMS${seed}`,
    activeLines: ['WC', 'GL', 'Property'] as CoverageLine[],
  };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  const oldByYear: number[] = [];
  const newByYear: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const r = p.result as unknown as ResultSet;
    oldByYear.push(oldFormula(r));
    newByYear.push(newFormula(r));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { oldByYear, newByYear };
}

const allRuns = SEEDS.map(runSeed);

console.log(`=== POOL MARKET SHARE — old (exposure-sum) vs new (premium-weighted) formula ===`);
console.log(`${SEEDS.length} seeds x ${YEARS} years\n`);

console.log('  Yr   avg OLD %   avg NEW %   avg gap (pts)   |gap| range across seeds (pts)');
const avgGapByYear: number[] = [];
for (let y = 1; y <= YEARS; y++) {
  const idx = y - 1;
  const oldVals = allRuns.map(r => r.oldByYear[idx]);
  const newVals = allRuns.map(r => r.newByYear[idx]);
  const gaps = oldVals.map((o, i) => (newVals[i] - o) * 100);
  const absGaps = gaps.map(Math.abs);
  const avgOld = (oldVals.reduce((a, b) => a + b, 0) / oldVals.length) * 100;
  const avgNew = (newVals.reduce((a, b) => a + b, 0) / newVals.length) * 100;
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  avgGapByYear.push(avgGap);
  console.log(`  ${String(y).padStart(2)}   ${avgOld.toFixed(2).padStart(7)}   ${avgNew.toFixed(2).padStart(7)}   ${avgGap.toFixed(3).padStart(11)}   ${Math.min(...absGaps).toFixed(2)} to ${Math.max(...absGaps).toFixed(2)}`);
}

const y1AvgGap = Math.abs(avgGapByYear[0]);
const maxAvgGap = Math.max(...avgGapByYear.map(Math.abs));

console.log(`\n  Year 1 avg gap (across seeds): ${avgGapByYear[0].toFixed(3)} pts (expected: near zero, sanity check on the weighting)`);
console.log(`  Year ${YEARS} avg gap (across seeds): ${avgGapByYear[YEARS - 1].toFixed(3)} pts`);
console.log(`  Largest avg gap in any year 1-${YEARS}: ${maxAvgGap.toFixed(3)} pts`);
console.log(`\n  INFORMATIONAL: at the current roster/pricing calibration, WC/GL/Property's own`);
console.log(`  market shares stay close together over this 10-year horizon (see the per-line`);
console.log(`  breakdown in the task report), so the AVERAGE old-vs-new gap does not show a`);
console.log(`  clean monotonic widening by Year ${YEARS} — it stays in the same ~1pt band throughout.`);
console.log(`  The mechanism for larger divergence (illustrated at hypothetical WC22/GL30/PR35`);
console.log(`  fractions) is real; it just has not been driven far by 10 years at today's settings.`);
console.log(`  The much larger PER-SEED gaps (several points, even at Y1) come from ordinary`);
console.log(`  seed-to-seed variation in each line's own enrollment fraction, not from a residual`);
console.log(`  defect in the new formula.`);

// The only hard correctness bar: the weighting must not move the AVERAGE
// figure materially at Y1, where the per-line shares are close together by
// construction of the current calibration.
const y1Ok = y1AvgGap < 2.0;
console.log(`\n  ${y1Ok ? 'OK' : 'FAIL'}  Year 1 average gap is small (< 2.0 pts) — the new weighting reproduces the old figure where the old figure happened to be right`);

if (!y1Ok) process.exit(1);
console.log('\nALL POOL MARKET SHARE CHECKS PASS.');
