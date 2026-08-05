// Statistical verification of the WC claim-level generator (design doc Part A).
// Read-only; drives wcClaimEngine directly, not the game engine — this checks
// the GENERATOR against its design targets, before and independently of the
// engine cutover. Per finding 8, everything here is distributional across many
// seeds; nothing is a baseline diff.
//
// Run: npx tsx scripts/diagnostics/wc-claim-check.ts
//
// Lives outside src/ so tsconfig.app.json's "include": ["src"] never sees it
// and `npm run typecheck` is unaffected.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { WC_CLASS_KEYS, WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import {
  computeKLine,
  deriveNeutralPurePremiumPer100,
  expectedWcGrossLoss,
  generateWcClaims,
  regionMultiplier,
} from '../../src/utils/wcClaimEngine';
import type { Member } from '../../src/types/simulation';

const YEARS = 50; // draws per configuration — statistical, not a single run
const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;

const roster = getPredefinedMarketMembers();

// Draw `years` independent years for a book, at neutral settings (kLine from
// the book itself, gPool drawn per year, no risk control).
function runYears(members: Member[], years: number, opts: { rc?: number; seedBase?: number } = {}) {
  const kLine = computeKLine(members);
  const out = [];
  for (let y = 1; y <= years; y++) {
    // gPool has mean 1; drawing it per year here mirrors processYear's job.
    const gPool = 1; // held at its mean so counts/severities are tested without pool-factor noise
    out.push(generateWcClaims({
      members,
      yearNumber: y,
      calendarYear: 2025 + y,
      instanceSeed: (opts.seedBase ?? 991) + y * 7919,
      kLine,
      gPool,
      riskControlEffectiveness: opts.rc ?? 0,
    }));
  }
  return out;
}

