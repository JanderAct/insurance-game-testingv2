// ============================================================================
// RENEWAL UNDERWRITING — the pool declines to renew a member whose displayed
// experience modifier is above a threshold the player sets.
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
import { displayedMod, medianRatedMod, memberExperienceMods } from './memberExperienceMod';
import type {
  CoverageLine, Member, MemberLossHistory, MembershipHistory,
} from '../types/simulation';

/**
 * The threshold levels, on the DISPLAYED (median-centred) modifier.
 *
 * ⚠ ON THE DISPLAYED SCALE, NOT THE CHARGED ONE, BECAUSE THAT IS THE NUMBER
 * THE PLAYER IS LOOKING AT. The displayed mod is centred so 1.00 is the
 * typical member; a threshold of 1.15 therefore means "decline members
 * charged more than 15% above typical" in every book, whatever the charged
 * mod's own mean happens to be that year.
 *
 * The levels are placed against the measured distribution — WC p75 1.056,
 * p90 1.109, p95 1.148 — so 1.25 is a rare intervention, 1.15 catches roughly
 * one member in twenty and 1.10 roughly one in ten.
 *
 * ⚠ NO PERCENTAGE IN THE LABEL. The share at a threshold moves with the book,
 * so a static "declines ~5%" would go stale the first time the roster
 * shifted. The UI renders the LIVE count instead, which cannot.
 */
export const RENEWAL_THRESHOLDS = [1.25, 1.15, 1.10] as const;

/** null = renew all. Otherwise the displayed-mod threshold above which a
 *  member is declined. */
export type RenewalThreshold = number | null;

export interface RenewalDecision {
  memberId: string;
  displayedMod: number;
}

/**
 * Which members this threshold would decline, on the book as it stands.
 *
 * PURE, and shared by the engine and the UI — the DecisionsPage renders the
 * count from this same function, so the number the player is shown is the
 * number they get rather than a second estimate of it.
 *
 * ⚠ UNRATED MEMBERS ARE NEVER DECLINED AND NEED NO SPECIAL CASE. displayedMod
 * returns null for them, and null is not above any threshold. A member with
 * fewer than three years of history has no experience to decline them on, and
 * Property — whose credibility measured 0.000 — has no rated members at all.
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
  const median = medianRatedMod(mods);
  const out: RenewalDecision[] = [];
  for (const m of mods) {
    const d = displayedMod(m, median);
    if (d !== null && d > threshold) out.push({ memberId: m.memberId, displayedMod: d });
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
