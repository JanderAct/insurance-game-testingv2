// GL SEVERITY-TREND BEHAVIOUR RUN — is a 2.0% social-inflation baseline too
// much for a ten-year game?
//
//   npx tsx scripts/diagnostics/gl-trend-behaviour-run.ts
//
// WORKTREE-ONLY. Not a shipping diagnostic, not for claims-distribution.
//
// THE QUESTION. GL's trend pair is RATE-NEUTRAL BY CONSTRUCTION: severity
// x1.6473 over nine periods, nominal payroll x1.3784, so the rate rises only by
// the real difference (+19.5%, the social-inflation half). But SURPLUS IS A
// DOLLAR QUANTITY against a fixed starting balance, and premium grows x1.6473
// while the opening capital does not grow at all. Leverage should therefore
// deteriorate even though pricing is "correct" every year. WC saw exactly this
// when wage inflation landed: below-start 22 -> 26 of 100, leverage -23.6%.
//
// ⚠ SEEDS ARE THIS RUN'S OWN. The 72ecaa0 baseline figures came from another
// session and its seeds are not available here, so this is a DISTRIBUTIONAL
// comparison, not a paired one. At n=50 that is adequate for reading a shift in
// the body of the distribution; it is NOT adequate for min/max, which are single
// observations, or for the >$25M band, which fires ~0.05 times a year.
//
// ⚠ WHAT IS GATED AND WHAT IS NOT. GL's blended CV is 29.55 and its
// retained-above-tower band is UNLIMITED, so no ground-up sample mean here
// carries a trustworthy CI (finding 26). Quantiles are reported throughout;
// where a tight figure is needed the $1M-CAPPED proxy is used, whose per-claim
// variance is bounded. Nothing in this file is a gate — it is a measurement.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import { GL_SEVERITY_TREND_PER_YEAR } from '../../src/utils/glClaimEngine';
import { WAGE_INFLATION_PER_YEAR, wageFactor } from '../../src/data/exposureTrend';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = 50;
const YEARS = 10;
const LINES: CoverageLine[] = ['GL'];
const CAP = 1_000_000;

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
// A generator distinct from every shipping harness's, so this run is not
// accidentally a superset of gl-cutover-check's 40 seeds.
const SEEDS = Array.from({ length: GAMES }, (_, i) => (((i + 11) * 3266489917) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));

function decisions(y: number) {
  const d = defaultDecisionSet(y);
  const gl = d.byLine.GL;
  gl.fundingConfidenceLevel = 0.60;
  gl.layersPlaced = REINSURANCE_TOWER.GL.map(() => false); // decline every layer
  gl.aggregateStopLevel = -1;                              // and the aggregate
  return d;
}

const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
};
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const ci95 = (xs: number[]) => 1.96 * sd(xs) / Math.sqrt(Math.max(1, xs.length));
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface GameOut {
  s0: number; sEnd: number; uw: number; inv: number;
  premiumFinal: number; premiumTotal: number;
  chargeByYear: number[]; exposureByYear: number[];
  crByYear: number[]; ratByYear: number[];
  drawnOverExpected: number[]; cappedDrawn: number[]; cappedExpected: number[];
  over25: number; largestClaim: number; ratTotal: number;
}

console.log('='.repeat(78));
console.log(`GL TREND BEHAVIOUR — ${GAMES} games x ${YEARS} years, GL ONLY, NO reinsurance, 60% funding stop`);
console.log(`  GL_SEVERITY_TREND_PER_YEAR = ${GL_SEVERITY_TREND_PER_YEAR}  (x${Math.pow(1 + GL_SEVERITY_TREND_PER_YEAR, YEARS - 1).toFixed(4)} over ${YEARS - 1} periods)`);
console.log(`  WAGE_INFLATION_PER_YEAR    = ${WAGE_INFLATION_PER_YEAR}  (x${wageFactor('GL', YEARS).toFixed(4)})`);
console.log(`  implied rate trend         = x${(Math.pow(1 + GL_SEVERITY_TREND_PER_YEAR, YEARS - 1) / wageFactor('GL', YEARS)).toFixed(4)} real over the decade`);
console.log(`  SEEDS ARE THIS RUN'S OWN — distributional comparison, not paired.`);
console.log('='.repeat(78));

const out: GameOut[] = [];
const t0 = Date.now();

