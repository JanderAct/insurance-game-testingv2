// DERIVATION for WC's Monte Carlo percentile grid (finding 38, take 2).
//
// Cornish-Fisher failed (see wc-clf-derivation-check.ts's history / the
// commit this replaces): WC's skewness (18-42) is far outside where a
// cumulant-polynomial correction to the normal quantile is valid, and it
// produced negative loss percentiles. This script builds the replacement:
// options (b) from the approved plan — Monte Carlo the percentile curve at
// several reference book sizes, interpolate at runtime on the book's own CV
// (chosen over 1/sqrt(exposure) below, with the residual reported).
//
// Run: npx tsx scripts/diagnostics/wc-clf-grid-derive.ts
//
// OUTPUT: the grid data to hard-code into src/data/wcClfGrid.ts (measured
// once, then held — same convention as WC_HELD_PURE_PREMIUM_PER_100 and
// FUNDING_CLF_TABLE itself), plus the held-out validation residual and the
// CV-vs-1/sqrt(exposure) interpolation comparison.
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { computeKLine, expectedWcGrossLossForPricing, generateWcClaims } from '../../src/utils/wcClaimEngine';
import { wcAggregateCumulants } from '../../src/utils/wcLossDistribution';
import type { Member } from '../../src/types/simulation';

const N_DRAWS = 50_000;
const YEAR = 1;
const PCTS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99];

