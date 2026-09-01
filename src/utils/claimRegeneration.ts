// ============================================================================
// CLAIM REGENERATION — redraw a past line-year and get exactly what was drawn.
//
// Ruling 8 keeps the claim register out of persistence. Until da011f5 that was
// false by accident (the register WAS saved, and it blew the localStorage quota
// at year 4); since da011f5 it is true by stripping; and from this file it is
// true BY DESIGN — a save carries the inputs, and the register is redrawn from
// them on demand. Store the inputs, not the output.
//
// ⚠ "SEED x MEMBER x YEAR" WAS NEVER ENOUGH, AND FOUR COMMENTS SAID IT WAS.
// Measured: the same seed with one pool-wide risk-control decision changed moves
// GL's AY1 register from 321 claims / $27.375M to 310 / $26.986M. A line-year's
// draw also depends on the ENROLLED ROSTER, the mix correction k, the year's
// rcEffectiveness, GL's shared gPool, and any shock effects in force. All of
// those are functions of the decision path, not of the seed.
//
// ⚠ ONE NUMBER HAD TO BE STORED, AND ONLY ONE. Tracing each input to where it lives:
//
//   roster                  LineResultSet.memberList — the SAME array the
//                           generator was handed (memberResult.activeMembers)
//   k                       LineResultSet.kLineApplied
//   pre-game seed offset    LineResultSet.pregameAttempt — the bootstrap's
//                           accepted redraw attempt; effective seed is
//                           (seed + attempt x 997). Stamped by priorHistoryEngine
//                           for exactly this use, before this file existed.
//   rcEffectiveness         LineResultSet.rcEffectivenessApplied — ADDED FOR
//                           THIS. The only rc anywhere was the line STATE's
//                           rolling current value, overwritten each year; a
//                           past year's applied value was not recorded.
//   calendarYear, year      on the ResultSet
//   gPool                   poolYearFactor(seed, year) — a pure function
//   shock effects           resolveShocks(instance, year) — consumes no
//                           randomness; instance.scheduledShocks is never
//                           mutated after creation
//
// So of the inputs a redraw needs, THREE were already there (roster, k, and the
// pre-game attempt), ONE had to be added (rc, a single number per line-year),
// and two are derivable —
// and a derivable value stored would be a second copy of one fact. The save
// grows by roughly 3 x 13 x 8 bytes. (The first draft of this header said
// nothing needed adding; typecheck disagreed, and it was right.)
//
// ============================================================================
// ⚠ A REDRAW THAT IS NOT EXACT IS WORSE THAN NO REDRAW, because it is silent.
// Every consumer would read plausible claims that were never drawn. So:
//
//   - the argument mapping is SHARED with the engine (claimGeneration.ts), not
//     re-implemented here, so the two cannot drift apart;
//   - save-round-trip-check regenerates every line-year of a restored game and
//     compares it to the straight-through arm CLAIM BY CLAIM ON EVERY FIELD —
//     ids, amounts, components, occurrence grouping — never on totals, which
//     can agree while the register underneath differs;
//   - that gate carries its own positive control: it perturbs one input and
//     asserts the redraw DIFFERS, so the comparison is known to have teeth;
//   - a result that cannot be reproduced THROWS. A save written before
//     `kLineApplied` existed has no k to redraw with, and defaulting to 1 would
//     produce a plausible, wrong register with no symptom — the failure this
//     file exists to prevent, reintroduced as a fallback.
//
// WHO CALLS THIS, AND WHO MUST NOT. The claims workbook and anything else that
// reads a register the save dropped. NOT the engine's live path: processYear
// has the claims it just drew, and a second code path producing the same
// objects is how two views of one fact drift.
// ============================================================================

import type { CoverageLine, GameInstance, ResultSet } from '../types/simulation';
import { resolveShocks } from './shockResolver';
import { generateLineYearClaims, poolYearFactor, type LineYearGenerationOutput } from './claimGeneration';

export class ClaimRegenerationError extends Error {
  constructor(public readonly line: CoverageLine, public readonly yearNumber: number, reason: string) {
    super(`cannot regenerate ${line} accident year ${yearNumber}: ${reason}`);
    this.name = 'ClaimRegenerationError';
  }
}

/**
 * Redraw the enrolled claims of one line-year from a persisted result.
 *
 * Exact by construction when the result carries what it needs; throws
 * ClaimRegenerationError when it does not. Never returns an approximation.
 */
export function regenerateLineYearClaims(
  instance: GameInstance,
  result: ResultSet,
  line: CoverageLine,
): LineYearGenerationOutput {
  const lr = result.byLine[line];
  const year = result.yearNumber;
  if (!lr) throw new ClaimRegenerationError(line, year, 'the result carries no entry for this line');
  if (!Array.isArray(lr.memberList)) {
    throw new ClaimRegenerationError(line, year, 'memberList is absent — the roster the generator saw was not recorded');
  }
  if (typeof lr.kLineApplied !== 'number') {
    throw new ClaimRegenerationError(line, year,
      'kLineApplied is absent — this result predates the field, and redrawing at k = 1 would fabricate a register');
  }
  if (typeof lr.rcEffectivenessApplied !== 'number') {
    throw new ClaimRegenerationError(line, year,
      'rcEffectivenessApplied is absent — this result predates the field, and redrawing at the current rc would fabricate a register');
  }

  // ⚠ THE PRE-GAME DID NOT RUN ON instance.seed, AND THIS IS THE FIRST THING THE
  // REPRODUCTION GATE CAUGHT. runLinePreGame is a reject-and-redraw search: each
  // candidate past is simulated on `(instance.seed + attempt x 997) >>> 0`, per
  // line, until one lands in the opening band. Every per-member stream AND the
  // year's gPool were drawn from that offset seed. Redrawing a pre-game year on
  // the base seed reproduced every GAME year exactly and every pre-game year
  // wrong — 24 of 24 mismatches on the first run, all at years -2..0, and by
  // hundreds of claims, not one or two.
  //
  // priorHistoryEngine stamps the accepted attempt on each pre-game line-result
  // for exactly this reason (its own comment says so), and attempt 0 is the base
  // seed unchanged — the same rule simulateLineCandidate applies. Game years
  // carry no stamp and take the base seed.
  const attempt = lr.pregameAttempt ?? 0;
  const effectiveSeed = attempt === 0 ? instance.seed : (instance.seed + attempt * 997) >>> 0;

  return generateLineYearClaims(line, {
    members: lr.memberList,
    yearNumber: year,
    calendarYear: result.calendarYear,
    instanceSeed: effectiveSeed,
    k: lr.kLineApplied,
    riskControlEffectiveness: lr.rcEffectivenessApplied,
    gPool: poolYearFactor(effectiveSeed, year),
    shock: resolveShocks(instance, year)?.byLine[line],
  });
}
