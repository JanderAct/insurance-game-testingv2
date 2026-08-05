// Statistical verification of the GL claim-level generator (design doc Part B).
// Read-only; drives glClaimEngine directly — checks the GENERATOR against its
// design targets before and independently of the engine cutover. Per finding 8
// everything is distributional across many draws; nothing is a baseline diff.
//
// Run: npx tsx scripts/diagnostics/gl-claim-check.ts
//
// Pareto caution (alpha 1.3, infinite variance): law-enforcement dollar totals
// verify on counts/medians and are otherwise REPORTED; the strict
// draw-vs-analytic assertions run per-sub on general/epl/abuse and on the
// total EXCLUDING lawEnforcement.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import {
  GL_LOSS_MODEL,
  GL_RELATIVITIES,
  GL_SUB_KEYS,
  WC_CLASS_MIX,
} from '../../src/data/defaultAssumptions';
import {
  computeKGl,
  deriveNeutralGlPurePremiumPer100,
  expectedGlGrossLoss,
  generateGlClaims,
  glInternals,
} from '../../src/utils/glClaimEngine';
import { lognormalInvCdf, lognormalParams, normalCdf } from '../../src/utils/claimMath';
import { SeededRandom } from '../../src/utils/random';
import type { Claim, Member } from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'OK' : 'FAIL'; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const roster = getPredefinedMarketMembers();
const Mdl = GL_LOSS_MODEL;

function runYears(members: Member[], years: number, opts: { rc?: number; seedBase?: number } = {}) {
  const kGl = computeKGl(members);
  const out = [];
  for (let y = 1; y <= years; y++) {
    out.push(generateGlClaims({
      members,
      yearNumber: 1, // frequency is flat; fixing the year isolates lag/trend structure per draw
      calendarYear: 2026,
      instanceSeed: (opts.seedBase ?? 1211) + y * 7919,
      kGl,
      gPool: 1,
      riskControlEffectiveness: opts.rc ?? 0,
    }));
  }
  return out;
}

const YEARS = 300;
console.log(`=== GL generator: full canonical market, ${YEARS} independent draw-years, gPool=1, RQ actual, no RC ===\n`);
const runs = runYears(roster, YEARS);
const allClaims: Claim[] = runs.flatMap(r => r.claims);

console.log('--- 1. per-sub frequency (roster-derived analytic; design "~832 general" is stale reference) ---');
{
  const kGl = computeKGl(roster);
  // Analytic per-sub expected counts at the roster's actual RQ mix, x kGl.
  const analytic: Record<string, number> = { general: 0, epl: 0, lawEnforcement: 0, abuse: 0 };
  for (const m of roster) {
    const theta = Math.exp(-Mdl.rqFrequencyBeta * (m.riskQuality - 5));
    for (const sub of GL_SUB_KEYS) {
      const base = sub === 'lawEnforcement'
        ? (m.exposureByLine.GL ?? 0) * (WC_CLASS_MIX[m.type]?.police ?? 0)
        : (m.exposureByLine.GL ?? 0);
      const rel = GL_RELATIVITIES[m.type];
      const w = sub === 'general' ? rel.general : sub === 'epl' ? rel.epl : sub === 'lawEnforcement' ? rel.lawEnforcement : rel.abuse;
      analytic[sub] += base * w * Mdl.ratePer1M[sub] * theta * kGl;
    }
  }
  const measured: Record<string, number> = {
    general: mean(runs.map(r => r.claimCountsBySub.general)),
    epl: mean(runs.map(r => r.claimCountsBySub.epl)),
    lawEnforcement: mean(runs.map(r => r.claimCountsBySub.lawEnforcement)),
    abuse: mean(runs.map(r => r.claimCountsBySub.abuseIncidents)),
  };
  const refs: Record<string, string> = { general: '897 (stale ref 832)', epl: '~108', lawEnforcement: '~13.3', abuse: '~3.4 incidents' };
  for (const sub of GL_SUB_KEYS) {
    const rel = Math.abs(measured[sub] - analytic[sub]) / analytic[sub];
    console.log(`  ${sub.padEnd(15)} measured ${measured[sub].toFixed(2).padStart(8)}   analytic ${analytic[sub].toFixed(2).padStart(8)}   (${refs[sub]})  ${note(rel < 0.05, `${sub} freq ${measured[sub].toFixed(1)} vs ${analytic[sub].toFixed(1)}`)}`);
  }
  const claimants = mean(runs.map(r => r.claimCountsBySub.abuse)) / Math.max(1e-9, mean(runs.map(r => r.claimCountsBySub.abuseIncidents)));
  const expClaimants = glInternals.expectedClaimantsPerIncident();
  console.log(`  abuse claimants/incident ${claimants.toFixed(2)} vs truncated-NegBin analytic ${expClaimants.toFixed(2)}  ${note(Math.abs(claimants - expClaimants) / expClaimants < 0.08, `claimants ${claimants.toFixed(2)} vs ${expClaimants.toFixed(2)}`)}`);
}

