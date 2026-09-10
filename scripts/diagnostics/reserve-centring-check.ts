// ============================================================================
// THE CALENDAR BLEND ADDS DISPERSION AND NOT DRIFT — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/reserve-centring-check.ts
//   GAMES=120 npx tsx scripts/diagnostics/reserve-centring-check.ts
//
// IBNER_CALENDAR_RHO exists to widen the year-to-year dispersion of the
// reserve-driven residual. The whole mechanism is only legitimate if it leaves
// the LEVEL of that residual where it was, because the pricing is derived from
// the same model: the residual's mean is what forward booking contracts and
// what the premium is set to fund, so a mechanism that moves the mean moves the
// price with it and the pool is no better funded than before, only noisier.
//
// ⚠ SO THE ASSERTION IS ON THE MEAN, AND THE DISPERSION IS A READING. That is
// the opposite way round from what the mechanism is FOR, and deliberately so.
// The dispersion is a calibration — it was solved, it is allowed to drift with
// the engine, and pinning it here would turn every unrelated change into a red
// gate. The mean is a property the mechanism must have BY CONSTRUCTION at any
// rho (see calendarBlendedZ: the blend preserves every cohort's marginal law,
// so E[factor] = 1 exactly), and a break in it means the construction has been
// broken rather than that a number has moved.
//
// ============================================================================
// ⚠ THE SE IS ACROSS GAMES, NOT ACROSS POOL-YEARS, AND THE DIFFERENCE IS ABOUT
// THREEFOLD. The ten played years of one game share an opening surplus, a
// membership path and a reserve stock that carries from year to year, so their
// residual rates are anything but independent draws. Pooling them as n = GAMES
// x YEARS understates the SE by roughly sqrt(YEARS) and would let this gate
// pass a drift it should have caught. Every figure below is a PER-GAME mean
// first; the statistics are taken over those.
//
// The two arms run on IDENTICAL SEEDS and the difference is taken PAIRWISE per
// game, which removes the game-to-game variation in the level entirely and is
// what makes 40 games enough.
//
// ============================================================================
// ⚠ AND IT CARRIES A POSITIVE CONTROL, BECAUSE A CENTRING GATE WITH ONLY A
// PASSING CASE IS UNTESTED. A gate that asserts "nothing moved" passes just as
// happily when it is measuring the wrong thing, when its SE is inflated, or
// when both arms are accidentally the same arm. Two recorded cases calibrate
// it, both measured at 30 games x 10 years on the shipped engine while this
// mechanism was being chosen:
//
//   phi x2      pool residual mean 29.90% -> 27.86%,  -2.04pp   MUST FAIL
//   IBNER x2    pool residual mean 29.90% -> 29.92%,  +0.02pp   MUST PASS
//
// The phi arm is why this gate exists at all. Widening the per-claim law was
// the obvious way to widen the reserve and it moves the mean by two points,
// through two different mechanisms on two different lines — cession convexity
// on WC (gross mean 28.48% -> 28.70%, i.e. flat, while net falls 24.52% ->
// 22.98%) and the claim-level floors on Property (gross itself falls 22.03% ->
// 19.86%). Neither is visible in a dispersion figure.
//
// WHAT 40 GAMES BUYS, MEASURED RATHER THAN ASSUMED. At the shipped cell the
// control rejects the -2.04pp drift at -3.94 SE, so the gate has the power it
// was built for. The arms themselves read, at 40 games, POOL +0.99 SE and WC
// +1.75 SE; at 120 games the same comparison reads POOL +1.37 and WC +1.01 SE.
// The 40-game WC figure is noise, not a shrinking bias — raise GAMES if a
// reading here ever looks like it is going somewhere. GL's SE is the loose one
// (its mean is the noisiest of the three) and no sample here tightens it much.
//
// ⚠ THE CONTROL IS APPLIED TO THE DECISION RULE, NOT TO THE ENGINE. It injects
// the recorded -2.04pp into this run's own per-game means and asserts that this
// gate's SE and threshold reject it. That tests the part that can silently be
// wrong — the SE basis and the tolerance — without needing a second mechanism
// in the engine to perturb. If the SE is ever inflated to the point where a two
// point drift would slip through, THIS is the line that goes red.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import {
  FORWARD_BOOKING, IBNER_CALENDAR_RHO, IBNER_COHORT_SD_SCALE, PRICING_TRIANGLE,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 40);
const YEARS = Number(process.env.YEARS ?? 10);

// How many standard errors of the paired difference the level may move.
const MAX_SE = 3;
// The recorded phi x2 drift, in points of the opening reserve. See the header.
const PHI_ARM_DRIFT = -0.0204;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

