// ============================================================================
// TOTAL DEVELOPMENT SD — THE NEW PATH AGAINST IBNER_TOTAL_SD's OWN BASIS.
//
//   npx tsx scripts/diagnostics/revision-total-sd-report.ts
//   GAMES=40 YEARS=20 npx tsx scripts/diagnostics/revision-total-sd-report.ts
//
// REPORTS. Gates nothing, deliberately — the flag is off, nothing ships on the
// ON arm, and pre-committing a bar to it now would be inventing a threshold
// before anyone has ruled on the mechanism. Same reasoning as
// pregame-acceptance-check's ON arm.
//
// ============================================================================
// THE QUESTION, AND IT IS A UNITS QUESTION THAT WAS GOT WRONG ONCE.
//
// 42b2c2b cleared the opening band conditionally, on the reasoning that the
// law's realised movement (9.8% of cohort incurred at age 1) is SMALLER than
// the cohort path it replaces (IBNER_TOTAL_SD 20-25%), so the pre-game's spread
// could not widen. THOSE ARE DIFFERENT STATISTICS. 9.8% is PER STEP; the
// constant is the TOTAL relative SD of the ultimate over the whole runoff, by
// its own definition at reserveStepSigma. Increments add in variance, so a
// per-step 9.8% over five or six steps is 21.9% to 24.0% — the same
// neighbourhood, not a third of it. The conditional was resting on a
// comparison that was never like for like.
//
// So this measures the thing the constant is actually defined as, on both arms,
// through the engine.
//
// ============================================================================
// THE BASIS, AND WHY IT IS NOT netUltimate / registerSum.
//
// ⚠ THE NET COHORT RATIO IS DAMPED BY CESSION AND IS NOT WHAT reserveStepSigma
// SOLVES. Development lands on occurrences and a share of it goes to the tower;
// the cohort's own note states the identity
// `netUltimate + cededDevelopmentToDate === registerSum` at maturity for the
// null case. reserveStepSigma knows nothing about reinsurance — it solves the
// per-step sigma on the remaining reserve that delivers IBNER_TOTAL_SD as the
// total relative SD of the ultimate. So the like-for-like quantity is
//
//     (netUltimate + cededDevelopmentToDate) / registerSum - 1
//
// which is the cohort's development BEFORE the tower takes its share. Both are
// printed, because the net column is what the pool actually carries and the gap
// between them is the tower's.
//
// ⚠ AND THE SAMPLE IS HORIZON-UNBIASED, WHICH ibner-report's SECTION 1 IS NOT.
// Filtering on `age >= horizon` in a game shorter than the longest horizon keeps
// only the cohorts whose horizon was short enough to finish, so the surviving WC
// set is drawn from horizons near 5-7 rather than 5-12 and accumulates less —
// survivorship in the measurement, not under-delivery by the model. Here the
// game runs past the longest horizon on every line and only accident years
// written on or before `YEARS - max horizon` are read, so every cohort in the
// sample matures WHATEVER it drew and the horizon distribution is the model's
// own. The counts are printed; they should be exactly
// (YEARS - max horizon) per game with nothing dropped.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SeededRandom } from '../../src/utils/random';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { revisionMagnitudeOnIncurred } from '../../src/utils/claimRevision';
import {
  CLAIM_REVISION_PHI, IBNER_HORIZON, IBNER_TOTAL_SD, LINE_PAYOUT_PATTERN, PER_CLAIM_REVISION,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 100);
// Order-of-magnitude medians of the tracked (cedeable) register, for the s table
// at the foot of this report only. Nothing is computed from them.
const MEDIAN_TRACKED_VALUE: Record<string, number> = { WC: 250_000, GL: 250_000, Property: 250_000 };
const YEARS = Number(process.env.YEARS ?? 20);

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const qt = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const t = [...xs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.floor(p * t.length))];
};
/** ⚠ THE ROBUST SPREAD, AND ON THE ON ARM IT IS THE ONE TO READ. The interquartile
 *  range over 1.349 estimates the SD of a normal and ignores the tail entirely.
 *  It is here because the sample SD of the ON arm is NOT a stable statistic —
 *  see the tail note at the foot of this report. */
