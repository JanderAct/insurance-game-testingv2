// THE RATEMAKING LOOP — THE ACCEPTANCE TEST. Play a year; all four must hold.
//
//   1. the triangle the pool priced that year off now CONTAINS that year, age 1
//   2. the oldest accident year is GONE
//   3. every remaining accident year has developed one step, ON INCURRED
//   4. the next year is priced off the UPDATED triangle
//
// ============================================================================
// ⚠ WRITTEN BEFORE THE LOOP EXISTED, AND IT NOW PASSES 4/4 ON THE FLAGGED ARM.
// This gate is the deliverable's definition, not a report on a component. Four
// components had each passed their own gate while the loop stayed unbuilt, so
// this one was written first and made to pass last. It came out of EXPECTED_RED
// at the commit that built LinePoolState.pricingTriangle.
//
// ⚠ PASSING DOES NOT MEAN SHIPPING. Conditions 3 and 4 are asserted with
// FORWARD_BOOKING and PRICING_TRIANGLE on, and both flags still ship OFF —
// PRICING_TRIANGLE because experience-pricing-check's loop-stability arm does
// not exist, FORWARD_BOOKING because Property still over-develops by 22%. The
// loop is BUILT and CORRECT; it is not yet CALIBRATED. Do not read a green
// acceptance test as permission to flip either flag.
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
// pattern no book produces. reserveDevelopment opens as a proper staircase
// (ay-4 at age 1, ay-5 at age 2, ... ay-8 at age 5) and every factor in it —
// seeded rows included — is engine-produced, because runPriorHistory calls
// processYear. So the ledger is internally consistent end to end and the shape
// problem does not arise.
//
// ⚠ CORRECTED: "7-8 rows at game start, ten within two or three played years"
// was written here and in claimTriangle.ts and is wrong on both halves.
// Measured, flagged arm, 8 games: WC opens at 6.5 rows and reaches ten at
// PLAYED YEAR 4; GL 7.0 and year 3; Property 7.5 and year 3. So the window is
// short on every line for the first three years and shortest on WC — the pool
// prices off a PARTIAL window before it prices off a full one, which is a real
// property of the opening game rather than a warm-up to be papered over.
//
// Condition 3 is asserted against reserveDevelopment directly rather than
// against the projection, so it measures the ENGINE rather than the window.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FORWARD_BOOKING, PRICING_TRIANGLE, TRIANGLE_HISTORY_YEARS } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, PricingTriangleState, ReserveDevelopmentRow } from '../../src/types/simulation';

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
// CONDITION 3 IS PAIRED, AND ON THIS GATE THAT IS NOT A TIGHTENING — IT IS THE
// ONLY ESTIMATOR THAT WORKS AT ALL.
//
// ⚠ THE FOURTH APPEARANCE OF THE PAIRED LESSON, AND THE FIRST OF ITS KIND.
// Cession bought 5x. M2 bought 5x. The climb instrument bought only 1.2x and
// that was CHECKED rather than assumed. Three times pairing was CHEAPER — the
// same question answered on less sample. Here an absolute test is IMPOSSIBLE,
// not merely expensive, and the distinction is worth having written down.
//
// ⚠ WHY NO ABSOLUTE BAR CAN WORK. A fixed bar must sit above the noise and
// below the signal. Once the drift is scaled by the open-share curve,
// Property's INTENDED steps are 1.137 / 1.052 / 1.025 at ages 1-3, while
// MATERIAL_FACTOR was 1.02 read off the shipped arm's own 95th percentile.
// There is no gap left to sit in: the smallest real signal and the noise floor
// are the same size. Property read 94% under the old engine and 67.9% under the
// fixed one — and the 94% was earned by developing value whose claims had
// closed, which is the +35.1% overshoot maturity-anchor-check now forbids. The
// gate was green BECAUSE of the defect.
//
// ⚠ PAIRING REMOVES THE NOISE RATHER THAN CLEARING IT. Same seeds, same
// line-years, both arms: the shipped arm IS the null for that exact cell. A
// 1.025 intended step against a paired null of 1.000 is a 2.5% signal on
// near-zero noise, not a 0.5% margin over a 2% floor. And the tuned constant
// disappears — the question becomes whether flagged minus shipped is positive
// more often than chance, which is a sign test and has no bar to pick.
//
// ⚠ SIGNIFICANCE, NOT A SHARE. PASS requires the one-sided sign test against
// p=0.5 to clear MAX_P. That is a stringent threshold rather than a
// conventional 0.05 because three lines are tested at once and because this
// repo's history is of under-powered readings believed too early. It is not
// tuned to the answer: it is the same number whatever the lines read.
//
// ⚠ AND IT MUST STILL FAIL WHERE THERE IS NO MECHANISM. The ORIGINAL condition
// 3 was a float inequality that passed 73.7% of SHIPPED line-years where
// nothing develops; the absolute bar fixed that; a paired version could fall
// into the same hole a third time. TWO CONTROLS RUN EVERY TIME:
//
//   SHIPPED vs SHIPPED, same seeds — the difference is identically zero, so no
//     cell is positive and the sign test cannot fire. Catches a statistic that
//     reads signal out of a pairing with itself.
//   SHIPPED vs SHIPPED, DISJOINT seeds — genuine noise with no mechanism in it.
//     The share positive must sit near 0.5 and the test must NOT clear MAX_P.
//     This is the control that would catch a one-sided estimator.
//
// Both are asserted, not merely printed. A control that passes fails the gate.
//
// ⚠ THE SCOPE CORRECTION FROM THE PREVIOUS COMMIT IS RETIRED, ON ITS OWN
// MERITS AND NOT BECAUSE PAIRING SUCCEEDED. It excluded steps whose own
// deterministic drift was under 1.02, because demanding a 1.02x move from a
// 1.012x intended step asserts against the mechanism. That incoherence was a
// property of the ABSOLUTE bar. A paired test is coherent for any positive
// intended step however small, so the correction now solves a problem the
// statistic does not have — and excluding cells would cost power and could hide
// a real failure at the ages where development is smallest.
// ============================================================================
/** One-sided sign-test threshold. Three lines are tested; 0.05 is too loose. */
const MAX_P = 0.001;
/** A line-year needs at least this many carried within-horizon years to count. */
const MIN_CARRIED = 2;


