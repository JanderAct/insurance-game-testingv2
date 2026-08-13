import { DEFAULT_LAYERS_PLACED } from '../data/reinsuranceTower';
import type { CoverageLine, LineDecisionSet, LinePoolState, LineResultSet, LineView, Member, ResultSet } from '../types/simulation';
import { ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';

export function getMemberExposure(member: Member, line: CoverageLine): number {
  return member.exposureByLine[line] ?? 0;
}

// Stage 2.1 view filter: 'pool' returns lockedResults unchanged (by reference —
// this is what makes the Pool view provably identical to pre-Stage-2.1
// behavior, not just tested to match). A specific line maps each locked
// year to that line's own unaggregated slice.
export function selectResultView(lockedResults: ResultSet[], view: LineView): LineResultSet[] {
  if (view === 'pool') return lockedResults;
  return lockedResults.map(r => r.byLine[view]);
}

export function emptyLinePoolState(): LinePoolState {
  return {
    rateLevel: 100,
    ratePer100: 0,
    purePremiumPer100: 0,
    purePremium: 0,
    memberSatisfaction: 0,
    averageRiskQuality: 0,
    riskControlEffectiveness: 0,
    reserveCohorts: [],
    members: [],
    netUnpaidReserve: 0,
    surplus: 0,
    investedAssets: 0,
    totalMarketExposure: 0,
  };
}

export function emptyLineDecisionSet(): LineDecisionSet {
  return {
    fundingConfidenceLevel: 0.60,
    dividendPct: 0,
    assessmentPct: 0,
    underwritingStrictness: 5,
    riskControlPct: 0,
    reinsuranceLevel: 0,
    layersPlaced: DEFAULT_LAYERS_PLACED,
    aggregateStopLevel: -1,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  };
}
