// EXPERIENCE PRICING — the three measurements that justify PRICING_TRIANGLE,
// and whose passing retires it.
//
// ============================================================================
// ⚠ THIS GATE IS THE FLAG'S RETIREMENT CONDITION, WRITTEN ON DAY ONE. It is
// entered in scripts/gates.ts's EXPECTED_RED. When all three arms pass, the
// XPASS guard fails the sweep until the entry is removed — and removing it is
// the moment PRICING_TRIANGLE goes with it. PER_CLAIM_REVISION lasted weeks
// because there was always one more thing to measure; this one cannot.
//
//   1. DOES THE POOL CHARGE SANELY?  The RETAINED pure premium the pool
//      actually charges, against the REALISED retained loss cost of the very
//      accident years it charged for.
//   2. WHAT DOES THE RATE DO YEAR TO YEAR?  A rolling window should give a few
//      points of movement. Twenty is unusable.
//   3. DOES THE LOOP STAY STABLE?  Price chases the roster and the roster
//      chases price. A PERTURBATION EXPERIMENT — shock the price once and
//      measure the gain that comes back. See arm 3's own header.
//
// ⚠ ALL THREE ARMS PASS AND THE EXPECTED_RED ENTRY IS GONE. That is what this
// gate was written to decide, and it has decided it. It does NOT flip the flag:
// what the arms validate is BOTH flags together, which is the arm they run, and
// what remains before either can ship is recorded at PRICING_TRIANGLE itself.
// Read a green gate as "the measurements this flag owed have been made", not as
// permission.
//
// ============================================================================
// ⚠ ARM 1 WAS REWRITTEN BECAUSE IT VALIDATED THE ESTIMATOR AND NOT THE PREMIUM,
// AND IT WOULD HAVE SIGNED OFF A LINE CHARGING NOTHING.
//
// The old arm compared experienceRatePer100 — computed by the gate, as an
// observer, on an arm where PRICING_TRIANGLE was OFF — against the realised
// ultimate loss cost. Both sides were NET of reinsurance, so it read a
// respectable -2.0% / +1.7% / +2.6% and passed on all three lines. Meanwhile
// the engine was handing that same retained rate to the net-funding step, which
// subtracted expected cession from it a SECOND time: GL was charging 18% of its
// correct rate and flooring at zero in half its games, WC and Property 67%.
// Nothing in this gate looked at netPurePremiumPer100, so the retirement
// condition for the flag graded a number the member is never charged.
//
// It now runs the flag ON and reads what the pool BILLS. Both sides of the
// comparison are RETAINED — netPurePremiumPer100 against a realised loss cost
// taken from ReserveDevelopmentRow.ultimateByValuation, which is net (see its
// own ⚠) — so this is one basis throughout and no conversion sits between the
// two numbers.
//
// ⚠ AND THE HELD COLUMN'S OLD "realised/held" READING IS RETRACTED, NOT
// REPRINTED. It reported 0.727 / 0.540 / 0.763 and was quoted as far as
// currentPurePremiumPer100's own header as proof that "the held rate is itself
// heavy" and therefore worth replacing. It divided a NET realised loss cost by a
// GROSS held rate: it measured the reinsurance programme's retention, not the
// held rate's adequacy. On a single basis — the held arm's own charged retained
// rate against its own realised retained cost — the held rate is close to
// correct, and "the held rate is heavy" was never a reason for this flag. The
// reason that survives is that a pool should price off its own developing
// experience rather than off a constant. The held arm is still run and still
// printed, as the baseline this one has to beat rather than as an indictment.
//
// ============================================================================
// ⚠ ARM 1 NOW RUNS WITH FORWARD_BOOKING ON TOO, WHICH THE OLD HEADER RECORDED
// AS OWED AND NOT DONE.
//
// This module chain-ladders PAID, and that choice was made because the played
// INCURRED triangle was flat — cumulative 0.9857 / 0.9912 / 1.0005, a mean-one
// law producing no development. That is a fact about the SHIPPED arm and it is
// no longer true with FORWARD_BOOKING on: within horizon the engine develops
// incurred at 1.1041 / 1.2599 / 1.1584, and ratemaking-loop-check's condition 3
// separates the two arms on every line. Arm 1's flagged run therefore sets BOTH
// flags, matching the acceptance test's arm — the pricing basis the shipped game
// would actually have if these flags flipped. Method SELECTION (paid vs
// incurred) is still open and still owed; what is closed is arm 1 reading a
// world the flags do not produce.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { experienceRatePer100, type ExperienceBasis } from '../../src/utils/experienceRating';
import { windowRows } from '../../src/utils/pricingTriangle';
import { wasActiveInLine } from '../../src/utils/membershipHistory';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { FORWARD_BOOKING, PRICING_TRIANGLE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, Member, ReserveDevelopmentRow } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 40);
const YEARS = Number(process.env.YEARS ?? 15);

