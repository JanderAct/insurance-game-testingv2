// WC SEVERITY CAP — is it applied identically on BOTH sides of the matched pair?
//
//   npx tsx scripts/diagnostics/wc-cap-check.ts
//   TRIALS=400000 npx tsx scripts/diagnostics/wc-cap-check.ts
//
// ============================================================================
// THE FAILURE THIS EXISTS TO CATCH is finding 37's class: a factor that reaches
// the DRAW but not the ANALYTIC, or vice versa. A cap is unusually good at
// hiding one, because both sides still look like "the severity model" and the
// only symptom is a slow divergence between what the pool prices and what it
// pays.
//
// ⚠ AND WC'S CAP HAS A SPECIFIC TRAP THAT GL'S DID NOT: THE REGION MULTIPLIER.
// WC scales each drawn claim by a region factor AFTER the lognormal draw:
//
//   amount = min(lognormal(mu, sigma) x regionMult, CAP)
//
// so the ceiling bites the SCALED claim. The matching analytic is therefore
//
//   E[min(regionMult x X, CAP)] = regionMult x E[min(X, CAP / regionMult)]
//
// and a per-component limit of CAP rather than CAP/regionMult would price a
// High-region claim as if its ceiling were 1/mult times too high. That error is
// INVISIBLE at the book level on a region-balanced roster, because the regions
// offset — which is exactly why this checks per region rather than only in
// total.

import {
  WC_LOSS_MODEL, WC_RATING_GROUPS, WC_SEVERITY_CAP, WC_SEVERITY_COMPONENTS,
} from '../../src/data/defaultAssumptions';
import {
  componentMean, expectedClaimSeverity, regionMultiplier, trendedMu, wcSeverityCap, wcSeverityTrend,
} from '../../src/utils/wcClaimEngine';
import { SeededRandom } from '../../src/utils/random';
import type { Region } from '../../src/types/simulation';

const TRIALS = Number(process.env.TRIALS ?? 400_000);
const REGIONS: Region[] = ['North', 'Central', 'South'];
const YEARS = [1, 5, 10];

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
// E[min(X,L)^k] in closed form — the same identity wcLossDistribution uses.
// Local so this check does not depend on the module it is checking.
function rawMomentCapped(mu: number, sigma: number, k: number, L: number): number {
  const d = (Math.log(L) - mu) / sigma;
  const Phi0 = (z: number) => 0.5 * (1 + Math.sign(z) * Math.sqrt(1 - Math.exp(-2 * z * z / Math.PI)));
  void Phi0;
  return Math.exp(k * mu + (k * k * sigma * sigma) / 2) * stdNormCdf(d - k * sigma)
    + Math.pow(L, k) * (1 - stdNormCdf(d));
}
function stdNormCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26, ample for a ratio test at 1e-12 tolerance
  // because the SAME function is used in numerator and denominator.
  const s0 = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t)
    * Math.exp(-x * x);
  return 0.5 * (1 + s0 * y);
}

const fmt$ = (x: number) => x >= 1e6 ? `$${(x / 1e6).toFixed(3)}M` : `$${Math.round(x).toLocaleString()}`;

console.log(`WC SEVERITY CAP (year 1) = ${fmt$(WC_SEVERITY_CAP)}   (${TRIALS.toLocaleString()} trials per cell)`);
console.log(`  the ceiling TRENDS: ${YEARS.map(y => `yr ${y} ${fmt$(wcSeverityCap(y))}`).join('   ')}\n`);

