// RATIO BASIS — a numerator and a denominator must be on the SAME basis.
//
// Run: npx tsx scripts/diagnostics/ratio-basis-check.ts
//
// ============================================================================
// WHY THIS EXISTS. The ratio block in simulationEngine.ts already carried a
// rule — "every ratio states which denominator it uses" — and a guard on the
// audit page that checked both terms of the combined ratio shared one. Both
// were followed. Neither caught the defect, because a denominator is only HALF
// of a basis: after the net-funding change both denominators contained the
// net-funded poolPremium while the loss numerator stayed GROSS, so the ceded
// loss was counted twice and the Expected Combined Ratio read 130.0% on GL and
// 118.9% on WC while the pool was funding exactly its expected cost.
//
// The rule that was missing is asserted here: THE NUMERATORS MUST SHARE THE
// BASIS TOO.
// ============================================================================
//
// THE IDENTITY, which is what makes this a test rather than a measurement.
// poolPremium + adminExpense + reinsuranceCost is identically
// totalMemberCharge. So when the loss numerator is the loss the premium
// actually funds, at CLF 1.000:
//
//   expectedCombinedRatio = (poolPremium + admin + reins) / totalMemberCharge
//                         = 1.0000, EXACTLY
//
// Not approximately, and not to a tolerance chosen to make it pass. It is
// asserted at 1e-12, which is float noise on quantities of ~1e7. Above CLF
// 1.000 the shortfall below 1.0000 is the funding margin and is checked to be
// positive rather than pinned.
//
// ⚠ PROPERTY WAS THE CONTROL AND NO LONGER IS. This note read "PROPERTY IS THE
// CONTROL. It is deliberately not netted, so it was already correct before the
// fix and must be EXACTLY unchanged by it." That was the isolation argument for
// the expected-combined-ratio basis fix, and it held then. Property nets as of
// its own occurrence layer and aggregate, so it is now an ordinary subject of
// these checks like WC and GL. The checks below are line-generic and needed no
// change — only this claim about which line is a control expired.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 40);
const YEARS = 8;
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const EXACT = 1e-12;

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way,
// attributing a failure in one section to a paragraph in another that happened
// to say "is NOT a defect". `failed` exists so the last line of output is the
// list, not the count.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? '  — ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

console.log('=== RATIO BASIS CHECK ===\n');

// --- 1. THE IDENTITY, at the default CLF of exactly 1.000 --------------------
console.log('--- 1. EXPECTED COMBINED RATIO IS EXACTLY 1.0000 AT CLF 1.000 ---');
console.log('  Defaults put fundingAtExpected true on every line, so CLF is exactly 1.0.\n');
{
  const worst: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
  let poolWorst = 0, n = 0, clfNot1 = 0;

  for (let g = 0; g < GAMES; g++) {
    const id = `RBC${g}`;
    const inst = generateGameInstance(id, 9_100_000 + g * 6337);
    const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const pool = p.result as ResultSet;
      for (const l of LINES) {
        const r = (pool as never as { byLine: Record<string, LineResultSet> }).byLine[l];
        if (!r) continue;
        if (r.selectedFundingCLF !== 1.0) clfNot1++;
        worst[l] = Math.max(worst[l], Math.abs(r.expectedCombinedRatio - 1));
        n++;
      }
      poolWorst = Math.max(poolWorst, Math.abs((pool as never as { expectedCombinedRatio: number }).expectedCombinedRatio - 1));
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }

  console.log(`  ${n.toLocaleString()} line-years across ${GAMES} games; ${clfNot1} had CLF != 1.000\n`);
  check(clfNot1 === 0, 'every line-year priced at CLF exactly 1.000 (the default)');
  for (const l of LINES) {
    check(worst[l] < EXACT, `${l}: |expectedCombinedRatio - 1| < 1e-12 on every line-year`,
      `worst ${worst[l].toExponential(2)}`);
  }
  check(poolWorst < EXACT, 'pool aggregate: |expectedCombinedRatio - 1| < 1e-12 on every year',
    `worst ${poolWorst.toExponential(2)}`);
  console.log('\n  ⚠ THE POOL ROW IS A SEPARATE ASSERTION ON PURPOSE. It re-derives every ratio');
  console.log('  from its own sums, so a line-level fix that forgot the aggregation would pass');
  console.log('  the three line checks above and fail only here.');
}

