// Stage 2.10 — per-line prior histories.
//
// Each active line gets a REAL simulated 3-year pre-game past (yearNumbers -2,
// -1, 0) produced by the same engine as live years (processYear ->
// processLineYear), at default decisions. Year 0's ending state IS the Year 1
// opening position — the history feeds the game, it isn't just display.
//
// Seeding: every engine draw is deriveSubRng(seed, yearNumber, label) — a pure
// stateless function — so pre-game years -2..0 use sub-streams fully disjoint
// from live years 1..N, and running the pre-game sim cannot shift any live
// draw. Reproducible by construction: same seed -> same history, always.
//
// Adequacy (reject-and-redraw, NO clamping): every active line must begin the
// game rated at least Adequate (excessAvailableSurplus >= 0 — the game's
// existing capital-adequacy definition). If any line ends the pre-game sim
// below that, the 3 pre-game years are re-simulated on a deterministically
// derived alternate seed (seed + attempt * 997, the same accept/reject seed
// convention the old synthetic history generator used) until every line ends
// Adequate-or-better. The accepted history is fully real and ties out — no
// phantom surplus is ever injected. The scan order is fixed, so the same seed
// always lands on the same accepted attempt. Live years always use the true
// instance seed regardless of which attempt was accepted.

import type {
  CoverageLine,
  GameInstance,
  GameSetupSettings,
  GameState,
  HistoricalYear,
  LineResultSet,
  PoolState,
  ResultSet,
  StartingFinancials,
} from '../types/simulation';
import { generateStartingPoolState } from './instanceGenerator';
import { processYear } from './simulationEngine';
import { defaultDecisionSet } from './decisionDefaults';

export const PRE_GAME_YEARS = 3; // yearNumbers -2, -1, 0
const MAX_HISTORY_ATTEMPTS = 500;

export interface PriorHistoryResult {
  priorHistory: ResultSet[];      // the 3 accepted pre-game years, oldest first
  poolState: PoolState;           // ending state after year 0 = Year 1 opening
  startingFinancials: StartingFinancials;
  historyAttempt: number;         // which derived seed was accepted (0 = base seed)
}

// Simulate the 3 pre-game years from the bootstrap position on one candidate
// seed. Loan offers are auto-declined (no player exists pre-game); a line that
// dips negative mid-history can still recover — only the ENDING position is
// gated by the adequacy check.
function simulateCandidate(
  instance: GameInstance,
  setup: GameSetupSettings,
  bootstrapPoolState: PoolState,
  attempt: number
): { priorHistory: ResultSet[]; poolState: PoolState } {
  const candidateInstance: GameInstance = attempt === 0
    ? instance
    : { ...instance, seed: (instance.seed + attempt * 997) >>> 0 };

  let gs: GameState = {
    setup,
    instance: candidateInstance,
    currentYearNumber: -(PRE_GAME_YEARS - 1), // -2
    isStarted: true,
    isComplete: false,
    poolState: structuredClone(bootstrapPoolState),
    lockedResults: [],
    currentDecisions: defaultDecisionSet(-(PRE_GAME_YEARS - 1)),
    priorHistory: [],
  };

  for (let y = -(PRE_GAME_YEARS - 1); y <= 0; y++) {
    const processed = processYear(gs, defaultDecisionSet(y));
    // Committing the pre-authorization result IS the auto-decline: a deficient
    // line keeps its negative surplus (and blocked dividend next year).
    gs = {
      ...gs,
      currentYearNumber: y + 1,
      poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result],
    };
  }

  return { priorHistory: gs.lockedResults, poolState: gs.poolState };
}

function minLineExcessSurplus(lastResult: ResultSet, activeLines: CoverageLine[]): number {
  return Math.min(...activeLines.map(line => lastResult.byLine[line].excessAvailableSurplus));
}

export function runPriorHistory(
  instance: GameInstance,
  setup: GameSetupSettings
): PriorHistoryResult {
  // The bootstrap draws now describe the pool's position 3 years BEFORE game
  // start (same draw sequence as before — the seed stream is untouched — only
  // the calendar labeling shifts). Its seed reserve cohorts are relabeled 3
  // years older so they don't collide with the pre-game years' own new
  // accident-year cohorts (pure relabel — cohort math never reads yearNumber).
  const { poolState: bootstrapPoolState } = generateStartingPoolState(
    instance,
    setup.startingYear - PRE_GAME_YEARS,
    setup.activeLines
  );
  for (const line of setup.activeLines) {
    const ls = bootstrapPoolState.lines[line];
    ls.reserveCohorts = ls.reserveCohorts.map(c => ({ ...c, yearNumber: c.yearNumber - PRE_GAME_YEARS }));
  }

  let best: { candidate: ReturnType<typeof simulateCandidate>; attempt: number; minExcess: number } | null = null;

  for (let attempt = 0; attempt < MAX_HISTORY_ATTEMPTS; attempt++) {
    const candidate = simulateCandidate(instance, setup, bootstrapPoolState, attempt);
    const lastResult = candidate.priorHistory[candidate.priorHistory.length - 1];
    const minExcess = minLineExcessSurplus(lastResult, setup.activeLines);

    if (minExcess >= 0) {
      return finalize(candidate, attempt);
    }
    if (!best || minExcess > best.minExcess) {
      best = { candidate, attempt, minExcess };
    }
  }

  // Pathological seed: no attempt produced an all-lines-Adequate ending. Fall
  // back to the closest attempt (still a real, tied-out history — just below
  // Adequate on some line) rather than clamping or injecting surplus.
  console.warn(
    `Prior history: no attempt of ${MAX_HISTORY_ATTEMPTS} ended all lines Adequate; ` +
    `using best attempt ${best!.attempt} (min excess surplus ${Math.round(best!.minExcess)}).`
  );
  return finalize(best!.candidate, best!.attempt);
}

