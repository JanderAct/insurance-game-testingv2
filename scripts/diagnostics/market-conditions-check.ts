// ============================================================================
// THE MARKET DERIVATION — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/market-conditions-check.ts
//   GAMES=8 DRAWS=4000 npx tsx scripts/diagnostics/market-conditions-check.ts
//
// marketConditions.ts is a benchmark: every member's grievance is measured
// against it and two more consumers are named to arrive. A benchmark that
// drifts, or that is noisier than the thing it judges, corrupts everything
// downstream of it silently — nothing would fail, members would simply be
// unhappy for a reason nobody chose. So the properties the module's header
// rests on are asserted here rather than argued there.
//
// SIX SECTIONS, AND SECTION 5 IS THE ONE A FUTURE COMPONENT WILL MEET.
//
//   1. THE TREND IDENTITY, TO FLOAT. With only the deterministic component,
//      the benchmark must reproduce RATE_NEUTRAL_CHANGE_PCT exactly at every
//      year. Not to a tolerance: the window is fixed-width and the component is
//      a power, so the residual is genuinely zero and anything else is a bug.
//
//   2. EVERY COMPONENT STRICTLY POSITIVE AND MEAN 1. The geometric window needs
//      positivity or it returns 0/NaN, and the whole neutral point rests on the
//      mean. A component with a mean away from 1 retunes the neutral silently,
//      which is the defect RATE_NEUTRAL_CHANGE_PCT exists to prevent.
//
//   3. PURITY. Two calls agree bit-for-bit, and the index is defined at the
//      NEGATIVE pre-game years — which is what makes the window full from year
//      1 rather than filling over the first ten played years.
//
//   4. THE UNBUILT COMPONENTS, PRINTED. An unbuilt component that lives only in
//      a comment is one nobody is reminded of. Two are declared; this says so
//      on every run and prints what each is blocked on.
//
//   5. QUIETER THAN THE RATE IT JUDGES. Per line, the benchmark's own SD must
//      be below the pool's measured rate-change SD. This is the assertion that
//      DISQUALIFIED the calendar component: reserveStepSigma taken at face
//      value puts about 20% SD on WC's market restatement against a pool rate
//      change of 3.4%, and a benchmark four times noisier than its subject
//      makes every grievance a reading of one hashed number.
//
//   6. THE POSITIVE CONTROL. Section 5 has to be shown to fire. A gPool
//      component with its deviation scaled up must red it — a noise test that
//      has never gone red is not a noise test.
//
// ⚠ AND THE RECORDED CALENDAR FIGURES ARE TIED BACK TO THE ENGINE HERE, which
// is the only reason simulationEngine exports reserveStepSigma. The module
// cannot call it (membershipEngine imports the module, so importing the engine
// back would close a cycle), so it carries the numbers and this re-derives them.
// If the IBNER constants move, the rejection argument in that header goes stale
// and this says so.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear, reserveStepSigma } from '../../src/utils/simulationEngine';
import {
  MARKET_COMPONENTS, MARKET_COMPONENTS_UNBUILT, MARKET_RATING_WINDOW,
  marketBreakdown, marketCostIndex, marketRateChangePct, type MarketComponent,
} from '../../src/utils/marketConditions';
import {
  IBNER_CALENDAR_RHO, RATE_NEUTRAL_CHANGE_PCT, TRIANGLE_HISTORY_YEARS, openShareAtStep,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
/**
 * ⚠ 16, AND THE REASON IS SECTION 5'S MARGIN ON WC. The pool side of that
 * comparison is the noisy one — GAMES x (YEARS - 1) observations of a
 * rate change against DRAWS x 4 of the benchmark — and WC is the line where the
 * two are closest: ratio 0.88 at 4 games, 0.88 at 8, 0.84 at 16. At 4 games the
 * pool's own SD read 3.17% against 3.34% at 16, which is a fifth of the margin
 * spent on sampling. A gate whose margin is its own noise is a gate that flakes.
 */
const GAMES = Number(process.env.GAMES ?? 16);
const YEARS = Number(process.env.YEARS ?? 10);
/** Draws for the mean-1 and dispersion measurements. Cheap — no engine. */
const DRAWS = Number(process.env.DRAWS ?? 3000);
/**
 * The control raises each non-deterministic component to this POWER rather than
 * scaling its deviation from 1.
 *
 * ⚠ SCALING THE DEVIATION WAS TRIED FIRST AND REDDENED THE GATE FOR THE WRONG
 * REASON. `1 + 8 (g - 1)` goes NEGATIVE whenever g < 0.875 — g's measured
 * minimum over 800 draws is 0.478 — and the geometric window then returns NaN,
 * so the comparison failed on a NaN rather than on a dispersion. A control that
 * reddens the gate by breaking it is not a control. A power keeps the component
 * strictly positive, which is section 2's requirement, and multiplies its log
 * dispersion by exactly this factor.
 */
const CONTROL_POWER = 4;

const failures: string[] = [];
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const sd = (v: number[]) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};
const ctxFor = (g: number) => ({ seed: 9_000_000 + g * 7919, gameId: `MKT${g}` });

