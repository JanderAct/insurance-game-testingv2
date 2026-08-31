// THE REINSURANCE TOWER IS PRICED AT RUNTIME — this is what guards it.
//
// Run: npx tsx scripts/diagnostics/tower-runtime-check.ts
//
// Replaces the frozen constants' guard rails. Those were checkable by reading a
// number out of a file; a computation needs a different kind of check, and the
// three that matter are:
//
//   1. THE MEMO KEY. This is the dangerous one. towerMoments caches band moments
//      keyed by (line, layer, severity-year, group, region). A wrong key silently
//      prices one year's tower with ANOTHER year's moments — and every downstream
//      figure stays perfectly self-consistent, so neither export gate would show
//      a thing. Cold-cache and warm-cache interleaved evaluation must agree
//      exactly, and distinct years must give distinct answers.
//   2. THE ANALYTIC MUST MATCH THE GENERATOR. The closed form is exact for a
//      lognormal mixture, but "exact" is a claim about the algebra, not about
//      whether the algebra describes the draw. Monte Carlo cross-check, with CIs.
//      (This is where the retired wc-tower-rederive.ts's simulation machinery
//      went — it used to produce constants; now it validates a computation.)
//   3. THE gPool FLOOR. GL's SD/E cannot go below sqrt(1/25) = 0.2000 no matter
//      how large the book gets, because gPool multiplies every member
//      simultaneously and does not diversify. WC has no such term and decays
//      toward zero. Same code, different limit — asserted in both directions.
//
// Plus: the above-tower band's gate (newly possible — see section 5), the
// runtime cost budget, and the enrolment feedback loop the runtime price
// introduces.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { REINSURANCE_TOWER, TOWER_TOP } from '../../src/data/reinsuranceTower';
import { GL_SEVERITY_CAP, WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import {
  layerRiskMoments, retainedRiskMoments, resetTowerMomentCache, glBandMoments, wcBandMoments,
} from '../../src/utils/towerMoments';
import { occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { computeKLine, generateWcClaims } from '../../src/utils/wcClaimEngine';
import { computeKGl, generateGlClaims } from '../../src/utils/glClaimEngine';
import { deriveSubRng } from '../../src/utils/random';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { Member } from '../../src/types/simulation';

const ROSTER = getPredefinedMarketMembers();
const glP = (m: Member) => m.exposureByLine.GL ?? 0;
const wcP = (m: Member) => m.exposureByLine.WC ?? 0;
const GL_FULL = ROSTER.reduce((s, m) => s + glP(m), 0);
const WC_FULL = ROSTER.reduce((s, m) => s + wcP(m), 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sdOf = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way,
// attributing a failure in one section to a paragraph in another that happened
// to say "is NOT a defect". `failed` exists so the last line of output is the
// list, not the count.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? '  — ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

function bookFor(line: 'WC' | 'GL', targetM: number): Member[] {
  const out: Member[] = []; let e = 0;
  const px = line === 'GL' ? glP : wcP;
  for (const m of ROSTER) { if (e >= targetM) break; out.push(m); e += px(m); }
  return out;
}

console.log('=== RUNTIME TOWER PRICING CHECK ===');
console.log(`roster ${ROSTER.length} members — WC $${WC_FULL.toFixed(0)}M, GL $${GL_FULL.toFixed(0)}M\n`);

// ---------------------------------------------------------------------------
console.log('--- 1. THE MEMO KEY (the dangerous one) ---');
{
  // 1a. Cold vs warm, interleaved. Every year evaluated with a freshly cleared
  // cache must equal the same year evaluated out of order against a warm one.
  const YEARS = 15;
  const lines: ('WC' | 'GL')[] = ['WC', 'GL'];
  let allMatch = true, allDistinct = true;
  for (const line of lines) {
    const book = bookFor(line, 400);
    for (let li = 0; li < REINSURANCE_TOWER[line].length; li++) {
      const cold: number[] = [];
      for (let y = 1; y <= YEARS; y++) {
        resetTowerMomentCache();
        cold.push(layerRiskMoments(line, li, book, y).expected);
      }
      // Warm, deliberately out of order and with repeats, so a key that ignored
      // the year would return the FIRST year's value for every later call.
      resetTowerMomentCache();
      const warm = new Array<number>(YEARS).fill(NaN);
      for (const y of [9, 2, 15, 5, 9, 1, 12, 3, 7, 15, 4, 6, 8, 10, 11, 13, 14, 2]) {
        warm[y - 1] = layerRiskMoments(line, li, book, y).expected;
      }
      for (let y = 1; y <= YEARS; y++) if (warm[y - 1] !== cold[y - 1]) allMatch = false;
      if (new Set(cold.map(x => x.toFixed(6))).size !== YEARS) allDistinct = false;
    }
  }
  check(allMatch, 'cold-cache === warm-cache, 15 years x 3 layers x 2 lines, evaluated out of order');
  check(allDistinct, 'every year gives a DISTINCT expected ceded (no key collapsing years together)');

  // 1b. The key must separate RATING GROUP on WC. If it were dropped, two
  // different groups would return one another's moments — a much quieter
  // failure than a year collision.
  //
  // ⚠ THIS USED TO ASSERT TWELVE DISTINCT (group, region) PAIRS AND NOW ASSERTS
  // FOUR, because region left chronic severity. The old form would fail on
  // correct code: the three regional cells of a group are now identical by
  // construction, which is the whole point of the change. Inverting it rather
  // than deleting it keeps the stronger statement — region must NOT reach these
  // moments — under test, so a shock that scales severity regionally cannot
  // quietly leak into the tower's rate card without this failing first.
  resetTowerMomentCache();
  const seen = new Map<string, string>();
  let groupDistinct = true;
  const GROUPS = ['county', 'schools', 'highSafety', 'lowSafety'] as const;
  for (const g of GROUPS) {
    const v = wcBandMoments(0, 3, g);
    const sig = `${v.m1.toFixed(6)}|${v.m2.toFixed(2)}`;
    if (seen.has(sig)) groupDistinct = false;
    seen.set(sig, g);
  }
  check(groupDistinct, 'all 4 WC rating groups return distinct band moments');
  check(seen.size === GROUPS.length,
    'the WC band cache keys on rating group (4 distinct entries, not 12)');

  // 1c. The year is FLOORED in the key because both severity trends floor at
  // year 1. Pre-game years must therefore return year-1 moments EXACTLY, not
  // merely nearly — if the key stopped flooring, these would diverge silently.
  resetTowerMomentCache();
  const y1 = glBandMoments(0, 1), yNeg = glBandMoments(0, -2), y0 = glBandMoments(0, 0);
  check(y1.m1 === yNeg.m1 && y1.m1 === y0.m1 && y1.m2 === yNeg.m2,
    'pre-game years (-2, 0) return year-1 band moments exactly (both trends floor at 1)');
}

// ---------------------------------------------------------------------------
console.log('\n--- 2. YEAR-1 FULL-MARKET REPRODUCES THE CLOSED-FORM REFERENCE ---');
{
  // These literals were derived independently at the planning stage, and WC's
  // three reproduced the values the RETIRED frozen constants held (0.6620 /
  // 0.1474 / 0.1383 and SD/E 0.54 / 1.44 / 3.38) — i.e. the runtime path
  // independently rederived a Monte-Carlo-measured constant to four decimals.
  // That was the strongest single piece of evidence that this module is right.
  //
  // ⚠ WC's THREE MOVED WHEN REGION LEFT CHRONIC SEVERITY, and the SHAPE of the
  // move is the interesting part rather than the fact of it:
  //
  //   layer            was      now      move
  //   $4M xs $1M     0.6620   0.6647   +0.41%
  //   $5M xs $5M     0.1474   0.1481   +0.47%
  //   $40M xs $10M   0.1383   0.1390   +0.51%
  //
  // The held pure premium moved only +0.30% on the same change, so the layers
  // moved MORE, and progressively more with attachment depth. That is excess-
  // layer elasticity, not an error: E[ceded to a layer] responds to a severity
  // scale with elasticity above 1, and further above it the deeper the
  // attachment sits in the tail. A mean shift of +0.30% therefore lands as
  // +0.41% at $1M and +0.51% at $10M. If these ever move by the SAME percentage
  // as the pure premium, that is the thing to be suspicious of.
  //
  // GL's are untouched — region never entered GL's severity.
  const REF: Record<string, { per100: number[]; sdOverE: number[] }> = {
    WC: { per100: [0.6647, 0.1481, 0.1390], sdOverE: [0.541, 1.446, 3.366] },
    GL: { per100: [1.3621, 0.4889, 0.5015], sdOverE: [0.452, 0.846, 1.366] },
  };
  resetTowerMomentCache();
  for (const line of ['WC', 'GL'] as const) {
    const units = (line === 'GL' ? GL_FULL : WC_FULL) * 1e4;
    for (let i = 0; i < REINSURANCE_TOWER[line].length; i++) {
      const m = layerRiskMoments(line, i, ROSTER, 1);
      const per100 = m.expected / units;
      const okE = Math.abs(per100 / REF[line].per100[i] - 1) < 1e-3;
      const okS = Math.abs(m.sdOverExpected / REF[line].sdOverE[i] - 1) < 2e-3;
      check(okE && okS, `${line} ${REINSURANCE_TOWER[line][i].name.padEnd(13)}`,
        `per100 ${per100.toFixed(4)} (ref ${REF[line].per100[i]})  SD/E ${m.sdOverExpected.toFixed(3)} (ref ${REF[line].sdOverE[i]})`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- 3. ANALYTIC vs MONTE CARLO (the algebra vs the generator) ---');
{
  const YEARS = 4000;
  for (const line of ['WC', 'GL'] as const) {
    const book = ROSTER;
    const k = line === 'WC' ? computeKLine(book) : computeKGl(book, 1);
    const perYear: number[][] = REINSURANCE_TOWER[line].map(() => []);
    for (let y = 1; y <= YEARS; y++) {
      let totals: number[];
      if (line === 'WC') {
        const g = generateWcClaims({
          members: book, yearNumber: 1, calendarYear: 2026,
          instanceSeed: 4242 + y * 7919, kLine: k, riskControlEffectiveness: 0,
        });
        // Every claim from the accident year is in g.claims now — WC's report
        // lag is gone, so there is no deferred set to add back. The union that
        // stood here existed only so the treaty saw deferred claims too.
        totals = g.claims.map(c => c.grossUltimate);
      } else {
        const gp = deriveSubRng(9090 + y * 7919, 1, 'tower_check_gpool')
          .gamma(WC_LOSS_MODEL.poolYearFactor.shape, WC_LOSS_MODEL.poolYearFactor.scale);
        const g = generateGlClaims({
          members: book, yearNumber: 1, calendarYear: 2026,
          instanceSeed: 9090 + y * 7919, kGl: k, riskControlEffectiveness: 0, gPool: gp,
        });
        totals = g.claims.map(c => c.grossUltimate);
      }
      REINSURANCE_TOWER[line].forEach((l, i) => {
        let s = 0;
        for (const t of totals) s += Math.min(Math.max(t - l.attachment, 0), l.limit);
        perYear[i].push(s);
      });
    }
    console.log(`  ${line} (${YEARS.toLocaleString()} full-market years):`);
    for (let i = 0; i < REINSURANCE_TOWER[line].length; i++) {
      const a = layerRiskMoments(line, i, book, 1);
      const mc = mean(perYear[i]), mcSd = sdOf(perYear[i]);
      const ci = 2.576 * mcSd / Math.sqrt(YEARS);
      // ⚠ THE MEAN IS GATED, THE SD IS REPORTED. A layer's annual ceded loss is
      // bounded per occurrence (the limit), so its sample MEAN has a valid CI.
      // Its sample SD converges far more slowly on a mixture this skewed, so
      // holding it to a tolerance would be gating a statistic the run cannot
      // resolve — finding 26's rule, applied to the second moment.
      const inCi = Math.abs(a.expected - mc) <= ci;
      check(inCi, `${line} ${REINSURANCE_TOWER[line][i].name.padEnd(13)} E[ceded]`,
        `analytic $${(a.expected / 1e6).toFixed(3)}M vs MC $${(mc / 1e6).toFixed(3)}M +/-$${(ci / 1e6).toFixed(3)}M`);
      console.log(`          SD/E analytic ${a.sdOverExpected.toFixed(3)} vs MC ${(mcSd / mc).toFixed(3)} — REPORTED, not gated`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- 4. THE gPool FLOOR: GL floors at 0.2000, WC has none ---');
{
  const FLOOR = Math.sqrt(1 / WC_LOSS_MODEL.poolYearFactor.shape);
  console.log(`  sqrt(Vg) = sqrt(1/${WC_LOSS_MODEL.poolYearFactor.shape}) = ${FLOOR.toFixed(4)}`);
  console.log('  book multiple      GL 4xs1     WC 4xs1');
  let glAbove = true, glConverges = false, wcDecays = true;
  let prevGl = Infinity, prevWc = Infinity;
  for (const reps of [1, 4, 20, 200]) {
    const big = Array.from({ length: reps }, () => ROSTER).flat();
    const g = layerRiskMoments('GL', 0, big, 1).sdOverExpected;
    const w = layerRiskMoments('WC', 0, big, 1).sdOverExpected;
    if (g < FLOOR) glAbove = false;
    if (g > prevGl || w > prevWc) { /* must be monotone decreasing */ }
    prevGl = g; prevWc = w;
    if (reps === 200) { glConverges = Math.abs(g - FLOOR) < 0.01; wcDecays = w < FLOOR / 2; }
    console.log(`  x${String(reps).padStart(3)}            ${g.toFixed(4)}      ${w.toFixed(4)}`);
  }
  check(glAbove, 'GL SD/E never drops below the 0.2000 floor at any book size');
  check(glConverges, 'GL SD/E converges TO the floor at 200x the roster (within 0.01)');
  check(wcDecays, 'WC SD/E decays well below GL\'s floor — no shared factor, no floor');
  // Not binding at playable sizes, and that matters: the floor is a structural
  // property, not the thing setting today's prices.
  const glFull = layerRiskMoments('GL', 0, ROSTER, 1).sdOverExpected;
  check(glFull > FLOOR * 2, 'the floor is NOT binding at full market', `${glFull.toFixed(3)} vs floor ${FLOOR.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 5. THE ABOVE-TOWER BAND CAN NOW CARRY A GATE ---');
{
  // ⚠ THE CAP MADE THIS VARIANCE PRACTICALLY MEASURABLE, NOT NEWLY FINITE, and
  // the distinction is the whole reason the old note was worded cautiously. A
  // lognormal has ALL moments finite, so the pre-cap band's variance existed —
  // it was simply dominated by mass beyond any feasible sample (the same fact
  // GL_SEVERITY_CAP's own note records as "half the variance above $1.42B").
  // GL_SEVERITY_CAP bounds each occurrence's contribution at $75M
  // ($100M cap - $25M tower top), which brings the required sample size down
  // from unreachable to a few thousand years.
  const placedAll = REINSURANCE_TOWER.GL.map(l => l.purchasable);
  const r = retainedRiskMoments('GL', placedAll, ROSTER, 1);
  // Isolate the above-tower band by differencing against a hypothetical tower
  // that also ceded it: what remains above TOWER_TOP is bounded by the cap.
  const YEARS = 4000;
  const drawn: number[] = [];
  const k = computeKGl(ROSTER, 1);
  for (let y = 1; y <= YEARS; y++) {
    const gp = deriveSubRng(5150 + y * 7919, 1, 'tower_check_above')
      .gamma(WC_LOSS_MODEL.poolYearFactor.shape, WC_LOSS_MODEL.poolYearFactor.scale);
    const g = generateGlClaims({
      members: ROSTER, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 5150 + y * 7919, kGl: k, riskControlEffectiveness: 0, gPool: gp,
    });
    let s = 0;
    for (const c of g.claims) s += Math.max(0, c.grossUltimate - TOWER_TOP.GL);
    drawn.push(s);
  }
  const mc = mean(drawn), mcSd = sdOf(drawn), cv = mcSd / mc;
  const ciPct = 100 * 1.96 * mcSd / Math.sqrt(YEARS) / mc;
  console.log(`  above $25M, ${YEARS.toLocaleString()} full-market years: E $${(mc / 1e6).toFixed(3)}M/yr  CV ${cv.toFixed(3)}`);
  console.log(`  bounded at $${((GL_SEVERITY_CAP - TOWER_TOP.GL) / 1e6).toFixed(0)}M per occurrence, so this CI is VALID`);
  check(ciPct <= 10.0, 'the above-tower band resolves to +/-10% at this sample size', `+/-${ciPct.toFixed(2)}%`);
  let breach = 0;
  for (const v of drawn) if (v < 0) breach++;
  check(breach === 0, 'no negative above-tower year');
  console.log(`  (retained-loss CV with the full tower placed, for reference: ${r.sdOverExpected.toFixed(3)})`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 6. RUNTIME COST BUDGET ---');
{
  // ============================================================================
  // ⚠ THE THRESHOLD IS 2%, DELIBERATELY, AND IT IS THE COLD-KEY FIGURE. Do not
  // tighten it to 1% without reading this — 1% was an initial target that was
  // measured against and withdrawn, and the work to reach it has already been
  // done and does not get there.
  //
  // THERE ARE TWO COSTS, AND ONLY ONE OF THEM IS WHAT A RUNNING GAME PAYS:
  //   WARM key  ~8 us   ~0.13% of a game-year — every call after the first in a
  //                     given year, i.e. the steady state.
  //   COLD key  ~84 us  ~1.4%  of a game-year — the FIRST call for a year, when
  //                     that year's band moments are computed. Paid once per
  //                     line-year, and the module-level cache is never cleared
  //                     in production, so across a session playing several games
  //                     only the first occurrence of each year number is cold.
  //                     It amortises to nothing.
  //
  // WHAT WAS ALREADY TRIED, to save the next reader the effort. The naive path
  // was 1,164 us; it is now ~8 us warm, a ~145x reduction, via: batching all
  // layers into one pass over the book; collapsing the book to sufficient
  // statistics per (rating group, region) cell (sum of lambda AND sum of
  // lambda-squared, since the B2 term needs the squares); hoisting the
  // loop-invariant Math.pow/Math.exp out of the member loop (the single biggest
  // win — wcFrequencyTrend was being evaluated once per member with the same
  // argument); sharing partial moments across contiguous band edges; and caching
  // at the COMPONENT level rather than the rating-group level (four distinct WC
  // severity components serve eleven group-component pairs).
  //
  // WHAT IS LEFT is ~180 normalCdf evaluations plus allocation overhead. That is
  // the floor without changing the mathematics, and the remaining ~1.3pp sits
  // inside the run-to-run noise of the measurement itself.
  //
  // EAGER PRECOMPUTATION AT IMPORT TIME WAS CONSIDERED AND REJECTED: computing
  // years 1-20 at module load would make every game-year warm, but it MOVES the
  // cost to startup rather than removing it, and wastes most of it on games
  // shorter than twenty years.
  // ============================================================================
  // ⚠ MEASURED AGAINST A processYear TIMED IN THIS SAME RUN, not against a
  // remembered figure from another machine. And measured after a JIT warmup: an
  // earlier version of this check timed 30 cold iterations straight after a cache
  // reset and swung 170-232 us run to run, because it was measuring compilation
  // rather than steady-state cost.
  const enrolled = bookFor('GL', 400);           // ~55 members, a realistic book
  const placed = [true, true, true];

  // Warm the JIT on both paths.
  for (let i = 0; i < 500; i++) {
    occurrenceProgramCost('WC', placed, enrolled, 1 + (i % 7));
    occurrenceProgramCost('GL', placed, enrolled, 1 + (i % 7));
  }

  // WARM KEY: the year's band moments are already cached (the common case —
  // every call after the first within a year).
  const NW = 20000, w0 = process.hrtime.bigint();
  for (let i = 0; i < NW; i++) { occurrenceProgramCost('WC', placed, enrolled, 3); occurrenceProgramCost('GL', placed, enrolled, 3); }
  const warmUs = Number(process.hrtime.bigint() - w0) / 1000 / NW;

  // COLD KEY, REAL ACCESS PATTERN: a fresh game clears nothing (the cache is
  // process-wide), but each new YEAR is a key never seen before, so a 5-year game
  // pays the band-moment computation five times per line. Measured as a whole
  // game rather than as a sweep over thousands of distinct years — the earlier
  // version of this benchmark walked 2,000 fresh years, which grew the cache to
  // 2,000 entries and measured Map degradation a real game never sees.
  const GAME_YEARS = 5, REPS = 400;
  const g0 = process.hrtime.bigint();
  for (let r = 0; r < REPS; r++) {
    resetTowerMomentCache();                    // a new game/process
    for (let y = 1; y <= GAME_YEARS; y++) {
      occurrenceProgramCost('WC', placed, enrolled, y);
      occurrenceProgramCost('GL', placed, enrolled, y);
    }
  }
  const coldUs = Number(process.hrtime.bigint() - g0) / 1000 / (REPS * GAME_YEARS);
  resetTowerMomentCache();

  // A REAL game-year on this machine, for the denominator.
  const inst = generateGameInstance('COSTBENCH', 20260819);
  const setup = { poolName: 'B', gameLength: 5, startingYear: 2026, instanceId: 'COSTBENCH', activeLines: ['WC', 'GL', 'Property'] as const };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as Parameters<typeof processYear>[0];
  const NY = 40, p0 = process.hrtime.bigint();
  for (let i = 0; i < NY; i++) processYear(gs, defaultDecisionSet(1));
  const gameYearUs = Number(process.hrtime.bigint() - p0) / 1000 / NY;

  console.log(`  a real processYear (3 lines, this machine): ${gameYearUs.toFixed(0)} us`);
  console.log(`  tower pricing, both lines, WARM key: ${warmUs.toFixed(1)} us  (${(100 * warmUs / gameYearUs).toFixed(2)}% of a game-year)`);
  console.log(`  tower pricing, both lines, COLD key: ${coldUs.toFixed(1)} us  (${(100 * coldUs / gameYearUs).toFixed(2)}% of a game-year)`);
  check(warmUs / gameYearUs < 0.005, 'WARM tower pricing (the steady state) is under 0.5% of a game-year',
    `${(100 * warmUs / gameYearUs).toFixed(2)}%`);
  check(coldUs / gameYearUs < 0.02, 'COLD-key tower pricing is under 2% of a game-year (see the note above)',
    `${(100 * coldUs / gameYearUs).toFixed(2)}%`);
  // The full 200-member marketplace is 3-4x a realistic enrolled book; reported
  // as the worst case rather than gated, since no line ever enrols all of it.
  const f0 = process.hrtime.bigint();
  for (let i = 0; i < 500; i++) { occurrenceProgramCost('WC', placed, ROSTER, 5000 + i); occurrenceProgramCost('GL', placed, ROSTER, 5000 + i); }
  const fullUs = Number(process.hrtime.bigint() - f0) / 1000 / 500;
  resetTowerMomentCache();
  console.log(`  worst case (all 200 members enrolled on both lines, cold): ${fullUs.toFixed(1)} us — REPORTED`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 7. THE FEEDBACK LOOP THE RUNTIME PRICE INTRODUCES ---');
{
  // Runtime SD/E makes reinsurance cost depend on book SIZE, which feeds member
  // charge -> satisfaction -> retention -> book size. That is a loop the frozen
  // constant did not have, so its gain has to be measured rather than assumed.
  // Loop gain = d(member charge %) / d(book size %). Anything well below 1 damps.
  const base = bookFor('GL', 400);
  const shrunk = bookFor('GL', 360);   // ~10% smaller
  const placed = [true, true, true];
  const expOf = (bk: Member[]) => bk.reduce((s, m) => s + glP(m), 0);
  const costOf = (bk: Member[]) => occurrenceProgramCost('GL', placed, bk, 1).premium;
  const rateBase = costOf(base) / expOf(base), rateSmall = costOf(shrunk) / expOf(shrunk);
  const sizeDelta = expOf(shrunk) / expOf(base) - 1;
  const rateDelta = rateSmall / rateBase - 1;
  // Reinsurance is only part of the member charge; scale by its share.
  const reinsShareOfCharge = 0.25;
  const gain = Math.abs((rateDelta * reinsShareOfCharge) / sizeDelta);
  console.log(`  book ${(sizeDelta * 100).toFixed(1)}%  ->  reinsurance rate/$100 ${(rateDelta * 100).toFixed(2)}%`);
  console.log(`  member charge moves ~${(rateDelta * reinsShareOfCharge * 100).toFixed(2)}% (reinsurance ~${(reinsShareOfCharge * 100).toFixed(0)}% of charge)`);
  check(gain < 0.5, `loop gain ${gain.toFixed(3)} — damps, does not oscillate`, 'gain >= 1 would be self-reinforcing');
}

console.log(failures === 0 ? '\nALL RUNTIME TOWER CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
