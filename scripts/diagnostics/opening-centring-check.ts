// ============================================================================
// THE SEARCH STARTS WHERE THE BAND IS — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/opening-centring-check.ts
//
// STARTING_CAPITAL_TO_PREMIUM is calibrated so each line's UNFILTERED candidate
// distribution centres on its own band's midpoint. That is not a property of the
// constant — it is a property of the constant AGAINST AN ENGINE, and every
// change to how a pre-game year accumulates surplus moves it. Payout patterns,
// closure curves and the per-claim payment split have all moved it since it was
// last set.
//
// ⚠ IT HAS NOW DRIFTED TWICE AND BOTH TIMES IT WAS FOUND BY ACCIDENT. Once at
// 995f6f9 (28.7% off, found while re-reading the constant) and once here (WC
// +0.19, Property +0.29, found while measuring something else entirely — the
// cost of a deeper pre-game). A third time is the expected outcome of fixing it
// and stopping, so this file exists to make the NEXT payout pattern trip a gate
// instead of the drift being noticed a month later.
//
// ============================================================================
// WHAT THE DRIFT COSTS — AND THE OBVIOUS ANSWER IS WRONG, MEASURED.
//
// The natural claim, and the one this file was written believing: when the
// candidate distribution sits above the band, the ceiling rejects its top and
// the accepted set is drawn from the low tail, so the pool ships systematically
// weaker openings. THAT IS NOT WHAT HAPPENS. At the drift this file was written
// for — the unfiltered median +34% of band width on WC, +29% on Property — the
// ACCEPTED median sat +5% and -3% off its midpoint, and on WC in the HIGH
// direction. Re-centring moved the accepted median by 2% of band width.
//
// The reason is that the band is narrow against the spread of the candidate
// distribution, so conditional on landing inside it the position within it is
// nearly uniform: the accepted p10-p90 spans 79-81% of the band both before and
// after re-centring. Selection cannot bias what it barely filters.
//
// WHAT DRIFT ACTUALLY COSTS IS ACCEPTANCE, and it is nonlinear. While the band
// still sits in the bulk, attempts barely move — measured 2.81 / 2.63 / 4.13
// before against 2.75 / 2.88 / 4.14 after, i.e. nothing. Once the band leaves
// the bulk the cost explodes: pin-vs-band-check doubles the pin and reads 16.6x
// and 12.7x on attempts, and at the retired pins the same perturbation reached
// 67.9 attempts with a worst case of 481 against a cap of 500. The failure mode
// is a cliff, not a slope.
//
// SO THIS GATE IS PREVENTIVE, AND HONEST ABOUT THAT. The drift it was written
// for had done no measurable damage yet. What it had done is move the search
// toward the edge of its own proposal distribution, where the next engine change
// of the same size would start pushing acceptance off the cliff. Watching
// attempts would give no warning until it was already expensive; watching the
// centring gives warning while it is still free.
//
// ============================================================================
// ⚠ MEASURED UNFILTERED, AND THAT IS THE WHOLE METHOD.
//
// UNFILTERED = attempt 0 of the real search, with no rejection. Measuring the
// median on the band-SELECTED sample is a fixed-point iteration against your own
// selection effect: the selected sample is confined to the band by construction,
// so it always looks well centred no matter how far the underlying distribution
// has drifted. 995f6f9 measured it both ways — GL read 1.119 selected against
// 0.900 unfiltered, and calibrating on the selected figure produced a band 48%
// above the old one. A gate that measured the selected sample would pass
// forever and assert nothing.
//
// ============================================================================
// THE TOLERANCE, AND WHY THIS NUMBER — IT IS SET ABOVE THE ESTIMATOR'S OWN NOISE.
//
// TOL = 0.25 x the band's own WIDTH, per line — not an absolute ratio. The bands
// differ in width (WC 0.39, GL 0.58, Property 0.57) and an absolute tolerance
// would be three different standards wearing one number.
//
// The number has to clear two things at once, and the first draft of this file
// only cleared one. THE EFFECT: the drift this was written for ran +0.19 on WC
// and +0.29 on Property, 49% and 52% of their band widths — so any tolerance
// under ~40% catches it. THE NOISE: the thing being tested is a MEDIAN of a wide
// distribution, and it has real sampling error. Bootstrap SE at 800 seeds is
// 0.015 / 0.031 / 0.046 per line, so at this file's 400 it is about 0.021 /
// 0.044 / 0.065 — which is 5% / 8% / 11% of the respective band widths.
//
// A 15% tolerance, which is what this file shipped with on its first draft,
// would be 1.4-3 SE and would flap on noise alone. 25% is 2.3-4.8 SE and still
// catches a 49% drift at nearly twice over. Raising SEEDS tightens the SE as
// 1/sqrt(n) if a future reader wants a tighter gate; lowering it does the
// opposite and the tolerance must follow.
//
// ⚠ THE GATE IS THE POINT, THE THRESHOLD IS NOT. If a future engine change trips
// this at 0.26, the answer is to re-solve K — STARTING_CAPITAL_TO_PREMIUM's
// header records the method, the affine fit and the Newton step — not to widen
// the tolerance. Loosening this to make it pass would restore exactly the
// silence it exists to break.
// ============================================================================

