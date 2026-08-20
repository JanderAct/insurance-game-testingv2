// Stage 2.10 + seed-fix-per-line-opening — per-line prior histories.
//
// Each active line gets a REAL simulated 3-year pre-game past (yearNumbers -2,
// -1, 0) produced by the same engine as live years, at default decisions. Each
// line is simulated IN ISOLATION (a single-line pre-game), so its history is
// config-independent: WC's pre-game is byte-identical whether the game is
// WC-only, WC+GL, or WC+GL+Property. There is no shared roster fold and no
// pool-wide reseed across lines during the pre-game. The per-line ending states
// are then assembled into the Year 1 opening pool; live years (Y1+) resume the
// normal multi-line shared-cash fold, which reproduces each line's stored
// surplus (so tie-out holds with cash still pooled).
//
// Seeding: every engine draw is deriveSubRng(seed, yearNumber, label), a pure
// stateless function; each line's streams are label-keyed to that line, so a
// line at attempt 0 uses the true instance seed and is unaffected by whether
// other lines exist or needed a redraw.
//
// Opening band (PER-LINE reject-and-redraw, NO clamping): each active line
// must end its pre-game with opening surplus inside that line's own
// OPENING_SURPLUS_TO_PREMIUM_BAND — [min, max] × its own opening POOL PREMIUM
// (two-sided: too weak AND too strong both redraw). If a line lands outside,
// ONLY that line re-simulates on a deterministically derived alternate seed
// (seed + attempt * 997) until it lands in-band — one line's redraw never
// reseeds another. Deterministic: same seed -> same per-line redraw path
// -> same history, every config. The accepted history is real and ties out.

import type {
  CoverageLine,
  GameInstance,
  GameSetupSettings,
  GameState,
  HistoricalYear,
  LineResultSet,
  LinePoolState,
  Member,
  MembershipHistory,
  MemberLossHistory,
  PoolState,
  ResultSet,
  StartingFinancials,
} from '../types/simulation';
import { generateStartingPoolState } from './instanceGenerator';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { OPENING_SURPLUS_TO_PREMIUM_BAND } from '../data/defaultAssumptions';
import { processYear, aggregateLineResults } from './simulationEngine';
import { emptyLinePoolState } from './lineHelpers';
import { defaultDecisionSet } from './decisionDefaults';

export const PRE_GAME_YEARS = 3; // yearNumbers -2, -1, 0
const MAX_HISTORY_ATTEMPTS = 500;

export interface PriorHistoryResult {
  priorHistory: ResultSet[];      // the 3 accepted pre-game years, oldest first (pool aggregate)
  poolState: PoolState;           // ending state after year 0 = Year 1 opening
  startingFinancials: StartingFinancials;
  historyAttempt: number;         // max accepted per-line attempt (0 = all lines passed on base seed)
}

// One line's accepted solo pre-game: the 3 per-line yearly results plus its
// ending line state and its own ending shared operating items.
interface LinePreGame {
  line: CoverageLine;
  lineResults: LineResultSet[];   // years -2, -1, 0 for this line
  lineState: LinePoolState;       // ending state (Year 1 opening for this line)
  cash: number;                   // this line's own ending operating cash
  unearnedPremium: number;
  members: Member[];              // this line's ending roster
  membershipHistory: MembershipHistory; // this line's pre-game enrollment ledger
  memberLossHistory: MemberLossHistory; // this line's pre-game marketplace loss record
  attempt: number;
}

// Run one line's 3 pre-game years IN ISOLATION (single-line sim) on a given
// candidate seed. Loan offers can't arise (single line), and the ending is
// gated by that line's own adequacy in the caller.
function simulateLineCandidate(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine,
  attempt: number
): { lineResults: LineResultSet[]; poolState: PoolState; pooled: ResultSet[] } {
  const candidateInstance: GameInstance = attempt === 0
    ? instance
    : { ...instance, seed: (instance.seed + attempt * 997) >>> 0 };

  const soloSetup: GameSetupSettings = { ...setup, activeLines: [line] };
  const { poolState: bootstrap } = generateStartingPoolState(
    candidateInstance,
    setup.startingYear - PRE_GAME_YEARS,
    [line],
    -(PRE_GAME_YEARS - 1)
  );
  // Relabel this line's seed reserve cohorts 3 years older so they don't
  // collide with the pre-game years' own new accident-year cohorts.
  bootstrap.lines[line].reserveCohorts = bootstrap.lines[line].reserveCohorts.map(
    c => ({ ...c, yearNumber: c.yearNumber - PRE_GAME_YEARS })
  );

  let gs: GameState = {
    setup: soloSetup,
    instance: candidateInstance,
    currentYearNumber: -(PRE_GAME_YEARS - 1),
    isStarted: true,
    isComplete: false,
    poolState: bootstrap,
    lockedResults: [],
    currentDecisions: defaultDecisionSet(-(PRE_GAME_YEARS - 1)),
    priorHistory: [],
  };

  for (let y = -(PRE_GAME_YEARS - 1); y <= 0; y++) {
    const processed = processYear(gs, defaultDecisionSet(y));
    gs = {
      ...gs,
      currentYearNumber: y + 1,
      poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result],
    };
  }

  return {
    lineResults: gs.lockedResults.map(r => r.byLine[line]),
    poolState: gs.poolState,
    pooled: gs.lockedResults,
  };
}

