// ============================================================================
// MEMBER SATISFACTION — what one member thinks of the pool, and it MOVES.
//
//     delta_i = -K . r(excess_i) . (1 - FAULT . ownFault_i)
//
//     excess_i   = the member's own bill change, in percentage points, MINUS
//                  what the market's rate did this year
//     r(x)       = x^2 for x >= 0, and -x^2/LAMBDA for x < 0 — CONVEX, so the
//                  reaction grows faster than the gap, and ASYMMETRIC, so
//                  grievance outruns gratitude
//     ownFault_i = how much of their own increase their own claims explain,
//                  on [0, 1]
//
// applied to the member's carried satisfaction and clamped to [1, 10].
//
// ============================================================================
// ⚠ WHY CONVEX RATHER THAN A BIGGER W, WHICH WAS THE OBVIOUS NEXT STEP.
//
// The linear form's own measurement killed it: gap and noise both scale
// linearly in the weight, so the separation ratio is CONSTANT and raising W
// makes the scoreboard louder and no clearer. The problem was never the size of
// the reaction — it was that a 1.5pp year and a 13pp decision were treated as
// the same kind of thing. A convex reaction fixes that at source rather than
// amplifying it.
//
// What it buys, measured: in a year carrying both a typical gap and one stop on
// the funding slider, the DECISION'S SHARE of the member's move goes from 42%
// under the linear form to 67% under this one. That share is a property of the
// FORM and is the same at any coefficient, which is why it is the number worth
// quoting rather than any absolute size.
//
// ⚠ AND IT IS A SHARE, NOT NOISE REMOVAL. The gap's SD at defaults is 5-7pp per
// line while one funding stop is worth about +4pp, so a p90 ordinary year still
// outweighs a decision under either form. Convexity moves the ordinary year out
// of the way; it does not make the benchmark quiet.
//
// ============================================================================
// ⚠ THIS IS A BUILD, NOT A REPAIR, AND WHAT IT REPLACES HAD NO MOVING PARTS.
//
// Member.satisfaction was drawn once at enrolment from U(6.0, 8.5) and never
// updated again: measured, it changed in 70 of 18,239 member-year pairs (0.4%),
// and every one of those was a member re-joining and drawing afresh. Its only
// consumer was the old departure key, and the departure rebuild took that out —
// see memberDeparture.ts, which condemns the field as "inert noise wearing a
// behavioural label" and as "a coin flip frozen at enrolment into a permanent
// caste". So for the last several commits it has been a frozen number with no
// reader, displayed on the members table as if it meant something.
//
// THAT IS WHY IT DRIFTED FOR MONTHS UNNOTICED, and it is the argument for
// building it as a MEASURED quantity now rather than waiting for a consumer: a
// field nothing reads and nothing writes is invisible to every gate in the
// repo. This one is written every year by a pure function of things the player
// can see, and member-satisfaction-check asserts that it moves.
//
// ============================================================================
// IT FEEDS NOTHING, AND THAT IS THE RULING RATHER THAN AN OVERSIGHT.
//
// No DECISION in src/ reads Member.satisfaction. Two display surfaces do —
// MembershipPage's roster column and ResultSpreadsheetPage's, which also has a
// CSV export of it. It is a SCOREBOARD. Both export baselines therefore hold
// bit-identical across this commit, and that is the test of the claim rather
// than a hope: if a baseline moves, something reads the field.
//
// ⚠ THE SECOND SURFACE WAS FOUND BY THE GATE AND NOT BY ME, WHICH IS THE
// ARGUMENT FOR THE GATE BEING STATIC. This header first said "nothing except
// MembershipPage". member-satisfaction-check's allow-list scan named
// ResultSpreadsheetPage on its first run: a per-member Satisfaction column and
// a CSV of it, live since before this rebuild and rendering a frozen number the
// whole time.
//
// ⚠ AND NEITHER BASELINE COVERS THAT CSV. solo-export-guard hashes
// buildResultsWorkbook, which carries no per-member roster, so that page's
// export is a player-facing surface no baseline sees. It is also why both
// baselines can hold bit-identical while the field starts moving — the thing
// that changed is not on either guarded path. Named rather than left to be
// discovered as a "baseline missed it" later.
//
// ⚠ AND THERE ARE NOW TWO SATISFACTION NUMBERS IN THE MODEL. Say it plainly
// because it is a seam and it will be found:
//
//   LinePoolState.memberSatisfaction   a POOL-LEVEL scalar, updated by
//     updateSatisfaction in membershipEngine.ts, which DOES feed retention
//     through MEMBER_MOVEMENT_WEIGHTS.retention.satisfaction. It reads the rate
//     change as a deviation from RATE_NEUTRAL_CHANGE_PCT, plus dividends and
//     assessments. It is not an average of anything.
//
//   Member.satisfaction                this. PER MEMBER, per line, reads the
//     member's OWN bill against the market, and feeds nothing.
//
// They are not two views of one quantity and averaging this one into that one
// is NOT the tidy-up it looks like — it would put a per-member price signal
// into retention, which moves every baseline and every calibration that stands
// on them. Converging them is a measurement commit of its own.
//
// ============================================================================
// WHAT WOULD HAVE TO BE TRUE FOR THE DEPARTURE MODEL TO READ IT.
//
// This is where the mechanic goes, and the next person should not have to
// reverse-engineer that from a display field — which is exactly how the frozen
// version survived. memberDeparture.ts ranks members by
//
//     risk_i = W_PRICE . max(0, priceShock_i) . marketability_i + noise_i
//
// and satisfaction would enter as a fourth term. Three things have to hold
// first, and none of them holds today:
//
//   1. IT MUST NOT DOUBLE-COUNT priceShock. Departure's priceShock is the
//      pool-wide rate deviation plus the member's own modifier change — which
//      is the SAME two quantities this file's excess_i is built from, minus the
//      market benchmark. Adding satisfaction as written to the risk it is built
//      from would weight one signal twice and call it two mechanisms. The
//      honest form is that satisfaction REPLACES priceShock there (it is the
//      accumulated, market-adjusted version of it) rather than joining it.
//
//   2. IT NEEDS A LEVEL THAT MEANS SOMETHING. A stock on [1, 10] whose starting
//      point is a U(6.0, 8.5) draw has no natural threshold — "below 6" is a
//      statement about the draw, not about the member. Departure needs either a
//      relative reading (this member against this book's median, the way
//      displayedMod handles the same problem) or a calibrated absolute one.
//
//   3. THE DRIFT AT DEFAULTS MUST BE ZERO AND STAY THERE. A scoreboard that
//      drifts a tenth of a point a year is readable; a departure term that does
//      is a slow, invisible retune of the book. member-satisfaction-check
//      asserts the drift at defaults, which is what makes that promotion
//      checkable rather than argued.
//
// ============================================================================
// THE THREE DRIVERS, AND THE THIRD IS WHY THIS COMMIT NEEDED A MARKET MODULE.
//
//   PRICE — the member's OWN bill, year over year. Member price is
//     pool rate x class relativity x mod (see memberPremium.ts), the class
//     relativity is static, so the change is exactly
//
//         (1 + r/100) . (mod_t / mod_(t-1))
//
//     and needs no new storage. Both halves already exist: r is the engine's
//     `rateChangePct` and the mod ratio is ownExperienceFrames' ownChangePct.
//
//     ⚠ THE RAW RATE CHANGE, NOT THE DEVIATION FROM NEUTRAL. Retention and the
//     pool-level satisfaction scalar both read
//     `rateChangePct - RATE_NEUTRAL_CHANGE_PCT[line]`, because they have no
//     other way to say what a normal year looks like. This one subtracts the
//     MARKET instead, and the market's trend component IS
//     RATE_NEUTRAL_CHANGE_PCT — so at defaults the two agree to the trend and
//     differ by the market's year. Subtracting both would net the trend out
//     twice.
//
//   THEIR OWN LOSSES — the three-year clamped ratio, already built, already
//     displayed on the members table as "Loss Ratio".
//
//   THE MARKET — marketConditions.ts. Derived from the components every carrier
//     feels rather than invented as an index. A pool that raises its rate in a
//     year the whole market moved costs less satisfaction than one that raises
//     it alone, and that distinction is the reason the market term is derived
//     rather than picked.
//
// ============================================================================
// ⚠ THE LOSS TERM IS AN INTERACTION, NOT A SECOND PENALTY, AND THAT IS THE
// WHOLE DESIGN.
//
// Two independent penalties — one for a big increase, one for a bad loss year —
// would say that a member with a GOOD record facing a BIG increase is only
// half-unhappy, because only one of the two terms fires. That is backwards:
// they are the member with the strongest grievance in the book, because nothing
// they did explains their bill.
//
// So the loss term MODULATES the price term:
//
//     ownFault_i = clamp01( (c_i/M - 1) / (ceiling/M - 1) )
//
// 0 at or below the book's mean experience, 1 at the worst the clamp permits.
// A blameless member takes the full grievance; a member whose own claims ran at
// the clamp's ceiling takes none, because their bill is their own record coming
// back to them.
//
// ⚠ IT IS marketabilityOf's STATISTIC RUN THE OTHER WAY, DELIBERATELY. That
// function normalises the member's shortfall BELOW the book mean by the best
// the clamp allows, (1 - c/M)/(1 - floor/M); this normalises their excess ABOVE
// it by the worst, (c/M - 1)/(ceiling/M - 1). Same c, same M, same clamp, two
// opposite tails — which is the same one-statistic-two-pressures structure
// memberDeparture describes, and it is why neither number needed a scale
// invented for it.
//
// ⚠ AND THE DAMPING IS SYMMETRIC: a high-fault member reacts less to a CUT too.
// Not an oversight and not an asymmetry worth a branch. The reading is that a
// member whose own claims explain their bill attributes the movement to
// THEMSELVES rather than to the pool, in either direction, and it is the pool
// they are scoring.
//
// ⚠ PROPERTY MEMBERS ARE ALL AT FAULT 0, AND THAT IS THE SAME MEASUREMENT THAT
// WITHDREW PROPERTY'S EXPERIENCE RATING. CREDIBILITY_Z.Property is 0 because
// its measured split-half reliability is 0.000 at every split point tried, so
// no Property member is rated and none carries a clamped ratio. They therefore
// take the FULL grievance on every price move — which is right, not degenerate:
// a Property member has no experience rating to explain their bill, so a rate
// rise is entirely the pool's. The line is not excluded from the mechanic; it
// is the case where the interaction term is empty.
//
// ============================================================================
// ⚠ SATISFACTION IS PER MEMBER PER LINE, AND Member.satisfaction IS ONE FIELD.
//
// Each line carries its own LinePoolState.members array, and this writes a COPY
// rather than mutating in place, so a member on WC and GL ends up with two
// independent satisfactions — WC's on WC's array, GL's on GL's. That is
// correct: the drivers are a bill on one line.
//
// What it costs is the pool-level view. simulationEngine's roster fold dedupes
// `memberList` by id and keeps the FIRST line's copy, so the members table shows
// the first ACTIVE line's number, exactly as `status` is folded (see Member.status's
// own note on the same hazard). MembershipPage is already a WC view — its payroll,
// loss-ratio and mod columns are all WC — so the column is consistent with the
// page it is on, and the page says so.
//
// ⚠ DO NOT "FIX" THIS BY MUTATING THE MEMBER IN PLACE. The arrays can alias
// across lines, so an in-place write would make the last line processed
// overwrite the others and the field would silently become Property's opinion
// of everything.
// ============================================================================

