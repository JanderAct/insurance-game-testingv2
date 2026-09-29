// ============================================================================
// RISK CONTROL PROGRAMS — THE TWO THAT REACH THE ENGINE.
//
// riskControlCategories.ts describes five programs. TWO of them are wired:
// `gl-law-enforcement-analytics` reduces GL CLAIM FREQUENCY on a three-year
// ramp, and `wc-safety-rtw` cuts WC frequency and converts lost-time claims to
// medical-only (see its own section below). The other three are still
// description only, and the catalog's header says which is which.
//
// The GL sections that follow were written for the GL program and are about
// GL; the WC program's reasoning is in its own section.
//
// ============================================================================
// ⚠ FREQUENCY, NOT SEVERITY, AND THE REASON IS WHAT THE PROGRAM DOES.
//
// Early-intervention analytics identifies officers generating repeated
// complaints and intervenes before the next incident. It PREVENTS INCIDENTS. An
// incident that does not happen produces no claim at all — it is not a cheaper
// claim. So the program removes claims from the draw rather than shrinking the
// ones drawn, and it enters lambda, not the severity distribution.
//
// ⚠ AND IT IS FLAT ACROSS THE SEVERITY DISTRIBUTION, WHICH IS A FIRST
// APPROXIMATION AND IS WRONG IN A KNOWN DIRECTION. The real program targets the
// small number of officers who generate a disproportionate share of liability —
// the repeat-complaint tail — and those officers are exactly the ones whose
// incidents become large claims. A real early-intervention program should
// therefore remove LARGE claims preferentially, and this one removes a claim of
// every size with equal probability.
//
// The consequence is that this UNDERSTATES the program at equal cost: dollars
// saved per claim removed is the book's average severity here, where the real
// program's would be above average. Sizing the reduction to a dollar target (see
// below) therefore buys a LARGER frequency cut than the real program would need.
//
// ⚠ IT CANNOT CURRENTLY BE DONE BETTER, AND THAT IS A PROPERTY OF GL'S MODEL
// RATHER THAN A SHORTCUT. WC carries named components and a shock can target
// one — `componentFreqMultiplier` exists for exactly that. GL's severity
// components are STATISTICAL TIERS drawn per claim from a tilted categorical,
// not sub-coverages with their own exposure, and shockCatalog's own validator
// rejects a GL `freqMultiplier` that names a `sub` for that reason. There is no
// law-enforcement exposure to target and no large-claim tier that means
// "police". Targeting the tail would mean giving GL a severity-tier frequency
// channel, which is a change to GL's loss model and not to this program.
//
// ============================================================================
// ⚠ HOW A PROGRAM AND A SHOCK COMPOSE, RECORDED BEFORE BOTH EXIST ON ONE LINE.
//
// Both are whole-line frequency multipliers on GL and both reach the same
// lambda. The rule is:
//
//   lambda = ... * gPool * rcFactor * shockMult * programMult
//
// MULTIPLICATIVE, INDEPENDENT, AND ORDER-FREE. A 1.217x frequency shock and a
// 0.95x program give 1.156x, and neither is clamped against the other: a shock
// year is a year the program made less bad, which is what a risk control
// program does. Nothing caps the product, because there is no floor a
// frequency multiplier must respect — lambda only has to stay non-negative and
// both factors are positive.
//
// ⚠ BUT THEY MUST NOT SHARE A RECORD, AND THE TEMPTATION IS REAL. The shock
// system already carries `freqMultipliers: Record<string, number>` keyed by
// WHOLE_LINE, and writing the program's factor into that record would have been
// one line. It is wrong twice over, and both are load-bearing:
//
//   1. THE MARKETPLACE READS THE SHOCK RECORD AND MUST NOT READ THE PROGRAM.
//      simulationEngine draws prospects with `freqMultipliers:
//      ctx.shock?.freqMultipliers` and `riskControlEffectiveness: 0` — a shock
//      is weather and falls on everyone, the pool's risk control is the pool's
//      alone. A program is the pool's. Sharing the record would hand the
//      marketplace a program it did not buy, and would do it silently.
//   2. IT WOULD CORRUPT THE SHOCK'S OWN COST ATTRIBUTION. `shockExpectedAdded`
//      answers "what did THIS event add" per firing. A program folded into the
//      same record makes that question unanswerable from it.
//
// So the mechanism is shared and the CHANNEL is separate. That is the same
// distinction the market cycle needed: one number, two writers, and the rule
// written down before the second writer arrives rather than after they
// disagree.
//
// ============================================================================
// ⚠ DRAW ONLY, LIKE RISK CONTROL AND SHOCKS, AND THIS IS A REAL CHOICE.
//
// The program does NOT enter the pricing expectation. It therefore shows up as
// lower losses against unchanged premium — it moves the loss ratio rather than
// cancelling out of it — which is what makes it worth buying at all.
//
// The argument the other way is genuine and is recorded rather than dismissed:
// unlike a shock, a program is KNOWN IN ADVANCE, so an actuary pricing next
// year could reflect it, and a pool that priced for it would hand the saving to
// its members as lower contributions instead of keeping it as surplus. That is
// a pricing policy question — who gets the benefit — and it is not settled
// here. What settles the CURRENT behaviour is that riskControlEffectiveness,
// the existing risk-control channel, is already draw-only, and a second risk
// control mechanism that priced differently from the first would be two rules
// for one idea. If pricing is ever taught to see programs, both should move.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