// ============================================================================
// ⚠ THE ACCEPTANCE ARM IS BOTH FLAGS, AND THAT IS A FINDING RATHER THAN A
// CONVENIENCE. Condition 4 says the next year is priced off the UPDATED
// triangle. With PRICING_TRIANGLE off, currentPurePremiumPer100 returns the
// HELD rate, which moves with the trend factors and WC's roster blend and never
// reads the triangle at all — so the rate would move every year and condition 4
// would pass while being false. FORWARD_BOOKING supplies condition 3 (incurred
// development); PRICING_TRIANGLE supplies condition 4 (the triangle is the
// pricing input). Both ship OFF and both are exercised here.
//
// PRICING_TRIANGLE's own retirement condition is unchanged and unaffected: it
// stays off until experience-pricing-check's loop-stability arm exists and
// passes. Turning it on in a gate is not turning it on.
// ============================================================================
function triangleOf(st: unknown, line: CoverageLine): PricingTriangleState | undefined {
  const s = st as { lines?: Record<string, { pricingTriangle?: PricingTriangleState }> };
  return s.lines?.[line]?.pricingTriangle;
}
const appliedRateOf = (st: unknown, line: CoverageLine): number | undefined => {
  const s = st as { lines?: Record<string, { purePremiumPer100?: number }> };
  return s.lines?.[line]?.purePremiumPer100;
};
const depthOf = (t: PricingTriangleState) => new Set(t.cells.map(c => c.accidentYear)).size;
const cellAt = (t: PricingTriangleState, ay: number, age: number) =>
  t.cells.find(c => c.accidentYear === ay && c.age === age);

interface ArmResult {
  /** Per line, per (game|valuation year): that cell's value-weighted factor. */
  factor: Record<string, Map<string, number>>;
  /** Conditions 1, 2 and 4: passes and opportunities. */
  c1: number; c2: number; c4: number; checked: number;
  absent: number;
  notes: string[];
}