// Per-line reject-and-redraw: re-simulate ONLY this line until its opening
// surplus lands inside OPENING_SURPLUS_TO_PREMIUM_BAND (two-sided).
//
// ⚠ MEASURED AGAINST PREMIUM, NOT AGAINST THE REQUIRED RESERVE MARGIN. The
// margin is expectedNetUnpaidLoss x (reserveMarginCLF - 1), and testing against
// it made the opening move whenever the reserve, the reserve-margin CLF or the
// funding basis moved — three consecutive commits did exactly that, none of them
// a decision. Premium is the same quantity STARTING_CAPITAL_TO_PREMIUM already
// sets the seed from, so both sides of the pre-game now reference one stable
// basis and the reserve margin has left this path entirely. The band stays
// PER-LINE: a single shared tolerance was measured and rejected because it moved
// WC +22% and Property -18%, which is a re-tune, not a decoupling. See the
// band's own comment for the calibration.
function runLinePreGame(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine
): LinePreGame {
  const band = OPENING_SURPLUS_TO_PREMIUM_BAND[line] ?? { min: 0.83, max: 1.22 };
  let best: { c: ReturnType<typeof simulateLineCandidate>; attempt: number; distance: number } | null = null;

  for (let attempt = 0; attempt < MAX_HISTORY_ATTEMPTS; attempt++) {
    const c = simulateLineCandidate(instance, setup, line, attempt);
    const last = c.lineResults[c.lineResults.length - 1];
    const multiple = last.endingSurplus / Math.max(last.poolPremium, 1);
    if (multiple >= band.min && multiple <= band.max) return finalizeLine(c, line, attempt);
    // Distance to the band (0 inside): the fallback keeps the closest miss.
    const distance = multiple < band.min ? band.min - multiple : multiple - band.max;
    if (!best || distance < best.distance) best = { c, attempt, distance };
  }

  console.warn(
    `Prior history (${line}): no attempt of ${MAX_HISTORY_ATTEMPTS} landed in the ` +
    `[${band.min}, ${band.max}]x opening band; using closest attempt ${best!.attempt} ` +
    `(missed by ${best!.distance.toFixed(2)}x).`
  );
  return finalizeLine(best!.c, line, best!.attempt);
}

function finalizeLine(
  c: ReturnType<typeof simulateLineCandidate>,
  line: CoverageLine,
  attempt: number
): LinePreGame {
  // Stamp the accepted attempt onto each pre-game year's result so the
  // effective seed (instance.seed + attempt x 997) that produced it is
  // recoverable later from saved state, not just during this simulation run.
  const lineResults = c.lineResults.map(r => ({ ...r, pregameAttempt: attempt }));
  return {
    line,
    lineResults,
    lineState: c.poolState.lines[line],
    cash: c.poolState.cash,
    unearnedPremium: c.poolState.unearnedPremium,
    members: c.poolState.lines[line].members,
    membershipHistory: c.poolState.membershipHistory,
    memberLossHistory: c.poolState.memberLossHistory ?? {},
    attempt,
  };
}

