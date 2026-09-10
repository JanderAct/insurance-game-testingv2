// Stage 2.10 + seed-fix-per-line-opening — per-line prior histories.
//
// Each active line gets a REAL simulated 3-year pre-game past (yearNumbers -2,
// -1, 0) produced by the same engine as live years, at default decisions —
// preceded by MATURATION_YEARS further simulated years that are NOT part of the
// declared past and exist only to leave a ten-accident-year book behind. See
// MATURATION_YEARS for why, and for the re-pin that separates the book from the
// profit that built it. Each
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
// OPENING_SURPLUS_BAND — [min, max] × its own opening POOL PREMIUM on a
// 'premium' line, or × its own opening NET RESERVE on a 'reserve' line
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
import {
  OPENING_SURPLUS_BAND,
  OPERATING_CASH_PCT_OF_PREMIUM,
  STARTING_CAPITAL_TO_PREMIUM,
} from '../data/defaultAssumptions';
import { processYear, aggregateLineResults } from './simulationEngine';
import { emptyLinePoolState, getMemberExposure } from './lineHelpers';
import { defaultDecisionSet } from './decisionDefaults';

export const PRE_GAME_YEARS = 3; // yearNumbers -2, -1, 0

// ============================================================================
// THE MATURATION YEARS — WHY THE POOL NO LONGER STARTS THREE YEARS OLD.
//
// These are played BEFORE the three declared pre-game years and are not part of
// the pool's stated past. Their only job is to leave a book behind: ten accident
// years, each at its own age, each with a real claim register, a real developing
// set and real cession — the thing a three-year pre-game plus a handful of
// apportioned seed cohorts cannot produce.
//
// ⚠ WHY IT WAS NEEDED, AND IT IS A FORWARD-BOOKING PROBLEM. Booking a cohort at
// its contracted initial estimate understates incurred while the book is young.
// A pool in runoff EQUILIBRIUM does not have that problem: the development of
// its older years exactly offsets the under-booking of its newest, so booked
// incurred equals ultimate written. A three-year book is nowhere near
// equilibrium, so three years of income were overstated and the opening surplus
// ran away with them — measured, the unfiltered opening median rose to 2.207 on
// WC against a band ceiling of 1.22, and no admissible pin brought it back:
// WC and GL both solved NEGATIVE and both sat above their ceilings at K = 0.
//
// ⚠ THE TRANSIENT IS AS LONG AS THE IBNER HORIZON, WHICH IS WHERE TEN COMES
// FROM. Measured, the implied intercept by depth:
//
//   accident years at game start        WC       GL   Property
//   3 (the old book)                  1.304    1.628     0.395
//   7                                 0.783    0.064    -0.265
//   10  <- shipped                    0.377   -0.012    -0.105
//   13                                0.237   -0.048    -0.131
//
// Each line stops improving at roughly its own MEAN IBNER horizon — GL (5.5)
// and Property (3) are done by seven, WC (8.5) is still moving at thirteen.
// Nobody designed that agreement; it is the reason to trust the number. Seven
// passes on all three lines but leaves WC at K* = 0.112, which is thin. Ten is
// set by WC and is where WC has room.
//
// ⚠ AND THE RELIEF IS DEVELOPMENT, NOT RESERVE — WHICH IS WHY THE BOOK HAS TO BE
// PLAYED RATHER THAN APPORTIONED. Split at the boundary below, the whole move is
// made in the three declared years and it is adverse development on the mature
// book: 108% of it on every line, with investment income on the assets backing
// the deeper reserve pushing the other way (hence over 100%). GL is the proof —
// its net reserve/premium rises only 1.118 -> 1.429 while its opening falls by
// 1.585 of premium, five times more. The relief is a FLOW of development across
// ten cohorts, not a STOCK of reserve. An apportioned book carries the stock and
// none of the flow, so it would have bought nothing.
//
// ⚠ AND CESSION IS REAL HERE, WHICH AN APPORTIONED BOOK CANNOT MODEL. A seed
// cohort has no register, so it cedes nothing ever. These cohorts cede: the
// tower takes 15% / 26% / 14% off the standing reserve, and the gain survives it.
// ============================================================================
// ⚠ WHAT IT COSTS, AND THE TWO COSTS ARE DIFFERENT AUDIENCES.
//
// THE PLAYER pays 261 ms for a full three-line opening, measured at the
// re-solved pin with the band in force and no fallbacks in 20 openings. That is
// 2.6x the old path rather than the 3.3x the depth alone implies, because a
// centred pin buys back more than the extra years cost: fifty precomputed
// openings take 13 s, and a cold start that generates one takes 0.26 s.
//
// THE DEVELOPER pays much more, on the two-armed gates only, and this is the
// real bill. The pin is ONE SCALAR PER LINE and it centres the SHIPPED
// configuration. Any gate that also runs the other arm through runPriorHistory
// runs it off-centre, and the deeper pre-game multiplies every extra attempt.
// Measured, share of unfiltered candidates landing in band:
//
//   line       FB on (shipped)   FB off (retired)
//   WC              30%               45%
//   GL              35%                5%     <- 1 in 20, so ~20 attempts
//   Property        20%               25%
//
// GL's retired arm therefore pays roughly twenty ten-year pre-games per opening,
// and cohort-ledger-check went from about 35 s to over ten minutes on that
// alone. It is not fallbacks — nothing hits the 500 cap — it is an off-centre
// proposal distribution meeting a longer candidate.
//
// ⚠ DO NOT FIX THIS BY SHORTENING THE PRE-GAME. The depth is what the mechanism
// needs. If the suite's runtime has to come down, cut GAMES on the two-armed
// gates, or stop running the retired arm through the real search where the arm
// is only being reported — pregame-acceptance-check does the latter and says so.
export const MATURATION_YEARS = 7;

