// THE RATEMAKING LOOP — THE ACCEPTANCE TEST. Play a year; all four must hold.
//
//   1. the triangle the pool priced that year off now CONTAINS that year, age 1
//   2. the oldest accident year is GONE
//   3. every remaining accident year has developed one step, ON INCURRED
//   4. the next year is priced off the UPDATED triangle
//
// ============================================================================
// ⚠ WRITTEN BEFORE THE LOOP EXISTS, DELIBERATELY. This gate is the deliverable's
// definition, not a report on a component. Four components have each passed
// their own gate while the loop stayed unbuilt, so this one is written first and
// made to pass last.
//
// ⚠ IT REPORTS UNEVALUATED SEPARATELY FROM FAILED, AND THE DISTINCTION IS THE
// POINT. The first version asserted all four against LinePoolState.pricingTriangle,
// which does not exist, so it short-circuited at NOT BUILT and printed 0/4. That
// reads as four failures. It was four conditions never reached, and reading it
// as four failures cost two commits aimed at a mechanism blocker that was not
// there — condition 3's mechanism has worked since commit 1. A gate that cannot
// tell "this is broken" from "this was never run" is worse than one that fails.
//
// ============================================================================
// ⚠ CONDITION 3 ASSERTS AGAINST reserveDevelopment, NOT pricingTriangle, AND
// THAT IS A RULING RATHER THAN A CONVENIENCE.
//
// The window seeds from LinePoolState.reserveDevelopment — the pool's own
// append-only ledger of accident years it actually wrote — and NOT from
// claimTriangle.ts's synthetic ten-year history. The two compound development on
// different clocks: the generator to each CLAIM's closure age, the engine to the
// COHORT's IBNER_HORIZON. Mixing them makes a chain ladder average an age-to-age
// pattern no book produces. reserveDevelopment carries 7-8 rows at game start
// (a proper staircase: ay-4 at age 1, ay-5 at age 2, ... ay-8 at age 5) and
// passes ten within two or three played years, and every factor in it — seeded
// rows included — is engine-produced, because runPriorHistory calls processYear.
// So the ledger is internally consistent end to end and the shape problem does
// not arise.
//
// Condition 3 is therefore evaluable TODAY, against the source the triangle will
// project from. When conditions 1, 2 and 4 land, its bar is already proven.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FORWARD_BOOKING, TRIANGLE_HISTORY_YEARS } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ReserveDevelopmentRow } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// ⚠ SIX GAMES, AND THE REASON IS THE MECHANISM, NOT THRIFT. On the flagged arm
// the pre-game acceptance search runs ~240 attempts a seed against a shipped
// mean of 3 (see the flag's block: the opening band is calibrated to the old
// reserve level and forward booking raises surplus/premium out of it). Every
// game on that arm therefore costs ~80x what it does on the shipped path. Six
// gives ~30 line-years a line, enough to separate 7% from 93% many times over;
// raise it when commit 4 puts the band back and the search is cheap again.
const GAMES = Number(process.env.GAMES ?? 6);
// Play far enough in that every window slot is a PLAYED accident year, so
// condition 3 is asserted against the engine rather than against the generator's
// seeded years. One window depth plus two.
const YEARS = Number(process.env.YEARS ?? TRIANGLE_HISTORY_YEARS + 2);

// ============================================================================
// CONDITION 3'S TWO THRESHOLDS, BOTH MEASURED RATHER THAN PICKED.
//
// ⚠ THE OLD TEST WAS `nowCell.incurred !== prevCell.incurred` AND IT COULD NOT
// FAIL. On the SHIPPED arm — where the revision law is mean-one and cumulative
// incurred development is 0.9857 / 0.9912 / 1.0005, i.e. nothing develops —
// 100% of within-horizon steps satisfied it and whole line-years passed at WC
// 73.7% and GL 59.6%. A float inequality is satisfied by dispersion noise. A
// test that cannot go red on the arm with no mechanism is not a test.
//
// ⚠ AND "EVERY CARRIED YEAR MOVES UP" IS NOT ACHIEVABLE, WHICH IS A CORRECTION
// TO THE OBVIOUS FIX RATHER THAN A WEAKENING OF IT. The revision law is drift
// PLUS a mean-one dispersion term, so individual accident years come in below
// their prior estimate — as they do in a real book. Measured on the FLAGGED
// arm, per cohort, within horizon, 12 games x 20 years:
//
//     share of one-step factors above 1.00   WC 91.3%   GL 95.2%   Property 96.1%
//
// A universal quantifier would fail the flagged arm ~5-9% of the time for a
// CORRECT reason, which is the same defect family as the wording it replaces.
// Condition 3 is therefore a POPULATION statement, and it is asserted on the
// VALUE-WEIGHTED aggregate of each line-year's carried years — which is also
// what catches the failure the original header worried about, a total rising
// because the new year was added while every carried year sat still.
//
// ⚠ MATERIAL_FACTOR = 1.02 IS THE SHIPPED ARM'S OWN UPPER TAIL. Per line-year,
// value-weighted, the shipped arm's 95th percentile runs 1.017 / 1.030 / 1.021.
// So 1.02 is roughly where noise alone tops out: it clears that bar in 4.7% /
// 6.9% / 7.1% of line-years. Anything clearing 1.02 systematically is not noise,
// and the number is read off the null arm rather than chosen to be passed.
//
// ⚠ MIN_SHARE = 0.75 IS SET FOR HEADROOM ON BOTH SIDES, and the headroom below
// is deliberate. Measured share of line-years clearing 1.02, 12 games x 20 years:
//
//     arm        WC      GL   Property
//     shipped   4.7%    6.9%     7.1%      <- must stay RED
//     flagged  93.8%   92.4%    94.1%      <- must stay GREEN
//
// 0.75 is more than 10x the noise rate and leaves 17 points under the flagged
// arm's worst line. THE HEADROOM IS NOT SLACK: Property still over-develops by
// 22% and GL's age profile CROSSES (0.950 at age 2 to 1.387 at age 10). Neither
// is what this condition measures, and neither must be able to turn it red — a
// calibration item failing a wiring gate is how a bar becomes a target.
// ============================================================================
const MATERIAL_FACTOR = 1.02;
const MIN_SHARE = 0.75;
/** A line-year needs at least this many carried within-horizon years to count. */
const MIN_CARRIED = 2;