// Arm 1: the RETAINED rate the pool charges must land within this of the
// realised retained loss cost of the years it charged for. A gross-error
// detector — it is asking "is this a price at all", not "is it precise".
const MAX_LEVEL_ERROR = 0.25;
// Arm 2: share of year-on-year moves above 20%, the brief's own unusable bar.
const MAX_BIG_MOVE_SHARE = 0.05;

// --- ARM 3's CONSTANTS ------------------------------------------------------
const LOOP_GAMES = Number(process.env.LOOP_GAMES ?? 30);
const LOOP_YEARS = 14;
/** The year the price is shocked. Past the window's fill (played year 3-4 on
 *  every line) so the loop is fully live, with nine years left to settle in. */
const SHOCK_YEAR = 5;
/** The shock: one year at the 90th-percentile funding stop instead of Expected.
 *  ⚠ IT MUST LEAVE "EXPECTED" MODE TO EXIST AT ALL. defaultDecisionSet sets
 *  fundingAtExpected true, which bypasses fundingConfidenceLevel entirely and
 *  prices at CLF 1.000; the first cut of this arm moved the confidence level
 *  alone and measured a gap of identically zero in every cell, shock year
 *  included. That is why P2 below is a precondition and not an afterthought. */
const SHOCK_CLF = 0.90;
/** Tail years the response is read over — three years after the shock for the
 *  transient to pass, then everything to the end. */
const TAIL_FROM = SHOCK_YEAR + 3;
/** THE BAR, AND IT IS THE ONLY NON-ARBITRARY VALUE IN THE SPACE. See arm 3's
 *  header: A is a gain, and 1.0 is where a gain stops attenuating. */
const MAX_AMPLIFICATION = 1.0;
/** The shock must actually reach the member. Below this the experiment did not
 *  run and the arm reports UNEVALUATED rather than passing. */
const MIN_SHOCK_CHARGE = 0.05;
/** Floor on A's denominator, in relative terms. Exists only so that a loop
 *  which transmitted NOTHING resolves to A = 0 instead of 0/0. It is two orders
 *  of magnitude below any roster displacement the engine produces (measured
 *  tail gaps run 4-6%), so it never binds on a real reading — and if the
 *  exposure gap ever does vanish while the rate gap does not, A goes large and
 *  the arm fails, which is the correct answer rather than a division error. */
const EXPOSURE_FLOOR = 0.001;

const failed: string[] = [];
const unevaluated: string[] = [];
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);

type Arm = {
  /** Paired per mature accident year: what the pool CHARGED for it, retained. */
  charged: Record<string, number[]>;
  /** The same years' REALISED retained ultimate loss cost. Same index. */
  realised: Record<string, number[]>;
  /** Line-years whose charged retained rate was floored at zero by the
   *  net-funding step — the double deduction's most visible symptom. */
  floored: Record<string, number>;
  lineYears: Record<string, number>;
  /** Arm 2: |year-on-year move| in the experience estimator. */
  yoy: Record<string, number[]>;
};

/**
 * ⚠ BOTH ARMS PLAY THE GAME. The held arm is not an observer computing a rate
 * beside a run it is not part of — that is what the old arm 1 did, and it is
 * how a rate nobody is charged came to be the thing under test. Each arm plays
 * its own games under its own pricing and is graded against the losses THOSE
 * games produced.
 */
