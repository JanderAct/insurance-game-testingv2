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

// ============================================================================
// WHEN A COHORT IS FINISHED.
//
// ⚠ AN ABSOLUTE DOLLAR TEST AGAINST A RELATIVE DECAY DOES NOT TERMINATE, AND
// THAT IS WHAT THIS REPLACES. The engine closed a matured cohort at
// `newUnpaid < $1,000`. Against a 35% geometric that bites at about age 23,
// which is why it was never a problem. Against a Weibull it does not bite at all
// in any relevant range: WC's unpaid share reaches $1,000 on a $20M ultimate at
// AGE 98, so cohorts accumulated one a year and never shed — 46 open on WC by
// year 40 and still climbing, against a stock the payout-pattern commit had
// assumed was bounded.
//
// It also scaled with cohort SIZE, which nothing about being finished does. A
// $200M accident year and a $2M one are equally finished at the same AGE, and
// the dollar test held the large one open four times longer.
//
// So the test is a share of the cohort's own current ultimate. It is scale-free,
// shape-free, and — the part that matters for maintenance — it does not have to
// be re-tuned when a pattern moves, because it is expressed in the same units
// the pattern is.
//
// ⚠ THE FRACTION IS 0.5% AND IT IS THE KNEE. Ages at which each line crosses,
// with what the truncation costs the steady-state reserve and what the residual
// pays early:
//
//   fraction   WC age   GL age   PR age   WC reserve       GL       PR   WC residual
//      5.0%        16        7        5      -13.09%   -1.16%   -7.78%         4.46%
//      2.0%        23        7        7       -6.40%   -1.16%   -2.24%         1.98%
//      1.0%        30        8        8       -3.33%   -0.36%   -1.21%         0.96%
//      0.5%        37        9        9       -1.82%   -0.10%   -0.65%         0.49%
//      0.2%        48        9       10       -0.75%   -0.10%   -0.36%         0.19%
//
// Each halving of the fraction roughly halves the truncation and buys 7 to 11
// more open cohorts, so the marginal cohort gets steadily more expensive per unit
// of accuracy. 0.5% is where that turns: 1.82% off WC's steady-state reserve to
// bound the array at 37, against 13% to bound it at 16. And the truncated dollars
// are not lost — the residual is PAID, on a cohort already 37 years old and
// decades past any decision a player makes.
//
// ⚠ ONE FRACTION FOR ALL THREE LINES, DELIBERATELY. The point of a share is that
// it is shape-independent; a per-line fraction would be re-tuning by another name
// and would put the close age back under manual control.
export const COHORT_CLOSE_SHARE = 0.005;

// ⚠ THE GEOMETRIC CONTROL KEEPS THE DOLLAR TEST, and this is the THIRD legacy
// behaviour it now carries — with the linear seed ratio and reserveStepSigma's
// closed form. That is a real and growing cost and it is worth naming.
//
// It is kept because the null test's value is that it is TOTAL. "0 values
// changed" is a statement anyone can check; "0 changed except the ones cohort
// closure moved" needs a judgement about which differences are allowed, and a
// null test that needs judgement is not a null test. A share-based rule closes a
// geometric cohort at a different age than $1,000 did, so the control either
// keeps the dollar rule or stops being the parent.
//
// ⚠ THE CONTROL IS NOW A SECOND IMPLEMENTATION, not a switch, and retiring it
// should be a deliberate decision rather than something that happens by
// attrition. It stays useful after this branch merges — it is the standing test
// that the pattern machinery still reproduces the pre-pattern engine — but every
// further legacy behaviour added to it makes that claim more expensive to keep
// true. If a fourth is ever needed, retire the control instead.
const LEGACY_DOLLAR_CLOSE_FLOOR = 1000;

/**
 * The unpaid balance below which a MATURED cohort is finished and closes. The
 * caller still gates on maturity — a still-developing cohort must never close,
 * because freezing its ultimate early breaks E[ultimate] = registerSum.
 */
export function cohortCloseBelow(p: PayoutPattern, netUltimate: number): number {
  if (p.kind === 'geometric') return LEGACY_DOLLAR_CLOSE_FLOOR;
  return COHORT_CLOSE_SHARE * Math.max(0, netUltimate);
}
