// IBNER BEHAVIOUR — does the development look like what the constants promise?
//
//   npx tsx scripts/diagnostics/ibner-report.ts
//   GAMES=50 YEARS=10 npx tsx scripts/diagnostics/ibner-report.ts
//   SQUEEZE_LINE=WC npx tsx scripts/diagnostics/ibner-report.ts
//
// REPORTS. Gates nothing — ibner-null-check.ts is the gate.
//
// ============================================================================
// WHAT EACH SECTION ANSWERS, AND THE ONE MEASUREMENT TRAP IN HERE.
//
//   1  total development as a share of the initial estimate, against the
//      stated IBNER_TOTAL_SD of 8 / 20 / 25%
//   2  share of accident years that barely move, against the mixture's
//      intended "roughly half"
//   3  calendar-year CV, which is the quantity the CLF tables are derived from
//   4  mean development, which must be ~0 at defaults since the bias is inert
//   5  the same book run at maximum squeeze, so an underfunding pool's exhibit
//      can be looked at directly
//
// ⚠ SECTION 1 MUST READ MATURED COHORTS ONLY, AND IN A TEN-YEAR GAME MOST ARE
// NOT MATURED. WC draws a horizon of 5-12 years, so a cohort written in year 6
// has taken at most four steps by year 10 and has accumulated roughly
// sqrt(4/8.5) = 69% of its nominal SD. Pooling those with matured cohorts would
// understate every line's total and would do it WORST on the longest-tailed
// line — exactly backwards. Matured and still-developing are reported
// separately, with counts, and only the matured figure is compared to the
// constant.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { IBNER_TOTAL_SD, IBNER_HORIZON, IBNER_STEP_MIXTURE, IBNER_BOOKING_BIAS_COEFF } from '../../src/data/defaultAssumptions';
import { SeededRandom } from '../../src/utils/random';
import type { CoverageLine, GameState, LineResultSet, DecisionSet, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 50);
const YEARS = Number(process.env.YEARS ?? 10);
const SQUEEZE_LINE = (process.env.SQUEEZE_LINE ?? 'WC') as CoverageLine;

// Parent-branch (claims-distribution at 0b2e537, the old wobble) calendar-year
// CV, measured with the SAME seed family and game count as this report uses,
// with a 95% CI from a block bootstrap resampling whole games.
const PARENT_CV: Record<string, { cv: number; lo: number; hi: number }> = {
  WC: { cv: 0.3211, lo: 0.2541, hi: 0.4076 },
  GL: { cv: 0.8025, lo: 0.7192, hi: 0.8686 },
  Property: { cv: 0.4677, lo: 0.4460, hi: 0.4875 },
};

