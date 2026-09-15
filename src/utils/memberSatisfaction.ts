// ============================================================================
// MEMBER SATISFACTION — what one member thinks of the pool, and it MOVES.
//
// TWO LIMBS, BECAUSE A PRICE HAS TWO THINGS TO SAY:
//
//   THE CHANGE — what happened to the bill this year, once.
//
//     delta_i = -K . r(excess_i) . (1 - FAULT . ownFault_i)
//     r(x)    = x^2 for x >= 0, -x^2/LAMBDA for x < 0     CONVEX and ASYMMETRIC
//
//   THE LEVEL — where the pool's price SITS against the market, every year it
//   persists. It is an ANCHOR the stock decays toward, not a second flow.
//
//     anchor_i = CENTRE - A . L(levelGap)
//     L(x)     = x for x >= 0, x/LAMBDA for x < 0         LINEAR, kinked at 0
//
//   sat_t = sat_(t-1) + delta_i  +  PULL . (anchor_i - (sat_(t-1) + delta_i))
//
// clamped to [1, 10].
//
// ⚠ A LEVEL AS A FLOW WOULD BE UNBOUNDED, WHICH IS THE WHOLE REASON FOR THE
// ANCHOR. A change gap happens once and a flow is the right shape for it. A
// standing 10% gap added year after year would only ever be stopped by the
// [1, 10] clamp — and a model whose limit is its clamp is not a model. As an
// anchor the stock walks to what the standing price implies and stays there.
//
// ⚠ AND THE ANCHOR FIXED THE THING THE CONVEX FORM COULD NOT. The stock used to
// be a random walk driven by a convex reaction to a noisy gap, with nothing
// pulling it back, so its defaults drift accumulated. Mean-reverting, the same
// noise is transient: WC's drift went -0.0115 to +0.0073 points per member-year
// and the six-year decision footprint's standard error fell from 0.014 to 0.006.
// The level term is not a second way to wander. It is what stopped the first.
//
// ============================================================================
// ⚠ THE BIGGEST THING IN THE GAP WAS THE MEMBER'S OWN EXPERIENCE RATING, AND IT
// IS OUT. Measured on the convex form, WC's gap had SD 7.29pp of which about 5pp
// was mod_t/mod_(t-1) — against 2.81 from the market benchmark and 3.69 from the
// pool's own charged rate. A scoreboard whose largest movement is the member's
// own modifier churning is not reporting on the player, and ownFault did not
// catch it because ownFault damps the ratio's LEVEL while the noise was in its
// CHANGE. See OWN_CHANGE_EXPLAINED. WC's gap SD is now 4.52pp.
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
  /**
   * How much of the member's OWN modifier change their own claims explain.
   *
   * ⚠ 1.0, AND THE REACTION THEREFORE READS THE POOL'S GAP ALONE. This is the
   * largest correction in the convex rebuild's aftermath and it came out of the
   * convex form's own drift measurement: WC's gap had SD 7.29pp of which about
   * 5pp was mod_t/mod_(t-1), against 2.81 from the market benchmark and 3.69
   * from the pool's charged rate. So the biggest thing a member's satisfaction
   * moved on was THEIR OWN EXPERIENCE RATING CHURNING, and a scoreboard whose
   * largest movement is that is not reporting on the player.
   *
   * WHY 1.0 IS THE ANSWER AND NOT A TUNED FRACTION. The modifier is rebased to
   * the book's mean every year, and ownExperienceFrames deliberately divides
   * BOTH legs by the SAME M — see its header — so mod_t/mod_(t-1) isolates the
   * member's own clamped ratio moving and contains no move in the book around
   * them. There is no pool decision inside it to leave in. Anything below 1
   * charges the pool for a member's own claims.
   *
   * ⚠ AND IT NARROWS WHAT THE FIELD MEANS, WHICH IS WORTH SAYING. The original
   * design read "the member's own bill year over year". It now reads "the
   * pool's price against the market, damped by how much this member can blame
   * themselves". The BILL is still computed and carried on every move row —
   * billChangePct — so nothing is hidden; it is simply not what the member
   * holds the pool responsible for.
   *
   * ⚠ WHAT IT COSTS: within a line-year every member now shares one gap, so the
   * only per-member variation left in a single year is ownFault. Members still
   * separate across years, across their line mix, and through the accumulated
   * path — but two members of one line in one year can differ by at most the
   * fault discount. member-satisfaction-check's interaction section is
   * correspondingly weaker and says so.
   */
  ownChangeExplained: 1.0,
  /**
   * Satisfaction points per percentage point of LEVEL gap, at the anchor.
   *
   * ⚠ DERIVED FROM WHAT EACH TERM SHOULD BE WORTH OVER A GAME, WHICH IS THE
   * QUESTION A SHARED WEIGHT GETS WRONG. A level gap applies every year and a
   * change gap applies once, so on one weight the level dominates within two or
   * three years and the change term stops mattering.
   *
   * THE ANCHOR: one stop on the funding slider should be worth the SAME through
   * the level as it is through the change, over the six years the gate already
   * traces (the decision year and the five after it). Bigger moves and longer
   * holds then belong to the level, one-off rate blips to the change, and
   * neither is set by taste.
   *
   * Measured, Expected -> the 0.65 stop on WC:
   *
   *   cushion             -8.66%  ->  -4.98%      (both on the cheaper side)
   *   L(x) = x / 2.25     -3.85   ->  -2.21       delta 1.64pp of reaction
   *   convergence in 6 years at a 3-year half-life  1 - 0.5^2 = 75%
   *   settled level effect                        0.75 x 1.64 x levelWeight
   *   the change term's own six-year footprint     0.037 points (24 games)
   *
   *   levelWeight = 0.037 / (0.75 x 1.64) = 0.030
   *
   * ⚠ WHAT THAT BUYS ACROSS THE WHOLE SLIDER, which is the number that matters
   * more than the anchor: Expected -> the 0.95 stop moves the cushion -8.66% ->
   * +9.88% on WC, so L goes -3.85 -> +9.88 and the anchor moves 0.41 points.
   * On Property, whose load climbs fastest, -7.34% -> +23.18% moves it 0.79.
   * A sustained pricing decision is therefore worth ten to twenty times a
   * one-year rate blip, which is what "applies every year" should mean.
   */
  levelWeight: 0.030,
  /**
   * How long a member takes to come round to a new standing price.
   *
   * ⚠ 3 YEARS, AND IT IS EXPERIENCE_WINDOW_YEARS RATHER THAN A PICK. The model
   * already has a statement about how far back a member looks — the experience
   * window their own loss ratio is computed over, measured at 3 because
   * reliability peaks there. Using the same span for how long an opinion takes
   * to catch up with a price is one memory, not two.
   *
   * At a 3-year half-life a member is 75% of the way to a new anchor after six
   * years and 90% after ten, so a decision taken in year 3 of a ten-year game
   * has substantially landed by the end and one taken in year 9 has barely
   * started — which is the right shape for a game where late decisions should
   * not read as free.
   */
  levelHalfLifeYears: 3,
  /**
   * What a member thinks of a pool priced EXACTLY AT THE MARKET.
   *
   * ⚠ THIS IS WHY THE OPENING DISPOSITION IS NOT THE NEUTRAL POINT ANY MORE,
   * AND THE OFFSET IS THE MECHANIC RATHER THAN A DRIFT. Members open at
   * OPENING_SATISFACTION, which is this number; at all-default decisions the
   * pool is 6-9% CHEAPER than the modelled market, so the anchor sits slightly
   * above the opening and the stock settles a little happier than it started.
   * That is the pool's reason to exist showing up on the scoreboard, and it is
   * a fixed offset rather than an accumulating slide — the whole point of an
   * anchor.
   *
   * member-satisfaction-check's drift assertion therefore measures the NET of
   * the change term's negative and the anchor's positive pull, and both have to
   * stay small. Two ways to wander, one bound.
   */
  anchorCentre: 7.20,
  /** The stock's bounds. Same [1, 10] the field has always carried. */
  floor: 1.0,
  ceiling: 10.0,
};

