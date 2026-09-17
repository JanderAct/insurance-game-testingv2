// ============================================================================
// RENEWAL UNDERWRITING — the pool declines to renew a member whose EXPERIENCE
// RATIO is above a threshold the player sets.
//
// ⚠ THE THRESHOLD IS ON THE RATIO, NOT ON THE MODIFIER, AND THAT IS A CHANGE.
// It used to compare the displayed modifier against 1.25 / 1.15 / 1.10. Those
// are the right shape for a modifier and meaningless as an underwriting
// decision, because the modifier is DELIBERATELY DAMPED: Z is 0.155 on WC, so
// 84.5% of what a member is charged is the class average and only 15.5% is
// them. Measured over 3,506 rated WC member-years, a member running 3x their
// own expected cost displays at about 1.31 and the whole displayed range is
// 0.93 to 1.35. Nothing in that band looks like a decision because nothing in
// that band IS one — it is a billing consequence.
//
// The ratio is what an underwriter judges: actual primary loss over the
// member's own expected primary loss, on their own class basis, over the
// window. It runs 0.24 to 5.48 on WC. See renewal-threshold-derive.ts for the
// distribution and for how the shipped level was picked off it.
//
// This is the lever that manages adverse selection. memberDeparture.ts is the
// pressure: when the price rises, the members with the best experience have
// somewhere to go and leave. This is the pool's answer — it cannot keep the
// good risks by wanting to, but it can decline the worst.
//
// ⚠ ONE STATISTIC, TWO OPPOSITE PRESSURES, AND THAT IS THE MECHANISM RATHER
// THAN A COINCIDENCE. The market poaches LOW-mod members; the pool declines
// HIGH-mod ones. Both read the same number off the same ledger.
//
// ============================================================================
// THE BASIS: RAW, AND IT IS NOW THE SAME ONE NEW BUSINESS APPETITE USES.
//
// The two controls read one ledger and used to read it two ways — this file
// compared `clampedRatio` (Mahler's rule 3, [0.5, 3.0]) and
// newBusinessAppetite.ts compared `rawRatio`. Measured before choosing, 8 games
// x 14 years, warm years only, every rated member-year, BOTH readings taken
// from the same call on the same member:
//
//   the two readings differ as NUMBERS on 20.4% of WC member-years and 23.4%
//   of GL's — 19.0% / 21.4% below the floor, 1.4% / 2.0% above the ceiling.
//
//   they differ as DECISIONS, at every level either control offers, on ZERO.
//
//     threshold   0.75  1.00  1.50  2.00  2.50  2.75  |  3.00
//     disagree       0     0     0     0     0     0  |   101 (WC), 142 (GL)
//
// ⚠ SO THE BASIS WAS NEVER THE DIFFERENCE IT LOOKED LIKE. The clamp is
// monotone, so for any threshold strictly inside (0.5, 3.0) `clamped > t` and
// `raw > t` are the same statement about the same member — not usually, not to
// a tolerance, identically. The choice therefore costs nothing at any shipped
// level and is decided entirely on what happens at the edges.
//
// RAW WINS ON TWO COUNTS, ONE OF WHICH IS THE PLAYER'S:
//
//   IT IS THE NUMBER ON THE SCREEN. The Membership page's Loss Ratio column is
//   the raw ratio and the control's own note points at it. A threshold
//   comparing something else needed a paragraph explaining that it did; it no
//   longer does.
//
//   THE CEILING DEAD ZONE GOES. On the clamped basis every value at or above
//   3.00 declined nobody on any book, ever — measured, 80 of 80 line-years at
//   exactly 0 — while raw declines 1.26 (WC) and 1.77 (GL) per line-year there.
//   A control that is silently inert at a settable value is a hazard; this file
//   carried a warning about it instead of not having it.
//
// ⚠ WHAT THE CLAMPED BASIS LOSES, NAMED RATHER THAN WAVED AT. Two things, and
// the first is real:
//
//   THE UNREACHABLE BOUND STOPS BEING STRUCTURAL. `clampedRatio` could not
//   exceed 3.0 by construction, so "a threshold that declines nobody" had a
//   proof. Ap/Ep is unbounded above, so the same statement is now an EMPIRICAL
//   bound — the observed maximum is 6.96 (WC) and 5.40 (GL). renewal-stability
//   -check's null arm is re-derived on that basis and says so at the constant.
//
//   MAHLER'S RULE 3 NO LONGER APPLIES TO THE COMPARISON. It still governs the
//   MODIFIER, which is where it belongs — a rebased billing weight is exactly
//   the quantity stability protects. What is given up here is the guarantee,
//   not a behaviour: measured, the clamp changes no decision at any level.
//
// ============================================================================
// ⚠ AND THE GAP THAT SURVIVES IS NOT THIS ONE. It is bigger, and choosing a
// reading cannot close it.
//
// An applicant's claims are drawn at kLine = 1 with riskControlEffectiveness =
// 0; an enrolled member's carry the book's own k and whatever risk control the
// pool has bought. Both legs of the ratio see k, so the MODIFIER is k-invariant
// — every member of a line-year shares one k and the rebase divisor absorbs it.
// A THRESHOLD IS NOT REBASED, so k does not cancel there.
//
// Measured on the same member observed both ways — a window drawn entirely
// before they joined against one drawn entirely after, paired within member:
//
//   line   paired mean diff (member - prospect)   aggregate ratio   placebo
//   WC        -0.1388   (t -4.65)                    0.916          +0.042 (t 1.59)
//   GL        -0.1540   (t -4.44)                    0.929          -0.023 (t -0.72)
//
// The placebo runs the identical estimator on members who were NEVER enrolled,
// early windows against late, so it carries the time gap and not the basis
// change. It reads null on both lines, so the -0.14 is the basis.
//
// ⚠ THE SAME MEMBER READS ABOUT 0.92x ENROLLED WHAT THEY READ AS AN APPLICANT.
// So a renewal bar of 2.50 is roughly a 2.72 bar on the applicant scale, and
// the factor MOVES with the book because k does. Nothing here is wrong — an
// applicant's loss run is their own and must not carry the pool's mix
// correction — but the two ladders are not on one scale and cannot be made so
// by picking a reading. Closing it means dividing the member's ratio by k_line,
// which changes every renewal decision, and that is a design ruling rather than
// a basis choice.
//
// ⚠ AND THE CROSS-SECTIONAL FIGURE GETS THE SIGN WRONG. Comparing enrolled
// members against available applicants in the same year reads members HIGHER —
// 0.981 against 0.912 on WC — which is the composition of the two groups, not
// the basis, and it points the opposite way to the paired estimate above.
// newBusinessAppetite.ts records that cross-section (0.918 against 0.958); it
// is a true statement about who those people are and it is not a measurement of
// the basis gap. Marked at that constant.
//
// ============================================================================
// WHERE IT SITS, AND WHY BESIDE simulateMemberMovement RATHER THAN INSIDE IT.
//
// Movement decides how many members LEAVE (calcRetentionProbability) and
// which (departureRisks). A decline is not a departure: it is the pool's
// decision, not the member's, and it must not consume the withdrawal budget.
// Run through that budget, declining a member would SAVE a member who would
// otherwise have left, and a strict renewal policy would show up as improved
// retention. So declines run after movement returns, on the book it produced.
//
// ⚠ AND EACH DECLINE WRITES closeInterval, OR IT MEANS NOTHING. Recruitment
// eligibility reads membershipHistory, not Member.status
// (see membershipHistory.ts). A declined member who is not written to the
// ledger is eligible to be recruited straight back the following year — the
// pool would decline them in year 5 and re-accept them in year 6, having paid
// nothing for the decision. The two-year cooldown is what makes a decline a
// decision.
//
// ============================================================================
// ⚠ THE MODIFIER IS EVALUATED TWICE, AND THE OBVIOUS IMPLEMENTATION EVALUATES
// IT ONCE.
//
// The decision reads the mod on the PRE-DECLINE book — that is the only book
// that exists when the decision is made, and it is the one the player saw
// when they set the threshold. Pricing then reads it again on the
// POST-DECLINE book, because the rebase divisor M is computed over whoever is
// actually enrolled and the surviving members' mods have to sum back to the
// allocation.
//
// Evaluate once and the difference is INVISIBLE until someone declines a lot
// of members: with two or three declines out of sixty, M barely moves and
// both readings agree to three decimals. Decline fifteen and the pre-decline
// mods are wrong for pricing by several points, in the direction that
// under-charges the survivors. The failure appears only at the setting a
// player reaches when the mechanism is working hardest.
//
// ============================================================================
// ⚠ THE RATCHET, WHICH IS THE REAL RISK AND IS NOT THE LOOP THAT WAS WATCHED
// FOR.
//
// The loop flagged twice in planning was: decline high-mod members -> the
// enrolled mix improves -> k_line moves -> expected moves -> next year's mods
// move. THAT LOOP DOES NOT EXIST. k appears in both legs of the ratio
// deliberately (see memberLossHistory.ts), so Ap and Ep scale together and
// the modifier is k-invariant.
//
// The real loop is the REBASE DIVISOR. mod = 1 + Z(c/M - 1) and M is the mean
// clamped ratio over the current book. Decline the worst members and M falls,
// so every survivor's c/M rises, so every survivor's mod rises, so more of
// them sit above the threshold next year. Tighter than the loop that was
// being watched for, and through a completely different term.
//
// renewal-stability-check measures whether it runs away, with four controls.
// If the ratchet is real the remedy is probably a cap on annual declines —
// but that is the arm's call, not this file's.
// ============================================================================