interface Arm {
  /** One mean residual rate per GAME — the unit the statistics are taken over. */
  perGamePool: number[];
  perGameLine: Record<string, number[]>;
  /** Every pool-year rate, for the dispersion READING only. */
  poolYearRates: number[];
  lineYearRates: Record<string, number[]>;
}

function runArm(rho: number, scale: Record<string, number>): Arm {
  const wasRho = IBNER_CALENDAR_RHO.rho;
  const wasScale = { ...IBNER_COHORT_SD_SCALE };
  IBNER_CALENDAR_RHO.rho = rho;
  for (const l of LINES) IBNER_COHORT_SD_SCALE[l] = scale[l];
  const out: Arm = {
    perGamePool: [], perGameLine: {}, poolYearRates: [], lineYearRates: {},
  };
  for (const l of LINES) { out.perGameLine[l] = []; out.lineYearRates[l] = []; }
  try {
    for (let g = 0; g < GAMES; g++) {
      // ⚠ THE SAME ids AND SEEDS IN BOTH ARMS. The pairing is the whole reason
      // 40 games has the power that it does.
      const id = `RC${g}`;
      const instance = generateGameInstance(id, 4_400_000 + g * 7919);
      const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      const poolThis: number[] = [];
      const lineThis: Record<string, number[]> = {};
      for (const l of LINES) lineThis[l] = [];
      for (let y = 1; y <= YEARS; y++) {
        const p = processYear(gs, defaultDecisionSet(y));
        let resid = 0, base = 0;
        for (const lr of p.lineResults) {
          const x = lr.result as never as Record<string, number>;
          // THE ENGINE'S OWN IDENTITY. netIncurredLoss = netUltimateLoss -
          // developmentImpact, so this difference IS the reserve-driven
          // residual and nothing here re-derives it.
          const r = x.netIncurredLoss - x.netUltimateLoss;
          const b = x.beginningNetReserve;
          resid += r; base += b;
          // ⚠ YEAR 1 IS EXCLUDED ON BOTH ARMS. Its opening reserve is the
          // pre-game's, not a played year's, and it carries the seed cohorts.
          if (y > 1 && b > 0) { lineThis[lr.line].push(r / b); out.lineYearRates[lr.line].push(r / b); }
        }
        if (y > 1 && base > 0) { poolThis.push(resid / base); out.poolYearRates.push(resid / base); }
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      }
      out.perGamePool.push(mean(poolThis));
      for (const l of LINES) out.perGameLine[l].push(mean(lineThis[l]));
    }
  } finally {
    IBNER_CALENDAR_RHO.rho = wasRho;
    for (const l of LINES) IBNER_COHORT_SD_SCALE[l] = wasScale[l];
  }
  return out;
}

/** The paired decision: mean difference against MAX_SE standard errors of it.
 *
 *  ⚠ AN EXACTLY-ZERO SPREAD IS A RESULT, NOT A DIVISION BY ZERO. When a line's
 *  scale is unchanged and rho is 0, that line is BIT-IDENTICAL between the two
 *  arms and both the difference and its SE are exactly 0 — which is the
 *  strongest possible pass and also a useful confirmation that the mechanism is
 *  confined to the constants that moved. It is reported as `identical` rather
 *  than as a ratio of 0/0. */
function verdict(on: number[], off: number[], shift = 0) {
  const d = on.map((v, i) => (v + shift) - off[i]);
  const n = d.length;
  const m = mean(d);
  const se = n > 1 ? sd(d) / Math.sqrt(n - 1) : Infinity;
  const identical = m === 0 && se === 0;
  return { m, se, identical, ratio: se > 0 ? m / se : 0, ok: identical || Math.abs(m) <= MAX_SE * se };
}

const RHO_AT_ENTRY = IBNER_CALENDAR_RHO.rho;
const SCALE_AT_ENTRY = { ...IBNER_COHORT_SD_SCALE };
const FB_AT_ENTRY = FORWARD_BOOKING.enabled;
const PT_AT_ENTRY = PRICING_TRIANGLE.enabled;

// THE NULL: rho 0 and every scale 1 — the configuration this mechanism
// replaced, reached through the same code path.
const NULL_SCALE: Record<string, number> = { WC: 1, GL: 1, Property: 1 };
const off = runArm(0, NULL_SCALE);
const on = runArm(RHO_AT_ENTRY, SCALE_AT_ENTRY);

if (IBNER_CALENDAR_RHO.rho !== RHO_AT_ENTRY
  || LINES.some(l => IBNER_COHORT_SD_SCALE[l] !== SCALE_AT_ENTRY[l])
  || FORWARD_BOOKING.enabled !== FB_AT_ENTRY
  || PRICING_TRIANGLE.enabled !== PT_AT_ENTRY) {
  console.log('⚠ A CONSTANT WAS NOT RESTORED — this gate mutates them and must put them back');
  process.exitCode = 1;
}