const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
const q = (xs: number[], p: number) => { const s = sortNum(xs); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(3)}M`;

// Evenly-spaced subset of exactly n members across the 200-member roster —
// exact count regardless of divisibility, and spread across the roster's
// interleaved type/region ordering rather than a contiguous block.
function evenSubset(roster: Member[], n: number): Member[] {
  const picked: Member[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const idx = Math.min(roster.length - 1, Math.floor((i * roster.length) / n));
    if (!seen.has(idx)) { seen.add(idx); picked.push(roster[idx]); }
  }
  // Guard against rounding collisions leaving fewer than n — fill from the front.
  let j = 0;
  while (picked.length < n && j < roster.length) {
    if (!seen.has(j)) { seen.add(j); picked.push(roster[j]); }
    j++;
  }
  return picked;
}

interface BookRun {
  size: number;
  exposure: number;
  cv: number;
  expectedLoss: number;
  ratios: Record<number, number>; // percentile -> drawn/expected
}

function runBook(members: Member[]): BookRun {
  const kLine = computeKLine(members);
  const exposure = members.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  const expectedLoss = expectedWcGrossLossForPricing(members, { kLine, yearNumber: YEAR });
  const analytic = wcAggregateCumulants(members, kLine, YEAR);

  const draws: number[] = [];
  for (let i = 0; i < N_DRAWS; i++) {
    const g = generateWcClaims({
      members, yearNumber: YEAR, calendarYear: 2026,
      instanceSeed: 424242 + i * 7919, kLine, riskControlEffectiveness: 0,
    });
    draws.push(g.grossUltimateLoss + g.delayedGross);
  }
  const sorted = sortNum(draws);
  const ratios: Record<number, number> = {};
  for (const p of PCTS) ratios[p] = q(sorted, p) / expectedLoss;

  return { size: members.length, exposure, cv: analytic.cv, expectedLoss, ratios };
}

const roster = getPredefinedMarketMembers();
const GRID_SIZES = [15, 30, 50, 80, 130, 200];
const HELD_OUT_SIZE = 65;

console.log(`=== WC CLF GRID DERIVATION: ${GRID_SIZES.length} reference books, ${N_DRAWS} single-year draws each ===\n`);

const grid: BookRun[] = [];
for (const size of GRID_SIZES) {
  const book = evenSubset(roster, size);
  const run = runBook(book);
  grid.push(run);
  console.log(`  size ${String(size).padStart(3)}  exposure $${run.exposure.toFixed(0)}M  CV ${run.cv.toFixed(4)}  expectedLoss ${fmt$(run.expectedLoss)}`);
}

console.log('\n--- GRID DATA (paste into src/data/wcClfGrid.ts) ---');
console.log('export const WC_CLF_GRID: { size: number; exposure: number; cv: number; ratios: Record<number, number> }[] = [');
for (const run of grid) {
  const ratioStr = PCTS.map(p => `${p}: ${run.ratios[p].toFixed(4)}`).join(', ');
  console.log(`  { size: ${run.size}, exposure: ${run.exposure.toFixed(1)}, cv: ${run.cv.toFixed(4)}, ratios: { ${ratioStr} } },`);
}
console.log('];');

// --- MONOTONICITY assertion at every grid point ---
console.log('\n--- MONOTONICITY CHECK, every grid point ---');
let anyNonMonotonic = false;
for (const run of grid) {
  let prev = -Infinity;
  let ok = true;
  for (const p of PCTS) {
    if (run.ratios[p] <= prev) ok = false;
    prev = run.ratios[p];
  }
  console.log(`  size ${run.size}: ${ok ? 'monotonic' : '*** NOT MONOTONIC ***'}`);
  if (!ok) anyNonMonotonic = true;
}

// --- interpolation function, CV-indexed or 1/sqrt(exposure)-indexed ---
function interpolate(x: number, points: { x: number; ratios: Record<number, number> }[], p: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (x <= sorted[0].x) return sorted[0].ratios[p];
  if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].ratios[p];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (x >= a.x && x <= b.x) {
      const w = (x - a.x) / (b.x - a.x);
      return a.ratios[p] + w * (b.ratios[p] - a.ratios[p]);
    }
  }
  return sorted[sorted.length - 1].ratios[p];
}

// --- held-out validation ---
console.log(`\n--- HELD-OUT VALIDATION: size ${HELD_OUT_SIZE} (not a grid point) ---`);
const heldOutBook = evenSubset(roster, HELD_OUT_SIZE);
const heldOutRun = runBook(heldOutBook);
console.log(`  held-out: exposure $${heldOutRun.exposure.toFixed(0)}M  CV ${heldOutRun.cv.toFixed(4)}  expectedLoss ${fmt$(heldOutRun.expectedLoss)}`);

const cvPoints = grid.map(r => ({ x: r.cv, ratios: r.ratios }));
const invSqrtExpPoints = grid.map(r => ({ x: 1 / Math.sqrt(r.exposure), ratios: r.ratios }));
const heldOutInvSqrtExp = 1 / Math.sqrt(heldOutRun.exposure);

console.log('\n  pctile   true (MC)   interp-by-CV   residual   interp-by-1/sqrt(exp)   residual');
let sumAbsResidCv = 0, sumAbsResidInvSqrt = 0;
for (const p of PCTS) {
  const truth = heldOutRun.ratios[p];
  const viaCv = interpolate(heldOutRun.cv, cvPoints, p);
  const viaInvSqrt = interpolate(heldOutInvSqrtExp, invSqrtExpPoints, p);
  const residCv = viaCv - truth;
  const residInvSqrt = viaInvSqrt - truth;
  sumAbsResidCv += Math.abs(residCv);
  sumAbsResidInvSqrt += Math.abs(residInvSqrt);
  console.log(`  ${String(p).padStart(5)}    ${truth.toFixed(4)}       ${viaCv.toFixed(4)}       ${residCv >= 0 ? '+' : ''}${residCv.toFixed(4)}       ${viaInvSqrt.toFixed(4)}              ${residInvSqrt >= 0 ? '+' : ''}${residInvSqrt.toFixed(4)}`);
}
console.log(`\n  mean |residual| by CV:            ${(sumAbsResidCv / PCTS.length).toFixed(4)}`);
console.log(`  mean |residual| by 1/sqrt(exp):   ${(sumAbsResidInvSqrt / PCTS.length).toFixed(4)}`);
console.log(`  SMOOTHER AXIS: ${sumAbsResidCv <= sumAbsResidInvSqrt ? 'CV' : '1/sqrt(exposure)'}`);

// --- monotonicity of the interpolated held-out curve itself ---
let prevInterp = -Infinity;
let interpMonotonic = true;
for (const p of PCTS) {
  const v = interpolate(heldOutRun.cv, cvPoints, p);
  if (v <= prevInterp) interpMonotonic = false;
  prevInterp = v;
}
console.log(`  interpolated held-out curve (by CV) monotonic: ${interpMonotonic ? 'YES' : '*** NO ***'}`);
if (!interpMonotonic) anyNonMonotonic = true;

// --- where does drawn/expected = 1.000 fall, per book ---
console.log('\n--- WHERE DOES drawn/expected = 1.000 FALL? (linear interp between adjacent stops) ---');
for (const run of [...grid, heldOutRun]) {
  const sortedP = PCTS;
  let crossing = 'below 10%';
  for (let i = 0; i < sortedP.length - 1; i++) {
    const p0 = sortedP[i], p1 = sortedP[i + 1];
    if (run.ratios[p0] <= 1.0 && run.ratios[p1] >= 1.0) {
      const w = (1.0 - run.ratios[p0]) / (run.ratios[p1] - run.ratios[p0]);
      crossing = `${(p0 + w * (p1 - p0)).toFixed(1)}%`;
      break;
    }
  }
  if (run.ratios[sortedP[sortedP.length - 1]] < 1.0) crossing = 'above 99%';
  console.log(`  size ${String(run.size).padStart(3)} (CV ${run.cv.toFixed(3)}): crosses 1.000 at ~${crossing}`);
}

console.log(`\n${anyNonMonotonic ? '*** NON-MONOTONICITY DETECTED — DO NOT SHIP ***' : 'All monotonicity checks pass.'}`);
process.exitCode = anyNonMonotonic ? 1 : 0;