console.log('\n--- 2. pay rates and ALAE share ---');
{
  // Pay rates asserted on a uniform-RQ5 book so the analytic is exact.
  const at5 = roster.map(m => ({ ...m, riskQuality: 5 }));
  const r5 = Array.from({ length: 150 }, (_, i) => generateGlClaims({
    members: at5, yearNumber: 1, calendarYear: 2026, instanceSeed: 5150 + i * 104729, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
  }));
  const c5 = r5.flatMap(r => r.claims);
  for (const sub of GL_SUB_KEYS) {
    const subClaims = c5.filter(c => c.tier === sub);
    const paid = subClaims.filter(c => (c.indemnity ?? 0) > 0).length / Math.max(1, subClaims.length);
    const target = Mdl.subCoverages[sub].payRate;
    console.log(`  ${sub.padEnd(15)} pay rate ${(paid * 100).toFixed(1)}% vs ${(target * 100).toFixed(0)}%  ${note(Math.abs(paid - target) < 0.02, `${sub} pay rate ${(paid * 100).toFixed(1)} vs ${(target * 100).toFixed(0)}`)}`);
  }
  const alaeShare = allClaims.reduce((s, c) => s + (c.alae ?? 0), 0) / allClaims.reduce((s, c) => s + c.grossUltimate, 0);
  console.log(`  ALAE share of gross ${(alaeShare * 100).toFixed(1)}% (design ~35%)  ${note(alaeShare > 0.25 && alaeShare < 0.50, `ALAE share ${(alaeShare * 100).toFixed(1)}%`)}`);
}

console.log('\n--- 3. the liability gate ---');
{
  // Structural monotonicity: bigger latent strength M -> bigger u -> bigger
  // loss, at a fixed threshold (mirrors the generator's mapping exactly).
  const t = glInternals.gateThreshold('general', 5);
  const phiT = normalCdf(t);
  let prev = 0, monotone = true;
  for (const strength of [t + 0.1, t + 0.5, t + 1, t + 1.5, t + 2, t + 3]) {
    const u = Math.min(1 - 1e-12, (normalCdf(strength) - phiT) / (1 - phiT));
    const sev = lognormalInvCdf(Mdl.subCoverages.general.indemnity.mean, Mdl.subCoverages.general.indemnity.cv, u);
    if (sev <= prev) monotone = false;
    prev = sev;
  }
  console.log(`  severity strictly increasing in latent strength M: ${note(monotone, 'gate not monotone in M')}`);
  // The tried-and-won case: max defense spend, zero indemnity.
  const triedWon = allClaims.filter(c => c.litigationStage === 'triedToVerdict' && (c.indemnity ?? 0) === 0 && (c.alae ?? 0) > 0);
  const meanAlaeAll = mean(allClaims.map(c => c.alae ?? 0));
  const meanAlaeTriedWon = mean(triedWon.map(c => c.alae ?? 0));
  console.log(`  tried-to-verdict-and-WON claims: ${triedWon.length} (${(triedWon.length / allClaims.length * 100).toFixed(2)}%)  ${note(triedWon.length > 0, 'tried-and-won case never occurred')}`);
  console.log(`  their mean ALAE ${fmt$(meanAlaeTriedWon)} vs all-claim mean ${fmt$(meanAlaeAll)}  ${note(meanAlaeTriedWon > 2 * meanAlaeAll, 'tried-and-won ALAE not elevated')}`);
}

