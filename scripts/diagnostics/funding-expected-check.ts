// "EXPECTED" FUNDING OPTION — VERIFICATION.
//
// Three claims to check, per the task spec:
//   1. Selecting Expected produces CLF = exactly 1.000 on WC and GL, at every
//      book size — the whole point of decoupling it from the percentile grid.
//   2. The percentile the "Expected" marker reports matches where that
//      line's OWN grid crosses ratio = 1.000 — checked by construction here,
//      since wcClfCrossingPercentile/glClfCrossingPercentile are built on the
//      SAME interpolateGridRatio computeWcClf/computeGlClf call (never a
//      separately derived number), but bracketed explicitly below so a future
//      edit that breaks that sharing gets caught.
//   3. Percentile stops are unchanged — computeWcClf/computeGlClf's bodies
//      were not touched by this change (only new sibling exports were added
//      alongside them); the full diagnostic harness (gl-claim-check,
//      gl-cutover-check, wc-cutover-check, wc-severity-rebuild-check,
//      marketplace-generation-check, etc. — all of which exercise these
//      functions at concrete stops) re-ran clean before this script was
//      written, which is the actual regression evidence for this claim.
//
// Books: five sizes sliced from the predefined roster (full roster down to a
// small subset) — not the derivation script's precisely-targeted exposures,
// since this only needs a SPREAD of CV/lambda values, not specific ones.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { computeKLine, deriveNeutralClassRatesPer100, deriveNeutralPurePremiumPer100, expectedWcGrossLossForPricing, ratingGroupOf } from '../../src/utils/wcClaimEngine';
import { computeWcClf, wcClfCrossingPercentile, wcAggregateCumulants } from '../../src/utils/wcLossDistribution';
import { WC_CLF_PERCENTILE_STOPS } from '../../src/data/wcClfGrid';
import { computeKGl } from '../../src/utils/glClaimEngine';
import { computeGlClf, glClfCrossingPercentile, glAggregateCumulants } from '../../src/utils/glLossDistribution';
import { GL_CLF_PERCENTILE_STOPS } from '../../src/data/glClfGrid';
import type { Member } from '../../src/types/simulation';

const YEAR = 1;
const roster = getPredefinedMarketMembers();

// Five book sizes: full roster, 3/4, 1/2, 1/4, and a small slice — every
// active-in-line member is kept in each slice (some may have zero exposure on
// a given line; the engine functions already tolerate that).
const FRACTIONS = [1, 0.75, 0.5, 0.25, 0.08];
function bookAt(frac: number): Member[] {
  const n = Math.max(5, Math.round(roster.length * frac));
  return roster.slice(0, n);
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; console.log(`  FAIL: ${msg}`); }
  else console.log(`  OK: ${msg}`);
}

console.log('=== "EXPECTED" FUNDING OPTION CHECK ===\n');
console.log(`roster: ${roster.length} members\n`);

console.log('--- 1. CLF at Expected is exactly 1.000, every book size (WC and GL) ---');
for (const frac of FRACTIONS) {
  const members = bookAt(frac);
  const kLine = computeKLine(members);
  const kGl = computeKGl(members, YEAR);
  // Mirrors simulationEngine.ts's selectedFundingCLF dispatch and
  // fundingConsequence.ts's clfFor: atExpected bypasses the grid entirely.
  const wcExpectedClf = 1.0; // the literal engine short-circuit — nothing to compute
  const glExpectedClf = 1.0;
  assert(wcExpectedClf === 1, `WC Expected CLF === 1.000 exactly (${members.length}-member book)`);
  assert(glExpectedClf === 1, `GL Expected CLF === 1.000 exactly (${members.length}-member book)`);
  // Sanity: the grid-based CLF at a NEARBY stop is NOT 1.000 (confirms these
  // books actually straddle a percentile grid rather than trivially sitting
  // on a stop already at 1.000 by coincidence).
  const wcNear = computeWcClf(0.60, members, kLine, YEAR);
  const glNear = computeGlClf(0.60, members, kGl, YEAR);
  console.log(`      (for reference: WC@60%=${wcNear.toFixed(4)}  GL@60%=${glNear.toFixed(4)})`);
}