/** The programs wired to the engine. The other three are description only. */
export const WIRED_PROGRAM_IDS = ['gl-law-enforcement-analytics', 'wc-safety-rtw'] as const;

// ============================================================================
// ⚠ THE MAGNITUDE. SIZED AGAINST THE $1,000,000 PLACEHOLDER COST, DELIBERATELY
// SMALL, AND MEANT TO BE RAISED RATHER THAN ARGUED DOWN.
//
// GL's gross ultimate loss measured $25.42M a year averaged over five years at
// defaults (8 games, identical in GL-only and three-line — GL is
// config-independent). So each 1% of frequency is worth about $0.254M of GROSS
// loss a year, and $1M of gross saving would need a 3.93% cut.
//
// ⚠ GROSS IS NOT WHAT THE POOL KEEPS, WHICH IS WHY THIS IS NOT 3.93%. The
// reinsurance tower cedes part of every large claim, so removing a claim
// returns the pool only its RETAINED share. The figure that matters is the
// change in ending surplus, and it is MEASURED rather than derived — see the
// commit and gl-program-value.ts.
//
// 5% AT FULL RAMP is the shipped value. It is a starting point chosen to be on
// the low side of a real decision rather than a calibration to break-even: the
// brief asked for an effect that could be raised, and a program that obviously
// pays for itself is not a decision, it is a button.
export const GL_ANALYTICS_FREQUENCY_REDUCTION = 0.05;

// ⚠ THE RAMP IS INDEXED BY YEARS COMPLETED, NOT BY COMMITMENT YEAR, so a
// program held past its three-year term stays at full effect rather than
// falling off the end of the array. Year 1 of the commitment buys NOTHING —
// analytics has to accumulate a baseline before it can flag anyone — year 2
// buys half, year 3 and after buy all of it. This is the catalog's `ramped`
// benefit shape made numeric; the catalog says WHICH shape, this says how much.
export const PROGRAM_RAMP: readonly number[] = [0, 0.5, 1];

/** The ramp fraction for a program in its `tenure`-th year (1-based). */
export function rampFraction(tenure: number): number {
  if (tenure <= 0) return 0;
  const i = Math.min(tenure, PROGRAM_RAMP.length) - 1;
  return PROGRAM_RAMP[i];
}

/**
 * CONSECUTIVE years this program has been committed, counting the year being
 * processed. 0 when it is not committed this year.
 *
 * ⚠ CONSECUTIVE, SO DROPPING A PROGRAM RESETS ITS RAMP. Stopping in year two
 * and restarting later starts again at nothing, which is the catalog's own
 * statement that "stopping a three-year program in year two should cost the
 * years already spent" — the cost being that the ramp is not banked.
 *
 * ⚠ DERIVED FROM THE PLAYED YEARS RATHER THAN STORED. Every locked result
 * carries the decisions it was played with, so tenure is a function of history
 * that is already persisted. Storing a counter in poolState would be a second
 * source for the same fact, free to disagree with the decisions after a reload.
 */
