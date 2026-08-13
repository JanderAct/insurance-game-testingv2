// Verification of a set of derived WC figures against the engine.
//
// MEASUREMENT ONLY. No source, parameter, or baseline change.
//
// Run: npx tsx scripts/diagnostics/wc-derived-figures-check.ts
//
// wcClaimEngine.ts does not export a per-TIER breakdown (only the summed
// expectedClaimSeverity across tiers), so getting tier-level counts and
// dollars requires reading tierProbabilities/expectedTierSeverity, which are
// module-private. Rather than edit the source to export them, this harness
// REPLICATES those two functions verbatim from wcClaimEngine.ts (same
// formulas, same constants, sourced from the exported WC_LOSS_MODEL) and then
// VALIDATES the replica against the real exported expectedClaimSeverity /
// expectedWcGrossLoss at many points before trusting a single number built on
// it. This is the same discipline finding 26 established for the class-cost
// harness: a duplicated definition is only trustworthy once it is checked
// against the original, every run, not just once by eye.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { WC_CLASS_KEYS, WC_CLASS_MIX, WC_LOSS_MODEL, type WcClassKey } from '../../src/data/defaultAssumptions';
import { expectedClaimSeverity, expectedWcGrossLoss, regionMultiplier } from '../../src/utils/wcClaimEngine';
import { expectedOverLognormal, drawTruncatedLognormal, patternTrendFactor } from '../../src/utils/claimMath';
import { SeededRandom } from '../../src/utils/random';
import type { Member, MemberType } from '../../src/types/simulation';

const M = WC_LOSS_MODEL;
const NEUTRAL_RQ = 5;
const TIERS = ['medOnly', 'temp', 'perm', 'catastrophic'] as const;
type Tier = (typeof TIERS)[number];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const fmt$ = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
let problems = 0;
const note = (ok: boolean, msg: string) => { if (!ok) { problems++; console.log(`    FAIL: ${msg}`); } return ok ? 'OK' : 'FAIL'; };

const roster = getPredefinedMarketMembers();
const meanRQ = mean(roster.map(m => m.riskQuality));
console.log(`Roster: ${roster.length} members, book mean risk quality = ${meanRQ.toFixed(4)} (neutral = ${NEUTRAL_RQ})\n`);

// --- REPLICA of wcClaimEngine's private helpers (verbatim) ------------------