for (let gi = 0; gi < SEEDS.length; gi++) {
  const id = SEEDS[gi];
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'T', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const s0 = poolState.lines.GL.surplus;
  let uw = 0, inv = 0, premiumTotal = 0, over25 = 0, largest = 0, ratTotal = 0, sEnd = s0, premiumFinal = 0;
  const chargeByYear: number[] = [], exposureByYear: number[] = [], crByYear: number[] = [], ratByYear: number[] = [];
  const drawnOverExpected: number[] = [], cappedDrawn: number[] = [], cappedExpected: number[] = [];

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, decisions(y));
    const gl = p.result.byLine.GL!;
    uw += gl.underwritingIncome;
    inv += gl.investmentIncome;
    premiumTotal += gl.totalMemberCharge;
    premiumFinal = gl.totalMemberCharge;
    sEnd = gl.endingSurplus;
    chargeByYear.push(gl.totalMemberCharge);
    exposureByYear.push(gl.activeExposure);
    crByYear.push(gl.actualCombinedRatio);
    ratByYear.push(gl.retainedAboveTower ?? 0);
    ratTotal += gl.retainedAboveTower ?? 0;
    if (gl.expectedLoss > 0) drawnOverExpected.push(gl.grossUltimateLoss / gl.expectedLoss);
    const claims = gl.claims ?? [];
    cappedDrawn.push(claims.reduce((s, c) => s + Math.min(c.grossUltimate, CAP), 0));
    cappedExpected.push(gl.expectedLoss);
    for (const c of claims) { if (c.grossUltimate > 25e6) over25++; if (c.grossUltimate > largest) largest = c.grossUltimate; }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  out.push({ s0, sEnd, uw, inv, premiumFinal, premiumTotal, chargeByYear, exposureByYear, crByYear, ratByYear, drawnOverExpected, cappedDrawn, cappedExpected, over25, largestClaim: largest, ratTotal });
  if ((gi + 1) % 10 === 0) console.log(`  ...${gi + 1}/${GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const mult = out.map(g => g.sEnd / g.s0);
const belowStart = out.filter(g => g.sEnd < g.s0).length;

console.log('\n' + '-'.repeat(78));
console.log('1. SURPLUS MULTIPLE (ending GL surplus / starting GL surplus)  [ENROLLED, NET]');
console.log('-'.repeat(78));
console.log(`  min ${q(mult, 0).toFixed(2)}   p10 ${q(mult, 0.10).toFixed(2)}   median ${q(mult, 0.5).toFixed(2)}   p90 ${q(mult, 0.90).toFixed(2)}   max ${Math.max(...mult).toFixed(2)}   mean ${mean(mult).toFixed(2)}`);
console.log(`  BASELINE (72ecaa0, no trend):`);
console.log(`  min -8.85   p10 0.46   median 2.85   p90 4.24   max 5.73   mean 2.13`);
console.log(`\n  below start: ${belowStart}/${GAMES} = ${pct(belowStart / GAMES)}    BASELINE 10/50 = 20%`);

console.log('\n' + '-'.repeat(78));
console.log('2. INCOME SPLIT, as a multiple of STARTING surplus  [ENROLLED, NET]');
console.log('-'.repeat(78));
const uwS0 = out.map(g => g.uw / g.s0), invS0 = out.map(g => g.inv / g.s0);
console.log(`  underwriting / S0   median ${q(uwS0, 0.5).toFixed(2)}   mean ${mean(uwS0).toFixed(2)}   (baseline median +0.55, mean -0.09)`);
console.log(`  investment   / S0   median ${q(invS0, 0.5).toFixed(2)}   mean ${mean(invS0).toFixed(2)}   (baseline median 1.32, mean 1.22)`);

console.log('\n' + '-'.repeat(78));
console.log('3. THE LEVERAGE MEASURE — ending surplus / final-year member charge  [READ FIRST]');
console.log('-'.repeat(78));
const lev = out.map(g => g.sEnd / Math.max(g.premiumFinal, 1));
console.log(`  min ${q(lev, 0).toFixed(2)}   p10 ${q(lev, 0.10).toFixed(2)}   median ${q(lev, 0.5).toFixed(2)}   p90 ${q(lev, 0.90).toFixed(2)}   max ${Math.max(...lev).toFixed(2)}`);
console.log(`  RATE-NEUTRAL MEANS SURPLUS AND PREMIUM SHOULD SCALE TOGETHER. If this sits below the`);
console.log(`  no-trend run's, the pool ends supporting a bigger book on the same capital.`);
console.log(`  (the 72ecaa0 baseline did not report this ratio; ending-surplus and final-premium`);
console.log(`   quantiles below let it be reconstructed if that run is ever re-run.)`);
console.log(`  ending GL surplus       median ${fmt$(q(out.map(g => g.sEnd), 0.5))}   p10 ${fmt$(q(out.map(g => g.sEnd), 0.1))}   p90 ${fmt$(q(out.map(g => g.sEnd), 0.9))}`);
console.log(`  final-year charge       median ${fmt$(q(out.map(g => g.premiumFinal), 0.5))}   p10 ${fmt$(q(out.map(g => g.premiumFinal), 0.1))}   p90 ${fmt$(q(out.map(g => g.premiumFinal), 0.9))}`);
console.log(`  starting GL surplus     median ${fmt$(q(out.map(g => g.s0), 0.5))}  (FIXED — does not inflate)`);

console.log('\n' + '-'.repeat(78));
console.log('4. MEMBER CHARGE AND ENROLLED EXPOSURE BY YEAR  [ENROLLED]');
console.log('-'.repeat(78));
console.log('  yr   median charge     vs Y1     median exposure($M)   vs Y1     wageFactor');
for (let y = 0; y < YEARS; y++) {
  const ch = out.map(g => g.chargeByYear[y]), ex = out.map(g => g.exposureByYear[y]);
  const ch1 = out.map(g => g.chargeByYear[0]), ex1 = out.map(g => g.exposureByYear[0]);
  console.log(`  ${String(y + 1).padStart(2)}   ${fmt$(q(ch, 0.5)).padStart(9)}   ${(q(ch, 0.5) / q(ch1, 0.5)).toFixed(4)}     ${q(ex, 0.5).toFixed(1).padStart(9)}         ${(q(ex, 0.5) / q(ex1, 0.5)).toFixed(4)}    ${wageFactor('GL', y + 1).toFixed(4)}`);
}
const chargeGrowth = q(out.map(g => g.chargeByYear[YEARS - 1]), 0.5) / q(out.map(g => g.chargeByYear[0]), 0.5);
console.log(`\n  median charge Y1 -> Y${YEARS}: x${chargeGrowth.toFixed(4)}   TARGET x1.6473 (the severity trend)`);
console.log(`  ⚠ CHARGE GROWTH IS NOT PURE TREND — membership churns, so the enrolled book changes size.`);
console.log(`    The exposure column separates the two: exposure/Y1 should track wageFactor if the book is`);
console.log(`    stable, and charge/Y1 should track wageFactor x rate trend = the severity trend.`);

console.log('\n' + '-'.repeat(78));
console.log('5. COMBINED RATIO BY YEAR  [ENROLLED, NET — no reinsurance, so net = gross]');
console.log('-'.repeat(78));
console.log('  yr   median CR    pooled mean CR   95% CI');
for (let y = 0; y < YEARS; y++) {
  const cr = out.map(g => g.crByYear[y]);
  console.log(`  ${String(y + 1).padStart(2)}   ${pct(q(cr, 0.5)).padStart(8)}     ${pct(mean(cr)).padStart(8)}      +/-${(ci95(cr) * 100).toFixed(1)}pp`);
}
const allCr = out.flatMap(g => g.crByYear);
console.log(`\n  POOLED across all ${allCr.length} line-years: median ${pct(q(allCr, 0.5))}   mean ${pct(mean(allCr))}   95% CI +/-${(ci95(allCr) * 100).toFixed(1)}pp`);
console.log(`  BASELINE pooled actual 101.7% +/-9.8pp (expected 100% every year)`);
console.log(`  ⚠ THE MEAN IS THE HEAVY-TAILED STATISTIC HERE. Median is the stable location.`);

console.log('\n' + '-'.repeat(78));
console.log('6. DRAWN / EXPECTED  [ENROLLED, GROSS]');
console.log('-'.repeat(78));
const doe = out.flatMap(g => g.drawnOverExpected);
const crossing = doe.filter(x => x < 1).length / doe.length;
console.log(`  crossing (below expected) ${pct(crossing)}   above expected ${pct(1 - crossing)}`);
console.log(`  BASELINE crossing 69.4%, 30.6% above expected`);
console.log(`  median ${q(doe, 0.5).toFixed(4)}   p90 ${q(doe, 0.9).toFixed(4)}   mean ${mean(doe).toFixed(4)} (mean NOT trustworthy, CV 29.55)`);
const capD = out.flatMap(g => g.cappedDrawn), capE = out.flatMap(g => g.cappedExpected);
const capRatio = capD.reduce((a, b) => a + b, 0) / capE.reduce((a, b) => a + b, 0);
console.log(`  $1M-CAPPED drawn / expected(uncapped) = ${capRatio.toFixed(4)} — the bounded proxy, reported for shape only`);

console.log('\n' + '-'.repeat(78));
console.log('7. THE TAIL: claims over $25M and the UNLIMITED retained-above-tower band  [ENROLLED, GROSS]');
console.log('-'.repeat(78));
const totalOver25 = out.reduce((s, g) => s + g.over25, 0);
console.log(`  claims over $25M: ${totalOver25} in ${GAMES * YEARS} enrolled game-years = ${(totalOver25 / (GAMES * YEARS)).toFixed(3)}/yr`);
console.log(`  BASELINE 0.054/yr enrolled, largest $517.7M`);
console.log(`  largest single claim across all games: ${fmt$(Math.max(...out.map(g => g.largestClaim)))}`);
const ratAll = out.flatMap(g => g.ratByYear);
console.log(`\n  retainedAboveTower per line-year: median ${fmt$(q(ratAll, 0.5))}   p90 ${fmt$(q(ratAll, 0.9))}   p99 ${fmt$(q(ratAll, 0.99))}   mean ${fmt$(mean(ratAll))}   max ${fmt$(Math.max(...ratAll))}`);
console.log(`  BASELINE median $0, p90 $0, mean $2.08M, max $492.7M`);
console.log(`  ⚠ MEAN IS INDICATIVE ONLY — this band is UNLIMITED, so its sample mean has no valid CI.`);
console.log(`\n  by year (the analytic says it grows +62% over the decade):`);
console.log('  yr   median      p90         mean(indicative)   line-years firing');
for (let y = 0; y < YEARS; y++) {
  const r = out.map(g => g.ratByYear[y]);
  const firing = r.filter(x => x > 0).length;
  console.log(`  ${String(y + 1).padStart(2)}   ${fmt$(q(r, 0.5)).padStart(8)}   ${fmt$(q(r, 0.9)).padStart(9)}   ${fmt$(mean(r)).padStart(12)}       ${firing}/${GAMES}`);
}
const firstHalf = out.flatMap(g => g.ratByYear.slice(0, 5)), secondHalf = out.flatMap(g => g.ratByYear.slice(5));
console.log(`\n  Y1-Y5 mean ${fmt$(mean(firstHalf))} (${firstHalf.filter(x => x > 0).length} firing)  vs  Y6-Y10 mean ${fmt$(mean(secondHalf))} (${secondHalf.filter(x => x > 0).length} firing)`);

console.log('\n' + '-'.repeat(78));
console.log('8. DEEPLY NEGATIVE GAMES — did the trend produce losses the no-trend run did not?');
console.log('-'.repeat(78));
const negative = out.map((g, i) => ({ i, m: g.sEnd / g.s0, rat: g.ratTotal })).filter(x => x.m < 0).sort((a, b) => a.m - b.m);
console.log(`  games ending with NEGATIVE surplus: ${negative.length}/${GAMES}`);
if (negative.length) {
  for (const n of negative.slice(0, 8)) console.log(`    seed ${SEEDS[n.i]}  multiple ${n.m.toFixed(2)}   retainedAboveTower over the game ${fmt$(n.rat)}`);
}
console.log(`  BASELINE min multiple -8.85 (so the no-trend run had at least one deeply negative game)`);
const worst = out.map((g, i) => ({ i, m: g.sEnd / g.s0, rat: g.ratTotal })).sort((a, b) => a.m - b.m).slice(0, 5);
console.log(`\n  five worst games this run:`);
for (const w of worst) console.log(`    seed ${SEEDS[w.i]}  multiple ${w.m.toFixed(2)}   retainedAboveTower over the game ${fmt$(w.rat)}`);

console.log('\n' + '='.repeat(78));
console.log(`DONE — measurement only. No parameter, constant or generator was changed. ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('='.repeat(78));
