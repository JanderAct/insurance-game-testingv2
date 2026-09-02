// WC BEHAVIOUR OVER A FULL GAME — what a player actually experiences.
//
// Run: npx tsx scripts/diagnostics/wc-behaviour-report.ts
//
// CONFIGURATION, fixed: WC only, 10-year games, NO reinsurance (every layer
// declined, no aggregate), CLF 1.000, 50 games at default decisions otherwise.
// Reinsurance off so the loss ratio is a clean read on the pricing/draw pair
// rather than on the tower.
//
// ⚠ RECONSTRUCTED. An earlier run of this diagnostic was never committed and its
// worktree is gone, so this script is rebuilt from the reported configuration and
// its outputs. IT IS THEREFORE ONLY VALID AS A BEFORE/AFTER COMPARISON RUN ON
// ITSELF at two commits — not against figures produced by the lost original. The
// prior-run values are printed alongside for orientation and labelled as such.
//
// EVERY FIGURE HERE IS ENROLLED BASIS. The pool's own book, not the 200-member
// marketplace. Mixing the two is this project's most repeated error.
//
// REPORTS, IT DOES NOT GATE. Nothing here calls a pass/fail: the quantities are
// dollar-weighted means over a book whose blended CV is 11-15, and finding 26's
// rule is that those are reported with an interval, never gated. The gates live
// in wc-severity-rebuild-check (counts, capped means, Little's Law).

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const GAMES = 50;
const YEARS = 10;
const LINES: CoverageLine[] = ['WC'];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const ci95 = (xs: number[]) => 1.96 * sd(xs) / Math.sqrt(xs.length);
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const seedOf = (id: string) => { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; };
const SEEDS = Array.from({ length: GAMES }, (_, i) => (((i + 1) * 2654435761) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));

// Decisions: CLF 1.000, every reinsurance layer declined, no aggregate.
function decisions(y: number) {
  const d = defaultDecisionSet(y);
  const wc = d.byLine.WC;
  wc.fundingConfidenceLevel = 0.60;          // FUNDING_CLF_TABLE key for CLF 1.000 (a FRACTION, not a percent)
  wc.layersPlaced = REINSURANCE_TOWER.WC.map(() => false);
  wc.aggregateStopLevel = -1;
  return d;
}

interface GameOut {
  startSurplus: number;
  endSurplus: number;
  underwriting: number;      // summed underwritingIncome over the game
  investment: number;        // summed investmentIncome
  years: LineResultSet[];
}