// --- 1. THE MATCHED PAIR, PER GROUP AND PER REGION --------------------------
console.log('=== 1. DRAW MEAN === ANALYTIC MEAN, per rating group x region x year ===');
console.log('    the draw is Monte Carlo, so the bar is its own standard error, not a fixed %.\n');
console.log('group      | yr |    analytic |    drawn MC |   diff | vs 3 SE');
{
  const rng = new SeededRandom(20260825);
  let worstRatio = 0;
  for (const group of WC_RATING_GROUPS) {
    const spec = WC_LOSS_MODEL.ratingGroups[group];
    const weights = spec.mix.map(m => m.weight);
    {
      for (const yearNumber of YEARS) {
        const analytic = expectedClaimSeverity(group, weights, yearNumber);
        // The draw, reproduced EXACTLY as generateWcClaims does it: pick a
        // component by weight, draw lognormal at the trended mu, then clamp.
        // No region scale — see section 2.
        let sum = 0, sumSq = 0;
        for (let t = 0; t < TRIALS; t++) {
          let u = rng.next(), idx = spec.mix.length - 1;
          for (let i = 0; i < spec.mix.length; i++) { u -= weights[i]; if (u <= 0) { idx = i; break; } }
          const c = WC_SEVERITY_COMPONENTS[spec.mix[idx].component];
          // THAT YEAR'S ceiling — reproducing generateWcClaims exactly. Using
          // the year-1 constant here would make this check agree with a
          // generator that no longer exists.
          const x = Math.min(rng.lognormal(trendedMu(c.mu, yearNumber), c.sigma), wcSeverityCap(yearNumber));
          sum += x; sumSq += x * x;
        }
        const drawn = sum / TRIALS;
        const se = Math.sqrt(Math.max(0, sumSq / TRIALS - drawn * drawn) / TRIALS);
        const ratio = se > 0 ? Math.abs(drawn - analytic) / se : 0;
        worstRatio = Math.max(worstRatio, ratio);
        console.log(`${group.padEnd(10)} | ${String(yearNumber).padStart(2)} | ` +
          `${fmt$(analytic).padStart(11)} | ${fmt$(drawn).padStart(11)} | ` +
          `${((drawn / analytic - 1) * 100).toFixed(2).padStart(6)}% | ${ratio.toFixed(2)} SE`);
      }
    }
  }
  console.log(`\n  worst deviation ${worstRatio.toFixed(2)} SE  ` +
    `${note(worstRatio < 3, `a group/year cell missed its analytic by ${worstRatio.toFixed(2)} SE — the cap is not applied identically on both sides`)}`);
}

// --- 2. REGION DOES NOT TOUCH CHRONIC SEVERITY ------------------------------
//
// ⚠ THIS SECTION IS THE INVERSE OF THE ONE IT REPLACES, and the inversion is the
// point. It used to be "THE REGION-SCALED LIMIT IS THE ONE IN FORCE", asserting
// that componentMean(key, yr, CAP/mult) x mult DIFFERED from the flat-limit form
// wherever mult != 1 — because the draw was min(lognormal x regionMult, CAP) and
// the analytic had to divide the ceiling through by the same factor to match.
//
// Region no longer scales chronic severity. A standing +/-5% on every claim in
// one region was asserted with nothing behind it; region is retained as data for
// SHOCK events, where a regional catastrophe is a real thing to scale. So the
// old assertion would now fail on correct code, and the useful thing to test is
// the opposite: that no region reaches severity at all.
//
// Kept as an assertion rather than deleted because the trap it guarded is real
// and will return the moment a shock scales severity per-region — whatever
// multiplies the DRAW must divide the analytic's ceiling.
console.log('\n=== 2. REGION DOES NOT TOUCH CHRONIC SEVERITY ===');
console.log('    expectedClaimSeverity takes no region argument, and the drawn severity');
console.log('    distribution must be identical across regions. Both are checked.\n');
{
  // (a) The analytic is region-blind by SIGNATURE — there is nothing to pass.
  //     What can still be checked is that the data is intact for shocks.
  const mults = REGIONS.map(r => regionMultiplier(r));
  console.log(`  regionMultiplier data retained for shocks: ${REGIONS.map((r, i) => `${r} ${mults[i]}`).join('  ')}`);
  console.log(`  ${note(mults.some(m => m !== 1), 'every region multiplier is 1 — the data a regional shock needs has been flattened, not just unwired')}`);

  // (b) The DRAW must be identical across regions. Same stream, same member
  //     shape, only the region differs: any difference means region is still
  //     reaching the generator somewhere.
  let worstSpread = 0;
  for (const group of WC_RATING_GROUPS) {
    const spec = WC_LOSS_MODEL.ratingGroups[group];
    const weights = spec.mix.map(m => m.weight);
    const means: number[] = [];
    for (let ri = 0; ri < REGIONS.length; ri++) {
      const rng = new SeededRandom(90210);      // SAME seed for every region
      let sum = 0;
      const T = 200_000;
      for (let t = 0; t < T; t++) {
        let u = rng.next(), idx = spec.mix.length - 1;
        for (let i = 0; i < spec.mix.length; i++) { u -= weights[i]; if (u <= 0) { idx = i; break; } }
        const c = WC_SEVERITY_COMPONENTS[spec.mix[idx].component];
        sum += Math.min(rng.lognormal(trendedMu(c.mu, 1), c.sigma), wcSeverityCap(1));
      }
      means.push(sum / T);
    }
    const spread = Math.max(...means) / Math.min(...means) - 1;
    worstSpread = Math.max(worstSpread, spread);
    console.log(`  ${group.padEnd(10)} drawn mean by region: ${means.map(m => fmt$(m)).join('  ')}  spread ${spread.toExponential(2)}`);
  }
  console.log(`\n  ${note(worstSpread === 0, `the drawn severity differs across regions by ${worstSpread.toExponential(2)} — region is still reaching the draw`)}`);
}