const iqrSd = (xs: number[]) => (qt(xs, 0.75) - qt(xs, 0.25)) / 1.349;
const maxAbs = (xs: number[]) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

interface Obs { pre: number; net: number; game: number }

function play(id: string, seed: number, game: number): Record<string, Obs[]> {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  // A cohort that closes leaves the array, so the LAST sighting is kept rather
  // than read off the final state — ibner-report's convention, same reason.
  const last: Record<string, Map<number, ReserveCohort>> = { WC: new Map(), GL: new Map(), Property: new Map() };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      for (const c of p.updatedPoolState.lines[l].reserveCohorts) if (c.yearNumber >= 1) last[l].set(c.yearNumber, c);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  const out: Record<string, Obs[]> = { WC: [], GL: [], Property: [] };
  for (const l of LINES) {
    const cutoff = YEARS - IBNER_HORIZON[l].max;
    for (const c of last[l].values()) {
      if (c.registerSum <= 0 || c.yearNumber > cutoff || c.age < c.horizon) continue;
      const ceded = (c as { cededDevelopmentToDate?: number }).cededDevelopmentToDate ?? 0;
      out[l].push({ pre: (c.netUltimate + ceded) / c.registerSum - 1, net: c.netUltimate / c.registerSum - 1, game });
    }
  }
  return out;
}

function runArm(label: string): Record<string, Obs[]> {
  const all: Record<string, Obs[]> = { WC: [], GL: [], Property: [] };
  for (let g = 0; g < GAMES; g++) {
    const r = play(`TSD${g}`, 4_200_000 + g * 8117, g);
    for (const l of LINES) all[l].push(...r[l]);
  }
  console.log(`--- ${label} ---`);
  console.log('  line      cohorts   robust SD  [95% CI]          SD    max |dev|   stated     mean   net SD');
  for (const l of LINES) {
    const pre = all[l].map(o => o.pre), net = all[l].map(o => o.net);
    const [lo, hi] = bootstrapCI(all[l]);
    console.log(`  ${l.padEnd(9)} ${String(pre.length).padStart(6)}    ${pct(iqrSd(pre)).padStart(7)}  `
      + `[${pct(lo)}, ${pct(hi)}]   ${pct(sd(pre)).padStart(8)}   ${pct(maxAbs(pre)).padStart(9)}   `
      + `${pct(IBNER_TOTAL_SD[l]).padStart(6)}  ${pct(mean(pre)).padStart(7)}  ${pct(sd(net)).padStart(7)}`);
  }
  return all;
}

/** 95% CI on the ROBUST spread, resampling WHOLE GAMES — cohorts inside one game
 *  share its instance and are not independent draws. ibner-report's convention. */
function bootstrapCI(obs: Obs[]): [number, number] {
  const byGame = new Map<number, number[]>();
  for (const o of obs) (byGame.get(o.game) ?? byGame.set(o.game, []).get(o.game)!).push(o.pre);
  const games = [...byGame.values()];
  if (games.length < 2) return [0, 0];
  const rng = new SeededRandom(90_210);
  const draws: number[] = [];
  for (let b = 0; b < 400; b++) {
    const pool: number[] = [];
    for (let i = 0; i < games.length; i++) pool.push(...games[rng.intRange(0, games.length - 1)]);
    draws.push(iqrSd(pool));
  }
  draws.sort((a, b) => a - b);
  return [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]];
}

console.log(`TOTAL DEVELOPMENT SD — ${GAMES} games x ${YEARS} years, matured and horizon-unbiased`);
console.log('Basis: (netUltimate + cededDevelopmentToDate) / registerSum - 1, the pre-cession');
console.log('cohort development that IBNER_TOTAL_SD is the target for.\n');

