// Statistical verification of the GL claim-level generator, REBUILT onto a
// fitted per-claim 3-component lognormal mixture (see GL_LOSS_MODEL in
// defaultAssumptions.ts). Replaces the old design-doc-Part-B harness, which
// tested sub-coverages, the liability gate, litigation stages and abuse
// batches — all deleted by this rebuild.
//
// Run: npx tsx scripts/diagnostics/gl-claim-check.ts
//
// STRUCTURE: section 1 replicates the mixture's closed-form moments
// independently of the engine and validates the replica against the real
// exported functions before trusting anything built on them — the same
// discipline wc-severity-rebuild-check.ts used for WC's rebuild. 2 is the
// frequency anchor, 2b is k_GL's identity, 3 the distribution targets, 4 the
// RQ channels, 5 the draw, 6 integrity.
//
// ============================================================================
// EVERY CHECK IS LABELLED [ANALYTIC] OR [DRAWN], AND THAT DISTINCTION MATTERS.
//
//   [ANALYTIC]  closed form vs the spec's own closed form. A real check of the
//               PARAMETERS and the arithmetic; NO check of the generator. It
//               cannot be "suspiciously tight" because no sampling is involved.
//   [DRAWN]     measured from generateGlClaims. Only these test the generator.
//               Each carries a CI, and whether that CI is TRUSTWORTHY depends
//               entirely on whether the quantity has bounded variance:
//                 trustworthy  counts, rates, quantiles, CAPPED means
//                 NOT          any ground-up mean of a heavy-tailed severity
//
// GL's blended CV is 29.55 (component 1 alone: 99.1% of loss at CV 21.5), so a
// ground-up sample mean is dominated by the largest draw seen and CANNOT carry a
// gate at any realistic sample size — finding 26. Ground-up figures here are
// REPORTED with their CI marked untrustworthy; the gates sit on capped means and
// on counts. A previous version of this file mislabelled a circular closed-form
// identity as a verification of the anchor; see section 2.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { GL_HEAVY_COMPONENT_INDEX, GL_LOSS_MODEL, GL_SEVERITY_COMPONENTS } from '../../src/data/defaultAssumptions';
import {
  computeKGl,
  deriveNeutralGlPurePremiumPer100,
  expectedClaimSeverity,
  expectedGlGrossLossForKLine,
  expectedGlGrossLossForPricing,
  generateGlClaims,
  glInternals,
  tiltedGlWeights,
} from '../../src/utils/glClaimEngine';
import { limitedExpectedValue, normalCdf } from '../../src/utils/claimMath';
import type { Claim } from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sdOfAll = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const ci99 = (xs: number[]) => 2.5758 * sdOfAll(xs) / Math.sqrt(xs.length);
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const roster = getPredefinedMarketMembers();
const M = GL_LOSS_MODEL;
const TOTAL_PAYROLL_M = roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0);

// Mixture survival P(X > x) — used by both the analytic occurrence counts in
// section 3 and their drawn counterparts' targets in section 5.
const survivalAt = (x: number) => GL_SEVERITY_COMPONENTS.reduce((s, c) => {
  const z = (Math.log(x) - c.mu) / c.sigma;
  return s + c.weight * (1 - normalCdf(z));
}, 0);

console.log(`=== GL generator: full canonical market ($${TOTAL_PAYROLL_M.toFixed(1)}M payroll), fitted 3-component mixture ===\n`);

