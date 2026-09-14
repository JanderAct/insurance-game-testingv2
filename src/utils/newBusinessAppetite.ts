// ============================================================================
// NEW BUSINESS APPETITE — the pool declines to WRITE an applicant whose own
// experience ratio is above a threshold the player sets.
//
// The mirror of renewalUnderwriting.ts. That one decides who stays; this one
// decides who gets in. Both read the same quantity — actual primary loss over
// the applicant's own expected primary loss, over EXPERIENCE_MOD.windowYears —
// so the pool has ONE view of what "too expensive to write" means rather than
// two dials a player has to reconcile.
//
// ============================================================================
// HOW AN APPLICANT HAS A RATIO AT ALL, AND WHY THE FICTION MATTERS.
//
// The engine generates claims for ALL 200 canonical members every year,
// enrolled or not (simulationEngine.ts, the marketplace-wide generation block).
// Prospect claims feed nothing — no pool loss, no premium, no reserve — they
// exist solely as loss HISTORY so that an applicant arrives with a readable
// record instead of a blank one.
//
// ⚠ THE FICTION IS A LOSS RUN, AND IT IS NOT "THE POOL CAN SEE THE MARKET".
// An applicant hands the pool three years of their own claims experience
// BECAUSE THEY WANT TO JOIN. That is why the pool reads an applicant's ratio
// and not the marketplace's: it was GIVEN, not observed. A pool that could see
// every non-member's experience would be able to rank the entire marketplace
// and cherry-pick it, which is not underwriting and is not a thing any real
// pool can do. Anything built on this should preserve that asymmetry.
//
// ⚠ AND THE BASIS IS NOT THE SAME AS A MEMBER'S. Prospects generate at
// kLine/kGl = 1 with riskControlEffectiveness = 0, because k is the ENROLLED
// book's risk-quality-mix correction and risk control is a service members buy.
// So an applicant's ratio carries neither, and a member's carries both. The two
// numbers are close — measured medians 0.918 (prospects) against 0.958
// (members) on WC — but they are not the same measurement and the column says
// so rather than papering over it.
//
// ============================================================================
// RANDOM AMONG ELIGIBLE, NOT BEST-FIRST, AND THAT IS THE LOAD-BEARING CHOICE.
//
// When the cap binds, the intake is filled at random from those who CLEAR the
// tier. Best-first would collapse every tier into the cap: at "accept everyone"
// the pool would still take the best five applicants, so a tighter tier would
// change almost nothing and the control would be inert while looking live.
//
// Random is also how a pool actually underwrites — against a standard, one
// applicant at a time, in the order they arrive — rather than by ranking a
// queue it does not have.
//
// ⚠ THE FILTER RUNS BEFORE THE SHUFFLE AND THAT CHANGES THE DRAW. Shuffling a
// smaller pool consumes a different number of RNG draws, so any tier other than
// "accept everyone" diverges the stream from a default game. That is correct —
// it is a different decision — and it is why ACCEPT_ALL is represented as "do
// not filter" rather than as a threshold of Infinity that happens to admit
// everyone. A no-op filter that still rebuilt the array would move the draw on
// the default path and break both baselines for no behavioural reason.
// ============================================================================

import { memberExperienceMods } from './memberExperienceMod';
import type { CoverageLine, Member, MemberLossHistory } from '../types/simulation';