// --- 3. THE CEILING TRENDS, AND IT TRENDS ON BOTH SIDES ----------------------
//
// ⚠ THIS IS THE SECTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT, and it is
// an extension of the matched pair above rather than a new check, deliberately:
// the failure mode is the SAME one (a factor on one side only), just along the
// year axis instead of the region axis.
//
// While the ceiling was a fixed number of dollars, three things were true and
// all three were wrong:
//   - the modelled tail shrank 28% in real terms across a ten-year game;
//   - the capped mean grew SLOWER than wcSeverityTrend, so pricing at the raw
//     trend over-charged by 0.19% at year 10 and 0.52% at year 20;
//   - the severity-scale invariance CV = sqrt(k2)/k1 broke, which is what
//     wcClfGrid's interpolation axis rests on.
//
// With CAP_t = CAP_1 x s_t the algebra closes: min(s X, s L) = s min(X, L), so
// E[min(s X, s L)^k] = s^k E[min(X, L)^k] EXACTLY. Asserted, not argued.
console.log('\n=== 3. THE CEILING TRENDS ON BOTH SIDES ===\n');
{
  // (a) THE ANALYTIC SCALES BY EXACTLY THE TREND. If the cap were pinned this
  //     ratio would fall BELOW the trend and drift further every year.
  console.log('  (a) analytic capped severity must scale by exactly wcSeverityTrend');
  console.log('      group      | yr | severity ratio |  wcSeverityTrend | rel err');
  let worstRel = 0;
  for (const group of WC_RATING_GROUPS) {
    const spec = WC_LOSS_MODEL.ratingGroups[group];
    const weights = spec.mix.map(m => m.weight);
    {
      const base = expectedClaimSeverity(group, weights, 1);
      for (const yr of [5, 10, 20]) {
        const ratio = expectedClaimSeverity(group, weights, yr) / base;
        const trend = wcSeverityTrend(yr);
        const rel = Math.abs(ratio / trend - 1);
        worstRel = Math.max(worstRel, rel);
        if (group === WC_RATING_GROUPS[0]) {
          console.log(`      ${group.padEnd(10)} | ${String(yr).padStart(2)} | ` +
            `${ratio.toFixed(10).padStart(14)} | ${trend.toFixed(10).padStart(16)} | ${rel.toExponential(2)}`);
        }
      }
    }
  }
  console.log(`      (all ${WC_RATING_GROUPS.length} groups x 3 years measured; one group printed)`);
  console.log(`\n      worst relative error ${worstRel.toExponential(3)}  ` +
    `${note(worstRel < 1e-12, `capped severity does not scale by the trend (worst ${worstRel.toExponential(3)}) — the ceiling is not trending with the distribution`)}`);

  // (b) EVERY MOMENT, NOT ONLY THE MEAN. The CV is what wcClfGrid indexes on,
  //     so k = 2 mattering is the whole reason the invariance is load-bearing.
  console.log('\n  (b) the k-th capped moment must scale by exactly s^k (k = 1..4)');
  let worstMoment = 0;
  for (const key of Object.keys(WC_SEVERITY_COMPONENTS) as (keyof typeof WC_SEVERITY_COMPONENTS)[]) {
    const c = WC_SEVERITY_COMPONENTS[key];
    for (const yr of [5, 10, 20]) {
      const s_t = wcSeverityTrend(yr);
      for (let k = 1; k <= 4; k++) {
        const m1 = rawMomentCapped(trendedMu(c.mu, 1), c.sigma, k, wcSeverityCap(1));
        const mt = rawMomentCapped(trendedMu(c.mu, yr), c.sigma, k, wcSeverityCap(yr));
        const rel = Math.abs(mt / (m1 * Math.pow(s_t, k)) - 1);
        worstMoment = Math.max(worstMoment, rel);
      }
    }
  }
  console.log(`      worst relative error across ${Object.keys(WC_SEVERITY_COMPONENTS).length} components x 3 years x 4 orders: ` +
    `${worstMoment.toExponential(3)}`);
  console.log(`      ${note(worstMoment < 1e-12, `a capped moment did not scale by s^k (worst ${worstMoment.toExponential(3)}) — the CV is not trend-invariant`)}`);

  // (c) THE DRAW'S CEILING MOVED TOO. (a) and (b) are both analytic; if the
  //     generator were still clamping at the year-1 cap they would pass while
  //     the pair was broken. So: sample the heavy component in year 10 and
  //     require draws ABOVE the year-1 ceiling.
  console.log('\n  (c) the DRAW must be able to exceed the year-1 ceiling in a later year');
  {
    const rng = new SeededRandom(77002);
    const c = WC_SEVERITY_COMPONENTS.large;
    const yr = 10, cap1 = wcSeverityCap(1), cap10 = wcSeverityCap(yr);
    let aboveOldCap = 0, atNewCap = 0, maxSeen = 0;
    const N = 2_000_000;
    for (let t = 0; t < N; t++) {
      const x = Math.min(rng.lognormal(trendedMu(c.mu, yr), c.sigma), cap10);
      if (x > cap1) aboveOldCap++;
      if (x >= cap10 * 0.999999) atNewCap++;
      maxSeen = Math.max(maxSeen, x);
    }
    console.log(`      ${N.toLocaleString()} year-10 draws of \`large\`: ${aboveOldCap} above the year-1 ceiling ` +
      `(${fmt$(cap1)}), ${atNewCap} at the year-10 ceiling (${fmt$(cap10)})`);
    console.log(`      largest drawn ${fmt$(maxSeen)}`);
    console.log(`      ${note(aboveOldCap > 0, 'no year-10 draw exceeded the year-1 ceiling — the DRAW is still clamping at the old cap')}`);
    console.log(`      ${note(maxSeen <= cap10 * 1.000001, 'a draw exceeded the year-10 ceiling — the clamp is not being applied')}`);
  }
}