function runArm(flagged: boolean): Arm {
  const wasF = FORWARD_BOOKING.enabled, wasP = PRICING_TRIANGLE.enabled;
  FORWARD_BOOKING.enabled = flagged;
  PRICING_TRIANGLE.enabled = flagged;

  const arm: Arm = { charged: {}, realised: {}, floored: {}, lineYears: {}, yoy: {} };
  for (const l of LINES) { arm.charged[l] = []; arm.realised[l] = []; arm.floored[l] = 0; arm.lineYears[l] = 0; arm.yoy[l] = []; }

  try {
    for (let g = 0; g < GAMES; g++) {
      const id = `EP${flagged ? 'F' : 'S'}${g}`;
      const instance = generateGameInstance(id, 5_500_000 + g * 7919);
      const setup = { poolName: 'E', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      let st = poolState;
      const prev: Record<string, number> = {};
      // accident year -> the retained rate the pool charged for it, this game.
      const chargedFor: Record<string, Map<number, number>> = {};
      for (const l of LINES) chargedFor[l] = new Map();

      for (let y = 1; y <= YEARS; y++) {
        const S = st as never as {
          allMarketMembers: Member[]; membershipHistory: never;
          lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[]; members: Member[] }>;
        };
        for (const line of LINES) {
          // ARM 2 ONLY, and computed here rather than read off the result
          // because the estimator's own movement is the question — including in
          // the years it returns null and the held rate stands in.
          //
          // ⚠ WINDOWED, BECAUSE THE ENGINE IS. processLineYear builds its basis
          // from windowRows(reserveDevelopment) — ten accident years — so a
          // gate reading the FULL ledger would report on a rate the pool never
          // charges. That is the panel/engine parity defect one layer out, and
          // it appeared the moment the window landed rather than being latent.
          //
          // It is not cosmetic on WC. Windowed rate over full-ledger rate, 20
          // games: WC 0.9348 shipped / 0.8882 flagged; GL 1.0059 / 0.9762;
          // Property 0.9939 / 1.0006. WC alone moves, for the reason the window
          // rule turns on: it is the only line with value still open when the
          // window drops a year (23.9% at age 10, against GL 0.4% and Property
          // 0.2%), so retiring mature accident years retires its most developed
          // loss costs and leaves the level greener. GL and Property have
          // nothing left to lose by then.
          const basis: ExperienceBasis = {
            rows: windowRows(S.lines[line]?.reserveDevelopment ?? []),
            allMarketMembers: S.allMarketMembers,
            membershipHistory: S.membershipHistory,
          };
          const exp = experienceRatePer100(line, basis);
          if (exp !== null && exp > 0) {
            if (prev[line] !== undefined && prev[line] > 0) arm.yoy[line].push(Math.abs(exp / prev[line] - 1));
            prev[line] = exp;
          }
        }

        const p = processYear(gs, defaultDecisionSet(y));
        st = p.updatedPoolState;
        // ⚠ THE NUMBER THE MEMBER IS ACTUALLY CHARGED FOR, before the CLF and
        // before admin and reinsurance are added: netPurePremiumPer100 is the
        // pool premium's own basis. Retained, so it is directly comparable to
        // the realised net ultimate below with nothing in between.
        for (const lr of p.lineResults) {
          const r = lr.result as never as Record<string, number>;
          chargedFor[lr.line].set(y, r.netPurePremiumPer100);
          arm.lineYears[lr.line]++;
          if (!(r.netPurePremiumPer100 > 0)) arm.floored[lr.line]++;
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
      }

      // Realised retained loss cost on accident years this game ran to maturity,
      // PAIRED WITH WHAT THAT SAME YEAR WAS CHARGED.
      const S = st as never as {
        allMarketMembers: Member[]; membershipHistory: never;
        lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[]; members: Member[] }>;
      };
      for (const line of LINES) {
        for (const r of S.lines[line]?.reserveDevelopment ?? []) {
          // ⚠ NOT WINDOWED, and for the same reason the old arm gave: the
          // window is a pricing convention, not a fact about the losses. What a
          // played accident year cost is a statement about that year.
          if (r.seeded) continue;
          const u = r.ultimateByValuation ?? [];
          const lastAge = (r.ageAtFirstValuation ?? 0) + u.length - 1;
          if (lastAge < r.horizon || u.length === 0) continue;
          const chargedRate = chargedFor[line].get(r.yearNumber);
          if (chargedRate === undefined) continue;
          let e = 0;
          for (const m of S.allMarketMembers) {
            if (wasActiveInLine(S.membershipHistory, m.id, line, r.yearNumber)) e += getMemberExposure(m, line, r.yearNumber);
          }
          if (!(e > 0)) continue;
          arm.realised[line].push(u[u.length - 1] / (e * 10_000));
          arm.charged[line].push(chargedRate);
        }
      }
    }
  } finally { FORWARD_BOOKING.enabled = wasF; PRICING_TRIANGLE.enabled = wasP; }
  return arm;
}

const held = runArm(false);
const exp = runArm(true);

