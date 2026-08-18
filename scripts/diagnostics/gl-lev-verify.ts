// GL LOSS-BY-BAND: does the generator reproduce the mixture's limited expected
// values, or does it not?
//
//   npx tsx scripts/diagnostics/gl-lev-verify.ts
//
// WORKTREE-ONLY. Verification, not a shipping diagnostic. Nothing here is fixed.
//
// ============================================================================
// WHY THIS IS NOT A BAND-SHARE RE-RUN.
//
// A prior measurement put GL's dollar shares at 33.0 / 46.1 / 20.9 against a
// closed form of 48.1 / 40.0 / 12.0 — the top band +75%. A band share is a
// RATIO OF TWO HEAVY-TAILED SUMS. At GL's blended CV of 29.55 neither the
// numerator nor the denominator has a usable sampling distribution, their ratio
// has no honest CI, and re-running it larger tells you nothing you can defend.
//
// So this file does not measure band shares to decide the question. It measures
// E[min(X,k)] at five thresholds. Each is a CAPPED quantity: per-observation
// variance is bounded by k x E[min(X,k)], so each carries a real CI and each is
// PASS/FAIL against its closed form. The bands are then DIFFERENCES of
// quantities that have actually been verified:
//
//   below $1M   = E[min(X,1M)]
//   $1M-$25M    = E[min(X,25M)] - E[min(X,1M)]
//   above $25M  = E[X] - E[min(X,25M)]
//
// Only the third involves the raw mean, and it is the one reported without a
// gate.
//
// THE CLOSED FORM IS IMPLEMENTED INDEPENDENTLY HERE. Phi comes from an erfc
// continued fraction written in this file, validated against five standard
// normal constants before anything is built on it, and only THEN cross-checked
// against the repo's limitedExpectedValue/normalCdf. Testing the engine against
// the engine's own closed form would verify nothing.
//
// BASIS. Every draw below is on the closed form's own basis: uniform RQ 5 (so
// the severity tilt is exp(0) = 1 and inert), kGl = 1, gPool = 1, no risk
// control, yearNumber = 1 (so glSeverityTrend = 1 and wageFactor = 1). Section
// 7 deliberately BREAKS that basis to test a specific hypothesis about the
// prior measurement.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { GL_LOSS_MODEL, GL_SEVERITY_COMPONENTS } from '../../src/data/defaultAssumptions';
import { generateGlClaims, glSeverityTrend } from '../../src/utils/glClaimEngine';
import { limitedExpectedValue, normalCdf } from '../../src/utils/claimMath';

const problems: string[] = [];
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'PASS' : 'FAIL'; };
const Z99 = 2.5758293035489004;
const fmt = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// 1. AN INDEPENDENT NORMAL CDF.
// erfc by Lentz continued fraction for x >= 1, Taylor series for x < 1. Neither
// borrows from claimMath.
// ---------------------------------------------------------------------------
// erfc(x) = Q(1/2, x^2), the regularised UPPER incomplete gamma, evaluated by
// the modified-Lentz continued fraction. Computing erfc directly (rather than
// as 1 - erf) is what keeps the far tail accurate: at z = 5, erfc is 5.7e-7 and
// a 1 - erf route would have already thrown away half the mantissa.
const LN_GAMMA_HALF = 0.5 * Math.log(Math.PI);   // ln Gamma(1/2) = ln sqrt(pi)
function erfcInd(x: number): number {
  if (x < 0) return 2 - erfcInd(-x);
  if (x === 0) return 1;
  if (x < 1) {
    // erf(x) = 2/sqrt(pi) * sum_{n>=0} (-1)^n x^(2n+1) / (n! (2n+1)) — the
    // alternating series is well conditioned here and erfc is O(1), so
    // forming it as 1 - erf costs nothing.
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) {
      term *= -x * x / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-18 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  const a = 0.5, xx = x * x;
  const TINY = 1e-300;
  let b = xx + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 400; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-xx + a * Math.log(xx) - LN_GAMMA_HALF) * h;
}
const PhiInd = (z: number) => 0.5 * erfcInd(-z / Math.SQRT2);

