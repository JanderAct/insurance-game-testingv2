// GL'S SUPPLIED CLF CURVE — this is what guards it.
//
// Run: npx tsx scripts/diagnostics/gl-supplied-clf-check.ts
//
// GL now prices off a SUPPLIED real-pool curve rather than its own derived one.
// The supplied curve describes a bigger, smoother book (implied annual CV ~0.40
// against GL's measured ~0.79), so its stop labels do NOT mean what they say
// against GL's own retained distribution. That is a known, accepted cost of a
// deliberate placeholder — but it has to be MEASURED and kept measured, not
// asserted once and forgotten.
//
// WHAT IS ASSERTED (hard, will fail the run):
//   1. The supplied curve is monotonic and crosses 1.000 at 57.7%.
//   2. "Expected" still pins the multiplier at EXACTLY 1.000 — bit-exact, not
//      near — on both lines. The supplied curve must not leak into that path.
//   3. Every confidence level the UI can request falls INSIDE the supplied
//      curve's 25-95 range, so no reachable slider position is answered by a
//      clamp.
//   4. WC's table is untouched and still crosses at 47.2%.
//
// WHAT IS MEASURED AND REPORTED (not gated — it is a property of a placeholder,
// and gating on it would just encode the placeholder):
//   the delivered adequacy of each supplied stop against GL's ACTUAL retained
//   loss distribution, measured by running the engine.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  STATIC_CLF_TABLE, GL_DERIVED, crossingOf, clfFromTable,
} from '../../src/data/clfTables';
import { SLIDER_RANGES } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 1000);
const YEARS = 10;

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
  else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

const supplied = STATIC_CLF_TABLE.GL;
const wc = STATIC_CLF_TABLE.WC;

console.log('=== GL SUPPLIED CLF CURVE ===\n');

console.log('--- 1. THE SUPPLIED CURVE ITSELF ---');
check(supplied.source === 'supplied', 'GL table is tagged `supplied`, not `derived`');
check(wc.source === 'derived', 'WC table is still tagged `derived`');
{
  let mono = true;
  for (let i = 1; i < supplied.clf.length; i++) if (supplied.clf[i] <= supplied.clf[i - 1]) mono = false;
  check(mono, 'supplied curve is strictly monotonic');
  const c = crossingOf(supplied);
  check(Math.abs(c - 0.577) < 0.0005, 'supplied curve crosses 1.000 at 57.7%', `${(c * 100).toFixed(2)}%`);
  check(Math.abs(crossingOf(GL_DERIVED) - 0.686) < 0.002,
    'GL_DERIVED is retained beside it and still crosses at 68.6%', `${(crossingOf(GL_DERIVED) * 100).toFixed(2)}%`);
  check(Math.abs(crossingOf(wc) - 0.472) < 0.002,
    'WC untouched, still crosses at 47.2%', `${(crossingOf(wc) * 100).toFixed(2)}%`);
}

