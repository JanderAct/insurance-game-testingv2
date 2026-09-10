// ============================================================================
// THE MEMBER EXPERIENCE MODIFIER — a member's own losses move their share of
// the line's premium, and move NOTHING else.
//
// mod_i = 1 + Z . ( clamp(A_i / E_i, floor, ceiling) / M - 1 )
//
//   A_i  actual loss over the rolling window, from the ledger
//   E_i  expectedAtManual over the same window — the expectation at NEUTRAL
//        risk quality. NOT expectedAtOwnRq: dividing by an expectation that
//        already carries the member's own risk quality removes the very thing
//        the modifier exists to discover. See memberLossHistory.ts and
//        member-experience-basis-check.
//   M    the exposure-weighted mean of the clamped ratio over the rated book,
//        so the exposure-weighted mean mod is exactly 1 (the REBASE).
//   Z    credibility.
//
// ============================================================================
// ⚠ THE CREDIBILITY THE DATA SUPPORTS IS 0.02-0.07, AND AT THAT CREDIBILITY
// THIS MECHANIC IS COSMETIC. READ THIS BEFORE RAISING Z.
//
// Credibility is reliability: the share of a member's observed ratio that is
// repeatable signal rather than luck. Measured two independent ways, 12 games
// x 18 years, on DISJOINT three-year windows for the same member:
//
//   line       split-half r(w1,w2)   Buhlmann VHM/(VHM+EVPV)
//   WC              0.0673                0.0412
//   GL              0.0202                0.0151
//   Property        0.0398                0.0288
//
// The two estimators agree, so the number is not an artefact of either. The
// shipped Z is the midpoint, rounded: WC 0.05, GL 0.02, Property 0.03.
//
// ⚠ AND THE RATIO IS NOT BROKEN — IT IS JUST NOISY, WHICH IS A DIFFERENT
// PROBLEM WITH A DIFFERENT FIX. An observed quantity cannot correlate with
// any stable trait above sqrt(its reliability). Measured against true risk
// quality at three years, the ratio's ranking power lands essentially ON that
// ceiling:
//
//   line      ranking power   sqrt(reliability)
//   WC            0.232             0.259
//   GL            0.144             0.142
//   Property      0.110             0.200
//
// So almost ALL of the repeatable signal in a member's loss ratio is their
// risk quality. The modifier is reading the right thing. There is simply very
// little of it in three years of one member's claims.
//
// ⚠ AND THE CAUSE IS SEVERITY, NOT CLAIM COUNT — which matters because the
// two have different fixes. Measured on the enrolled book, claims per member
// per year: WC 7.99, GL 4.61, Property 0.59. So a WC member brings about 24
// claims to a three-year window, which is not a small sample. The noise is in
// how much those claims cost: the severity mixture is heavy enough that one
// large loss still dominates the window, which is why the ratio's mean is
// 1.03 while its median is 0.395. More years would not fix that either — see
// the window measurement below.
//
// ⚠ SO: Z=0.05 ON WC GIVES A MOD BAND OF ABOUT -2.4% TO +11%, AND THE MEDIAN
// MEMBER MOVES BY UNDER 1%. That is not a decision a player can act on. To
// make it one you would need Z around 0.25, which is five times what the data
// supports and would price members mostly on luck. THAT IS A GAME-DESIGN
// CHOICE AND IT IS NOT MADE HERE. If it is made, change CREDIBILITY_Z and say
// in the commit that the mod is deliberately over-credible; do not reach for
// it by adjusting the window or the cap, which have both been measured and
// are already at their best settings.
//
// ⚠ AND MORE YEARS IS NOT THE ANSWER, WHICH IS THE MEASUREMENT THAT SETTLES
// THE WINDOW. Reliability by window length on WC: 0.011 at one year, 0.0673
// at three, 0.0513 at five. It PEAKS at three and five is worse, on all three
// lines (GL 0.008 / 0.020 / 0.013, Property -0.005 / 0.040 / -0.001). So the
// three-year window is not a compromise between recency and credibility — it
// is the best available on this engine, and the ledger's five-year retention
// is not a credibility reserve waiting to be spent.
//
// What would earn a higher Z honestly: a loss model with a larger persistent
// per-member component than risk quality alone provides, or a severity
// distribution the pool can flatten before rating on it.
//
// ============================================================================
// THE CAP IS ON THE RATIO, NOT ON LOSSES, AND THE FLOOR IS THE EXPENSIVE HALF.
//
// Capping losses would need a capped EXPECTATION under it or every member
// gets a ~50% credit; capping the RATIO needs no second field and the ledger
// stays at three numbers. Measured, ranking power against true risk quality
// at a three-year window, ceiling 3.0:
//
//   floor    WC      GL      Property   % of WC members tied at the floor
//   0.00    0.253   0.169     0.093              1%
//   0.25    0.246   0.160     0.117             36%
//   0.40    0.237   0.149     0.111             49%
//   0.50    0.232   0.144     0.110             55%
//   0.60    0.224   0.134     0.102             60%
//   0.75    0.209   0.122     0.108             67%
//
// The floor costs monotonically on WC and GL and it is not free: 0.5 ties 55%
// of the book at one value and gives up 8% of WC's ranking power, 15% of
// GL's. It is kept anyway because its job is not ranking — it is bounding how
// much credit luck can buy, and it also guarantees M >= floor > 0 so the
// rebase can never divide by zero.
//
// ⚠ THE CEILING IS FREE AND THE MEASUREMENT SAYS SO. Ranking power at
// ceilings of 2 / 3 / 5 / 10 / none reads 0.253 / 0.253 / 0.253 / 0.253 /
// 0.253 on WC at three years — identical to three decimals, because the
// members it ties were already at the top of the rank order. So the ceiling
// costs nothing and can be set on what the pool is willing to charge rather
// than on what the statistic can bear.
//
// ============================================================================
// WHAT THIS MUST NEVER REACH, AND WHY EACH ONE WOULD BE A DEFECT.
//
//   RETENTION AND RECRUITMENT. Member premium -> who stays -> the enrolled mix
//     -> the blended rate -> the pool rate is a feedback loop the pool does
//     not have and must not acquire by accident. member-premium-check's
//     assertion 4 holds this for the class rates; member-experience-mod-check
//     holds it for the mod, by the same perturb-and-compare method.
//
//   PRICING. The pool's rate is derived at NEUTRAL risk quality, deliberately
//     (the cross-subsidy across risk quality is intentional — see the
//     wcClaimEngine header). A modifier feeding back into the rate would be
//     finding 17 arriving through underwriting: a realized outcome repricing
//     the line instead of moving money between members.
//
//   THE POOL TOTAL. This is an ALLOCATION. It changes who pays, never how
//     much is collected, and that holds by construction because the mod
//     enters as a WEIGHT in allocateMemberPremium and weights are normalised.
//     Same allocate-don't-recompute discipline as the class rates.
//
// ⚠ AND IT MUST NOT READ THE CURRENT YEAR'S OWN LOSSES. It does not, and the
// property is structural rather than guarded: processYear records the year
// into the ledger AFTER processLineYear has returned, so the clone this reads
// ends at yearNumber - 1. Pricing year N off years N-3..N-1 is the point; if
// recording ever moves ahead of processLineYear, the mod starts pricing off
// the answer and member-experience-mod-check's lookahead assertion goes red.
// ============================================================================