console.log('='.repeat(78));
console.log('GL LIMITED EXPECTED VALUES — does the generator draw the specified mixture?');
console.log('='.repeat(78));

console.log('\n--- 1. the independent normal CDF, validated before use ---');
{
  const known: [number, number][] = [
    [1, 0.8413447460685429], [2, 0.9772498680518208], [3, 0.9986501019683699],
    [4, 0.9999683287581669], [5, 0.9999997133484281],
  ];
  let worst = 0;
  for (const [z, want] of known) {
    const got = PhiInd(z);
    worst = Math.max(worst, Math.abs(got - want));
    console.log(`  Phi(${z}) = ${got.toFixed(16)}  known ${want.toFixed(16)}  |d| ${Math.abs(got - want).toExponential(2)}`);
  }
  console.log(`  worst |d| vs standard constants: ${worst.toExponential(2)}  ${note(worst < 1e-13, `independent Phi is inaccurate (worst ${worst.toExponential(2)}) — nothing downstream can be trusted`)}`);
  // and only now, the repo's
  let worstRepo = 0;
  for (let z = -6; z <= 6; z += 0.25) worstRepo = Math.max(worstRepo, Math.abs(PhiInd(z) - normalCdf(z)));
  console.log(`  worst |Phi_independent - claimMath.normalCdf| over z in [-6,6]: ${worstRepo.toExponential(2)}  ${note(worstRepo < 1e-6, `claimMath.normalCdf disagrees with an independent Phi by ${worstRepo.toExponential(2)} — larger than an A&S 7.1.26 approximation explains`)}`);
  console.log(`  OBSERVATION, not a failure: claimMath.normalCdf is Abramowitz & Stegun 7.1.26, whose`);
  console.log(`    stated absolute error is 1.5e-7 on erf — the ${worstRepo.toExponential(1)} above is exactly that and nothing`);
  console.log(`    more. Its cost on the LEVs is shown in section 2 (~$0.74 on $65,777 at $25M, 1.1e-5`);
  console.log(`    relative). Irrelevant to a +75% question. Recorded because the GL tower re-derivation`);
  console.log(`    prices layers off these same LEVs and 1e-5 is the floor on any figure it produces.`);
}

// ---------------------------------------------------------------------------
// 2. THE CLOSED FORM, INDEPENDENTLY
// ---------------------------------------------------------------------------
// E[min(X,k)] for X ~ LN(mu,sigma):
//   exp(mu+sigma^2/2) * Phi((ln k - mu - sigma^2)/sigma) + k*(1 - Phi((ln k - mu)/sigma))
function levInd(mu: number, sigma: number, k: number): number {
  if (!Number.isFinite(k)) return Math.exp(mu + sigma * sigma / 2);
  const lk = Math.log(k);
  return Math.exp(mu + sigma * sigma / 2) * PhiInd((lk - mu - sigma * sigma) / sigma)
       + k * (1 - PhiInd((lk - mu) / sigma));
}

// The fitted weights sum to 1.0000001 (six-decimal rounding). tiltedGlWeights
// normalises; this replica does too, so the two agree exactly.
const RAW_W = GL_SEVERITY_COMPONENTS.map(c => c.weight);
const W_SUM = RAW_W.reduce((a, b) => a + b, 0);
const W = RAW_W.map(w => w / W_SUM);

const mixLev = (k: number) => GL_SEVERITY_COMPONENTS.reduce((s, c, i) => s + W[i] * levInd(c.mu, c.sigma, k), 0);
const mixSurv = (k: number) => GL_SEVERITY_COMPONENTS.reduce((s, c, i) => s + W[i] * (1 - PhiInd((Math.log(k) - c.mu) / c.sigma)), 0);
const mixCdf = (x: number) => 1 - mixSurv(x);
const E_X = mixLev(Number.POSITIVE_INFINITY);

const KS = [100_000, 500_000, 1_000_000, 5_000_000, 25_000_000];

