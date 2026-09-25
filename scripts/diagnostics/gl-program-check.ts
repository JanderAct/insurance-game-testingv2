// ============================================================================
// THE GL ANALYTICS PROGRAM REACHES GL'S FREQUENCY AND NOTHING ELSE — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/gl-program-check.ts
//
// riskControlPrograms.ts is the first thing to write a risk-control effect into
// the loss draw. Its whole claim is a CONFINEMENT claim — GL only, frequency
// only, the pool only, and nothing at all until the ramp starts — and every
// part of that is assertable against a paired run rather than argued.
//
// WHAT IT ASSERTS
//   RAMP        the multiplier by tenure is exactly 1, 0.975, 0.95, 0.95 —
//               read from the function the engine calls, not recomputed here.
//   YEAR ONE    a game with the program committed is BIT-IDENTICAL to one
//               without, for the whole first year, on every line. The ramp is 0
//               there, so "no effect" must mean no effect at all rather than a
//               small one. This is the negative control and it is the assertion
//               most likely to catch a wiring mistake: anything that touched a
//               seed, an order of draws or a rounding path would break it while
//               leaving the dollar figures looking plausible.
//   OTHER LINES in a three-line game with the GL program committed, WC's and
//               Property's gross losses are bit-identical to the unprogrammed
//               run at every year. The program is scoped GL; this is what says
//               so.
//   DIRECTION   at full ramp GL's gross loss FALLS, and falls by roughly the
//               reduction — within a tolerance, because a Poisson draw at a
//               lower lambda is not the same claims minus 5%.
//   RESET       a program dropped for a year restarts its ramp at zero rather
//               than banking tenure.
//   MARKETPLACE the prospect draw is untouched — a program the pool bought must
//               not reach members who are not in it. Asserted through the
//               marketplace loss ledger, which is what the Underwriting
//               document reads.
//
// WHAT IT DOES NOT ASSERT: that 5% is the right number. That is a calibration
// question and it belongs to the measurement in gl-program-value.ts, which
// prints what the reduction is worth against the placeholder cost and has no
// pass condition because "worth buying" is a judgement.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  GL_ANALYTICS_FREQUENCY_REDUCTION, programFreqMultiplier, programTenure,
  GL_ANALYTICS_BUILD_ANNUAL_COST, GL_ANALYTICS_MAINTENANCE_ANNUAL_COST,
  BENEFIT_DECAY_PER_LAPSED_YEAR, glAnalyticsStanding,
} from '../../src/utils/riskControlPrograms';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const PROGRAM = 'gl-law-enforcement-analytics';
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 4);
const ALL: CoverageLine[] = ['WC', 'GL', 'Property'];
const CENT = 0.01;

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const ok = (cond: boolean, msg: string) => { if (!cond) fail(msg); };

