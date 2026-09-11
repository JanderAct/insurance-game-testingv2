// ============================================================================
// WHO LEAVES, AND WHY — the departure model.
//
//   departureRisk_i = W_PRICE . max(0, priceShock_i) . marketability_i
//                     + noise_i
//
// sorted DESCENDING: the highest risk leaves. The COUNT is not decided here —
// calcRetentionProbability sets how many go, reading the pool-wide rate
// increase, dividends, assessments and surplus. This file decides only WHICH.
//
// ============================================================================
// WHAT IT REPLACED, AND WHY A SIGN FLIP WOULD NOT HAVE DONE.
//
// The old key was `satisfaction + 0.3 * riskQuality`, ascending, lowest
// leaves. Measured over 8 games x 14 years before the rebuild:
//
//   rho(key, riskQuality)    WC 0.340  GL 0.383  Property 0.416
//   rho(key, satisfaction)   WC 0.524  GL 0.550  Property 0.517
//   mean RQ of leavers       4.607 against 5.630 for stayers  (WC, -1.02)
//
// Two defects, and the second is the one that made this a rebuild.
//
// WRONG DIRECTION. Low risk quality left first, so the book self-cleaned.
// Real adverse selection runs the other way: when the price rises it is the
// GOOD risks who can get a better deal elsewhere, and the pool keeps the ones
// nobody else wants.
//
// ⚠ AND THE SATISFACTION TERM WAS INERT NOISE WEARING A BEHAVIOURAL LABEL.
// Member.satisfaction is drawn once at enrolment from U(6.0, 8.5) and never
// updated: measured, it changed in 70 of 18,239 member-year pairs (0.4%), and
// every one of those was a member re-joining and drawing afresh. The
// pool-level memberSatisfaction scalar does respond to decisions; this
// per-member field never did. Yet it carried MORE rank weight than the risk
// quality term (0.52 against 0.34), purely because its range (1.80) slightly
// exceeded 0.3 x RQ's (1.71).
//
// So departure was half genuine risk selection, half a coin flip frozen at
// enrolment into a permanent caste, and no part of WHO left responded to
// anything the player did. Flipping the sign would have fixed the direction
// and left the caste.
//
// ============================================================================
// WHAT THE MEMBER ACTS ON, AND WHY IT IS NOT RISK QUALITY.
//
// A member cannot act on an attribute the model calls risk quality — they do
// not know their score, and neither does anyone else. They know two things:
// their own bill, and their own claims. Both are in the modifier already.
//
//   priceShock_i    how much their charge rose relative to the book. The
//                   pool-wide rate change (which everyone feels) plus their
//                   own modifier's change (which only they feel). Their class
//                   relativity is static, so member price = pool rate x class
//                   relativity x mod, and the change needs no new storage.
//
//   marketability_i how much better the outside market could price them.
//
// ============================================================================
// ⚠ MARKETABILITY IS DERIVED, NOT PICKED, AND THE DERIVATION IS THE POINT.
//
// The naive worry: if the outside market prices on the same experience the
// pool does, nobody has an edge and there is no adverse selection. The
// asymmetry is CREDIBILITY. The pool moves only Z = 0.15 of the way from the
// manual to the member's own experience, because that is all the data
// supports. A commercial carrier that is willing to cherry-pick effectively
// applies a HIGHER credibility to the members it wants.
//
// Write the outside carrier's weight as Z_out > Z. With c_i the member's
// clamped experience ratio and M the book's rebase divisor:
//
//   pool charges     1 + Z     (c_i/M - 1)
//   outside offers   1 + Z_out (c_i/M - 1)
//   the member gains (Z_out - Z)(1 - c_i/M)
//
// So the gain from shopping is PROPORTIONAL TO (1 - c_i/M) — the member's
// shortfall below the book's mean experience — and the constant of
// proportionality is the credibility differential. A member at the book mean
// gains nothing; a member with better-than-average experience gains in
// proportion to how much better; a member with worse experience gains a
// negative amount, which is to say they are captive.
//
// THE SCALE COMES FROM THE CLAMP, SO Z_out NEVER HAS TO BE GUESSED. The best
// experience the clamp permits is c = ratioFloor, so the largest possible
// shortfall is (1 - ratioFloor/M). Normalising by it puts marketability on
// [0, 1] where 1 is the most attractive member this configuration can
// produce:
//
//   marketability_i = clamp01( (1 - c_i/M) / (1 - ratioFloor/M) )
//
// Every term is a shipped, measured constant. The credibility differential
// disappears into W_PRICE, which is the single free scale and is measured
// below rather than asserted.
//
// ⚠ AND THE SAME STATISTIC RUNS BOTH WAYS, WHICH IS THE WHOLE MECHANISM. The
// pool wants to decline HIGH-mod members; the market wants to poach LOW-mod
// ones. One number, two opposite pressures. That tension IS adverse
// selection rather than a label for it, and Renewal Underwriting is the lever
// that manages it.
//
// ============================================================================
// THE NOISE IS DRAWN FRESH EVERY YEAR.
//
// Not because randomness is desirable but because the alternative measured
// worse: a draw frozen at enrolment is a permanent caste, and the members
// unlucky at join were disadvantaged for the whole game by a number that
// never responded to anything. Fresh each year, a member's luck this year
// says nothing about next year, and the systematic part of departure is the
// only part that persists.
// ============================================================================

