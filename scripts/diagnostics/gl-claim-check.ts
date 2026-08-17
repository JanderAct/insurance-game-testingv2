// Statistical verification of the GL claim-level generator, REBUILT onto a
// fitted per-claim 3-component lognormal mixture (see GL_LOSS_MODEL in
// defaultAssumptions.ts). Replaces the old design-doc-Part-B harness, which
// tested sub-coverages, the liability gate, litigation stages and abuse
// batches — all deleted by this rebuild.
//
// Run: npx tsx scripts/diagnostics/gl-claim-check.ts
//
// STRUCTURE: section 1 replicates the frequency-anchor derivation and the
// mixture's own closed-form moments independently of the engine, and
// validates the replica against the real exported expectedGlGrossLoss before
// trusting anything built on it — the same discipline
// wc-severity-rebuild-check.ts used for WC's rebuild. Sections 2-4 assert the
// spec's verification targets. Section 5+ exercises the draw, the RQ
// channels, and engine integrity.
//
// GL's blended CV is 29.55 (roughly double WC's ~11-14) — the draw's ground-up
// mean is gated ONLY by a wide CI (finding 26: never gate a heavy-tailed
// sample mean on a tight tolerance); the $1M-CAPPED mean is well-behaved and
// gated strictly, exactly as WC's rebuild-check does for its own mixture.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { GL_HEAVY_COMPONENT_INDEX, GL_LOSS_MODEL, GL_SEVERITY_COMPONENTS } from '../../src/data/defaultAssumptions';
import {
  computeKGl,
  deriveNeutralGlPurePremiumPer100,
  expectedClaimSeverity,
  expectedGlGrossLoss,
  generateGlClaims,
  glInternals,
  tiltedGlWeights,
} from '../../src/utils/glClaimEngine';
import { limitedExpectedValue, normalCdf } from '../../src/utils/claimMath';
import type { Claim } from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const roster = getPredefinedMarketMembers();
const M = GL_LOSS_MODEL;
const TOTAL_PAYROLL_M = roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0);

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

console.log('\n--- 2. the frequency anchor: DERIVED, not fitted ---');
{
  // rate = 2.8300 x 10,000 / 35,920 = 0.7879, per GL_LOSS_MODEL's own comment.
  const derivedRate = 2.8300 * 10_000 / ANALYTIC_1M_LIMITED_MEAN;
  console.log(`  0-$1M loss cost anchor: $2.8300 per $100 (ASSERT — this is GL's only externally-grounded number)`);
  console.log(`  derived rate: 2.8300 x 10,000 / ${ANALYTIC_1M_LIMITED_MEAN.toFixed(2)} = ${derivedRate.toFixed(4)} vs stored ${M.ratePer1M}  ${note(Math.abs(derivedRate - M.ratePer1M) < 0.0001, `derived rate ${derivedRate.toFixed(4)} vs stored ${M.ratePer1M}`)}`);

  const oneHundredLossCost0to1M = M.ratePer1M * ANALYTIC_1M_LIMITED_MEAN / 10_000;
  const groundUpLossCost = M.ratePer1M * ANALYTIC_GROUND_MEAN / 10_000;
  console.log(`  reconstructed 0-$1M loss cost: ${oneHundredLossCost0to1M.toFixed(4)} vs 2.8300  ${note(Math.abs(oneHundredLossCost0to1M - 2.8300) < 0.001, `0-$1M loss cost ${oneHundredLossCost0to1M.toFixed(4)} vs 2.8300`)}`);
  console.log(`  ground-up loss cost: ${groundUpLossCost.toFixed(4)} vs 5.8864  ${note(Math.abs(groundUpLossCost - 5.8864) < 0.001, `ground-up loss cost ${groundUpLossCost.toFixed(4)} vs 5.8864`)}`);
}

