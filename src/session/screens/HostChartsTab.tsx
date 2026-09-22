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
// ⚠ LOSSES ARE TWO CHARTS, BECAUSE ONE OF THEM CANNOT SHOW WHAT HAPPENS TO A
// LOSS. netUltimateLoss is the accident year AS BOOKED — measured, it is bit-for
// -bit the reserve ledger's opening column — and under forward booking a year is
// booked far below the register it will develop into. Plotting only that draws a
// line of FIRST ESTIMATES: on a ten-year WC game every one of those points was
// later restated upwards, by 1.2x at age 2 and 1.85x by age 12, and none of that
// appeared anywhere on the chart.
//
//   AS BOOKED     each accident year at the estimate it was posted with. Frozen.
//                 What the team knew at the time, and what it priced off.
//   AS DEVELOPED  the same accident years at the CURRENT valuation. Every point
//                 moves each year as the prior years develop, which is forward
//                 booking made visible.
//
// ⚠ AND THEY SHARE ONE y-DOMAIN, WHICH IS NOT A DETAIL. Two charts of the same
// quantity, each scaled to its own box, look alike — the reader sees two similar
// shapes rather than one sitting far above the other. The comparison IS the
// height difference, so the domain is computed across both.
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
 * ⚠ THE CHARTS COMPUTE NOTHING; THEY PLOT WHAT THE TEAMS PUBLISHED. Three of the
 * four read a RESULT_METRICS key off the posted figures. The fourth —
 * losses AS DEVELOPED — reads the posted developed column, which is deliberately
 * NOT a metric key: see DevelopedUltimates in the contract for why forcing it
 * into that list would be a worse mistake than leaving it out of it.
 *
 * ⚠ AND THE TWO LOSS CHARTS ARE ONE READING, WHICH IS WHY THEY SHARE A SCALE.
 * As booked is the accident year frozen at what it was thought to cost when it
 * happened; as developed is the same years at today's valuation. Given separate
 * y-domains the two would look alike — both rescale to fill their own box — and
 * the growth, which is the entire point, would be invisible. `scaleGroup` puts
 * them on one domain computed over both.
 */
interface Metric {
  id: string;
  title: string;
  note: string;
  /** Where the value comes from: a year's own figures, or the developed column. */
  source: 'figures' | 'developed';
  pick: (f: TeamYearFigures) => number;
  format: (v: number) => string;
  /** Money quantities anchor at zero; a member count does not. */
  anchorZero: boolean;
  /** Surplus is the one that can go negative, and the sign is the whole story. */
  zeroRule: boolean;
  /** Charts sharing a group share one y-domain, computed across all of them. */
  scaleGroup?: string;
  /** A line under the title, when the chart needs a sentence rather than a label. */
  subtitle?: string;
  /**
   * ⚠ THE LOSS CHARTS' x IS THE ACCIDENT YEAR, NOT THE GAME YEAR, and saying so
   * matters most on the developed chart: its points are all valued NOW, so
   * reading its x as "when" would suggest a year-by-year history of one figure.
   */
  xLabel?: string;
}