import { CREDIBILITY_Z, EXPERIENCE_MOD, clampedRatioFor } from './memberExperienceMod';
import { experienceWindow, priorExperienceWindow } from './memberLossHistory';
import type { CoverageLine, Member, MemberLossHistory } from '../types/simulation';
import type { SeededRandom } from './random';

/**
 * How hard the economic term pushes against the noise.
 *
 * ⚠ THE ONE FREE SCALE, AND IT IS ANCHORED TO WHAT THE MODEL ALREADY HAD
 * RATHER THAN CHOSEN FOR FEEL. marketability's form and scale are both
 * derived (see the header); this is the only number left, and the anchor is
 * that the model should keep the AMOUNT of selection it always had while the
 * sign and the basis change. The old sort produced a mean risk-quality gap of
 * -1.02 between leavers and stayers on WC.
 *
 * Swept, 6 games x 14 years, mean RQ of leavers minus stayers:
 *
 *   weight    WC gap    GL gap   Property   WC enrolled   rho(risk, economics)
 *     0.00   -0.0408   +0.2434   -0.1658        61.8          -      (null)
 *     0.02   +0.0886   +0.0116   -0.1658        57.3        0.048
 *     0.05   +0.2158   +0.1678   -0.1658        55.8        0.068
 *     0.08   +0.4274   +0.0862   -0.1658        54.3        0.097
 *     0.15   +0.4634   +0.1400   -0.1658        55.2        0.150
 *     0.30   +0.5300   +0.3363   -0.1658        56.4        0.291
 *     1.00   +0.9180   +0.4255   -0.1658        57.1        0.472
 *
 * 1.00 reproduces the old magnitude (+0.918 against -1.023) with the sign
 * reversed, and does NOT make departure deterministic: the rank correlation
 * between a member's departure risk and its economic component is 0.47, so
 * economics and luck contribute about equally. The worry that
 * magnitude-matching would force a degenerate weight was wrong, and it was
 * measured rather than reasoned about.
 *
 * ⚠ TWO HONEST LIMITS ON THAT LAST COLUMN. It is measured with the POOL-WIDE
 * rate deviation zeroed, so it captures only the member's own modifier change
 * — the real economics share in a year when the pool moves its rate is higher
 * than 0.47. And weight 0 is the null arm: WC -0.04 is pure noise and
 * confirms the mechanism contributes nothing when switched off.
 *
 * ⚠ PROPERTY IS -0.1658 AT EVERY WEIGHT, INCLUDING ZERO, AND THAT IS CORRECT.
 * Property's credibility is 0, so no member is rated, marketability is 0 for
 * all of them and departure is pure noise. Property has no adverse selection
 * because it has no modifier to generate one — the same measurement that
 * withdrew its experience rating.
 *
 * priceShock is in PERCENTAGE POINTS (matching priceSignalFor), marketability
 * is on [0, 1], and the noise is U(0, 1).
 */
