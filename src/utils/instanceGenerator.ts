// Generates a deterministic game instance from a seed
// Exposure = payroll in millions of dollars
// Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { GameInstance, Member, PoolState, StartingFinancials, ReserveCohort } from '../types/simulation';
import { SeededRandom } from './random';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import {
  STARTING_FINANCIALS,
  STARTING_MEMBER_RANGE,
  STARTING_POOL_EXPOSURE,
  STARTING_RATE_PER_100,
  RESERVE_PAYDOWN_PCT,
} from '../data/defaultAssumptions';

function assignStartingMembers(allMembers: Member[], rng: SeededRandom, targetCount: number, startingYear: number): Member[] {
  let bestSelection: Member[] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  // Try several seeded selections and keep the one closest to the target
  // payroll band with a balanced average risk quality.
  for (let attempt = 0; attempt < 250; attempt++) {
    const shuffled = [...allMembers];
    rng.shuffle(shuffled);
    const candidate = shuffled.slice(0, targetCount);
    const exposure = candidate.reduce((sum, member) => sum + member.exposure, 0);
    const averageRisk = candidate.reduce((sum, member) => sum + member.riskQuality, 0) / candidate.length;
    const exposurePenalty = exposure < STARTING_POOL_EXPOSURE.min
      ? STARTING_POOL_EXPOSURE.min - exposure
      : exposure > STARTING_POOL_EXPOSURE.max
        ? exposure - STARTING_POOL_EXPOSURE.max
        : 0;
    const score = exposurePenalty * 10 + Math.abs(averageRisk - 5.25);

    if (score < bestScore) {
      bestScore = score;
      bestSelection = candidate;
    }
  }

  return bestSelection.map(m => ({
    ...m,
    status: 'active' as const,
    yearJoined: 1,
    calendarYearJoined: startingYear,
  }));
}

// Generate starting reserve cohorts from the beginning gross unpaid reserve
// These are prior accident-year cohorts that exist before gameplay starts
function generateStartingReserveCohorts(
  grossUnpaidReserve: number,
  reinsuranceRecoverable: number,
  startingYear: number,
  rng: SeededRandom
): ReserveCohort[] {
  if (grossUnpaidReserve <= 0) return [];

  // Create 3-5 prior accident-year cohorts
  // More recent cohorts have more unpaid; older cohorts have less
  const numCohorts = rng.intRange(3, 5);
  const cohorts: ReserveCohort[] = [];

  // Weight distribution for cohorts (most recent gets most weight)
  // e.g., for 4 cohorts: [0.35, 0.30, 0.20, 0.15]
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < numCohorts; i++) {
    // Decreasing weight for older cohorts
    const w = 1 / (i + 1);
    weights.push(w);
    weightSum += w;
  }
  // Normalize
  for (let i = 0; i < weights.length; i++) {
    weights[i] /= weightSum;
  }

  // Distribute the gross unpaid reserve across cohorts
  let remainingReserve = grossUnpaidReserve;
  let remainingReins = reinsuranceRecoverable;

  for (let i = 0; i < numCohorts; i++) {
    // Last cohort gets the remainder to ensure exact sum
    const isLast = i === numCohorts - 1;
    const cohortGrossUnpaid = isLast ? remainingReserve : grossUnpaidReserve * weights[i];
    const cohortReins = isLast ? remainingReins : reinsuranceRecoverable * weights[i];

    // Calculate how much has been paid on this cohort (older = more paid)
    // Age determines paydown: cohorts aged 1-5 years
    const age = i + 1; // 1 = most recent (1 year ago), 5 = oldest (5 years ago)
    const paidRatio = Math.min(0.80, age * RESERVE_PAYDOWN_PCT);
    const grossUltimate = cohortGrossUnpaid / (1 - paidRatio);
    const grossPaid = grossUltimate * paidRatio;

    // Development factor based on age (older cohorts have settled more)
    const devFactor = 1 + rng.range(-0.03, 0.05) / age;

    // Year number is negative for prior accident years (relative to game start)
    // yearNumber 0 = accident year before game starts
    // Calendar year is game starting year minus age
    const cohortYearNumber = -age;
    const cohortCalendarYear = startingYear - age;

    cohorts.push({
      yearNumber: cohortYearNumber,
      calendarYear: cohortCalendarYear,
      grossUltimate,
      grossPaid,
      grossUnpaid: cohortGrossUnpaid,
      reinsuranceRecoverable: cohortReins,
      reinsuranceReceived: cohortReins * paidRatio, // Proportional to paid
      paydownPct: RESERVE_PAYDOWN_PCT,
      developmentFactor: devFactor,
      closed: false,
    });

    remainingReserve -= cohortGrossUnpaid;
    remainingReins -= cohortReins;
  }

  return cohorts;
}

export function generateGameInstance(instanceId: string, seed: number): GameInstance {
  const rng = new SeededRandom(seed);
  return {
    instanceId,
    seed,
    lossEnvironment: {
      baseLossRatio: rng.range(0.62, 0.78),
      lossTrend: rng.range(0.02, 0.07),
      volatility: rng.range(0.10, 0.25),
      shockProbability: rng.range(0.05, 0.15),
      shockSeverityMultiplier: rng.range(1.8, 3.5),
      heavyTailRisk: rng.range(0.05, 0.25),
    },
    investmentEnvironment: {
      baseReturn: rng.range(0.025, 0.055),
      volatility: rng.range(0.04, 0.10),
      downsideRisk: rng.range(0.05, 0.15),
    },
    marketEnvironment: {
      totalMarketGrowthRate: rng.range(0.01, 0.04),
      competitivePressure: rng.range(0.3, 0.8),
      memberSensitivity: rng.range(0.3, 0.8),
    },
  };
}

