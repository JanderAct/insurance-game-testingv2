// POOL-SCOPE AGGREGATION CHECK — is every pooled field still the thing its name says?
//
//   npx tsx scripts/diagnostics/pool-aggregation-check.ts
//
// ============================================================================
// WHY THIS EXISTS, AND WHY A COMMENT WAS NOT ENOUGH.
//
// Seven pool-scope aggregation defects reached players, each found by tripping
// over it rather than by looking. THREE of them were added directly underneath
// a comment warning about exactly that class:
//
//   activeExposure / totalMarketExposure   the warning itself (payroll + TIV)
//   writtenExposure                        added later, same defect, NOT named
//                                          by the warning three lines above it
//   cededByLayer                           its justification said "only
//                                          meaningful because WC and GL share
//                                          attachments" — then Property got a
//                                          tower and its $70M xs $5M layer
//                                          landed in the $4M xs $1M cell
//
// A warning naming three fields did not stop the fourth. That is the evidence
// that prose does not hold this line: the failure is always "a field was added
// (or a LINE was added) and nobody re-read the neighbouring comment".
//
// So aggregateLineResults now has NO generic `sum`. Every call names its class —
// addDollars / addEnrolments / addMixedUnitExposure / noPoolMeaning — and this
// script asserts that every numeric field on the pooled row is COVERED by one
// of the four classifications below. A field added to ResultSet without being
// classified here turns this red.
//
// ⚠ THIS CHECKS BOOKKEEPING, NOT TRUTH. It cannot tell you that a field is in
// the wrong class — only that somebody made a choice and wrote it down. The
// value is that adding a field now requires a deliberate act, where before it
// required nothing.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
let failures = 0;
// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
const note = (ok: boolean, msg: string) => { if (!ok) { failures++; failed.push(msg); return `FAIL — ${msg}`; } return 'OK'; };

// --- THE CLASSIFICATION -----------------------------------------------------
// Every numeric field on the pooled row must appear in exactly one of these.

// Extensive money and other genuinely additive quantities.
const DOLLARS = new Set([
  'poolPremium', 'adminExpense', 'poolPremiumAndAdminExpense', 'totalMemberCharge',
  'grossPremium', 'assessments', 'dividends', 'aggregateMemberLoss',
  'grossUltimateLoss', 'reinsuranceCost', 'retainedAboveTower', 'aggregateRecovery',
  'aggregatePremium', 'reinsuranceRecovery', 'netUltimateLoss', 'netIncurredLoss',
  'operatingExpense', 'riskControlInvestment', 'priorYearDevelopment',
  'beginningNetReserve', 'currentYearNetReserve', 'netPaidLosses', 'endingNetReserve',
  'investedAssets', 'investmentIncome', 'outstandingLoanBalance', 'loanRepaymentApplied',
  'loanInterestAccrued', 'loanOriginatedThisYear',
  // ⚠ THESE TWO SUM TO ZERO AT POOL SCOPE RATHER THAN TO A TOTAL, and they are
  // still DOLLARS: every dollar one line receives from inter-line lending is a
  // dollar another line paid, so the pool row is 0 by construction. Summing is
  // the correct aggregation AND the check — a pool total that drifts off zero
  // means the borrower side and the lender side disagree.
  'interLineTransfer', 'interLineCashTransfer',
  'expectedLoss', 'clfAdjustedExpectedLoss',
  'expectedNetUnpaidLoss', 'priorYearDevelopmentCeded', 'bookingGiveBack',
  'netFundingTarget', 'indicatedNetReserveAtConfidenceLevel', 'reserveRiskMarginNeeded',
  'fundingMarginNeeded', 'availableFunding', 'availableSurplus', 'fundingGap',
  'capitalFundingGap', 'excessAvailableSurplus', 'underwritingIncome', 'netIncome',
  'beginningCash', 'endingCash', 'beginningInvestments', 'endingInvestments',
  'totalAssets', 'unearnedPremium', 'totalLiabilities', 'beginingSurplus', 'endingSurplus',
  'surplusFromIncome', 'surplusTieOutDifference',
]);

// Distinct member counts — deduplicated by id, equal to the line value at line scope.
const DISTINCT_MEMBERS = new Set(['activeMembers', 'newMembers', 'withdrawnMembers']);