const failures: string[] = [];
const untested: string[] = [];

console.log(RULE);
console.log('RESERVE CENTRING — DOES THE CALENDAR BLEND MOVE THE LEVEL?');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years per arm, identical seeds, paired per game.`);
console.log(`Shipped arm: rho ${RHO_AT_ENTRY}, scale WC ${SCALE_AT_ENTRY.WC} / GL ${SCALE_AT_ENTRY.GL} / `
  + `Property ${SCALE_AT_ENTRY.Property}.  Null arm: rho 0, every scale 1.\n`);

console.log('--- THE ASSERTION: the residual MEAN, as a share of the opening reserve ---');
console.log('  basis        null      shipped     paired diff    SE      diff/SE   verdict');
const rows: Array<[string, number[], number[]]> = [
  ['POOL', on.perGamePool, off.perGamePool],
  ...LINES.map(l => [l, on.perGameLine[l], off.perGameLine[l]] as [string, number[], number[]]),
];
for (const [name, a, b] of rows) {
  const v = verdict(a, b);
  console.log(`  ${name.padEnd(11)} ${(100 * mean(b)).toFixed(2).padStart(6)}%   ${(100 * mean(a)).toFixed(2).padStart(6)}%   `
    + `${((v.m >= 0 ? '+' : '') + (100 * v.m).toFixed(3)).padStart(9)}pp  ${(100 * v.se).toFixed(3)}pp   `
    + `${(v.identical ? 'identical' : v.ratio.toFixed(2)).padStart(9)}    ${v.ok ? 'PASS' : 'FAIL'}`);
  if (!v.ok) {
    failures.push(`${name}: the residual mean moved ${(100 * v.m).toFixed(3)}pp of the opening reserve, `
      + `which is ${v.ratio.toFixed(1)} standard errors against a ${MAX_SE} SE bound. The calendar blend is `
      + `mean-preserving BY CONSTRUCTION — it changes no cohort's marginal law — so a real move here means `
      + `the construction is broken, not that a calibration has drifted. Check calendarBlendedZ: the two `
      + `coefficients must square to one, and the common draw must not depend on the cohort.`);
  }
}

console.log('\n--- THE POSITIVE CONTROL: the recorded phi x2 drift must be REJECTED ---');
const ctl = verdict(on.perGamePool, off.perGamePool, PHI_ARM_DRIFT);
console.log(`  injecting ${(100 * PHI_ARM_DRIFT).toFixed(2)}pp into the shipped arm's per-game means:`);
console.log(`  paired diff ${(100 * ctl.m).toFixed(3)}pp   SE ${(100 * ctl.se).toFixed(3)}pp   `
  + `${ctl.ratio.toFixed(2)} SE   ${ctl.ok ? 'NOT REJECTED' : 'REJECTED'}`);
if (ctl.ok) {
  untested.push('the phi x2 drift of -2.04pp was NOT rejected by this gate\'s own rule. The gate cannot '
    + 'detect the drift it was written to detect, so its PASS above means nothing. Either the SE has been '
    + 'inflated (check that it is taken across GAMES and that the arms are paired), MAX_SE has been raised, '
    + 'or the two arms are running the same configuration.');
}

console.log('\n--- READING, NOT ASSERTED: what the mechanism bought ---');
console.log('  basis        null SD    shipped SD    ratio');
const disp: Array<[string, number[], number[]]> = [
  ['POOL', on.poolYearRates, off.poolYearRates],
  ...LINES.map(l => [l, on.lineYearRates[l], off.lineYearRates[l]] as [string, number[], number[]]),
];
for (const [name, a, b] of disp) {
  const sa = sd(a), sb = sd(b);
  console.log(`  ${name.padEnd(11)} ${(100 * sb).toFixed(2).padStart(6)}pp   ${(100 * sa).toFixed(2).padStart(7)}pp   `
    + `${(sb > 0 ? sa / sb : NaN).toFixed(2)}x`);
}
console.log('');
console.log('  ⚠ THESE ARE POOL-YEAR SDs AND THEY ARE NOT ASSERTED. GL\'s in particular is not');
console.log('  estimable to better than about +/-0.6pp between independent seed sets even at 150');
console.log('  games — measured 7.85 / 9.04 / 8.06 on the null arm across three of them — so a');
console.log('  tolerance here would fire on the seed rather than on the engine. The dispersion');
console.log('  target lives at IBNER_CALENDAR_RHO with the sample it was solved on.');

console.log('');
console.log(RULE);
if (untested.length > 0) {
  console.log('THE GATE IS UNTESTED:');
  for (const u of untested) console.log(`  - ${u}`);
  console.log(RULE);
  process.exitCode = 2;
} else if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE BLEND ADDS DISPERSION AND NOT DRIFT — every basis centred, control rejected.');
  console.log(RULE);
}
