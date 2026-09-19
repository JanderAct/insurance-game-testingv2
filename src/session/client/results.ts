// ============================================================================
// WHAT A TEAM POSTS BACK — a summary, not the whole ResultSet.
//
// ⚠ THE FULL ResultSet IS FAR TOO LARGE TO POST. It carries every line's
// decisions echoed, the reinsurance layer breakdown, the claim register slices
// and the whole funding derivation. Three teams times ten years of those would
// be megabytes in a store whose realistic budget is about five, and the repo
// already runs a save-size gate for exactly this reason. The host's table needs
// to know WHO HAS REPORTED and roughly how they are doing; it does not need the
// register.
//
// ⚠ AND THE FULL RESULT IS NOT LOST — IT IS JUST NOT SHARED. Every browser holds
// its own complete GameState with every locked ResultSet in it, because every
// browser ran processYear itself. What crosses the wire is the scoreboard.
// ============================================================================

import type { ResultSet } from '../../types/simulation';
import type { JsonValue } from '../contract';

export interface TeamYearSummary {
  yearNumber: number;
  calendarYear: number;
  grossPremium: number;
  netIncurredLoss: number;
  netIncome: number;
  endingSurplus: number;
  activeMembers: number;
  memberSatisfaction: number;
}

export function summarize(r: ResultSet): TeamYearSummary {
  return {
    yearNumber: r.yearNumber,
    calendarYear: r.calendarYear,
    grossPremium: r.grossPremium,
    netIncurredLoss: r.netIncurredLoss,
    netIncome: r.netIncome,
    endingSurplus: r.endingSurplus,
    activeMembers: r.activeMembers,
    memberSatisfaction: r.memberSatisfaction,
  };
}

export function summaryToJson(s: TeamYearSummary): JsonValue {
  return { ...s } as unknown as JsonValue;
}

export function summaryFromJson(v: JsonValue): TeamYearSummary {
  return v as unknown as TeamYearSummary;
}