// Per-line enrolment counts. A weight, never a headcount.
const ENROLMENTS = new Set(['enrolmentCount']);

// WC/GL payroll added to Property TIV. Retained for display; never unit-labelled.
const MIXED_UNIT_EXPOSURE = new Set(['activeExposure', 'totalMarketExposure', 'writtenExposure']);

// Recomputed from summed components — never summed directly.
// ⚠ RESERVE-WEIGHTED, LIKE investmentReturnRate. A rate summed across lines is
// nonsense; the pool's next-year paydown rate is the pool's own next-year
// payment over the pool's own reserve.
const RECOMPUTED_RATIOS = new Set([
  'nextYearPaydownRate',
  'marketShare', 'memberRetentionRate', 'memberSatisfaction', 'averageRiskQuality',
  'investmentReturnRate', 'expectedLossRatio', 'expectedLossRatioMemberBasis',
  'expectedExpenseRatio', 'expectedCombinedRatio', 'actualLossRatio', 'actualExpenseRatio',
  'actualCombinedRatio', 'combinedRatio', 'lossRatio', 'expenseRatio',
  'excessCapitalRatio', 'capitalAdequacyRatio',
]);

// No pool-level referent. Carried as a placeholder; read byLine instead.
const NO_POOL_MEANING = new Set(['aggregateAttachment', 'commonLossFactor', 'catastropheFactor']);

// Line-ambiguous descriptive/rate fields showing the first active line's value.
// Documented at the definition; not aggregations at all.
const FIRST_LINE_PLACEHOLDER = new Set([
  'yearNumber', 'calendarYear', 'rateLevel', 'ratePer100', 'purePremiumPer100', 'purePremium',
  'expectedCededPer100', 'netPurePremiumPer100', 'selectedFundingConfidenceLevel',
  'selectedFundingCLF', 'fundingCLF',
  'historyAttempt',
]);

const ALL = [DOLLARS, DISTINCT_MEMBERS, ENROLMENTS, MIXED_UNIT_EXPOSURE, RECOMPUTED_RATIOS,
  NO_POOL_MEANING, FIRST_LINE_PLACEHOLDER];

function play(id: string, seed: number, lines: CoverageLine[]): ResultSet[] {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'P', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: ResultSet[] = [];
  for (let y = 1; y <= 5; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    out.push(p.result);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return out;
}

const tri = play('POOLAGG', 5_150_000, LINES);

console.log('=== 1. EVERY NUMERIC POOLED FIELD IS CLASSIFIED ===');
console.log('  A field added to ResultSet without a class turns this red — that is the point.\n');
{
  const seen = new Set<string>();
  for (const r of tri) for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' && Number.isFinite(v)) seen.add(k);
  }
  const unclassified = [...seen].filter(k => !ALL.some(s => s.has(k))).sort();
  const duplicated = [...seen].filter(k => ALL.filter(s => s.has(k)).length > 1).sort();
  console.log(`  ${seen.size} numeric fields on the pooled row`);
  console.log(`  unclassified ${unclassified.length}${unclassified.length ? `: ${unclassified.join(', ')}` : ''}  ` +
    `${note(unclassified.length === 0, `unclassified pooled field(s): ${unclassified.join(', ')} — add each to exactly one set in this file`)}`);
  console.log(`  in two classes ${duplicated.length}${duplicated.length ? `: ${duplicated.join(', ')}` : ''}  ` +
    `${note(duplicated.length === 0, `field(s) in more than one class: ${duplicated.join(', ')}`)}`);
}

console.log('\n=== 2. DISTINCT MEMBER COUNTS ARE ACTUALLY DISTINCT ===');
console.log('  activeMembers must equal the deduplicated roster, not the enrolment sum.\n');
{
  let worstGap = 0, worstEnrol = 0;
  for (const r of tri) {
    worstGap = Math.max(worstGap, Math.abs(r.activeMembers - r.memberList.length));
    worstEnrol = Math.max(worstEnrol, r.enrolmentCount - r.activeMembers);
  }
  console.log(`  worst |activeMembers - memberList.length| ${worstGap}  ` +
    `${note(worstGap === 0, 'activeMembers is not the distinct roster at pool scope')}`);
  // The enrolment sum must still EXCEED the roster on a multi-line pool, or the
  // weight has been silently deduplicated and satisfaction/quality are wrong.
  console.log(`  enrolmentCount - activeMembers, worst ${worstEnrol}  ` +
    `${note(worstEnrol > 0, 'enrolmentCount no longer exceeds the roster on a three-line pool — the WEIGHT has been deduplicated, which breaks memberSatisfaction and averageRiskQuality')}`);
  const r = tri[tri.length - 1];
  console.log(`  e.g. ${r.activeMembers} members carrying ${r.enrolmentCount} enrolments`);
}

