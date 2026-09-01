// ============================================================================
// THE ENDING POSITION — SURPLUS, AND WHAT IS STILL OWED AGAINST IT.
//
// ⚠ ENDING SURPLUS ALONE IS THE MOST MISLEADING NUMBER IN THE GAME, AND IT IS
// THE LAST ONE A PLAYER SEES. Measured on a five-year GL game: the median
// actual/expected loss ratio reads 0.868 at the final valuation and 0.964 over
// complete cohort lives. Ten of those thirteen points are TRUNCATION, not
// performance — the game stopped before the runoff could take them back. At year
// five roughly 37% of everything the pool ever wrote is still outstanding, and
// GL's reserve runs 1.8-3.1x a year's premium.
//
// So a GL player who underpriced finishes with a surplus that says it worked.
// This is the figure that says what the surplus is standing on.
//
// ⚠ IT DOES NOT REPLACE ENDING SURPLUS AND MUST NOT. Both, adjacent. The surplus
// is what the balance sheet says; the net figure is what it means. A player
// needs to watch the two disagree — collapsing them into one "true" number
// teaches nothing and hides which half moved.
//
// ⚠ PER LINE, BECAUSE THE CONTRAST IS THE LESSON. Measured at year 5 on twelve
// seeds at defaults, the share of everything booked that is still unpaid:
//
//     WC 50%          GL 50%          Property 22%
//
// A player who ran all three sees short-tail against long-tail in one place,
// which is what the exhibit is for. So this is always computed for every active
// line and the pool, regardless of which line the page is filtered to.
//
// ⚠ "PROPERTY ENDS ROUGHLY SETTLED" IS TRUE ON ONE MEASURE AND NOT THE OTHER, so
// both are carried. Against a year's premium Property reads 0.86x at defaults —
// settled, on that framing. Against everything it has written it still holds
// 22%, which is a fifth of the book open and not nothing. The premium ratio also
// moves with the player's own funding choice, so it is the weaker of the two for
// judging a LINE. Neither is wrong; they answer different questions and the
// panel labels which.
//
// ⚠ READ-ONLY, AND THAT IS ASSERTED ELSEWHERE. Nothing here writes to game
// state, and ending-position-check runs a game with and without this call to
// prove the engine's values are untouched. A disclosure that changes the thing
// it discloses is not a disclosure.
// ============================================================================

import type { CoverageLine, GameState } from '../types/simulation';
import { unEmergedDeficiency } from './actuarialMemo';

export interface EndingPositionRow {
  /** A coverage line, or 'pool' for the aggregate. */
  key: CoverageLine | 'pool';
  label: string;
  endingSurplus: number;
  /** The booked reserve: unpaid losses, net of reinsurance. */
  outstanding: number;
  /**
   * What the booked reserve is still short by because the optimistic booking has
   * not finished unwinding. `null` until the game is complete — see below.
   */
  deficiency: number | null;
  /** endingSurplus - outstanding - (deficiency ?? 0). */
  netOfOutstanding: number;
  /** This year's pool premium, for the reserve-to-premium ratio. */
  premium: number;
  /**
   * outstanding / premium — "how many years of income is this liability worth".
   *
   * ⚠ THIS MOVES WITH THE FUNDING DECISION, so it is not a clean tail measure.
   * Underprice and the denominator shrinks and the ratio rises, which is a fact
   * about the player rather than about the line. Measured on the same seeds: at
   * DEFAULTS the medians are WC 2.43x / GL 1.87x / Property 0.86x, and under a
   * hard squeeze they read 3.81x / 2.67x / 1.79x. Both are true and they are
   * answering different questions, which is why the next field exists.
   */
  outstandingToPremium: number | null;
  /** Every loss booked to date, cumulative, net of reinsurance. */
  bookedToDate: number;
  /**
   * outstanding / bookedToDate — "how much of what you have written is still
   * open". Independent of pricing, so this is the one that measures the TAIL.
   * Medians at year 5: WC 50%, GL 50%, Property 22%.
   */
  outstandingToBooked: number | null;
}

