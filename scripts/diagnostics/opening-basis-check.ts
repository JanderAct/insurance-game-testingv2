// THE OPENING POSITION — what sets it, and what the acceptance band is measured
// against.
//
// Run: npx tsx scripts/diagnostics/opening-basis-check.ts
//
// STARTING_CAPITAL_TO_PREMIUM seeds each line's PRE-GAME surplus as a multiple
// of its own premium, which is config-independent by construction. But the
// pre-game used to ACCEPT an opening only inside OPENING_MULTIPLE_BAND x
// Required Reserve Margin, and that margin is expectedNetUnpaidLoss x
// (reserveMarginCLF - 1) — an unstable quantity. A stable target filtered
// through an unstable test, and the filter wins. Three consecutive commits moved
// the opening through that path. The band is now measured against PREMIUM;
// section 4 is what proves the coupling is actually gone rather than reduced.
//
// This measures both sides on one run: the opening surplus actually produced,
// what it is as a multiple of PREMIUM (the stable basis) and as a multiple of the
// RESERVE MARGIN (the current basis), and how many redraw attempts the band
// costs. Run before and after the change; the numbers are compared in the commit.

import { unpaidShare } from '../../src/utils/payoutPattern';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import {
  STARTING_CAPITAL_TO_PREMIUM, OPENING_SURPLUS_TO_PREMIUM_BAND, LINE_PAYOUT_PATTERN,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Number(process.env.SEEDS ?? 150);
const M = 1e6;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

interface Obs { surplus: number; premium: number; margin: number; attempt: number }
const obs: Record<string, Obs[]> = { WC: [], GL: [], Property: [] };

for (let i = 0; i < SEEDS; i++) {
  for (const line of LINES) {
    const id = `OBC${line}${i}`;
    const inst = generateGameInstance(id, 6_100_000 + i * 4177);
    const setup = { poolName: 'O', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: [line] };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    const surplus = (poolState as never as {
      lines: Record<string, { surplus: number }>
    }).lines[line].surplus;
    // The last pre-game year's own result carries the premium and the margin the
    // acceptance test compared against, plus which attempt was accepted.
    const last = (priorHistory as never as {
      byLine: Record<string, {
        poolPremium: number; reserveRiskMarginNeeded: number; pregameAttempt?: number;
      }>
    }[]).slice(-1)[0];
    const r = last?.byLine?.[line];
    if (!r) continue;
    obs[line].push({
      surplus,
      premium: r.poolPremium,
      margin: r.reserveRiskMarginNeeded,
      attempt: r.pregameAttempt ?? -1,
    });
  }
}

console.log(`=== OPENING POSITION — ${SEEDS} seeds per line, each line SOLO ===\n`);

console.log('--- 1. THE OPENING, AND WHAT IT IS A MULTIPLE OF ---');
console.log('  line       surplus $M (p10/med/p90)      surplus/PREMIUM      surplus/MARGIN      target');
for (const line of LINES) {
  const o = obs[line];
  const sp = o.map(x => x.surplus / Math.max(x.premium, 1));
  const sm = o.map(x => x.surplus / Math.max(x.margin, 1));
  console.log(`  ${line.padEnd(10)} ${(q(o.map(x => x.surplus), 0.1) / M).toFixed(2).padStart(5)} / ` +
    `${(q(o.map(x => x.surplus), 0.5) / M).toFixed(2).padStart(5)} / ${(q(o.map(x => x.surplus), 0.9) / M).toFixed(2).padStart(5)}` +
    `      ${q(sp, 0.1).toFixed(3)} / ${q(sp, 0.5).toFixed(3)} / ${q(sp, 0.9).toFixed(3)}` +
    `   ${q(sm, 0.1).toFixed(2)} / ${q(sm, 0.5).toFixed(2)} / ${q(sm, 0.9).toFixed(2)}` +
    `   ${STARTING_CAPITAL_TO_PREMIUM[line].toFixed(2)}`);
}
console.log('\n  ⚠ THE LAST COLUMN IS THE YEAR -2 SEED, NOT A TARGET FOR THE OPENING. Three simulated');
console.log('  years run on top of it, so surplus/PREMIUM lands well above it and is SUPPOSED to.');
console.log('  surplus/PREMIUM is what the band now tests; surplus/MARGIN is what it used to test,');
console.log('  kept here so a re-run still shows both sides.');

console.log('\n--- 2. WHAT THE BAND COSTS IN REDRAWS ---');
console.log(`  bands in force (surplus/premium): ${LINES.map(l =>
  `${l} [${OPENING_SURPLUS_TO_PREMIUM_BAND[l].min}, ${OPENING_SURPLUS_TO_PREMIUM_BAND[l].max}]`).join('  ')}`);
console.log('\n  line       attempts (median/p90/max)   mean');
for (const line of LINES) {
  const a = obs[line].map(x => x.attempt);
  console.log(`  ${line.padEnd(10)} ${String(q(a, 0.5)).padStart(6)} / ${String(q(a, 0.9)).padStart(4)} / ${String(q(a, 1)).padStart(4)}` +
    `        ${mean(a).toFixed(1)}`);
}
console.log('\n  Attempt 0 accepted on the first try. A high median means the band and the target');
console.log('  disagree about where the opening belongs, so the pre-game is rejecting most draws.');

console.log('\n--- 3. THE MARGIN AS A MULTIPLE OF PREMIUM — the instability, quantified ---');
console.log('  line       margin/premium (p10/med/p90)');
for (const line of LINES) {
  const mp = obs[line].map(x => x.margin / Math.max(x.premium, 1));
  console.log(`  ${line.padEnd(10)} ${q(mp, 0.1).toFixed(3)} / ${q(mp, 0.5).toFixed(3)} / ${q(mp, 0.9).toFixed(3)}`);
}
console.log('\n  This ratio is what MADE the old band unstable: it moves whenever the reserve, the');
console.log('  reserve-margin CLF, or the funding basis moves — none of which is a decision.');
console.log('  It is still measured because it is the covariate section 4 correlates against.');

// --- the decoupling itself, measured -----------------------------------------
// THE POINT OF THE CHANGE, tested rather than asserted. Under the old band the
// acceptance test was surplus ∈ [min, max] x MARGIN, which mechanically ties the
// accepted opening to the margin: a seed whose margin came out high is only
// accepted with a correspondingly high surplus. So surplus/premium and
// margin/premium should be strongly correlated BEFORE and uncorrelated AFTER.
// Nothing else in this file distinguishes the two bases so directly.
console.log('\n--- 4. IS THE OPENING STILL COUPLED TO THE RESERVE MARGIN? ---');
console.log('  Pearson r between (surplus/premium) and (margin/premium) across seeds.');
console.log('  Strongly positive = the margin is still choosing the opening.\n');
for (const line of LINES) {
  const x = obs[line].map(o => o.margin / Math.max(o.premium, 1));
  const y = obs[line].map(o => o.surplus / Math.max(o.premium, 1));
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
  }
  const r = sxy / Math.sqrt(Math.max(sxx * syy, 1e-12));
  console.log(`  ${line.padEnd(10)} r = ${r >= 0 ? ' ' : ''}${r.toFixed(3)}`);
}

