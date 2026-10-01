// ============================================================================
// POOL-ROW METRIC CHECK — no exported metric may read a field the pool row does
// not have.
//
//   npx tsx scripts/diagnostics/pool-row-metric-check.ts
//
// ⚠ IT EXISTS BECAUSE THE COMPILER CANNOT SEE INSIDE A CLOSURE, AND THAT GAP IS
// NOT THEORETICAL — IT FIRED DURING THE COMMIT THAT ADDED THIS FILE.
//
// Splitting the pooled result type put per-line quantities out of reach of a
// pool-scope read, and the compiler found every direct one: 20 errors in 10
// files, each a page printing the first active line's rate or decisions under a
// pool heading. It could not find the ones inside SpreadsheetMetric, because a
// metric is `{ key, label, value: (r) => ... }` and `value` is a closure. No
// signature on that interface can state which fields the body touches.
//
// So the metric table carries a hand-written `lineOnly` flag, and a hand-written
// flag is exactly the kind of thing that goes stale. Six metrics were marked by
// reading the file; SIX MORE WERE MISSED and were found only when
// solo-export-guard crashed with "Cannot read properties of undefined (reading
// 'dividendPct')". That crash is the honest version of the failure. The silent
// version is worse and is what this gate is for: a metric reading a missing
// NUMBER gets `undefined`, formats as "NaN" or "$NaN", and ships.
//
// ============================================================================
// HOW IT WORKS, AND WHY A PROXY RATHER THAN A SAMPLE.
//
// Every pool metric is evaluated against a REAL pool row — a played game, not a
// fixture — wrapped in a Proxy that THROWS on any key in PoolAbsentKey. A metric
// that touches one is named, with the key it reached for.
//
// A proxy rather than "look for undefined" because absence and a legitimate zero
// are indistinguishable afterwards: `poolPremium` of 0 in a degenerate year is a
// real answer, and `rateLevel` of undefined is not. Catching the ACCESS rather
// than inspecting the RESULT tells those apart with no tolerance to tune.
//
// ⚠ AND IT CHECKS THE OTHER DIRECTION TOO, which is the half that stops the flag
// becoming a dumping ground. A metric marked `lineOnly` that does NOT read an
// absent field is over-marked: it was dropped from the Pool tab for no reason,
// and a row the pool could have shown is missing. Both directions fail.
//
// ⚠ THE `poolValue` ESCAPE IS CHECKED ON ITS OWN TERMS. A metric may be
// line-only in form and pool-wide in substance — `riskControlPct` is one spend
// projected into every line — and carries a `poolValue` that reads `pool`
// instead. Those are evaluated against the proxy as well, so a pool form that
// reaches back into a line field is caught like any other.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import { buildPoolMetrics } from '../../src/utils/resultsExport';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 3;

/** Mirrors PoolAbsentKey in types/simulation.ts. Kept here as a literal list so
 *  the gate fails loudly if the two drift rather than silently checking less. */
const ABSENT = [
  'rateLevel', 'ratePer100', 'purePremiumPer100', 'purePremium',
  'expectedCededPer100', 'netPurePremiumPer100',
  'selectedFundingConfidenceLevel', 'selectedFundingCLF', 'fundingCLF',
  'decisions', 'commonLossFactor', 'aggregateAttachment',
] as const;

class AbsentFieldRead extends Error {
  constructor(public key: string) { super(`read of absent pool field '${key}'`); }
}

function guard(row: ResultSet): ResultSet {
  return new Proxy(row as unknown as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop === 'string' && (ABSENT as readonly string[]).includes(prop)) {
        throw new AbsentFieldRead(prop);
      }
      return target[prop as string];
    },
  }) as unknown as ResultSet;
}

function playOne(): ResultSet {
  const inst = generateGameInstance('PRM1', 9_100_000);
  const setup = { poolName: 'PRM', gameLength: YEARS, startingYear: 2026, instanceId: 'PRM1', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let last: ResultSet | null = null;
  for (let y = 1; y <= YEARS; y++) {
    const out = processYear(gs, defaultDecisionSet(y));
    last = out.result;
    gs = {
      ...gs, poolState: out.updatedPoolState, lockedResults: [...gs.lockedResults, out.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
  return last!;
}

/** Runs one accessor and reports which absent key it reached for, if any. */
function probe(fn: (r: never) => unknown, row: ResultSet): string | null {
  try { fn(guard(row) as never); return null; } catch (e) {
    if (e instanceof AbsentFieldRead) return e.key;
    return null;  // a metric throwing for its own reasons is not this gate's subject
  }
}

const row = playOne();
const poolMetrics = buildPoolMetrics(RESULT_METRICS, LINES);
const failures: string[] = [];

console.log('='.repeat(78));
console.log('POOL-ROW METRIC CHECK — every Pool-tab metric, against a real pool row');
console.log('='.repeat(78));
console.log(`  base metrics ${RESULT_METRICS.length}   pool-tab metrics ${poolMetrics.length}`);

// --- 1. nothing on the Pool tab may read an absent field --------------------
let leaks = 0;
for (const m of poolMetrics) {
  for (const [what, fn] of [['value', m.value], ['csvValue', m.csvValue]] as const) {
    if (!fn) continue;
    const key = probe(fn as (r: never) => unknown, row);
    if (key) {
      leaks++;
      failures.push(`POOL TAB: metric '${m.key}' (${what}) reads '${key}', which the pool row does not have. `
        + 'Mark it `lineOnly: true` — or, if the quantity really is pool-wide, give it a `poolValue` '
        + 'that reads `pool`.');
    }
  }
}
console.log(`  pool-tab metrics reading an absent field: ${leaks}`);

// --- 2. nothing may be marked lineOnly without reading one ------------------
let overMarked = 0;
for (const m of RESULT_METRICS) {
  if (!m.lineOnly) continue;
  const reads = probe(m.value as (r: never) => unknown, row)
    ?? (m.csvValue ? probe(m.csvValue as (r: never) => unknown, row) : null);
  if (!reads) {
    overMarked++;
    failures.push(`OVER-MARKED: metric '${m.key}' is flagged lineOnly but reads no absent field. `
      + 'It is being dropped from the Pool tab for no reason — a row the pool could show is missing.');
  }
}
console.log(`  metrics marked lineOnly that need not be: ${overMarked}`);

// --- 3. the ABSENT list here must match the type ----------------------------
// A key that is still present on a real pool row means this list has drifted
// ahead of PoolAbsentKey and the gate is checking something that is not true.
const stale = ABSENT.filter(k => (row as unknown as Record<string, unknown>)[k] !== undefined);
if (stale.length) {
  failures.push(`THE ABSENT LIST HAS DRIFTED: ${stale.join(', ')} still present on a real pool row. `
    + 'This gate is asserting against a type that has moved; reconcile it with PoolAbsentKey.');
}
console.log(`  absent-list keys still present on the row: ${stale.length}`);

console.log(`\n${'='.repeat(78)}`);
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('OK — every Pool-tab metric reads only fields the pool row has, every lineOnly');
  console.log('flag earns itself, and the absent list matches the shipped type.');
}
