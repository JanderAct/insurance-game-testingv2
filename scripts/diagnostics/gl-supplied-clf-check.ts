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
//   4. WC's SUPPLIED curve crosses 1.000 at 55.8%, every stop of WC's OWN slider
//      range (0.10-0.99, not SLIDER_RANGES) is answered by the table rather than
//      by a clamp, WC_DERIVED is retained beside
//      it and still crosses at 42.9%, and WC's extension joins its measured part
//      with no step in volatility.
//
// ⚠ THE NAME OF THIS FILE IS NOW HALF RIGHT. WC prices off a supplied real-pool
// curve too, so this guards two substitutions rather than one. It was not renamed
// because the file's git history is the record of six moves in WC's crossing and
// a rename would cost more than the wrong name does.
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
  STATIC_CLF_TABLE, GL_DERIVED, WC_DERIVED, crossingOf, clfFromTable,
} from '../../src/data/clfTables';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 1000);
const YEARS = 10;

// Inverse normal CDF (Acklam), used only to check WC's extension for a step at
// its join. Local to this file because nothing in src needs it.
function probit(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  let q: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  q = p - 0.5;
  const r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
    (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way,
// attributing a failure in one section to a paragraph in another that happened
// to say "is NOT a defect". `failed` exists so the last line of output is the
// list, not the count.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? '  — ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

const supplied = STATIC_CLF_TABLE.GL;
const wc = STATIC_CLF_TABLE.WC;

console.log('=== GL SUPPLIED CLF CURVE ===\n');

console.log('--- 1. THE SUPPLIED CURVE ITSELF ---');
check(supplied.source === 'supplied', 'GL table is tagged `supplied`, not `derived`');
// ⚠ WC IS NOW SUPPLIED TOO, SO THIS ASSERTION CHANGED SIDES. It used to read
// `derived` and was half of how this file proved the GL swap had not reached WC.
// WC now prices off its own supplied real-pool curve, so the tag it must carry is
// `supplied`; the isolation claim is carried entirely by assertion 2 below, which
// is the one that was always doing that work.
check(wc.source === 'supplied', 'WC table is tagged `supplied`, not `derived`');
{
  let mono = true;
  for (let i = 1; i < supplied.clf.length; i++) if (supplied.clf[i] <= supplied.clf[i - 1]) mono = false;
  check(mono, 'supplied curve is strictly monotonic');
  const c = crossingOf(supplied);
  check(Math.abs(c - 0.577) < 0.0005, 'supplied curve crosses 1.000 at 57.7%', `${(c * 100).toFixed(2)}%`);
  // GL_DERIVED's crossing moved 68.6% -> 70.8% when the severity ceilings
  // started trending: the trending ceiling stops truncating GL's later-year
  // tail, mass moves from the middle of the ratio distribution into the extreme
  // tail (the 99th stop went 5.6018 -> 6.5251 while the median FELL), and a more
  // right-skewed distribution crosses 1.000 at a higher percentile. Re-derived
  // and confirmed over two passes. See clfTables.ts's crossing block.
  //
  // SECOND MOVE, 70.8% -> 65.6%, at the mid-band re-derivation, and it is the
  // first move that ran the OTHER way. The membership target came out, so the
  // derivation sample no longer contains the book drifting toward twenty members
  // — and a twenty-member pool is where one above-tower GL occurrence lands on a
  // tiny premium base and produces a ratio of six. Removing those line-years
  // removes the skew they generated: the 99th stop went 6.5251 -> 1.4523 and the
  // crossing came back toward the median. The above-tower hazard is untouched;
  // what changed is the size of the denominator it lands on.
  check(Math.abs(crossingOf(GL_DERIVED) - 0.656) < 0.002,
    'GL_DERIVED is retained beside it and still crosses at 65.6%', `${(crossingOf(GL_DERIVED) * 100).toFixed(2)}%`);
  // GUARDS AGAINST THE GL SWAP LEAKING INTO WC, not against WC ever changing.
  // This constant tracks WC's current derived value and must be updated whenever
  // WC is deliberately re-derived.
  //
  // ⚠ IT HAS NOW FAILED TWICE, AND THE SECOND TIME WENT UNNOTICED FOR A COMMIT.
  // The first was the report-lag/IBNR removal (47.2% -> 43.5%), recorded here as
  // "the check working rather than the check being wrong". The second was
  // WC_SEVERITY_CAP, which moved WC's crossing to 44.2% and left this assertion
  // red at the commit that caused it — the cap commit re-derived WC's table and
  // updated clfTables.ts's own crossing prose, but did not run this script, so
  // the one place that would have objected was never asked.
  //
  // The lesson is not "loosen the constant". It is that a re-derivation has more
  // consumers than the file it edits: anything holding a crossing as a literal
  // has to be re-run, and grepping the OLD VALUE is what finds them.
  //
  // Third move, 44.2% -> 50.4%, when WC went to four held class rates. That one
  // is not a re-measurement: WC had been charging the market's average rate to
  // books that were not the market, and pricing each rating group at its own
  // rate raised the median enrolled book's premium 2.3%. This check found it on
  // the first run after the change, which is the grep working.
  //
  // Fourth, 50.4% -> 54.7%, when WC's table was re-derived with IBNER live. The
  // table this branch carried had been derived on claims-distribution, where
  // development is the retired wobble rather than IBNER; re-deriving on the
  // branch's own distribution is what moved it. Not a pricing change — WC's
  // premium is untouched — a table catching up with the engine it prices for.
  //
  // Fifth, 54.7% -> 48.6%, at the mid-band re-derivation. Same cause as GL's move
  // above and the same direction: the old table was fitted on a sample that still
  // held very small books, whose ratios swing hard in both directions, so it was
  // too WIDE. The new one is tighter and its crossing sits nearer the median.
  //
  // ⚠ AND THIS ASSERTION WENT RED AT THE COMMIT THAT CAUSED IT, WHICH IS THE
  // THIRD TIME AND THE FIRST TIME THAT WAS THE POINT. The note above says the
  // lesson is that a re-derivation has more consumers than the file it edits and
  // that grepping the old value is what finds them. Here the full sweep found it
  // instead, at the commit that moved the tables, before they were pushed. That
  // is the cheaper mechanism and it is the one to rely on.
  //
  // Sixth, 48.6% -> 42.9%, at the SMALL-BAND re-derivation. WC's table is now
  // fitted to the shipped default's frozen ~62-member book rather than to the
  // 72-88 band, and a smaller book runs a higher loss ratio, so its whole
  // distribution sits higher and the crossing falls. Same direction as the
  // fifth movement and a larger step, which is what a whole band rather than a
  // re-fit should produce.
  //
  // ⚠ FOURTH TIME THIS TRIPWIRE HAS FIRED, AND IT IS NOT A DEFECT IN THE
  // TRIPWIRE. It is worth being explicit, because the obvious reading after four
  // firings is that the literal should go: this assertion is NOT an isolation
  // test despite its wording, it is a REGRESSION TRIPWIRE on WC's table, and the
  // isolation claim it names is carried by assertion 2 above — "Expected" pinned
  // bit-exactly at 1.000 on BOTH lines, which is what actually proves the GL swap
  // did not reach WC's pricing.
  //
  // So the literal is maintenance by design. Deriving it from WC's own shipped
  // table would make it tautological — STATIC_CLF_TABLE.WC IS WC_DERIVED — and a
  // tautology catches nothing. An ACCIDENTAL edit to WC's table is exactly what
  // this catches, and it has to be updated deliberately when WC moves on purpose.
  // Four firings, four deliberate WC changes, zero false alarms.
  //
  // ⚠ SEVENTH MOVE, 42.9% -> 55.8%, AND THIS ONE IS NOT A RE-DERIVATION AT ALL.
  // WC was given a SUPPLIED real-pool curve, the same substitution GL carries.
  // Every previous move on this list was the model's own crossing shifting as the
  // model changed; this one replaces the model's crossing with someone else's, so
  // the figure stops being a property of this engine. WC_DERIVED is retained
  // beside it, still crossing at 42.9%, and that is now the number this list has
  // been tracking all along — it gets its own assertion below so the history
  // stays attached to the quantity it is a history OF.
  //
  // ⚠ AND THE TAUTOLOGY WARNING ABOVE NO LONGER APPLIES THE WAY IT READS.
  // STATIC_CLF_TABLE.WC is WC_SUPPLIED now, not WC_DERIVED, so the two assertions
  // below are genuinely independent: one guards a supplied curve that must not be
  // edited by accident, the other guards a derived table that must not be quietly
  // dropped. Neither can be derived from the other.
  check(Math.abs(crossingOf(wc) - 0.5578) < 0.002,
    'WC supplied curve crosses 1.000 at 55.8%',
    `${(crossingOf(wc) * 100).toFixed(2)}%`);
  check(Math.abs(crossingOf(WC_DERIVED) - 0.429) < 0.002,
    'WC_DERIVED is retained beside it and still crosses at 42.9%',
    `${(crossingOf(WC_DERIVED) * 100).toFixed(2)}%`);
  {
    let mono = true;
    for (let i = 1; i < wc.clf.length; i++) if (wc.clf[i] <= wc.clf[i - 1]) mono = false;
    check(mono, 'WC supplied curve is strictly monotonic across the extension and the join');
  }
  // ⚠ THE EXTENSION IS CHECKED AS AN EXTENSION, not just as numbers. WC's curve
  // was supplied over 45-95 and extended down to 10 on a fitted lognormal, so the
  // thing that can silently go wrong is a STEP at the join. The local volatility
  // d(ln CLF)/dz must not jump between the last extrapolated interval and the
  // first measured one — measured 0.3515 against 0.3511, and the bound here is
  // loose enough to allow a re-fit and tight enough to catch a discontinuity.
  {
    const sigmaAt = (i: number) => (Math.log(wc.clf[i]) - Math.log(wc.clf[i - 1]))
      / (probit(wc.stops[i] / 100) - probit(wc.stops[i - 1] / 100));
    const join = wc.stops.indexOf(45);
    const gap = Math.abs(sigmaAt(join) - sigmaAt(join + 1));
    check(gap < 0.01, 'no volatility step at the 45% join between the extension and the measurement',
      `|${sigmaAt(join).toFixed(4)} - ${sigmaAt(join + 1).toFixed(4)}| = ${gap.toFixed(4)}`);
  }
}

console.log('\n--- 2. "EXPECTED" IS STILL EXACTLY 1.000 ---');
console.log('  fundingAtExpected bypasses the table entirely. Only the DISPLAYED crossing');
console.log('  percentile moves (65.6% -> 57.7%); the multiplier charged must not.\n');
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
  // ⚠ AND THE SAME FOR WC, AGAINST WC'S OWN RANGE — WHICH IS NOT SLIDER_RANGES,
  // AND ASSUMING IT WAS IS A MISTAKE THIS CHECK EXISTS TO STOP ANYONE REPEATING.
  // WC reads WC_FUNDING_CONFIDENCE_RANGE, 0.10-0.99, with explicit stops at 0.975
  // and 0.99. The supplied curve arrived covering 45-95, so NINE reachable
  // positions — seven below 45 and two above 95 — would have been answered by a
  // clamp, and a clamp at the top silently delivers the 95% multiplier under a
  // 99% label. WC's curve is extended at BOTH ends for that reason, and this
  // asserts every discrete stop the WC slider can occupy is inside the table.
  {
    const wlo = wc.stops[0] / 100, whi = wc.stops[wc.stops.length - 1] / 100;
    const wr = WC_FUNDING_CONFIDENCE_RANGE;
    console.log(`  WC slider ${wr.min}-${wr.max} (its OWN range, not SLIDER_RANGES); `
      + `WC curve covers ${wlo}-${whi} after its extension`);
    check(wr.min >= wlo && wr.max <= whi,
      'the whole WC slider range lies inside WC\'s extended curve', `[${wr.min}, ${wr.max}] within [${wlo}, ${whi}]`);
    check(0.90 >= wlo && 0.90 <= whi, 'reserveMarginCLF\'s 0.90 request is inside WC\'s range too');
    const outside = wr.stops.filter(v => v < wlo - 1e-9 || v > whi + 1e-9);
    check(outside.length === 0,
      'every discrete WC slider stop is answered by the table rather than by a clamp',
      outside.length ? `outside: ${outside.join(', ')}` : `all ${wr.stops.length} stops inside`);
    // A clamp is silent, so this catches it by VALUE rather than by range: the
    // top two stops must not return the same multiplier as the 95% stop.
    const at95 = clfFromTable(wc, 0.95);
    check(clfFromTable(wc, 0.99) > at95 + 1e-9 && clfFromTable(wc, 0.975) > at95 + 1e-9,
      'WC\'s 97.5% and 99% stops return more than its 95% stop — not a clamp',
      `${at95.toFixed(4)} -> ${clfFromTable(wc, 0.975).toFixed(4)} -> ${clfFromTable(wc, 0.99).toFixed(4)}`);
  }
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

console.log(failures === 0 ? '\nALL SUPPLIED-CURVE CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