import { closeInterval } from './membershipHistory';
import { memberExperienceMods } from './memberExperienceMod';
import type {
  CoverageLine, Member, MemberLossHistory, MembershipHistory,
} from '../types/simulation';

/**
 * The thresholds, on the RAW experience ratio. TWO LEVELS, plus Renew All.
 *
 * ASCENDING, and the UI renders them REVERSED — Renew All, 2.50, 2.00, which
 * is most lenient to most strict and is the direction New Business Appetite
 * reads. Ascending is right for a threshold list and wrong for a row of tiles;
 * the same split NEW_BUSINESS_TIERS makes, for the same reason.
 *
 * ⚠ TWO LEVELS RATHER THAN ONE, AND THE SECOND IS A DIFFERENT DECISION RATHER
 * THAN A FINER DIAL. This block used to argue for a single level on the
 * grounds that "renewal underwriting is a single question" and middle settings
 * reshape the book rather than manage it. The measurement below is what
 * overturns it: 2.50 and 2.00 are not two points on one dial, they are a
 * renewal decision and a roster decision, and the book effect tells them apart
 * by a factor of two and a half. Offering only the mild one hid the strict one
 * rather than protecting the player from it.
 *
 * ⚠ PICKED OFF THE MEASURED DISTRIBUTION, NOT CHOSEN FOR ROUNDNESS, AND THE
 * TABLE THIS REPLACES WAS BADLY STALE. Every absolute figure in the previous
 * version came off a mean book of 58; the live engine runs a mean book of 92
 * (WC) and 88 (GL) since the intake rebuild, so every count roughly doubled
 * while the shape survived. That is the second table in this control pair to
 * go stale the same way — see newBusinessAppetite.ts, which records the same
 * failure twice — so the BOOK SIZE is now stated beside the counts rather than
 * left implicit, because it is the term that moved.
 *
 * MEASURED NOW, 8 games x 14 years, warm years only, default decisions, per
 * line-year on a Renew All history (mean book: WC 91.6, GL 88.4):
 *
 *   threshold   WC declines/yr   GL declines/yr   line-years reading 0   max
 *      1.50        18.06            18.50            0% / 0%            28 / 34
 *      2.00         7.05             7.21            0% / 1%            12 / 17
 *      2.50         2.95             3.46            9% / 4%             7 /  8
 *      2.75         1.91             2.45           16% / 10%            5 /  7
 *      3.00         1.26             1.77             —                  —
 *
 * 2.50 declines about three members in a typical year — a renewal decision.
 * 2.00 declines about seven, which with the two-year cooldown is a policy that
 * reshapes the roster. Both are offered because both are things a player might
 * actually mean. 1.50 is not: eighteen a year out of ninety is not underwriting.
 *
 * ⚠ THE COUNT PER YEAR IS NOT THE COST, AND THE BOOK EFFECT IS THE NUMBER TO
 * JUDGE THESE BY. A decline carries a two-year cooldown, so holding a level
 * costs more than its yearly count. Measured with the threshold APPLIED for a
 * whole game (renewal-threshold-derive section 4, 6 games x 14 years, mean
 * enrolled, renewal off -> on):
 *
 *   level   WC book            GL book            declines/yr (WC / GL)
 *   2.50    90.6 -> 81.4  (-10.2%)   93.2 -> 80.4  (-13.7%)    1.10 / 1.58
 *   2.00    90.6 -> 67.5  (-25.5%)   93.2 -> 67.9  (-27.1%)    2.38 / 2.57
 *
 * So the strict level costs a QUARTER of the book and the mild one a tenth.
 * That is the trade the two tiles exist to put in front of the player, and one
 * tile could not show it.
 *
 * ⚠ AND GL RUNS HOTTER THAN WC AT BOTH LEVELS, WHICH IS NOT A RENEWAL
 * PROPERTY. GL loses more book on a very similar decline rate, so the
 * difference is in how fast each line's recruitment refills rather than in how
 * many members each declines. Recorded here because a reader comparing the two
 * lines will otherwise look for the cause in this file, and it is not in this
 * file.
 *
 * ⚠ THE DECLINE COUNT SHOWN ON THE SCREEN IS HIGHER THAN THE COUNT A HELD
 * LEVEL PRODUCES, AND BOTH ARE RIGHT. The screen counts against the CURRENT
 * book, which on a Renew All history is 2.95 (WC) and 3.46 (GL) per year at
 * 2.50. Once the level has been held for a few years the worst members are
 * gone and the rate settles near 1.10 / 1.58. The screen is not
 * over-promising; the book is improving, which is the mechanism working.
 *
 * ⚠ NO PERCENTAGE IN THE LABEL. The share at a threshold moves with the book,
 * so a static "declines ~3%" would go stale the first time the roster shifted
 * — which is exactly what happened to the table above. The UI renders the LIVE
 * count instead, which cannot.
 *
 * Kept as an array so a third level is a data change rather than a UI change,
 * and so the stability gate can keep reading the tightest shipped value.
 */
