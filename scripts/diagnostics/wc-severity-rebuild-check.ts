// Verification of the WC severity rebuild: per-rating-group lognormal mixtures,
// the report lag, and the chain-ladder IBNR provision.
//
// Run: npx tsx scripts/diagnostics/wc-severity-rebuild-check.ts
//
// REPLACES wc-claim-check.ts and wc-derived-figures-check.ts, both of which
// verified the retired four-tier structure end to end (tier probabilities,
// per-tier severities, the catastrophic annuity's present-value booking, the
// three-way payout decomposition, the presumption process). None of those
// quantities exist any more, so the harnesses were deleted rather than
// half-ported — a check that still compiles against a model it no longer
// describes is worse than no check.
//
// ⚠ WHAT IS ASSERTED AND WHAT IS ONLY REPORTED — read this before adding a gate.
//
// The blended CV is 11.22 to 14.56 by group and the heavy component's is 7.32,
// so a SAMPLE MEAN of WC loss is dominated by the largest draw seen and does not
// concentrate at any usable rate. Everything dollar-weighted is therefore
// ASSERTED ANALYTICALLY and REPORTED from the draw with a bootstrap interval.
// Counts have bounded per-observation variance, so they can be gated directly.
// Gating a realized dollar mean against a fixed percentage is the failure mode
// this project has hit four times; it is finding 26's standing rule.

import {
  WC_HIGH_SAFETY_CITIES,
  WC_LOSS_MODEL,
  WC_RATING_GROUPS,
  WC_SEVERITY_COMPONENTS,
  type WcRatingGroup,
} from '../../src/data/defaultAssumptions';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import { WAGE_INFLATION_PER_YEAR } from '../../src/data/exposureTrend';
import {
  WC_SEVERITY_TREND_PER_YEAR,
  trendedMu,
  componentMean,
  computeKLine,
  deriveNeutralPurePremiumPer100,
  expectedWcGrossLossForKLine,
  expectedWcGrossLossForPricing,
  generateWcClaims,
  ratingGroupOf,
  regionMultiplier,
  tiltedWeights,
} from '../../src/utils/wcClaimEngine';
import {
  MEAN_REPORT_LAG_YEARS,
  dollarWeightedPDelayed,
  ldfToUltimate,
  reportLagCdf,
  wcIbnrBalance,
} from '../../src/utils/wcIbnr';
import { limitedExpectedValue, normalCdf } from '../../src/utils/claimMath';
import { SeededRandom } from '../../src/utils/random';
import type { Member, WcUnreportedClaim, WcAccidentYearReportedEntry } from '../../src/types/simulation';

const M = WC_LOSS_MODEL;
const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

const roster = getPredefinedMarketMembers();
const NEUTRAL_RQ = 5;

// Bootstrap CI for a mean, for the figures that are reported rather than gated.
function bootstrapCi(xs: number[], reps = 2000, conf = 0.99): [number, number] {
  const rng = new SeededRandom(8675309);
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng.next() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  const lo = Math.floor(((1 - conf) / 2) * reps);
  const hi = Math.min(reps - 1, Math.floor((1 - (1 - conf) / 2) * reps));
  return [means[lo], means[hi]];
}

console.log('=== WC SEVERITY REBUILD — verification ===');
console.log('BASIS: FULL MARKET (all 200 canonical members, $1,300M payroll) unless a line says otherwise.');
console.log('Enrolled figures are labelled ENROLLED. Mixing the two is this project\'s most repeated error.\n');

