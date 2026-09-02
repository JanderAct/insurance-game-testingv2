// Read-only diagnostic (CALIBRATION_FINDINGS.md findings 6 & 17). Drives the
// REAL engine — generateGameInstance / runPriorHistory / defaultDecisionSet /
// processYear — at default decisions, all three lines, and reports two things
// directly off the returned result objects:
//
//   1. Does commonLossFactor (the lognormal draw x actualLossLevelMultiplier,
//      simulationEngine.ts:203-206) average ~1.0 across many seeds/years, as
//      the AGGREGATE_LOSS_DISTRIBUTION comment in defaultAssumptions.ts claims?
//   2. Does expressing expectedLossRatio and actualLossRatio on the SAME
//      denominator (poolPremiumAndAdminExpense) reconcile the ~46%-vs-66.8%
//      gap in finding 6, which today compares expectedLossRatio (denominator
//      poolPremiumAndAdminExpense) against actualLossRatio (denominator
//      totalMemberCharge, which additionally includes reinsuranceCost)?
//
// Deliberately outside src/, so tsconfig.app.json's "include": ["src"] never
// sees it — but tsconfig.scripts.json does, and `npm run typecheck` runs both.
// Run with `npx tsx`.
//
// No engine/pricing/loss logic is reimplemented anywhere below — every
// captured field is read straight off the LineResultSet objects processYear
// returns. The one exception is the seed-string-to-number hash: App.tsx's
// seedFromInstanceId (App.tsx:46) is a private, unexported helper, so it is
// reproduced verbatim here (it is plumbing — turning a label into a number —
// not a business rule) rather than pulled in via a source change.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { GameState, GameSetupSettings, CoverageLine, LineResultSet } from '../../src/types/simulation';

// Verbatim copy of App.tsx:46-53 (seedFromInstanceId) — not exported there.
function seedFromInstanceId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash;
}

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 5;
const SEED_COUNT = 30;

// 30 varied, deterministic 8-character instanceIds (not Math.random — this
// script must be reproducible run to run). Each index maps through a
// different multiplicative constant to base36 so the strings don't share a
// common prefix the way zero-padded sequential numbers would.
const SEED_IDS: string[] = Array.from({ length: SEED_COUNT }, (_, i) => {
  const mixed = ((i + 1) * 2654435761) >>> 0;
  return mixed.toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
});

interface Row {
  seed: string;
  line: CoverageLine;
  year: number;
  expectedLoss: number;
  commonLossFactor: number;
  netIncurredLoss: number;
  poolPremiumAndAdminExpense: number;
  totalMemberCharge: number;
  reinsuranceCost: number;
  adminExpense: number;
  expectedLossRatio: number;
  actualLossRatio: number;
}

const rows: Row[] = [];

for (const instanceId of SEED_IDS) {
  const seed = seedFromInstanceId(instanceId);
  const instance = generateGameInstance(instanceId, seed);
  const setup: GameSetupSettings = {
    poolName: 'Diagnostic',
    gameLength: YEARS,
    startingYear: 2026,
    instanceId,
    activeLines: LINES,
  };
  // Whatever pre-game reject-and-redraw attempt the existing bootstrap
  // accepts — not altered or inspected here (finding 8).
  const { poolState, priorHistory } = runPriorHistory(instance, setup);

  let gs: GameState = {
    setup,
    instance,
    currentYearNumber: 1,
    isStarted: true,
    isComplete: false,
    poolState,
    lockedResults: [],
    currentDecisions: defaultDecisionSet(1),
    priorHistory,
  };

  for (let y = 1; y <= YEARS; y++) {
    const decisions = defaultDecisionSet(y); // default decisions every year, no rate/reinsurance/CLF changes
    const p = processYear(gs, decisions);

    for (const line of LINES) {
      const r: LineResultSet = p.result.byLine[line];
      rows.push({
        seed: instanceId,
        line,
        year: y,
        expectedLoss: r.expectedLoss,
        commonLossFactor: r.commonLossFactor,
        netIncurredLoss: r.netIncurredLoss,
        poolPremiumAndAdminExpense: r.poolPremiumAndAdminExpense,
        totalMemberCharge: r.totalMemberCharge,
        reinsuranceCost: r.reinsuranceCost,
        adminExpense: r.adminExpense,
        expectedLossRatio: r.expectedLossRatio,
        actualLossRatio: r.actualLossRatio,
      });
    }

    gs = {
      ...gs,
      currentYearNumber: y + 1,
      poolState: p.updatedPoolState,
      lockedResults: [...gs.lockedResults, p.result],
    };
  }
}

