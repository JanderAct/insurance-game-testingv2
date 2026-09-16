// ============================================================================
// MEMBER SATISFACTION — what one member thinks of the pool, and it MOVES.
//
// FOUR LIMBS. ONE CHANGE, THREE LEVELS:
//
//   sat_t = sat_(t-1) + delta_i + PULL . (anchor_i - (sat_(t-1) + delta_i))
//
//   delta_i  = -K . r(excess) . amp_i          the CHANGE, amplified per member
//   anchor_i = CENTRE - A . L(levelGap)        the MARKET's level
//                    + B . lossLevel_i         the MEMBER's own losses  (term 3)
//                    + surplusContribution     the POOL's surplus       (term 4)
//
// ⚠ TERM 3 IS THE ONLY PER-MEMBER CHANNEL, AND BEFORE IT THERE WAS NONE. The
// price gap is line-level — one pricing decision, identical for every member of
// a line-year — so until this limb shipped two members side by side, one with no
// claims and one with four, read the same number. Measured, the whole
// cross-member spread of the displayed value was 0.034 points at year 1, and
// every bit of it came from enrolment history rather than from anything a member
// had done or had happen to them.
//
// ⚠ AND TERMS 1 AND 4 PULL AGAINST EACH OTHER ON THE PLAYER'S MAIN LEVER, WHICH
// IS THE CENTRAL FACT ABOUT THIS MODEL NOW. Funding is what BUILDS surplus: one
// stop up raises the price, which costs satisfaction through the market level,
// and accumulates surplus, which pays it back through term 4. The first two
// weights tried for surplusWeight cancelled 56% and 67% of the funding decision
// and the gate went red on a ruling it has held since the level term shipped.
// See surplusWeight for how the bound replaced the match.
//
// THE FIRST TWO LIMBS, BECAUSE A PRICE HAS TWO THINGS TO SAY:
//
//   THE CHANGE — what happened to the bill this year, once.
//
//     delta_i = -K . r(excess_i)
//     r(x)    = x^2 for x >= 0, -x^2/LAMBDA for x < 0     CONVEX and ASYMMETRIC
//     excess  = the pool's rate change against the market — the member's own
//               modifier is removed AT SOURCE, not damped. See satisfactionMoves.
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
// ⚠ THE MEMBER'S OWN EXPERIENCE RATING IS NOT IN THE GAP AT ALL, AND IT TOOK
// TWO COMMITS TO GET THERE BECAUSE THE FIRST ONE DAMPED IT INSTEAD.
//
// Measured on the convex form, WC's gap had SD 7.29pp of which about 5pp was
// mod_t/mod_(t-1) — against 2.81 from the market benchmark and 3.69 from the
// pool's own charged rate. A scoreboard whose largest movement is the member's
// own modifier churning is not reporting on the player. The first attempt
// discounted it out with a weight; this one removes it by comparing the
// member's bill to WHAT IT WOULD HAVE BEEN AT THEIR PREVIOUS MODIFIER, which is
// the pool's rate change and nothing else.
//
// WC's gap SD is 4.52pp against sqrt(2.81^2 + 3.69^2) = 4.64 for the two
// components that should be left — slightly under, because the benchmark and
// the charged rate are not independent (both carry the trend, and both respond
// to the same loss experience through the pool's own triangle). Nothing else is
// in there.
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
// WHAT DRIVES IT — TWO THINGS, AND IT WAS THREE.
//
//   THE POOL'S PRICE, against the market. The member's bill is
//   pool rate x class relativity x mod; holding the modifier at LAST YEAR'S
//   value makes the class relativity and the mod both cancel, so the
//   counterfactual bill change is the pool's rate change exactly. That is what
//   the change limb reads, and where the level limb's gap comes from.
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
//   THE MARKET — marketConditions.ts, in both limbs. The CHANGE benchmark is
//     derived from the components every carrier feels; the LEVEL is modelled
//     from a target loss ratio. A pool that raises its rate in a year the whole
//     market moved costs less satisfaction than one that raises it alone, and a
//     pool that sits permanently under a carrier's price is forgiven things a
//     dearer one would not be.
//
//   THEIR OWN LOSSES — RETIRED AS A DRIVER, and this was the third. See the
//     block below. The member's loss ratio is still built and still displayed on
//     the members table; it no longer touches satisfaction, because a member's
//     claims are not the pool's pricing.
//
// ============================================================================
// ⚠ THE LOSS TERM IS RETIRED, AND IT WAS THE DESIGN'S CENTREPIECE FOR TWO
// COMMITS. RECORDED IN FULL, BECAUSE THE REASONING THAT BUILT IT WAS SOUND AND
// THE THING IT WAS BUILT FOR MOVED.
//
// It read
//
//     ownFault_i = clamp01( (c_i/M - 1) / (ceiling/M - 1) )
//
// — 0 at or below the book's mean experience, 1 at the worst the clamp permits,
// marketabilityOf's statistic run the other way — and it MODULATED the price
// reaction rather than adding a second penalty. The argument was that two
// independent penalties would make a member with a GOOD record facing a BIG
// increase only half-unhappy, when they are the member with the strongest
// grievance in the book.
//
// THAT ARGUMENT IS STILL RIGHT AND NO LONGER APPLIES. It was about an increase
// that CONTAINED the member's own modifier, so part of the increase really was
// theirs and the fault term said how much. The gap now contains only the pool's
// rate against the market — one decision, identical for every member of a
// line-year — and a member's claims record gives them no less standing to mind a
// pool-wide rate rise. Damping it would attribute part of the pool's decision to
// the member: the same conflation, moved one term to the right.
//
// ⚠ AND IT CARRIED A CROSS-LINE ARTEFACT NOBODY CHOSE. Property has no rated
// members, so every Property member sat at fault 0 and took the full reaction
// while WC and GL averaged 0.116 and 0.124 and were systematically damped.
// Three lines reacting differently to one pricing decision, because of a
// credibility measurement about something else.
//
// ⚠ PROPERTY'S OLD NOTE HERE — that its members "take the FULL grievance on
// every price move, which is right, not degenerate" — was true and is now true
// of every member on every line, which is the tell that the term had stopped
// describing anything.
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