function runArm(flagged: boolean, seedOffset = 0, tag = ''): ArmResult {
  const wasF = FORWARD_BOOKING.enabled, wasP = PRICING_TRIANGLE.enabled;
  FORWARD_BOOKING.enabled = flagged;
  PRICING_TRIANGLE.enabled = flagged;
  // per line, key `${game}|${valuationYear}` -> that line-year's carried steps
  const cells: Record<string, Map<string, { from: number; to: number }[]>> = {};
  for (const l of LINES) cells[l] = new Map();
  let c1 = 0, c2 = 0, c4 = 0, checked = 0, absent = 0;
  const notes: string[] = [];
  const note = (s: string) => { if (notes.length < 8) notes.push(s); };

  try {
    for (let g = 0; g < GAMES; g++) {
      const id = `RL${flagged ? 'F' : 'S'}${tag}${g}`;
      const instance = generateGameInstance(id, 9_100_000 + seedOffset + g * 7919);
      const setup = { poolName: 'L', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      let st: unknown = poolState;
      // The triangle as it stood at the END of the previous year — which is the
      // one that priced THIS year. Condition 4 is asserted against it.
      let prev: Partial<Record<CoverageLine, PricingTriangleState>> = {};

      for (let y = 1; y <= YEARS; y++) {
        const before: Partial<Record<CoverageLine, PricingTriangleState>> = {};
        for (const line of LINES) {
          const t = triangleOf(st, line);
          if (t) before[line] = JSON.parse(JSON.stringify(t)) as PricingTriangleState;
        }

        const p = processYear(gs, defaultDecisionSet(y));
        st = p.updatedPoolState;
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };

        // Assert only once every window slot is a PLAYED accident year.
        if (y <= TRIANGLE_HISTORY_YEARS) { prev = before; continue; }

        for (const line of LINES) {
          const b = before[line], a = triangleOf(st, line);
          checked++;
          if (!b || !a) { absent++; continue; }

          // --- 1. the played year is in the triangle at AGE 1 ----------------
          // ⚠ AGE 1, NOT 0. The ledger registers a year written this year with
          // ageAtFirstValuation 0; a triangle's first development column is age
          // 1 by convention. projectPricingTriangle converts, and this is the
          // assertion that would catch it if it stopped.
          const fresh = cellAt(a, y, 1);
          if (fresh && fresh.incurred > 0) c1++;
          else note(`${line} y${y}: condition 1 — accident year ${y} is not in the triangle at age 1`);

          // --- 2. the oldest accident year is gone, depth capped ------------
          const oldestBefore = Math.min(...b.cells.map(c => c.accidentYear));
          const stillThere = a.cells.some(c => c.accidentYear === oldestBefore);
          const depth = depthOf(a);
          if (!stillThere && depth === a.years) c2++;
          else note(`${line} y${y}: condition 2 — oldest accident year ${oldestBefore} `
            + `${stillThere ? 'is still present' : `went, but depth is ${depth} not ${a.years}`}`);

          // --- 4. THIS year was priced off the triangle that preceded it -----
          // ⚠ TWO PARTS, AND THE FIRST IS THE REAL ONE. (a) the rate the pool
          // APPLIED this year equals the rate the PREVIOUS triangle stamped —
          // that is what "priced off the triangle" means, and a harness that
          // recomputed the rate for itself would prove nothing. (b) the stamped
          // rate MOVED, which stops a constant satisfying (a) trivially.
          // `b` IS the triangle that priced year y — it is the state as it
          // stood when the year began. `prev` is the one before that, and is
          // used only to establish that the stamp is not a constant.
          const applied = appliedRateOf(st, line);
          const stamped = b.ratePer100;
          const moved = stamped !== undefined && prev[line]?.ratePer100 !== undefined
            && stamped !== prev[line]!.ratePer100;
          if (stamped !== undefined && applied !== undefined && moved
            && Math.abs(applied - stamped) <= 1e-9 * Math.max(1, Math.abs(stamped))) c4++;
          else if (stamped === undefined) note(`${line} y${y}: condition 4 — the triangle that priced this year stamped no rate`);
          else if (applied === undefined) note(`${line} y${y}: condition 4 — no applied rate on the line state`);
          else if (Math.abs(applied - stamped) > 1e-9 * Math.max(1, Math.abs(stamped))) {
            note(`${line} y${y}: condition 4 — applied ${applied.toFixed(6)} is not the `
              + `${stamped.toFixed(6)} the triangle that priced it stamped`);
          } else note(`${line} y${y}: condition 4 — the stamped rate did not move from the year before`);
        }
        prev = before;
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
  } finally { FORWARD_BOOKING.enabled = wasF; PRICING_TRIANGLE.enabled = wasP; }

  // Per-cell value-weighted factor, keyed so the two arms pair exactly.
  const factor: Record<string, Map<string, number>> = {};
  for (const l of LINES) {
    factor[l] = new Map();
    for (const [key, v] of cells[l]) {
      if (v.length < MIN_CARRIED) continue;
      const from = v.reduce((t, c) => t + c.from, 0), to = v.reduce((t, c) => t + c.to, 0);
      if (from > 0) factor[l].set(key, to / from);
    }
  }
  return { factor, c1, c2, c4, checked, absent, notes };
}

const shipped = runArm(false);
const flagged = runArm(true);
// ⚠ THE DISJOINT-SEED CONTROL. Genuine noise, no mechanism. Pairing cell-for-cell
// against `shipped` is then meaningless by construction, which is the point: the
// sign test must NOT fire on it.
const shippedB = runArm(false, 5_000_000, 'B');

if (FORWARD_BOOKING.enabled !== false || PRICING_TRIANGLE.enabled !== false) {
  console.log('⚠ A FLAG WAS NOT RESTORED — this gate mutates both and must put them back');
  process.exitCode = 1;
}

console.log(RULE);
console.log('RATEMAKING LOOP — ACCEPTANCE TEST');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years per arm, identical seeds.\n`);

// --- conditions 1, 2, 4 ---------------------------------------------------
const failures: string[] = [];
console.log('--- CONDITIONS 1, 2 AND 4: THE ROLLING WINDOW ---');
console.log(`  ${flagged.checked} line-years asserted on the flagged arm, from year `
  + `${TRIANGLE_HISTORY_YEARS + 1} so every window slot is a PLAYED accident year.`);
if (flagged.absent > 0) {
  console.log(`  ⚠ ${flagged.absent} of them had NO pricingTriangle — UNEVALUATED, not failed.`);
}
const c124 = [
  ['1. the played year is in the triangle at age 1', flagged.c1],
  ['2. the oldest accident year is gone, depth capped', flagged.c2],
  ['4. this year was priced off the triangle before it', flagged.c4],
] as const;
for (const [label, n] of c124) {
  const ok = n === flagged.checked && flagged.checked > 0;
  console.log(`    ${label.padEnd(52)} ${String(n).padStart(4)} / ${flagged.checked}   ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) failures.push(`${label} — ${n} of ${flagged.checked} line-years`);
}
if (flagged.notes.length > 0) {
  console.log('  first failures:');
  for (const n of flagged.notes) console.log(`    - ${n}`);
}
// ⚠ THE SHIPPED ARM HAS A TRIANGLE AND MUST NOT BE PRICED BY IT, WHICH IS THE
// DISTINCTION THAT MATTERS. The projection is DERIVED and runs on both arms —
// it is a view of a ledger that already exists and moves no value. What must
// not reach the shipped path is the triangle as a PRICING INPUT, and with
// PRICING_TRIANGLE off currentPurePremiumPer100 returns the held rate. So
// condition 4 must FAIL on the shipped arm, exactly as condition 3 does, and
// conditions 1 and 2 must PASS on both because they are wiring rather than
// mechanism. Value identity on the shipped path is asserted by
// value-identity-check and the export hash, not by the absence of a field.
console.log(`  shipped arm: 1 ${shipped.c1 === shipped.checked ? 'PASS' : 'fail'}`
  + `, 2 ${shipped.c2 === shipped.checked ? 'PASS' : 'fail'}`
  + `, 4 ${shipped.c4} / ${shipped.checked} — condition 4 MUST fail here: the held rate`);
