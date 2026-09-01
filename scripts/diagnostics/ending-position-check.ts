// ============================================================================
// THE ENDING POSITION — arithmetic, pooling, the game-end boundary, and proof
// that disclosing it does not change it.
//
// Run:  npx tsx scripts/diagnostics/ending-position-check.ts
//
// ⚠ THE DEFICIENCY IS THE ONLY DERIVED FIGURE HERE AND IT READS ENGINE STATE, so
// the load-bearing assertion is that it READS rather than REACHES. A disclosure
// that moves the thing it discloses is not a disclosure, and the failure would
// be invisible from the panel — the number would simply be self-consistent and
// wrong. Case 4 runs the same seed twice, once calling endingPosition at every
// valuation and once never calling it, and requires the two games to be
// identical.
//
// WHAT IT ASSERTS
//   ARITHMETIC     netOfOutstanding === endingSurplus - outstanding - deficiency
//                  on every row, to the cent.
//   POOLING        the pool row's surplus equals the pooled RESULT's surplus.
//                  The row is summed from the lines; the result is pooled by the
//                  engine. Two derivations of one fact, so they are compared
//                  rather than assumed equal — that shape is what let the claim
//                  sheets and the Development sheet disagree about which years
//                  existed.
//   BOUNDARY       the deficiency is null at every valuation before the last and
//                  non-null once the game is complete. It is derived from the
//                  player's own funding choice, so disclosing it mid-game hands
//                  them their optimism back as a number to price against.
//   NON-NEGATIVE   outstanding is never negative, and the deficiency never is
//                  either — the unwind adds dollars, it cannot remove them.
//   READ-ONLY      case 4, above.
//
// WHAT IT DOES NOT ASSERT: that the deficiency is the RIGHT size. Its formula
// lives in actuarialMemo and is checked by actuarial-memo-check against the
// engine's own unwind weights. This gate checks that the ending position
// presents it faithfully, which is a different question.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { endingPosition } from '../../src/utils/endingPosition';
import { unEmergedDeficiency } from '../../src/utils/actuarialMemo';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 5);
const CENT = 0.01;

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
// ⚠ SQUEEZED, BECAUSE AT DEFAULTS THE DEFICIENCY IS IDENTICALLY ZERO. bookingBias
// is `COEFF x max(0, 1 - CLF)` and defaults fund at expected, so a defaults-only
// run would assert that a zero equals a zero and pass whatever the formula did.
const squeeze = (d: DecisionSet): DecisionSet => ({
  ...d,
  byLine: Object.fromEntries(LINES.map(l =>
    [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
});

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const RULE = '='.repeat(72);

function start(id: string, seed: number): GameState {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'E', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  return {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
}

function advance(gs: GameState, y: number): GameState {
  const p = processYear(gs, squeeze(defaultDecisionSet(y)));
  return {
    ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
    currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
    // The app sets this when the final year is locked (App.tsx's commitYear).
    isComplete: y >= YEARS,
  };
}

console.log('=== ENDING POSITION ===');
console.log(`${GAMES} games x ${YEARS} years, all three lines, SQUEEZED funding.\n`);

let rowsChecked = 0;
let midGameRows = 0;
let deficiencySeen = 0;
let worstArith = 0;
let worstPool = 0;
const ratios: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const openShare: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const netVsSurplus: number[] = [];

for (let g = 0; g < GAMES; g++) {
  let gs = start(`EP${g}`, 8_800_000 + g * 5171);

  // --- BEFORE ANY YEAR: no position to report ------------------------------
  if (endingPosition(gs).length !== 0) {
    fail(`g${g}: endingPosition returned rows before any year was locked`);
  }

  for (let y = 1; y <= YEARS; y++) {
    gs = advance(gs, y);
    const rows = endingPosition(gs);
    const last = gs.lockedResults[gs.lockedResults.length - 1];
    if (rows.length !== LINES.length + 1) {
      fail(`g${g} y${y}: ${rows.length} rows, expected ${LINES.length + 1}`);
      continue;
    }

    for (const r of rows) {
      rowsChecked++;
      // --- ARITHMETIC ------------------------------------------------------
      const expect = r.endingSurplus - r.outstanding - (r.deficiency ?? 0);
      worstArith = Math.max(worstArith, Math.abs(expect - r.netOfOutstanding));
      if (Math.abs(expect - r.netOfOutstanding) > CENT) {
        fail(`g${g} y${y} ${r.label}: net ${r.netOfOutstanding} !== surplus - outstanding - deficiency ${expect}`);
      }
      if (r.outstanding < -CENT) fail(`g${g} y${y} ${r.label}: outstanding is negative (${r.outstanding})`);
      if (r.deficiency !== null && r.deficiency < -CENT) {
        fail(`g${g} y${y} ${r.label}: deficiency is negative (${r.deficiency}) — the unwind only adds dollars`);
      }

      // --- BOUNDARY --------------------------------------------------------
      if (y < YEARS) {
        midGameRows++;
        if (r.deficiency !== null) {
          fail(`g${g} y${y} ${r.label}: deficiency disclosed at year ${y} of ${YEARS}, before the game ended`);
        }
      } else if (r.deficiency === null) {
        fail(`g${g} ${r.label}: deficiency withheld at game end`);
      } else if (r.deficiency > CENT) deficiencySeen++;
    }

    // --- POOLING -----------------------------------------------------------
    const pool = rows[rows.length - 1];
    worstPool = Math.max(worstPool, Math.abs(pool.endingSurplus - last.endingSurplus));
    if (Math.abs(pool.endingSurplus - last.endingSurplus) > CENT) {
      fail(`g${g} y${y}: pool row surplus ${pool.endingSurplus} !== pooled result surplus ${last.endingSurplus}`);
    }

    if (y === YEARS) {
      for (const r of rows) {
        if (r.key !== 'pool' && r.outstandingToPremium !== null) ratios[r.key].push(r.outstandingToPremium);
        if (r.key !== 'pool' && r.outstandingToBooked !== null) openShare[r.key].push(r.outstandingToBooked);
      }
      netVsSurplus.push(pool.netOfOutstanding - pool.endingSurplus);
    }
  }
}

const q = (a: number[], p: number) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// --- THE TAIL ORDERING, ASSERTED --------------------------------------------
// ⚠ NOT A TASTE CHECK. The panel's whole claim is that a player can read the
// short-tail/long-tail difference off it. If Property ever stopped settling
// faster than the casualty lines, the panel would still render and would simply
// be teaching the wrong thing — silently. This is the assertion that the exhibit
// still says what it is for.
{
  const med = (a: number[]) => q(a, 0.5);
  if (!(med(openShare.Property) < med(openShare.GL) && med(openShare.Property) < med(openShare.WC))) {
    fail('TAIL ORDERING: Property no longer settles faster than WC and GL — '
      + `Property ${(100 * med(openShare.Property)).toFixed(0)}%, GL ${(100 * med(openShare.GL)).toFixed(0)}%, `
      + `WC ${(100 * med(openShare.WC)).toFixed(0)}%. The panel would still render and would be `
      + 'teaching the opposite of the lesson it exists for.');
  }
}

// --- CASE 4: READ-ONLY -------------------------------------------------------
// ⚠ THE SAME SEED, ONE ARM CALLING endingPosition AT EVERY VALUATION AND THE
// OTHER NEVER CALLING IT. If the deficiency reaches the engine — through a
// mutated cohort, a consumed RNG draw, anything — the two games diverge and the
// panel would be reporting a number it had itself caused.
{
  let a = start('EPRO', 4_242_000);
  let b = start('EPRO', 4_242_000);
  for (let y = 1; y <= YEARS; y++) {
    a = advance(a, y);
    endingPosition(a);
    for (const l of LINES) unEmergedDeficiency(a.poolState.lines[l]);
    b = advance(b, y);
  }
  const strip = (gs: GameState) => JSON.stringify(gs.poolState) + '|' + JSON.stringify(gs.lockedResults);
  if (strip(a) !== strip(b)) {
    fail('READ-ONLY: a game whose ending position was computed each year differs from one where it was not '
      + '— the disclosure is reaching the engine rather than reading it');
  }
  console.log(`  read-only arms identical: ${strip(a) === strip(b)}`);
}

// ============================================================================
console.log(`  rows checked ${rowsChecked} (${midGameRows} mid-game), non-zero deficiencies at game end ${deficiencySeen}`);
console.log(`  worst arithmetic error $${worstArith.toFixed(6)}, worst pool-vs-result gap $${worstPool.toFixed(6)}`);
console.log('');
console.log('OUTSTANDING AS A MULTIPLE OF ONE YEAR\'S POOL PREMIUM, at game end:');
for (const l of LINES) {
  console.log(`  ${l.padEnd(9)} p10 ${q(ratios[l], 0.1).toFixed(2)}x   median ${q(ratios[l], 0.5).toFixed(2)}x   p90 ${q(ratios[l], 0.9).toFixed(2)}x`);
}
console.log('');
console.log('STILL OPEN AS A SHARE OF EVERYTHING BOOKED, at game end — the funding-independent');
console.log('measure, and the one that actually separates a short tail from a long one:');
for (const l of LINES) {
  console.log(`  ${l.padEnd(9)} p10 ${(100 * q(openShare[l], 0.1)).toFixed(0)}%   median ${(100 * q(openShare[l], 0.5)).toFixed(0)}%   p90 ${(100 * q(openShare[l], 0.9)).toFixed(0)}%`);
}
console.log('');
console.log('  ⚠ THE TWO MEASURES DISAGREE ABOUT PROPERTY AND BOTH ARE RIGHT. Against a');
console.log('  year\'s premium Property looks settled; against everything it has written it');
console.log('  still holds about a fifth. The premium ratio also moves with the player\'s own');
console.log('  funding choice, which is why the panel carries both and labels which is which.');
console.log('');
console.log('  This is the contrast the panel exists to show: a short-tail line settles');
console.log('  most of what it wrote, a long-tail line is still holding years of it.');
console.log(`  Pool surplus overstates the net position by a median of `
  + `$${Math.abs(q(netVsSurplus, 0.5) / 1e6).toFixed(2)}M at game end.`);

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('PASS — arithmetic ties, the pool row agrees with the pooled result, the deficiency is');
  console.log('       withheld until the game ends, and computing the position does not change it.');
  console.log(RULE);
}