import { ownExperienceFrames } from './memberExperienceMod';
import { experienceWindow, EXPERIENCE_WINDOW_YEARS } from './memberLossHistory';
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
   * ⚠ faultDiscount AND ownChangeExplained ARE BOTH GONE, AND THEY WENT FOR ONE
   * REASON BETWEEN THEM: THE MEMBER'S OWN EXPERIENCE IS REMOVED AT SOURCE NOW
   * RATHER THAN WEIGHTED ANYWHERE.
   *
   * ownChangeExplained was a discount whose only defensible value was 1.0, which
   * is a deletion wearing a dial. satisfactionMoves states the counterfactual
   * instead — the bill at LAST YEAR'S modifier, which is the pool's rate change
   * exactly — so there is nothing left to weight.
   *
   * faultDiscount followed it, and this is the part worth arguing rather than
   * asserting. It damped a member's reaction by how much their own loss ratio
   * explained their increase. That was the right shape when the increase
   * CONTAINED their own modifier: a member whose bill rose because their claims
   * rose had themselves to answer to. It is the wrong shape now. What is left in
   * the gap is the POOL'S rate against the market — one decision, identical for
   * every member of a line-year — and a member's claims record gives them no
   * less standing to mind a pool-wide rate rise. Keeping the damping would have
   * attributed part of the pool's decision to the member, which is the same
   * conflation moved one term to the right.
   *
   * ⚠ AND IT HAD A CROSS-LINE ARTEFACT NOBODY CHOSE. Property carries no rated
   * members — CREDIBILITY_Z.Property is 0 — so every Property member sat at
   * fault 0 and took the full reaction, while WC and GL members averaged 0.116
   * and 0.124 and were systematically damped. Three lines reacting differently to
   * the same pricing decision, because of a credibility measurement about
   * something else.
   *
   * ⚠ WHAT IT COSTS IS ALL THE WITHIN-YEAR TEXTURE, AND THAT IS THE CORRECT
   * CONSEQUENCE RATHER THAN A REGRESSION. Every member of a line-year now takes
   * an identical delta and an identical anchor. Per-member spread survives only
   * through enrolment history — when they joined, what they opened at, which
   * lines they carry — so Member.satisfaction is closer to a per-LINE quantity
   * carried per member than the name suggests.
   *
   * That follows from the ruling: satisfaction reports on the POOL, and the pool
   * does exactly one per-member thing — the experience modifier — which is
   * precisely what has been ruled out of it. Genuine per-member variation would
   * need a per-member thing the pool DOES that is not the modifier: how a claim
   * was handled, a dividend felt differently by size, a service a member used.
   * None of those exist in the model. Until one does, a flat line-year is the
   * honest answer and member-satisfaction-check asserts it rather than letting it
   * be discovered.
   */
  /**
   * Satisfaction points per percentage point of LEVEL gap, at the anchor.
   *
   * ⚠ THE RULE THIS WAS DERIVED FROM DOES NOT HOLD, AND THE NUMBER IS KEPT
   * ANYWAY. Recorded in full, because the arithmetic looked sound and the input
   * was measured in the wrong model.
   *
   * THE RULE WAS: one stop on the funding slider should be worth the SAME
   * through the level as through the change, over the six years the gate traces.
   * The change-limb input used was 0.037 points — the six-year footprint
   * measured BEFORE the anchor existed. In the shipped model the anchor PULLS
   * every year at 20.6% of the remaining distance, and that pull damps the
   * change limb's accumulated difference as well as carrying the level's. So
   * 0.037 is not the quantity the rule names.
   *
   * MEASURED IN THE SHIPPED MODEL, one stop over six years splits:
   *
   *   level limb   0.037 points   anchor difference x (1 - 0.5^(6/3))
   *   change limb  0.009 points   what survives the pull
   *   total        0.045 points   which is the footprint the gate measures
   *
   * — about FOUR TO ONE, not one to one. Satisfying the rule as written would
   * need levelWeight = 0.030 x (0.009 / 0.037) = 0.0073.
   *
   * ⚠ 0.0073 IS NOT TAKEN, AND THE REASON IS THE ORIGINAL REQUIREMENT RATHER
   * THAN CONVENIENCE. The whole point of a level limb is that a gap applying
   * EVERY YEAR should outweigh one applying ONCE; forcing them equal over six
   * years contradicts that, and it would leave the full slider worth 0.10 points
   * end to end — below where the enrolment draw sat two commits ago, and back to
   * a scoreboard nobody can read. Four to one over six years, growing with how
   * long the decision is held, is what "applies every year" should mean.
   *
   * SO THE HONEST STATUS IS: a continuity choice, not a derivation. 0.030 makes
   * a sustained one-stop decision's SETTLED effect 0.049 points, which is close
   * to what the change term alone was worth before the anchor existed, so the
   * mechanic kept its scale across the structural change. That is a reason, and
   * it is a weaker one than the rule it replaces.
   *
   * ⚠ AND THE SPLIT IS NOW ASSERTED RATHER THAN RECORDED. member-satisfaction-
   * check section 6 decomposes its own footprint into the two limbs from the
   * anchor differences on the move rows and requires the level limb to be the
   * larger. The ratio cannot go stale behind this comment again.
   *
   * WHAT IT BUYS ACROSS THE WHOLE SLIDER, which matters more than the anchor:
   * Expected -> the 0.95 stop moves the cushion -8.66% -> +9.88% on WC, so L
   * goes -3.85 -> +9.88 and the anchor moves 0.41 points. On Property, whose
   * load climbs fastest, -7.34% -> +23.18% moves it 0.79.
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

  // ==========================================================================
  // TERM 3 — THE MEMBER'S OWN LOSS RATIO AGAINST THE BOOK'S.
  //
  // ⚠ THE ONLY PER-MEMBER CHANNEL SATISFACTION HAS, AND THAT IS WHY IT EXISTS.
  // The price gap is a LINE-LEVEL quantity: one pricing decision, identical for
  // every member of a line-year. Measured before this term shipped, the whole
  // cross-member spread of the displayed value was 0.034 points at year 1 and
  // 0.070 at year 10, and every bit of it came from enrolment history — when a
  // member joined and which lines they carry. Two members side by side in the
  // same book, one with no claims and one with four, read the same number.
  // ==========================================================================
  /**
   * ⚠ MEASURED, AND IT IS A REACTION SCALE RATHER THAN A CAP ON LOSSES.
   *
   * THE RATIO IS UNCAPPED — MemberLossYear.actual is the drawn gross ultimate,
   * every layer, because this asks what the member GOT BACK. Measured over
   * EXPERIENCE_WINDOW_YEARS, 12 games x 10 years, rebased so the book reads 1:
   *
   *   line       mean    SD     p10    p50    p75    p99      MAX
   *   WC        0.990  2.638   0.05   0.45   1.02   9.20    159.9
   *   GL        1.069  4.443   0.01   0.25   0.79  13.96    158.6
   *   Property  0.986  4.741   0.00   0.10   0.56  14.33    203.1
   *
   * THE BRIEF ASKED FOR THAT SPREAD AND SAID TO REPORT IT RATHER THAN REACH FOR
   * A CAP IF IT WAS UNUSABLE. IT IS UNUSABLE RAW, and these are the numbers:
   * the top 1% of member-years carries 18-34% of the total ratio mass; the
   * MEDIAN member reads 0.45 / 0.25 / 0.10 while the mean is 1, so "average" in
   * this quantity describes almost nobody; 38.7% of Property member-years read
   * EXACTLY zero. And it is a SMALL-MEMBER artefact, which is the tell: the
   * smallest exposure quartile has SD 4.2 / 7.1 / 8.1 against the largest
   * quartile's 1.1 / 1.4 / 1.8, and a maximum of 159.9 against 15.5.
   *
   * ⚠ SO THE LOSSES ARE NOT CAPPED AND THE REACTION IS BOUNDED, WHICH IS A
   * DIFFERENT THING AND IS ALREADY THE HOUSE FORM. Every dollar still counts in
   * the ratio; what saturates is how far satisfaction will move for it. The
   * change limb does the same through r(x) and the market level through L(x) —
   * neither caps its input either.
   *
   *     u = tanh((1 - ratio) / lossSaturation)
   *
   * 1.70 is 2 x the pooled median |1 - ratio| of 0.852, on the rule that the
   * TYPICAL absolute deviation should map to half scale (tanh(0.5) = 0.462) so
   * that ordinary members sit on the responsive part of the curve rather than
   * on its shoulder. Per line the median reads 0.721 / 0.848 / 0.983, so one
   * pooled scale puts WC slightly more responsive than Property.
   *
   * ⚠ AND THE MAP IS NATURALLY ASYMMETRIC, WHICH IS NOT A DESIGN CHOICE. A
   * ratio cannot go below 0, so 1 - ratio <= 1 and u <= tanh(1/1.70) = +0.528;
   * a bad ratio is unbounded above, so u reaches -1. A member with NO claims at
   * all can be 0.53 good, a member with enough claims is 1.00 bad. That falls
   * out of the quantity rather than being put there.
   */
  lossSaturation: 1.70,
  /**
   * Anchor points per unit of loss standing.
   *
   * DERIVED THE SAME WAY THE LEVEL WEIGHT WAS: the spread this term creates
   * across a book should be worth about what ONE STOP on the funding slider is
   * worth through the market level, so that "who you are" and "what the pool
   * did" are the same size on the screen. One stop moves the market gap 3.64 /
   * 2.83 / 5.08 pp by line, so through levelWeight it is worth 0.030 x 3.85 =
   * 0.116 anchor points at the three-line mean.
   *
   * ⚠ AND THE FIRST VALUE SHIPPED HERE DID NOT SATISFY ITS OWN RULE. 0.45 was
   * the arithmetic estimate; measured on the built term the realised
   * within-line-year anchor SD came out 0.069 against the 0.116 target, so the
   * estimate of the standing's own spread was 1.7x out. 0.75 is 0.45 x
   * 0.116/0.069 and is the value the rule actually implies.
   *
   * member-satisfaction-check asserts the realised cross-member SD against that
   * target rather than trusting this arithmetic — the level weight's own
   * derivation went stale behind a comment and was only caught when the gate was
   * made to assert it, and this constant was wrong on the same day it was
   * written for exactly that reason.
   */
  lossLevelWeight: 0.75,
  /**
   * ⚠ JUDGEMENT, AND IT IS THE ONE CONSTANT THAT DECIDES THE SHAPE OF THE TERM.
   *
   * The brief says a good-ratio member is POSITIVE — they get the benefit of
   * pooling and are not punished for being productive — and that a bad-ratio
   * member "can also gain, from value received". Taken literally both ends are
   * positive and the term is a U with its minimum at the book average, which is
   * what ships.
   *
   * THAT IS A STRANGE SHAPE AND IT IS FLAGGED RATHER THAN SMOOTHED OVER: it
   * makes the exactly-average member the least satisfied of the three, on the
   * reasoning that they neither subsidised anyone nor were subsidised, so they
   * feel neither the productive member's recognition nor the claimant's payout.
   *
   * SETTING THIS TO 0 GIVES THE MONOTONE READING — good ratio positive, bad
   * ratio neutral — and that is a one-constant change, which is why the choice
   * is isolated here instead of being welded into the form. 0.35 says value
   * received is worth about a third of being productive.
   */
  lossValueShare: 0.35,
  /**
   * How much harder a good-ratio member takes a price rise above the market.
   *
   *     amp_i = 1 + lossAmplifierSlope x (u_i - book mean u)
   *
   * ⚠ THIS IS ownFault INVERTED IN MEANING, AND THE INVERSION IS A RULING THAT
   * OVERTURNS THIS FILE'S OWN PREVIOUS ONE. ownFault damped a member's reaction
   * by how much their own losses explained their increase; it was retired two
   * commits ago on the reasoning that "a member's claims record gives them no
   * less standing to mind a pool-wide rate rise". That reading is overruled: a
   * member who has taken nothing out and is asked for more minds MORE, and a
   * member the pool has just paid out for minds LESS. The old note is kept
   * below rather than deleted, because it argued the opposite and was wrong.
   *
   * ⚠ MEASURED AGAINST THE TERM IT INVERTS, so the change is in DIRECTION and
   * not in size. ownFault's own recorded book means were 0.116 on WC and 0.124
   * on GL — it damped the average member's reaction by about 12%. The mean
   * |u - u_book| measures 0.33, so a slope of 0.36 makes the average member's
   * amplifier differ from 1 by the same 12%. The pool is not being made more or
   * less reactive overall; the reaction is being pointed the other way.
   *
   * ⚠ AND IT IS REBASED SO THE BOOK'S MEAN AMPLIFIER IS EXACTLY 1. Without that
   * the term would silently rescale the whole line's price reaction — u has a
   * positive book mean (+0.145 / +0.216 / +0.270 by line, because the median
   * member sits well below the mean ratio), so an unrebased amplifier would
   * make every line react 5-10% harder to price and would show up as a change
   * in the change limb's own drift.
   */
  lossAmplifierSlope: 0.36,

  // ==========================================================================
  // TERM 4 — SURPLUS ADEQUACY. A LEVEL, BANDED.
  // ==========================================================================
  /**
   * Anchor points per BAND STEP of surplus adequacy.
   *
   * ⚠ THE FIRST DERIVATION WAS CIRCULAR AND IT IS RECORDED RATHER THAN REPLACED
   * QUIETLY, BECAUSE THE ERROR IS INSTRUCTIVE AND THE NEXT PERSON WILL REACH FOR
   * THE SAME RULE.
   *
   * It read: one band step is worth one stop on the funding slider through the
   * market level, 0.116 points — the same rule lossLevelWeight uses. THAT RULE
   * CANNOT BE USED HERE. Funding is what BUILDS surplus: one stop up raises the
   * price, which costs satisfaction through the market level, and accumulates
   * surplus, which pays it back through this term. Calibrating this term against
   * the very decision that drives it guarantees the two cancel.
   *
   * MEASURED, AT 0.115: one stop moved the surplus band +0.50 steps, worth
   * +0.058 anchor points, against the market level's -0.102 — so 56% of the
   * funding decision was cancelled, the six-year footprint of one stop fell from
   * -0.045 to +0.006, and member-satisfaction-check's section 6 went red on the
   * ruling it has asserted since the level term shipped: a decision must
   * outweigh the enrolment draw. A scoreboard whose two channels cancel reports
   * nothing, and the gate caught it.
   *
   * THE RULE THAT REPLACES IT IS A BOUND RATHER THAN A MATCH: this term may not
   * cancel more than a QUARTER of the funding decision it responds to.
   *
   * ⚠ AND THE BOUND HAD TO BE SOLVED FROM THE MEASUREMENT RATHER THAN ESTIMATED,
   * WHICH IS THE SECOND TIME THIS CONSTANT WAS WRONG BY ARITHMETIC. The estimate
   * — one stop moves the band half a step, so 0.25 x 0.116 / 0.50 = 0.058 —
   * still left 67% cancelled, because surplus COMPOUNDS over the six years the
   * footprint is measured across while the estimate treated one stop as one
   * step. Measured on section 6's own arm, the six-year footprint runs
   *
   *     w = 0.115  ->  +0.006      w = 0.058  ->  -0.015
   *
   * so d(footprint)/dw = +0.368 and the un-cancelled footprint is -0.036. A
   * quarter of that is -0.027, which needs w = 0.024.
   *
   * WHAT THAT LEAVES: the ladder spans Deficient -2 steps to Strong +1, so end to
   * end it is worth 0.072 points against the funding slider's own 0.41. That is
   * 18% of the funding mechanic — smaller than the first two attempts wanted,
   * and it is what the requirement permits: this term responds to the same
   * decision the market level responds to, in the opposite direction, so every
   * point of weight it carries is taken straight out of the player's main lever.
   * member-satisfaction-check asserts BOTH halves — the decision stays visible,
   * and the cancellation stays inside the quarter.
   */
  surplusWeight: 0.024,
  /**
   * Where "comfortably above the requirement" sits, in units of
   * excessCapitalRatio = (availableSurplus - reserveRiskMarginNeeded) /
   * reserveRiskMarginNeeded.
   *
   * ⚠ MEASURED, AS THE MEDIAN OF DEFAULT PLAY ON THE TWO LINES WHERE THE
   * QUANTITY DISCRIMINATES. 24 games x 10 years at all-default decisions the
   * ratio reads median 1.279 on WC and 0.969 on GL, so a boundary at 1.15 puts
   * a default-playing pool at the edge of the positive band about half the time.
   * That is the same rule anchorCentre follows — the neutral point sits where
   * DEFAULT play sits, so the term reports what the PLAYER did rather than what
   * the game does on its own.
   *
   * ⚠ PROPERTY DOES NOT DISCRIMINATE AND IS EXCLUDED FROM THE DERIVATION RATHER
   * THAN AVERAGED INTO IT. Its median ratio is 4.963 and 93% of its line-years
   * would sit in the positive band at any boundary in this range. The reason is
   * structural and is a real limitation of reading this quantity:
   * reserveRiskMarginNeeded is a RESERVE risk margin, Property is short-tail so
   * its reserves are small, and its actual exposure is a $75M catastrophe that
   * this denominator does not measure at all. The term is therefore close to
   * constant on Property, and that is a property of the measure rather than of
   * the pool.
   */
  surplusComfortable: 1.15,
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
export function satisfactionAnchor(
  levelGapPct: number,
  lossLevel: number = 0,
  surplusBand: SurplusBand = 'Unknown',
): number {
  const { anchorCentre, levelWeight, lossLevelWeight, floor, ceiling } = SATISFACTION;
  return Math.max(floor, Math.min(ceiling,
    anchorCentre
    - levelWeight * satisfactionLevelReaction(levelGapPct)
    + lossLevelWeight * lossLevel
    + surplusContribution(surplusBand)));
}

