// PROPERTY TOWER — the aggregate stop-loss's attachment levels, and the
// validation of its Panjer pricing against Monte Carlo.
//
// Run: npx tsx scripts/diagnostics/property-tower-mc.ts
//      SEEDS=200 TRIALS=25000 npx tsx scripts/diagnostics/property-tower-mc.ts
//
// ⚠ SEED COUNT IS A PRECISION PARAMETER, NOT A STYLE CHOICE, and this script
// was WRONG about that on its first version. It validated across 8 seeds at
// 30,000 trials each and reported a 2-18% Panjer "error" — but at Property's
// aggregate CV the per-seed Monte Carlo standard error on E[ceded] at the
// higher attachment is itself several percent, so the 8-seed spread was
// substantially sampling noise and NEITHER the headline error nor its
// apparent spread across levels meant anything. The defaults below are set so
// the reported MEAN error is resolved to well under the effect being measured,
// and the per-seed standard error is printed alongside every figure so the
// reader can see the resolution rather than trust it.
//
// What re-measuring properly then exposed: an 18% understatement at the higher
// attachment that was REAL and was this module's own defect — see section 0.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { generatePropertyClaims, computeKPr, expectedPropertyGrossLoss } from '../../src/utils/propertyClaimEngine';
import { quoteAggregate, occurrenceTotals, cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { propertyAggregateInternals } from '../../src/utils/propertyAggregate';
import { retainedRiskMoments } from '../../src/utils/towerMoments';
import { lognormalPartialMoment } from '../../src/utils/claimMath';
import { AGG_ATTACHMENT_LEVELS } from '../../src/data/reinsuranceTower';
import { PROPERTY_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, Member, ResultSet } from '../../src/types/simulation';

const N_SEEDS = Number(process.env.SEEDS ?? 200);
const TRIALS = Number(process.env.TRIALS ?? 25_000);
const SEEDS = Array.from({ length: N_SEEDS }, (_, i) => 5_000_000 + i * 13_793);
const PM = PROPERTY_LOSS_MODEL;
const LEVELS = AGG_ATTACHMENT_LEVELS.Property;

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
  else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
};

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
    out[t] = cedeOccurrences('Property', occurrenceTotals(gen.claims, gen.occurrences), [true]).retained;
  }
  return out;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

// ===========================================================================
console.log('=== SECTION 0: the discretisation grid is not a convergence parameter ===\n');
{
  const { limitedExpectedValue, neutralSeverityCdf, discretizedRetainedSeverity, BIN } = propertyAggregateInternals;
  const TH = PM.perRiskRetention;
  const trueMean = limitedExpectedValue(TH);

  // Reconstruct the RETIRED naive discretisation to show what it cost. Bucket j
  // held F(j*BIN) - F((j-1)*BIN) placed at j*BIN — every claim rounded UP.
  const naiveMeanAt = (h: number) => {
    const J = Math.round(TH / h);
    let m = 0, prev = 0;
    for (let j = 1; j < J; j++) { const c = neutralSeverityCdf(j * h); m += (c - prev) * j * h; prev = c; }
    m += (1 - prev) * J * h;
    return m;
  };
  const shippedMean = (() => {
    const f = discretizedRetainedSeverity(TH);
    let m = 0; for (let j = 0; j < f.length; j++) m += f[j] * j * BIN;
    return m;
  })();

  console.log(`  true E[min(X, $${TH / 1e6}M)] = $${trueMean.toFixed(2)}   (closed form, limitedExpectedValue)\n`);
  console.log('  bin width    RETIRED naive    bias      shipped mean-preserving');
  for (const h of [200_000, 100_000, 50_000, 25_000, 10_000, 2_000]) {
    const nm = naiveMeanAt(h);
    const marker = h === BIN ? `  $${shippedMean.toFixed(2)} (bias ${((shippedMean / trueMean - 1) * 100).toExponential(1)}%)` : '';
    console.log(`  $${String(h).padStart(7)}     $${nm.toFixed(2).padStart(10)}   ${((nm / trueMean - 1) * 100).toFixed(2).padStart(6)}%${marker}`);
  }
  check(Math.abs(shippedMean / trueMean - 1) < 1e-9,
    'mean-preserving discretisation reproduces E[min(X,retention)] exactly',
    `relative bias ${((shippedMean / trueMean - 1) * 100).toExponential(2)}%`);
  console.log(`\n  The naive form biased +8.1% at $50k bins — it rounded every claim UP to the`);
  console.log(`  next lattice point. Compounded over ~33 claims/yr that inflated the annual`);
  console.log(`  mean, the rescale then divided it out, and the distortion landed on the SHAPE:`);
  console.log(`  invisible in the mean, ~18% understatement of E[ceded] at the higher attachment.`);
}

