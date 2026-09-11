// ============================================================================
// THE MEMBER EXPERIENCE MODIFIER — a member's own losses move their share of
// the line's premium, and move NOTHING else.
//
// mod_i = 1 + Z . ( clamp(Ap_i / Ep_i, floor, ceiling) / M - 1 )
//
//   Ap_i  the member's PRIMARY actual over the rolling window: the sum of
//         min(claim, EXPERIENCE_SPLIT_POINT), recorded by the claim engines.
//   Ep_i  the expected primary on the same basis — expectedAtManual scaled by
//         the member's own primary SHARE, recomputed from the engine.
//   M     the exposure-weighted mean of the clamped ratio over the rated
//         book, so the exposure-weighted mean mod is exactly 1 (the REBASE).
//   Z     credibility, per line.
//
// ============================================================================
// WHY PRIMARY ONLY, AND WHY NOTHING IS DISCARDED.
//
// This follows Mahler (1996 CAS Ratemaking Seminar), who ran the same
// experiment on 250 simulated risks: claim COUNTS fitted 0.780 credibility,
// DOLLARS 0.515, dollars CAPPED at $25,000 0.714. Dollars introduce random
// fluctuation and credibility falls; limiting them brings it back. Measured
// on this engine, the same shape, split-half reliability of the three-year
// ratio on WC:
//
//   whole loss                          0.052
//   primary layer at a $25k split       0.155
//
// THE EXCESS LAYER IS STILL RECORDED AND IS STILL THE MEMBER'S LOSS. It is
// `actual - primaryActual`, available to anything that wants to show it. It
// is simply not RATED, and that is a measurement rather than a simplification:
//
//   line   rank vs true RQ, primary-only   with the excess layer added
//   WC              0.2754                        0.2684   (-0.0070)
//   GL              0.2601                        0.2419   (-0.0182)
//
// Adding the excess layer made the modifier WORSE on both lines that have any
// signal. Its split-half reliability is ~0.05 on WC and its rank stability
// turns out to be mostly member SIZE — a large member breaches $25k every
// year and a small one never does, which repeats beautifully and says nothing
// about risk quality. So the honest design is primary-only with excess
// reported and not rated, and that was measured into rather than assumed.
//
// ============================================================================
// ⚠ THE EXPECTED PRIMARY IS PER RATING GROUP. A POOLED SHARE IS HALF CLASS
// BIAS AND WAS MEASURED AND REJECTED.
//
// The primary SHARE differs sharply by class, because classes differ in how
// many small claims they generate. Measured at a $25k split on WC:
//
//   schools 33.3%   county 17.4%   lowSafety 16.4%   highSafety 16.2%
//
// Schools run double the others. Divide every member by ONE pooled share and
// every school district carries a ratio above 1 in every window — a stable,
// member-specific offset that inflates split-half reliability while carrying
// no risk quality at all. Measured, pooled against per-group:
//
//   Zp                 0.299  ->  0.155     (half of it was class)
//   rank vs true RQ    0.275  ->  0.332     (and removing it HELPS)
//
// The reliability fell and the ranking power rose, which is exactly the
// signature of a stable-but-irrelevant offset being removed. So the share is
// computed from the engine for the member's own class and year, never pooled.
//
// ============================================================================
// CREDIBILITY: WC 0.15, GL 0.075, PROPERTY 0. MEASURED, NOT CHOSEN.
//
// Split-half reliability of the three-year primary ratio over DISJOINT
// windows for the same member, 10 games x 18 years, class bias removed:
//
//   line       Zp at $10k   $25k    $50k
//   WC            0.193     0.155   0.131
//   GL            0.045     0.076   0.102
//   Property      0.000     0.000   0.000
//
// ⚠ PROPERTY IS NOT RATED AT ALL, and that is the measurement's verdict
// rather than a policy. Its primary-layer reliability is 0.000 at every split
// point tried — it averages 1.9 claims per three-year window, which is not a
// sample. Property members therefore carry mod exactly 1. The previous
// single-layer design gave Property a +/-3% mod built on a credibility the
// data never supported; that is withdrawn here.
//
// ⚠ AND MAHLER'S OWN TOLERANCE RESULT APPLIES TO THE GAP BETWEEN ESTIMATORS,
// WHICH IS WHY THERE IS NO OPEN QUESTION HERE TO GO AND SETTLE.
//
// The procedure is forgiving of small errors in the weights: changes in K
// under a factor of two produce small changes in credibility. The two
// estimators of Z used on this project — split-half reliability and a
// Buhlmann VHM/(VHM+EVPV) decomposition — differed by well under that on the
// old whole-loss basis (0.0673 against 0.0412) and the implied Ks differ by
// less than a factor of two. So the spread is NOT a discrepancy to resolve
// before shipping, and a reader who finds those two numbers side by side
// should not spend a commit reconciling estimators whose difference the
// method is insensitive to. Spend it on more games instead, which is the
// thing that would actually move either.
//
// ============================================================================
// SIZE GRADING IS NOT SHIPPED, AND THE DATA IS WHY.
//
// NCCI grades credibility with the risk's expected losses, Z = E/(E+K). The
// direction is right here — small members are less credible — but the FORM is
// not supported. Measured on the corrected basis, WC at a $25k split, by
// expected-loss quintile:
//
//   E        $0.12M   $0.26M   $0.43M   $0.73M   $2.14M
//   Zp       -0.019    0.151    0.302    0.194    0.383
//   K            -     $1.5M    $1.0M    $3.0M    $3.5M
//
// If Z = E/(E+K) held, K would be roughly constant. It swings by 3.5x and is
// not even monotone (Q3 above Q4), and GL and Property go negative in their
// small quintiles. Fitting a K here would be fitting noise, and by Mahler's
// own factor-of-two tolerance the flat-Z simplification costs little. Revisit
// with more games, not with a fitted constant.
//
// ============================================================================
// THE 0.5-3.0 CLAMP IS MAHLER'S RULE 3, AND IT IS ENDORSED RATHER THAN
// TOLERATED.
//
// Mahler (1996 CAS Ratemaking Seminar), rule 3: cap the changes in
// relativities — it adds stability and may improve accuracy by eliminating
// extremes. So this is the recommended treatment, not a crude stand-in for
// something better, and it should not be removed on the grounds that a
// "proper" credibility procedure would not need it.
//
// Measured here it does a second job as well: it is what makes Pearson
// reliability estimable at all. The raw ratio has a mean of 1.03 against a
// median of 0.395, and on that distribution a single outlier pair drives the
// split-half correlation NEGATIVE — every uncapped column measured below
// zero. Clamp first, then measure.
//
// ============================================================================
// WHAT THIS MUST NEVER REACH, AND WHY EACH ONE WOULD BE A DEFECT.
//
//   RETENTION AND RECRUITMENT. Member premium -> who stays -> the enrolled mix
//     -> the blended rate -> the pool rate is a feedback loop the pool does
//     not have and must not acquire by accident.
//
//   PRICING. The pool's rate is derived at NEUTRAL risk quality, deliberately.
//     A modifier feeding back into the rate would be finding 17 arriving
//     through underwriting: a realized outcome repricing the line instead of
//     moving money between members.
//
//   THE POOL TOTAL. This is an ALLOCATION. It changes who pays, never how
//     much is collected, and that holds by construction because the mod
//     enters as a WEIGHT in allocateMemberPremium and weights are normalised.
//
// ⚠ AND IT MUST NOT READ THE CURRENT YEAR'S OWN LOSSES. It does not, and the
// property is structural: processYear records the year into the ledger AFTER
// processLineYear has returned, so the clone this reads ends at
// yearNumber - 1. member-experience-mod-check's lookahead assertion holds it.
// ============================================================================