/**
 * The ending position, per active line and pooled.
 *
 * Returns an empty array before any year is locked — there is no position to
 * report and a row of zeroes would read as one.
 */
export function endingPosition(gameState: GameState): EndingPositionRow[] {
  const last = gameState.lockedResults[gameState.lockedResults.length - 1];
  if (!last) return [];

  // ⚠ THE DEFICIENCY IS GAME-END ONLY, AND THAT IS A DELIBERATE INFORMATION
  // BOUNDARY RATHER THAN A DISPLAY CHOICE. It is derived from `bookingBias`,
  // which is the player's own funding decision fed back to them — disclosing it
  // mid-game would let a player read their optimism off the screen and price
  // against it, which is the lesson arriving as a cheat sheet. At game end there
  // is nothing left to price, so it becomes the reveal it was written to be.
  // See actuarialMemo's unEmergedDeficiency header.
  //
  // ⚠ AND IT IS AN ESTIMATE OF WHAT HAS NOT EMERGED, NOT THE TRUE ULTIMATE.
  // Neither the true ultimate nor the bias itself is shown anywhere. The
  // deficiency is the unwind still scheduled; the stochastic development on top
  // of it is unknowable and is not implied to be zero.
  const complete = gameState.isComplete;

  const rows: EndingPositionRow[] = [];
  const lines = gameState.setup.activeLines;

  for (const line of lines) {
    const lr = last.byLine[line];
    const ls = gameState.poolState.lines[line];
    if (!lr || !ls) continue;
    const outstanding = lr.expectedNetUnpaidLoss;
    const deficiency = complete ? unEmergedDeficiency(ls) : null;
    // ⚠ SUMMED FROM netIncurredLoss, NOT FROM netUltimateLoss. Incurred is the
    // calendar-year figure — paid plus reserve movement — so summing it over the
    // game gives everything booked as a loss INCLUDING later development on
    // earlier years. Summing the as-booked ultimates would use each year's
    // opinion at inception and understate a book that has deteriorated since,
    // which is precisely the book this panel is written for.
    const bookedToDate = gameState.lockedResults
      .reduce((s, r) => s + (r.byLine[line]?.netIncurredLoss ?? 0), 0);
    rows.push({
      key: line,
      label: line,
      endingSurplus: lr.endingSurplus,
      outstanding,
      deficiency,
      netOfOutstanding: lr.endingSurplus - outstanding - (deficiency ?? 0),
      premium: lr.poolPremium,
      outstandingToPremium: lr.poolPremium > 0 ? outstanding / lr.poolPremium : null,
      bookedToDate,
      outstandingToBooked: bookedToDate > 0 ? outstanding / bookedToDate : null,
    });
  }

  // ⚠ THE POOL ROW IS SUMMED FROM THE LINES, NOT READ FROM THE POOLED RESULT,
  // and the two must agree. `last.endingSurplus` is itself a sum of the per-line
  // figures, so taking it here would be a second derivation of one fact — the
  // shape that let the line sheets and the Development sheet disagree about
  // which years exist. ending-position-check asserts this row against the
  // pooled result rather than trusting the equality.
  const sum = (pick: (r: EndingPositionRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const poolOutstanding = sum(r => r.outstanding);
  const poolDeficiency = complete ? sum(r => r.deficiency ?? 0) : null;
  const poolPremium = sum(r => r.premium);
  const poolBooked = sum(r => r.bookedToDate);
  rows.push({
    key: 'pool',
    label: 'Pool',
    endingSurplus: sum(r => r.endingSurplus),
    outstanding: poolOutstanding,
    deficiency: poolDeficiency,
    netOfOutstanding: sum(r => r.endingSurplus) - poolOutstanding - (poolDeficiency ?? 0),
    premium: poolPremium,
    outstandingToPremium: poolPremium > 0 ? poolOutstanding / poolPremium : null,
    bookedToDate: poolBooked,
    outstandingToBooked: poolBooked > 0 ? poolOutstanding / poolBooked : null,
  });

  return rows;
}
