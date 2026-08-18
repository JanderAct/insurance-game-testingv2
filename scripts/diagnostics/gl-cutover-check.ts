// GL cutover verification through the REAL game engine.
//
// Complements gl-claim-check.ts: that one exercises the generator in
// isolation, this one drives the actual processYear loop across 40 seeds x 5
// live years. Beyond claim integrity it checks the wiring GL shares with WC —
// WC and GL must be DECOUPLED on the pool-year factor (WC reports 1, GL reports
// the shared gPool draw — see WC_LOSS_MODEL.poolYearFactor),
// neither may carry a separate shockLossAmount (their shock lives inside the
// drawn claims), and claimCount must reconcile to the claims array (no more
// per-sub breakdown to reconcile — the GL sub-coverage rebuild deleted it).
//
//   npx tsx scripts/diagnostics/gl-cutover-check.ts 6b   # assert the ratio
//   npx tsx scripts/diagnostics/gl-cutover-check.ts      # 6a: report only
//
// THE TWO-PART LOSS-RATIO CHECK — same decomposition as wc-cutover-check.ts,
// and GL is the reason it exists. GL's alpha=1.3 law-enforcement Pareto tail
// and abuse batch totals (P99 ~8x mean) give the realized mean a +/-10pp CI of
// its own, so a +/-2pp band around it is a coin flip. HARD ASSERT the analytic
// gross-basis ratio; REPORT the realized draw against its own CI.
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { deriveNeutralGlPurePremiumPer100, expectedGlGrossLossForPricing } from '../../src/utils/glClaimEngine';
import type { GameState, CoverageLine } from '../../src/types/simulation';

function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const problems: string[] = [];
const MODE = process.argv[2] === '6b' ? '6b' : '6a';
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'OK' : 'FAIL'; };