/** Share of the distance to the anchor closed in one year. See levelHalfLifeYears. */
export function satisfactionAnchorPull(): number {
  return 1 - Math.pow(0.5, 1 / SATISFACTION.levelHalfLifeYears);
}

// ============================================================================
// TERM 3 — WHERE A MEMBER STANDS AGAINST THE BOOK ON LOSSES.
//
//   ratio_i = (A_i / E_i) / (A_book / E_book)      UNCAPPED, gross, all layers
//   u_i     = tanh((1 - ratio_i) / lossSaturation)  bounded REACTION, not a cap
//
// and u drives two things at once:
//
//   A LEVEL, which is a U. level_i = max(0, u_i) + lossValueShare . max(0, -u_i)
//     A good-ratio member is positive because they get the benefit of pooling
//     and are not punished for being productive. A bad-ratio member is also
//     positive, smaller, because they received value. The average member is the
//     minimum. See lossValueShare, which is the one constant that decides this.
//
//   AN AMPLIFIER ON PRICE. amp_i = 1 + lossAmplifierSlope . (u_i - mean u).
//     A good-ratio member facing a rise above market minds MORE; a
//     heavy-claims member minds LESS. ownFault inverted in meaning.
//
// ⚠ BOTH ARE REBASED TO THE BOOK, AND FOR DIFFERENT REASONS. The amplifier is
// rebased so the line's mean reaction is unchanged — otherwise this term would
// silently retune the change limb for everyone. The LEVEL is rebased so the
// line's mean anchor is unchanged — otherwise a U whose book mean is positive
// would lift every member's anchor and show up as a level shift at defaults,
// which is exactly the drift the check-first confirmed is already there for a
// different reason. Rebased, term 3 is PURELY REDISTRIBUTIVE: it adds
// per-member texture and moves the book's average by nothing.
//
// ⚠ THE WINDOW IS THE LEDGER'S, AND IT CANNOT SEE THE YEAR IT IS SCORING. The
// satisfaction pass runs before this year's claims are generated, so the window
// is EXPERIENCE_WINDOW_YEARS of COMPLETED years — the same read the experience
// modifier gets, and the right one: a member forms a view of the pool from the
// losses they have actually had, not from ones the engine has not drawn yet.
//
// ⚠ AND THE DENOMINATOR IS expectedAtManual, THE NEUTRAL-RISK-QUALITY LEG. Using
// expectedAtOwnRq would divide out the member's own risk quality, which is the
// very thing that makes one member's ratio differ from another's — the same
// argument MemberLossResult.expectedLossAtManual makes for the modifier.
// ============================================================================

