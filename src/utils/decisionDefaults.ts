import { DEFAULT_LAYERS_PLACED } from '../data/reinsuranceTower';
// Single source of truth for default decisions. Used by the App (new game /
// next year), the Decisions page (per-line reset), and the Stage 2.10 pre-game
// history simulation — so the "steadily managed before the player took over"
// pre-game years can never drift from the in-game defaults.
import { SLIDER_RANGES, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import type { CoverageLine, DecisionSet, LineDecisionSet } from '../types/simulation';

// Fresh object per call (allocation is nested, so lines must not share a reference).
export function defaultLineDecisionSet(line: CoverageLine): LineDecisionSet {
  return {
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    // Default TRUE for every line, and no longer inert on any of them: all
    // three now default to "fund exactly at expected loss", the same CONCEPT on
    // each, rather than a per-line percentage stop (WC at 60%, GL at 65% — two
    // numbers that meant two different, both wrong, things before their own
    // derived tables existed). Property was the last line for which this flag
    // did nothing; its derived table crosses at 54.0%, not 60%, so it now
    // carries the same meaning here as on WC and GL.
    fundingAtExpected: true,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    underwritingStrictness: SLIDER_RANGES.underwritingStrictness.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    reinsuranceLevel: SLIDER_RANGES.reinsuranceLevel.default,
    // Default: every purchasable occurrence layer placed, no aggregate. Matches
    // the default-on-load rule for saves that predate the tower. KEYED BY
    // LINE — Property's one-layer tower must not receive WC's three-element
    // array (or vice versa); see DEFAULT_LAYERS_PLACED's own header.
    layersPlaced: [...DEFAULT_LAYERS_PLACED[line]],
    aggregateStopLevel: -1,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  };
}

export function defaultDecisionSet(yearNumber: number): DecisionSet {
  return {
    yearNumber,
    byLine: {
      WC: defaultLineDecisionSet('WC'),
      GL: defaultLineDecisionSet('GL'),
      Property: defaultLineDecisionSet('Property'),
    },
    // Pool-wide decisions (projected into every line at processYear entry).
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
  };
}
