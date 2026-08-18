// MARKETPLACE-WIDE GENERATION CHECK — stage 2 of the experience-modifier work.
//
//   npx tsx scripts/diagnostics/marketplace-generation-check.ts
//
// ============================================================================
// WHAT CHANGED AND WHY THIS FILE EXISTS.
//
// Claims are now generated for ALL 200 canonical members every year, not just
// the enrolled book, so that a prospect arrives with a readable loss record and
// adverse selection becomes something the player can read. Only ENROLLED claims
// feed pool losses, premium, reserves and reinsurance.
//
// That split has two failure modes, and BOTH CORRUPT QUIETLY RATHER THAN FAIL
// LOUDLY, which is exactly why they are asserted here:
//
//   TRAP 1 — the mix correction computed on the wrong book. k_line / k_GL must
//     come from the ENROLLED book; it is the enrolment-mix correction that lets
//     purePremiumPer100 be held. Handing it the 200-member roster drives it to
//     ~1 and disables the correction. On the canonical roster the two values
//     differ by only ~0.4% (0.9820 enrolled vs 0.9781 roster), so nothing
//     downstream would look wrong. This is why kLineApplied is exposed on the
//     result at all: so the rule can be ASSERTED, not reviewed.
//
//   TRAP 2 — prospects generated with pool benefits. k_line and risk control are
//     properties of POOL MEMBERSHIP. Applying either to a prospect gives
//     non-members free safety consulting AND makes their history depend on the
//     enrolled book's RQ mix — the incoherence the per-member stream keying
//     removed. Prospects must draw at k = 1, rc = 0.
//
// PLUS the containment check that matters most: prospect losses run ~10x
// enrolled losses at a 68/200 book, so any leak into a pool figure is a
// 10x error, not a rounding one.
//
// VERIFICATION IS STATISTICAL, NOT VALUE-FOR-VALUE. The per-member stream keying
// in stage 1 moved every draw, so old baselines cannot be compared number by
// number. What must still hold is the pricing invariant: enrolled gross loss
// over its own analytic expectation sits at 1.00. Measured at 1.0021 over 1,000
// line-years before this work.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { computeKLine, expectedWcGrossLossForKLine, expectedWcGrossLossForPricing } from '../../src/utils/wcClaimEngine';
import { computeKGl, expectedGlGrossLossForKLine, expectedGlGrossLossForPricing } from '../../src/utils/glClaimEngine';
import type { CoverageLine, GameState, Member } from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }

const SEEDS = Array.from({ length: 40 }, (_, i) => (((i + 1) * 2654435761) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 5;
const Z99 = 2.5758;

console.log(`=== MARKETPLACE-WIDE GENERATION: ${SEEDS.length} seeds x ${YEARS} live years, default decisions ===\n`);

// Ratios of drawn enrolled loss to its own analytic expectation, per line-year.
const ratio: Record<string, number[]> = { WC: [], GL: [] };
// The same ratio on a $1M-CAPPED basis — bounded per-claim variance, so this one
// can carry a real gate where the ground-up figure cannot. GL only; see the gate
// block for why WC stays on the ground-up figure.
const ratioCapped: Record<string, number[]> = { WC: [], GL: [] };
const CAP = 1_000_000;
let genT = 0;
let bootstrapMarketYears = 0;
let bootstrapWithHistory = 0;
let trap1Checked = 0;
let trap2Checked = 0;
let containmentChecked = 0;
let coverageChecked = 0;

const t0 = Date.now();

for (const id of SEEDS) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);

  // --- BOOTSTRAP: prospects must arrive at year 1 with history ---------------
  for (const r of priorHistory) {
    for (const line of ['WC', 'GL'] as CoverageLine[]) {
      const lr = r.byLine[line];
      if (!lr?.marketMemberLossResults) continue;
      bootstrapMarketYears++;
      if (lr.marketMemberLossResults.length === poolState.allMarketMembers.length) bootstrapWithHistory++;
    }
  }

  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  for (let y = 1; y <= YEARS; y++) {
    const g0 = Date.now();
    const p = processYear(gs, defaultDecisionSet(y));
    genT += Date.now() - g0;

    const roster = gs.poolState.allMarketMembers;
    for (const line of ['WC', 'GL'] as CoverageLine[]) {
      const lr = p.result.byLine[line];
      if (!lr) continue;
      const market = lr.marketMemberLossResults ?? [];
      const enrolledIds = new Set(lr.memberLossResults.map(m => m.memberId));

      // --- coverage: all 200, exactly once ---------------------------------
      coverageChecked++;
      const uniq = new Set(market.map(m => m.memberId));
      if (market.length !== roster.length || uniq.size !== roster.length) {
        note(false, `${line} Y${y} seed ${id}: market list has ${market.length} entries / ${uniq.size} unique against a ${roster.length}-member roster`);
      }

      // --- TRAP 1: mix correction from the ENROLLED book -------------------
      const enrolled: Member[] = lr.memberLossResults
        .map(m => roster.find(r2 => r2.id === m.memberId))
        .filter((m): m is Member => !!m);
      if (enrolled.length === lr.memberLossResults.length && lr.kLineApplied !== undefined) {
        trap1Checked++;
        const kEnrolled = line === 'WC' ? computeKLine(enrolled) : computeKGl(enrolled, y);
        const kRoster = line === 'WC' ? computeKLine(roster) : computeKGl(roster, y);
        // Bit-equal against the enrolled book. Exact, not a tolerance: the
        // engine calls the same function on the same list.
        if (lr.kLineApplied !== kEnrolled) {
          note(false, `${line} Y${y} seed ${id}: kLineApplied ${lr.kLineApplied.toFixed(6)} != computeK(enrolled) ${kEnrolled.toFixed(6)}`
            + (Math.abs(lr.kLineApplied - kRoster) < 1e-12 ? ' — IT MATCHES THE FULL ROSTER, which is trap 1 exactly' : ''));
        }
      }

      // --- containment: pool figures are enrolled-only ---------------------
      containmentChecked++;
      const enrolledSum = lr.memberLossResults.reduce((s, m) => s + m.simulatedLoss, 0);
      if (Math.abs(enrolledSum - lr.aggregateMemberLoss) > 1) {
        note(false, `${line} Y${y} seed ${id}: aggregateMemberLoss ${fmt$(lr.aggregateMemberLoss)} != sum of enrolled simulated losses ${fmt$(enrolledSum)}`);
      }
      if (!(lr.claims ?? []).every(c => enrolledIds.has(c.memberId))) {
        note(false, `${line} Y${y} seed ${id}: the claims array contains non-enrolled claims — prospect claims must never reach pool accounting`);
      }

      // --- TRAP 2: prospects drew at k = 1, rc = 0 -------------------------
      // Their stored expectedLoss is expectedGrossLoss([member], { kLine }),
      // so recomputing it at k = 1 must reproduce it exactly. If the pool's
      // k or rc had been applied, it would not.
      const prospects = market.filter(m => !enrolledIds.has(m.memberId));
      for (const pr of prospects.slice(0, 3)) {
        const m = roster.find(r2 => r2.id === pr.memberId);
        if (!m) continue;
        trap2Checked++;
        const expAtOne = line === 'WC'
          ? expectedWcGrossLossForPricing([m], { kLine: 1, yearNumber: y })
          : expectedGlGrossLossForPricing([m], { yearNumber: y, kGl: 1 });
        if (Math.abs(pr.expectedLoss - expAtOne) > Math.max(1e-6, expAtOne * 1e-9)) {
          note(false, `${line} Y${y} seed ${id}: prospect ${pr.memberId} expectedLoss ${pr.expectedLoss.toFixed(2)} != expectation at k=1 ${expAtOne.toFixed(2)} — the pool's k or rc reached a prospect`);
        }
      }

      // --- the pricing invariant, statistically ---------------------------
      //
      // ⚠ THE k_line BASIS, NOT THE PRICING BASIS. This check's own subject is
      // "drawn enrolled loss / ITS OWN analytic", and the draw's own analytic is
      // the k_line basis — both risk-quality channels, frequency theta AND the
      // severity tilt. It used to call the PRICING basis (untilted severity),
      // which measures a different and blurrier thing: drawn-over-priced mixes
      // the generator's internal consistency together with whether k_line
      // neutralises the book's RQ mix. Those are separable and are now separated:
      //   this check          drawn vs the draw's own expectation  (generator)
      //   gl-claim-check      draw's expectation == held priced     (k_line, exact)
      //   gl/wc-cutover-check drawn vs held priced                  (both together)
      // On the pricing basis this ratio sits at the theta-weighted mean tilt
      // rather than at 1.0 — near 1 only because the roster's mean RQ happens to
      // be near neutral, which is luck, not a test.
      const exp = line === 'WC'
        ? expectedWcGrossLossForKLine(enrolled, { kLine: lr.kLineApplied ?? 1, yearNumber: y })
        : expectedGlGrossLossForKLine(enrolled, { yearNumber: y, kGl: lr.kLineApplied ?? 1 });
      if (exp > 0) ratio[line].push(lr.grossUltimateLoss / exp);
      // The $1M-CAPPED counterpart — the quantity GL's gate is on. See the gate
      // block below for why the gate cannot be on the ground-up figure.
      if (line === 'GL') {
        const expCapped = expectedGlGrossLossForKLine(enrolled, { yearNumber: y, kGl: lr.kLineApplied ?? 1, severityLimit: CAP });
        const drawnCapped = (lr.claims ?? []).reduce((s, c) => s + Math.min(c.grossUltimate, CAP), 0);
        if (expCapped > 0) ratioCapped[line].push(drawnCapped / expCapped);
      }
    }

    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

const wall = Date.now() - t0;

console.log('--- 1. COVERAGE: every year generates the whole marketplace ---');
console.log(`  line-years checked ${coverageChecked}; all 200 members present exactly once each  ${note(true, '')}`);
console.log(`  bootstrap line-years ${bootstrapMarketYears}, of which full-roster ${bootstrapWithHistory}`
  + `  ${note(bootstrapMarketYears > 0 && bootstrapWithHistory === bootstrapMarketYears, 'the pre-game years did not generate marketplace-wide — prospects would start year 1 blind')}`);

console.log('\n--- 2. TRAP 1: mix correction computed on the ENROLLED book ---');
console.log(`  kLineApplied === computeK(enrolled) on ${trap1Checked} line-years  ${note(true, '')}`);

console.log('\n--- 3. TRAP 2: prospects drew at k = 1 with no risk control ---');
console.log(`  prospect expectedLoss reproduces the k=1 expectation on ${trap2Checked} samples  ${note(true, '')}`);

console.log('\n--- 4. CONTAINMENT: prospect losses never reach pool accounting ---');
console.log(`  aggregateMemberLoss ties to the enrolled sum, and the claims array is enrolled-only, on ${containmentChecked} line-years  ${note(true, '')}`);

console.log('\n--- 5. THE PRICING INVARIANT, STATISTICALLY (drawn enrolled loss / its own analytic) ---');
console.log('  Value-for-value comparison against pre-stage-1 baselines is impossible: per-member');
console.log('  stream keying moved every draw. This is the invariant that must survive it.');
// ============================================================================
// ⚠ WHY GL'S GATE IS ON THE $1M-CAPPED RATIO AND NOT THE GROUND-UP ONE.
// DO NOT "RESTORE" A GROUND-UP GATE HERE. It was tried and it fails on correct
// code.
//
// GL's fitted mixture has a blended CV of 29.55 — component 1 alone carries
// 99.1% of the loss at CV 21.5. At that tail weight a 200-line-year sample mean
// is nowhere near normal: the mean is carried by draws rarer than the sample
// usually contains, so the realized figure sits BELOW expectation until a large
// draw lands, and the CI — computed from realized variance — is itself unstable,
// which is finding 26's whole point. Measured on the ground-up basis: 0.8725
// with a +/-0.1063 band, excluding 1.00 on entirely correct code.
//
// CAPPING AT $1M BOUNDS PER-CLAIM VARIANCE, so a normal CI is valid however
// heavy the raw tail is — the same reasoning that makes a finite reinsurance
// layer's ceded mean gateable where an unlimited layer's is not. The capped
// gate is ~1.8x tighter and is a real test: it is what caught the k_GL defect
// (see below), which the ground-up figure had buried in its own noise.
//
// WC STAYS ON THE GROUND-UP FIGURE, and that is not an inconsistency. WC has a
// REPORT LAG: its drawn loss in year y includes prior-accident-year claims
// emerging late, drawn at prior years' k_line and trend factors. A tight capped
// gate there would be measuring that emergence transient rather than the pricing
// invariant, so the honest instrument for WC is the wide one. WC's CV (~11-14)
// is also low enough that the ground-up CI covers correctly, which is why this
// gate has always passed for WC.
//
// HISTORY: before the GL rebuild both lines were gated on ground-up and both
// passed. GL's rebuild made its tail heavier and the GL gate started failing; it
// was briefly converted to reported-only, which was the wrong call — diagnosing
// a failure is right, deciding it does not count is not. It is now gated on the
// quantity that can carry a gate.
// ============================================================================
for (const line of ['WC', 'GL']) {
  const xs = ratio[line];
  const m = mean(xs);
  const half = Z99 * sd(xs) / Math.sqrt(xs.length);
  const groundLabel = line === 'GL'
    ? 'REPORTED (heavy-tailed sample mean, finding 26 — the gate is the capped line below)'
    : `${note(Math.abs(m - 1) <= half, `WC drawn/expected ${m.toFixed(4)} excludes 1.00 at 99% (CI half-width ${half.toFixed(4)})`)}`;
  console.log(`  ${line.padEnd(3)} ground-up ratio ${m.toFixed(4)} over ${xs.length} line-years, 99% CI [${(m - half).toFixed(4)}, ${(m + half).toFixed(4)}]`
    + `  ${groundLabel}`
    + `   (pre-change reference 1.0021 over 1,000 line-years)`);
  if (line === 'GL') {
    const cs = ratioCapped[line];
    const mc = mean(cs);
    const halfC = Z99 * sd(cs) / Math.sqrt(cs.length);
    console.log(`      $1M-capped ratio ${mc.toFixed(4)} over ${cs.length} line-years, 99% CI [${(mc - halfC).toFixed(4)}, ${(mc + halfC).toFixed(4)}]`
      + `  THE GATE: ${note(Math.abs(mc - 1) <= halfC, `GL capped drawn/expected ${mc.toFixed(4)} excludes 1.00 at 99% (CI half-width ${halfC.toFixed(4)}) — on a BOUNDED-VARIANCE basis this is a structural divergence between the draw and its own expectation, not sampling noise`)}`);
  }
  // SHAPE OF THE DISTRIBUTION — REPORTED, NOT GATED, and the reason matters.
  //
  // A first draft asserted that the fraction of line-years reaching expectation
  // should sit near half. THAT IS INVALID HERE, for the same reason the fixed
  // percentage band on Property's damage ratio was: it imports a
  // roughly-symmetric intuition into a heavy-tailed statistic. Both lines carry
  // a lumpy tail — WC's $9.8M catastrophic annuity, GL's alpha-1.3 Pareto — so
  // the MEAN of the annual aggregate sits far ABOVE its median, and the fraction
  // of years reaching the mean is naturally well below half even when pricing is
  // exactly right. A band around 0.5 would fail on correct code.
  //
  // Measured, and IDENTICAL on the pre-marketplace code (attributed by running
  // this same measurement on both, 40 seeds x 5 years): WC median 0.7305 with
  // 75/200 at-or-above; GL median 0.7009 with 48/200. Marketplace-wide
  // generation moved neither figure by a digit, which is the containment result
  // and the reason these are reference values rather than a finding.
  //
  // The GATE is the mean against its own CI above. This block exists so that a
  // future reader who sees a mean of 0.93 can tell skew from a shortfall.
  const sorted = xs.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const above = xs.filter(r => r >= 1).length;
  console.log(`      median ${median.toFixed(4)}, line-years at/above expectation ${above}/${xs.length}`
    + ` (${(above / xs.length * 100).toFixed(0)}%) — REPORTED: mean >> median on a heavy tail, so this is`
    + ` expected to sit below half. Pre-marketplace reference: WC 75/200 med 0.7305, GL 48/200 med 0.7009.`);
}

console.log('\n--- 6. RUNTIME ---');
console.log(`  ${SEEDS.length * YEARS} processYear calls in ${(genT / 1000).toFixed(2)}s  (${(genT / (SEEDS.length * YEARS)).toFixed(1)}ms per game-year, 200 members x 2 claim lines)`);
console.log(`  whole harness ${(wall / 1000).toFixed(2)}s including ${SEEDS.length} bootstraps`);

console.log('');
if (problems.length === 0) {
  console.log('ALL MARKETPLACE GENERATION CHECKS PASS.');
} else {
  console.log(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.log(`  - ${p}`);
  process.exit(1);
}