console.log('\n--- 5. DOES TAIL LENGTH EXPLAIN 0.70 / 0.45 / 0.18? ---');
console.log('  The engine\'s per-line runoff is now a fitted PAYOUT PATTERN, not one rate:');
for (const line of LINES) {
  const pat = LINE_PAYOUT_PATTERN[line];
  // Steady-state reserve / annual loss is the sum of the unpaid share over all
  // ages: in equilibrium one cohort of each age is open at once. Summed to 400
  // rather than in closed form because there is no closed form for a Weibull
  // survival summed over integers, and 400 is far past where any line is
  // material.
  let steady = 0;
  for (let t = 1; t <= 400; t++) steady += unpaidShare(pat, t);
  const shape = pat.kind === 'weibull' ? `k ${pat.k.toFixed(2)} b ${pat.b.toFixed(3)}` : `geometric ${pat.conditional.toFixed(2)}`;
  console.log(`    ${line.padEnd(10)} ${shape.padEnd(18)} ->  steady-state reserve ${steady.toFixed(2)}x annual loss`);
}
console.log('\n  ⚠ THE ARGUMENT THAT STOOD HERE IS NOW FALSE AND IS REPLACED. It read: "WC AND GL');
console.log('  ARE IDENTICAL ON THIS AXIS (both 0.35), so tail length CANNOT explain WC 0.70');
console.log('  against GL 0.45." That was true of a single paydown rate and is not true of a');
console.log('  payout pattern — WC and GL are now the two MOST different lines on this axis,');
console.log('  3.36x against 2.51x, because WC pays fast and then crawls while GL defers.');
console.log('  Tail length is therefore a live candidate again and points the RIGHT way for');
console.log('  the first time: the longer-tailed line does carry the larger capital multiple.');
console.log('  Whether it explains the SIZE of the gap is a re-derivation, not a re-reading,');
console.log('  and it belongs with the CLF work rather than here.');
console.log('\n  What DOES separate them is the PREMIUM BASE the multiple is applied to:');
for (const line of LINES) {
  const p = q(obs[line].map(x => x.premium), 0.5);
  console.log(`    ${line.padEnd(10)} median opening premium $${(p / M).toFixed(2)}M  ` +
    `x ${STARTING_CAPITAL_TO_PREMIUM[line].toFixed(2)} = $${((p * STARTING_CAPITAL_TO_PREMIUM[line]) / M).toFixed(2)}M of capital`);
}
