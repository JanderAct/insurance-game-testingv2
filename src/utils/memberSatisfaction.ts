// ============================================================================
// MEMBER SATISFACTION — what one member thinks of the pool, and it MOVES.
//
//     delta_i = -W . excess_i . (1 - FAULT . ownFault_i)
//
//     excess_i   = the member's own bill change, in percentage points, MINUS
//                  what the market's rate did this year
//     ownFault_i = how much of their own increase their own claims explain,
//                  on [0, 1]
//
// applied to the member's carried satisfaction and clamped to [1, 10].
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
import type { CoverageLine, Member, MemberLossHistory } from '../types/simulation';

/**
 * The response scale, in satisfaction points per percentage point of
 * market-adjusted bill change.
 *
 * ⚠ ADOPTED FROM THE POOL-LEVEL CONSTANT, THEN CHECKED FOR SEPARATION RATHER
 * THAN FOR FEEL. RATE_SATISFACTION_SENSITIVITY is 0.015 and its own header is
 * candid about where it came from: "there is no measurement in this model that
 * could pin a member's price elasticity, so it is a judgment, and it is
 * recorded as one." Nothing here changes that, so inventing a second judgment
 * would be worse than reusing the first.
 *
 * ⚠ AND A SWEEP CANNOT PICK IT, WHICH WAS WORTH FINDING OUT RATHER THAN
 * ASSUMING. The obvious criterion — "set W so a pool priced above market
 * separates from one priced at market by more than the noise" — is EMPTY,
 * because the gap and the noise both scale linearly in W and the ratio is
 * therefore constant. Measured, 16 seed-matched games x 10 years, mean WC
 * member satisfaction at year 10, defaults against an ascending-CLF arm
 * (fundingAtExpected off, confidence 0.60 climbing 3.5pp a year to 0.95):
 *
 *   W        defaults   priced up     gap     unpaired gap/SD   paired t
 *   0.005      7.202      7.158      -0.043        0.4             4.2
 *   0.015      7.081      6.945      -0.136        1.0             8.1
 *   0.030      6.901      6.624      -0.277        1.1             8.8
 *   0.050      6.658      6.195      -0.463        1.2             8.8
 *   0.150      5.849      4.754      -1.095        1.0             8.1
 *
 * The unpaired column is flat, as the scale argument says it must be. The
 * PAIRED column is not flat, and that is not the mechanism — it is the two
 * DISCRETISATIONS either side of the range: at 0.005 a year's move is small
 * enough that the two-decimal rounding eats part of it, and at 0.150 the [1, 10]
 * clamp starts binding. Between them the mechanism transmits cleanly and W is
 * a free choice.
 *
 * SO 0.015 IS KEPT ON CONSISTENCY, NOT ON A MEASUREMENT. It is the shipped
 * scale for exactly this quantity elsewhere in the model, and adopting a
 * different one would be a SECOND judgement about member price elasticity with
 * no more evidence than the first. What it costs is legibility: a decade of the
 * ascending-CLF arm moves the mean by 0.14 against a join-draw spread of 2.5
 * points, so a player reading one member's number would struggle to tell a
 * decade of aggressive pricing from where that member started. The scoreboard
 * is SLOW, and saying so is better than quietly picking a louder number. 0.050
 * would make it plain at 0.46 and is the change to make if playtest says the
 * column looks frozen — the table is here so that is one line with evidence
 * behind it rather than a taste.
 *
 * ⚠ AND THE DRIVER IS SMALLER THAN THE DECISION THAT PRODUCES IT, which is why
 * the gap is small. Mean market-adjusted bill change, percentage points a year,
 * same 16 games:
 *
 *   arm              WC       GL       Property
 *   defaults       -0.31    -0.99      -0.74
 *   ascending CLF  +0.97    +1.27      +1.70
 *
 * A pricing lever swung from break-even to the 95th percentile over a decade
 * moves a member's bill about 1.3 to 2.4 points a year past the market. That is
 * the quantity satisfaction reads, and it is the honest size of it.
 */
export const SATISFACTION = {
  priceWeight: 0.015,
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

export interface SatisfactionMove {
  memberId: string;
  /** Percentage points: (1 + r/100)(mod_t/mod_(t-1)) - 1, x100. */
  billChangePct: number;
  /** Percentage points, from marketConditions. The same for every member. */
  marketChangePct: number;
  /** billChangePct - marketChangePct. What the pool has to answer for. */
  excessPct: number;
  /** [0, 1]. 0 for an unrated member and for anyone at or below the book mean. */
  ownFault: number;
  /** Satisfaction points. Negative is unhappier. */
  delta: number;
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
      delta: -SATISFACTION.priceWeight * excessPct * (1 - SATISFACTION.faultDiscount * ownFault),
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