export function generateStartingPoolState(instance: GameInstance, startingYear: number): { poolState: PoolState; startingFinancials: StartingFinancials } {
  const rng = new SeededRandom(instance.seed + 777);

  const allMarketMembers = getPredefinedMarketMembers();
  const startingMemberCount = rng.intRange(STARTING_MEMBER_RANGE.min, STARTING_MEMBER_RANGE.max);
  const startingPoolMembers = assignStartingMembers(allMarketMembers, rng, startingMemberCount, startingYear);
  const startingMemberIds = new Set(startingPoolMembers.map(m => m.id));

  const allMembersWithStatus: Member[] = allMarketMembers.map(m => ({
    ...m,
    status: startingMemberIds.has(m.id) ? ('active' as const) : ('prospect' as const),
    yearJoined: startingMemberIds.has(m.id) ? 1 : 0,
    calendarYearJoined: startingMemberIds.has(m.id) ? startingYear : 0,
  }));

  const activeMembers = allMembersWithStatus.filter(m => m.status === 'active');

  let activeExposure = activeMembers.reduce((sum, m) => sum + m.exposure, 0);
  let totalMarketExposure = allMarketMembers.reduce((sum, m) => sum + m.exposure, 0);

  const targetPremium = rng.range(STARTING_FINANCIALS.annualPremium.min, STARTING_FINANCIALS.annualPremium.max);
  const annualPremium = targetPremium;

  const derivedRate = annualPremium / (activeExposure * 10_000);
  const ratePer100 = Math.max(STARTING_RATE_PER_100.min, Math.min(STARTING_RATE_PER_100.max, derivedRate));

  const expectedLossRatio = rng.range(STARTING_FINANCIALS.expectedLossRatio.min, STARTING_FINANCIALS.expectedLossRatio.max);
  const purePremiumPer100 = ratePer100 * expectedLossRatio;
  const memberSatisfaction = rng.range(STARTING_FINANCIALS.memberSatisfaction.min, STARTING_FINANCIALS.memberSatisfaction.max);
  const riskQuality = rng.range(STARTING_FINANCIALS.riskQuality.min, STARTING_FINANCIALS.riskQuality.max);

  const cash = rng.range(STARTING_FINANCIALS.cash.min, STARTING_FINANCIALS.cash.max);
  const investments = rng.range(STARTING_FINANCIALS.investments.min, STARTING_FINANCIALS.investments.max);
  const reinsuranceRecoverable = rng.range(STARTING_FINANCIALS.reinsuranceRecoverable.min, STARTING_FINANCIALS.reinsuranceRecoverable.max);
  const otherAssets = rng.range(STARTING_FINANCIALS.otherAssets.min, STARTING_FINANCIALS.otherAssets.max);
  const grossUnpaidReserve = rng.range(STARTING_FINANCIALS.grossUnpaidReserve.min, STARTING_FINANCIALS.grossUnpaidReserve.max);
  // Held at zero, matching every subsequent year: written premium is treated as collected
  // and earned in the year it's written, with no separate unearned-premium timing layer.
  const unearnedPremium = 0;
  const otherLiabilities = rng.range(STARTING_FINANCIALS.otherLiabilities.min, STARTING_FINANCIALS.otherLiabilities.max);

  const totalAssets = cash + investments + reinsuranceRecoverable + otherAssets;
  const totalLiabilities = grossUnpaidReserve + unearnedPremium + otherLiabilities;
  const surplus = totalAssets - totalLiabilities;

  const marketShare = activeExposure / Math.max(totalMarketExposure, 0.01);

  // Generate starting reserve cohorts from the beginning gross unpaid reserve
  // These represent prior accident-year unpaid losses that will roll forward during gameplay
  const startingReserveCohorts = generateStartingReserveCohorts(
    grossUnpaidReserve,
    reinsuranceRecoverable,
    startingYear,
    rng
  );

  // Validate sum
  const cohortSum = startingReserveCohorts.reduce((s, c) => s + c.grossUnpaid, 0);
  if (Math.abs(cohortSum - grossUnpaidReserve) > 1) {
    console.warn(`Starting reserve cohort sum (${cohortSum}) does not match grossUnpaidReserve (${grossUnpaidReserve})`);
  }

  const poolState: PoolState = {
    rateLevel: 100,
    ratePer100,
    purePremiumPer100,
    purePremium: purePremiumPer100,
    memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
    averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
    riskControlEffectiveness: 0,
    reserveCohorts: startingReserveCohorts,
    members: allMembersWithStatus,
    cash,
    investments,
    otherAssets,
    grossUnpaidReserve,
    reinsuranceRecoverable,
    unearnedPremium,
    otherLiabilities,
    surplus,
    totalMarketExposure,
    allMarketMembers: allMembersWithStatus,
  };

  const startingFinancials: StartingFinancials = {
    cash,
    investments,
    reinsuranceRecoverable,
    otherAssets,
    totalAssets,
    grossUnpaidReserve,
    unearnedPremium,
    otherLiabilities,
    totalLiabilities,
    surplus,
    annualPremium,
    expectedLossRatio,
    memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
    riskQuality: parseFloat(riskQuality.toFixed(1)),
    surplusToPremiumRatio: surplus / annualPremium,
    activeMembers: activeMembers.length,
    activeExposure: parseFloat(activeExposure.toFixed(2)),
    totalMarketExposure: parseFloat(totalMarketExposure.toFixed(2)),
    marketShare: parseFloat(marketShare.toFixed(4)),
    rateLevel: 100,
    ratePer100: parseFloat(ratePer100.toFixed(4)),
    purePremiumPer100: parseFloat(purePremiumPer100.toFixed(4)),
    purePremium: parseFloat(purePremiumPer100.toFixed(4)),
  };

  return { poolState, startingFinancials };
}
