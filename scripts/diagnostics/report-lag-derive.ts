// ============================================================================
// THE REPORTING PATTERN — DERIVER AND ASSERTION.
//
// Emits LINE_REPORTING_PATTERN for defaultAssumptions.ts, then asserts the curve
// it just produced reproduces the three figures on record. Run:
//   npx tsx scripts/diagnostics/report-lag-derive.ts
//
// ⚠ THIS EXITS NON-ZERO. It is a GENERATOR, like open-share-derive, but one that
// fails if the emitted curve stops reproducing its own targets.
//
// ============================================================================
// THE THREE FIGURES, AND THEY ARE THE WHOLE EVIDENCE BASE.
//
//   reported counts grow  6.5%  by age 2          defaultAssumptions.ts, the
//   reported counts grow 12.16% age 1 to ultimate  report-lag deletion note and
//   counts still moving   0.25% at age 5           the closure-curve correction
//
// Everything below is pinned by those three and nothing else. There are exactly
// three free parameters in the count curve and exactly three targets, so the
// solve is EXACT and there is no fitting freedom left — which is the point. A
// two-parameter family cannot do it: a Weibull matched on ages 1 and 2 lands at
// 0.61% at age 5 against the recorded 0.25%, and a single geometric at 0.59%.
// The reported count completes FASTER than either, and that is a property of the
// source figures rather than a modelling choice.
//
// ⚠ THE THIRD FIGURE HAS THREE READINGS AND THEY DO NOT AGREE. "Still moving
// 0.25% at age 5" is taken here as a GROWTH RATE, R(5)/R(4) - 1 = 0.0025,
// because that is how the 6.5% is stated. Two alternatives are printed below so
// the choice is visible rather than buried: reading it as an increment of
// ultimate count lands within 0.2% of the same answer, but reading it as the
// share STILL UNREPORTED at age 5 gives a materially fatter tail. Named, not
// resolved — no further evidence exists to resolve it with.
//
// ============================================================================
// ⚠ THE COUNT CURVE IS POOL-LEVEL AND IS NOT SPLIT BY LINE. The three recorded
// figures come from one extract across the whole book. LINE_REPORTING_PATTERN is
// keyed by line so a future per-line fit has somewhere to land, and today all
// three lines carry the SAME numbers. Do not read the per-line keying as
// per-line evidence; there is none.
//
// What DOES differ by line is the VALUE consequence, and that is derived here
// rather than assumed: the same count curve over three different severity mixes
// produces three different dollar effects, because lag is drawn conditional on
// severity.
//
// ============================================================================
// LAG IS DRAWN CONDITIONAL ON SEVERITY, WHICH IS THE CAUSAL DIRECTION.
//
// A claim reports late BECAUSE nobody knew it was a claim — a latent injury, an
// occupational disease, an abuse allegation, a construction defect. Severity
// does not follow from lateness; both follow from the claim being the kind of
// thing that takes years to surface. So the model tilts the PROBABILITY of
// being late by size:
//
//     odds(late | s) = w . F(s)^BETA,   P = odds / (1 + odds)
//
// where F(s) is the claim's QUANTILE in its own line's severity distribution and
// w is solved per line so the expected late COUNT share equals the recorded
// 10.84%. The odds form keeps P inside [0,1] at every size without a clamp; a
// clamp would make every largest claim late, which is stronger than the evidence
// supports.
//
// ⚠ THE TILT IS ON RANK, NOT ON SIZE, AND THE SIZE VERSION WAS MEASURED AND
// REJECTED. `odds ∝ (s/s_median)^BETA` is the obvious form and it is unusable
// here: GL's severity is Pareto with alpha 1.3, so s/median runs to four and
// five figures in the tail and odds proportional to it make every large claim
// late with certainty. At BETA = 1 it returns a multiplier of 49.1x on GL and
// 30.7x on WC with 86% of all dollars in late claims — not a late-reporting
// assumption, a restatement of the tail. F(s) is uniform whatever the tail does,
// so BETA means the same thing on all three lines and the multiplier is set by
// the severity distribution's own conditional means. Both families are printed
// below; do not "simplify" the rank tilt back to the size one.
//
// ⚠ AND THAT MAKES THE SEVERITY MULTIPLIER AN OUTPUT — BUT IT DOES NOT REMOVE
// THE JUDGEMENT, AND SAYING SO IS THE POINT. E[s | late] / E[s | timely] is not
// chosen here; it falls out of each line's own drawn severity population, and it
// differs by line because the mixes differ. What it does NOT do is reduce the
// number of imposed parameters: BETA replaces the multiplier one for one. There
// is exactly ONE degree of freedom the recorded data does not pin, and every
// parameterisation — BETA, the multiplier, the late value share, an odds ratio
// between size bands — is a different coordinate on that same one number.
//
// What the causal form buys is real but narrower than "one fewer chosen number":
// the SHAPE of how the judgement distributes across claims is defensible, the
// multiplier varies by line off each line's own mix rather than being imposed
// uniformly, and BETA = 1 has a natural reading on a rank scale ("the odds of
// reporting late scale linearly with where the claim sits in its own size
// distribution") where no multiplier has a natural default. BETA is a judgement
// of exactly the same standing as CLAIM_REVISION_PHI and IBNER_TOTAL_SD.
//
// ⚠ THE RECORDED FIGURES CANNOT PIN BETA. All three are COUNT figures. They
// carry no severity information whatsoever, and no amount of care with them will
// produce one. The sweep below is printed so the reader sees the range.
//
// ⚠ LAG LENGTH IS NOT ALSO TILTED BY SEVERITY, and that is deliberate and
// conservative. Causally it should be — a latent claim is both bigger and slower
// — but the aggregate count curve is already pinned by the three figures, so a
// second severity channel would add a parameter without adding evidence. Leaving
// it out UNDERSTATES the multiplier. Say so rather than claim the estimate is
// centred.
//
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { initialEstimate } from '../../src/utils/claimTriangle';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { LINE_REPORTING_PATTERN, REPORT_LAG_SEVERITY_BETA, reportedShareAtAge } from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const RULE = '='.repeat(94);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = Number(process.env.YEARS ?? 40);
const MAX_AGE = 12;
const members = getPredefinedMarketMembers();