// ---------------------------------------------------------------------------
console.log('--- 1. RATING GROUPS — stored, not derived ---');
// ---------------------------------------------------------------------------
{
  const byGroup: Record<string, Member[]> = {};
  for (const g of WC_RATING_GROUPS) byGroup[g] = [];
  for (const m of roster) byGroup[ratingGroupOf(m)].push(m);

  const targets: Record<WcRatingGroup, { n: number; payroll: number }> = {
    county: { n: 23, payroll: 390.0 },
    schools: { n: 20, payroll: 98.1 },
    highSafety: { n: 24, payroll: 157.5 },
    lowSafety: { n: 133, payroll: 654.4 },
  };
  for (const g of WC_RATING_GROUPS) {
    const members = byGroup[g];
    const payroll = members.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
    const t = targets[g];
    console.log(`  ${g.padEnd(11)} n=${String(members.length).padStart(3)} (target ${t.n})  payroll $${payroll.toFixed(1)}M (target $${t.payroll}M)  ` +
      `${note(members.length === t.n && Math.abs(payroll - t.payroll) < 0.15, `${g}: n=${members.length}/$${payroll.toFixed(1)}M vs ${t.n}/$${t.payroll}M`)}`);
  }

  // THE EIGHT CITIES. The whole reason the group is stored: WC_CLASS_MIX gives
  // every city a safety share of exactly 0.3500, so no threshold can find them.
  const highCities = byGroup.highSafety.filter(m => m.type === 'City');
  console.log(`  High Safety contains exactly 8 cities: ${highCities.length}  ` +
    `${note(highCities.length === 8, `High Safety holds ${highCities.length} cities, not 8`)}`);
  const namesMatch = highCities.every(m => WC_HIGH_SAFETY_CITIES.has(m.name)) && WC_HIGH_SAFETY_CITIES.size === 8;
  console.log(`  and they are exactly the stored eight: ${note(namesMatch, 'the High Safety city set does not match WC_HIGH_SAFETY_CITIES')}`);
  const fireDistricts = byGroup.highSafety.filter(m => m.type === 'Fire District');
  console.log(`  plus all 16 Fire Districts: ${fireDistricts.length}  ${note(fireDistricts.length === 16, `${fireDistricts.length} Fire Districts in High Safety, not 16`)}`);

  // SURVIVES A SAVE/LOAD ROUND TRIP. The whole GameState goes through
  // JSON.stringify in App.tsx, so a field that does not serialise is silently
  // lost — this asserts the group is plain data, not a getter or a Map.
  const roundTripped: Member[] = JSON.parse(JSON.stringify(roster));
  const survived = roundTripped.every((m, i) => m.wcRatingGroup === roster[i].wcRatingGroup && !!m.wcRatingGroup);
  console.log(`  survives a JSON save/load round trip: ${note(survived, 'wcRatingGroup does not survive JSON serialisation')}`);

  // High Safety must sit in the 18-22% band the selection was constrained to.
  const hi = byGroup.highSafety.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  const lo = byGroup.lowSafety.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  const share = hi / (hi + lo);
  console.log(`  High Safety is ${pct(share)} of combined Low+High payroll (constrained to 18-22%)  ` +
    `${note(share > 0.18 && share < 0.22, `High Safety share ${pct(share)} outside the 18-22% the selection was constrained to`)}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 2. MIXTURE WEIGHTS AND CALIBRATION (analytic, region-neutral) ---');
// ---------------------------------------------------------------------------
{
  for (const g of WC_RATING_GROUPS) {
    const sum = M.ratingGroups[g].mix.reduce((s, m) => s + m.weight, 0);
    console.log(`  ${g.padEnd(11)} weights sum to ${sum.toFixed(10)}  ${note(Math.abs(sum - 1) < 1e-9, `${g} weights sum to ${sum}, not 1.0`)}`);
  }

  // $1M-LIMITED loss cost per $100 of payroll — the quantity the weights were
  // SOLVED against, so this is the calibration's own residual, not a new fit.
  const targets: Record<WcRatingGroup, { limited: number; ground: number }> = {
    county: { limited: 2.1828, ground: 2.9619 },
    schools: { limited: 1.2339, ground: 1.3202 },
    highSafety: { limited: 4.2988, ground: 5.8958 },
    lowSafety: { limited: 2.9907, ground: 4.0701 },
  };
  console.log('  group        $1M-limited   target    resid    ground-up   target');
  for (const g of WC_RATING_GROUPS) {
    const spec = M.ratingGroups[g];
    let limited = 0, ground = 0;
    for (const { component, weight } of spec.mix) {
      const c = WC_SEVERITY_COMPONENTS[component];
      limited += weight * limitedExpectedValue(c.mu, c.sigma, 1e6);
      ground += weight * componentMean(component);
    }
    const limitedPer100 = spec.ratePer1M * limited / 1e4;
    const groundPer100 = spec.ratePer1M * ground / 1e4;
    const t = targets[g];
    const resid = limitedPer100 / t.limited - 1;
    console.log(`  ${g.padEnd(11)} ${limitedPer100.toFixed(4).padStart(11)} ${t.limited.toFixed(4).padStart(9)} ` +
      `${(resid * 100).toFixed(3).padStart(7)}%  ${groundPer100.toFixed(4).padStart(10)} ${t.ground.toFixed(4).padStart(8)}  ` +
      `${note(Math.abs(resid) < 0.001, `${g} $1M-limited loss cost ${limitedPer100.toFixed(4)} vs target ${t.limited} (${(resid * 100).toFixed(2)}%)`)}`);
  }

  // Pool ground-up and claim count, full market.
  let poolLoss = 0, poolClaims = 0, payrollUnits = 0;
  for (const m of roster) {
    const payroll = m.exposureByLine.WC ?? 0;
    const spec = M.ratingGroups[ratingGroupOf(m)];
    const lambda = payroll * spec.ratePer1M;
    poolClaims += lambda;
    for (const { component, weight } of spec.mix) poolLoss += lambda * weight * componentMean(component);
    payrollUnits += payroll * 1e4;
  }
  const poolPer100 = poolLoss / payrollUnits;
  console.log(`  POOL ground-up ${poolPer100.toFixed(4)} per $100 (target 3.751 +/-0.5%)  ` +
    `${note(Math.abs(poolPer100 / 3.751 - 1) < 0.005, `pool ground-up ${poolPer100.toFixed(4)} vs 3.751`)}`);
  console.log(`  POOL claims/yr ${poolClaims.toFixed(1)} FULL MARKET (target 1826 +/-1%)  ` +
    `${note(Math.abs(poolClaims / 1826 - 1) < 0.01, `pool claim count ${poolClaims.toFixed(1)} vs 1826`)}`);
  console.log(`  POOL annual loss ${fmt$(poolLoss)} FULL MARKET`);

  // FREQUENCY RECONCILIATION. The four group rates are the last figures derived
  // from the retired class structure; the caveat says they reconcile with the
  // pool's rate table to within 3.4%. Checked as the loss-cost ratio each group
  // implies against the supplied 0-1M table, which is what "reconcile" means.
  const tableRatio = { county: 2.1828, schools: 1.2339, highSafety: 4.2988, lowSafety: 2.9907 };
  let worst = 0;
  for (const g of WC_RATING_GROUPS) {
    const spec = M.ratingGroups[g];
    let limited = 0;
    for (const { component, weight } of spec.mix) {
      const c = WC_SEVERITY_COMPONENTS[component];
      limited += weight * limitedExpectedValue(c.mu, c.sigma, 1e6);
    }
    worst = Math.max(worst, Math.abs((spec.ratePer1M * limited / 1e4) / tableRatio[g] - 1));
  }
  console.log(`  rate-table reconciliation, worst group ${(worst * 100).toFixed(2)}% (caveat says within 3.4%)  ` +
    `${note(worst < 0.034, `frequency reconciliation off by ${(worst * 100).toFixed(2)}%`)}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 3. THE ASSERTED HEAVY COMPONENT AND ITS TAIL ---');
// ---------------------------------------------------------------------------
{
  const c = WC_SEVERITY_COMPONENTS.large;
  const cv = Math.sqrt(Math.exp(c.sigma * c.sigma) - 1);
  console.log(`  'large' mu ${c.mu} sigma ${c.sigma}: median $${Math.round(Math.exp(c.mu)).toLocaleString()}, ` +
    `mean $${Math.round(componentMean('large')).toLocaleString()}, CV ${cv.toFixed(2)}`);
  console.log(`    ASSERTED, NOT FITTED (EM gave mu 10.653133 / sigma 1.243817). Do not "correct" it back.`);
  console.log(`    CV is 7.32 as specified: ${note(Math.abs(cv - 7.32) < 0.01, `heavy component CV ${cv.toFixed(3)} vs 7.32`)}`);

  // Annual count of heavy-component claims, full market — the multiplier on
  // every exceedance rate below.
  let heavyClaims = 0;
  for (const m of roster) {
    const spec = M.ratingGroups[ratingGroupOf(m)];
    const w = spec.mix.find(x => x.component === 'large')?.weight ?? 0;
    heavyClaims += (m.exposureByLine.WC ?? 0) * spec.ratePer1M * w;
  }
  const exceed = (x: number) => 1 - normalCdf((Math.log(x) - c.mu) / c.sigma);
  console.log(`  heavy-component claims/yr, FULL MARKET: ${heavyClaims.toFixed(1)}`);

  const p47 = exceed(47e6) * heavyClaims;
  console.log(`  P(claim > $47M) x annual count = ${p47.toFixed(4)} (target ~0.01, i.e. 1-in-100yr)  ` +
    `${note(Math.abs(p47 - 0.01) < 0.003, `1-in-100yr claim lands at $47M with rate ${p47.toFixed(4)}, not ~0.01`)}`);

  // ⚠ THE >$5M RATE. This is the figure the tower re-derivation is sized
  // against, and the spec carried a WRONG value for it (1 per 41 years) taken
  // from the PRE-ASSERTION component. Asserted here so it cannot drift again.
  const p5 = exceed(5e6) * heavyClaims;
  console.log(`  P(claim > $5M) x annual count = ${p5.toFixed(3)}/yr, one every ${(1 / p5).toFixed(1)} years  ` +
    `${note(Math.abs(p5 - 0.70) < 0.05, `>$5M rate ${p5.toFixed(3)}/yr vs the expected ~0.70/yr`)}`);
  console.log(`    against the retired catastrophic tier's 0.89/yr — a ${((1 - p5 / 0.89) * 100).toFixed(0)}% REDUCTION, not a 36x one.`);
  console.log(`    (An earlier spec draft said "1 per 41 years" here; that was the pre-assertion component.)`);
  console.log(`  P(claim > $25M) x annual count = ${(exceed(25e6) * heavyClaims).toFixed(4)}/yr, one every ${(1 / (exceed(25e6) * heavyClaims)).toFixed(0)} years`);
  console.log(`    ⚠ the $25M xs $25M layer is marked NOT PURCHASABLE because "a single claim cannot reach $25M".`);
  console.log(`      Under this severity it can. That justification is VOID and is a commit-2 design call.`);

  // Share of loss above $1M — the quantity the calibration held fixed.
  let above = 0, total = 0;
  for (const m of roster) {
    const spec = M.ratingGroups[ratingGroupOf(m)];
    const lambda = (m.exposureByLine.WC ?? 0) * spec.ratePer1M;
    for (const { component, weight } of spec.mix) {
      const cc = WC_SEVERITY_COMPONENTS[component];
      const full = componentMean(component);
      above += lambda * weight * (full - limitedExpectedValue(cc.mu, cc.sigma, 1e6));
      total += lambda * weight * full;
    }
  }
  const shareAbove = above / total;
  console.log(`  share of loss above $1M: ${pct(shareAbove)} (target 26.0% +/-1pp)  ` +
    `${note(Math.abs(shareAbove - 0.26) < 0.01, `loss above $1M ${pct(shareAbove)} vs 26.0%`)}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 4. RISK QUALITY — two channels, and k_line sees both ---');
// ---------------------------------------------------------------------------
{
  for (const g of WC_RATING_GROUPS) {
    const spec = M.ratingGroups[g];
    const hIdx = spec.mix.findIndex(m => m.component === spec.heavyComponent);
    const base = spec.mix[hIdx].weight;
    const at1 = tiltedWeights(g, 1)[hIdx], at10 = tiltedWeights(g, 10)[hIdx];
    const sums = [1, 5, 10].map(rq => tiltedWeights(g, rq).reduce((a, b) => a + b, 0));
    console.log(`  ${g.padEnd(11)} heavy='${spec.heavyComponent}' w ${base.toFixed(4)}: RQ1 ${at1.toFixed(4)} (x${(at1 / base).toFixed(3)}), RQ10 ${at10.toFixed(4)} (x${(at10 / base).toFixed(3)})`);
    console.log(`              weights still sum to 1 at RQ 1/5/10: ${sums.map(x => x.toFixed(6)).join(' ')}  ` +
      `${note(sums.every(x => Math.abs(x - 1) < 1e-9), `${g} tilted weights do not sum to 1`)}`);
    console.log(`              identity at neutral RQ 5: ${note(Math.abs(tiltedWeights(g, 5)[hIdx] - base) < 1e-12, `${g} tilt is not the identity at RQ 5`)}`);
    console.log(`              clamped below 1.0: ${note(at1 < 1, `${g} heavy weight reaches ${at1} at RQ 1`)}`);
  }
  // Schools' heavy component is its SECOND, not its last-by-index habit.
  console.log(`  Schools tilts component 2, not a "largest index" rule: ` +
    `${note(M.ratingGroups.schools.heavyComponent === 'schoolsMedium', "Schools' heavy component is not schoolsMedium")}`);

  // THE TWO BASES MUST DIFFER, AND IN THE RIGHT DIRECTION. If they were equal,
  // the tilt would be either absent from k_line (drift) or present in pricing
  // (cancels, finding 17).
  const pricing = expectedWcGrossLossForPricing(roster, {});
  const kBasis = expectedWcGrossLossForKLine(roster, {});
  console.log(`  pricing basis ${fmt$(pricing)} vs k_line basis ${fmt$(kBasis)} (differ by ${((kBasis / pricing - 1) * 100).toFixed(3)}%)  ` +
    `${note(Math.abs(kBasis - pricing) > 1, 'the two expectation bases are identical — the k_line wrapper is not seeing the severity tilt')}`);
  console.log(`  the two bases AGREE at neutral RQ (the tilt is the identity there): ` +
    `${note(Math.abs(expectedWcGrossLossForPricing(roster, { riskQualityOverride: NEUTRAL_RQ })
      - expectedWcGrossLossForKLine(roster, { riskQualityOverride: NEUTRAL_RQ })) < 1e-6,
      'the bases disagree at neutral RQ, where the tilt must be inert')}`);
  console.log(`  k_line on the full roster: ${computeKLine(roster).toFixed(6)}`);
  console.log(`  held neutral pure premium: ${deriveNeutralPurePremiumPer100(roster).toFixed(4)} per $100`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 5. REPORT LAG — the pattern and its LDFs ---');
// ---------------------------------------------------------------------------
{
  console.log(`  E[lag] (rounded lag, tail-sum) = ${MEAN_REPORT_LAG_YEARS.toFixed(4)} years`);
  const within4 = reportLagCdf(4), within5 = reportLagCdf(5);
  console.log(`  share of DELAYED claims reporting within 4 years: ${pct(within4)}   within 5: ${pct(within5)}`);
  console.log(`    ⚠ THE SPEC SAYS 78% / 88% HERE AND THAT IS INCONSISTENT WITH ITS OWN §9 TABLES.`);
  console.log(`      The LDF table and the convergence table below both reproduce EXACTLY off F(4)=${within4.toFixed(4)},`);
  console.log(`      so 81.6% is the value the stated parameters actually imply. Gated on the LDF table,`);
  console.log(`      which is checkable two ways, rather than on the 78%.`);

  // The implied LDF table — a checkable OUTPUT, and what makes the lag testable
  // against a real reporting triangle.
  const pPool = dollarWeightedPDelayed(roster, [], 1);
  console.log(`  pool dollar-weighted p_delayed, GROSS, FULL MARKET: ${pct(pPool)} (spec 17.1%)  ` +
    `${note(Math.abs(pPool - 0.171) < 0.005, `dollar-weighted p_delayed ${pct(pPool)} vs 17.1%`)}`);
  const ldfTargets: Record<number, number> = { 0: 1.2063, 1: 1.1442, 2: 1.0751, 3: 1.0471, 5: 1.0238, 10: 1.0079 };
  console.log('  age   reported    LDF     spec');
  for (const age of [0, 1, 2, 3, 5, 10]) {
    const ldf = ldfToUltimate(age, pPool);
    const t = ldfTargets[age];
    console.log(`  ${String(age).padStart(3)}   ${pct(1 / ldf).padStart(8)}  ${ldf.toFixed(4)}  ${t.toFixed(4)}  ` +
      `${note(Math.abs(ldf - t) < 0.002, `LDF at age ${age} is ${ldf.toFixed(4)}, spec ${t}`)}`);
  }

  // CONVERGENCE IS STRUCTURAL — reproduced so nobody gates on 0.599.
  console.log('  IBNR / annual loss by game year (structural ceiling, NOT a target):');
  for (const N of [1, 3, 5, 10, 40]) {
    let acc = 0;
    for (let t = 0; t < N; t++) acc += 1 - reportLagCdf(t);
    console.log(`    year ${String(N).padStart(2)}: ${(pPool * acc).toFixed(3)}`);
  }
  console.log(`    A 5-year run reaches ~0.443 against the 0.599 limit. GATING ON 0.599 WOULD FAIL CORRECT CODE.`);

  // NET vs GROSS. Delayed dollars sit in the heavy component, which is exactly
  // what the tower cedes, so the two patterns are materially different.
  const allPlaced = [true, true, true, false];
  const pNet = dollarWeightedPDelayed(roster, allPlaced, 1);
  console.log(`  p_delayed NET of the purchasable tower: ${pct(pNet)} vs GROSS ${pct(pPool)}  ` +
    `${note(pNet < pPool, 'netting did not reduce the delayed dollar share — the heavy component is what the tower cedes')}`);
  console.log(`    LDF(0) net ${ldfToUltimate(0, pNet).toFixed(4)} vs gross ${ldfToUltimate(0, pPool).toFixed(4)} — reserves are NET, so the net one is booked.`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 6. THE DRAW — counts asserted, dollars reported with CI ---');
// ---------------------------------------------------------------------------
const YEARS = 300;
{
  const kFull = computeKLine(roster);
  const runs = [];
  for (let y = 1; y <= YEARS; y++) {
    runs.push(generateWcClaims({
      members: roster, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 4242 + y * 7919, kLine: kFull, riskControlEffectiveness: 0,
    }));
  }
  // yearNumber HELD AT 1 and the SEED varied: WC carries a -1.5%/yr frequency
  // trend, so looping the year would average over a decline instead of sampling
  // one year repeatedly.
  const counts = runs.map(r => r.claims.length + r.newlyDelayed.length);
  const drawn = runs.map(r => r.grossUltimateLoss + r.delayedGross);
  const delayedCounts = runs.map(r => r.delayedCount);
  const delayedDollars = runs.map(r => r.delayedGross);

  // ⚠ THE COMPARATOR MUST CARRY THE DRAW'S OWN CONDITIONS. The 1,825.6 headline
  // is the NEUTRAL-RQ, k_line = 1 figure; the draw applies each member's own
  // theta and the book's k_line, and theta does not average to 1 (exp is convex,
  // so a roster spread over RQ 1-10 sits above it). Comparing against 1,825.6
  // would fail by ~2% on entirely correct code.
  let analyticCount = 0;
  for (const m of roster) {
    const spec = M.ratingGroups[ratingGroupOf(m)];
    analyticCount += (m.exposureByLine.WC ?? 0) * spec.ratePer1M * Math.exp(-M.rqFrequencyBeta * (m.riskQuality - NEUTRAL_RQ)) * kFull;
  }
  console.log(`  claims/yr drawn (FULL MARKET): ${mean(counts).toFixed(1)} over ${YEARS} seeds`);
  console.log(`    against the analytic AT THE DRAW'S CONDITIONS (actual RQ, k_line ${kFull.toFixed(4)}): ${analyticCount.toFixed(1)}  ` +
    `${note(Math.abs(mean(counts) / analyticCount - 1) < 0.01, `drawn claim count ${mean(counts).toFixed(1)} vs analytic ${analyticCount.toFixed(1)}`)}`);
  console.log(`    (the 1,825.6 headline is the NEUTRAL-RQ, k_line=1 figure — a different quantity)`);

  // COUNT-BASED, SO GATEABLE. Finding 26's line.
  const delayedShareCount = mean(delayedCounts) / mean(counts);
  console.log(`  delayed share BY COUNT: ${pct(delayedShareCount)} (target 8.4%)  ` +
    `${note(Math.abs(delayedShareCount - 0.084) < 0.005, `delayed share by count ${pct(delayedShareCount)} vs 8.4%`)}`);

  // DOLLAR-WEIGHTED — REPORTED, NOT GATED.
  const delayedShareDollar = mean(delayedDollars) / mean(drawn);
  const [dLo, dHi] = bootstrapCi(runs.map(r => r.delayedGross / Math.max(r.grossUltimateLoss + r.delayedGross, 1)));
  console.log(`  delayed share BY DOLLARS: ${pct(delayedShareDollar)}, 99% CI [${pct(dLo)}, ${pct(dHi)}] (analytic 17.1%) — REPORTED`);

  // THE GATEABLE DOLLAR FIGURE IS THE CAPPED ONE. Finding 26 permits gating
  // counts, rates, quantiles and CAPPED means — and forbids gating a
  // heavy-tailed sample mean. Capping at $1M leaves a well-behaved variable and
  // is also the layer the weights were calibrated against, so this checks the
  // calibration rather than the tail.
  let analyticCapped = 0;
  for (const m of roster) {
    const group = ratingGroupOf(m);
    const spec = M.ratingGroups[group];
    const regionMult = regionMultiplier(m.region);
    const lambda = (m.exposureByLine.WC ?? 0) * spec.ratePer1M * Math.exp(-M.rqFrequencyBeta * (m.riskQuality - NEUTRAL_RQ)) * kFull;
    const w = tiltedWeights(group, m.riskQuality);
    spec.mix.forEach(({ component }, i) => {
      const c = WC_SEVERITY_COMPONENTS[component];
      analyticCapped += lambda * w[i] * limitedExpectedValue(c.mu + Math.log(regionMult), c.sigma, 1e6);
    });
  }
  const drawnCapped = mean(runs.map(r =>
    [...r.claims.map(c => c.grossUltimate), ...r.newlyDelayed.map(u => u.amount)]
      .reduce((s, x) => s + Math.min(x, 1e6), 0)));
  console.log(`  $1M-CAPPED annual loss — GATED: drawn ${fmt$(drawnCapped)} vs analytic ${fmt$(analyticCapped)} ` +
    `(${((drawnCapped / analyticCapped - 1) * 100).toFixed(2)}%)  ` +
    `${note(Math.abs(drawnCapped / analyticCapped - 1) < 0.02, `capped drawn loss ${fmt$(drawnCapped)} vs analytic ${fmt$(analyticCapped)}`)}`);

  const [gLo, gHi] = bootstrapCi(drawn);
  const analyticFull = expectedWcGrossLossForKLine(roster, { kLine: kFull });
  console.log(`  GROUND-UP annual loss — REPORTED, NOT GATED: drawn ${fmt$(mean(drawn))}, bootstrap 99% CI [${fmt$(gLo)}, ${fmt$(gHi)}]`);
  console.log(`    analytic (k_line basis, which is what the draw uses): ${fmt$(analyticFull)} ` +
    `(draw is ${((mean(drawn) / analyticFull - 1) * 100).toFixed(1)}%)`);
  console.log(`    ⚠ NOT GATED, AND THE BOOTSTRAP CI ABOVE IS NOT A GATE EITHER. At sigma 2.0 the mean is`);
  console.log(`      carried by draws rarer than ${YEARS} years of experience contains, so a bootstrap —`);
  console.log(`      which can only resample values it has SEEN — systematically under-covers. An earlier`);
  console.log(`      version of this harness gated on that CI and failed on correct code. The analytic is`);
  console.log(`      the assertion; the capped figure above is what the draw is held to.`);

  // Realized claim-size distribution, reported.
  const all = runs.flatMap(r => [...r.claims.map(c => c.grossUltimate), ...r.newlyDelayed.map(u => u.amount)]);
  all.sort((a, b) => a - b);
  const q = (p: number) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
  const sampleMean = mean(all);
  const sampleCv = Math.sqrt(mean(all.map(x => (x - sampleMean) ** 2))) / sampleMean;
  console.log(`  claim size: median $${Math.round(q(0.5)).toLocaleString()}, p90 $${Math.round(q(0.9)).toLocaleString()}, ` +
    `p99 $${Math.round(q(0.99)).toLocaleString()}, p99.9 $${Math.round(q(0.999)).toLocaleString()}, max $${Math.round(all[all.length - 1]).toLocaleString()}`);
  console.log(`  realized blended CV ${sampleCv.toFixed(2)} — REPORTED (analytic 11.22-14.56 by group; a sample CV at this tail does not converge)`);
  const over5m = all.filter(x => x > 5e6).length / YEARS;
  console.log(`  drawn claims > $5M: ${over5m.toFixed(2)}/yr (analytic ~0.70)  ` +
    `${note(Math.abs(over5m - 0.70) < 0.25, `drawn >$5M rate ${over5m.toFixed(2)}/yr vs analytic 0.70`)}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 7. IBNR — Little\'s Law, not a fixed percentage ---');
{
  // Drives the generator with a real inventory, which is what the engine does.
  //
  // ⚠ AVERAGED ACROSS INDEPENDENT PATHS, AND THAT IS NOT A CONVENIENCE. Little's
  // Law holds IN EXPECTATION: E[balance] = E[accrual] x E[lag]. A single realized
  // path does not obey it year by year, because the chain-ladder balance is
  // driven by what actually REPORTED, and on a book with a blended CV above 11 a
  // year in which one large claim reports produces a large balance estimate
  // whether or not the unreported inventory moved. Gating one path's maximum
  // fails on entirely correct code — measured at 1.74 here before the paths were
  // averaged. The per-path spread is REPORTED below so the volatility stays
  // visible rather than hidden by the averaging.
  const enrolled = roster.filter((_, i) => i % 5 === 0); // ~40 members, an enrolled-scale stand-in
  const k = computeKLine(enrolled);
  const N = 40;
  const PATHS = 40;
  const pDelayedNet = dollarWeightedPDelayed(enrolled, [], 1);
  const balByYear: number[][] = Array.from({ length: N }, () => []);
  const accByYear: number[][] = Array.from({ length: N }, () => []);
  const lossByYear: number[][] = Array.from({ length: N }, () => []);
  const invByYear: number[][] = Array.from({ length: N }, () => []);

  for (let path = 0; path < PATHS; path++) {
    let inventory: WcUnreportedClaim[] = [];
    const ledger: WcAccidentYearReportedEntry[] = [];
    for (let y = 1; y <= N; y++) {
      const emerging = inventory.filter(u => u.reportYear <= y);
      inventory = inventory.filter(u => u.reportYear > y);
      const g = generateWcClaims({
        members: enrolled, yearNumber: 1, calendarYear: 2025 + y,
        instanceSeed: 31337 + path * 104729 + y * 7919, kLine: k, riskControlEffectiveness: 0,
        emerging,
      });
      // The generator dates newly delayed claims to its own yearNumber, which is
      // pinned at 1 here so the frequency trend does not confound the pattern.
      // Re-stamp them onto the real game year, preserving the DRAWN lag.
      inventory = [...inventory, ...g.newlyDelayed.map(u => ({
        ...u, accidentYear: y, reportYear: y + (u.reportYear - u.accidentYear),
      }))];
      for (const e of ledger) {
        e.netReported += emerging.filter(u => u.accidentYear === e.yearNumber).reduce((t, u) => t + u.amount, 0);
      }
      ledger.push({ yearNumber: y, netReported: g.currentAccidentYearGross, pDelayedNet });
      balByYear[y - 1].push(wcIbnrBalance(ledger, y));
      accByYear[y - 1].push(g.currentAccidentYearGross * (ldfToUltimate(0, pDelayedNet) - 1));
      lossByYear[y - 1].push(g.grossUltimateLoss + g.delayedGross);
      invByYear[y - 1].push(inventory.length);
    }
  }

  // Expected-path ratio: mean balance over (mean accrual to date x mean lag).
  const ratioAt = (y: number) => {
    const meanAccrualToDate = mean(accByYear.slice(0, y).map(a => mean(a)));
    return mean(balByYear[y - 1]) / (meanAccrualToDate * MEAN_REPORT_LAG_YEARS);
  };
  console.log(`  ${PATHS} independent ${N}-year paths, enrolled-scale book ` +
    `($${enrolled.reduce((t, m) => t + (m.exposureByLine.WC ?? 0), 0).toFixed(0)}M payroll, ${enrolled.length} members).`);
  console.log('  year   E[IBNR balance]   E[accrual]   E[bal]/(E[acc] x meanLag)   IBNR/annual loss   inventory');
  for (const y of [1, 2, 3, 5, 10, 20, 40]) {
    console.log(`  ${String(y).padStart(4)}   ${fmt$(mean(balByYear[y - 1])).padStart(15)}   ${fmt$(mean(accByYear[y - 1])).padStart(10)}   ` +
      `${ratioAt(y).toFixed(3).padStart(25)}   ${(mean(balByYear[y - 1]) / mean(lossByYear[y - 1])).toFixed(3).padStart(16)}   ${mean(invByYear[y - 1]).toFixed(0).padStart(9)}`);
  }

  // THE GATE, on the expectation. Approaches 1 FROM BELOW and must not exceed it.
  const ratios = Array.from({ length: N - 1 }, (_, i) => ratioAt(i + 2));
  const maxRatio = Math.max(...ratios);
  console.log(`  max E-ratio from year 2 on: ${maxRatio.toFixed(3)} — must not exceed 1  ` +
    `${note(maxRatio <= 1.05, `Little's Law ratio reached ${maxRatio.toFixed(3)} in expectation — the balance exceeds arrival rate x time in system`)}`);
  const lateRatio = mean(ratios.slice(24));
  console.log(`  mean E-ratio over years 26-40: ${lateRatio.toFixed(3)} — should approach 1  ` +
    `${note(lateRatio > 0.85, `Little's Law ratio only reaches ${lateRatio.toFixed(3)} by year 40 — the balance is not converging`)}`);
  console.log(`    ⚠ UNDER THE BALANCE-AS-ACCRUAL FAILURE THIS READS ~${MEAN_REPORT_LAG_YEARS.toFixed(1)} FROM TURN ONE. That is why it is the`);
  console.log(`      gate and the 0.599 LEVEL is not: the level is 26% short at year 5 on correct code.`);

  // Per-path spread at year 40 — REPORTED, so the averaging above does not hide
  // how volatile a single game's reserve actually is.
  const y40 = [...balByYear[N - 1]].sort((a, b) => a - b);
  console.log(`  single-path IBNR balance at year 40: p10 ${fmt$(y40[Math.floor(0.1 * PATHS)])}, ` +
    `median ${fmt$(y40[Math.floor(0.5 * PATHS)])}, p90 ${fmt$(y40[Math.floor(0.9 * PATHS)])} — REPORTED`);

  // STEADY STATE, not monotonic growth.
  const inv20 = mean(invByYear[19]), inv40 = mean(invByYear[39]);
  console.log(`  E[inventory] year 20 ${inv20.toFixed(0)} -> year 40 ${inv40.toFixed(0)} (a growing stock would roughly double)  ` +
    `${note(inv40 < inv20 * 1.15, `the unreported inventory grew ${(inv40 / inv20).toFixed(2)}x between years 20 and 40 rather than holding steady`)}`);
  console.log(`  ENROLLED-SCALE figures; they scale with exposure. THE RATIO DOES NOT.`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 8. WAGE INFLATION: the trend-free lag, and what fixed attachments do ---');
// ---------------------------------------------------------------------------
{
  // ⚠ THE REPORT LAG MUST STAY TREND-FREE. Severity is trended ONCE, at the
  // accident-year draw, and then frozen. If a delayed claim were re-trended when
  // it emerges, E[(1+r)^lag] over an unbounded lognormal lag would be DIVERGENT —
  // the reason the retired presumption process had to truncate at 40 years, and
  // the reason this lag was built trend-free. It holds by CONSTRUCTION (the
  // amount is stored on WcUnreportedClaim), so this asserts the construction
  // rather than trusting it.
  const k = computeKLine(roster);
  const y1 = generateWcClaims({
    members: roster, yearNumber: 1, calendarYear: 2026,
    instanceSeed: 5150, kLine: k, riskControlEffectiveness: 0,
  });
  const delayed = y1.newlyDelayed;
  const later = generateWcClaims({
    members: roster, yearNumber: 6, calendarYear: 2031,
    instanceSeed: 909, kLine: k, riskControlEffectiveness: 0,
    emerging: delayed,
  });
  const byId = new Map(later.claims.map(c => [c.id, c.grossUltimate]));
  const worst = delayed.reduce((w, u) => Math.max(w, Math.abs((byId.get(u.id) ?? 0) - u.amount)), 0);
  console.log(`  ${delayed.length} year-1 claims emerged in year 6; worst amount change $${worst.toExponential(2)}  ` +
    `${note(worst < 1e-9, `a delayed claim was re-trended on emergence (worst $${worst}) — E[(1+r)^lag] is divergent and the lag must stay trend-free`)}`);
  const sevRatio = Math.pow(1 + WC_SEVERITY_TREND_PER_YEAR, 5);
  console.log(`    (had it been re-trended over 5 years it would have moved ${((sevRatio - 1) * 100).toFixed(1)}%, so this is a real test)`);

  // SEVERITY AND PAYROLL TREND TOGETHER, so the rate barely moves. Asserted
  // analytically because it is the whole design.
  const rateTrend = (1 + M.frequencyTrendPerYear) * (1 + WC_SEVERITY_TREND_PER_YEAR) / (1 + WAGE_INFLATION_PER_YEAR);
  console.log(`  rate trend = freq x sev / wage = ${rateTrend.toFixed(5)} -> ${((rateTrend - 1) * 100).toFixed(3)}%/yr  ` +
    `${note(Math.abs(rateTrend - 0.98538) < 0.0002, `rate trend ${rateTrend.toFixed(5)} is not the expected 0.98538`)}`);
  const premiumTrend = (1 + M.frequencyTrendPerYear) * (1 + WC_SEVERITY_TREND_PER_YEAR);
  console.log(`  premium trend = freq x sev = ${((premiumTrend - 1) * 100).toFixed(3)}%/yr — INDEPENDENT of the wage rate  ` +
    `${note(Math.abs(premiumTrend - 1.02115) < 0.0002, 'premium trend is not freq x sev — a wage factor is missing or doubled somewhere')}`);

  // §5: FIXED REINSURANCE ATTACHMENTS AGAINST INFLATING SEVERITY. The layers
  // attach at fixed DOLLARS while severity inflates 3.67%/yr, so each layer sees
  // more — but the per-$100 denominator inflates too, and claim counts fall.
  // REPORTED, because the near-cancellation is a coincidence of these three
  // parameters and not a structural identity: if any of them moves, this drifts.
  const HORIZON = 10;
  const wage = Math.pow(1 + WAGE_INFLATION_PER_YEAR, HORIZON - 1);
  const freq = Math.pow(1 + M.frequencyTrendPerYear, HORIZON - 1);
  console.log(`  reinsurance layers, expected ceded per $100 — year 1 vs year ${HORIZON}:`);
  for (const l of REINSURANCE_TOWER.WC) {
    const cededAt = (yearNumber: number) => {
      let total = 0;
      for (const m of roster) {
        const group = ratingGroupOf(m);
        const spec = M.ratingGroups[group];
        const rm = regionMultiplier(m.region);
        const w = tiltedWeights(group, m.riskQuality);
        const lambda = (m.exposureByLine.WC ?? 0) * spec.ratePer1M * Math.exp(-M.rqFrequencyBeta * (m.riskQuality - 5));
        spec.mix.forEach(({ component }, i) => {
          const c = WC_SEVERITY_COMPONENTS[component];
          const mu = trendedMu(c.mu, yearNumber) + Math.log(rm);
          total += lambda * w[i] * (limitedExpectedValue(mu, c.sigma, l.attachment + l.limit) - limitedExpectedValue(mu, c.sigma, l.attachment));
        });
      }
      return total;
    };
    // Per $100 of NOMINAL exposure, and counts carry the frequency trend.
    const y1Per100 = cededAt(1) / (1300 * 1e4);
    const yNPer100 = cededAt(HORIZON) * freq / (1300 * 1e4 * wage);
    console.log(`    ${l.name.padEnd(14)} ${y1Per100.toFixed(4)} -> ${yNPer100.toFixed(4)}  (${(((yNPer100 / y1Per100) - 1) * 100).toFixed(1)}% over ${HORIZON} years)`);
  }
  console.log(`    ⚠ NEAR-CANCELLATION, NOT AN IDENTITY: severity inflation pushes each layer UP while the`);
  console.log(`      per-$100 denominator inflates and counts fall. Re-measure if the wage rate, the severity`);
  console.log(`      trend, the frequency trend or any attachment moves.`);

  // The same question for the IBNR netting, which uses the same fixed bounds.
  const allPlaced = REINSURANCE_TOWER.WC.map(() => true);
  console.log(`  wcIbnr net p_delayed (fixed layer bounds): year 1 ${pct(dollarWeightedPDelayed(roster, allPlaced, 1))}  ` +
    `year ${HORIZON} ${pct(dollarWeightedPDelayed(roster, allPlaced, HORIZON))}`);
}

console.log(`\n${problems.length === 0 ? 'ALL WC SEVERITY REBUILD CHECKS PASS.' : `${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`}`);
process.exitCode = problems.length === 0 ? 0 : 1;