// ===========================================================================
console.log('\n=== SECTION 1: attachment levels at the current enrolled book ===\n');
{
  const { members, kPr, expectedGrossLoss } = enrolledPropertyBook(7_654_321, 8);
  const totalTiv = members.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  console.log(`  members ${members.length}   TIV $${totalTiv.toFixed(1)}M   kPr ${kPr.toFixed(4)}   E[gross] $${(expectedGrossLoss / 1e6).toFixed(2)}M\n`);

  const retained = mcRetained(members, kPr, Math.max(TRIALS, 50_000)).sort((a, b) => a - b);
  const eR = mean(retained), sdR = sd(retained);
  console.log(`  MC (${retained.length.toLocaleString()} trials): E[retained] $${(eR / 1e6).toFixed(2)}M   SD $${(sdR / 1e6).toFixed(2)}M   CV ${(sdR / eR).toFixed(3)}`);

  console.log(`\n  candidate    fires (MC)`);
  for (const m of [8, 10, 12, 14, 16, 17, 18, 20, 24]) {
    const lvl = m * 1e6;
    const ex = retained.filter(x => x > lvl).length / retained.length;
    console.log(`  $${String(m).padStart(2)}M       ${(ex * 100).toFixed(1).padStart(5)}%  (~1-in-${(1 / Math.max(ex, 1e-6)).toFixed(1)})`);
  }
  console.log(`\n  CHOSEN: AGG_ATTACHMENT_LEVELS.Property = [${LEVELS.join(', ')}]`);
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const q = quoteAggregate('Property', [true], members, expectedGrossLoss, lv, 8);
    const ex = retained.filter(x => x > q.attachment).length / retained.length;
    console.log(`    level ${lv} (${LEVELS[lv]}x E[R]): attaches at $${(q.attachment / 1e6).toFixed(0)}M, fires ${(ex * 100).toFixed(1)}% at this book`);
  }
}