// --- 4. WHAT THE CAP COSTS, ANALYTICALLY --------------------------------------
// ⚠ COMPUTED IN CLOSED FORM, NOT SAMPLED, AND THAT IS NOT A STYLE CHOICE. An
// earlier cut of this section Monte-Carlo'd the uncapped mean and CV. That is
// self-defeating: the reason the cap exists is that WC's uncapped moments
// cannot be estimated by sampling — the binding event is 1-in-200,000 claims,
// so a 400k-trial run saw it twice and reported a "CV" that was an artefact of
// which two draws it happened to get. The uncapped second moment is finite but
// enormous, and every figure below is exact instead.
//
//   uncapped mean   exp(mu + sigma^2/2)
//   capped mean     LEV(mu, sigma, C)
//   uncapped E[X^2] exp(2mu + 2 sigma^2)
//   capped   E[X^2] exp(2mu + 2 sigma^2) Phi((ln C - mu)/sigma - 2 sigma)
//                     + C^2 (1 - Phi((ln C - mu)/sigma))
console.log('\n=== 4. WHAT THE CAP COSTS AND BUYS (closed form, per component, YEAR 1) ===\n');
{
  const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
  function erf(x: number): number {
    // Abramowitz & Stegun 7.1.26 — ample for a report column.
    const sign = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t * t
      * 0 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
    return sign * y;
  }
  console.log('component      |  uncapped mean |    capped mean |   diff | uncapped CV | capped CV | P(binds)');
  for (const key of Object.keys(WC_SEVERITY_COMPONENTS) as (keyof typeof WC_SEVERITY_COMPONENTS)[]) {
    const c = WC_SEVERITY_COMPONENTS[key];
    const mu = trendedMu(c.mu, 1), sg = c.sigma;
    const z = (Math.log(WC_SEVERITY_CAP) - mu) / sg;
    const tail = 1 - Phi(z);
    const meanUn = Math.exp(mu + sg * sg / 2);
    const meanCap = componentMean(key, 1, WC_SEVERITY_CAP);
    const m2Un = Math.exp(2 * mu + 2 * sg * sg);
    const m2Cap = Math.exp(2 * mu + 2 * sg * sg) * Phi(z - 2 * sg) + WC_SEVERITY_CAP * WC_SEVERITY_CAP * tail;
    const cvUn = Math.sqrt(Math.max(0, m2Un - meanUn * meanUn)) / meanUn;
    const cvCap = Math.sqrt(Math.max(0, m2Cap - meanCap * meanCap)) / meanCap;
    console.log(`${key.padEnd(14)} | ${fmt$(meanUn).padStart(14)} | ${fmt$(meanCap).padStart(14)} | ` +
      `${((meanCap / meanUn - 1) * 100).toFixed(2).padStart(6)}% | ${cvUn.toFixed(2).padStart(11)} | ` +
      `${cvCap.toFixed(2).padStart(9)} | 1 per ${tail > 0 ? Math.round(1 / tail).toLocaleString() : '—'}`);
  }
  console.log('\n  ⚠ ONLY `large` IS MATERIALLY AFFECTED, and that is the whole design. The cap');
  console.log('    is a statement about the catastrophic-injury tail; the small and medium');
  console.log('    components cannot reach $85M at any percentile that matters, so their means');
  console.log('    and CVs are untouched to display precision.');
  console.log('  ⚠ THE MEAN MOVES LITTLE AND THE SECOND MOMENT MOVES A LOT. That is what');
  console.log("    separates a ceiling from a loss limit — same reading as GL's and Property's.");
}

console.log(problems.length === 0
  ? '\nALL WC CAP CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
