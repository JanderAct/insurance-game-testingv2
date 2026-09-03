// ============================================================================
// THE COHORT LEDGER IDENTITIES — A GATE, AND IT SHIPS RED ON THE FLAG-ON ARM.
//
// ⚠ THIS EXITS NON-ZERO, AND ON THE FLAG-ON ARM IT IS SUPPOSED TO. Run:
//   npx tsx scripts/diagnostics/cohort-ledger-check.ts
//   GAMES=60 npx tsx scripts/diagnostics/cohort-ledger-check.ts
//
// THREE EXIT CODES, AND THE DISTINCTION IS THE WHOLE POINT:
//   0   both arms clean — the open item below is FIXED and this file's
//       EXPECTED_RED entry in gates.ts must be removed
//   1   the FLAG-OFF arm violated an identity. A REAL REGRESSION on the shipped
//       path, never excused by anything
//   2   flag-off clean, flag-on violating. The KNOWN OPEN ITEM, attributed in
//       gates.ts and reported as `xfail` by the sweep
//
// A single red would have let a flag-off regression hide behind the expected
// flag-on redness, which is the exact family this repo has now found sixteen
// times. Two different reds cannot mask each other.
//
// ============================================================================
// WHAT IS ASSERTED — PURE LEDGER IDENTITIES. NO TOLERANCE, NO SAMPLE SIZE.
//
//   1. netPaid is MONOTONE NON-DECREASING per cohort across valuations.
//      Paid-to-date is history. It cannot fall.
//   2. netUltimate >= netPaid.
//      A cohort cannot expect to pay less in total than it has already paid.
//   3. netUnpaid >= 0 on every cohort-valuation.
//      A case reserve is a liability, not an asset.
//
// ⚠ THESE NEED NO INTERVAL AND NO NOISE BUDGET, WHICH IS WHY THEY BEAT ANY
// STATISTICAL ALTERNATIVE. The same shape as openEnd[a] === openStart[a+1] and
// as martingale-equivalence-check's 24-of-24 settlement identity: a property
// that is either true or false on each observation, so one violation is a
// finding and no sample size argument is required. The only tolerance is
// EPSILON below, and it is float dust rather than a modelling allowance.
//
// ============================================================================
// ⚠ IT RUNS ON BOTH ARMS, ALWAYS, AND THAT IS STRUCTURAL RATHER THAN THOROUGH.
//
// ibner-null-check asserts that the reserve floor is hit exactly 0 times, and
// simulationEngine's floors note calls the crossing "unreachable". Both are true
// of the COHORT path, where development is `newUnpaid *= factor` — a positive
// factor on a positive balance cannot cross zero, so the identity holds by
// construction. Neither is true of the PER-CLAIM path, where development is
// `newUnpaid += sum(claim reserve x (f - 1))`: the deltas are computed against a
// different base and then ADDED, so nothing bounds their sum by the balance they
// land in. And ibner-null-check runs flag-off only.
//
// A GUARD THAT ASSERTS ZERO ON THE ONLY PATH WHERE ZERO IS GUARANTEED IS NOT A
// GUARD. That is why this file takes the flag as a dimension rather than reading
// whatever is shipped.
//
// ============================================================================
// THE OPEN ITEM THIS IS RED FOR, NAMED SO THE REDNESS IS ATTRIBUTABLE.
//
// The per-claim revision law scales each claim's movement by a headroom taken
// from the PAYOUT PATTERN — `cumulativePaid(LINE_PAYOUT_PATTERN[line], age + 1)`
// at reviseDevelopingSet's call site — while the cohort balance those movements
// land on has been paid down along its own REALISED path. Development moves the
// realised path away from the curve. Measured, median headroom entering a step:
//
//   cohorts that end the step negative    pattern 0.125   realised 0.003   46x
//   cohorts that end the step positive    pattern 0.136   realised 0.143   0.95x
//
// So the law computes movements as if an eighth of every claim's value were at
// risk against a balance holding three tenths of a percent. Settlement is the
// extreme case of the same defect: `current x (factor - 1)` has no headroom
// scaling at all.
//
// ⚠ AND THE CLAIM LEVEL IS SOUND — this is an AGGREGATION defect, not a hole in
// the reserve basis. With settlement suppressed, 100% of negative-reserve
// cohorts have every tracked claim carrying a POSITIVE value, and 0% were
// floored by cedeDevelopment. The per-claim reserve genuinely cannot go
// negative. It is the cohort balance that is not tied to it.
//
// THE FIX IS THE NEXT COMMIT: the claim headroom becomes the cohort's realised
// netUnpaid / netUltimate. It is a reconciliation and NOT A FLOOR — a floor on
// the reserve is the Stage 0 defect that simulationEngine's floors note records,
// one-sided truncation of favourable movement that breaks the martingale. When
// the fix lands this gate goes green and its EXPECTED_RED entry comes out.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { PER_CLAIM_REVISION } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 20);
const YEARS = Number(process.env.YEARS ?? 15);
/** One dollar. Float dust on figures in the tens of millions, not an allowance —
 *  every violation this gate has ever seen is six figures or more. */