console.log('\n--- 4. abuse batches (J6: totals REPORTED, not just correlation asserted) ---');
{
  const batches = runs.flatMap(r => r.occurrences.filter(o => o.claimIds.length >= 1 && o.id.includes('abuse')));
  const sizes = batches.map(b => b.claimIds.length);
  const multi = batches.filter(b => b.claimIds.length > 1).length;
  console.log(`  incidents ${batches.length}, multi-claimant ${multi} (${(multi / batches.length * 100).toFixed(0)}%), sizes min ${Math.min(...sizes)} / mean ${mean(sizes).toFixed(2)} / max ${Math.max(...sizes)}  ${note(Math.min(...sizes) >= 1 && multi > 0, 'batch structure wrong')}`);
  // one occurrence id per batch, claims sum matches
  const claimById = new Map(allClaims.map(c => [c.id, c]));
  let backrefOk = true;
  const totals: number[] = [];
  for (const b of batches) {
    let t = 0;
    for (const cid of b.claimIds) {
      const c = claimById.get(cid);
      if (!c || c.occurrenceId !== b.id) backrefOk = false;
      t += c?.grossUltimate ?? 0;
    }
    totals.push(t);
  }
  console.log(`  occurrence<->claim backrefs consistent: ${note(backrefOk, 'occurrence claimIds backrefs broken')}`);
  totals.sort((a, b) => a - b);
  const p = (q: number) => totals[Math.min(totals.length - 1, Math.floor(q * totals.length))];
  console.log(`  BATCH TOTALS (booked, settlement-yr $): mean ${fmt$(mean(totals))}  median ${fmt$(p(0.5))}  P99 ${fmt$(p(0.99))}  max ${fmt$(totals[totals.length - 1])}`);
  // within-batch correlation: shared factor -> paid log-severities correlate
  const pairsX: number[] = [], pairsY: number[] = [];
  for (const b of batches) {
    const paid = b.claimIds.map(id => claimById.get(id)!).filter(c => (c.indemnity ?? 0) > 0);
    for (let i = 0; i + 1 < paid.length; i += 2) {
      pairsX.push(Math.log(paid[i].indemnity!));
      pairsY.push(Math.log(paid[i + 1].indemnity!));
    }
  }
  const mx = mean(pairsX), my = mean(pairsY);
  const cov = pairsX.reduce((s, x, i) => s + (x - mx) * (pairsY[i] - my), 0) / pairsX.length;
  const sx = Math.sqrt(pairsX.reduce((s, x) => s + (x - mx) ** 2, 0) / pairsX.length);
  const sy = Math.sqrt(pairsY.reduce((s, y) => s + (y - my) ** 2, 0) / pairsY.length);
  const corr = cov / (sx * sy);
  console.log(`  within-batch paid log-indemnity correlation ${corr.toFixed(3)} over ${pairsX.length} pairs (50/50 log-var split -> ~0.5)  ${note(corr > 0.3, `within-batch corr ${corr.toFixed(3)} <= 0.3`)}`);
}

console.log('\n--- 5. law-enforcement tail ---');
{
  const le = allClaims.filter(c => c.tier === 'lawEnforcement');
  const paid = le.filter(c => (c.indemnity ?? 0) > 0);
  // Pareto component: indemnity (accident-yr xm $1M, trended up) — identify by size
  const big = paid.filter(c => (c.indemnity ?? 0) >= 1_000_000);
  console.log(`  LE claims ${le.length}, paid ${paid.length}, indemnity >= $1M: ${big.length} (${(big.length / Math.max(1, paid.length) * 100).toFixed(1)}% of paid; Pareto weight 5%)  ${note(big.length > 0, 'no Pareto-tail LE claims occurred')}`);
  const fedShare = le.filter(c => c.legalBasis === 'federal1983').length / Math.max(1, le.length);
  console.log(`  federal1983 share ${(fedShare * 100).toFixed(1)}% vs 60%  ${note(Math.abs(fedShare - 0.60) < 0.05, `LE 1983 share ${(fedShare * 100).toFixed(1)}%`)}`);
  const bigFed = big.filter(c => c.legalBasis === 'federal1983').length;
  console.log(`  of the >=1M claims, federal (cap-escaping): ${bigFed}/${big.length}; max LE claim ${fmt$(Math.max(...paid.map(c => c.grossUltimate)))} — REPORTED (infinite-variance tail)`);
}