console.log('=== 1. FULL-MARKET AGGREGATES (all 200 members, gPool=1, RQ actual, no RC) ===');
{
  const runs = runYears(roster, YEARS);
  // Strip the frequency trend so the count target is comparable to the
  // design's reference year: report both raw and de-trended.
  const trend = (y: number) => Math.pow(1 + WC_LOSS_MODEL.frequencyTrendPerYear, y - 1);
  const coreCounts = runs.map(r => WC_CLASS_KEYS.reduce((s, c) => s + r.claimCountsByClass[c], 0));
  const deTrended = coreCounts.map((c, i) => c / trend(i + 1));
  const presump = runs.map(r => r.claimCountsByClass.presumption);
  const gross = runs.map(r => r.grossUltimateLoss);

  console.log(`  four-class claims/yr : ${mean(coreCounts).toFixed(1)} raw, ${mean(deTrended).toFixed(1)} de-trended (target ~809)  ${note(Math.abs(mean(deTrended) - 809) < 30, `four-class claims ${mean(deTrended).toFixed(1)} vs 809`)}`);
  console.log(`  presumption claims/yr: ${mean(presump).toFixed(2)} (target ~10)  ${note(Math.abs(mean(presump) - 9.72) < 1.5, `presumption ${mean(presump).toFixed(2)} vs ~10`)}`);
  // REPORTED, NOT ASSERTED. The design's "$19-20M combined" figure predates the
  // A4 annuity model and is known-stale; book scale is an open cross-line
  // recalibration item. Frequency, which is NOT stale, is asserted above.
  console.log(`  gross loss/yr        : ${fmt$(mean(gross))} de-trended ${fmt$(mean(gross.map((g, i) => g / trend(i + 1))))} — REPORTED (the "$19-20M" design figure is known-stale, predates the annuity model)`);

  console.log('  per-class counts (de-trended mean vs target):');
  const targets: Record<string, number> = { clerical: 75, publicWorks: 511, police: 79, fire: 144 };
  for (const c of WC_CLASS_KEYS) {
    const m = mean(runs.map((r, i) => r.claimCountsByClass[c] / trend(i + 1)));
    const t = targets[c];
    console.log(`    ${c.padEnd(12)} ${m.toFixed(1).padStart(6)}  target ${String(t).padStart(4)}  ${note(Math.abs(m - t) / t < 0.10, `${c} ${m.toFixed(1)} vs ${t}`)}`);
  }

  const allTier = runs.flatMap(r => Object.entries(r.claimCountsByTier).filter(([k]) => k !== 'presumption'));
  const tierTotals: Record<string, number> = {};
  for (const [k, v] of allTier) tierTotals[k] = (tierTotals[k] ?? 0) + v;
  const tierSum = Object.values(tierTotals).reduce((a, b) => a + b, 0);
  console.log('  tier mix (realized share of four-class claims):');
  for (const t of ['medOnly', 'temp', 'perm', 'catastrophic']) {
    console.log(`    ${t.padEnd(14)} ${((tierTotals[t] / tierSum) * 100).toFixed(3)}%`);
  }
  // Compared against the count the SUPPLIED tier probabilities actually imply
  // (sum over classes of expected claims x p_catastrophic = 2.97), not against
  // the design's stated "~5-6/yr" — those two are inconsistent with each other
  // and the probabilities are the operative parameter. See the report.
  const catPerYear = mean(runs.map((r, i) => r.claimCountsByTier.catastrophic / trend(i + 1)));
  console.log(`  catastrophic claims/yr: ${catPerYear.toFixed(2)} de-trended (tier probs imply 2.97; design text says ~5-6)  ${note(Math.abs(catPerYear - 2.97) / 2.97 < 0.25, `catastrophic ${catPerYear.toFixed(2)} vs implied 2.97`)}`);

  console.log('  mean severity by tier:');
  const bySev: Record<string, number[]> = {};
  for (const r of runs) for (const c of r.claims) (bySev[c.tier] ??= []).push(c.grossUltimate);
  for (const t of ['medOnly', 'temp', 'perm', 'catastrophic', 'presumption']) {
    if (bySev[t]) console.log(`    ${t.padEnd(14)} ${fmt$(mean(bySev[t]))}  (n=${bySev[t].length})`);
  }

  // Overdispersion: member-year noise (k=16) must make counts wider than Poisson.
  const cv2 = coreCounts.reduce((a, b) => a + (b - mean(coreCounts)) ** 2, 0) / coreCounts.length / mean(coreCounts);
  console.log(`  count variance/mean  : ${cv2.toFixed(2)} (>1 = overdispersed vs pure Poisson)  ${note(cv2 > 1, `variance/mean ${cv2.toFixed(2)} not > 1`)}`);

  // Book decomposition — REPORTED for the cross-line recalibration decision.
  console.log('\n  book decomposition (de-trended $/yr, as booked):');
  const bucket = (pred: (t: string) => boolean) =>
    mean(runs.map((r, i) => r.claims.filter(c => pred(c.tier)).reduce((s, c) => s + c.grossUltimate, 0) / trend(i + 1)));
  const nonCat = bucket(t => t === 'medOnly' || t === 'temp' || t === 'perm');
  const cat = bucket(t => t === 'catastrophic');
  const pres = bucket(t => t === 'presumption');
  console.log(`    non-catastrophic (medOnly+temp+perm) ${fmt$(nonCat).padStart(9)}`);
  console.log(`    catastrophic, PV-booked              ${fmt$(cat).padStart(9)}`);
  console.log(`    presumption                          ${fmt$(pres).padStart(9)}`);
  console.log(`    TOTAL WC BOOK                        ${fmt$(nonCat + cat + pres).padStart(9)}`);
}

console.log('\n=== 1b. CATASTROPHIC: NOMINAL vs PV (why this tier alone discounts) ===');
{
  // The claim books PV; the nominal schedule is stored for Phase 3. This
  // records the gap that makes an undiscounted long-tail sum an invalid
  // booked value.
  const runs = runYears(roster, 200, { seedBase: 20250 });
  const cats = runs.flatMap(r => r.claims).filter(c => c.tier === 'catastrophic' && c.annuity);
  const nominal = cats.map(c => {
    const a = c.annuity!;
    const nom = (first: number, g: number, y: number) => (y <= 0 ? 0 : Math.abs(g) < 1e-12 ? first * y : first * ((Math.pow(1 + g, y) - 1) / g));
    return nom(a.medicalFirstYearPayment, a.medicalInflationPct, a.medicalYears) + nom(a.indemnityAnnualPayment, a.indemnityInflationPct, a.indemnityYears);
  });
  const booked = cats.map(c => c.grossUltimate);
  console.log(`  n = ${cats.length} catastrophic claims`);
  console.log(`  mean NOMINAL sum of stream : ${fmt$(mean(nominal))}  (stored on Claim.annuity for Phase 3)`);
  console.log(`  mean PV, as BOOKED         : ${fmt$(mean(booked))}  (at ${(WC_LOSS_MODEL.catastrophicDiscountRate * 100).toFixed(0)}% discount)`);
  console.log(`  nominal / PV ratio         : ${(mean(nominal) / mean(booked)).toFixed(2)}x  — the reason this tier cannot book undiscounted`);
  console.log(`  ${note(mean(booked) < mean(nominal) && mean(booked) > 0, 'PV not below nominal')}`);
  console.log(`  ${note(cats.every(c => c.annuity!.medicalInflationPct === WC_LOSS_MODEL.medicalTrend && c.annuity!.indemnityInflationPct === WC_LOSS_MODEL.indemnityTrend), 'annuity legs not using the named trend constants')}`);
}

