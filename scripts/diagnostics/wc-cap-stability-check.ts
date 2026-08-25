// IS WC'S CALENDAR CV MEASURABLE NOW THAT SEVERITY IS CAPPED?
//
//   npx tsx scripts/diagnostics/wc-cap-stability-check.ts
//
// ============================================================================
// THE TEST, AND WHY IT IS THIS ONE.
//
// Before the cap, WC's calendar-year CV of netIncurredLoss was not a
// measurement. On UNCHANGED code it read 0.2502 at 50 games and 0.3211 at 120 —
// a 28% move — and the 50-game figure fell OUTSIDE the 120-game run's own 95%
// confidence interval. An interval that a re-measurement of the same code
// escapes is not describing the uncertainty that matters.
//
// The cause was structural rather than statistical: WC severity was unbounded,
// so a single game containing a $200M+ claim moved the CV materially and such
// games are rare. A block bootstrap resamples the games it HAS. It cannot
// resample a tail event the sample never contained, so it reported a tight
// interval around whichever tail the draw happened to include — confident and
// wrong, which is worse than noisy.
//
// So the test is STABILITY ACROSS SAMPLE SIZE, not a tighter interval. If the
// 50-game and 120-game figures agree, and each sits inside the other's
// interval, the quantity is estimable.
//
// ============================================================================
// ⚠ THE FIGURES BELOW WERE MEASURED UNDER A FIXED $85M CEILING. The ceiling
// trends now, which RAISES it in later years and so makes the tail slightly
// heavier, not lighter — the direction that would worsen this instability
// rather than relieve it. The conclusion is therefore unaffected in sign, and
// the table is left on its measured basis rather than silently restated. Re-run
// this script for figures on the trending basis.
//
// ⚠ THE ANSWER IS NO. THE CAP IMPROVED THIS AND DID NOT FIX IT.
//
//              50 games   120 games   move    each inside the other's CI?
//   pre-cap      0.2502      0.3211   +28.3%   no
//   capped       0.2448      0.2880   +17.6%   no
//
// The cap IS binding — the largest WC claim in these runs is exactly $85.00M —
// and the instability still halved rather than vanished. That is not a failed
// cap, it is a correctly-sized one meeting a distribution that is heavy-tailed
// well below its own ceiling: component `large` has sigma 2.00 and a CAPPED CV
// of 6.27, so a single $85M claim is still roughly eight times the book's
// entire annual expected loss. Bounding a tail is not the same as making it
// light, and only the second would make a moment estimable at 120 games.
//
// WHAT THIS MEANS FOR THE CLF QUESTION, which is the reason anyone runs this:
// it does NOT undermine the derived table. clf-table-derive measures
// PERCENTILES over 20,000 line-years, not a moment over 1,200, and percentiles
// of a heavy-tailed variable are estimable where its CV is not — its own
// block-bootstrap half-widths run 0.005 to 0.027 and are stable across passes.
// The right reading is the one this instrument's own failure already pointed
// to: settle CLF questions by re-deriving the table, never by comparing CVs.
//
// GL and Property are carried as CONTROLS. Both are stable across the same
// change (+1.3% and -2.5%, each inside the other's interval), so a WC-only
// result is a fact about WC rather than about the harness.
//
// ⚠ THIS IS A REPORT, NOT A GATE, AND DELIBERATELY SO. Turning it into an
// assertion would mean picking a threshold for "stable enough", and the honest
// reading is a comparison of two intervals rather than a number against a bar.
// It is also the check most at risk of being reassigned from gross-error
// detector to precision instrument — see WORKING_PRACTICES. It answers "is this
// quantity estimable at all", never "did it change by X%".

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { wcSeverityCap } from '../../src/utils/wcClaimEngine';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 10;
const SIZES = [50, 120];

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
};

// Block bootstrap over whole GAMES — line-years within a game are not
// independent (the book and surplus persist), so resampling line-years would
// understate the interval.
function bootCV(games: number[][]): { cv: number; lo: number; hi: number } {
  const flat = games.flat();
  const cv = sd(flat) / mean(flat);
  const B = 800;
  const out: number[] = [];
  let st = 987654321;
  const rnd = () => { st = (Math.imul(1664525, st) + 1013904223) >>> 0; return st / 4294967296; };
  for (let b = 0; b < B; b++) {
    const s: number[] = [];
    for (let i = 0; i < games.length; i++) s.push(...games[Math.floor(rnd() * games.length)]);
    out.push(sd(s) / mean(s));
  }
  out.sort((a, b) => a - b);
  return { cv, lo: out[Math.floor(0.025 * B)], hi: out[Math.floor(0.975 * B)] };
}

