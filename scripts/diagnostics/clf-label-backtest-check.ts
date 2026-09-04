// CLF LABEL BACKTEST — does the funding slider's PERCENTAGE mean what it says,
// on the mechanism that actually ships?
//
// ============================================================================
// ⚠ THIS GATE IS EXPECTED RED AND THAT IS WHY IT EXISTS. It is entered in
// scripts/gates.ts's EXPECTED_RED with S3 named as the fix. Read that block
// before "correcting" anything here.
//
// STATIC_CLF_TABLE's three tables were backtested against THIS ENGINE — which
// at the time meant the COHORT development path. PER_CLAIM_REVISION.enabled is
// now true, so the distribution those percentiles are percentiles OF is no
// longer the distribution the game draws from. Nothing about the tables is
// wrong as arithmetic; they describe a mechanism that no longer runs.
//
// ⚠ AND THE FLIP IS NOT THE CAUSE, WHICH IS THE FINDING THIS GATE EXISTS TO
// KEEP VISIBLE. Run on BOTH arms at this commit, 120 games x 8 years:
//
//   worst label error    flag OFF  +14.5pp (GL, 45% stop)
//                        flag ON   +14.7pp (GL, 45% stop)
//   GL's 60% stop        delivers 73.4% OFF, 73.0% ON
//   WC's 60% stop        delivers 56.9% OFF, 56.9% ON
//   Property's 60% stop  delivers 60.9% OFF, 61.5% ON
//
// The flip moves realised confidence by well under a point at every stop on
// every line. The labels were ALREADY wrong, so this is not "the flip broke the
// sliders" — it is "the sliders were already wrong and the flip inherits them
// unchanged". A marker that blamed the flip would send the next reader to the
// wrong place, so it does not.
//
// WHERE THE ERROR ACTUALLY LIVES: GL, and it is its table's PROVENANCE rather
// than the mechanism. GL reads GL_SUPPLIED — `source: 'supplied'`, not derived
// from this engine — and clfTables.ts's own crossing note already records the
// discrepancy ("GL 57.7% on the supplied curve, against 70.9% on its derived
// one"). This gate measures 73.0%, which is that same gap seen from the other
// end. WC (-1 to -4pp) and Property (within +/-1.5pp at every stop) are both
// fine, and PROPERTY_DERIVED being fine also retires a stale engine comment at
// simulationEngine.ts:422 which still says Property reads the generic table.
//
// What was NOT on the record at all is that no gate anywhere backtests
// STATIC_CLF_TABLE against the engine — the two CLF grid derivers assert
// monotonicity on the grid they PRODUCE, not on the static table the engine
// prices off, and gates.ts's SLOW block says so in as many words. This gate
// closes that hole, which is why it is worth having even though its red is
// older than the commit that added it.
//
// ============================================================================
// WHAT IT MEASURES, AND WHY THIS BASIS.
//
// A CLF table maps a confidence level to a MULTIPLE OF EXPECTED loss. So it is
// a set of percentiles of the line's own net loss distribution divided by that
// distribution's mean, and the label is testable directly: fund at the stop's
// multiplier and count how often the year's loss came in under it.
//
//     realised confidence at stop p
//       = share of line-years with netUltimateLoss <= staticClf(line, p) x mean
//
// Both sides come from the same run, so the mean is the realised mean rather
// than a priced figure — this asks whether the TABLE describes the DRAW, which
// is the question a re-derivation answers. It deliberately does not go through
// the pricing loop: a label error and a pricing error would then be summed and
// this gate could not say which had moved.
//
// ⚠ REPORTED WITH A CI, GATED ON THE WORST STOP. Realised confidence is a
// binomial proportion, so its own standard error is knowable and printed. The
// gate fires on the largest absolute label error across the stops, against a
// tolerance wide enough to be a gross-error detector and no wider — per this
// repo's own division of labour between wide CI gates and component checks.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { STATIC_CLF_TABLE, staticClf } from '../../src/data/clfTables';
import { PER_CLAIM_REVISION } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 120);
const YEARS = 8;

// The label error tolerance, in percentage points. A GROSS-ERROR DETECTOR: at
// 960 line-years a realised proportion carries a standard error near 1.5pp, so
// anything under ~5pp cannot be separated from sampling here and belongs to a
// re-derivation rather than to a gate.
const MAX_LABEL_ERROR_PP = 5.0;

