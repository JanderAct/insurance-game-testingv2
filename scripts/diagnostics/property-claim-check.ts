// Statistical verification of the Property ATTRITIONAL generator (design doc
// property_noncat_design NC1). Read-only; drives propertyClaimEngine directly,
// not the game engine — Property is NOT cut over and still runs the legacy
// aggregate path. Per finding 8, everything here is distributional across many
// draws; nothing is a baseline diff.
//
// Run: npx tsx scripts/diagnostics/property-claim-check.ts
//
// VERIFICATION DISCIPLINE FOR THIS BAND. The damage ratio is Beta(0.08, 1.92),
// whose density is UNBOUNDED at zero. Every quantity derived from it here is
// checked by Monte Carlo or closed form (E[dr] = mu exactly) and NEVER by
// fixed-grid quadrature, which mis-integrates the spike — that error once
// produced 21.8 per-risk breaches/yr against a true 1.78.
//
// TAIL STRUCTURE — READ BEFORE SETTING A TOLERANCE. This band is light-tailed
// in FREQUENCY and heavy-tailed in ANNUAL DOLLARS, and conflating the two is a
// mistake this harness previously made in writing.
//   claim COUNT   CV 0.098  — genuinely stable, exactly as NC1.1 intends
//                             (Poisson core, eps SD 0.15, no NegBin)
//   annual GROSS  CV 0.622  — NOT stable
// The dollar variance comes from the location schedule being deliberately
// CONCENTRATED: one claim on the $93.5M primary asset can reach ~4x the entire
// year's expected loss. That concentration is not incidental — it is the whole
// mechanism keeping the per-risk treaty alive (NC1.2). A band engineered to
// throw occasional huge single-risk losses cannot have a light-tailed annual
// total.
//
// Consequence: dollar quantities get 99% CI gates against realized variance,
// never fixed percentages. At CV 0.622 the standard error is 9.8% at 40 years
// and 1.8% at 1,200 — so a 3% fixed bar fails constantly on correct code.
// Counts, being genuinely stable, can carry a fixed bar.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { PROPERTY_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import {
  computeKPr,
  deriveNeutralPropertyPurePremiumPer100,
  expectedPropertyGrossLoss,
  generatePropertyClaims,
  locationCount,
  locationTivAt,
  propertyInternals,
  PROPERTY_BOOKED_TREND_FACTOR,
} from '../../src/utils/propertyClaimEngine';
import type { Member } from '../../src/types/simulation';

const M = PROPERTY_LOSS_MODEL;
const YEARS = 40;               // independent draw-years per configuration
const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const sdOf = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
// 99% half-width on the MEAN. 99% not 95%: several dollar quantities are gated
// here, and at 95% the chance that at least one flags on correct code is high
// enough to train us to ignore the harness.
const ci99 = (xs: number[]) => 2.5758 * sdOf(xs) / Math.sqrt(xs.length);

const roster = getPredefinedMarketMembers();

function runYears(members: Member[], years: number, opts: { rc?: number; seedBase?: number; kPr?: number } = {}) {
  const kPr = opts.kPr ?? computeKPr(members);
  const out = [];
  for (let y = 1; y <= years; y++) {
    out.push(generatePropertyClaims({
      members, yearNumber: y, calendarYear: 2025 + y,
      instanceSeed: (opts.seedBase ?? 5150) + y * 7919,
      kPr, gPool: 1, riskControlEffectiveness: opts.rc ?? 0,
    }));
  }
  return out;
}

console.log(`=== Property ATTRITIONAL generator: full canonical market, ${YEARS} draw-years, gPool=1, no RC ===\n`);

