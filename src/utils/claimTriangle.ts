// ============================================================================
// THE PRICING TRIANGLE — S1. NOTHING READS THIS YET.
//
// ⚠ PRICING_TRIANGLE.enabled IS FALSE AND NOTHING IN src/ CALLS THIS MODULE.
// The pool still prices off the held pure premium exactly as before; this file
// has one consumer, triangle-check.ts, and both standing gates are byte-identical
// against the parent. When the flag flips, `currentPurePremiumPer100` reads a
// developed triangle instead of a constant — that is S3, not this commit.
//
// ============================================================================
// WHAT THIS IS FOR, AND WHY IT COULD NOT BE MEASURED BEFORE IT EXISTED.
//
// The pool is to price off its own experience: ten accident years, each at its
// OWN maturity, developed to ultimate with selected factors. Measured on the
// SHIPPED engine, that is impossible — the incurred triangle there is flat.
// Age-to-age factors read 0.992 to 1.002 on all three lines against the pool's
// own GL experience of 1.872 / 1.439 / 1.265 / 1.031 / 1.024, because a cohort
// is booked AT its register sum on day one (bookingBias is 0.80 x max(0, 1-CLF)
// and the shipped default CLF is exactly 1.000) and then developed by a mean-one
// factor. A chain ladder on it returns the truth: 1.001 / 0.999 / 1.002.
//
// ⚠ SO THE TRIANGLE IS NOT A VIEW OF THE EXISTING PATH. It is a second claim
// draw with a different generation order, and that difference IS the mechanism.
//
// ============================================================================
// FORWARD DEVELOPMENT, AND THE ULTIMATE IS NOT KNOWN AT GENERATION.
//
// The shipped generators draw an ULTIMATE and the engine develops it with a
// mean-one factor, so the ultimate is known at inception and the development is
// noise around it. Here a claim is drawn as an INITIAL ESTIMATE and walked
// forward; where it lands is not known when it is written. That is the whole
// point and it is what makes a factor selection meaningful: there is something
// genuinely unobserved at the valuation date.
//
// ⚠ THE INITIAL DISTRIBUTION IS DERIVED, NOT FITTED, AND THE ARITHMETIC IS
// TESTABLE. Development is a variance ADDED in log space, so
//
//     Var[ln terminal] = Var[ln initial] + Var[ln development] + 2Cov
//
// and the severity fit becomes the TERMINAL target rather than the draw. Solving
// for the initial spread gives the contraction at
// TRIANGLE_INITIAL_CONTRACTION: initial = A x drawn^k. See that constant for
// the solve, the per-line development variances behind it, and why GL's figure
// was NOT carried across to the other two lines.
//
// ⚠ THE MEAN IS PRESERVED AND THAT IS NOT COSMETIC. The triangle is read as a
// LOSS COST. The development law is mean-one, so E[terminal] = E[initial], and
// A is solved to hold E[initial] = E[drawn] exactly — measured at 1.00000 on
// every line. Contracting the log spread WITHOUT re-centring would move the
// mean by exp((1-k^2) sigma^2 / 2), which on GL is a factor of 1.5.
// ============================================================================

import { generateWcClaims } from './wcClaimEngine';
import { generateGlClaims } from './glClaimEngine';
import { generatePropertyClaims } from './propertyClaimEngine';
import { closedShare, claimClosureUnit } from './claimClosure';
import { cumulativePaid } from './payoutPattern';
import { reviseOnce, settlementFactor, type RevisionState } from './claimRevision';
import { getMemberExposure } from './lineHelpers';
import {
  CLAIM_REVISION_MAGNITUDE_NUMERATOR,
  LINE_PAYOUT_PATTERN,
  TRIANGLE_DEVELOPMENT_DRIFT,
  TRIANGLE_HISTORY_YEARS,
  TRIANGLE_INITIAL_CONTRACTION,
  resolveClosureCurve,
} from '../data/defaultAssumptions';
import type { CoverageLine, Member } from '../types/simulation';

/** The longest a claim is followed when resolving its closure age. Matches the
 *  bound every other closure consumer uses; a claim that has not closed by then
 *  is treated as closing there. */
const MAX_CLOSURE_AGE = 40;

