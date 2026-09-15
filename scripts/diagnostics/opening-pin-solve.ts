// RE-SOLVE STARTING_CAPITAL_TO_PREMIUM — a generator, not a check.
//
// Run:  npx tsx scripts/diagnostics/opening-pin-solve.ts
//       LINES=WC,GL SEEDS=600 npx tsx scripts/diagnostics/opening-pin-solve.ts
//
// Writes nothing. Prints a pin per line; paste it into defaultAssumptions.ts by
// hand and re-run opening-centring-check.
//
// ============================================================================
// WHY THIS FILE EXISTS. STARTING_CAPITAL_TO_PREMIUM has now drifted THREE times
// — 995f6f9 (28.7% off), the payout-pattern change, and this one. The first two
// were found by accident; the third was found by opening-centring-check, which
// is the gate doing its job. What did not exist either time was a way to re-solve
// it that anyone could just run, so each re-solve was rebuilt from the header's
// prose. This is that tool.
//
// ============================================================================
// ⚠ BISECT. DO NOT FIT A SLOPE. The constant's own header records a secant being
// tried and thrashing on GL — 0.5007 -> 0.2543 -> 0.0665 -> 0 -> 0.1097, never
// reaching the target — and says why: the objective is a MEDIAN of N noisy
// draws, so a secant differentiates noise, and near the floor the curve is
// non-monotone (pin 0.0665 read 0.271 against pin 0 reading 0.280).
//
// ⚠ AND THE AFFINE FITS IN THAT HEADER ARE SUPERSEDED TWICE OVER, which is worth
// saying because they are the obvious thing to reach for. `surplus/premium ~
// 0.2059 + 2.1214 K` and its two siblings were measured (a) against an earlier
// engine and (b) on the PREMIUM basis. WC and GL are now RESERVE-anchored — see
// OPENING_SURPLUS_BAND — so a Newton step off those fits solves the wrong
// objective with the wrong slope. Property is still on premium and is the only
// line those fits could still describe.
//
// ============================================================================
// ⚠ SOLVE THROUGH THE GATE'S OWN ESTIMATOR, AND THIS IS THE LESSON THAT COST A
// PASS LAST TIME. The first re-solve used a private 64-instance harness, landed
// GL at 0.1659, and opening-centring-check rejected it at -5.4 SE: the gate
// reads 400 seeds through simulateLineCandidate and measured 0.408 where the
// harness had measured 0.502. A pin solved against a different estimator than
// the one that asserts is a pin that fails its own gate.
//
// So this file calls simulateLineCandidate directly, at attempt 0 with no
// rejection, through openingBandRatio — the same three calls opening-centring-
// check makes, in the same order, on the same setup shape.
//
// ⚠ ON AN INDEPENDENT SEED BASE, THOUGH. Solving on the gate's own seeds would
// fit the gate's own sampling noise and produce a pin that passes by
// construction rather than because it is centred. This uses its own prefix and
// stride; the gate then verifies on seeds this solver never saw. Agreement
// across the two is the evidence, and disagreement is a finding rather than a
// nuisance.
//
// ⚠ AND THE OBJECTIVE IS THE UNFILTERED MEDIAN, not the accepted one. Centring
// on the accepted sample is a fixed-point iteration against the band's own
// selection: the accepted set is confined to the band by construction, so it
// looks centred however far the underlying distribution has moved.
// opening-centring-check's header records that measured both ways.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import {
  simulateLineCandidate, openingBandRatio, PRE_GAME_DEPTH,
} from '../../src/utils/priorHistoryEngine';
import { OPENING_SURPLUS_BAND, STARTING_CAPITAL_TO_PREMIUM } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameInstance, GameSetupSettings } from '../../src/types/simulation';

const RULE = '='.repeat(78);
const ALL: CoverageLine[] = ['WC', 'GL', 'Property'];
const LINES = (process.env.LINES ?? 'WC,GL').split(',').map(x => x.trim()) as CoverageLine[];
const SEEDS = Number(process.env.SEEDS ?? 600);
/** Stop when the median is within this share of the band's width of its midpoint. */
const TOL_BAND_WIDTHS = Number(process.env.TOL ?? 0.06);
const MAX_PASSES = Number(process.env.PASSES ?? 9);

// ⚠ A DIFFERENT PREFIX AND STRIDE FROM opening-centring-check's
// `OCC_${line}_${s}` / 41_000_000 + s * 5171. That is the whole point of the
// independence; changing one of the two without the other silently removes it.
const SEED_BASE = 58_000_000;
const SEED_STRIDE = 6421;

// BASE=gate re-points this solver at opening-centring-check's OWN seeds. Use it
// to VERIFY or to diagnose a disagreement between the two bases — never to
// solve, because a pin solved on the asserting gate's seeds passes by
// construction rather than because the distribution is centred.
const ON_GATE_SEEDS = process.env.BASE === 'gate';
const idOf = (line: string, s: number) => (ON_GATE_SEEDS ? `OCC_${line}_${s}` : `PIN_${line}_${s}`);
const seedOf = (s: number) => (ON_GATE_SEEDS ? 41_000_000 + s * 5171 : SEED_BASE + s * SEED_STRIDE);