console.log('  prices that arm, so a triangle-stamped rate it matched would be a coincidence.');
if (shipped.c4 > 0) {
  failures.push(`CONDITION 4 passed on ${shipped.c4} SHIPPED line-years. With PRICING_TRIANGLE off `
    + 'the held rate is applied, so the triangle cannot be what priced them. Investigate before accepting.');
}
console.log('');

// --- condition 3: PAIRED, plus two controls -------------------------------
/**
 * One-sided sign test: P(X >= k) for X ~ Binomial(n, 0.5). Exact, summed in the
 * shorter tail so it stays stable at the n this gate runs at.
 */
function signTestP(k: number, n: number): number {
  if (n === 0) return 1;
  let logC = 0, total = 0;
  for (let i = 0; i < k; i++) logC += Math.log((n - i) / (i + 1));
  // walk down from k accumulating the upper tail
  let term = logC;
  for (let i = k; i <= n; i++) {
    total += Math.exp(term - n * Math.LN2);
    term += Math.log((n - i) / (i + 1));
  }
  return Math.min(1, total);
}

/** Pair two arms cell-for-cell and sign-test the difference. */
function paired(a: ArmResult, b: ArmResult, line: string) {
  let pos = 0, n = 0, sum = 0;
  for (const [key, fa] of a.factor[line]) {
    const fb = b.factor[line].get(key);
    if (fb === undefined) continue;
    n++; sum += fa - fb;
    if (fa - fb > 0) pos++;
  }
  return { pos, n, mean: n > 0 ? sum / n : NaN, p: signTestP(pos, n) };
}

