// WC cutover verification through the REAL game engine.
//
// Complements wc-claim-check.ts: that one exercises the generator in
// isolation, this one drives the actual processYear loop across 40 seeds x 5
// live years and checks that claims survive the trip — sums tie to
// grossUltimateLoss, surplus reconciles, no non-finite fields — and that the
// pricing lands where it should.
//
//   npx tsx scripts/diagnostics/wc-cutover-check.ts 6b   # assert the ratio
//
// ⚠ MODE 6b IS RED AND THE SWEEP HAS NEVER SEEN IT. scripts/gates.ts runs this
// file with NO ARGUMENT, which is mode 6a, and the 66.8% analytic assertion
// below is inside `if (MODE === '6b')`. So the repo contains a hard assertion
// that fails and reports green. Measured at d1cef12, BEFORE the WC volatility
// work and in a clean worktree: ANALYTIC gross basis 112.21% against a 66.8%
// target, a 45pp gap. This is NOT a consequence of the year factor — the null
// arm (shape at 1e9, Vg to zero) reads 112.24% and the parent commit reads
// 112.21%. The year factor moves it to 115.47%, a +3.3pp contribution, through
// the reinsurance risk load in the premium denominator.
//
// RECORDED RATHER THAN FIXED, deliberately: whatever put the analytic ratio 45pp
// above its target is a pricing question that predates this work and closing it
// is its own ruling. What must not happen again is it being invisible. Do not
// "fix" this by deleting the 6b branch.
//   npx tsx scripts/diagnostics/wc-cutover-check.ts      # 6a: report only
//
// THE TWO-PART LOSS-RATIO CHECK (see docs/PROJECT_STATE_SUMMARY.md section 3).
// Pricing correctness decomposes into two independent propositions, and
// asserting them separately is STRICTER than asserting their product on a
// noisy realized mean:
//   (a) draw == analytic expectation — invariant 1, asserted by
//       wc-claim-check.ts at full-market scale.
//   (b) analytic ratio == 66.8%      — the finding-6 constraint, HARD
//       ASSERTED here; deterministic given the roster, zero draw noise.
// Together they imply realized ~ 66.8% IN EXPECTATION. The realized figure is
// REPORTED and flagged only if it drifts outside its own CI of the analytic,
// which WOULD be a genuine draw/expectation bug. Do not "restore" a +/-2pp
// band on the realized mean: WC's catastrophic annuity tier is lumpy enough
// that such a band fails on correct pricing about as often as not.
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { deriveNeutralPurePremiumPer100, expectedWcGrossLossForPricing, wcYearFactor } from '../../src/utils/wcClaimEngine';
import { WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import type { GameState, CoverageLine } from '../../src/types/simulation';

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const problems: string[] = [];
// 6a runs with the OLD pure premium still in place, so the loss ratio is
// EXPECTED to be wrong there; only 6b asserts it.
const MODE = process.argv[2] === '6b' ? '6b' : '6a';
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'OK' : 'FAIL'; };