console.log('\n--- 3. full-market claims, gross, and loss by band (neutral RQ, kGl=1) ---');
{
  const fullMarketClaims = M.ratePer1M * TOTAL_PAYROLL_M;
  const fullMarketGross = fullMarketClaims * ANALYTIC_GROUND_MEAN;
  console.log(`  full-market claims: ${fullMarketClaims.toFixed(1)}/yr vs target 1,024/yr  ${note(Math.abs(fullMarketClaims - 1024) < 1, `full-market claims ${fullMarketClaims.toFixed(1)} vs 1,024`)}`);
  console.log(`  full-market gross: ${fmt$(fullMarketGross)}/yr vs target $76.5M/yr  ${note(Math.abs(fullMarketGross - 76.5e6) < 0.05e6, `full-market gross ${fmt$(fullMarketGross)} vs $76.5M`)}`);

  // Validate against the real exported expectedGlGrossLoss (neutral RQ, kGl=1
  // — the exact pricing basis deriveNeutralGlPurePremiumPer100 uses).
  const engineGross = expectedGlGrossLoss(roster, { riskQualityOverride: 5, kGl: 1 });
  console.log(`  engine expectedGlGrossLoss (RQ=5, kGl=1): ${fmt$(engineGross)}  ${note(Math.abs(engineGross - fullMarketGross) / fullMarketGross < 1e-6, 'expectedGlGrossLoss disagrees with the independent replica')}`);

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

  const survival = (x: number) => GL_SEVERITY_COMPONENTS.reduce((s, c) => {
    const z = (Math.log(x) - c.mu) / c.sigma;
    return s + c.weight * (1 - normalCdf(z));
  }, 0);
  const occ1M = M.ratePer1M * TOTAL_PAYROLL_M * survival(1_000_000);
  const occ5M = M.ratePer1M * TOTAL_PAYROLL_M * survival(5_000_000);
  const occ25M = M.ratePer1M * TOTAL_PAYROLL_M * survival(25_000_000);
  console.log(`  occurrences (== claims) over $1M: ${occ1M.toFixed(3)}/yr vs target 11.400/yr  ${note(Math.abs(occ1M - 11.400) < 0.01, `occ>$1M ${occ1M.toFixed(3)} vs 11.400`)}`);
  console.log(`  occurrences over $5M: ${occ5M.toFixed(3)}/yr vs target 1.989/yr  ${note(Math.abs(occ5M - 1.989) < 0.01, `occ>$5M ${occ5M.toFixed(3)} vs 1.989`)}`);
  console.log(`  occurrences over $25M: ${occ25M.toFixed(3)}/yr vs target 0.236/yr  ${note(Math.abs(occ25M - 0.236) < 0.005, `occ>$25M ${occ25M.toFixed(3)} vs 0.236`)}`);
  console.log(`  (dropping batches cut this from ~14.7/yr to ${occ25M.toFixed(3)}/yr — a ~${(14.7 / occ25M).toFixed(0)}x reduction, matching the measured consequence recorded in GL_LOSS_MODEL's header)`);
}

console.log('\n--- 4. RQ channels: frequency unchanged, severity tilt NEW and draw-only ---');
{
  const b = M.rqFrequencyBeta;
  console.log(`  rqFrequencyBeta = ${b} (unchanged from before the gate was deleted)  ${note(b === 0.055, `rqFrequencyBeta is ${b}, expected 0.055`)}`);
  console.log(`  theta(RQ0)/theta(RQ5) = ${Math.exp(5 * b).toFixed(4)} vs exp(5x${b})=${Math.exp(5 * b).toFixed(4)}  OK by construction`);

  // The tilt: heavy component's weight at RQ0/RQ5/RQ10, and the renormalised
  // others. At RQ5 (neutral) this must be the identity.
  const w5 = tiltedGlWeights(5);
  const w0 = tiltedGlWeights(0);
  const w10 = tiltedGlWeights(10);
  const untilted = GL_SEVERITY_COMPONENTS.map(c => c.weight);
  // Tolerance 1e-6, not 1e-9, for the same reason as the weight-sum check
  // above: the renormalisation scale factor inherits the fit's ~1e-7 rounding
  // residual (otherTotal is computed from weights that sum to 1.0000001, not
  // exactly 1), so exact identity at RQ5 is not achievable to machine
  // precision — only to the precision the input weights carry.
  console.log(`  RQ5 (neutral) tilt is the identity: ${note(w5.every((w, i) => Math.abs(w - untilted[i]) < 1e-6), 'RQ5 tilt is not the identity')}`);
  const factor0 = Math.exp(-M.rqSeverityBeta * (0 - 5)), factor10 = Math.exp(-M.rqSeverityBeta * (10 - 5));
  console.log(`  heavy component weight: RQ0 ${w0[GL_HEAVY_COMPONENT_INDEX].toFixed(4)} (x${factor0.toFixed(4)}) / RQ5 ${w5[GL_HEAVY_COMPONENT_INDEX].toFixed(4)} / RQ10 ${w10[GL_HEAVY_COMPONENT_INDEX].toFixed(4)} (x${factor10.toFixed(4)})`);
  console.log(`  RQ0 heavy weight matches exp(-0.06x(0-5)): ${note(Math.abs(w0[GL_HEAVY_COMPONENT_INDEX] - untilted[GL_HEAVY_COMPONENT_INDEX] * factor0) < 1e-9, 'RQ0 heavy tilt does not match the formula')}`);
  console.log(`  weights still sum to 1 at every RQ: ${note([w0, w5, w10].every(w => Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9), 'tilted weights do not sum to 1')}`);
  console.log(`  clamp never binds in the roster's RQ range (max heavy weight ${Math.max(...[w0, w5, w10].map(w => w[GL_HEAVY_COMPONENT_INDEX])).toFixed(4)} << 0.999): ${note(Math.max(...[w0, w5, w10].map(w => w[GL_HEAVY_COMPONENT_INDEX])) < 0.999, 'clamp is binding')}`);

  // INVARIANT 2: the tilt must NEVER reach the pricing expectation. RQ0 and
  // RQ10 severity means (via expectedGlGrossLoss with an RQ override) must be
  // identical, because the analytic always uses untilted weights.
  const grossRQ0 = expectedGlGrossLoss(roster, { riskQualityOverride: 0, kGl: 1 });
  const grossRQ10 = expectedGlGrossLoss(roster, { riskQualityOverride: 10, kGl: 1 });
  const freqOnlyRatio = grossRQ0 / grossRQ10;
  const expectedFreqOnlyRatio = Math.exp(-b * (0 - 5)) / Math.exp(-b * (10 - 5));
  console.log(`  pricing expectation RQ0/RQ10 ratio ${freqOnlyRatio.toFixed(4)} vs FREQUENCY-ONLY ${expectedFreqOnlyRatio.toFixed(4)} (severity tilt absent from pricing): ${note(Math.abs(freqOnlyRatio - expectedFreqOnlyRatio) < 1e-6, 'pricing expectation carries the severity tilt — invariant 2 violated')}`);
}

