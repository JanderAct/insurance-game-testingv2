// NET FUNDING BASIS — this is what guards it.
//
// Run: npx tsx scripts/diagnostics/funding-basis-check.ts
//
// The pool premium now funds NET expected loss: gross pure premium less the
// expected ceded of the layers ACTUALLY PLACED (plus the WC/Property
// aggregate's own expected ceded), before the CLF is applied. All three lines
// net now — Property joined as of its own occurrence layer and aggregate.
//
// THE ASSERTIONS THAT MATTER:
//
//  1. poolPremium / (expectedLoss - expectedCeded) == CLF exactly. Under the old
//     gross basis this ratio was CLF against expectedLoss itself.
//  2. The underwriting identity still holds EXACTLY: at defaults,
//     underwritingIncome == poolPremium - netIncurredLoss. What changes is not
//     the identity but its expectation.
//  3. E[underwriting income] at CLF 1.000 is now ~ZERO rather than ~E[ceded].
//     This is the whole point: the pool no longer banks the ceded portion.
//  4. Declining layers RAISES the pool premium, because their expected ceded
//     stays in. A layer's net cost to members is its RISK LOAD alone.
//  5. Admin is unchanged and still on the GROSS expected loss.
//
// Reported, plus hard assertions where the quantity is bounded.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER, RISK_LOAD_LAMBDA } from '../../src/data/reinsuranceTower';
import { occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, Member } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = 60, YEARS = 10;
const M = 1e6;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const ci95 = (xs: number[]) => 1.96 * sd(xs) / Math.sqrt(xs.length);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
  else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

