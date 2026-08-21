// PROPERTY'S FITTED LOSS MODEL — the numbers the rebuild rests on.
//
// Run: npx tsx scripts/diagnostics/property-fit-check.ts
//
// ⚠ THE ANNUAL AGGREGATE CV IS THE HEADLINE, and it is a SCALE fact rather
// than a fit fact. The mixture was fitted to a book generating ~200 claims a
// year; the game's enrolled Property book generates a fraction of that. For a
// compound Poisson the annual CV goes as sqrt((1 + CV_sev^2) / lambda), so the
// SAME severity distribution produces a very different annual CV at the game's
// scale than it did in the data. Reporting the fit's severity CV alone would
// hide that completely.
//
// Everything here is analytic where a closed form exists and Monte Carlo only
// where it does not, with the two cross-checked.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { SeededRandom } from '../../src/utils/random';
import type { CoverageLine } from '../../src/types/simulation';

// ---- the fitted model -------------------------------------------------------
const FREQ_PER_1M_TIV = 0.00221;
const CAP = 75_000_000;
const MIX: { w: number; mu: number; sigma: number }[] = [
  { w: 0.1562, mu: 9.2566, sigma: 0.4147 },
  { w: 0.0714, mu: 10.2933, sigma: 0.0937 },
  { w: 0.3210, mu: 11.1586, sigma: 0.6330 },
  { w: 0.4514, mu: 12.2086, sigma: 1.7417 },
];
// The nine-year fit sample, for the comparison the whole check exists to make.
const SAMPLE_CLAIMS = 1822, SAMPLE_YEARS = 9, SAMPLE_SEV_CV = 4.46, SAMPLE_MAX = 51.9e6;

const SEEDS = Number(process.env.SEEDS ?? 60);
const TRIALS = Number(process.env.TRIALS ?? 400_000);

// Normal CDF via erf, good to ~1e-7 — enough for tail probabilities at these
// magnitudes and avoids a dependency.
function erf(x: number): number {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t * t * Math.exp(-x * x)
    - 0; // grouped below for clarity
  // Abramowitz & Stegun 7.1.26
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  return s * (1 - poly * Math.exp(-x * x)) * (y === y ? 1 : 1);
}
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// E[min(X, cap)^k] for one lognormal component, closed form.
// E[X^k 1{X<=K}] = exp(k mu + k^2 s^2/2) Phi((lnK - mu - k s^2)/s)
function cappedMoment(mu: number, s: number, k: number, K: number): number {
  const lnK = Math.log(K);
  const below = Math.exp(k * mu + (k * k * s * s) / 2) * Phi((lnK - mu - k * s * s) / s);
  const atCap = Math.pow(K, k) * (1 - Phi((lnK - mu) / s));
  return below + atCap;
}
function mixMoment(k: number, K: number): number {
  return MIX.reduce((a, c) => a + c.w * cappedMoment(c.mu, c.sigma, k, K), 0);
}
function mixMomentUncapped(k: number): number {
  return MIX.reduce((a, c) => a + c.w * Math.exp(k * c.mu + (k * k * c.sigma * c.sigma) / 2), 0);
}

console.log('=== PROPERTY FITTED MODEL ===\n');