const EPSILON = 1;

const RULE = '='.repeat(72);

interface Violation { line: string; game: number; ay: number; yr: number; amount: number; detail: string }
interface ArmResult {
  cohortValuations: number;
  steps: number;
  paidFell: Violation[];
  ultBelowPaid: Violation[];
  negativeUnpaid: Violation[];
}

function measure(): ArmResult {
  const res: ArmResult = { cohortValuations: 0, steps: 0, paidFell: [], ultBelowPaid: [], negativeUnpaid: [] };
  for (let g = 0; g < GAMES; g++) {
    const id = `LG${g}`;
    const inst = generateGameInstance(id, 5_100_000 + g * 7919);
    const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    // A cohort is followed by (line, accident year) so identity 1 compares the
    // SAME cohort across valuations rather than two cohorts of the same age.
    let prev = new Map<string, ReserveCohort>();
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const next = new Map<string, ReserveCohort>();
      for (const line of LINES) {
        for (const c of p.updatedPoolState.lines[line].reserveCohorts) {
          const key = `${line}|${c.yearNumber}`;
          next.set(key, c);
          res.cohortValuations++;
          const where = { line, game: g, ay: c.yearNumber, yr: y };
          const money = (x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(0)}k`);

          // 1. netPaid monotone non-decreasing.
          const before = prev.get(key);
          if (before) {
            res.steps++;
            const fall = c.netPaid - before.netPaid;
            if (fall < -EPSILON) {
              res.paidFell.push({
                ...where, amount: fall,
                detail: `netPaid ${money(before.netPaid)} -> ${money(c.netPaid)}  (registerSum ${money(c.registerSum)})`,
              });
            }
          }
          // 2. netUltimate >= netPaid.
          if (c.netUltimate < c.netPaid - EPSILON) {
            res.ultBelowPaid.push({
              ...where, amount: c.netUltimate - c.netPaid,
              detail: `netUltimate ${money(c.netUltimate)} < netPaid ${money(c.netPaid)}  (registerSum ${money(c.registerSum)}, age ${c.age})`,
            });
          }
          // 3. netUnpaid >= 0.
          if (c.netUnpaid < -EPSILON) {
            res.negativeUnpaid.push({
              ...where, amount: c.netUnpaid,
              detail: `netUnpaid ${money(c.netUnpaid)}  (registerSum ${money(c.registerSum)}, netPaid ${money(c.netPaid)}, netUltimate ${money(c.netUltimate)}, age ${c.age})`,
            });
          }
        }
      }
      prev = next;
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  return res;
}

const wasEnabled = PER_CLAIM_REVISION.enabled;
const wasSettlement = PER_CLAIM_REVISION.settlement;
let off: ArmResult, on: ArmResult;
try {
  PER_CLAIM_REVISION.enabled = false;
  off = measure();
  PER_CLAIM_REVISION.enabled = true;
  PER_CLAIM_REVISION.settlement = true;
  on = measure();
} finally {
  PER_CLAIM_REVISION.enabled = wasEnabled;
  PER_CLAIM_REVISION.settlement = wasSettlement;
}
const flagRestored = PER_CLAIM_REVISION.enabled === wasEnabled && PER_CLAIM_REVISION.settlement === wasSettlement;

console.log('=== COHORT LEDGER IDENTITIES — both arms, no tolerance ===');
console.log(`${GAMES} games x ${YEARS} years x 3 lines, default funding.`);
console.log(`Flag OFF is ASSERTED. Flag ON is asserted too and is EXPECTED RED — see this file's header.\n`);

const arms: [string, ArmResult][] = [['FLAG OFF', off], ['FLAG ON ', on]];
console.log('  arm        cohort-valns   steps    (1) netPaid fell   (2) ultimate < paid   (3) netUnpaid < 0');
for (const [label, a] of arms) {
  console.log(`  ${label}   ${String(a.cohortValuations).padStart(10)}  ${String(a.steps).padStart(7)}    `
    + `${String(a.paidFell.length).padStart(14)}   ${String(a.ultBelowPaid.length).padStart(19)}   ${String(a.negativeUnpaid.length).padStart(16)}`);
}

console.log('\n--- BY LINE ---');
console.log('  arm        line       (1) paid fell   (2) ult < paid   (3) unpaid < 0   worst unpaid');
for (const [label, a] of arms) {
  for (const line of LINES) {
    const n = a.negativeUnpaid.filter(v => v.line === line);
    const worst = n.length ? Math.min(...n.map(v => v.amount)) : 0;
    console.log(`  ${label}   ${line.padEnd(9)}  ${String(a.paidFell.filter(v => v.line === line).length).padStart(12)}   `
      + `${String(a.ultBelowPaid.filter(v => v.line === line).length).padStart(13)}   ${String(n.length).padStart(13)}   `
      + `${worst < 0 ? `$${(worst / 1e6).toFixed(2)}M` : '-'}`);
  }
}

// The worst case of each identity, printed so a reader can go and look at it.
console.log('\n--- WORST CASES, FLAG ON ---');
for (const [name, list] of [
  ['(1) netPaid fell', on.paidFell],
  ['(2) ultimate < paid', on.ultBelowPaid],
  ['(3) netUnpaid < 0', on.negativeUnpaid],
] as const) {
  if (list.length === 0) { console.log(`  ${name}: none`); continue; }
  const w = [...list].sort((a, b) => a.amount - b.amount).slice(0, 3);
  console.log(`  ${name}:`);
  for (const v of w) console.log(`    ${v.line} AY${v.ay} at year ${v.yr} (game ${v.game})  ${v.detail}`);
}

// ---------------------------------------------------------------- verdict
const offViolations = off.paidFell.length + off.ultBelowPaid.length + off.negativeUnpaid.length;
const onViolations = on.paidFell.length + on.ultBelowPaid.length + on.negativeUnpaid.length;

console.log('');
console.log(RULE);
if (!flagRestored) {
  console.log('FAILURE: PER_CLAIM_REVISION was not restored. This gate mutates it and must put it back.');
  console.log(RULE);
  process.exitCode = 1;
} else if (offViolations > 0) {
  console.log(`REGRESSION ON THE SHIPPED PATH — ${offViolations} identity violation(s) with the flag OFF.`);
  console.log('  netPaid fell        ' + off.paidFell.length);
  console.log('  ultimate < paid     ' + off.ultBelowPaid.length);
  console.log('  netUnpaid < 0       ' + off.negativeUnpaid.length);
  console.log('');
  console.log('These are LEDGER IDENTITIES and the cohort path holds them by construction:');
  console.log('development is `newUnpaid *= factor`, a positive factor on a positive balance.');
  console.log('A violation here means that stopped being true. This is exit 1 and is never');
  console.log('excused by the flag-on expectation.');
  console.log(RULE);
  process.exitCode = 1;
} else if (onViolations > 0) {
  console.log(`EXPECTED RED — flag-off is clean, flag-on violates ${onViolations} time(s).`);
  console.log('');
  console.log('  netPaid fell        ' + on.paidFell.length + '   (paid-to-date is history and cannot fall)');
  console.log('  ultimate < paid     ' + on.ultBelowPaid.length + '   (Stage 0\'s crossing, back by a different route)');
  console.log('  netUnpaid < 0       ' + on.negativeUnpaid.length + '   (a case reserve is not an asset)');
  console.log('');
  console.log('THIS IS THE NAMED OPEN ITEM, not a general failure: the per-claim law scales');
  console.log('claim movements by the PAYOUT PATTERN\'s headroom while the cohort balance has');
  console.log('been paid down along its own realised path. Full diagnosis in this file\'s');
  console.log('header and at PER_CLAIM_REVISION. The claim level is sound; the aggregation is');
  console.log('not. Exit 2, reported as `xfail` by the sweep and attributable there.');
  console.log(RULE);
  process.exitCode = 2;
} else {
  console.log('ALL THREE IDENTITIES HOLD ON BOTH ARMS.');
  console.log('');
  console.log('⚠ IF YOU ARE READING THIS, THE OPEN ITEM IS FIXED AND THIS GATE\'S');
  console.log('EXPECTED_RED ENTRY IN scripts/gates.ts MUST BE REMOVED. The sweep reports an');
  console.log('unexpected pass as a FAILURE precisely so the expectation cannot outlive the');
  console.log('defect it describes.');
  console.log(RULE);
}