import { EXPERIENCE_WINDOW_YEARS, experienceWindow } from './memberLossHistory';
import { getMemberExposure } from './lineHelpers';
import type { CoverageLine, Member, MemberLossHistory } from '../types/simulation';

export const EXPERIENCE_MOD = {
  /** Years of history read. Reliability peaks here — see the header. */
  windowYears: EXPERIENCE_WINDOW_YEARS,
  /** Ratio clamp. The floor bounds how much credit luck can buy and keeps the
   *  rebase divisor positive; the ceiling is free in ranking terms. */
  ratioFloor: 0.5,
  ratioCeiling: 3.0,
  /** Years of history a member needs before they are rated at all. A member
   *  with less gets mod exactly 1 — not a partial-window ratio, because a
   *  one-year ratio has a measured reliability of 0.011 on WC and would be
   *  charging members for noise while calling it experience. */
  minYears: EXPERIENCE_WINDOW_YEARS,
} as const;

/**
 * Credibility, per line. THESE ARE MEASURED RELIABILITIES, NOT TUNING KNOBS —
 * see the header before changing one. Raising them does not make the mod more
 * accurate, it makes it more confident about noise.
 */
export const CREDIBILITY_Z: Record<CoverageLine, number> = {
  WC: 0.05,        // split-half 0.0673, Buhlmann 0.0412
  GL: 0.02,        // split-half 0.0202, Buhlmann 0.0151
  Property: 0.03,  // split-half 0.0398, Buhlmann 0.0288
};