console.log('\n=== 2. ENROLLED SUBSET SCALES PROPORTIONALLY (~30% of the market) ===');
{
  // Deterministic ~30%-of-payroll subset: every third member.
  const subset = roster.filter((_, i) => i % 3 === 0);
  const share = subset.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0) / roster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  const runs = runYears(subset, YEARS, { seedBase: 5501 });
  // De-trend before comparing: the target is a reference-year figure, and the
  // 50-year window carries the -1.5%/yr frequency decline.
  const trend = (y: number) => Math.pow(1 + WC_LOSS_MODEL.frequencyTrendPerYear, y - 1);
  const counts = mean(runs.map((r, i) => WC_CLASS_KEYS.reduce((s, c) => s + r.claimCountsByClass[c], 0) / trend(i + 1)));
  const gross = mean(runs.map((r, i) => r.grossUltimateLoss / trend(i + 1)));
  console.log(`  subset payroll share : ${(share * 100).toFixed(1)}% of market`);
  console.log(`  claims/yr            : ${counts.toFixed(1)} de-trended (proportional target ~${(809 * share).toFixed(0)})  ${note(Math.abs(counts - 809 * share) / (809 * share) < 0.15, `subset claims ${counts.toFixed(1)} vs proportional ${(809 * share).toFixed(0)}`)}`);
  console.log(`  gross loss/yr        : ${fmt$(gross)} de-trended (proportional to full-market book)`);
}

