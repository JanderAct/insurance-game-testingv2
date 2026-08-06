// GL cutover verification through the REAL game engine.
//
// Complements gl-claim-check.ts: that one exercises the generator in
// isolation, this one drives the actual processYear loop across 40 seeds x 5
// live years. Beyond claim integrity it checks the wiring GL shares with WC —
// both lines must read the same pool-wide gPool as their commonLossFactor,
// neither may carry a separate shockLossAmount (their shock lives inside the
// drawn claims), and claimCountsBySub must reconcile to the claims array.
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
import { deriveNeutralGlPurePremiumPer100, expectedGlGrossLoss } from '../../src/utils/glClaimEngine';
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
const wcGrossLR: number[] = [];
let maxTie = 0, glClaimSumErr = 0, wcClaimSumErr = 0, lineYears = 0, nonFinite = 0;
let glShockAmtBad = 0, gPoolMismatch = 0, subCountMismatch = 0, memberSumErr = 0;
const glClaimsPerYear: number[] = [], glShockYears: number[] = [];
const wcGross: number[] = [], wcPrem: number[] = [], glGross: number[] = [], glPrem: number[] = [], prGross: number[] = [], prPrem: number[] = [];
const subTotals: Record<string, number> = {};

for (const id of SEEDS) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const seedGl: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const wc = p.result.byLine.WC, gl = p.result.byLine.GL, pr = p.result.byLine.Property;
    for (const l of LINES) {
      const x = p.result.byLine[l];
      lineYears++;
      maxTie = Math.max(maxTie, Math.abs(x.surplusTieOutDifference));
      for (const [k, v] of Object.entries(x)) if (typeof v === 'number' && !Number.isFinite(v)) { nonFinite++; console.log(`  NON-FINITE ${id} Y${y} ${l}.${k}`); }
    }
    // WC and GL must both read the same shared gPool as their commonLossFactor.
    if (wc.commonLossFactor !== gl.commonLossFactor) gPoolMismatch++;
    // claim-line shockLossAmount must be 0 (shock lives inside the claims).
    if (gl.shockLossAmount !== 0 || wc.shockLossAmount !== 0) glShockAmtBad++;
    if (gl.claims) {
      glClaimSumErr = Math.max(glClaimSumErr, Math.abs(gl.claims.reduce((s, c) => s + c.grossUltimate, 0) - gl.grossUltimateLoss));
      glClaimsPerYear.push(gl.claims.length);
      const counts = gl.claimCountsBySub;
      if (!counts) { subCountMismatch++; problems.push(`${id} Y${y}: GL result carries no claimCountsBySub`); }
      else {
        const subSum = (counts.general ?? 0) + (counts.epl ?? 0) + (counts.lawEnforcement ?? 0) + (counts.abuse ?? 0);
        if (subSum !== gl.claims.length) subCountMismatch++;
        for (const [k, v] of Object.entries(counts)) subTotals[k] = (subTotals[k] ?? 0) + v;
      }
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
    const expNeutral = expectedGlGrossLoss(gl.memberList, { riskQualityOverride: 5, kGl: 1 });
    glAnalyticLR.push(expNeutral / Math.max(gl.poolPremiumAndAdminExpense, 1));
    glEnrolledPP.push(expNeutral / (gl.memberList.reduce((s: number, m: any) => s + (m.exposureByLine.GL ?? 0), 0) * 10_000));
    glDrawOverExp.push(gl.grossUltimateLoss / Math.max(expNeutral, 1));
    wcGrossLR.push(wc.grossUltimateLoss / Math.max(wc.poolPremiumAndAdminExpense, 1));
    wcGross.push(wc.grossUltimateLoss); wcPrem.push(wc.poolPremium);
    glGross.push(gl.grossUltimateLoss); glPrem.push(gl.poolPremium);
    prGross.push(pr.grossUltimateLoss); prPrem.push(pr.poolPremium);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  perSeedGlGross.push(mean(seedGl));
}

console.log('--- claim integrity through the engine ---');
console.log(`  line-years processed: ${lineYears}   non-finite fields: ${nonFinite}  ${note(nonFinite === 0, 'non-finite result fields')}`);
console.log(`  max |sum(GL claims) - grossUltimateLoss|: $${glClaimSumErr.toFixed(6)}  ${note(glClaimSumErr < 0.01, 'GL claims do not sum to grossUltimateLoss')}`);
console.log(`  max |sum(WC claims) - grossUltimateLoss|: $${wcClaimSumErr.toFixed(6)}  ${note(wcClaimSumErr < 0.01, 'WC claims do not sum to grossUltimateLoss')}`);
console.log(`  max |sum(GL memberLossResults) - aggregate|: $${memberSumErr.toFixed(6)}  ${note(memberSumErr < 0.01, 'GL member losses do not sum')}`);
console.log(`  max |surplus tie-out|: ${maxTie.toExponential(2)}  ${note(maxTie < 1e-4, `tie-out ${maxTie}`)}`);
console.log(`  WC/GL commonLossFactor (gPool) mismatches: ${gPoolMismatch}  ${note(gPoolMismatch === 0, 'gPool not shared')}`);
console.log(`  claim-line shockLossAmount != 0 count: ${glShockAmtBad}  ${note(glShockAmtBad === 0, 'claim-line shockLossAmount nonzero')}`);
console.log(`  claimCountsBySub mismatches: ${subCountMismatch}  ${note(subCountMismatch === 0, 'claimCountsBySub missing or does not sum to claims')}`);
console.log(`  GL claims/yr (enrolled book): mean ${mean(glClaimsPerYear).toFixed(1)}`);
const st = Object.entries(subTotals).map(([k, v]) => `${k} ${(v / lineYears * 3).toFixed(1)}`).join('  ');
console.log(`  per-sub mean/yr: ${st}`);
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
console.log(`  [2] REALIZED (reported, not gated — alpha=1.3 tail)`);
console.log(`      mean ${(m * 100).toFixed(2)}%   95% CI +/-${(ci * 100).toFixed(2)}pp across ${perSeedGlGross.length} seeds`);
console.log(`      realized/analytic ratio ${mean(glDrawOverExp).toFixed(4)} over ${glDrawOverExp.length} GL line-years (finite-sample tail bias: heavy-tailed sample means sit low, repaid by rare huge draws)`);
const withinCI = Math.abs(m - ma) <= ci;
console.log(`      realized within its own CI of the analytic: ${withinCI ? 'YES' : 'NO'}  ${note(withinCI, `realized ${(m * 100).toFixed(2)}% is OUTSIDE its own CI (+/-${(ci * 100).toFixed(2)}pp) of the analytic ${(ma * 100).toFixed(2)}% — draw/expectation divergence, investigate`)}`);
console.log(`  WC gross-basis for reference: ${(mean(wcGrossLR) * 100).toFixed(2)}%`);

console.log('\n--- cross-line scale (enrolled books, mean per line-year) ---');
console.log(`  WC       gross ${fmt$(mean(wcGross)).padStart(9)}   pool premium ${fmt$(mean(wcPrem)).padStart(9)}`);
console.log(`  GL       gross ${fmt$(mean(glGross)).padStart(9)}   pool premium ${fmt$(mean(glPrem)).padStart(9)}`);
console.log(`  Property gross ${fmt$(mean(prGross)).padStart(9)}   pool premium ${fmt$(mean(prPrem)).padStart(9)}`);

console.log(problems.length === 0 ? '\nALL GL CUTOVER CHECKS PASS.' : `\n${problems.length} PROBLEMS:\n  ${problems.slice(0, 12).join('\n  ')}`);
