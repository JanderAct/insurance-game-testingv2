// Generates a deterministic game instance from a seed
// Exposure = payroll in millions of dollars
// Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { GameInstance, Member, MembershipHistory, PoolState, LinePoolState, StartingFinancials, ReserveCohort } from '../types/simulation';
import { SeededRandom, deriveSubRng } from './random';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { getMemberExposure, emptyLinePoolState } from './lineHelpers';
import {
  STARTING_FINANCIALS,
  STARTING_EXPOSURE_SHARE,
  STARTING_CAPITAL_TO_PREMIUM,
  OPERATING_CASH_PCT_OF_PREMIUM,
  STARTING_RATE_PER_100,
  RESERVE_PAYDOWN_PCT,
  GL_STARTING_RATE_PER_100,
  GL_EXPECTED_LOSS_RATIO,
  GL_STARTING_FINANCIALS,
  PROPERTY_STARTING_RATE_PER_100,
  PROPERTY_EXPECTED_LOSS_RATIO,
  PROPERTY_STARTING_FINANCIALS,
  LINE_RESERVE_PAYDOWN_PCT,
  IBNER_HORIZON,
  IBNER_STEP_MIXTURE,
} from '../data/defaultAssumptions';
import type { CoverageLine } from '../types/simulation';

// Each active line independently enrolls its own starting members. First it
// draws its own seeded TARGET share within the STARTING_EXPOSURE_SHARE band
// (25-35%) — so different seeds/lines land at different points across the band,
// not always at the 25% floor. Then it iterates the 100-member market in a
// seeded random order, accumulating that line's enrolled exposure (WC payroll /
// GL payroll / Property TIV) until it reaches that drawn target. A member whose
// exposure would push the running total past the target is skipped in favor of
// smaller members later in the order, so the landing is always at-or-just-below
// the target (hence inside the band) — single pass, no retries, deterministic
// per seed. The exposure target drives the member count; there is no separate
// count draw or quality screen at enrollment (underwriting strictness screening
// remains a live-year recruitment mechanic and can't apply before any decisions
// exist). The target draw and the shuffle share this line's own derived stream,
// so both are deterministic per seed and independent of the other lines.
function selectStartingLineMembers(
  allMembers: Member[],
  line: CoverageLine,
  rng: SeededRandom,
  // Threaded only so the two exposure reads below sit on ONE basis. The
  // selection is a RATIO (targetShare x totalExposure), so the wage factor
  // cancels exactly and the chosen book is year-invariant whatever is passed.
  yearNumber: number,
): Set<string> {
  const totalExposure = allMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);
  const targetShare = rng.range(STARTING_EXPOSURE_SHARE.min, STARTING_EXPOSURE_SHARE.max);
  const targetExposure = targetShare * totalExposure;

  const order = rng.shuffle([...allMembers]);
  const selected = new Set<string>();
  let enrolled = 0;

  for (const member of order) {
    if (enrolled >= targetExposure) break;
    const exposure = getMemberExposure(member, line, yearNumber);
    if (exposure <= 0 || enrolled + exposure > targetExposure) continue;
    selected.add(member.id);
    enrolled += exposure;
  }

  return selected;
}

// Per-line RNG label for the enrollment stream — WC unsuffixed, matching the
// engine's lineRngLabel convention, so each line's roster is deterministic per
// seed AND independent of which other lines are active.
function enrollLabel(line: CoverageLine): string {
  return line === 'WC' ? 'enroll' : `enroll_${line}`;
}

// One draw from IBNER_STEP_MIXTURE. Duplicated from simulationEngine's
// drawStepMultiplier rather than imported: instanceGenerator is upstream of the
// engine and importing from it would make a cycle. Both read the SAME exported
// constant, so the mixture itself has one definition.
function drawStepMultiplierFor(rng: SeededRandom): number {
  const u = rng.next();
  let acc = 0;
  for (const bucket of IBNER_STEP_MIXTURE) {
    acc += bucket.weight;
    if (u < acc) return bucket.multiplier;
  }
  return IBNER_STEP_MIXTURE[IBNER_STEP_MIXTURE.length - 1].multiplier;
}