// --- Write the CSV ---
const csvHeader = [
  'seed', 'line', 'year', 'expectedLoss', 'commonLossFactor', 'netIncurredLoss',
  'poolPremiumAndAdminExpense', 'totalMemberCharge', 'reinsuranceCost', 'adminExpense',
  'expectedLossRatio', 'actualLossRatio',
].join(',');
const csvLines = rows.map(r => [
  r.seed, r.line, r.year, r.expectedLoss, r.commonLossFactor, r.netIncurredLoss,
  r.poolPremiumAndAdminExpense, r.totalMemberCharge, r.reinsuranceCost, r.adminExpense,
  r.expectedLossRatio, r.actualLossRatio,
].join(','));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, 'loss-ratio-report-output.csv');
fs.writeFileSync(outPath, [csvHeader, ...csvLines].join('\n') + '\n');

// --- Summary stats ---
function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const clf = rows.map(r => r.commonLossFactor);
const clfByLine = (line: CoverageLine) => rows.filter(r => r.line === line).map(r => r.commonLossFactor);

const sumNetIncurred = rows.reduce((s, r) => s + r.netIncurredLoss, 0);
const sumPoolPremiumAndAdmin = rows.reduce((s, r) => s + r.poolPremiumAndAdminExpense, 0);
const reconciledLossRatio = sumNetIncurred / sumPoolPremiumAndAdmin;

const meanActualLossRatio = mean(rows.map(r => r.actualLossRatio));
const meanExpectedLossRatio = mean(rows.map(r => r.expectedLossRatio));

console.log(`=== Loss ratio diagnostic: ${SEED_COUNT} seeds x ${YEARS} years x ${LINES.length} lines = ${rows.length} line-years ===\n`);

console.log('-- commonLossFactor (should average ~1.0 per the AGGREGATE_LOSS_DISTRIBUTION comment) --');
console.log(`  pooled   : mean ${mean(clf).toFixed(4)}   median ${median(clf).toFixed(4)}   n=${clf.length}`);
for (const line of LINES) {
  const xs = clfByLine(line);
  console.log(`  ${line.padEnd(8)}: mean ${mean(xs).toFixed(4)}   median ${median(xs).toFixed(4)}   n=${xs.length}`);
}

console.log('\n-- Loss ratios, three ways --');
console.log(`  displayed actualLossRatio   (numerator netIncurredLoss,   denominator totalMemberCharge)          : ${(meanActualLossRatio * 100).toFixed(2)}%`);
console.log(`  displayed expectedLossRatio (numerator expectedLoss,     denominator poolPremiumAndAdminExpense)  : ${(meanExpectedLossRatio * 100).toFixed(2)}%`);
console.log(`  reconciled loss ratio       (sum netIncurredLoss / sum poolPremiumAndAdminExpense, SAME denominator as expected): ${(reconciledLossRatio * 100).toFixed(2)}%`);

console.log('\n-- Plain read --');
console.log(`  commonLossFactor mean ${Math.abs(mean(clf) - 1) < 0.02 ? 'IS' : 'is NOT'} close to 1.0 (measured ${mean(clf).toFixed(4)}).`);
console.log(`  reconciled loss ratio ${Math.abs(reconciledLossRatio - 0.5) < 0.05 ? 'IS' : 'is NOT'} close to 50% (measured ${(reconciledLossRatio * 100).toFixed(2)}%), vs the mismatched-denominator pair ${(meanActualLossRatio * 100).toFixed(2)}% actual / ${(meanExpectedLossRatio * 100).toFixed(2)}% expected.`);

console.log(`\nWrote ${rows.length} rows to ${outPath}`);