import {
  EXPERIENCE_SPLIT_POINT, EXPERIENCE_WINDOW_YEARS, experienceWindow,
} from './memberLossHistory';
import { getMemberExposure } from './lineHelpers';
import { expectedWcGrossLossForPricing, NEUTRAL_RQ as WC_NEUTRAL_RQ, ratingGroupOf } from './wcClaimEngine';
import { expectedGlGrossLossForPricing, NEUTRAL_RQ as GL_NEUTRAL_RQ } from './glClaimEngine';
import type { CoverageLine, Member, MemberLossHistory } from '../types/simulation';

export const EXPERIENCE_MOD = {
  /** Years of history read. Reliability peaks here — 5 is no better. */
  windowYears: EXPERIENCE_WINDOW_YEARS,
  /** Mahler's rule 3. See the header. */
  ratioFloor: 0.5,
  ratioCeiling: 3.0,
  /** Years of history a member needs before they are rated at all. */
  minYears: EXPERIENCE_WINDOW_YEARS,
} as const;

/**
 * Credibility on the PRIMARY layer, per line. MEASURED RELIABILITIES — read
 * the header before changing one. Property is 0 because its measured
 * reliability is 0, not because it is switched off.
 */
export const CREDIBILITY_Z: Record<CoverageLine, number> = {
  WC: 0.15,        // measured 0.155 at a $25k split, class bias removed
  GL: 0.075,       // measured 0.076
  Property: 0,     // measured 0.000 at every split point tried
};