console.log('--- 1. location schedule (the two stored roster columns) ---');
{
  const totalLocations = roster.reduce((s, m) => s + locationCount(m), 0);
  console.log(`  locations total ${totalLocations}  ${note(totalLocations === 1866, `locations ${totalLocations} != 1866`)}`);
  let worstSum = 0, biggest = 0, notLargest = 0;
  for (const m of roster) {
    const n = locationCount(m);
    let s = 0;
    for (let i = 0; i < n; i++) { const v = locationTivAt(m, i); s += v; if (v > biggest) biggest = v; }
    worstSum = Math.max(worstSum, Math.abs(s - (m.exposureByLine.Property ?? 0)));
    if (n > 1 && locationTivAt(m, 0) <= locationTivAt(m, 1)) notLargest++;
  }
  console.log(`  schedule sums to member TIV: worst error $${(worstSum * 1e6).toFixed(6)}  ${note(worstSum < 1e-9, 'location schedule does not sum to member TIV')}`);
  console.log(`  largest single location ${fmt$(biggest * 1e6)}  ${note(Math.abs(biggest - 93.5) < 0.5, `largest location $${biggest.toFixed(1)}M != ~$93.5M`)}`);
  // DOCUMENTED, NOT ASSERTED: "primary" means designated, not largest.
  console.log(`  members whose designated primary is NOT their largest: ${notLargest} — documented, not asserted (9 expected at v3)`);
  const single = roster.filter(m => locationCount(m) === 1).length;
  console.log(`  single-location members: ${single} (none at v3; the engine still guards the divide)`);
}

console.log('\n--- 2. frequency and the expected-loss identity (NC1.5) ---');
{
  const runs = runYears(roster, 400, { seedBase: 5150 });
  const counts = runs.map(r => r.claimCountsByBand.attritional);
  const gross = runs.map(r => r.grossUltimateLoss);
  const totalTiv = roster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const kPr = computeKPr(roster);

  // THE COUNT TARGET IS NOT 112. 1,866 x 0.06 = 112.0 is the NEUTRAL count, at
  // RQ 5 with k_PR = 1 — not what this configuration draws. k_PR normalizes
  // expected LOSS, which is TIV-weighted and carries BOTH RQ channels, while
  // the count is location-weighted and carries only the frequency channel.
  // The two cannot both be preserved; the model-derived count is what the
  // generator must match, and 112.0 is reported as the design reference.
  let analyticCount = 0;
  for (const m of roster) {
    analyticCount += locationCount(m) * M.baseFrequencyPerLocation
      * propertyInternals.thetaFrequency(m.riskQuality) * kPr;
  }
  const neutralCount = roster.reduce((s, m) => s + locationCount(m), 0) * M.baseFrequencyPerLocation;
  console.log(`  claims/yr ${mean(counts).toFixed(2)} vs model analytic ${analyticCount.toFixed(2)}  ${note(Math.abs(mean(counts) / analyticCount - 1) < 0.03, `claims/yr ${mean(counts).toFixed(2)} vs analytic ${analyticCount.toFixed(2)}`)}`);
  console.log(`    (neutral reference 1,866 x 0.06 = ${neutralCount.toFixed(1)}; the ${((analyticCount / neutralCount - 1) * 100).toFixed(1)}% gap is k_PR + RQ mix, structural — see comment)`);

  // The identity, in ACCIDENT-YEAR dollars, then carried to booked dollars.
  const identity = totalTiv * 1e6 * M.baseFrequencyPerLocation * M.damageRatio.mean;
  const identityBooked = identity * PROPERTY_BOOKED_TREND_FACTOR;
  console.log(`  identity (accident-yr $): ${totalTiv.toFixed(1)} x 0.06 x 0.04 = ${fmt$(identity)}`);
  console.log(`  identity (booked, x${PROPERTY_BOOKED_TREND_FACTOR.toFixed(4)}) = ${fmt$(identityBooked)}`);
  const ci = ci99(gross);
  console.log(`  drawn gross/yr ${fmt$(mean(gross))} vs ${fmt$(identityBooked)} (${((mean(gross) / identityBooked - 1) * 100).toFixed(2)}%, 99% CI +/-${(ci / identityBooked * 100).toFixed(2)}%)  ${note(Math.abs(mean(gross) - identityBooked) <= ci, `drawn ${fmt$(mean(gross))} outside its 99% CI of the identity ${fmt$(identityBooked)}`)}`);
  const m0 = mean(counts);
  const vm = counts.reduce((a, b) => a + (b - m0) ** 2, 0) / counts.length / m0;
  console.log(`  count variance/mean ${vm.toFixed(2)} — mild overdispersion expected (eps SD 0.15, Poisson core)`);
  console.log(`  count CV ${(sdOf(counts) / mean(counts)).toFixed(3)} vs annual-gross CV ${(sdOf(gross) / mean(gross)).toFixed(3)} — stable in frequency, heavy in dollars`);
}