/** One (accident year, development age) cell, on BOTH bases.
 *
 *  ⚠ BOTH BASES, BECAUSE THE WINDOW BUYS DIFFERENT THINGS ON EACH. Measured on
 *  the shipped engine, a ten-year window costs WC 9.8% on the PAID triangle
 *  (payments run past the twelve-year IBNER horizon, so the tail is genuinely
 *  unobserved) and essentially nothing on the INCURRED one (0.999-1.002, because
 *  the estimate stops moving at the horizon). Those are different deficiencies
 *  and a plan that quotes the paid figure on the incurred basis is wrong. Both
 *  are carried here so the comparison can be made again once claims develop
 *  forward, where the gap will not be the same. */
export interface TriangleCell {
  /** 1 = oldest accident year, TRIANGLE_HISTORY_YEARS = newest. */
  accidentYear: number;
  /** 1 = first valuation after the accident year. */
  age: number;
  /** Cumulative incurred: the carried estimate of ultimate at this valuation. */
  incurred: number;
  /** Cumulative paid to date at this valuation. */
  paid: number;
  /** Claims closed at or before this age, and still open. Reported rather than
   *  used: a count triangle is what a Bornhuetter-Ferguson severity a-priori
   *  would be built from, and BF cannot be built until pricing exists. */
  closedCount: number;
  openCount: number;
}

export interface ClaimTriangle {
  line: CoverageLine;
  /** Accident years, oldest first. `cells` is ragged: accident year j is
   *  observed to age (years + 1 - j), so year 1 reaches the full window and the
   *  newest year has a single cell. */
  years: number;
  /** Exposure written in each accident year, oldest first.
   *
   *  ⚠ AS WRITTEN, NEVER RESTATED. A member that leaves takes neither its claims
   *  nor its exposure out of the years they belong to. The rate is a loss cost
   *  PER UNIT of exposure, so the ratio is unaffected and nothing jumps when the
   *  roster moves — which is the property that makes a rolling window usable at
   *  all. Stored per year rather than derived so a later consumer cannot
   *  accidentally restate it against the current roster.
   *
   *  It is also what a Bornhuetter-Ferguson needs: BF is exposure x an a-priori
   *  loss cost, and the a-priori does not exist until the pool prices. Not built
   *  here; deliberately not made impossible. */
  exposureByYear: number[];
  /** Claims written in each accident year, oldest first. */
  countByYear: number[];
  cells: TriangleCell[];
}

/**
 * The initial estimate for a claim whose eventual settled value the generator
 * would have drawn as `drawn`.
 *
 * ⚠ EXPORTED SO NOTHING REIMPLEMENTS IT. Two constants and one power, but this
 * is the line where the terminal target becomes an initial distribution, and a
 * second copy of it drifting from this one is the failure this project has
 * already had once — revision-total-sd-report kept its own inlined copy of `s`
 * and printed a retired form's table for a whole commit.
 */
export function initialEstimate(line: CoverageLine, drawn: number): number {
  const { k, A } = TRIANGLE_INITIAL_CONTRACTION[line];
  return A * Math.pow(Math.max(0, drawn), k);
}

/**
 * The DRIFT applied to an open claim at one age — the reason the history
 * develops at all.
 *
 *     1 + g x 2/(age + 1)
 *
 * ⚠ IT DECAYS WITH AGE, AND A CONSTANT PER-OPEN-YEAR RATE IS THE THIRD INSTANCE
 * OF ONE FAILURE FAMILY. Sized both ways: a constant rate anchored on GL gives WC
 * a cumulative development factor of 4,756, because WC still has 3.9% of its
 * VALUE open at age 30 and a geometric rate compounds over all of it. That is the
 * same shape as the 1/headroom exponent (a rate divided by a quantity that goes
 * to zero) and as the retired s = phi.m/h — a rate applied to something that does
 * not shrink fast enough to stop it. Real factors decay towards 1.0: GL's own run
 * 1.872 / 1.439 / 1.265 / 1.031 / 1.024.
 *
 * ⚠ THE SHAPE IS NOT INVENTED HERE. 2/(age+1) is
 * CLAIM_REVISION_MAGNITUDE_NUMERATOR's age curve, fitted against the pool's own
 * experience and already carrying the ruling that model age 1 is data age 2. The
 * numerator is read from that constant rather than copied, so the two cannot
 * drift apart — and if it moves, triangle-check's terminal assertion fails.
 *
 * Applied while the claim is OPEN, at ages 1..closureAge-1. At closure the
 * settlement factor resolves the file and no further drift applies.
 */
export function developmentDrift(line: CoverageLine, age: number): number {
  return 1 + TRIANGLE_DEVELOPMENT_DRIFT[line] * (CLAIM_REVISION_MAGNITUDE_NUMERATOR / (age + 1));
}

