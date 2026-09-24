// ============================================================================
// RISK CONTROL PROGRAMS — THE FIRST ONE THAT REACHES THE ENGINE.
//
// riskControlCategories.ts describes five programs and, until this commit, was
// read by nothing but the display. ONE of them is now wired:
// `gl-law-enforcement-analytics` reduces GL CLAIM FREQUENCY on a three-year
// ramp. The other four are still description only, and the catalog's header
// says which is which.
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

/** The one program wired to the engine. The other four are description only. */
export const WIRED_PROGRAM_IDS = ['gl-law-enforcement-analytics'] as const;

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
  if (line !== 'GL') return 1;
  const tenure = programTenure('gl-law-enforcement-analytics', currentIds, priorIds);
  if (tenure === 0) return 1;
  return 1 - GL_ANALYTICS_FREQUENCY_REDUCTION * rampFraction(tenure);
}