console.log('\n--- 3. severity: the insured-value cap and the damage ratio ---');
{
  const runs = runYears(roster, YEARS, { seedBase: 31337 });
  const all = runs.flatMap(r => r.claims);
  // HARD ASSERT, in accident-year dollars: damageRatio x locationTiv <=
  // locationTiv, i.e. no claim exceeds the insured value of what it hit.
  let capBreaches = 0, ratioOutOfRange = 0, bookedOverTrend = 0;
  for (const c of all) {
    const ay = (c.damageRatio ?? 0) * (c.locationTiv ?? 0);
    if (ay > (c.locationTiv ?? 0) + 1e-6) capBreaches++;
    if ((c.damageRatio ?? -1) < 0 || (c.damageRatio ?? 2) > 1) ratioOutOfRange++;
    if (c.grossUltimate > (c.locationTiv ?? 0) * PROPERTY_BOOKED_TREND_FACTOR + 1e-6) bookedOverTrend++;
  }
  console.log(`  n = ${all.length} claims`);
  console.log(`  accident-yr severity <= hit location TIV: ${capBreaches} breaches  ${note(capBreaches === 0, `${capBreaches} claims exceed their location's insured value`)}`);
  console.log(`  damage ratio within [0,1]: ${ratioOutOfRange} violations  ${note(ratioOutOfRange === 0, 'damage ratio outside [0,1]')}`);
  console.log(`  booked severity <= locationTIV x ${PROPERTY_BOOKED_TREND_FACTOR.toFixed(4)}: ${bookedOverTrend} breaches  ${note(bookedOverTrend === 0, 'booked severity exceeds the trended cap')}`);
  console.log(`    (booked may exceed accident-year TIV by up to the payout trend — rebuilding later costs more; that is not a cap breach)`);
  const drs = all.map(c => c.damageRatio ?? 0).sort((a, b) => a - b);
  const q = (p: number) => drs[Math.floor(p * drs.length)];
  const dm = mean(drs);
  console.log(`  damage ratio: mean ${dm.toFixed(4)} vs closed form ${M.damageRatio.mean.toFixed(4)}  ${note(Math.abs(dm - M.damageRatio.mean) / M.damageRatio.mean < 0.06, `damage ratio mean ${dm.toFixed(4)}`)}`);
  console.log(`    median ${q(0.5).toFixed(5)}  p75 ${q(0.75).toFixed(4)}  p90 ${q(0.90).toFixed(4)}  p99 ${q(0.99).toFixed(4)}  max ${drs[drs.length - 1].toFixed(4)}`);
  console.log(`    J-shaped (median << mean): ${note(q(0.5) < dm / 3, 'damage ratio not J-shaped')}`);
  console.log(`    tail: P(dr>0.10) ${(drs.filter(x => x > 0.10).length / drs.length * 100).toFixed(2)}%  P(dr>0.40) ${(drs.filter(x => x > 0.40).length / drs.length * 100).toFixed(2)}% — REPORTED`);
}

console.log('\n--- 4. per-risk layer (the $2M retention) — REPORTED, wide sanity band ---');
{
  // WHY THIS IS REPORTED AND NOT HARD-GATED. This rate is a design input to the
  // reinsurance tower (the $2M retention was sized against ~1.7-1.8/yr), so the
  // number must be KNOWN — but it is a rare-event count with real structural
  // spread between bases, and a tight gate on it would fire on correct code.
  //
  // THE DETERMINISTIC-VS-FULL DECOMPOSITION, computed exactly (Beta survival
  // integrated from x to 1, away from the t=0 singularity):
  //
  //   1.776/yr   flat RQ 5, k_PR = 1, accident-year threshold
  //                  <- the spec's reference basis; its three independent
  //                     simulations (1.77/1.78/1.78) all used these same
  //                     simplifications, so they agreed with each other but
  //                     never validated the full-machinery number.
  //   +5.5%      actual RQ dispersion            -> 1.874/yr
  //                  Breach probability is CONVEX in the severity-mu shift, so
  //                  averaging over the real RQ spread RAISES the rate. It does
  //                  not suppress it.
  //   -3.9%      k_PR = 0.9611 scaling lambda    -> 1.801/yr
  //   +1.8%      booked (settlement-trended) $   -> 1.833/yr
  //
  //   = 1.833/yr exact for what the engine actually does, confirmed by
  //     simulation at 1.851/yr over 2,000 years.
  //
  // eps and gPool do NOT appear: both have mean 1 and enter lambda LINEARLY,
  // and a breach is a per-claim severity event, so their dispersion has no
  // first-order effect on the expected count.
  //
  // HYPOTHESES CLOSED — do not reopen these without new evidence:
  //  - Beta sampler bias at shape 0.08. gamma() uses the Marsaglia-Tsang boost,
  //    so a = 0.08 computes u^12.5, which could in principle shave the right
  //    tail where breaches live. Tested at 5,000,000 draws through the real
  //    RNG path against exact incomplete-beta values: every survival
  //    probability within |z| < 1.5, mean within z = 0.54, left tail correct
  //    to 1e-100. See the note on SeededRandom.beta.
  //  - Structural covariance between the Poisson count and uniform location
  //    sampling. There is none: lambda = Locations x base_freq with uniform
  //    per-claim location choice is mathematically IDENTICAL to summing
  //    base_freq x P(breach) over locations, so nothing cancels or fails to
  //    cancel. The exact and simulated figures agree (1.833 vs 1.851 over
  //    2,000 years, ~1 Poisson SE apart), which is what that identity predicts.
  //
  // BASIS NOTE: the engine tests the BOOKED claim against the retention, since
  // a real treaty responds to the settled amount. The spec's 1.78 was measured
  // on accident-year severity, which is why the two differ by the payout trend.
  const runs = runYears(roster, 600, { seedBase: 90210 });
  const breaches = mean(runs.map(r => r.perRiskBreaches));
  const claims = mean(runs.map(r => r.claimCountsByBand.attritional));
  const inBand = breaches >= 1.4 && breaches <= 2.1;
  console.log(`  breaches/yr over $${(M.perRiskRetention / 1e6).toFixed(0)}M: ${breaches.toFixed(3)} — REPORTED`);
  console.log(`    exact for this configuration 1.833; spec reference 1.776 on the deterministic basis`);
  console.log(`    sanity band 1.4-2.1: ${inBand ? 'inside' : 'OUTSIDE'}  ${note(inBand, `per-risk breaches ${breaches.toFixed(2)} outside the 1.4-2.1 sanity band — the location schedule or the retention basis has moved`)}`);
  console.log(`  as a share of attritional claims: ${(breaches / claims * 100).toFixed(2)}%`);
  console.log(`  largest single claim ${fmt$(Math.max(...runs.map(r => r.maxClaimGross)))} — REPORTED`);
  console.log(`    (the treaty is alive ONLY through Primary Asset Share concentration — a rate far`);
  console.log(`     outside the band means the location schedule is being built wrong)`);
}

console.log('\n--- 5. RQ sweeps (NC1.3: beta_freq 0.08, beta_sev 0.04, total 0.12) ---');
{
  const uniform = (rq: number): Member[] => roster.map(m => ({ ...m, riskQuality: rq }));
  const at = (rq: number) => {
    const book = uniform(rq);
    const runs = runYears(book, YEARS, { seedBase: 4711, kPr: 1 });
    return {
      freq: mean(runs.map(r => r.claimCountsByBand.attritional)),
      sev: mean(runs.flatMap(r => r.claims).map(c => c.damageRatio ?? 0)),
      total: mean(runs.map(r => r.grossUltimateLoss)),
    };
  };
  const lo = at(0), mid = at(5), hi = at(10);
  const fr = (a: number, b: number) => a / b;
  console.log(`  frequency RQ0/RQ5 ${fr(lo.freq, mid.freq).toFixed(4)} vs exp(+5x0.08)=${Math.exp(5 * M.rqFrequencyBeta).toFixed(4)}  ${note(Math.abs(fr(lo.freq, mid.freq) - Math.exp(5 * M.rqFrequencyBeta)) / Math.exp(5 * M.rqFrequencyBeta) < 0.05, 'freq beta low side')}`);
  console.log(`  frequency RQ10/RQ5 ${fr(hi.freq, mid.freq).toFixed(4)} vs exp(-5x0.08)=${Math.exp(-5 * M.rqFrequencyBeta).toFixed(4)}  ${note(Math.abs(fr(hi.freq, mid.freq) - Math.exp(-5 * M.rqFrequencyBeta)) / Math.exp(-5 * M.rqFrequencyBeta) < 0.05, 'freq beta high side')}`);
  console.log(`  damage ratio RQ0/RQ5 ${fr(lo.sev, mid.sev).toFixed(4)} vs exp(+5x0.04)=${Math.exp(5 * M.rqSeverityBeta).toFixed(4)}  ${note(Math.abs(fr(lo.sev, mid.sev) - Math.exp(5 * M.rqSeverityBeta)) / Math.exp(5 * M.rqSeverityBeta) < 0.06, 'sev beta low side')}`);
  console.log(`  damage ratio RQ10/RQ5 ${fr(hi.sev, mid.sev).toFixed(4)} vs exp(-5x0.04)=${Math.exp(-5 * M.rqSeverityBeta).toFixed(4)}  ${note(Math.abs(fr(hi.sev, mid.sev) - Math.exp(-5 * M.rqSeverityBeta)) / Math.exp(-5 * M.rqSeverityBeta) < 0.06, 'sev beta high side')}`);
  // The two CHANNEL ratios above are the real assertions — they are counts and
  // damage ratios, both stable. The combined DOLLAR ratio is a quotient of two
  // heavy-tailed annual totals, so its own sampling error is roughly the sum of
  // theirs; it is reported against a wide band rather than gated tightly.
  const combined = fr(lo.total, hi.total);
  const target = Math.exp(10 * (M.rqFrequencyBeta + M.rqSeverityBeta));
  const channelProduct = fr(lo.freq, hi.freq) * fr(lo.sev, hi.sev);
  console.log(`  combined total-cost RQ0/RQ10 ${combined.toFixed(3)} vs exp(10x0.12)=${target.toFixed(3)} — REPORTED`);
  console.log(`    channel product (freq ratio x damage-ratio ratio) ${channelProduct.toFixed(3)} vs ${target.toFixed(3)}  ${note(Math.abs(channelProduct - target) / target < 0.06, `RQ channel product ${channelProduct.toFixed(3)} vs ${target.toFixed(3)}`)}`);
  console.log(`    (the channel product is the assertable form: it multiplies two stable ratios`);
  console.log(`     instead of dividing two heavy-tailed dollar totals)`);
}

console.log('\n--- 6. k_PR neutrality (TIV-weighted by construction) ---');
{
  // k_PR is built from expected loss, which is exactly proportional to member
  // TIV, so the ratio IS TIV-weighted with no separate weighting term.
  const shapes: [string, Member[]][] = [
    ['full roster', roster],
    ['good-RQ book', roster.filter(m => m.riskQuality >= 7)],
    ['bad-RQ book', roster.filter(m => m.riskQuality <= 3)],
    ['high-TIV book', [...roster].sort((a, b) => (b.exposureByLine.Property ?? 0) - (a.exposureByLine.Property ?? 0)).slice(0, 40)],
  ];
  for (const [label, book] of shapes) {
    if (!book.length) continue;
    const kPr = computeKPr(book);
    const withK = expectedPropertyGrossLoss(book, { kPr });
    const neutral = expectedPropertyGrossLoss(book, { riskQualityOverride: 5 });
    const err = Math.abs(withK - neutral) / Math.max(neutral, 1);
    console.log(`  ${label.padEnd(14)} k_PR ${kPr.toFixed(4)}  expected with k_PR ${fmt$(withK)} vs neutral ${fmt$(neutral)}  err ${(err * 100).toFixed(4)}%  ${note(err < 1e-9, `${label} k_PR does not neutralise`)}`);
  }
}

console.log('\n--- 7. draw vs analytic expectation (invariant 1) ---');
{
  const kPr = computeKPr(roster);
  // 1,200 years, not 40: at CV 0.622 the 99% gate is +/-4.6% here versus a
  // useless +/-25% at 40. SAMPLE SIZE, NOT TOLERANCE, BUYS DETECTION POWER —
  // widening a tolerance to stop false positives destroys the check.
  const INV1_YEARS = 1200;
  const runs = runYears(roster, INV1_YEARS, { seedBase: 611, kPr });
  const gross = runs.map(r => r.grossUltimateLoss);
  const drawn = mean(gross);
  const analytic = expectedPropertyGrossLoss(roster, { kPr });
  const ci = ci99(gross);
  console.log(`  (${INV1_YEARS} draw-years; annual-gross CV ${(sdOf(gross) / drawn).toFixed(3)})`);
  console.log(`  drawn ${fmt$(drawn)} vs analytic ${fmt$(analytic)} (${((drawn / analytic - 1) * 100).toFixed(2)}%, 99% CI +/-${(ci / analytic * 100).toFixed(2)}%)  ${note(Math.abs(drawn - analytic) <= ci, `draw outside its 99% CI of the analytic`)}`);
  // RC must move the DRAW and not the expectation. Counts, not dollars: the
  // count is the stable statistic, so this reads cleanly at a modest sample.
  const base = runYears(roster, 200, { seedBase: 611, kPr });
  const rcRuns = runYears(roster, 200, { seedBase: 611, kPr, rc: 0.15 });
  const countRatio = mean(rcRuns.map(r => r.claimCountsByBand.attritional)) / mean(base.map(r => r.claimCountsByBand.attritional));
  console.log(`  RC 15%: claim COUNT ratio ${countRatio.toFixed(4)} (expect 0.85)  ${note(Math.abs(countRatio - 0.85) < 0.02, `RC count ratio ${countRatio.toFixed(3)} vs 0.85`)}`);
  console.log(`  analytic is RC-blind (no rc argument exists): ${fmt$(analytic)}  ${note(expectedPropertyGrossLoss(roster, { kPr }) === analytic, 'analytic moved with RC')}`);
}

console.log('\n--- 8. determinism, integrity, and the attritional-only pure premium ---');
{
  const a = generatePropertyClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601, kPr: 1, gPool: 1.05, riskControlEffectiveness: 0.05 });
  const b = generatePropertyClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601, kPr: 1, gPool: 1.05, riskControlEffectiveness: 0.05 });
  console.log(`  same inputs -> identical output: ${note(JSON.stringify(a) === JSON.stringify(b), 'not deterministic')}`);
  const sum = a.claims.reduce((s, c) => s + c.grossUltimate, 0);
  console.log(`  sum(claims) === grossUltimateLoss: ${note(Math.abs(sum - a.grossUltimateLoss) < 1e-6, `claim sum off by ${Math.abs(sum - a.grossUltimateLoss)}`)}`);
  const mSum = a.memberLossResults.reduce((s, r) => s + r.simulatedLoss, 0);
  console.log(`  member losses sum to total: ${note(Math.abs(mSum - a.grossUltimateLoss) < 1e-6, 'member losses do not sum')}`);
  console.log(`  ids unique: ${note(new Set(a.claims.map(c => c.id)).size === a.claims.length, 'duplicate claim ids')}`);
  const occIds = new Set(a.occurrences.map(o => o.id));
  console.log(`  occurrence per claim, 1:1 with consistent backrefs: ${note(a.occurrences.length === a.claims.length && a.claims.every(c => occIds.has(c.occurrenceId)) && a.occurrences.every(o => o.claimIds.length === 1), 'occurrence/claim not 1:1')}`);
  console.log(`  all amounts finite and non-negative, reserve = ultimate, paid = 0: ${note(a.claims.every(c => Number.isFinite(c.grossUltimate) && c.grossUltimate >= 0 && c.caseReserve === c.grossUltimate && c.paidToDate === 0), 'claim amount invariants broken')}`);
  console.log(`  every claim carries the 70/25/5 payout pattern: ${note(a.claims.every(c => (c.paymentPattern?.length ?? 0) === 3), 'payout pattern missing')}`);
  console.log(`  report lag 0 (property damage is known immediately): ${note(a.claims.every(c => c.reportedYear === c.accidentYear), 'report lag non-zero')}`);
  const pp = deriveNeutralPropertyPurePremiumPer100(roster);
  console.log(`\n  attritional-only pure premium ${pp.toFixed(4)} per $100 TIV`);
  console.log(`  implied full-market attritional loss ${fmt$(expectedPropertyGrossLoss(roster, { riskQualityOverride: 5, kPr: 1 }))}`);
  console.log(`  MEASUREMENT ONLY — this is 58% of the ~$28.8M property book (weather and cat are not built).`);
  console.log(`  Pricing off it would set Property at 58% of eventual loss. Cutover waits for all three bands.`);
  console.log(`  payout trend factor ${propertyInternals.payoutTrendFactor.toFixed(6)} over 70/25/5 at ${(M.severityTrendPerYear * 100).toFixed(0)}%/yr`);
}

console.log(problems.length === 0
  ? '\nALL PROPERTY ATTRITIONAL CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