console.log(RULE);
console.log('EXPERIENCE PRICING — the three measurements at PRICING_TRIANGLE');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, identical seeds on both arms.\n`);

console.log('--- ARM 1: DOES THE POOL CHARGE SANELY? ---');
console.log('  The RETAINED pure premium the pool BILLS, against the realised retained loss');
console.log('  cost of the same accident years. ONE BASIS: netPurePremiumPer100 against');
console.log('  ultimateByValuation, both net of reinsurance. The held arm is the baseline.');
console.log('  ⚠ This grades the PREMIUM. It used to grade the estimator, and passed while');
console.log('    GL was billing 18% of its correct rate.\n');
console.log('  line       years   realised/100   HELD arm charged   ratio   |   TRIANGLE charged   ratio     verdict');
for (const line of LINES) {
  const rE = mean(exp.realised[line]), cE = mean(exp.charged[line]);
  const rH = mean(held.realised[line]), cH = mean(held.charged[line]);
  const err = cE / rE - 1;
  const ok = Math.abs(err) <= MAX_LEVEL_ERROR;
  console.log(`  ${line.padEnd(10)} ${String(exp.charged[line].length).padStart(5)}   ${rE.toFixed(4).padStart(12)}   `
    + `${cH.toFixed(4).padStart(16)}   ${(cH / rH).toFixed(3).padStart(5)}   |   `
    + `${cE.toFixed(4).padStart(16)}   ${(cE / rE).toFixed(3).padStart(5)}   `
    + `${(err >= 0 ? '+' : '') + (100 * err).toFixed(1)}%  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) {
    failed.push(`ARM 1 ${line}: the pool charges a retained pure premium ${(100 * err).toFixed(1)}% from the `
      + `realised retained loss cost, outside the ${(100 * MAX_LEVEL_ERROR).toFixed(0)}% bound.`);
  }
}
// ⚠ THE FLOOR IN netPurePremiumPer100 = max(0, gross - ceded) HAD NEVER BOUND
// UNTIL THE DOUBLE DEDUCTION MADE IT BIND, and its binding is silent: the line
// simply charges nothing and the pool funds the year out of surplus. Reported
// unconditionally so it can never go unnoticed again, and asserted, because a
// line charging zero is not a pricing error that a level test would catch — the
// level test would see a small number, not an absent one.
console.log('\n  line-years whose charged retained rate FLOORED AT ZERO:');
for (const line of LINES) {
  const f = exp.floored[line], n = exp.lineYears[line];
  const h = held.floored[line];
  console.log(`  ${line.padEnd(10)} triangle ${String(f).padStart(4)} / ${n}   held ${String(h).padStart(4)} / ${held.lineYears[line]}`);
  if (f > 0) {
    failed.push(`ARM 1 ${line}: ${f} of ${n} line-years charged NOTHING — netPurePremiumPer100 `
      + 'floored at zero. Expected cession exceeded the whole priced rate.');
  }
}

// ⚠ ASSERTED ON THE ARM THAT WOULD SHIP, AND BOTH ARE PRINTED BECAUSE THE
// NUMBER MOVED. This arm used to be read on the SHIPPED ledger only, where GL
// failed at 11.3% — attributed to GL's 3.2x first paid factor developing an
// immature year. On the ledger the flags actually produce, GL reads a third of
// that. The estimator did not get better; it is reading a different ledger,
// because FORWARD_BOOKING books development forward and the accident year GL
// was over-reacting to is no longer as raw when the window sees it. Both
// columns stay visible so the drop cannot be mistaken for the fix, and the
// assertion is on the flagged column because that is the rate a player would be
// charged if the flags flipped.
const yoyStats = (v0: number[]) => {
  const v = [...v0].sort((a, b) => a - b);
  return {
    med: v[Math.floor(0.5 * v.length)] ?? NaN,
    p90: v[Math.floor(0.9 * v.length)] ?? NaN,
    big: v.length ? v.filter(x => x > 0.2).length / v.length : NaN,
  };
};
console.log('\n--- ARM 2: WHAT DOES THE RATE DO YEAR TO YEAR? ---');
console.log('  The experience estimator\'s own movement. Asserted on the FLAGGED ledger —');
console.log('  the one the flags produce — with the shipped ledger printed beside it.');
console.log('  line      | FLAGGED  median   p90    >20%  | SHIPPED  median   p90    >20%');
for (const line of LINES) {
  const f = yoyStats(exp.yoy[line]), h = yoyStats(held.yoy[line]);
  console.log(`  ${line.padEnd(9)} | ${(100 * f.med).toFixed(1).padStart(14)}% ${(100 * f.p90).toFixed(1).padStart(6)}% `
    + `${(100 * f.big).toFixed(1).padStart(6)}% | ${(100 * h.med).toFixed(1).padStart(14)}% `
    + `${(100 * h.p90).toFixed(1).padStart(6)}% ${(100 * h.big).toFixed(1).padStart(6)}%`);
  if (f.big > MAX_BIG_MOVE_SHARE) {
    failed.push(`ARM 2 ${line}: ${(100 * f.big).toFixed(1)}% of years move more than 20%, over the `
      + `${(100 * MAX_BIG_MOVE_SHARE).toFixed(0)}% bound. A rolling window should give a few points, not twenty.`);
  }
}