// --- 2. THE NUMERATOR BASIS, stated as an identity rather than a value -------
console.log('\n--- 2. THE LOSS NUMERATOR IS THE ONE THE PREMIUM FUNDS ---');
console.log('  expectedLossRatioMemberBasis x totalMemberCharge must equal poolPremium / CLF,');
console.log('  which is what "same basis" MEANS here. Independent of section 1: this holds at');
console.log('  every CLF, not just 1.000.\n');
{
  const CONFS = [0.30, 0.60, 0.75, 0.90];
  console.log('  conf   line       ECR        recovered numerator vs poolPremium/CLF');
  for (const conf of CONFS) {
    const id = `RBN${Math.round(conf * 100)}`;
    const inst = generateGameInstance(id, 5_900_000);
    const setup = { poolName: 'N', gameLength: 2, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    const gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    // Same decisions, but funding OFF Expected and onto the table at `conf`.
    const base = defaultDecisionSet(1) as never as { byLine: Record<string, Record<string, unknown>> };
    for (const l of LINES) {
      base.byLine[l].fundingAtExpected = false;
      base.byLine[l].fundingConfidenceLevel = conf;
    }
    const p = processYear(gs, base as never);
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
      if (!r) continue;
      const recovered = r.expectedLossRatioMemberBasis * r.totalMemberCharge;
      const funded = r.poolPremium / r.selectedFundingCLF;
      const rel = Math.abs(recovered - funded) / Math.max(funded, 1);
      console.log(`  ${(conf * 100).toFixed(0).padStart(3)}%   ${l.padEnd(10)} ${(r.expectedCombinedRatio * 100).toFixed(2).padStart(7)}%    ` +
        `rel diff ${rel.toExponential(2)}  ${rel < 1e-12 ? 'OK' : 'FAIL'}`);
      if (rel >= 1e-12) failures++;
      // Above CLF 1.0 the combined ratio must sit BELOW 1.0 — that gap is the margin.
      if (r.selectedFundingCLF > 1.0) {
        check(r.expectedCombinedRatio < 1.0,
          `  CLF ${r.selectedFundingCLF.toFixed(4)} > 1 on ${l}: combined ratio below 1.0 (the funding margin)`,
          `${(r.expectedCombinedRatio * 100).toFixed(2)}%`);
      }
    }
  }
}

// --- 3. NO OTHER RATIO MIXES BASES -------------------------------------------
console.log('\n--- 3. EVERY OTHER STORED RATIO, RECONCILED AGAINST ITS OWN PARTS ---');
console.log('  Recomputes each ratio from the fields it claims to be built from. A ratio that');
console.log('  no longer reproduces from its stated parts has had one side changed underneath it.\n');
{
  const inst = generateGameInstance('RBO', 3_700_000);
  const setup = { poolName: 'O', gameLength: 4, startingYear: 2026, instanceId: 'RBO', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const bad: string[] = [];
  for (let y = 1; y <= 4; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
      if (!r) continue;
      const t = (label: string, stored: number, rebuilt: number) => {
        if (Math.abs(stored - rebuilt) > 1e-12) bad.push(`${l} Y${y} ${label}: stored ${stored} vs rebuilt ${rebuilt}`);
      };
      const funded = r.poolPremium / r.selectedFundingCLF;
      t('expectedLossRatio (pricing)', r.expectedLossRatio, funded / Math.max(r.poolPremium + r.adminExpense, 1));
      t('expectedLossRatioMemberBasis', r.expectedLossRatioMemberBasis, funded / Math.max(r.totalMemberCharge, 1));
      t('expectedExpenseRatio', r.expectedExpenseRatio, (r.adminExpense + r.reinsuranceCost) / Math.max(r.totalMemberCharge, 1));
      t('actualLossRatio', r.actualLossRatio, r.netIncurredLoss / Math.max(r.totalMemberCharge, 1));
      t('actualExpenseRatio', r.actualExpenseRatio, (r.adminExpense + r.reinsuranceCost) / Math.max(r.totalMemberCharge, 1));
      t('actualCombinedRatio', r.actualCombinedRatio, r.actualLossRatio + r.actualExpenseRatio);
      // The member-charge identity every one of the above leans on.
      t('totalMemberCharge identity', r.totalMemberCharge, r.poolPremium + r.adminExpense + r.reinsuranceCost);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  check(bad.length === 0, 'every stored ratio reproduces from its own stated parts', `${bad.length} mismatch(es)`);
  for (const b of bad.slice(0, 8)) console.log(`        ${b}`);
}

// --- 4. ACTUAL vs EXPECTED NOW SHARE A BASIS ---------------------------------
console.log('\n--- 4. ACTUAL AND EXPECTED LOSS RATIOS ARE FINALLY COMPARABLE ---');
console.log('  actualLossRatio has always been net (netIncurredLoss / totalMemberCharge).');
console.log('  Until this fix the expected one was gross over the same denominator, so the two');
console.log('  could not be differenced — the gap read as pricing error when it was basis error.\n');
{
  const inst = generateGameInstance('RBA', 8_200_000);
  const setup = { poolName: 'A', gameLength: 6, startingYear: 2026, instanceId: 'RBA', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const gaps: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  for (let y = 1; y <= 6; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
      if (r) gaps[l].push(r.actualLossRatio - r.expectedLossRatioMemberBasis);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log('  line       mean (actual - expected) loss ratio, both net, member-charge basis');
  for (const l of LINES) {
    console.log(`  ${l.padEnd(10)} ${(mean(gaps[l]) * 100>= 0 ? '+' : '')}${(mean(gaps[l]) * 100).toFixed(2)}pp`);
  }
  console.log('\n  REPORTED, NOT GATED — this is a draw outcome on a heavy tail, and gating on the');
  console.log('  mean of one is finding 26. It is here because a persistent one-sided gap is the');
  console.log('  signature a basis error would leave behind.');
}

console.log(failures === 0 ? '\nALL RATIO BASIS CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