import { EXPERIENCE_MOD, ownExperienceFrames } from './memberExperienceMod';
import type { CoverageLine, Member, MemberLossHistory, SatisfactionMove } from '../types/simulation';

export type { SatisfactionMove };

/**
 * THE CONVEX SCALE — satisfaction points per SQUARED percentage point of
 * market-adjusted bill change.
 *
 * ============================================================================
 * ⚠ THE FORM IS SQUARED AND NOT A THRESHOLD, AND THE THRESHOLD IS THE ONE THAT
 * LOOKS BETTER ON THE FIRST MEASUREMENT.
 *
 * Both were considered. A threshold-and-slope, max(0, |x| - T), matches
 * behaviour better on its face — people genuinely ignore small increases — and
 * measured on the gap distribution it separates far harder: with T at the
 * median |gap| the ordinary year contributes EXACTLY zero and the decision year
 * keeps its whole excess, a ratio in the tens against squaring's four.
 *
 * It is not taken, for one reason. T would have to be pinned to the gap's own
 * dispersion at defaults, because that is the only statistic available — and
 * the gap's dispersion at defaults is the MARKET BENCHMARK'S NOISE plus the
 * pool's own rate noise, not a fact about how members feel. Fitting a
 * behavioural bend to a measurement-error statistic is calibrating the
 * mechanism to hide its own noise, and it would move every time the benchmark
 * gained a component. Squaring has no bend to place: one scale, and the shape
 * is fixed.
 *
 * ⚠ AND THE THRESHOLD DOES NOT ACTUALLY SOLVE THE PROBLEM IT LOOKS LIKE IT
 * SOLVES. It kills the MEDIAN ordinary year and leaves the tail: the gap's SD
 * is 5-7pp per line while one stop on the funding slider is worth about +4pp,
 * so a p90 ordinary year still outweighs the decision under either form. What
 * convexity buys is the decision's SHARE of the year it lands in, and that is
 * the honest claim — not that noise has been removed.
 *
 * ============================================================================
 * THE COEFFICIENT, AND IT IS ANCHORED RATHER THAN CHOSEN.
 *
 * A convex form cannot be pinned by a separation ratio — the previous commit
 * measured that gap and noise both scale linearly in the weight, so any
 * signal-to-noise criterion is empty. What CAN be pinned is where the convex
 * reaction crosses the linear one it replaces:
 *
 *     K x g^2 = W_lin x g   at   g = W_lin / K
 *
 * Set the crossover at THE GAP A TYPICAL YEAR CARRYING ONE FUNDING STOP
 * PRODUCES, and the reaction at the decision is unchanged while everything
 * smaller goes quiet and everything larger bites. Measured on the charged-rate
 * basis, 8 games x 10 years:
 *
 *     pooled median |gap| at defaults                  3.93pp
 *     one stop (Expected -> the 0.65 stop), own effect  +3.96pp
 *     crossover = the two together                       7.89pp
 *
 *     K = W_lin / 7.89 = 0.015 / 7.89 = 0.0019
 *
 * so W_lin is inherited, the crossover is measured, and nothing is picked.
 * What it does, against the linear form at the same anchor:
 *
 *     gap      convex     linear     ratio
 *     1.5pp    0.0043     0.0225     0.19x     an ordinary year goes quiet
 *     3pp      0.0171     0.0450     0.38x
 *     5pp      0.0475     0.0750     0.63x
 *     7.89pp   0.1183     0.1183     1.00x     the crossover, by construction
 *     13pp     0.3211     0.1950     1.65x     a funding stop on a bad year bites
 *     20pp     0.7600     0.3000     2.53x
 *
 * ⚠ THE CLAIM THIS SUPPORTS IS ABOUT SHARES, NOT ABOUT NOISE REMOVAL. In a year
 * carrying both a typical gap and one funding stop, the decision's share of the
 * member's move goes from 53% under the linear form to 78% under this one —
 * (7.89^2 - 3.93^2)/7.89^2 against (7.89 - 3.93)/7.89. That ratio is a property
 * of the FORM and is the same at any K, which is why it is the number worth
 * quoting.
 */
