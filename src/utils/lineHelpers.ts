import type { CoverageLine, LineDecisionSet, LinePoolState, Member } from '../types/simulation';

export function getMemberExposure(member: Member, line: CoverageLine): number {
  return member.exposureByLine[line] ?? 0;
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
    grossUnpaidReserve: 0,
    reinsuranceRecoverable: 0,
    surplus: 0,
    totalMarketExposure: 0,
  };
}

export function emptyLineDecisionSet(): LineDecisionSet {
  return {
    rateChange: 0,
    fundingConfidenceLevel: 0.75,
    dividendPct: 0,
    assessmentPct: 0,
    underwritingStrictness: 5,
    riskControlPct: 0,
    reinsuranceLevel: 0,
    loanRepaymentAggressiveness: 0.5,
  };
}