console.log('\n--- 6. RQ sweeps (B7) ---');
{
  const at = (rq: number) => roster.map(m => ({ ...m, riskQuality: rq }));
  const stats = (rq: number) => {
    const rs = Array.from({ length: 120 }, (_, i) => generateGlClaims({
      members: at(rq), yearNumber: 1, calendarYear: 2026, instanceSeed: 31337 + i * 104729, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
    }));
    const cs = rs.flatMap(r => r.claims);
    const singles = cs.filter(c => c.tier !== 'abuse');
    return {
      freq: mean(rs.map(r => r.claimCountsBySub.general + r.claimCountsBySub.epl + r.claimCountsBySub.lawEnforcement)),
      payRateGen: (() => { const g = cs.filter(c => c.tier === 'general'); return g.filter(c => (c.indemnity ?? 0) > 0).length / Math.max(1, g.length); })(),
      // Trimmed paid-severity (general, sub-cap) to dodge tail noise: J9 says flat in RQ.
      paidSevGen: (() => { const xs = cs.filter(c => c.tier === 'general' && (c.indemnity ?? 0) > 0).map(c => c.indemnity!).sort((a, b) => a - b); return mean(xs.slice(0, Math.floor(xs.length * 0.95))); })(),
      alaePerClaim: mean(singles.map(c => c.alae ?? 0)),
      total: mean(rs.map(r => r.grossUltimateLoss)),
    };
  };
  const lo = stats(0), mid = stats(5), hi = stats(10);
  const b = Mdl.rqFrequencyBeta;
  console.log(`  frequency RQ0/RQ5 ${(lo.freq / mid.freq).toFixed(4)} vs exp(+5x${b})=${Math.exp(5 * b).toFixed(4)}  ${note(Math.abs(lo.freq / mid.freq - Math.exp(5 * b)) / Math.exp(5 * b) < 0.05, 'freq beta low side')}`);
  console.log(`  frequency RQ10/RQ5 ${(hi.freq / mid.freq).toFixed(4)} vs exp(-5x${b})=${Math.exp(-5 * b).toFixed(4)}  ${note(Math.abs(hi.freq / mid.freq - Math.exp(-5 * b)) / Math.exp(-5 * b) < 0.05, 'freq beta high side')}`);
  for (const [label, rq, st] of [['RQ0', 0, lo], ['RQ5', 5, mid], ['RQ10', 10, hi]] as const) {
    const analyticPay = glInternals.payRateAt('general', rq);
    console.log(`  ${label} general pay rate ${(st.payRateGen * 100).toFixed(1)}% vs gate analytic ${(analyticPay * 100).toFixed(1)}%  ${note(Math.abs(st.payRateGen - analyticPay) < 0.02, `${label} pay rate off gate analytic`)}`);
  }
  console.log(`  paid-severity (general, 95%-trimmed) RQ0 ${fmt$(lo.paidSevGen)} RQ5 ${fmt$(mid.paidSevGen)} RQ10 ${fmt$(hi.paidSevGen)} — J9: flat  ${note(Math.abs(lo.paidSevGen - hi.paidSevGen) / mid.paidSevGen < 0.08, 'paid severity not flat in RQ')}`);
  console.log(`  ALAE per claim RQ0 ${fmt$(lo.alaePerClaim)} RQ10 ${fmt$(hi.alaePerClaim)} — flat  ${note(Math.abs(lo.alaePerClaim - hi.alaePerClaim) / mid.alaePerClaim < 0.08, 'ALAE per claim not flat in RQ')}`);
  console.log(`  total-cost RQ0/RQ10 ratio ${(lo.total / hi.total).toFixed(3)} vs exp(10x0.084)=${Math.exp(10 * 0.084).toFixed(3)} — REPORTED (combined beta, tail-noisy)`);
}