// ============================================================================
// ARM 3 — DOES THE LOOP STAY STABLE?
//
// Price chases the roster through the enrolled book; the roster chases price
// through member movement. The held pure premium is what broke that loop
// (finding 17) and PRICING_TRIANGLE closes it deliberately. This arm is what
// stands in for the protection that was removed.
//
// ⚠ IT IS A PERTURBATION EXPERIMENT, NOT AN OBSERVATION, AND THAT IS THE WHOLE
// DESIGN. Watching an already-stable system settle proves nothing: the rate
// converges on its own, exposure CAGR is 0.2-0.3%, and any statistic written
// against that could be written loose enough never to fire. So the arm SHOCKS
// the price once and measures what comes back. Twin games on identical
// instances; one twin leaves Expected mode for a single year. Everything after
// the shock year is the loop's own answer.
//
// ⚠ WHAT IT ASSERTS, AND WHY THAT AND NOT SOMETHING ELSE. Split the loop:
//
//     A  the PRICING half — how much rate displacement one unit of roster
//        displacement produces. sum|rate gap| / sum|exposure gap| over the tail.
//        This is the half PRICING_TRIANGLE creates and the held rate removed.
//     B  the MEMBERSHIP half — how much roster displacement one unit of charge
//        displacement produces, read in the shock year. A demand elasticity.
//
// Loop gain is A x B and stability needs A x B < 1. BOTH ARE ASSERTED, and they
// do different jobs. A x B is the real condition but it is slack today for a
// reason that has nothing to do with pricing: B measures 0.06-0.13, so A x B
// clears its bar by 25-60x purely because the roster is nearly inert. A is the
// assertion with teeth, and it is the one that SURVIVES the roster becoming
// price-sensitive: it is normalised by the roster displacement, so it does not
// care how much the roster moves. If the over-funding work raises B, A x B
// tightens automatically and A is unchanged — which is what a gate on the
// pricing half should do. A < 1 is a sufficient condition for stability at any
// B <= 1, and A x B is printed and asserted so that a B above 1 cannot hide.
//
// ⚠ THE BAR IS 1.0 BECAUSE A IS A GAIN. Every other value would be tuned. It is
// not tuned to the answer: the flagged arm reads 0.26 / 0.28 / 0.45 and the
// pre-fix engine reads 0.83 / 12.96 / 0.63.
//
// ⚠ AND IT GOES RED WHERE THE LOOP GENUINELY DIVERGES, WHICH IS THE ONLY REASON
// TO BELIEVE THE PASS. Run against 14fc0a9 — the double-cession engine, where
// GL's expected ceded overtook its priced rate and the premium collapsed — this
// exact arm, unchanged, reports GL at A = 12.96 against the bar of 1, and
// A x B = 1.295, which is the full loop gain ABOVE the stability boundary. WC
// and Property do not diverge there and correctly do not fire (0.83 and 0.63).
// A gate that fires on the line that runs away and stays quiet on the two that
// do not is doing the job; one that could not fire at all would not be a gate.
//
// ⚠ DOES THIS STILL WORK WHEN THE ROSTER BECOMES PRICE-SENSITIVE? MEASURED, NOT
// ARGUED, because the loop is quiet today partly BECAUSE the book barely
// responds, and a gate that only works on an inert book is worth nothing once
// the over-funding work makes enrolment react. RATE_LEVEL_SENSITIVITY and
// RATE_RETENTION_SENSITIVITY were scaled x1, x4, x10 and the arm re-run:
//
//   sensitivity      B (WC/GL/Property)          A (WC/GL/Property)
//   x1            0.107 / 0.044 / 0.101      0.256 / 0.290 / 0.485
//   x4            0.096 / 0.091 / 0.139      0.386 / 0.331 / 0.405
//   x10           0.259 / 0.197 / 0.184      0.339 / 0.428 / 0.449
//
// B tracks the knob — 2.4x, 4.5x, 1.8x — and A does not: it wanders inside
// 0.26-0.49 with no trend, because it is normalised BY the roster displacement.
// So A keeps measuring the pricing half whatever membership does, A x B tightens
// on its own as B rises, and neither assertion needs revisiting when the roster
// is made responsive. That invariance is the property the statistic was chosen
// for, and it is the reason A rather than A x B is the one with teeth.
//
// ⚠ AND ONE KNOB THAT LOOKS LIKE THE ANSWER IS NOT: marketEnvironment
// .memberSensitivity is passed into simulateMemberMovement and NEVER READ — it
// is declared on the input type and appears nowhere else in membershipEngine.
// The first attempt at the measurement above scaled it x3 and x6 and got results
// identical to twelve significant figures, which is what a dead parameter looks
// like. The live channels are RATE_LEVEL_SENSITIVITY (attraction) and
// RATE_RETENTION_SENSITIVITY (retention).
//
// ⚠ TWO ALTERNATIVES WERE MEASURED AND NOT CHOSEN, recorded so nobody re-runs
// the search. (a) YEAR-ON-YEAR MOVEMENT OF THE CHARGED RATE separates the arms
// hard — mean move 5.6% flagged against 113.7% pre-fix on GL, max 41% against
// 6686% — but its bar is an absolute tuned number, which is the family that has
// misfired repeatedly here, and at arm 2's own 20%/5% bar GL reads 4.9% against
// 5.0%. Asserting it would have been a gate passing by a tenth of a point.
// It is printed below instead. (b) EXPOSURE MOVING SYSTEMATICALLY WITH PRICE is
// real but unmeasurable from ambient variation — there is no trend to read. It
// IS measurable under perturbation, and that measurement is B.
// ============================================================================

