// ============================================================================
// THE CHARTS TAB — three lines over time, one line per team.
//
// ⚠ IT EXISTS BECAUSE THE TEAMS TAB CANNOT ANSWER "WHEN". That table is one
// year wide by design: five figures for the last completed year, scanned for who
// is in trouble now. A host also wants the shape — who has been sliding since
// year 2, whose surplus recovered, whether everybody's losses moved together
// (a shock) or one team's did (a decision). That is a line over years, and no
// arrangement of a one-year table gives it.
//
// ⚠ AND IT IS THE REASON THE ROOM NOW KEEPS EVERY YEAR. Results were ONE SLOT
// per team, overwritten on every post — the same defect the decision history
// fixed, in a different field. A table of the newest year was happy with it; a
// line over time cannot be drawn from it at all. The history came first in this
// commit, and these charts read TeamView.resultsByYear directly.
//
// ⚠ THE THREE STATES ARE THE TEAMS TAB'S THREE STATES, DRAWN INSTEAD OF WRITTEN,
// AND A CHART MAKES THE DISTINCTION MATTER MORE RATHER THAN LESS:
//
//   ABSENT   the team does not write this line. NO LINE AT ALL, and the team is
//            named in the legend as not writing it. A line at zero would read as
//            a team with no surplus rather than a team that is not in this line.
//   PENDING  the team writes the line and has not posted the year. The line
//            STOPS at the last year it did post; it does not travel to zero,
//            because a line to zero reads as a collapse. A year missing in the
//            MIDDLE breaks the line rather than being bridged — a bridge would
//            draw a value nobody played.
//   REPORTED a point, joined to its neighbours.
//
// ⚠ THE X-AXIS IS FIXED AT SETUP AND STARTS AT YEAR 0. A five-year game draws 0
// through 5 from the moment the room exists, whatever has been played. Two
// things follow, and both were wrong while the axis grew with the game: the
// lines stopped rescaling on every advance (a team's surplus used to move on
// screen because ANOTHER team's year had landed), and how much game is left
// became visible instead of implied.
//
// ⚠ YEAR 0 IS THE OPENING POSITION, AND IT IS A REAL ENGINE YEAR RATHER THAN A
// ZERO. The pre-game runs through processYear and numbers its last year 0 —
// which is why an opening surplus, an opening roster and an opening reserve
// exist at all — so all three charts have a genuine value there, losses
// included. It is POSTED like any other year (see useSessionGame): the host
// holds a seed and never runs the engine, and each team's opening differs
// anyway, because it is the sum over the lines that team chose.
//
// ⚠ COLOUR FOLLOWS THE TEAM, NOT ITS POSITION IN THE CHART. The hue is taken by
// the team's index in the room's team list, so switching the line view — which
// changes WHICH teams have a line — never repaints the survivors. A host who has
// learned that Cedar Valley is the orange one keeps that on every view.
//
// ⚠ IDENTITY IS NEVER COLOUR ALONE. The palette is validated for colour-vision
// deficiency (scripts/validate_palette.js in the dataviz skill, ALL CHECKS PASS
// on the light surface), and three of its hues still carry a contrast warning
// against white, which obliges visible labels rather than a shrug. So: a legend
// always, and the series named at its own right-hand end whenever four or fewer
// are drawn.
// ============================================================================

import { useState } from 'react';
import { BarChart3, Layers, HardHat, Scale, Building2 } from 'lucide-react';
import TabNav from '../../components/TabNav';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { formatCurrency } from '../../utils/formatters';
import type { CoverageLine, LineView } from '../../types/simulation';
import type { RoomView, TeamYearFigures, TeamView } from '../index';

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

/**
 * ⚠ VALIDATED, NOT CHOSEN BY EYE. These eight are the dataviz skill's
 * categorical theme on a light surface; the validator passes the lightness band,
 * the chroma floor, the adjacent-pair separation under all three CVD
 * simulations, and the normal-vision floor. They are assigned IN ORDER and never
 * cycled: a ninth team would need a different answer (facets, or an "other"),
 * and a generated ninth hue is exactly the thing that breaks the guarantee.
 */
const TEAM_COLORS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
];

// ---------------------------------------------------------------- the metrics

/**
 * ⚠ EVERY ONE IS A RESULT_METRICS KEY, READ OFF THE POSTED SUMMARY. The charts
 * do not compute anything: they plot what the teams published. Losses is
 * netUltimateLoss — "Net Ultimate Loss + LAE" in the list. See TeamYearFigures
 * for why it is that field and not netIncurredLoss, which is not in the list.
 */
interface Metric {
  id: string;
  title: string;
  note: string;
  pick: (f: TeamYearFigures) => number;
  format: (v: number) => string;
  /** Money quantities anchor at zero; a member count does not. */
  anchorZero: boolean;
  /** Surplus is the one that can go negative, and the sign is the whole story. */
  zeroRule: boolean;
}