console.log('--- 1. mixture moments, replicated independently and validated against the engine ---');
let ANALYTIC_GROUND_MEAN = 0, ANALYTIC_1M_LIMITED_MEAN = 0;
{
  // Tolerance 1e-6, not 1e-9: the fitted weights are given to 6 decimal
  // places and carry a ~1e-7 rounding residual (0.519201 + 0.0629521 +
  // 0.417847 = 1.0000001) from the source fit itself — immaterial at the
  // dollar level, not a code bug, and not something to silently "correct" by
  // renormalising numbers the spec gave verbatim.
  const weightSum = GL_SEVERITY_COMPONENTS.reduce((s, c) => s + c.weight, 0);
  console.log(`  weights sum to 1: ${weightSum.toFixed(7)} (residual ${(weightSum - 1).toExponential(2)}, from the fit's own 6dp rounding)  ${note(Math.abs(weightSum - 1) < 1e-6, `component weights sum to ${weightSum}, off by more than the expected 6dp rounding residual`)}`);

  // Replica of the ground-up and $1M-limited mixture means, from the raw
  // component parameters directly — no reference to glClaimEngine's own
  // expectedClaimSeverity, so this is a genuine independent cross-check.
  for (const c of GL_SEVERITY_COMPONENTS) {
    ANALYTIC_GROUND_MEAN += c.weight * Math.exp(c.mu + (c.sigma * c.sigma) / 2);
    ANALYTIC_1M_LIMITED_MEAN += c.weight * limitedExpectedValue(c.mu, c.sigma, 1_000_000);
  }
  console.log(`  ground-up mean: replica $${ANALYTIC_GROUND_MEAN.toFixed(2)} vs target $74,714  ${note(Math.abs(ANALYTIC_GROUND_MEAN - 74_714) < 1, `ground-up mean $${ANALYTIC_GROUND_MEAN.toFixed(2)} vs $74,714`)}`);
  console.log(`  $1M-limited mean: replica $${ANALYTIC_1M_LIMITED_MEAN.toFixed(2)} vs target $35,920  ${note(Math.abs(ANALYTIC_1M_LIMITED_MEAN - 35_920) < 1, `$1M-limited mean $${ANALYTIC_1M_LIMITED_MEAN.toFixed(2)} vs $35,920`)}`);

  // Validate the replica against the real exported expectedClaimSeverity
  // (untilted weights — the pricing basis) before trusting anything downstream.
  const engineGroundMean = expectedClaimSeverity(GL_SEVERITY_COMPONENTS.map(c => c.weight));
  console.log(`  replica vs expectedClaimSeverity: ${engineGroundMean.toFixed(6)} vs ${ANALYTIC_GROUND_MEAN.toFixed(6)}  ${note(Math.abs(engineGroundMean - ANALYTIC_GROUND_MEAN) < 1e-6, 'expectedClaimSeverity disagrees with the independent replica')}`);
}

console.log('\n--- 2. the frequency anchor: DERIVED, and checked BY SIMULATION not by rearranging it ---');
{
  // rate = 2.8300 x 10,000 / 35,920 = 0.7879, per GL_LOSS_MODEL's own comment.
  // ASSERTED ANALYTICALLY: that the stored constant matches the derivation.
  const derivedRate = 2.8300 * 10_000 / ANALYTIC_1M_LIMITED_MEAN;
  console.log(`  0-$1M loss cost anchor: $2.8300 per $100 — GL's only externally-grounded number`);
  console.log(`  [ANALYTIC] derived rate: 2.8300 x 10,000 / ${ANALYTIC_1M_LIMITED_MEAN.toFixed(2)} = ${derivedRate.toFixed(4)} vs stored ${M.ratePer1M}  ${note(Math.abs(derivedRate - M.ratePer1M) < 0.0001, `derived rate ${derivedRate.toFixed(4)} vs stored ${M.ratePer1M}`)}`);

  // ⚠ THE OLD VERSION OF THIS CHECK WAS CIRCULAR AND HAS BEEN REPLACED.
  // It computed `ratePer1M * ANALYTIC_1M_LIMITED_MEAN / 10000` and compared it
  // to 2.83 — which is the derivation above rearranged, over the same closed
  // form and the same inputs. It is an arithmetic identity: it cannot fail
  // unless 0.7879 is mistyped, and it says nothing about whether the GENERATOR
  // reproduces the anchor. Do not reinstate it.
  //
  // THE INDEPENDENT ROUTE: simulate, cap each claim at $1M, divide by exposure.
  // Never touches the closed form. Capping bounds per-claim variance, so the CI
  // is valid however heavy the raw tail is (finding 26).
  const YEARS = 4000;
  const neutralBook = roster.map(m => ({ ...m, riskQuality: 5 }));
  const capped: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const r = generateGlClaims({
      members: neutralBook, yearNumber: y, calendarYear: 2025 + y,
      instanceSeed: 555_001 + y * 7919, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
    });
    capped.push(r.claims.reduce((s, c) => s + Math.min(c.grossUltimate, 1_000_000), 0));
  }
  const drawnCost = mean(capped) / (TOTAL_PAYROLL_M * 10_000);
  const ciCost = ci99(capped) / (TOTAL_PAYROLL_M * 10_000);
  console.log(`  [DRAWN, ${YEARS} yrs, uniform RQ 5, kGl=1] 0-$1M loss cost ${drawnCost.toFixed(5)} per $100, 99% CI +/-${ciCost.toFixed(5)} (+/-${(ciCost / drawnCost * 100).toFixed(3)}%)`);
  console.log(`      vs the 2.83000 anchor: ${note(Math.abs(drawnCost - 2.83) <= ciCost, `the DRAWN capped loss cost ${drawnCost.toFixed(5)} is outside its 99% CI of the 2.83 anchor — the generator does not reproduce the anchor its rate was derived from`)}`);

  // Ground-up loss cost stays an ANALYTIC assertion: its drawn counterpart has a
  // ~3% CI at 4,000 years (CV 29.55), so nothing tight is assertable there.
  const groundUpLossCost = M.ratePer1M * ANALYTIC_GROUND_MEAN / 10_000;
  console.log(`  [ANALYTIC] ground-up loss cost: ${groundUpLossCost.toFixed(4)} vs 5.8864  ${note(Math.abs(groundUpLossCost - 5.8864) < 0.001, `ground-up loss cost ${groundUpLossCost.toFixed(4)} vs 5.8864`)}`);
}