const SEEDS = Array.from({ length: 40 }, (_, i) => (((i + 1) * 2654435761) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 5;

console.log(`=== WC CUTOVER through the real engine: ${SEEDS.length} seeds x ${YEARS} live years, default decisions ===\n`);
console.log(`held neutral purePremiumPer100 (full canonical roster @ RQ=5) = ${deriveNeutralPurePremiumPer100(getPredefinedMarketMembers()).toFixed(4)}\n`);

const wcNarrowLR: number[] = [];
const wcAnalyticLR: number[] = [];
const wcGrossLR: number[] = [];
const wcWideLR: number[] = [];
const perSeedNarrow: number[] = [];
const perSeedGross: number[] = [];
let maxTie = 0, claimSumErr = 0, lineYears = 0, nonFinite = 0;
let wcClaimsPerYear: number[] = [], wcGross: number[] = [], wcPremium: number[] = [];
let glGross: number[] = [], prGross: number[] = [], glPrem: number[] = [], prPrem: number[] = [];

for (const id of SEEDS) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const seedNarrow: number[] = [];
  const seedGross: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      const x = p.result.byLine[l];
      lineYears++;
      maxTie = Math.max(maxTie, Math.abs(x.surplusTieOutDifference));
      for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && !Number.isFinite(v)) { nonFinite++; console.log(`  NON-FINITE ${id} Y${y} ${l}.${k}`); }
      if (l === 'WC') {
        const narrow = x.netIncurredLoss / Math.max(x.poolPremiumAndAdminExpense, 1);
        wcNarrowLR.push(narrow); seedNarrow.push(narrow);
        // GROSS basis, the finding-6 comparable (6b ruling): reinsurance
        // recovery is active, so a NET numerator understates by design.
        const grossLR = x.grossUltimateLoss / Math.max(x.poolPremiumAndAdminExpense, 1);
        wcGrossLR.push(grossLR); seedGross.push(grossLR);
        // ANALYTIC basis: this enrolled book's own expected WC loss, no draw noise.
        const expNeutral = expectedWcGrossLossForPricing(x.memberList, { riskQualityOverride: 5, kLine: 1 });
        wcAnalyticLR.push(expNeutral / Math.max(x.poolPremiumAndAdminExpense, 1));
        wcWideLR.push(x.actualLossRatio);
        wcGross.push(x.grossUltimateLoss); wcPremium.push(x.poolPremium);
        if (x.claims) {
          claimSumErr = Math.max(claimSumErr, Math.abs(x.claims.reduce((s, c) => s + c.grossUltimate, 0) - x.grossUltimateLoss));
          wcClaimsPerYear.push(x.claims.length);
        } else problems.push(`${id} Y${y}: WC result carries no claims array`);
      } else if (l === 'GL') { glGross.push(x.grossUltimateLoss); glPrem.push(x.poolPremium); }
      else { prGross.push(x.grossUltimateLoss); prPrem.push(x.poolPremium); }
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  perSeedNarrow.push(mean(seedNarrow));
  perSeedGross.push(mean(seedGross));
}

console.log('--- claim integrity through the engine ---');
console.log(`  line-years processed: ${lineYears}   non-finite fields: ${nonFinite}  ${note(nonFinite === 0, 'non-finite result fields')}`);
console.log(`  max |sum(claims) - grossUltimateLoss|: $${claimSumErr.toFixed(6)}  ${note(claimSumErr < 0.01, 'claims do not sum to grossUltimateLoss')}`);
console.log(`  max |surplus tie-out|: ${maxTie.toExponential(2)}  ${note(maxTie < 1e-4, `tie-out ${maxTie}`)}`);
console.log(`  WC claims/yr (enrolled book): mean ${mean(wcClaimsPerYear).toFixed(1)}`);