console.log('\n=== 3. RQ SWEEP — realized betas vs the A6 budget (uniform-RQ synthetic books) ===');
{
  // Uniform-RQ rosters bypass the canonical roster's 1.0 clamp so RQ 0 is testable.
  const at = (rq: number) => roster.map(m => ({ ...m, riskQuality: rq }));
  const stats = (rq: number) => {
    const members = at(rq);
    // kLine = 1 deliberately: kLine would neutralise the very RQ effect being measured.
    const runs = Array.from({ length: YEARS }, (_, i) => generateWcClaims({
      members, yearNumber: 1, calendarYear: 2026, instanceSeed: 31337 + i * 104729,
      kLine: 1, gPool: 1, riskControlEffectiveness: 0,
    }));
    const freq = mean(runs.map(r => WC_CLASS_KEYS.reduce((s, c) => s + r.claimCountsByClass[c], 0)));
    const claims = runs.flatMap(r => r.claims).filter(c => c.tier !== 'presumption');
    const permShare = claims.filter(c => c.tier === 'perm').length / claims.length;
    const catShare = claims.filter(c => c.tier === 'catastrophic').length / claims.length;
    const tempPerm = claims.filter(c => c.tier === 'temp' || c.tier === 'perm');
    return { freq, permShare, catShare, meanTempPermSev: mean(tempPerm.map(c => c.grossUltimate)) };
  };
  const lo = stats(0), mid = stats(5), hi = stats(10);
  const b = WC_LOSS_MODEL;

  const freqRatioLo = lo.freq / mid.freq, freqRatioHi = hi.freq / mid.freq;
  const expLo = Math.exp(5 * b.rqFrequencyBeta), expHi = Math.exp(-5 * b.rqFrequencyBeta);
  console.log(`  frequency  RQ0/RQ5 ${freqRatioLo.toFixed(4)} vs exp(+5x0.08)=${expLo.toFixed(4)}  ${note(Math.abs(freqRatioLo - expLo) / expLo < 0.05, `freq RQ0 ratio ${freqRatioLo.toFixed(4)} vs ${expLo.toFixed(4)}`)}`);
  console.log(`  frequency  RQ10/RQ5 ${freqRatioHi.toFixed(4)} vs exp(-5x0.08)=${expHi.toFixed(4)}  ${note(Math.abs(freqRatioHi - expHi) / expHi < 0.05, `freq RQ10 ratio ${freqRatioHi.toFixed(4)} vs ${expHi.toFixed(4)}`)}`);
  console.log(`  perm share RQ0 ${(lo.permShare * 100).toFixed(2)}%  RQ5 ${(mid.permShare * 100).toFixed(2)}%  RQ10 ${(hi.permShare * 100).toFixed(2)}%  (worse RQ -> costlier mix)  ${note(lo.permShare > mid.permShare && mid.permShare > hi.permShare, 'tier mix does not shift monotonically with RQ')}`);
  console.log(`  temp+perm mean severity RQ0 ${fmt$(lo.meanTempPermSev)}  RQ5 ${fmt$(mid.meanTempPermSev)}  RQ10 ${fmt$(hi.meanTempPermSev)}  (duration channel)  ${note(lo.meanTempPermSev > hi.meanTempPermSev, 'duration channel not monotonic in RQ')}`);
  console.log(`  catastrophic share RQ0 ${(lo.catShare * 100).toFixed(4)}%  RQ5 ${(mid.catShare * 100).toFixed(4)}%  RQ10 ${(hi.catShare * 100).toFixed(4)}%  — must be FLAT  ${note(Math.abs(lo.catShare - hi.catShare) / Math.max(mid.catShare, 1e-9) < 0.30, `catastrophic share varies with RQ: ${lo.catShare} vs ${hi.catShare}`)}`);
}

console.log('\n=== 4. PRESUMPTION IS RQ-INVARIANT (theta_WC not applied) ===');
{
  const at = (rq: number) => roster.map(m => ({ ...m, riskQuality: rq }));
  const count = (rq: number) => mean(Array.from({ length: YEARS }, (_, i) => generateWcClaims({
    members: at(rq), yearNumber: 1, calendarYear: 2026, instanceSeed: 777 + i * 15485863,
    kLine: 1, gPool: 1, riskControlEffectiveness: 0,
  }).claimCountsByClass.presumption));
  const lo = count(0), hi = count(10);
  console.log(`  presumption/yr at RQ0 ${lo.toFixed(2)}  at RQ10 ${hi.toFixed(2)}  ${note(Math.abs(lo - hi) / Math.max(lo, 1e-9) < 0.12, `presumption varies with RQ: ${lo.toFixed(2)} vs ${hi.toFixed(2)}`)}`);
  // The report-lag trend is the surface a Phase-3 retroactive presumption
  // expansion acts on: severity is drawn in accident-year dollars and carried
  // forward at the medical trend over the lag.
  const sample = generateWcClaims({
    members: roster, yearNumber: 1, calendarYear: 2026, instanceSeed: 246813,
    kLine: 1, gPool: 1, riskControlEffectiveness: 0,
  }).claims.filter(c => c.tier === 'presumption');
  const meanLag = mean(sample.map(c => c.reportedYear - c.accidentYear));
  const meanSev = mean(sample.map(c => c.grossUltimate));
  const impliedFactor = meanSev / (WC_LOSS_MODEL.presumption.severityMean * 1.0);
  console.log(`  mean report lag ${meanLag.toFixed(1)}yr, mean booked severity ${fmt$(meanSev)} vs $0.35M accident-year draw`);
  console.log(`  => implied trend factor ~${impliedFactor.toFixed(2)}x (medical trend over the lag)  ${note(impliedFactor > 1.2, 'presumption severity not trended over the report lag')}`);
  // The lag distribution is truncated-and-renormalised: no draw may exceed the
  // bound, and there must be no artificial point mass sitting ON the bound.
  const maxLag = WC_LOSS_MODEL.presumption.maxReportLagYears;
  const lagRuns = Array.from({ length: 200 }, (_, i) => generateWcClaims({
    members: roster, yearNumber: 1, calendarYear: 2026, instanceSeed: 13579 + i * 7919,
    kLine: 1, gPool: 1, riskControlEffectiveness: 0,
  }).claims.filter(c => c.tier === 'presumption')).flat();
  const lags = lagRuns.map(c => c.reportedYear - c.accidentYear);
  const atBound = lags.filter(l => l === Math.round(maxLag)).length;
  console.log(`  lag draws n=${lags.length}: max ${Math.max(...lags)}y (bound ${maxLag}y), none exceed bound ${note(Math.max(...lags) <= maxLag, `lag ${Math.max(...lags)} exceeds bound ${maxLag}`)}`);
  console.log(`  no artificial point mass at the bound: ${atBound}/${lags.length} exactly at ${maxLag}y  ${note(atBound / lags.length < 0.01, `${atBound} draws piled on the bound — truncation degenerated into clamping`)}`);
}