export interface MemberExperienceMod {
  memberId: string;
  yearsOfHistory: number;
  rated: boolean;
  /** Primary actual over the window. */
  primaryActual: number;
  /** Expected primary over the window, on the member's own class basis. */
  primaryExpected: number;
  /** The excess layer, recorded and NOT rated. */
  excessActual: number;
  /** Ap/Ep before the clamp. null when unrated. */
  rawRatio: number | null;
  clampedRatio: number;
  mod: number;
}

// ---------------------------------------------------------------------------
// THE PRIMARY SHARE, E[min(X,D)] / E[X], FOR ONE MEMBER IN ONE YEAR.
//
// ⚠ INVARIANT TO k, EXPOSURE AND LAMBDA, WHICH IS WHY IT NEED NOT BE STORED.
// Both legs are the same expectation with the same frequency and the same
// class; only the per-claim ceiling differs, so every scale factor cancels.
// What it DOES depend on is the rating group and the year's severity trend,
// which is exactly why it is computed per member per year rather than pooled.
//
// Memoized on (line, group, year) because it is identical for every member of
// a rating group — the within-group rate CV is exactly 0.0%, so members of a
// group share a mixture and therefore share a share.
// ---------------------------------------------------------------------------
const shareCache = new Map<string, number>();

export function primaryShare(member: Member, line: CoverageLine, yearNumber: number): number {
  if (line === 'Property') return 0;   // never rated; see the header
  const key = `${line}|${line === 'WC' ? ratingGroupOf(member) : '-'}|${yearNumber}`;
  const hit = shareCache.get(key);
  if (hit !== undefined) return hit;

  let share = 0;
  if (line === 'WC') {
    const total = expectedWcGrossLossForPricing([member], { yearNumber, riskQualityOverride: WC_NEUTRAL_RQ });
    const primary = expectedWcGrossLossForPricing([member], {
      yearNumber, riskQualityOverride: WC_NEUTRAL_RQ, severityLimit: EXPERIENCE_SPLIT_POINT,
    });
    share = total > 0 ? primary / total : 0;
  } else {
    const total = expectedGlGrossLossForPricing([member], { yearNumber, riskQualityOverride: GL_NEUTRAL_RQ });
    const primary = expectedGlGrossLossForPricing([member], {
      yearNumber, riskQualityOverride: GL_NEUTRAL_RQ, severityLimit: EXPERIENCE_SPLIT_POINT,
    });
    share = total > 0 ? primary / total : 0;
  }
  shareCache.set(key, share);
  return share;
}

/**
 * The modifier for every member on this line's book.
 *
 * ⚠ THE REBASE IS OVER THE RATED SUBSET AND UNRATED MEMBERS SIT AT EXACTLY 1,
 * which is what makes the exposure-weighted mean over the WHOLE book equal 1
 * as well: the rated part averages 1 by construction and the unrated part is
 * 1 identically.
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
    ap: number; ep: number; ax: number; raw: number | null; clamped: number;
  }> = [];

  let weighted = 0, totalExposure = 0;
  for (const m of members) {
    const exposure = getMemberExposure(m, line, yearNumber);
    if (!(exposure > 0)) continue;

    const w = experienceWindow(history, m.id, line, windowYears);
    let ap = 0, ax = 0, ep = 0;
    for (const e of w) {
      ap += e.primaryActual;
      ax += e.actual - e.primaryActual;
      // The share is taken at the entry's OWN year, not this year's — the
      // severity trend moves it, and a window spans three of them.
      ep += e.expectedAtManual * primaryShare(m, line, e.yearNumber);
    }

    // Unrated: too little history, an expectation of zero to divide by, or a
    // line the measurement says carries no signal (Z = 0).
    if (Z <= 0 || w.length < minYears || !(ep > 0)) {
      rows.push({ memberId: m.id, exposure, years: w.length, ap, ep, ax, raw: null, clamped: 1 });
      continue;
    }

    const raw = ap / ep;
    const clamped = Math.min(ratioCeiling, Math.max(ratioFloor, raw));
    rows.push({ memberId: m.id, exposure, years: w.length, ap, ep, ax, raw, clamped });
    weighted += exposure * clamped;
    totalExposure += exposure;
  }

  // The rebase divisor, over the RATED subset only. The floor guarantees every
  // clamped ratio is at least ratioFloor, so this is >= ratioFloor > 0
  // whenever anything is rated.
  const M = totalExposure > 0 ? weighted / totalExposure : 1;

  return rows.map(r => ({
    memberId: r.memberId,
    yearsOfHistory: r.years,
    rated: r.raw !== null,
    primaryActual: r.ap,
    primaryExpected: r.ep,
    excessActual: r.ax,
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
