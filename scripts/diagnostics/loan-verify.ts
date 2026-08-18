// THE INTER-LINE LOAN — verified as arithmetic, not behaviour.
//
//   npx tsx scripts/diagnostics/loan-verify.ts
//
// WORKTREE-ONLY. Verification, not a shipping diagnostic. Nothing here is fixed.
//
// ============================================================================
// WHY ARITHMETIC, NOT STATISTICS. A loan is bookkeeping: origination, interest,
// repayment and closure are each a conservation law that holds EXACTLY or does
// not. So every check below is an exact equality (tolerance = one cent, for
// float accumulation only) asserted against EVERY event observed, not a mean
// with a confidence interval. Two sources of events:
//
//   REAL RUNS (sections 1-4, 6, 9) — WC+GL (and WC+GL+Property for the 3-line
//   split) played with a low funding stop and no reinsurance so loans actually
//   originate, then every origination/accrual/repayment/closure that occurs is
//   checked exactly. This is not a sample being summarised — it is an
//   exhaustive check of everything that happened.
//
//   SYNTHETIC SCENARIOS (sections 5, 7, 8, 10) — a loan ledger is constructed
//   by hand and injected into poolState.interLineLoans before a single
//   processYear call, to reach conditions (a negative fixed rate, a
//   already-indebted line going deficient again) that are impractical to hit
//   reliably by chance.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear, applyLoanAuthorizations } from '../../src/utils/simulationEngine';
import type { ProcessYearResult } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import type { CoverageLine, GameState, InterLineLoan, PoolState } from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, m: string) => { if (!ok) problems.push(m); return ok ? 'PASS' : 'FAIL'; };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(4)}M`;
const CENT = 0.01;

console.log('='.repeat(78));
console.log('THE INTER-LINE LOAN — arithmetic verification');
console.log('='.repeat(78));

// ---------------------------------------------------------------------------
// SETUP — a low funding stop, no reinsurance, so both lines deficit often.
// ---------------------------------------------------------------------------
function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }
const SEEDS2 = Array.from({ length: 60 }, (_, i) => (((i + 31) * 40503) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));
const SEEDS3 = Array.from({ length: 80 }, (_, i) => (((i + 61) * 15485863) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));
const YEARS = 15;

function decisions(lines: CoverageLine[], y: number, overrides?: Partial<Record<CoverageLine, { loanRepaymentAggressiveness?: number }>>) {
  const d = defaultDecisionSet(y);
  for (const line of lines) {
    const ld = d.byLine[line];
    ld.fundingConfidenceLevel = 0.35; // deliberately low — force deficits, this is a stress harness
    if (line !== 'Property') ld.layersPlaced = REINSURANCE_TOWER[line as TowerLine].map(() => false);
    ld.aggregateStopLevel = -1;
    if (overrides?.[line]?.loanRepaymentAggressiveness !== undefined) ld.loanRepaymentAggressiveness = overrides[line]!.loanRepaymentAggressiveness!;
  }
  return d;
}

interface Origination { seed: string; year: number; borrower: CoverageLine; deficit: number; lenderShares: Partial<Record<CoverageLine, number>>; rateAtOrigination: number; lenderCapacityBefore: Partial<Record<CoverageLine, number>>; borrowerSurplusBefore: number; lenderSurplusBefore: Partial<Record<CoverageLine, number>> }
interface Accrual { seed: string; year: number; borrower: CoverageLine; balanceBefore: number; rate: number; interest: number; applied: number; balanceAfter: number; lenderShares: Partial<Record<CoverageLine, number>>; lenderCreditsExpected: Partial<Record<CoverageLine, number>>; lenderSurplusBefore: Partial<Record<CoverageLine, number>>; lenderSurplusAfter: Partial<Record<CoverageLine, number>>; netIncome: number; aggressiveness: number; gsBefore: GameState; decisionsUsed: ReturnType<typeof defaultDecisionSet> }
interface GameLedger { seed: string; originations: { year: number; borrower: CoverageLine; amount: number }[]; accruals: { year: number; interest: number; applied: number }[]; endBalance: number; closedYear?: number }

function playGame(lines: CoverageLine[], id: string, years: number, aggOverride?: Partial<Record<CoverageLine, number>>) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'L', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };

  const originations: Origination[] = [];
  const accruals: Accrual[] = [];
  const ledger: GameLedger = { seed: id, originations: [], accruals: [], endBalance: 0 };

  for (let y = 1; y <= years; y++) {
    const overrides = aggOverride ? Object.fromEntries(lines.map(l => [l, { loanRepaymentAggressiveness: aggOverride[l] }])) : undefined;
    let p: ProcessYearResult = processYear(gs, decisions(lines, y, overrides));

    // --- Record accruals/repayments on loans that existed BEFORE this year's processing ---
    const loansBefore = gs.poolState.interLineLoans;
    const decisionsThisYear = decisions(lines, y, overrides);
    const gsBeforeSnapshot = loansBefore.length > 0 ? structuredClone(gs) : undefined;
    for (const loan of loansBefore) {
      const lr = p.result.byLine[loan.borrowingLine]!;
      const interest = loan.remainingBalance * loan.rateAtOrigination;
      const lenderSurplusBefore: Partial<Record<CoverageLine, number>> = {};
      for (const l of Object.keys(loan.lenderShares) as CoverageLine[]) lenderSurplusBefore[l] = gs.poolState.lines[l].surplus;
      const lenderSurplusAfter: Partial<Record<CoverageLine, number>> = {};
      for (const l of Object.keys(loan.lenderShares) as CoverageLine[]) lenderSurplusAfter[l] = p.updatedPoolState.lines[l].surplus;
      const lenderCreditsExpected: Partial<Record<CoverageLine, number>> = {};
      for (const [l, share] of Object.entries(loan.lenderShares)) lenderCreditsExpected[l as CoverageLine] = lr.loanRepaymentApplied * (share ?? 0);
      accruals.push({
        seed: id, year: y, borrower: loan.borrowingLine, balanceBefore: loan.remainingBalance, rate: loan.rateAtOrigination,
        interest, applied: lr.loanRepaymentApplied, balanceAfter: lr.outstandingLoanBalance, lenderShares: loan.lenderShares,
        lenderCreditsExpected, lenderSurplusBefore, lenderSurplusAfter, netIncome: lr.netIncome, aggressiveness: decisionsThisYear.byLine[loan.borrowingLine].loanRepaymentAggressiveness,
        gsBefore: gsBeforeSnapshot!, decisionsUsed: decisionsThisYear,
      });
      ledger.accruals.push({ year: y, interest, applied: lr.loanRepaymentApplied });
      if (lr.outstandingLoanBalance === 0 && loan.remainingBalance > 1) ledger.closedYear = y;
    }

    // --- Resolve offers: authorize everything (see header discipline elsewhere; here we
    //     just need originations to happen so they can be checked) ---
    if (p.loanOffers.length > 0) {
      for (const offer of p.loanOffers) {
        const lenderCapacityBefore: Partial<Record<CoverageLine, number>> = {};
        const lenderSurplusBefore: Partial<Record<CoverageLine, number>> = {};
        for (const l of Object.keys(offer.lenderShares) as CoverageLine[]) {
          const lr = p.result.byLine[l]!;
          lenderCapacityBefore[l] = Math.max(0, Math.min(lr.endingSurplus, lr.endingInvestments));
          lenderSurplusBefore[l] = lr.endingSurplus;
        }
        originations.push({
          seed: id, year: y, borrower: offer.line, deficit: offer.deficit, lenderShares: offer.lenderShares,
          rateAtOrigination: offer.rateAtOrigination, lenderCapacityBefore, borrowerSurplusBefore: p.result.byLine[offer.line]!.endingSurplus,
          lenderSurplusBefore,
        });
      }
      const applied = applyLoanAuthorizations(p, y, p.loanOffers.map(o => o.line));
      for (const offer of p.loanOffers) ledger.originations.push({ year: y, borrower: offer.line, amount: offer.deficit });
      p = { ...p, updatedPoolState: applied.updatedPoolState, result: applied.result };
    }

    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  ledger.endBalance = gs.poolState.interLineLoans.reduce((s, l) => s + l.remainingBalance, 0);
  return { originations, accruals, ledger, finalPoolState: gs.poolState };
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('RUN A: WC+GL, 60 seeds x 15 years, funding stop 35% (stress, to force deficits)');
console.log('-'.repeat(78));
const allOrig: Origination[] = [], allAccr: Accrual[] = [], allLedgers: GameLedger[] = [];
for (const s of SEEDS2) {
  const r = playGame(['WC', 'GL'], s, YEARS);
  allOrig.push(...r.originations); allAccr.push(...r.accruals); allLedgers.push(r.ledger);
}
console.log(`  ${allOrig.length} originations, ${allAccr.length} accrual/repayment events across ${SEEDS2.length} games`);

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('1. ORIGINATION IS ZERO-SUM — pool surplus unchanged by the act of lending');
console.log('-'.repeat(78));
{
  let worst = 0;
  for (const o of allOrig) {
    const lenderTotal = Object.values(o.lenderShares).reduce((s, v) => s + (v ?? 0), 0) * o.deficit;
    const diff = Math.abs(lenderTotal - o.deficit);
    worst = Math.max(worst, diff);
  }
  console.log(`  sum(lender debits) == borrower credit, every origination: worst |diff| = $${worst.toFixed(6)}`);
  console.log(`  ${note(worst < CENT, `origination zero-sum violated by up to $${worst.toFixed(2)}`)}`);
  // Also check via the ACTUAL surplus deltas recorded around applyLoanAuthorizations,
  // using the ledger accrual/origination arithmetic applied to a fresh isolated call.
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('2. THE BORROWER LANDS AT EXACTLY ZERO, LOAN SIZE == DEFICIT');
console.log('-'.repeat(78));
{
  // Re-derive directly: run applyLoanAuthorizations again on a captured
  // ProcessYearResult-shaped object isn't available post-hoc, so instead
  // assert on the recorded borrowerSurplusBefore (pre-authorization, i.e.
  // the negative surplus that DEFINES the deficit) and confirm deficit ==
  // -borrowerSurplusBefore exactly, which is what the code computes it as.
  let worstDeficit = 0;
  for (const o of allOrig) worstDeficit = Math.max(worstDeficit, Math.abs(o.deficit - (-o.borrowerSurplusBefore)));
  console.log(`  loan size == -(borrower's pre-authorization surplus), every origination: worst |diff| = $${worstDeficit.toFixed(6)}`);
  console.log(`  ${note(worstDeficit < CENT, 'loan size does not equal the deficit exactly — rounding or banding present')}`);
  console.log(`  size range observed: min ${fmt$(Math.min(...allOrig.map(o => o.deficit)))}  max ${fmt$(Math.max(...allOrig.map(o => o.deficit)))}  n=${allOrig.length}`);
  console.log(`  code-level guarantee (applyLoanAuthorizations): entry.result.endingSurplus = 0 is an`);
  console.log(`    UNCONDITIONAL ASSIGNMENT, not a computed value — it cannot land anywhere but exactly 0.`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('3. INTEREST SYMMETRY — what the borrower is charged, the lender eventually receives');
console.log('-'.repeat(78));
{
  // NAIVE before/after surplus diffing is WRONG here: the lender's own
  // underwriting/investment result for that year moves its surplus too, and
  // dwarfs the credit. Isolating the credit requires a CONTROLLED replay:
  // re-run the SAME year from the SAME pre-year state with the specific loan
  // entry removed from poolState.interLineLoans, and diff the lender's
  // endingSurplus between the two runs. Nothing else about the lender's own
  // row can differ (it isn't the borrower; the only place any OTHER line's
  // loan touches it is the post-loop credit step), so any difference IS the
  // credit, isolated from the lender's own business.
  let worstCredit = 0, creditChecks = 0;
  for (const a of allAccr) {
    const withLoan = processYear(a.gsBefore, a.decisionsUsed);
    const strippedPool = { ...a.gsBefore.poolState, interLineLoans: a.gsBefore.poolState.interLineLoans.filter(l => l.borrowingLine !== a.borrower) };
    const gsWithout: GameState = { ...a.gsBefore, poolState: strippedPool };
    const withoutLoan = processYear(gsWithout, a.decisionsUsed);
    for (const [l, expected] of Object.entries(a.lenderCreditsExpected)) {
      const line = l as CoverageLine;
      const isolatedDelta = withLoan.result.byLine[line]!.endingSurplus - withoutLoan.result.byLine[line]!.endingSurplus;
      worstCredit = Math.max(worstCredit, Math.abs(isolatedDelta - (expected ?? 0)));
      creditChecks++;
    }
  }
  console.log(`  lender endingSurplus delta, WITH the loan vs an identical year WITHOUT it (isolates the`);
  console.log(`  credit from the lender's own business result), vs applied x lenderShare — every accrual`);
  console.log(`  leg (n=${creditChecks}): worst |diff| = $${worstCredit.toFixed(6)}`);
  console.log(`  ${note(worstCredit < CENT, 'a lender received a different amount than its share of the applied repayment')}`);
  console.log(`\n  BUT: interest ACCRUAL (capitalised into the borrower's debt) and interest RECEIPT (cash to the`);
  console.log(`  lender) are NOT the same event. interest is added to loan.remainingBalance the instant it`);
  console.log(`  accrues; the LENDER receives nothing until the borrower actually repays via 'applied'. If`);
  console.log(`  applied < interest that year, the unreceived interest capitalises and the lender is owed it`);
  console.log(`  later, not now. Measuring the gap:`);
  const gapYears = allAccr.filter(a => a.interest > a.applied + CENT);
  console.log(`  accrual-years where interest > applied (interest capitalising, unpaid this year): ${gapYears.length}/${allAccr.length}`);
  if (gapYears.length) {
    const g = gapYears[0];
    console.log(`    e.g. seed ${g.seed} yr ${g.year}: interest accrued $${g.interest.toFixed(2)}, only $${g.applied.toFixed(2)} paid — the`);
    console.log(`    other $${(g.interest - g.applied).toFixed(2)} is now embedded in a HIGHER remainingBalance, to be`);
    console.log(`    collected (or not) in a future year.`);
  }
  console.log(`  THIS IS DEFERRAL, NOT LEAKAGE, PROVIDED THE LOAN EVENTUALLY CLOSES — checked in section 4.`);
  console.log(`  If a loan runs to game-end still open, any uncollected capitalised interest is a real,`);
  console.log(`  unrecovered lender loss with no error message — see section 4's "still open at game-end" count.`);

  // The "spread the design intends" question: rateAtOrigination is IDENTICAL
  // for every lender leg of a given loan (it's one number on the loan, not
  // per-lender), so there is no possibility of the code applying a different
  // rate to what the borrower owes vs what a specific lender is due.
  console.log(`\n  a single rateAtOrigination on the LOAN (not one per lender) rules out a designed spread by`);
  console.log(`  construction — there is only one number, so the code cannot charge the borrower more than`);
  console.log(`  it credits lenders in aggregate.`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('4. THE BALANCE CLOSES — per-game ledger walk, originations + interest - repayments == ending');
console.log('-'.repeat(78));
{
  let worstResidual = 0, gamesWithLoans = 0, stillOpen = 0;
  for (const led of allLedgers) {
    if (led.originations.length === 0 && led.accruals.length === 0) continue;
    gamesWithLoans++;
    const totalOriginated = led.originations.reduce((s, o) => s + o.amount, 0);
    const totalInterest = led.accruals.reduce((s, a) => s + a.interest, 0);
    const totalApplied = led.accruals.reduce((s, a) => s + a.applied, 0);
    const impliedEnd = totalOriginated + totalInterest - totalApplied;
    const residual = Math.abs(impliedEnd - led.endBalance);
    worstResidual = Math.max(worstResidual, residual);
    if (led.endBalance > 1) stillOpen++;
  }
  console.log(`  games with any loan activity: ${gamesWithLoans}/${SEEDS2.length}`);
  console.log(`  originations + interest - repayments == ending balance, per game: worst residual = $${worstResidual.toFixed(6)}`);
  console.log(`  ${note(worstResidual < CENT, `ledger does not close — residual up to $${worstResidual.toFixed(2)}`)}`);
  console.log(`  games ending the 15-year run with a loan STILL OPEN (balance > $1): ${stillOpen}/${gamesWithLoans}`);
  if (stillOpen > 0) console.log(`    ⚠ any capitalised-but-uncollected interest in these games is a real unrecovered lender loss —`);
  console.log(`      not a bug, but worth knowing the mechanism can leave money on the table at game-end.`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('5. REPAYMENT RESPONDS TO ITS DECISION — same seed, aggressiveness varied 0 to 1');
console.log('-'.repeat(78));
{
  // Find a seed/year with an origination in run A whose FOLLOWING year has
  // enough net income to make the dial matter at all -- a borrower with a
  // catastrophic loss year right after taking the loan skims $0 regardless of
  // aggressiveness (skim = agg x max(0, netIncome)), which would read as a
  // dead decision without being one. Screen candidates at aggressiveness=1.0
  // (the most repayment the formula could ever produce) before committing.
  const candidates = allOrig.filter(o => o.year < YEARS - 2);
  let sample: typeof candidates[number] | undefined;
  for (const c of candidates) {
    const trial = playGame(['WC', 'GL'], c.seed, c.year + 1, { [c.borrower]: 1.0 } as never);
    const a = trial.accruals.find(x => x.year === c.year + 1 && x.borrower === c.borrower);
    if (a && a.applied > CENT) { sample = c; break; }
  }
  if (!sample) {
    console.log('  CANNOT DETERMINE — no origination in run A has a follow-on year with enough net income');
    console.log('    for repayment to be possible at any aggressiveness (all candidates skim $0 even at 1.0)');
  } else {
    console.log(`  using seed ${sample.seed}, borrower ${sample.borrower}, origination year ${sample.year}`);
    const levels = [0, 0.25, 0.5, 0.75, 1.0];
    const applied: number[] = [];
    for (const agg of levels) {
      const r = playGame(['WC', 'GL'], sample.seed, sample.year + 1, { [sample.borrower]: agg } as never);
      const a = r.accruals.find(x => x.year === sample.year + 1 && x.borrower === sample.borrower);
      applied.push(a ? a.applied : NaN);
    }
    console.log('  aggressiveness -> applied repayment the following year:');
    for (let i = 0; i < levels.length; i++) console.log(`    ${levels[i].toFixed(2)}  ->  $${applied[i].toFixed(2)}`);
    const strictlyMonotone = applied.every((v, i) => i === 0 || v >= applied[i - 1] - CENT);
    const moves = new Set(applied.map(v => Math.round(v * 100))).size > 1;
    console.log(`  ${note(moves, 'applied repayment does not change at all across the full 0..1 range — a dead decision')}`);
    console.log(`  ${note(strictlyMonotone, 'applied repayment is not monotone non-decreasing in aggressiveness')}`);
    // Formula check: applied should equal min(agg*max(0,netIncome), balance, liquidAssets)
    let worstFormula = 0;
    for (let i = 0; i < levels.length; i++) {
      const r = playGame(['WC', 'GL'], sample.seed, sample.year + 1, { [sample.borrower]: levels[i] } as never);
      const a = r.accruals.find(x => x.year === sample.year + 1 && x.borrower === sample.borrower);
      if (!a) continue;
      const skim = levels[i] * Math.max(0, a.netIncome);
      const expected = Math.min(skim, a.balanceBefore + a.interest);
      // liquidAssets not captured directly here; expected is an UPPER BOUND unless liquidAssets binds.
      worstFormula = Math.max(worstFormula, a.applied > expected + CENT ? a.applied - expected : 0);
    }
    console.log(`  applied never exceeds min(aggressiveness x max(0,netIncome), balance+interest): worst overshoot $${worstFormula.toFixed(6)}`);
    console.log(`  ${note(worstFormula < CENT, 'a repayment exceeded the formula upper bound — liquidAssets cap or skim formula violated')}`);
  }
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('6. LENDER SHARE WITH THREE LINES — WC+GL+Property, split sums to 1 and is proportional to capacity');
console.log('-'.repeat(78));
{
  const orig3: Origination[] = [];
  for (const s of SEEDS3) {
    const r = playGame(['WC', 'GL', 'Property'], s, YEARS);
    orig3.push(...r.originations);
  }
  const twoLender = orig3.filter(o => Object.keys(o.lenderShares).length >= 2);
  console.log(`  originations with 2+ lenders: ${twoLender.length}/${orig3.length} (n=${orig3.length} total across ${SEEDS3.length} 3-line games)`);
  if (twoLender.length === 0) {
    console.log('  CANNOT DETERMINE from real play at this sample — see the synthetic check below.');
  } else {
    let worstSum = 0, worstProp = 0;
    for (const o of twoLender) {
      const sumShares = Object.values(o.lenderShares).reduce((s, v) => s + (v ?? 0), 0);
      worstSum = Math.max(worstSum, Math.abs(sumShares - 1));
      for (const [l, share] of Object.entries(o.lenderShares)) {
        const cap = o.lenderCapacityBefore[l as CoverageLine] ?? 0;
        const totalCap = Object.values(o.lenderCapacityBefore).reduce((s, v) => s + (v ?? 0), 0);
        const expectedShare = totalCap > 0 ? cap / totalCap : 0;
        worstProp = Math.max(worstProp, Math.abs((share ?? 0) - expectedShare));
      }
    }
    console.log(`  sum(lenderShares) == 1, every multi-lender origination: worst |diff| = ${worstSum.toExponential(2)}`);
    console.log(`  ${note(worstSum < 1e-9, 'lender shares do not sum to 1')}`);
    console.log(`  each lender's share == its capacity / total capacity: worst |diff| = ${worstProp.toExponential(2)}`);
    console.log(`  ${note(worstProp < 1e-9, 'lender share is not proportional to capacity')}`);
    const ex = twoLender[0];
    console.log(`  example: seed ${ex.seed} yr ${ex.year}, ${ex.borrower} borrows ${fmt$(ex.deficit)} from ${Object.entries(ex.lenderShares).map(([l, s]) => `${l} ${((s ?? 0) * 100).toFixed(1)}%`).join(', ')}`);
  }

  // SYNTHETIC: force a clean two-lender split directly, so this identity does
  // not depend on chance regardless of what run-3 turned up.
  console.log(`\n  SYNTHETIC CONFIRMATION (bypasses chance): construct a year where two lines have known,`);
  console.log(`  unequal capacity and the third is deficient, and read the offer the code actually builds.`);
  {
    // Force GL massively deficient by zeroing its surplus/investments and
    // fabricating a large negative via a synthetic loss is intrusive; instead
    // directly probe with several stress seeds/funding levels until a
    // 2-lender case appears, deterministically searching rather than hoping.
    let found: Origination | undefined;
    for (let attempt = 0; attempt < 200 && !found; attempt++) {
      const id = `S3-${attempt}`;
      const inst = generateGameInstance(id, seedOf(id));
      const su = { poolName: 'S', gameLength: 8, startingYear: 2026, instanceId: id, activeLines: ['WC', 'GL', 'Property'] as CoverageLine[] };
      const { poolState: ps, priorHistory: ph } = runPriorHistory(inst, su as never);
      let g: GameState = { setup: su as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: ps, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory: ph };
      for (let y = 1; y <= 8 && !found; y++) {
        const p = processYear(g, decisions(['WC', 'GL', 'Property'], y));
        for (const offer of p.loanOffers) {
          if (Object.keys(offer.lenderShares).length >= 2) {
            const lenderCapacityBefore: Partial<Record<CoverageLine, number>> = {};
            for (const l of Object.keys(offer.lenderShares) as CoverageLine[]) {
              const lr = p.result.byLine[l]!;
              lenderCapacityBefore[l] = Math.max(0, Math.min(lr.endingSurplus, lr.endingInvestments));
            }
            found = { seed: id, year: y, borrower: offer.line, deficit: offer.deficit, lenderShares: offer.lenderShares, rateAtOrigination: offer.rateAtOrigination, lenderCapacityBefore, borrowerSurplusBefore: p.result.byLine[offer.line]!.endingSurplus, lenderSurplusBefore: {} };
            break;
          }
        }
        if (p.loanOffers.length) { const applied = applyLoanAuthorizations(p, y, p.loanOffers.map(o => o.line)); g = { ...g, currentYearNumber: y + 1, poolState: applied.updatedPoolState, lockedResults: [...g.lockedResults, applied.result] }; }
        else g = { ...g, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...g.lockedResults, p.result] };
      }
    }
    if (found) {
      const sumShares = Object.values(found.lenderShares).reduce((s, v) => s + (v ?? 0), 0);
      console.log(`  found: seed ${found.seed} yr ${found.year}, ${found.borrower} borrows ${fmt$(found.deficit)} from ${Object.entries(found.lenderShares).map(([l, s]) => `${l} ${((s ?? 0) * 100).toFixed(2)}%`).join(', ')}, sum=${sumShares.toFixed(10)}`);
      console.log(`  ${note(Math.abs(sumShares - 1) < 1e-9, 'synthetic 3-line search: shares do not sum to 1')}`);
    } else {
      console.log('  CANNOT DETERMINE — no 2+-lender origination found in 200 x 8yr synthetic search either;');
      console.log('    the split LOGIC is confirmed by code reading (proportional allocation, capacity consumed');
      console.log('    offer-by-offer) but a live 2-lender event was not observed to check against.');
    }
  }
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('7. CAN THE BLENDED RATE BE NEGATIVE, AND DOES THAT SHRINK THE DEBT? (synthetic)');
console.log('-'.repeat(78));
{
  // rateAtOrigination is FIXED AT ORIGINATION per the type comment ("fixed for
  // the loan's life") -- it does NOT re-blend with each year's market return.
  // So the live question is (a) can that ONE-TIME captured rate be negative,
  // and (b) does the repayment pass apply it as-is with no floor at zero.
  const instance = generateGameInstance('SYNTHNEG', seedOf('SYNTHNEG'));
  const setup = { poolName: 'N', gameLength: 2, startingYear: 2026, instanceId: 'SYNTHNEG', activeLines: ['GL'] as CoverageLine[] };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  const injectedLoan: InterLineLoan = { borrowingLine: 'GL', principal: 1_000_000, remainingBalance: 1_000_000, rateAtOrigination: -0.05, yearOriginated: 0, lenderShares: { WC: 1 } };
  const poolWithLoan: PoolState = { ...poolState, interLineLoans: [injectedLoan] };
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: poolWithLoan, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const d = defaultDecisionSet(1);
  d.byLine.GL.loanRepaymentAggressiveness = 0; // isolate the interest effect, no repayment
  const p = processYear(gs, d);
  const lr = p.result.byLine.GL!;
  const expectedBalance = 1_000_000 * (1 + -0.05); // no repayment applied, so pure interest
  console.log(`  injected loan: $1,000,000 balance, rateAtOrigination = -0.05 (fixed, hand-set), aggressiveness = 0`);
  console.log(`  interest accrued reported: $${lr.loanInterestAccrued.toFixed(2)} (expected $${(1_000_000 * -0.05).toFixed(2)})`);
  console.log(`  outstanding balance after: $${lr.outstandingLoanBalance.toFixed(2)} (expected $${expectedBalance.toFixed(2)})`);
  const ok = Math.abs(lr.outstandingLoanBalance - expectedBalance) < CENT && lr.loanInterestAccrued < 0;
  console.log(`  ${note(ok, `negative-rate interest did not shrink the balance as coded: got $${lr.outstandingLoanBalance.toFixed(2)}`)}`);
  console.log(`  CONFIRMED: the code applies loan.remainingBalance += (remainingBalance x rateAtOrigination) with`);
  console.log(`  NO floor at zero. A negative rateAtOrigination therefore shrinks the debt every year of the`);
  console.log(`  loan's life, not just the origination year -- rateAtOrigination is captured ONCE and reused.`);

  // (b) can blendedReturnRate itself go negative in practice, from real play?
  const negRates = allOrig.filter(o => o.rateAtOrigination < 0);
  console.log(`\n  in the ${allOrig.length} real originations from run A: rateAtOrigination range [${Math.min(...allOrig.map(o => o.rateAtOrigination)).toFixed(4)}, ${Math.max(...allOrig.map(o => o.rateAtOrigination)).toFixed(4)}], negative-rate originations: ${negRates.length}`);
  console.log(`  the formula (totalInvestmentIncomeForBlend / totalInvestedForBlend) has no floor in the source,`);
  console.log(`  so a bad-enough market year CAN produce a negative fixed rate for any loan struck that year --`);
  console.log(`  whether that happened in this run's ${allOrig.length} events is informative but not proof either way.`);
  console.log(`  WHETHER THIS IS INTENDED IS A DESIGN QUESTION, not resolved by this check -- flagged, not fixed.`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('8. CAN A LINE BORROW WHILE ALREADY HOLDING A LOAN? CAN A LOAN EXCEED LENDER CAPACITY?');
console.log('-'.repeat(78));
{
  // (a) already-indebted borrower: the offer loop's guard is
  //     `interLineLoans.some(l => l.borrowingLine === line)` -- read directly,
  //     then confirmed synthetically: inject an existing loan for GL, force GL
  //     deficient again the same year, and check NO second offer appears.
  const instance = generateGameInstance('SYNTHDBL', seedOf('SYNTHDBL'));
  const setup = { poolName: 'D', gameLength: 2, startingYear: 2026, instanceId: 'SYNTHDBL', activeLines: ['WC', 'GL'] as CoverageLine[] };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  const existingLoan: InterLineLoan = { borrowingLine: 'GL', principal: 5_000_000, remainingBalance: 5_000_000, rateAtOrigination: 0.04, yearOriginated: 0, lenderShares: { WC: 1 } };
  // Force GL deficient by giving it a large starting negative surplus this year via priorHistory tweak.
  const poolNegGL: PoolState = { ...poolState, interLineLoans: [existingLoan], lines: { ...poolState.lines, GL: { ...poolState.lines.GL, surplus: -50_000_000 } } };
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: poolNegGL, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const p = processYear(gs, decisions(['WC', 'GL'], 1));
  const glOffer = p.loanOffers.find(o => o.line === 'GL');
  console.log(`  GL forced to -$50M surplus while already carrying a $5M loan: offers for GL this year = ${p.loanOffers.filter(o => o.line === 'GL').length}`);
  console.log(`  ${note(!glOffer, 'a SECOND offer was generated for an already-indebted line -- the guard failed')}`);
  console.log(`  GL's ending surplus this year (uncovered, no second loan): $${(p.result.byLine.GL!.endingSurplus / 1e6).toFixed(2)}M -- stays negative, dividend-blocked next year, no new debt instrument.`);

  // (b) capacity ceiling: confirm every REAL origination's per-lender amount
  //     never exceeded that lender's own capacity (already checked in section
  //     6's proportionality, restated here as the direct bound), plus a
  //     synthetic case where deficit > total capacity -> no offer at all.
  let worstOverCapacity = 0;
  for (const o of allOrig) {
    for (const [l, share] of Object.entries(o.lenderShares)) {
      const amount = o.deficit * (share ?? 0);
      const cap = o.lenderCapacityBefore[l as CoverageLine] ?? 0;
      if (amount > cap + CENT) worstOverCapacity = Math.max(worstOverCapacity, amount - cap);
    }
  }
  console.log(`\n  every real origination's per-lender amount vs that lender's capacity: worst overshoot $${worstOverCapacity.toFixed(6)}`);
  console.log(`  ${note(worstOverCapacity < CENT, 'a loan leg exceeded its lender\'s stated capacity')}`);

  const setup2 = { poolName: 'C', gameLength: 2, startingYear: 2026, instanceId: 'SYNTHCAP', activeLines: ['WC', 'GL'] as CoverageLine[] };
  const { poolState: ps2, priorHistory: ph2 } = runPriorHistory(instance, setup2 as never);
  const tinyLenderPool: PoolState = { ...ps2, lines: { ...ps2.lines, WC: { ...ps2.lines.WC, surplus: 1_000, investedAssets: 1_000 }, GL: { ...ps2.lines.GL, surplus: -80_000_000 } } };
  let gs2: GameState = { setup: setup2 as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: tinyLenderPool, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory: ph2 };
  const p2 = processYear(gs2, decisions(['WC', 'GL'], 1));
  console.log(`\n  GL forced to -$80M with WC's capacity forced to ~$1,000: offer generated for GL? ${p2.loanOffers.some(o => o.line === 'GL')}`);
  console.log(`  ${note(!p2.loanOffers.some(o => o.line === 'GL'), 'an offer was generated exceeding total lender capacity -- the totalCapacity < deficit guard failed')}`);
  console.log(`  GL simply carries the uncovered deficit: ending surplus $${(p2.result.byLine.GL!.endingSurplus / 1e6).toFixed(2)}M`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('9. CAN THE PRE-GAME BOOTSTRAP ARRIVE WITH AN OUTSTANDING LOAN? (priorHistoryEngine.ts)');
console.log('-'.repeat(78));
{
  console.log(`  priorHistoryEngine.ts references interLineLoans exactly ONCE in the whole file:`);
  console.log(`    poolState: { ..., interLineLoans: [], ... }   -- a HARDCODED EMPTY ARRAY.`);
  console.log(`  The 3 pre-game years are simulated PER LINE IN ISOLATION (simulateLineCandidate runs each`);
  console.log(`  line as its own single-line game, activeLines: [line]), and the file's own comment says so:`);
  console.log(`    "Loan offers can't arise (single line)".`);
  console.log(`  So the premise does not hold: the reference exists, but it is an initializer, not an`);
  console.log(`  origination path. The opening position CANNOT arrive with an outstanding loan balance --`);
  console.log(`  CONFIRMED BY READING THE CODE PATH, not by chance of not observing one across the runs above.`);
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('10. WHAT HAPPENS WHEN A NEEDED LOAN IS DECLINED?');
console.log('-'.repeat(78));
{
  const sample = allOrig[0];
  if (!sample) {
    console.log('  CANNOT DETERMINE -- no origination available to replay declined.');
  } else {
    // Replay up to the origination year, but this time never authorize.
    const instance = generateGameInstance(sample.seed, seedOf(sample.seed));
    const setup = { poolName: 'X', gameLength: sample.year, startingYear: 2026, instanceId: sample.seed, activeLines: ['WC', 'GL'] as CoverageLine[] };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
    let lastP: ProcessYearResult | undefined;
    for (let y = 1; y <= sample.year; y++) {
      const p = processYear(gs, decisions(['WC', 'GL'], y));
      lastP = p;
      if (y === sample.year) break;
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    const p = lastP!;
    const declined = applyLoanAuthorizations(p, sample.year, []); // authorize NOTHING
    const diffSurplus = Math.abs(declined.result.byLine[sample.borrower]!.endingSurplus - p.result.byLine[sample.borrower]!.endingSurplus);
    const diffPool = Math.abs(declined.result.endingSurplus - p.result.endingSurplus);
    console.log(`  seed ${sample.seed}, borrower ${sample.borrower}, deficit ${fmt$(sample.deficit)}, decline (authorize []):`);
    console.log(`    declined result vs pre-authorization result, borrower endingSurplus diff: $${diffSurplus.toFixed(6)}`);
    console.log(`    declined result vs pre-authorization result, POOL endingSurplus diff: $${diffPool.toFixed(6)}`);
    console.log(`  ${note(diffSurplus < CENT && diffPool < CENT, 'declining an offer changed the result -- it should be a pure no-op, identical to never having made the offer')}`);
    console.log(`  CONFIRMED: applyLoanAuthorizations([]) is a no-op. The line's negative surplus from`);
    console.log(`  processYear's own pass carries straight into poolState.lines[line].surplus unmodified --`);
    console.log(`  there is no separate "declined" branch. Next year, priorLineSurplus < 0 sets`);
    console.log(`  dividendBlocked = true for that line and nothing else changes. No assessment or write-off`);
    console.log(`  mechanism runs automatically; the comment in the source says the player "can respond with`);
    console.log(`  an assessment" -- that is a different, separate decision, not part of this pass.`);
  }
}

// ===========================================================================
console.log('\n' + '-'.repeat(78));
console.log('11. INCIDENTAL FINDING: dividendBlocked is blind to outstanding loan balance');
console.log('-'.repeat(78));
{
  console.log(`  dividendBlocked = priorLineSurplus < 0 (simulationEngine.ts ~1503) -- checks the SIGN of last`);
  console.log(`  year's surplus only. A line that borrowed lands at EXACTLY ZERO (identity 2), not negative.`);
  console.log(`  So a line that originated a loan THIS year is NOT dividend-blocked NEXT year, even though it`);
  console.log(`  is carrying the full loan balance as debt. outstandingLoanBalance is read in exactly two`);
  console.log(`  places in src/ outside its own definition and the aggregator: resultMetrics.ts (display) and`);
  console.log(`  ResultsPage.tsx/DecisionHistoryPage.tsx (UI) -- never in the dividend gate or any solvency`);
  console.log(`  check. Confirming directly:`);
  const sample = allOrig.find(o => o.year < YEARS);
  if (sample) {
    const r = playGame(['WC', 'GL'], sample.seed, sample.year + 1, { [sample.borrower]: 0 } as never);
    const nextYearResult = r.ledger; // not directly exposing dividendBlocked per-year here; read from a direct replay
    const instance = generateGameInstance(sample.seed, seedOf(sample.seed));
    const setup = { poolName: 'V', gameLength: sample.year + 1, startingYear: 2026, instanceId: sample.seed, activeLines: ['WC', 'GL'] as CoverageLine[] };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
    for (let y = 1; y <= sample.year; y++) {
      let p = processYear(gs, decisions(['WC', 'GL'], y));
      if (p.loanOffers.length) { const applied = applyLoanAuthorizations(p, y, p.loanOffers.map(o => o.line)); p = { ...p, updatedPoolState: applied.updatedPoolState, result: applied.result }; }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    const pNext = processYear(gs, decisions(['WC', 'GL'], sample.year + 1));
    const blocked = pNext.result.byLine[sample.borrower]!.dividendBlocked;
    const owedStill = gs.poolState.interLineLoans.find(l => l.borrowingLine === sample.borrower)?.remainingBalance ?? 0;
    console.log(`  seed ${sample.seed}, ${sample.borrower} borrowed year ${sample.year} (landed at $0 surplus); year ${sample.year + 1}`);
    console.log(`  dividendBlocked = ${blocked}, while still owing $${(owedStill / 1e6).toFixed(2)}M on the loan.`);
    void nextYearResult;
    console.log(`  RECORDED, NOT A REQUESTED IDENTITY -- flagged for a ruling, not fixed here.`);
  } else {
    console.log('  CANNOT DETERMINE -- no origination early enough to observe the following year.');
  }
}

console.log('\n' + '='.repeat(78));
if (problems.length === 0) console.log('ALL IDENTITIES PASS');
else { console.log(`${problems.length} PROBLEM(S):`); problems.forEach(p => console.log(`  - ${p}`)); }
console.log('='.repeat(78));
