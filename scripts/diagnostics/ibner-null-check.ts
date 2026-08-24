// IBNER NULL TEST — does the plumbing change anything on its own?
//
//   npx tsx scripts/diagnostics/ibner-null-check.ts
//
// ============================================================================
// WHY A NULL TEST AND NOT A BEFORE/AFTER DIFF.
//
// The cutover deletes a draw the old code spent filling a field nobody read
// (`developmentFactor: 1 + devRng.range(-0.05, 0.08)`), and replaces a
// one-uniform-per-cohort loop with a different number of draws from a
// different stream. Every draw after that point re-rolls. A raw before/after
// comparison therefore mixes the MECHANISM change with a reseed and can
// attribute nothing.
//
// So the test is a NULL: turn IBNER off at its own constants and assert the
// engine collapses to a known closed form. With every scale and the bias at
// zero, no cohort's estimate can move, so development must be identically zero
// and the rollforward must reduce to
//
//     netIncurredLoss === netUltimateLoss
//
// on EVERY line-year. That is the same identity the old mechanism satisfied
// with its band forced to 1.0, so the two products agree at the null even
// though their draw sequences differ — which is exactly the claim that
// "the plumbing is unchanged, only the distribution moved".
//
// ⚠ THE ASSERTION IS EXACT AND UNTOLERANCED, which it could not have been
// against the old mechanism. That one marked a cohort closed at a residual
// balance under $1,000 and then filtered it out the following year, silently
// dropping the liability — the audit page carries it as a declared
// closed-cohort variance, worst measured $2,278 at pool scope. processIbner
// PAYS the residual at closure instead, so the rollforward is an exact
// identity and this gate needs no allowance for a real leak to hide under.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { IBNER_TOTAL_SD, IBNER_BOOKING_BIAS_COEFF, SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, LineResultSet, DecisionSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 12);
const YEARS = Number(process.env.YEARS ?? 10);

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const fmt$ = (x: number) => Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(2)}k`;

// ⚠ THE NULL IS ASSERTED AGAINST THE CONSTANTS, NOT ASSUMED.
// If someone sets a scale to zero permanently this check would pass vacuously
// while testing nothing, so it first confirms the SHIPPED constants are
// non-zero — i.e. that turning them off is a real intervention.
console.log('=== 0. THE SHIPPED CONSTANTS ARE LIVE (so the null is a real intervention) ===');
for (const l of LINES) {
  console.log(`  IBNER_TOTAL_SD.${l.padEnd(9)} = ${IBNER_TOTAL_SD[l]}  ` +
    `${note(IBNER_TOTAL_SD[l] > 0, `IBNER_TOTAL_SD.${l} is zero — the null test below would pass vacuously`)}`);
}
console.log(`  IBNER_BOOKING_BIAS_COEFF = ${IBNER_BOOKING_BIAS_COEFF}  ` +
  `${note(IBNER_BOOKING_BIAS_COEFF > 0, 'IBNER_BOOKING_BIAS_COEFF is zero — the bias arm below would pass vacuously')}`);

// The null is produced by DECISIONS, not by editing constants: funding at or
// above break-even sets the bias to exactly 0 by construction (CLF >= 1.000),
// which is the half of the null that can be reached without touching source.
// The scale half genuinely needs the constants stubbed, so this harness reads
// them through a local override that mirrors what the engine reads.
console.log('\n=== 1. BIAS IS EXACTLY ZERO AT OR ABOVE BREAK-EVEN FUNDING ===');
console.log('  fundingAtExpected pins CLF to 1.000, so squeeze = max(0, 1 - CLF) = 0.');
console.log('  Asserted through the engine: every cohort written at defaults carries bookingBias 0.\n');

function play(id: string, seed: number, mutate?: (d: DecisionSet) => DecisionSet) {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'N', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const rows: { line: CoverageLine; r: LineResultSet }[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const d = mutate ? mutate(defaultDecisionSet(y)) : defaultDecisionSet(y);
    const p = processYear(gs, d);
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
      if (r) rows.push({ line: l, r });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return rows;
}

// --- THE NULL ARM ----------------------------------------------------------
// Scales stubbed to zero in place, restored immediately after. Done by direct
// mutation of the exported record rather than by editing the file, so the
// harness is self-contained and cannot leave the tree modified.
const SAVED = { ...IBNER_TOTAL_SD };
for (const l of LINES) (IBNER_TOTAL_SD as Record<string, number>)[l] = 0;

console.log('=== 2. THE NULL: all scales 0, funding at defaults (bias 0) ===');
console.log('  netIncurredLoss must equal netUltimateLoss on every line-year.\n');
{
  // FLOAT NOISE ONLY. These are sums of millions, so the identity holds to
  // relative precision rather than to the last cent; 1e-6 of a dollar is far
  // below any real leak and far above double-precision accumulation error.
  const EPS = 1e-6;
  const worst: Record<string, number> = {};
  for (const l of LINES) worst[l] = 0;
  let devMax = 0;

  for (let g = 0; g < GAMES; g++) {
    for (const { line, r } of play(`NULL${g}`, 9_100_000 + g * 6421)) {
      worst[line] = Math.max(worst[line], Math.abs(r.netIncurredLoss - r.netUltimateLoss));
      devMax = Math.max(devMax, Math.abs(r.priorYearDevelopment));
    }
  }

  for (const l of LINES) {
    console.log(`  ${l.padEnd(9)} worst |netIncurred - netUltimate| ${worst[l].toExponential(2).padStart(11)}  ` +
      `${note(worst[l] <= EPS, `${l}: the null does not collapse to netIncurredLoss === netUltimateLoss (gap ${fmt$(worst[l])})`)}`);
  }
  console.log(`\n  worst |priorYearDevelopment| anywhere at the null: ${devMax.toExponential(2)}  ` +
    `${note(devMax <= EPS, `development is non-zero at the null (${fmt$(devMax)}) — a scale or the bias is still live`)}`);
}

// --- THE BIAS ARM ----------------------------------------------------------
// Scales still zero, but funding squeezed. Development must now be purely the
// deterministic unwind: strictly adverse, never favorable, and never zero.
console.log('\n=== 3. SCALES 0 BUT FUNDING SQUEEZED: development is the unwind alone ===');
console.log('  With no stochastic term the bias must show as STRICTLY adverse development.\n');
{
  const squeeze = (d: DecisionSet): DecisionSet => ({
    ...d,
    byLine: Object.fromEntries(LINES.map(l =>
      [l, { ...d.byLine[l], fundingConfidenceLevel: 0.30, fundingAtExpected: false }])) as never,
  });
  const sign: Record<string, { adverse: number; favorable: number; zero: number }> = {};
  for (const l of LINES) sign[l] = { adverse: 0, favorable: 0, zero: 0 };

  for (let g = 0; g < GAMES; g++) {
    for (const { line, r } of play(`BIAS${g}`, 9_700_000 + g * 5119, squeeze)) {
      const d = r.priorYearDevelopment;
      if (d < -1) sign[line].adverse++;          // negative = adverse, per the field's convention
      else if (d > 1) sign[line].favorable++;
      else sign[line].zero++;
    }
  }
  for (const l of LINES) {
    const s = sign[l];
    console.log(`  ${l.padEnd(9)} adverse ${String(s.adverse).padStart(4)}  favorable ${String(s.favorable).padStart(4)}  ~zero ${String(s.zero).padStart(4)}  ` +
      `${note(s.favorable === 0, `${l}: favorable development with the stochastic term off — the unwind has the wrong sign`)}`);
  }
  console.log('\n  ⚠ ~zero rows are EXPECTED and are not a failure: year 1 has no prior cohort to');
  console.log('    develop, and pre-game cohorts carry bookingBias 0 by construction, so a game');
  console.log('    whose open cohorts are all pre-game shows no unwind at all.');
}

// --- THE EXACTNESS ARM ------------------------------------------------------
// ⚠ THE UNWIND MUST LAND EXACTLY ON registerSum, NOT MERELY POINT UPWARDS.
// Section 3 only checks the SIGN, which a schedule that under- or over-shoots
// would still pass. With the stochastic term off, a MATURED cohort's estimate
// is a deterministic function of its booking bias and its schedule, so
// netUltimate/registerSum must be exactly 1 — any residual is a permanent
// mis-statement of ultimate that no later year corrects.
console.log('\n=== 4. MATURED COHORTS LAND EXACTLY ON registerSum (scales 0, squeezed) ===');
console.log('  E[estimate(H)] = registerSum is the whole reason the unwind exists.\n');
{
  // ⚠ EACH LINE'S OWN REACHABLE MINIMUM, not a flat 0.10. WC's slider runs to
  // stop 10 (WC_FUNDING_CONFIDENCE_RANGE); GL and Property stop at 30
  // (SLIDER_RANGES). Driving all three to 0.10 would measure Property at a
  // 41.5% booking bias the UI cannot produce, which overstates the residual
  // without testing anything the game can reach.
  const MIN_STOP: Record<string, number> = {
    WC: WC_FUNDING_CONFIDENCE_RANGE.min,
    GL: SLIDER_RANGES.fundingConfidenceLevel.min,
    Property: SLIDER_RANGES.fundingConfidenceLevel.min,
  };
  const squeezeAll = (d: DecisionSet): DecisionSet => ({
    ...d,
    byLine: Object.fromEntries(LINES.map(l =>
      [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
  });
  const worst: Record<string, { resid: number; n: number; bias: number; H: number }> = {};
  for (const l of LINES) worst[l] = { resid: 0, n: 0, bias: 0, H: 0 };

  for (let g = 0; g < GAMES; g++) {
    const id = `EXACT${g}`;
    const inst = generateGameInstance(id, 8_400_000 + g * 5443);
    const setup = { poolName: 'E', gameLength: 20, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const seen = new Map<string, { dev: number; bias: number; H: number }>();
    // TWENTY years, not ten: a cohort has to MATURE for this assertion to mean
    // anything, and WC draws horizons up to 12.
    for (let y = 1; y <= 20; y++) {
      const p = processYear(gs, squeezeAll(defaultDecisionSet(y)));
      for (const l of LINES) {
        for (const c of p.updatedPoolState.lines[l].reserveCohorts) {
          if (c.yearNumber >= 1 && c.bookingBias > 0 && c.age >= c.horizon && c.registerSum > 0) {
            seen.set(`${l}:${c.yearNumber}`, { dev: c.netUltimate / c.registerSum - 1, bias: c.bookingBias, H: c.horizon });
          }
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    for (const [k, v] of seen) {
      const l = k.split(':')[0];
      worst[l].n++;
      if (Math.abs(v.dev) > Math.abs(worst[l].resid)) worst[l] = { resid: v.dev, n: worst[l].n, bias: v.bias, H: v.H };
    }
  }
  const EXACT_EPS = 1e-9;
  for (const l of LINES) {
    const w = worst[l];
    console.log(`  ${l.padEnd(9)} n=${String(w.n).padStart(4)} matured biased cohorts  worst residual ` +
      `${(w.resid * 100).toFixed(4).padStart(9)}%  (bias ${(w.bias * 100).toFixed(2)}%, H=${w.H})  ` +
      `${note(Math.abs(w.resid) <= EXACT_EPS, `${l}: a matured cohort missed registerSum by ${(w.resid * 100).toFixed(4)}% — the unwind schedule does not total the booking bias`)}`);
  }
}

for (const l of LINES) (IBNER_TOTAL_SD as Record<string, number>)[l] = SAVED[l];
console.log(`\n  constants restored: ${LINES.map(l => `${l} ${IBNER_TOTAL_SD[l]}`).join(', ')}  ` +
  `${note(LINES.every(l => IBNER_TOTAL_SD[l] === SAVED[l]), 'the harness failed to restore IBNER_TOTAL_SD')}`);

console.log(problems.length === 0
  ? '\nALL IBNER NULL CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
