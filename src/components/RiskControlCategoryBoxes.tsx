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
import { formatCurrency } from '../utils/formatters';
import type { CoverageLine } from '../types/simulation';

const SCOPE_STYLE: Record<string, string> = {
  WC: 'bg-sky-100 text-sky-700',
  GL: 'bg-violet-100 text-violet-700',
  Property: 'bg-amber-100 text-amber-700',
  Pool: 'bg-gray-200 text-gray-600',
};

function CategoryTile({ c }: { c: RiskControlCategory }) {
  return (
    <div className="w-full h-full flex flex-col items-center p-2 rounded-lg border border-gray-200 bg-white text-center text-xs text-gray-600">
      <span className={`text-[10px] font-semibold px-1.5 rounded ${SCOPE_STYLE[c.scope]}`}>{c.scope}</span>
      {/* tileName, not name — the full name heads the department page and does
          not fit a tile five-across. See the catalog's own note on the pair. */}
      <span className="font-bold text-gray-800 mt-1 leading-tight">{c.tileName}</span>
      <span className="text-xs opacity-75 mt-0.5 leading-tight">{commitmentLabel(c)}</span>
      <span className="text-xs font-semibold text-gray-700 mt-0.5">
        {formatCurrency(RISK_CONTROL_PLACEHOLDER_ANNUAL_COST)}/yr
      </span>
      <span className="text-[10px] text-gray-400 mt-1">Not active</span>
    </div>
  );
}

export default function RiskControlCategoryBoxes({ activeLines }: { activeLines: readonly CoverageLine[] }) {
  // ⚠ THE SAME availableCategories THE DEPARTMENT PAGE CALLS, not a second
  // filter written to match it. The page tells the player that line-specific
  // programs appear only if the pool writes that coverage; two independent
  // filters would be two things to keep in step, and the screen contradicting
  // the page is exactly the failure the shared helper prevents.
  const shown = availableCategories(activeLines);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-blue-600"><Layers size={14} /></span>
        <span className="text-sm font-semibold text-gray-700">Risk Control Programs</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        {shown.map(c => <CategoryTile key={c.id} c={c} />)}
      </div>
      {/* ⚠ WHAT SELECTING THEM WOULD COST, NOT A SPEND. Nothing is bought:
          the tiles are inert and riskControlPct is pinned at 0, so the pool's
          actual risk-control spend this year is zero. GATED like the tiles —
          a one-line pool is offered three programs, so its total is $3M. */}
      <div className="flex items-baseline justify-between border-t border-gray-200 pt-2">
        <span className="text-[11px] text-gray-500">
          All {shown.length} available programs, if selected
        </span>
        <span className="text-sm font-bold text-gray-800">
          {formatCurrency(totalAnnualCost(activeLines))}/yr
        </span>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Five independent programs — a pool can run any, all or none of them.
      </p>
    </div>
  );
}
