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
 * ⚠ WHAT THE TIER ACTUALLY CHANGES — AND IT IS NOT HOW MANY MEMBERS JOIN.
 *
 * Measured over 8 games x 14 years with every other decision at default:
 *
 *   tier         WC mean book   joins/yr   eligible applicants   pool < cap
 *   Accept All       58.8         2.63           137                0%
 *   below 1.50       58.2         2.59           113                0%
 *   below 1.00       58.4         2.56            72                0%
 *   below 0.75       58.1         2.47            49                0%
 *
 * THE BOOK DOES NOT MOVE. The tightest tier costs 0.16 members a year of
 * intake — a 6% reduction — and leaves the book statistically where it started.
 *
 * The reason is the last column: the eligible pool NEVER falls below the cap.
 * Even at 0.75 there are 35-49 applicants clearing the standard against an
 * intake cap of 4, and the minimum ever seen across every game and year is 30.
 * So the tier is not rationing applicants. It is choosing WHICH applicants the
 * draw can reach, which is exactly what "random among eligible" was ruled to
 * do — the mechanism is working as designed, and the design's effect is on
 * composition rather than on count.
 *
 * ⚠ AND THE COMPOSITION EFFECT IS NOT RESOLVED AT THIS SAMPLE SIZE. Mean
 * exposure across the arms reads 506 / 548 / 508 / 473 $M on WC, which is not
 * monotone in tier strictness and therefore cannot be read as a selection
 * signal — 8 games does not separate it from year-to-year noise on books of
 * identical size. Anyone wanting the quality effect should measure the enrolled
 * book's own ratio distribution over many more games, not its exposure.
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
