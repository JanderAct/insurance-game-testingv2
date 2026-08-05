// Membership engine for Risk Pool Simulation v1
// Uses count-based attraction to keep growth realistic

import type { Member, LineDecisionSet, CoverageLine, MembershipHistory } from '../types/simulation';
import { SeededRandom } from './random';
import { canReenroll } from './membershipHistory';
import { getMemberExposure } from './lineHelpers';
import {
  MEMBER_MOVEMENT_WEIGHTS,
  BASE_RETENTION,
  BASE_NEW_MEMBERS_PER_YEAR,
  MAX_NEW_MEMBERS_PER_YEAR,
  MAX_WITHDRAWN_PER_YEAR,
} from '../data/defaultAssumptions';

export interface MemberMovementInputs {
  currentMembers: Member[];
  allMarketMembers: Member[];
  // Authoritative per-line enrollment ledger — the ONLY legitimate source for
  // recruitment eligibility (see the candidate-pool filter below).
  membershipHistory: MembershipHistory;
  decisions: LineDecisionSet;
  line: CoverageLine;
  currentMemberSatisfaction: number;
  currentRiskQuality: number;
  surplus: number;
  annualPremium: number;
  priorYearLossRatio?: number;
  competitivePressure: number;
  memberSensitivity: number;
  yearNumber: number;
  calendarYear: number;
  rng: SeededRandom;
}

export interface MemberMovementResult {
  activeMembers: Member[];
  newMembers: Member[];
  withdrawnMembers: Member[];
  retentionRate: number;
  memberSatisfaction: number;
  averageRiskQuality: number;
  activeExposure: number;
  totalMarketExposure: number;
}

function calcRetentionProbability(inputs: MemberMovementInputs): number {
  const { decisions, currentMemberSatisfaction, surplus, annualPremium, priorYearLossRatio } = inputs;

  const satisfactionImpact = (currentMemberSatisfaction - 5.0) / 5.0 * 0.03;
  const surplusRatio = surplus / Math.max(annualPremium, 1);
  const financialImpact = Math.min(0.02, Math.max(-0.02, (surplusRatio - 0.6) / 30));
  const dividendImpact = decisions.dividendPct * 0.20;
  const assessmentPenalty = decisions.assessmentPct * 0.15;
  const rateIncreasePenalty = Math.max(0, decisions.rateChange) * 0.12;
  const poorResultPenalty = priorYearLossRatio
    ? Math.max(0, priorYearLossRatio - 0.85) * 0.05
    : 0;

  const W = MEMBER_MOVEMENT_WEIGHTS.retention;
  const adjustment =
    W.satisfaction * satisfactionImpact
    + W.financialStrength * financialImpact
    + W.dividend * dividendImpact
    - W.assessmentPenalty * assessmentPenalty
    - W.rateIncreasePenalty * rateIncreasePenalty
    - poorResultPenalty;

  return Math.max(0.80, Math.min(0.99, BASE_RETENTION + adjustment));
}

function calcExpectedNewMembers(inputs: MemberMovementInputs): number {
  const { decisions, currentMemberSatisfaction, surplus, annualPremium, competitivePressure } = inputs;

  let expected = BASE_NEW_MEMBERS_PER_YEAR;

  if (decisions.rateChange < -0.10) expected += 1.2;
  else if (decisions.rateChange < -0.05) expected += 0.7;
  else if (decisions.rateChange < 0) expected += 0.3;
  else if (decisions.rateChange > 0.15) expected -= 0.6;
  else if (decisions.rateChange > 0.08) expected -= 0.3;

  if (decisions.underwritingStrictness <= 2) expected += 0.8;
  else if (decisions.underwritingStrictness <= 4) expected += 0.3;
  else if (decisions.underwritingStrictness >= 8) expected -= 0.4;

  if (currentMemberSatisfaction >= 8.5) expected += 0.5;
  else if (currentMemberSatisfaction >= 7.5) expected += 0.2;
  else if (currentMemberSatisfaction < 5.0) expected -= 0.5;

  const surplusRatio = surplus / Math.max(annualPremium, 1);
  if (surplusRatio >= 1.20) expected += 0.3;
  else if (surplusRatio < 0.40) expected -= 0.3;

  if (decisions.assessmentPct > 0.15) expected -= 0.8;
  else if (decisions.assessmentPct > 0.05) expected -= 0.3;

  if (decisions.riskControlPct >= 0.05) expected += 0.2;

  expected += (1 - competitivePressure) * 0.5;

  return Math.max(0, Math.min(MAX_NEW_MEMBERS_PER_YEAR, expected));
}

function updateSatisfaction(current: number, decisions: LineDecisionSet): number {
  let delta = 0;
  delta -= decisions.rateChange * 5.0;
  delta += decisions.dividendPct * 10.0;
  delta -= decisions.assessmentPct * 8.0;
  delta += (decisions.fundingConfidenceLevel - 0.75) * 0.5;
  return Math.max(1.0, Math.min(10.0, parseFloat((current + delta).toFixed(1))));
}