console.log('\n--- 2b. k_GL NEUTRALISES BOTH RQ CHANNELS (the held-pure-premium identity) ---');
{
  // ⚠ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE k_GL DEFECT.
  // computeKGl used to call the PRICING basis on both sides, which is untilted —
  // so the severity term cancelled out of the ratio and k_GL corrected FREQUENCY
  // ONLY, while the draw applied the tilt anyway. Drawn expected loss then
  // diverged from the held priced expectation by up to 26.6% as the book's RQ mix
  // moved, and because underwriting selection moves that mix, a player who
  // underwrote well earned a hidden margin. Exact, deterministic, no draw noise —
  // and it must hold across the WHOLE RQ range, not just at neutral where the
  // tilt is the identity and everything trivially agrees.
  //
  // WC satisfies the same identity to 1.33e-15 (see wcClaimEngine's computeKLine).
  let worst = 0, worstRq = 0;
  for (const q of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const book = roster.map(m => ({ ...m, riskQuality: q }));
    const kGl = computeKGl(book);
    const drawnBasis = expectedGlGrossLossForKLine(book, { kGl });
    const heldPriced = expectedGlGrossLossForPricing(book, { riskQualityOverride: 5, kGl: 1 });
    const dev = Math.abs(drawnBasis / heldPriced - 1);
    if (dev > worst) { worst = dev; worstRq = q; }
  }
  console.log(`  uniform books RQ 1..10: worst |drawn-basis / held-priced - 1| = ${worst.toExponential(2)} at RQ ${worstRq}`);
  console.log(`  ${note(worst < 1e-12, `k_GL does not neutralise both RQ channels: drawn expected loss diverges from the held priced expectation by ${(worst * 100).toFixed(2)}% at RQ ${worstRq}. computeKGl must use the k_GL basis (tilted) on BOTH sides — see its comment.`)}`);
  // And on the real, non-uniform roster.
  const kFull = computeKGl(roster);
  const devFull = Math.abs(expectedGlGrossLossForKLine(roster, { kGl: kFull })
    / expectedGlGrossLossForPricing(roster, { riskQualityOverride: 5, kGl: 1 }) - 1);
  console.log(`  full canonical roster (mixed RQ): deviation ${devFull.toExponential(2)}  ${note(devFull < 1e-12, `k_GL identity fails on the real roster by ${(devFull * 100).toFixed(2)}%`)}`);
  // The two bases MUST differ away from neutral, or the tilt is not reaching the
  // draw at all — the converse failure, and just as silent.
  const at1 = roster.map(m => ({ ...m, riskQuality: 1 }));
  const spread = expectedGlGrossLossForKLine(at1, { kGl: 1 }) / expectedGlGrossLossForPricing(at1, { kGl: 1 });
  console.log(`  the two bases DO differ at RQ 1 (ratio ${spread.toFixed(4)}): ${note(Math.abs(spread - 1) > 0.05, 'the k_GL and pricing bases are identical away from neutral — the severity tilt is not in the k_GL basis, so k_GL is correcting nothing extra')}`);
}