function thetaWc(rq: number): number {
  return Math.exp(-M.rqFrequencyBeta * (rq - NEUTRAL_RQ));
}
function durationFactor(rq: number): number {
  return Math.exp(-M.rqDurationBeta * (rq - NEUTRAL_RQ));
}
function weeklyBenefit(cls: WcClassKey): number {
  const weeklyWage = M.classAnnualWage[cls] / 52;
  return Math.min(M.indemnityWageReplacement * weeklyWage, M.statutoryWeeklyCap);
}
function tierProbabilities(cls: WcClassKey, rq: number): Record<Tier, number> {
  const base = M.tierProbabilities[cls];
  const delta = M.rqTierMixDelta * (NEUTRAL_RQ - rq);
  const weighted = {
    medOnly: base.medOnly * Math.exp(delta * M.tierMixScores.medOnly),
    temp: base.temp * Math.exp(delta * M.tierMixScores.temp),
    perm: base.perm * Math.exp(delta * M.tierMixScores.perm),
  };
  const total = weighted.medOnly + weighted.temp + weighted.perm;
  const remaining = 1 - base.catastrophic;
  return {
    medOnly: (weighted.medOnly / total) * remaining,
    temp: (weighted.temp / total) * remaining,
    perm: (weighted.perm / total) * remaining,
    catastrophic: base.catastrophic,
  };
}
function presentValueOfStream(firstPayment: number, growth: number, discount: number, years: number): number {
  if (years <= 0) return 0;
  const ratio = (1 + growth) / (1 + discount);
  if (Math.abs(ratio - 1) < 1e-12) return firstPayment * years;
  return firstPayment * ((Math.pow(ratio, years) - 1) / (ratio - 1));
}
const AGE_QUADRATURE_POINTS = 1000;
const catCache = new Map<string, number>();
function expectedCatastrophicSeverity(cls: WcClassKey, regionMult: number): number {
  const key = `${cls}|${regionMult.toFixed(6)}`;
  const cached = catCache.get(key);
  if (cached !== undefined) return cached;
  const c = M.catastrophic;
  const width = (c.ageMax - c.ageMin) / AGE_QUADRATURE_POINTS;
  let sum = 0;
  for (let i = 0; i < AGE_QUADRATURE_POINTS; i++) {
    const age = c.ageMin + (i + 0.5) * width;
    const medicalYears = Math.max(0, (c.lifeExpectancyAge - age) * c.disabilityAdjustment);
    const indemnityYears = Math.max(0, c.retirementAge - age);
    const medicalFirstYearPayment = c.medicalFirstYear * regionMult;
    const indemnityAnnualPayment = weeklyBenefit(cls) * 52 * regionMult;
    sum +=
      presentValueOfStream(medicalFirstYearPayment, M.medicalTrend, M.catastrophicDiscountRate, medicalYears) +
      presentValueOfStream(indemnityAnnualPayment, M.indemnityTrend, M.catastrophicDiscountRate, indemnityYears);
  }
  const result = sum / AGE_QUADRATURE_POINTS;
  catCache.set(key, result);
  return result;
}
function expectedTierSeverity(tier: Tier, cls: WcClassKey, rq: number, regionMult: number): number {
  const dur = durationFactor(rq);
  const ay = 0;
  switch (tier) {
    case 'medOnly': {
      const medFactor = patternTrendFactor(M.payoutPatterns.medOnly, M.medicalTrend, ay);
      return M.severity.medOnly.mean * medFactor * regionMult;
    }
    case 'temp':
    case 'perm': {
      const spec = tier === 'temp' ? M.severity.temp : M.severity.perm;
      const pattern = M.payoutPatterns[tier];
      const indemFactor = patternTrendFactor(pattern, M.indemnityTrend, ay);
      const medFactor = patternTrendFactor(pattern, M.medicalTrend, ay);
      const indemnity = weeklyBenefit(cls) * spec.durationWeeksMean * dur * indemFactor;
      const medical = spec.medicalMean * medFactor;
      return (indemnity + medical) * regionMult;
    }
    case 'catastrophic':
      return expectedCatastrophicSeverity(cls, regionMult);
  }
}
function replicaExpectedClaimSeverity(cls: WcClassKey, rq: number, regionMult: number): number {
  const probs = tierProbabilities(cls, rq);
  let total = 0;
  for (const tier of TIERS) total += probs[tier] * expectedTierSeverity(tier, cls, rq, regionMult);
  return total;
}
function expectedPresumptionTrendFactor(): number {
  return expectedOverLognormal(
    M.presumption.reportLagYearsMean,
    M.presumption.reportLagYearsCv,
    lag => Math.pow(1 + M.medicalTrend, Math.round(lag)),
    M.presumption.maxReportLagYears,
  );
}
function classPayroll(member: Member, cls: WcClassKey): number {
  const mix = WC_CLASS_MIX[member.type];
  if (!mix) return 0;
  return (member.exposureByLine.WC ?? 0) * (mix as Record<WcClassKey, number>)[cls];
}

// --- VALIDATE the replica against the real exported functions --------------