export const RENEWAL_THRESHOLDS = [2.00, 2.50] as const;

/** null = renew all. Otherwise the RAW-RATIO threshold above which a member is
 *  declined. */
export type RenewalThreshold = number | null;

export interface RenewalDecision {
  memberId: string;
  /** What the member actually cost, Ap/Ep, UNCLAMPED — and what the threshold
   *  was compared against. See THE BASIS in the header. */
  rawRatio: number;
  /** The same quantity under Mahler's rule 3. RECORDED, NOT RATED: it is what
   *  the member's BILL is computed from, so a reader reconciling a decline
   *  against a premium needs both. Nothing compares it. */
  clampedRatio: number;
}

/**
 * Which members this threshold would decline, on the book as it stands.
 *
 * PURE, and shared by the engine and the UI — the DecisionsPage renders the
 * count from this same function, so the number the player is shown is the
 * number they get rather than a second estimate of it.
 *
 * ⚠ UNRATED MEMBERS ARE NEVER DECLINED, AND THE GUARD IS `rated` RATHER THAN
 * THE RATIO. This mattered more when the comparison was on `clampedRatio`,
 * which is 1 on an unrated member — a filler, not a measurement, and one that
 * sits below every shipped threshold, so comparing it gave the right answer
 * for the wrong reason and would have started declining unrated members the
 * moment a threshold below 1.0 was offered. On the raw ratio the filler is
 * `null` and the guard is load-bearing rather than merely correct. A member
 * with fewer than EXPERIENCE_MOD.minYears of history has no experience to
 * decline them on, and Property — whose credibility measured 0.000 — has no
 * rated members at all, so no Property member can ever be declined.
 *
 * ⚠ IT COMPARES THE RAW RATIO — THE SAME NUMBER THE SCREEN SHOWS, AND THE SAME
 * NUMBER NEW BUSINESS APPETITE COMPARES. It used to compare `clampedRatio`
 * while New Business Appetite compared `rawRatio`, so one pool had two views of
 * the same quantity. See THE BASIS in the header for the measurement that
 * settled it, and for the larger gap that a reading cannot close.
 */
