// ============================================================================
// RISK CONTROL, AS FIVE CATEGORIES INSTEAD OF ONE INTENSITY DIAL.
//
// ⚠ NOTHING READS THIS BUT THE DISPLAY. IT IS INERT AT THIS COMMIT.
//
// The live control is still SLIDER_RANGES.riskControlPct — one pool-wide
// percentage of premium, in the decision set, reaching the loss draw through
// riskControlEffectiveness. This file describes what is intended to REPLACE it
// and is deliberately wired to nothing: no engine path reads it, no decision
// field corresponds to it, and `grep riskControlCategories src/utils src/types`
// returns nothing. If that stops being true, this header is wrong.
//
// WHY IT SHIPS INERT. Risk control reaches the DRAW. Deleting the slider and
// replacing it with boxes that do nothing would remove a working lever and move
// both value baselines for what is, this commit, a display change. Instead the
// slider keeps working and keeps spending while these boxes are rearranged; ONE
// later commit swaps the spend across and removes the slider, and no commit in
// between has to put a lever back.
//
// ============================================================================
// WHAT THE CATEGORIES ARE FOR, AND WHY THEY ARE NOT ONE NUMBER.
//
// A dial says "spend 4% of premium on safety" and cannot express the two things
// that make risk control a real decision for a public-entity pool:
//
//   1. IT IS BOUGHT IN PROGRAMS, NOT IN INTENSITY. A pool commits to a
//      three-year return-to-work program; it does not commit to 4%.
//   2. THE BENEFIT ARRIVES ON THE PROGRAM'S OWN CLOCK. WC safety pays back
//      quickly because WC losses report quickly. Liability losses emerge over
//      years, so law-enforcement analytics cannot pay back in year one whatever
//      is spent. A capital system pays back NOTHING until it is finished.
//
// A single intensity dial collapses all three timings into one, which is what
// makes the current control unteachable: the player cannot get the timing wrong,
// so they cannot learn it.
//
// ============================================================================
// ⚠ MULTI-YEAR COMMITMENTS DEFAULT TO CONTINUING, AND THAT IS THE POINT.
//
// A player chooses to STOP, not to continue. That is how a real program
// behaves — nobody re-signs a safety consultant every January — and it is the
// only arrangement under which abandoning a program partway is a decision the
// player has to actually make rather than one they make by forgetting. The
// opt-out is also where the teaching is: stopping a three-year program in
// year two should cost the years already spent.
//
// NONE OF THAT BEHAVIOR IS BUILT. `commitmentYears` and `benefit` below are
// DESCRIPTIONS for the display, not a schedule the engine runs.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

/** Which book a category's spend and benefit land on. 'Pool' is every line. */
export type RiskControlScope = CoverageLine | 'Pool';

/** How the benefit arrives once the money is committed. DISPLAY ONLY. */
export type BenefitShape =
  /** Full effect from the first year of the commitment. */
  | 'immediate'
  /** Builds across the years of the commitment — slow-emerging losses. */
  | 'ramped'
  /** Nothing until the commitment completes, then the full effect. */
  | 'onCompletion';

export interface RiskControlCategory {
  id: string;
  name: string;
  scope: RiskControlScope;
  /**
   * Years the commitment runs.
   *
   * ⚠ WAS `number | readonly [number, number]`, AND THE RANGE IS GONE BECAUSE
   * NOTHING USES IT. Claims Management was the only range at 2-4 years and is
   * now a fixed 3, so the tuple arm and commitmentLabel's Array.isArray branch
   * were both dead. Removed with the data change rather than left as a shape
   * waiting for a case that no longer exists.
   */
  commitmentYears: number;
  /** Whether it re-commits by default — see the opt-out note above. */
  renewal: 'opt-out' | 'yearly';
  benefit: BenefitShape;
  /** One line on what the money buys. */
  what: string;
  /** One line on WHY the timing is what it is. This is the teaching. */
  why: string;
  /** ⚠ 'placeholder' means the scoping itself is not settled, not that the
   *  code is missing — every entry here is missing its code. */
  status: 'scoped' | 'placeholder';
}