const q = (a: number[], p: number) => {
  const t = [...a].sort((x, y) => x - y);
  return t[Math.min(t.length - 1, Math.floor(p * t.length))];
};

/** The gate's estimator, verbatim: attempt 0, no rejection, shared ratio. */
function unfilteredMedian(line: CoverageLine, k: number): number {
  const previous = STARTING_CAPITAL_TO_PREMIUM[line];
  // The binding is const; the object is not. A solver has to move the pin to
  // measure its effect, and doing it in-process beats rewriting the source file
  // between passes. Restored below whatever happens.
  STARTING_CAPITAL_TO_PREMIUM[line] = k;
  try {
    const ms: number[] = [];
    for (let s = 0; s < SEEDS; s++) {
      const id = idOf(line, s);
      const inst: GameInstance = generateGameInstance(id, seedOf(s));
      const setup = {
        poolName: 'P', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: ALL,
      } as GameSetupSettings;
      const c = simulateLineCandidate(inst, setup, line, 0);
      const last = c.lineResults[c.lineResults.length - 1];
      ms.push(openingBandRatio(line, last.endingSurplus, last.poolPremium, last.endingNetReserve));
    }
    return q(ms, 0.5);
  } finally {
    STARTING_CAPITAL_TO_PREMIUM[line] = previous;
  }
}

console.log(RULE);
console.log('OPENING PIN SOLVE — bisect STARTING_CAPITAL_TO_PREMIUM onto each band midpoint');
console.log(RULE);
console.log(`${SEEDS} seeds per evaluation, pre-game depth ${PRE_GAME_DEPTH}, band held open (attempt 0).`);
console.log(ON_GATE_SEEDS
  ? '⚠ BASE=gate — running on opening-centring-check\'s OWN seeds. VERIFY/DIAGNOSE ONLY.'
  : `Independent of opening-centring-check's seeds by construction: prefix PIN_, base ${SEED_BASE}.`);
console.log(`Stopping tolerance ${TOL_BAND_WIDTHS} x band width.\n`);

const solved: Record<string, number> = {};
for (const line of LINES) {
  const band = OPENING_SURPLUS_BAND[line];
  if (!band) { console.log(`  ${line}: no band, skipped`); continue; }
  const mid = (band.min + band.max) / 2;
  const width = band.max - band.min;
  const tol = TOL_BAND_WIDTHS * width;
  const shipped = STARTING_CAPITAL_TO_PREMIUM[line];

  console.log(`--- ${line} — band [${band.min}, ${band.max}] on ${band.basis}, midpoint ${mid.toFixed(4)} ---`);
  console.log(`  shipped pin ${shipped.toFixed(4)}`);

  // BRACKET. The pin adds capital, so the ratio rises with K; the band's
  // denominator does not depend on it. Walk outward from the shipped value
  // rather than assuming a range, so a line that has drifted the other way is
  // bracketed too and a non-monotone floor is never entered blindly.
  const atShipped = unfilteredMedian(line, shipped);
  console.log(`  pass 0   K ${shipped.toFixed(4)}   median ${atShipped.toFixed(4)}   `
    + `offset ${atShipped - mid >= 0 ? '+' : ''}${(atShipped - mid).toFixed(4)}`);

  let lo: number, hi: number;
  if (atShipped > mid) {
    hi = shipped; lo = Math.max(0.10, shipped * 0.5);
    let guard = 0;
    while (unfilteredMedian(line, lo) > mid && guard++ < 4) {
      hi = lo; lo = Math.max(0.10, lo * 0.6);
    }
  } else {
    lo = shipped; hi = shipped * 1.8;
    let guard = 0;
    while (unfilteredMedian(line, hi) < mid && guard++ < 4) {
      lo = hi; hi *= 1.8;
    }
  }
  console.log(`  bracket  [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);

  let k = shipped, med = atShipped;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    k = (lo + hi) / 2;
    med = unfilteredMedian(line, k);
    const off = med - mid;
    console.log(`  pass ${pass}   K ${k.toFixed(4)}   median ${med.toFixed(4)}   `
      + `offset ${off >= 0 ? '+' : ''}${off.toFixed(4)}   ${Math.abs(off) <= tol ? 'INSIDE' : ''}`);
    if (Math.abs(off) <= tol) break;
    if (med > mid) hi = k; else lo = k;
  }
  solved[line] = k;
  console.log(`  -> ${line} ${shipped.toFixed(4)} -> ${k.toFixed(4)}   `
    + `(${((100 * (k - shipped)) / shipped).toFixed(1)}%)\n`);
}

console.log(RULE);
console.log('PASTE INTO defaultAssumptions.ts, then run opening-centring-check — it samples');
console.log('seeds this solver never saw, so agreement there is evidence rather than');
console.log('construction:\n');
for (const line of ALL) {
  const v = solved[line];
  console.log(`  ${line}: ${(v ?? STARTING_CAPITAL_TO_PREMIUM[line]).toFixed(4)},`
    + (v === undefined ? '   // unchanged — not solved in this run' : ''));
}
console.log(RULE);