export const SATISFACTION = {
  priceWeight: 0.0019,
  /**
   * The LINEAR weight this replaced, kept as the anchor the coefficient above
   * was derived from and as the arm the gate compares against. It is
   * RATE_SATISFACTION_SENSITIVITY, adopted at the previous commit.
   *
   * ⚠ AND ITS PROVENANCE IS THINNER THAN ITS REUSE IMPLIED, WHICH IS WORTH
   * KNOWING BEFORE ANY OF ITS SIBLINGS IS REUSED AGAIN. `git log -S` puts all
   * three rate sensitivities in ONE commit, bdc98ec "Reconnect the price channel
   * to membership", 2026-08-19, and that commit derives exactly one of them and
   * only as far as: "SCALE: 0.0030 of retention per point of rate rise above
   * neutral — the requested starting scale, adopted as given. There is no
   * measurement in this model that could pin a member's price elasticity; it is
   * a judgment and is recorded as one."
   *
   * That sentence is about RATE_RETENTION_SENSITIVITY (0.02). The satisfaction
   * figure (0.015) and the level figure (0.10) arrived in the same diff with NO
   * derivation of their own at all — they are siblings of a judgement, not
   * judgements that were each made. And the family has since thinned out:
   * RATE_LEVEL_SENSITIVITY lost its only consumer when the recruitment ladder
   * was retired with the membership target and is dormant; RATE_RETENTION_
   * SENSITIVITY is still live in calcRetentionProbability.
   *
   * So the honest status of the anchor is: one unexamined request, adopted
   * three times. It is still used here, because the alternative is a fourth
   * unexamined number and consistency with the shipped one is worth more than
   * novelty — but it is NOT evidence, and the next person to reach for one of
   * these should know they are all the same number's cousins.
   */
  linearEquivalent: 0.015,
  /**
   * How much less a rate CUT is worth than an equal rate RISE costs.
   *
   * ⚠ A JUDGEMENT, RECORDED AS ONE, AND IT DOES NOT FALL OUT OF THE CONVEX FORM.
   * Squaring is symmetric about zero on its own; the asymmetry is a separate
   * decision and is made here rather than left implicit. Grievance outruns
   * gratitude: a pool that prices 13pp under the market should not buy back what
   * one 13pp over costs it.
   *
   * 2.25 is Tversky and Kahneman's measured loss-aversion coefficient (Advances
   * in Prospect Theory, 1992) — the median ratio at which losses loom larger
   * than equivalent gains. Used for the same reason Mahler's rule 3 and NCCI's
   * credibility form are used elsewhere in this repo: a published figure from
   * the literature that studies exactly this beats a number picked to feel
   * right. It is NOT a measurement of this model and must not be quoted as one.
   *
   * ⚠ AND IT CONVERTS BENCHMARK NOISE INTO DRIFT, WHICH IS ITS REAL COST. At
   * defaults the gap is roughly symmetric about zero, so damping only the
   * favourable half leaves a negative expectation that scales with the gap's
   * VARIANCE — that is, with how noisy the market benchmark is, which is not
   * something a player did. RATE_SATISFACTION_SENSITIVITY's own header names the
   * same failure mode as the reason the pool-level term is symmetric. It is
   * tolerated here and not there because the convex form makes the ordinary
   * year's contribution tiny; member-satisfaction-check's drift assertion is
   * what holds it, and if that goes red this constant is the first suspect.
   */
  gratitudeLambda: 2.25,
  /**
   * How much of the grievance a maximally-at-fault member absorbs. 1.0 means
   * a member at the clamp's ceiling takes none of it.
   *
   * ⚠ NOT A FREE PARAMETER IN PRACTICE, AND 1.0 IS THE ONLY DEFENSIBLE END OF
   * ITS RANGE. Below 1 a member whose bill is entirely their own record still
   * blames the pool for part of it; above 1 the sign flips and a bad year makes
   * a member HAPPIER about a rate rise. The endpoint is the statement.
   */
  faultDiscount: 1.0,
  /** The stock's bounds. Same [1, 10] the field has always carried. */
  floor: 1.0,
  ceiling: 10.0,
};