console.log('\n--- WC loss ratio ---');
const m = mean(wcNarrowLR), s = sd(perSeedNarrow), ci = 1.96 * s / Math.sqrt(perSeedNarrow.length);
console.log(`  NARROW basis (netIncurredLoss / poolPremiumAndAdminExpense) — the finding-6 comparable`);
console.log(`    mean ${(m * 100).toFixed(2)}%   95% CI +/-${(ci * 100).toFixed(2)}pp across ${perSeedNarrow.length} seeds`);
console.log(`  WIDE basis (as displayed, denominator includes reinsuranceCost): ${(mean(wcWideLR) * 100).toFixed(2)}%`);
const above = wcNarrowLR.filter(r => r >= 0.668).length;
console.log(`  line-years at/above 66.8%: ${above}/${wcNarrowLR.length} (${(above / wcNarrowLR.length * 100).toFixed(0)}%) — centred means ~half`);
// ============================================================================
// THE MEAN IS HELD, AND IT IS ASSERTED RATHER THAN ARGUED.
//
// WC_LOSS_MODEL.wcYearFactor multiplies every WC member's arrival rate by one
// shared Gamma(shape, 1/shape) draw per year. Because scale = 1/shape the factor
// has mean EXACTLY 1, so the book's expected loss is untouched — which is what
// lets the held pure premium, the held class rates and k_line stand unchanged
// through a volatility change. That argument is worth nothing unasserted, and it
// is asserted here in the two ways that can actually fail.
//
// (1) STRUCTURAL, AND IT IS A PERTURBATION TEST. The pricing expectation must
//     not be able to SEE the factor at all. Perturbing the shape by a factor of
//     four and re-running expectedWcGrossLossForPricing must return a
//     BIT-IDENTICAL number. If it ever moves, the frequency channel has leaked
//     into the pricing side and the pure premium genuinely does re-derive —
//     which is the expensive outcome this check exists to catch early.
//
// (2) DISTRIBUTIONAL. The factor's own realised mean over many (seed, year)
//     pairs must sit on 1 within its CI. This catches a scale/shape mix-up,
//     which is the one way a Gamma "mean-one" factor is usually got wrong and
//     which the structural check above would not see.
console.log('\n--- THE YEAR FACTOR IS MEAN-ONE ---');
{
  const roster = getPredefinedMarketMembers();
  const before = expectedWcGrossLossForPricing(roster, { riskQualityOverride: 5, kLine: 1 });
  const keep = WC_LOSS_MODEL.wcYearFactor.shape;
  const keepScale = WC_LOSS_MODEL.wcYearFactor.scale;
  WC_LOSS_MODEL.wcYearFactor.shape = keep * 4;
  WC_LOSS_MODEL.wcYearFactor.scale = 1 / (keep * 4);
  const after = expectedWcGrossLossForPricing(roster, { riskQualityOverride: 5, kLine: 1 });
  WC_LOSS_MODEL.wcYearFactor.shape = keep;
  WC_LOSS_MODEL.wcYearFactor.scale = keepScale;
  console.log(`  [1] pricing expectation under a 4x perturbation of the shape:`);
  console.log(`      ${before.toFixed(6)} -> ${after.toFixed(6)}  ${before === after ? 'BIT-IDENTICAL' : 'MOVED'}`);
  if (before !== after) {
    problems.push(`the WC pricing expectation MOVED when wcYearFactor.shape was perturbed `
      + `(${before} -> ${after}). The volatility channel has leaked into the pricing side, so the held `
      + `pure premium, the held class rates and k_line all re-derive. This is the expensive outcome; do `
      + `not adjust the constant to make it agree.`);
  }
  // The realised mean of the factor itself, over a grid of (seed, year) pairs.
  const draws: number[] = [];
  for (let seed = 1; seed <= 4000; seed++) for (let y = 1; y <= 10; y++) draws.push(wcYearFactor(seed, y));
  const gm = mean(draws), gsd = sd(draws), gci = 1.96 * gsd / Math.sqrt(draws.length);
  const impliedShape = 1 / (gsd * gsd);
  console.log(`  [2] factor mean over ${draws.length.toLocaleString()} (seed, year) pairs: `
    + `${gm.toFixed(5)} +/- ${gci.toFixed(5)}   SD ${gsd.toFixed(5)} -> implied shape ${impliedShape.toFixed(2)} `
    + `against ${WC_LOSS_MODEL.wcYearFactor.shape}`);
  if (Math.abs(gm - 1) > gci) {
    problems.push(`wcYearFactor's realised mean is ${gm.toFixed(5)}, outside 1 +/- ${gci.toFixed(5)}. `
      + `A mean-one factor is the requirement — scale must be 1/shape — and the book's expected loss moves `
      + `with it.`);
  }
  // Structural, and it cannot go stale: mean-one is scale === 1/shape.
  const exact = WC_LOSS_MODEL.wcYearFactor.scale === 1 / WC_LOSS_MODEL.wcYearFactor.shape;
  console.log(`  [3] scale === 1/shape exactly (mean-one by construction): ${exact ? 'OK' : 'FAIL'}`);
  if (!exact) {
    problems.push(`wcYearFactor.scale is ${WC_LOSS_MODEL.wcYearFactor.scale}, not 1/shape = `
      + `${1 / WC_LOSS_MODEL.wcYearFactor.shape}. A Gamma(shape, scale) has mean shape x scale, so the `
      + `factor is no longer mean-one and every WC expectation is off by that ratio.`);
  }
}