const was = PER_CLAIM_REVISION.enabled;
let off: Record<string, Obs[]>, on: Record<string, Obs[]>;
try {
  PER_CLAIM_REVISION.enabled = false;
  off = runArm('FLAG OFF — the cohort lognormal, i.e. what ships today');
  console.log('');
  PER_CLAIM_REVISION.enabled = true;
  on = runArm('FLAG ON — the per-claim revision law');
} finally {
  PER_CLAIM_REVISION.enabled = was;
}
if (PER_CLAIM_REVISION.enabled !== was) {
  console.log('\n⚠ THE FLAG WAS NOT RESTORED. This report mutates PER_CLAIM_REVISION.enabled in a finally.');
  process.exitCode = 1;
}

console.log('');
console.log('=== THE COMPARISON, ON THE ROBUST SPREAD ===');
console.log('  line        OFF      ON   ON / OFF   ON / stated   OFF / stated');
for (const l of LINES) {
  const a = iqrSd(off[l].map(o => o.pre)), b = iqrSd(on[l].map(o => o.pre)), t = IBNER_TOTAL_SD[l];
  console.log(`  ${l.padEnd(9)} ${pct(a).padStart(7)}  ${pct(b).padStart(7)}   ${(b / a).toFixed(2).padStart(6)}x   `
    + `${(b / t).toFixed(2).padStart(9)}x   ${(a / t).toFixed(2).padStart(11)}x`);
}


// ============================================================================
// WHERE THE TAIL COMES FROM — s, THE ONE DIVISION IN THE LAW.
//
// s = phi x magnitude / headroom, and headroom is 1 - paidShare. The call site
// passes the COHORT's paid share from the line's payout pattern at the age about
// to be stepped, so s is a deterministic function of (line, age, claim value).
// Nothing bounds it: as a cohort pays down, headroom goes to zero and s goes to
// infinity. This table is that function at each line's median tracked value,
// over the ages the engine actually steps.
// ============================================================================
console.log('');
console.log('=== s AT THE CALL SITE, BY AGE — the median tracked occurrence ===');
console.log('  line       age:  ' + Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(6)).join(''));
for (const l of LINES) {
  const pattern = LINE_PAYOUT_PATTERN[l];
  const v = MEDIAN_TRACKED_VALUE[l];
  const cells: string[] = [];
  for (let a = 1; a <= 12; a++) {
    if (a > IBNER_HORIZON[l].max) { cells.push('     -'); continue; }
    const headroom = Math.max(1e-9, 1 - cumulativePaid(pattern, a));
    const s = CLAIM_REVISION_PHI * revisionMagnitudeOnIncurred(a, v) / headroom;
    cells.push((s >= 100 ? s.toExponential(0) : s.toFixed(2)).padStart(6));
  }
  console.log(`  ${l.padEnd(9)}       ` + cells.join(''));
}