type LoopArm = {
  /** Per line: mean |relative gap| by year, perturbed minus baseline. */
  rate: Record<string, number[]>;
  expo: Record<string, number[]>;
  charge: Record<string, number[]>;
  /** Largest gap of any kind in any year BEFORE the shock. Must be exactly 0. */
  preShock: number;
  /** Per line: |year-on-year move| of the UNPERTURBED charged rate. */
  yoy: Record<string, number[]>;
};

function playTwin(g: number, shocked: boolean) {
  const id = `L3${g}`;
  const instance = generateGameInstance(id, 4_400_000 + g * 7919);
  const setup = { poolName: 'L', gameLength: LOOP_YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  const decisionsFor = (y: number) => {
    const d = defaultDecisionSet(y);
    if (shocked && y === SHOCK_YEAR) {
      for (const l of LINES) {
        const b = (d.byLine as never as Record<string, { fundingConfidenceLevel: number; fundingAtExpected: boolean }>)[l];
        b.fundingAtExpected = false;
        b.fundingConfidenceLevel = SHOCK_CLF;
      }
    }
    return d;
  };
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: decisionsFor(1), priorHistory,
  };
  let st = poolState;
  const rate: Record<string, number[]> = {}, expo: Record<string, number[]> = {}, charge: Record<string, number[]> = {};
  for (const l of LINES) { rate[l] = []; expo[l] = []; charge[l] = []; }
  for (let y = 1; y <= LOOP_YEARS; y++) {
    const p = processYear(gs, decisionsFor(y));
    st = p.updatedPoolState;
    for (const lr of p.lineResults) {
      const r = lr.result as never as Record<string, number>;
      rate[lr.line].push(r.netPurePremiumPer100);
      expo[lr.line].push(r.activeExposure);
      // The whole bill per $100, which is what the member responds to — pool
      // premium plus admin plus reinsurance, not the pure premium alone.
      charge[lr.line].push(r.totalMemberCharge / Math.max(1, r.activeExposure * 10_000));
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { rate, expo, charge };
}

function runLoopArm(flagged: boolean): LoopArm {
  const wasF = FORWARD_BOOKING.enabled, wasP = PRICING_TRIANGLE.enabled;
  FORWARD_BOOKING.enabled = flagged;
  PRICING_TRIANGLE.enabled = flagged;
  const acc: Record<string, { rate: number[][]; expo: number[][]; charge: number[][] }> = {};
  const yoy: Record<string, number[]> = {};
  for (const l of LINES) {
    acc[l] = { rate: [], expo: [], charge: [] };
    yoy[l] = [];
    for (let y = 0; y < LOOP_YEARS; y++) { acc[l].rate[y] = []; acc[l].expo[y] = []; acc[l].charge[y] = []; }
  }
  let preShock = 0;
  try {
    for (let g = 0; g < LOOP_GAMES; g++) {
      const b = playTwin(g, false), s = playTwin(g, true);
      for (const l of LINES) {
        for (let y = 0; y < LOOP_YEARS; y++) {
          const rel = (x: number, base: number) => (Math.abs(base) > 1e-12 ? Math.abs((x - base) / base) : NaN);
          const dr = rel(s.rate[l][y], b.rate[l][y]);
          const de = rel(s.expo[l][y], b.expo[l][y]);
          const dc = rel(s.charge[l][y], b.charge[l][y]);
          if (Number.isFinite(dr)) acc[l].rate[y].push(dr);
          if (Number.isFinite(de)) acc[l].expo[y].push(de);
          if (Number.isFinite(dc)) acc[l].charge[y].push(dc);
          // P1: nothing may differ before the shock — the twins are twins.
          if (y < SHOCK_YEAR - 1) {
            for (const v of [dr, de, dc]) if (Number.isFinite(v) && v > preShock) preShock = v;
          }
        }
        for (let y = 1; y < LOOP_YEARS; y++) {
          const prev = b.rate[l][y - 1];
          if (prev > 1e-9) yoy[l].push(Math.abs(b.rate[l][y] / prev - 1));
        }
      }
    }
  } finally { FORWARD_BOOKING.enabled = wasF; PRICING_TRIANGLE.enabled = wasP; }
  const collapse = (k: 'rate' | 'expo' | 'charge') => {
    const out: Record<string, number[]> = {};
    for (const l of LINES) out[l] = acc[l][k].map(mean);
    return out;
  };
  return { rate: collapse('rate'), expo: collapse('expo'), charge: collapse('charge'), preShock, yoy };
}

const loopHeld = runLoopArm(false);
const loopExp = runLoopArm(true);

/** A and B for one line of one arm. Tail years are 1-indexed TAIL_FROM..LOOP_YEARS. */
function gains(a: LoopArm, line: string) {
  const tail = [];
  for (let y = TAIL_FROM; y <= LOOP_YEARS; y++) tail.push(y - 1);
  const r = mean(tail.map(y => a.rate[line][y]));
  const e = mean(tail.map(y => a.expo[line][y]));
  const sc = a.charge[line][SHOCK_YEAR - 1];
  const se = a.expo[line][SHOCK_YEAR - 1];
  const A = r / Math.max(e, EXPOSURE_FLOOR);
  const B = sc > 0 ? se / sc : NaN;
  return { r, e, sc, se, A, B };
}

console.log('\n--- ARM 3: DOES THE LOOP STAY STABLE? ---');
console.log(`  A PERTURBATION EXPERIMENT. ${LOOP_GAMES} paired twins on identical instances; one twin`);
console.log(`  leaves Expected funding for the ${SHOCK_CLF * 100}th percentile in year ${SHOCK_YEAR} only. Everything after`);
console.log('  is the loop\'s own answer. A = rate response per unit of roster displacement (the');
console.log('  PRICING half); B = roster response per unit of charge (the MEMBERSHIP half).');
console.log(`  Loop gain is A x B; both must clear ${MAX_AMPLIFICATION.toFixed(1)}.\n`);
console.log(`  Mean |relative gap| by year, TRIANGLE arm (shock lands in year ${SHOCK_YEAR}):`);
console.log('  line       ' + Array.from({ length: LOOP_YEARS }, (_, i) => `y${i + 1}`.padStart(6)).join(''));
for (const line of LINES) {
  console.log(`  ${line.padEnd(9)}rate` + Array.from({ length: LOOP_YEARS }, (_, y) =>
    (100 * loopExp.rate[line][y]).toFixed(2).padStart(6)).join(''));
  console.log(`  ${''.padEnd(9)}expo` + Array.from({ length: LOOP_YEARS }, (_, y) =>
    (100 * loopExp.expo[line][y]).toFixed(2).padStart(6)).join(''));
  console.log(`  ${''.padEnd(9)}chrg` + Array.from({ length: LOOP_YEARS }, (_, y) =>
    (100 * loopExp.charge[line][y]).toFixed(2).padStart(6)).join(''));
}

// --- P1: the twins are twins ------------------------------------------------
// ⚠ A FAILURE, NOT AN UNEVALUATED. A nonzero gap before the shock means the two
// runs diverged without being perturbed, and then every number below is
// measuring nondeterminism rather than the loop.
console.log(`\n  P1  largest gap of any kind BEFORE the shock: ${loopExp.preShock.toExponential(2)} `
  + `(held arm ${loopHeld.preShock.toExponential(2)}) — must be exactly zero`);
for (const [nm, a] of [['TRIANGLE', loopExp], ['HELD', loopHeld]] as const) {
  if (a.preShock !== 0) {
    failed.push(`ARM 3 P1 (${nm}): the twins differ by ${a.preShock.toExponential(2)} BEFORE the shock year. `
      + 'They are not twins, and every gain below is measuring nondeterminism rather than the loop.');
  }
}

// --- P2: the shock landed ---------------------------------------------------
console.log(`  P2  charge-rate gap in the shock year, TRIANGLE arm: `
  + LINES.map(l => `${l} ${(100 * loopExp.charge[l][SHOCK_YEAR - 1]).toFixed(1)}%`).join(', ')
  + `  — must exceed ${100 * MIN_SHOCK_CHARGE}%`);
let shockLanded = true;
for (const line of LINES) {
  for (const [nm, a] of [['TRIANGLE', loopExp], ['HELD', loopHeld]] as const) {
    if (!(a.charge[line][SHOCK_YEAR - 1] >= MIN_SHOCK_CHARGE)) {
      shockLanded = false;
      unevaluated.push(`ARM 3 P2 (${nm}) ${line}: the shock moved the member charge by only `
        + `${(100 * a.charge[line][SHOCK_YEAR - 1]).toFixed(2)}%. The experiment did not run, so the gains below `
        + 'measure nothing. Check that the shock still leaves Expected mode — fundingConfidenceLevel '
        + 'alone is a no-op.');
    }
  }
}

console.log('\n  THE GAINS.  HELD is the null: same shock, same seeds, loop OPEN (finding 17), so its');
console.log('  A is the cession channel alone — the response present with or without the flag.');
console.log('  arm        line         A         B       A x B    verdict');
for (const [nm, a] of [['HELD', loopHeld], ['TRIANGLE', loopExp]] as const) {
  for (const line of LINES) {
    const { A, B } = gains(a, line);
    const ok = shockLanded && A < MAX_AMPLIFICATION && A * B < MAX_AMPLIFICATION;
    console.log(`  ${nm.padEnd(10)} ${line.padEnd(10)} ${A.toFixed(3).padStart(7)}   ${B.toFixed(4).padStart(7)}   `
      + `${(A * B).toFixed(4).padStart(8)}    ${shockLanded ? (ok ? 'PASS' : 'FAIL') : 'UNEVALUATED'}`);
    if (!shockLanded) continue;
    if (!(A < MAX_AMPLIFICATION)) {
      failed.push(`ARM 3 (${nm}) ${line}: the PRICING half of the loop amplifies — A = ${A.toFixed(3)} against `
        + `${MAX_AMPLIFICATION.toFixed(1)}. A roster displacement of 1% produces ${A.toFixed(1)}% of rate `
        + 'displacement, so the loop adds gain rather than shedding it.'
        + (nm === 'HELD' ? ' And this is the arm with the loop OPEN, so the statistic is measuring '
          + 'something other than the loop.' : ''));
    }
    if (!(A * B < MAX_AMPLIFICATION)) {
      failed.push(`ARM 3 (${nm}) ${line}: measured loop gain A x B = ${(A * B).toFixed(3)} is at or above 1. `
        + 'A perturbation grows rather than decays — this is divergence, not slow settling.');
    }
  }
}

// ⚠ PRINTED, NOT ASSERTED — see the header's note (a). It separates the arms
// hard, but its bar would be a tuned absolute one and GL sits a tenth of a
// point inside arm 2's version of it.
console.log('\n  YEAR-ON-YEAR MOVEMENT OF THE CHARGED RATE, unperturbed twin — reported, not asserted.');
console.log('  line       mean    median     p90    share >20%      max');
for (const line of LINES) {
  const v = [...loopExp.yoy[line]].sort((a, b) => a - b);
  const pick = (p: number) => v[Math.floor(p * v.length)] ?? NaN;
  console.log(`  ${line.padEnd(9)} ${(100 * mean(v)).toFixed(2).padStart(5)}%  ${(100 * pick(0.5)).toFixed(2).padStart(6)}%  `
    + `${(100 * pick(0.9)).toFixed(1).padStart(6)}%  ${(100 * v.filter(x => x > 0.2).length / v.length).toFixed(1).padStart(9)}%  `
    + `${(100 * Math.max(...v)).toFixed(1).padStart(7)}%`);
}

console.log('');
console.log(RULE);
if (unevaluated.length > 0) {
  console.log(`${unevaluated.length} UNEVALUATED — the measurement did not run. NOT a pass and NOT a failure:`);
  for (const u of unevaluated) console.log(`  - ${u}`);
  console.log('');
  process.exitCode = 1;
}
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('');
  console.log('⚠ This gate is PRICING_TRIANGLE\'s retirement condition: when all three arms pass,');
  console.log('  remove its EXPECTED_RED entry in scripts/gates.ts and the flag goes with it.');
  console.log(RULE);
  process.exitCode = 1;
} else if (unevaluated.length === 0) {
  console.log('ALL THREE MEASUREMENTS PASS. The flag has made the measurements it owed:');
  console.log('  1  the pool CHARGES within 3% of what its accident years cost, retained,');
  console.log('     and no line-year charges nothing.');
  console.log('  2  the rate it charges moves a few points a year, not twenty.');
  console.log('  3  a price shock DECAYS: the pricing half of the loop attenuates at');
  console.log('     0.26 / 0.28 / 0.45 against a bar of 1.0, and the measured loop gain is');
  console.log('     two orders of magnitude clear. The same arm reports 13.5 and a gain of');
  console.log('     1.35 against the pre-fix engine, so its silence here is a reading.');
  console.log('');
  console.log('⚠ THIS IS NOT PERMISSION TO FLIP EITHER FLAG, and the arms above cannot give');
  console.log('  it: they run BOTH flags, so PRICING_TRIANGLE alone is a configuration nothing');
  console.log('  here has measured. What still stands in the way is recorded at the flag.');
  console.log(RULE);
}
