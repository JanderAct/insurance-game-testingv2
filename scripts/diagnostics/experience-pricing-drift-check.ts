// ============================================================================
// EXPERIENCE PRICING DRIFT — DOES THE CHARGED RATE MOVE WHEN NOTHING MOVES?
//
//   npx tsx scripts/diagnostics/experience-pricing-drift-check.ts
//   GAMES=40 npx tsx scripts/diagnostics/experience-pricing-drift-check.ts
//   LINE=GL MAX_EXPOSURE_MOVE=1 npx tsx ...   <- the positive control; see below
//
// ⚠ THIS GATE IS GREEN AND IT WAS COMMISSIONED AS A RED. It was asked for as
// "experience-pricing-check's loop-stability arm, which was never built, and
// which will fail the moment it exists". BOTH HALVES OF THAT WERE WRONG, and the
// file exists anyway for the reason at the bottom of this header. What follows
// is what was actually found, because a gate built on a retracted premise has to
// carry the retraction or the next reader re-derives it.
//
// ============================================================================
// ⚠ THE ARM EXISTS. IT IS ARM 3 OF experience-pricing-check AND IT PASSES.
//
// "DOES THE LOOP STAY STABLE?" — a perturbation experiment: twin games on one
// instance, one twin shocked out of Expected funding for a single year, loop
// gain read as A x B off the divergence. It asserts A < 1 and A x B < 1, reads
// 0.26 / 0.28 / 0.45 on the shipped path, and reads 12.96 on GL against the
// pre-fix double-cession engine, so its silence is a reading and not an absence.
// The gate exits 0, all three arms green, and its EXPECTED_RED entry was already
// removed. simulationEngine's comment saying the arm was owed and the flag was
// off was stale prose on both counts and is corrected at this commit; so was
// gates.ts's tier note.
//
// ============================================================================
// ⚠ AND THE DRIFT IT WAS COMMISSIONED TO CATCH IS NOT THERE. ONE SEED IS NOT A
// MEASUREMENT, WHICH IS THE WHOLE LESSON OF THIS FILE.
//
// The commission cited "Property's charged rate falls 18.1% over ten years on a
// frozen roster, 0.0917 -> 0.0873 -> 0.0751". That figure is real, reproducible,
// and ONE GAME. Across games, on the same construction:
//
//     GAMES = 8      +0.60%  +/- 2.98%
//     GAMES = 40     -0.22%  +/- 1.71%
//
// Property's charged rate does not drift. The single-seed -18.1% sits about two
// standard deviations out on a per-game spread of ~11%, which is an unlucky draw
// and not a defect. It was reported as a finding before it was averaged, and
// this file is partly the apology for that.
//
// ⚠ THE MECHANISM PROPOSED FOR IT IS ALSO WRONG, AND THAT WAS MEASURED RATHER
// THAN DROPPED. The story was that PRICING_TRIANGLE prices off the pool's own
// BOOKED triangle, FORWARD_BOOKING contracts every occurrence before the
// triangle sees it, and so each year another under-booked cohort enters the
// window and ramps the rate down. Steepening Property's contraction should then
// steepen the ramp. It does not — 12 games at each k:
//
//     k = 0.924533 (shipped)   drift +0.20%   rate 0.09932 -> 0.10000
//     k = 0.890000             drift +2.00%   rate 0.07552 -> 0.07447
//     k = 0.850000             drift +2.02%   rate 0.05427 -> 0.05543
//     k = 0.800000             drift -0.67%   rate 0.04201 -> 0.04100
//
// The contraction moves the LEVEL hard — better than halving the charged rate
// between the first row and the last — and moves the TREND not at all. On
// reflection that is what a ROLLING window of fixed length must do: once it has
// filled, every year holds the same mix of contracted cohorts, so there is a
// level shift and no accumulating ramp. There was never a ramp to find.
//
// (The level shift is its own matter and is NOT this gate's subject. A charged
// rate that halves when a booking constant moves is what
// experience-pricing-check arm 1 grades, and it grades it green at 1.024 /
// 1.038 / 0.994.)
//
// ============================================================================
// ⚠ WHY IT IS COMMITTED ANYWAY, AND THIS IS THE ONLY ARGUMENT FOR IT.
//
// Not because it found something. Because it PINS something that nothing else
// pins, and the two gates divide the subject cleanly:
//
//   arm 3 measures the LOOP — how a displacement propagates. Twin-differencing
//   is what makes it robust, and twin-differencing CANCELS anything common to
//   both twins, so an exogenous ramp in the pricing basis is invisible to it by
//   construction. Its own header declines the ambient measurement on purpose:
//   "watching an already-stable system settle proves nothing".
//
//   this file measures the AMBIENT LEVEL PATH — whether the rate sits still when
//   the book sits still. Loop gain below 1 and monotone drift are not
//   alternatives; a stable loop driven by a ramp is stable and drifting.
//
// So the claim "the charged rate is flat on a still book" is now measured rather
// than assumed, and a future change that introduces a ramp is caught by this
// file rather than by somebody noticing it in a single game — which is exactly
// how it was almost "found" this time, in the wrong direction.
//
// It also closes a hole the other gate names in its own closing line:
// "PRICING_TRIANGLE alone is a configuration nothing here has measured."
// Cell 3 below is that configuration.
//
// ============================================================================
// ⚠ PROPERTY IS THE INSTRUMENT AND IT IS THE ONLY LINE ASSERTED ON BY DEFAULT.
//
// The three lines are not equally readable, and the two that are confounded are
// confounded by their own held paths rather than by anything this gate is about.
// Measured here, ten years, PRICING_TRIANGLE OFF, zero sampling error because
// the held path is deterministic:
//
//     WC        -9.80%   the wage divisor outruns the 6% / 3.5% trends
//     GL       +14.87%   glCappedSeverityTrend, capped near 2.0%/yr, not 7%
//     Property   0.00%   PROPERTY_HELD_PURE_PREMIUM_PER_100, to the digit
//
// On WC and GL a flag-on reading has to be scored against a moving null, and
// differencing two engine configurations is the basis hazard this repo has
// retracted more findings to than anything else. Their exposure also moves 37.8%
// over ten years, so their books are not still and the statistic does not mean
// on them what it means on Property. On Property the null is a constant, the
// roster is frozen to 0.000%, and a flat reading is the EXACT expectation rather
// than a tolerance band.
//
// WC and GL are RUN AND PRINTED with their flag-off nulls beside them so the
// confound is visible and quantified rather than argued about. They are not
// graded. Asserting them needs a modelled expectation, not a second engine.
//
// ============================================================================
// ⚠ THE POSITIVE CONTROL, BECAUSE A GATE THAT HAS NEVER FIRED IS NOT A GATE.
//
// The in-file control (cell 2, PT off) reads 0.00% with zero standard error and
// proves the statistic is not manufacturing drift. That is only half of it. The
// other half is that it FIRES on real drift, and the shipped engine supplies
// some: GL's charged rate genuinely climbs.
//
//     LINE=GL MAX_EXPOSURE_MOVE=1 npx tsx scripts/diagnostics/experience-pricing-drift-check.ts
//
// reports GL at +10.97% against a firing threshold of 6.40% and EXITS 2. Both
// knobs are needed and each says something: LINE moves the assertion, and
// MAX_EXPOSURE_MOVE lifts the stillness precondition that otherwise — correctly
// — refuses to grade a line whose book moved 37.8%. Neither is a default and
// neither is a way to make the gate lenient; they only ever make it assert on
// MORE than it does by default.
//
// ⚠ AND THE FLATNESS CONTROL IS SKIPPED ON ANY LINE BUT PROPERTY, WHICH THE
// FIRST BUILD OF THIS FILE GOT WRONG. It fired on GL's held path — correctly
// finding +14.87% — and took the positive control's exit from 2 to 1, so the
// demonstration that exit 2 means the drift assertion was itself broken. The
// held path is only a constant on Property; on WC and GL a nonzero reading there
// is the held path working.
//
// ============================================================================
// ⚠ THE BAR, AND WHAT IS AND IS NOT DERIVED IN IT.
//
// On a still book with a constant true expected loss the correct drift is ZERO.
// There is no principled positive value, so the assertion is a SIGNIFICANCE test
// — |mean drift| > 3 standard errors across games — and the one positive number
// is labelled as the concession it is:
//
//   DETECTION_FLOOR exists ONLY so this does not become a thermometer for GAMES.
//   A pure 3-SE test tightens without limit as the sample grows and would
//   eventually fire on any nonzero drift however small. 2% over ten years is a
//   JUDGEMENT about what is worth a red. It is not derived and is not dressed up
//   as derived.
//
// The gate reports the threshold it actually achieved at the sample it ran, so a
// reader can see what it could and could not have caught. At the shipped GAMES
// it catches a drift of about 6.5% and up; the WC and GL drifts above are inside
// that range, which is the sensitivity check that matters.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FORWARD_BOOKING, PRICING_TRIANGLE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(84);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 24);
const YEARS = Number(process.env.YEARS ?? 10);

