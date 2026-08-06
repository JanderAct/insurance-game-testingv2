// WC cutover verification through the REAL game engine.
//
// Complements wc-claim-check.ts: that one exercises the generator in
// isolation, this one drives the actual processYear loop across 40 seeds x 5
// live years and checks that claims survive the trip — sums tie to
// grossUltimateLoss, surplus reconciles, no non-finite fields — and that the
// pricing lands where it should.
//
//   npx tsx scripts/diagnostics/wc-cutover-check.ts 6b   # assert the ratio
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
import { deriveNeutralPurePremiumPer100, expectedWcGrossLoss } from '../../src/utils/wcClaimEngine';
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
        const expNeutral = expectedWcGrossLoss(x.memberList, { riskQualityOverride: 5, kLine: 1 });
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
// --- the two-part 6b check (same decomposition GL uses) --------------------
// (a) draw == analytic expectation is asserted by wc-claim-check.ts at
// full-market scale; (b) the ANALYTIC gross-basis ratio == 66.8% is asserted
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
const wcWithinCI = Math.abs(mg - ma) <= cig;
console.log(`      realized within its own CI of the analytic: ${wcWithinCI ? 'YES' : 'NO'}  ${note(wcWithinCI, `WC realized ${(mg * 100).toFixed(2)}% OUTSIDE its CI (+/-${(cig * 100).toFixed(2)}pp) of analytic ${(ma * 100).toFixed(2)}% — draw/expectation divergence`)}`);
console.log(`  [3] NET narrow basis (reported): ${(m * 100).toFixed(2)}% — below gross because reinsurance recovery is active`);

console.log('\n--- cross-line scale (enrolled books, mean per line-year) ---');
console.log(`  WC       gross ${fmt$(mean(wcGross)).padStart(9)}   pool premium ${fmt$(mean(wcPremium)).padStart(9)}`);
console.log(`  GL       gross ${fmt$(mean(glGross)).padStart(9)}   pool premium ${fmt$(mean(glPrem)).padStart(9)}`);
console.log(`  Property gross ${fmt$(mean(prGross)).padStart(9)}   pool premium ${fmt$(mean(prPrem)).padStart(9)}`);
console.log(`  WC / GL premium ratio: ${(mean(wcPremium) / mean(glPrem)).toFixed(2)}x   WC / Property: ${(mean(wcPremium) / mean(prPrem)).toFixed(2)}x`);

console.log(problems.length === 0 ? '\nALL CUTOVER CHECKS PASS.' : `\n${problems.length} PROBLEMS:\n  ${problems.slice(0, 12).join('\n  ')}`);