export const RISK_CONTROL_CATEGORIES: readonly RiskControlCategory[] = [
  {
    id: 'wc-safety-rtw',
    name: 'Safety and Return to Work',
    scope: 'WC',
    commitmentYears: 3,
    renewal: 'opt-out',
    benefit: 'immediate',
    what: 'On-site safety program and a managed return-to-work path for injured employees.',
    why: 'WC losses report and close quickly, so a program that shortens time away shows up '
      + 'in the same years it runs.',
    status: 'scoped',
  },
  {
    id: 'gl-law-enforcement-analytics',
    name: 'Law Enforcement Analytics',
    scope: 'GL',
    commitmentYears: 3,
    renewal: 'opt-out',
    benefit: 'ramped',
    what: 'Early-warning analytics on use-of-force and complaint patterns, with intervention.',
    why: 'Liability losses emerge over years, so the benefit builds across years one to three '
      + 'rather than arriving with the first invoice.',
    status: 'scoped',
  },
  {
    id: 'property-mitigation',
    name: 'Property Mitigation',
    scope: 'Property',
    commitmentYears: 2,
    renewal: 'opt-out',
    benefit: 'immediate',
    what: 'Roof, water and wind hardening on the highest-value locations.',
    why: 'Scoping not settled — the two-year term and the benefit shape are both placeholders.',
    status: 'placeholder',
  },
  {
    id: 'claims-management-system',
    name: 'Claims Management System',
    scope: 'Pool',
    commitmentYears: 3,
    renewal: 'opt-out',
    benefit: 'onCompletion',
    what: 'Capital build of a claims system: intake, adjuster workflow, and reserving discipline.',
    why: 'Capital spend across two to four years that returns NOTHING until it is finished — '
      + 'abandoning it partway wastes every year already paid.',
    status: 'scoped',
  },
  {
    id: 'member-services',
    name: 'Member Services',
    scope: 'Pool',
    commitmentYears: 1,
    renewal: 'yearly',
    benefit: 'immediate',
    what: 'Training, hotlines and advisory hours available to every member.',
    why: 'Bought and consumed within the year, so it carries no commitment and is decided afresh '
      + 'each year.',
    status: 'scoped',
  },
];

/**
 * The programs a pool can actually be offered, given the lines it writes.
 *
 * ⚠ THIS IS A MECHANIC AND NOT COPY. The department page states that
 * line-specific programs are only available if the pool provides that coverage.
 * If the tiles did not gate, the page would say something the screen
 * contradicts, so BOTH read this one function — a GL-only pool sees three
 * programs, a three-line pool sees five.
 *
 * It is a filter over data that was already there: every entry has carried a
 * `scope` since the catalog was written, so nothing new is stored to make this
 * work and there is no second list to keep in step.
 */
export function availableCategories(
  activeLines: readonly CoverageLine[],
): readonly RiskControlCategory[] {
  return RISK_CONTROL_CATEGORIES.filter(
    c => c.scope === 'Pool' || activeLines.includes(c.scope),
  );
}

/** "3 years", "1 year", "Yearly". DISPLAY ONLY. */
export function commitmentLabel(c: RiskControlCategory): string {
  if (c.renewal === 'yearly') return 'Yearly';
  return `${c.commitmentYears} year${c.commitmentYears === 1 ? '' : 's'}`;
}

/** How the benefit arrives, in words. DISPLAY ONLY. */
export function benefitLabel(c: RiskControlCategory): string {
  switch (c.benefit) {
    case 'immediate': return 'Benefit from year one';
    case 'ramped': return 'Benefit ramps over years 1-3';
    case 'onCompletion': return 'No benefit until complete';
  }
}
