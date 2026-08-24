// WHICH REINSURANCE PRODUCT DOES A LINE HAVE, AND HOW IS IT NAMED.
//
// ONE definition, shared by every readout, because a display that picks the
// wrong product is the failure mode this module exists to prevent. As of
// Property's own occurrence layer and aggregate, all three lines run the
// PER-OCCURRENCE TOWER (WC and Property additionally carry an aggregate
// stop-loss; GL does not — see reinsuranceTower.ts's header on why).
//
// REINSURANCE_PROGRAMS / `reinsuranceLevel` / reinsuranceEngine.ts ARE GONE.
// Property was the model's last consumer and now runs its own tower like WC
// and GL. `hasTractableCeded` is kept as a real function rather than
// collapsed to `true`, so a future line without a closed-form E[ceded] has
// somewhere to say no.

import { REINSURANCE_TOWER, AGG_ATTACHMENT_LEVELS, TOWER_TOP, type TowerLine } from '../data/reinsuranceTower';
import type { CoverageLine, LineDecisionSet, LineView } from '../types/simulation';
import { normalizeLayersPlaced } from './reinsuranceTower';

// ============================================================================
// THE SEAM, STATED ONCE. Renamed from `usesTower`, which named the MECHANISM
// and hid what actually rides on it.
//
// The capability is: THIS LINE'S REINSURANCE HAS A CLOSED-FORM EXPECTED CEDED
// LOSS. A per-occurrence layer structure over a fitted severity distribution
// has one (towerMoments integrates it band by band); a percentage-of-premium
// quota share does not, because its cession is a function of the realised
// annual aggregate with no tractable expectation to deduct.
//
// ⚠ IT IS ONE CAPABILITY, NOT SEVERAL SHARING A FLAG, AND MUST NOT BE SPLIT.
// Netting the pool premium requires a tractable E[ceded]; a tractable E[ceded]
// requires the layer structure; the layer structure is also what cedes the
// realised claims. Splitting this into separate flags would make expressible a
// state that cannot exist — a line netted against an expected cession it has
// no way to compute, or one ceding through layers it was not priced for.
//
// THREE BEHAVIOURS RIDE ON IT, and the third was not on the list when the
// Property cutover was planned:
//   1. PRICING     reinsuranceCost comes from the placed layers' own
//                  E[ceded] + lambda x SD[ceded], not a percentage of premium.
//   2. NET FUNDING the pool premium funds gross expected loss LESS that same
//                  E[ceded]. This is the one that widened silently when
//                  Property was added.
//   3. THE LOSS-SPLIT BASIS  `attachment` — and through it poolLosses,
//                  excessLosses and quotaShareLosses, all three EXPORTED
//                  fields — is the tower's own retention on this path and
//                  125% of expected loss on the other. That is a reporting
//                  decomposition, not a reinsurance behaviour, and it rides
//                  here only because the two branches happen to set the same
//                  variable. It is what the Property cutover's null test
//                  measured as its ONLY difference.
//
// Always true today (every CoverageLine qualifies), kept as a real predicate
// rather than inlined so a future line has somewhere to say no.
// ============================================================================
export const hasTractableCeded = (line: CoverageLine | LineView): line is TowerLine =>
  line === 'WC' || line === 'GL' || line === 'Property';

// WC and Property are the only lines with an aggregate stop-loss.
const hasAggregate = (line: CoverageLine | LineView): line is 'WC' | 'Property' =>
  line === 'WC' || line === 'Property';

// For readouts that have NO line in scope (narrativeEngine, resultMetrics,
// deriveAnnualStatement all take a result, not a line). `cededByLayer` is
// populated by the tower, so its width discriminates a tower result from a
// legacy one.
//
// ⚠ IT NO LONGER DISCRIMINATES BY LINE. This said "left EMPTY on Property, so
// its width is a reliable in-band discriminator" — Property populates it now,
// and every line does, so this returns true universally on live results. It
// survives only to classify a result loaded from a save written before the
// tower.
//
// PREFER `hasTractableCeded(line)` WHERE A LINE IS AVAILABLE. This exists because
// threading a line parameter through those three signatures would touch more
// surface than the readout fix is worth; it is not the better test.
export const resultUsesTower = (r: { cededByLayer?: number[] }): boolean =>
  (r.cededByLayer?.length ?? 0) > 0;

// Short one-line summary of what was actually bought. Used wherever the old code
// printed "2 — Moderate".
export function placementSummary(
  line: CoverageLine,
  decisions: Pick<LineDecisionSet, 'layersPlaced' | 'aggregateStopLevel'>,
): string {
  if (!hasTractableCeded(line)) {
    throw new Error(`placementSummary: ${line} has no tractable ceded reinsurance to summarize`);
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
  decisions: Pick<LineDecisionSet, 'layersPlaced' | 'aggregateStopLevel'>,
): string {
  if (!hasTractableCeded(line)) {
    throw new Error(`placementCode: ${line} has no tractable ceded reinsurance to encode`);
  }
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
  hasTractableCeded(line) ? `$${TOWER_TOP[line] / 1e6}M` : '—';