export function programTenure(
  programId: string,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  if (!currentIds?.includes(programId)) return 0;
  let tenure = 1;
  for (let i = priorIds.length - 1; i >= 0; i--) {
    if (!priorIds[i]?.includes(programId)) break;
    tenure++;
  }
  return tenure;
}

/**
 * The program frequency multiplier for one line — 1 when nothing applies.
 *
 * Returned as a SCALAR rather than a Record keyed by WHOLE_LINE, deliberately:
 * the record shape is the shock channel's, and the header above says why these
 * two must not be mistaken for one another at the type level either.
 */
export function programFreqMultiplier(
  line: CoverageLine,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  if (line === 'WC') {
    const tenure = programTenure('wc-safety-rtw', currentIds, priorIds);
    if (tenure === 0) return 1;
    return 1 - WC_SAFETY_FREQUENCY_REDUCTION * rampAt(WC_SAFETY_RAMP, tenure);
  }
  if (line !== 'GL') return 1;
  const tenure = programTenure('gl-law-enforcement-analytics', currentIds, priorIds);
  if (tenure === 0) return 1;
  return 1 - GL_ANALYTICS_FREQUENCY_REDUCTION * rampFraction(tenure);
}

// ============================================================================
// THE WC SAFETY & RETURN-TO-WORK PROGRAM — TWO LEVERS, ONE COMMITMENT.
//
// SAFETY is a FREQUENCY cut: fewer injuries. It enters WC's lambda through the
// same scalar channel as GL's program (programFreqMultiplier above), and for the
// same reasons it is not the shock record.
//
// RETURN TO WORK is a CONVERSION, NOT A SEVERITY SCALE. Modified duty brings the
// worker back before the waiting period ends, so the claim stays MEDICAL-ONLY
// and its indemnity never exists. In this model that is a lost-time claim
// (component medium, large or schoolsMedium) re-drawn from `small` — the fitted
// component whose median is $308 — one for one, so the COUNT is unchanged and
// the MIX is cheaper.
//
// ⚠ WHY CONVERSION AND NOT A SEVERITY SCALE — THREE REASONS, EACH MEASURED.
//
//   1. IT IS WHAT RETURN TO WORK DOES. The worker is back on light duty before
//      the indemnity waiting period ends, so the claim never becomes lost-time.
//      That is a change of KIND, not of size, and conversion models a change of
//      kind. A scale shrinks every lost-time claim a little, which no RTW program
//      does.
//
//   2. IT KEEPS THE WHOLE SAVING WITH THE POOL. Scaling every lost-time claim by
//      x% hands ~41% of the saving to the tower (measured at 5/10/15%, 96 games
//      x 5 years), because a percentage cut on a claim already above the $1M
//      retention comes entirely out of the layer. Conversion under the ceiling
//      leaves the tower's cession exactly unchanged on the ultimate basis.
//
//   3. THE REAL MECHANISM — INDEMNITY DURATION — WAS EXPLORED AND REJECTED. A WC
//      claim is one amount drawn from a mixture fitted to TOTAL cost; there is no
//      indemnity leg for a duration cut to act on. Adding one reverses a
//      deliberate retirement: the medical/indemnity split was removed in 3181b18
//      as ~65 authored parameters calibrated only to each other
//      (CALIBRATION_FINDINGS §30). And it buys nothing here. Measured on 249,656
//      drawn claims, a duration-only RTW under $1M keeps 100% for the pool and
//      moves the experience-rated primary layer 0.78-0.92 per unit of gross —
//      the same economics as conversion (0.73-0.89). Its one distinct finding is
//      a bound: cutting indemnity alone cannot pass -27.5% of gross, so the top
//      of the Texas 10-30% range needs medical and frequency savings too.
//
//   ⚠ AND DO NOT BUILD DURATION BY SHORTENING CLOSURE. The booked path climbs
//      back to the drawn value by a deterministic drift that grows with closure
//      age (1.26x at age 2, 1.68x at 4, 2.32x at 8). Closing a claim earlier
//      without changing its drawn amount cuts BOOKED loss while the ultimate is
//      unchanged — a free lunch in the reserves and the pricing triangle. Cost
//      has to live in the drawn amount; the revision law is mean-one and cannot
//      carry it.
//
// ⚠ WHY NOT THE SHOCK RECORD, AND WHY IT IS NOT A MULTIPLIER AT ALL. Keeping the
// count one-for-one would need a different boost to `small` per rating group —
// 1 + c x 0.82 schools, 1.27 county, 1.37 lowSafety, 1.96 highSafety — and the
// risk-quality tilt moves it again per member. componentFreqMultipliers holds
// one number per component for the whole pool and cannot say that. And the
// marketplace reads that record, so a program written into it would reach
// prospects who never bought it.
//
// ⚠ CLAIMS UNDER WC_RTW_CONVERSION_CEILING ONLY, AND THAT IS A JUDGEMENT. A
// catastrophic injury does not come back on light duty. It is also what keeps
// the tower out of it: a claim under the $1M retention that converts to a
// smaller one never touched a layer, so the pool keeps 100% of the saving
// (measured 0.0% tower share; the unrestricted version gave the tower ~25%).
// The restriction needs the amount, so conversion is a step AFTER the draw —
// see generateWcClaims.
//
// ⚠ THE SIZES, AND WHERE THEY COME FROM.
//   RTW 10% of WC gross loss at full effect. The Texas State Office of Risk
//     Management says a return-to-work program should cut overall WC losses by
//     at least 10% and as much as 30%. 10% is its FLOOR, chosen because it is
//     the one size at which the program was measured to be a real decision —
//     near break-even against the placeholder cost by year 5 — rather than an
//     obvious yes. The conversion RATE that delivers it is solved, below.
//   SAFETY 5%. Not sourced. The low end of an ordinary safety-program claim,
//     and the same size as the GL program's.
//
// ⚠ THE RAMPS DIFFER IN THE RIGHT DIRECTION, NOT IN MEASURED AMOUNTS. Safety is
// a culture build — committees, training, habits — small in year 1 and real by
// year 3. RTW is a policy change: adopt modified duty and the next injured worker
// is back in weeks, so it is near-full at once. Both are indexed by TENURE,
// exactly as GL's ramp is, so dropping the program resets both.
//
// ⚠ AND NEITHER RAMP STARTS AT ZERO, WHICH IS WHERE THIS DIFFERS FROM GL. GL's
// year 1 is a free negative control because its ramp is 0 there. WC's is not:
// the program acts from its first year. wc-program-check's exact control is
// therefore a game that commits from year 2, whose year 1 is at tenure 0.
//
// ⚠ DRAW ONLY, like GL's program: it does not enter the pricing expectation. But
// the pool prices off its own experience (PRICING_TRIANGLE), so about a fifth of
// the saving returns to members as lower premium a year or two later. That is
// not a leak in this program; it is the experience channel doing its job.
// ============================================================================