/**
 * The CHANGE reaction: how many satisfaction points a one-year gap of
 * `excessPct` is worth, before the fault discount. Positive OUT means
 * unhappier, so the caller negates.
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

// ============================================================================
// THE LEVEL REACTION — LINEAR EITHER SIDE OF A KINK AT ZERO, AND THE FORM IS
// NOT THE CHANGE TERM'S.
//
//     L(x) =  x           for x >= 0   the pool costs MORE than the market
//     L(x) =  x / LAMBDA  for x <  0   the pool is cheaper, and that is worth
//                                      something, but less
//
// ⚠ NOT CONVEX, AND THE REASON IS NOT SYMMETRY WITH THE CHANGE TERM. Three
// arguments, none of which is "the other one is squared":
//
//   1. THERE IS NO NOISE TO SUPPRESS. Convexity's job in the change term is
//      separating a decision from a noisy year: the change gap's SD at defaults
//      is 4.3-5.1pp per line. The LEVEL gap's own year-to-year SD is the pool's
//      load moving, measured at 0.012-0.030 of load — about 1-2pp of cushion.
//      A curve that exists to push noise below the signal has nothing to push.
//
//   2. A LEVEL APPLIES EVERY YEAR AND CONVEXITY WOULD COMPOUND IT. A standing
//      gap held for a decade under a squared reaction is a standing squared
//      pull, which would dominate the change term within two years — the exact
//      failure the weighting question was asked about, arriving through the
//      form instead of the weight.
//
//   3. THE JUDGEMENT IN A LEVEL IS A THRESHOLD, NOT A CURVATURE. "A 2pp increase
//      is invisible and a 15pp one is a board conversation" is a statement about
//      curvature. The level's equivalent statement is "being dearer than the
//      alternative is different in kind from being cheaper", which is a KINK —
//      and it sits at zero, where MARKET_TARGET_LOSS_RATIO puts it.
//
// ⚠ THE KINK IS WHERE THE UNMEASURED JUDGEMENT EARNS ITS KEEP. The target loss
// ratio does not set how hard satisfaction reacts — that scale is absorbed by
// levelWeight, so 60% and 70% give the same behaviour at a different weight.
// What it sets is WHERE THE CUSHION CROSSES ZERO, and because the reaction is
// kinked there, crossing it more than doubles the marginal reaction. A pool
// funding past that point stops being the cheaper option and starts being the
// dearer one, which is a different conversation with a member.
// ============================================================================
export function satisfactionLevelReaction(levelGapPct: number): number {
  const x = levelGapPct;
  return x >= 0 ? x : x / SATISFACTION.gratitudeLambda;
}

/**
 * Where a member's satisfaction is heading, given what the pool costs against
 * the market right now. The stock decays toward this rather than being pushed
 * by it — see applySatisfaction.
 *
 * ⚠ AN ANCHOR AND NOT A FLOW, AND THAT IS THE WHOLE DIFFERENCE BETWEEN A LEVEL
 * AND A CHANGE. A change gap happens once and a flow is the right shape for it.
 * A level gap applies EVERY YEAR, and a level added as a flow into a stock is
 * unbounded — after ten years of a standing 10% gap the only thing stopping it
 * is the [1, 10] clamp, which would mean the clamp was the model. As an anchor
 * it is bounded by construction: the stock walks to where the standing price
 * comparison says and then stays there.
 *
 * ⚠ AND IT MAKES THE PROCESS MEAN-REVERTING, WHICH HELPS THE THING THE CHANGE
 * TERM WAS FAILING. Before this the stock was a random walk driven by a convex
 * reaction to a noisy gap, so its defaults drift accumulated without anything
 * pulling back. With an anchor the same noise is transient.
 */