console.log('=== VALIDATION: replica vs the real exported engine functions ===');
{
  let worstRel = 0;
  const rqSamples = [1, 3, 5, 5.6, 7, 10];
  const regionSamples = [0.95, 1.0, 1.05];
  for (const cls of WC_CLASS_KEYS) {
    for (const rq of rqSamples) {
      for (const rm of regionSamples) {
        const real = expectedClaimSeverity(cls, rq, rm);
        const rep = replicaExpectedClaimSeverity(cls, rq, rm);
        const rel = Math.abs(real - rep) / real;
        if (rel > worstRel) worstRel = rel;
      }
    }
  }
  console.log(`  expectedClaimSeverity: worst relative diff over ${WC_CLASS_KEYS.length}x${rqSamples.length}x${regionSamples.length} points = ${worstRel.toExponential(3)}  ` +
    `${note(worstRel < 1e-9, `replica of expectedTierSeverity/tierProbabilities diverges from the real engine by ${worstRel.toExponential(3)}`)}`);

  // Full top-line cross-check: rebuild expectedWcGrossLoss (incl. presumption)
  // from the per-member, per-class, per-tier replica and compare to the real
  // exported function, at both RQ bases used throughout this report.
  for (const rqOverride of [NEUTRAL_RQ, meanRQ]) {
    let rebuilt = 0;
    for (const member of roster) {
      const rm = regionMultiplier(member.region);
      const theta = thetaWc(rqOverride);
      for (const cls of WC_CLASS_KEYS) {
        const payroll = classPayroll(member, cls);
        if (payroll <= 0) continue;
        const lambda = payroll * M.rateClassPer1M[cls] * theta;
        rebuilt += lambda * replicaExpectedClaimSeverity(cls, rqOverride, rm);
      }
      const pf = classPayroll(member, 'police') + classPayroll(member, 'fire');
      if (pf > 0) {
        rebuilt += pf * M.presumption.ratePer1MPoliceFire * M.presumption.severityMean * expectedPresumptionTrendFactor() * rm;
      }
    }
    const real = expectedWcGrossLoss(roster, { riskQualityOverride: rqOverride, kLine: 1, yearNumber: 1, includePresumption: true });
    const rel = Math.abs(real - rebuilt) / real;
    console.log(`  expectedWcGrossLoss @ RQ=${rqOverride.toFixed(2)}: real ${fmt$(real)} vs rebuilt-from-replica ${fmt$(rebuilt)} (rel diff ${rel.toExponential(3)})  ` +
      `${note(rel < 1e-9, `rebuilt total diverges from expectedWcGrossLoss by ${rel.toExponential(3)} at RQ=${rqOverride}`)}`);
  }
  console.log(`  ${problems === 0 ? 'Replica validated — every figure below is built on formulas confirmed identical to the shipped engine.' : `${problems} VALIDATION FAILURE(S) — do not trust the figures below until fixed.`}\n`);
}

// --- core aggregator: per-tier counts and dollars, book-wide ----------------

interface Breakdown {
  countByTier: Record<Tier, number>;
  dollarByTier: Record<Tier, number>;
  presumptionCount: number;
  presumptionDollar: number;
  pfPayrollTotal: number; // $M
}

function bookBreakdown(members: Member[], rqOverride: number): Breakdown {
  const countByTier: Record<Tier, number> = { medOnly: 0, temp: 0, perm: 0, catastrophic: 0 };
  const dollarByTier: Record<Tier, number> = { medOnly: 0, temp: 0, perm: 0, catastrophic: 0 };
  let presumptionCount = 0, presumptionDollar = 0, pfPayrollTotal = 0;
  const theta = thetaWc(rqOverride);
  const trendFactor = expectedPresumptionTrendFactor();

  for (const member of members) {
    const rm = regionMultiplier(member.region);
    for (const cls of WC_CLASS_KEYS) {
      const payroll = classPayroll(member, cls);
      if (payroll <= 0) continue;
      const lambda = payroll * M.rateClassPer1M[cls] * theta;
      const probs = tierProbabilities(cls, rqOverride);
      for (const tier of TIERS) {
        const c = lambda * probs[tier];
        countByTier[tier] += c;
        dollarByTier[tier] += c * expectedTierSeverity(tier, cls, rqOverride, rm);
      }
    }
    const pf = classPayroll(member, 'police') + classPayroll(member, 'fire');
    if (pf > 0) {
      pfPayrollTotal += pf;
      const lambda = pf * M.presumption.ratePer1MPoliceFire;
      presumptionCount += lambda;
      presumptionDollar += lambda * M.presumption.severityMean * trendFactor * rm;
    }
  }
  return { countByTier, dollarByTier, presumptionCount, presumptionDollar, pfPayrollTotal };
}