/** Full-effect WC frequency reduction from the safety lever. */
export const WC_SAFETY_FREQUENCY_REDUCTION = 0.05;

/** Safety ramp by tenure: a culture build. */
export const WC_SAFETY_RAMP: readonly number[] = [0.25, 0.60, 1];

/** RTW ramp by tenure: a policy change, near-full at once. */
export const WC_RTW_RAMP: readonly number[] = [0.75, 1, 1];

/**
 * The share of WC gross loss RTW is sized to remove at full effect. The TARGET;
 * the rate below is what delivers it.
 *
 * ⚠ WHAT THE PROGRAM IS WORTH AT THESE SIZES — AND WHY BEHIND IN GAME IS THE
 * POINT. Safety 5% and RTW 10% together, both ramps, 96 games x 5 years WC solo,
 * paired on seeds (wc-program-value.ts), against the $1M/yr placeholder at
 * RISK_CONTROL_PLACEHOLDER_ANNUAL_COST — which is NOT CHARGED yet:
 *
 *   year                      1      2      3      4      5
 *   surplus gained, cum     0.54   1.41   2.50   3.64   4.53   ($M)
 *   placeholder cost, cum   1.00   2.00   3.00   4.00   5.00
 *
 *   year-5 surplus +$4.53M against $5.00M: -$0.47M, SE $0.20M, 2.3 SE behind
 *   pool keeps over the claims' full life (ultimate basis) $9.15M = 1.83x cost
 *   of which ~$1.45M (16%) returns to members as lower premium
 *
 * Behind in every game year and clearly ahead over the claims' life is
 * DELIBERATE: it is the only size at which the program is a decision a player
 * weighs rather than an obvious yes or no. What would change it: RTW near 11%,
 * or a cost near $0.9M/yr, breaks even at year 5 (estimated by scaling, not
 * re-run). The cost is the softer of the two numbers — see the placeholder.
 */