console.log('\n--- 5. draw vs analytic (invariant 1): $1M-capped mean GATED, ground-up REPORTED ---');
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

  const analyticGross = expectedGlGrossLoss(roster, { kGl }); // actual RQ mix, untilted (pricing basis)
  const analyticCapped = (() => {
    // Capped analytic MATCHED TO THE DRAW, not to the pricing basis: the draw
    // tilts each member's severity mix by their OWN risk quality
    // (tiltedGlWeights, draw-only), so a member's realized capped mean is NOT
    // the untilted pricing-basis mean whenever that member's RQ != 5. Using
    // the untilted mean here would compare the draw against the wrong
    // quantity — invariant 2 says the TILT stays out of pricing, not that the
    // tilt stays out of a check that is specifically about the draw.
    let total = 0;
    for (const member of roster) {
      const theta = glInternals.thetaGl(member.riskQuality);
      const payroll = member.exposureByLine.GL ?? 0;
      const lambda = payroll * M.ratePer1M * theta * kGl;
      const weights = tiltedGlWeights(member.riskQuality);
      const cappedMean = GL_SEVERITY_COMPONENTS.reduce((s, c, i) => s + weights[i] * limitedExpectedValue(c.mu, c.sigma, 1_000_000), 0);
      total += lambda * cappedMean;
    }
    return total;
  })();

  const drawnGround = mean(groundPerYear);
  const drawnCapped = mean(cappedPerYear);
  const relGround = (drawnGround - analyticGross) / analyticGross;
  console.log(`  ground-up: drawn ${fmt$(drawnGround)} vs analytic ${fmt$(analyticGross)} (${(relGround * 100).toFixed(2)}%, 99% CI +/-${(ciHalf(groundPerYear) / analyticGross * 100).toFixed(2)}%)  REPORTED, NOT GATED (CV 29.55: heavy-tailed sample mean, finding 26)`);
  const cappedInCI = Math.abs(drawnCapped - analyticCapped) <= ciHalf(cappedPerYear);
  console.log(`  $1M-capped: drawn ${fmt$(drawnCapped)} vs analytic ${fmt$(analyticCapped)} (${((drawnCapped / analyticCapped - 1) * 100).toFixed(2)}%, 99% CI +/-${(ciHalf(cappedPerYear) / analyticCapped * 100).toFixed(2)}%)  ${note(cappedInCI, `$1M-capped mean outside its 99% CI of the analytic — gross-error signal, investigate`)}`);

  const drawnCount = mean(claimCounts);
  const analyticCount = roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0) * glInternals.thetaGl(m.riskQuality), 0) * M.ratePer1M * kGl;
  const countCI = ciHalf(claimCounts);
  console.log(`  claim COUNT (bounded-variance instrument): drawn ${drawnCount.toFixed(2)}/yr vs analytic ${analyticCount.toFixed(2)}/yr, 99% CI +/-${countCI.toFixed(2)}  ${note(Math.abs(drawnCount - analyticCount) <= countCI, 'claim count outside its 99% CI')}`);

  const compCounts = { component1: 0, component2: 0, component3: 0 } as Record<string, number>;
  for (const c of allClaims) compCounts[c.tier] = (compCounts[c.tier] ?? 0) + 1;
  const compShare = Object.fromEntries(Object.entries(compCounts).map(([k, v]) => [k, v / allClaims.length]));
  console.log(`  component draw shares (300yr sample): component1 ${(compShare.component1 * 100).toFixed(1)}% (weight ${(GL_SEVERITY_COMPONENTS[0].weight * 100).toFixed(1)}%), component2 ${(compShare.component2 * 100).toFixed(1)}% (weight ${(GL_SEVERITY_COMPONENTS[1].weight * 100).toFixed(1)}%), component3 ${(compShare.component3 * 100).toFixed(1)}% (weight ${(GL_SEVERITY_COMPONENTS[2].weight * 100).toFixed(1)}%)`);
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