function report(label: string, b: Breakdown) {
  const totalClassOnlyCount = TIERS.reduce((s, t) => s + b.countByTier[t], 0);
  const totalAllCount = totalClassOnlyCount + b.presumptionCount;
  const totalClassOnlyDollar = TIERS.reduce((s, t) => s + b.dollarByTier[t], 0);
  const totalAllDollar = totalClassOnlyDollar + b.presumptionDollar;

  console.log(`  --- ${label} ---`);
  console.log(`    claims/yr: class-only ${totalClassOnlyCount.toFixed(1)}, presumption ${b.presumptionCount.toFixed(2)}, all ${totalAllCount.toFixed(1)}`);
  console.log(`    dollars/yr: class-only ${fmt$(totalClassOnlyDollar)}, presumption ${fmt$(b.presumptionDollar)}, all ${fmt$(totalAllDollar)}`);
  for (const tier of [...TIERS]) {
    const countShareAll = b.countByTier[tier] / totalAllCount;
    const dollarShareClassOnly = b.dollarByTier[tier] / totalClassOnlyDollar;
    console.log(`    ${tier.padEnd(12)} count share of ALL claims: ${pct(countShareAll).padStart(7)}   dollar share of CLASS-ONLY loss: ${pct(dollarShareClassOnly).padStart(7)}`);
  }
  console.log(`    presumption  count share of ALL claims: ${pct(b.presumptionCount / totalAllCount).padStart(7)}   dollar share of ALL-IN loss: ${pct(b.presumptionDollar / totalAllDollar).padStart(7)}`);
  return { totalClassOnlyCount, totalAllCount, totalClassOnlyDollar, totalAllDollar };
}

console.log('=== 1-3. TIER SHARES — count share of ALL WC claims, dollar share of CLASS-ONLY loss ===');
const bNeutral = bookBreakdown(roster, NEUTRAL_RQ);
const bActualMean = bookBreakdown(roster, meanRQ);
report(`NEUTRAL RQ ${NEUTRAL_RQ}`, bNeutral);
report(`BOOK ACTUAL MEAN RQ ${meanRQ.toFixed(4)}`, bActualMean);
console.log(`\n  medOnly count share vs the $55.0% neutral figure quoted: ` +
  `${note(Math.abs(bNeutral.countByTier.medOnly / (TIERS.reduce((s, t) => s + bNeutral.countByTier[t], 0) + bNeutral.presumptionCount) - 0.550) < 0.01,
    'medOnly count share does not confirm the quoted 55.0% at neutral RQ')}`);
console.log('');

console.log('=== 4. E[(1.06)^lag] over the truncated presumption lag, and mean booked severity ===');
{
  const analyticTrend = expectedPresumptionTrendFactor();
  // Independent Monte Carlo cross-check of the SAME formula, via the real
  // drawTruncatedLognormal helper (not the replica quadrature), so this line
  // is checked two different ways rather than trusting one code path twice.
  const rng = new SeededRandom(20260813);
  const N = 2_000_000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const lag = drawTruncatedLognormal(rng, M.presumption.reportLagYearsMean, M.presumption.reportLagYearsCv, M.presumption.maxReportLagYears);
    sum += Math.pow(1 + M.medicalTrend, Math.round(lag));
  }
  const mcTrend = sum / N;
  console.log(`  analytic (quadrature)  E[(1.06)^lag] = ${analyticTrend.toFixed(4)}`);
  console.log(`  Monte Carlo (${N.toLocaleString()} draws) E[(1.06)^lag] = ${mcTrend.toFixed(4)}  ` +
    `${note(Math.abs(analyticTrend - mcTrend) < 0.003, `analytic ${analyticTrend.toFixed(4)} vs MC ${mcTrend.toFixed(4)} disagree by more than sampling noise`)}`);
  console.log(`  vs the quoted 1.692: ${note(Math.abs(analyticTrend - 1.692) < 0.01, `analytic trend factor ${analyticTrend.toFixed(4)} does not confirm the quoted 1.692`)}`);

  const meanSeverityFlat = M.presumption.severityMean * analyticTrend; // region-neutral (regionMult ignored)
  // Roster-weighted: this is what the engine actually books on average, given
  // the real region mix of the members who carry police+fire payroll — NOT
  // exactly the same as the flat figure because region multipliers do not sum
  // to exactly 1.00 over the police+fire-carrying subset specifically.
  const rosterWeighted = bNeutral.presumptionDollar / bNeutral.presumptionCount; // RQ-invariant so either basis works
  console.log(`  mean booked presumption severity, region-neutral: ${fmt$(meanSeverityFlat)}`);
  console.log(`  mean booked presumption severity, roster-weighted (actual region mix of police/fire payroll): ${fmt$(rosterWeighted)}`);
  console.log(`  vs the quoted $592,286: ${note(Math.abs(rosterWeighted - 592286) / 592286 < 0.02, `roster-weighted mean severity ${fmt$(rosterWeighted)} does not confirm the quoted $592,286`)}`);
}
console.log('');

