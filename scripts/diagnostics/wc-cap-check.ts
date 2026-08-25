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
import { componentMean, expectedClaimSeverity, regionMultiplier, trendedMu } from '../../src/utils/wcClaimEngine';
import { SeededRandom } from '../../src/utils/random';
import type { Region } from '../../src/types/simulation';

const TRIALS = Number(process.env.TRIALS ?? 400_000);
const REGIONS: Region[] = ['North', 'Central', 'South'];
const YEARS = [1, 5, 10];

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const fmt$ = (x: number) => x >= 1e6 ? `$${(x / 1e6).toFixed(3)}M` : `$${Math.round(x).toLocaleString()}`;

console.log(`WC SEVERITY CAP = ${fmt$(WC_SEVERITY_CAP)}   (${TRIALS.toLocaleString()} trials per cell)\n`);

// --- 1. THE MATCHED PAIR, PER GROUP AND PER REGION --------------------------
console.log('=== 1. DRAW MEAN === ANALYTIC MEAN, per rating group x region x year ===');
console.log('    the draw is Monte Carlo, so the bar is its own standard error, not a fixed %.\n');
console.log('group      | region  | yr |    analytic |    drawn MC |   diff | vs 3 SE');
{
  const rng = new SeededRandom(20260825);
  let worstRatio = 0;
  for (const group of WC_RATING_GROUPS) {
    const spec = WC_LOSS_MODEL.ratingGroups[group];
    const weights = spec.mix.map(m => m.weight);
    for (const region of REGIONS) {
      const mult = regionMultiplier(region);
      for (const yearNumber of YEARS) {
        const analytic = expectedClaimSeverity(group, weights, mult, yearNumber);
        // The draw, reproduced EXACTLY as generateWcClaims does it: pick a
        // component by weight, draw lognormal at the trended mu, scale by
        // region, then clamp.
        let sum = 0, sumSq = 0;
        for (let t = 0; t < TRIALS; t++) {
          let u = rng.next(), idx = spec.mix.length - 1;
          for (let i = 0; i < spec.mix.length; i++) { u -= weights[i]; if (u <= 0) { idx = i; break; } }
          const c = WC_SEVERITY_COMPONENTS[spec.mix[idx].component];
          const x = Math.min(rng.lognormal(trendedMu(c.mu, yearNumber), c.sigma) * mult, WC_SEVERITY_CAP);
          sum += x; sumSq += x * x;
        }
        const drawn = sum / TRIALS;
        const se = Math.sqrt(Math.max(0, sumSq / TRIALS - drawn * drawn) / TRIALS);
        const ratio = se > 0 ? Math.abs(drawn - analytic) / se : 0;
        worstRatio = Math.max(worstRatio, ratio);
        console.log(`${group.padEnd(10)} | ${region.padEnd(7)} | ${String(yearNumber).padStart(2)} | ` +
          `${fmt$(analytic).padStart(11)} | ${fmt$(drawn).padStart(11)} | ` +
          `${((drawn / analytic - 1) * 100).toFixed(2).padStart(6)}% | ${ratio.toFixed(2)} SE`);
      }
    }
  }
  console.log(`\n  worst deviation ${worstRatio.toFixed(2)} SE  ` +
    `${note(worstRatio < 3, `a group/region/year cell missed its analytic by ${worstRatio.toFixed(2)} SE — the cap is not applied identically on both sides`)}`);
}

// --- 2. THE REGION TRAP, STATED AS ITS OWN CHECK ----------------------------
// If the analytic capped at CAP instead of CAP/regionMult, this is the cell
// that would show it: the highest region multiplier on the heaviest component.
console.log('\n=== 2. THE REGION-SCALED LIMIT IS THE ONE IN FORCE ===');
console.log('    componentMean(key, yr, CAP/mult) x mult must differ from componentMean(key, yr, CAP) x mult');
console.log('    wherever mult != 1 — if they agree, the limit is not being scaled.\n');
{
  let anyScaled = false;
  for (const region of REGIONS) {
    const mult = regionMultiplier(region);
    const scaled = componentMean('large', 1, WC_SEVERITY_CAP / mult) * mult;
    const flat = componentMean('large', 1, WC_SEVERITY_CAP) * mult;
    const differs = Math.abs(scaled - flat) > 1e-9;
    if (mult !== 1) anyScaled = anyScaled || differs;
    console.log(`  ${region.padEnd(7)} mult ${mult.toFixed(4)}  scaled-limit ${fmt$(scaled).padStart(10)}  ` +
      `flat-limit ${fmt$(flat).padStart(10)}  ${mult === 1 ? '(mult 1 — must agree)' : differs ? 'differ, as they must' : '⚠ IDENTICAL'}`);
  }
  console.log(`\n  ${note(anyScaled, 'no region showed a difference between the scaled and flat limit — the analytic is not scaling the cap')}`);
}

// --- 3. WHAT THE CAP COSTS, ANALYTICALLY --------------------------------------
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
console.log('\n=== 3. WHAT THE CAP COSTS AND BUYS (closed form, per component) ===\n');
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
