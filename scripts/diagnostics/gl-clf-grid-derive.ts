// DERIVATION for GL's Monte Carlo percentile grid — replaces FUNDING_CLF_TABLE
// for GL pricing, mirroring wc-clf-grid-derive.ts's recipe with two approved
// departures (see the two headers below) and one addition the severity cap
// makes possible for the first time.
//
// Run: npx tsx scripts/diagnostics/gl-clf-grid-derive.ts --replicate-study
//      npx tsx scripts/diagnostics/gl-clf-grid-derive.ts --sample-only
//      npx tsx scripts/diagnostics/gl-clf-grid-derive.ts
//
// --replicate-study sizes N_DRAWS against the CAPPED distribution directly,
// at the smallest and largest reference books only, before any full run.
// --sample-only prints book-selection diagnostics and skips the Monte Carlo.
//
// ============================================================================
// DEPARTURE 1 FROM WC's RECIPE: INDEXED ON LAMBDA (expected annual claim
// count), NOT CV.
//
// WC's grid is CV-indexed because CV is trend-invariant there (wcClfGrid.ts's
// load-bearing axis argument). That argument does NOT survive GL's severity
// cap: GL_SEVERITY_CAP is FIXED while severity inflates, so a fixed ceiling is
// a SHRINKING share of an inflating distribution and the CAPPED per-claim CV
// moves with the year (see gl-claim-check.ts section 2c(iv), which measures
// and reports the drift rather than asserting invariance). Indexing a grid on
// a quantity that itself slides with trend is exactly the failure CV-indexing
// was chosen to prevent for WC — so it disqualifies CV for GL.
//
// LAMBDA is what CV is a function of anyway (annual CV falls roughly as
// 1/sqrt(lambda) at fixed severity CV), and it is trend-invariant by
// CONSTRUCTION rather than by proof: GL frequency reads REAL (frozen) payroll,
// with no frequency trend at all (GL_LOSS_MODEL's header — frequency is flat by
// design), so lambda for a given book's real composition does not move as
// wages or severity inflate. It is also already computed as part of every
// expected-loss calculation, so indexing on it costs nothing at runtime.
//
// ============================================================================
// DEPARTURE 2: SAMPLE SIZE RE-DERIVED AGAINST THE CAPPED DISTRIBUTION.
//
// WC's 50,000 (and this file's first draft, sized against the UNCAPPED tail at
// alpha~1.41) is not automatically right for a distribution whose severity CV
// fell 29.55 -> 13.68 and whose annual CV more than halved. See the
// --replicate-study section for the measured answer.
//
// ============================================================================
// THE ADDITION THE CAP MAKES POSSIBLE: THE CUMULANTS MODULE IS NOW VERIFIABLE.
//
// Uncapped, half of E[X^2] came from above $1.42B, once per 5,182 years — no
// feasible sample could ever touch the region the analytic most needed
// checking, so glAggregateCumulants's gPool-mixing algebra (the one piece of
// GL's cumulants module WC's does not have) could not be validated against
// data at all. Capped, half comes from above $58.0M, once per ~15 full-market
// years — thousands of such claims in a half-million-draw run. See the
// dedicated ANALYTIC CV vs MONTE CARLO CV section below, at the full roster,
// with a bootstrap CI. This is legitimate where it would not have been
// uncapped (finding 26): the resampling UNIT here is one annual aggregate draw
// from a now-BOUNDED severity distribution, not a raw heavy-tailed severity
// draw, so the bootstrap's own sample space is no longer missing the mass that
// matters.
//
// EVERYTHING ELSE IS WC's RECIPE, UNCHANGED: gross basis, stratified round-
// robin by GL-payroll decile (same two rejected alternatives and the same
// reasons — see wc-clf-grid-derive.ts's header, restated below for GL), two
// seeded shuffles, stops 10-99, monotonicity asserted everywhere, held-out
// validation in the sparse region.
// ============================================================================
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { computeKGl, expectedGlGrossLossForKLine, expectedGlGrossLossForPricing, generateGlClaims, glCappedSeverityTrend } from '../../src/utils/glClaimEngine';
import { glAggregateCumulants } from '../../src/utils/glLossDistribution';
import { wageFactor } from '../../src/data/exposureTrend';
import { WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import { SeededRandom, deriveSubRng } from '../../src/utils/random';
import type { Member } from '../../src/types/simulation';

// ⚠ gPool MUST BE DRAWN, NOT FIXED AT 1, EVERYWHERE BELOW. A first draft of
// this file fixed gPool: 1 in every Monte Carlo call (copied from
// gl-claim-check.ts's neutral-book sections, which pin it deliberately to
// isolate OTHER effects) — correct for THAT purpose, wrong for a percentile
// grid, which has to represent the TRUE annual distribution the engine prices
// against, gPool variance included. E[gPool] = 1 so the analytic MEAN is
// unaffected either way (confirmed: the drawn/analytic mean matched to
// 0.016% even under the bug) — but gPool contributes real variance
// (Vg = 1/25) that a fixed gPool cannot produce, and the bug was caught
// exactly this way: the analytic CV (0.4747) fell OUTSIDE the bootstrap CI of
// a gPool=1 Monte Carlo run (measured 0.4310) at the full roster. Drawn from
// its own stream, keyed off the same instanceSeed with a distinct purpose
// label so it never collides with any per-member stream and stays
// reproducible from this file alone.
function drawGPool(instanceSeed: number): number {
  return deriveSubRng(instanceSeed, 1, 'gl_grid_gpool').gamma(WC_LOSS_MODEL.poolYearFactor.shape, WC_LOSS_MODEL.poolYearFactor.scale);
}

const YEAR = 1;
const PCTS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99];
const MODE = process.argv.includes('--replicate-study') ? 'replicate' : process.argv.includes('--sample-only') ? 'sample' : 'full';