console.log('\n--- 7. lag truncation (divergence guard) ---');
{
  for (const sub of GL_SUB_KEYS) {
    const spec = Mdl.subCoverages[sub];
    const lags = allClaims.filter(c => c.tier === sub).map(c => c.reportedYear - c.accidentYear);
    let maxLag = 0;
    for (const l of lags) if (l > maxLag) maxLag = l;
    const atBound = lags.filter(l => l === Math.round(spec.reportLag.maxYears)).length;
    // Rejection rate: analytic P(raw > bound) + empirical from raw draws.
    const { mu, sigma } = lognormalParams(spec.reportLag.meanYears, spec.reportLag.cv);
    const analyticReject = 1 - normalCdf((Math.log(spec.reportLag.maxYears) - mu) / sigma);
    const rng = new SeededRandom(999);
    let rejected = 0; const NN = 200_000;
    for (let i = 0; i < NN; i++) if (Math.exp(mu + sigma * rng.normal(0, 1)) > spec.reportLag.maxYears) rejected++;
    console.log(`  ${sub.padEnd(15)} max lag ${maxLag}y (bound ${spec.reportLag.maxYears}y) ${note(maxLag <= spec.reportLag.maxYears, `${sub} lag exceeds bound`)}; at-bound count ${atBound} (${(atBound / Math.max(1, lags.length) * 100).toFixed(2)}%) ${note(atBound / Math.max(1, lags.length) < 0.02, `${sub} mass piled at bound`)}; rejection rate analytic ${(analyticReject * 100).toFixed(3)}% / empirical ${(rejected / NN * 100).toFixed(3)}%`);
  }
}

console.log('\n--- 8. draw vs analytic expectation (invariant 1) ---');
{
  const kGl = computeKGl(roster);
  // Per-sub booked dollars from the draw:
  const drawn: Record<string, number> = { general: 0, epl: 0, lawEnforcement: 0, abuse: 0 };
  for (const c of allClaims) drawn[c.tier] = (drawn[c.tier] ?? 0) + c.grossUltimate;
  for (const k of Object.keys(drawn)) drawn[k] /= YEARS;
  // Per-sub analytic: rebuild from internals (mirrors expectedGlGrossLoss's terms).
  const analytic: Record<string, number> = { general: 0, epl: 0, lawEnforcement: 0, abuse: 0 };
  for (const m of roster) {
    const theta = Math.exp(-Mdl.rqFrequencyBeta * (m.riskQuality - 5));
    for (const sub of GL_SUB_KEYS) {
      const base = sub === 'lawEnforcement' ? (m.exposureByLine.GL ?? 0) * (WC_CLASS_MIX[m.type]?.police ?? 0) : (m.exposureByLine.GL ?? 0);
      const rel = GL_RELATIVITIES[m.type];
      const w = sub === 'general' ? rel.general : sub === 'epl' ? rel.epl : sub === 'lawEnforcement' ? rel.lawEnforcement : rel.abuse;
      const lam = base * w * Mdl.ratePer1M[sub] * theta * kGl;
      const spec = Mdl.subCoverages[sub];
      const per = glInternals.payRateAt(sub, m.riskQuality) * glInternals.meanIndemnityWhenPaid(sub) * glInternals.expectedIndemnityTrend(sub)
        + spec.alae.mean * glInternals.expectedAlaeMultipleTimesTrend(sub);
      analytic[sub] += sub === 'abuse' ? lam * glInternals.expectedClaimantsPerIncident() * per : lam * per;
    }
  }
  let strictTotalDrawn = 0, strictTotalAnalytic = 0;
  for (const sub of GL_SUB_KEYS) {
    const rel = Math.abs(drawn[sub] - analytic[sub]) / analytic[sub];
    if (sub === 'lawEnforcement') {
      console.log(`  ${sub.padEnd(15)} drawn ${fmt$(drawn[sub])} vs analytic ${fmt$(analytic[sub])} (${(rel * 100).toFixed(1)}%) — REPORTED (Pareto: infinite variance)`);
    } else {
      strictTotalDrawn += drawn[sub]; strictTotalAnalytic += analytic[sub];
      console.log(`  ${sub.padEnd(15)} drawn ${fmt$(drawn[sub])} vs analytic ${fmt$(analytic[sub])} (${(rel * 100).toFixed(2)}%)  ${note(rel < (sub === 'abuse' ? 0.10 : 0.03), `${sub} draw vs analytic ${(rel * 100).toFixed(1)}%`)}`);
    }
  }
  const relStrict = Math.abs(strictTotalDrawn - strictTotalAnalytic) / strictTotalAnalytic;
  console.log(`  total EXCLUDING LE: drawn ${fmt$(strictTotalDrawn)} vs analytic ${fmt$(strictTotalAnalytic)} (${(relStrict * 100).toFixed(2)}%)  ${note(relStrict < 0.03, `non-LE total ${(relStrict * 100).toFixed(1)}%`)}`);
  const full = expectedGlGrossLoss(roster, { kGl });
  console.log(`  FULL analytic (expectedGlGrossLoss) ${fmt$(full)} vs component rebuild ${fmt$(analytic.general + analytic.epl + analytic.lawEnforcement + analytic.abuse)}  ${note(Math.abs(full - (analytic.general + analytic.epl + analytic.lawEnforcement + analytic.abuse)) / full < 1e-9, 'expectedGlGrossLoss disagrees with its own components')}`);
  console.log(`  FULL drawn total ${fmt$(mean(runs.map(r => r.grossUltimateLoss)))} vs FULL analytic ${fmt$(full)} — REPORTED (LE tail included)`);
}