console.log('\n--- 3. [ANALYTIC] full-market claims, gross, loss by band, occurrence counts ---');
{
  // ALL FIGURES IN THIS SECTION ARE [ANALYTIC] — closed-form mixture moments and
  // survival probabilities. Their DRAWN counterparts, with CIs and a trustworthy/
  // not verdict for each, are measured in section 5.
  const fullMarketClaims = M.ratePer1M * TOTAL_PAYROLL_M;
  const fullMarketGross = fullMarketClaims * ANALYTIC_GROUND_MEAN;
  console.log(`  full-market claims: ${fullMarketClaims.toFixed(1)}/yr vs target 1,024/yr  ${note(Math.abs(fullMarketClaims - 1024) < 1, `full-market claims ${fullMarketClaims.toFixed(1)} vs 1,024`)}`);
  console.log(`  full-market gross: ${fmt$(fullMarketGross)}/yr vs target $76.5M/yr  ${note(Math.abs(fullMarketGross - 76.5e6) < 0.05e6, `full-market gross ${fmt$(fullMarketGross)} vs $76.5M`)}`);

  // Validate against the real exported expectedGlGrossLossForPricing (neutral RQ, kGl=1
  // — the exact pricing basis deriveNeutralGlPurePremiumPer100 uses).
  const engineGross = expectedGlGrossLossForPricing(roster, { riskQualityOverride: 5, kGl: 1 });
  console.log(`  engine expectedGlGrossLossForPricing (RQ=5, kGl=1): ${fmt$(engineGross)}  ${note(Math.abs(engineGross - fullMarketGross) / fullMarketGross < 1e-6, 'expectedGlGrossLossForPricing disagrees with the independent replica')}`);

  const bandMean = (lo: number, hi: number) => {
    const limLo = lo > 0 ? GL_SEVERITY_COMPONENTS.reduce((s, c) => s + c.weight * limitedExpectedValue(c.mu, c.sigma, lo), 0) : 0;
    const limHi = Number.isFinite(hi) ? GL_SEVERITY_COMPONENTS.reduce((s, c) => s + c.weight * limitedExpectedValue(c.mu, c.sigma, hi), 0) : ANALYTIC_GROUND_MEAN;
    return limHi - limLo;
  };
  const below1M = bandMean(0, 1_000_000) / ANALYTIC_GROUND_MEAN;
  const oneMto25M = bandMean(1_000_000, 25_000_000) / ANALYTIC_GROUND_MEAN;
  const above25M = bandMean(25_000_000, Infinity) / ANALYTIC_GROUND_MEAN;
  console.log(`  loss by band: below $1M ${(below1M * 100).toFixed(1)}% (target 48.1%)  ${note(Math.abs(below1M - 0.481) < 0.002, `below-$1M share ${(below1M * 100).toFixed(1)}% vs 48.1%`)}`);
  console.log(`                $1M-$25M ${(oneMto25M * 100).toFixed(1)}% (target 40.0%)  ${note(Math.abs(oneMto25M - 0.400) < 0.002, `$1M-$25M share ${(oneMto25M * 100).toFixed(1)}% vs 40.0%`)}`);
  console.log(`                above $25M ${(above25M * 100).toFixed(1)}% (target 12.0%)  ${note(Math.abs(above25M - 0.120) < 0.002, `above-$25M share ${(above25M * 100).toFixed(1)}% vs 12.0%`)}`);
  console.log(`                bands sum to 1: ${note(Math.abs(below1M + oneMto25M + above25M - 1) < 1e-9, 'loss bands do not sum to 1')}`);

  const occ1M = M.ratePer1M * TOTAL_PAYROLL_M * survivalAt(1_000_000);
  const occ5M = M.ratePer1M * TOTAL_PAYROLL_M * survivalAt(5_000_000);
  const occ25M = M.ratePer1M * TOTAL_PAYROLL_M * survivalAt(25_000_000);
  console.log(`  occurrences (== claims) over $1M: ${occ1M.toFixed(3)}/yr vs target 11.400/yr  ${note(Math.abs(occ1M - 11.400) < 0.01, `occ>$1M ${occ1M.toFixed(3)} vs 11.400`)}`);
  console.log(`  occurrences over $5M: ${occ5M.toFixed(3)}/yr vs target 1.989/yr  ${note(Math.abs(occ5M - 1.989) < 0.01, `occ>$5M ${occ5M.toFixed(3)} vs 1.989`)}`);
  console.log(`  occurrences over $25M: ${occ25M.toFixed(3)}/yr vs target 0.236/yr  ${note(Math.abs(occ25M - 0.236) < 0.005, `occ>$25M ${occ25M.toFixed(3)} vs 0.236`)}`);
  console.log(`  (dropping batches cut this from ~14.7/yr to ${occ25M.toFixed(3)}/yr — a ~${(14.7 / occ25M).toFixed(0)}x reduction, matching the measured consequence recorded in GL_LOSS_MODEL's header)`);
}