// --- THE THREE RECORDED FIGURES ---------------------------------------------
const GROWTH_TO_AGE_2 = 0.065;      // reported count age 2 / age 1
const GROWTH_TO_ULTIMATE = 0.1216;  // reported count ultimate / age 1
const GROWTH_AT_AGE_5 = 0.0025;     // reported count age 5 / age 4
/** THE JUDGEMENT. Read from the shipped constant, not restated — see the header. */
const BETA = REPORT_LAG_SEVERITY_BETA;
/** Tolerance on the reproduction assertions — these are solved, not fitted. */
const TOL = 1e-9;

let failures = 0;
const fail = (s: string) => { failures++; console.log(`  FAIL  ${s}`); };

// ============================================================================
// 1. SOLVE THE COUNT CURVE. Three parameters, three targets, exact.
//
//   U(1) = unreported share at age 1
//   U(2) = U(1) . d1
//   U(a) = U(2) . d2^(a-2)   for a >= 2
// ============================================================================
const U1 = 1 - 1 / (1 + GROWTH_TO_ULTIMATE);
const R1 = 1 - U1;
const R2 = R1 * (1 + GROWTH_TO_AGE_2);
const U2 = 1 - R2;
const D1 = U2 / U1;
// R(5)/R(4) = 1 + g5  =>  U2.d2^2.(1 + g5 - d2) = g5
const d2Of = (d: number) => U2 * d * d * (1 + GROWTH_AT_AGE_5 - d) - GROWTH_AT_AGE_5;
let lo = 1e-9, hi = 0.999;
for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (d2Of(m) < 0) lo = m; else hi = m; }
const D2 = (lo + hi) / 2;