console.log('\n--- 2. "EXPECTED" IS STILL EXACTLY 1.000 ---');
console.log('  fundingAtExpected bypasses the table entirely. Only the DISPLAYED crossing');
console.log('  percentile moves (68.6% -> 57.7%); the multiplier charged must not.\n');
{
  // The engine's own dispatch is `fundingAtExpected ? 1.0 : staticClf(...)`, so
  // the assertion that matters is that the literal survives — checked here by
  // running the engine at defaults and reading the CLF it actually applied.
  const LINES: CoverageLine[] = ['WC', 'GL'];
  const inst = generateGameInstance('EXPCHK', 5_150_000);
  const setup = { poolName: 'E', gameLength: 5, startingYear: 2026, instanceId: 'EXPCHK', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as GameState;
  const seen: Record<string, number[]> = { WC: [], GL: [] };
  for (let y = 1; y <= 5; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[l];
      if (r) seen[l].push(r.selectedFundingCLF);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  for (const l of LINES) {
    check(seen[l].every(v => v === 1.0), `${l}: selectedFundingCLF === 1.0 exactly at defaults, all 5 years`,
      `values ${[...new Set(seen[l])].join(', ')}`);
  }
}

console.log('\n--- 3. NO REACHABLE SLIDER POSITION HITS A CLAMP ---');
{
  const { min, max, step } = SLIDER_RANGES.fundingConfidenceLevel;
  const lo = supplied.stops[0] / 100, hi = supplied.stops[supplied.stops.length - 1] / 100;
  console.log(`  slider ${min}-${max} step ${step}; supplied curve covers ${lo}-${hi}`);
  check(min >= lo && max <= hi,
    'the whole slider range lies inside the supplied curve — no narrowing needed', `[${min}, ${max}] within [${lo}, ${hi}]`);
  check(0.90 >= lo && 0.90 <= hi, 'reserveMarginCLF\'s fixed 0.90 request is inside the range too');
  // Every discrete slider position, and the "next step" preview's top request.
  let allInside = true;
  for (let v = min; v <= max + 1e-9; v = Math.round((v + step) * 100) / 100) {
    if (v < lo - 1e-9 || v > hi + 1e-9) allInside = false;
  }
  check(allInside, 'every discrete slider stop resolves by interpolation, never by clamp');
}

console.log('\n--- 4. MEASURED: WHAT EACH SUPPLIED STOP ACTUALLY DELIVERS ON GL ---');
console.log(`  Running ${GAMES} games x ${YEARS} years, GL solo, all defaults, and asking what share`);
console.log('  of line-years the supplied CLF would actually have covered.\n');
{
  const ratios: number[] = [];
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g++) {
    const id = `GSC${g}`;
    const inst = generateGameInstance(id, 2_600_000 + g * 8117);
    const setup = { poolName: 'G', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: ['GL'] as CoverageLine[] };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    } as never as GameState;
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine.GL;
      if (r && r.poolPremium > 0) ratios.push(r.netIncurredLoss / r.poolPremium);
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  const n = ratios.length;
  const se = 1.96 * Math.sqrt(0.25 / n) * 100;
  console.log(`  ${n.toLocaleString()} line-years in ${((Date.now() - t0) / 1000).toFixed(0)}s (+/-${se.toFixed(1)}pp at worst)\n`);
  console.log('  label   supplied CLF   delivers   error(pp)   GL_DERIVED CLF at the same label');
  for (const p of [30, 40, 50, 60, 70, 80, 90, 95]) {
    const s = clfFromTable(supplied, p / 100);
    const delivered = ratios.filter(r => r <= s).length / n;
    const d = clfFromTable(GL_DERIVED, p / 100);
    console.log(`  ${String(p).padStart(4)}%   ${s.toFixed(4).padStart(12)}   ${(delivered * 100).toFixed(1).padStart(7)}%   ` +
      `${((delivered - p / 100) * 100 >= 0 ? '+' : '')}${((delivered - p / 100) * 100).toFixed(1).padStart(8)}   ${d.toFixed(4)}`);
  }
  const topDelivered = ratios.filter(r => r <= supplied.clf[supplied.clf.length - 1]).length / n;
  console.log(`\n  ⚠ CEILING: the supplied curve's top stop is ${supplied.clf[supplied.clf.length - 1]}, which covers ` +
    `${(topDelivered * 100).toFixed(1)}% of GL line-years.`);
  console.log(`    GL's own 99th percentile is ${GL_DERIVED.clf[GL_DERIVED.clf.length - 1]}, so near-certainty is NOT`);
  console.log('    purchasable at any slider position on this curve.');
  // Where the supplied curve's crossing actually lands on GL's distribution.
  const atOne = ratios.filter(r => r <= 1).length / n;
  console.log(`\n  And "Expected" (CLF 1.000) still covers ${(atOne * 100).toFixed(1)}% of GL line-years — unchanged by`);
  console.log(`    the table swap, since Expected bypasses the table. The DISPLAY now reads 57.7%.`);
  console.log(`    That display figure understates GL's real coverage by ${((atOne - 0.577) * 100).toFixed(1)}pp.`);
}

console.log(failures === 0 ? '\nALL SUPPLIED-CURVE CHECKS PASS.' : `\n${failures} CHECK(S) FAILED.`);
if (failures > 0) process.exit(1);
