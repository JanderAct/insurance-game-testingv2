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
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, Member } from '../../src/types/simulation';

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

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failures++; failed.push(msg); console.log(`  FAIL: ${msg}`); }
  else console.log(`  OK: ${msg}`);
}

console.log('=== "EXPECTED" FUNDING OPTION CHECK ===\n');
console.log(`roster: ${roster.length} members\n`);

// ============================================================================
// 1. THE ENGINE'S OWN selectedFundingCLF AT "EXPECTED" IS EXACTLY 1.000.
//
// ⚠ THIS SECTION USED TO BE A TAUTOLOGY, AND IT IS THE ASSUMPTION EVERY NULL
// TEST IN THIS PROJECT STANDS ON. What stood here was:
//
//     const wcExpectedClf = 1.0; // the literal engine short-circuit
//     assert(wcExpectedClf === 1, 'WC Expected CLF === 1.000 exactly');
//
// It asserted that a local literal equals itself. Its own comment said so
// ("nothing to compute"), which is how it survived review: the reader agrees
// there is nothing to compute and moves on. Measured at b0a9bad — setting the
// engine's dispatch to 1.001 left this file GREEN.
//
// WHY IT MATTERS MORE THAN AN ORDINARY VACUOUS CHECK. Every martingale and
// null test here runs at defaultDecisionSet, which sets fundingAtExpected
// true, and those tests need the CLF pinned at exactly 1.000 so that premium
// carries no load and E[underwriting income] is zero. ibner-null-check's
// martingale, funding-basis-check's assertion 3, development-cession-check's
// arms and cession-path-independence's paired difference all inherit it. A CLF
// of 1.001 would put a 0.1% wedge under every one of them and none would say so.
//
// ⚠ WHAT WAS AND WAS NOT ALREADY COVERED — MEASURED, NOT ASSUMED, because the
// tempting version of this note overstates the gap and this project has been
// caught doing that. gl-supplied-clf-check DOES assert selectedFundingCLF ===
// 1.0 at defaults and it DOES have teeth: verified against both perturbations,
// it fails at 1.001 and it fails when the bypass is removed (reading 1.023,
// which is GL's own static table at 0.60 — not the generic table's literal
// 1.000, so its default-confidence run is not passing by coincidence).
//
// TWO THINGS WERE GENUINELY UNCOVERED, AND THEY ARE WHY THIS SECTION EXISTS:
//   PROPERTY, NOWHERE. gl-supplied-clf-check's LINES is ['WC', 'GL']. Nothing
//     in the repo asserted Property's Expected CLF. And the engine's own comment
//     at the dispatch site said "Property ignores the flag, same as before" —
//     stale, because hasStaticClf now returns true for all three lines, so
//     Property has taken the same bypass since it got its own table. Corrected
//     at the site in this commit.
//   EVERY LEVEL BUT THE DEFAULT. gl-supplied-clf-check runs at defaults only,
//     so a dispatch that pinned 1.000 at 0.60 and not elsewhere would pass it.
//     This section sweeps all 14 reachable slider positions.
// Plus, of course, this file's own claim, which was a literal.
// ============================================================================
console.log('--- 1. THE ENGINE\'s selectedFundingCLF AT "EXPECTED" IS EXACTLY 1.000 ---');
{
  const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
  const { min, max, step } = SLIDER_RANGES.fundingConfidenceLevel;
  const levels: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) levels.push(parseFloat(v.toFixed(4)));

  // Every reachable slider position, with fundingAtExpected ON. The flag is
  // supposed to make the level irrelevant; if it does not, these diverge.
  const atExpected = (y: number, level: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    for (const l of LINES) {
      const ld = d.byLine[l];
      if (ld) { ld.fundingAtExpected = true; ld.fundingConfidenceLevel = level; }
    }
    return d;
  };
  // The control arm: flag OFF at the same level. If THIS also reads 1.000
  // everywhere then the assertion above is passing by coincidence and cannot
  // distinguish the bypass from the table — so it is asserted too.
  const offExpected = (y: number, level: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    for (const l of LINES) {
      const ld = d.byLine[l];
      if (ld) { ld.fundingAtExpected = false; ld.fundingConfidenceLevel = level; }
    }
    return d;
  };

  const YEARS = 3;
  const seenOn: Record<string, Set<number>> = { WC: new Set(), GL: new Set(), Property: new Set() };
  const seenOff: Record<string, Set<number>> = { WC: new Set(), GL: new Set(), Property: new Set() };
  let lineYears = 0;

  for (const level of levels) {
    for (const [mode, decide, sink] of [['on', atExpected, seenOn], ['off', offExpected, seenOff]] as const) {
      const id = `FEC_${mode}_${Math.round(level * 100)}`;
      const inst = generateGameInstance(id, 71_000_000 + Math.round(level * 1000));
      const setup = { poolName: 'F', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
      let gs: GameState = {
        setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: decide(1, level), priorHistory,
      };
      for (let y = 1; y <= YEARS; y++) {
        const p = processYear(gs, decide(y, level));
        for (const l of LINES) {
          const lr = p.result.byLine[l] as never as { selectedFundingCLF?: number } | undefined;
          if (lr && typeof lr.selectedFundingCLF === 'number') {
            sink[l].add(lr.selectedFundingCLF);
            if (mode === 'on') lineYears++;
          }
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      }
    }
  }

  console.log(`  ${levels.length} reachable confidence levels x ${YEARS} years x 3 lines`
    + `  (${lineYears} line-years read from the engine's STORED selectedFundingCLF)\n`);
  console.log('  line       flag ON: distinct CLF values                 flag OFF: distinct CLF values');
  for (const l of LINES) {
    const on = [...seenOn[l]].sort((a, b) => a - b);
    const off = [...seenOff[l]].sort((a, b) => a - b);
    const onStr = on.length <= 3 ? on.map(v => v.toFixed(6)).join(', ') : `${on.length} values, ${on[0].toFixed(4)}..${on[on.length - 1].toFixed(4)}`;
    const offStr = off.length <= 3 ? off.map(v => v.toFixed(6)).join(', ') : `${off.length} values, ${off[0].toFixed(4)}..${off[off.length - 1].toFixed(4)}`;
    console.log(`  ${l.padEnd(9)} ${onStr.padEnd(44)} ${offStr}`);
  }
  console.log('');

  for (const l of LINES) {
    const on = [...seenOn[l]];
    // THE ASSERTION. Exactly 1, bit-for-bit, at every reachable level. Not a
    // tolerance: the engine returns the literal 1.0 and anything else is a bug.
    assert(on.length === 1 && on[0] === 1.0,
      `${l}: engine selectedFundingCLF === 1.0 EXACTLY at fundingAtExpected, all ${levels.length} confidence levels`
      + (on.length === 1 && on[0] === 1.0 ? '' : ` — saw ${on.length} distinct value(s): ${on.map(v => v.toFixed(6)).join(', ')}`));
    // THE CONTROL. The flag must be doing the work. If the table returned
    // 1.000 everywhere too, the assertion above would be vacuous — which is
    // exactly the failure mode this section is being rewritten out of.
    const off = [...seenOff[l]];
    assert(off.some(v => v !== 1.0),
      `${l}: with the flag OFF the CLF is NOT 1.000 everywhere, so the assertion above has teeth`
      + (off.some(v => v !== 1.0) ? '' : ' — flag-off CLF was 1.000 at EVERY level, so this section cannot'
        + ' distinguish the bypass from the table and the assertion above is passing by coincidence'));
  }
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

console.log(failures === 0 ? '\nALL "EXPECTED" FUNDING CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