console.log('--- CONDITION 3: PAIRED, flagged minus shipped on the SAME seeds ---');
console.log('  Is the paired difference positive more often than chance? No absolute bar —');
console.log(`  a one-sided sign test against p=0.5, passing at p < ${MAX_P}.\n`);
console.log('  line       cells   positive   share    mean diff    sign-test p     verdict');
for (const line of LINES) {
  const r = paired(flagged, shipped, line);
  const ok = r.n > 0 && r.p < MAX_P;
  console.log(`  ${line.padEnd(10)} ${String(r.n).padStart(5)}   ${String(r.pos).padStart(8)}   `
    + `${(100 * r.pos / Math.max(1, r.n)).toFixed(1).padStart(5)}%   ${(r.mean >= 0 ? '+' : '') + r.mean.toFixed(4)}   `
    + `${r.p.toExponential(2).padStart(11)}     ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) {
    failures.push(`CONDITION 3 ${line}: paired flagged-minus-shipped is positive in `
      + `${r.pos} of ${r.n} line-years, sign-test p ${r.p.toExponential(2)} against ${MAX_P}.`);
  }
}

console.log('\n  --- CONTROL 1: shipped vs shipped, SAME seeds. Difference is identically');
console.log('      zero, so nothing can be positive and the test cannot fire. ---');
for (const line of LINES) {
  const r = paired(shipped, shipped, line);
  const fired = r.n > 0 && r.p < MAX_P;
  console.log(`  ${line.padEnd(10)} ${String(r.n).padStart(5)} cells, ${r.pos} positive, `
    + `p ${r.p.toExponential(2)}   ${fired ? 'FIRED ⚠' : 'silent'}`);
  if (fired) {
    failures.push(`CONTROL 1 ${line}: the paired statistic FIRED on an arm paired with ITSELF. `
      + 'That is signal read out of nothing and the statistic is wrong.');
  }
}

console.log('\n  --- CONTROL 2: shipped vs shipped, DISJOINT seeds. Real noise, no');
console.log('      mechanism. The share must sit near 0.5 and the test must not fire. ---');
for (const line of LINES) {
  const r = paired(shippedB, shipped, line);
  const fired = r.n > 0 && r.p < MAX_P;
  console.log(`  ${line.padEnd(10)} ${String(r.n).padStart(5)} cells, `
    + `${(100 * r.pos / Math.max(1, r.n)).toFixed(1)}% positive, mean `
    + `${(r.mean >= 0 ? '+' : '') + r.mean.toFixed(4)}, p ${r.p.toExponential(2)}   ${fired ? 'FIRED ⚠' : 'silent'}`);
  if (fired) {
    failures.push(`CONTROL 2 ${line}: the paired statistic FIRED on two runs of the arm with NO `
      + 'mechanism. It is detecting something other than development — the same defect family as the '
      + 'float inequality and the noise-clearing bar before it.');
  }
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`FAILING (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE RATEMAKING LOOP HOLDS — ALL FOUR CONDITIONS, EVERY LINE, EVERY YEAR PAST');
  console.log('THE WINDOW DEPTH.');
  console.log('');
  console.log('  1. the year the pool played is in the triangle that priced it, at age 1');
  console.log('  2. the oldest accident year is gone and the window stays ten deep');
  console.log('  3. carried years develop MORE than the same years on the same seeds without');
  console.log('     the mechanism — paired, sign-tested, with both null controls silent');
  console.log('  4. the rate applied IS the rate the preceding triangle stamped, and it moved');
  console.log('');
  console.log('⚠ ON THE FLAGGED ARM — FORWARD_BOOKING for condition 3, PRICING_TRIANGLE for');
  console.log('condition 4. Both still ship OFF. PRICING_TRIANGLE\'s retirement condition is');
  console.log('unchanged: experience-pricing-check\'s loop-stability arm does not exist, and');
  console.log('until it does the held rate stays the shipped path. Exercising a flag in a gate');
  console.log('is not turning it on.');
  console.log(RULE);
}