const METRICS: Metric[] = [
  {
    id: 'surplus',
    title: 'Ending surplus',
    note: 'RESULT_METRICS · endingSurplus',
    pick: f => f.endingSurplus,
    format: v => formatCurrency(v, true),
    anchorZero: true,
    zeroRule: true,
  },
  {
    id: 'members',
    title: 'Active members',
    note: 'RESULT_METRICS · activeMembers',
    pick: f => f.activeMembers,
    format: v => String(Math.round(v)),
    // ⚠ NOT ANCHORED AT ZERO, DELIBERATELY. Every pool has dozens of members, so
    // a zero-anchored axis would squash the churn that is the only thing this
    // chart is for. The axis is labelled, and no member count is near zero.
    anchorZero: false,
    zeroRule: false,
  },
  {
    id: 'losses',
    title: 'Net ultimate loss + LAE',
    note: 'RESULT_METRICS · netUltimateLoss',
    pick: f => f.netUltimateLoss,
    format: v => formatCurrency(v, true),
    anchorZero: true,
    zeroRule: false,
  },
];

// ---------------------------------------------------------------- series

type TeamState =
  | { kind: 'absent' }
  | { kind: 'silent' }                               // writes the line, has posted nothing
  | { kind: 'drawn'; years: number[] };              // the years it has posted

interface TeamSeries {
  team: TeamView;
  color: string;
  state: TeamState;
  /** Year -> that year's figures, on the current view. Empty unless 'drawn'. */
  byYear: Map<number, TeamYearFigures>;
}

/**
 * ⚠ ABSENCE IS DECIDED BEFORE SILENCE, the same order the Teams tab uses. A team
 * that does not write GL is not "late on GL" and never will be.
 */
function seriesFor(team: TeamView, color: string, view: LineView, years: number[]): TeamSeries {
  if (view !== 'pool' && !team.lines.includes(view)) {
    return { team, color, state: { kind: 'absent' }, byYear: new Map() };
  }
  const byYear = new Map<number, TeamYearFigures>();
  for (const y of years) {
    const posted = team.resultsByYear?.[String(y)];
    if (!posted) continue;
    const figures = view === 'pool' ? posted.pool : posted.byLine[view];
    if (figures) byYear.set(y, figures);
  }
  const drawn = [...byYear.keys()].sort((a, b) => a - b);
  return {
    team,
    color,
    state: drawn.length === 0 ? { kind: 'silent' } : { kind: 'drawn', years: drawn },
    byYear,
  };
}

// ---------------------------------------------------------------- scales

/** A domain on 1/2/5 steps, so the axis labels are numbers a person would say. */
function niceScale(min: number, max: number, anchorZero: boolean): { lo: number; hi: number; ticks: number[] } {
  let lo = anchorZero ? Math.min(0, min) : min;
  let hi = anchorZero ? Math.max(0, max) : max;
  // ⚠ A SERIES THAT NEVER MOVES IS CENTRED, NOT FLOORED. Every pool holds a
  // similar member count, so the members chart is often flat; growing the domain
  // upwards only would print the line along the bottom rule, which reads as a
  // number near the axis minimum rather than as a number that did not change.
  if (hi === lo) {
    const pad = Math.abs(lo || 1) * 0.1 + 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? 10 * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo, hi, ticks };
}

// ---------------------------------------------------------------- one chart