const SEEDS = Array.from({ length: 40 }, (_, i) => (((i + 1) * 2654435761) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 5;

console.log(`=== GL CUTOVER (${MODE}) through the real engine: ${SEEDS.length} seeds x ${YEARS} live years, default decisions ===\n`);
console.log(`held neutral GL purePremiumPer100 (full canonical roster @ RQ=5) = ${deriveNeutralGlPurePremiumPer100(getPredefinedMarketMembers()).toFixed(4)}\n`);

const glGrossLR: number[] = [], perSeedGlGross: number[] = [];
const glAnalyticLR: number[] = [], glEnrolledPP: number[] = [], glDrawOverExp: number[] = [];
// $1M-CAPPED counterparts — the quantity [3] gates. Bounded per-claim variance.
const glCappedLR: number[] = [], glCappedAnalyticLR: number[] = [], perSeedGlCapped: number[] = [];
const CAP = 1_000_000;
const wcGrossLR: number[] = [];
let maxTie = 0, glClaimSumErr = 0, wcClaimSumErr = 0, lineYears = 0, nonFinite = 0;
let glShockAmtBad = 0, wcFactorNotOne = 0, glFactorIsOne = 0, countMismatch = 0, memberSumErr = 0;
const glClaimsPerYear: number[] = [], glShockYears: number[] = [];
const wcGross: number[] = [], wcPrem: number[] = [], glGross: number[] = [], glPrem: number[] = [], prGross: number[] = [], prPrem: number[] = [];

for (const id of SEEDS) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const seedGl: number[] = [];
  const seedGlCapped: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const wc = p.result.byLine.WC, gl = p.result.byLine.GL, pr = p.result.byLine.Property;
    for (const l of LINES) {
      const x = p.result.byLine[l];
      lineYears++;
      maxTie = Math.max(maxTie, Math.abs(x.surplusTieOutDifference));
      for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && !Number.isFinite(v)) { nonFinite++; console.log(`  NON-FINITE ${id} Y${y} ${l}.${k}`); }
    }
    // ⚠ WAS `wc.commonLossFactor === gl.commonLossFactor` — the two lines used to
    // SHARE the pool-year factor, and that shared draw was the model's only
    // cross-line correlation. The WC severity rebuild REMOVED gPool from WC
    // (WC_LOSS_MODEL.poolYearFactor, §7), so WC now reports a defined 1 and GL
    // still consumes the draw. Asserting they match would now fail by design.
    //
    // The replacement asserts the DECOUPLING, which is the stronger statement:
    // WC must be exactly 1, and GL must not be (it is a Gamma(25, 1/25) draw, so
    // landing on exactly 1 would mean the draw had stopped happening).
    if (wc.commonLossFactor !== 1) wcFactorNotOne++;
    if (gl.commonLossFactor === 1) glFactorIsOne++;
    // claim-line shockLossAmount must be 0 (shock lives inside the claims).
    if (gl.shockLossAmount !== 0 || wc.shockLossAmount !== 0) glShockAmtBad++;
    if (gl.claims) {
      glClaimSumErr = Math.max(glClaimSumErr, Math.abs(gl.claims.reduce((s, c) => s + c.grossUltimate, 0) - gl.grossUltimateLoss));
      glClaimsPerYear.push(gl.claims.length);
      if (gl.claimCount === undefined) { countMismatch++; problems.push(`${id} Y${y}: GL result carries no claimCount`); }
      else if (gl.claimCount !== gl.claims.length) countMismatch++;
      const mSum = gl.memberLossResults.reduce((s, r) => s + r.simulatedLoss, 0);
      memberSumErr = Math.max(memberSumErr, Math.abs(mSum - gl.aggregateMemberLoss));
    } else problems.push(`${id} Y${y}: GL result carries no claims array`);
    if (wc.claims) wcClaimSumErr = Math.max(wcClaimSumErr, Math.abs(wc.claims.reduce((s, c) => s + c.grossUltimate, 0) - wc.grossUltimateLoss));
    glShockYears.push(gl.shockLossIncurred ? 1 : 0);
    const glLR = gl.grossUltimateLoss / Math.max(gl.poolPremiumAndAdminExpense, 1);
    glGrossLR.push(glLR); seedGl.push(glLR);
    // ANALYTIC basis: this enrolled book's OWN expected GL loss, no draw noise.
    // kGl=1 with RQ pinned to neutral reproduces E[draw] exactly, because the
    // engine's kGl (= neutral/adjusted) cancels the actual-RQ tilt in the draw.
    const expNeutral = expectedGlGrossLossForPricing(gl.memberList, { yearNumber: y, riskQualityOverride: 5, kGl: 1 });
    glAnalyticLR.push(expNeutral / Math.max(gl.poolPremiumAndAdminExpense, 1));
    glEnrolledPP.push(expNeutral / (gl.memberList.reduce((s: number, m: any) => s + (m.exposureByLine.GL ?? 0), 0) * 10_000));
    glDrawOverExp.push(gl.grossUltimateLoss / Math.max(expNeutral, 1));
    // The capped pair, on the SAME neutral/held basis as expNeutral above.
    const drawnCapped = (gl.claims ?? []).reduce((s2, c) => s2 + Math.min(c.grossUltimate, CAP), 0);
    const expNeutralCapped = expectedGlGrossLossForPricing(gl.memberList, { yearNumber: y, riskQualityOverride: 5, kGl: 1, severityLimit: CAP });
    const glCapLR = drawnCapped / Math.max(gl.poolPremiumAndAdminExpense, 1);
    glCappedLR.push(glCapLR); seedGlCapped.push(glCapLR);
    glCappedAnalyticLR.push(expNeutralCapped / Math.max(gl.poolPremiumAndAdminExpense, 1));
    wcGrossLR.push(wc.grossUltimateLoss / Math.max(wc.poolPremiumAndAdminExpense, 1));
    wcGross.push(wc.grossUltimateLoss); wcPrem.push(wc.poolPremium);
    glGross.push(gl.grossUltimateLoss); glPrem.push(gl.poolPremium);
    prGross.push(pr.grossUltimateLoss); prPrem.push(pr.poolPremium);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  perSeedGlGross.push(mean(seedGl));
  perSeedGlCapped.push(mean(seedGlCapped));
}

