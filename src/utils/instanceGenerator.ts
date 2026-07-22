// Generates a deterministic game instance from a seed
// Exposure = payroll in millions of dollars
// Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { GameInstance, Member, PoolState, LinePoolState, StartingFinancials, ReserveCohort } from '../types/simulation';
import { SeededRandom } from './random';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { getMemberExposure, emptyLinePoolState } from './lineHelpers';
import {
  STARTING_FINANCIALS,
  STARTING_MEMBER_RANGE,
  STARTING_POOL_EXPOSURE,
  STARTING_RATE_PER_100,
  RESERVE_PAYDOWN_PCT,
  GL_STARTING_RATE_PER_100,
  GL_EXPECTED_LOSS_RATIO,
  GL_STARTING_FINANCIALS,
  PROPERTY_STARTING_RATE_PER_100,
  PROPERTY_EXPECTED_LOSS_RATIO,
  PROPERTY_STARTING_FINANCIALS,
  LINE_RESERVE_PAYDOWN_PCT,
} from '../data/defaultAssumptions';
import type { CoverageLine } from '../types/simulation';

function assignStartingMembers(allMembers: Member[], rng: SeededRandom, targetCount: number, startingYear: number): Member[] {
  let bestSelection: Member[] = [];
  let bestScore = Number.POSITIVE_INFINITY;

  // Try several seeded selections and keep the one closest to the target
  // payroll band with a balanced average risk quality.
  for (let attempt = 0; attempt < 250; attempt++) {
    const shuffled = [...allMembers];
    rng.shuffle(shuffled);
    const candidate = shuffled.slice(0, targetCount);
    const exposure = candidate.reduce((sum, member) => sum + getMemberExposure(member, 'WC'), 0);
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
  rng: SeededRandom,
  paydownPct: number = RESERVE_PAYDOWN_PCT
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
    const paidRatio = Math.min(0.80, age * paydownPct);
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
      paydownPct,
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

export function generateStartingPoolState(
  instance: GameInstance,
  startingYear: number,
  activeLines: CoverageLine[]
): { poolState: PoolState; startingFinancials: StartingFinancials } {
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

  let activeExposure = activeMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC'), 0);
  let totalMarketExposure = allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC'), 0);

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

  // GL bootstrap draws happen strictly after every WC draw above, so the WC-only
  // seed stream (and its regression baseline) is completely unaffected by GL's
  // presence or absence.
  const glLineState: LinePoolState = activeLines.includes('GL')
    ? (() => {
        const glRatePer100 = rng.range(GL_STARTING_RATE_PER_100.min, GL_STARTING_RATE_PER_100.max);
        const glExpectedLossRatio = rng.range(GL_EXPECTED_LOSS_RATIO.min, GL_EXPECTED_LOSS_RATIO.max);
        const glPurePremiumPer100 = glRatePer100 * glExpectedLossRatio;
        const glGrossUnpaidReserve = rng.range(GL_STARTING_FINANCIALS.grossUnpaidReserve.min, GL_STARTING_FINANCIALS.grossUnpaidReserve.max);
        const glReinsuranceRecoverable = rng.range(GL_STARTING_FINANCIALS.reinsuranceRecoverable.min, GL_STARTING_FINANCIALS.reinsuranceRecoverable.max);
        const glTotalMarketExposure = allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'GL'), 0);
        const glStartingReserveCohorts = generateStartingReserveCohorts(
          glGrossUnpaidReserve,
          glReinsuranceRecoverable,
          startingYear,
          rng
        );
        return {
          rateLevel: 100,
          ratePer100: glRatePer100,
          purePremiumPer100: glPurePremiumPer100,
          purePremium: glPurePremiumPer100,
          memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
          averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
          riskControlEffectiveness: 0,
          reserveCohorts: glStartingReserveCohorts,
          members: allMembersWithStatus,
          grossUnpaidReserve: glGrossUnpaidReserve,
          reinsuranceRecoverable: glReinsuranceRecoverable,
          // Placeholder — the redistribution block below assigns every active
          // line its weighted share of the opening surplus and investments.
          surplus: glReinsuranceRecoverable - glGrossUnpaidReserve,
          investedAssets: 0,
          totalMarketExposure: glTotalMarketExposure,
        };
      })()
    : emptyLinePoolState();

  // Property bootstrap draws happen strictly after WC's and GL's above, so
  // neither of their seed streams (or regression baselines) are affected by
  // Property's presence or absence.
  const propertyLineState: LinePoolState = activeLines.includes('Property')
    ? (() => {
        const propertyRatePer100 = rng.range(PROPERTY_STARTING_RATE_PER_100.min, PROPERTY_STARTING_RATE_PER_100.max);
        const propertyExpectedLossRatio = rng.range(PROPERTY_EXPECTED_LOSS_RATIO.min, PROPERTY_EXPECTED_LOSS_RATIO.max);
        const propertyPurePremiumPer100 = propertyRatePer100 * propertyExpectedLossRatio;
        const propertyGrossUnpaidReserve = rng.range(PROPERTY_STARTING_FINANCIALS.grossUnpaidReserve.min, PROPERTY_STARTING_FINANCIALS.grossUnpaidReserve.max);
        const propertyReinsuranceRecoverable = rng.range(PROPERTY_STARTING_FINANCIALS.reinsuranceRecoverable.min, PROPERTY_STARTING_FINANCIALS.reinsuranceRecoverable.max);
        const propertyTotalMarketExposure = allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'Property'), 0);
        const propertyStartingReserveCohorts = generateStartingReserveCohorts(
          propertyGrossUnpaidReserve,
          propertyReinsuranceRecoverable,
          startingYear,
          rng,
          LINE_RESERVE_PAYDOWN_PCT.Property
        );
        return {
          rateLevel: 100,
          ratePer100: propertyRatePer100,
          purePremiumPer100: propertyPurePremiumPer100,
          purePremium: propertyPurePremiumPer100,
          memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
          averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
          riskControlEffectiveness: 0,
          reserveCohorts: propertyStartingReserveCohorts,
          members: allMembersWithStatus,
          grossUnpaidReserve: propertyGrossUnpaidReserve,
          reinsuranceRecoverable: propertyReinsuranceRecoverable,
          // Placeholder — see the redistribution block below (same as GL).
          surplus: propertyReinsuranceRecoverable - propertyGrossUnpaidReserve,
          investedAssets: 0,
          totalMarketExposure: propertyTotalMarketExposure,
        };
      })()
    : emptyLinePoolState();

  const wcLineState: LinePoolState = {
    rateLevel: 100,
    ratePer100,
    purePremiumPer100,
    purePremium: purePremiumPer100,
    memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
    averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
    riskControlEffectiveness: 0,
    reserveCohorts: startingReserveCohorts,
    members: allMembersWithStatus,
    grossUnpaidReserve,
    reinsuranceRecoverable,
    surplus,
    investedAssets: 0, // assigned by the redistribution block below
    totalMarketExposure,
  };

  // --- Consistent per-line opening surplus allocation ---
  // The engine gives each active line its contribution-share of the shared
  // opening assets (cash/investments/other) when it builds that line's Year 1
  // balance sheet. So each line's STORED starting surplus must be consistent
  // with that — its share of the shared net opening assets, less its own net
  // reserves — or Year 1 fails to tie out. (The prior "WC holds all the assets,
  // other lines hold only their reserves" split made GL/Property launch with a
  // spuriously negative surplus and a Year 1 tie-out gap equal to the shared
  // assets they actually control.)
  //
  // We distribute the pool's single opening surplus across active lines,
  // weighted by each line's net reserve. This conserves the pool total exactly
  // (it only redistributes it), keeps a WC-only game byte-identical (a single
  // active line gets weight 1 -> SHARED_NET - wcNetReserve, WC's existing
  // value), uses no RNG (seed stream untouched), and leaves no line underwater
  // for a solvent pool.
  const sharedNetOpeningAssets = cash + investments + otherAssets - unearnedPremium - otherLiabilities;
  const lineStateByLine: Record<CoverageLine, LinePoolState> = {
    WC: wcLineState,
    GL: glLineState,
    Property: propertyLineState,
  };
  const activeNetReserves = activeLines.map(line => ({
    line,
    netReserve: lineStateByLine[line].grossUnpaidReserve - lineStateByLine[line].reinsuranceRecoverable,
  }));
  const totalActiveNetReserve = activeNetReserves.reduce((s, x) => s + x.netReserve, 0);
  const totalOpeningSurplus = sharedNetOpeningAssets - totalActiveNetReserve;
  const positiveNetReserveTotal = activeNetReserves.reduce((s, x) => s + Math.max(0, x.netReserve), 0);
  for (const { line, netReserve } of activeNetReserves) {
    const weight = positiveNetReserveTotal > 0
      ? Math.max(0, netReserve) / positiveNetReserveTotal
      : 1 / activeLines.length;
    lineStateByLine[line].surplus = totalOpeningSurplus * weight;
    // Stage 2.9: the opening investment portfolio is likewise split into
    // per-line segregated portfolios by the same weight. Conserves the pool
    // total exactly, uses no RNG, and gives a solo line the full amount
    // (weight 1) — identical to what it controlled under the shared model.
    lineStateByLine[line].investedAssets = investments * weight;
  }

  const poolState: PoolState = {
    cash,
    otherAssets,
    unearnedPremium,
    otherLiabilities,
    allMarketMembers: allMembersWithStatus,
    lines: {
      WC: wcLineState,
      GL: glLineState,
      Property: propertyLineState,
    },
    interLineLoans: [],
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