export interface LossStanding {
  memberId: string;
  /** Uncapped, rebased so the book reads 1. Heavy-tailed — see lossSaturation. */
  ratio: number;
  /** The bounded reaction, tanh((1 - ratio)/s), in (-1, +0.528]. */
  u: number;
  /** The U-shaped level contribution, rebased so the book mean is 0. */
  level: number;
  /** Multiplier on the price reaction, rebased so the book mean is 1. */
  amplifier: number;
  /** False when the member has no usable window; level 0 and amplifier 1. */
  known: boolean;
}

export function memberLossStanding(
  members: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
): LossStanding[] {
  const { lossSaturation, lossValueShare, lossAmplifierSlope } = SATISFACTION;
  const raw = members.map(m => {
    const w = experienceWindow(history, m.id, line, EXPERIENCE_WINDOW_YEARS);
    let a = 0, e = 0;
    for (const y of w) { a += y.actual; e += y.expectedAtManual; }
    return { id: m.id, a, e };
  });
  const bookA = raw.reduce((t, x) => t + x.a, 0);
  const bookE = raw.reduce((t, x) => t + x.e, 0);
  const bookRate = bookE > 0 ? bookA / bookE : 0;

  const pre = raw.map(x => {
    const known = x.e > 0 && bookRate > 0;
    const ratio = known ? (x.a / x.e) / bookRate : 1;
    const u = known ? Math.tanh((1 - ratio) / lossSaturation) : 0;
    const level = Math.max(0, u) + lossValueShare * Math.max(0, -u);
    return { id: x.id, known, ratio, u, level };
  });
  // The two rebases. Over the members with a usable window only — an unrated
  // member must not drag the book's mean toward its own neutral 0.
  const usable = pre.filter(x => x.known);
  const meanU = usable.length ? usable.reduce((t, x) => t + x.u, 0) / usable.length : 0;
  const meanLevel = usable.length ? usable.reduce((t, x) => t + x.level, 0) / usable.length : 0;

  return pre.map(x => ({
    memberId: x.id,
    ratio: x.ratio,
    u: x.u,
    level: x.known ? x.level - meanLevel : 0,
    amplifier: x.known ? 1 + lossAmplifierSlope * (x.u - meanU) : 1,
    known: x.known,
  }));
}