const games: GameOut[] = [];
const t0 = Date.now();
for (const id of SEEDS) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'B', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: decisions(1), priorHistory,
  };
  const startSurplus = poolState.lines.WC.surplus;
  const rows: LineResultSet[] = [];
  let uw = 0, inv = 0;
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, decisions(y));
    const wc = p.result.byLine.WC!;
    rows.push(wc);
    uw += wc.underwritingIncome;
    inv += wc.investmentIncome;
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  games.push({ startSurplus, endSurplus: rows[YEARS - 1].endingSurplus, underwriting: uw, investment: inv, years: rows });
  if (games.length % 10 === 0) console.log(`  ...${games.length}/${GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

console.log(`\n=== WC BEHAVIOUR — ${GAMES} games x ${YEARS} years, WC only, no reinsurance, CLF 1.000 ===`);
console.log('ENROLLED BASIS throughout. Reported, not gated.\n');

// --- Q1 ---------------------------------------------------------------------
console.log('--- Q1. WHERE DOES SURPLUS GROWTH COME FROM? (multiples of STARTING surplus) ---');
{
  const uwX = games.map(g => g.underwriting / g.startSurplus);
  const invX = games.map(g => g.investment / g.startSurplus);
  const totX = games.map(g => (g.endSurplus - g.startSurplus) / g.startSurplus);
  const row = (label: string, xs: number[], prior: string) =>
    console.log(`  ${label.padEnd(22)} median ${q(xs, 0.5).toFixed(3).padStart(7)}x   mean ${mean(xs).toFixed(3).padStart(7)}x  (95% CI +/-${ci95(xs).toFixed(3)})   prior run: ${prior}`);
  row('underwriting', uwX, 'median +0.45x, mean +0.30x');
  row('investment income', invX, 'median +1.21x');
  row('total surplus growth', totX, '—');
  console.log(`  starting surplus mean ${fmt$(mean(games.map(g => g.startSurplus)))}, ending mean ${fmt$(mean(games.map(g => g.endSurplus)))}`);
}

// --- Q2 ---------------------------------------------------------------------
console.log('\n--- Q2. REALIZED COMBINED RATIO ---');
{
  const all = games.flatMap(g => g.years);
  const perGame = games.map(g => mean(g.years.map(r => r.combinedRatio)));
  const cr = mean(perGame);
  console.log(`  realized combined ratio: ${pct(cr)}  95% CI +/-${(ci95(perGame) * 100).toFixed(2)}pp across ${GAMES} games`);
  console.log(`    prior run 93.90%; expected-at-pricing 100.00% (0.8696 loss + 0.1304 expense)`);
  console.log(`  loss ratio ${pct(mean(games.map(g => mean(g.years.map(r => r.lossRatio)))))}   ` +
    `expense ratio ${pct(mean(games.map(g => mean(g.years.map(r => r.expenseRatio)))))}`);
  // By year, so a compounding gap is visible as a slope rather than an average.
  console.log('  by year (mean across games): combined / loss / drawn-over-expected');
  for (let y = 0; y < YEARS; y++) {
    const rows = games.map(g => g.years[y]);
    const drawnOverExpected = mean(rows.map(r => r.grossUltimateLoss / Math.max(r.expectedLoss, 1)));
    console.log(`    Y${String(y + 1).padStart(2)}  ${pct(mean(rows.map(r => r.combinedRatio))).padStart(8)}  ${pct(mean(rows.map(r => r.lossRatio))).padStart(8)}  ${drawnOverExpected.toFixed(4).padStart(8)}`);
  }
  void all;
}

// --- Q3 ---------------------------------------------------------------------
console.log('\n--- Q3. IS THE PRICE STILL FLAT? (the defect this run exists to check) ---');
{
  console.log('  year   pure premium/$100   rate/$100   change vs prior year');
  for (let y = 0; y < YEARS; y++) {
    const pp = mean(games.map(g => g.years[y].purePremiumPer100));
    const rt = mean(games.map(g => g.years[y].ratePer100));
    const prev = y === 0 ? null : mean(games.map(g => g.years[y - 1].purePremiumPer100));
    console.log(`  ${String(y + 1).padStart(4)}   ${pp.toFixed(4).padStart(16)}   ${rt.toFixed(4).padStart(9)}   ${prev === null ? '—' : `${((pp / prev - 1) * 100).toFixed(2)}%`}`);
  }
  const first = mean(games.map(g => g.years[0].purePremiumPer100));
  const last = mean(games.map(g => g.years[YEARS - 1].purePremiumPer100));
  console.log(`  Y1 -> Y${YEARS}: ${first.toFixed(4)} -> ${last.toFixed(4)}  (${((last / first - 1) * 100).toFixed(2)}%)`);
  console.log(`  member charge: ${fmt$(mean(games.map(g => g.years[0].totalMemberCharge)))} -> ${fmt$(mean(games.map(g => g.years[YEARS - 1].totalMemberCharge)))}`);

  // ⚠ A FALLING CHARGE MOVES MEMBERSHIP, and that is a consequence of pricing the
  // trend rather than a side effect to absorb. Reported so the channel is visible.
  console.log('  membership response — year   members   exposure$M   retention   satisfaction');
  for (const y of [1, 3, 5, 10]) {
    const rows = games.map(g => g.years[y - 1]);
    console.log(`                        ${String(y).padStart(4)}   ${mean(rows.map(r => r.activeMembers)).toFixed(1).padStart(7)}   ` +
      `${mean(rows.map(r => r.activeExposure)).toFixed(1).padStart(10)}   ${mean(rows.map(r => r.memberRetentionRate)).toFixed(3).padStart(9)}   ` +
      `${mean(rows.map(r => r.memberSatisfaction)).toFixed(2).padStart(12)}`);
  }
  console.log(`  market share Y1 ${pct(mean(games.map(g => g.years[0].marketShare)))} -> Y${YEARS} ${pct(mean(games.map(g => g.years[YEARS - 1].marketShare)))}`);
}

// --- Q4 ---------------------------------------------------------------------
// ⚠ Q4 (IBNR AND THE REPORT LAG) IS GONE, with the mechanic it measured. It
// reported IBNR/annual loss at Y10, Little's Law across games, and the
// unreported inventory count. None of those quantities exists any more.
//
// FOR THE RECORD, since this harness is where the figure came from: its last
// run read IBNR/annual loss 0.529 at Y10. That was measured with NO
// REINSURANCE (layersPlaced all false above) and IBNR is a NET reserve, so it
// is not comparable to the 0.409 measured at all-defaults with the full tower
// placed. Both were correct; they described different books.

// --- Q5 ---------------------------------------------------------------------
console.log('\n--- Q5. LOSS SHAPE AND THE TAIL ---');
{
  const perYear = games.flatMap(g => g.years.map(r => r.grossUltimateLoss));
  console.log(`  gross loss/yr: median ${fmt$(q(perYear, 0.5))}, p90 ${fmt$(q(perYear, 0.9))}, p99 ${fmt$(q(perYear, 0.99))}, max ${fmt$(Math.max(...perYear))}`);
  const largest = games.map(g => Math.max(...g.years.flatMap(r => (r.claims ?? []).map(c => c.grossUltimate))));
  console.log(`  largest claim in a game: median ${fmt$(q(largest, 0.5))}, p90 ${fmt$(q(largest, 0.9))}, max across all ${GAMES} games ${fmt$(Math.max(...largest))}`);
  console.log(`    prior run: median $8.27M, max across 50 games $55.8M — different quantities, both expected`);
  const over50 = games.flatMap(g => g.years.flatMap(r => (r.claims ?? []).filter(c => c.grossUltimate > 50e6))).length;
  const gameYears = GAMES * YEARS;
  console.log(`  claims over $50M (above the tower top): ${over50} in ${gameYears} enrolled game-years`);
  console.log(`    ENROLLED expectation ~1 per 436 yrs => ${(gameYears / 436).toFixed(2)} expected. (1 per 109 yrs is the FULL-MARKET rate.)`);
  // The bimodal on/off the previous run flagged as fixed: is any year at zero?
  const zeroYears = perYear.filter(x => x === 0).length;
  console.log(`  years with exactly zero loss (the old bimodal signature): ${zeroYears}/${gameYears}`);
}

console.log('\nDONE — reported, not gated. No parameter or baseline changed by this run.');