const METRICS: Metric[] = [
  {
    id: 'surplus',
    title: 'Ending surplus',
    note: 'RESULT_METRICS · endingSurplus',
    source: 'figures',
    pick: f => f.endingSurplus,
    format: v => formatCurrency(v, true),
    anchorZero: true,
    zeroRule: true,
  },
  {
    id: 'members',
    title: 'Active members',
    note: 'RESULT_METRICS · activeMembers',
    source: 'figures',
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
    title: 'Losses — as booked',
    note: 'RESULT_METRICS · netUltimateLoss',
    subtitle: 'What each accident year was estimated at when it was played. Frozen; never revised.',
    xLabel: 'accident year',
    source: 'figures',
    pick: f => f.netUltimateLoss,
    format: v => formatCurrency(v, true),
    anchorZero: true,
    zeroRule: false,
    scaleGroup: 'loss',
  },
  {
    // ⚠ THE ONE CHART WHOSE OLD POINTS MOVE. Every other line here is a record
    // of what was posted; this one is re-reported in full every year, so year
    // 3's point in year 8 is what year 3 is NOW thought to cost. That is forward
    // booking made visible: claims are booked at an initial estimate well below
    // the drawn register and develop up towards it, so a chart of first
    // estimates alone shows none of it.
    id: 'developed',
    title: 'Losses — as developed',
    note: 'reserveDevelopment · ultimateByValuation (NOT a RESULT_METRICS key)',
    subtitle: 'The same accident years at their CURRENT valuation. Every point moves as prior years develop.',
    xLabel: 'accident year',
    source: 'developed',
    pick: f => f.netUltimateLoss,   // unused on this source; the column is read directly
    format: v => formatCurrency(v, true),
    anchorZero: true,
    zeroRule: false,
    scaleGroup: 'loss',
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
  /**
   * ⚠ ONE COLUMN, FROM THE NEWEST POST THAT HAS ONE — not a year-by-year read.
   * Every post restates every accident year, so the newest post IS the current
   * valuation of all of them; taking each year's own post instead would rebuild
   * the frozen series and draw the as-booked chart twice.
   */
  developed: Map<number, number>;
}

/**
 * ⚠ ABSENCE IS DECIDED BEFORE SILENCE, the same order the Teams tab uses. A team
 * that does not write GL is not "late on GL" and never will be.
 */
function seriesFor(team: TeamView, color: string, view: LineView, years: number[]): TeamSeries {
  if (view !== 'pool' && !team.lines.includes(view)) {
    return { team, color, state: { kind: 'absent' }, byYear: new Map(), developed: new Map() };
  }
  const byYear = new Map<number, TeamYearFigures>();
  for (const y of years) {
    const posted = team.resultsByYear?.[String(y)];
    if (!posted) continue;
    const figures = view === 'pool' ? posted.pool : posted.byLine[view];
    if (figures) byYear.set(y, figures);
  }

  // The newest post carrying a developed column wins; a post written before the
  // column existed has none, which is absence rather than an empty valuation.
  const developed = new Map<number, number>();
  for (let i = years.length - 1; i >= 0; i--) {
    const posted = team.resultsByYear?.[String(years[i])];
    const column = view === 'pool' ? posted?.developed?.pool : posted?.developed?.byLine[view];
    if (!column) continue;
    for (const [ay, v] of Object.entries(column)) {
      const n = Number(ay);
      if (Number.isFinite(n) && Number.isFinite(v)) developed.set(n, v);
    }
    break;
  }

  const drawn = [...byYear.keys()].sort((a, b) => a - b);
  return {
    team,
    color,
    state: drawn.length === 0 ? { kind: 'silent' } : { kind: 'drawn', years: drawn },
    byYear,
    developed,
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

/**
 * What a chart plots for one team: a year (or ACCIDENT year) to a value. Drawn
 * from the year's own figures, or from the developed column, per the metric.
 */
function pointsOf(metric: Metric, s: TeamSeries): Map<number, number> {
  if (metric.source === 'developed') return s.developed;
  const out = new Map<number, number>();
  for (const [yr, f] of s.byYear) out.set(yr, metric.pick(f));
  return out;
}

interface ChartProps {
  metric: Metric;
  series: TeamSeries[];
  years: number[];
  /** Direct end labels are for a readable few; beyond that the legend carries it. */
  directLabels: boolean;
  /** Imposed when this chart shares a scale with another; otherwise its own. */
  domain?: { lo: number; hi: number; ticks: number[] };
}

function LineChart({ metric, series, years, directLabels, domain }: ChartProps) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const drawn = series
    .filter(s => s.state.kind === 'drawn')
    .map(s => ({ s, points: pointsOf(metric, s) }))
    .filter(d => d.points.size > 0);
  const values = drawn.flatMap(d => [...d.points.values()]);

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

  const { lo, hi, ticks } = domain ?? niceScale(Math.min(...values), Math.max(...values), metric.anchorZero);
  const x = (year: number) =>
    M.left + (years.length === 1 ? PLOT_W / 2 : ((year - years[0]) / (years[years.length - 1] - years[0])) * PLOT_W);
  const y = (v: number) => M.top + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;

  // ⚠ CONSECUTIVE RUNS, NOT ONE POLYLINE. A year missing in the middle ends the
  // run and starts a new one, so the gap stays a gap. Bridging it would draw a
  // straight line through a year the team never posted, which is a value.
  const runsOf = (points: Map<number, number>): number[][] => {
    const runs: number[][] = [];
    let run: number[] = [];
    for (const yr of years) {
      if (points.has(yr)) run.push(yr);
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
    .map(({ s, points }) => {
      const last = [...points.keys()].sort((a, b) => a - b).slice(-1)[0];
      return { name: s.team.name, color: s.color, anchor: y(points.get(last)!) };
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
        .filter(d => d.points.has(hoverYear))
        .map(d => ({ name: d.s.team.name, color: d.s.color, value: d.points.get(hoverYear)! }));

  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <figcaption>
        {/* Title and provenance on one line; the sentence gets its own, so a
            long one cannot wrap around the note and interleave with it. */}
        <span className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium text-slate-700">{metric.title}</span>
          <span className="shrink-0 font-mono text-[11px] text-slate-300">{metric.note}</span>
        </span>
        {metric.subtitle && (
          <span className="mt-0.5 block text-[11px] text-slate-400">{metric.subtitle}</span>
        )}
      </figcaption>

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`${metric.title} by ${metric.xLabel ?? 'year'}, one line per team`}
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
            {metric.xLabel ?? 'year'}
          </text>

          {hoverYear !== null && hoverRows.length > 0 && (
            <line x1={x(hoverYear)} x2={x(hoverYear)} y1={M.top} y2={M.top + PLOT_H} stroke="#cbd5e1" strokeWidth={1} />
          )}

          {drawn.map(({ s, points }) => (
            <g key={s.team.name}>
              {runsOf(points).map((run, i) => (
                <polyline
                  key={i}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={run.map(yr => `${x(yr)},${y(points.get(yr)!)}`).join(' ')}
                />
              ))}
              {[...points.keys()].map(yr => (
                // A 2px surface ring keeps overlapping markers legible where two
                // teams cross.
                <circle
                  key={yr}
                  cx={x(yr)}
                  cy={y(points.get(yr)!)}
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

  // ⚠ ONE DOMAIN ACROSS A SCALE GROUP, COMPUTED BEFORE ANY OF ITS CHARTS DRAWS.
  // The two loss charts are the same quantity at two valuations, so a reader
  // compares them by height. Left to themselves each would fill its own box and
  // the pair would look identical — the as-developed chart would show its own
  // shape rather than its distance from the booked one.
  const sharedDomains: Record<string, { lo: number; hi: number; ticks: number[] }> = {};
  for (const group of new Set(METRICS.map(m => m.scaleGroup).filter((g): g is string => !!g))) {
    const members = METRICS.filter(m => m.scaleGroup === group);
    const values = series
      .filter(s => s.state.kind === 'drawn')
      .flatMap(s => members.flatMap(m => [...pointsOf(m, s).values()]));
    if (values.length === 0) continue;
    sharedDomains[group] = niceScale(Math.min(...values), Math.max(...values), members[0].anchorZero);
  }

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
        <LineChart
          key={m.id}
          metric={m}
          series={series}
          years={years}
          directLabels={directLabels}
          domain={m.scaleGroup ? sharedDomains[m.scaleGroup] : undefined}
        />
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
