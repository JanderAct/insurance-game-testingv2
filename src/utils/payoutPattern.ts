// ============================================================================
// PAYOUT PATTERNS — HOW FAST EACH LINE'S LOSSES ACTUALLY SETTLE.
//
// Replaces a single geometric paydown rate per line (LINE_RESERVE_PAYDOWN_PCT)
// plus a shared first-year split (IBNER_OPEN_FRACTION). Both are retired; see
// LINE_PAYOUT_PATTERN in defaultAssumptions.ts for the parameters and where
// they came from.
//
// ============================================================================
// ⚠ A FORMULA AND NOT AN ARRAY, AND THE REASON IS WC'S TAIL.
//
// An array would need a rule for what happens past its last entry, and that is
// exactly where the interesting behaviour is. Measured from the fitted
// parameters, the share of the REMAINING balance each line pays at age t:
//
//   age          1     2     3     4     5     6     8    10    12    15    20
//   WC        41.0  25.5  21.6  19.4  17.9  16.7  15.1  13.9  13.1  12.1  10.9
//   GL         9.6  23.7  34.6  43.5  50.9  57.3  67.3  74.7  80.3  86.4  92.5
//   Property  50.4  48.4  47.7  47.3  46.9  46.6  46.2  45.9  45.7  45.3  45.0
//
// WC is 90% paid at age 10 and still paying 10.9% of what is left at age 20 —
// the long crawl IS the shape, and a truncated array would have to invent it.
// Property is still at 45% at age 20 because k is essentially 1: a nearly
// geometric line, which is why the retired constant fitted it least badly.
// Cohorts routinely outlive any table you would want to write out: the horizon
// runs to 12 on WC and a cohort keeps PAYING after it stops developing.
//
// Three numbers per line are also the whole record. An array would be a derived
// artefact sitting next to the parameters that generated it — two descriptions
// of one fact, which is the defect shape this project keeps finding. The
// rendered table above is a CHECK on the parameters, not the source of truth,
// and it is labelled as such.
//
// Cost: two Math.exp and two Math.pow per cohort-year, and NO RNG DRAW. That
// last part is what makes the null test possible.
// ============================================================================
//
// ============================================================================
// ⚠ THE ENGINE CONSUMES THE CONDITIONAL RATE, NOT THE CUMULATIVE ONE, AND THAT
// IS FORCED BY "PAID IS HISTORY".
//
// processIbner pays down the REMAINING balance and then develops what is left.
// It cannot set paid to `ultimate x cumulative(t)`, because the ultimate moves
// and that would restate payments already made — the exact thing the
// pay-first-then-develop ordering exists to prevent.
//
// So a pattern is consumed as the share of the remaining balance paid at each
// step:
//
//     conditional(t) = [ P(t) - P(t-1) ] / [ 1 - P(t-1) ]
//
// which is scale-free: a cohort whose ultimate deteriorated pays proportionally
// more, and one that improved pays less, without either restating history. The
// retired geometric mechanism is exactly the case where this is CONSTANT in t,
// which is why one rate could stand in for it at all.
//
// AGE CONVENTION, because there are two clocks and they are off by one.
// Pattern age t is YEARS SINCE THE START OF THE ACCIDENT YEAR, so t = 1 is the
// accident year's own year-end — the point at which the engine books the cohort
// with `unpaidShare(pattern, 1)` still outstanding. ReserveCohort.age counts
// STEPS TAKEN and is 0 at that same moment. So:
//
//     cohort.age = a   <->   pattern age t = a + 1
//
// and the step that takes a cohort from age a to a+1 pays at conditional(a + 2).
// ============================================================================

/**
 * WEIBULL is the fitted form; GEOMETRIC exists as the null test's control and
 * reproduces the retired mechanism exactly. See the note on the geometric
 * branches below before touching either.
 */
export type PayoutPattern =
  | { kind: 'weibull'; k: number; b: number }
  | { kind: 'geometric'; openFraction: number; conditional: number };

/**
 * The share of ULTIMATE still unpaid at pattern age `t`, t >= 1.
 *
 * ⚠ UNPAID IS THE PRIMARY FORM AND PAID IS DERIVED, not the other way round,
 * and that is a bit-exactness requirement rather than taste. The retired engine
 * wrote `bookedUltimate * IBNER_OPEN_FRACTION` and `bookedUltimate * (1 -
 * IBNER_OPEN_FRACTION)` against a stored 0.60. Storing the geometric variant's
 * OPEN fraction rather than its paid fraction means the null test reproduces
 * both of those expressions character for character.
 */
export function unpaidShare(p: PayoutPattern, t: number): number {
  if (t <= 0) return 1;
  if (p.kind === 'geometric') return p.openFraction * Math.pow(1 - p.conditional, t - 1);
  return Math.exp(-Math.pow(t / p.b, p.k));
}

/** Cumulative share of ULTIMATE paid by the end of pattern age `t`. */
export function cumulativePaid(p: PayoutPattern, t: number): number {
  return 1 - unpaidShare(p, t);
}

/**
 * The share of the REMAINING balance paid at pattern age `t`. This is what
 * processIbner multiplies the unpaid reserve by.
 *
 * ⚠ THE GEOMETRIC BRANCH RETURNS THE STORED LITERAL, not a difference of two
 * cumulative figures that happens to equal it. `netUnpaid * 0.35` and
 * `netUnpaid * ((P(t) - P(t-1)) / (1 - P(t-1)))` are the same number in exact
 * arithmetic and NOT the same in floating point, and the null test cannot tell
 * a reassociation from a mechanism — the same trap
 * DEVELOPMENT_CESSION_ENABLED's disabled path is written around.
 */
export function conditionalPaydown(p: PayoutPattern, t: number): number {
  if (t <= 1) return cumulativePaid(p, 1);
  if (p.kind === 'geometric') return p.conditional;
  // 1 - rem(t)/rem(t-1), written as a single exponential so the ratio of two
  // very small numbers never has to be formed.
  return 1 - Math.exp(-(Math.pow(t / p.b, p.k) - Math.pow((t - 1) / p.b, p.k)));
}

/**
 * The share of ULTIMATE a cohort of age `a` (in years, >= 1) has already paid,
 * for the SEED cohorts the instance generator apportions a drawn reserve
 * across.
 *
 * ⚠ THE GEOMETRIC BRANCH IS NOT GEOMETRIC, AND THAT IS DELIBERATE. It
 * reproduces `Math.min(0.80, age * paydownPct)` — a linear approximation with a
 * hard cap that the retired generator used and that was never the geometric
 * pattern's own cumulative. The geometric variant's job is to be the RETIRED
 * BEHAVIOUR, not a tidy version of it; a null test against a cleaned-up control
 * proves nothing about the change being made. The weibull branch uses the
 * pattern's real cumulative, and needs no cap because a cumulative distribution
 * cannot exceed 1.
 */
export function seedPaidRatio(p: PayoutPattern, ageYears: number): number {
  if (p.kind === 'geometric') return Math.min(0.80, ageYears * p.conditional);
  return cumulativePaid(p, ageYears);
}
