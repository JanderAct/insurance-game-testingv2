// Statistical verification of the Property ATTRITIONAL band (sections 1-8,
// design doc property_noncat_design NC1) and the NON-CAT WEATHER band
// (sections 9-13, NC2). Read-only; drives propertyClaimEngine directly, not the
// game engine — Property is NOT cut over and still runs the legacy aggregate
// path. Per finding 8, everything here is distributional across many draws;
// nothing is a baseline diff.
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
import { PROPERTY_LOSS_MODEL, PROPERTY_WEATHER_MODEL } from '../../src/data/defaultAssumptions';
import {
  computeKPr,
  deriveNeutralPropertyPurePremiumPer100,
  expectedPropertyGrossLoss,
  expectedWeatherGrossLoss,
  generatePropertyClaims,
  generateWeatherEvent,
  generateWeatherEvents,
  groupMembersByZone,
  locationCount,
  locationTivAt,
  propertyInternals,
  PROPERTY_BOOKED_TREND_FACTOR,
  WEATHER_BOOKED_TREND_FACTOR,
} from '../../src/utils/propertyClaimEngine';
import { lognormalPartialMoment, normalCdf } from '../../src/utils/claimMath';
import { deriveSubRng } from '../../src/utils/random';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import type { CoverageLine, Member } from '../../src/types/simulation';

const M = PROPERTY_LOSS_MODEL;
const W = PROPERTY_WEATHER_MODEL;
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