/** Share of ultimate count still unreported at `age` (1-based). */
const unreportedAt = (a: number) => (a <= 1 ? U1 : U2 * Math.pow(D2, a - 2));
const reportedAt = (a: number) => 1 - unreportedAt(a);

console.log(RULE);
console.log('THE REPORTING PATTERN — DERIVER AND ASSERTION');
console.log(RULE);
console.log(`  targets: +${(100 * GROWTH_TO_AGE_2).toFixed(2)}% by age 2, `
  + `+${(100 * GROWTH_TO_ULTIMATE).toFixed(2)}% age 1 to ultimate, `
  + `+${(100 * GROWTH_AT_AGE_5).toFixed(2)}% at age 5\n`);
console.log(`  SOLVED   unreportedAtAge1 ${U1.toFixed(6)}   firstStepDecay ${D1.toFixed(6)}   laterStepDecay ${D2.toFixed(6)}`);
console.log('\n  the curve — share of ULTIMATE COUNT reported by age');
console.log('  age    ' + Array.from({ length: MAX_AGE }, (_, i) => String(i + 1).padStart(9)).join(''));
console.log('  R(a)   ' + Array.from({ length: MAX_AGE }, (_, i) => reportedAt(i + 1).toFixed(6).padStart(9)).join(''));
console.log('  growth ' + Array.from({ length: MAX_AGE }, (_, i) =>
  (i === 0 ? '' : `${(100 * (reportedAt(i + 1) / reportedAt(i) - 1)).toFixed(3)}%`).padStart(9)).join(''));