import { generateGameInstance, generateStartingPoolState } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { PRE_GAME_YEARS } from '../../src/utils/priorHistoryEngine';
import { OPENING_SURPLUS_TO_PREMIUM_BAND, STARTING_CAPITAL_TO_PREMIUM } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameInstance, GameState, GameSetupSettings, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Number(process.env.SEEDS ?? 400);
/** Tolerance as a share of each band's own width — see the header. */
const TOL_BAND_WIDTHS = 0.25;

const failed: string[] = [];
const RULE = '='.repeat(72);

// ⚠ ATTEMPT 0 OF THE REAL SEARCH, REPRODUCED — the same bootstrap, the same
// cohort relabelling, the same solo setup, the same year loop. It is not the
// real runLinePreGame because that function's whole job is to REJECT, and this
// needs the candidate before rejection. Kept adjacent to it deliberately: if
// priorHistoryEngine's candidate construction changes, this must change with it.
function unfilteredMultiple(instance: GameInstance, setup: GameSetupSettings, line: CoverageLine): number {
  const D = PRE_GAME_YEARS;
  const solo: GameSetupSettings = { ...setup, activeLines: [line] };
  const { poolState: boot } = generateStartingPoolState(instance, setup.startingYear - D, [line], -(D - 1));
  boot.lines[line].reserveCohorts = boot.lines[line].reserveCohorts.map(c => ({ ...c, yearNumber: c.yearNumber - D }));
  let gs: GameState = {
    setup: solo, instance, currentYearNumber: -(D - 1), isStarted: true, isComplete: false,
    poolState: boot, lockedResults: [], currentDecisions: defaultDecisionSet(-(D - 1)), priorHistory: [],
  };
  for (let y = -(D - 1); y <= 0; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  const last = gs.lockedResults[gs.lockedResults.length - 1].byLine[line] as LineResultSet;
  return last.endingSurplus / Math.max(last.poolPremium, 1);
}

const q = (a: number[], p: number) => {
  const t = [...a].sort((x, y) => x - y);
  return t[Math.min(t.length - 1, Math.floor(p * t.length))];
};

console.log('=== OPENING CENTRING: the unfiltered candidate median against the band midpoint ===');
console.log(`${SEEDS} seeds per line, pre-game depth ${PRE_GAME_YEARS}, band disabled (attempt 0 only).`);
console.log(`tolerance ${TOL_BAND_WIDTHS} x each band's own width\n`);
console.log('  line       K       band            midpoint   unfiltered median   offset    tol     share of         candidates');
console.log('                                                                              band width  offset/SE   above / below');

for (const line of LINES) {
  const band = OPENING_SURPLUS_TO_PREMIUM_BAND[line];
  const mid = (band.min + band.max) / 2;
  const width = band.max - band.min;
  const tol = TOL_BAND_WIDTHS * width;

  const ms: number[] = [];
  for (let s = 0; s < SEEDS; s++) {
    const id = `OCC_${line}_${s}`;
    const inst = generateGameInstance(id, 41_000_000 + s * 5171);
    const setup = { poolName: 'O', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings;
    ms.push(unfilteredMultiple(inst, setup, line));
  }
  const median = q(ms, 0.5);
  const offset = median - mid;
  // Bootstrap SE of the median, printed so the offset can be read against the
  // estimator's own noise rather than against the tolerance alone.
  //
  // ⚠ UNSEEDED ON PURPOSE, AND IT DOES NOT DECIDE ANYTHING. The resampling uses
  // Math.random, so the printed SE moves by a few percent between runs (WC has
  // read 0.8 and 0.9 on the same tree). Pass/fail is `|offset| > tol` and never
  // touches this number; the SE is a reading aid for whoever has to judge a
  // borderline offset. Seeding it would suggest the figure is exact, which a
  // 300-resample bootstrap is not.
  const boots: number[] = [];
  for (let b = 0; b < 300; b++) {
    const r: number[] = [];
    for (let i = 0; i < ms.length; i++) r.push(ms[(Math.random() * ms.length) | 0]);
    boots.push(q(r, 0.5));
  }
  const bMean = boots.reduce((x, y) => x + y, 0) / boots.length;
  const se = Math.sqrt(boots.reduce((x, y) => x + (y - bMean) ** 2, 0) / boots.length);
  const above = ms.filter(m => m > band.max).length / ms.length;
  const below = ms.filter(m => m < band.min).length / ms.length;

  console.log(
    `  ${line.padEnd(9)} ${STARTING_CAPITAL_TO_PREMIUM[line].toFixed(2)}  `
    + `[${band.min}, ${band.max}]${' '.repeat(Math.max(0, 14 - `[${band.min}, ${band.max}]`.length))}`
    + `${mid.toFixed(3)}      ${median.toFixed(3)}           `
    + `${offset >= 0 ? '+' : ''}${offset.toFixed(3)}   ${tol.toFixed(3)}    `
    + `${((100 * offset) / width).toFixed(0).padStart(4)}%  ${(offset / se).toFixed(1).padStart(5)} SE   ${(100 * above).toFixed(0)}% / below ${(100 * below).toFixed(0)}%`
  );

  if (Math.abs(offset) > tol) {
    failed.push(
      `${line}: the unfiltered candidate median is ${median.toFixed(3)} against a band midpoint of `
      + `${mid.toFixed(3)} — off by ${offset >= 0 ? '+' : ''}${offset.toFixed(3)}, which is `
      + `${((100 * Math.abs(offset)) / width).toFixed(0)}% of the band's width against a `
      + `${(100 * TOL_BAND_WIDTHS).toFixed(0)}% tolerance, and ${(offset / se).toFixed(1)} standard errors. `
      + `${(100 * (offset > 0 ? above : below)).toFixed(0)}% of candidates now fall outside the band on the `
      + `${offset > 0 ? 'high' : 'low'} side, so the search is running near the edge of its own proposal `
      + `distribution. Expect the SHIPPED OPENING to be almost unaffected — the band is narrow enough that `
      + `acceptance barely filters position within it — and expect the cost to appear in ATTEMPTS, `
      + `nonlinearly, once the band leaves the bulk. RE-SOLVE K, do not widen this tolerance: `
      + `STARTING_CAPITAL_TO_PREMIUM's header records the affine fit, the Newton step and the sample sizes.`
    );
  }
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('PASS — every line\'s unfiltered candidate distribution is centred on its own band,');
  console.log('       so the search proposes where the band is and acceptance stays cheap.');
  console.log(RULE);
}