// --- the two-part 6b check (same decomposition GL uses) --------------------
// (a) draw == analytic expectation is asserted by wc-severity-rebuild-check.ts,
// on the $1M-CAPPED basis, at full-market scale (wc-claim-check.ts was deleted
// with the tier model); (b) the ANALYTIC gross-basis ratio == 66.8% is asserted
// here, deterministic given the roster. Together they imply realized ~ 66.8%
// in expectation. The realized mean is REPORTED, not gated: WC's catastrophic
// annuity tier is lumpy enough that a +/-2pp band around it is noise-limited.
const mg = mean(wcGrossLR), sg = sd(perSeedGross), cig = 1.96 * sg / Math.sqrt(perSeedGross.length);
const ma = mean(wcAnalyticLR);
console.log(`  [1] ANALYTIC gross basis (enrolled book's own expected loss, no draw noise)`);
console.log(`      mean ${(ma * 100).toFixed(2)}%  vs target 66.8%`);
if (MODE === '6b') {
  console.log(`      HARD ASSERT ${note(Math.abs(ma - 0.668) <= 0.02, `WC ANALYTIC gross loss ratio ${(ma * 100).toFixed(2)}% outside 66.8% +/- 2pp`)}`);
} else {
  console.log(`      [6a] not asserted — OLD pure premium still in place.`);
}
console.log(`  [2] REALIZED gross basis (reported, not gated — catastrophic annuity lumpiness)`);
console.log(`      mean ${(mg * 100).toFixed(2)}%   95% CI +/-${(cig * 100).toFixed(2)}pp across ${perSeedGross.length} seeds`);
// ⚠ THIS IS NOW GENUINELY REPORTED, MATCHING THE COMMENT ABOVE IT. It used to
// call note() on `|realized - analytic| <= 1.96 sigma / sqrt(seeds)`, so the block
// said "reported, not gated" while the line below it gated — the same
// comment/code contradiction this harness's own header warns about elsewhere.
//
// AND THE GATE FAILED ON CORRECT CODE. A normal-theory CI assumes the sample mean
// is normal at this sample size. WC severity is a lognormal mixture whose heavy
// component has sigma 2.0, so the mean is carried by draws rarer than the sample
// contains and the realized figure sits BELOW the analytic until the tail shows
// up — measured at -9.0% here, and -4.1% directly on the full-market book in
// wc-severity-rebuild-check. 1.96 sigma systematically under-covers that, so the
// check reported a "draw/expectation divergence" that is ordinary sampling.
//
// DRAW-VS-EXPECTATION IS STILL ASSERTED, just not here and not on this quantity:
// wc-severity-rebuild-check gates the $1M-CAPPED mean against its analytic, which
// is a well-behaved variable (finding 26's rule: gate counts, rates, quantiles and
// capped means; never a heavy-tailed sample mean). The header's claim that
// wc-claim-check.ts covers it is stale — that harness was deleted with the tier
// model it tested.
const gap = (mg - ma) / ma;
console.log(`      realized is ${(gap * 100).toFixed(1)}% of analytic, against a +/-${(cig * 100).toFixed(2)}pp normal CI — REPORTED, NOT GATED`);
console.log(`      (a normal CI under-covers a sigma-2.0 mixture mean; see wc-severity-rebuild-check for the gated capped-basis test)`);
console.log(`  [3] NET narrow basis (reported): ${(m * 100).toFixed(2)}% — below gross because reinsurance recovery is active`);

console.log('\n--- cross-line scale (enrolled books, mean per line-year) ---');
console.log(`  WC       gross ${fmt$(mean(wcGross)).padStart(9)}   pool premium ${fmt$(mean(wcPremium)).padStart(9)}`);
console.log(`  GL       gross ${fmt$(mean(glGross)).padStart(9)}   pool premium ${fmt$(mean(glPrem)).padStart(9)}`);
console.log(`  Property gross ${fmt$(mean(prGross)).padStart(9)}   pool premium ${fmt$(mean(prPrem)).padStart(9)}`);
console.log(`  WC / GL premium ratio: ${(mean(wcPremium) / mean(glPrem)).toFixed(2)}x   WC / Property: ${(mean(wcPremium) / mean(prPrem)).toFixed(2)}x`);

// ============================================================================
// ⚠ THE EXIT PATH. THIS SCRIPT ASSERTED FOR MONTHS AND COULD NOT SAY SO.
//
// It collects `problems[]` and prints `FAIL` beside every failing row, then
// used to end on a console.log and exit 0 — so `npm run gates` printed `ok`
// beside a script that had just printed FAIL. That is worse than a probe which
// asserts nothing: the runner actively reports green, and only someone reading
// the body would learn otherwise. Ruled at 153980b's audit: promote, do not
// rename. The assertions are real and were built and used as gates.
//
// The verdict names what failed, per 8402b33's rule, and the count is printed
// even when the list is truncated so a reader knows there is more.
// ============================================================================
console.log(problems.length === 0
  ? '\nALL CUTOVER CHECKS PASS.'
  : `\n${problems.length} PROBLEM(S):\n  ${problems.slice(0, 12).join('\n  ')}`
    + (problems.length > 12 ? `\n  ... and ${problems.length - 12} more not listed` : ''));
process.exitCode = problems.length === 0 ? 0 : 1;