function finalize(
  candidate: { priorHistory: ResultSet[]; poolState: PoolState },
  attempt: number
): PriorHistoryResult {
  return {
    priorHistory: candidate.priorHistory,
    poolState: candidate.poolState,
    startingFinancials: deriveStartingFinancials(candidate.poolState, candidate.priorHistory),
    historyAttempt: attempt,
  };
}

// The Year 1 opening position, derived from the pre-game ending state instead
// of raw draws. Pool-level: sums span all lines (inactive lines are zeroed
// empty states, so summing all three is safe).
function deriveStartingFinancials(poolState: PoolState, priorHistory: ResultSet[]): StartingFinancials {
  const lastResult = priorHistory[priorHistory.length - 1];
  const lines = Object.values(poolState.lines);

  const investments = lines.reduce((s, l) => s + l.investedAssets, 0);
  const reinsuranceRecoverable = lines.reduce((s, l) => s + l.reinsuranceRecoverable, 0);
  const grossUnpaidReserve = lines.reduce((s, l) => s + l.grossUnpaidReserve, 0);

  const totalAssets = poolState.cash + investments + reinsuranceRecoverable + poolState.otherAssets;
  const totalLiabilities = grossUnpaidReserve + poolState.unearnedPremium + poolState.otherLiabilities;
  const surplus = totalAssets - totalLiabilities;
  const annualPremium = lastResult.totalMemberCharge;

  return {
    cash: poolState.cash,
    investments,
    reinsuranceRecoverable,
    otherAssets: poolState.otherAssets,
    totalAssets,
    grossUnpaidReserve,
    unearnedPremium: poolState.unearnedPremium,
    otherLiabilities: poolState.otherLiabilities,
    totalLiabilities,
    surplus,
    annualPremium,
    expectedLossRatio: lastResult.expectedLossRatio,
    memberSatisfaction: parseFloat(lastResult.memberSatisfaction.toFixed(1)),
    riskQuality: parseFloat(lastResult.averageRiskQuality.toFixed(1)),
    surplusToPremiumRatio: surplus / Math.max(annualPremium, 1),
    activeMembers: lastResult.activeMembers,
    activeExposure: lastResult.activeExposure,
    totalMarketExposure: lastResult.totalMarketExposure,
    marketShare: lastResult.marketShare,
    rateLevel: lastResult.rateLevel,
    ratePer100: lastResult.ratePer100,
    purePremiumPer100: lastResult.purePremiumPer100,
    purePremium: lastResult.purePremiumPer100,
  };
}

// Adapter: map a real pre-game result (pool or per-line slice) onto the
// HistoricalYear display shape the Pool History / Dashboard / Financials
// pages already render. Every field is present on (or derivable from) the
// real result — no synthetic values.
export function toHistoricalYear(r: LineResultSet): HistoricalYear {
  return {
    historyYearNumber: r.yearNumber,
    calendarYear: r.calendarYear,
    activeMembers: r.activeMembers,
    activeExposure: r.activeExposure,
    totalMarketExposure: r.totalMarketExposure,
    marketShare: r.marketShare,
    purePremiumPer100: r.purePremiumPer100,
    poolPremiumRatePer100: r.poolPremium / Math.max(r.activeExposure * 10_000, 1),
    expectedLoss: r.expectedLoss,
    poolPremium: r.poolPremium,
    adminExpense: r.adminExpense,
    poolPremiumAndAdminExpense: r.poolPremiumAndAdminExpense,
    selfFundedDiscount: r.selfFundedDiscount,
    reinsuranceCost: r.reinsuranceCost,
    totalMemberCharge: r.totalMemberCharge,
    grossUltimateLoss: r.grossUltimateLoss,
    attachment: r.attachment,
    poolLosses: r.poolLosses,
    excessLosses: r.excessLosses,
    quotaShareLosses: r.quotaShareLosses,
    reinsuranceRecovery: r.reinsuranceRecovery,
    netUltimateLoss: r.netUltimateLoss,
    grossPaidLosses: r.grossPaidLosses,
    endingGrossReserve: r.endingGrossReserve,
    endingReinsuranceRecoverable: r.endingReinsRecoverable,
    endingNetReserve: r.expectedNetUnpaidLoss,
    actualLossRatio: r.actualLossRatio,
    actualExpenseRatio: r.actualExpenseRatio,
    actualCombinedRatio: r.actualCombinedRatio,
    underwritingIncome: r.underwritingIncome,
    investmentIncome: r.investmentIncome,
    netIncome: r.netIncome,
    endingSurplus: r.endingSurplus,
    requiredReserveMargin: r.reserveRiskMarginNeeded,
    excessCapitalRatio: r.excessCapitalRatio,
    capitalAdequacyStatus: r.capitalAdequacyStatus,
  };
}