// ===========================================================================
console.log(`\n=== SECTION 2: Panjer vs lognormal, ${N_SEEDS} seeds x ${TRIALS.toLocaleString()} MC trials ===\n`);
{
  function lognormalLayerExpected(m: number, cv: number, a: number, b: number): number {
    const M0a = lognormalPartialMoment(m, cv, 0, a), M0b = lognormalPartialMoment(m, cv, 0, b);
    const M1a = lognormalPartialMoment(m, cv, 1, a), M1b = lognormalPartialMoment(m, cv, 1, b);
    return Math.max(0, (M1b - M1a) - a * (M0b - M0a) + (b - a) * (1 - M0b));
  }

  const panjerErr: number[][] = LEVELS.map(() => []);
  const lognormalErr: number[][] = LEVELS.map(() => []);
  const perSeedSE: number[][] = LEVELS.map(() => []);

  for (const seed of SEEDS) {
    const { members, kPr, expectedGrossLoss } = enrolledPropertyBook(seed, 8);
    const retained = mcRetained(members, kPr, TRIALS);
    const cvMoments = retainedRiskMoments('Property', [true], members, 8);

    for (let lv = 0; lv < LEVELS.length; lv++) {
      const q = quoteAggregate('Property', [true], members, expectedGrossLoss, lv, 8);
      const ceded = retained.map(x => Math.min(Math.max(0, x - q.attachment), q.limit));
      const mcE = mean(ceded);
      if (!(mcE > 0)) continue;
      // Standard error of THIS seed's MC estimate — printed so the reported
      // error can be read against its own resolution.
      perSeedSE[lv].push(sd(ceded) / Math.sqrt(TRIALS) / mcE * 100);
      panjerErr[lv].push((q.expectedCeded / mcE - 1) * 100);
      lognormalErr[lv].push(
        (lognormalLayerExpected(q.expectedRetained, cvMoments.sdOverExpected, q.attachment, q.attachment + q.limit) / mcE - 1) * 100);
    }
  }

  console.log('  level   n    per-seed MC SE   Panjer mean err (SE of mean)   lognormal mean err (SE of mean)');
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const p = panjerErr[lv], l = lognormalErr[lv];
    const pSE = sd(p) / Math.sqrt(p.length), lSE = sd(l) / Math.sqrt(l.length);
    console.log(`  L${lv}    ${String(p.length).padStart(4)}   ${mean(perSeedSE[lv]).toFixed(2).padStart(6)}%          ` +
      `${(mean(p) >= 0 ? '+' : '')}${mean(p).toFixed(2)}% (+/-${pSE.toFixed(2)})            ` +
      `${(mean(l) >= 0 ? '+' : '')}${mean(l).toFixed(2)}% (+/-${lSE.toFixed(2)})`);
  }

  console.log('\n  --- signs, which is the property that matters ---');
  let panjerSignStable = true;
  for (let lv = 0; lv < LEVELS.length; lv++) {
    const p = panjerErr[lv], l = lognormalErr[lv];
    const pPos = p.filter(x => x > 0).length, lPos = l.filter(x => x > 0).length;
    console.log(`  L${lv}: Panjer positive on ${pPos}/${p.length} seeds   lognormal positive on ${lPos}/${l.length}`);
  }
  const panjerMeans = LEVELS.map((_, lv) => mean(panjerErr[lv]));
  const lognormalMeans = LEVELS.map((_, lv) => mean(lognormalErr[lv]));
  panjerSignStable = panjerMeans.every(m => m > 0) || panjerMeans.every(m => m < 0);
  const lognormalSignStable = lognormalMeans.every(m => m > 0) || lognormalMeans.every(m => m < 0);
  console.log(`\n  Panjer mean error keeps one sign across levels: ${panjerSignStable}   [${panjerMeans.map(m => m.toFixed(2)).join(', ')}]`);
  console.log(`  lognormal mean error keeps one sign across levels: ${lognormalSignStable}   [${lognormalMeans.map(m => m.toFixed(2)).join(', ')}]`);
  console.log(`  A SIGN-CHANGING error cannot be corrected by a loading factor; a one-directional`);
  console.log(`  one can. That, not raw magnitude, is why the aggregate is Panjer-priced.`);

  const worstPanjer = Math.max(...panjerMeans.map(Math.abs));
  const worstLognormal = Math.max(...lognormalMeans.map(Math.abs));
  console.log('');
  check(worstPanjer < worstLognormal, 'Panjer\'s worst mean error is smaller than lognormal\'s',
    `${worstPanjer.toFixed(2)}% vs ${worstLognormal.toFixed(2)}%`);
  check(panjerSignStable, 'Panjer\'s mean error does not change sign across attachment levels');
  check(worstPanjer < 8, 'Panjer\'s worst mean error is within 8% (the residual is the NegBin ' +
    'moment-match and the neutral-RQ severity basis, not discretisation)', `${worstPanjer.toFixed(2)}%`);
}

console.log('');
if (failures > 0) { console.log(`${failures} CHECK(S) FAILED.`); process.exit(1); }
console.log('ALL PROPERTY TOWER MC CHECKS PASS.');
