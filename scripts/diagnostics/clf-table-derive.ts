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
// (OPENING_SURPLUS_BAND), so the 90% stop no longer reaches the
// opening surplus. Expect ONE pass to converge. Run it twice anyway and check —
// the cost is one run, and this loop is exactly the kind that comes back.
//
// So: derive, install, DERIVE AGAIN, and only ship once two consecutive passes
// agree. Anything else ships a table calibrated to an engine that no longer
// exists. GL barely moves between passes (68.8% -> 68.6% at the time); WC does, because its
// crossing sits where the density is highest and small shifts in the ratio
// distribution move it further.

import { NO_NEW_BUSINESS } from '../../src/utils/newBusinessAppetite';
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

// ============================================================================
// BAND MODE — WHICH BOOK TO DERIVE AT.
//
//   BANDS=1 GAMES=500 npx tsx scripts/diagnostics/clf-table-derive.ts
//
// ⚠ WHY THIS EXISTS NOW. The shipped table has no book-size dimension, and the
// file says why: "Since the membership equilibrium fix the enrolled book holds
// near 62 members". That fix is deleted. The book is an outcome now and the
// derivation sample itself has moved — measured, the solo run's median enrolled
// book is 87-93, not 62. So the question "which book is the table derived at"
// has an answer that changed without anyone choosing it.
//
// ⚠ AND BOOK SIZE IS CONFOUNDED WITH BOOK AGE IN A SINGLE TRAJECTORY, WHICH IS
// THE TRAP. At all-defaults the book climbs monotonically — WC runs 76 -> 92
// across the ten years — so "small book" is almost exactly "early year", and any
// difference between bands could be size OR age. Deriving from bands of one
// trajectory would measure the two together and attribute it to size.
//
// The appetite tiers break the confound. They produce genuinely different books
// AT THE SAME YEAR — below 0.75 shrinks while Accept All grows — so banding
// across arms gives book sizes that are not year labels. fundingAtExpected is
// still true on every arm, so CLF is still pinned to 1.000 and the derivation is
// still non-circular.
//
// This mode therefore samples ALL FOUR appetite arms, reports the ratio banded
// by book size WITH YEAR HELD so the confound is visible rather than assumed
// away, derives a candidate table from each band, and backtests every candidate
// across the whole range.
// ============================================================================

const BAND_MODE = process.env.BANDS === '1';
/** Evaluation and derivation bands, on enrolled members. */
const BOOK_BANDS: [number, number, string][] = [
  [0, 72, 'small ~64'], [72, 88, 'mid ~80'], [88, 999, 'large ~97'],
];
const bandOf = (n: number) => BOOK_BANDS.findIndex(([lo, hi]) => n >= lo && n < hi);

interface BandRow { ratio: number; members: number; year: number; arm: string; game: string }

// ⚠ POOLED=1 RUNS ALL THREE LINES IN ONE GAME, WHICH IS WHAT THE PLAYER PLAYS.
// The solo default exists so inter-line loans cannot couple two lines'
// derivations. That protects the derivation's internal independence and it costs
// something the header above does not admit to: a solo game is not a population
// the game ever produces, so "there is no model left to mismatch" is not quite
// true — running one line alone IS a model choice. clf-label-backtest-check
// evaluates the shipped table on pooled games, so solo-derived tables are being
// marked against a different population from the one they were fitted on. This
// switch is what makes the size of that gap measurable instead of arguable.
//
// ⚠ MEASURED, AND IT IS SMALL — which is the reason the solo default stays. WC
// at 400 games x 4 arms, solo against pooled, mid band:
//
//              10th     50th     90th    99th    crossing   worst cross-band
//   solo     0.7913   1.0064   1.2776  1.6030      48.8%      -2.7 / +2.2
//   pooled   0.7944   1.0026   1.2800  1.6466      49.3%      -4.0 / +1.5
//
// Every working stop agrees to within 0.5%, and the two disagree most at the
// 99th (2.7%), where a pooled game's inter-line loan can keep a line solvent
// through a year a solo game would not. So the solo simplification costs
// something real in the far tail and nothing in the range a slider can reach.
// It is recorded rather than removed because the independence it buys between
// lines is worth more than 0.5% at the median.
const POOLED = process.env.POOLED === '1';

