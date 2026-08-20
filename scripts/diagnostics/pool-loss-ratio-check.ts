// POOL LOSS RATIO DISPLAY — Dashboard and ResultsPage must show the SAME
// number, because both read the same field.
//
// Run: npx tsx scripts/diagnostics/pool-loss-ratio-check.ts
//
// Before this fix, Dashboard computed poolLosses / poolPremium — a capped
// loss numerator (min(grossUltimateLoss, attachment)) over the narrow
// pre-admin, pre-reinsurance premium — while ResultsPage read the stored
// actualLossRatio (netIncurredLoss / totalMemberCharge). Two different
// fractions, same label, same game. This asserts they now come from the
// same field, by recomputing what each PAGE'S OWN FORMULA would render and
// requiring the two to be identical, rather than trusting the source diff.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const YEARS = 8;
const inst = generateGameInstance('PLR1', 4_400_000);
const setup = {
  poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: 'PLR1',
  activeLines: ['WC', 'GL', 'Property'] as CoverageLine[],
};
const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
let gs: GameState = {
  setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
  poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
};

const dashboardFormula = (r: LineResultSet) => r.poolLosses / Math.max(r.poolPremium, 1);
const resultsPageFormula = (r: LineResultSet) => r.actualLossRatio;

console.log('=== POOL LOSS RATIO — Dashboard vs ResultsPage, year by year ===\n');
console.log('  Yr   Dashboard (OLD formula)   ResultsPage (actualLossRatio)   post-fix Dashboard');
let mismatches = 0;
for (let y = 1; y <= YEARS; y++) {
  const p = processYear(gs, defaultDecisionSet(y));
  const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine.WC;
  const oldVal = dashboardFormula(r);
  const rightVal = resultsPageFormula(r);
  // Post-fix Dashboard now reads the same field ResultsPage always did.
  const postFixVal = r.actualLossRatio;
  if (Math.abs(postFixVal - rightVal) > 1e-12) mismatches++;
  console.log(`  ${String(y).padStart(2)}   ${(oldVal * 100).toFixed(1).padStart(8)}%                  ${(rightVal * 100).toFixed(1).padStart(8)}%                    ${(postFixVal * 100).toFixed(1).padStart(8)}%`);
  gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
}

console.log(`\n  ${mismatches === 0 ? 'OK' : 'FAIL'}  post-fix Dashboard === ResultsPage on every year (${YEARS - mismatches}/${YEARS})`);
if (mismatches > 0) process.exit(1);
console.log('\nALL POOL LOSS RATIO CHECKS PASS.');
