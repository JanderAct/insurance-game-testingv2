// ============================================================================
// THE YEAR-0 ROSTER — one implementation, both callers.
//
// ⚠ WHAT THIS REPLACES WAS `poolState.lines.WC.members`, UNCONDITIONALLY. That
// read WC's roster whatever the game was, so a GL-only or Property-only pool
// opened with an EMPTY membership page, and a WC+GL pool opened showing 65 of
// its 112 members and then jumped to 112 the moment year 1 locked. The first was
// invisible until teams could choose their own lines; the second has been wrong
// since the second line existed.
//
// ⚠ IT MUST BE THE SAME KIND OF OBJECT AS `result.memberList`, BECAUSE THAT IS
// WHAT REPLACES IT. MembershipPage reads `last ? last.memberList : initialMembers`
// — one expression, two sources — so the year-0 value has to be built the way
// aggregateLineResults builds the pool row: the DEDUPLICATED UNION across active
// lines, in setup.activeLines order, because a member carrying WC and GL is one
// member however many lines they hold. Measured against the real year-1 pool row
// on five configurations: same count and same id order on every one.
//
// ⚠ AND IT IS NOT ENGINE CODE. Nothing here feeds processYear or
// runPriorHistory; initialMembers has exactly one reader in the whole tree
// (MembershipPage's pre-year-1 fallback) and the diagnostics pass `[]` for it.
// That is why correcting it cannot move a baseline — see the commit message.
// ============================================================================

import type { CoverageLine, Member, PoolState } from '../types/simulation';

/**
 * ⚠ ONE LINE'S OPENING MEMBERS, AND IT IS DERIVED RATHER THAN STORED. The union
 * above is what App holds in state and writes to the save; a per-line breakdown
 * cannot be recovered from it afterwards, because Member.exposureByLine is a
 * CATALOG ATTRIBUTE (every member has payroll and a TIV whatever they buy) and
 * not an enrolment record — the type says so next to yearJoined.
 *
 * So it is not persisted. poolState IS in the save, this is a pure function of
 * it, and recomputing costs a filter. Storing a second copy would have changed
 * the save shape to answer a question the save can already answer.
 */
export function openingRosterForLine(poolState: PoolState, line: CoverageLine): Member[] {
  return poolState.lines[line].members.filter(m => m.status === 'active');
}

export function openingRoster(poolState: PoolState, activeLines: CoverageLine[]): Member[] {
  const seen = new Set<string>();
  const roster: Member[] = [];
  for (const line of activeLines) {
    for (const m of poolState.lines[line].members) {
      if (m.status !== 'active') continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      roster.push(m);
    }
  }
  return roster;
}