export const WC_RTW_TARGET_REDUCTION = 0.10;

/**
 * The probability that an eligible lost-time claim converts to medical-only, at
 * full effect. SOLVED, NOT CHOSEN, against WC_RTW_TARGET_REDUCTION.
 *
 * Eligible lost-time claims under the ceiling are 56.8% of WC gross, and a
 * converted claim keeps only a `small` draw (mean $489), so a rate c removes
 * about 0.57c of gross. SOLVED on the enrolled book by wc-program-value.ts part
 * 1 — every played WC year of 96 games x 5 redrawn with this lever alone:
 * c = 0.179 removed 10.18%, so 10.00% needs c = 0.1758, rounded to 0.176.
 * Re-solve with that script if the WC severity mixture or the ceiling moves.
 */
export const WC_RTW_CONVERSION_RATE = 0.176;

/**
 * Lost-time claims at or above this drawn amount never convert — a catastrophic
 * injury does not come back on light duty. NOMINAL, and deliberately equal to
 * the WC tower's retention, which is what makes the tower's share of the saving
 * exactly zero while every layer is placed.
 *
 * ⚠ "EXACTLY ZERO" HOLDS ON TWO BASES AND NOT A THIRD. Measured with RTW alone
 * in the engine (a copy with WC_SAFETY_FREQUENCY_REDUCTION set to 0), 24 games x
 * 5 years WC solo, 120 line-years:
 *
 *   ULTIMATE basis — the tower on the drawn claims     unchanged in 120 of 120
 *   INCEPTION recovery — the tower on the booked claims unchanged in 120 of 120
 *   DEVELOPMENT cession as booked reserves develop      MOVED in 68 of 120,
 *                                                       net +$0.17M over the run
 *
 * The third is 0.09% of the $187M gross the run avoided, and it moved in the
 * pool's favour. THE CAUSE IS A READING, NOT A PROOF: development is a
 * cohort-level amount (IBNER on the cohort's net unpaid) spread across a TRACKED
 * set of claims chosen by developmentAllocation's reselection, and conversion
 * changes which claims are in that set, so a share of the cohort's movement
 * lands on a different claim — occasionally one that crosses the retention. No
 * per-claim trace was run to confirm it. If this ever needs to be exactly zero
 * too, that trace is the first step.
 *
 * The inception result is structural, not lucky: the booked first estimate is
 * A x drawn^k (TRIANGLE_INITIAL_CONTRACTION), which for any drawn amount under
 * $1M is at most $0.39M, so an eligible claim cannot pierce at inception.
 *
 * And it assumes every layer is placed. A pool that declines the first layer
 * retains up to $5M, and conversion then touches the tower even less.
 */
export const WC_RTW_CONVERSION_CEILING = 1_000_000;

/** The WC components RTW converts FROM. `small` is the medical-only target. */
export const WC_RTW_LOST_TIME_COMPONENTS: readonly string[] = ['medium', 'large', 'schoolsMedium'];

/** A ramp's fraction at `tenure` (1-based), held at its last value past its end. */
export function rampAt(ramp: readonly number[], tenure: number): number {
  if (tenure <= 0) return 0;
  return ramp[Math.min(tenure, ramp.length) - 1];
}

/**
 * The RTW conversion rate for one line — 0 when nothing applies. A separate
 * scalar channel from the frequency multiplier, for the same reason that one is
 * separate from the shock record: one number, one writer.
 */
export function programRtwConversion(
  line: CoverageLine,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  if (line !== 'WC') return 0;
  const tenure = programTenure('wc-safety-rtw', currentIds, priorIds);
  if (tenure === 0) return 0;
  return WC_RTW_CONVERSION_RATE * rampAt(WC_RTW_RAMP, tenure);
}