export function renewalDeclines(
  members: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
  yearNumber: number,
  threshold: RenewalThreshold,
): RenewalDecision[] {
  if (threshold === null || !(threshold > 0)) return [];
  const mods = memberExperienceMods(members, line, history, yearNumber);
  const out: RenewalDecision[] = [];
  for (const m of mods) {
    if (!m.rated || m.rawRatio === null) continue;
    if (m.rawRatio > threshold) {
      out.push({ memberId: m.memberId, rawRatio: m.rawRatio, clampedRatio: m.clampedRatio });
    }
  }
  return out;
}

/**
 * Apply the declines: remove them from the book and CLOSE THEIR INTERVAL.
 *
 * Mutates `membershipHistory`, which is the working clone processYear already
 * maintains — the same object openInterval and closeInterval are called on
 * for joins and withdrawals.
 */
export function applyRenewalDeclines(
  activeMembers: readonly Member[],
  line: CoverageLine,
  yearNumber: number,
  declines: readonly RenewalDecision[],
  membershipHistory: MembershipHistory,
): { retained: Member[]; declined: Member[] } {
  if (declines.length === 0) return { retained: [...activeMembers], declined: [] };
  const ids = new Set(declines.map(d => d.memberId));
  const retained: Member[] = [];
  const declined: Member[] = [];
  for (const m of activeMembers) {
    if (ids.has(m.id)) {
      declined.push({ ...m, status: 'withdrawn' as const, yearWithdrawn: yearNumber });
      // ⚠ lastActiveYear is yearNumber - 1: the decline takes effect at THIS
      // renewal, so the member's last covered year is the one just ended.
      // Same convention as a withdrawal, and it is what starts the two-year
      // cooldown from the right year.
      closeInterval(membershipHistory, m.id, line, yearNumber - 1);
    } else {
      retained.push(m);
    }
  }
  return { retained, declined };
}
