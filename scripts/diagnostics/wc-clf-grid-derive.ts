// DERIVATION for WC's Monte Carlo percentile grid (finding 38).
//
// Run: npx tsx scripts/diagnostics/wc-clf-grid-derive.ts
//      npx tsx scripts/diagnostics/wc-clf-grid-derive.ts --sample-only
//
// --sample-only prints just the book-selection diagnostics (member count,
// exposure, mean payroll, analytic CV) and skips the Monte Carlo. It exists
// because a bad reference-book selection invalidates the whole grid, and the
// 50,000-draw run per point is far too expensive to be the thing that tells
// you the sampling was wrong.
//
// ============================================================================
// REFERENCE BOOKS ARE SELECTED BY TARGET EXPOSURE, STRATIFIED ACROSS PAYROLL
// DECILES. Two rejected alternatives, and why each fails:
//
// 1. EVEN-SPACED SUBSAMPLE BY HEADCOUNT (what the first version of this grid
//    used, and the defect that prompted the rebuild). Taking every k-th member
//    of the roster makes exposure NON-MONOTONIC in headcount — the 30-member
//    book landed on $309.3M while the 50-member book landed on $287.9M, because
//    the roster's ordering interleaves entity types with wildly different
//    payrolls and a systematic stride can land disproportionately on large ones
//    (that 30-member book averaged $10.31M/member against the roster's $6.50M,
//    59% high). The consequence was a grid with two points nearly on top of each
//    other at CV 0.684 and 0.718 and NOTHING anchoring CV 0.718 to 1.159 — a
//    0.44-wide hole in exactly the region where the curve bends hardest, which
//    is also where a shrinking pool ends up.
//
// 2. LARGEST-FIRST TO HIT AN EXPOSURE TARGET. Reaching $300M by taking the
//    biggest members gives ~10 members averaging $30.95M — a pool of giants
//    whose aggregate claim distribution looks nothing like a real 45-member
//    book at the same payroll, because CV depends on how exposure is
//    DISTRIBUTED across members, not just its total. This is the opposite
//    failure from (1) and equally disqualifying.
//
// STRATIFIED ROUND-ROBIN fixes both: sort by WC payroll, split into deciles,
// then repeatedly walk the deciles taking one member from each until the
// exposure target is met. Every grid point therefore reproduces the ROSTER'S
// OWN PAYROLL SHAPE (mean payroll per member lands near the roster's $6.50M at
// every size — asserted below), which is what makes the points comparable to
// one another and makes CV vary because of BOOK SIZE rather than because of
// book composition.
//
// TWO SHUFFLES, BOTH SEEDED (STRATIFY_SEED, fixed and recorded so the grid is
// reproducible):
//   - WITHIN each decile, so which member represents that decile is not an
//     artifact of payroll ordering within the band;
//   - the decile VISIT ORDER on each pass, so that a partial final cycle (the
//     common case — a $100M book is ~1.5 cycles) is an unbiased sample of
//     deciles. Without this the walk would always stop having taken from the
//     SMALLEST deciles, dragging small books' mean payroll below the roster's
//     and reintroducing a composition artifact of its own.
// ============================================================================
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { computeKLine, expectedWcGrossLossForPricing, generateWcClaims } from '../../src/utils/wcClaimEngine';
import { wcAggregateCumulants } from '../../src/utils/wcLossDistribution';
import { SeededRandom } from '../../src/utils/random';
import type { Member } from '../../src/types/simulation';

const N_DRAWS = 50_000;
const YEAR = 1;
const PCTS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99];
const SAMPLE_ONLY = process.argv.includes('--sample-only');

// Fixed, and recorded here rather than passed in: the grid is a measured
// constant and must be reproducible from this file alone.
const STRATIFY_SEED = 20260815;
const DECILES = 10;

// Exposure targets, $M of WC payroll. Spans the enrollable range from a
// nearly-collapsed pool to the full 200-member marketplace.
const TARGETS_M = [100, 200, 300, 450, 700, 1000, 1300];
// Held-out validation point. Deliberately in the SPARSE region of the OLD
// grid (CV near 0.9, ~$180M) rather than the dense one: the previous
// validation sat at CV 0.568 where two grid points bracketed it closely, so
// it tested the easy case and proved little.
const HELD_OUT_M = 150;

