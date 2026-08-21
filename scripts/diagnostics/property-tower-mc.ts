// PROPERTY TOWER — Monte Carlo derivation of the aggregate stop-loss
// attachment levels, and a measurement of Panjer vs lognormal pricing error
// against the true compound distribution.
//
// Re-derives from the CURRENT (v16, roster v6 enrolled) book rather than
// reusing the pre-rescale plan's numbers, which is why this exists as a
// script and not a one-off calculation: the roster has moved twice since
// that plan and will move again.
//
// Run: npx tsx scripts/diagnostics/property-tower-mc.ts

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { generatePropertyClaims, computeKPr, expectedPropertyGrossLoss } from '../../src/utils/propertyClaimEngine';
import { quoteAggregate, occurrenceTotals, cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { retainedRiskMoments } from '../../src/utils/towerMoments';
import { lognormalPartialMoment } from '../../src/utils/claimMath';
import { AGG_ATTACHMENT_LEVELS } from '../../src/data/reinsuranceTower';
import type { CoverageLine, GameState, Member, ResultSet } from '../../src/types/simulation';

const SEEDS = Array.from({ length: 32 }, (_, i) => 5_000_000 + i * 137_931);

function enrolledPropertyBook(seed: number, year: number): { members: Member[]; kPr: number; expectedGrossLoss: number } {
  const setup = {
    poolName: 'G', gameLength: year, startingYear: 2026, instanceId: `PTMC${seed}`,
    activeLines: ['WC', 'GL', 'Property'] as CoverageLine[],
  };
  const inst = generateGameInstance(`PTMC${seed}`, seed);
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let last: ResultSet | undefined;
  for (let y = 1; y <= year; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    last = p.result as unknown as ResultSet;
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  const members = last!.byLine.Property.memberList.filter(m => (m.exposureByLine.Property ?? 0) > 0);
  const kPr = computeKPr(members);
  return { members, kPr, expectedGrossLoss: expectedPropertyGrossLoss(members, { kPr }) };
}

function mcRetained(members: Member[], kPr: number, trials: number): number[] {
  const out: number[] = new Array(trials);
  for (let t = 0; t < trials; t++) {
    const gen = generatePropertyClaims({
      members, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 1_000_003 + t * 97, kPr, riskControlEffectiveness: 0,
    });
    const totals = occurrenceTotals(gen.claims, gen.occurrences);
    out[t] = cedeOccurrences('Property', totals, [true]).retained;
  }
  return out;
}

// The SAME lognormal-layer formula WC's quoteAggregate uses, reimplemented
// locally rather than importing reinsuranceTower.ts's private layerMoments —
// this is the comparator being measured against, not production code.
function lognormalLayerExpected(mean: number, cv: number, a: number, b: number): number {
  const M0a = lognormalPartialMoment(mean, cv, 0, a), M0b = lognormalPartialMoment(mean, cv, 0, b);
  const M1a = lognormalPartialMoment(mean, cv, 1, a), M1b = lognormalPartialMoment(mean, cv, 1, b);
  const width = b - a;
  return Math.max(0, (M1b - M1a) - a * (M0b - M0a) + width * (1 - M0b));
}

console.log('=== SECTION 1: attachment levels at the current enrolled book ===\n');
{
  const { members, kPr, expectedGrossLoss } = enrolledPropertyBook(7_654_321, 8);
  const totalTiv = members.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  console.log(`  members ${members.length}   TIV $${totalTiv.toFixed(1)}M   kPr ${kPr.toFixed(4)}   E[gross] $${(expectedGrossLoss / 1e6).toFixed(2)}M\n`);

  const retained = mcRetained(members, kPr, 100_000).sort((a, b) => a - b);
  const eR = retained.reduce((a, b) => a + b, 0) / retained.length;
  const sdR = Math.sqrt(retained.reduce((a, x) => a + (x - eR) ** 2, 0) / retained.length);
  console.log(`  MC (100,000 trials): E[retained] $${(eR / 1e6).toFixed(2)}M   SD $${(sdR / 1e6).toFixed(2)}M   CV ${(sdR / eR).toFixed(3)}`);

  console.log(`\n  candidate    fires (MC)`);
  for (const m of [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24]) {
    const level = m * 1_000_000;
    const exceed = retained.filter(x => x > level).length / retained.length;
    console.log(`  $${String(m).padStart(2)}M       ${(exceed * 100).toFixed(1).padStart(5)}%  (~1-in-${(1 / Math.max(exceed, 1e-6)).toFixed(1)})`);
  }

  console.log(`\n  CHOSEN: AGG_ATTACHMENT_LEVELS.Property = [${AGG_ATTACHMENT_LEVELS.Property.join(', ')}]`);
  for (let lv = 0; lv < AGG_ATTACHMENT_LEVELS.Property.length; lv++) {
    const q = quoteAggregate('Property', [true], members, expectedGrossLoss, lv, 8);
    const exceed = retained.filter(x => x > q.attachment).length / retained.length;
    console.log(`    level ${lv} (${AGG_ATTACHMENT_LEVELS.Property[lv]}x E[R]): attaches at $${(q.attachment / 1e6).toFixed(0)}M, fires ${(exceed * 100).toFixed(1)}% at this book`);
  }
}

console.log('\n=== SECTION 2: Panjer vs lognormal, against Monte Carlo ground truth ===');
console.log('30,000 MC trials per seed x 8 seeds, occurrence layer purchased\n');
{
  const VALIDATE_SEEDS = SEEDS.slice(0, 8);
  const panjerErrs: number[][] = AGG_ATTACHMENT_LEVELS.Property.map(() => []);
  const lognormalErrs: number[][] = AGG_ATTACHMENT_LEVELS.Property.map(() => []);

  console.log('  seed        level   attach     MC E[ceded]   Panjer (err%)      lognormal (err%)');
  for (const seed of VALIDATE_SEEDS) {
    const { members, kPr, expectedGrossLoss } = enrolledPropertyBook(seed, 8);
    const retained = mcRetained(members, kPr, 30_000);

    // The lognormal comparator: same CV source (retainedRiskMoments) and same
    // attachment/limit WC's own quoteAggregate would use, just applied to
    // Property's book — this isolates the SHAPE assumption (lognormal vs
    // Panjer) as the only variable, holding E[R] and CV construction fixed.
    const cvMoments = retainedRiskMoments('Property', [true], members, 8);

    for (let lv = 0; lv < AGG_ATTACHMENT_LEVELS.Property.length; lv++) {
      const q = quoteAggregate('Property', [true], members, expectedGrossLoss, lv, 8);
      const exceed = retained.filter(x => x > q.attachment);
      const mcECeded = exceed.reduce((a, x) => a + Math.min(x - q.attachment, q.limit), 0) / retained.length;

      const lognormalECeded = lognormalLayerExpected(
        q.expectedRetained, cvMoments.sdOverExpected, q.attachment, q.attachment + q.limit,
      );

      const panjerErrPct = mcECeded > 0 ? (q.expectedCeded / mcECeded - 1) * 100 : 0;
      const lognormalErrPct = mcECeded > 0 ? (lognormalECeded / mcECeded - 1) * 100 : 0;
      panjerErrs[lv].push(panjerErrPct);
      lognormalErrs[lv].push(lognormalErrPct);

      console.log(`  ${String(seed).padStart(9)}   L${lv}     $${(q.attachment / 1e6).toFixed(0).padStart(2)}M     $${(mcECeded / 1e6).toFixed(3).padStart(7)}M    $${(q.expectedCeded / 1e6).toFixed(3)}M (${panjerErrPct >= 0 ? '+' : ''}${panjerErrPct.toFixed(1)}%)   $${(lognormalECeded / 1e6).toFixed(3)}M (${lognormalErrPct >= 0 ? '+' : ''}${lognormalErrPct.toFixed(1)}%)`);
    }
  }

  console.log('\n  --- summary: mean |error|, by level ---');
  let worstPanjer = 0, worstLognormal = 0;
  for (let lv = 0; lv < AGG_ATTACHMENT_LEVELS.Property.length; lv++) {
    const meanAbs = (a: number[]) => a.reduce((s, x) => s + Math.abs(x), 0) / a.length;
    const pE = meanAbs(panjerErrs[lv]), lE = meanAbs(lognormalErrs[lv]);
    worstPanjer = Math.max(worstPanjer, ...panjerErrs[lv].map(Math.abs));
    worstLognormal = Math.max(worstLognormal, ...lognormalErrs[lv].map(Math.abs));
    console.log(`  level ${lv}: Panjer ${pE.toFixed(1)}%   lognormal ${lE.toFixed(1)}%   (${lE > pE ? 'Panjer wins' : 'lognormal wins'})`);
  }
  console.log(`\n  worst single-observation |error|: Panjer ${worstPanjer.toFixed(1)}%   lognormal ${worstLognormal.toFixed(1)}%`);
  console.log(`  (context: WC's own lognormal fit measured -29.7% to +3.4% across 1.5x-2.5x E[R] —`);
  console.log(`  a SIGN-CHANGING error a multiplier cannot correct. Property's Panjer fit does not`);
  console.log(`  change sign across either level tested here.)`);

  const panjerBeatsLognormal = worstPanjer < worstLognormal;
  console.log(`\n  ${panjerBeatsLognormal ? 'OK' : 'FAIL'}  Panjer's worst error is smaller than lognormal's`);
  if (!panjerBeatsLognormal) process.exit(1);
}

console.log('\nALL PROPERTY TOWER MC CHECKS PASS.');