// Generate starting reserve cohorts from the beginning NET unpaid reserve
// These are prior accident-year cohorts that exist before gameplay starts
// ⚠ PRE-GAME COHORTS ARE SYNTHETIC AND HAVE NO CLAIM REGISTER BEHIND THEM.
// They are apportioned from a drawn reserve TOTAL, so there is no "sum of drawn
// claims" that ever existed for them. `registerSum` is therefore set equal to
// the generated `netUltimate`, which makes their IBNER provision exactly zero at
// game start — they begin honest and develop forward from there. Their history
// is NOT back-filled: the Actuarial exhibit shows blanks for their pre-game
// years and measures their total development FROM GAME START, because inventing
// a development history that never happened would put fiction in the one exhibit
// whose whole value is showing real movement.
//
// They carry NO booking bias. The bias is a consequence of a funding decision
// the player made, and they predate the player.
//
// ⚠ THE IBNER DRAWS USE THEIR OWN SUB-STREAM, not the instance `rng` threaded
// through here. Drawing horizon and step multiplier from the shared stream would
// re-roll every later instance-generation draw for reasons unrelated to this
// change, and the `deriveSubRng(seed, 0, label)` pattern beside enrollLabel is
// the existing precedent for exactly this.
function generateStartingReserveCohorts(
  netUnpaidReserve: number,
  startingYear: number,
  rng: SeededRandom,
  line: CoverageLine,
  ibnerRng: SeededRandom,
  paydownPct: number = RESERVE_PAYDOWN_PCT
): ReserveCohort[] {
  if (netUnpaidReserve <= 0) return [];

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

  // Distribute the net unpaid reserve across cohorts
  let remainingReserve = netUnpaidReserve;

  for (let i = 0; i < numCohorts; i++) {
    // Last cohort gets the remainder to ensure exact sum
    const isLast = i === numCohorts - 1;
    const cohortNetUnpaid = isLast ? remainingReserve : netUnpaidReserve * weights[i];

    // Calculate how much has been paid on this cohort (older = more paid)
    // Age determines paydown: cohorts aged 1-5 years
    const age = i + 1; // 1 = most recent (1 year ago), 5 = oldest (5 years ago)
    const paidRatio = Math.min(0.80, age * paydownPct);
    const netUltimate = cohortNetUnpaid / (1 - paidRatio);
    const netPaid = netUltimate * paidRatio;

    // Year number is negative for prior accident years (relative to game start)
    // yearNumber 0 = accident year before game starts
    // Calendar year is game starting year minus age
    const cohortYearNumber = -age;
    const cohortCalendarYear = startingYear - age;

    // ⚠ HORIZON IS DRAWN THEN AGED. A cohort five years old has already used
    // five years of its runoff, so it develops only for whatever remains. Giving
    // every pre-game cohort a full fresh horizon would hand the oldest ones more
    // remaining uncertainty than a brand-new accident year, which is backwards.
    // `age` is carried so processIbner's `age < horizon` test does the rest, and
    // a cohort drawn shorter than its own age is simply already mature.
    const horizon = ibnerRng.intRange(IBNER_HORIZON[line].min, IBNER_HORIZON[line].max);

    cohorts.push({
      yearNumber: cohortYearNumber,
      calendarYear: cohortCalendarYear,
      netUltimate,
      netPaid,
      netUnpaid: cohortNetUnpaid,
      paydownPct,
      closed: false,
      registerSum: netUltimate,
      horizon,
      age,
      stepMultiplier: drawStepMultiplierFor(ibnerRng),
      bookingBias: 0,
    });

    remainingReserve -= cohortNetUnpaid;
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

// THE OPENING STATE IS DEFINED IN YEAR-1 DOLLARS, and every exposure read in
// this file uses it rather than `firstYearNumber`.
//
// ⚠ NOT AN OVERSIGHT — using firstYearNumber (-2 for the pre-game bootstrap)
// deflates the opening book ~10% by wageFactor while STARTING_FINANCIALS'
// premium/surplus ranges stay fixed dollars, which silently re-rates the whole
// opening position and moves every seed's starting membership. Year 1 is the
// reference year of the trend system (every factor is exactly 1.0 there) and it
// is the vintage memberCatalog's payroll is authored in, so the dollar constants
// calibrated against that roster keep meaning what they meant.
//
// The pre-game years still deflate — processYear applies the factor per year on
// its own — so the past really is cheaper. Only the OPENING reference is pinned.
const OPENING_EXPOSURE_YEAR = 1;

export function generateStartingPoolState(
  instance: GameInstance,
  startingYear: number,
  activeLines: CoverageLine[],
  // The yearNumber of the first year the caller will simulate on this state
  // (-2 for the pre-game bootstrap). Opening enrollees' ledger intervals are
  // active from this year on.
  firstYearNumber: number
): { poolState: PoolState; startingFinancials: StartingFinancials } {
  const rng = new SeededRandom(instance.seed + 777);

  const allMarketMembers = getPredefinedMarketMembers();

  // Each active line draws its OWN starting roster (different but overlapping
  // sets) from its own derived stream — enrollment happens here, BEFORE the
  // pre-game years simulate on the enrolled books.
  const enrolledIdsByLine: Partial<Record<CoverageLine, Set<string>>> = {};
  for (const line of activeLines) {
    enrolledIdsByLine[line] = selectStartingLineMembers(
      allMarketMembers,
      line,
      deriveSubRng(instance.seed, 0, enrollLabel(line)),
      OPENING_EXPOSURE_YEAR,
    );
  }

  const lineMembers = (line: CoverageLine): Member[] => {
    const ids = enrolledIdsByLine[line] ?? new Set<string>();
    return allMarketMembers.map(m => ({
      ...m,
      status: ids.has(m.id) ? ('active' as const) : ('prospect' as const),
      yearJoined: ids.has(m.id) ? 1 : 0,
      calendarYearJoined: ids.has(m.id) ? startingYear : 0,
    }));
  };

  // Shared market roster: a member is 'active' if it's enrolled in ANY active
  // line (only 'withdrawn' blocks recruitment elsewhere, so multi-line
  // membership keeps working exactly as in live years).
  const activeInAnyLine = new Set<string>(
    activeLines.flatMap(line => [...(enrolledIdsByLine[line] ?? [])])
  );
  const allMembersWithStatus: Member[] = allMarketMembers.map(m => ({
    ...m,
    status: activeInAnyLine.has(m.id) ? ('active' as const) : ('prospect' as const),
    yearJoined: activeInAnyLine.has(m.id) ? 1 : 0,
    calendarYearJoined: activeInAnyLine.has(m.id) ? startingYear : 0,
  }));

  const wcMembers = lineMembers('WC');
  const activeMembers = wcMembers.filter(m => m.status === 'active');

  let activeExposure = activeMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC', OPENING_EXPOSURE_YEAR), 0);
  let totalMarketExposure = allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC', OPENING_EXPOSURE_YEAR), 0);

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
  // Retained solely to preserve RNG stream position. The reinsurance-recoverable
  // concept was removed (reserves are now net of reinsurance), but this draw
  // still consumes the bootstrap stream so that every subsequent draw — starting
  // cash, investments, reserves, cohort development factors, member generation —
  // lands on the same value as before. Deleting it would shift the whole sequence
  // and re-roll every seed's opening position.
  // The drawn value is used only locally: seededNetReserve = grossDraw - recoverableDraw.
  const wcRecoverableDraw = rng.range(STARTING_FINANCIALS.reinsuranceRecoverable.min, STARTING_FINANCIALS.reinsuranceRecoverable.max);
  // Retained solely to preserve RNG stream position. The otherAssets/
  // otherLiabilities concepts were removed (frozen bootstrap constants with no
  // mechanic), but these draws still consume the bootstrap stream so every
  // subsequent draw lands on the same value as before. Deleting them would
  // shift the sequence and re-roll every seed's opening position. The drawn
  // values are discarded.
  rng.range(STARTING_FINANCIALS.otherAssets.min, STARTING_FINANCIALS.otherAssets.max);
  const wcGrossReserveDraw = rng.range(STARTING_FINANCIALS.grossUnpaidReserve.min, STARTING_FINANCIALS.grossUnpaidReserve.max);
  const netUnpaidReserve = wcGrossReserveDraw - wcRecoverableDraw;
  // Held at zero, matching every subsequent year: written premium is treated as collected
  // and earned in the year it's written, with no separate unearned-premium timing layer.
  const unearnedPremium = 0;
  // Retained solely to preserve RNG stream position (see the otherAssets draw above).
  rng.range(STARTING_FINANCIALS.otherLiabilities.min, STARTING_FINANCIALS.otherLiabilities.max);

  const totalAssets = cash + investments;
  const totalLiabilities = netUnpaidReserve + unearnedPremium;
  const surplus = totalAssets - totalLiabilities;

  const marketShare = activeExposure / Math.max(totalMarketExposure, 0.01);

  // Generate starting reserve cohorts from the beginning NET unpaid reserve
  // These represent prior accident-year unpaid losses that will roll forward during gameplay
  const startingReserveCohorts = generateStartingReserveCohorts(
    netUnpaidReserve,
    startingYear,
    rng,
    'WC',
    deriveSubRng(instance.seed, 0, 'ibner_seed_WC'),
  );

  // Validate sum
  const cohortSum = startingReserveCohorts.reduce((s, c) => s + c.netUnpaid, 0);
  if (Math.abs(cohortSum - netUnpaidReserve) > 1) {
    console.warn(`Starting reserve cohort sum (${cohortSum}) does not match netUnpaidReserve (${netUnpaidReserve})`);
  }

  // GL bootstrap draws happen strictly after every WC draw above, so the WC-only
  // seed stream (and its regression baseline) is completely unaffected by GL's
  // presence or absence.
  const glLineState: LinePoolState = activeLines.includes('GL')
    ? (() => {
        const glRatePer100 = rng.range(GL_STARTING_RATE_PER_100.min, GL_STARTING_RATE_PER_100.max);
        const glExpectedLossRatio = rng.range(GL_EXPECTED_LOSS_RATIO.min, GL_EXPECTED_LOSS_RATIO.max);
        const glPurePremiumPer100 = glRatePer100 * glExpectedLossRatio;
        const glGrossReserveDraw = rng.range(GL_STARTING_FINANCIALS.grossUnpaidReserve.min, GL_STARTING_FINANCIALS.grossUnpaidReserve.max);
        // Retained solely to preserve RNG stream position. The reinsurance-recoverable
        // concept was removed (reserves are now net of reinsurance), but this draw
        // still consumes the bootstrap stream so that every subsequent draw — starting
        // cash, investments, reserves, cohort development factors, member generation —
        // lands on the same value as before. Deleting it would shift the whole sequence
        // and re-roll every seed's opening position.
        // The drawn value is used only locally: seededNetReserve = grossDraw - recoverableDraw.
        const glRecoverableDraw = rng.range(GL_STARTING_FINANCIALS.reinsuranceRecoverable.min, GL_STARTING_FINANCIALS.reinsuranceRecoverable.max);
        const glNetUnpaidReserve = glGrossReserveDraw - glRecoverableDraw;
        const glTotalMarketExposure = allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'GL', OPENING_EXPOSURE_YEAR), 0);
        const glStartingReserveCohorts = generateStartingReserveCohorts(
          glNetUnpaidReserve,
          startingYear,
          rng,
          'GL',
          deriveSubRng(instance.seed, 0, 'ibner_seed_GL'),
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
          members: lineMembers('GL'),
          netUnpaidReserve: glNetUnpaidReserve,
          // Placeholder — the redistribution block below assigns every active
          // line its weighted share of the opening surplus and investments.
          surplus: -glNetUnpaidReserve,
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
        const propertyGrossReserveDraw = rng.range(PROPERTY_STARTING_FINANCIALS.grossUnpaidReserve.min, PROPERTY_STARTING_FINANCIALS.grossUnpaidReserve.max);
        // Retained solely to preserve RNG stream position. The reinsurance-recoverable
        // concept was removed (reserves are now net of reinsurance), but this draw
        // still consumes the bootstrap stream so that every subsequent draw — starting
        // cash, investments, reserves, cohort development factors, member generation —
        // lands on the same value as before. Deleting it would shift the whole sequence
        // and re-roll every seed's opening position.
        // The drawn value is used only locally: seededNetReserve = grossDraw - recoverableDraw.
        const propertyRecoverableDraw = rng.range(PROPERTY_STARTING_FINANCIALS.reinsuranceRecoverable.min, PROPERTY_STARTING_FINANCIALS.reinsuranceRecoverable.max);
        const propertyNetUnpaidReserve = propertyGrossReserveDraw - propertyRecoverableDraw;
        const propertyTotalMarketExposure = allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'Property', OPENING_EXPOSURE_YEAR), 0);
        const propertyStartingReserveCohorts = generateStartingReserveCohorts(
          propertyNetUnpaidReserve,
          startingYear,
          rng,
          'Property',
          deriveSubRng(instance.seed, 0, 'ibner_seed_Property'),
          LINE_RESERVE_PAYDOWN_PCT.Property,
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
          members: lineMembers('Property'),
          netUnpaidReserve: propertyNetUnpaidReserve,
          // Placeholder — see the redistribution block below (same as GL).
          surplus: -propertyNetUnpaidReserve,
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
    members: wcMembers,
    netUnpaidReserve,
    surplus,
    investedAssets: 0, // assigned by the redistribution block below
    totalMarketExposure,
  };

  // --- Per-line opening capital (seed-fix-per-line-opening) ---
  // Each active line's opening surplus = STARTING_CAPITAL_TO_PREMIUM[line] × its
  // OWN opening premium (its enrolled exposure × its rate). Invested assets are
  // the balance-sheet plug that realizes that surplus; operating cash is the
  // line's own 15%-of-premium target. This depends only on the line's own
  // premium/reserves — config-independent — replacing the old net-reserve-
  // weighted split of one shared pot (which made a line's opening depend on
  // which other lines were active). The shared cash/other-assets pool becomes
  // the SUM of each active line's own operating items; the live-year
  // contribution-share split then faithfully reproduces each line's stored
  // surplus (the split is constructed to do exactly that when the pool total is
  // internally consistent — see computeContributionShares), so Year 1 ties out
  // with cash still pooled.
  const lineStateByLine: Record<CoverageLine, LinePoolState> = {
    WC: wcLineState,
    GL: glLineState,
    Property: propertyLineState,
  };
  let poolCash = 0;
  activeLines.forEach(line => {
    const ls = lineStateByLine[line];
    const activeExp = ls.members
      .filter(m => m.status === 'active')
      .reduce((s, m) => s + getMemberExposure(m, line, OPENING_EXPOSURE_YEAR), 0);
    const linePremium = activeExp * ls.ratePer100 * 10_000;
    const targetSurplus = (STARTING_CAPITAL_TO_PREMIUM[line] ?? 1.0) * linePremium;
    const lineCash = OPERATING_CASH_PCT_OF_PREMIUM * linePremium;
    // surplus = cash + invested − netReserve
    // ⇒ invested = surplus + netReserve − cash
    ls.investedAssets = targetSurplus + ls.netUnpaidReserve - lineCash;
    ls.surplus = targetSurplus;
    poolCash += lineCash;
  });

  // Opening ledger: each line's enrollees are active from the first simulated
  // year. This is the authoritative per-line enrollment record (the shared
  // status field cannot answer per-line questions — see membershipHistory.ts).
  const membershipHistory: MembershipHistory = {};
  for (const line of activeLines) {
    for (const id of enrolledIdsByLine[line] ?? []) {
      const byLine = (membershipHistory[id] ??= {});
      byLine[line] = [{ startYear: firstYearNumber, endYear: null }];
    }
  }

  const poolState: PoolState = {
    cash: poolCash,
    unearnedPremium,
    allMarketMembers: allMembersWithStatus,
    lines: {
      WC: wcLineState,
      GL: glLineState,
      Property: propertyLineState,
    },
    interLineLoans: [],
    membershipHistory,
    // Empty at bootstrap by construction: no year has been simulated yet, so
    // there is nothing to record. The three pre-game years fill it as they run
    // through processYear (see priorHistoryEngine), which is why members carry
    // history at Year 1 rather than starting blank.
    memberLossHistory: {},
  };

  const startingFinancials: StartingFinancials = {
    cash,
    investments,
    totalAssets,
    netUnpaidReserve,
    unearnedPremium,
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
