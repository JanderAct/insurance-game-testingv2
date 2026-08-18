// TWO-LINE POOL — the first measurement of WC and GL sharing a pool.
//
//   npx tsx scripts/diagnostics/two-line-pool-run.ts
//
// WORKTREE-ONLY. Not a shipping diagnostic, not for claims-distribution.
//
// CONFIGURATION: WC and GL, no Property (still on the legacy path at roughly a
// tenth of correct premium — it would contaminate every pool-level figure).
// 10-year games, NO reinsurance on either line, 60% funding stop on both,
// defaults elsewhere. 50 games, this run's own seeds.
//
// ⚠ THE INTER-LINE LOAN IS EXERCISED, NOT JUST OBSERVED. No diagnostic before
// this one could exercise it — every prior run was single-line, and a loan
// needs a second line to lend from. processYear returns loanOffers that a
// player resolves separately via applyLoanAuthorizations; nothing in the brief
// specifies a player policy, so this harness AUTHORIZES EVERY OFFER. That is a
// choice, stated here rather than buried in the code: declining every offer
// would make the mechanism untestable by construction (0 loans, trivially),
// which answers a different question than "does it fire and for how much".
//
// BASIS NOTES CARRIED FROM EARLIER VERIFICATION:
//   - WC's commonLossFactor is pinned to 1 (the severity rebuild removed WC's
//     dependence on the pool-year factor); GL still consumes it. Both lines'
//     LineYearContext receives the SAME single per-year gPool draw (keyed
//     'wc_gpool', a stale label from before the split), but WC discards it.
//     So the two lines' claim generation is independent by construction, and
//     Q2 below tests whether that holds in what's actually drawn.
//   - GL's blended CV is high enough (raw severity CV ~21.8, annual-loss CV
//     predicted ~1.7) that NO ground-up dollar mean here carries a trustworthy
//     CI (finding 26). Reported with quantiles; gated nothing.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear, applyLoanAuthorizations } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';
import type { TowerLine } from '../../src/data/reinsuranceTower';

const GAMES = 50;
const YEARS = 10;
const LINES: CoverageLine[] = ['WC', 'GL'];

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
// A generator distinct from every other harness's, this session's or prior.
const SEEDS = Array.from({ length: GAMES }, (_, i) => (((i + 17) * 2971215073) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));

function decisions(y: number) {
  const d = defaultDecisionSet(y);
  for (const line of LINES) {
    const ld = d.byLine[line];
    ld.fundingConfidenceLevel = 0.60;
    ld.layersPlaced = REINSURANCE_TOWER[line as TowerLine].map(() => false); // decline every layer
    ld.aggregateStopLevel = -1;                                  // and the aggregate
  }
  return d;
}

const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
};
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const cov = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let s = 0; for (let i = 0; i < xs.length; i++) s += (xs[i] - mx) * (ys[i] - my); return s / Math.max(1, xs.length - 1); };
const corr = (xs: number[], ys: number[]) => { const c = cov(xs, ys), sx = sd(xs), sy = sd(ys); return sx > 0 && sy > 0 ? c / (sx * sy) : NaN; };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface LineYear { loss: number; expected: number; premium: number; exposure: number; cr: number; endingSurplus: number; retainedAboveTower: number; }
interface GameOut {
  s0Pool: number; s0ByLine: Record<CoverageLine, number>;
  sEndPool: number; sEndByLine: Record<CoverageLine, number>;
  uw: number; inv: number; premiumFinalPool: number;
  byLine: Record<CoverageLine, LineYear[]>;
  poolCrByYear: number[]; poolPremiumByYear: number[]; poolExposureByYear: number[];
  glShareByYear: number[];
  loans: { year: number; borrower: CoverageLine; lender: CoverageLine; amount: number; lenderShare: number }[];
  worstLineByYear: { year: number; line: CoverageLine; loss: number }[];
  poolSurplusByYear: number[];
}

console.log('='.repeat(78));
console.log(`TWO-LINE POOL — ${GAMES} games x ${YEARS} years, WC + GL, NO reinsurance either line,`);
console.log(`  60% funding stop both lines, defaults elsewhere. This run's own seeds.`);
console.log(`  LOAN POLICY: every offer is authorized (see header — this is a stated choice).`);
console.log('='.repeat(78));

const out: GameOut[] = [];
let offersExtended = 0;
const t0 = Date.now();