export function satisfactionAnchor(levelGapPct: number): number {
  const { anchorCentre, levelWeight, floor, ceiling } = SATISFACTION;
  return Math.max(floor, Math.min(ceiling,
    anchorCentre - levelWeight * satisfactionLevelReaction(levelGapPct)));
}

/** Share of the distance to the anchor closed in one year. See levelHalfLifeYears. */
export function satisfactionAnchorPull(): number {
  return 1 - Math.pow(0.5, 1 / SATISFACTION.levelHalfLifeYears);
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
  levelGapPct: number,
): SatisfactionMove[] {
  const { divisor: M, frames } = ownExperienceFrames(members, line, history);
  const { ratioCeiling } = EXPERIENCE_MOD;
  const faultSpan = ratioCeiling / M - 1;
  const known = poolRateChangePct !== null && poolRateChangePct !== undefined;
  const r = known ? poolRateChangePct : 0;

  // The pool's own doing: its charged rate against the market. One number for
  // the whole line-year, because a pricing decision is one decision.
  const poolGapPct = known ? r - marketChangePct : 0;

  return members.map((m, i) => {
    const f = frames[i];
    const billChangePct = ((1 + r / 100) * (1 + f.ownChangePct / 100) - 1) * 100;
    const ownFault = f.rated && faultSpan > 0
      ? Math.max(0, Math.min(1, (f.clamped / M - 1) / faultSpan))
      : 0;
    // ⚠ THE MEMBER'S OWN MODIFIER CHANGE IS DISCOUNTED OUT — see
    // OWN_CHANGE_EXPLAINED. At 1.0 the reaction reads the pool's gap alone and
    // the member's own experience reaches satisfaction only through ownFault,
    // which is what it was built to do.
    const excessPct = known
      ? poolGapPct + f.ownChangePct * (1 - SATISFACTION.ownChangeExplained)
      : 0;
    return {
      memberId: m.id,
      billChangePct,
      marketChangePct,
      ownChangePct: f.ownChangePct,
      poolGapPct,
      excessPct,
      ownFault,
      levelGapPct,
      // ⚠ THE FAULT DISCOUNT DOES NOT TOUCH THE ANCHOR, DELIBERATELY. ownFault
      // answers "how much of this INCREASE did you cause", which is a question
      // about a change. A member's own claims do not make the pool a cheaper or
      // dearer place to buy insurance than a carrier, so there is nothing for
      // them to be at fault for in a level.
      anchor: satisfactionAnchor(levelGapPct),
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
  const pull = satisfactionAnchorPull();
  return members.map(m => {
    const mv = moves.get(m.id);
    if (!mv) return m;
    // THE CHANGE FIRST, THEN THE PULL. Order matters only at the second decimal
    // and the choice is stated rather than incidental: this year's price shock
    // lands, and then the member's opinion drifts toward what the standing price
    // implies. Pulling first would let the anchor absorb part of a shock in the
    // year it happened, which is exactly the visibility the convex change term
    // exists to protect.
    const afterChange = m.satisfaction + mv.delta;
    const next = Math.max(floor, Math.min(ceiling,
      parseFloat((afterChange + pull * (mv.anchor - afterChange)).toFixed(2))));
    return next === m.satisfaction ? m : { ...m, satisfaction: next };
  });
}

/** Convenience for the one caller and for the gate: moves keyed by member id. */
export function satisfactionMovesById(
  moves: readonly SatisfactionMove[],
): Map<string, SatisfactionMove> {
  return new Map(moves.map(mv => [mv.memberId, mv]));
}