console.log('\n--- 4. [ANALYTIC] RQ channels: frequency unchanged, severity tilt NEW and draw-only ---');
{
  const b = M.rqFrequencyBeta;
  console.log(`  rqFrequencyBeta = ${b} (unchanged from before the gate was deleted)  ${note(b === 0.055, `rqFrequencyBeta is ${b}, expected 0.055`)}`);
  console.log(`  theta(RQ0)/theta(RQ5) = ${Math.exp(5 * b).toFixed(4)} vs exp(5x${b})=${Math.exp(5 * b).toFixed(4)}  OK by construction`);

  // The tilt: heavy component's weight at RQ0/RQ5/RQ10, and the renormalised
  // others. At RQ5 (neutral) this must be the identity.
  const w5 = tiltedGlWeights(5);
  const w0 = tiltedGlWeights(0);
  const w10 = tiltedGlWeights(10);
  // THE REFERENCE IS THE NORMALISED WEIGHT VECTOR, not the raw stored one. The
  // stored weights sum to 1.0000001 (the fit's 6dp rounding); glClaimEngine
  // normalises once and both expectation bases and the tilt all work off that
  // single normalised vector, which is what makes k_GL's identity exact (see
  // NORMALISED_WEIGHTS there, and section 2b). Comparing against the RAW weights
  // here would reintroduce that 1e-7 as a phantom discrepancy in the harness.
  const rawTotal = GL_SEVERITY_COMPONENTS.reduce((s, c) => s + c.weight, 0);
  const untilted = GL_SEVERITY_COMPONENTS.map(c => c.weight / rawTotal);
  console.log(`  RQ5 (neutral) tilt is the identity: ${note(w5.every((w, i) => Math.abs(w - untilted[i]) < 1e-15), 'RQ5 tilt is not the identity against the normalised base')}`);
  const factor0 = Math.exp(-M.rqSeverityBeta * (0 - 5)), factor10 = Math.exp(-M.rqSeverityBeta * (10 - 5));
  console.log(`  heavy component weight: RQ0 ${w0[GL_HEAVY_COMPONENT_INDEX].toFixed(4)} (x${factor0.toFixed(4)}) / RQ5 ${w5[GL_HEAVY_COMPONENT_INDEX].toFixed(4)} / RQ10 ${w10[GL_HEAVY_COMPONENT_INDEX].toFixed(4)} (x${factor10.toFixed(4)})`);
  console.log(`  RQ0 heavy weight matches exp(-0.06x(0-5)): ${note(Math.abs(w0[GL_HEAVY_COMPONENT_INDEX] - untilted[GL_HEAVY_COMPONENT_INDEX] * factor0) < 1e-15, 'RQ0 heavy tilt does not match the formula')}`);
  console.log(`  weights still sum to 1 at every RQ: ${note([w0, w5, w10].every(w => Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9), 'tilted weights do not sum to 1')}`);
  console.log(`  clamp never binds in the roster's RQ range (max heavy weight ${Math.max(...[w0, w5, w10].map(w => w[GL_HEAVY_COMPONENT_INDEX])).toFixed(4)} << 0.999): ${note(Math.max(...[w0, w5, w10].map(w => w[GL_HEAVY_COMPONENT_INDEX])) < 0.999, 'clamp is binding')}`);

  // INVARIANT 2: the tilt must NEVER reach the pricing expectation. RQ0 and
  // RQ10 severity means (via expectedGlGrossLossForPricing with an RQ override) must be
  // identical, because the analytic always uses untilted weights.
  const grossRQ0 = expectedGlGrossLossForPricing(roster, { riskQualityOverride: 0, kGl: 1 });
  const grossRQ10 = expectedGlGrossLossForPricing(roster, { riskQualityOverride: 10, kGl: 1 });
  const freqOnlyRatio = grossRQ0 / grossRQ10;
  const expectedFreqOnlyRatio = Math.exp(-b * (0 - 5)) / Math.exp(-b * (10 - 5));
  console.log(`  pricing expectation RQ0/RQ10 ratio ${freqOnlyRatio.toFixed(4)} vs FREQUENCY-ONLY ${expectedFreqOnlyRatio.toFixed(4)} (severity tilt absent from pricing): ${note(Math.abs(freqOnlyRatio - expectedFreqOnlyRatio) < 1e-6, 'pricing expectation carries the severity tilt — invariant 2 violated')}`);
}

