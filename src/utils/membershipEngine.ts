// Membership engine for Risk Pool Simulation v1
// Uses count-based attraction to keep growth realistic

import type { Member, LineDecisionSet, CoverageLine, MembershipHistory } from '../types/simulation';
import { SeededRandom } from './random';
import { canReenroll } from './membershipHistory';
import { getMemberExposure } from './lineHelpers';
import {
  MEMBER_MOVEMENT_WEIGHTS,
  BASE_RETENTION,
  MEMBERSHIP_EQUILIBRIUM_ENROLLMENT,
  MEMBERSHIP_DEFAULT_ADJUSTMENT,
  MEMBERSHIP_DEFAULT_DEPARTURE_RATE,
  MAX_NEW_MEMBERS_PER_YEAR,
  MAX_WITHDRAWN_PER_YEAR,
  RATE_NEUTRAL_CHANGE_PCT,
  RATE_NEUTRAL_LOAD,
  RATE_RETENTION_SENSITIVITY,
  RATE_SATISFACTION_SENSITIVITY,
  RATE_LEVEL_SENSITIVITY,
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
  // % change in this line's TOTAL MEMBER CHARGE RATE per $100 vs last year.
  // Null when there is no usable prior rate — see priceSignalFor.
  rateChangePct?: number | null;
  // This line's total member charge rate over its pure premium rate. Null when
  // the pure premium is not positive.
  rateLoad?: number | null;
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

// --- the price signal, in the two forms the three sites need ----------------
//
// NULL HANDLING, one rule for both. A missing signal means NEUTRAL — deviation
// exactly 0, no penalty and no bonus — never a default of "zero rate change",
// which is a different and wrong thing on a line whose neutral is not zero.
// Treating a null as a literal 0% change on a line whose neutral is not zero
// would read as a rate CUT of the neutral's size and hand out a bonus for
// missing data. GL is the live example now (neutral +1.26%); Property used to
// be the striking one at +4.83% and then +4.10%, but its netting re-measured
// it to -0.21% — essentially flat, which is what a line with no frequency
// trend, no severity trend and a non-inflating exposure base should read.
//
// In practice null is nearly unreachable: runPriorHistory simulates three
// pre-game years through this same engine, so lineState.ratePer100 is already
// populated when year 1 runs — measured 30/30 line-instances with a prior rate
// in year 1, on every line. The branch exists for a save restored mid-stream or
// a line switched on late, not for the normal opening.
function priceSignalFor(inputs: MemberMovementInputs): {
  changeDeviationPct: number;
  levelDeviationPct: number;
} {
  const neutralChange = RATE_NEUTRAL_CHANGE_PCT[inputs.line] ?? 0;
  const neutralLoad = RATE_NEUTRAL_LOAD[inputs.line] ?? 0;

  const changeDeviationPct = inputs.rateChangePct === null || inputs.rateChangePct === undefined
    ? 0
    : inputs.rateChangePct - neutralChange;

  const levelDeviationPct = inputs.rateLoad === null || inputs.rateLoad === undefined || neutralLoad <= 0
    ? 0
    : (inputs.rateLoad / neutralLoad - 1) * 100;

  return { changeDeviationPct, levelDeviationPct };
}

function calcRetentionProbability(inputs: MemberMovementInputs): number {
  const { decisions, currentMemberSatisfaction, surplus, annualPremium, priorYearLossRatio } = inputs;

  const satisfactionImpact = (currentMemberSatisfaction - 5.0) / 5.0 * 0.03;
  const surplusRatio = surplus / Math.max(annualPremium, 1);
  const financialImpact = Math.min(0.02, Math.max(-0.02, (surplusRatio - 0.6) / 30));
  const dividendImpact = decisions.dividendPct * 0.20;
  const assessmentPenalty = decisions.assessmentPct * 0.15;
  // rateIncreasePenalty RECONNECTED. Reads the derived rate change — this
  // year's total member charge rate per $100 against last year's — measured
  // as a DEVIATION from this line's own neutral, because at defaults the
  // neutral is not zero and differs per line (see RATE_NEUTRAL_CHANGE_PCT).
  //
  // PENALTY ONLY: a cut below neutral earns nothing back here. Members notice
  // increases; the goodwill from a cut runs through satisfaction instead.
  const { changeDeviationPct } = priceSignalFor(inputs);
  const rateIncreasePenalty = Math.max(0, changeDeviationPct) * RATE_RETENTION_SENSITIVITY;
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

// The marketplace-scaled join rate, k, derived from the LIVE roster rather than
// frozen as a literal — see MEMBERSHIP_EQUILIBRIUM_ENROLLMENT for the full
// derivation and for why the default adjustment is netted off here.
//
// Returns 0 for a roster too small to hold the calibration book (degenerate
// rather than meaningful), and clamps at 0 if the adjustment ladder were ever
// re-tuned above the departure rate — a negative capture rate would make a
// SMALLER book recruit FEWER members, inverting the self-correction.
export function prospectCaptureRate(rosterSize: number): number {
  const headroom = rosterSize - MEMBERSHIP_EQUILIBRIUM_ENROLLMENT;
  if (headroom <= 0) return 0;
  const netDepartures =
    MEMBERSHIP_EQUILIBRIUM_ENROLLMENT * MEMBERSHIP_DEFAULT_DEPARTURE_RATE
    - MEMBERSHIP_DEFAULT_ADJUSTMENT;
  return Math.max(0, netDepartures / headroom);
}

// The marketplace-scaled BASE, before any adjustment.
//
// Prospects are counted as (roster - enrolled), NOT as the post-cooldown
// candidate pool. The 2-year canReenroll cooldown still binds, but it binds
// downstream in simulateMemberMovement, where the join count is truncated to
// the pool that actually exists — keeping it out of the base leaves the base a
// clean function of book size, which is what the equilibrium algebra is
// written against.
export function baseNewMembers(rosterSize: number, enrolledCount: number): number {
  const prospects = Math.max(0, rosterSize - enrolledCount);
  return prospectCaptureRate(rosterSize) * prospects;
}

// Everything that is NOT the base, split out so it can be measured on its own.
//
// ⚠ THESE DO NOT SUM TO ZERO AT DEFAULT DECISIONS, and the calibration of k
// depends on knowing by how much. underwritingStrictness 5, assessmentPct 0 and
// riskControlPct 0 all sit on inert branches, but two channels are live and
// both are positive at defaults: competitivePressure is drawn in [0.3, 0.8], so
// its term contributes +0.10 to +0.35 (mean +0.225); and satisfaction starts in
// [6.5, 8.5], so the >= 7.5 branch fires about half the time. The surplusRatio
// term starts mostly inert but turns positive later in a game as surplus
// builds. See MEMBERSHIP_EQUILIBRIUM_ENROLLMENT for how the measured total is
// folded into k.
export function newMemberAdjustment(a: {
  underwritingStrictness: number;
  assessmentPct: number;
  riskControlPct: number;
  memberSatisfaction: number;
  surplus: number;
  annualPremium: number;
  competitivePressure: number;
  levelDeviationPct?: number;
}): number {
  let adj = 0;

  // The five-branch rateChange ladder is REPLACED, not restored: prospects
  // compare LEVELS, not year-over-year changes. A pool that has been overpriced
  // for five straight years has no rate change left to show and would escape a
  // change-based ladder entirely, while still being the pool nobody joins.
  //
  // Scaled by competitivePressure because that is what the existing hook below
  // already means here — high pressure is a market where members are harder to
  // win, so being overpriced costs more in one. Symmetric: below-neutral pricing
  // attracts, which is what makes declining the tower visible as an upside.
  adj -= MEMBER_MOVEMENT_WEIGHTS.attraction.rateLevel
    * a.competitivePressure
    * RATE_LEVEL_SENSITIVITY
    * (a.levelDeviationPct ?? 0);

  if (a.underwritingStrictness <= 2) adj += 0.8;
  else if (a.underwritingStrictness <= 4) adj += 0.3;
  else if (a.underwritingStrictness >= 8) adj -= 0.4;

  if (a.memberSatisfaction >= 8.5) adj += 0.5;
  else if (a.memberSatisfaction >= 7.5) adj += 0.2;
  else if (a.memberSatisfaction < 5.0) adj -= 0.5;

  const surplusRatio = a.surplus / Math.max(a.annualPremium, 1);
  if (surplusRatio >= 1.20) adj += 0.3;
  else if (surplusRatio < 0.40) adj -= 0.3;

  if (a.assessmentPct > 0.15) adj -= 0.8;
  else if (a.assessmentPct > 0.05) adj -= 0.3;

  if (a.riskControlPct >= 0.05) adj += 0.2;

  adj += (1 - a.competitivePressure) * 0.5;

  return adj;
}

function calcExpectedNewMembers(inputs: MemberMovementInputs): number {
  const {
    decisions, currentMemberSatisfaction, surplus, annualPremium, competitivePressure,
    allMarketMembers, currentMembers,
  } = inputs;

  // BASE: scales with what is left of the marketplace, so the book is
  // self-limiting upward and self-recovering downward. Every adjustment is
  // unchanged and still applies ON TOP of this — only the base moved.
  const expected = baseNewMembers(allMarketMembers.length, currentMembers.length)
    + newMemberAdjustment({
      underwritingStrictness: decisions.underwritingStrictness,
      assessmentPct: decisions.assessmentPct,
      riskControlPct: decisions.riskControlPct,
      memberSatisfaction: currentMemberSatisfaction,
      surplus,
      annualPremium,
      competitivePressure,
      levelDeviationPct: priceSignalFor(inputs).levelDeviationPct,
    });

  return Math.max(0, Math.min(MAX_NEW_MEMBERS_PER_YEAR, expected));
}

function updateSatisfaction(
  current: number,
  decisions: LineDecisionSet,
  changeDeviationPct: number,
): number {
  let delta = 0;
  // The rateChange satisfaction term RECONNECTED, reading the same derived rate
  // change the retention term reads, as a deviation from this line's neutral.
  //
  // SYMMETRIC here, unlike retention: satisfaction is a slow-moving stock
  // clamped to [1, 10], and a penalty-only form would ratchet it downward at
  // defaults on rate noise alone. Letting it move both ways keeps it centred on
  // its starting value when the pool prices at its neutral.
  delta -= changeDeviationPct * RATE_SATISFACTION_SENSITIVITY;
  delta += decisions.dividendPct * 10.0;
  delta -= decisions.assessmentPct * 8.0;
  // NEUTRALISED — coefficient set to 0, not sign-flipped. This term zeroed at
  // the old fundingConfidenceLevel default (0.75); the new default is 0.60
  // (CLF-only pricing), so it started contributing -0.075 satisfaction/yr at
  // defaults (-0.225/yr at the 30% floor) — and backwards: charging members
  // LESS was making them UNHAPPIER. Two reasons it goes to 0 rather than
  // getting its sign corrected: the 0.75 reference point is now arbitrary
  // since the default moved to 0.60, and this whole term is being replaced by
  // bill-based satisfaction (Economics Step 1 / Stage 2.5). A term with an
  // arbitrary anchor and an uncalibrated magnitude is better dormant than
  // wrong.
  delta += (decisions.fundingConfidenceLevel - 0.75) * 0;
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

  const totalMarketExposure = allMarketMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);

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
  const activeExposure = activeMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);

  const retentionRate = currentMembers.length > 0
    ? retainedMembers.length / currentMembers.length
    : 1;

  const newSatisfaction = updateSatisfaction(
    inputs.currentMemberSatisfaction, inputs.decisions, priceSignalFor(inputs).changeDeviationPct,
  );
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
