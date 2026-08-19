// RE-MEASURE the two membership calibration constants after the price channel
// was reconnected, and re-derive k.
//
// Run: npx tsx scripts/diagnostics/membership-recalibrate.ts
//
// MEMBERSHIP_DEFAULT_ADJUSTMENT and MEMBERSHIP_DEFAULT_DEPARTURE_RATE are
// properties of the join and retention ladders, not constants of nature — the
// source comments on both say exactly that and say to re-measure if a branch
// changes. Reconnecting the price channel added a term to BOTH ladders, so both
// have moved and k has to be re-derived from the new values. Skipping this
// would mean all-defaults is no longer the neutral point and every later
// measurement is against a baseline that quietly shifted again.
//
// Reports per line as well as pooled, because the price channel is the first
// mechanism in this model with a genuinely per-line neutral point — each line's
// rate trends differently at defaults — so whether ONE pair of constants still
// serves all three lines is now an open question rather than a settled one.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { newMemberAdjustment, prospectCaptureRate } from '../../src/utils/membershipEngine';
import {
  MEMBERSHIP_EQUILIBRIUM_ENROLLMENT, MEMBERSHIP_DEFAULT_ADJUSTMENT,
  MEMBERSHIP_DEFAULT_DEPARTURE_RATE, RATE_NEUTRAL_CHANGE_PCT, RATE_NEUTRAL_LOAD,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = 40, YEARS = 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

const adjBy: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const leftBy: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const bookBy: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const startBook: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const levelDev: Record<string, number[]> = { WC: [], GL: [], Property: [] };
const satBy: Record<string, number[]> = { WC: [], GL: [], Property: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `RCAL${g}`;
  const inst = generateGameInstance(id, 5_200_000 + g * 6353);
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as GameState;
  const cp = (inst as never as { marketEnvironment: { competitivePressure: number } })
    .marketEnvironment.competitivePressure;

  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y);
    const pre: Record<string, { sat: number; surplus: number; prem: number }> = {};
    for (const line of LINES) {
      const lp = (gs.poolState as never as {
        lines: Record<string, { memberSatisfaction: number; surplus: number }>
      }).lines[line];
      const prev = gs.lockedResults.length
        ? (gs.lockedResults[gs.lockedResults.length - 1] as never as {
            byLine: Record<string, { poolPremium: number }>
          }).byLine[line]
        : undefined;
      pre[line] = { sat: lp.memberSatisfaction, surplus: lp.surplus, prem: prev?.poolPremium ?? 1 };
    }

    const p = processYear(gs, d);

    for (const line of LINES) {
      const r = (p.result as never as {
        byLine: Record<string, {
          activeMembers: number; newMembers: number; withdrawnMembers: number;
          ratePer100: number; purePremiumPer100: number; memberSatisfaction: number;
        }>
      }).byLine[line];
      if (!r) continue;
      const book = r.activeMembers - r.newMembers + r.withdrawnMembers;
      // The realised level deviation this year, recomputed from the result's own
      // rate and pure premium — close enough to the engine's preliminary figure
      // to characterise the ladder, and read from published fields rather than
      // from a reimplementation of the pricing path.
      const load = r.purePremiumPer100 > 0 ? r.ratePer100 / r.purePremiumPer100 : 0;
      const ldev = RATE_NEUTRAL_LOAD[line] > 0 ? (load / RATE_NEUTRAL_LOAD[line] - 1) * 100 : 0;
      levelDev[line].push(ldev);
      adjBy[line].push(newMemberAdjustment({
        underwritingStrictness: d.byLine[line].underwritingStrictness,
        assessmentPct: d.byLine[line].assessmentPct,
        riskControlPct: d.byLine[line].riskControlPct,
        memberSatisfaction: pre[line].sat,
        surplus: pre[line].surplus,
        annualPremium: pre[line].prem,
        competitivePressure: cp,
        levelDeviationPct: ldev,
      }));
      leftBy[line].push(r.withdrawnMembers);
      bookBy[line].push(book);
      satBy[line].push(r.memberSatisfaction);
      if (y === 1) startBook[line].push(book);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

console.log('=== RE-CALIBRATION AFTER THE PRICE CHANNEL — 40 games x 10 years, all defaults ===\n');

console.log('--- the price signal at defaults (should sit near zero if the neutrals are right) ---');
console.log('  line       mean level deviation %   median');
for (const l of LINES) {
  console.log(`  ${l.padEnd(10)} ${mean(levelDev[l]).toFixed(3).padStart(20)} ${q(levelDev[l], 0.5).toFixed(3).padStart(9)}`);
}
console.log(`  neutral changes in use: ${LINES.map(l => `${l} ${RATE_NEUTRAL_CHANGE_PCT[l]}%`).join(', ')}`);

console.log('\n--- satisfaction stability (the symmetric term must not ratchet) ---');
console.log('  line       mean sat   p10     p90');
for (const l of LINES) {
  console.log(`  ${l.padEnd(10)} ${mean(satBy[l]).toFixed(3).padStart(8)} ${q(satBy[l], 0.1).toFixed(2).padStart(7)} ${q(satBy[l], 0.9).toFixed(2).padStart(7)}`);
}

console.log('\n--- MEMBERSHIP_DEFAULT_ADJUSTMENT ---');
console.log(`  old (fdc747c): ${MEMBERSHIP_DEFAULT_ADJUSTMENT}`);
console.log('  line       mean     median');
for (const l of LINES) {
  console.log(`  ${l.padEnd(10)} ${mean(adjBy[l]).toFixed(4).padStart(8)} ${q(adjBy[l], 0.5).toFixed(4).padStart(9)}`);
}
const pooledAdj = mean(LINES.flatMap(l => adjBy[l]));
console.log(`  POOLED mean: ${pooledAdj.toFixed(4)}`);

console.log('\n--- MEMBERSHIP_DEFAULT_DEPARTURE_RATE ---');
console.log(`  old (fdc747c): ${MEMBERSHIP_DEFAULT_DEPARTURE_RATE}`);
console.log('  line       realised departures/book');
const dRates: number[] = [];
for (const l of LINES) {
  const dr = mean(leftBy[l]) / mean(bookBy[l]);
  dRates.push(dr);
  console.log(`  ${l.padEnd(10)} ${(dr * 100).toFixed(3).padStart(20)}%`);
}
const pooledD = mean(dRates);
console.log(`  POOLED: ${(pooledD * 100).toFixed(3)}%`);

console.log('\n--- N*, the starting book ---');
for (const l of LINES) {
  console.log(`  ${l.padEnd(10)} median ${q(startBook[l], 0.5)}`);
}
const pooledN = q(LINES.flatMap(l => startBook[l]), 0.5);
console.log(`  POOLED median: ${pooledN}`);

console.log('\n--- RE-DERIVED k ---');
const roster = 200;
const kOld = prospectCaptureRate(roster);
console.log(`  currently in force: ${kOld.toFixed(6)}  (N*=${MEMBERSHIP_EQUILIBRIUM_ENROLLMENT}, ` +
  `d=${MEMBERSHIP_DEFAULT_DEPARTURE_RATE}, adj=${MEMBERSHIP_DEFAULT_ADJUSTMENT})`);
for (const N of [MEMBERSHIP_EQUILIBRIUM_ENROLLMENT, pooledN]) {
  const kNew = (N * pooledD - pooledAdj) / (roster - N);
  console.log(`  re-derived with N*=${N}, d=${pooledD.toFixed(4)}, adj=${pooledAdj.toFixed(4)}: k = ${kNew.toFixed(6)}`);
}

console.log('\nDONE — measured. Apply by hand, then re-run the equilibrium check.');