/**
 * The thresholds, on the applicant's RAW experience ratio.
 *
 * ⚠ RAW, NOT CLAMPED, AND THAT IS THE OPPOSITE OF RENEWAL'S CHOICE. Renewal
 * thresholds on the clamped ratio because a threshold wants stability and
 * because the member is already in the book — the clamp keeps a single
 * catastrophic year from making a renewal decision for you. An applicant is not
 * in the book, there is nothing to stabilise, and the clamp would make every
 * applicant above 3.0 identical at exactly the moment the pool is deciding
 * whether to take them at all. All three shipped tiers sit below the clamp
 * floor-to-ceiling range anyway, so on these values the two bases agree; the
 * distinction bites only if a tier above 3.0 is ever added, and it should not
 * be, because that tier would admit everyone.
 *
 * ⚠ PLACED AGAINST THE MEASURED APPLICANT DISTRIBUTION, not the member one.
 * From new-business-appetite-derive, 8 games x 14 years, share of rated
 * applicants each tier ACCEPTS:
 *
 *   tier    WC      GL
 *   0.75    36.9%   40.7%
 *   1.00    55.8%   57.1%
 *   1.50    82.4%   80.3%
 *   (none)  100%    100%
 *
 * Well spaced, and each means something a player can state: the best ~40%, the
 * better-than-expected half, everyone but the worst fifth, and everyone.
 *
 * ============================================================================
 * ⚠ WHAT THE TIER CHANGES — REBUILT, AND THE OLD ANSWER IS NOW WRONG.
 *
 * Before the intake rebuild this block recorded that the tier changed
 * composition and not count: the book read 58.8 / 58.2 / 58.4 / 58.1 across the
 * four arms and the strictest bar cost 0.16 members a year. The cause was that
 * every unenrolled member was treated as an applicant, so ~140 of them competed
 * for 4 slots and the bar could only ever choose WHICH ones the draw reached.
 *
 * With applications a 6% share of the unenrolled pool (APPLICATION_RATE),
 * measured over 8 games x 14 years:
 *
 *   tier         applicants/yr   eligible/yr   SHORT   joins/yr   final book
 *   Accept All        8.3            8.25        0%       2.61      59.9 / 57.9
 *   below 1.50        8.3            6.7         0%       2.54      58.1 / 59.1
 *   below 1.00        8.3            4.5        10%       2.53      58.0 / 58.8
 *   below 0.75        8.4            3.0        34%       2.15      52.9 / 54.6
 *
 * SHORT is a line-year where fewer applicants cleared the bar than the pool had
 * room for — the state that makes this a decision. It runs at zero for Accept
 * All and the permissive bar, one year in ten at the middle bar, and one in
 * three at the strict one, where the book ends 5-7 members below Accept All.
 *
 * So being picky now costs members, which is the trade the control is for. The
 * permissive bar still costs almost nothing, which is correct: 1.50 excludes
 * only the worst fifth of applicants and the pool rarely wanted four of them in
 * the same year anyway.
 * ============================================================================
 * ============================================================================
 */
export const NEW_BUSINESS_TIERS = [0.75, 1.00, 1.50] as const;

/** null = accept every applicant. Otherwise the raw-ratio threshold at or above
 *  which an applicant is not written. */
export type NewBusinessAppetite = number | null;

/**
 * Applicants this appetite would accept, from a candidate pool.
 *
 * PURE, and shared by the engine and the UI — the DecisionsPage renders its
 * counts from this same function, so the number shown is the number the player
 * gets rather than a second estimate of it. Same discipline as renewalDeclines.
 *
 * ⚠ AN UNRATED APPLICANT IS ACCEPTED, NOT REJECTED, AND IT IS THE SAME RULE AS
 * RENEWAL'S IN THE OTHER DIRECTION. An applicant with fewer than
 * EXPERIENCE_MOD.minYears of history cannot produce a three-year loss run, so
 * there is nothing to judge them on — and a pool that refused everyone it could
 * not rate would be selecting on record-keeping rather than on risk. Property
 * has no rated applicants at all (its credibility measured 0.000), so every
 * tier accepts everyone there and the control is inert on that line by
 * construction rather than by a branch.
 *
 * ⚠ ORDER IS PRESERVED. The caller shuffles; this must not reorder, or the
 * "random among eligible" property would depend on the order the marketplace
 * happens to be stored in.
 */
export function appetiteEligible(
  candidates: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
  yearNumber: number,
  appetite: NewBusinessAppetite,
): Member[] {
  if (appetite === null || !(appetite > 0)) return [...candidates];
  const mods = memberExperienceMods(candidates, line, history, yearNumber);
  const ratio = new Map<string, number | null>();
  for (const m of mods) ratio.set(m.memberId, m.rated ? m.rawRatio : null);
  return candidates.filter(c => {
    const r = ratio.get(c.id);
    return r === null || r === undefined || r < appetite;
  });
}
