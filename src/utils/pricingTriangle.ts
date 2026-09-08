// ============================================================================
// THE PRICING TRIANGLE — the pool's ten-year rolling history, PROJECTED.
//
// ⚠ DERIVED, NOT STORED. Every figure here is a pure function of
// LinePoolState.reserveDevelopment plus the roster and membership history, all
// of which the save already carries. `pricingTriangle` is therefore in
// SAVE_STRIPPED_KEYS and is rebuilt by processYear on the far side of a reload,
// exactly as LineResultSet.claims is rebuilt by claimRegeneration. Ruling 8's
// principle — store the inputs, not the output — applies unchanged, and it is
// why this commit adds no field the round trip has to carry or assert.
//
// ============================================================================
// ⚠ IT SEEDS FROM reserveDevelopment AND NOT FROM claimTriangle.ts. Ruled, and
// the reason is a clock mismatch: the generator compounds developmentDrift to
// each CLAIM's closure age, the engine to the COHORT's IBNER_HORIZON. Same
// cumulative by construction, different age-to-age shape, and a chain ladder
// over both averages a pattern no book produces. See claimTriangle.ts's header.
//
// Measured depth, mean rows per line, flagged arm, 8 games:
//
//   played year        0     1     2     3     4     6    10
//   WC               6.5   7.5   8.5   9.5  10.5  12.5  16.5    reaches 10 at year 4
//   GL               7.0   8.0   9.0  10.0  11.0  13.0  17.0    reaches 10 at year 3
//   Property         7.5   8.5   9.5  10.5  11.5  13.5  17.5    reaches 10 at year 3
//
// ⚠ THAT CORRECTS "SEVEN TO EIGHT ROWS, TEN WITHIN TWO OR THREE PLAYED YEARS",
// which is written in two headers from the previous commit. WC opens at 6.5 and
// takes FOUR played years, not two or three. The window is therefore short on
// every line for the first three years and shortest on WC — pricing runs on a
// partial window before it runs on a full one, which is a real property of the
// opening game rather than a warm-up to be hidden.
//
// ============================================================================
// THE WINDOW RULE — A FIXED TEN ACCIDENT YEARS. THE OLDEST DROPS, EVERY YEAR.
//
// ⚠ AND ON WC THAT RETIRES ACCIDENT YEARS THAT ARE STILL DEVELOPING. INTENDED.
// The alternative rule — drop what has run off — was considered and refused. A
// ratemaking window is ten years because that is the window, not because the
// claims inside it are finished. What sits beyond it is the unobserved tail,
// and estimating that tail is the problem this whole design is about; a window
// that waited for closure would hand the pool a triangle with no tail to
// estimate and no reason to prefer one method over another.
//
// The two rules pick different cells because reserveDevelopment is append-only
// and never prunes — WC seeded rows are still being valued at age 23.
//
// ⚠ THE ASYMMETRY IS THE MECHANISM, AND IT IS ONE LINE'S. Unpaid share of
// ultimate at the moment the window drops a year, value-weighted, flagged arm:
//
//   line       age 1    age 4    age 8   age 10   age 12
//   WC         54.8%    42.9%    29.7%    23.9%    18.3%
//   GL         79.1%    33.4%     3.9%     0.4%        -
//   Property   38.3%    14.1%     1.2%     0.2%        -
//
// So the window truncates roughly a QUARTER of WC's value and essentially none
// of GL's or Property's — a ratio of about 60x and 120x. GL develops violently
// and finishes early; WC develops mildly and finishes late. One line has a tail
// the pool must estimate and two do not, and that is the difference the method
// selection is supposed to be about.
//
// ⚠ THE 23.9% CORRECTS A FIGURE OF 43.6% CARRIED INTO THIS COMMIT'S BRIEF, and
// GL/Property read 0.4%/0.2% rather than 0.1%. The direction and the mechanism
// survive intact; the magnitude on WC is about half what was stated. Recorded
// because the window rule rests on it.
//
// ============================================================================
// ⚠ AGES ARE 1-BASED HERE AND 0-BASED IN reserveDevelopment. DELIBERATE, AND IT
// IS THE ONLY PLACE THE TWO CONVENTIONS MEET.
//
// A newly written accident year is registered with ageAtFirstValuation: 0, so
// at the end of its own year it sits at LEDGER AGE 0. A triangle's first
// development period is age 1 — twelve months — by every actuarial convention,
// and the acceptance test's condition 1 says "the played year is present at
// AGE 1". Both are right; they are different clocks. triangle age = ledger age
// + 1, converted here and nowhere else.
// ============================================================================

