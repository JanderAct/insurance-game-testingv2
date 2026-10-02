// ============================================================================
// THE COHORT READERS THREE DOCUMENTS SHARE — gross paid, gross ultimate, and
// per-occurrence development, read off `poolState.lines[].reserveCohorts`.
//
// ⚠ EACH OF THESE WAS WRITTEN THREE TIMES AND THE COPIES HAD DRIFTED. The
// claims workbook, the claims memo and the actuarial memo each walked the
// cohorts themselves. Nothing about that was gratuitous — each walk is six
// lines — but three walks are three places for a rule to change in one and not
// the others, and one had: the actuarial memo's developed-occurrence count
// carried a $1,000 floor the workbook's listing did not, so the same book was
// 778 occurrences in one document and 840 in the other.
//
// ⚠ AND THE FIX IS NOT TO PICK ONE FLOOR — see countDevelopedOccurrences. The
// two documents ask different questions and both answers were right. What was
// wrong is that the difference lived in a magic number nobody could see from
// either call site. It is a named parameter here, with the measurement.
//
// ⚠ EVERY READER HERE IS AT THE CURRENT VALUATION, because reserveCohorts IS
// the current valuation — it is live state, not a history. A cohort carries
// `grossPaid` and `grossUnpaid` AS THEY STAND NOW and no earlier pair. The only
// per-valuation history in the model is `reserveDevelopment.paidByValuation`,
// which is NET, so a document on a GROSS basis cannot rewind at all. That is
// not a gap to be filled later; it is the reason buildClaimsMemo strikes at the
// latest valuation rather than at a year a reader picks. The one quantity that
// CAN be rewound is development, because movementByStep keeps the per-step
// series — which is what asAtYear means in countDevelopedOccurrences and
// nowhere else in this file.
// ============================================================================

import type { CoverageLine, PoolState, ResultSet } from '../types/simulation';

/**
 * The valuation every gross document is struck at: the last PLAYED year.
 *
 * ⚠ NOT `gameState.currentYearNumber`, WHICH IS THE YEAR NOBODY HAS PLAYED YET.
 * The Departments page defaults its year selector to currentYearNumber, so that
 * was the default valuation the claims memo resolved claim status against —
 * while its money columns came from reserveCohorts, which is the year before.
 * Measured on a seven-year game: 508 claims read OPEN at the workbook's
 * valuation and CLOSED one year on, so the default listing dropped a third of
 * the open inventory (1,494 files down to 986) and quoted the remainder's Paid
 * from a valuation it was no longer claiming to be at.
 *
 * ⚠ A PRE-GAME-ONLY STATE STRIKES AT ITS LAST PRE-GAME YEAR RATHER THAN AT 0.
 * Before year 1 is played there are no locked results, and defaulting to 0
 * would resolve every pre-game claim's closure at a curve age of
 * `0 - accidentYear + 1` — right by luck for the last pre-game year and wrong
 * for the others. This is the rule claimsExport already used; it is here so the
 * workbook and the memo cannot answer it differently.
 */
export function latestValuationYear(
  // Structural rather than `GameState`, because the workbook reaches this point
  // holding the two arrays and not the state they came from. A GameState
  // satisfies it as it stands.
  state: { lockedResults: readonly ResultSet[]; priorHistory: readonly ResultSet[] },
): number {
  const { lockedResults, priorHistory } = state;
  if (lockedResults.length > 0) return lockedResults[lockedResults.length - 1].yearNumber;
  return priorHistory.length > 0 ? priorHistory[priorHistory.length - 1].yearNumber : 0;
}

/**
 * Accident year -> the cohort's cumulative GROSS paid, for the years that carry
 * one.
 *
 * ⚠ AN ABSENT YEAR MEANS BLANK, NEVER ZERO, and both documents honour that. A
 * cohort that has CLOSED is filtered out of reserveCohorts the following year,
 * so its claims have no retrievable paid total — they were paid, the figure is
 * simply gone on this basis. `reserveDevelopment.paidByValuation` is NOT a
 * fallback: it is net, and putting net dollars in a column headed Gross Paid on
 * exactly the old accident years nobody re-checks is worse than a gap that says
 * so. Cohorts close well after maturity (WC at age 37), so no normal-length
 * game reaches it.
 */
export function grossPaidByAccidentYear(
  poolState: PoolState | undefined, line: CoverageLine,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of poolState?.lines[line]?.reserveCohorts ?? []) {
    if (c.grossPaid !== undefined) out.set(c.yearNumber, c.grossPaid);
  }
  return out;
}

/**
 * Accident year -> the cohort's CURRENT gross ultimate, `grossPaid +
 * grossUnpaid`.
 *
 * ⚠ BOTH HALVES OR NEITHER. A cohort missing either contributes no entry, and
 * its claims fall back to their drawn values with `developed: false` on the
 * row — the same corner the paid column goes blank in, marked the same way.
 */
export function grossUltimateByAccidentYear(
  poolState: PoolState | undefined, line: CoverageLine,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of poolState?.lines[line]?.reserveCohorts ?? []) {
    if (c.grossPaid !== undefined && c.grossUnpaid !== undefined) {
      out.set(c.yearNumber, c.grossPaid + c.grossUnpaid);
    }
  }
  return out;
}