console.log('\n--- 5. [DRAWN] every section-3 target measured from the generator, with CIs ---');
{
  // Finding 26: never gate a heavy-tailed sample mean. GL's blended CV is
  // 29.55 (computed from the full mixture, roughly double WC's 11-14), so the
  // ground-up mean is dominated by the largest draw seen at any realistic
  // sample size. The $1M-capped mean has bounded per-observation variance
  // (capped at $1M), so a normal CI is valid there however heavy the
  // underlying tail is — same reasoning the tower diagnostics use for a
  // finite reinsurance layer.
  const kGl = computeKGl(roster);
  const YEARS = 1500;
  const Z99 = 2.5758;
  const groundPerYear: number[] = [];
  const cappedPerYear: number[] = [];
  const claimCounts: number[] = [];
  let allClaims: Claim[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const r = generateGlClaims({
      members: roster, yearNumber: y, calendarYear: 2025 + y,
      instanceSeed: 4242 + y * 7919, kGl, gPool: 1, riskControlEffectiveness: 0,
    });
    groundPerYear.push(r.grossUltimateLoss);
    cappedPerYear.push(r.claims.reduce((s, c) => s + Math.min(c.grossUltimate, 1_000_000), 0));
    claimCounts.push(r.claimCount);
    if (y <= 300) allClaims = allClaims.concat(r.claims);
  }
  const sdOf = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
  const ciHalf = (xs: number[]) => Z99 * sdOf(xs) / Math.sqrt(xs.length);

  // Both analytics come from the engine's own expectation on the basis that
  // matches what is being compared:
  //   ground-up / capped DRAW  <-> the k_GL basis (tilted), because the draw
  //     tilts each member's mix by their own RQ. Comparing the draw against the
  //     untilted PRICING basis would be comparing it to a different quantity —
  //     invariant 2 says the tilt stays out of pricing, not out of a check whose
  //     subject is the draw.
  // Using expectedGlGrossLossForKLine(..., { severityLimit }) rather than a
  // hand-rolled loop keeps ONE definition of GL's capped expectation.
  const analyticGround = expectedGlGrossLossForKLine(roster, { kGl });
  const analyticCapped = expectedGlGrossLossForKLine(roster, { kGl, severityLimit: 1_000_000 });

  const drawnGround = mean(groundPerYear);
  const drawnCapped = mean(cappedPerYear);
  console.log(`  ground-up loss/yr:  drawn ${fmt$(drawnGround)} vs analytic ${fmt$(analyticGround)} (${((drawnGround / analyticGround - 1) * 100).toFixed(2)}%, 99% CI +/-${(ciHalf(groundPerYear) / analyticGround * 100).toFixed(2)}%)   CI NOT TRUSTWORTHY (CV 29.55) — REPORTED, NOT GATED`);
  const cappedInCI = Math.abs(drawnCapped - analyticCapped) <= ciHalf(cappedPerYear);
  console.log(`  $1M-capped loss/yr: drawn ${fmt$(drawnCapped)} vs analytic ${fmt$(analyticCapped)} (${((drawnCapped / analyticCapped - 1) * 100).toFixed(2)}%, 99% CI +/-${(ciHalf(cappedPerYear) / analyticCapped * 100).toFixed(2)}%)   CI valid (bounded)  ${note(cappedInCI, `$1M-capped mean outside its 99% CI of the analytic — gross-error signal, investigate`)}`);

  const drawnCount = mean(claimCounts);
  const analyticCount = roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0) * glInternals.thetaGl(m.riskQuality), 0) * M.ratePer1M * kGl;
  const countCI = ciHalf(claimCounts);
  console.log(`  claims/yr:          drawn ${drawnCount.toFixed(2)} vs analytic ${analyticCount.toFixed(2)}, 99% CI +/-${countCI.toFixed(2)}   CI valid (count)  ${note(Math.abs(drawnCount - analyticCount) <= countCI, 'claim count outside its 99% CI')}`);

  // --- the section-3 targets, measured. Neutral book so the targets' own basis
  // applies (kGl=1, RQ 5) and the tilt is inert.
  const NEUTRAL_YEARS = 4000;
  const neutral = roster.map(m => ({ ...m, riskQuality: 5 }));
  const nCounts: number[] = [], nGround: number[] = [], nCapped: number[] = [];
  const over1: number[] = [], over5: number[] = [], over25: number[] = [];
  const bBelow1: number[] = [], b1to25: number[] = [], bAbove25: number[] = [];
  let claimSample: number[] = [];
  for (let y = 1; y <= NEUTRAL_YEARS; y++) {
    const r = generateGlClaims({
      members: neutral, yearNumber: y, calendarYear: 2025 + y,
      instanceSeed: 909_101 + y * 7919, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
    });
    nCounts.push(r.claimCount);
    nGround.push(r.grossUltimateLoss);
    nCapped.push(r.claims.reduce((s, c) => s + Math.min(c.grossUltimate, 1e6), 0));
    over1.push(r.claims.filter(c => c.grossUltimate > 1e6).length);
    over5.push(r.claims.filter(c => c.grossUltimate > 5e6).length);
    over25.push(r.claims.filter(c => c.grossUltimate > 25e6).length);
    let x1 = 0, x2 = 0, x3 = 0;
    for (const c of r.claims) {
      x1 += Math.min(c.grossUltimate, 1e6);
      x2 += Math.max(0, Math.min(c.grossUltimate, 25e6) - 1e6);
      x3 += Math.max(0, c.grossUltimate - 25e6);
    }
    bBelow1.push(x1); b1to25.push(x2); bAbove25.push(x3);
    if (y <= 400) claimSample = claimSample.concat(r.claims.map(c => c.grossUltimate));
  }
  const row = (label: string, xs: number[], target: number, trustworthy: boolean, dp = 4) => {
    const d = mean(xs), ci = ciHalf(xs);
    const inCI = Math.abs(d - target) <= ci;
    const verdict = trustworthy
      ? note(inCI, `${label.trim()} drawn ${d.toFixed(dp)} outside its 99% CI (+/-${ci.toFixed(dp)}) of the analytic target ${target.toFixed(dp)}`)
      : (inCI ? 'within CI' : 'OUTSIDE CI') + ' — CI NOT TRUSTWORTHY, reported only';
    console.log(`    ${label.padEnd(24)} drawn ${d.toFixed(dp).padStart(12)}  99% CI +/-${ci.toFixed(dp).padStart(10)}  target ${target.toFixed(dp).padStart(12)}  ${((d / target - 1) * 100).toFixed(2).padStart(6)}%  ${verdict}`);
  };
  console.log(`\n    (${NEUTRAL_YEARS} draw-years, uniform RQ 5, kGl=1 — the section-3 targets' own basis)`);
  row('claims/yr', nCounts, M.ratePer1M * TOTAL_PAYROLL_M, true, 2);
  row('occurrences > $1M /yr', over1, M.ratePer1M * TOTAL_PAYROLL_M * survivalAt(1e6), true);
  row('occurrences > $5M /yr', over5, M.ratePer1M * TOTAL_PAYROLL_M * survivalAt(5e6), true);
  row('occurrences > $25M /yr', over25, M.ratePer1M * TOTAL_PAYROLL_M * survivalAt(25e6), true);
  row('$1M-limited mean $', claimSample.map(x => Math.min(x, 1e6)), ANALYTIC_1M_LIMITED_MEAN, true, 2);
  row('0-$1M cost /$100', nCapped.map(x => x / (TOTAL_PAYROLL_M * 10_000)), 2.8300, true, 5);
  console.log('    --- below here the CI is NOT trustworthy: heavy-tailed ground-up quantities ---');
  row('mean claim $', claimSample, ANALYTIC_GROUND_MEAN, false, 2);
  row('ground-up cost /$100', nGround.map(x => x / (TOTAL_PAYROLL_M * 10_000)), 5.8864, false, 4);
  const bTot = mean(bBelow1) + mean(b1to25) + mean(bAbove25);
  console.log(`    band shares: below $1M ${(mean(bBelow1) / bTot * 100).toFixed(2)}% (target 48.10) | $1M-$25M ${(mean(b1to25) / bTot * 100).toFixed(2)}% (40.00) | above $25M ${(mean(bAbove25) / bTot * 100).toFixed(2)}% (12.00)`);
  console.log(`      REPORTED ONLY — a ratio of dollar sums, so the >$25M share inherits the full tail.`);

  const compCounts = { component1: 0, component2: 0, component3: 0 } as Record<string, number>;
  for (const c of allClaims) compCounts[c.tier] = (compCounts[c.tier] ?? 0) + 1;
  const compShare = Object.fromEntries(Object.entries(compCounts).map(([k, v]) => [k, v / allClaims.length]));
  console.log(`\n  component draw shares (300yr sample): component1 ${(compShare.component1 * 100).toFixed(1)}% (weight ${(GL_SEVERITY_COMPONENTS[0].weight * 100).toFixed(1)}%), component2 ${(compShare.component2 * 100).toFixed(1)}% (weight ${(GL_SEVERITY_COMPONENTS[1].weight * 100).toFixed(1)}%), component3 ${(compShare.component3 * 100).toFixed(1)}% (weight ${(GL_SEVERITY_COMPONENTS[2].weight * 100).toFixed(1)}%)`);
}