console.log('\n  ASSERTIONS — the three recorded figures, reproduced not approached');
const check = (name: string, got: number, want: number) => {
  const ok = Math.abs(got - want) <= TOL;
  console.log(`    ${name.padEnd(34)} got ${got.toFixed(9)}  want ${want.toFixed(9)}   ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail(`${name}: ${got} against ${want}`);
};
check('growth age 1 -> 2', reportedAt(2) / reportedAt(1) - 1, GROWTH_TO_AGE_2);
check('growth age 1 -> ultimate', 1 / reportedAt(1) - 1, GROWTH_TO_ULTIMATE);
check('growth age 4 -> 5', reportedAt(5) / reportedAt(4) - 1, GROWTH_AT_AGE_5);

// ⚠ AND THE SHIPPED CONSTANT MUST BE WHAT THIS SOLVE PRODUCES. Without this the
// deriver and defaultAssumptions.ts are two independent statements of one fact
// and will drift the first time either is touched. This is the assertion that
// makes the file a gate rather than a generator.
console.log('\n  THE SHIPPED CONSTANT AGAINST THE SOLVE — they must not drift');
for (const line of LINES) {
  const p = LINE_REPORTING_PATTERN[line];
  const near = (a: number, b: number) => Math.abs(a - b) <= 5e-7;
  const ok = p && near(p.unreportedAtAge1, U1) && near(p.firstStepDecay, D1) && near(p.laterStepDecay, D2);
  console.log(`    ${line.padEnd(9)} shipped ${p.unreportedAtAge1.toFixed(6)} / ${p.firstStepDecay.toFixed(6)} / ${p.laterStepDecay.toFixed(6)}`
    + `   solved ${U1.toFixed(6)} / ${D1.toFixed(6)} / ${D2.toFixed(6)}   ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail(`${line}: LINE_REPORTING_PATTERN has drifted from the solve`);
}

// ⚠ AND THE SHIPPED ACCESSOR MUST REPRODUCE THE THREE FIGURES, AT ITS OWN
// PRECISION. Two tolerances, and the difference is not slack — it is the
// rounding. The SOLVE is exact and is asserted at 1e-9. The SHIPPED constants
// are written to six decimals, so the curve a consumer actually reads
// reproduces the targets to about 1e-6, not to 1e-9. Asserting the accessor at
// the solve's tolerance would fail on the rounding alone and say nothing; not
// asserting it at all would leave the only curve anything will ever call
// unchecked. So it is asserted at 1e-5 on the growth rates — three orders
// tighter than the two significant figures the source quotes.
const SHIPPED_TOL = 1e-5;
console.log('\n  THE SHIPPED ACCESSOR AGAINST THE THREE FIGURES — this is the curve consumers read');
for (const line of LINES) {
  const g2 = reportedShareAtAge(line, 2) / reportedShareAtAge(line, 1) - 1;
  const gu = 1 / reportedShareAtAge(line, 1) - 1;
  const g5 = reportedShareAtAge(line, 5) / reportedShareAtAge(line, 4) - 1;
  const ok = Math.abs(g2 - GROWTH_TO_AGE_2) <= SHIPPED_TOL
    && Math.abs(gu - GROWTH_TO_ULTIMATE) <= SHIPPED_TOL
    && Math.abs(g5 - GROWTH_AT_AGE_5) <= SHIPPED_TOL;
  console.log(`    ${line.padEnd(9)} age1->2 ${(100 * g2).toFixed(4)}%   age1->ult ${(100 * gu).toFixed(4)}%`
    + `   age4->5 ${(100 * g5).toFixed(4)}%   ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) fail(`${line}: the shipped accessor does not reproduce the three figures within ${SHIPPED_TOL}`);
}

console.log('\n  ⚠ THE THIRD FIGURE\'S OTHER READINGS, printed so the choice is visible:');
const solveD2 = (f: (d: number) => number) => {
  let a = 1e-9, b = 0.999;
  for (let i = 0; i < 200; i++) { const m = (a + b) / 2; if (f(m) < 0) a = m; else b = m; }
  return (a + b) / 2;
};
const d2Increment = solveD2(d => U2 * d * d * (1 - d) - GROWTH_AT_AGE_5);      // R(5)-R(4) = 0.0025
const d2Remaining = solveD2(d => U2 * Math.pow(d, 3) - GROWTH_AT_AGE_5);        // U(5) = 0.0025
console.log(`    growth rate at age 5 (ADOPTED)     laterStepDecay ${D2.toFixed(6)}`);
console.log(`    increment of ultimate count        laterStepDecay ${d2Increment.toFixed(6)}   (${(100 * (d2Increment / D2 - 1)).toFixed(1)}% from adopted)`);
console.log(`    share STILL UNREPORTED at age 5    laterStepDecay ${d2Remaining.toFixed(6)}   (${(100 * (d2Remaining / D2 - 1)).toFixed(1)}% from adopted — a materially fatter tail)`);

// ============================================================================
// 2. THE SEVERITY TILT. Draw the population, solve w per line, read out the
//    multiplier and the dollar consequence.
// ============================================================================
function register(line: CoverageLine): number[] {
  const out: number[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const base = { members, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 7_300_000 + y * 7919, riskControlEffectiveness: 0 };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
        : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) out.push(c.grossUltimate);
  }
  return out;
}

/**
 * P(late | s), with w solved so the expected late COUNT share equals U1.
 *
 * TWO FAMILIES, BOTH MEASURED, BECAUSE THE OBVIOUS ONE FAILS.
 *
 *   'value'  odds ∝ (s / s_median)^BETA
 *   'rank'   odds ∝ (F(s))^BETA,  F = the claim's quantile in its own line
 *
 * ⚠ THE VALUE TILT IS UNUSABLE ON THESE SEVERITY DISTRIBUTIONS AND THAT IS A
 * FINDING, NOT A TUNING PROBLEM. GL's severity is Pareto with alpha 1.3, so
 * s/median runs to four and five figures in the tail; odds proportional to it
 * make every large claim late with certainty. At BETA = 1 — the "natural"
 * default — it returns a multiplier of 49x on GL and 31x on WC, with 86% of all
 * dollars in late claims. That is not a late-reporting assumption, it is a
 * restatement of the tail.
 *
 * The RANK tilt is scale-free by construction: F(s) is uniform whatever the
 * tail does, so BETA means the same thing on all three lines and the multiplier
 * is set by the severity distribution's own conditional means rather than by
 * how far the tilt can run. It is the family shipped.
 */
function tilt(sev: number[], beta: number, family: 'value' | 'rank') {
  const sorted = [...sev].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const med = sorted[Math.floor(sorted.length / 2)].v || 1;
  const score = new Array<number>(sev.length);
  if (family === 'rank') {
    // mid-rank quantile, so the largest claim is not F = 1 exactly
    sorted.forEach((x, r) => { score[x.i] = (r + 0.5) / sev.length; });
  } else {
    for (let k = 0; k < sev.length; k++) score[k] = Math.max(sev[k], 1e-9) / med;
  }
  const p = (w: number) => score.map(x => {
    const o = w * Math.pow(x, beta);
    return o / (1 + o);
  });
  const meanOf = (w: number) => p(w).reduce((a, b) => a + b, 0) / sev.length;
  let a = 1e-12, b = 1e12;
  for (let i = 0; i < 300; i++) { const m = Math.sqrt(a * b); if (meanOf(m) < U1) a = m; else b = m; }
  const w = Math.sqrt(a * b);
  return { w, prob: p(w), median: med };
}

type Row = { line: string; family: string; beta: number; mult: number; valueShare: number; emerge2: number; emergeInit2: number; check: number };
const rows: Row[] = [];
const BETAS = [0, 0.5, 1.0, 2.0, 4.0];
const FAMILY: 'value' | 'rank' = 'rank';

for (const line of LINES) {
  const sev = register(line);
  for (const family of ['rank', 'value'] as const) for (const beta of BETAS) {
    const { prob } = tilt(sev, beta, family);
    let sLate = 0, wLate = 0, sTimely = 0, wTimely = 0, sAll = 0;
    // value reported by age a, drawn basis and CONTRACTED basis (what the engine books)
    let v1 = 0, v2 = 0, i1 = 0, i2 = 0;
    for (let k = 0; k < sev.length; k++) {
      const s = sev[k], w = prob[k], init = initialEstimate(line, s);
      sLate += w * s; wLate += w; sTimely += (1 - w) * s; wTimely += 1 - w; sAll += s;
      // P(reported by age a) = (1-w) + w . (1 - U(a)/U(1))
      const byAge = (a: number) => (1 - w) + w * (1 - unreportedAt(a) / U1);
      v1 += s * byAge(1); v2 += s * byAge(2);
      i1 += init * byAge(1); i2 += init * byAge(2);
    }
    rows.push({ line, family, beta,
      mult: (sLate / wLate) / (sTimely / wTimely),
      valueShare: sLate / sAll,
      emerge2: v2 / v1,
      emergeInit2: i2 / i1,
      check: wLate / sev.length });
  }
  console.log(`\n  ${line}: ${sev.length.toLocaleString()} drawn claims over ${YEARS} accident years`);
}

console.log('\n' + RULE);
console.log('THE SEVERITY MULTIPLIER IS AN OUTPUT — swept over BETA, shipped at BETA = ' + BETA.toFixed(2));
console.log(RULE);
console.log('  BETA is a judgement. The three recorded figures are COUNT figures and pin none of it.');
console.log('  E[s|late]/E[s|timely] and the dollar effect below fall out of each line\'s own severity mix.\n');
for (const family of ['rank', 'value'] as const) {
  console.log(`\n  --- ${family.toUpperCase()} TILT${family === FAMILY ? '  (SHIPPED)' : '  (measured and rejected — see tilt())'} ---`);
  console.log('  line       BETA   late count   E[s|late]/E[s|timely]   late VALUE share   emergence factor at age 2');
  console.log('                       share                                                  drawn      as booked');
  for (const line of LINES) {
    for (const r of rows.filter(x => x.line === line && x.family === family)) {
      const shipped = family === FAMILY && Math.abs(r.beta - BETA) < 1e-9;
      console.log(`  ${(shipped ? '> ' : '  ') + line.padEnd(9)} ${r.beta.toFixed(2).padStart(5)} `
        + `${(100 * r.check).toFixed(2).padStart(11)}% ${r.mult.toFixed(3).padStart(22)} `
        + `${(100 * r.valueShare).toFixed(2).padStart(17)}% ${r.emerge2.toFixed(4).padStart(13)} ${r.emergeInit2.toFixed(4).padStart(14)}`);
    }
  }
}
console.log('\n  late count share must equal the recorded 10.84% on every row — that is the solve, not a result.');
for (const r of rows) {
  if (Math.abs(r.check - U1) > 1e-6) fail(`${r.line} BETA ${r.beta}: late count share ${r.check} against ${U1}`);
}

// ============================================================================
// 3. THE VERDICT ON THE MODEL'S SEVERITY DEVELOPMENT.
// ============================================================================
const MODEL_FIRST_FACTOR = 1.448;   // GL, measured age 1->2 on the flagged arm
const POOL_FIRST_FACTOR = 1.872;    // GL, the pool's own book
console.log('\n' + RULE);
console.log('WHAT IT IMPLIES ABOUT THE MODEL\'S SEVERITY DEVELOPMENT — GL, the line the gap was measured on');
console.log(RULE);
console.log(`  The model's GL age 1->2 factor is ${MODEL_FIRST_FACTOR} and is PURE SEVERITY on a frozen register.`);
console.log(`  The pool's is ${POOL_FIRST_FACTOR} and is severity x emergence. Emergence supplied here:\n`);
console.log('  BETA   emergence at age 2   severity left to explain   model\'s 1.448 is...');
for (const r of rows.filter(x => x.line === 'GL' && x.family === FAMILY)) {
  const left = POOL_FIRST_FACTOR / r.emergeInit2;
  const verdict = MODEL_FIRST_FACTOR / left - 1;
  console.log(`  ${r.beta.toFixed(2).padStart(4)} ${r.emergeInit2.toFixed(4).padStart(19)} ${left.toFixed(4).padStart(26)}`
    + `   ${(verdict >= 0 ? '+' : '') + (100 * verdict).toFixed(1)}%`
    + (Math.abs(r.beta - BETA) < 1e-9 ? '   <-- SHIPPED' : ''));
}
console.log('\n  Read the last column as: how far the model\'s severity development sits from what the pool\'s');
console.log('  first factor requires, ONCE this emergence is credited. Negative = the model is short.');
console.log('  ⚠ NOTHING HERE WAS SIZED TO CLOSE THAT GAP. BETA was chosen a priori at 1.0 — the odds of');
console.log('    reporting late scaling linearly with the claim\'s size RANK — and the column is reported,');
console.log('    not aimed at. At no BETA in the sweep does the emergence alone account for the gap.');

console.log('\n' + RULE);
if (failures > 0) { console.log(`${failures} FAILURE(S) — the emitted curve does not reproduce its own targets.`); process.exitCode = 1; }
else {
  console.log('EMIT — paste into defaultAssumptions.ts:\n');
  console.log('export const LINE_REPORTING_PATTERN: Record<string, ReportingPattern> = {');
  for (const l of LINES) {
    console.log(`  ${l}: { unreportedAtAge1: ${U1.toFixed(6)}, firstStepDecay: ${D1.toFixed(6)}, laterStepDecay: ${D2.toFixed(6)} },`);
  }
  console.log('};');
}
console.log(RULE);