const W = 760, H = 240, M = { top: 14, right: 118, bottom: 38, left: 74 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

interface ChartProps {
  metric: Metric;
  series: TeamSeries[];
  years: number[];
  /** Direct end labels are for a readable few; beyond that the legend carries it. */
  directLabels: boolean;
}

function LineChart({ metric, series, years, directLabels }: ChartProps) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const drawn = series.filter(s => s.state.kind === 'drawn');
  const values = drawn.flatMap(s => [...s.byYear.values()].map(metric.pick));

  if (values.length === 0) {
    return (
      <figure className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <figcaption className="text-sm font-medium text-slate-700">{metric.title}</figcaption>
        <p data-testid={`chart-empty-${metric.id}`} className="py-10 text-center text-sm text-slate-400">
          Nothing reported on this view yet.
        </p>
      </figure>
    );
  }

  const { lo, hi, ticks } = niceScale(Math.min(...values), Math.max(...values), metric.anchorZero);
  const x = (year: number) =>
    M.left + (years.length === 1 ? PLOT_W / 2 : ((year - years[0]) / (years[years.length - 1] - years[0])) * PLOT_W);
  const y = (v: number) => M.top + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;

  // ⚠ CONSECUTIVE RUNS, NOT ONE POLYLINE. A year missing in the middle ends the
  // run and starts a new one, so the gap stays a gap. Bridging it would draw a
  // straight line through a year the team never posted, which is a value.
  const runsOf = (s: TeamSeries): number[][] => {
    const runs: number[][] = [];
    let run: number[] = [];
    for (const yr of years) {
      if (s.byYear.has(yr)) run.push(yr);
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    return runs;
  };

  // ⚠ TWO TEAMS ENDING ON THE SAME NUMBER IS THE NORMAL CASE, NOT THE EDGE ONE —
  // teams that made similar decisions finish close together, which is exactly
  // when the host wants to read both names. Labels are nudged apart down the
  // right-hand margin, keeping their order, so a tie prints twice rather than
  // once on top of itself.
  const GAP = 13;
  const labels = drawn
    .map(s => {
      const last = (s.state as { kind: 'drawn'; years: number[] }).years.slice(-1)[0];
      return { name: s.team.name, color: s.color, anchor: y(metric.pick(s.byYear.get(last)!)) };
    })
    .sort((a, b) => a.anchor - b.anchor)
    .map(l => ({ ...l, at: l.anchor }));
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].at - labels[i - 1].at < GAP) labels[i].at = labels[i - 1].at + GAP;
  }
  const overflow = labels.length ? labels[labels.length - 1].at - (M.top + PLOT_H) : 0;
  if (overflow > 0) for (const l of labels) l.at -= overflow;

  const hoverRows = hoverYear === null
    ? []
    : drawn
        .filter(s => s.byYear.has(hoverYear))
        .map(s => ({ name: s.team.name, color: s.color, value: metric.pick(s.byYear.get(hoverYear)!) }));

  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">{metric.title}</span>
        <span className="font-mono text-[11px] text-slate-300">{metric.note}</span>
      </figcaption>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`${metric.title} by year, one line per team`}
          data-testid={`chart-${metric.id}`}
          onMouseLeave={() => setHoverYear(null)}
          onMouseMove={e => {
            const box = e.currentTarget.getBoundingClientRect();
            const vx = ((e.clientX - box.left) / box.width) * W;
            let best = years[0], bestD = Infinity;
            for (const yr of years) {
              const d = Math.abs(x(yr) - vx);
              if (d < bestD) { bestD = d; best = yr; }
            }
            setHoverYear(best);
          }}
        >
          {/* Recessive grid: the data is the ink, the frame is not. */}
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.left} x2={M.left + PLOT_W} y1={y(t)} y2={y(t)} stroke="#f1f5f9" strokeWidth={1} />
              <text x={M.left - 8} y={y(t) + 3.5} textAnchor="end" className="fill-slate-400" fontSize={10}>
                {metric.format(t)}
              </text>
            </g>
          ))}

          {metric.zeroRule && lo < 0 && hi > 0 && (
            // Surplus crossing zero is a different fact from surplus falling, and
            // the axis should say so without a colour.
            <line x1={M.left} x2={M.left + PLOT_W} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
          )}

          <line x1={M.left} x2={M.left + PLOT_W} y1={M.top + PLOT_H} y2={M.top + PLOT_H} stroke="#e2e8f0" strokeWidth={1} />
          {years.map(yr => (
            <text key={yr} x={x(yr)} y={H - 22} textAnchor="middle" className="fill-slate-400" fontSize={10}>
              {yr}
            </text>
          ))}
          <text x={M.left + PLOT_W / 2} y={H - 6} textAnchor="middle" className="fill-slate-300" fontSize={10}>
            year
          </text>

          {hoverYear !== null && hoverRows.length > 0 && (
            <line x1={x(hoverYear)} x2={x(hoverYear)} y1={M.top} y2={M.top + PLOT_H} stroke="#cbd5e1" strokeWidth={1} />
          )}

          {drawn.map(s => (
            <g key={s.team.name}>
              {runsOf(s).map((run, i) => (
                <polyline
                  key={i}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={run.map(yr => `${x(yr)},${y(metric.pick(s.byYear.get(yr)!))}`).join(' ')}
                />
              ))}
              {[...s.byYear.keys()].map(yr => (
                // A 2px surface ring keeps overlapping markers legible where two
                // teams cross.
                <circle
                  key={yr}
                  cx={x(yr)}
                  cy={y(metric.pick(s.byYear.get(yr)!))}
                  r={4}
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              ))}
            </g>
          ))}

          {directLabels && labels.map(l => (
            <g key={l.name}>
              {/* A leader from the series' true end to a nudged label, so the
                  nudge never reassigns a name to the wrong line. */}
              {Math.abs(l.at - l.anchor) > 1 && (
                <line
                  x1={M.left + PLOT_W} y1={l.anchor}
                  x2={M.left + PLOT_W + 8} y2={l.at}
                  stroke={l.color} strokeWidth={1} opacity={0.5}
                />
              )}
              <circle cx={M.left + PLOT_W + 12} cy={l.at} r={3.5} fill={l.color} />
              {/* ⚠ THE LABEL WEARS INK, NOT THE SERIES COLOUR. The dot beside it
                  carries identity; coloured text is the part that fails against a
                  white surface, and three of these hues carry a contrast warning
                  precisely there. */}
              <text x={M.left + PLOT_W + 21} y={l.at + 3.5} className="fill-slate-600" fontSize={11}>
                {l.name.length > 16 ? l.name.slice(0, 15) + '…' : l.name}
              </text>
            </g>
          ))}
        </svg>

        {hoverYear !== null && hoverRows.length > 0 && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(x(hoverYear) / W) * 100}%`, top: 0 }}
          >
            <p className="mb-1 font-medium text-slate-500">Year {hoverYear}</p>
            {hoverRows.map(r => (
              <p key={r.name} className="flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.name}
                <span className="ml-auto pl-3 font-mono">{metric.format(r.value)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- the tab

interface Props {
  room: RoomView;
}

export default function HostChartsTab({ room }: Props) {
  const [view, setView] = useState<LineView>('pool');

  const linesInPlay = LINE_ORDER.filter(l => room.teams.some(t => t.lines.includes(l)));
  const effectiveView: LineView = view !== 'pool' && !linesInPlay.includes(view) ? 'pool' : view;

  // ⚠ THE AXIS IS THE GAME, NOT THE PROGRESS. A five-year game draws 0 through
  // 5 from the moment the room is created. An axis that grew a year at a time
  // rescaled every line on every advance — the same team's surplus moved on
  // screen because somebody else's year had landed — and it hid how much game
  // was left. Fixed at setup, a line that stops early leaves VISIBLE empty
  // space, which is the honest rendering of a team that has not reported.
  const years: number[] = [];
  for (let y = 0; y <= room.yearCount; y++) years.push(y);
  // The last year anybody could have posted — what "behind" is measured against.
  const lastPlayable = room.currentYear - 1;

  if (room.teams.length === 0) {
    return (
      <p data-testid="charts-empty" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
        No teams have joined yet.
      </p>
    );
  }

  const series = room.teams.map((t, i) => seriesFor(t, TEAM_COLORS[i % TEAM_COLORS.length], effectiveView, years));
  const directLabels = series.filter(s => s.state.kind === 'drawn').length <= 4;

  return (
    <div className="space-y-4">
      {/* ⚠ ONE FILTER ROW ABOVE ALL THREE CHARTS, not one per chart. The three
          are the same teams on the same years; a view that differed between them
          would be three questions pretending to be one screen. */}
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

      {/* ⚠ THE LEGEND IS ALSO WHERE THE OTHER TWO STATES ARE SAID. A team with no
          line on the chart has a reason, and the reason is not the same reason
          twice: it either does not write this line or has not reported yet. */}
      <div data-testid="charts-legend" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-xs">
        {series.map(s => (
          <span key={s.team.name} className="flex items-center gap-1.5">
            {s.state.kind === 'drawn' ? (
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            ) : (
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-slate-300" />
            )}
            <span className={s.state.kind === 'drawn' ? 'text-slate-700' : 'text-slate-400'}>{s.team.name}</span>
            {s.state.kind === 'absent' && (
              <span data-testid={`chart-absent-${s.team.name}`} className="italic text-slate-400">
                does not write {effectiveView === 'pool' ? 'any line' : effectiveView}
              </span>
            )}
            {s.state.kind === 'silent' && (
              <span data-testid={`chart-silent-${s.team.name}`} className="text-amber-600">
                nothing reported yet
              </span>
            )}
            {s.state.kind === 'drawn' && s.state.years[s.state.years.length - 1] < lastPlayable && (
              // PENDING, and the line stopping is only half of saying so. "Through
              // year 0" would be a strange way to say a team has played nothing,
              // so the opening-only case says that instead.
              <span data-testid={`chart-pending-${s.team.name}`} className="text-amber-600">
                {s.state.years[s.state.years.length - 1] === 0
                  ? 'opening position only'
                  : `through year ${s.state.years[s.state.years.length - 1]}`}
              </span>
            )}
          </span>
        ))}
      </div>

      {METRICS.map(m => (
        <LineChart key={m.id} metric={m} series={series} years={years} directLabels={directLabels} />
      ))}

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
        <BarChart3 size={12} />
        {effectiveView === 'pool'
          ? 'Pooled figures. Teams writing different lines are not directly comparable here — pick a line above.'
          : `Every line is ${effectiveView}, so the charts compare like with like.`}
      </p>
    </div>
  );
}