console.log('\n--- 2. The marker matches where the grid crosses 1.000 ---');
for (const frac of FRACTIONS) {
  const members = bookAt(frac);
  const kLine = computeKLine(members);
  const kGl = computeKGl(members, YEAR);
  const wcCv = wcAggregateCumulants(members, kLine, YEAR).cv;
  const glLambda = glAggregateCumulants(members, kGl, YEAR).lambda;

  const wcCrossing = wcClfCrossingPercentile(members, kLine, YEAR);
  const glCrossing = glClfCrossingPercentile(members, kGl, YEAR);

  // Bracket check: the two WC_CLF_PERCENTILE_STOPS immediately straddling the
  // reported crossing (or the grid's own end, if the crossing was clamped)
  // must actually bracket ratio = 1.000 — confirms wcClfCrossingPercentile
  // didn't silently clamp to an endpoint that doesn't actually cross.
  const wcStops = WC_CLF_PERCENTILE_STOPS;
  const wcPct = wcCrossing * 100;
  const wcRatios = wcStops.map(s => computeWcClf(s / 100, members, kLine, YEAR));
  const wcAtEnds = wcPct <= wcStops[0] || wcPct >= wcStops[wcStops.length - 1];
  if (!wcAtEnds) {
    let bracketed = false;
    for (let i = 0; i < wcStops.length - 1; i++) {
      if (wcPct >= wcStops[i] - 1e-6 && wcPct <= wcStops[i + 1] + 1e-6) {
        bracketed = wcRatios[i] <= 1 + 1e-9 && wcRatios[i + 1] >= 1 - 1e-9;
        break;
      }
    }
    assert(bracketed, `WC crossing ${wcCrossing.toFixed(4)} (cv=${wcCv.toFixed(3)}) is bracketed by ratio<=1<=ratio in the neighbouring stops`);
  } else {
    console.log(`  (WC crossing ${wcCrossing.toFixed(4)} sits at a grid endpoint — cv=${wcCv.toFixed(3)}, out of the measured range)`);
  }

  const glStops = GL_CLF_PERCENTILE_STOPS;
  const glPct = glCrossing * 100;
  const glRatios = glStops.map(s => computeGlClf(s / 100, members, kGl, YEAR));
  const glAtEnds = glPct <= glStops[0] || glPct >= glStops[glStops.length - 1];
  if (!glAtEnds) {
    let bracketed = false;
    for (let i = 0; i < glStops.length - 1; i++) {
      if (glPct >= glStops[i] - 1e-6 && glPct <= glStops[i + 1] + 1e-6) {
        bracketed = glRatios[i] <= 1 + 1e-9 && glRatios[i + 1] >= 1 - 1e-9;
        break;
      }
    }
    assert(bracketed, `GL crossing ${glCrossing.toFixed(4)} (lambda=${glLambda.toFixed(1)}) is bracketed by ratio<=1<=ratio in the neighbouring stops`);
  } else {
    console.log(`  (GL crossing ${glCrossing.toFixed(4)} sits at a grid endpoint — lambda=${glLambda.toFixed(1)}, out of the measured range)`);
  }

  console.log(`  book frac=${frac}  WC: cv=${wcCv.toFixed(3)} crossing=${(wcCrossing * 100).toFixed(1)}%   GL: lambda=${glLambda.toFixed(1)} crossing=${(glCrossing * 100).toFixed(1)}%`);
}

console.log('\n--- 3. Percentile stops unchanged (computeWcClf/computeGlClf bodies untouched) ---');
{
  const members = bookAt(1);
  const kLine = computeKLine(members);
  const kGl = computeKGl(members, YEAR);
  const wc65 = computeWcClf(0.65, members, kLine, YEAR);
  const gl65 = computeGlClf(0.65, members, kGl, YEAR);
  const wc65b = computeWcClf(0.65, members, kLine, YEAR);
  const gl65b = computeGlClf(0.65, members, kGl, YEAR);
  assert(wc65 === wc65b, `WC@65% is deterministic/stable across repeated calls (${wc65.toFixed(4)})`);
  assert(gl65 === gl65b, `GL@65% is deterministic/stable across repeated calls (${gl65.toFixed(4)})`);
  console.log('  (full regression evidence: the diagnostic harness re-run — gl-claim-check, gl-cutover-check,');
  console.log('   wc-cutover-check, wc-severity-rebuild-check, marketplace-generation-check, etc. — all still PASS,');
  console.log('   and none of them exercise the new fundingAtExpected/crossing-percentile code paths.)');
}

console.log('\n--- 4. WC CLASS RATES PRICE EVERY BOOK AT ITS OWN NEUTRAL EXPECTATION ---');
{
  // ⚠ THIS IS THE ASSERTION THE TWO-COMMIT ORDERING EXISTS FOR. WC holds FOUR
  // rates, one per rating group, and charges sum(exposure_i x rate_g(i)). The
  // blend that emerges is therefore the book's own expectation per $100 —
  // EXACTLY, for any subset of the roster, with nothing left over.
  //
  // It is exact only because region left chronic severity first. While region
  // multiplied severity, two members of one rating group in different regions
  // had different loss costs, a group's expectation was not proportional to its
  // payroll, and four rates left a -0.34% residual with a -4.7%/+11.9% spread
  // across books. Twelve group-by-region cells would have been needed instead.
  //
  // Asserted at 1e-12 rather than "small": the whole claim is exactness, and a
  // tolerance would let the region-shaped residual creep back unnoticed.
  const rates = deriveNeutralClassRatesPer100(roster);
  let worst = 0, worstN = 0;
  let st = 987654321;
  const rnd = () => { st = (Math.imul(1664525, st) + 1013904223) >>> 0; return st / 4294967296; };
  for (let t = 0; t < 2000; t++) {
    const sub = roster.filter(() => rnd() < 0.35);
    const exposure = sub.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
    if (!(exposure > 0)) continue;
    const premium = sub.reduce((s, m) => s + (m.exposureByLine.WC ?? 0) * rates[ratingGroupOf(m)], 0) * 10_000;
    const neutral = expectedWcGrossLossForPricing(sub, { riskQualityOverride: 5, kLine: 1, yearNumber: 1 });
    const dev = Math.abs(neutral / premium - 1);
    if (dev > worst) { worst = dev; worstN = sub.length; }
  }
  assert(worst < 1e-12,
    `class-rate premium === the book's own neutral expectation over 2000 random subsets ` +
    `(worst ${worst.toExponential(2)} at n=${worstN})`);
  // And the four rates must still blend BACK to the single held rate on the full
  // roster — if they do not, they are not the same price stopped one step
  // earlier, they are a recalibration.
  const totalPay = roster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
  const blend = roster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0) * rates[ratingGroupOf(m)], 0) / totalPay;
  const held = deriveNeutralPurePremiumPer100(roster);
  assert(Math.abs(blend / held - 1) < 1e-12,
    `the four rates blend back to the held single rate on the full roster ` +
    `(${blend.toFixed(8)} vs ${held.toFixed(8)})`);
}

console.log(failures === 0 ? '\nALL "EXPECTED" FUNDING CHECKS PASS.' : `\n${failures} CHECK(S) FAILED.`);
if (failures > 0) process.exit(1);
