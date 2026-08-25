// DERIVATION of the static CLF tables, MEASURED FROM THE ENGINE ITSELF.
//
// Run:  npx tsx scripts/diagnostics/clf-table-derive.ts
//       GAMES=2000 npx tsx scripts/diagnostics/clf-table-derive.ts
//
// ============================================================================
// WHY THIS IS A BACKTEST AND NOT A MONTE CARLO.
//
// The previous grids were derived from a separate Monte Carlo of the annual
// loss distribution and then interpolated at runtime. Measured against the
// engine, WC's over-delivered at EVERY stop by about +3.5pp — a mismatch
// between the grid's model of the draw and the draw itself. Deriving from a
// second model and validating against the engine is exactly what produced that.
//
// This measures the engine. The pool runs at ALL-DEFAULT decisions, and for
// every line-year the realised retained loss is divided by the retained loss
// that was FUNDED. The percentiles of that ratio ARE the table, so any
// mismatch between model and engine is absorbed by construction — there is no
// model left to mismatch.
//
// ⚠ NO CIRCULARITY. At all-defaults fundingAtExpected is true, so CLF is pinned
// to exactly 1.000 and the grid is never consulted. The derivation run
// therefore does not depend on the table it produces.
//
// ============================================================================
// THE RATIO, AND WHY IT IS THIS ONE.
//
//   ratio = netIncurredLoss / poolPremium
//
// DENOMINATOR: at CLF 1.000 the pool premium IS the expected retained loss.
// Since fab85e4, poolPremium = (grossExpected - expectedCeded) x CLF, so at
// defaults it equals E[retained] exactly — asserted in funding-basis-check.
// Using the published poolPremium rather than reconstructing E[retained] keeps
// the denominator identical to the one the CLF will actually multiply.
//
// NUMERATOR: netIncurredLoss, because that is the loss the P&L charges against
// the premium — underwritingIncome = poolPremium - netIncurredLoss is an exact
// identity at defaults. So "adequate at stop p" means precisely "underwriting
// income is non-negative p% of the time", which is the question the funding
// slider is asking.
//
// ⚠ NOT netUltimateLoss, and on WC the two genuinely differ. WC's
// grossUltimateLoss is the CALENDAR-year REPORTED loss (its own header says
// so): it carries prior-year emergence and excludes this year's delayed
// claims. netIncurredLoss is paid plus reserve movement, which is the
// accident-year view the premium is set against. Both are reported below so the
// gap is visible rather than assumed away; GL has no IBNR so they coincide
// there, which doubles as a check that the distinction is being read correctly.
//
// ============================================================================
// SAMPLE AND UNCERTAINTY. Line-years within a game are NOT independent — the
// book persists, and so does surplus. Confidence intervals are therefore a
// BLOCK bootstrap resampling whole GAMES with replacement, never individual
// line-years, which would understate the interval at every stop.
//
// ============================================================================
// ⚠ RUN THIS TWICE. THE TABLE IS SELF-REFERENTIAL.
//
// Installing the table changes the engine it was measured from, via the 90%
// stop: reserveMarginCLF reads it, the Required Reserve Margin scales with it,
// and runPriorHistory accepted a pre-game only if the opening surplus landed
// inside OPENING_MULTIPLE_BAND x that margin. Measured, not assumed — the first
// pass gave a WC crossing of 49.9% and re-deriving with that table installed
// gave 47.2%.
//
// ⚠ THE LINK IS NOW CUT: the pre-game tests the opening against PREMIUM
// (OPENING_SURPLUS_TO_PREMIUM_BAND), so the 90% stop no longer reaches the
// opening surplus. Expect ONE pass to converge. Run it twice anyway and check —
// the cost is one run, and this loop is exactly the kind that comes back.
//
// So: derive, install, DERIVE AGAIN, and only ship once two consecutive passes
// agree. Anything else ships a table calibrated to an engine that no longer
// exists. GL barely moves between passes (68.8% -> 68.6% at the time); WC does, because its
// crossing sits where the density is highest and small shifts in the ratio
// distribution move it further.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SeededRandom } from '../../src/utils/random';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 2000);
const YEARS = 10;
const BOOT = 400;
const STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
// Linear-interpolated quantile on the sorted sample.
function q(sorted: number[], p: number): number {
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

interface LineYear { ratio: number; ratioUlt: number; members: number; year: number }

function derive(line: CoverageLine) {
  const LINES: CoverageLine[] = [line];
  const byGame: LineYear[][] = [];
  const t0 = Date.now();

  for (let g = 0; g < GAMES; g++) {
    const id = `CLFD${line}${g}`;
    const inst = generateGameInstance(id, 1_700_000 + g * 7013);
    const setup = { poolName: 'D', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    } as never as GameState;
    const rows: LineYear[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
      if (r && r.poolPremium > 0) {
        rows.push({
          ratio: r.netIncurredLoss / r.poolPremium,
          ratioUlt: r.netUltimateLoss / r.poolPremium,
          members: r.activeMembers,
          year: y,
        });
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    byGame.push(rows);
    if ((g + 1) % 500 === 0) console.log(`    ...${g + 1}/${GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  const all = byGame.flat();
  const sorted = [...all.map(r => r.ratio)].sort((a, b) => a - b);
  const sortedUlt = [...all.map(r => r.ratioUlt)].sort((a, b) => a - b);

  // Block bootstrap over whole games.
  const rng = new SeededRandom(424242);
  const bootQ: number[][] = STOPS.map(() => []);
  for (let b = 0; b < BOOT; b++) {
    const sample: number[] = [];
    for (let i = 0; i < byGame.length; i++) {
      const gi = Math.min(byGame.length - 1, Math.floor(rng.next() * byGame.length));
      for (const r of byGame[gi]) sample.push(r.ratio);
    }
    sample.sort((a, b2) => a - b2);
    STOPS.forEach((p, k) => bootQ[k].push(q(sample, p)));
  }

  console.log(`\n=== ${line} — ${all.length.toLocaleString()} line-years from ${GAMES} games ` +
    `(${((Date.now() - t0) / 1000).toFixed(0)}s) ===`);
  console.log(`  median enrolled book ${[...all.map(r => r.members)].sort((a, b) => a - b)[Math.floor(all.length / 2)]} members`);
  console.log('\n  stop     CLF      95% CI (block bootstrap over games)      half-width   ultimate-basis');
  const table: number[] = [];
  STOPS.forEach((p, k) => {
    const v = q(sorted, p);
    table.push(v);
    const bs = [...bootQ[k]].sort((a, b) => a - b);
    const lo = bs[Math.floor(0.025 * (bs.length - 1))], hi = bs[Math.floor(0.975 * (bs.length - 1))];
    console.log(`  ${String(p).padStart(5)}   ${v.toFixed(4)}   [${lo.toFixed(4)}, ${hi.toFixed(4)}]` +
      `${' '.repeat(22)}${((hi - lo) / 2).toFixed(4)}   ${q(sortedUlt, p).toFixed(4)}`);
  });

  // THE CROSSING: the percentile at which the ratio reaches 1.000, i.e. the
  // share of line-years in which the funded amount covered the loss at CLF
  // 1.000. This is what "Expected" delivers.
  const crossing = all.filter(r => r.ratio <= 1).length / all.length;
  const crossingUlt = all.filter(r => r.ratioUlt <= 1).length / all.length;
  const cBoot: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    let hit = 0, n = 0;
    for (let i = 0; i < byGame.length; i++) {
      const gi = Math.min(byGame.length - 1, Math.floor(rng.next() * byGame.length));
      for (const r of byGame[gi]) { n++; if (r.ratio <= 1) hit++; }
    }
    cBoot.push(hit / n);
  }
  cBoot.sort((a, b) => a - b);
  console.log(`\n  CROSSING (where drawn/funded = 1.000, i.e. what "Expected" delivers):`);
  console.log(`    incurred basis ${(crossing * 100).toFixed(1)}%  ` +
    `95% CI [${(cBoot[Math.floor(0.025 * (BOOT - 1))] * 100).toFixed(1)}%, ${(cBoot[Math.floor(0.975 * (BOOT - 1))] * 100).toFixed(1)}%]`);
  console.log(`    ultimate basis ${(crossingUlt * 100).toFixed(1)}%`);
  console.log(`    mean ratio ${mean(all.map(r => r.ratio)).toFixed(4)}, median ${q(sorted, 50).toFixed(4)}`);

  // Is the early-game IBNR build distorting WC's early years?
  console.log('\n  crossing by year (is the ratio stationary, or is the early game different?)');
  const cells: string[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const yr = all.filter(r => r.year === y);
    cells.push(`Y${y} ${((yr.filter(r => r.ratio <= 1).length / yr.length) * 100).toFixed(0)}%`);
  }
  console.log('    ' + cells.join('  '));

  console.log(`\n  TABLE LITERAL for src/data/clfTables.ts:`);
  console.log(`  ${line}: [${table.map(v => v.toFixed(4)).join(', ')}],`);
  return { table, crossing };
}

// ============================================================================
// WHAT THE STATIC TABLES LEAVE WITHOUT A CONSUMER — reported, NOT deleted here.
//
// After wiring clfTables.ts into simulationEngine and fundingConsequence, a grep
// for live imports finds ZERO src consumers of any of the following. The only
// remaining references anywhere in src/ are prose in comments.
//
//   src/utils/wcLossDistribution.ts   computeWcClf, wcClfCrossingPercentile,
//                                     wcAggregateCumulants
//   src/utils/glLossDistribution.ts   computeGlClf, glClfCrossingPercentile,
//                                     glAggregateCumulants
//   src/data/wcClfGrid.ts             WC_CLF_GRID, WC_CLF_PERCENTILE_STOPS
//   src/data/glClfGrid.ts             GL_CLF_GRID, GL_CLF_PERCENTILE_STOPS
//
// ⚠ THE CUMULANTS MODULES GO WITH THEM. wcAggregateCumulants and
// glAggregateCumulants were only ever called from inside their own files, by the
// CLF and crossing functions above. They are NOT what the aggregate stop-loss
// uses — that is retainedRiskMoments in towerMoments.ts, a different module that
// is untouched and still live. Checked explicitly, because "the cumulants module
// must be load-bearing for the aggregate" is the plausible-sounding assumption
// that would wrongly save it.
//
// Three diagnostic scripts still import them and would need retiring or
// rewriting alongside: funding-expected-check.ts, wc-clf-grid-derive.ts,
// gl-clf-grid-derive.ts.
//
// ⚠ funding-expected-check.ts NOW TESTS CODE THE ENGINE NO LONGER RUNS. It still
// passes, which is the problem: it asserts crossings of 67.0% (WC) and 72.2%
// (GL) read off the retired grids, while the shipped path crosses at 49.9% and
// 68.8%. A green check reporting numbers the game does not use is worse than a
// deleted one.
// ============================================================================

console.log(`=== STATIC CLF TABLE DERIVATION — ${GAMES} games x ${YEARS} years per line, all defaults ===`);
console.log('Each line run SOLO, so inter-line loans cannot couple the two derivations.');
console.log(`Stops: ${STOPS.join(', ')}\n`);
// LINES env override so one line can be re-derived on its own — the
// convergence pass after installing a table only needs the line that moved.
const ONLY = (process.env.LINES ?? 'WC,GL,Property').split(',').map(x => x.trim()) as CoverageLine[];
for (const l of ONLY) derive(l);
console.log('\nDONE — derivation only. Nothing written; copy the literals by hand.');