/** The shape conditions 1, 2 and 4 are about. Absent today; see the header. */
interface PricingCell { accidentYear: number; age: number; incurred: number; paid: number }
interface PricingTriangleState {
  years: number;
  cells: PricingCell[];
  exposureByYear: Record<string, number>;
  /** The rate this triangle produced, so condition 4 can be checked rather
   *  than assumed — a rate recomputed by the harness would prove nothing. */
  ratePer100?: number;
}

function triangleOf(st: unknown, line: CoverageLine): PricingTriangleState | undefined {
  const s = st as { lines?: Record<string, { pricingTriangle?: PricingTriangleState }> };
  return s.lines?.[line]?.pricingTriangle;
}

interface ArmResult {
  /** Per line: the share of line-years whose carried years developed materially. */
  share: Record<string, number>;
  lineYears: Record<string, number>;
  /** Per line: the pooled value-weighted factor over every carried year. */
  pooled: Record<string, number>;
  /** Line-years in which a pricingTriangle existed at all. */
  triangleSeen: number;
  triangleChecked: number;
}

function runArm(flagged: boolean): ArmResult {
  const was = FORWARD_BOOKING.enabled;
  FORWARD_BOOKING.enabled = flagged;
  // per line, key `${game}|${valuationYear}` -> that line-year's carried steps
  const cells: Record<string, Map<string, { from: number; to: number }[]>> = {};
  for (const l of LINES) cells[l] = new Map();
  let triangleSeen = 0, triangleChecked = 0;

  try {
    for (let g = 0; g < GAMES; g++) {
      const id = `RL${flagged ? 'F' : 'S'}${g}`;
      const instance = generateGameInstance(id, 9_100_000 + g * 7919);
      const setup = { poolName: 'L', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      let st: unknown = poolState;

      for (let y = 1; y <= YEARS; y++) {
        const p = processYear(gs, defaultDecisionSet(y));
        st = p.updatedPoolState;
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
        for (const line of LINES) {
          triangleChecked++;
          if (triangleOf(st, line)) triangleSeen++;
        }
      }

      // Condition 3, off the ledger the window will project from.
      const S = st as never as { lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[] }> };
      for (const line of LINES) {
        for (const r of S.lines[line]?.reserveDevelopment ?? []) {
          const u = r.ultimateByValuation ?? [];
          const a0 = r.ageAtFirstValuation ?? 0;
          for (let k = 0; k + 1 < u.length; k++) {
            const age = a0 + k;
            // ⚠ WITHIN THE HORIZON ONLY. Past c.age >= c.horizon the engine stops
            // developing a cohort (simulationEngine's `developing` flag), and a
            // cohort that has run off SHOULD stop. IBNER_HORIZON is WC 5-12,
            // GL 3-8, Property 2-4, so over a ten-year window most of Property's
            // carried years are legitimately frozen — which is why the old
            // "every carried year" wording read 11.0% on BOTH arms, unmoved by
            // the flag. Years past their horizon are OUT OF SCOPE, said here
            // rather than left for the reader to infer from a low number.
            if (!(u[k] > 0) || age < 1 || age >= r.horizon) continue;
            const key = `${g}|${r.yearNumber + age}`;      // the VALUATION year
            if (!cells[line].has(key)) cells[line].set(key, []);
            cells[line].get(key)!.push({ from: u[k], to: u[k + 1] });
          }
        }
      }
    }
  } finally { FORWARD_BOOKING.enabled = was; }

  const share: Record<string, number> = {}, lineYears: Record<string, number> = {}, pooled: Record<string, number> = {};
  for (const l of LINES) {
    const groups = [...cells[l].values()].filter(v => v.length >= MIN_CARRIED);
    let a = 0, b = 0;
    for (const v of groups) for (const c of v) { a += c.from; b += c.to; }
    lineYears[l] = groups.length;
    pooled[l] = a > 0 ? b / a : NaN;
    const ok = groups.filter(v => {
      const from = v.reduce((s, c) => s + c.from, 0), to = v.reduce((s, c) => s + c.to, 0);
      return from > 0 && to / from >= MATERIAL_FACTOR;
    }).length;
    share[l] = groups.length > 0 ? ok / groups.length : NaN;
  }
  return { share, lineYears, pooled, triangleSeen, triangleChecked };
}