console.log(RULE);
console.log('MARKET CONDITIONS — the benchmark every member is judged against');
console.log(RULE);
console.log(`Window ${MARKET_RATING_WINDOW} years (TRIANGLE_HISTORY_YEARS ${TRIANGLE_HISTORY_YEARS}), `
  + `${MARKET_COMPONENTS.length} built components, ${MARKET_COMPONENTS_UNBUILT.length} declared and unbuilt.`);
console.log(`${DRAWS} draws for the component laws, ${GAMES} games x ${YEARS} years on the engine.\n`);

// --- 1. the trend identity, to float ---------------------------------------
console.log('--- 1. the trend identity: the deterministic component alone reproduces the constant ---');
for (const line of LINES) {
  const target = RATE_NEUTRAL_CHANGE_PCT[line];
  let worst = 0;
  for (let y = -5; y <= 30; y++) {
    const b = marketBreakdown(line, y, ctxFor(0));
    const trend = b.components.find(c => c.name === 'trend');
    if (!trend) { failures.push(`no component named 'trend' — section 1 cannot run`); break; }
    worst = Math.max(worst, Math.abs(trend.soloChangePct - target));
  }
  const ok = worst <= 1e-9;
  console.log(`  ${line.padEnd(9)} target ${String(target).padStart(6)}   worst residual over 36 years ${worst.toExponential(2)}  ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: the trend component's solo change is ${worst.toExponential(2)} off `
      + `RATE_NEUTRAL_CHANGE_PCT. The window is fixed-width and the component is a power, so this `
      + `residual should be zero — a non-zero one means the window or the component changed shape.`);
  }
}

// --- 2. every component strictly positive, mean 1 ---------------------------
console.log('\n--- 2. component laws: strictly positive, mean 1 ---');
for (const c of MARKET_COMPONENTS) {
  for (const line of LINES) {
    const vals: number[] = [];
    let minSeen = Infinity;
    for (let g = 0; g < DRAWS; g++) {
      const v = c.factor(line, (g % 40) - 10, ctxFor(g));
      vals.push(v);
      minSeen = Math.min(minSeen, v);
    }
    const positive = minSeen > 0 && Number.isFinite(minSeen);
    if (!positive) {
      failures.push(`component '${c.name}' on ${line} returned ${minSeen}. The window mean is `
        + `GEOMETRIC — a zero sends the index to zero and a negative one to NaN.`);
    }
    // The deterministic component is a trend, not a mean-1 law. Its own
    // identity is section 1's; asserting a mean here would assert the shape of
    // the year range this loop happens to sweep.
    if (c.name === 'trend') {
      console.log(`  ${c.name.padEnd(10)} ${line.padEnd(9)} deterministic — min ${minSeen.toFixed(4)}  ${positive ? 'OK' : 'FAIL'}`);
      continue;
    }
    const m = mean(vals);
    const se = sd(vals) / Math.sqrt(vals.length);
    const centred = Math.abs(m - 1) <= 4 * se;
    console.log(`  ${c.name.padEnd(10)} ${line.padEnd(9)} mean ${m.toFixed(5)} +/- ${se.toFixed(5)}   `
      + `min ${minSeen.toFixed(4)}  ${positive && centred ? 'OK' : 'FAIL'}`);
    if (!centred) {
      failures.push(`component '${c.name}' on ${line} has mean ${m.toFixed(5)}, ${(Math.abs(m - 1) / se).toFixed(1)} `
        + `SE off 1. A component away from mean 1 retunes the neutral point silently.`);
    }
  }
}