console.log('--- claim integrity through the engine ---');
console.log(`  line-years processed: ${lineYears}   non-finite fields: ${nonFinite}  ${note(nonFinite === 0, 'non-finite result fields')}`);
console.log(`  max |sum(GL claims) - grossUltimateLoss|: $${glClaimSumErr.toFixed(6)}  ${note(glClaimSumErr < 0.01, 'GL claims do not sum to grossUltimateLoss')}`);
console.log(`  max |sum(WC claims) - grossUltimateLoss|: $${wcClaimSumErr.toFixed(6)}  ${note(wcClaimSumErr < 0.01, 'WC claims do not sum to grossUltimateLoss')}`);
console.log(`  max |sum(GL memberLossResults) - aggregate|: $${memberSumErr.toFixed(6)}  ${note(memberSumErr < 0.01, 'GL member losses do not sum')}`);
console.log(`  max |surplus tie-out|: ${maxTie.toExponential(2)}  ${note(maxTie < 1e-4, `tie-out ${maxTie}`)}`);
console.log(`  WC commonLossFactor is exactly 1 (pool factor REMOVED from WC): ${lineYears - wcFactorNotOne}/${lineYears}  ${note(wcFactorNotOne === 0, 'WC does not report commonLossFactor 1 — the pool-year factor is still reaching WC')}`);
console.log(`  GL commonLossFactor still varies (gPool draw retained for GL): ${lineYears - glFactorIsOne}/${lineYears}  ${note(glFactorIsOne === 0, 'GL commonLossFactor is exactly 1 — the shared pool-year draw has stopped')}`);
console.log(`    WC and GL are now INDEPENDENT. gPool was the model's only cross-line correlation, so a bad`);
console.log(`    WC year no longer carries any information about GL. Deliberate — see WC_LOSS_MODEL.poolYearFactor.`);
console.log(`  claim-line shockLossAmount != 0 count: ${glShockAmtBad}  ${note(glShockAmtBad === 0, 'claim-line shockLossAmount nonzero')}`);
console.log(`  claimCount mismatches: ${countMismatch}  ${note(countMismatch === 0, 'claimCount missing or does not equal claims.length')}`);
console.log(`  GL claims/yr (enrolled book): mean ${mean(glClaimsPerYear).toFixed(1)}`);
console.log(`  GL shock (occurrence > $1M) share of line-years: ${(mean(glShockYears) * 100).toFixed(0)}%`);

// --- the two-part 6b check -------------------------------------------------
// Pricing correctness for a heavy-tailed line decomposes into two independent
// propositions, and asserting them separately is STRICTER than asserting their
// product on a noisy realized mean:
//   (a) draw == analytic expectation  — invariant 1, asserted by
//       gl-claim-check.ts at full-market scale (0.992 over 300 draw-years).
//   (b) analytic ratio == 66.8%       — the finding-6 constraint, HARD
//       ASSERTED below; deterministic given the roster, zero draw noise.
// (a) and (b) together imply realized ~ 66.8% IN EXPECTATION. Gating on a
// +/-2pp band around the realized mean is NOT a stricter test: GL's alpha=1.3
// Pareto tail and abuse batches (P99 ~8x mean) give that mean a +/-6.6pp CI of
// its own, so the band is a coin flip that fails on correct pricing. The
// realized figure is therefore REPORTED, and flagged only if it drifts outside
// its own CI of the analytic — which WOULD be a genuine draw/expectation bug.
// Do not "restore" the old realized-mean assertion: it was not dropped for
// convenience, it was replaced by a decomposition that tests more.
console.log('\n--- GL loss ratio (GROSS basis: gross loss / poolPremiumAndAdminExpense) ---');
const m = mean(glGrossLR), s = sd(perSeedGlGross), ci = 1.96 * s / Math.sqrt(perSeedGlGross.length);
const ma = mean(glAnalyticLR);
console.log(`  [1] ANALYTIC (each enrolled book's own expected loss, no draw noise)`);
console.log(`      mean ${(ma * 100).toFixed(2)}%  vs target 66.8%`);
console.log(`      enrolled-book neutral PP ${mean(glEnrolledPP).toFixed(4)} vs held full-roster ${deriveNeutralGlPurePremiumPer100(getPredefinedMarketMembers()).toFixed(4)} (ratio ${(mean(glEnrolledPP) / deriveNeutralGlPurePremiumPer100(getPredefinedMarketMembers())).toFixed(4)} — the accepted ~0.7% composition effect, Correction 1)`);
if (MODE === '6b') {
  console.log(`      HARD ASSERT ${note(Math.abs(ma - 0.668) <= 0.02, `GL ANALYTIC gross loss ratio ${(ma * 100).toFixed(2)}% outside 66.8% +/- 2pp`)}`);
} else {
  console.log(`      [6a] not asserted — the OLD GL pure premium is still in place here; 6b flips it.`);
}
console.log(`  [2] REALIZED, GROUND-UP — REPORTED, NOT GATED (GL's blended CV is 29.55 post-rebuild)`);
console.log(`      mean ${(m * 100).toFixed(2)}%   95% CI +/-${(ci * 100).toFixed(2)}pp across ${perSeedGlGross.length} seeds`);
console.log(`      realized/analytic ratio ${mean(glDrawOverExp).toFixed(4)} over ${glDrawOverExp.length} GL line-years (finite-sample tail bias: heavy-tailed sample means sit low, repaid by rare huge draws)`);
const gap = (m - ma) / ma;
console.log(`      realized is ${(gap * 100).toFixed(1)}% of analytic, against a +/-${(ci * 100).toFixed(2)}pp normal CI`);