function collectAcrossArms(line: CoverageLine): BandRow[] {

// ⚠ FIVE ARMS NOW, AND THE FIFTH IS THE SHIPPED DEFAULT. NO_NEW_BUSINESS was
// added when WC was re-derived at the small band: the default appetite writes
// nobody, so the book is FROZEN at its opening ~62 for the whole game, and none
// of the other four arms produces that. Without it the derivation sampled four
// populations a player has to opt into and none that a player who touches
// nothing actually plays.
//
// ⚠ IT IS ADDED TO clf-table-derive AND clf-label-backtest-check TOGETHER, AND
// THAT COUPLING IS LOAD-BEARING. The backtest judges each table against the
// population it was fitted on; adding an arm to one file alone would score a
// table on a book it never saw. Change one, change both.
  const arms: (number | null)[] = [null, 1.50, 1.00, 0.75, NO_NEW_BUSINESS];
  const active: CoverageLine[] = POOLED ? ['WC', 'GL', 'Property'] : [line];
  const out: BandRow[] = [];
  for (const appetite of arms) {
    for (let g = 0; g < GAMES; g++) {
      const id = `CLFB${POOLED ? 'P' : line}${appetite ?? 'A'}${g}`;
      const inst = generateGameInstance(id, 2_900_000 + g * 7013);
      const setup = { poolName: 'B', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: active };
      const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
      let gs = {
        setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      } as never as GameState;
      for (let y = 1; y <= YEARS; y++) {
        const d = defaultDecisionSet(y);
        // Every ACTIVE line takes the arm, not just the one being collected:
        // appetite is a per-line control but a player setting a strict bar sets
        // it across the pool, and in POOLED mode leaving the other two on Accept
        // All would put this line's small book next to two growing ones.
        for (const l of active) d.byLine[l].newBusinessAppetite = appetite;
        const pr = processYear(gs, d);
        const r = (pr.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
        if (r && r.poolPremium > 0) {
          out.push({
            ratio: r.netIncurredLoss / r.poolPremium,
            members: r.activeMembers, year: y,
            arm: appetite === null ? 'all' : appetite.toFixed(2),
            game: id,
          });
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: pr.updatedPoolState, lockedResults: [...gs.lockedResults, pr.result] };
      }
    }
  }
  return out;
}

/** Share of `rows` whose ratio falls at or below `clf` — what the label delivers. */
const delivered = (rows: BandRow[], clf: number) =>
  (100 * rows.filter(r => r.ratio <= clf).length) / Math.max(1, rows.length);

function bandAnalysis(line: CoverageLine) {
  const t0 = Date.now();
  const rows = collectAcrossArms(line);
  console.log(`
${'='.repeat(94)}`);
  console.log(`${line} — ${rows.length.toLocaleString()} line-years across 4 appetite arms `
    + `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log('='.repeat(94));

  // --- 1. the confound, shown rather than assumed away ---
  console.log('\n--- BOOK SIZE vs BOOK AGE: median ratio by band, with year held ---');
  console.log('  If the bands differ only because small books are early years, the columns move');
  console.log('  down each row and the rows do not differ within a year. They do differ.\n');
  console.log('  year    ' + BOOK_BANDS.map(([, , n]) => n.padStart(14)).join('') + '      n per cell');
  for (const y of [2, 4, 6, 8, 10]) {
    const cells: string[] = []; const ns: number[] = [];
    for (let b = 0; b < BOOK_BANDS.length; b++) {
      const cell = rows.filter(r => r.year === y && bandOf(r.members) === b);
      ns.push(cell.length);
      cells.push(cell.length >= 30
        ? q([...cell.map(r => r.ratio)].sort((a, c) => a - c), 50).toFixed(3).padStart(14)
        : '—'.padStart(14));
    }
    console.log(`  ${String(y).padStart(4)}    ${cells.join('')}      ${ns.join(' / ')}`);
  }

  // --- 2. candidate tables, one per band ---
  console.log('\n--- CANDIDATE TABLES, one per book band ---');
  // `band` is carried explicitly rather than recovered by indexOf: a band that
  // falls under the 200-row floor is skipped, after which the candidate's
  // position in the array no longer equals its band index.
  const candidates: { band: number; name: string; table: number[]; n: number; medianBook: number }[] = [];
  for (let b = 0; b < BOOK_BANDS.length; b++) {
    const cell = rows.filter(r => bandOf(r.members) === b);
    if (cell.length < 200) continue;
    const sortedC = [...cell.map(r => r.ratio)].sort((a, c) => a - c);
    const books = [...cell.map(r => r.members)].sort((a, c) => a - c);
    candidates.push({
      band: b, name: BOOK_BANDS[b][2], table: STOPS.map(pp => q(sortedC, pp)),
      n: cell.length, medianBook: books[Math.floor(books.length / 2)],
    });
  }
  for (const c of candidates) {
    console.log(`  ${c.name.padEnd(12)} n=${String(c.n).padStart(6)}  median book ${String(c.medianBook).padStart(3)}  `
      + `crossing ${delivered(rows.filter(r => bandOf(r.members) === c.band), 1).toFixed(1)}%`);
    console.log(`    [${c.table.map(v => v.toFixed(4)).join(', ')}]`);
  }

  // --- 3. the backtest: every candidate against every band ---
  console.log('\n--- LABEL ERROR: what each candidate DELIVERS at each book size ---');
  console.log('  Error in percentage points at the stop. Positive = over-funds (delivers a higher');
  console.log('  percentile than labelled). The tolerance that matters is 5pp, per stop, per band.\n');
  const KEY_STOPS = [25, 50, 60, 75, 90, 95];
  console.log('  candidate      evaluated on   ' + KEY_STOPS.map(x => `${x}%`.padStart(8)).join('') + '     worst');
  for (const c of candidates) {
    for (let b = 0; b < BOOK_BANDS.length; b++) {
      const cell = rows.filter(r => bandOf(r.members) === b);
      if (cell.length < 200) continue;
      const errs = KEY_STOPS.map(st => delivered(cell, c.table[STOPS.indexOf(st)]) - st);
      const worst = errs.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
      console.log(`  ${c.name.padEnd(14)} ${BOOK_BANDS[b][2].padEnd(13)}  `
        + errs.map(e => `${e >= 0 ? '+' : ''}${e.toFixed(1)}`.padStart(8)).join('')
        + `   ${Math.abs(worst) > 5 ? '!' : ' '}${worst >= 0 ? '+' : ''}${worst.toFixed(1)}`);
    }
    // pooled, exposure-weighted by how many line-years actually occur in each band
    const errsAll = KEY_STOPS.map(st => delivered(rows, c.table[STOPS.indexOf(st)]) - st);
    const worstAll = errsAll.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
    console.log(`  ${c.name.padEnd(14)} ${'POOLED'.padEnd(13)}  `
      + errsAll.map(e => `${e >= 0 ? '+' : ''}${e.toFixed(1)}`.padStart(8)).join('')
      + `   ${Math.abs(worstAll) > 5 ? '!' : ' '}${worstAll >= 0 ? '+' : ''}${worstAll.toFixed(1)}\n`);
  }

  // --- 4. where the line-years actually are ---
  const counts = BOOK_BANDS.map((_, b) => rows.filter(r => bandOf(r.members) === b).length);
  console.log(`  line-years per band: ${BOOK_BANDS.map(([, , n], i) =>
    `${n} ${((100 * counts[i]) / rows.length).toFixed(0)}%`).join('   ')}`);
}

// ============================================================================
// BAND_DERIVE=<n> — produce a SHIPPABLE table from one band, with CIs.
//
// The band analysis above says which band to derive at; this writes that band's
// table out at full precision with a block bootstrap over whole games, which is
// the same interval the ordinary derivation reports and the reason the band rows
// carry their game id.
//
// ⚠ THE BLOCK IS THE GAME, NOT THE BAND-YEAR. Resampling band rows individually
// would treat ten years of one pool as ten independent observations; they are
// not, because a pool's book size and its loss experience both persist. So a
// bootstrap draw takes a whole game and then keeps whichever of its years fall
// in the band — which also means the band's row count varies between draws,
// exactly as it would between real pools.
// ============================================================================
function bandDerive(line: CoverageLine, band: number) {
  const t0 = Date.now();
  const rows = collectAcrossArms(line);
  const byGame = new Map<string, BandRow[]>();
  for (const r of rows) {
    const k = `${r.arm}|${r.game}`;
    const list = byGame.get(k); if (list) list.push(r); else byGame.set(k, [r]);
  }
  const blocks = [...byGame.values()];
  const cell = rows.filter(r => bandOf(r.members) === band);
  const sorted = [...cell.map(r => r.ratio)].sort((a, b) => a - b);
  const books = [...cell.map(r => r.members)].sort((a, b) => a - b);

  const rng = new SeededRandom(818181);
  const bootQ: number[][] = STOPS.map(() => []);
  for (let b = 0; b < BOOT; b++) {
    const sample: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const gi = Math.min(blocks.length - 1, Math.floor(rng.next() * blocks.length));
      for (const r of blocks[gi]) if (bandOf(r.members) === band) sample.push(r.ratio);
    }
    if (sample.length === 0) continue;
    sample.sort((a, c) => a - c);
    STOPS.forEach((p, k) => bootQ[k].push(q(sample, p)));
  }

  console.log(`\n=== ${line} — derived at the ${BOOK_BANDS[band][2]} band ===`);
  console.log(`  ${cell.length.toLocaleString()} line-years of ${rows.length.toLocaleString()} `
    + `across ${blocks.length.toLocaleString()} games, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  enrolled book in the band: p10 ${books[Math.floor(0.1 * books.length)]}, `
    + `median ${books[Math.floor(0.5 * books.length)]}, p90 ${books[Math.floor(0.9 * books.length)]}`);
  console.log(`  crossing (share of band line-years with ratio <= 1.000): `
    + `${(100 * cell.filter(r => r.ratio <= 1).length / cell.length).toFixed(1)}%`);
  console.log('\n  stop     CLF      95% CI (block bootstrap over games)   half-width');
  const table: number[] = [];
  STOPS.forEach((p, k) => {
    const v = q(sorted, p);
    table.push(v);
    const bs = [...bootQ[k]].sort((a, b) => a - b);
    const lo = bs[Math.floor(0.025 * (bs.length - 1))], hi = bs[Math.floor(0.975 * (bs.length - 1))];
    console.log(`  ${String(p).padStart(5)}   ${v.toFixed(4)}   [${lo.toFixed(4)}, ${hi.toFixed(4)}]`
      + `${' '.repeat(19)}${((hi - lo) / 2).toFixed(4)}`);
  });
  console.log(`\n  stops: [${STOPS.join(', ')}],`);
  console.log(`  clf: [${table.map(v => v.toFixed(4)).join(', ')}],`);

  // What this table delivers at EVERY band, which is the number that decided it.
  console.log('\n  delivered error by band (pp):');
  const KEY = [25, 50, 60, 75, 90, 95];
  console.log('    evaluated on   ' + KEY.map(x => `${x}%`.padStart(8)).join('') + '     worst');
  for (let b = 0; b < BOOK_BANDS.length; b++) {
    const c2 = rows.filter(r => bandOf(r.members) === b);
    if (c2.length < 200) continue;
    const errs = KEY.map(st => delivered(c2, table[STOPS.indexOf(st)]) - st);
    const w = errs.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
    console.log(`    ${BOOK_BANDS[b][2].padEnd(13)}  ` + errs.map(e => `${e >= 0 ? '+' : ''}${e.toFixed(1)}`.padStart(8)).join('')
      + `   ${Math.abs(w) > 5 ? '!' : ' '}${w >= 0 ? '+' : ''}${w.toFixed(1)}`);
  }
}

if (process.env.BAND_DERIVE) {
  const band = Number(process.env.BAND_DERIVE);
  console.log(`=== BAND-TARGETED DERIVATION — band ${band} (${BOOK_BANDS[band][2]}), `
    + `${GAMES} games x ${YEARS} years x 4 appetite arms ===`);
  const only = (process.env.LINES ?? 'WC,GL,Property').split(',').map(x => x.trim()) as CoverageLine[];
  for (const l of only) bandDerive(l, band);
  console.log('\nDONE — nothing written. Paste into src/data/clfTables.ts by hand.');
  process.exit(0);
}

if (BAND_MODE) {
  console.log('=== WHICH BOOK TO DERIVE AT — band analysis across the appetite arms ===');
  const only = (process.env.LINES ?? 'WC,GL,Property').split(',').map(x => x.trim()) as CoverageLine[];
  for (const l of only) bandAnalysis(l);
  console.log('\nDONE — band analysis only. Nothing written.');
  process.exit(0);
}

console.log(`=== STATIC CLF TABLE DERIVATION — ${GAMES} games x ${YEARS} years per line, all defaults ===`);
console.log('Each line run SOLO, so inter-line loans cannot couple the two derivations.');
console.log(`Stops: ${STOPS.join(', ')}\n`);
// LINES env override so one line can be re-derived on its own — the
// convergence pass after installing a table only needs the line that moved.
const ONLY = (process.env.LINES ?? 'WC,GL,Property').split(',').map(x => x.trim()) as CoverageLine[];
for (const l of ONLY) derive(l);
console.log('\nDONE — derivation only. Nothing written; copy the literals by hand.');