// --- 3. purity and the pre-game years ---------------------------------------
console.log('\n--- 3. purity, and the window is full from year 1 ---');
{
  let repeatable = true;
  for (const line of LINES) {
    for (let y = -9; y <= YEARS; y++) {
      const a = marketRateChangePct(line, y, ctxFor(3));
      const b = marketRateChangePct(line, y, ctxFor(3));
      if (a !== b || !Number.isFinite(a)) repeatable = false;
    }
  }
  console.log(`  repeatable and finite at every year from -9 to ${YEARS}: ${repeatable ? 'OK' : 'FAIL'}`);
  if (!repeatable) {
    failures.push('marketRateChangePct is not repeatable, or is not finite at a pre-game year. '
      + 'It must be a pure function of (line, year, seed, gameId) at EVERY integer year — the '
      + 'window at played year 1 reaches back to year -9.');
  }
  const deepest = 1 - MARKET_RATING_WINDOW - 1;
  const c = marketCostIndex('WC', deepest, ctxFor(3));
  const ok = c > 0 && Number.isFinite(c);
  console.log(`  cost index at year ${deepest} (the deepest the year-1 window reaches) = ${c.toFixed(5)}  ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) failures.push(`the cost index is not evaluable at year ${deepest}, so the year-1 window cannot be full.`);
}

// --- 4. what is declared and not built --------------------------------------
console.log('\n--- 4. declared and NOT built ---');
for (const u of MARKET_COMPONENTS_UNBUILT) {
  console.log(`  ${u.name.padEnd(10)} ${u.kind.padEnd(13)} ${u.blockedOn}`);
}
{
  // The calendar rejection's own arithmetic, re-derived from the live engine so
  // the module's recorded figures cannot go stale behind it.
  const rho = IBNER_CALENDAR_RHO.rho;
  console.log('  the calendar figures, re-derived from the engine:');
  for (const line of LINES) {
    const s = Math.sqrt(rho) * reserveStepSigma(line);
    let open = 0;
    for (let a = 1; a <= TRIANGLE_HISTORY_YEARS; a++) open += openShareAtStep(line, a);
    open /= TRIANGLE_HISTORY_YEARS;
    console.log(`    ${line.padEnd(9)} sqrt(rho) x stepSigma ${s.toFixed(4)}   window open share ${open.toFixed(4)}   `
      + `implied SD on the window ${(100 * open * Math.sqrt(Math.exp(s * s) - 1)).toFixed(1)}%`);
  }
}

// --- 5. quieter than the rate it judges -------------------------------------
console.log('\n--- 5. the benchmark against the rate it judges ---');
function playRates(g: number): Record<string, number[]> {
  const id = `MKT${g}`;
  const instance = generateGameInstance(id, 9_000_000 + g * 7919);
  const setup = { poolName: 'M', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y) as DecisionSet);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    for (const lr of p.lineResults) {
      out[lr.line as string].push((lr.result as never as Record<string, number>).ratePer100);
    }
  }
  return out;
}

const poolChange: Record<string, number[]> = { WC: [], GL: [], Property: [] };
for (let g = 0; g < GAMES; g++) {
  const r = playRates(g);
  for (const line of LINES) {
    for (let i = 1; i < r[line].length; i++) poolChange[line].push((r[line][i] / r[line][i - 1] - 1) * 100);
  }
}

/**
 * The benchmark's own dispersion, over DRAWS independent games.
 *
 * ⚠ THROUGH THE MODULE'S OWN marketRateChangePct, WITH ITS COMPONENT LIST
 * OVERRIDDEN — not through a copy of the window arithmetic here. A gate that
 * reimplements the thing it is asserting can pass while the shipped path is
 * broken, which is the whole reason the module takes the list as an argument.
 */
function benchSd(line: CoverageLine, components: readonly MarketComponent[]): number {
  const v: number[] = [];
  for (let g = 0; g < DRAWS; g++) {
    for (let y = 1; y <= 4; y++) v.push(marketRateChangePct(line, y, ctxFor(100_000 + g), components));
  }
  return sd(v);
}

for (const line of LINES) {
  const b = benchSd(line, MARKET_COMPONENTS);
  const p = sd(poolChange[line]);
  const ok = b < p;
  console.log(`  ${line.padEnd(9)} benchmark SD ${b.toFixed(2)}%   pool rate-change SD ${p.toFixed(2)}%   `
    + `ratio ${(b / p).toFixed(2)}  ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: the market benchmark's SD is ${b.toFixed(2)}% against the pool's own `
      + `rate-change SD of ${p.toFixed(2)}%. A benchmark noisier than its subject makes every member's `
      + `grievance a reading of the benchmark's own draw rather than of a decision. See the calendar `
      + `component's rejection in marketConditions.ts — this is the assertion that made it.`);
  }
}

// --- 6. the positive control ------------------------------------------------
console.log(`\n--- 6. positive control: every non-deterministic component raised to the power ${CONTROL_POWER} ---`);
{
  const loud: MarketComponent[] = MARKET_COMPONENTS.map(c => (c.name === 'trend' ? c : {
    ...c,
    factor: (line, y, ctx) => Math.pow(c.factor(line, y, ctx), CONTROL_POWER),
  }));
  let fired = 0;
  for (const line of LINES) {
    const b = benchSd(line, loud);
    const p = sd(poolChange[line]);
    const red = !(b < p);
    if (red) fired++;
    console.log(`  ${line.padEnd(9)} benchmark SD ${b.toFixed(2)}%   pool ${p.toFixed(2)}%   ${red ? 'RED (correct)' : 'still green'}`);
    if (!Number.isFinite(b)) {
      failures.push(`the control produced a non-finite SD on ${line}. It must red section 5 by being `
        + `NOISY, not by being invalid — see CONTROL_POWER.`);
    }
  }
  console.log(`  ${fired}/3 lines red under the control`);
  if (fired < 3) {
    failures.push(`the positive control reddened only ${fired} of 3 lines at power ${CONTROL_POWER}. `
      + `Section 5's assertion has not been shown to fire, and a noise test that cannot go red is not one.`);
  }
}

console.log('\n' + RULE);
if (failures.length === 0) {
  console.log('MARKET CONDITIONS HOLD.');
  console.log(RULE);
  process.exit(0);
}
console.log(`${failures.length} FAILURE(S):`);
for (const f of failures) console.log(`  - ${f}`);
console.log(RULE);
process.exit(1);