/** A claim's whole cumulative development factor, first estimate to ultimate.
 *  Deterministic given the closure age, which is what makes the identity at
 *  TRIANGLE_INITIAL_CONTRACTION exactly checkable rather than approximately. */
export function cumulativeDevelopment(line: CoverageLine, closureAge: number): number {
  let f = 1;
  for (let a = 1; a < closureAge; a++) f *= developmentDrift(line, a);
  return f;
}

/** The age at which a claim closes.
 *
 *  ⚠ RESOLVED FROM THE DRAWN VALUE, NOT THE CONTRACTED INITIAL ESTIMATE.
 *  resolveClosureCurve is size-banded, so letting the initial estimate pick the
 *  curve would make CLOSURE depend on the contraction — a different book, rather
 *  than the same book seen earlier in its life. It is claimClosure's own
 *  prohibition arriving from a new direction: closure is a property of the
 *  claim, not of what anyone currently thinks it is worth. */
function closureAgeOf(line: CoverageLine, gameId: string, claimId: string, drawn: number): number {
  const curve = resolveClosureCurve(line, drawn);
  const u = claimClosureUnit(gameId, claimId);
  for (let t = 1; t <= MAX_CLOSURE_AGE; t++) if (closedShare(curve, t) >= u) return t;
  return MAX_CLOSURE_AGE;
}

function drawYear(
  line: CoverageLine, members: Member[], yearNumber: number, calendarYear: number, instanceSeed: number,
) {
  const base = { members, yearNumber, calendarYear, instanceSeed, riskControlEffectiveness: 0 };
  if (line === 'WC') return generateWcClaims({ ...base, kLine: 1 });
  if (line === 'GL') return generateGlClaims({ ...base, kGl: 1, gPool: 1 });
  return generatePropertyClaims({ ...base, kPr: 1 });
}

/**
 * Walk one claim from its initial estimate to the valuation date.
 *
 * ⚠ EVERY STEP GOES THROUGH claimRevision's OWN FUNCTIONS — reviseOnce for the
 * revision, settlementFactor for the close. This module does not contain a copy
 * of the law and must not acquire one. The constraint is not tidiness: if the
 * history is built with one development process and the game applies another,
 * the pool learns factors that stop being true the moment play starts, and the
 * whole rebuild rests on those factors being real.
 *
 * ⚠ AND THE PROCESS IT MATCHES IS THE FLAG-ON ONE, WHICH IS A RECORDED
 * DEPENDENCY RATHER THAN AN OVERSIGHT. With PER_CLAIM_REVISION.enabled false the
 * live engine develops COHORTS through a lognormal step and has no per-claim
 * development at all — there is no per-claim process to match. A triangle is a
 * per-claim object, so it is built on the per-claim law, and the factors it
 * teaches become true of the played game only when that flag flips. Both flags
 * are off today and neither is flipped here; the ORDER is the point, and it is
 * that PER_CLAIM_REVISION must lead PRICING_TRIANGLE.
 */
function walkClaim(
  line: CoverageLine, gameId: string, claimId: string, drawn: number, toAge: number,
): { incurred: number[]; paid: number[]; closureAge: number } {
  const pattern = LINE_PAYOUT_PATTERN[line];
  const closureAge = closureAgeOf(line, gameId, claimId, drawn);
  const incurred: number[] = [];
  const paid: number[] = [];
  let st: RevisionState = { value: initialEstimate(line, drawn), paidShare: 0 };
  let settled = false;
  for (let age = 1; age <= toAge; age++) {
    if (!settled && age >= closureAge) {
      // The adjuster's final resolution, applied once, at the valuation the
      // claim closes — same convention as claimTerminalValue.
      st = { ...st, value: st.value * settlementFactor(gameId, claimId) };
      settled = true;
    } else if (!settled) {
      // ⚠ DRIFT FIRST, THEN THE MEAN-ONE LAW, AND BOTH ARE NEEDED. The drift is
      // the LEVEL — it is why E[terminal] > E[initial] and why a chain ladder
      // reads factors above 1.000 at all. The law is the DISPERSION around it.
      // S1 shipped the second without the first and the triangle came out flat:
      // contracting the initial spread buys spread, and a chain ladder estimates
      // the mean. Order matters only for reproducibility, not for either moment.
      st = { ...st, value: st.value * developmentDrift(line, age) };
      st = { ...st, paidShare: Math.min(0.999, cumulativePaid(pattern, age)) };
      st = reviseOnce(gameId, claimId, age, st);
    }
    // Payment runs on the cohort's pattern whether or not the file is closed;
    // closing fixes the ESTIMATE, it does not accelerate the cheque.
    const share = settled ? 1 : Math.min(0.999, cumulativePaid(pattern, age));
    incurred.push(st.value);
    paid.push(st.value * share);
  }
  return { incurred, paid, closureAge };
}

