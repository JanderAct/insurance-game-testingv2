// PROPERTY'S CLF BASIS ERROR — sizing what its own derived table would correct.
//
// Run: npx tsx scripts/diagnostics/property-clf-basis-report.ts
//      GAMES=3000 npx tsx scripts/diagnostics/property-clf-basis-report.ts
//
// REPORTS. Changes nothing, gates nothing. Property's own CLF table is the
// next commit; this measures what that commit is for.
//
// ============================================================================
// THE DEFECT, STATED PRECISELY.
//
// FUNDING_CLF_TABLE maps a confidence LEVEL to a multiplier on expected loss:
// at level p, funding = CLF(p) x expected loss is asserted to cover the year's
// loss with probability p. It is the real pool's reference chart, derived on a
// GROSS annual loss distribution.
//
// Since dbd9138 Property's pool premium funds NET expected loss — gross less
// what the occurrence layer is expected to cede. So a gross-basis multiplier is
// being applied to a net base, and the confidence level it actually delivers is
// not the one on the label. This is the same defect fab85e4 flagged (and did
// not fix) for WC and GL, where it measured ~5.5pp: the 60% stop delivered
// 54.3% on GL and 54.7% on WC.
//
// ⚠ THE DEFAULT IS THE ONE PLACE THE ERROR CANNOT SHOW AS A PRICE. At the 60%
// stop the table's entry is the literal 1.000, and multiplying by one is the
// identity on any basis — so the DOLLARS the pool collects at defaults are not
// wrong. What is wrong is the LABEL: 1.000x net expected loss does not sit at
// the 60th percentile of Property's net outcome distribution. Every other stop
// is wrong in dollars as well, because there the multiplier is not 1.
//
// Two quantities are therefore reported and they answer different questions:
//   DELIVERED CONFIDENCE  what percentile each labelled stop actually reaches.
//                         The label error. Comparable to fab85e4's 5.5pp.
//   IMPLIED MULTIPLIER    what multiplier WOULD reach the labelled percentile.
//                         The dollar error, and what a derived table would ship.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FUNDING_CLF_TABLE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 1200);
const YEARS = 10;
const LINE: CoverageLine = 'Property';

// The statistic is the same one clf-table-derive.ts uses to BUILD a table:
// netIncurredLoss / poolPremium. Its percentiles ARE the table — a stop at
// percentile p wants the multiplier that makes that ratio 1.0 at p.
//
// ⚠ AT DEFAULTS THE RATIO IS ALREADY ON THE NET BASIS, on both sides. Property
// funds net, so poolPremium = 1.000 x net expected loss, and netIncurredLoss is
// the realised net. The ratio's distribution is therefore exactly the object a
// net-basis table must be derived from, with no rescaling needed here.
const ratios: number[] = [];

for (let g = 0; g < GAMES; g++) {
  const id = `PCLF${g}`;
  const inst = generateGameInstance(id, 3_100_000 + g * 6151);
  // SOLO, matching clf-table-derive's convention: a line's own funding
  // adequacy is a property of that line's book, and running it alongside
  // others only adds cross-line membership coupling to the measurement.
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: [LINE] };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const r = (p.result as unknown as ResultSet).byLine[LINE];
    if (r && r.poolPremium > 0) ratios.push(r.netIncurredLoss / r.poolPremium);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

ratios.sort((a, b) => a - b);
const n = ratios.length;
const quantile = (p: number) => ratios[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
// Share of years the funding COVERS the loss, i.e. ratio <= multiplier.
const coverage = (mult: number) => ratios.filter(x => x <= mult).length / n;

console.log('=== PROPERTY CLF BASIS ERROR — the label against what is delivered ===');
console.log(`${GAMES} solo games x ${YEARS} years = ${n.toLocaleString()} line-years, all defaults (layer placed, no aggregate)\n`);
console.log(`  netIncurredLoss / poolPremium:  median ${quantile(0.5).toFixed(4)}   mean ${(ratios.reduce((a, b) => a + b, 0) / n).toFixed(4)}`);
console.log(`  p10 ${quantile(0.1).toFixed(3)}   p25 ${quantile(0.25).toFixed(3)}   p75 ${quantile(0.75).toFixed(3)}   p90 ${quantile(0.9).toFixed(3)}   p99 ${quantile(0.99).toFixed(3)}\n`);

console.log('  labelled   table CLF   DELIVERS   error (pp)   implied CLF for the label   dollar error');
const stops = Object.keys(FUNDING_CLF_TABLE).map(Number).sort((a, b) => a - b);
let worstPP = 0, defaultPP = 0;
for (const stop of stops) {
  const clf = FUNDING_CLF_TABLE[stop];
  const delivered = coverage(clf);
  const errPP = (delivered - stop) * 100;
  const implied = quantile(stop);
  const dollarErr = (clf / implied - 1) * 100;
  if (Math.abs(errPP) > Math.abs(worstPP)) worstPP = errPP;
  if (Math.abs(stop - 0.60) < 1e-9) defaultPP = errPP;
  console.log(`   ${(stop * 100).toFixed(0).padStart(4)}%     ${clf.toFixed(3).padStart(7)}    ${(delivered * 100).toFixed(1).padStart(6)}%   ${(errPP >= 0 ? '+' : '')}${errPP.toFixed(1).padStart(6)}       ${implied.toFixed(3).padStart(9)}              ${(dollarErr >= 0 ? '+' : '')}${dollarErr.toFixed(1)}%`);
}

console.log('\n  --- what this means ---');
console.log(`  AT THE DEFAULT 60% STOP: the table says 1.000 and delivers ${(coverage(1.0) * 100).toFixed(1)}%,`);
console.log(`  an error of ${defaultPP >= 0 ? '+' : ''}${defaultPP.toFixed(1)}pp. The DOLLARS are exactly right there regardless —`);
console.log('  1.000x is the identity on any basis — so this is a mislabelling, not an');
console.log('  overcharge or an undercharge. It is what the funding-consequence panel and');
console.log('  the Decisions slider tell the player they are buying.');
console.log(`\n  WORST STOP: ${worstPP >= 0 ? '+' : ''}${worstPP.toFixed(1)}pp.`);
console.log('  fab85e4 measured the same defect at ~5.5pp on WC and GL (their 60% stop');
console.log('  delivering 54.3% and 54.7%) before their tables were re-derived on the');
console.log('  retained distribution. Property has no derived table at all, so it carries');
console.log('  BOTH that basis error AND whatever gap there is between the real pool\'s');
console.log('  reference chart and this model\'s Property book — the two are not separable');
console.log('  from this measurement alone, and a derived table corrects them together.');
console.log('\nDONE — reported, not gated.');