// Chosen from the --replicate-study run below (see its printed conclusion).
// Fixed and recorded here rather than passed in: the grid is a measured
// constant and must be reproducible from this file alone.
const N_DRAWS = 150_000;

// ⚠ NOT WC's seed, and not the first one tried. The 9 targets below are spaced
// far more tightly at the low end than WC's 7 ever were (evenly in 1/sqrt(E)
// down to $50M vs WC's $100M floor), and at that spacing a single large
// member's payroll can jump exposure past TWO adjacent targets in one round-
// robin step, landing two "different" grid points on the identical book. Seed
// 20260815 (WC's) and 20260817 both did this at $62M/$78M or $50M/$62M;
// 99991 is the first of eight tried that resolves all nine targets to
// genuinely distinct books, checked by construction below (DISTINCT_BOOKS).
const STRATIFY_SEED = 99991;
const DECILES = 10;

// Exposure targets, $M of GL payroll, spaced EVENLY IN 1/sqrt(exposure) from
// $50M to $1300M (the full 200-member roster) — 9 points:
//   1/sqrt(E) = 0.141421 down to 0.027735 in 8 equal steps.
// Denser at the small-book end (where the curve bends hardest and CV is
// highest), sparser at the large end, matching how CV itself falls roughly as
// 1/sqrt(lambda) so this axis maps onto comparable curve-shape resolution.
const TARGETS_M = [50, 62, 78, 102, 140, 202, 317, 568, 1300];
// Two held-out points (the plan called for one; both approved), in the two
// regions that matter for different reasons: ~$58M sits in the grid's
// SPARSEST gap (between $50M and $62M — a book near collapse), ~$450M sits
// between $317M and $568M where a real enrolled book is likeliest to live
// operationally.
//
// ⚠ $58M NEEDS ITS OWN SEED. Under STRATIFY_SEED, the achievable exposures
// near $50-62M jump $54.3M -> $63.6M in a single member (the same coarseness
// that forced STRATIFY_SEED's own choice above) — there is NO target in
// [51,62] that lands strictly between the two grid books; every one collapses
// onto whichever side it's closer to. A held-out point that coincides with a
// grid anchor tests nothing. Seed 9 (the first of twenty tried that lands
// strictly between $54.3M and $63.6M) is used for $58M ONLY; $450M has no such
// problem under the main seed and uses it normally.
const HELD_OUT: { target: number; seed: number }[] = [
  { target: 58, seed: 9 },
  { target: 450, seed: 99991 },
];