const failed: string[] = [];

function shippedRun(): Record<string, number[]> {
  const out: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  for (let g = 0; g < GAMES; g++) {
    const id = `CLFB${g}`;
    const instance = generateGameInstance(id, 6_200_000 + g * 7919);
    const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      for (const line of LINES) {
        const lr = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
        if (lr && Number.isFinite(lr.netUltimateLoss)) out[line].push(lr.netUltimateLoss as number);
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(RULE);
console.log('CLF LABEL BACKTEST — what the funding slider\'s percentage actually delivers');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years on the SHIPPED mechanism `
  + `(PER_CLAIM_REVISION.enabled = ${PER_CLAIM_REVISION.enabled}).`);
console.log('The flag is NOT toggled here — this gate asks about the shipped path only.\n');

const loss = shippedRun();

// The stops each line's own table actually carries.
console.log('  line      stop   multiplier   nominal   realised   error      +-1 SE');
let worst = { line: '', stop: 0, err: 0 };
for (const line of LINES) {
  const xs = loss[line];
  if (xs.length === 0) { failed.push(`${line}: no line-years collected`); continue; }
  const m = mean(xs);
  // `stops` are in PERCENT on the table; staticClf takes a fraction.
  const stops = STATIC_CLF_TABLE[line as 'WC' | 'GL' | 'Property'].stops
    .map(s => s / 100)
    .filter(c => c >= 0.30 && c <= 0.95)
    .sort((a, b) => b - a);
  for (const p of stops) {
    const mult = staticClf(line as 'WC' | 'GL' | 'Property', p);
    const hit = xs.filter(v => v <= mult * m).length / xs.length;
    const se = Math.sqrt(Math.max(1e-12, hit * (1 - hit) / xs.length));
    const errPp = 100 * (hit - p);
    if (Math.abs(errPp) > Math.abs(worst.err)) worst = { line, stop: p, err: errPp };
    console.log(`  ${line.padEnd(9)} ${(100 * p).toFixed(1).padStart(5)}%  ${mult.toFixed(4).padStart(9)}   `
      + `${(100 * p).toFixed(1).padStart(6)}%   ${(100 * hit).toFixed(1).padStart(7)}%   `
      + `${(errPp >= 0 ? '+' : '') + errPp.toFixed(1)}pp`.padStart(8) + `   ${(100 * se).toFixed(2)}pp`);
  }
  console.log('');
}

console.log(`  line-years per line: ${loss.WC.length}`);
console.log(`  WORST LABEL ERROR: ${worst.line} at the ${(100 * worst.stop).toFixed(1)}% stop, `
  + `${(worst.err >= 0 ? '+' : '') + worst.err.toFixed(1)}pp against a ${MAX_LABEL_ERROR_PP}pp tolerance`);

if (Math.abs(worst.err) > MAX_LABEL_ERROR_PP) {
  failed.push(`${worst.line}'s ${(100 * worst.stop).toFixed(1)}% funding stop delivers `
    + `${(100 * worst.stop + worst.err).toFixed(1)}% — a ${(worst.err >= 0 ? '+' : '') + worst.err.toFixed(1)}pp label error. `
    + 'STATIC_CLF_TABLE describes a distribution the engine does not draw from. Measured on both '
    + 'arms, this is NOT caused by the per-claim flip (which moves it under a point) — it is GL\'s '
    + 'supplied curve. The fix is S3, which re-derives all three tables against the shipped '
    + 'mechanism; this gate turns green when it lands and the EXPECTED_RED entry retires itself.');
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('');
  console.log('⚠ EXPECTED RED PENDING S3. The funding slider\'s percentages are labels on a');
  console.log('  distribution that is no longer the one being drawn. Acceptable on a');
  console.log('  development branch with the re-derivation scheduled; NOT acceptable to put');
  console.log('  in front of a player who reads the confidence levels as meaningful.');
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('CLF LABELS HOLD — every funding stop delivers its nominal confidence within');
  console.log(`${MAX_LABEL_ERROR_PP}pp on the shipped mechanism.`);
  console.log(RULE);
}
