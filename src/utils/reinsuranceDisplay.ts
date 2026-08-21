// WHICH REINSURANCE PRODUCT DOES A LINE HAVE, AND HOW IS IT NAMED.
//
// ONE definition, shared by every readout, because a display that picks the
// wrong product is the failure mode this module exists to prevent. As of
// Property's own occurrence layer and aggregate, all three lines run the
// PER-OCCURRENCE TOWER (WC and Property additionally carry an aggregate
// stop-loss; GL does not — see reinsuranceTower.ts's header on why).
//
// REINSURANCE_PROGRAMS / `reinsuranceLevel` ARE NOW DEAD FOR EVERY LINE. Left
// in place — and `usesTower` left as a real function rather than collapsed to
// `true` — only because their removal is its own commit, after netting, same
// as the WC/GL cutover's own sequencing.
//
// ⚠ DO NOT READ `reinsuranceLevel` ANYWHERE IN THE UI. The field is still on
// LineDecisionSet and still carries whatever value it was last set to, so it
// renders perfectly happily as "Moderate" on a line whose product is a layer
// tower. That is exactly the class of defect the combined-ratio readout
// was — a display showing a plausible number that means nothing — and it went
// unnoticed for weeks. Branch through `usesTower` instead.

import { REINSURANCE_TOWER, AGG_ATTACHMENT_LEVELS, TOWER_TOP, type TowerLine } from '../data/reinsuranceTower';
import { REINSURANCE_PROGRAMS } from '../data/defaultAssumptions';
import type { CoverageLine, LineDecisionSet, LineView } from '../types/simulation';
import { normalizeLayersPlaced } from './reinsuranceTower';

// The seam, stated once. Mirrors simulationEngine's `isClaimLine`/`usesTower`
// — if that ever changes, this must change with it. Always true today (every
// CoverageLine is a TowerLine), kept as a real predicate rather than inlined
// so a future fourth line has somewhere to say no.
export const usesTower = (line: CoverageLine | LineView): line is TowerLine =>
  line === 'WC' || line === 'GL' || line === 'Property';

// WC and Property are the only lines with an aggregate stop-loss.
const hasAggregate = (line: CoverageLine | LineView): line is 'WC' | 'Property' =>
  line === 'WC' || line === 'Property';

// For readouts that have NO line in scope (narrativeEngine, resultMetrics,
// deriveAnnualStatement all take a result, not a line). `cededByLayer` is
// populated by the tower and left EMPTY on Property, so its width is a reliable
// in-band discriminator.
//
// PREFER `usesTower(line)` WHERE A LINE IS AVAILABLE. This exists because
// threading a line parameter through those three signatures would touch more
// surface than the readout fix is worth; it is not the better test.
export const resultUsesTower = (r: { cededByLayer?: number[] }): boolean =>
  (r.cededByLayer?.length ?? 0) > 0;

// Short one-line summary of what was actually bought. Used wherever the old code
// printed "2 — Moderate".
export function placementSummary(
  line: CoverageLine,
  decisions: Pick<LineDecisionSet, 'layersPlaced' | 'aggregateStopLevel' | 'reinsuranceLevel'>,
): string {
  if (!usesTower(line)) {
    const prog = REINSURANCE_PROGRAMS[decisions.reinsuranceLevel];
    return `${decisions.reinsuranceLevel} — ${prog?.label ?? 'Unknown'}`;
  }
  const layers = REINSURANCE_TOWER[line];
  const placed = normalizeLayersPlaced(line, decisions.layersPlaced);
  const bought = layers.filter((_, i) => placed[i]).map(l => l.name);
  const agg = hasAggregate(line) && decisions.aggregateStopLevel >= 0
    ? ` + agg @ ${(AGG_ATTACHMENT_LEVELS[line][decisions.aggregateStopLevel] * 100).toFixed(0)}%`
    : '';
  if (!bought.length) return `Full retention — no layers placed${agg}`;
  return `${bought.join(' + ')}${agg}`;
}

// Compact machine-friendly form for the spreadsheet export's csv column.
export function placementCode(
  line: CoverageLine,
  decisions: Pick<LineDecisionSet, 'layersPlaced' | 'aggregateStopLevel' | 'reinsuranceLevel'>,
): string {
  if (!usesTower(line)) return String(decisions.reinsuranceLevel);
  const placed = normalizeLayersPlaced(line, decisions.layersPlaced);
  const bits = placed.map((on, i) => on ? `L${i + 1}` : '').filter(Boolean).join('+') || 'NONE';
  const agg = hasAggregate(line) && decisions.aggregateStopLevel >= 0 ? `+AGG${decisions.aggregateStopLevel}` : '';
  return bits + agg;
}

// The band above the top of the tower — GL's is the pool's largest single
// exposure and cannot be transferred at any price. The caveat travels WITH the
// number, because the band is unbounded (GL severity is Pareto alpha 1.3) and a
// mean over it has no valid confidence interval.
export const RETAINED_ABOVE_TOWER_CAVEAT =
  'Retained above the top of the tower — cannot be reinsured at any price. ' +
  'Mean is INDICATIVE ONLY: the band is unbounded, so it has no valid confidence interval.';

export const towerTopLabel = (line: CoverageLine): string =>
  usesTower(line) ? `$${TOWER_TOP[line] / 1e6}M` : '—';