/** Years actually simulated before Year 1: the maturation years plus the three
 *  declared pre-game years. Ten, so ten accident years exist at game start. */
export const PRE_GAME_DEPTH = MATURATION_YEARS + PRE_GAME_YEARS;

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

// Run one line's pre-game IN ISOLATION (single-line sim) on a given candidate
// seed: MATURATION_YEARS to build the book, the re-pin, then the 3 declared
// pre-game years. Loan offers can't arise (single line), and the ending is
// gated by that line's own adequacy in the caller.
//
// ⚠ EXPORTED SO opening-centring-check STOPS REIMPLEMENTING IT. That gate needs
// the candidate BEFORE rejection, which runLinePreGame cannot give it, so it
// carried its own copy of this construction with a comment saying the two must
// be changed together. They were changed together exactly once — here — and the
// duplicate is now gone instead. A gate that reproduces the thing it measures
// can silently stop measuring it.
export function simulateLineCandidate(
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
    setup.startingYear - PRE_GAME_DEPTH,
    [line],
    -(PRE_GAME_DEPTH - 1)
  );
  // Relabel this line's seed reserve cohorts past the whole simulated depth so
  // they don't collide with the played years' own new accident-year cohorts.
  //
  // ⚠ THIS LEAVES A ONE-YEAR HOLE IN THE AGE LADDER AND ALWAYS HAS. The seeds are
  // created at ages 1..n and shifted by the depth, so nothing ever occupies the
  // age exactly equal to the depth. Before this commit the played years covered
  // ages 0-2 and the seeds landed at 4-8, so THE HOLE WAS AT AGE 3 — inside the
  // part of the ladder that carries most of the reserve, and no gate looked
  // there. It is now at age 10, past the far end of every line's IBNER horizon
  // and past where any payout pattern still holds much: measured at game start,
  // everything beyond the hole is 3.1% / 0.0% / 0.0% of opening net reserve.
  // Ages 0-9 are contiguous, which is the part pricing reads.
  bootstrap.lines[line].reserveCohorts = bootstrap.lines[line].reserveCohorts.map(
    c => ({ ...c, yearNumber: c.yearNumber - PRE_GAME_DEPTH })
  );

  let gs: GameState = {
    setup: soloSetup,
    instance: candidateInstance,
    currentYearNumber: -(PRE_GAME_DEPTH - 1),
    isStarted: true,
    isComplete: false,
    poolState: bootstrap,
    lockedResults: [],
    currentDecisions: defaultDecisionSet(-(PRE_GAME_DEPTH - 1)),
    priorHistory: [],
  };

  for (let y = -(PRE_GAME_DEPTH - 1); y <= 0; y++) {
    // ------------------------------------------------------------------ re-pin
    // ⚠ THE BOUNDARY. The maturation years' accumulated surplus is DISCARDED
    // here and the line is re-pinned exactly as generateStartingPoolState pins
    // it at a bootstrap. What carries forward is the BOOK, not the profit that
    // built it.
    //
    // ⚠ THIS IS NOT A CAPITAL EVENT AND THE CONSTANT SAYS SO ITSELF:
    // STARTING_CAPITAL_TO_PREMIUM's own note opens "⚠ THIS IS A SEARCH ORIGIN,
    // NOT A CAPITAL STANDARD. Read that sentence before reasoning about these
    // numbers at all." Moving the origin from year -9 to year -2 is using it as
    // precisely what it says it is. Without the re-pin the maturation years
    // compound instead of maturing: measured at ten played years, the reserve
    // does arrive (WC 1.014 -> 2.005) and the opening goes the WRONG WAY
    // (WC median 2.207 -> 4.691, zero of forty seeds in band on any line),
    // because ten years at default decisions accumulate profit.
    //
    // ⚠ IT MUST STAY THE SAME ARITHMETIC AS instanceGenerator's pin, not merely
    // a similar one — same exposure basis, same rate, same cash target — or the
    // two origins diverge and the pin is calibrated against neither.
    if (y === -(PRE_GAME_YEARS - 1)) {
      const ls = gs.poolState.lines[line];
      const activeExposure = ls.members
        .filter(m => m.status === 'active')
        .reduce((s, m) => s + getMemberExposure(m, line, y), 0);
      const linePremium = activeExposure * ls.ratePer100 * 10_000;
      const targetSurplus = (STARTING_CAPITAL_TO_PREMIUM[line] ?? 1.0) * linePremium;
      const lineCash = OPERATING_CASH_PCT_OF_PREMIUM * linePremium;
      gs = {
        ...gs,
        poolState: {
          ...gs.poolState,
          cash: lineCash,
          lines: {
            ...gs.poolState.lines,
            [line]: {
              ...ls,
              surplus: targetSurplus,
              // surplus = cash + invested − netReserve ⇒ invested = surplus + netReserve − cash
              investedAssets: targetSurplus + ls.netUnpaidReserve - lineCash,
            },
          },
        },
      };
    }
    const processed = processYear(gs, defaultDecisionSet(y));
    gs = {
      ...gs,
      currentYearNumber: y + 1,
      poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result],
    };
  }

  return {
    // ⚠ ONLY THE DECLARED YEARS. The maturation years are not part of the pool's
    // stated past — priorHistory stays three years and every exhibit reading it
    // is unchanged. The BOOK they left is on the line state, and
    // reserveDevelopment carries them all, which is the point.
    lineResults: gs.lockedResults.slice(-PRE_GAME_YEARS).map(r => r.byLine[line]),
    poolState: gs.poolState,
    pooled: gs.lockedResults,
  };
}

