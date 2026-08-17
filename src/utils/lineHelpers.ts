import { DEFAULT_LAYERS_PLACED } from '../data/reinsuranceTower';
import type { CoverageLine, LineDecisionSet, LinePoolState, LineResultSet, LineView, Member, ResultSet } from '../types/simulation';
import { ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import { wageFactor } from '../data/exposureTrend';

// A member's exposure in THIS YEAR'S DOLLARS — the NOMINAL, rating-side figure.
//
// ⚠ THIS IS THE RATING/PREMIUM/DISPLAY READER. There is a second exposure basis
// and confusing them is the whole design of the wage-inflation change:
//
//   NOMINAL (here)      frozen roster payroll x wageFactor(line, year).
//                       Premium, member charge, market share, every display.
//
//   REAL (raw           `member.exposureByLine.WC` read directly, no factor.
//    exposureByLine)    CLAIM FREQUENCY, and only claim frequency.
//                       wcClaimEngine, wcIbnr, wcLossDistribution read it raw.
//
// WHY FREQUENCY MUST NOT SEE THE FACTOR: the roster is frozen, so payroll growth
// here is PURE WAGE INFLATION — same members, same workers, same injuries.
// Letting claim counts rise 3.63%/yr would assert that paying people more
// injures more of them, and it would move WC's rate trend from -1.46%/yr to
// +2.12%/yr, growing premium 5.82%/yr instead of 2.115%.
//
// yearNumber is REQUIRED, with no default. A default would silently price some
// call site at year 1 forever, which is exactly the class of defect the
// frequency-trend fix corrected (finding 37).
export function getMemberExposure(member: Member, line: CoverageLine, yearNumber: number): number {
  return (member.exposureByLine[line] ?? 0) * wageFactor(line, yearNumber);
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
