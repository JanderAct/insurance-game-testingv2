// PROPERTY'S CLF CURVE — is the labelled confidence level the one delivered?
//
// Run: npx tsx scripts/diagnostics/property-clf-basis-report.ts
//      GAMES=3000 npx tsx scripts/diagnostics/property-clf-basis-report.ts
//
// REPORTS. Changes nothing, gates nothing.
//
// Written to SIZE the basis error while Property was still on the generic
// FUNDING_CLF_TABLE; it now VALIDATES the derived table that replaced it, and
// reads both curves side by side so the correction stays legible.
//
// ⚠ OUT-OF-SAMPLE BY CONSTRUCTION, WHICH IS WHY IT IS WORTH RUNNING AT ALL. A
// derived table is the percentiles of this exact statistic, so measuring it on
// the derivation's own sample would be a tautology. This draws a DIFFERENT
// population (its own seeds and game count from clf-table-derive's), so a small
// residual is genuine agreement and a large one means the table has gone stale
// against the engine.
//
// ============================================================================
// THE DEFECT, AS IT STOOD, STATED PRECISELY.
//
// FUNDING_CLF_TABLE maps a confidence LEVEL to a multiplier on expected loss:
// at level p, funding = CLF(p) x expected loss is asserted to cover the year's
// loss with probability p. It is the real pool's reference chart, derived on a
// GROSS annual loss distribution.
//
// Since dbd9138 Property's pool premium funds NET expected loss — gross less
// what the occurrence layer is expected to cede. So a gross-basis multiplier was
// being applied to a net base, and the confidence level actually delivered was
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
import { STATIC_CLF_TABLE, hasStaticClf, crossingOf } from '../../src/data/clfTables';
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

// ⚠ NOW MEASURES THE LIVE CURVE, WHICHEVER IT IS. This read FUNDING_CLF_TABLE
// unconditionally, which was right while that was the curve Property priced
// against. Property has its own derived table now, so reading the generic one
// would report a corrected defect as though it were still live — the exact
// class of stale-diagnostic failure clf-table-derive's own header warns about
// ("a green check reporting numbers the game does not use is worse than a
// deleted one"). Both curves are printed so the correction stays visible.
const live = hasStaticClf(LINE) ? STATIC_CLF_TABLE[LINE] : null;
const liveClfAt = (stop: number) => {
  if (!live) return FUNDING_CLF_TABLE[stop];
  const { stops: ss, clf: cc } = live;
  const t = stop * 100, last = ss.length - 1;
  if (t <= ss[0]) return cc[0];
  if (t >= ss[last]) return cc[last];
  for (let i = 0; i < last; i++) if (t >= ss[i] && t <= ss[i + 1]) {
    const w = ss[i + 1] === ss[i] ? 0 : (t - ss[i]) / (ss[i + 1] - ss[i]);
    return cc[i] + w * (cc[i + 1] - cc[i]);
  }
  return cc[last];
};
console.log(`  LIVE CURVE: ${live ? `${LINE}'s own DERIVED table, crossing ${(crossingOf(live) * 100).toFixed(1)}%` : 'the generic FUNDING_CLF_TABLE (no derived table)'}`);
console.log('  (the generic table is shown alongside, as the basis this replaced)\n');
console.log('  labelled   LIVE CLF   DELIVERS   error (pp)   implied CLF   generic CLF   generic delivers');
const stops = Object.keys(FUNDING_CLF_TABLE).map(Number).sort((a, b) => a - b);
let worstPP = 0, defaultPP = 0;
for (const stop of stops) {
  const clf = liveClfAt(stop);
  const generic = FUNDING_CLF_TABLE[stop];
  const delivered = coverage(clf);
  const errPP = (delivered - stop) * 100;
  const implied = quantile(stop);
  if (Math.abs(errPP) > Math.abs(worstPP)) worstPP = errPP;
  if (Math.abs(stop - 0.60) < 1e-9) defaultPP = errPP;
  console.log(`   ${(stop * 100).toFixed(0).padStart(4)}%    ${clf.toFixed(4).padStart(8)}    ${(delivered * 100).toFixed(1).padStart(6)}%   ${(errPP >= 0 ? '+' : '')}${errPP.toFixed(1).padStart(6)}     ${implied.toFixed(4).padStart(9)}     ${generic.toFixed(3).padStart(7)}        ${(coverage(generic) * 100).toFixed(1).padStart(6)}%`);
}

console.log('\n  --- what this means ---');
console.log(`  WORST |error| on the LIVE curve: ${Math.abs(worstPP).toFixed(1)}pp (at the 60% stop: ${defaultPP >= 0 ? '+' : ''}${defaultPP.toFixed(1)}pp).`);
console.log('  A derived table should read near zero at every stop BY CONSTRUCTION — it is');
console.log('  the percentiles of this very statistic — so a large residual here means the');
console.log('  table has gone stale against the engine, not that the basis is wrong.');
console.log('');
console.log('  THE GENERIC COLUMN IS THE DEFECT THIS REPLACED, kept as the record: a');
console.log('  gross-basis real-pool chart applied to a net-funded line. Its 60% stop');
console.log(`  delivers ${(coverage(FUNDING_CLF_TABLE[0.60]) * 100).toFixed(1)}% against the 60% it claims — fab85e4 measured the same`);
console.log('  defect at ~5.5pp on WC and GL (54.3% and 54.7%) before their own tables');
console.log('  were derived. Property carried both that basis error and the gap between');
console.log('  the reference chart and this model\'s Property book; the derived table');
console.log('  corrects them together.');
console.log('\nDONE — reported, not gated.');