// Per-line reject-and-redraw: re-simulate ONLY this line until its opening
// surplus lands inside OPENING_SURPLUS_BAND (two-sided), on that line's basis.
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
//
// ⚠ AND THAT PARAGRAPH IS NOW HALF TRUE, WHICH IS WHY IT IS KEPT. WC and GL are
// tested against the opening NET RESERVE; Property is still tested against
// premium. The objection above — that testing against the required reserve
// margin made the opening move whenever the reserve, the margin CLF or the
// funding basis moved — is answered by FROZEN_CAPITAL_J: the CLF-derived
// multiple is a frozen literal, so the margin CLF is not a live consumer of this
// path and cannot move it. The RESERVE still can, and that is intended: it is
// the liability the capital is held against. See OPENING_SURPLUS_BAND.

/**
 * THE ACCEPTANCE RATIO — one definition, called by the engine and by every gate
 * that reproduces the search.
 *
 * ⚠ IT IS EXPORTED BECAUSE FOUR DIAGNOSTICS RE-IMPLEMENT THIS TEST. pin-vs-band,
 * opening-centring, pregame-acceptance and opening-basis-report all divide a
 * surplus by something and compare it to the band. Before the reserve basis
 * existed they could all hardcode `/ poolPremium` and be right; now a copy that
 * did so would silently grade WC and GL against the wrong denominator and still
 * look green. There is one expression and all five call it.
 */
export function openingBandRatio(
  line: CoverageLine,
  endingSurplus: number,
  poolPremium: number,
  endingNetReserve: number,
): number {
  const basis = OPENING_SURPLUS_BAND[line]?.basis ?? 'premium';
  return basis === 'reserve'
    ? endingSurplus / Math.max(endingNetReserve, 1)
    : endingSurplus / Math.max(poolPremium, 1);
}

function runLinePreGame(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine
): LinePreGame {
  const band = OPENING_SURPLUS_BAND[line] ?? { basis: 'premium' as const, min: 0.83, max: 1.22 };
  let best: { c: ReturnType<typeof simulateLineCandidate>; attempt: number; distance: number } | null = null;

  for (let attempt = 0; attempt < MAX_HISTORY_ATTEMPTS; attempt++) {
    const c = simulateLineCandidate(instance, setup, line, attempt);
    const last = c.lineResults[c.lineResults.length - 1];
    const multiple = openingBandRatio(line, last.endingSurplus, last.poolPremium, last.endingNetReserve);
    if (multiple >= band.min && multiple <= band.max) return finalizeLine(c, line, attempt);
    // Distance to the band (0 inside): the fallback keeps the closest miss.
    const distance = multiple < band.min ? band.min - multiple : multiple - band.max;
    if (!best || distance < best.distance) best = { c, attempt, distance };
  }

  console.warn(
    `Prior history (${line}): no attempt of ${MAX_HISTORY_ATTEMPTS} landed in the ` +
    `[${band.min}, ${band.max}]x opening ${band.basis} band; using closest attempt ${best!.attempt} ` +
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
    // activeMembers is the DISTINCT roster at both scopes now — the pooled row
    // deduplicates by member id rather than summing per-line enrolments. Read
    // the field directly; there is no longer a display-side correction to apply.
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
    reinsuranceRecovery: r.reinsuranceRecovery,
    priorYearDevelopmentCeded: r.priorYearDevelopmentCeded,
    bookingGiveBack: r.bookingGiveBack,
    netUltimateLoss: r.netUltimateLoss,
    netPaidLosses: r.netPaidLosses,
    endingNetReserve: r.endingNetReserve,
    actualLossRatio: r.actualLossRatio,
    actualLossRatioPricingBasis: r.actualLossRatioPricingBasis,
    actualLossRatioRetainedPremium: r.actualLossRatioRetainedPremium,
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
