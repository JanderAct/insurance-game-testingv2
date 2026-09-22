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

import type { CoverageLine, LineResultSet, ResultSet } from '../../types/simulation';
import type { TeamYearFigures, TeamYearSummary } from '../contract';

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

export function summarize(r: ResultSet, lines: CoverageLine[]): TeamYearSummary {
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
  };
}