const shipped = runArm(false);
const flagged = runArm(true);

if (FORWARD_BOOKING.enabled !== false) {
  console.log('⚠ FORWARD_BOOKING WAS NOT RESTORED — this gate mutates it and must put it back');
  process.exitCode = 1;
}

console.log(RULE);
console.log('RATEMAKING LOOP — ACCEPTANCE TEST');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years per arm, identical seeds.\n`);

// --- conditions 1, 2, 4: UNEVALUATED, and said so -------------------------
console.log('--- CONDITIONS 1, 2 AND 4: UNEVALUATED ---');
console.log(`  LinePoolState.pricingTriangle was present in ${flagged.triangleSeen} of `
  + `${flagged.triangleChecked} line-years on the flagged arm.`);
console.log('  These three assert against a persistent rolling window that does not exist:');
console.log('    1. the played year is in the triangle at age 1     UNEVALUATED — no triangle');
console.log('    2. the oldest accident year is gone                UNEVALUATED — no triangle');
console.log('    4. the stored rate moved with the triangle         UNEVALUATED — no triangle');
console.log('  ⚠ UNEVALUATED IS NOT FAILED. Nothing here says the wiring is wrong; it says the');
console.log('  wiring is absent. reserveDevelopment is append-only and never rolls off (WC runs');
console.log('  8 -> 22 rows over 14 years), and experienceRating derives its rate on the fly and');
console.log('  stores nothing, so conditions 2 and 4 have no referent to assert about.\n');

// --- condition 3: EVALUATED, on both arms ---------------------------------
console.log('--- CONDITION 3: EVALUATED, BOTH ARMS ---');
console.log('  Carried accident years WITHIN THEIR HORIZON develop upward, value-weighted per');
console.log(`  line-year, by at least ${MATERIAL_FACTOR.toFixed(2)}x in at least `
  + `${(100 * MIN_SHARE).toFixed(0)}% of line-years.\n`);
console.log('  line       line-years   SHIPPED share   pooled     FLAGGED share   pooled     verdict');
const failures: string[] = [];
for (const line of LINES) {
  const s = shipped.share[line], f = flagged.share[line];
  // The rewrite's own test: RED on the arm with no mechanism, GREEN on the one with.
  const shippedRed = !(s >= MIN_SHARE);
  const flaggedGreen = f >= MIN_SHARE;
  const verdict = shippedRed && flaggedGreen ? 'SEPARATES' : shippedRed ? 'FLAGGED FAILS' : 'SHIPPED PASSES ⚠';
  console.log(`  ${line.padEnd(10)} ${String(flagged.lineYears[line]).padStart(10)}   `
    + `${(100 * s).toFixed(1).padStart(12)}%   ${shipped.pooled[line].toFixed(4)}   `
    + `${(100 * f).toFixed(1).padStart(12)}%   ${flagged.pooled[line].toFixed(4)}   ${verdict}`);
  if (!flaggedGreen) {
    failures.push(`CONDITION 3 ${line}: the flagged arm develops materially in only `
      + `${(100 * f).toFixed(1)}% of line-years, under the ${(100 * MIN_SHARE).toFixed(0)}% bar.`);
  }
  if (!shippedRed) {
    failures.push(`CONDITION 3 ${line}: THE SHIPPED ARM PASSES at ${(100 * s).toFixed(1)}%. `
      + 'The shipped revision law is mean-one and develops nothing, so a bar it clears is measuring '
      + 'noise. This is the defect the rewrite exists to remove — retighten, do not accept.');
  }
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`CONDITION 3 FAILING (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('CONDITION 3 HOLDS on the flagged arm and is RED on the shipped arm, which is the');
  console.log('test of the assertion as well as of the mechanism. 1 of 4 conditions evaluable.');
  console.log('');
  console.log('THE LOOP IS NOT BUILT. Conditions 1, 2 and 4 need one persistent');
  console.log('LinePoolState.pricingTriangle, projected each valuation from reserveDevelopment');
  console.log('(see the seeding ruling in this file\'s header), a window rule that retires the');
  console.log('oldest accident year, and the produced rate stamped on the triangle so condition 4');
  console.log('has something to read. That is wiring. Condition 3 is done.');
  console.log(RULE);
  process.exitCode = 1;
}
