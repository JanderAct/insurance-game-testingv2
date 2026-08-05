// Membership-history ledger: the authoritative record of per-member, per-line
// enrollment intervals, carried on PoolState and maintained by processYear
// (live years) and the pre-game bootstrap.
//
// WHY THIS EXISTS — DO NOT ANSWER PER-LINE QUESTIONS FROM Member.status.
// The shared allMarketMembers list carries ONE status field per member, but
// enrollment is PER LINE: "active in WC, withdrawn from Property" cannot be
// represented in a single status. In live years that field is folded
// sequentially per line (the last-processed line's copy wins), so a member
// withdrawn from a later-processed line while still active in an earlier one
// reads 'withdrawn' on the shared list — the documented roster fold
// (CALIBRATION_FINDINGS findings 2/5). Any per-line eligibility rule (the
// 2-year re-enrollment cooldown especially) must therefore read EXCLUSIVELY
// from this ledger, never from Member.status. Strict "active if active in
// any line" OR-semantics is an opening-assembly property only.
//
// Interval semantics: startYear/endYear are ACTIVE yearNumbers, inclusive
// (pre-game years negative). A member withdrawn during year Y's movement was
// last active in Y-1 (endYear = Y-1); a member joining during year Y is
// active in Y (startYear = Y). endYear null = currently enrolled.
//
// Degenerate-but-meaningful edge: an OPENING enrollee withdrawn during the
// very first simulated year closes with endYear = startYear - 1 — an empty
// active span (they entered the year enrolled but didn't finish it). Kept,
// not deleted: wasActiveInLine correctly reports no active year, while
// canReenroll still applies the cooldown from the real withdrawal year.
// Integrity checks must therefore allow endYear >= startYear - 1.
//
// Member.yearJoined is LOSSY relative to this ledger, not merely imprecise:
// opening enrollees are stamped yearJoined: 1 as a display convention ("was
// here when the game started"), while their ledger interval truthfully starts
// at the first pre-game year. At Y1 a genuine recruit and an opening member
// both read yearJoined: 1 — indistinguishable by scalar alone. That is why
// the scalar can never be promoted to an authoritative field (repairing it to
// the true year would surface pre-game internals in the UI), and why every
// enrollment question must come here instead.

import type { CoverageLine, EnrollmentInterval, MembershipHistory } from '../types/simulation';

// Per-line re-enrollment cooldown: a member withdrawn during year W (i.e.
// last active W-1, endYear = W-1) sits out years W and W+1 — two full years —
// and may re-enroll from year W+2 onward. In endYear terms: year >= endYear + 3.
export const REENROLLMENT_COOLDOWN_YEARS = 2;

// Deep-clone the ledger so a processing pass can mutate its working copy
// without aliasing the prior year's persisted state.
export function cloneMembershipHistory(history: MembershipHistory): MembershipHistory {
  const out: MembershipHistory = {};
  for (const [memberId, byLine] of Object.entries(history)) {
    const lineCopy: Partial<Record<CoverageLine, EnrollmentInterval[]>> = {};
    for (const [line, intervals] of Object.entries(byLine) as [CoverageLine, EnrollmentInterval[]][]) {
      lineCopy[line] = intervals.map(iv => ({ ...iv }));
    }
    out[memberId] = lineCopy;
  }
  return out;
}

function intervalsFor(history: MembershipHistory, memberId: string, line: CoverageLine): EnrollmentInterval[] {
  return history[memberId]?.[line] ?? [];
}

// Open a new interval (member joined `line` and is active from startYear).
// Mutates `history` (call on a working clone). No-op if the latest interval
// is already open — a member re-recruited in the same year it was withdrawn
// never left the active roster for a full year, so no transition is recorded.
export function openInterval(history: MembershipHistory, memberId: string, line: CoverageLine, startYear: number): void {
  const byLine = (history[memberId] ??= {});
  const intervals = (byLine[line] ??= []);
  const last = intervals[intervals.length - 1];
  if (last && last.endYear === null) return;
  intervals.push({ startYear, endYear: null });
}

// Close the open interval (member withdrawn during lastActiveYear + 1).
// Mutates `history` (call on a working clone). No-op without an open interval.
export function closeInterval(history: MembershipHistory, memberId: string, line: CoverageLine, lastActiveYear: number): void {
  const intervals = history[memberId]?.[line];
  const last = intervals?.[intervals.length - 1];
  if (!last || last.endYear !== null) return;
  last.endYear = lastActiveYear;
}

// Was this member active in this line during this year? Works for any
// member/line/year combination, including pre-game years and members with
// multiple past intervals.
export function wasActiveInLine(history: MembershipHistory, memberId: string, line: CoverageLine, year: number): boolean {
  return intervalsFor(history, memberId, line).some(
    iv => year >= iv.startYear && (iv.endYear === null || year <= iv.endYear)
  );
}

// May this member (re-)enroll in this line in `year` under the per-line
// cooldown? True if never enrolled; false while enrolled (open interval);
// after a withdrawal, true once the two-year cooldown has elapsed
// (withdrawal year W = endYear + 1; eligible from W + REENROLLMENT_COOLDOWN_YEARS).
export function canReenroll(history: MembershipHistory, memberId: string, line: CoverageLine, year: number): boolean {
  const intervals = intervalsFor(history, memberId, line);
  if (intervals.length === 0) return true;
  const last = intervals[intervals.length - 1];
  if (last.endYear === null) return false;
  const withdrawalYear = last.endYear + 1;
  return year >= withdrawalYear + REENROLLMENT_COOLDOWN_YEARS;
}