console.log('\n=== 5. RISK CONTROL HITS THE DRAW ONLY (Correction 2 / finding 17) ===');
{
  const rc = 0.15; // RISK_CONTROL_PARAMS.maxEffectiveness
  const N = 300;
  const runA = runYears(roster, N, { seedBase: 4242 });
  const runB = runYears(roster, N, { seedBase: 4242, rc });
  // Frequency is the channel RC acts on, so claim COUNT is the clean test —
  // gross loss is dominated by lumpy catastrophic claims and converges far
  // more slowly.
  const cnt = (rs: typeof runA) => mean(rs.map(r => WC_CLASS_KEYS.reduce((s, c) => s + r.claimCountsByClass[c], 0)));
  const countRatio = cnt(runB) / cnt(runA);
  const lossRatio = mean(runB.map(r => r.grossUltimateLoss)) / mean(runA.map(r => r.grossUltimateLoss));
  const expected = 1 - rc;
  console.log(`  claim COUNT with RC / without: ${countRatio.toFixed(4)} (expect ${expected.toFixed(2)})  ${note(Math.abs(countRatio - expected) < 0.02, `RC count effect ${countRatio.toFixed(4)} vs ${expected}`)}`);
  console.log(`  gross LOSS  with RC / without: ${lossRatio.toFixed(4)} (same expectation, slower convergence — catastrophic lumpiness)`);
  const expNoRc = expectedWcGrossLoss(roster);
  console.log(`  analytic expectation is RC-blind (no rc argument exists): ${fmt$(expNoRc)}  OK`);
  console.log(`  => RC reduces losses without reducing premium: loss-ratio effective  ${note(countRatio < 0.98, 'RC had no effect on the draw')}`);
}

console.log('\n=== 6. DRAW MATCHES ITS OWN ANALYTIC EXPECTATION (invariant 1) ===');
{
  const kLine = computeKLine(roster);
  const analytic = expectedWcGrossLoss(roster, { kLine, yearNumber: 1 });
  const drawn = mean(Array.from({ length: 300 }, (_, i) => generateWcClaims({
    members: roster, yearNumber: 1, calendarYear: 2026, instanceSeed: 60013 + i * 7919,
    kLine, gPool: 1, riskControlEffectiveness: 0,
  }).grossUltimateLoss));
  const err = Math.abs(drawn - analytic) / analytic;
  console.log(`  analytic ${fmt$(analytic)}   drawn mean (300 yrs) ${fmt$(drawn)}   relative error ${(err * 100).toFixed(2)}%  ${note(err < 0.05, `draw vs analytic off by ${(err * 100).toFixed(2)}%`)}`);
}

console.log('\n=== 7. k_line NEUTRALISES RISK-QUALITY MIX ===');
{
  const kFull = computeKLine(roster);
  const good = roster.filter(m => m.riskQuality >= 7);
  const bad = roster.filter(m => m.riskQuality <= 3);
  console.log(`  k_line full roster ${kFull.toFixed(4)}   good-RQ book ${computeKLine(good).toFixed(4)}   bad-RQ book ${computeKLine(bad).toFixed(4)}`);
  for (const [label, book] of [['full', roster], ['good-RQ', good], ['bad-RQ', bad]] as [string, Member[]][]) {
    const k = computeKLine(book);
    const adj = expectedWcGrossLoss(book, { kLine: k, includePresumption: false });
    const neu = expectedWcGrossLoss(book, { riskQualityOverride: 5, includePresumption: false });
    const err = Math.abs(adj - neu) / neu;
    console.log(`    ${label.padEnd(8)} expected loss with k_line ${fmt$(adj)} vs neutral ${fmt$(neu)}  err ${(err * 100).toFixed(4)}%  ${note(err < 1e-6, `k_line does not neutralise ${label}`)}`);
  }
}