console.log('\n--- 6. determinism, integrity, shock signal, held pure premium ---');
{
  const a = generateGlClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 8675309, kGl: 1, gPool: 1, riskControlEffectiveness: 0.05 });
  const b = generateGlClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 8675309, kGl: 1, gPool: 1, riskControlEffectiveness: 0.05 });
  console.log(`  same inputs -> identical output: ${note(JSON.stringify(a) === JSON.stringify(b), 'not deterministic')}`);
  const sum = a.claims.reduce((s, c) => s + c.grossUltimate, 0);
  console.log(`  sum(claims) === grossUltimateLoss: ${note(Math.abs(sum - a.grossUltimateLoss) < 1e-6, 'claim sum mismatch')}`);
  console.log(`  claimCount === claims.length: ${note(a.claimCount === a.claims.length, 'claimCount does not match claims array')}`);
  console.log(`  member losses sum to total: ${note(Math.abs(a.memberLossResults.reduce((s, m) => s + m.simulatedLoss, 0) - a.grossUltimateLoss) < 1e-6, 'member sums mismatch')}`);
  console.log(`  ids unique: ${note(new Set(a.claims.map(c => c.id)).size === a.claims.length, 'duplicate ids')}`);
  console.log(`  occurrence === claim, every occurrence has exactly one claimId: ${note(a.occurrences.every(o => o.claimIds.length === 1), 'an occurrence carries more than one claim — batches should be gone')}`);
  console.log(`  every claim's occurrence exists & backrefs: ${note((() => { const occ = new Map(a.occurrences.map(o => [o.id, o])); return a.claims.every(c => occ.get(c.occurrenceId)?.claimIds.includes(c.id)); })(), 'occurrence backrefs broken')}`);
  console.log(`  reportedYear === accidentYear on every claim (no report lag): ${note(a.claims.every(c => c.reportedYear === c.accidentYear), 'a claim reported after its accident year — GL should have no lag')}`);

  // Shock signal (J11): with 0 risk control this year's kGl=1 book at RQ mix,
  // check the signal fires across a real sample.
  let shockYears = 0;
  const SIGNAL_YEARS = 300;
  for (let y = 1; y <= SIGNAL_YEARS; y++) {
    const r = generateGlClaims({ members: roster, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 909 + y * 7919, kGl: 1, gPool: 1, riskControlEffectiveness: 0 });
    if (r.maxOccurrenceGross > 1_000_000) shockYears++;
  }
  console.log(`  years with an occurrence > $1M (shock signal, J11): ${shockYears}/${SIGNAL_YEARS} (${(shockYears / SIGNAL_YEARS * 100).toFixed(0)}%)  ${note(shockYears > 0, 'shock signal never fires')}`);

  const pp = deriveNeutralGlPurePremiumPer100(roster);
  console.log(`  held neutral GL purePremiumPer100 = ${pp.toFixed(4)} ($ per $100 payroll)  ${note(pp > 0 && Number.isFinite(pp), 'pure premium not finite')}`);
  console.log(`  implied full-market expected GL loss = ${fmt$(pp * TOTAL_PAYROLL_M * 10_000)}`);
}

console.log(problems.length === 0 ? '\nALL GL GENERATOR CHECKS PASS.' : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