console.log('\n=== 3. JOINERS AND LEAVERS ARE DEDUPLICATED TOO ===');
console.log('  A member entering WC and GL in one year is one joiner, not two.\n');
{
  let badNew = 0, badWd = 0;
  for (const r of tri) {
    const sumNew = LINES.reduce((s, l) => s + r.byLine[l].newMembers, 0);
    const sumWd = LINES.reduce((s, l) => s + r.byLine[l].withdrawnMembers, 0);
    if (r.newMembers > sumNew) badNew++;
    if (r.withdrawnMembers > sumWd) badWd++;
  }
  console.log(`  years where pooled newMembers exceeded the per-line sum: ${badNew}  ` +
    `${note(badNew === 0, 'pooled joiner count exceeds the sum of per-line joiners — impossible for a union')}`);
  console.log(`  years where pooled withdrawnMembers exceeded the per-line sum: ${badWd}  ` +
    `${note(badWd === 0, 'pooled leaver count exceeds the sum of per-line leavers — impossible for a union')}`);
  const tot = tri.reduce((s, r) => s + LINES.reduce((a, l) => a + r.byLine[l].newMembers, 0), 0);
  const dis = tri.reduce((s, r) => s + r.newMembers, 0);
  console.log(`  over 5 years: ${tot} per-line joins collapse to ${dis} distinct joiners`);
}

console.log('\n=== 4. cededByLayer CELLS LINE UP ===');
console.log('  Elementwise sums require a shared attachment. Property does not share one.\n');
{
  const r = tri[0];
  const wcGl = LINES.filter(l => l !== 'Property')
    .reduce((acc, l) => { r.byLine[l].cededByLayer.forEach((v, i) => { acc[i] = (acc[i] ?? 0) + v; }); return acc; }, [] as number[]);
  const matches = r.cededByLayer.length === wcGl.length
    && r.cededByLayer.every((v, i) => Math.abs(v - wcGl[i]) < 1e-6);
  console.log(`  pooled  [${r.cededByLayer.map(v => (v / 1e6).toFixed(2)).join(', ')}]`);
  console.log(`  WC+GL   [${wcGl.map(v => (v / 1e6).toFixed(2)).join(', ')}]`);
  console.log(`  Property (excluded, single $70M xs $5M layer) [${r.byLine.Property.cededByLayer.map(v => (v / 1e6).toFixed(2)).join(', ')}]`);
  console.log(`  ${note(matches, 'pooled cededByLayer is not the WC+GL elementwise sum — Property has been folded back into cells whose attachment it does not share')}`);
}

console.log('\n=== 5. A SOLO POOL IS ITS ONE LINE, EXACTLY ===');
console.log('  With one active line every aggregation is the identity. Any drift here is a bug\n' +
  '  in the aggregation itself rather than in the pooling, so it localises the fault.\n');
{
  for (const line of LINES) {
    const solo = play(`SOLO${line}`, 6_200_000, [line]);
    let worst = '', worstRel = 0;
    for (const r of solo) {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (FIRST_LINE_PLACEHOLDER.has(k) || NO_POOL_MEANING.has(k)) continue;
        const lv = (r.byLine[line] as unknown as Record<string, number>)[k];
        if (typeof lv !== 'number' || !Number.isFinite(lv)) continue;
        const scale = Math.max(Math.abs(v), Math.abs(lv), 1);
        const rel = Math.abs(v - lv) / scale;
        if (rel > worstRel) { worstRel = rel; worst = k; }
      }
    }
    console.log(`  ${line.padEnd(9)} worst pooled-vs-line divergence ${worstRel.toExponential(2)}${worst ? ` (${worst})` : ''}  ` +
      `${note(worstRel < 1e-12, `${line}-solo pooled row differs from its only line at ${worst}`)}`);
  }
}

console.log(failures === 0 ? '\nALL POOL AGGREGATION CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
process.exit(failures === 0 ? 0 : 1);
