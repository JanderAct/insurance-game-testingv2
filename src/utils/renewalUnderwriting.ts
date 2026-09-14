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
 * The threshold, on the CLAMPED experience ratio. ONE LEVEL, plus Renew All.
 *
 * ⚠ ONE LEVEL RATHER THAN THREE, AND THE REASON IS THAT THE OTHER TWO WERE
 * NOT DECISIONS. Renewal underwriting is a single question — decline the
 * members who cost far more than they were expected to, or do not — and three
 * levels invited the player to tune a dial whose middle settings reshape the
 * book rather than manage it. Two boxes state the question.
 *
 * ⚠ PICKED OFF THE MEASURED DISTRIBUTION, NOT CHOSEN FOR ITS ROUNDNESS. From
 * renewal-threshold-derive.ts, 6 games x 14 years, warm years only, per
 * line-year on a mean book of 58:
 *
 *   threshold   WC declines/yr   GL declines/yr   line-years where it fires
 *      2.00        4.47              4.75              60/60, 59/60
 *      2.25        2.58              2.85              53/60, 56/60
 *      2.50        1.77              1.92              47/60, 48/60
 *      2.75        1.10              1.40              42/60, 43/60
 *      3.00        0.00              0.00               0/60  (see below)
 *
 * 2.50 is the level that declines a couple of members in a typical year — a
 * renewal decision. 2.00 runs at one member in twelve of the rated book, which
 * with the two-year cooldown becomes a policy that reshapes the roster. 2.75
 * does nothing at all in three years out of ten, and a control that is inert a
 * third of the time reads as broken rather than as strict.
 *
 * In plain terms the shipped level declines a member who has run more than
 * 2.5x their own expected primary loss over the window.
 *
 * ⚠ THE COUNT PER YEAR IS NOT THE COST, AND THE BOOK EFFECT IS THE NUMBER TO
 * JUDGE THIS BY. A decline carries a two-year cooldown, so holding the level
 * costs more than its yearly count. Measured with the threshold APPLIED for a
 * whole game (renewal-stability-check, 6 games x 14 years, mean enrolled,
 * renewal off -> on):
 *
 *   WC   53.9 -> 48.9   (-9.3%)     at 0.71-0.90 declines per year
 *   GL   60.3 -> 51.3   (-15.0%)    at 0.83-1.25 declines per year
 *
 * For scale, the retired mod-scale 1.10 took WC from 55.5 to 35.3 — a 36% cut,
 * which is a different pool rather than a renewal decision. This is under a
 * third of that.
 *
 * ⚠ AND GL RUNS HOTTER THAN WC FOR THE SAME THRESHOLD, WHICH IS NOT A RENEWAL
 * PROPERTY. GL loses 15% of its book against WC's 9% on a very similar decline
 * rate, so the difference is in how fast each line's recruitment refills rather
 * than in how many members each declines. Recorded here because a reader
 * comparing the two lines will otherwise look for the cause in this file, and
 * it is not in this file.
 *
 * ⚠ THE DECLINE COUNT SHOWN ON THE SCREEN IS HIGHER THAN THE COUNT A HELD
 * LEVEL PRODUCES, AND BOTH ARE RIGHT. The screen counts against the CURRENT
 * book, which on a Renew All history is 1.77 (WC) and 1.92 (GL) per year. Once
 * the level has been held for a few years the worst members are gone and the
 * rate settles near 0.85. The screen is not over-promising; the book is
 * improving, which is the mechanism working.
 *
 * ⚠ AND EVERY VALUE AT OR ABOVE THE CEILING IS UNREACHABLE. The comparison is
 * strictly-greater against `clampedRatio`, which cannot exceed
 * EXPERIENCE_MOD.ratioCeiling (3.0). So a threshold of 3.00 or above declines
 * nobody on any book, ever — not "rarely", never. That is why the table above
 * stops where it does, and it is the reason the shipped level has to sit below
 * the ceiling rather than near it.
 *
 * ⚠ NO PERCENTAGE IN THE LABEL. The share at a threshold moves with the book,
 * so a static "declines ~3%" would go stale the first time the roster
 * shifted. The UI renders the LIVE count instead, which cannot.
 *
 * Kept as an array so a second level is a data change rather than a UI change,
 * and so the stability gate can keep reading the tightest shipped value.
 */
export const RENEWAL_THRESHOLDS = [2.50] as const;

/** null = renew all. Otherwise the CLAMPED-RATIO threshold above which a
 *  member is declined. */
export type RenewalThreshold = number | null;

export interface RenewalDecision {
  memberId: string;
  /** What the member actually cost, Ap/Ep, UNCLAMPED. For display only. */
  rawRatio: number;
  /** What the threshold was compared against. */
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
 * THE RATIO. `clampedRatio` is 1 on an unrated member — a filler, not a
 * measurement — and 1 sits below every shipped threshold today, so comparing
 * it would give the right answer for the wrong reason and would start
 * declining unrated members the moment a threshold below 1.0 was offered. A
 * member with fewer than EXPERIENCE_MOD.minYears of history has no experience
 * to decline them on, and Property — whose credibility measured 0.000 — has no
 * rated members at all, so no Property member can ever be declined.
 *
 * ⚠ IT COMPARES THE CLAMPED RATIO WHILE THE SCREEN SHOWS THE RAW ONE, AND THE
 * DIVERGENCE IS DELIBERATE. The raw figure is what the member cost and a
 * reader has to be able to tell 3.2 from 11.0. The clamp is Mahler's rule 3
 * and exists to keep the quantity stable, which is exactly what a threshold
 * needs. The consequence, which the screen states rather than hides: a member
 * showing 5.48 and one showing 3.2 both clamp to 3.00 and are declined or
 * renewed together. Those are measured extremes rather than illustrations: the
 * raw ratio's observed maximum is 5.48 on WC and 6.12 on GL, and 1.4% of WC
 * rated member-years sit on the ceiling.
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
    if (m.clampedRatio > threshold) {
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