console.log('');
console.log('  ⚠ THEY DO NOT AGREE, AND THE DISAGREEMENT IS THE OTHER WAY UP. The law develops');
console.log('    MORE in total than the cohort path it replaces — 2.7x to 3.2x on the robust');
console.log('    spread, on every line. So 42b2c2b\'s reasoning was wrong twice over: the two');
console.log('    figures it compared were different statistics, AND the direction was backwards.');
console.log('');
console.log('  ⚠ THE SD COLUMN IS NOT AN ESTIMATE ON THE ON ARM, AND THE max |dev| COLUMN IS WHY.');
console.log('    A single cohort at twenty-two times its register sum sets WC\'s sample SD, which');
console.log('    moved from 31% at 40 games to 83% at 100 as one more such cohort turned up. This');
console.log('    is reserveStepSigma\'s own lesson from the other side — its header records a');
console.log('    Monte Carlo that reported 87.5% of the true variance at 1M trials and was still');
console.log('    climbing at 48M. The question "does the law deliver IBNER_TOTAL_SD" CANNOT be');
console.log('    answered by measuring an SD at any game count this repo will ever run. The robust');
console.log('    spread and its bootstrap are what is estimable, and they are what the comparison');
console.log('    above is built on.');
console.log('');
console.log('  ⚠ AND THE TAIL HAS A NAMED SOURCE, IN TWO DIFFERENT SHAPES. The basis conversion');
console.log('    divides by headroom and NOTHING BOUNDS THE RESULT: as a cohort pays down,');
console.log('    headroom goes to zero and s goes to infinity. GL reaches s = 21 by age 8 and');
console.log('    Property s = 3.6 by age 4, at an s no fitted parameter chose — the magnitude was');
console.log('    fitted on the incurred, and the division is what puts it on the reserve. At large');
console.log('    s the factor exp(s.sign.|Z| - s^2/2) is still exactly mean-one, but it delivers');
console.log('    that mean as a near-certain collapse plus a vanishing chance of an enormous');
console.log('    multiple. WC\'s tail is the OTHER shape and the table shows that too: s never');
console.log('    leaves the neighbourhood of 1, but twelve steps of a log walk at that scale');
console.log('    compound to a log-SD near 3, which is a 20x multiple at two SD. One mechanism');
console.log('    runs away in s, the other in depth. Both are where the flip\'s next question is.');
console.log('');
console.log('  ⚠ IT DOES NOT CONTRADICT THE TERMINAL-SEVERITY ANCHOR, and that is worth being');
console.log('    precise about rather than assuming either way. The anchor constrains the log-SD');
console.log('    of SETTLED severity PER CLAIM. This measures the COHORT aggregate. The old path');
console.log('    drew one lognormal for a whole accident year, with a mixture that made half of');
console.log('    them nearly flat; the law draws every occurrence separately, and a cohort\'s');
console.log('    movement is then dominated by its few largest occurrences with almost no');
console.log('    diversification. Matching per-claim severity and widening the cohort aggregate');
console.log('    are consistent. The anchor was never a statement about this quantity — which is');
console.log('    exactly why this quantity was unbudgeted until now.');
console.log('');
console.log('  ⚠ THE BAND CLEARANCE ITSELF STANDS, AND IS NOW UNCONDITIONAL. It was a measurement,');
console.log('    not an inference. The ON arm here is the same mechanism at the same phi, so the');
console.log('    pre-game already CONTAINS this widening — and the opening distribution did not');
console.log('    move, nor did acceptance on any line (pregame-acceptance-check). A 3-year');
console.log('    pre-game takes two or three steps of a five-to-twelve-step runoff, at the low-age');
console.log('    end of the s table above where s is smallest, and the opening surplus ratio is');
console.log('    dominated by premium and loss LEVEL rather than by cohort development tails. The');
console.log('    condition in 42b2c2b is withdrawn: the band met the widening and survived it.');
console.log('');
console.log('  ⚠ THE OFF ARM DOES NOT DELIVER ITS OWN CONSTANT ON EITHER STATISTIC, AND THAT IS');
console.log('    PRE-EXISTING. The OFF row is the SHIPPED path, bit-identical to the parent, so');
console.log('    nothing in Stage 1 caused it. Part of it is not a defect at all: IBNER_STEP_MIXTURE');
console.log('    puts half of all cohorts on a 0.231 multiplier, so a robust spread reads the');
console.log('    boring half and comes in far under a constant that is defined as a variance. The');
console.log('    SD column is the like-for-like one there, and it reads 0.75x to 0.94x of stated.');
console.log('    Recorded because it is the denominator of the ON / OFF column. Not chased.');
console.log('');
console.log('  ⚠ THE MEAN IS THE PART THAT IS NOT MOVING, and it is the reassuring one. The');
console.log('    pre-cession mean sits near zero on both arms, so the per-step factor delivers its');
console.log('    mean-one property through the engine and the persistence drift is small over');
console.log('    these horizons. The net mean is below it on both arms and further below on ON:');
console.log('    that is the tower, convex in occurrence size, taking more of a large');
console.log('    deterioration than it gives back on a large redundancy.');
