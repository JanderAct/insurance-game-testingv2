// ============================================================================
// WHAT A TEAM POSTS BACK — five figures, per scope, and nothing else.
//
// ⚠ THE FULL ResultSet IS FAR TOO LARGE TO POST. It carries every line's
// decisions echoed, the reinsurance layer breakdown, the claim register slices
// and the whole funding derivation — 422 KB for a WC-only team-year, 858 KB
// across three lines, measured. The host's table needs to know who is an outlier
// and roughly how; it does not need the register.
//
// ⚠ AND THE FULL RESULT IS NOT LOST — IT IS JUST NOT SHARED. Every browser holds
// its own complete GameState with every locked ResultSet in it, because every
// browser ran processYear itself. What crosses the wire is the scoreboard.
//
// ⚠ EVERY FIELD IS A RESULT_METRICS KEY. See TeamYearFigures in the contract for
// the field-by-field mapping and for why poolPremium replaced grossPremium.
//
// ⚠ PER LINE AS WELL AS POOLED, BECAUSE TEAMS PLAY DIFFERENT BOOKS. A pooled
// figure blends different things for different teams once each picks its own
// lines, so the host's table is comparable only on a line view — and a line view
// needs the line's own slice. Only the lines the team WRITES get an entry;
// absence is what lets the table say "does not write GL" rather than showing a
// zero somebody could read as a result.
// ============================================================================

import type { CoverageLine, LineResultSet, PoolState, ResultSet } from '../../types/simulation';
import { exhibitRows, poolExhibitRows, type ExhibitRow } from '../../utils/actuarialMemo';
import type { DevelopedUltimates, TeamYearFigures, TeamYearSummary } from '../contract';

function figuresOf(r: LineResultSet): TeamYearFigures {
  return {
    endingSurplus: r.endingSurplus,
    actualLossRatioPricingBasis: r.actualLossRatioPricingBasis,
    poolPremium: r.poolPremium,
    activeMembers: r.activeMembers,
    selectedFundingConfidenceLevel: r.selectedFundingConfidenceLevel,
    netUltimateLoss: r.netUltimateLoss,
  };
}

/**
 * ⚠ THE DEVELOPED COLUMN COMES OUT OF THE MEMORANDUM'S OWN READER, NOT OUT OF A
 * SECOND ONE. exhibitRows is what the Actuarial memorandum's development
 * exhibit is built from; it carries the clamping rule that a closed cohort's
 * last recorded figure IS its estimate at every later valuation, which a naive
 * `ultimateByValuation.at(-1)` gets right by accident and a naive index gets
 * wrong the first time a cohort closes. poolExhibitRows is the same function's
 * pool aggregation, with its own rule about partial sums. A host's chart and a
 * team's own memorandum therefore cannot disagree about what a year now costs.
 *
 * ⚠ ACCIDENT YEARS BELOW 0 ARE DROPPED AFTER the pool sum, not before it: the
 * pre-game years and the seeded cohorts are off the session's axis, but they are
 * real rows and dropping them earlier would change nothing and risk implying
 * they are not part of the ledger. They are; they are just not plottable.
 */
function developedAt(poolState: PoolState, lines: CoverageLine[], asAt: number): {
  pool: DevelopedUltimates;
  byLine: Partial<Record<CoverageLine, DevelopedUltimates>>;
} {
  const onAxis = (rows: ExhibitRow[]): DevelopedUltimates => {
    const out: DevelopedUltimates = {};
    for (const row of rows) if (row.yearNumber >= 0) out[String(row.yearNumber)] = row.current;
    return out;
  };

  const perLine: ExhibitRow[][] = [];
  const byLine: Partial<Record<CoverageLine, DevelopedUltimates>> = {};
  for (const line of lines) {
    const rows = exhibitRows(poolState.lines[line]?.reserveDevelopment ?? [], asAt);
    perLine.push(rows);
    byLine[line] = onAxis(rows);
  }
  return { pool: onAxis(poolExhibitRows(perLine)), byLine };
}

/**
 * ⚠ poolState IS THE VALUATION, AND IT IS WHY THIS TAKES A SECOND ARGUMENT. The
 * ResultSet describes the year that was just played; the reserve ledger lives on
 * the pool state and holds every PRIOR accident year restated as at that same
 * year. One is the year's own news, the other is what the news did to everything
 * before it, and the second cannot be read off the first.
 */
export function summarize(r: ResultSet, lines: CoverageLine[], poolState: PoolState): TeamYearSummary {
  const byLine: Partial<Record<CoverageLine, TeamYearFigures>> = {};
  for (const line of lines) {
    const slice = r.byLine[line];
    // A line the team does not write has no slice to report. Skipping it rather
    // than writing zeroes is the entire basis of the host table's "absent" state.
    if (slice) byLine[line] = figuresOf(slice);
  }
  return {
    yearNumber: r.yearNumber,
    calendarYear: r.calendarYear,
    pool: figuresOf(r),
    byLine,
    developed: developedAt(poolState, lines, r.yearNumber),
  };
}