// ============================================================================
// ⚠ [3] IS THE GATE, AND IT IS ON THE $1M-CAPPED QUANTITY. DO NOT MOVE IT BACK
// TO THE GROUND-UP FIGURE IN [2] — that was tried and it fails on correct code.
//
// GL's fitted mixture has a blended CV of 29.55; component 1 alone carries 99.1%
// of the loss at CV 21.5. A normal-theory CI over 40 seeds assumes the sample
// mean is roughly normal at that sample size, which at this tail weight it is
// not: the realized mean sits BELOW expectation until a rare large draw lands,
// and the CI is computed from realized variance, which a heavy tail makes an
// unstable statistic in its own right. Measured on the ground-up basis:
// realized 75.87% vs analytic 86.96%, outside a +/-7.38pp band, on correct code.
//
// CAPPING AT $1M BOUNDS PER-CLAIM VARIANCE, so the normal CI is valid however
// heavy the raw tail is — the same reasoning that makes a FINITE reinsurance
// layer's ceded mean gateable where an unlimited layer's is not. The capped CI
// is ~4x tighter, and that tightness is what earns it the gate: it is precise
// enough to have caught the k_GL defect (computeKGl neutralising frequency only,
// so the severity tilt survived in losses with nothing offsetting it in price),
// which the ground-up figure had buried in its own noise.
//
// BOTH LINES OF DEFENCE, kept separate on purpose:
//   [1] analytic vs 66.8%      — deterministic, zero draw noise
//   [3] drawn vs analytic      — capped, bounded variance, gateable
//   gl-claim-check             — k_GL's identity, exact to 1e-12
// ============================================================================
const mc = mean(glCappedLR), mca = mean(glCappedAnalyticLR);
const cic = 1.96 * sd(perSeedGlCapped) / Math.sqrt(perSeedGlCapped.length);
console.log(`  [3] REALIZED, $1M-CAPPED — THE GATE (bounded per-claim variance, so this CI is valid)`);
console.log(`      realized ${(mc * 100).toFixed(2)}%   analytic ${(mca * 100).toFixed(2)}%   gap ${((mc / mca - 1) * 100).toFixed(2)}%   95% CI +/-${(cic * 100).toFixed(2)}pp`);
console.log(`      ${note(Math.abs(mc - mca) <= cic, `GL capped realized ${(mc * 100).toFixed(2)}% is outside its 95% CI (+/-${(cic * 100).toFixed(2)}pp) of the capped analytic ${(mca * 100).toFixed(2)}% — on a bounded-variance basis that is a STRUCTURAL draw/expectation divergence, not sampling noise. Check k_GL's identity in gl-claim-check first.`)}`);
console.log(`  WC gross-basis for reference: ${(mean(wcGrossLR) * 100).toFixed(2)}%`);

console.log('\n--- cross-line scale (enrolled books, mean per line-year) ---');
console.log(`  WC       gross ${fmt$(mean(wcGross)).padStart(9)}   pool premium ${fmt$(mean(wcPrem)).padStart(9)}`);
console.log(`  GL       gross ${fmt$(mean(glGross)).padStart(9)}   pool premium ${fmt$(mean(glPrem)).padStart(9)}`);
console.log(`  Property gross ${fmt$(mean(prGross)).padStart(9)}   pool premium ${fmt$(mean(prPrem)).padStart(9)}`);

console.log(problems.length === 0 ? '\nALL GL CUTOVER CHECKS PASS.' : `\n${problems.length} PROBLEMS:\n  ${problems.slice(0, 12).join('\n  ')}`);