/**
 * The convex reaction: how many satisfaction points a gap of `excessPct` is
 * worth, before the fault discount. Positive OUT means unhappier, so the caller
 * negates.
 *
 *     r(x) =  x^2          for x >= 0
 *     r(x) = -x^2 / LAMBDA for x <  0
 *
 * Exported so the gate can assert the shape at named points rather than
 * re-deriving it, and so a reader can evaluate it without running a game.
 */
export function satisfactionReaction(excessPct: number): number {
  const x = excessPct;
  return x >= 0 ? x * x : -(x * x) / SATISFACTION.gratitudeLambda;
}

/**
 * How every member on this line's book feels about this year's bill.
 *
 * PURE — no draws. That is what keeps this out of every seeded stream in the
 * engine and is why adding it cannot move a baseline.
 *
 * `poolRateChangePct` is the engine's own `rateChangePct`: this year's total
 * member charge rate against last year's. NULL means there is no usable prior
 * rate, and the rule is priceSignalFor's — a missing signal is NEUTRAL, so
 * every delta is 0. Treating it as a literal zero change would read as a rate
 * CUT of the market's whole year and hand the book a bonus for missing data.
 */
export function satisfactionMoves(
  members: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
  poolRateChangePct: number | null | undefined,
  marketChangePct: number,
): SatisfactionMove[] {
  const { divisor: M, frames } = ownExperienceFrames(members, line, history);
  const { ratioCeiling } = EXPERIENCE_MOD;
  const faultSpan = ratioCeiling / M - 1;
  const known = poolRateChangePct !== null && poolRateChangePct !== undefined;
  const r = known ? poolRateChangePct : 0;

  return members.map((m, i) => {
    const f = frames[i];
    const billChangePct = ((1 + r / 100) * (1 + f.ownChangePct / 100) - 1) * 100;
    const excessPct = known ? billChangePct - marketChangePct : 0;
    const ownFault = f.rated && faultSpan > 0
      ? Math.max(0, Math.min(1, (f.clamped / M - 1) / faultSpan))
      : 0;
    return {
      memberId: m.id,
      billChangePct,
      marketChangePct,
      excessPct,
      ownFault,
      delta: -SATISFACTION.priceWeight * satisfactionReaction(excessPct)
        * (1 - SATISFACTION.faultDiscount * ownFault),
    };
  });
}