// A REAL enrolled Property book, taken from the game's own enrollment path
// rather than reconstructed here — the share is drawn per seed inside
// STARTING_EXPOSURE_SHARE (25-35% of market TIV), so a hand-rolled subset would
// drift from what the engine actually enrolls.
//
// EVERY TREATY-FACING FIGURE HAS TO BE READ ON THIS BASIS, NOT THE FULL MARKET.
// A treaty responds to the POOL's claims, and the pool is roughly a quarter of
// the market, so a full-market firing rate runs ~3.7x high. Several per-risk
// figures quoted in this project were full-market and therefore wrong by that
// factor.
function enrolledPropertyBook(instanceId: string): Member[] {
  let h = 5381;
  for (let i = 0; i < instanceId.length; i++) { h = ((h << 5) + h) ^ instanceId.charCodeAt(i); h = h >>> 0; }
  const instance = generateGameInstance(instanceId, h);
  const setup = { poolName: 'G', gameLength: 5, startingYear: 2026, instanceId, activeLines: ['Property'] as CoverageLine[] };
  const { poolState } = runPriorHistory(instance, setup as never);
  return poolState.lines.Property.members.filter(m => m.status === 'active');
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
  // ROSTER v4 VALUE. Was $93.5M at v3; the TIV rescale doubled it to $186.98M
  // (exactly 2.0x, as a pure scale change must). Update this alongside any
  // future roster revision — it is a stale-constant check, not a model check.
  console.log(`  largest single location ${fmt$(biggest * 1e6)}  ${note(Math.abs(biggest - 186.98) < 0.5, `largest location $${biggest.toFixed(1)}M != ~$186.98M (v4; was $93.5M at v3)`)}`);
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

console.log('\n--- 4. large-loss severity signal — DIAGNOSTIC ONLY, NOT GATED HERE ---');
{
  // THE TREATY-FIRING ASSERTION THAT USED TO LIVE HERE HAS BEEN REMOVED, NOT
  // WEAKENED. It read: breaches/yr above the $2M per-risk retention must fall in
  // 1.4-2.1. Two independent reasons it does not belong in a generator harness,
  // and both matter.
  //
  // 1. IT MEASURED THE WRONG BASIS. The rate below is FULL-MARKET (200 members).
  //    A treaty responds to the POOL's claims, and the pool is ~25% of market
  //    TIV, so the full-market figure runs ~3.7x the rate a treaty would
  //    actually see. Both bases are printed below so the gap is visible rather
  //    than inferred. Several per-risk figures quoted in this project — including
  //    in the comment this replaces — were full-market and wrong by that factor.
  //
  // 2. THE $2M PER-RISK RETENTION IS OBSOLETE. The property tower was settled as
  //    a SINGLE OCCURRENCE LAYER AT $5M, collapsing per-risk and cat, on the
  //    reasoning that a single-claim occurrence is still an occurrence. The old
  //    assertion therefore tested a treaty structure that no longer exists.
  //    NOTE: PROPERTY_LOSS_MODEL.perRiskRetention is STILL $2M in the constants
  //    and the generator still counts breaches against it. That counter is kept
  //    as a large-loss severity signal, which is genuinely useful — it is the
  //    one statistic that dies if the location schedule stops concentrating —
  //    but it is no longer a treaty check.
  //
  // WHERE THE TREATY CHECK GOES: the waterfall harness at cutover, measured on
  // POOL claims at the $5M occurrence retention, across all three bands
  // together. Expected there: ~0.71 breaches/yr. A treaty firing rate is a
  // PORTFOLIO property — it depends on enrolment, on the band mix, and on the
  // retention — and none of those three things is a property of a generator.
  //
  // HISTORICAL DECOMPOSITION, retained because it documents how the v3 number
  // was built and is what a future re-derivation will be checked against:
  //
  // THE DETERMINISTIC-VS-FULL DECOMPOSITION, computed exactly (Beta survival
  // integrated from x to 1, away from the t=0 singularity). ALL AT v3 TIV AND
  // FULL-MARKET — roster v4 doubled every location value, so a fixed dollar
  // threshold is now pierced far more often and none of these figures transfers:
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
  //   = 1.833/yr exact for what the engine did AT v3, confirmed by simulation at
  //     1.851/yr over 2,000 years.
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
  const pool = enrolledPropertyBook('MAMC6EA4');
  const poolTiv = pool.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const marketTiv = roster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const poolRuns = runYears(pool, 600, { seedBase: 90210 });
  const poolBreaches = mean(poolRuns.map(r => r.perRiskBreaches));
  console.log(`  claims over $${(M.perRiskRetention / 1e6).toFixed(0)}M (the obsolete per-risk threshold, kept as a severity signal):`);
  console.log(`    FULL MARKET  ${breaches.toFixed(3)}/yr — ${(breaches / claims * 100).toFixed(2)}% of attritional claims`);
  console.log(`    ENROLLED POOL ${poolBreaches.toFixed(3)}/yr at ${(poolTiv / marketTiv * 100).toFixed(1)}% of market TIV — ${(breaches / Math.max(poolBreaches, 1e-9)).toFixed(2)}x lower, and THIS is the treaty-facing basis`);
  console.log(`    v3 reference 1.833/yr exact (full-market, v3 TIV); superseded by the v4 rescale, see comment`);
  console.log(`  largest single claim ${fmt$(Math.max(...runs.map(r => r.maxClaimGross)))} (full market) — REPORTED`);
  console.log(`  NOT GATED HERE. The treaty check belongs in the waterfall harness at cutover, on POOL claims`);
  console.log(`  at the $5M single-occurrence retention across all three bands (~0.71/yr expected). A firing rate`);
  console.log(`  is a portfolio property — enrolment, band mix, retention — and none of those is a generator's.`);
  console.log(`  What this signal IS good for: the concentration it depends on. Primary Asset Share is the only`);
  console.log(`  reason large single-risk losses exist at all, so a collapse toward zero here means the location`);
  console.log(`  schedule has stopped concentrating — which no loss-ratio check would catch.`);
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

// ===========================================================================
// NON-CAT WEATHER band (NC2). Sections 9-13.
//
// TAIL STRUCTURE — READ BEFORE SETTING A TOLERANCE. Worse than the attritional
// band on both axes, for a different reason:
//   event COUNT    Poisson(7.5), so CV 0.365 — stable, fixed bars fine
//   annual GROSS   CV 1.079 — HEAVY. At 2,500 years the 99% interval on the
//                             mean is still +/-5.6%.
// The dollar variance is NOT the location schedule this time. It is intensity
// entering the event twice (footprint AND damage-ratio mean) compounded with a
// damage ratio whose Beta shape parameter is ~0.0076, giving a per-claim CV of
// about 10. So the AAL gate here is a GROSS-ERROR DETECTOR, not a precision
// instrument. Precision comes from the component checks: the closed-form
// intensity factor (section 10), the claim-weighted damage-ratio mean over ~1M
// claims (section 11), and the exact RQ assertions (section 12), all of which
// have far tighter bounded variance than the annual total.
//
// BOTH BASES ARE REPORTED THROUGHOUT: the full 200-member market (what the AAL
// target and mu are calibrated against) and a real enrolled pool at ~25-35% of
// market TIV (what a game actually simulates). Reporting only one invites the
// mistake of checking a pool-scale number against a market-scale target.

const WX_YEARS = 2500;
const WX_ZONES = propertyInternals.weatherZones;
const wxParams = propertyInternals.wxIntensityLogParams;
const WX_CAP_I = propertyInternals.wxCapIntensity;

// Rank correlation, average ranks for ties. Used instead of Pearson because
// every quantity involved is severely skewed — a Pearson correlation on event
// gross would be dominated by two or three events.
const rankOf = (v: number[]) => {
  const idx = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
};
const spearman = (xs: number[], ys: number[]) => {
  const rx = rankOf(xs), ry = rankOf(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
};
const quantiles = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p75: q(0.75), p90: q(0.90), p99: q(0.99), max: s[s.length - 1] };
};

function runWeatherYears(members: Member[], years: number, seedBase = 8080) {
  const out = [];
  for (let y = 1; y <= years; y++) {
    out.push(generateWeatherEvents({ members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: seedBase + y * 7919 }));
  }
  return out;
}

console.log(`\n\n=== Property NON-CAT WEATHER band: full canonical market, ${WX_YEARS} draw-years ===`);

// Computed ONCE and shared by sections 9-11 and 13: at ~470 claims/yr this is
// over a million claim records, and re-drawing it per section would quadruple
// the harness's runtime for no extra information.
const wxRuns = runWeatherYears(roster, WX_YEARS);
const wxEvents = wxRuns.flatMap(r => r.events);
const wxAnnualGross = wxRuns.map(r => r.grossUltimateLoss);
// Per-occurrence damage ratios, for the within-event correlation checks.
const drByOccurrence = new Map<string, number[]>();
for (const r of wxRuns) {
  for (const c of r.claims) {
    const list = drByOccurrence.get(c.occurrenceId);
    if (list) list.push(c.damageRatio ?? 0);
    else drByOccurrence.set(c.occurrenceId, [c.damageRatio ?? 0]);
  }
}

console.log('\n--- 9. weather frequency and event structure (NC2.1) ---');
{
  // HARD ASSERT, target derived from the constants rather than typed in: three
  // zones each drawing Poisson(lambdaPerZone). The count is the stable
  // statistic in this band, so it carries a real gate.
  const expectedEvents = W.lambdaPerZone * WX_ZONES.length;
  const perYear = mean(wxRuns.map(r => r.eventsDrawn));
  const poissonCi = 2.5758 * Math.sqrt(expectedEvents / WX_YEARS);
  console.log(`  events/yr ${perYear.toFixed(4)} vs ${WX_ZONES.length} zones x ${W.lambdaPerZone} = ${expectedEvents.toFixed(1)} (99% CI +/-${poissonCi.toFixed(3)})  ${note(Math.abs(perYear - expectedEvents) <= poissonCi, `weather events/yr ${perYear.toFixed(3)} outside its 99% CI of ${expectedEvents}`)}`);
  for (const zone of WX_ZONES) {
    const z = wxEvents.filter(e => e.region === zone).length / WX_YEARS;
    console.log(`    ${zone.padEnd(8)} ${z.toFixed(4)}/yr  ${note(Math.abs(z - W.lambdaPerZone) <= 2.5758 * Math.sqrt(W.lambdaPerZone / WX_YEARS), `${zone} ${z.toFixed(3)}/yr vs ${W.lambdaPerZone}`)}`);
  }
  console.log(`    (equal rates by design: weather has no regional hazard differentiation, so zones differ only through TIV)`);

  console.log(`  footprint: affected locations/event ${mean(wxEvents.map(e => e.affectedLocations)).toFixed(2)} of ${mean(wxEvents.map(e => e.locationsExposed)).toFixed(1)} exposed`);
  console.log(`  members hit per event ${mean(wxEvents.map(e => e.membersAffected)).toFixed(2)} — this is why Occurrence needs memberIds`);

  // The zero-footprint branch. It exists and is correct, but at pool scale it
  // is unreachable: missing all ~622 locations in a zone needs an intensity
  // draw so low that the joint probability is far below 1e-6. FORCED rather
  // than waited for.
  const zeroDrawn = wxEvents.filter(e => e.affectedLocations === 0).length;
  console.log(`  zero-footprint events observed: ${zeroDrawn} of ${wxEvents.length} — expected 0 at pool scale, so forced below`);
  const ctx = {
    membersByZone: groupMembersByZone(roster),
    yearNumber: 1, calendarYear: 2026,
    hitRng: deriveSubRng(1, 1, 'pr_wx_hit'), sevRng: deriveSubRng(1, 1, 'pr_wx_sev'),
  };
  const empty = generateWeatherEvent(ctx, 'North', 1e-9, 'FORCED-EMPTY');
  console.log(`  forced intensity 1e-9: ${empty.claims.length} claims, occurrence ${empty.occurrence === null ? 'null' : 'PRESENT'}  ${note(empty.occurrence === null && empty.claims.length === 0 && empty.gross === 0, 'a zero-footprint event still produced an occurrence')}`);
  console.log(`    (an occurrence with no claims is not a loss event, it is a weather report)`);

  // Multi-member occurrence integrity — the W1 type change, checked against
  // what the generator actually emits.
  let memberIdMismatch = 0, backrefBroken = 0, claimIdMismatch = 0, tagMissing = 0, singleMemberEvents = 0;
  for (const r of wxRuns) {
    const byId = new Map(r.claims.map(c => [c.id, c]));
    for (const o of r.occurrences) {
      const distinct = new Set(o.claimIds.map(id => byId.get(id)?.memberId));
      if (distinct.size === 1) singleMemberEvents++;
      // memberId present IFF exactly one member was hit.
      if ((o.memberId !== undefined) !== (o.memberIds.length === 1)) memberIdMismatch++;
      if (o.memberIds.length !== distinct.size) claimIdMismatch++;
      if (o.claimIds.some(id => !byId.has(id))) backrefBroken++;
      if (o.peril !== 'weather' || o.intensity === undefined || o.isCatastrophe !== false) tagMissing++;
    }
  }
  const occTotal = wxRuns.reduce((s, r) => s + r.occurrences.length, 0);
  console.log(`  occurrences ${occTotal}, of which single-member ${singleMemberEvents}`);
  console.log(`  memberId present iff exactly one member hit: ${memberIdMismatch} violations  ${note(memberIdMismatch === 0, `${memberIdMismatch} occurrences disagree about single-member status`)}`);
  console.log(`  memberIds matches the distinct members in claimIds: ${claimIdMismatch} violations  ${note(claimIdMismatch === 0, 'memberIds does not match the occurrence claim list')}`);
  console.log(`  every claimId resolves to a claim of this event: ${backrefBroken} violations  ${note(backrefBroken === 0, 'occurrence claimIds do not resolve')}`);
  console.log(`  peril/intensity/isCatastrophe tags present and correct: ${tagMissing} violations  ${note(tagMissing === 0, 'weather occurrence tags wrong')}`);
}

console.log('\n--- 10. intensity enters TWICE (finding 22) ---');
{
  // The whole band turns on this: intensity scales the FOOTPRINT
  // (hit_rate = min(base x I, cap)) and the DAMAGE-RATIO MEAN (mu x I), so
  // expected loss per event carries a SECOND moment of intensity — not E[I],
  // which is exactly 1 and would make intensity look free.
  console.log(`  E[min(${W.baseFootprint} x I, ${W.cap}) x I] closed form ${propertyInternals.wxIntensityFactor.toFixed(6)}`);
  console.log(`    naive base x E[I^2] = base x (1 + CV^2) = ${(W.baseFootprint * (1 + W.intensityCv ** 2)).toFixed(6)} — WRONG by ${((W.baseFootprint * (1 + W.intensityCv ** 2) / propertyInternals.wxIntensityFactor - 1) * 100).toFixed(2)}%`);
  console.log(`    the gap is the footprint cap truncating the top of the intensity draw; the design doc concludes`);
  console.log(`    from this that no closed form lands, which is true of the naive correction ONLY — splitting at`);
  console.log(`    the cap and using exact lognormal PARTIAL moments is exact, with no quadrature`);
  // Verified against the realized draw, which is the pair that has to match.
  const realized = wxEvents.map(e => Math.min(W.baseFootprint * e.intensity, W.cap) * e.intensity);
  const ci = ci99(realized);
  console.log(`  realized over ${wxEvents.length} events ${mean(realized).toFixed(6)} (99% CI +/-${(ci / propertyInternals.wxIntensityFactor * 100).toFixed(2)}%)  ${note(Math.abs(mean(realized) - propertyInternals.wxIntensityFactor) <= ci, `intensity factor drawn ${mean(realized).toFixed(6)} outside its 99% CI of ${propertyInternals.wxIntensityFactor.toFixed(6)}`)}`);

  // BOTH channels must respond to intensity. Rank correlation, because a
  // single event's gross can be 75x the median.
  const share = wxEvents.map(e => e.affectedLocations / Math.max(1, e.locationsExposed));
  const rhoFootprint = spearman(wxEvents.map(e => e.intensity), share);
  console.log(`  channel 1, footprint:  rho(intensity, affected share) ${rhoFootprint.toFixed(4)}  ${note(rhoFootprint > 0.90, `footprint does not track intensity (rho ${rhoFootprint.toFixed(3)})`)}`);
  const withDr = wxEvents.filter(e => (drByOccurrence.get(e.id)?.length ?? 0) >= 10);
  const rhoSeverity = spearman(withDr.map(e => e.intensity), withDr.map(e => mean(drByOccurrence.get(e.id)!)));
  console.log(`  channel 2, severity:   rho(intensity, event mean damage ratio) ${rhoSeverity.toFixed(4)} over ${withDr.length} events  ${note(rhoSeverity > 0.40, `damage ratio does not track intensity (rho ${rhoSeverity.toFixed(3)})`)}`);
  console.log(`    lower than channel 1 and correctly so: the event mean is estimated from ~60 draws of a Beta with`);
  console.log(`    shape ~0.0076, so per-event estimation noise dilutes a relationship that is exact in the mean`);
  console.log(`  combined:              rho(intensity, event gross) ${spearman(wxEvents.map(e => e.intensity), wxEvents.map(e => e.gross)).toFixed(4)} — REPORTED`);

  // The cap is live but rare. Reported, not gated: ~14 events in 18,600.
  const capped = wxEvents.filter(e => e.hitRate >= W.cap - 1e-12).length;
  const capExpected = wxEvents.length * (1 - normalCdf((Math.log(WX_CAP_I) - wxParams.mu) / wxParams.sigma));
  console.log(`  footprint cap binds at I >= ${WX_CAP_I}: ${capped} events vs ${capExpected.toFixed(1)} expected — REPORTED (rare-event count)`);
}

console.log('\n--- 11. weather severity, the insured-value cap, within-event correlation ---');
{
  const allDr: number[] = [];
  let capBreaches = 0, ratioOutOfRange = 0, bookedOverTrend = 0, claimTotal = 0;
  for (const r of wxRuns) {
    for (const c of r.claims) {
      claimTotal++;
      allDr.push(c.damageRatio ?? 0);
      const ay = (c.damageRatio ?? 0) * (c.locationTiv ?? 0);
      if (ay > (c.locationTiv ?? 0) + 1e-6) capBreaches++;
      if ((c.damageRatio ?? -1) < 0 || (c.damageRatio ?? 2) > 1) ratioOutOfRange++;
      if (c.grossUltimate > (c.locationTiv ?? 0) * WEATHER_BOOKED_TREND_FACTOR + 1e-6) bookedOverTrend++;
    }
  }
  console.log(`  n = ${claimTotal} claims (${(claimTotal / WX_YEARS).toFixed(1)}/yr — 4x the attritional band, because one event touches ~63 locations)`);
  console.log(`  accident-yr severity <= hit location TIV: ${capBreaches} breaches  ${note(capBreaches === 0, `${capBreaches} weather claims exceed their location's insured value`)}`);
  console.log(`  damage ratio within [0,1]: ${ratioOutOfRange} violations  ${note(ratioOutOfRange === 0, 'weather damage ratio outside [0,1]')}`);
  console.log(`  booked severity <= locationTIV x ${WEATHER_BOOKED_TREND_FACTOR.toFixed(4)}: ${bookedOverTrend} breaches  ${note(bookedOverTrend === 0, 'weather booked severity exceeds the trended cap')}`);

  // THE PRECISION CHECK OF THIS BAND. The claim-weighted mean damage ratio is
  // NOT mu: claims are size-biased toward high-intensity events, because a
  // stronger storm both hits more locations AND raises the mean of each. The
  // exact factor is E[min(bI,c) I] / E[min(bI,c)], and it lifts the observed
  // mean by ~36%. Anyone comparing the drawn mean straight to mu will conclude
  // the sampler is broken.
  const eMinTimesI = propertyInternals.wxIntensityFactor;
  const eMin = W.baseFootprint * lognormalPartialMoment(1, W.intensityCv, 1, WX_CAP_I)
    + W.cap * (1 - normalCdf((Math.log(WX_CAP_I) - wxParams.mu) / wxParams.sigma));
  const drAnalytic = W.betaMean * (eMinTimesI / eMin);
  const drCi = ci99(allDr);
  console.log(`  claim-weighted mean damage ratio ${mean(allDr).toFixed(6)} vs analytic ${drAnalytic.toFixed(6)} (99% CI +/-${(drCi / drAnalytic * 100).toFixed(2)}%)  ${note(Math.abs(mean(allDr) - drAnalytic) <= drCi, `claim-weighted damage ratio ${mean(allDr).toFixed(6)} outside its 99% CI of ${drAnalytic.toFixed(6)}`)}`);
  console.log(`    = mu ${W.betaMean} x size-biasing ${(eMinTimesI / eMin).toFixed(4)} — the +${((eMinTimesI / eMin - 1) * 100).toFixed(1)}% is structural, not sampler bias`);
  const dq = quantiles(allDr);
  console.log(`    median ${dq.median.toExponential(2)}  p75 ${dq.p75.toExponential(2)}  p90 ${dq.p90.toFixed(5)}  p99 ${dq.p99.toFixed(4)}  max ${dq.max.toFixed(4)}`);
  console.log(`    Beta shape a = mu x nu ~ ${(W.betaMean * W.betaConcentration).toFixed(5)}, so the density is extremely singular at 0:`);
  console.log(`    MOST HIT LOCATIONS TAKE A NEGLIGIBLE LOSS and a few take a large one. That is the specified model`);
  console.log(`    (NC2.1), so the claim COUNT here is not a count of material claims — REPORTED, not gated.`);

  // Within-event correlation is the band's reason for existing. The variance
  // ratio is reported rather than gated: with a per-claim damage-ratio CV near
  // 10, the shared-mean signal is only ~20% on top of within-event noise, so
  // the rank correlation in section 10 is the assertable form.
  const bigEvents = wxEvents.filter(e => (drByOccurrence.get(e.id)?.length ?? 0) >= 30);
  const eventMeans = bigEvents.map(e => mean(drByOccurrence.get(e.id)!));
  const independentPrediction = mean(bigEvents.map(e => {
    const a = drByOccurrence.get(e.id)!;
    return sdOf(a) ** 2 / a.length;
  }));
  console.log(`  within-event correlation: var(event mean dr) ${(sdOf(eventMeans) ** 2).toExponential(3)} vs ${independentPrediction.toExponential(3)} if claims were independent`);
  console.log(`    ratio ${(sdOf(eventMeans) ** 2 / independentPrediction).toFixed(2)} — REPORTED; section 10's rank correlation is the assertable form`);

  // Event totals. Quantiles, not a mean and an SD: the distribution is far too
  // skewed for either to describe it.
  const eq = quantiles(wxEvents.map(e => e.gross));
  console.log(`  event gross: median ${fmt$(eq.median)}  p75 ${fmt$(eq.p75)}  p90 ${fmt$(eq.p90)}  p99 ${fmt$(eq.p99)}  max ${fmt$(eq.max)}  mean ${fmt$(mean(wxEvents.map(e => e.gross)))}`);
  const overRetention = wxEvents.filter(e => e.gross > 5_000_000).length;
  const overPerRisk = wxRuns.flatMap(r => r.claims).filter(c => c.grossUltimate > M.perRiskRetention).length;
  console.log(`  TREATY-FACING DIAGNOSTICS — FULL-MARKET BASIS, REPORTED NOT GATED:`);
  console.log(`    events above the $5M occurrence retention: ${overRetention} of ${wxEvents.length} (${(overRetention / wxEvents.length * 100).toFixed(2)}%, ${(overRetention / WX_YEARS).toFixed(2)}/yr)`);
  console.log(`    single claims above the obsolete $2M per-risk threshold: ${overPerRisk} (${(overPerRisk / WX_YEARS).toFixed(2)}/yr)`);
  console.log(`    Both are FULL-MARKET and neither is a gate. A treaty responds to POOL claims, and the pool is`);
  console.log(`    ~25% of market TIV, so read these as roughly 4x the rate a treaty would see. The real check`);
  console.log(`    belongs in the waterfall harness at cutover, on pool claims at the $5M retention across all`);
  console.log(`    three bands together — a firing rate is a portfolio property, not a generator property.`);
  console.log(`    Nothing here is asserted against NC2.2's "both occurrence treaties silent for weather": that`);
  console.log(`    table was written at the v3 anchor and at full-market scale, and weather/cat overlap is`);
  console.log(`    accepted — NC2.3 already calls the boundary deliberately fuzzy. Weather reaching the`);
  console.log(`    occurrence layer is the model working, not a miscalibration.`);
}

console.log('\n--- 12. weather RQ channels (NC2.3: frequency LOCKED, severity beta 0.04) ---');
{
  const uniform = (rq: number): Member[] => roster.map(m => ({ ...m, riskQuality: rq }));

  // EXACT ASSERT, not statistical. RQ enters neither the Poisson draw nor the
  // per-location Bernoulli, so at a fixed seed the entire event and footprint
  // structure must be BIT-IDENTICAL between an all-RQ-0 book and an all-RQ-10
  // book. A CI-based check here would tolerate a real frequency leak; this
  // cannot.
  const a0 = generateWeatherEvents({ members: uniform(0), yearNumber: 4, calendarYear: 2029, instanceSeed: 24601 });
  const a10 = generateWeatherEvents({ members: uniform(10), yearNumber: 4, calendarYear: 2029, instanceSeed: 24601 });
  const sameEvents = a0.eventsDrawn === a10.eventsDrawn;
  const sameFootprint = JSON.stringify(a0.events.map(e => [e.region, e.intensity, e.affectedLocations, e.locationsExposed]))
    === JSON.stringify(a10.events.map(e => [e.region, e.intensity, e.affectedLocations, e.locationsExposed]));
  const sameClaimCount = a0.claims.length === a10.claims.length;
  const sameLocations = JSON.stringify(a0.claims.map(c => [c.id, c.locationTiv])) === JSON.stringify(a10.claims.map(c => [c.id, c.locationTiv]));
  console.log(`  RQ 0 vs RQ 10 at one seed: ${a0.eventsDrawn} vs ${a10.eventsDrawn} events, ${a0.claims.length} vs ${a10.claims.length} claims`);
  console.log(`  event count, zone, intensity and footprint EXACTLY identical: ${note(sameEvents && sameFootprint, 'RQ moved the weather frequency or footprint — rqFrequencyBeta must be 0')}`);
  console.log(`  claim ids and hit locations EXACTLY identical: ${note(sameClaimCount && sameLocations, 'RQ changed which locations were hit')}`);
  console.log(`    (hazard is nature's, not the member's — the design locks beta_freq to 0, and risk control is`);
  console.log(`     absent for the same reason: a per-zone hazard count has nothing member-specific to multiply)`);

  // Severity channel, gated statistically because the damage ratio is a draw.
  const drAt = (rq: number) => {
    let sum = 0, n = 0;
    for (let y = 1; y <= 200; y++) {
      const r = generateWeatherEvents({ members: uniform(rq), yearNumber: y, calendarYear: 2025 + y, instanceSeed: 4711 + y * 7919 });
      for (const c of r.claims) { sum += c.damageRatio ?? 0; n++; }
    }
    return sum / Math.max(1, n);
  };
  const d0 = drAt(0), d5 = drAt(5), d10 = drAt(10);
  const up = Math.exp(5 * W.rqSeverityBeta), down = Math.exp(-5 * W.rqSeverityBeta);
  console.log(`  damage ratio RQ0/RQ5  ${(d0 / d5).toFixed(4)} vs exp(+5x${W.rqSeverityBeta})=${up.toFixed(4)}  ${note(Math.abs(d0 / d5 - up) / up < 0.02, `weather sev beta low side ${(d0 / d5).toFixed(4)}`)}`);
  console.log(`  damage ratio RQ10/RQ5 ${(d10 / d5).toFixed(4)} vs exp(-5x${W.rqSeverityBeta})=${down.toFixed(4)}  ${note(Math.abs(d10 / d5 - down) / down < 0.02, `weather sev beta high side ${(d10 / d5).toFixed(4)}`)}`);

  // And the same channel in the analytic, where it is exact.
  const anaRatio = expectedWeatherGrossLoss(roster, { riskQualityOverride: 0 }) / expectedWeatherGrossLoss(roster, { riskQualityOverride: 5 });
  console.log(`  analytic RQ0/RQ5 ${anaRatio.toFixed(8)} vs ${up.toFixed(8)}  ${note(Math.abs(anaRatio - up) < 1e-9, 'analytic RQ channel does not match exp(-beta x dRQ)')}`);
}

console.log('\n--- 13. weather AAL at both bases, integrity, and the normalisation gap ---');
{
  const analyticActual = expectedWeatherGrossLoss(roster);
  const analyticNeutral = expectedWeatherGrossLoss(roster, { riskQualityOverride: 5 });
  const drawn = mean(wxAnnualGross);
  const ci = ci99(wxAnnualGross);

  console.log(`  FULL MARKET (what the target AAL and mu are calibrated against):`);
  console.log(`    annual-gross CV ${(sdOf(wxAnnualGross) / drawn).toFixed(3)} over ${WX_YEARS} years — heavy, so this gate is a gross-error detector`);
  console.log(`    drawn ${fmt$(drawn)} vs analytic ${fmt$(analyticActual)} (${((drawn / analyticActual - 1) * 100).toFixed(2)}%, 99% CI +/-${(ci / analyticActual * 100).toFixed(2)}%)  ${note(Math.abs(drawn - analyticActual) <= ci, 'weather draw outside its 99% CI of the analytic — invariant 1')}`);
  console.log(`    analytic at neutral RQ ${fmt$(analyticNeutral)} vs target ${fmt$(W.targetAal)} (${((analyticNeutral / W.targetAal - 1) * 100).toFixed(2)}%)  ${note(Math.abs(analyticNeutral / W.targetAal - 1) < 0.01, `weather analytic ${fmt$(analyticNeutral)} more than 1% off the ${fmt$(W.targetAal)} target`)}`);
  console.log(`      that residual is mu's rounding to three significant figures, not an error. mu was NOT re-solved`);
  console.log(`      at roster v4 because weather AAL is exactly linear in TIV; the closed form now makes an exact`);
  console.log(`      re-solve possible if one is ever wanted.`);
  const aq = quantiles(wxAnnualGross);
  console.log(`    annual gross: median ${fmt$(aq.median)}  p75 ${fmt$(aq.p75)}  p90 ${fmt$(aq.p90)}  p99 ${fmt$(aq.p99)}  max ${fmt$(aq.max)}`);
  console.log(`      median well below mean: a typical weather year is CHEAPER than the AAL, and the AAL is paid for`);
  console.log(`      by occasional very bad years — the shape that makes an aggregate treaty worth buying`);

  const pool = enrolledPropertyBook('MAMC6EA4');
  const poolTiv = pool.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const marketTiv = roster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const poolRuns = runWeatherYears(pool, 1200, 4242);
  const poolGross = poolRuns.map(r => r.grossUltimateLoss);
  const poolAnalytic = expectedWeatherGrossLoss(pool);
  const poolCi = ci99(poolGross);
  console.log(`\n  ENROLLED POOL (what a game actually simulates), seed MAMC6EA4:`);
  console.log(`    ${pool.length} members, TIV $${poolTiv.toFixed(1)}M = ${(poolTiv / marketTiv * 100).toFixed(1)}% of market, avg RQ ${mean(pool.map(m => m.riskQuality)).toFixed(2)}`);
  console.log(`    drawn ${fmt$(mean(poolGross))} vs analytic ${fmt$(poolAnalytic)} (${((mean(poolGross) / poolAnalytic - 1) * 100).toFixed(2)}%, 99% CI +/-${(poolCi / poolAnalytic * 100).toFixed(2)}%)  ${note(Math.abs(mean(poolGross) - poolAnalytic) <= poolCi, 'enrolled-pool weather draw outside its 99% CI of the analytic')}`);
  console.log(`    events/yr ${mean(poolRuns.map(r => r.eventsDrawn)).toFixed(3)} — UNCHANGED by enrolment: frequency is a per-zone`);
  console.log(`      hazard count, so a smaller book means the same storms hitting fewer locations, not fewer storms`);
  console.log(`    affected locations/event ${mean(poolRuns.flatMap(r => r.events).map(e => e.affectedLocations)).toFixed(2)}, members/event ${mean(poolRuns.flatMap(r => r.events).map(e => e.membersAffected)).toFixed(2)}`);

  // THE NORMALISATION GAP, measured rather than asserted away. Weather is not
  // scaled by k_PR — but it HAS an RQ severity channel, so at an enrolled book's
  // risk-quality mix its expected loss sits off the priced level. That drift is
  // real and needs its own normalisation on its own channel at cutover.
  const poolNeutral = expectedWeatherGrossLoss(pool, { riskQualityOverride: 5 });
  console.log(`\n  RQ DRIFT — the normalisation still owed at cutover:`);
  console.log(`    full market  actual/neutral ${(analyticActual / analyticNeutral).toFixed(4)} (${((analyticActual / analyticNeutral - 1) * 100).toFixed(2)}%)`);
  console.log(`    enrolled pool actual/neutral ${(poolAnalytic / poolNeutral).toFixed(4)} (${((poolAnalytic / poolNeutral - 1) * 100).toFixed(2)}%)`);
  console.log(`    Weather is NOT scaled by k_PR, and that must not be read as "weather is not normalised."`);
  console.log(`    It has one RQ channel (severity, beta ${W.rqSeverityBeta}) and needs its own normalisation on that`);
  console.log(`    channel — which lands at cutover, when there is a premium to normalise against.`);

  // Integrity, on one deterministic draw.
  const x = generateWeatherEvents({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601 });
  const y = generateWeatherEvents({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601 });
  const serialise = (r: typeof x) => JSON.stringify({ c: r.claims, o: r.occurrences, e: r.events, m: [...r.memberGross].sort() });
  console.log(`\n  INTEGRITY (one draw, seed 24601):`);
  console.log(`    same inputs -> identical output: ${note(serialise(x) === serialise(y), 'weather generator not deterministic')}`);
  const claimSum = x.claims.reduce((s, c) => s + c.grossUltimate, 0);
  console.log(`    sum(claims) === grossUltimateLoss: ${note(Math.abs(claimSum - x.grossUltimateLoss) < 1e-6, `weather claim sum off by ${Math.abs(claimSum - x.grossUltimateLoss)}`)}`);
  const memberSum = [...x.memberGross.values()].reduce((s, v) => s + v, 0);
  console.log(`    per-member sums === total: ${note(Math.abs(memberSum - x.grossUltimateLoss) < 1e-6, 'weather per-member sums do not reconcile to the total')}`);
  const eventSum = x.events.reduce((s, e) => s + e.gross, 0);
  console.log(`    per-event sums === total: ${note(Math.abs(eventSum - x.grossUltimateLoss) < 1e-6, 'weather per-event sums do not reconcile to the total')}`);
  console.log(`      (both views are returned because neither can be recovered from the other after the fact)`);
  console.log(`    claim ids unique: ${note(new Set(x.claims.map(c => c.id)).size === x.claims.length, 'duplicate weather claim ids')}`);
  console.log(`    occurrence ids unique: ${note(new Set(x.occurrences.map(o => o.id)).size === x.occurrences.length, 'duplicate weather occurrence ids')}`);
  console.log(`    every claim tagged tier 'weather': ${note(x.claims.every(c => c.tier === 'weather'), 'weather claim tier wrong')}`);
  console.log(`    every claim carries the ${W.payoutPattern.map(p => (p * 100).toFixed(0)).join('/')} payout pattern: ${note(x.claims.every(c => (c.paymentPattern?.length ?? 0) === W.payoutPattern.length), 'weather payout pattern missing')}`);
  console.log(`    report lag 0, reserve = ultimate, paid = 0, all amounts finite: ${note(x.claims.every(c => c.reportedYear === c.accidentYear && c.caseReserve === c.grossUltimate && c.paidToDate === 0 && Number.isFinite(c.grossUltimate) && c.grossUltimate >= 0), 'weather claim amount invariants broken')}`);
  console.log(`    booked trend factor ${WEATHER_BOOKED_TREND_FACTOR.toFixed(6)} over ${W.payoutPattern.map(p => (p * 100).toFixed(0)).join('/')} at ${(M.severityTrendPerYear * 100).toFixed(0)}%/yr`);
  console.log(`    the inputs interface has NO gPool and NO riskControlEffectiveness argument — the exclusions are`);
  console.log(`    structural, not defaulted: hazard bands are not modulated by the economic cycle, and cat must`);
  console.log(`    exclude gPool for the same reason.`);
}

console.log(problems.length === 0
  ? '\nALL PROPERTY ATTRITIONAL AND WEATHER CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