// Largest single WC claim seen anywhere, so the cap can be shown BINDING rather
// than assumed to. A run whose maximum sits well under the cap has not tested it.
let biggestClaim = 0;

function collect(games: number): Record<string, number[][]> {
  const per: Record<string, number[][]> = { WC: [], GL: [], Property: [] };
  for (let g = 0; g < games; g++) {
    const id = `CVM${g}`;
    const inst = generateGameInstance(id, 4_200_000 + g * 8117);
    const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const mine: Record<string, number[]> = { WC: [], GL: [], Property: [] };
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      for (const l of LINES) {
        const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
        if (!r) continue;
        mine[l].push(r.netIncurredLoss);
        if (l === 'WC') for (const c of r.claims ?? []) biggestClaim = Math.max(biggestClaim, c.grossUltimate);
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    for (const l of LINES) per[l].push(mine[l]);
  }
  return per;
}

// The ceiling TRENDS, so the binding level differs by year. A 10-year game's
// largest possible claim is the YEAR-10 ceiling, which is what the max below
// has to be judged against — comparing it to the year-1 cap would report the
// ceiling as "not binding" on a run where it bound every year.
const CAP_AT_HORIZON = wcSeverityCap(YEARS);
console.log(`WC CALENDAR-CV STABILITY — ceiling $${(wcSeverityCap(1) / 1e6).toFixed(1)}M in year 1, ` +
  `$${(CAP_AT_HORIZON / 1e6).toFixed(1)}M by year ${YEARS} (it trends)\n`);
console.log('Same seed family, same protocol, two sample sizes. The question is whether');
console.log('they agree — not whether either is small.\n');

const results: Record<string, Record<number, { cv: number; lo: number; hi: number }>> = { WC: {}, GL: {}, Property: {} };
for (const n of SIZES) {
  const per = collect(n);
  for (const l of LINES) results[l][n] = bootCV(per[l]);
}

console.log('line      | games |     CV | 95% CI (block bootstrap over games)');
for (const l of LINES) {
  for (const n of SIZES) {
    const r = results[l][n];
    console.log(`${l.padEnd(9)} | ${String(n).padStart(5)} | ${r.cv.toFixed(4)} | [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]`);
  }
}

console.log('\nSTABILITY — does each estimate sit inside the other\'s interval?\n');
console.log('line      | 50-game CV in 120-game CI? | 120-game CV in 50-game CI? |  relative move');
for (const l of LINES) {
  const a = results[l][50], b = results[l][120];
  const aInB = a.cv >= b.lo && a.cv <= b.hi;
  const bInA = b.cv >= a.lo && b.cv <= a.hi;
  const move = (b.cv / a.cv - 1) * 100;
  console.log(`${l.padEnd(9)} | ${(aInB ? 'yes' : 'NO').padStart(26)} | ${(bInA ? 'yes' : 'NO').padStart(26)} | ` +
    `${(move >= 0 ? '+' : '') + move.toFixed(1)}%`);
}

console.log(`\nlargest single WC claim drawn anywhere in these runs: $${(biggestClaim / 1e6).toFixed(2)}M`);
console.log(`  ${biggestClaim >= CAP_AT_HORIZON * 0.999
  ? 'AT the cap — the ceiling is binding in this sample, so the stability above is being tested against it.'
  : 'below the cap — the ceiling did not bind here, so this sample does not by itself demonstrate the cap working.'}`);

console.log('\n⚠ THE PRE-CAP FIGURES, for comparison: WC read 0.2502 at 50 games and 0.3211');
console.log('  at 120 on unchanged code, and the 50-game figure fell outside the 120-game');
console.log('  interval. GL and Property were already stable across the same change and are');
console.log('  reported here as controls — if THEY moved, the change would be in the harness');
console.log('  rather than in WC.');
console.log('\nREPORT ONLY — nothing above is asserted.');