export const DEPARTURE = {
  priceWeight: 1.0,
};

export interface DepartureRisk {
  memberId: string;
  /** Percentage points: pool-wide rate deviation plus own modifier change. */
  priceShock: number;
  /** [0, 1]; 1 is the most attractive member the clamp can produce. */
  marketability: number;
  noise: number;
  risk: number;
}

/**
 * Marketability from the clamped experience ratio. Exported so the gate can
 * assert the endpoints rather than re-deriving them.
 */
export function marketabilityOf(clamped: number, M: number, ratioFloor = EXPERIENCE_MOD.ratioFloor): number {
  if (!(M > 0)) return 0;
  const span = 1 - ratioFloor / M;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (1 - clamped / M) / span));
}

/**
 * Departure risk for every member on the book, highest-first when sorted
 * descending.
 *
 * ⚠ CONSUMES ONE RNG DRAW PER MEMBER, IN ROSTER ORDER. That is a stream
 * change against the frozen-satisfaction model it replaces and it is the
 * reason both baselines recapture at this commit. The draw order is the
 * member array's order, which processYear derives deterministically, so the
 * stream is reproducible.
 */
export function departureRisks(
  members: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
  poolChangeDeviationPct: number,
  rng: SeededRandom,
): DepartureRisk[] {
  const Z = CREDIBILITY_Z[line] ?? 0;
  const { windowYears } = EXPERIENCE_MOD;

  // The rebase divisor over the CURRENT book, on the same basis
  // memberExperienceMods uses. Unexposed members are not on the book.
  const now = new Map<string, ReturnType<typeof clampedRatioFor>>();
  const prior = new Map<string, ReturnType<typeof clampedRatioFor>>();
  let weighted = 0, count = 0;
  for (const m of members) {
    const c = clampedRatioFor(m, line, experienceWindow(history, m.id, line, windowYears));
    now.set(m.id, c);
    prior.set(m.id, clampedRatioFor(m, line, priorExperienceWindow(history, m.id, line, windowYears)));
    if (c.rated) { weighted += c.clamped; count++; }
  }
  // ⚠ UNWEIGHTED HERE, AND memberExperienceMods WEIGHTS BY EXPOSURE. The
  // divisor there has to be exposure-weighted or the allocation would not
  // rebase to 1. Here it is a behavioural reference point — "how does my
  // experience compare to a typical member" — and a member shopping their
  // coverage compares themselves to other MEMBERS, not to other dollars.
  const M = count > 0 ? weighted / count : 1;

  return members.map(m => {
    const c = now.get(m.id)!;
    const p = prior.get(m.id)!;
    // Their own modifier's year-over-year change, in percentage points. Both
    // sides use the SAME M, so this isolates the member's own experience
    // rather than mixing in a move in the book around them.
    const modNow = c.rated ? 1 + Z * (c.clamped / M - 1) : 1;
    const modPrior = p.rated ? 1 + Z * (p.clamped / M - 1) : 1;
    const ownChangePct = modPrior > 0 ? (modNow / modPrior - 1) * 100 : 0;

    const priceShock = Math.max(0, poolChangeDeviationPct + ownChangePct);
    const marketability = c.rated ? marketabilityOf(c.clamped, M) : 0;
    const noise = rng.range(0, 1);
    return {
      memberId: m.id,
      priceShock,
      marketability,
      noise,
      risk: DEPARTURE.priceWeight * priceShock * marketability + noise,
    };
  });
}
