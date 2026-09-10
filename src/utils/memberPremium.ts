// ============================================================================
// MEMBER-LEVEL PREMIUM ALLOCATION — WHAT EACH MEMBER'S SHARE OF THE LINE'S
// POOL PREMIUM IS, AT THEIR OWN CLASS RATE.
//
// ⚠ THIS IS THE FIRST PER-MEMBER PREMIUM IN THE MODEL. Before it, premium
// existed only as a line-level total — `poolPremium = activeExposure x
// rateAtConfidenceLevelPer100 x 10_000` — and no member was ever individually
// billed. So this introduces an allocation rather than modifying one, which is
// why nothing downstream can move when it lands.
//
// ============================================================================
// ALLOCATE, DO NOT RECOMPUTE — AND THE OBVIOUS IMPLEMENTATION IS THE ONE THAT
// BREAKS THE PROPERTY IT IS MEANT TO GUARANTEE.
//
// The blend is exposure-weighted, so in REAL arithmetic
//     sum_i(e_i . r_i)  ===  blend . sum_i(e_i)
// by the definition of `wcBlendedRatePer100`. It is not true in FLOATING POINT.
// Measured on the shipped roster at three book sizes:
//
//   members   pool from blend        from member sum        difference
//      40     $9,093,305.531494      $9,093,305.531494      1.863e-9
//      60     $13,335,144.892432     $13,335,144.892432     3.725e-9
//      80     $22,950,898.903706     $22,950,898.903706     7.451e-9
//
// About one ulp, and it GROWS WITH THE BOOK. That is comfortably enough for
// value-identity-check to fire — it caught 325 values at ~1e-12 at cc9d8ac and
// was right to.
//
// So the pool total is never recomputed here. It is passed in, already
// computed exactly as it was before this file existed, and split by WEIGHTS:
//
//     share_i = poolPremium . (e_i . r_i) / sum_j(e_j . r_j)
//
// Bit-identity of the pool total then holds BY CONSTRUCTION rather than by
// float luck, because the total is not on the arithmetic path at all. The
// weights need only sum to one, and any error in them redistributes BETWEEN
// members instead of changing what the pool collects.
//
// ============================================================================
// WHY WC HAS FOUR RATES AND THE OTHER TWO HAVE ONE, AND IT IS NOT AN OMISSION.
//
// Expected loss per $100 at neutral risk quality, by member type — measured
// over the shipped 200-member catalog:
//
//   WC         schools 1.3201 / county 2.9527 / lowSafety 4.0561 /
//              highSafety 5.8757, against a 3.7391 blend.  SPREAD 4.45x,
//              and the CV WITHIN each rating group is EXACTLY 0.0%.
//   GL         every one of the nine member types reads 5.6319.  SPREAD 1.00x.
//   Property   every one of the nine member types reads 0.0962.  SPREAD 1.00x.
//
// So WC's four rates fully describe its class structure — nothing is left
// inside a group — while GL and Property have no class structure to describe.
// A class rate on either would have to be INVENTED rather than derived, which
// is a loss-model change and not a pricing one. Both therefore take the flat
// branch below, and that branch is the degenerate case of the same formula
// rather than a special case of the code: with r_i constant, the weights
// collapse to exposure share exactly.
// ============================================================================

import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { deriveNeutralClassRatesPer100, ratingGroupOf } from './wcClaimEngine';
import { getMemberExposure } from './lineHelpers';
import type { CoverageLine, Member, MemberPremiumShare } from '../types/simulation';

// ⚠ DERIVED HERE AS WELL AS IN simulationEngine, AND THAT IS SAFE FOR ONE
// REASON ONLY: `deriveNeutralClassRatesPer100` is a pure function of the frozen
// member catalog, so the two derivations cannot disagree. It is still a second
// copy, so member-premium-check ASSERTS they agree rather than trusting the
// argument. The alternative — exporting the constant from simulationEngine —
// would make this module import the engine that imports it.
const WC_CLASS_RATES = deriveNeutralClassRatesPer100(getPredefinedMarketMembers());

/**
 * The member's own rating basis for this line, as a RELATIVE weight.
 *
 * ⚠ ONLY THE RATIO MATTERS AND THAT IS WHY THE HELD NEUTRAL RATES ARE USABLE
 * HERE. The level the pool actually charges carries the funding CLF, the
 * pricing adjustment and — when PRICING_TRIANGLE is on — a rate derived from
 * the pool's own triangle. None of that is in these numbers and none of it
 * needs to be: the level arrives with `poolPremium`, and this supplies only
 * how it is divided. A member's implied charged rate is therefore correct at
 * any rate level, any funding decision and on either flag arm.
 */
export function memberRateWeight(member: Member, line: CoverageLine): number {
  return line === 'WC' ? WC_CLASS_RATES[ratingGroupOf(member)] : 1;
}

/**
 * Split `poolPremium` across the enrolled book at each member's class rate.
 *
 * Returns one entry per member with positive exposure, in the order given.
 * A member with no exposure on this line is omitted rather than given a zero
 * row — they are not on this line's book and a zero premium would read as a
 * member who was charged nothing.
 *
 * ⚠ THE SHARES SUM TO poolPremium TO FLOAT TOLERANCE, NOT EXACTLY, and that is
 * the correct place for the residual to live. Forcing the last member to
 * absorb the rounding would make one arbitrary member's bill depend on
 * iteration order. member-premium-check asserts the sum against a relative
 * tolerance rather than against zero.
 */
export function allocateMemberPremium(
  members: readonly Member[],
  line: CoverageLine,
  yearNumber: number,
  poolPremium: number,
): MemberPremiumShare[] {
  const rows: Array<{ member: Member; exposure: number; weight: number }> = [];
  let totalWeight = 0;
  for (const m of members) {
    const exposure = getMemberExposure(m, line, yearNumber);
    if (!(exposure > 0)) continue;
    const weight = exposure * memberRateWeight(m, line);
    totalWeight += weight;
    rows.push({ member: m, exposure, weight });
  }
  if (!(totalWeight > 0)) return [];

  // The blend, for the relativity column: the exposure-weighted mean rate over
  // this ENROLLED book. Not the roster's blend — a pool that is unusually
  // schools-heavy has its own, and a relativity against the roster's would
  // report every member of such a pool as cheap.
  const totalExposure = rows.reduce((s, r) => s + r.exposure, 0);
  const blendWeight = totalWeight / totalExposure;

  return rows.map(r => ({
    memberId: r.member.id,
    exposure: r.exposure,
    premium: poolPremium * (r.weight / totalWeight),
    relativity: (r.weight / r.exposure) / blendWeight,
  }));
}
