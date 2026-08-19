// FIVE PURE-FUNCTION-OF-YEAR TRENDS, MEMOIZED — this is what guards it.
//
// Run: npx tsx scripts/diagnostics/trend-memoization-check.ts
//
// wageFactor, wcFrequencyTrend, wcSeverityTrend, glSeverityTrend and
// glCappedSeverityTrend were each a fresh Math.pow (or, for the last, a
// component-loop evaluation) on every call, including calls made once per
// DRAWN CLAIM inside generateWcClaims/generateGlClaims and once per MEMBER
// inside wcAggregateCumulants/glAggregateCumulants — ~7,500 calls/yr at full
// market to pure functions of a single integer. Each is now backed by a
// module-level Map (src/utils/claimMath.ts's memoizeByYear).
//
// PURELY A SPEED FIX. Nothing here should ever be able to move a simulated
// value — if any assertion below fails, the memo key is wrong. Do not
// "explain" a failure; a wrong memoized value is a defect by definition,
// never a modelling question.
//
// THE THING WORTH GETTING WRONG: fn must floor internally, not rely on
// keyOf having already floored — memoizeByYear calls fn with the RAW year on
// a cache miss, so a function that trusted its key to be pre-floored would
// let whichever raw year (-2, -1, 0 or 1) happens to populate a given slot
// first silently decide that slot's value. Section 2 asserts this directly:
// every floored function must return the SAME thing at -2, -1, 0 and 1, in
// every call order.