function updateRiskQuality(
  current: number,
  underwritingStrictness: number,
  newMembers: Member[],
  allActiveMembers: Member[],
): number {
  const strictnessAdjustment = (underwritingStrictness - 5) * 0.04;
  const newMemberAvgQuality = newMembers.length > 0
    ? newMembers.reduce((s, m) => s + m.riskQuality, 0) / newMembers.length
    : current;
  const blendedQuality = current
    + strictnessAdjustment
    + (newMemberAvgQuality - current) * (newMembers.length / Math.max(allActiveMembers.length, 1)) * 0.5;
  return Math.max(1.0, Math.min(10.0, parseFloat(blendedQuality.toFixed(1))));
}

export function simulateMemberMovement(inputs: MemberMovementInputs): MemberMovementResult {
  const { currentMembers, allMarketMembers, line, yearNumber, calendarYear, rng } = inputs;

  const totalMarketExposure = allMarketMembers.reduce((s, m) => s + getMemberExposure(m, line), 0);

  const retentionProb = calcRetentionProbability(inputs);
  const expectedWithdrawals = currentMembers.length * (1 - retentionProb);
  const rawWithdrawalCount = Math.round(expectedWithdrawals * rng.range(0.4, 1.6));
  const cappedWithdrawalCount = Math.min(rawWithdrawalCount, MAX_WITHDRAWN_PER_YEAR);

  const membersSortedByLeaveRisk = [...currentMembers].sort((a, b) =>
    (a.satisfaction + a.riskQuality * 0.3) - (b.satisfaction + b.riskQuality * 0.3)
  );

  const withdrawnMembers: Member[] = membersSortedByLeaveRisk
    .slice(0, cappedWithdrawalCount)
    .map(m => ({ ...m, status: 'withdrawn' as const, yearWithdrawn: yearNumber }));
  const withdrawnIds = new Set(withdrawnMembers.map(m => m.id));
  const retainedMembers = currentMembers.filter(m => !withdrawnIds.has(m.id));

  const expectedNew = calcExpectedNewMembers(inputs);
  const rawNewCount = Math.round(expectedNew * rng.range(0.3, 1.7));
  const actualNewCount = Math.min(rawNewCount, MAX_NEW_MEMBERS_PER_YEAR);

  // Candidate-pool eligibility reads EXCLUSIVELY from membershipHistory,
  // NEVER from Member.status. The shared status field is fold-corrupted
  // across lines (one status per member, folded sequentially per line, so a
  // member withdrawn from a later-processed line while active in an earlier
  // one reads 'withdrawn' — CALIBRATION_FINDINGS 2/5) and cannot answer the
  // per-line question "may this member (re-)enroll in THIS line?". The
  // ledger is per-line by construction: canReenroll is true for a member
  // never enrolled in this line, false while its interval is open (which
  // also blocks same-year re-entry after a withdrawal — the ledger is
  // updated in processYear AFTER this movement, so a just-withdrawn member
  // still reads as enrolled here), and true again only once the 2-year
  // per-line cooldown from the most recent withdrawal has elapsed.
  const activeIds = new Set(retainedMembers.map(m => m.id));
  const availableMembers = allMarketMembers.filter(
    m => !activeIds.has(m.id) && canReenroll(inputs.membershipHistory, m.id, line, yearNumber)
  );

  let candidatePool = [...availableMembers];
  if (inputs.decisions.underwritingStrictness > 6) {
    candidatePool.sort((a, b) => b.riskQuality - a.riskQuality);
    candidatePool = candidatePool.slice(0, Math.ceil(candidatePool.length * 0.6));
  } else {
    rng.shuffle(candidatePool);
  }

  const newMembers: Member[] = candidatePool.slice(0, Math.min(actualNewCount, candidatePool.length)).map(m => ({
    ...m,
    status: 'active' as const,
    yearJoined: yearNumber,
    calendarYearJoined: calendarYear,
    satisfaction: parseFloat(rng.range(6.0, 8.5).toFixed(1)),
  }));

  const activeMembers: Member[] = [...retainedMembers, ...newMembers];
  const activeExposure = activeMembers.reduce((s, m) => s + getMemberExposure(m, line), 0);

  const retentionRate = currentMembers.length > 0
    ? retainedMembers.length / currentMembers.length
    : 1;

  const newSatisfaction = updateSatisfaction(inputs.currentMemberSatisfaction, inputs.decisions);
  const newRiskQuality = updateRiskQuality(inputs.currentRiskQuality, inputs.decisions.underwritingStrictness, newMembers, activeMembers);

  return {
    activeMembers,
    newMembers,
    withdrawnMembers,
    retentionRate,
    memberSatisfaction: newSatisfaction,
    averageRiskQuality: newRiskQuality,
    activeExposure,
    totalMarketExposure,
  };
}