/** The line the gate ASSERTS on. The other two are confounded by their own held
 *  paths and by a book that moves 37.8%; they are printed, not graded. Override
 *  exists for the positive control — see the header. */
const ASSERTED_LINE = (process.env.LINE ?? 'Property') as CoverageLine;
/** Years averaged at each end, so one heavy register cannot set the reading. */
const WINDOW = 3;
/** Significance: standard errors of the across-game mean. */
const SIGMA = 3;
/** ⚠ A JUDGEMENT, NOT A DERIVATION — see the header. It exists only to stop the
 *  significance test becoming a function of GAMES. */
const DETECTION_FLOOR = 0.02;
/** The instrument needs a still book. If the roster moves, the reading is not
 *  clean and the arm reports UNEVALUATED rather than grading it — the same
 *  precondition discipline arm 3 applies with MIN_SHOCK_CHARGE. Raising this is
 *  how the positive control asserts on a line whose book does move. */
const MAX_EXPOSURE_MOVE = Number(process.env.MAX_EXPOSURE_MOVE ?? 0.005);

interface Cell { pt: boolean; fb: boolean; name: string }
const CELLS: Cell[] = [
  { pt: true, fb: true, name: 'PT on,  FB on   (SHIPPED)' },
  { pt: false, fb: true, name: 'PT off, FB on   (held path — the in-file control)' },
  { pt: true, fb: false, name: 'PT on,  FB off  (the cell arm 3 says nothing has measured)' },
];

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, b) => s + (b - m) ** 2, 0) / (a.length - 1));
};