console.log('\n--- 9. determinism, integrity, shock signal, held pure premium ---');
{
  const a = generateGlClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 8675309, kGl: 1, gPool: 1.07, riskControlEffectiveness: 0.05 });
  const b = generateGlClaims({ members: roster, yearNumber: 3, calendarYear: 2028, instanceSeed: 8675309, kGl: 1, gPool: 1.07, riskControlEffectiveness: 0.05 });
  console.log(`  same inputs -> identical output: ${note(JSON.stringify(a) === JSON.stringify(b), 'not deterministic')}`);
  const sum = a.claims.reduce((s, c) => s + c.grossUltimate, 0);
  console.log(`  sum(claims) === grossUltimateLoss: ${note(Math.abs(sum - a.grossUltimateLoss) < 1e-6, 'claim sum mismatch')}`);
  console.log(`  indemnity + alae === grossUltimate per claim: ${note(a.claims.every(c => Math.abs((c.indemnity ?? 0) + (c.alae ?? 0) - c.grossUltimate) < 1e-9), 'indemnity+alae != gross')}`);
  console.log(`  member losses sum to total: ${note(Math.abs(a.memberLossResults.reduce((s, m) => s + m.simulatedLoss, 0) - a.grossUltimateLoss) < 1e-6, 'member sums mismatch')}`);
  console.log(`  ids unique: ${note(new Set(a.claims.map(c => c.id)).size === a.claims.length, 'duplicate ids')}`);
  console.log(`  every claim's occurrence exists & backrefs: ${note((() => { const occ = new Map(a.occurrences.map(o => [o.id, o])); return a.claims.every(c => occ.get(c.occurrenceId)?.claimIds.includes(c.id)); })(), 'occurrence backrefs broken')}`);
  const shockYears = runs.filter(r => r.maxOccurrenceGross > 1_000_000).length;
  console.log(`  years with an occurrence > $1M (shock signal, J11): ${shockYears}/${YEARS} (${(shockYears / YEARS * 100).toFixed(0)}%)  ${note(shockYears > 0, 'shock signal never fires')}`);
  const pp = deriveNeutralGlPurePremiumPer100(roster);
  console.log(`  held neutral GL purePremiumPer100 = ${pp.toFixed(4)} ($ per $100 payroll)  ${note(pp > 0 && Number.isFinite(pp), 'pure premium not finite')}`);
  console.log(`  implied full-market expected GL loss = ${fmt$(pp * roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0) * 10_000)}`);
}

console.log(problems.length === 0 ? '\nALL GL GENERATOR CHECKS PASS.' : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