import { wageFactor } from '../../src/data/exposureTrend';
import {
  wcFrequencyTrend, wcSeverityTrend, WC_SEVERITY_TREND_PER_YEAR,
} from '../../src/utils/wcClaimEngine';
import {
  glSeverityTrend, glCappedSeverityTrend, GL_SEVERITY_TREND_PER_YEAR,
  HELD_PURE_PREMIUM_YEAR, untiltedGlWeights, expectedClaimSeverity,
} from '../../src/utils/glClaimEngine';
import { WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
  else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

const YEARS = [-8, -5, -2, -1, 0, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50];

console.log('=== TREND MEMOIZATION CHECK ===\n');

// ---------------------------------------------------------------------------
console.log('--- 1. EVERY MEMOIZED VALUE MATCHES A FRESH, INDEPENDENTLY REIMPLEMENTED COMPUTATION ---');
{
  // Fresh reference formulas, duplicated from each function's PRE-MEMOIZATION
  // body rather than imported — the point is to have a computation that never
  // touches the Map, so a wrong key can't hide from it.
  const freshWcFrequencyTrend = (y: number) => Math.pow(1 + WC_LOSS_MODEL.frequencyTrendPerYear, y - 1);
  const freshWcSeverityTrend = (y: number) => Math.pow(1 + WC_SEVERITY_TREND_PER_YEAR, Math.max(1, y) - 1);
  const freshGlSeverityTrend = (y: number) => Math.pow(1 + GL_SEVERITY_TREND_PER_YEAR, Math.max(1, y) - 1);
  const freshWageFactor = (y: number) => Math.pow(1.0363, Math.max(1, y) - 1); // WAGE_INFLATION_PER_YEAR, restated so this check does not import the memoized module's own constant path
  // glCappedSeverityTrend's fresh reference calls the UNMEMOIZED
  // expectedClaimSeverity fresh every time, recomputing `base` from scratch on
  // every single call rather than hoisting it — the two must still agree,
  // which is the actual thing at risk in that function (the hoisting, not the
  // arithmetic already checked via glSeverityTrend above).
  const freshGlCapped = (y: number) => {
    const base = expectedClaimSeverity(untiltedGlWeights(), HELD_PURE_PREMIUM_YEAR);
    if (!(base > 0)) return 1;
    return expectedClaimSeverity(untiltedGlWeights(), y) / base;
  };

  let allMatch = true;
  for (const y of YEARS) {
    const rows: [string, number, number][] = [
      ['wcFrequencyTrend', wcFrequencyTrend(y), freshWcFrequencyTrend(y)],
      ['wcSeverityTrend', wcSeverityTrend(y), freshWcSeverityTrend(y)],
      ['glSeverityTrend', glSeverityTrend(y), freshGlSeverityTrend(y)],
      ['glCappedSeverityTrend', glCappedSeverityTrend(y), freshGlCapped(y)],
      ['wageFactor(WC)', wageFactor('WC', y), freshWageFactor(y)],
      ['wageFactor(GL)', wageFactor('GL', y), freshWageFactor(y)],
    ];
    for (const [name, memoized, fresh] of rows) {
      if (memoized !== fresh) {
        allMatch = false;
        console.log(`    MISMATCH ${name} at year ${y}: memoized ${memoized} vs fresh ${fresh}`);
      }
    }
  }
  check(allMatch, `memoized === fresh across years [${YEARS.join(', ')}]`, 'wageFactor on both WC and GL');
  check(wageFactor('Property', 10) === 1 && wageFactor('Property', -5) === 1,
    'wageFactor(Property, *) stays exactly 1 — WAGE_INFLATION_APPLIES.Property is false');
}

// ---------------------------------------------------------------------------
console.log('\n--- 2. THE FLOOR IS AT THE CACHE KEY, NOT JUST THE VALUE ---');
{
  // Query out of order and with repeats, so a function whose fn trusted keyOf
  // to have already floored would show it: whichever raw year populates the
  // key=1 slot FIRST would silently win for every year <= 1 queried after.
  const floored: [string, (y: number) => number][] = [
    ['wcSeverityTrend', wcSeverityTrend],
    ['glSeverityTrend', glSeverityTrend],
    ['glCappedSeverityTrend', glCappedSeverityTrend],
    ['wageFactor(WC)', (y: number) => wageFactor('WC', y)],
  ];
  for (const [name, fn] of floored) {
    const order = [0, -2, 1, -8, -1]; // year 1 is NOT queried first
    const seen = order.map(fn);
    const allSame = seen.every(v => v === seen[0]);
    check(allSame, `${name}: years [${order.join(', ')}] all equal, year 1 queried third`,
      allSame ? `${seen[0]}` : seen.join(' / '));
  }

  // The un-floored control: wcFrequencyTrend must NOT collapse -2 and 1,
  // because it deliberately has no floor.
  const distinct = wcFrequencyTrend(-2) !== wcFrequencyTrend(1);
  check(distinct, 'wcFrequencyTrend(-2) !== wcFrequencyTrend(1) — this one has NO floor, by design',
    `${wcFrequencyTrend(-2).toFixed(6)} vs ${wcFrequencyTrend(1).toFixed(6)}`);
}

// ---------------------------------------------------------------------------
console.log('\n--- 3. REPEATED CALLS ARE BIT-IDENTICAL (the cache itself is not corrupting anything) ---');
{
  let stable = true;
  for (const y of YEARS) {
    if (wcFrequencyTrend(y) !== wcFrequencyTrend(y)) stable = false;
    if (glCappedSeverityTrend(y) !== glCappedSeverityTrend(y)) stable = false;
  }
  check(stable, 'calling each function twice at the same year returns bit-identical results');
}

// ---------------------------------------------------------------------------
console.log('\n--- 4. RUNTIME COST: processYear timed in this process, before/after cannot be re-measured here ---');
console.log('  (this run only measures AFTER; see the report for the before/after comparison)');
{
  const inst = generateGameInstance('MEMOBENCH', 20260820);
  const setup = { poolName: 'B', gameLength: 5, startingYear: 2026, instanceId: 'MEMOBENCH', activeLines: ['WC', 'GL', 'Property'] as const };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as Parameters<typeof processYear>[0];
  const N = 60;
  for (let i = 0; i < 5; i++) processYear(gs, defaultDecisionSet(1)); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) processYear(gs, defaultDecisionSet(1));
  const perYear = Number(process.hrtime.bigint() - t0) / 1000 / N;
  console.log(`  processYear (3 lines, this machine, AFTER memoization): ${perYear.toFixed(0)} us`);
}

console.log(failures === 0 ? '\nALL TREND MEMOIZATION CHECKS PASS.' : `\n${failures} CHECK(S) FAILED.`);
if (failures > 0) process.exit(1);