export function runPriorHistory(
  instance: GameInstance,
  setup: GameSetupSettings
): PriorHistoryResult {
  // Simulate each active line's pre-game in isolation (config-independent).
  const perLine = setup.activeLines.map(line => runLinePreGame(instance, setup, line));

  // --- Assemble the Year 1 opening pool from the per-line ending states ---
  // Per-line surplus/invested/reserves/roster come straight from each line's
  // own solo pre-game. The shared operating cash is the SUM across lines.
  // The pool total is internally
  // consistent (each solo line's balance sheet ties, and summing preserves
  // that), so the live-year contribution-share split reproduces each line's
  // stored surplus and Year 1 ties out.
  const lines = {} as Record<CoverageLine, LinePoolState>;
  for (const line of (['WC', 'GL', 'Property'] as CoverageLine[])) {
    const pg = perLine.find(p => p.line === line);
    lines[line] = pg ? pg.lineState : emptyLinePoolState();
  }

  // Shared market roster: the FULL canonical marketplace, with a member
  // 'active' if active in ANY line's ending pre-game roster and 'prospect'
  // otherwise — the same OR-semantic instanceGenerator applies at bootstrap.
  //
  // The base set must be the full catalog, not any line's ending roster: a
  // line's ending members are its ACTIVES ONLY (the engine stores
  // memberResult.activeMembers each year), so basing the market on
  // perLine[0].members silently shrank the live-year universe to WC's
  // pre-game survivors. The activeIds OR-union was always computed correctly
  // across lines — it was just applied over that shrunken base, which
  // collapsed recruitment to a near-empty candidate pool and pushed displayed
  // market share to ~97% (>100% for non-WC lines, whose actives weren't even
  // subsets of the base).
  const activeIds = new Set<string>();
  for (const pg of perLine) {
    for (const m of pg.members) if (m.status === 'active') activeIds.add(m.id);
  }
  const allMarketMembers: Member[] = getPredefinedMarketMembers().map(m => ({
    ...m,
    status: activeIds.has(m.id) ? ('active' as const) : ('prospect' as const),
  }));

  // Merge the per-line pre-game ledgers. Each solo pre-game only ever wrote
  // its own line's intervals, so the merge is a disjoint per-line union.
  const membershipHistory: MembershipHistory = {};
  for (const pg of perLine) {
    for (const [memberId, byLine] of Object.entries(pg.membershipHistory)) {
      const intervals = byLine[pg.line];
      if (!intervals || intervals.length === 0) continue;
      const target = (membershipHistory[memberId] ??= {});
      target[pg.line] = intervals.map(iv => ({ ...iv }));
    }
  }

  // Merge the per-line pre-game LOSS records the same way, and for the same
  // reason: each solo pre-game ran with one line active, so recordMemberLossYear
  // only ever wrote that line's key. A disjoint per-line union.
  //
  // This is what gives members THREE YEARS OF HISTORY AT YEAR 1 instead of a
  // blank record on turn one — including prospects, since stage 2 generates
  // marketplace-wide in the pre-game years too (they run through the same
  // processYear).
  //
  // Only the ACCEPTED attempt's record survives. runLinePreGame re-simulates
  // rejected candidates, but each attempt builds its own poolState from
  // scratch, so a rejected attempt's losses are discarded with it rather than
  // accumulating — which is why recordMemberLossYear replaces same-year entries
  // rather than appending.
  const memberLossHistory: MemberLossHistory = {};
  for (const pg of perLine) {
    for (const [memberId, byLine] of Object.entries(pg.memberLossHistory)) {
      const years = byLine[pg.line];
      if (!years || years.length === 0) continue;
      const target = (memberLossHistory[memberId] ??= {});
      target[pg.line] = years.map(y => ({ ...y }));
    }
  }

  const poolState: PoolState = {
    cash: perLine.reduce((s, p) => s + p.cash, 0),
    unearnedPremium: perLine.reduce((s, p) => s + p.unearnedPremium, 0),
    allMarketMembers,
    lines,
    interLineLoans: [],
    membershipHistory,
    memberLossHistory,
  };

  // Pool-level pre-game history = per-year aggregate across the active lines.
  const priorHistory: ResultSet[] = [];
  for (let i = 0; i < PRE_GAME_YEARS; i++) {
    const lineResults = perLine.map(p => ({ line: p.line, result: p.lineResults[i] }));
    priorHistory.push(aggregateLineResults(lineResults, priorHistory[i - 1]));
  }

  return {
    priorHistory,
    poolState,
    startingFinancials: deriveStartingFinancials(poolState, priorHistory),
    historyAttempt: Math.max(0, ...perLine.map(p => p.attempt)),
  };
}

// The Year 1 opening position, derived from the pre-game ending state instead
// of raw draws. Pool-level: sums span all lines (inactive lines are zeroed
// empty states, so summing all three is safe).
function deriveStartingFinancials(poolState: PoolState, priorHistory: ResultSet[]): StartingFinancials {
  const lastResult = priorHistory[priorHistory.length - 1];
  const lines = Object.values(poolState.lines);

  const investments = lines.reduce((s, l) => s + l.investedAssets, 0);

  const netUnpaidReserve = lines.reduce((s, l) => s + l.netUnpaidReserve, 0);

  const totalAssets = poolState.cash + investments;
  const totalLiabilities = netUnpaidReserve + poolState.unearnedPremium;
  const surplus = totalAssets - totalLiabilities;
  const annualPremium = lastResult.totalMemberCharge;

  return {
    cash: poolState.cash,
    investments,
    totalAssets,
    netUnpaidReserve,
    unearnedPremium: poolState.unearnedPremium,
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
    reinsuranceCost: r.reinsuranceCost,
    totalMemberCharge: r.totalMemberCharge,
    grossUltimateLoss: r.grossUltimateLoss,
    attachment: r.attachment,
    poolLosses: r.poolLosses,
    excessLosses: r.excessLosses,
    quotaShareLosses: r.quotaShareLosses,
    reinsuranceRecovery: r.reinsuranceRecovery,
    netUltimateLoss: r.netUltimateLoss,
    netPaidLosses: r.netPaidLosses,
    endingNetReserve: r.endingNetReserve,
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