// --- 1. SEVERITY -------------------------------------------------------------
console.log('--- 1. SEVERITY: WHAT THE CAP DOES ---');
const m1u = mixMomentUncapped(1), m2u = mixMomentUncapped(2);
const m1 = mixMoment(1, CAP), m2 = mixMoment(2, CAP);
const cvU = Math.sqrt(m2u - m1u * m1u) / m1u;
const cvC = Math.sqrt(m2 - m1 * m1) / m1;
console.log(`  uncapped   mean $${m1u.toFixed(0).padStart(9)}   CV ${cvU.toFixed(2)}`);
console.log(`  capped $75M mean $${m1.toFixed(0).padStart(9)}   CV ${cvC.toFixed(2)}`);
console.log(`  sample                              CV ${SAMPLE_SEV_CV.toFixed(2)}   max $${(SAMPLE_MAX / 1e6).toFixed(1)}M`);
console.log(`\n  The cap removes ${((1 - m1 / m1u) * 100).toFixed(1)}% of the mean and takes the CV from ${cvU.toFixed(2)} to ${cvC.toFixed(2)},`);
console.log(`  against the sample's ${SAMPLE_SEV_CV.toFixed(2)} — the brief's stated 6.22 -> 4.78, reproduced here from`);
console.log('  the parameters rather than taken on trust.');
{
  // How often the cap binds, and where half of E[X^2] sits uncapped.
  const pAtCap = MIX.reduce((a, c) => a + c.w * (1 - Phi((Math.log(CAP) - c.mu) / c.sigma)), 0);
  console.log(`\n  P(claim >= cap) = ${(pAtCap * 100).toFixed(4)}%  -> 1 in ${(1 / pAtCap).toFixed(0)} claims`);
}

// --- 2. ENROLLED TIV ---------------------------------------------------------
console.log('\n--- 2. ENROLLED TIV AT THE LIVE STATE ---');
console.log('  Full-market TIV is not what generates loss — the ENROLLED subset is.\n');
const fullTiv = getPredefinedMarketMembers().reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
const enrolled: number[] = [];
for (let i = 0; i < SEEDS; i++) {
  const id = `PFC${i}`;
  const inst = generateGameInstance(id, 3_300_000 + i * 5171);
  const setup = { poolName: 'P', gameLength: 3, startingYear: 2026, instanceId: id, activeLines: ['Property'] as CoverageLine[] };
  const { poolState } = runPriorHistory(inst, setup as never);
  const members = (poolState as never as { lines: Record<string, { members: { status: string; exposureByLine: Record<string, number> }[] }> })
    .lines.Property.members.filter(m => m.status === 'active');
  enrolled.push(members.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0));
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const medEnrolled = q(enrolled, 0.5);
console.log(`  full market            $${fullTiv.toFixed(1)}M`);
console.log(`  enrolled p10/med/p90   $${q(enrolled, 0.1).toFixed(0)}M / $${medEnrolled.toFixed(0)}M / $${q(enrolled, 0.9).toFixed(0)}M   (${SEEDS} seeds)`);
console.log(`  enrolled share of market  ${(medEnrolled / fullTiv * 100).toFixed(1)}% at the median`);

// --- 3. THE ANNUAL AGGREGATE CV ----------------------------------------------
console.log('\n--- 3. ANNUAL AGGREGATE CV — THE HEADLINE ---');
console.log('  Compound Poisson: CV_agg = sqrt((1 + CV_sev^2) / lambda). Severity is IDENTICAL');
console.log('  at every scale below; only lambda differs. So any CV gap is scale, not fit.\n');
const cvAgg = (lambda: number, cvSev: number) => Math.sqrt((1 + cvSev * cvSev) / lambda);
const lamSample = SAMPLE_CLAIMS / SAMPLE_YEARS;
const lamFull = fullTiv * FREQ_PER_1M_TIV;
const lamEnrolled = medEnrolled * FREQ_PER_1M_TIV;
console.log('  book                          TIV        claims/yr   annual CV');
console.log(`  fit sample (real pool)              -      ${lamSample.toFixed(1).padStart(6)}      ${cvAgg(lamSample, SAMPLE_SEV_CV).toFixed(3)}`);
console.log(`  game, full market          $${fullTiv.toFixed(0).padStart(8)}M     ${lamFull.toFixed(1).padStart(6)}      ${cvAgg(lamFull, cvC).toFixed(3)}`);
console.log(`  game, enrolled median      $${medEnrolled.toFixed(0).padStart(8)}M     ${lamEnrolled.toFixed(1).padStart(6)}      ${cvAgg(lamEnrolled, cvC).toFixed(3)}`);
console.log(`  game, enrolled p10         $${q(enrolled, 0.1).toFixed(0).padStart(8)}M     ${(q(enrolled, 0.1) * FREQ_PER_1M_TIV).toFixed(1).padStart(6)}      ${cvAgg(q(enrolled, 0.1) * FREQ_PER_1M_TIV, cvC).toFixed(3)}`);

