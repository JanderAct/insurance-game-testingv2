// ============================================================================
// THE FIVE RISK-CONTROL TILES — compact, in the pool-wide card, where the
// retired intensity slider used to sit.
//
// ⚠ INERT. These tiles take no value, emit no change, and touch no decision
// field. Nothing here does anything yet.
//
// ⚠ AND THE SLIDER THEY REPLACE IS GONE. Until two commits ago the Loss
// Prevention card carried a live "Risk Control Investment" slider.
// `decisions.riskControlPct` REMAINS in the decision set, is still read by the
// engine, and is now pinned at its default of 0 — so the pool spends nothing on
// risk control until these tiles are given the field. The control went, not the
// decision. Do not wire a tile to riskControlPct as a half-step; the intended
// path is ONE commit that gives them the field outright.
//
// ============================================================================
// ⚠ THEY ARE NOT MUTUALLY EXCLUSIVE, AND THE UNDERWRITING ROWS THEY COPY ARE.
//
// The visual reference is DecisionsPage's PreviewBox rows — Renew All / Decline
// above 2.50x, and Open through No New Business. Those are ONE choice from a
// set, and their whole design says so: exactly one tile carries the blue
// `selected` state, so the row reads as a dial with positions.
//
// These are five INDEPENDENT programs. A pool can buy all five, none, or any
// mixture, and reading them as a pick-one would be reading the opposite of the
// mechanic. Three things keep them apart, and the first is the load-bearing one:
//
//   1. NO SELECTED STATE EXISTS HERE AT ALL. PreviewBox is deliberately NOT
//      reused. It takes a `selected` boolean and paints exactly one tile blue;
//      importing it would have made the pick-one reading the default and left
//      only the caption to argue against it.
//   2. EACH TILE CARRIES ITS OWN STATUS SLOT rather than sharing one highlight.
//      Today every slot reads "Not active" because nothing is wired. When these
//      become live that slot is where per-tile on/off goes — five independent
//      states, which is a shape a single shared highlight cannot express.
//   3. A ONE-LINE CAPTION SAYS IT IN WORDS. The visual grammar does the work,
//      but a player should not have to infer the rule from styling.
//
// ⚠ AND THEY ARE DIVS, NOT BUTTONS, WHICH IS ALSO A TEST DECISION. An inert
// button is a lie about interactivity, and it would put five new entries into
// the button role on a page two session drivers query by button name. One tile
// is called "Property Mitigation"; the drivers' line-tab regex is anchored
// (/^Property$/) so it would not match today, but a div cannot collide at all
// and costs nothing.
//
// ⚠ THE CARD TITLE MUST NOT CONTAIN THE STRING "Risk Control Investment", and
// the reason OUTLIVED the slider. full-session.cjs and replay-fidelity.cjs find
// a slider by walking UP from every range input looking for its label text in an
// ancestor within five levels. Both were repointed to "Funding Confidence Level"
// when the slider went, so neither searches for the old label now — but this
// card shares a grid with Investment Allocation, and the next range input added
// to that grid would inherit the trap. The title is "Risk Control Programs".
//
// ============================================================================
// WHAT THE FULL COPY NEEDS BEFORE IT CAN MOVE OFF THIS TILE.
//
// `what` and `why` on each category are no longer rendered — the tile carries
// NAME and TERM only. They are still in the catalog, unused, waiting for a Risk
// Control department page. For the next commit to be a MOVE rather than a
// rewrite, that page needs:
//
//   1. A ROUTE AND A TAB. DepartmentsPage exists and is already in the tab list
//      every driver walks; a Risk Control section under it needs no new tab and
//      no change to solo-oracle's TABS array. A NEW top-level tab would change
//      that array in four drivers and move every tab-count assertion.
//   2. NOTHING ELSE FROM THIS FILE. The catalog is already the single source —
//      `what`, `why`, `status`, commitmentLabel() and benefitLabel() are all
//      exported and all currently unused by this component. The department page
//      imports the same array and renders the fields this tile drops.
//   3. A DECISION ABOUT `benefitLabel`. It is the one piece of copy that is
//      arguably a tile concern rather than a department one; it is dropped here
//      because "Benefit ramps over years 1-3" does not fit a compact tile, not
//      because it belongs on another page.
//
// So the move is: render `what`, `why` and benefitLabel() on the department
// page, and delete nothing from the catalog.
// ============================================================================

import { Layers } from 'lucide-react';
import {
  RISK_CONTROL_PLACEHOLDER_ANNUAL_COST, availableCategories, commitmentLabel, totalAnnualCost,
  type RiskControlCategory,
} from '../data/riskControlCategories';
import {
  WIRED_PROGRAM_IDS, GL_ANALYTICS_BUILD_YEARS, glAnalyticsStanding, type ProgramStanding,
} from '../utils/riskControlPrograms';
import { formatCurrency } from '../utils/formatters';
import type { CoverageLine } from '../types/simulation';

const WIRED = new Set<string>(WIRED_PROGRAM_IDS);

/** The status slot's words, for a program that is wired. */
function standingLabel(st: ProgramStanding): string {
  if (!st.committed) return st.benefitFraction > 0 ? 'Lapsing' : 'Not active';
  if (st.maintaining) return 'Maintained';
  return `Year ${st.tenure} of ${GL_ANALYTICS_BUILD_YEARS}`;
}

const SCOPE_STYLE: Record<string, string> = {
  WC: 'bg-sky-100 text-sky-700',
  GL: 'bg-violet-100 text-violet-700',
  Property: 'bg-amber-100 text-amber-700',
  Pool: 'bg-gray-200 text-gray-600',
};