import { TRIANGLE_HISTORY_YEARS } from '../data/defaultAssumptions';
import { getMemberExposure } from './lineHelpers';
import { wasActiveInLine } from './membershipHistory';
import type {
  CoverageLine, Member, MembershipHistory, PricingTriangleState, ReserveDevelopmentRow,
} from '../types/simulation';

/** Everything the projection needs that the ledger does not carry. */
export interface TriangleBasis {
  allMarketMembers: Member[];
  membershipHistory: MembershipHistory;
}

/**
 * The newest `years` accident years, oldest first.
 *
 * ⚠ THIS IS CONDITION 2, AND IT IS THE ONLY GENUINELY NEW BEHAVIOUR IN THE
 * COMMIT. reserveDevelopment grows without bound — WC runs 8 rows to 22 over
 * fourteen years — so every consumer that wants a window has to take one. It is
 * a selection, never a mutation: the ledger keeps every row it ever had, because
 * the actuarial memorandum and the development exhibit are about the pool's
 * whole history and only PRICING is windowed.
 */
export function windowRows(
  rows: ReserveDevelopmentRow[], years: number = TRIANGLE_HISTORY_YEARS,
): ReserveDevelopmentRow[] {
  return [...rows]
    .sort((a, b) => a.yearNumber - b.yearNumber)
    .slice(-years);
}

/** The exposure enrolled in `line` in accident year `ay`, or 0 if unknowable. */
function exposureFor(basis: TriangleBasis, line: CoverageLine, ay: number): number {
  let e = 0;
  for (const m of basis.allMarketMembers) {
    if (!wasActiveInLine(basis.membershipHistory, m.id, line, ay)) continue;
    e += getMemberExposure(m, line, ay);
  }
  return e;
}

/**
 * Project the windowed triangle out of the ledger.
 *
 * `ratePer100` is NOT set here. The engine stamps it with the rate the window
 * actually produces, so condition 4 reads a rate the pool used rather than one
 * the harness recomputed — see the acceptance test's note on that distinction.
 *
 * ⚠ THE STAMP IS A RETAINED RATE. It is chain-laddered off ReserveDevelopmentRow,
 * whose ultimate and paid series are both NET of reinsurance, so it is a
 * retained loss cost and not the gross rate the engine applies. The engine
 * grosses it up before pricing (see grossUpRetainedPurePremium) so the
 * net-funding step removes cession once rather than twice. What comes back out
 * of that round trip is the stamp again — so it is `netPurePremiumPer100` that
 * equals this, not `purePremiumPer100`, and condition 4 compares against that.
 */
export function projectPricingTriangle(
  line: CoverageLine,
  rows: ReserveDevelopmentRow[],
  basis: TriangleBasis,
  years: number = TRIANGLE_HISTORY_YEARS,
): PricingTriangleState {
  const windowed = windowRows(rows, years);
  const cells = [];
  const exposureByYear: Record<string, number> = {};
  for (const r of windowed) {
    const u = r.ultimateByValuation ?? [];
    const p = r.paidByValuation ?? [];
    const a0 = r.ageAtFirstValuation ?? 0;
    for (let k = 0; k < u.length; k++) {
      if (!(u[k] > 0)) continue;
      cells.push({
        accidentYear: r.yearNumber,
        age: a0 + k + 1,                     // 1-based; see the header
        incurred: u[k],
        paid: p[k] ?? 0,
      });
    }
    // ⚠ SEEDED YEARS HAVE NO RECONSTRUCTABLE EXPOSURE and are recorded as 0
    // rather than omitted. They are apportioned from a drawn reserve total and
    // membershipHistory holds no enrolment intervals for them, so a fabricated
    // figure would be worse than a zero a reader can see. They still carry
    // age-to-age FACTORS, which need no exposure — experienceRating.ts's
    // constraint 2, and the reason a three-accident-year book is workable.
    exposureByYear[String(r.yearNumber)] = exposureFor(basis, line, r.yearNumber);
  }
  return { years, cells, exposureByYear };
}