interface Row {
  poolPremium: number; adminExpense: number; expectedLoss: number; reinsuranceCost: number;
  totalMemberCharge: number; netIncurredLoss: number; underwritingIncome: number;
  activeExposure: number; purePremiumPer100: number; ratePer100: number; clf: number;
}
const rows: Record<string, Row[]> = { WC: [], GL: [], Property: [] };
const cededPriced: Record<string, number[]> = { WC: [], GL: [], Property: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `FBC${g}`;
  const inst = generateGameInstance(id, 6_300_000 + g * 4441);
  const setup = { poolName: 'F', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as GameState;

  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y);
    // The expected ceded the engine itself priced on: same pre-movement book,
    // same placement, same function.
    for (const l of ['WC', 'GL', 'Property'] as const) {
      const book = (gs.poolState as never as {
        lines: Record<string, { members: Member[] }>
      }).lines[l].members.filter(m => m.status === 'active');
      const placed = REINSURANCE_TOWER[l].map(x => x.purchasable);
      cededPriced[l].push(occurrenceProgramCost(l, placed, book, y).expectedCeded);
    }

    const p = processYear(gs, d);
    for (const line of LINES) {
      const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
      if (!r) continue;
      rows[line].push({
        poolPremium: r.poolPremium, adminExpense: r.adminExpense, expectedLoss: r.expectedLoss,
        reinsuranceCost: r.reinsuranceCost, totalMemberCharge: r.totalMemberCharge,
        netIncurredLoss: r.netIncurredLoss, underwritingIncome: r.underwritingIncome,
        activeExposure: r.activeExposure, purePremiumPer100: r.purePremiumPer100,
        ratePer100: r.ratePer100, clf: r.selectedFundingCLF,
      });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

console.log('=== NET FUNDING BASIS CHECK — 60 games x 10 years, all defaults ===');
console.log('All-defaults = CLF 1.000 on WC/GL and the FULL occurrence tower placed.\n');

console.log('--- 1. poolPremium FUNDS NET, NOT GROSS ---');
for (const l of ['WC', 'GL', 'Property'] as const) {
  const gross = rows[l].map(r => r.poolPremium / Math.max(r.expectedLoss, 1));
  const net = rows[l].map((r, i) => r.poolPremium / Math.max(r.expectedLoss - cededPriced[l][i], 1));
  console.log(`  ${l}: poolPremium/GROSS expected = ${mean(gross).toFixed(4)}  ` +
    `poolPremium/NET expected = ${mean(net).toFixed(6)} (CLF ${mean(rows[l].map(r => r.clf)).toFixed(4)})`);
  check(Math.abs(mean(net) - 1) < 2e-3,
    `${l}: poolPremium / (gross - expected ceded) == CLF 1.000`, `${mean(net).toFixed(6)}`);
  check(mean(gross) < 0.95, `${l}: and it is NO LONGER the gross figure`, `gross ratio ${mean(gross).toFixed(4)}`);
}

console.log('\n--- 2. ADMIN IS STILL ON THE GROSS EXPECTED LOSS ---');
for (const l of LINES) {
  const ratio = rows[l].map(r => r.adminExpense / Math.max(r.expectedLoss, 1));
  check(Math.abs(mean(ratio) - ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM) < 1e-9,
    `${l}: adminExpense / GROSS expectedLoss == ${ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM}`, mean(ratio).toFixed(6));
}

console.log('\n--- 3. THE UNDERWRITING IDENTITY STILL HOLDS EXACTLY ---');
for (const l of LINES) {
  const diff = rows[l].map(r => Math.abs(r.underwritingIncome - (r.poolPremium - r.netIncurredLoss)));
  check(Math.max(...diff) < 1e-6,
    `${l}: underwritingIncome == poolPremium - netIncurredLoss`, `max abs diff $${Math.max(...diff).toExponential(2)}`);
}

console.log('\n--- 4. E[UW INCOME] AT CLF 1.000 IS NOW ~ZERO, NOT E[CEDED] ---');
console.log('  line       E[UW income]$M   95% CI +/-$M   E[ceded]$M (what it USED to be)');
for (const l of ['WC', 'GL'] as const) {
  const uw = rows[l].map(r => r.underwritingIncome);
  console.log(`  ${l.padEnd(10)} ${(mean(uw) / M).toFixed(3).padStart(14)} ${(ci95(uw) / M).toFixed(3).padStart(14)} ` +
    `${(mean(cededPriced[l]) / M).toFixed(3).padStart(30)}`);
}
console.log('  (heavy-tailed — reported with a CI, and NOT gated on. The gated facts are 1-3 above.)');

console.log('\n--- 5. MEMBER CHARGE PER $100 ---');
console.log('  line       pure/100   pool rate/100   admin/100   reins/100   TOTAL/100');
for (const l of LINES) {
  const e = mean(rows[l].map(r => r.activeExposure)) * 1e4;
  console.log(`  ${l.padEnd(10)} ${mean(rows[l].map(r => r.purePremiumPer100)).toFixed(3).padStart(8)} ` +
    `${(mean(rows[l].map(r => r.poolPremium)) / e).toFixed(3).padStart(15)} ` +
    `${(mean(rows[l].map(r => r.adminExpense)) / e).toFixed(3).padStart(11)} ` +
    `${(mean(rows[l].map(r => r.reinsuranceCost)) / e).toFixed(3).padStart(11)} ` +
    `${(mean(rows[l].map(r => r.totalMemberCharge)) / e).toFixed(3).padStart(11)}`);
}

console.log('\n--- 6. DECLINING A LAYER: the net cost is the RISK LOAD alone ---');
console.log('  Placing a layer costs its premium but SAVES its expected ceded from the pool');
console.log('  premium, so the net member cost of any layer is lambda x SD[ceded].');
console.log(`  Checked analytically on the full canonical roster at lambda ${RISK_LOAD_LAMBDA}.\n`);
{
  const { getPredefinedMarketMembers } = await import('../../src/data/memberCatalog');
  const book = getPredefinedMarketMembers();
  for (const l of ['WC', 'GL'] as const) {
    const none = REINSURANCE_TOWER[l].map(() => false);
    const all = REINSURANCE_TOWER[l].map(x => x.purchasable);
    const qAll = occurrenceProgramCost(l, all, book, 1);
    const qNone = occurrenceProgramCost(l, none, book, 1);
    const netCost = (qAll.premium - qAll.expectedCeded) - (qNone.premium - qNone.expectedCeded);
    console.log(`  ${l}: full tower premium $${(qAll.premium / M).toFixed(3)}M, expected ceded ` +
      `$${(qAll.expectedCeded / M).toFixed(3)}M, NET cost to members $${(netCost / M).toFixed(3)}M/yr`);
    check(netCost > 0 && netCost < qAll.premium,
      `${l}: net cost is positive but below the gross premium`,
      `${((netCost / qAll.premium) * 100).toFixed(1)}% of premium`);
  }
}

console.log(failures === 0 ? '\nALL FUNDING-BASIS CHECKS PASS.' : `\n${failures} CHECK(S) FAILED.`);
if (failures > 0) process.exit(1);