/**
 * The stock, advanced one year. Returns COPIES — see the header on why an
 * in-place write would fold three lines' opinions into one field.
 *
 * ⚠ KEYED BY ID RATHER THAN POSITIONAL, BECAUSE THE TWO LISTS DIFFER ON PURPOSE.
 * The moves are computed over the book that was BILLED (every member on the line
 * entering the year), so the rebase divisor M is the same one departureRisks
 * sees; they are applied to the book that REMAINS after withdrawals. A
 * positional zip would silently shift every member's move by the number of
 * leavers ahead of them in the roster.
 *
 * ⚠ STORED AT TWO DECIMALS THOUGH THE FIELD HAS ALWAYS CARRIED ONE, AND THE
 * EXTRA DIGIT IS LOAD-BEARING RATHER THAN COSMETIC. The enrolment draw rounds to
 * one — `parseFloat(rng.range(6.0, 8.5).toFixed(1))` — and the members table
 * displays one, so one was the obvious choice and it is WRONG FOR A STOCK. At
 * the shipped weight a typical year's delta is a few hundredths; rounded to one
 * decimal every one of those lands back on the number it started from, the
 * stock never moves except in a year with a large price event, and the rebuilt
 * field would look exactly as frozen as the one it replaces. Two decimals is
 * the smallest precision at which a year's move survives to be accumulated.
 * member-satisfaction-check asserts the share of member-years that move, which
 * is the assertion that would have caught the one-decimal version.
 */
export function applySatisfaction(
  members: readonly Member[],
  moves: ReadonlyMap<string, SatisfactionMove>,
): Member[] {
  const { floor, ceiling } = SATISFACTION;
  return members.map(m => {
    const d = moves.get(m.id)?.delta ?? 0;
    const next = Math.max(floor, Math.min(ceiling, parseFloat((m.satisfaction + d).toFixed(2))));
    return next === m.satisfaction ? m : { ...m, satisfaction: next };
  });
}

/** Convenience for the one caller and for the gate: moves keyed by member id. */
export function satisfactionMovesById(
  moves: readonly SatisfactionMove[],
): Map<string, SatisfactionMove> {
  return new Map(moves.map(mv => [mv.memberId, mv]));
}