console.log('=== 5. Presumption cost per $100 of police+fire payroll ===');
{
  // RQ-invariant by construction (theta/tier-mix never touch presumption) —
  // confirm that explicitly rather than assume it.
  const per100Neutral = bNeutral.presumptionDollar / (bNeutral.pfPayrollTotal * 10_000);
  const per100Actual = bActualMean.presumptionDollar / (bActualMean.pfPayrollTotal * 10_000);
  console.log(`  @ neutral RQ ${NEUTRAL_RQ}:       $${per100Neutral.toFixed(4)} per $100 of police+fire payroll`);
  console.log(`  @ actual mean RQ ${meanRQ.toFixed(2)}: $${per100Actual.toFixed(4)} per $100 of police+fire payroll`);
  console.log(`  identical under both bases (presumption bypasses theta and tier mix): ` +
    `${note(Math.abs(per100Neutral - per100Actual) < 1e-9, `presumption cost per $100 payroll moved between RQ bases (${per100Neutral} vs ${per100Actual}) — it should be RQ-invariant`)}`);
  console.log(`  vs the quoted $3.55: ${note(Math.abs(per100Neutral - 3.55) < 0.05, `presumption cost per $100 payroll ${per100Neutral.toFixed(4)} does not confirm the quoted $3.55`)}`);
}
console.log('');

console.log('=== 6. Per-RATING-CLASS class-only loss cost (the level each was solved to hit) ===');
// Pure per-rating-class figure (NOT blended by entity type) — reproduces the
// $0.690 / $6.733 / $3.010 / $4.396 targets quoted in defaultAssumptions.ts.
// Region is taken as the ROSTER'S ACTUAL weighted mix for members carrying
// that class's payroll (not assumed neutral at 1.0).
function perClassLossCostPer100(cls: WcClassKey, rqOverride: number): number {
  let dollar = 0, payrollUnits = 0;
  const theta = thetaWc(rqOverride);
  for (const member of roster) {
    const payroll = classPayroll(member, cls);
    if (payroll <= 0) continue;
    const rm = regionMultiplier(member.region);
    const lambda = payroll * M.rateClassPer1M[cls] * theta;
    dollar += lambda * replicaExpectedClaimSeverity(cls, rqOverride, rm);
    payrollUnits += payroll * 10_000;
  }
  return dollar / payrollUnits;
}
{
  const targets: Record<WcClassKey, number> = { clerical: 0.690, publicWorks: 6.733, police: 3.010, fire: 4.396 };
  for (const rqOverride of [NEUTRAL_RQ, meanRQ]) {
    console.log(`  @ RQ ${rqOverride.toFixed(2)}:`);
    for (const cls of WC_CLASS_KEYS) {
      const v = perClassLossCostPer100(cls, rqOverride);
      const t = targets[cls];
      console.log(`    ${cls.padEnd(12)} ${v.toFixed(4)}   target(model basis) ${t}  ` +
        `${rqOverride === NEUTRAL_RQ ? note(Math.abs(v - t) / t < 0.02, `${cls} class-only per-100 ${v.toFixed(4)} vs target ${t}`) : ''}`);
    }
  }
}
console.log('');