export interface MemberExperienceMod {
  memberId: string;
  /** Years actually found in the window. Below EXPERIENCE_MOD.minYears the
   *  member is unrated and `mod` is exactly 1. */
  yearsOfHistory: number;
  rated: boolean;
  /** A/E on the manual basis, before the clamp. null when unrated. */
  rawRatio: number | null;
  /** After the clamp, before the rebase. 1 when unrated. */
  clampedRatio: number;
  mod: number;
}

/**
 * The modifier for every member on this line's book.
 *
 * ⚠ THE REBASE IS OVER THE RATED SUBSET AND UNRATED MEMBERS SIT AT EXACTLY 1,
 * which is what makes the exposure-weighted mean over the WHOLE book equal 1
 * as well: the rated part averages 1 by construction and the unrated part is
 * 1 identically. Rebasing over everyone instead would push the rated members
 * off-centre to compensate for members who are not being rated at all.
 */
export function memberExperienceMods(
  members: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
  yearNumber: number,
): MemberExperienceMod[] {
  const { windowYears, ratioFloor, ratioCeiling, minYears } = EXPERIENCE_MOD;
  const Z = CREDIBILITY_Z[line] ?? 0;

  const rows: Array<{
    memberId: string; exposure: number; years: number;
    raw: number | null; clamped: number;
  }> = [];

  let weighted = 0, totalExposure = 0;
  for (const m of members) {
    const exposure = getMemberExposure(m, line, yearNumber);
    if (!(exposure > 0)) continue;

    const w = experienceWindow(history, m.id, line, windowYears);
    let actual = 0, expected = 0;
    for (const e of w) { actual += e.actual; expected += e.expectedAtManual; }

    // Unrated: too little history, or an expectation of zero to divide by.
    // The second is not hypothetical — a member can carry exposure this year
    // and have had none in an earlier window year.
    if (w.length < minYears || !(expected > 0)) {
      rows.push({ memberId: m.id, exposure, years: w.length, raw: null, clamped: 1 });
      continue;
    }

    const raw = actual / expected;
    const clamped = Math.min(ratioCeiling, Math.max(ratioFloor, raw));
    rows.push({ memberId: m.id, exposure, years: w.length, raw, clamped });
    weighted += exposure * clamped;
    totalExposure += exposure;
  }

  // The rebase divisor, over the RATED subset only. The floor guarantees every
  // clamped ratio is at least ratioFloor, so this is >= ratioFloor > 0
  // whenever anything is rated — the guard below is for the all-unrated book.
  const M = totalExposure > 0 ? weighted / totalExposure : 1;

  return rows.map(r => ({
    memberId: r.memberId,
    yearsOfHistory: r.years,
    rated: r.raw !== null,
    rawRatio: r.raw,
    clampedRatio: r.clamped,
    mod: r.raw === null ? 1 : 1 + Z * (r.clamped / M - 1),
  }));
}

/** The mod band this configuration can produce on a line, given a rebase
 *  divisor M. Reported by the gate rather than asserted as a constant,
 *  because M moves with the book. */
export function modBounds(line: CoverageLine, M: number): { lo: number; hi: number } {
  const Z = CREDIBILITY_Z[line] ?? 0;
  return {
    lo: 1 + Z * (EXPERIENCE_MOD.ratioFloor / M - 1),
    hi: 1 + Z * (EXPERIENCE_MOD.ratioCeiling / M - 1),
  };
}