/**
 * Ten accident years, each at its own maturity, as at the valuation date.
 *
 * ⚠ A REAL TRIANGLE, NOT TEN COPIES. Accident year 1 is the oldest and is
 * observed to age `years`; the newest is observed to age 1 and is barely
 * reported. The lower-right of the rectangle does not exist, which is what makes
 * a development factor something that has to be SELECTED rather than read off.
 *
 * `instanceSeed` is offset per accident year so the ten years are independent
 * draws rather than one register repeated. The offset is a fixed stride, not
 * derived from the seeded stream: this history is generated once at game start
 * and must not shift the live game's draws.
 */
export function generateClaimTriangle(
  line: CoverageLine,
  members: Member[],
  instanceId: string,
  instanceSeed: number,
  years: number = TRIANGLE_HISTORY_YEARS,
): ClaimTriangle {
  const cells: TriangleCell[] = [];
  const exposureByYear: number[] = [];
  const countByYear: number[] = [];

  for (let ay = 1; ay <= years; ay++) {
    const maturity = years + 1 - ay;
    // ⚠ A DISTINCT gameId PER ACCIDENT YEAR, not a shared one. The revision and
    // closure hashes key on (gameId, claimId), and the generators reuse claim
    // ids across years, so a shared gameId would give the same id in two
    // accident years the same development path.
    const gameId = `${instanceId}#tri${ay}`;
    const drawn = drawYear(line, members, ay, 2025 + ay, instanceSeed + ay * 7919);
    countByYear.push(drawn.claims.length);
    exposureByYear.push(members.reduce((s, m) => s + getMemberExposure(m, line, ay), 0));

    const inc = new Array<number>(maturity).fill(0);
    const pd = new Array<number>(maturity).fill(0);
    const closed = new Array<number>(maturity).fill(0);
    const open = new Array<number>(maturity).fill(0);
    for (const c of drawn.claims) {
      const w = walkClaim(line, gameId, c.id, c.grossUltimate, maturity);
      for (let a = 0; a < maturity; a++) {
        inc[a] += w.incurred[a];
        pd[a] += w.paid[a];
        if (a + 1 >= w.closureAge) closed[a] += 1; else open[a] += 1;
      }
    }
    for (let a = 0; a < maturity; a++) {
      cells.push({ accidentYear: ay, age: a + 1, incurred: inc[a], paid: pd[a], closedCount: closed[a], openCount: open[a] });
    }
  }
  return { line, years, exposureByYear, countByYear, cells };
}

/** The cell at (accident year, age), or undefined where the triangle is ragged. */
export function cellAt(t: ClaimTriangle, accidentYear: number, age: number): TriangleCell | undefined {
  return t.cells.find(c => c.accidentYear === accidentYear && c.age === age);
}

/**
 * Volume-weighted age-to-age factors on either basis.
 *
 * ⚠ THE ESTIMATOR LIVES HERE AND THE ERROR WILL TOO. This is an ORDINARY chain
 * ladder and it is deliberately honest: three mechanisms have now failed by
 * putting the error where the pool could observe it — a markdown that unwinds
 * exactly, a reserve drift that one funding stop repays, and a booking overshoot
 * that a chain ladder reads straight back at 1.001 to 1.007. The played triangle
 * stays true; when the selection error arrives it belongs on the PICK, between
 * this function and the rate. Do not put it in here.
 */
export function ageToAgeFactors(t: ClaimTriangle, basis: 'incurred' | 'paid'): number[] {
  const f: number[] = [];
  for (let a = 1; a < t.years; a++) {
    let num = 0, den = 0;
    for (let ay = 1; ay <= t.years; ay++) {
      // Observable only where BOTH ages sit on or above the valuation diagonal.
      if (ay + a > t.years) continue;
      const c0 = cellAt(t, ay, a), c1 = cellAt(t, ay, a + 1);
      if (!c0 || !c1) continue;
      den += c0[basis]; num += c1[basis];
    }
    f.push(den > 0 ? num / den : 1);
  }
  return f;
}