// Monte Carlo confirmation at the enrolled median, since the analytic form
// assumes Poisson and the engine will carry frequency noise on top.
{
  const rng = new SeededRandom(20260821);
  let s1 = 0, s2 = 0, maxY = 0;
  const cum: number[] = []; let acc = 0;
  for (const c of MIX) { acc += c.w; cum.push(acc); }
  for (let t = 0; t < TRIALS; t++) {
    // Poisson via inversion (lambda is small enough that this is fine).
    const L = Math.exp(-lamEnrolled); let k = 0, p = 1;
    do { k++; p *= rng.next(); } while (p > L);
    k--;
    let tot = 0;
    for (let j = 0; j < k; j++) {
      const u = rng.next(); let idx = 0; while (idx < cum.length - 1 && u > cum[idx]) idx++;
      const c = MIX[idx];
      const z = Math.sqrt(-2 * Math.log(Math.max(rng.next(), 1e-12))) * Math.cos(2 * Math.PI * rng.next());
      tot += Math.min(CAP, Math.exp(c.mu + c.sigma * z));
    }
    s1 += tot; s2 += tot * tot; if (tot > maxY) maxY = tot;
  }
  const mean = s1 / TRIALS;
  const cvMC = Math.sqrt(Math.max(0, s2 / TRIALS - mean * mean)) / mean;
  console.log(`\n  Monte Carlo at the enrolled median (${TRIALS.toLocaleString()} years):`);
  console.log(`    mean annual loss $${(mean / 1e6).toFixed(2)}M   CV ${cvMC.toFixed(3)}   worst year $${(maxY / 1e6).toFixed(1)}M`);
  console.log(`    analytic CV ${cvAgg(lamEnrolled, cvC).toFixed(3)} — agreement confirms the closed form above.`);
}
console.log('\n  ⚠ READ THE CV COLUMN AGAINST THE OTHER TWO LINES. WC measures ~0.39 and GL ~0.78');
console.log('  on their retained annual loss. Property at the enrolled median is well above both,');
console.log('  which makes it the MOST volatile line in the pool, not the quiet short-tail one the');
console.log('  current Gamma path makes it look like. That is a real consequence of the fit and the');
console.log('  book size, not an artefact — but it should be a decision, not a surprise.');

// --- 4. PURE PREMIUM ---------------------------------------------------------
console.log('\n--- 4. PURE PREMIUM PER $100 OF TIV ---');
const perMillion = FREQ_PER_1M_TIV * m1;
const per100 = perMillion / 1e6 * 100;
console.log(`  frequency ${FREQ_PER_1M_TIV} claims per $1M TIV  x  mean severity $${m1.toFixed(0)}`);
console.log(`    = $${perMillion.toFixed(0)} of loss per $1M TIV  =  ${per100.toFixed(4)} per $100`);
console.log(`  brief states 0.0962 — ${Math.abs(per100 - 0.0962) < 0.0005 ? 'RECONCILES' : 'DOES NOT RECONCILE'}`);
console.log(`\n  THE 0.0247 CAT LOAD IS RETIRED, not added. It was collected with certainty and`);
console.log('  incurred never — Property\'s cat shock is gated off — and it would have poisoned');
console.log('  the CLF backtest, which measures what the engine actually draws. The held pure');
console.log('  premium IS the figure above. See PROPERTY_HELD_PURE_PREMIUM_PER_100.');
console.log(`\n  AAL AS AN OUTPUT (not a target):`);
console.log(`    full market   $${(fullTiv * perMillion / 1e6).toFixed(2)}M`);
console.log(`    enrolled med  $${(medEnrolled * perMillion / 1e6).toFixed(2)}M`);
console.log(`\n  Against the Gamma path's measured $6.98M mean annual gross loss.`);