// ⚠ ONE TILE IS A BUTTON AND FOUR ARE STILL DIVS, AND THE SPLIT IS THE POINT.
// The header above says an inert button is a lie about interactivity. That
// argument has not changed — it has simply stopped applying to ONE tile. The
// four unwired programs stay divs because they still do nothing; the moment any
// of them is wired it becomes a button by the same rule.
//
// ⚠ THE ACCESSIBLE NAME IS THE PROGRAM'S TILE NAME AND NOTHING ELSE, which is
// what keeps it out of the drivers' way. Two session drivers query this page by
// button name; the names they use are 'Decisions', the line labels (anchored
// /^Property$/) and /Lock Year/. "Law Enforcement Analytics" collides with none
// of them, and the four names that might have — 'Property Mitigation' above all
// — are the four that are still divs.
function CategoryTile({ c, standing, onToggle, disabled }: {
  c: RiskControlCategory;
  standing?: ProgramStanding;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  const live = standing !== undefined && onToggle !== undefined;
  const on = standing?.committed ?? false;
  const cost = live && standing
    ? (standing.committed ? standing.annualCost : RISK_CONTROL_PLACEHOLDER_ANNUAL_COST)
    : RISK_CONTROL_PLACEHOLDER_ANNUAL_COST;

  const body = (
    <>
      <span className={`text-[10px] font-semibold px-1.5 rounded ${SCOPE_STYLE[c.scope]}`}>{c.scope}</span>
      {/* tileName, not name — the full name heads the department page and does
          not fit a tile five-across. See the catalog's own note on the pair. */}
      <span className="font-bold text-gray-800 mt-1 leading-tight">{c.tileName}</span>
      <span className="text-xs opacity-75 mt-0.5 leading-tight">{commitmentLabel(c)}</span>
      <span className="text-xs font-semibold text-gray-700 mt-0.5">
        {formatCurrency(cost)}/yr
      </span>
      <span className={`text-[10px] mt-1 ${on ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>
        {standing ? standingLabel(standing) : 'Not active'}
      </span>
    </>
  );

  const shell = 'w-full h-full flex flex-col items-center p-2 rounded-lg border text-center text-xs';
  if (!live) {
    return <div className={`${shell} border-gray-200 bg-white text-gray-600`}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className={`${shell} transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        on ? 'border-blue-500 bg-blue-50 text-gray-700' : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
      }`}
    >
      {body}
    </button>
  );
}

export default function RiskControlCategoryBoxes({
  activeLines, programIds, priorProgramIds, onProgramsChange, disabled = false,
}: {
  activeLines: readonly CoverageLine[];
  /** Programs committed for the year being edited. Absent on read-only hosts. */
  programIds?: readonly string[];
  /** The committed lists of every PLAYED year, oldest first. */
  priorProgramIds?: readonly (readonly string[] | undefined)[];
  onProgramsChange?: (ids: string[]) => void;
  disabled?: boolean;
}) {
  // ⚠ THE SAME availableCategories THE DEPARTMENT PAGE CALLS, not a second
  // filter written to match it. The page tells the player that line-specific
  // programs appear only if the pool writes that coverage; two independent
  // filters would be two things to keep in step, and the screen contradicting
  // the page is exactly the failure the shared helper prevents.
  const shown = availableCategories(activeLines);
  const live = programIds !== undefined && onProgramsChange !== undefined;
  const standing = live ? glAnalyticsStanding(programIds, priorProgramIds ?? []) : undefined;

  const toggle = (id: string) => {
    if (!live || !onProgramsChange) return;
    const set = new Set(programIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    onProgramsChange([...set]);
  };

  // What the pool is actually committed to THIS year, which is not the same as
  // what the menu would cost — see the two lines below the grid.
  const committedCost = standing?.committed ? standing.annualCost : 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-blue-600"><Layers size={14} /></span>
        <span className="text-sm font-semibold text-gray-700">Risk Control Programs</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        {shown.map(c => {
          const wired = live && WIRED.has(c.id);
          return (
            <CategoryTile
              key={c.id}
              c={c}
              standing={wired ? standing : undefined}
              onToggle={wired ? () => toggle(c.id) : undefined}
              disabled={disabled}
            />
          );
        })}
      </div>
      {/* ⚠ TWO TOTALS, AND THEY ANSWER DIFFERENT QUESTIONS. One is what the
          pool is CHARGED this year — a real spend that now leaves cash and
          underwriting income. The other is what the whole menu would cost if
          every program were live and selected, which is still mostly
          hypothetical: four of the five are unwired and cannot be committed at
          all. Showing only the second would have reported a menu price as
          though it were a bill. */}
      <div className="flex items-baseline justify-between border-t border-gray-200 pt-2">
        <span className="text-[11px] text-gray-500">Committed this year</span>
        <span className={`text-sm font-bold ${committedCost > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
          {formatCurrency(committedCost)}/yr
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-gray-400">
          All {shown.length} available programs, if selected
        </span>
        <span className="text-xs font-semibold text-gray-500">
          {formatCurrency(totalAnnualCost(activeLines))}/yr
        </span>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Five independent programs — a pool can run any, all or none of them.
        {/* ⚠ "the others", NOT "the other four". The grid is GATED, so a GL-only
            pool is shown THREE tiles and a sentence naming four contradicts the
            screen it sits under. Caught by reading the rendered card on a
            GL-only pool, where it said "the other four" beside two of them. */}
        {live ? ' Law Enforcement Analytics is live; the others are not yet buyable.' : ''}
      </p>
    </div>
  );
}