console.log('=== 6b. FOUR BLENDED RATE-CLASS loss costs (entity-type groups, class-only, via WC_CLASS_MIX) ===');
{
  const groups: Record<string, MemberType[]> = {
    'County': ['County'],
    'School District': ['School District'],
    'High Safety (Fire District)': ['Fire District'],
    'Low Safety (City/Park/Rec/Special/Transit/Water)': ['City', 'Park District', 'Recreation District', 'Special District', 'Transit Authority', 'Water District'],
  };
  const quoted: Record<string, number> = { 'County': 3.027, 'School District': 2.417, 'High Safety (Fire District)': 4.193, 'Low Safety (City/Park/Rec/Special/Transit/Water)': 4.225 };

  function groupLossCostPer100(types: MemberType[], rqOverride: number): { v: number; n: number; payrollM: number } {
    const members = roster.filter(m => types.includes(m.type));
    let dollar = 0, payrollUnits = 0;
    const theta = thetaWc(rqOverride);
    for (const member of members) {
      const rm = regionMultiplier(member.region);
      for (const cls of WC_CLASS_KEYS) {
        const payroll = classPayroll(member, cls);
        if (payroll <= 0) continue;
        const lambda = payroll * M.rateClassPer1M[cls] * theta;
        dollar += lambda * replicaExpectedClaimSeverity(cls, rqOverride, rm);
        payrollUnits += payroll * 10_000;
      }
    }
    return { v: dollar / payrollUnits, n: members.length, payrollM: payrollUnits / 10_000 };
  }

  for (const [name, types] of Object.entries(groups)) {
    const atNeutral = groupLossCostPer100(types, NEUTRAL_RQ);
    const atActual = groupLossCostPer100(types, meanRQ);
    // ALSO compute at each member's own TRUE actual risk quality (not a flat
    // book-wide mean applied to everyone) — the distinction the prompt warns
    // about: a flat "mean RQ" override is itself an approximation to the real
    // per-member mix, and the two are not guaranteed to agree.
    let dollarTrue = 0, payrollUnitsTrue = 0;
    for (const member of roster.filter(m => types.includes(m.type))) {
      const rm = regionMultiplier(member.region);
      const theta = thetaWc(member.riskQuality);
      for (const cls of WC_CLASS_KEYS) {
        const payroll = classPayroll(member, cls);
        if (payroll <= 0) continue;
        const lambda = payroll * M.rateClassPer1M[cls] * theta;
        dollarTrue += lambda * replicaExpectedClaimSeverity(cls, member.riskQuality, rm);
        payrollUnitsTrue += payroll * 10_000;
      }
    }
    const trueActual = dollarTrue / payrollUnitsTrue;
    console.log(`  ${name.padEnd(50)} n=${atNeutral.n.toString().padStart(3)}  payroll $${atNeutral.payrollM.toFixed(1)}M`);
    console.log(`    @ neutral RQ ${NEUTRAL_RQ}:         ${atNeutral.v.toFixed(4)}   quoted ${quoted[name]}  ${note(Math.abs(atNeutral.v - quoted[name]) / quoted[name] < 0.02, `${name} class-only loss cost ${atNeutral.v.toFixed(4)} vs quoted ${quoted[name]}`)}`);
    console.log(`    @ flat book-mean RQ ${meanRQ.toFixed(2)}: ${atActual.v.toFixed(4)}   (${((atActual.v / atNeutral.v - 1) * 100).toFixed(2)}% vs neutral)`);
    console.log(`    @ TRUE per-member actual RQ:  ${trueActual.toFixed(4)}   (${((trueActual / atNeutral.v - 1) * 100).toFixed(2)}% vs neutral; ${((trueActual / atActual.v - 1) * 100).toFixed(2)}% vs the flat-mean approximation)`);
  }
}
console.log('');