/** Play one game, returning per-year gross loss by line. `ids(y)` picks the commitments. */
function play(g: number, lines: CoverageLine[], ids: (y: number) => string[]) {
  const id = `GPC${g}`;
  const inst = generateGameInstance(id, 5_500_000 + g * 8171);
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: { gross: Record<string, number>; claims: number; charge: number; surplus: number; market: number }[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const d: DecisionSet = { ...defaultDecisionSet(y), riskControlProgramIds: ids(y) };
    const p = processYear(gs, d);
    const r = p.result as never as {
      byLine: Record<string, {
        grossUltimateLoss: number; claimCount?: number; riskControlInvestment: number;
        endingSurplus: number;
        marketMemberLossResults?: { actual: number }[];
      }>;
    };
    const gross: Record<string, number> = {};
    for (const l of lines) gross[l] = r.byLine[l]?.grossUltimateLoss ?? 0;
    const mk = r.byLine.GL?.marketMemberLossResults ?? [];
    out.push({
      gross, claims: r.byLine.GL?.claimCount ?? 0,
      charge: r.byLine.GL?.riskControlInvestment ?? 0,
      surplus: r.byLine.GL?.endingSurplus ?? 0,
      market: mk.reduce((s, m) => s + (m.actual ?? 0), 0),
    });
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
  return out;
}

const never = () => [] as string[];
const always = () => [PROGRAM];

console.log('=== GL ANALYTICS PROGRAM — CONFINEMENT ===');
console.log(`${GAMES} games x ${YEARS} years. full-ramp reduction ${(100 * GL_ANALYTICS_FREQUENCY_REDUCTION).toFixed(1)}%\n`);

// --- 1. THE RAMP ------------------------------------------------------------
console.log('--- 1. the multiplier by tenure, from the engine\'s own function ---');
const expect = [1, 1 - GL_ANALYTICS_FREQUENCY_REDUCTION / 2, 1 - GL_ANALYTICS_FREQUENCY_REDUCTION,
  1 - GL_ANALYTICS_FREQUENCY_REDUCTION];
for (let t = 1; t <= 4; t++) {
  const prior = Array.from({ length: t - 1 }, () => [PROGRAM]);
  const m = programFreqMultiplier('GL', [PROGRAM], prior);
  console.log(`   tenure ${t}: ${m.toFixed(4)}  (expected ${expect[t - 1].toFixed(4)})`);
  ok(Math.abs(m - expect[t - 1]) < 1e-12, `tenure ${t}: multiplier ${m} != ${expect[t - 1]}`);
}
ok(programFreqMultiplier('WC', [PROGRAM], [[PROGRAM], [PROGRAM]]) === 1, 'WC received a GL program multiplier');
ok(programFreqMultiplier('Property', [PROGRAM], [[PROGRAM], [PROGRAM]]) === 1, 'Property received a GL program multiplier');
ok(programFreqMultiplier('GL', [], []) === 1, 'GL moved with nothing committed');
ok(programFreqMultiplier('GL', ['not-a-real-program'], []) === 1, 'an unknown program id moved GL');
console.log('   other lines and an uncommitted GL read 1.0000: OK');

// --- 2. RESET ---------------------------------------------------------------
console.log('\n--- 2. tenure resets when a program is dropped ---');
ok(programTenure(PROGRAM, [PROGRAM], [[PROGRAM], [PROGRAM]]) === 3, 'three consecutive years did not read tenure 3');
ok(programTenure(PROGRAM, [PROGRAM], [[PROGRAM], [], [PROGRAM]]) === 2, 'a gap did not reset the run');
ok(programTenure(PROGRAM, [], [[PROGRAM], [PROGRAM]]) === 0, 'an uncommitted year read non-zero tenure');
console.log('   3 consecutive -> 3, gap -> 2, uncommitted -> 0: OK');

// --- 3. YEAR ONE IS BIT-IDENTICAL, AND OTHER LINES ALWAYS ARE ---------------
console.log('\n--- 3. paired games, three lines: year 1 and the other two lines ---');
let y1Checked = 0, otherChecked = 0;
for (let g = 0; g < GAMES; g++) {
  const off = play(g, ALL, never);
  const on = play(g, ALL, always);
  for (const l of ALL) {
    y1Checked++;
    if (Math.abs(off[0].gross[l] - on[0].gross[l]) > CENT) {
      fail(`g${g} ${l} YEAR 1: ${off[0].gross[l]} != ${on[0].gross[l]} — ramp is 0, so year 1 must not move`);
    }
  }
  for (let y = 0; y < YEARS; y++) {
    for (const l of ['WC', 'Property']) {
      otherChecked++;
      if (Math.abs(off[y].gross[l] - on[y].gross[l]) > CENT) {
        fail(`g${g} ${l} y${y + 1}: ${off[y].gross[l]} != ${on[y].gross[l]} — the program is scoped GL`);
      }
    }
  }
  // --- 4. MARKETPLACE ------------------------------------------------------
  for (let y = 0; y < YEARS; y++) {
    if (Math.abs(off[y].market - on[y].market) > CENT) {
      fail(`g${g} y${y + 1}: the MARKETPLACE loss ledger moved (${off[y].market} != ${on[y].market}) — `
        + 'a program the pool bought reached members who are not in it');
    }
  }
}
console.log(`   year-1 line-figures compared: ${y1Checked}, all identical`);
console.log(`   WC/Property line-years compared: ${otherChecked}, all identical`);
console.log('   marketplace ledger unchanged at every year: OK');

// --- 5. DIRECTION AND SIZE, ON CLAIM COUNT ---------------------------------
//
// ⚠ ASSERTED ON CLAIM COUNT, NOT ON GROSS LOSS, AND THE FIRST VERSION OF THIS
// SECTION USED GROSS LOSS AND WAS A BAD INSTRUMENT. The program multiplies
// lambda, so claim COUNT is what it acts on directly: counts are Poisson, they
// pool across games and years into a large N, and their relative standard error
// falls as 1/sqrt(N). Gross loss multiplies each of those counts by a
// heavy-tailed severity draw, so it carries the frequency signal plus a much
// larger severity variance. Measured, the same 6 games read a 10.69% "cut" on
// gross loss against a nominal 5% — an estimate so noisy that the only band
// that would hold was 0.4x to 2.2x of the nominal, which is not an assertion
// about the magnitude at all. On counts the same runs resolve it properly.
//
// Gross loss is still PRINTED, because it is the thing anyone cares about — it
// is simply not the thing to assert on at this sample size.
console.log('\n--- 5. at full ramp GL falls, by about the reduction ---');
let nOff = 0, nOn = 0, sumOff = 0, sumOn = 0;
for (let g = 0; g < GAMES; g++) {
  const off = play(g, ['GL'], never);
  const on = play(g, ['GL'], always);
  for (let y = 2; y < YEARS; y++) {
    nOff += off[y].claims; nOn += on[y].claims;
    sumOff += off[y].gross.GL; sumOn += on[y].gross.GL;
  }
}
const realised = 1 - nOn / nOff;
const grossCut = 1 - sumOn / sumOff;
console.log(`   years 3+: claims ${nOff} -> ${nOn}, realised cut ${(100 * realised).toFixed(2)}% `
  + `against a nominal ${(100 * GL_ANALYTICS_FREQUENCY_REDUCTION).toFixed(2)}%`);
console.log(`   (gross loss ${(sumOff / 1e6).toFixed(2)}M -> ${(sumOn / 1e6).toFixed(2)}M, `
  + `${(100 * grossCut).toFixed(2)}% — REPORTED, not asserted: severity variance dominates it)`);
ok(realised > 0, 'GL claim count did not fall at full ramp');
// Poisson counts over N ~ 3,600 claims per arm: the relative SE of the
// difference is about sqrt(2/N) = 2.4%, so +/- 40% of a 5% nominal is roughly
// three SE and the band is tight enough to mean something.
ok(realised > GL_ANALYTICS_FREQUENCY_REDUCTION * 0.6 && realised < GL_ANALYTICS_FREQUENCY_REDUCTION * 1.4,
  `realised claim-count cut ${(100 * realised).toFixed(2)}% is not within 0.6x-1.4x of the nominal `
  + `${(100 * GL_ANALYTICS_FREQUENCY_REDUCTION).toFixed(2)}%`);

// --- 6. THE COST SCHEDULE, FROM THE FUNCTION THE ENGINE CALLS ----------------
console.log('\n--- 6. the cost schedule and the ramp, by tenure ---');
console.log('   tenure   committed   cost        benefit fraction   label');
const B = GL_ANALYTICS_BUILD_ANNUAL_COST, MNT = GL_ANALYTICS_MAINTENANCE_ANNUAL_COST;
const expectCost = [B, B, B, MNT, MNT];
const expectLevel = [0, 0.5, 1, 1, 1];
for (let t = 1; t <= 5; t++) {
  const prior = Array.from({ length: t - 1 }, () => [PROGRAM]);
  const st = glAnalyticsStanding([PROGRAM], prior);
  console.log(`      ${t}      ${String(st.committed).padEnd(9)}   $${(st.annualCost / 1e6).toFixed(2)}M       `
    + `${st.benefitFraction.toFixed(2)}             ${st.maintaining ? 'maintained' : 'build'}`);
  ok(st.annualCost === expectCost[t - 1], `tenure ${t}: cost $${st.annualCost} != $${expectCost[t - 1]}`);
  ok(Math.abs(st.benefitFraction - expectLevel[t - 1]) < 1e-12,
    `tenure ${t}: benefit ${st.benefitFraction} != ${expectLevel[t - 1]}`);
}
ok(glAnalyticsStanding([], []).annualCost === 0, 'an uncommitted year was charged');
// ⚠ THE ONE THE BRIEF NAMES: after the build the charge DROPS to maintenance,
// it does not stop. A program that fell to zero cost would be a free benefit
// forever, which is the button this commit exists to remove.
ok(glAnalyticsStanding([PROGRAM], Array.from({ length: 3 }, () => [PROGRAM])).annualCost === MNT,
  'year 4 did not fall to the maintenance charge');
ok(MNT > 0, 'the maintenance charge is zero — declining it would cost nothing');
console.log(`   after the build the charge falls $${(B / 1e6).toFixed(1)}M -> $${(MNT / 1e3).toFixed(0)}k, not to zero: OK`);

// --- 7. LAPSE DECAYS, IT DOES NOT CLIFF -------------------------------------
console.log('\n--- 7. declining the maintenance ends the benefit, by halves ---');
const built = Array.from({ length: 3 }, () => [PROGRAM]);
let lapsePrior = [...built];
for (let gap = 1; gap <= 4; gap++) {
  const st = glAnalyticsStanding([], lapsePrior);
  // half each year, zeroed once below an eighth — so 0.5 / 0.25 / 0.125 / 0
  const raw = Math.pow(BENEFIT_DECAY_PER_LAPSED_YEAR, gap);
  const expected = raw < 0.125 ? 0 : raw;
  console.log(`   ${gap} year(s) after stopping: benefit ${st.benefitFraction.toFixed(3)}, charged $${st.annualCost}`);
  ok(Math.abs(st.benefitFraction - expected) < 1e-9,
    `gap ${gap}: benefit ${st.benefitFraction} != ${expected}`);
  ok(st.annualCost === 0, `gap ${gap}: a stopped program was still charged`);
  lapsePrior = [...lapsePrior, []];
}
ok(glAnalyticsStanding([], built).benefitFraction < 1,
  'stopping left the benefit at full strength — the maintenance decides nothing');
ok(glAnalyticsStanding([], built).benefitFraction > 0,
  'stopping zeroed the benefit immediately — that is the cliff the ruling rejects');

// --- 8. THE MONEY ACTUALLY LEAVES -------------------------------------------
console.log('\n--- 8. paired games: the charge reaches the books, and year 1 costs without paying ---');
let chargeChecked = 0;
for (let g = 0; g < GAMES; g++) {
  const off = play(g, ['GL'], never);
  const on = play(g, ['GL'], always);
  for (let y = 0; y < YEARS; y++) {
    chargeChecked++;
    const expected = y < 3 ? B : MNT;
    const delta = on[y].charge - off[y].charge;
    if (Math.abs(delta - expected) > CENT) {
      fail(`g${g} y${y + 1}: risk-control charge moved by ${delta}, expected ${expected}`);
    }
  }
  // Year 1 buys NOTHING and costs $1M, so surplus must be LOWER by about the
  // charge. This is the assertion that says the spend is real rather than
  // recorded: a cost that did not reach cash would leave surplus untouched.
  const d1 = on[0].surplus - off[0].surplus;
  if (!(d1 < -0.5 * B)) {
    fail(`g${g}: year-1 GL surplus moved ${d1.toFixed(0)} — a $${(B / 1e6).toFixed(0)}M charge with no benefit `
      + 'must reduce surplus, so the spend is not reaching the books');
  }
}
console.log(`   line-years with the charge compared: ${chargeChecked}, all exact`);
console.log('   year-1 surplus falls by about the charge in every game: OK');

console.log(`\n${'='.repeat(72)}`);
if (failed.length) {
  console.log(`FAIL — ${failed.length} problem(s):`);
  for (const f of failed) console.log(`  ${f}`);
  console.log('='.repeat(72));
  process.exit(1);
}
console.log('THE GL ANALYTICS PROGRAM REACHES GL\'S FREQUENCY AND NOTHING ELSE.');
console.log('='.repeat(72));