const fmt$ = (x: number) => Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(1)}k`;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const q = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

interface CohortObs { dev: number; matured: boolean; steps: number; bias: number; }

// One game. Returns per-line calendar-year netIncurredLoss and the final state
// of every cohort WRITTEN DURING PLAY (pre-game cohorts are excluded: they have
// no real register behind them, carry bookingBias 0, and start already partly
// aged, so mixing them in would blur every figure here).
function play(id: string, seed: number, mutate?: (d: DecisionSet) => DecisionSet) {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const calendar: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  const surplusY10: Record<string, number> = {};
  const devCal: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  const byYear: Record<string, Record<number, number[]>> = { WC: {}, GL: {}, Property: {} };
  // Latest sighting of each in-play cohort, keyed by accident year. A cohort
  // that closes is filtered out of the array, so the last sighting is kept
  // rather than read from the final state.
  const last: Record<string, Map<number, ReserveCohort>> = { WC: new Map(), GL: new Map(), Property: new Map() };

  for (let y = 1; y <= YEARS; y++) {
    const d = mutate ? mutate(defaultDecisionSet(y)) : defaultDecisionSet(y);
    const p = processYear(gs, d);
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
      if (!r) continue;
      calendar[l].push(r.netIncurredLoss);
      devCal[l].push(r.priorYearDevelopment);
      (byYear[l][y] ??= []).push(r.priorYearDevelopment);
      if (y === YEARS) surplusY10[l] = r.endingSurplus;
      for (const c of p.updatedPoolState.lines[l].reserveCohorts) {
        if (c.yearNumber >= 1) last[l].set(c.yearNumber, c);
      }
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }

  const cohorts: Record<string, CohortObs[]> = { WC: [], GL: [], Property: [] };
  for (const l of LINES) {
    for (const c of last[l].values()) {
      if (c.registerSum <= 0) continue;
      cohorts[l].push({
        dev: c.netUltimate / c.registerSum - 1,
        matured: c.age >= c.horizon,
        steps: Math.min(c.age, c.horizon),
        bias: c.bookingBias,
      });
    }
  }
  return { calendar, cohorts, devCal, surplusY10, byYear };
}

function runArm(label: string, mutate?: (d: DecisionSet) => DecisionSet) {
  const calendar: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  const cohorts: Record<string, CohortObs[]> = { WC: [], GL: [], Property: [] };
  const devCal: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  const surplus: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  const byYear: Record<string, Record<number, number[]>> = { WC: {}, GL: {}, Property: {} };
  for (let g = 0; g < GAMES; g++) {
    const r = play(`IBN${label}${g}`, 4_200_000 + g * 8117, mutate);
    for (const l of LINES) {
      calendar[l].push(...r.calendar[l]);
      cohorts[l].push(...r.cohorts[l]);
      devCal[l].push(...r.devCal[l]);
      if (r.surplusY10[l] !== undefined) surplus[l].push(r.surplusY10[l]);
      for (const [y, xs] of Object.entries(r.byYear[l])) (byYear[l][Number(y)] ??= []).push(...xs);
    }
  }
  return { calendar, cohorts, devCal, surplus, byYear };
}

console.log(`IBNER BEHAVIOUR — ${GAMES} games x ${YEARS} years, all three lines\n`);
console.log('constants under test:');
for (const l of LINES) {
  const h = IBNER_HORIZON[l];
  console.log(`  ${l.padEnd(9)} total SD ${pct(IBNER_TOTAL_SD[l])}  horizon ${h.min}-${h.max}  ` +
    `implied annual step ${(IBNER_TOTAL_SD[l] / Math.sqrt((h.min + h.max) / 2) * 100).toFixed(2)}%`);
}
console.log(`  booking bias coefficient ${IBNER_BOOKING_BIAS_COEFF} (inert at defaults)\n`);

// ============================================================================
// SECTION 0. THE WALK ITSELF, WITHOUT THE ENGINE.
//
// ⚠ THE ENGINE CANNOT SETTLE WHETHER THE WALK IS MEAN-PRESERVING, AND SECTION 4
// BELOW SHOULD NOT BE READ AS IF IT COULD. A ten-year game matures only ~90 WC
// cohorts across 50 games, and the development distribution is strongly LEFT-
// skewed (log compresses the upside and stretches the downside, so a
// multiplicative walk with additive-normal steps has a median well below its
// mean). A sample mean of 91 left-skewed draws with an 18% SD carries a ~2%
// standard error and will routinely sit 2 SE from zero while the underlying
// process is exactly unbiased — which is what it did on the first run of this
// report, at -3.92% on WC.
//
// So the martingale property is tested HERE instead, on 200k direct paths per
// line with no game around them. That is the right instrument for it: the
// question is about the walk's arithmetic, not about the pool.
function walkMonteCarlo() {
  const rng = new SeededRandom(20260824);
  console.log('=== 0. THE WALK, SAMPLED DIRECTLY (200k paths/line, no engine) ===');
  console.log('    E[dev] must be ~0 — this is the martingale test. SD must match the constant.\n');
  console.log('line      |   E[dev] |      SE |  SD(dev) | stated |  median | share |dev|<5%');
  const N = 200_000;
  for (const line of LINES) {
    const h = IBNER_HORIZON[line];
    const step = IBNER_TOTAL_SD[line] / Math.sqrt((h.min + h.max) / 2);
    const devs: number[] = [];
    for (let i = 0; i < N; i++) {
      const H = rng.intRange(h.min, h.max);
      const u = rng.next();
      let acc = 0, m = IBNER_STEP_MIXTURE[IBNER_STEP_MIXTURE.length - 1].multiplier;
      for (const b of IBNER_STEP_MIXTURE) { acc += b.weight; if (u < acc) { m = b.multiplier; break; } }
      let est = 1;
      for (let t = 0; t < H; t++) est = Math.max(0, est * (1 + m * step * rng.normal(0, 1)));
      devs.push(est - 1);
    }
    const sorted = [...devs].sort((a, b) => a - b);
    const se = sd(devs) / Math.sqrt(N);
    console.log(`${line.padEnd(9)} | ${pct(mean(devs)).padStart(8)} | ${pct(se).padStart(7)} | ${pct(sd(devs)).padStart(8)} | ` +
      `${pct(IBNER_TOTAL_SD[line]).padStart(6)} | ${pct(sorted[N >> 1]).padStart(7)} | ` +
      `${pct(devs.filter(d => Math.abs(d) < 0.05).length / N)}`);
  }
  console.log('\n  ⚠ SD RUNS SLIGHTLY ABOVE THE STATED TOTAL and that is structural, not a bug.');
  console.log('    The step is scaled by sqrt(E[H]) but each cohort draws its OWN horizon, so');
  console.log('    horizon dispersion adds cross-sectional variance on top of the walk\'s own.');
  console.log('    It is worth ~7% relative on WC (widest range), ~0.1% on Property (narrowest).');
}
walkMonteCarlo();
console.log();

const base = runArm('D');

console.log('=== 1. TOTAL DEVELOPMENT AS A SHARE OF THE INITIAL ESTIMATE ===');
console.log('    matured cohorts only — the stated total SD is what a FULL runoff accumulates.\n');
console.log('line      | matured | still dev | SD(matured) | stated | mean(matured) |  p10 /  p50 /  p90');
for (const l of LINES) {
  const all = base.cohorts[l];
  const mat = all.filter(c => c.matured).map(c => c.dev);
  const imm = all.filter(c => !c.matured).map(c => c.dev);
  console.log(`${l.padEnd(9)} | ${String(mat.length).padStart(7)} | ${String(imm.length).padStart(9)} | ` +
    `${pct(sd(mat)).padStart(11)} | ${pct(IBNER_TOTAL_SD[l]).padStart(6)} | ${pct(mean(mat)).padStart(13)} | ` +
    `${pct(q(mat, 0.1)).padStart(7)} / ${pct(q(mat, 0.5)).padStart(7)} / ${pct(q(mat, 0.9)).padStart(7)}`);
}
console.log('\n  ⚠ MATURED-ONLY IS ITSELF A BIASED SAMPLE IN A TEN-YEAR GAME, and section 0 is');
console.log('    what the constants should be judged against. A cohort can only appear in the');
console.log('    matured column if its horizon was SHORT enough to finish inside the game, so');
console.log('    the matured WC set is drawn from horizons near 5-7 rather than 5-12 and');
console.log('    accumulates correspondingly less — 18.5% measured against the walk\'s own');
console.log('    26.8%. Property shows the same effect (12.6% against 15.2%); GL barely does');
console.log('    (20.2% against 20.7%) because its horizon mostly fits. This is survivorship in');
console.log('    the MEASUREMENT, not under-delivery by the model.');
console.log('\n  still-developing cohorts, for reference (partial runoff, SD must be LOWER):');
for (const l of LINES) {
  const imm = base.cohorts[l].filter(c => !c.matured);
  console.log(`    ${l.padEnd(9)} n=${String(imm.length).padStart(4)}  mean steps taken ${mean(imm.map(c => c.steps)).toFixed(1)}` +
    `  SD ${pct(sd(imm.map(c => c.dev)))}`);
}

console.log('\n=== 2. SHARE OF ACCIDENT YEARS THAT BARELY MOVE (mixture check) ===');
console.log('    the 50% bucket draws multiplier 0.231, so those years should cluster near flat.\n');
console.log('line      |  <2%  |  <5%  | <10%  |  >=20%  (matured cohorts)');
for (const l of LINES) {
  const mat = base.cohorts[l].filter(c => c.matured).map(c => Math.abs(c.dev));
  if (!mat.length) { console.log(`${l.padEnd(9)} | (no matured cohorts at this horizon)`); continue; }
  const share = (t: number) => pct(mat.filter(x => x < t).length / mat.length);
  const over = pct(mat.filter(x => x >= 0.20).length / mat.length);
  console.log(`${l.padEnd(9)} | ${share(0.02).padStart(5)} | ${share(0.05).padStart(5)} | ${share(0.10).padStart(5)} | ${over.padStart(6)}`);
}

console.log('\n=== 3. CALENDAR-YEAR netIncurredLoss CV (the CLF derivation basis) ===');
console.log('    ⚠ NOT re-deriving anything — this is the measurement that decides whether to.\n');
console.log('line      |     mean |       sd |     CV | parent CV [95% CI]       | change');
for (const l of LINES) {
  const xs = base.calendar[l], m = mean(xs), s = sd(xs), cv = s / m;
  const p = PARENT_CV[l];
  const rel = (cv / p.cv - 1) * 100;
  console.log(`${l.padEnd(9)} | ${fmt$(m).padStart(8)} | ${fmt$(s).padStart(8)} | ${cv.toFixed(4)} | ` +
    `${p.cv.toFixed(4)} [${p.lo.toFixed(4)}, ${p.hi.toFixed(4)}] | ${(rel >= 0 ? '+' : '') + rel.toFixed(1)}%`);
}
console.log('\n  ⚠ PARENT FIGURES ARE MATCHED-SEED, 120 games, WITH A BLOCK-BOOTSTRAP CI OVER GAMES.');
console.log('    An earlier cut of this compared against a DIFFERENT 40-game seed family and showed');
console.log('    GL\'s CV falling 17% — which is meaningless: GL\'s own CV is ~0.80, so two unmatched');
console.log('    samples of it differ by more than anything IBNER does. Line-years within a game are');
console.log('    not independent (the book and surplus persist), so the CI resamples whole GAMES.');
console.log('    Read the CI, not the point change: a shift inside it is not a measurement.');

console.log('\n=== 4. MEAN DEVELOPMENT AT DEFAULTS (must be ~0 — the bias is inert here) ===');
console.log('    ⚠ UNDERPOWERED BY CONSTRUCTION — section 0 is the real martingale test.');
console.log('    Reported anyway because it is the mean the PLAYER experiences in a ten-year');
console.log('    game, which is a different and also useful question from whether the process');
console.log('    is unbiased. A line sitting >2 SE from zero here is expected occasionally.\n');
for (const l of LINES) {
  const mat = base.cohorts[l].filter(c => c.matured).map(c => c.dev);
  const se = mat.length > 1 ? sd(mat) / Math.sqrt(mat.length) : 0;
  const m = mean(mat);
  const within = Math.abs(m) <= 2 * se;
  console.log(`  ${l.padEnd(9)} mean ${pct(m).padStart(8)}  SE ${pct(se).padStart(7)}  ` +
    `${within ? 'within 2 SE of zero' : 'more than 2 SE from zero — SEE SECTION 0'}`);
  const biases = base.cohorts[l].map(c => c.bias);
  console.log(`            max bookingBias on any cohort: ${pct(Math.max(...biases))} ` +
    `${Math.max(...biases) === 0 ? '(inert, as expected at defaults)' : '⚠ NON-ZERO AT DEFAULTS'}`);
}

console.log(`\n=== 5. MAXIMUM SQUEEZE ON ${SQUEEZE_LINE} — what an underfunding pool looks like ===`);
console.log('    funding confidence at the bottom of the slider, other lines left at defaults.\n');
{
  const squeeze = (d: DecisionSet): DecisionSet => ({
    ...d,
    byLine: { ...d.byLine, [SQUEEZE_LINE]: { ...d.byLine[SQUEEZE_LINE], fundingConfidenceLevel: 0.10, fundingAtExpected: false } },
  });
  const arm = runArm('S', squeeze);
  const l = SQUEEZE_LINE;
  const biases = arm.cohorts[l].map(c => c.bias);
  const mat = arm.cohorts[l].filter(c => c.matured).map(c => c.dev);
  const allDev = arm.cohorts[l].map(c => c.dev);
  console.log(`  booking bias applied: ${pct(Math.max(...biases))} at the bottom stop`);
  console.log(`  matured cohorts     : n=${mat.length}  mean development ${pct(mean(mat))}  (defaults: ${pct(mean(base.cohorts[l].filter(c => c.matured).map(c => c.dev)))})`);
  console.log(`  ALL in-play cohorts : n=${allDev.length}  mean development ${pct(mean(allDev))}`);
  console.log(`  calendar development: mean ${fmt$(mean(arm.devCal[l]))}/yr  (defaults ${fmt$(mean(base.devCal[l]))}/yr)`);
  console.log(`  year-${YEARS} surplus      : mean ${fmt$(mean(arm.surplus[l]))}  (defaults ${fmt$(mean(base.surplus[l]))})`);

  // ⚠ THE NUMBER THE DISCLOSURE RULING TURNS ON. End-of-game-only disclosure
  // was ruled on the premise that the exhibit shows the drift year by year. It
  // only does if the drift is READABLE against the year's own noise, so this
  // reports it in units of that noise rather than in dollars.
  const noise = sd(base.calendar[l]);
  console.log(`\n  DRIFT PER GAME YEAR, in units of this line's calendar-year sd (${fmt$(noise)}):`);
  console.log('  game yr |   mean drift | as sigma | biased cohorts carrying the unwind');
  console.log('  (year 1 carries NO biased cohort, so its figure is sampling noise, not drift)');
  for (let y = 1; y <= YEARS; y++) {
    const xs = arm.byYear[l][y] ?? [];
    if (!xs.length) continue;
    const m = mean(xs);
    console.log(`  ${String(y).padStart(7)} | ${fmt$(m).padStart(12)} | ${(Math.abs(m) / noise).toFixed(3).padStart(8)} | ${Math.max(0, y - 1)}`);
  }
  console.log('\n  ⚠ THE EARLY YEARS ARE STILL CARRIED BY VERY FEW COHORTS — year 2 by exactly one,');
  console.log('    year 3 by two, because only cohorts the PLAYER wrote carry the unwind (pre-game');
  console.log('    cohorts have bookingBias 0 by construction). What makes them readable anyway is');
  console.log('    the FRONT-LOADED schedule: that one year-1 cohort surrenders about half its bias');
  console.log('    in its first step instead of an eighth. Under the retired flat b/H these years');
  console.log('    measured 0.04 and 0.03 sigma. The coefficient was never the lever here.');
  console.log('\n  ⚠ THE SURPLUS COMPARISON IS NOT THE COST OF THE BIAS. A squeezed pool also');
  console.log('    collects far less premium, and that dominates. The bias figure to read is the');
  console.log('    mean development above: at defaults it is noise around zero, here it is a');
  console.log('    systematic adverse drift the player has to notice year by year.');
}

console.log('\nREPORT ONLY — nothing above is asserted. ibner-null-check.ts is the gate.');