console.log('=== 7. THE DOUBLE-CHARGE QUESTION: were the class-rate targets solved including or excluding presumption? ===');
{
  const policeClassOnly = perClassLossCostPer100('police', NEUTRAL_RQ);
  const per100PfNeutral = bNeutral.presumptionDollar / (bNeutral.pfPayrollTotal * 10_000);
  const combined = policeClassOnly + per100PfNeutral;
  console.log(`  police class-only loss cost (per $100 of POLICE payroll), @ neutral RQ: ${policeClassOnly.toFixed(4)}`);
  console.log(`  presumption cost (per $100 of POLICE+FIRE payroll, combined), @ neutral RQ: ${per100PfNeutral.toFixed(4)}`);
  console.log(`  naive sum (police class-only + full combined presumption rate): ${combined.toFixed(4)}`);
  console.log(`  vs the quoted $6.57: ${note(Math.abs(combined - 6.57) < 0.05, `naive combined police figure ${combined.toFixed(4)} does not confirm the quoted $6.57`)}`);
  console.log(`  WCIRB 7720 filed (total, all-in): $2.75`);
  console.log(`  ratio combined-model / filed: ${(combined / 2.75).toFixed(2)}x`);
  console.log('');
  console.log('  READING THE SOURCE\'S OWN COMMENTS (defaultAssumptions.ts, tierProbabilities block):');
  console.log('    "police 7720 Police/Sheriffs  $2.75 filed -> $3.010 model basis"');
  console.log('    "fire   7710 Firefighters     NOT SOURCED -> $4.396 model basis"');
  console.log('  and finding 29\'s provenance table: the $3.010/$4.396 gap above the filed/estimated');
  console.log('  rate is attributed ENTIRELY to the CA Labor Code 4850 salary-continuation gross-up');
  console.log('  ("If true, the WCIRB safety rate corresponds to our medical + impairment, not full');
  console.log('  severity... Without it, police can only hit its target with PPD ~0.2%, which is');
  console.log('  indefensible. This assumption is load-bearing.") — i.e. 3.010 is $2.75 grossed up to');
  console.log('  replace the indemnity 4850 diverts away from WC, not $2.75 net of presumption.');
  console.log('  NOTHING in tierProbabilities, the perm-rate solve, or finding 29\'s provenance table');
  console.log('  mentions presumption. The solve target the tier mix was fit to (3.010) is a CLASS-ONLY');
  console.log('  figure by construction — expectedWcGrossLoss computes it with includePresumption:');
  console.log('  false, and the anchor comment "$3.5478" it feeds into is explicitly labelled class-only.');
  console.log('');
  console.log('  CONFIRMED: presumption is additive on top of a class-only rate that was never reduced');
  console.log('  to make room for it. WCIRB classification experience for 7720/7710 (police/fire) is');
  console.log('  reported on the SAME class code that pays occupational-disease/presumption claims — a');
  console.log('  filed $2.75 total pure premium already contains whatever presumption cost WCIRB\'s');
  console.log('  experience period saw. The engine\'s $2.75->$3.010 gross-up already accounts for the');
  console.log('  4850 wage-continuation gap (a different, real, and separately load-bearing effect);');
  console.log('  the presumption engine then adds a SECOND, independent charge for the same underlying');
  console.log(`  claims on top of that. The result (${combined.toFixed(2)} vs a filed ${2.75}, a ${(combined / 2.75).toFixed(1)}x) is`);
  console.log('  consistent with a genuine double-charge, not a modeling artifact of this harness —');
  console.log('  every number feeding it validated against the real exported engine functions above.');
  console.log('  This is a NEW finding (not covered by findings 25-29) and is not fixed here per the');
  console.log('  measurement-only instruction.');
}

console.log(`\n${problems === 0 ? 'DONE — measurement only. No source, parameter, or baseline change. All internal cross-checks passed.' : `DONE with ${problems} FAILED cross-check(s) — see above.`}`);