const wcPayroll = (m: Member) => m.exposureByLine.WC ?? 0;
const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
const q = (xs: number[], p: number) => { const s = sortNum(xs); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(3)}M`;

function stratifiedByExposure(roster: Member[], targetExposureM: number): Member[] {
  const sorted = [...roster].sort((a, b) => wcPayroll(a) - wcPayroll(b));
  const perDecile = Math.ceil(sorted.length / DECILES);
  const bands: Member[][] = [];
  for (let d = 0; d < DECILES; d++) bands.push(sorted.slice(d * perDecile, (d + 1) * perDecile));

  const rng = new SeededRandom(STRATIFY_SEED);
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
      exposure += wcPayroll(m);
      progressed = true;
      if (exposure >= targetExposureM) break;
    }
    if (!progressed) break; // roster exhausted before the target
  }
  return picked;
}

const roster = getPredefinedMarketMembers();
const rosterExposure = roster.reduce((s, m) => s + wcPayroll(m), 0);
const rosterMean = rosterExposure / roster.length;

console.log(`=== WC CLF GRID DERIVATION (stratified by target exposure) ===`);
console.log(`roster: ${roster.length} members, $${rosterExposure.toFixed(1)}M WC payroll, MEAN $${rosterMean.toFixed(2)}M/member`);
console.log(`stratification seed ${STRATIFY_SEED}, ${DECILES} payroll deciles, decile order reshuffled each pass\n`);

interface BookRun {
  label: string;
  size: number;
  exposure: number;
  meanPayroll: number;
  cv: number;
  expectedLoss: number;
  ratios: Record<number, number>;
}

function describeBook(label: string, members: Member[]): Omit<BookRun, 'ratios' | 'expectedLoss'> & { kLine: number; expectedLoss: number } {
  const kLine = computeKLine(members);
  const exposure = members.reduce((s, m) => s + wcPayroll(m), 0);
  const expectedLoss = expectedWcGrossLossForPricing(members, { kLine, yearNumber: YEAR });
  const cv = wcAggregateCumulants(members, kLine, YEAR).cv;
  return { label, size: members.length, exposure, meanPayroll: exposure / members.length, cv, kLine, expectedLoss };
}

// --- SELECTION DIAGNOSTICS, printed before any Monte Carlo ------------------
const selections = [
  ...TARGETS_M.map(t => ({ label: `$${t}M`, members: stratifiedByExposure(roster, t) })),
  { label: `$${HELD_OUT_M}M (HELD OUT)`, members: stratifiedByExposure(roster, HELD_OUT_M) },
];

console.log('--- BOOK SELECTION (mean payroll must land near the roster mean, or the stratification is not working) ---');
console.log('  target        members   exposure     mean/member   vs roster    CV');
let worstDeviation = 0;
for (const sel of selections) {
  const d = describeBook(sel.label, sel.members);
  const dev = d.meanPayroll / rosterMean - 1;
  worstDeviation = Math.max(worstDeviation, Math.abs(dev));
  console.log(`  ${d.label.padEnd(20)} ${String(d.size).padStart(3)}   $${d.exposure.toFixed(1).padStart(7)}M   $${d.meanPayroll.toFixed(2).padStart(6)}M   ${(dev >= 0 ? '+' : '')}${(dev * 100).toFixed(1).padStart(5)}%   ${d.cv.toFixed(4)}`);
}
console.log(`\n  worst |deviation| from roster mean payroll: ${(worstDeviation * 100).toFixed(1)}%  ` +
  `${worstDeviation <= 0.15 ? '(within the 15% tolerance)' : '*** EXCEEDS 15% — STRATIFICATION IS NOT WORKING ***'}`);

if (worstDeviation > 0.15) {
  console.log('\nSTOPPING: fix the sampler before deriving a grid on top of it.');
  process.exitCode = 1;
} else if (SAMPLE_ONLY) {
  console.log('\n--sample-only: stopping before the Monte Carlo.');
} else {
  // --- MONTE CARLO -----------------------------------------------------------
  function runBook(label: string, members: Member[]): BookRun {
    const d = describeBook(label, members);
    const draws: number[] = [];
    for (let i = 0; i < N_DRAWS; i++) {
      const g = generateWcClaims({
        members, yearNumber: YEAR, calendarYear: 2026,
        instanceSeed: 424242 + i * 7919, kLine: d.kLine, riskControlEffectiveness: 0,
      });
      // g.grossUltimateLoss is the whole accident year now — WC's report lag is
      // gone, so there is no delayedGross to add back.
      draws.push(g.grossUltimateLoss);
    }
    const sorted = sortNum(draws);
    const ratios: Record<number, number> = {};
    for (const p of PCTS) ratios[p] = q(sorted, p) / d.expectedLoss;
    return { label, size: d.size, exposure: d.exposure, meanPayroll: d.meanPayroll, cv: d.cv, expectedLoss: d.expectedLoss, ratios };
  }

  console.log(`\n--- MONTE CARLO: ${N_DRAWS} single-year draws per book ---`);
  const grid: BookRun[] = [];
  for (const t of TARGETS_M) {
    const run = runBook(`$${t}M`, stratifiedByExposure(roster, t));
    grid.push(run);
    console.log(`  ${run.label.padEnd(8)} size ${String(run.size).padStart(3)}  CV ${run.cv.toFixed(4)}  expectedLoss ${fmt$(run.expectedLoss)}`);
  }

  console.log('\n--- GRID DATA (paste into src/data/wcClfGrid.ts) ---');
  console.log('export const WC_CLF_GRID: WcClfGridEntry[] = [');
  for (const r of grid) {
    const ratioStr = PCTS.map(p => `${p}: ${r.ratios[p].toFixed(4)}`).join(', ');
    console.log(`  { size: ${r.size}, exposure: ${r.exposure.toFixed(1)}, cv: ${r.cv.toFixed(4)}, ratios: { ${ratioStr} } },`);
  }
  console.log('];');

  // --- MONOTONICITY at every grid point ---
  console.log('\n--- MONOTONICITY, every grid point ---');
  let anyNonMonotonic = false;
  for (const r of grid) {
    let prev = -Infinity, ok = true;
    for (const p of PCTS) { if (r.ratios[p] <= prev) ok = false; prev = r.ratios[p]; }
    console.log(`  ${r.label.padEnd(8)} (CV ${r.cv.toFixed(4)}): ${ok ? 'monotonic' : '*** NOT MONOTONIC ***'}`);
    if (!ok) anyNonMonotonic = true;
  }

  // --- interpolation, identical to the shipped runtime path (CV axis) ---
  function interpolate(cv: number, points: BookRun[], p: number): number {
    const s = [...points].sort((a, b) => a.cv - b.cv);
    if (cv <= s[0].cv) return s[0].ratios[p];
    if (cv >= s[s.length - 1].cv) return s[s.length - 1].ratios[p];
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if (cv >= a.cv && cv <= b.cv) {
        const w = (cv - a.cv) / (b.cv - a.cv);
        return a.ratios[p] + w * (b.ratios[p] - a.ratios[p]);
      }
    }
    return s[s.length - 1].ratios[p];
  }

  // --- HELD-OUT VALIDATION, in the SPARSE region (CV ~0.9) ---
  console.log(`\n--- HELD-OUT VALIDATION: $${HELD_OUT_M}M, targeting the sparse high-CV region ---`);
  const heldOut = runBook(`$${HELD_OUT_M}M`, stratifiedByExposure(roster, HELD_OUT_M));
  const below = [...grid].filter(g => g.cv <= heldOut.cv).sort((a, b) => b.cv - a.cv)[0];
  const above = [...grid].filter(g => g.cv >= heldOut.cv).sort((a, b) => a.cv - b.cv)[0];
  console.log(`  held-out: ${heldOut.size} members, $${heldOut.exposure.toFixed(1)}M, CV ${heldOut.cv.toFixed(4)}, expectedLoss ${fmt$(heldOut.expectedLoss)}`);
  console.log(`  bracketed by CV ${below ? below.cv.toFixed(4) + ` (${below.label})` : 'none'} and ${above ? above.cv.toFixed(4) + ` (${above.label})` : 'none'}` +
    `${below && above ? `  — gap ${(above.cv - below.cv).toFixed(4)}` : ''}`);

  console.log('\n  pctile   true (MC)   interpolated   residual');
  let sumAbs = 0, worstAbs = 0, worstAt = 0;
  for (const p of PCTS) {
    const truth = heldOut.ratios[p];
    const interp = interpolate(heldOut.cv, grid, p);
    const resid = interp - truth;
    sumAbs += Math.abs(resid);
    if (Math.abs(resid) > worstAbs) { worstAbs = Math.abs(resid); worstAt = p; }
    console.log(`  ${String(p).padStart(5)}    ${truth.toFixed(4)}      ${interp.toFixed(4)}       ${resid >= 0 ? '+' : ''}${resid.toFixed(4)}`);
  }
  console.log(`\n  mean |residual| ${(sumAbs / PCTS.length).toFixed(4)}   worst ${worstAbs.toFixed(4)} at the ${worstAt}th percentile`);

  // interpolated held-out curve must itself be monotonic
  let prevI = -Infinity, interpMono = true;
  for (const p of PCTS) { const v = interpolate(heldOut.cv, grid, p); if (v <= prevI) interpMono = false; prevI = v; }
  console.log(`  interpolated held-out curve monotonic: ${interpMono ? 'YES' : '*** NO ***'}`);
  if (!interpMono) anyNonMonotonic = true;

  // --- crossing point: where drawn/expected = 1.000 ---
  console.log('\n--- WHERE drawn/expected = 1.000 FALLS (linear interp between adjacent stops) ---');
  for (const r of [...grid, heldOut]) {
    let crossing = 'below 10%';
    for (let i = 0; i < PCTS.length - 1; i++) {
      const p0 = PCTS[i], p1 = PCTS[i + 1];
      if (r.ratios[p0] <= 1.0 && r.ratios[p1] >= 1.0) {
        const w = (1.0 - r.ratios[p0]) / (r.ratios[p1] - r.ratios[p0]);
        crossing = `${(p0 + w * (p1 - p0)).toFixed(1)}%`;
        break;
      }
    }
    if (r.ratios[PCTS[PCTS.length - 1]] < 1.0) crossing = 'above 99%';
    console.log(`  ${r.label.padEnd(8)} ${String(r.size).padStart(3)} members, CV ${r.cv.toFixed(4)}: crosses 1.000 at ~${crossing}`);
  }

  console.log(`\n${anyNonMonotonic ? '*** NON-MONOTONICITY DETECTED — DO NOT SHIP ***' : 'All monotonicity checks pass.'}`);
  process.exitCode = anyNonMonotonic ? 1 : 0;
}