/**
 * ⚠ THE JOIN KEY IS THE OCCURRENCE, NOT THE CLAIM, and the reasoning is the
 * workbook's: the tower attaches per occurrence, so development is tracked per
 * occurrence, while the line sheets are per claim. A `claimId` join would hand
 * an occurrence's whole development to its first claim and leave its siblings
 * blank — reading as "they did not develop" when they are part of an occurrence
 * that did.
 *
 * ⚠ VACUOUS TODAY, LIVE THE DAY A CAT BAND LANDS. Measured across 65,817
 * occurrences on all three lines: ZERO carry more than one claim, so occurrence
 * and claim are the same grain and every resolution agrees. reinsuranceTower's
 * header already requires a future catastrophe to be emitted as ONE occurrence
 * with many claims, and on that day a claim-id join starts misattributing
 * silently.
 */
export interface OccDevelopment {
  /** The occurrence as first REPORTED — with forward booking on, the contracted
   *  initial estimate, BELOW what the generator drew. Never moves. Exported
   *  under the historical header "Drawn Occurrence". */
  drawn: number;
  /** As first BOOKED — `drawn` less the cohort's optimistic markdown. */
  booked: number;
  current: number;
  /** current - booked. */
  dev: number;
  pct: number | '';
  accidentYear: number;
  /** Valuation year -> that year's change. Only years the occurrence actually
   *  moved in appear; a year it was valued at and did not move in is absent. */
  byYear: Map<number, number>;
}

/**
 * Every tracked occurrence on this line's live cohorts, with its development.
 *
 * ⚠ NO FLOOR, AND THAT IS THIS FUNCTION'S CONTRACT. It reports what is tracked,
 * including occurrences that have not moved at all — 31 of 840 on a measured
 * seven-year book. A caller that wants "development actually landed" filters;
 * see countDevelopedOccurrences.
 */
export function occurrenceDevelopment(
  poolState: PoolState | undefined, line: CoverageLine,
): Map<string, OccDevelopment> {
  const m = new Map<string, OccDevelopment>();
  for (const c of poolState?.lines[line]?.reserveCohorts ?? []) {
    for (const d of c.developingClaims ?? []) {
      const dev = d.current - d.original;
      // ⚠ THE VALUATION YEAR IS DERIVED, NOT STORED. Index k of movementByStep
      // is the step from age k to age k+1, and a cohort takes its first step the
      // year AFTER the accident year it was written for — so k belongs to
      // valuation year `yearNumber + k + 1`. Storing the year on every entry
      // would carry the cohort's own accident year once per claim per step.
      const byYear = new Map<number, number>();
      (d.movementByStep ?? []).forEach((mv, k) => {
        if (mv !== 0) byYear.set(c.yearNumber + k + 1, mv);
      });
      m.set(d.occurrenceId, {
        drawn: d.drawn, booked: d.original, current: d.current, dev,
        pct: d.original > 0 ? Number(((dev / d.original) * 100).toFixed(1)) : '',
        accidentYear: c.yearNumber,
        byYear,
      });
    }
  }
  return m;
}

/**
 * How many occurrences development has actually landed on, as at a valuation.
 *
 * ⚠ THE FLOOR SURVIVES, AND SO DOES ITS ABSENCE ELSEWHERE — the two documents
 * were not in conflict, they were answering different questions, and finding
 * that out was the point of sharing the builder rather than picking a winner.
 *
 *   the workbook   LISTS what is tracked. An occurrence that has not moved is a
 *                  true row of that listing, and a data export that silently
 *                  dropped rows would be the worse defect. No floor, by design.
 *   this count     backs a SENTENCE — "N occurrences have had development land
 *                  on them". Counting an occurrence that moved by $0 makes that
 *                  sentence false, so a floor is not a nicety here.
 *
 * ⚠ THE VALUE $1,000 IS ARBITRARY AND THE MEASUREMENT SAYS SO. Of 840 tracked
 * occurrences on a seven-year book: 31 moved by exactly nothing, 31 more moved
 * by less than $1,000 (the smallest non-zero movements are $14.39, $19.75,
 * $49.34), and 778 moved by more. So the floor decides 3.7% of the book and the
 * part of it that is load-bearing — excluding the true non-movers — is the
 * `> 0` half. $1,000 is kept because a sentence about claims deteriorating
 * should not count a $14 revaluation, not because the threshold was derived.
 *
 * ⚠ asAtYear IS HONOURED HERE AND NOWHERE ELSE IN THIS FILE, because
 * development is the one cohort quantity that keeps a per-step series.
 * `movementByStep` is summed over the steps that had landed BY that valuation.
 * Before this existed the count was always the latest year's, whatever year the
 * reader had selected: measured on a seven-year game it printed 778 at every
 * selection, against true counts of 440 / 493 / 557 / 608 / 664 / 721 / 778 —
 * a 77% overstatement at year 1, converging only at the latest valuation, which
 * is exactly where the gate was testing.
 */
export const DEVELOPED_MOVEMENT_FLOOR = 1000;

export function countDevelopedOccurrences(
  poolState: PoolState | undefined,
  lines: readonly CoverageLine[],
  asAtYear: number,
  floor: number = DEVELOPED_MOVEMENT_FLOOR,
): number {
  let n = 0;
  for (const line of lines) {
    for (const c of poolState?.lines[line]?.reserveCohorts ?? []) {
      for (const d of c.developingClaims ?? []) {
        let cumulative = 0;
        (d.movementByStep ?? []).forEach((mv, k) => {
          if (c.yearNumber + k + 1 <= asAtYear) cumulative += mv;
        });
        if (Math.abs(cumulative) >= floor) n++;
      }
    }
  }
  return n;
}