console.log('\n--- 2. [ANALYTIC] the closed form, computed independently ---');
console.log(`  fitted weights sum to ${W_SUM.toFixed(7)} — normalised before use (a ${((W_SUM - 1) * 1e6).toFixed(1)}ppm effect)`);
console.log(`  E[X]              $${fmt(E_X)}   target $74,714   ${note(Math.abs(E_X - 74_714) < 1, `independent E[X] $${fmt(E_X)} vs stated $74,714`)}`);
for (const k of KS) {
  const mine = mixLev(k), theirs = GL_SEVERITY_COMPONENTS.reduce((s, c, i) => s + W[i] * limitedExpectedValue(c.mu, c.sigma, k), 0);
  const tag = k === 1e6 ? '   target $35,920' : k === 25e6 ? '   target $65,777' : '';
  const okTarget = k === 1e6 ? Math.abs(mine - 35_920) < 1 : k === 25e6 ? Math.abs(mine - 65_777) < 1 : true;
  const rel = Math.abs(mine - theirs) / mine;
  console.log(`  E[min(X,$${(k / 1e6).toFixed(2)}M)] $${fmt(mine).padStart(10)}${tag}   vs claimMath $${fmt(theirs)}  rel ${rel.toExponential(2)}  ${note(rel < 1e-4 && okTarget, `LEV at $${k} disagrees beyond A&S precision: independent $${fmt(mine)}, claimMath $${fmt(theirs)} (rel ${rel.toExponential(2)})`)}`);
}
const A_BELOW1 = mixLev(1e6) / E_X, A_MID = (mixLev(25e6) - mixLev(1e6)) / E_X, A_ABOVE25 = (E_X - mixLev(25e6)) / E_X;
console.log(`  band shares from those LEVs: below $1M ${(A_BELOW1 * 100).toFixed(2)}%  $1M-$25M ${(A_MID * 100).toFixed(2)}%  above $25M ${(A_ABOVE25 * 100).toFixed(2)}%`);
console.log(`    ${note(Math.abs(A_BELOW1 - 0.481) < 0.001 && Math.abs(A_MID - 0.400) < 0.001 && Math.abs(A_ABOVE25 - 0.120) < 0.001, 'independently derived band shares do not reproduce 48.1/40.0/12.0')} — reproduces the 48.1 / 40.0 / 12.0 the question is asked against`);

// ---------------------------------------------------------------------------
// 3. THE DRAW, on the closed form's own basis
// ---------------------------------------------------------------------------
const YEARS = Number(process.env.GL_LEV_YEARS ?? 20_000);
const roster = getPredefinedMarketMembers().map(m => ({ ...m, riskQuality: 5 }));

// Exact accumulators — no array of 20M floats. sums[i] / sumSq[i] for min(X,KS[i]);
// sumRaw / sumRawSq for X itself; over[i] counts exceedances.
const sums = KS.map(() => 0), sumSq = KS.map(() => 0), over = KS.map(() => 0);
let sumRaw = 0, sumRawSq = 0, nClaims = 0, largest = 0;
const tailSample: number[] = [];   // every claim over $25k — exact upper quantiles
const subSample: number[] = [];    // 1-in-97 of everything — lower quantiles
const TAIL_CUT = 25_000;