// ============================================================================
// TERM 4 — SURPLUS ADEQUACY. A LEVEL, BANDED, AND IT READS WHAT ALREADY SHIPS.
//
// ⚠ NOTHING IS DERIVED HERE THAT THE ENGINE HAD NOT ALREADY COMPUTED. The brief
// asked whether capitalFundingGap and reserveRiskMarginNeeded answer this before
// deriving anything. THEY DO, and better than that: processLineYear already
// normalises them into excessCapitalRatio = (availableSurplus -
// reserveRiskMarginNeeded) / reserveRiskMarginNeeded, and already BANDS it into
// capitalAdequacyStatus at 0.25 / 0 / -0.10. So the quantity and the ladder both
// existed; this reads them.
//
// ⚠ WHAT IS NOT REUSED IS THE TOP BOUNDARY, AND THE REASON IS MEASURED. The
// shipped 0.25 was drawn for a solvency LABEL, and as a satisfaction band it is
// saturated: 24 games x 10 years at defaults puts 89.6% of WC line-years, 75.8%
// of GL's and 96.7% of Property's in "Strong". A band that contains nine
// line-years in ten cannot report anything about the player. surplusComfortable
// replaces only that edge, at the median of default play; the two boundaries
// that carry an absolute meaning — at the requirement, and below it — are the
// shipped ones untouched, because 0 needs no derivation.
//
// ⚠ THE RATIO IS LAST YEAR'S, NOT THIS YEAR'S, AND THAT IS DELIBERATE TWICE
// OVER. The satisfaction pass runs several hundred lines before the capital
// block, so this year's ratio does not exist yet — and it should not be used
// even if it did: the balance sheet a member can see when their bill arrives is
// the one that closed last year.
//
// ⚠ FLICKER IS REAL AND THE ANCHOR IS WHAT ABSORBS IT. Measured band-change
// rates per consecutive year pair at defaults: 13.0% WC, 18.5% GL, 6.9%
// Property at a 0.50 boundary, and 17.1 / 21.8 / 13.0 at 1.00. A three-year
// trailing mean of the ratio would cut those to 11.6 / 15.7 / 3.7 and is NOT
// taken, because it needs three prior results plumbed through and the anchor
// already damps what is left: a band flip that reverses next year moves the
// stock by one year of pull, 20.6% of the step, and then pulls back. A banded
// level feeding an ANCHOR is inherently flicker-tolerant in a way that the same
// band feeding a FLOW would not be.
// ============================================================================