for (let gi = 0; gi < SEEDS.length; gi++) {
  const id = SEEDS[gi];
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  const s0ByLine = { WC: poolState.lines.WC.surplus, GL: poolState.lines.GL.surplus } as Record<CoverageLine, number>;
  const s0Pool = s0ByLine.WC + s0ByLine.GL;
  const byLine: Record<CoverageLine, LineYear[]> = { WC: [], GL: [], Property: [] } as never;
  const poolCrByYear: number[] = [], poolPremiumByYear: number[] = [], poolExposureByYear: number[] = [], glShareByYear: number[] = [];
  const loans: GameOut['loans'] = [];
  const worstLineByYear: GameOut['worstLineByYear'] = [];
  const poolSurplusByYear: number[] = [];
  let uw = 0, inv = 0, premiumFinalPool = 0;

  for (let y = 1; y <= YEARS; y++) {
    let p = processYear(gs, decisions(y));

    if (p.loanOffers.length > 0) {
      offersExtended += p.loanOffers.length;
      const authorize = p.loanOffers.map(o => o.line);
      const applied = applyLoanAuthorizations(p, y, authorize);
      for (const offer of p.loanOffers) {
        for (const [lender, share] of Object.entries(offer.lenderShares)) {
          loans.push({ year: y, borrower: offer.line, lender: lender as CoverageLine, amount: offer.deficit * (share ?? 0), lenderShare: share ?? 0 });
        }
      }
      p = { ...p, updatedPoolState: applied.updatedPoolState, result: applied.result };
    }

    const r: ResultSet = p.result;
    for (const line of LINES) {
      const lr = r.byLine[line]!;
      byLine[line].push({
        loss: lr.grossUltimateLoss, expected: lr.expectedLoss, premium: lr.totalMemberCharge,
        exposure: lr.activeExposure, cr: lr.actualCombinedRatio, endingSurplus: lr.endingSurplus,
        retainedAboveTower: lr.retainedAboveTower ?? 0,
      });
    }
    poolCrByYear.push(r.actualCombinedRatio);
    poolPremiumByYear.push(r.totalMemberCharge);
    poolExposureByYear.push(r.activeExposure);
    const glPrem = r.byLine.GL!.totalMemberCharge;
    glShareByYear.push(r.totalMemberCharge > 0 ? glPrem / r.totalMemberCharge : NaN);
    uw += r.underwritingIncome;
    inv += r.investmentIncome;
    premiumFinalPool = r.totalMemberCharge;
    poolSurplusByYear.push(r.endingSurplus);

    const wcLoss = r.byLine.WC!.grossUltimateLoss, glLoss = r.byLine.GL!.grossUltimateLoss;
    worstLineByYear.push({ year: y, line: glLoss >= wcLoss ? 'GL' : 'WC', loss: Math.max(wcLoss, glLoss) });

    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, r] };
  }

  const sEndByLine = { WC: gs.poolState.lines.WC.surplus, GL: gs.poolState.lines.GL.surplus } as Record<CoverageLine, number>;
  const sEndPool = sEndByLine.WC + sEndByLine.GL;

  out.push({ s0Pool, s0ByLine, sEndPool, sEndByLine, uw, inv, premiumFinalPool, byLine, poolCrByYear, poolPremiumByYear, poolExposureByYear, glShareByYear, loans, worstLineByYear, poolSurplusByYear });
  if ((gi + 1) % 10 === 0) console.log(`  ...${gi + 1}/${GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('1. IS THE POOL JUST GL? — annual loss CV per line and pool, variance shares  [ENROLLED, GROSS]');
console.log('-'.repeat(78));
console.log('  yr    WC mean/SD/CV($M)          GL mean/SD/CV($M)          Pool CV    WC var%   GL var%');
const cvWCbyYear: number[] = [], cvGLbyYear: number[] = [], cvPoolbyYear: number[] = [], wcVarShare: number[] = [], glVarShare: number[] = [];
for (let y = 0; y < YEARS; y++) {
  const wc = out.map(g => g.byLine.WC[y].loss), gl = out.map(g => g.byLine.GL[y].loss);
  const pool = wc.map((x, i) => x + gl[i]);
  const mWc = mean(wc) / 1e6, sWc = sd(wc) / 1e6, mGl = mean(gl) / 1e6, sGl = sd(gl) / 1e6;
  const vWc = sd(wc) ** 2, vGl = sd(gl) ** 2, vCov = cov(wc, gl), vPool = sd(pool) ** 2;
  const poolCv = sd(pool) / mean(pool);
  cvWCbyYear.push(sWc / mWc); cvGLbyYear.push(sGl / mGl); cvPoolbyYear.push(poolCv);
  wcVarShare.push(vWc / vPool); glVarShare.push(vGl / vPool);
  console.log(`  ${String(y + 1).padStart(2)}    $${mWc.toFixed(2).padStart(6)} / $${sWc.toFixed(2).padStart(6)} / ${(sWc / mWc).toFixed(2).padStart(4)}      $${mGl.toFixed(2).padStart(6)} / $${sGl.toFixed(2).padStart(6)} / ${(sGl / mGl).toFixed(2).padStart(4)}      ${poolCv.toFixed(2).padStart(5)}    ${pct(vWc / vPool).padStart(6)}   ${pct(vGl / vPool).padStart(6)}   (cov term ${pct(2 * vCov / vPool)})`);
}
console.log(`\n  median across years: WC CV ${q(cvWCbyYear, 0.5).toFixed(2)} (prediction ~0.40)   GL CV ${q(cvGLbyYear, 0.5).toFixed(2)} (prediction ~1.7)   Pool CV ${q(cvPoolbyYear, 0.5).toFixed(2)} (prediction ~1.14)`);
console.log(`  median variance share: WC ${pct(q(wcVarShare, 0.5))}   GL ${pct(q(glVarShare, 0.5))} (prediction: GL ~99% of variance)`);
console.log(`  ⚠ CV and variance-share denominators use the SAMPLE SD across 50 games at a fixed year —`);
console.log(`    this avoids conflating the decade's trend growth with year-to-year volatility.`);
console.log(`  ⚠ GL's per-year CV swings 0.68 to 1.82 across the ten rows above — at n=50 and a heavy`);
console.log(`    right tail, the SAMPLE SD ITSELF is a noisy estimator (finding 26 applies to variance`);
console.log(`    estimates, not just means). A larger, trend-neutral estimate below.`);
{
  // loss/expected is unitless and removes both severity trend and the
  // enrollment-driven exposure trend (expected is computed on THAT year's
  // own enrolled roster), so all 10 years' worth of line-years can be pooled
  // into one n=500 CV estimate without conflating level growth with spread.
  const ratioCv = (line: CoverageLine) => {
    const r = out.flatMap(g => g.byLine[line].map(ly => ly.loss / ly.expected));
    return { cv: sd(r) / mean(r), n: r.length };
  };
  const wcR = ratioCv('WC'), glR = ratioCv('GL');
  console.log(`  pooled drawn/expected CV (n=500, trend-neutral): WC ${wcR.cv.toFixed(2)}   GL ${glR.cv.toFixed(2)}`);
  console.log(`    reads as an independent estimate of the same CV the per-year rows above are estimating.`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('2. DIVERSIFICATION — correlation of the two lines\' combined ratios, all 500 game-years  [ENROLLED, NET=GROSS]');
console.log('-'.repeat(78));
{
  const wcCrAll = out.flatMap(g => g.byLine.WC.map(ly => ly.cr));
  const glCrAll = out.flatMap(g => g.byLine.GL.map(ly => ly.cr));
  const r = corr(wcCrAll, glCrAll);
  const n = wcCrAll.length;
  // Fisher z CI
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  const seZ = 1 / Math.sqrt(n - 3);
  const zLo = z - 1.96 * seZ, zHi = z + 1.96 * seZ;
  const rLo = Math.tanh(zLo), rHi = Math.tanh(zHi);
  console.log(`  pooled, n=${n}: r = ${r.toFixed(4)}   95% CI [${rLo.toFixed(4)}, ${rHi.toFixed(4)}]`);
  console.log(`  ${Math.abs(r) < 0.10 ? 'NEAR ZERO, as expected — the shared gPool draw has no effect because WC pins commonLossFactor to 1' : 'NOT NEAR ZERO — something links the lines that the code review said should not exist, investigate'}`);
  console.log('\n  by year (50 obs each — noisy on its own, shown for a trend check):');
  console.log('  yr    r        95% CI');
  for (let y = 0; y < YEARS; y++) {
    const wc = out.map(g => g.byLine.WC[y].cr), gl = out.map(g => g.byLine.GL[y].cr);
    const ry = corr(wc, gl);
    const zy = 0.5 * Math.log((1 + ry) / (1 - ry)), sey = 1 / Math.sqrt(GAMES - 3);
    console.log(`  ${String(y + 1).padStart(2)}    ${ry.toFixed(3).padStart(6)}   [${Math.tanh(zy - 1.96 * sey).toFixed(3)}, ${Math.tanh(zy + 1.96 * sey).toFixed(3)}]`);
  }
  // also the raw loss (dollar) correlation for completeness, since CR ratio removes size effects
  const wcLossAll = out.flatMap(g => g.byLine.WC.map(ly => ly.loss));
  const glLossAll = out.flatMap(g => g.byLine.GL.map(ly => ly.loss));
  console.log(`\n  same test on raw dollar loss (not ratio, so trend-in-level is NOT removed): r = ${corr(wcLossAll, glLossAll).toFixed(4)}`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('3. DOES THE MIX SHIFT? — premium, exposure, GL share of pool premium, by year  [ENROLLED]');
console.log('-'.repeat(78));
console.log('  yr    WC premium    GL premium    WC exposure($M)   GL exposure($M)   GL share of pool premium');
for (let y = 0; y < YEARS; y++) {
  const wcP = out.map(g => g.byLine.WC[y].premium), glP = out.map(g => g.byLine.GL[y].premium);
  const wcE = out.map(g => g.byLine.WC[y].exposure), glE = out.map(g => g.byLine.GL[y].exposure);
  const share = out.map(g => g.glShareByYear[y]);
  console.log(`  ${String(y + 1).padStart(2)}    ${fmt$(q(wcP, 0.5)).padStart(9)}     ${fmt$(q(glP, 0.5)).padStart(9)}     ${q(wcE, 0.5).toFixed(1).padStart(9)}         ${q(glE, 0.5).toFixed(1).padStart(9)}         ${pct(q(share, 0.5)).padStart(7)}`);
}
console.log(`\n  GL share of pool premium: Y1 median ${pct(q(out.map(g => g.glShareByYear[0]), 0.5))}   Y${YEARS} median ${pct(q(out.map(g => g.glShareByYear[YEARS - 1]), 0.5))}`);
console.log(`  PREDICTION: 66.7% -> 73.2%`);

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('4. POOL SURPLUS — 10-year multiple, vs the single-line runs  [ENROLLED, NET]');
console.log('-'.repeat(78));
const mult = out.map(g => g.sEndPool / g.s0Pool);
const belowStart = out.filter(g => g.sEndPool < g.s0Pool).length;
console.log(`  min ${q(mult, 0).toFixed(2)}   p10 ${q(mult, 0.1).toFixed(2)}   median ${q(mult, 0.5).toFixed(2)}   p90 ${q(mult, 0.9).toFixed(2)}   max ${Math.max(...mult).toFixed(2)}   mean ${mean(mult).toFixed(2)}`);
console.log(`  below start: ${belowStart}/${GAMES} = ${pct(belowStart / GAMES)}`);
console.log(`  WC ALONE (reference): median 2.15, 22% below start   GL ALONE (4f695a0, reference): median 3.31, 16% below start`);
const uwS0 = out.map(g => g.uw / g.s0Pool), invS0 = out.map(g => g.inv / g.s0Pool);
console.log(`  underwriting / S0   median ${q(uwS0, 0.5).toFixed(2)}   mean ${mean(uwS0).toFixed(2)}`);
console.log(`  investment   / S0   median ${q(invS0, 0.5).toFixed(2)}   mean ${mean(invS0).toFixed(2)}`);
console.log(`  starting pool surplus median ${fmt$(q(out.map(g => g.s0Pool), 0.5))} (WC ${fmt$(q(out.map(g => g.s0ByLine.WC), 0.5))} + GL ${fmt$(q(out.map(g => g.s0ByLine.GL), 0.5))})`);

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('5. DOES EITHER LINE EVER SINK THE POOL ALONE?  [ENROLLED, GROSS/NET]');
console.log('-'.repeat(78));
{
  const worstCounts: Record<CoverageLine, number> = { WC: 0, GL: 0, Property: 0 };
  for (const g of out) for (const w of g.worstLineByYear) worstCounts[w.line]++;
  console.log(`  worst-loss line, by line-year (${GAMES * YEARS} total): WC ${worstCounts.WC} (${pct(worstCounts.WC / (GAMES * YEARS))})   GL ${worstCounts.GL} (${pct(worstCounts.GL / (GAMES * YEARS))})`);

  // games where pool surplus went negative at some point
  let poolNegGames = 0, poolNegGL = 0, poolNegWC = 0, poolNegBoth = 0;
  for (const g of out) {
    const negYears = g.poolSurplusByYear.map((s, y) => ({ s, y })).filter(x => x.s < 0);
    if (negYears.length === 0) continue;
    poolNegGames++;
    for (const { y } of negYears) {
      const wcBad = g.byLine.WC[y].loss > g.byLine.WC[y].expected * 1.5;
      const glBad = g.byLine.GL[y].loss > g.byLine.GL[y].expected * 1.5;
      if (glBad && !wcBad) poolNegGL++;
      else if (wcBad && !glBad) poolNegWC++;
      else if (wcBad && glBad) poolNegBoth++;
    }
  }
  console.log(`\n  games with pool surplus negative in ANY year: ${poolNegGames}/${GAMES}`);
  console.log(`  of the negative-surplus (year) instances: GL alone bad (>1.5x its own expected) ${poolNegGL}, WC alone bad ${poolNegWC}, both bad ${poolNegBoth}`);
  console.log(`  ("bad" = drawn > 1.5x that line's own expected loss that year, ENROLLED basis)`);

  // GL retained-above-tower correlation with pool going negative
  const ratWhenNeg: number[] = [], ratWhenNotNeg: number[] = [];
  for (const g of out) for (let y = 0; y < YEARS; y++) {
    (g.poolSurplusByYear[y] < 0 ? ratWhenNeg : ratWhenNotNeg).push(g.byLine.GL[y].retainedAboveTower);
  }
  console.log(`\n  GL retainedAboveTower ($1M+ over $25M would be visible here — GL's tower stops at $25M, unlimited above):`);
  console.log(`    mean when pool surplus that year is negative:     ${fmt$(mean(ratWhenNeg))}  (n=${ratWhenNeg.length}, ${ratWhenNeg.filter(x => x > 0).length} nonzero)`);
  console.log(`    mean when pool surplus that year is NOT negative: ${fmt$(mean(ratWhenNotNeg))}  (n=${ratWhenNotNeg.length}, ${ratWhenNotNeg.filter(x => x > 0).length} nonzero)`);
  console.log(`    (means INDICATIVE ONLY — unbounded band; the nonzero counts are the trustworthy signal)`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('6. THE INTER-LINE LOAN — exercised for the first time  [ENROLLED, NET]');
console.log('-'.repeat(78));
{
  const allLoans = out.flatMap(g => g.loans);
  console.log(`  offers extended (deficit lines with a viable lender): ${offersExtended} across ${GAMES * YEARS} line-years`);
  console.log(`  loan originations (this harness authorizes every offer): ${allLoans.length}`);
  if (allLoans.length > 0) {
    const byBorrower: Record<string, number> = {};
    for (const l of allLoans) byBorrower[l.borrower] = (byBorrower[l.borrower] ?? 0) + 1;
    console.log(`  by borrowing line: ${Object.entries(byBorrower).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const amounts = allLoans.map(l => l.amount);
    console.log(`  amount per lender-share: min ${fmt$(Math.min(...amounts))}  median ${fmt$(q(amounts, 0.5))}  max ${fmt$(Math.max(...amounts))}  total ${fmt$(amounts.reduce((a, b) => a + b, 0))}`);
    console.log(`  by year fired:`);
    const byYear: Record<number, number> = {};
    for (const l of allLoans) byYear[l.year] = (byYear[l.year] ?? 0) + 1;
    for (let y = 1; y <= YEARS; y++) if (byYear[y]) console.log(`    year ${y}: ${byYear[y]} lender-legs`);
    console.log(`\n  sample originations:`);
    for (const l of allLoans.slice(0, 8)) console.log(`    year ${l.year}: ${l.borrower} borrows from ${l.lender} (share ${(l.lenderShare * 100).toFixed(0)}%), ${fmt$(l.amount)}`);
  } else {
    console.log(`  NO LOANS FIRED in ${GAMES} games x ${YEARS} years. Either no line ever ended a year deficient`);
    console.log(`  while the other had capacity, or deficits exceeded total lender capacity every time they`);
    console.log(`  occurred. Cross-check against section 5's negative-surplus count above: if lines went`);
    console.log(`  negative but no offer appeared, the mechanism was never exercised by this configuration`);
    console.log(`  and remains unverified in practice, not merely untested.`);
  }
}

console.log('\n' + '='.repeat(78));
console.log(`DONE — measurement only. No parameter, constant or generator was changed. ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('='.repeat(78));