console.log('\n=== 8. HELD NEUTRAL PURE PREMIUM (Correction 1) ===');
{
  const pp = deriveNeutralPurePremiumPer100(roster);
  const payroll = roster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  console.log(`  derived purePremiumPer100 = ${pp.toFixed(4)}  ($ per $100 payroll)`);
  console.log(`  implied full-market expected loss = ${fmt$(pp * payroll * 10_000)} on $${payroll.toFixed(0)}M payroll`);
  console.log(`  (reported, not band-checked: whether this is right depends on the catastrophic-severity`);
  console.log(`   question in section 1 — at the $19.5M design target it would be ~1.50)`);
  console.log(`  ${note(pp > 0 && Number.isFinite(pp), 'purePremiumPer100 not a positive finite number')}`);
}

console.log('\n=== 9. DETERMINISM AND CLAIM INTEGRITY ===');
{
  const a = generateWcClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 8675309, kLine: 1, gPool: 1.07, riskControlEffectiveness: 0.05 });
  const b = generateWcClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 8675309, kLine: 1, gPool: 1.07, riskControlEffectiveness: 0.05 });
  console.log(`  same inputs -> identical output: ${note(JSON.stringify(a) === JSON.stringify(b), 'generator not deterministic')}`);
  const sum = a.claims.reduce((s, c) => s + c.grossUltimate, 0);
  console.log(`  sum(claim.grossUltimate) === grossUltimateLoss: ${note(Math.abs(sum - a.grossUltimateLoss) < 1e-6, 'claim sum != grossUltimateLoss')}`);
  console.log(`  one occurrence per claim: ${note(a.occurrences.length === a.claims.length, 'occurrence/claim count mismatch')}`);
  console.log(`  all ids unique: ${note(new Set(a.claims.map(c => c.id)).size === a.claims.length, 'duplicate claim ids')}`);
  console.log(`  member loss sum === total: ${note(Math.abs(a.memberLossResults.reduce((s, m) => s + m.simulatedLoss, 0) - a.grossUltimateLoss) < 1e-6, 'memberLossResults do not sum to total')}`);
  const bad = a.claims.filter(c => !(c.grossUltimate >= 0) || !Number.isFinite(c.grossUltimate) || c.caseReserve !== c.grossUltimate || c.paidToDate !== 0);
  console.log(`  amounts finite/non-negative, reserve=ultimate, paid=0: ${note(bad.length === 0, `${bad.length} malformed claims`)}`);
  const cats = a.claims.filter(c => c.tier === 'catastrophic');
  console.log(`  catastrophic carry annuity, no paymentPattern: ${note(cats.every(c => c.annuity && !c.paymentPattern), 'catastrophic claim missing annuity or carrying a pattern')}  (n=${cats.length})`);
  const nonCat = a.claims.filter(c => c.tier !== 'catastrophic');
  console.log(`  non-catastrophic carry a payment pattern: ${note(nonCat.every(c => (c.paymentPattern?.length ?? 0) > 0), 'non-catastrophic claim missing paymentPattern')}`);
  const presump = a.claims.filter(c => c.tier === 'presumption');
  console.log(`  presumption tagged with report lag > accident year: ${note(presump.every(p => p.reportedYear > p.accidentYear), 'presumption claim not lagged')}  (n=${presump.length}, mean lag ${presump.length ? (mean(presump.map(p => p.reportedYear - p.accidentYear))).toFixed(1) : 'n/a'}yr)`);
  console.log(`  region multipliers in [0.92, 1.12]: ${note([1, 2, 3, 4, 5].every(r => regionMultiplier(r) >= 0.92 && regionMultiplier(r) <= 1.12), 'region multiplier out of range')}`);
}

console.log(problems.length === 0
  ? '\nALL WC GENERATOR CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
