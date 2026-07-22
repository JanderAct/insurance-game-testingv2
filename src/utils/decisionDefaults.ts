// Single source of truth for default decisions. Used by the App (new game /
// next year), the Decisions page (per-line reset), and the Stage 2.10 pre-game
// history simulation — so the "steadily managed before the player took over"
// pre-game years can never drift from the in-game defaults.
import { SLIDER_RANGES, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import type { DecisionSet, LineDecisionSet } from '../types/simulation';

// Fresh object per call (allocation is nested, so lines must not share a reference).
export function defaultLineDecisionSet(): LineDecisionSet {
  return {
    rateChange: SLIDER_RANGES.rateChange.default,
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    underwritingStrictness: SLIDER_RANGES.underwritingStrictness.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    reinsuranceLevel: SLIDER_RANGES.reinsuranceLevel.default,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  };
}

export function defaultDecisionSet(yearNumber: number): DecisionSet {
  return {
    yearNumber,
    byLine: {
      WC: defaultLineDecisionSet(),
      GL: defaultLineDecisionSet(),
      Property: defaultLineDecisionSet(),
    },
  };
}