const glPayroll = (m: Member) => m.exposureByLine.GL ?? 0;
const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
const q = (xs: number[], p: number) => { const s = sortNum(xs); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(3)}M`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

// STRATIFIED ROUND-ROBIN, restated for GL. Two rejected alternatives, same
// reasons as WC's (wc-clf-grid-derive.ts header):
//   1. Even-spaced subsample by headcount — makes exposure non-monotonic in
//      headcount when the roster interleaves entity types of wildly different
//      payroll, leaving holes exactly where the curve bends hardest.
//   2. Largest-first to hit an exposure target — gives a pool of giants whose
//      aggregate shape looks nothing like a real book at that payroll, because
//      CV depends on how exposure is DISTRIBUTED, not just its total.
// Sort by GL payroll, split into deciles, then repeatedly walk the deciles
// (both the within-decile order and the decile visit order reshuffled, each
// seeded) taking one member at a time until the exposure target is met.
function stratifiedByExposure(roster: Member[], targetExposureM: number, seed: number = STRATIFY_SEED): Member[] {
  const sorted = [...roster].sort((a, b) => glPayroll(a) - glPayroll(b));
  const perDecile = Math.ceil(sorted.length / DECILES);
  const bands: Member[][] = [];
  for (let d = 0; d < DECILES; d++) bands.push(sorted.slice(d * perDecile, (d + 1) * perDecile));

  const rng = new SeededRandom(seed);
  for (const band of bands) rng.shuffle(band);

  const cursor = new Array(DECILES).fill(0);
  const picked: Member[] = [];
  let exposure = 0;
  while (exposure < targetExposureM) {
    const order = rng.shuffle(Array.from({ length: DECILES }, (_, i) => i));
    let progressed = false;
    for (const d of order) {
      if (cursor[d] >= bands[d].length) continue;
      const m = bands[d][cursor[d]++];
      picked.push(m);
      exposure += glPayroll(m);
      progressed = true;
      if (exposure >= targetExposureM) break;
    }
    if (!progressed) break;
  }
  return picked;
}

const roster = getPredefinedMarketMembers();
const rosterExposure = roster.reduce((s, m) => s + glPayroll(m), 0);
const rosterMean = rosterExposure / roster.length;

console.log(`=== GL CLF GRID DERIVATION (stratified by target exposure, indexed on lambda) ===`);
console.log(`roster: ${roster.length} members, $${rosterExposure.toFixed(1)}M GL payroll, MEAN $${rosterMean.toFixed(2)}M/member`);
console.log(`stratification seed ${STRATIFY_SEED}, ${DECILES} payroll deciles, decile order reshuffled each pass`);
console.log(`mode: ${MODE}\n`);

interface BookRun {
  label: string;
  size: number;
  exposure: number;
  meanPayroll: number;
  lambda: number;
  cv: number;
  expectedLoss: number;
  ratios: Record<number, number>;
  draws: number[];
}

function describeBook(label: string, members: Member[]) {
  const kGl = computeKGl(members, YEAR);
  const exposure = members.reduce((s, m) => s + glPayroll(m), 0);
  // ⚠ THE k_GL (TILTED/DRAWN) BASIS, NOT expectedGlGrossLossForPricing
  // (untilted). This is deliberate and load-bearing, not a restatement of WC's
  // own denominator choice — see the identity assertion below for why: only
  // the k_GL basis is provably equal to what the engine's held-rate pricing
  // formula computes for THIS specific book, for any real (non-neutral) RQ mix.
  const expectedLoss = expectedGlGrossLossForKLine(members, { kGl, yearNumber: YEAR });
  const cum = glAggregateCumulants(members, kGl, YEAR);
  return { label, size: members.length, exposure, meanPayroll: exposure / members.length, kGl, expectedLoss, lambda: cum.lambda, cv: cum.cv };
}

// --- SELECTION DIAGNOSTICS ---------------------------------------------------
const selections = [
  ...TARGETS_M.map(t => ({ label: `$${t}M`, members: stratifiedByExposure(roster, t) })),
  ...HELD_OUT.map(h => ({ label: `$${h.target}M (HELD OUT)`, members: stratifiedByExposure(roster, h.target, h.seed) })),
];

console.log('--- BOOK SELECTION (mean payroll must land near the roster mean) ---');
console.log('  target              members   exposure     mean/member   vs roster    lambda      cv');
let worstDeviation = 0;
for (const sel of selections) {
  const d = describeBook(sel.label, sel.members);
  const dev = d.meanPayroll / rosterMean - 1;
  worstDeviation = Math.max(worstDeviation, Math.abs(dev));
  console.log(`  ${d.label.padEnd(20)} ${String(d.size).padStart(3)}   $${d.exposure.toFixed(1).padStart(7)}M   $${d.meanPayroll.toFixed(2).padStart(6)}M   ${(dev >= 0 ? '+' : '')}${(dev * 100).toFixed(1).padStart(5)}%   ${d.lambda.toFixed(2).padStart(8)}   ${d.cv.toFixed(4)}`);
}
console.log(`\n  worst |deviation| from roster mean payroll: ${(worstDeviation * 100).toFixed(1)}%  ` +
  `${worstDeviation <= 0.15 ? '(within the 15% tolerance)' : '*** EXCEEDS 15% — STRATIFICATION IS NOT WORKING ***'}`);

// ⚠ DISTINCTNESS, ASSERTED. At the tight low-end spacing this grid uses (9
// targets down to $50M, denser than WC ever needed), a single large member's
// payroll can jump exposure past TWO adjacent targets in one round-robin step
// and land them on the IDENTICAL book — silently turning two grid points into
// one duplicate with no error, just two rows of the same numbers. Caught here
// by construction rather than by eyeballing the table.
const exposureKeys = TARGETS_M.map(t => stratifiedByExposure(roster, t).reduce((s, m) => s + glPayroll(m), 0).toFixed(1));
const distinctBooks = new Set(exposureKeys).size;
console.log(`  distinct books across the ${TARGETS_M.length} grid targets: ${distinctBooks}/${TARGETS_M.length}  ` +
  `${distinctBooks === TARGETS_M.length ? '(no collisions)' : '*** TWO OR MORE TARGETS COLLAPSED TO THE SAME BOOK — pick a different STRATIFY_SEED ***'}`);

// --- ⚠ THE DENOMINATOR IDENTITY, ASSERTED, NOT ASSUMED ----------------------
// expectedGlGrossLossForKLine(book, {kGl: computeKGl(book), year}) must equal
// EXACTLY what the engine's held-rate pricing formula computes for that same
// book: GL_HELD_PURE_PREMIUM_PER_100-derived rate x exposure x year factors.
// This holds for GL (and would NOT hold for a rating-group line like WC, at a
// book with non-representative group mix) because of two facts together: (1)
// the k_GL invariant (expectedGlGrossLossForKLine(book,{kGl:computeKGl(book)})
// === expectedGlGrossLossForPricing(book,{riskQualityOverride:5,kGl:1}), the
// defect fixed at 72ecaa0), and (2) GL is FLAT-RATED — no rating groups, no
// per-type relativity — so expectedGlGrossLossForPricing at NEUTRAL RQ is
// EXACTLY per-dollar-of-payroll x exposure for ANY book, with an identical
// per-dollar constant regardless of composition. Fact (2) is what makes fact
// (1) sufficient; a line with per-group rates would need the reference book's
// group mix to match the roster's, which is only approximately true even under
// careful stratification. GL needs no such approximation.
console.log('\n--- DENOMINATOR IDENTITY: expectedGlGrossLossForKLine === held-rate x exposure, every book ---');
{
  const heldRatePerDollarYr1 = expectedGlGrossLossForPricing(roster, { yearNumber: 1, riskQualityOverride: 5, kGl: 1 }) / (rosterExposure * 10_000);
  let worstRelDiff = 0;
  for (const sel of selections) {
    const d = describeBook(sel.label, sel.members);
    const heldPrice = heldRatePerDollarYr1 * glCappedSeverityTrend(YEAR) / wageFactor('GL', YEAR) * d.exposure * 10_000;
    const relDiff = Math.abs(d.expectedLoss / heldPrice - 1);
    worstRelDiff = Math.max(worstRelDiff, relDiff);
  }
  console.log(`  worst |expectedGlGrossLossForKLine / held-rate-priced - 1| across all ${selections.length} reference books: ${worstRelDiff.toExponential(2)}`);
  console.log(`  ${worstRelDiff < 1e-9 ? 'IDENTITY HOLDS — the grid\'s denominator is provably what the engine actually prices.' : '*** IDENTITY FAILS — the grid denominator does not match the engine\'s pricing basis ***'}`);
}

if (worstDeviation > 0.15 || distinctBooks !== TARGETS_M.length) {
  console.log('\nSTOPPING: fix the sampler before deriving a grid on top of it.');
  process.exitCode = 1;
} else if (MODE === 'sample') {
  console.log('\n--sample-only: stopping before the Monte Carlo.');
} else if (MODE === 'replicate') {
  // ===========================================================================
  // REPLICATE STUDY: how many draws does the CAPPED distribution actually need?
  // Smallest ($50M) and largest ($1300M, full roster) books only, per the
  // instruction — these bracket the CV range (highest and lowest), so they
  // bracket the sample-size requirement too. At each of several candidate N,
  // draw K INDEPENDENT replicate batches and measure the SAMPLE SD of the
  // resulting 99th-percentile ratio across replicates — the empirical version
  // of relSE(p) rather than the alpha_eff formula, which was sized against the
  // UNCAPPED tail and is not assumed to carry over.
  // ===========================================================================
  console.log('\n=== REPLICATE STUDY: sample size against the CAPPED distribution ===');
  const CANDIDATE_N = [50_000, 100_000, 150_000, 250_000];
  const REPLICATES = 8;
  for (const label of ['$50M', '$1300M']) {
    const members = stratifiedByExposure(roster, label === '$50M' ? 50 : 1300);
    const d = describeBook(label, members);
    console.log(`\n  book ${label}: ${d.size} members, lambda ${d.lambda.toFixed(1)}, cv ${d.cv.toFixed(4)}, expected ${fmt$(d.expectedLoss)}`);
    for (const n of CANDIDATE_N) {
      const p99s: number[] = [], p90s: number[] = [];
      for (let r = 0; r < REPLICATES; r++) {
        const draws: number[] = [];
        const seedBase = 5_000_000 + r * 1_000_003;
        for (let i = 0; i < n; i++) {
          const seed = seedBase + i * 7919;
          const g = generateGlClaims({ members, yearNumber: YEAR, calendarYear: 2026, instanceSeed: seed, kGl: d.kGl, gPool: drawGPool(seed), riskControlEffectiveness: 0 });
          draws.push(g.grossUltimateLoss);
        }
        p99s.push(q(draws, 99) / d.expectedLoss);
        p90s.push(q(draws, 90) / d.expectedLoss);
      }
      const relSE99 = sd(p99s) / mean(p99s);
      const relSE90 = sd(p90s) / mean(p90s);
      console.log(`    n=${String(n).padStart(7)}  (${REPLICATES} replicates, ${(n * REPLICATES).toLocaleString()} total draws)   ` +
        `p90 relSE ${(relSE90 * 100).toFixed(2)}%   p99 relSE ${(relSE99 * 100).toFixed(2)}%`);
    }
  }
  console.log('\n  CONCLUSION: read the p99 relSE column. Pick the smallest N at or below ~1% relSE on the');
  console.log('  worse (smaller, higher-CV) book, then set N_DRAWS to it above and re-run in full mode.');
} else {
  // ===========================================================================
  // ANALYTIC CV vs MONTE CARLO CV, AT THE FULL ROSTER, WITH A BOOTSTRAP CI.
  // Newly possible under the cap (see header) — this is the check that matters
  // most, because the gPool mixing algebra is the one piece of GL's cumulants
  // module with no WC equivalent to copy from, and an error there would index
  // the whole grid on a wrong number while every percentile still looked
  // monotone and plausible.
  //
  // BOOTSTRAP IS LEGITIMATE HERE, unlike a raw severity bootstrap (finding 26):
  // the resampling UNIT is one ANNUAL AGGREGATE draw from a now-BOUNDED
  // severity distribution, not an individual heavy-tailed claim. Capped, half
  // of E[X^2] comes from above $58.0M — about 1 claim in 15 full-market years,
  // so a several-hundred-thousand-draw sample contains thousands of the claims
  // that drive the variance, and the bootstrap's resample space is no longer
  // missing the mass that matters.
  // ===========================================================================
  console.log('\n=== ANALYTIC CV vs MONTE CARLO CV, full roster, bootstrap CI ===');
  {
    const CV_CHECK_N = 500_000;
    const kGl = computeKGl(roster, YEAR);
    const analytic = glAggregateCumulants(roster, kGl, YEAR);
    const draws: number[] = [];
    const t0 = Date.now();
    for (let i = 0; i < CV_CHECK_N; i++) {
      const seed = 9_000_000 + i * 7919;
      const g = generateGlClaims({ members: roster, yearNumber: YEAR, calendarYear: 2026, instanceSeed: seed, kGl, gPool: drawGPool(seed), riskControlEffectiveness: 0 });
      draws.push(g.grossUltimateLoss);
      if ((i + 1) % 100_000 === 0) console.log(`  ...${(i + 1).toLocaleString()}/${CV_CHECK_N.toLocaleString()} draws (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    const sampleMean = mean(draws), sampleCv = sd(draws) / sampleMean;
    console.log(`\n  ANALYTIC: lambda ${analytic.lambda.toFixed(2)}, mean ${fmt$(analytic.mean)}, cv ${analytic.cv.toFixed(4)}`);
    console.log(`  MONTE CARLO (n=${CV_CHECK_N.toLocaleString()}, gPool drawn from its own Gamma(25,1/25)): mean ${fmt$(sampleMean)}, cv ${sampleCv.toFixed(4)}`);

    // Bootstrap: resample annual draws with replacement, 2000 times.
    const BOOT = 2000;
    const bootCvs: number[] = [];
    let rngState = 2166136261;
    const nextRand = () => { rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5; return (rngState >>> 0) / 4294967296; };
    for (let b = 0; b < BOOT; b++) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < CV_CHECK_N; i++) {
        const x = draws[(nextRand() * CV_CHECK_N) | 0];
        s1 += x; s2 += x * x;
      }
      const m = s1 / CV_CHECK_N;
      bootCvs.push(Math.sqrt(Math.max(0, s2 / CV_CHECK_N - m * m)) / m);
    }
    bootCvs.sort((a, b) => a - b);
    const lo = bootCvs[Math.floor(0.005 * BOOT)], hi = bootCvs[Math.floor(0.995 * BOOT)];
    console.log(`  bootstrap 99% CI on sample CV (${BOOT} resamples): [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
    const inCI = analytic.cv >= lo && analytic.cv <= hi;
    console.log(`  ${inCI ? 'ANALYTIC CV FALLS INSIDE THE BOOTSTRAP CI — the gPool-mixing derivation checks out.' : '*** ANALYTIC CV OUTSIDE THE BOOTSTRAP CI — the cumulants derivation needs review before the grid is indexed on it. ***'}`);

    // Mean check too (cheap, and it's the matched-pair identity restated).
    const meanRelDiff = Math.abs(sampleMean / analytic.mean - 1);
    console.log(`  mean: drawn/analytic - 1 = ${(meanRelDiff * 100).toFixed(3)}%  (matched-pair sanity, not the main check)`);
  }

  // --- MONTE CARLO GRID --------------------------------------------------
  function runBook(label: string, members: Member[]): BookRun {
    const d = describeBook(label, members);
    const draws: number[] = [];
    for (let i = 0; i < N_DRAWS; i++) {
      const seed = 424242 + i * 7919;
      const g = generateGlClaims({
        members, yearNumber: YEAR, calendarYear: 2026,
        instanceSeed: seed, kGl: d.kGl, gPool: drawGPool(seed), riskControlEffectiveness: 0,
      });
      draws.push(g.grossUltimateLoss);
    }
    const sorted = sortNum(draws);
    const ratios: Record<number, number> = {};
    for (const p of PCTS) ratios[p] = q(sorted, p) / d.expectedLoss;
    return { label, size: d.size, exposure: d.exposure, meanPayroll: d.meanPayroll, lambda: d.lambda, cv: d.cv, expectedLoss: d.expectedLoss, ratios, draws };
  }

  console.log(`\n--- MONTE CARLO: ${N_DRAWS.toLocaleString()} single-year draws per book, gPool drawn per draw ---`);
  const grid: BookRun[] = [];
  for (const t of TARGETS_M) {
    const run = runBook(`$${t}M`, stratifiedByExposure(roster, t));
    grid.push(run);
    console.log(`  ${run.label.padEnd(8)} size ${String(run.size).padStart(3)}  lambda ${run.lambda.toFixed(2).padStart(8)}  cv ${run.cv.toFixed(4)}  expectedLoss ${fmt$(run.expectedLoss)}`);
  }

  console.log('\n--- GRID DATA (paste into src/data/glClfGrid.ts) ---');
  console.log('export const GL_CLF_GRID: GlClfGridEntry[] = [');
  for (const r of grid) {
    const ratioStr = PCTS.map(p => `${p}: ${r.ratios[p].toFixed(4)}`).join(', ');
    console.log(`  { size: ${r.size}, exposure: ${r.exposure.toFixed(1)}, lambda: ${r.lambda.toFixed(4)}, cv: ${r.cv.toFixed(4)}, ratios: { ${ratioStr} } },`);
  }
  console.log('];');

  // --- MONOTONICITY ---
  console.log('\n--- MONOTONICITY, every grid point ---');
  let anyNonMonotonic = false;
  for (const r of grid) {
    let prev = -Infinity, ok = true;
    for (const p of PCTS) { if (r.ratios[p] <= prev) ok = false; prev = r.ratios[p]; }
    console.log(`  ${r.label.padEnd(8)} (lambda ${r.lambda.toFixed(1)}): ${ok ? 'monotonic' : '*** NOT MONOTONIC ***'}`);
    if (!ok) anyNonMonotonic = true;
  }

  // --- interpolation on LAMBDA, identical to the shipped runtime path ---
  function interpolate(lambda: number, points: BookRun[], p: number): number {
    const s = [...points].sort((a, b) => a.lambda - b.lambda);
    if (lambda <= s[0].lambda) return s[0].ratios[p];
    if (lambda >= s[s.length - 1].lambda) return s[s.length - 1].ratios[p];
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (lambda >= a.lambda && lambda <= b.lambda) {
        const w = (lambda - a.lambda) / (b.lambda - a.lambda);
        return a.ratios[p] + w * (b.ratios[p] - a.ratios[p]);
      }
    }
    return s[s.length - 1].ratios[p];
  }

  // --- HELD-OUT VALIDATION, both points ---
  for (const h of HELD_OUT) {
    console.log(`\n--- HELD-OUT VALIDATION: $${h.target}M ---`);
    const heldOut = runBook(`$${h.target}M`, stratifiedByExposure(roster, h.target, h.seed));
    const below = [...grid].filter(g => g.lambda <= heldOut.lambda).sort((a, b) => b.lambda - a.lambda)[0];
    const above = [...grid].filter(g => g.lambda >= heldOut.lambda).sort((a, b) => a.lambda - b.lambda)[0];
    console.log(`  held-out: ${heldOut.size} members, $${heldOut.exposure.toFixed(1)}M, lambda ${heldOut.lambda.toFixed(2)}, cv ${heldOut.cv.toFixed(4)}, expectedLoss ${fmt$(heldOut.expectedLoss)}`);
    console.log(`  bracketed by lambda ${below ? below.lambda.toFixed(2) + ` (${below.label})` : 'none'} and ${above ? above.lambda.toFixed(2) + ` (${above.label})` : 'none'}` +
      `${below && above ? `  — gap ${(above.lambda - below.lambda).toFixed(2)}` : ''}`);

    console.log('\n  pctile   true (MC)   interpolated   residual');
    let sumAbs = 0, worstAbs = 0, worstAt = 0;
    for (const p of PCTS) {
      const truth = heldOut.ratios[p];
      const interp = interpolate(heldOut.lambda, grid, p);
      const resid = interp - truth;
      sumAbs += Math.abs(resid);
      if (Math.abs(resid) > worstAbs) { worstAbs = Math.abs(resid); worstAt = p; }
      console.log(`  ${String(p).padStart(5)}    ${truth.toFixed(4)}      ${interp.toFixed(4)}       ${resid >= 0 ? '+' : ''}${resid.toFixed(4)}`);
    }
    console.log(`\n  mean |residual| ${(sumAbs / PCTS.length).toFixed(4)}   worst ${worstAbs.toFixed(4)} at the ${worstAt}th percentile`);

    let prevI = -Infinity, interpMono = true;
    for (const p of PCTS) { const v = interpolate(heldOut.lambda, grid, p); if (v <= prevI) interpMono = false; prevI = v; }
    console.log(`  interpolated held-out curve monotonic: ${interpMono ? 'YES' : '*** NO ***'}`);
    if (!interpMono) anyNonMonotonic = true;
  }

  // --- crossing point (MONTE CARLO, not a lognormal approximation) ---
  console.log('\n--- WHERE drawn/expected = 1.000 FALLS, from MONTE CARLO (linear interp between adjacent stops) ---');
  for (const r of grid) {
    const below1 = r.draws.filter(d => d < r.expectedLoss).length / r.draws.length;
    let crossing: string;
    let found = false;
    for (let i = 0; i < PCTS.length - 1; i++) {
      const p0 = PCTS[i], p1 = PCTS[i + 1];
      if (r.ratios[p0] <= 1.0 && r.ratios[p1] >= 1.0) {
        const w = (1.0 - r.ratios[p0]) / (r.ratios[p1] - r.ratios[p0]);
        crossing = `${(p0 + w * (p1 - p0)).toFixed(1)}%`;
        found = true;
        break;
      }
    }
    if (!found) crossing = r.ratios[PCTS[0]] > 1.0 ? 'below 10%' : 'above 99%';
    console.log(`  ${r.label.padEnd(8)} ${String(r.size).padStart(3)} members, lambda ${r.lambda.toFixed(1)}, cv ${r.cv.toFixed(4)}: crosses 1.000 at ~${crossing!}  (raw P(draw<expected) = ${(below1 * 100).toFixed(1)}%)`);
  }

  // --- compression/expansion vs the generic table ---
  console.log('\n--- EXPANSION vs FUNDING_CLF_TABLE (GL is expected to WIDEN, not narrow, unlike WC) ---');
  const GENERIC: Record<number, number> = { 60: 1.000, 90: 1.951, 95: 2.448 };
  console.log('  book      lambda    60% (generic 1.000)   90% (generic 1.951)   95% (generic 2.448)');
  for (const r of [...grid]) {
    console.log(`  ${r.label.padEnd(8)}  ${r.lambda.toFixed(0).padStart(6)}    ${r.ratios[60].toFixed(4).padStart(6)} (${r.ratios[60] > GENERIC[60] ? '+' : ''}${((r.ratios[60] / GENERIC[60] - 1) * 100).toFixed(0)}%)      ${r.ratios[90].toFixed(4).padStart(6)} (${r.ratios[90] > GENERIC[90] ? '+' : ''}${((r.ratios[90] / GENERIC[90] - 1) * 100).toFixed(0)}%)      ${r.ratios[95].toFixed(4).padStart(6)} (${r.ratios[95] > GENERIC[95] ? '+' : ''}${((r.ratios[95] / GENERIC[95] - 1) * 100).toFixed(0)}%)`);
  }

  console.log(`\n${anyNonMonotonic ? '*** NON-MONOTONICITY DETECTED — DO NOT SHIP ***' : 'All monotonicity checks pass.'}`);
  process.exitCode = anyNonMonotonic ? 1 : 0;
}