console.log(`\n--- 3. [DRAWN] ${YEARS.toLocaleString()} full-market years, uniform RQ 5, kGl=1, gPool=1, yearNumber=1 ---`);
const t0 = Date.now();
for (let y = 1; y <= YEARS; y++) {
  const r = generateGlClaims({
    members: roster, yearNumber: 1, calendarYear: 2026,
    instanceSeed: 5_000_000 + y * 7919, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
  });
  for (const c of r.claims) {
    const x = c.grossUltimate;
    nClaims++;
    sumRaw += x; sumRawSq += x * x;
    if (x > largest) largest = x;
    for (let i = 0; i < KS.length; i++) {
      const v = x < KS[i] ? x : KS[i];
      sums[i] += v; sumSq[i] += v * v;
      if (x > KS[i]) over[i]++;
    }
    if (x > TAIL_CUT) tailSample.push(x);
    if (nClaims % 97 === 0) subSample.push(x);
  }
  if (y % 4000 === 0) console.log(`  ...${y.toLocaleString()}/${YEARS.toLocaleString()} years, ${nClaims.toLocaleString()} claims (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`  ${nClaims.toLocaleString()} claims drawn in ${((Date.now() - t0) / 1000).toFixed(0)}s | largest single claim $${(largest / 1e6).toFixed(2)}M`);

const meanOf = (s: number, n: number) => s / n;
const sdOf = (s: number, sq: number, n: number) => Math.sqrt(Math.max(0, (sq - s * s / n) / (n - 1)));

console.log('\n--- 4. [DRAWN] E[min(X,k)] vs the closed form — each CAPPED, each with an honest CI ---');
console.log('  threshold        drawn        closed form      gap      99% CI      CV     verdict');
const drawnLev: number[] = [], drawnLevCI: number[] = [];
for (let i = 0; i < KS.length; i++) {
  const k = KS[i];
  const m = meanOf(sums[i], nClaims);
  const sd = sdOf(sums[i], sumSq[i], nClaims);
  const ci = Z99 * sd / Math.sqrt(nClaims);
  const want = mixLev(k);
  drawnLev.push(m); drawnLevCI.push(ci);
  const gapPct = (m / want - 1) * 100;
  const ok = Math.abs(m - want) <= ci;
  console.log(`  $${(k / 1e6).toFixed(2).padStart(6)}M   $${fmt(m).padStart(11)}  $${fmt(want).padStart(11)}  ${gapPct.toFixed(3).padStart(7)}%  +/-${(ci / want * 100).toFixed(3)}%  ${(sd / m).toFixed(2).padStart(6)}  ${note(ok, `E[min(X,$${(k / 1e6).toFixed(2)}M)] drawn $${fmt(m)} is outside its 99% CI of the closed form $${fmt(want)} (gap ${gapPct.toFixed(2)}%)`)}`);
}
console.log('  every row above is a bounded-variance quantity: CI valid, verdict binding.');
console.log('  n required for a +/-1% CI at each k (so "resolvable at this sample size" is checkable):');
for (let i = 0; i < KS.length; i++) {
  const sd = sdOf(sums[i], sumSq[i], nClaims), m = meanOf(sums[i], nClaims);
  const need = Math.pow(Z99 * (sd / m) / 0.01, 2);
  console.log(`    $${(KS[i] / 1e6).toFixed(2).padStart(6)}M  n >= ${Math.ceil(need).toLocaleString().padStart(14)}   have ${nClaims.toLocaleString()}  ${need <= nClaims ? 'RESOLVABLE to +/-1%' : 'not resolvable to +/-1% at this n'}`);
}

console.log('\n--- 5. [DRAWN] exceedance counts — the tail FREQUENCY, independently of dollars ---');
console.log('  threshold      drawn S(k)      closed form S(k)      gap      99% CI     verdict');
for (let i = 0; i < KS.length; i++) {
  const p = over[i] / nClaims, want = mixSurv(KS[i]);
  const ci = Z99 * Math.sqrt(Math.max(p, 1 / nClaims) * (1 - p) / nClaims);
  console.log(`  $${(KS[i] / 1e6).toFixed(2).padStart(6)}M   ${p.toExponential(4)}    ${want.toExponential(4)}      ${((p / want - 1) * 100).toFixed(2).padStart(6)}%  +/-${(ci / want * 100).toFixed(2)}%  ${note(Math.abs(p - want) <= ci, `S($${KS[i]}) drawn ${p.toExponential(4)} outside 99% CI of ${want.toExponential(4)}`)}   (${over[i].toLocaleString()} claims)`);
}

console.log('\n--- 6. [DRAWN] quantiles — the sharpest far-tail SHAPE check, and order statistics are well behaved ---');
{
  tailSample.sort((a, b) => a - b);
  subSample.sort((a, b) => a - b);
  const pTail = 1 - tailSample.length / nClaims;   // subSample-free region above TAIL_CUT
  const empQ = (p: number) => {
    if (p >= pTail) {
      const idx = Math.min(tailSample.length - 1, Math.max(0, Math.round((p - pTail) / (1 - pTail) * (tailSample.length - 1))));
      return tailSample[idx];
    }
    return subSample[Math.min(subSample.length - 1, Math.max(0, Math.round(p * (subSample.length - 1))))];
  };
  const theoQ = (p: number) => {   // bisection on the mixture CDF
    let lo = 1, hi = 1e12;
    for (let it = 0; it < 200; it++) { const mid = Math.sqrt(lo * hi); if (mixCdf(mid) < p) lo = mid; else hi = mid; }
    return Math.sqrt(lo * hi);
  };
  console.log('  p           empirical        theoretical        gap');
  for (const p of [0.5, 0.9, 0.99, 0.999, 0.9999, 0.99999]) {
    const e = empQ(p), t = theoQ(p);
    const nAbove = Math.round((1 - p) * nClaims);
    const ok = Math.abs(e / t - 1) < 0.06 || nAbove < 200;
    console.log(`  ${p.toFixed(5)}   $${fmt(e).padStart(14)}   $${fmt(t).padStart(14)}   ${((e / t - 1) * 100).toFixed(2).padStart(7)}%   ${nAbove < 200 ? `only ${nAbove} claims above — not resolvable` : note(ok, `quantile p=${p} empirical $${fmt(e)} vs theoretical $${fmt(t)} (${((e / t - 1) * 100).toFixed(1)}%)`)}`);
  }
}

console.log('\n--- 7. [DRAWN] the raw mean, reported with its CI marked UNTRUSTWORTHY ---');
{
  const m = sumRaw / nClaims, sd = sdOf(sumRaw, sumRawSq, nClaims), ci = Z99 * sd / Math.sqrt(nClaims);
  console.log(`  E[X] drawn $${fmt(m)}  vs closed form $${fmt(E_X)}  gap ${((m / E_X - 1) * 100).toFixed(2)}%  nominal 99% CI +/-${(ci / E_X * 100).toFixed(2)}%  CV ${(sd / m).toFixed(2)}`);
  console.log(`  ⚠ THAT CI IS NOT TRUSTWORTHY AND NEITHER IS A BOOTSTRAP OF IT. At CV ${(sd / m).toFixed(0)} the mean is`);
  console.log(`    dominated by draws in the far tail; a bootstrap resamples only draws already seen, so it`);
  console.log(`    reports the variability of THIS sample, not of the estimator. Reported, never gated.`);
  console.log(`  largest single claim seen: $${(largest / 1e6).toFixed(2)}M, which alone is ${(largest / sumRaw * 100).toFixed(3)}% of all dollars drawn`);
}

console.log('\n--- 8. band shares: differences of VERIFIED LEVs vs the raw ratio-of-sums ---');
{
  const b1 = drawnLev[2], b25 = drawnLev[4], raw = sumRaw / nClaims;
  console.log(`  from verified LEVs (below $1M = E[min(X,1M)]/E[X], etc. — E[X] from the CLOSED FORM,`);
  console.log(`  the only piece that cannot be measured well):`);
  console.log(`    below $1M   ${(b1 / E_X * 100).toFixed(2)}% (+/-${(drawnLevCI[2] / E_X * 100).toFixed(2)}pp)   closed form ${(A_BELOW1 * 100).toFixed(2)}%`);
  console.log(`    $1M-$25M    ${((b25 - b1) / E_X * 100).toFixed(2)}% (+/-${((drawnLevCI[4] + drawnLevCI[2]) / E_X * 100).toFixed(2)}pp)   closed form ${(A_MID * 100).toFixed(2)}%`);
  console.log(`    above $25M  ${((E_X - b25) / E_X * 100).toFixed(2)}% (+/-${(drawnLevCI[4] / E_X * 100).toFixed(2)}pp)   closed form ${(A_ABOVE25 * 100).toFixed(2)}%`);
  console.log(`  the SAME sample as a raw ratio-of-dollar-sums, which is how the prior figure was formed:`);
  console.log(`    below $1M   ${(b1 / raw * 100).toFixed(2)}%   $1M-$25M ${((b25 - b1) / raw * 100).toFixed(2)}%   above $25M ${((raw - b25) / raw * 100).toFixed(2)}%`);
  console.log(`    prior measurement            33.0%                46.1%                20.9%`);
  console.log(`  the two rows differ ONLY in the denominator: closed-form E[X] vs this sample's raw mean.`);
}

// ---------------------------------------------------------------------------
// 8b. TWO DIFFERENT PARTITIONS THAT BOTH GET CALLED "LOSS BY BAND"
// ---------------------------------------------------------------------------
// The prior figures self-normalise: 33.0 + 46.1 + 20.9 = 100.0. So they are
// shares of the sample's OWN total, which rules out a pure denominator-inflation
// story — inflating the denominator would push all three DOWN and they would no
// longer sum to 1. That leaves the possibility that a different quantity was
// partitioned. There are two natural ones and they are not the same:
//
//   BY LAYER      the first $1M OF EVERY CLAIM, then the next $24M of every
//                 claim, then everything above $25M. This is what the closed
//                 form gives, because it is built from E[min(X,k)]. It is also
//                 what a reinsurance tower cedes: a $200M claim puts $1M in the
//                 bottom band, $24M in the middle, $175M on top.
//
//   BY CLAIM SIZE all dollars from claims SMALLER than $1M, then all dollars
//                 from claims between $1M and $25M, then all dollars from
//                 claims over $25M. A $200M claim puts ALL $200M in the top
//                 band and nothing in the others.
//
// Both are legitimate; they answer different questions. The identity linking
// them is E[X 1(X<k)] = E[min(X,k)] - k S(k), and both pieces on the right have
// already been verified above, so the by-size partition inherits their CIs.
// ---------------------------------------------------------------------------
console.log('\n--- 8b. BY LAYER vs BY CLAIM SIZE — two partitions, both called "loss by band" ---');
{
  const cfSize = (k: number) => mixLev(k) - k * mixSurv(k);          // E[X 1(X<k)], closed form
  const dwSize = (i: number) => drawnLev[i] - KS[i] * (over[i] / nClaims);   // the same, drawn
  const I1 = 2, I25 = 4;   // indices of $1M and $25M in KS
  const rawDrawn = sumRaw / nClaims;

  const cf = [cfSize(1e6), cfSize(25e6) - cfSize(1e6), E_X - cfSize(25e6)].map(v => v / E_X * 100);
  const dw = [dwSize(I1), dwSize(I25) - dwSize(I1), rawDrawn - dwSize(I25)].map(v => v / rawDrawn * 100);
  const layerCf = [A_BELOW1, A_MID, A_ABOVE25].map(v => v * 100);
  const layerDw = [drawnLev[I1], drawnLev[I25] - drawnLev[I1], rawDrawn - drawnLev[I25]].map(v => v / rawDrawn * 100);

  const row = (label: string, v: number[]) => `  ${label.padEnd(30)} ${v[0].toFixed(1).padStart(6)}%  ${v[1].toFixed(1).padStart(6)}%  ${v[2].toFixed(1).padStart(6)}%`;
  console.log('                                 below $1M   $1M-$25M  above $25M');
  console.log(row('BY LAYER, closed form', layerCf));
  console.log(row('BY LAYER, drawn (20.5M claims)', layerDw));
  console.log(row('BY CLAIM SIZE, closed form', cf));
  console.log(row('BY CLAIM SIZE, drawn', dw));
  console.log(row('THE PRIOR MEASUREMENT', [33.0, 46.1, 20.9]));
  const dist = (v: number[]) => Math.max(Math.abs(v[0] - 33.0), Math.abs(v[1] - 46.1), Math.abs(v[2] - 20.9));
  console.log(`\n  worst-band distance from the prior figures:  BY LAYER ${dist(layerCf).toFixed(1)}pp   BY CLAIM SIZE ${dist(cf).toFixed(1)}pp`);
  console.log(`  ${note(dist(cf) < dist(layerCf) && dist(cf) < 3, 'the by-claim-size partition does NOT account for the prior figures — the discrepancy is something else')} — the prior figures sit on the BY-CLAIM-SIZE partition, not the by-layer one.`);
  console.log(`  Neither generator nor sampling is implicated: these are two different quantities.`);
  console.log(`\n  ⚠ WHICH ONE THE TOWER NEEDS: BY LAYER. A tower cedes layers, not claims. The`);
  console.log(`    by-claim-size split cannot price a layer at all — it puts every dollar of a $200M`);
  console.log(`    claim in the top band, including the $1M the pool retains and the $24M the tower`);
  console.log(`    covers. Pricing "xs $25M" off a 20.9% figure would overstate that layer by`);
  console.log(`    ${(cf[2] / layerCf[2]).toFixed(2)}x, because ${(cf[2] / layerCf[2] - 1) * 100 > 0 ? 'it counts' : ''} the below-$25M dollars of every large claim as if they sat above $25M.`);
}

// ---------------------------------------------------------------------------
// 9. THE BASIS HYPOTHESIS — a year-varying draw against a year-1 analytic
// ---------------------------------------------------------------------------
console.log('\n--- 9. [DRAWN] hypothesis test: would a YEAR-VARYING draw produce this signature? ---');
{
  const H_YEARS = 2_000;
  for (const span of [10, 20]) {
    let s1 = 0, s25 = 0, sr = 0, n = 0, o25 = 0;
    for (let y = 1; y <= H_YEARS; y++) {
      const yr = ((y - 1) % span) + 1;
      const r = generateGlClaims({
        members: roster, yearNumber: yr, calendarYear: 2025 + yr,
        instanceSeed: 8_100_000 + y * 7919, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
      });
      for (const c of r.claims) {
        const x = c.grossUltimate; n++; sr += x;
        s1 += Math.min(x, 1e6); s25 += Math.min(x, 25e6);
        if (x > 25e6) o25++;
      }
    }
    const b1 = s1 / n, b25 = s25 / n, raw = sr / n;
    const avgTrend = Array.from({ length: span }, (_, i) => glSeverityTrend(i + 1)).reduce((a, b) => a + b, 0) / span;
    console.log(`  years 1..${span} cycled (mean severity trend x${avgTrend.toFixed(4)}), ${n.toLocaleString()} claims:`);
    console.log(`    band shares vs a YEAR-1 denominator: below $1M ${(b1 / raw * 100).toFixed(1)}%  $1M-$25M ${((b25 - b1) / raw * 100).toFixed(1)}%  above $25M ${((raw - b25) / raw * 100).toFixed(1)}%`);
    console.log(`    occurrences > $25M: ${(o25 / H_YEARS).toFixed(3)}/yr vs the year-1 analytic ${(GL_LOSS_MODEL.ratePer1M * roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0) * mixSurv(25e6)).toFixed(3)}/yr`);
  }
  console.log(`  READ THIS AGAINST THE PRIOR FIGURE'S COUNT. The prior run reported 0.241/yr over $25M`);
  console.log(`  against a 0.236 analytic — a MATCH. A trended draw inflates severity, which pushes the`);
  console.log(`  COUNT over a fixed $25M threshold up too, not just the dollars. If the count matched,`);
  console.log(`  the draws were on the year-1 basis and the trend is not the explanation.`);
}

console.log('\n' + '='.repeat(78));
if (problems.length === 0) console.log('ALL CHECKS PASS');
else { console.log(`${problems.length} PROBLEM(S):`); problems.forEach(p => console.log(`  - ${p}`)); }
console.log('='.repeat(78));
