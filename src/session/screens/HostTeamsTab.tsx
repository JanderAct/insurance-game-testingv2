// ============================================================================
// THE TEAMS TAB — one row per team, scanned for outliers.
//
// ⚠ A SUMMARY, NOT THE TEAM'S PAGES. Five figures and a name. The host is
// looking for who is in trouble, not diagnosing why; the per-team drill-down is
// a later tab and deliberately not this one.
//
// ⚠ THE LINE VIEW IS WHAT MAKES THE TABLE COMPARABLE AT ALL. Teams pick their
// own lines, so a pooled surplus blends a WC-only book with a three-line book
// and the column stops meaning one thing. On a line view every figure in a
// column is the same line. The Pool view still shows the aggregate, which is
// what the aggregate means everywhere else in this app — it is the right answer
// to a different question, not a worse answer to this one.
//
// ⚠ THREE STATES, AND THEY ARE STRUCTURALLY DIFFERENT RATHER THAN DIFFERENTLY
// COLOURED. This is the same distinction the Membership page draws, and it was
// worth more than a shade there too:
//
//   ABSENT   the team does not write this line. Not zero, and not late. The row
//            collapses to ONE cell saying so, because five dashes across five
//            numeric columns is exactly the thing somebody reads as a result.
//   PENDING  the team writes it and has not posted this year yet. Also one cell,
//            naming the year it is waiting on.
//   REPORTED five numbers.
//
// A row in any of the three is still a row: the team is always listed, because
// "which teams exist" is not the question any of these three answers.
//
// ⚠ IT SHOWS THE LAST COMPLETED YEAR, NOT THE CURRENT ONE. Results describe a
// year already played, so the host advances to year N and teams then report
// N-1. Between advances that is the newest thing there is, and a host waiting on
// a slow team should be reading it rather than a blank.
// ============================================================================

import { useState } from 'react';
import { Layers, HardHat, Scale, Building2 } from 'lucide-react';
import TabNav from '../../components/TabNav';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { colorForRatio, colorForSurplus, formatCurrency, formatPct } from '../../utils/formatters';
import type { CoverageLine, LineView } from '../../types/simulation';
import type { RoomView, TeamYearFigures, TeamView } from '../index';

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

type RowState =
  | { kind: 'absent' }
  | { kind: 'pending' }
  | { kind: 'reported'; figures: TeamYearFigures };

/**
 * ⚠ THE WHOLE POINT OF THIS FUNCTION IS THE ORDER OF ITS CHECKS. Absence is
 * decided BEFORE lateness: a team that does not write GL is not "late on GL",
 * and never will be, so asking whether it has reported would be asking the wrong
 * question of it forever.
 */
function rowState(team: TeamView, view: LineView, reportingYear: number): RowState {
  if (view !== 'pool' && !team.lines.includes(view)) return { kind: 'absent' };

  const posted = team.lastResult;
  if (!posted || posted.yearNumber !== reportingYear) return { kind: 'pending' };

  const figures = view === 'pool' ? posted.pool : posted.byLine[view];
  // A team that writes the line but whose posted summary has no slice for it is
  // pending rather than absent — the summary predates the line, not the team.
  if (!figures) return { kind: 'pending' };
  return { kind: 'reported', figures };
}

interface Props {
  room: RoomView;
}

export default function HostTeamsTab({ room }: Props) {
  const [view, setView] = useState<LineView>('pool');

  // Only the lines SOMEBODY writes are worth offering: a room where nobody took
  // Property has no Property column to compare.
  const linesInPlay = LINE_ORDER.filter(l => room.teams.some(t => t.lines.includes(l)));
  const effectiveView: LineView = view !== 'pool' && !linesInPlay.includes(view) ? 'pool' : view;

  const reportingYear = room.currentYear - 1;
  const teams = room.teams;

  if (teams.length === 0) {
    return (
      <p data-testid="teams-empty" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        No teams have joined yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* The same line-view bar the game uses, from the same component. */}
      <TabNav<LineView>
        tabs={[
          { id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool },
          ...linesInPlay.map(l => ({ id: l as LineView, label: LINE_FULL_NAME[l], icon: LINE_VIEW_ICONS[l] })),
        ]}
        activeTab={effectiveView}
        onSelect={setView}
        stickyTop={0}
        zIndex={10}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-medium text-slate-700">
            {effectiveView === 'pool' ? 'Pool' : LINE_FULL_NAME[effectiveView]}
          </p>
          <p data-testid="teams-year" className="text-xs text-slate-400">
            {reportingYear < 1
              ? 'No year completed yet'
              : `Year ${reportingYear} — the last completed year`}
          </p>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-2 font-medium">Team</th>
              <th className="px-5 py-2 font-medium">Surplus</th>
              <th className="px-5 py-2 font-medium">Loss ratio</th>
              <th className="px-5 py-2 font-medium">Premium</th>
              <th className="px-5 py-2 font-medium">Members</th>
              <th className="px-5 py-2 font-medium">Funding</th>
            </tr>
          </thead>
          <tbody data-testid="teams-table">
            {teams.map(t => {
              const state = rowState(t, effectiveView, reportingYear);
              return (
                <tr key={t.name} className="border-t border-slate-50">
                  <td className="px-5 py-2.5">
                    <span className="text-slate-700">{t.name}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{t.lines.join('+')}</span>
                  </td>

                  {state.kind === 'absent' && (
                    // ⚠ ONE CELL, IN WORDS. Nothing here can be read as a
                    // number, which is the requirement.
                    <td colSpan={5} data-testid={`absent-${t.name}`} className="px-5 py-2.5 text-xs italic text-slate-400">
                      does not write {effectiveView === 'pool' ? '' : effectiveView}
                    </td>
                  )}

                  {state.kind === 'pending' && (
                    <td colSpan={5} data-testid={`pending-${t.name}`} className="px-5 py-2.5 text-xs text-amber-600">
                      {reportingYear < 1 ? 'no year played yet' : `year ${reportingYear} not reported yet`}
                    </td>
                  )}

                  {state.kind === 'reported' && (
                    <>
                      <td data-testid={`surplus-${t.name}`} className={`px-5 py-2.5 font-mono ${colorForSurplus(state.figures.endingSurplus)}`}>
                        {formatCurrency(state.figures.endingSurplus, true)}
                      </td>
                      <td data-testid={`ratio-${t.name}`} className={`px-5 py-2.5 font-mono ${colorForRatio(state.figures.actualLossRatioPricingBasis)}`}>
                        {formatPct(state.figures.actualLossRatioPricingBasis)}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-slate-700">
                        {formatCurrency(state.figures.poolPremium, true)}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-slate-700">
                        {state.figures.activeMembers}
                      </td>
                      <td className="px-5 py-2.5 font-mono text-slate-700">
                        {formatPct(state.figures.selectedFundingConfidenceLevel, 0)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
          {effectiveView === 'pool'
            ? 'Pooled figures. Teams writing different lines are not directly comparable here — pick a line above.'
            : `Every figure is ${effectiveView}, so the column compares like with like.`}
        </p>
      </div>
    </div>
  );
}