type Track = Record<string, { rate: number[]; exposure: number[] }>;

function playOne(seed: number): Track {
  const id = `EPD${seed}`;
  const inst = generateGameInstance(id, 6_100_000 + seed * 7919);
  const setup = { poolName: 'Drift', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const track: Track = {};
  for (const L of LINES) track[L] = { rate: [], exposure: [] };
  for (let y = 1; y <= YEARS; y++) {
    const out = processYear(gs, defaultDecisionSet(y));
    for (const L of LINES) {
      const r = (out.result as { byLine?: Record<string, Record<string, unknown>> }).byLine?.[L];
      if (!r) continue;
      const shares = r.memberPremiumShares as { exposure?: number }[] | undefined;
      track[L].rate.push((r.purePremiumPer100 as number) ?? NaN);
      track[L].exposure.push(Array.isArray(shares)
        ? shares.reduce((a, m) => a + (m.exposure ?? 0), 0) : NaN);
    }
    gs = {
      ...gs, poolState: out.updatedPoolState, lockedResults: [...gs.lockedResults, out.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
  return track;
}

/** last-window mean over first-window mean, minus one. Zero on a still book. */
function drift(series: number[]): number {
  if (series.length < 2 * WINDOW) return NaN;
  const head = mean(series.slice(0, WINDOW));
  const tail = mean(series.slice(-WINDOW));
  return head === 0 ? NaN : tail / head - 1;
}

interface Acc { drifts: number[]; expMoves: number[]; rateByYear: number[] }

function runCell(cell: Cell): Record<string, Acc> {
  const wasP = PRICING_TRIANGLE.enabled, wasF = FORWARD_BOOKING.enabled;
  PRICING_TRIANGLE.enabled = cell.pt;
  FORWARD_BOOKING.enabled = cell.fb;
  try {
    const acc: Record<string, Acc> = {};
    for (const L of LINES) acc[L] = { drifts: [], expMoves: [], rateByYear: new Array(YEARS).fill(0) };
    for (let g = 0; g < GAMES; g++) {
      const t = playOne(g + 1);
      for (const L of LINES) {
        acc[L].drifts.push(drift(t[L].rate));
        const e = t[L].exposure;
        acc[L].expMoves.push(e.length && e[0] ? Math.abs(e[e.length - 1] / e[0] - 1) : NaN);
        for (let y = 0; y < YEARS; y++) acc[L].rateByYear[y] += (t[L].rate[y] ?? 0) / GAMES;
      }
    }
    return acc;
  } finally { PRICING_TRIANGLE.enabled = wasP; FORWARD_BOOKING.enabled = wasF; }
}

// ---------------------------------------------------------------------------
console.log(RULE);
console.log('EXPERIENCE PRICING DRIFT — does the charged rate move when nothing moves?');
console.log(`${GAMES} games x ${YEARS} years x ${CELLS.length} cells. Asserts on ${ASSERTED_LINE} only.`);
console.log(RULE);

const measured = CELLS.map(c => ({ cell: c, acc: runCell(c) }));

for (const { cell, acc } of measured) {
  console.log(`\n--- ${cell.name} ---`);
  console.log('  line        drift yr1->yrN      SE      exposure move    mean rate by year (first -> last)');
  for (const L of LINES) {
    const d = acc[L].drifts.filter(Number.isFinite);
    const m = mean(d), se = sd(d) / Math.sqrt(Math.max(1, d.length));
    const em = mean(acc[L].expMoves.filter(Number.isFinite));
    const ry = acc[L].rateByYear;
    console.log(`  ${L.padEnd(10)} ${(100 * m).toFixed(2).padStart(10)}%  ${(100 * se).toFixed(2).padStart(7)}%  `
      + `${(100 * em).toFixed(3).padStart(12)}%     ${ry[0].toFixed(5)} -> ${ry[ry.length - 1].toFixed(5)}`);
  }
}

// ---------------------------------------------------------------------------
// THE ASSERTION
// ---------------------------------------------------------------------------
console.log(`\n${RULE}`);
console.log(`THE ASSERTION — ${ASSERTED_LINE}, shipped cell`);
console.log(RULE);

const failed: string[] = [];
const unevaluated: string[] = [];

const shipped = measured[0].acc[ASSERTED_LINE];
const control = measured[1].acc[ASSERTED_LINE];
const noContraction = measured[2].acc[ASSERTED_LINE];

if (!shipped || !control) {
  console.log(`  ${ASSERTED_LINE} is not a line this run tracked. LINE must be one of ${LINES.join(', ')}.`);
  process.exitCode = 1;
} else {
  const d = shipped.drifts.filter(Number.isFinite);
  const m = mean(d);
  const se = sd(d) / Math.sqrt(Math.max(1, d.length));
  const expMove = mean(shipped.expMoves.filter(Number.isFinite));
  const threshold = Math.max(SIGMA * se, DETECTION_FLOOR);
  const cd = mean(control.drifts.filter(Number.isFinite));
  const nd = mean(noContraction.drifts.filter(Number.isFinite));

  console.log(`  mean drift              ${(100 * m).toFixed(2)}%`);
  console.log(`  standard error          ${(100 * se).toFixed(2)}%  over ${d.length} games`);
  console.log(`  fires above             ${(100 * threshold).toFixed(2)}%  = max(${SIGMA} x SE, floor ${100 * DETECTION_FLOOR}%)`);
  console.log(`  roster movement         ${(100 * expMove).toFixed(3)}%  (instrument needs < ${(100 * MAX_EXPOSURE_MOVE).toFixed(1)}%)`);
  console.log(`  control, PT off         ${(100 * cd).toFixed(2)}%  <- must be flat, or this file is measuring itself`);
  console.log(`  no contraction, FB off  ${(100 * nd).toFixed(2)}%  <- the cell nothing else measures`);

  if (!Number.isFinite(expMove) || expMove > MAX_EXPOSURE_MOVE) {
    unevaluated.push(`the ${ASSERTED_LINE} roster moved ${(100 * expMove).toFixed(3)}% over the game, above the `
      + `${(100 * MAX_EXPOSURE_MOVE).toFixed(1)}% this instrument needs. A drift reading on a moving book does not mean `
      + 'what it means on a still one, and this arm declines to grade it rather than reporting a number it '
      + 'cannot defend. Raise MAX_EXPOSURE_MOVE only to run the positive control.');
  } else if (Math.abs(m) > threshold) {
    failed.push(`${ASSERTED_LINE}'s charged rate drifts ${(100 * m).toFixed(2)}% over ${YEARS} years on a book whose `
      + `exposure moves ${(100 * expMove).toFixed(3)}%, against a firing threshold of ${(100 * threshold).toFixed(2)}%. `
      + `PT off reads ${(100 * cd).toFixed(2)}% and FB off reads ${(100 * nd).toFixed(2)}% — read those two before choosing a fix. `
      + '⚠ THIS GATE CANNOT SAY WHICH FIX. A red says the charged rate is unstable on a still book. It does not '
      + 'say whether to change the booking, damp the loop, or turn PRICING_TRIANGLE off, and TURNING IT OFF IS A '
      + 'REAL OPTION RATHER THAN A RETREAT: the held rate is stable by construction rather than by measurement, '
      + 'and experience-pricing-check arm 1 reads the held arm charging 1.024 / 1.038 / 0.994 of its own realised '
      + 'cost. What the pool would lose is pricing off its own experience, which is the whole reason the flag '
      + 'exists. That trade is a judgement for a human and this file does not make it.');
  }

  // The in-file control outranks the verdict above: if the held path is not
  // flat, the instrument is broken and nothing it says is worth anything.
  //
  // ⚠ PROPERTY ONLY, AND THAT IS NOT A CONVENIENCE. The held path is a constant
  // on Property alone; WC's carries a wage divisor and GL's a capped severity
  // trend, so a nonzero reading there is the held path working correctly and
  // asserting on it would make the positive control fail for the wrong reason.
  if (ASSERTED_LINE === 'Property' && (!Number.isFinite(cd) || Math.abs(cd) > DETECTION_FLOOR)) {
    failed.push(`THE CONTROL IS NOT FLAT. Property with PRICING_TRIANGLE off drifts ${(100 * cd).toFixed(2)}%, `
      + 'and it should be zero to the digit — that cell returns PROPERTY_HELD_PURE_PREMIUM_PER_100 unchanged, '
      + 'with no trend and no wage divisor. Something upstream moved and the verdict above cannot be trusted '
      + 'until it is explained.');
  }

  console.log(`\n${RULE}`);
  if (unevaluated.length) {
    console.log('UNEVALUATED:');
    for (const u of unevaluated) console.log(`  - ${u}`);
  }
  if (failed.length) {
    console.log(`${failed.length} FAILURE(S):`);
    for (const f of failed) console.log(`  - ${f}`);
    console.log('\n⚠ EXIT 2 IS THE DRIFT ASSERTION AND NOTHING ELSE, so that a broken control or a failed');
    console.log('  precondition can never hide behind it. Those exit 1 and block.');
    process.exitCode = failed.some(f => f.startsWith('THE CONTROL')) ? 1 : 2;
  } else if (unevaluated.length) {
    process.exitCode = 1;
  } else {
    console.log(`NO DRIFT. ${ASSERTED_LINE}'s charged rate is flat on a still book and the control is flat.`);
    console.log('This is the expected result and the gate is a guard, not an open item — see the header for');
    console.log('why it exists given that it was commissioned as a red and is not one.');
  }
}