export type SurplusBand = 'Deficient' | 'Thin' | 'Adequate' | 'Strong' | 'Unknown';

/**
 * Band steps, in units of surplusWeight. Adequate is 0 — the NEUTRAL band, at
 * and just above the requirement. Strong is open-ended: no ceiling.
 */
export const SURPLUS_BAND_STEPS: Record<SurplusBand, number> = {
  Deficient: -2,
  Thin: -1,
  Adequate: 0,
  Strong: +1,
  Unknown: 0,
};

export function surplusBandOf(excessCapitalRatio: number | null | undefined): SurplusBand {
  if (excessCapitalRatio === null || excessCapitalRatio === undefined
    || !Number.isFinite(excessCapitalRatio)) return 'Unknown';
  if (excessCapitalRatio >= SATISFACTION.surplusComfortable) return 'Strong';
  if (excessCapitalRatio >= 0) return 'Adequate';
  if (excessCapitalRatio >= -0.10) return 'Thin';
  return 'Deficient';
}

/** Anchor points this band contributes. Positive is happier. */
export function surplusContribution(band: SurplusBand): number {
  return SATISFACTION.surplusWeight * SURPLUS_BAND_STEPS[band];
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
  /** LAST year's excessCapitalRatio — see the term 4 header on why last year's. */
  priorExcessCapitalRatio?: number | null,
): SatisfactionMove[] {
  const { frames } = ownExperienceFrames(members, line, history);
  const standing = memberLossStanding(members, line, history);
  const surplusBand = surplusBandOf(priorExcessCapitalRatio);
  const known = poolRateChangePct !== null && poolRateChangePct !== undefined;
  const r = known ? poolRateChangePct : 0;

  // ============================================================================
  // THE COUNTERFACTUAL BILL, AND IT IS ONE LINE OF ALGEBRA.
  //
  // A member's bill is  rate x class relativity x mod.  Their class relativity
  // is static, so holding the modifier at LAST YEAR'S value and asking what the
  // bill would have done gives
  //
  //     (rate_t . class . mod_(t-1)) / (rate_(t-1) . class . mod_(t-1)) - 1
  //       =  rate_t / rate_(t-1) - 1
  //
  // — the pool's rate change, exactly, with the member's own experience gone
  // rather than weighted. Against the market that is one number for the whole
  // line-year, because a pricing decision is one decision.
  //
  // ⚠ IT IS ARITHMETICALLY WHAT THE PREVIOUS COMMIT'S OWN_CHANGE_EXPLAINED = 1.0
  // ALREADY PRODUCED, AND THE KNOB IS GONE ANYWAY. A discount whose only
  // defensible value is 1 is not a parameter, it is a deletion wearing a dial —
  // and a dial invites exactly one person to set it to 0.8 without an argument.
  // Stating the counterfactual says what the model does; stating a weight of 1
  // says what it happens to be set to.
  // ============================================================================
  const billAtPriorModPct = known ? r : 0;
  const excessPct = known ? billAtPriorModPct - marketChangePct : 0;
  // The line-level part of the reaction, before the per-member amplifier.
  const baseDelta = -SATISFACTION.priceWeight * satisfactionReaction(excessPct);

  return members.map((m, i) => {
    const f = frames[i];
    const st = standing[i];
    return {
      memberId: m.id,
      // REPORTED, NOT REACTED TO. What the member was actually billed, mod and
      // all, so the row shows both the bill and the counterfactual it is judged
      // against rather than hiding the difference.
      billChangePct: ((1 + r / 100) * (1 + f.ownChangePct / 100) - 1) * 100,
      ownChangePct: f.ownChangePct,
      billAtPriorModPct,
      marketChangePct,
      excessPct,
      levelGapPct,
      // TERM 3, both halves. The ratio is reported so a reader can see the
      // uncapped quantity the bounded reaction was taken from.
      lossRatio: st.ratio,
      lossStanding: st.u,
      lossLevel: st.level,
      priceAmplifier: st.amplifier,
      // TERM 4.
      surplusBand,
      surplusRatio: priorExcessCapitalRatio ?? null,
      // FOUR LIMBS. The anchor carries three levels — the market's, the
      // member's own losses, and the pool's surplus — and the change limb
      // carries the fourth, amplified per member.
      anchor: satisfactionAnchor(levelGapPct, st.level, surplusBand),
      delta: baseDelta * st.amplifier,
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

export function satisfactionMovesById(
  moves: readonly SatisfactionMove[],
): Map<string, SatisfactionMove> {
  return new Map(moves.map(mv => [mv.memberId, mv]));
}
