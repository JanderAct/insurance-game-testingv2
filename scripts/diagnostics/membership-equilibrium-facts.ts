// MEMBERSHIP EQUILIBRIUM — THE FACTS, MEASURED BEFORE ANY FIX.
//
// Run: npx tsx scripts/diagnostics/membership-equilibrium-facts.ts
//
// Establishes the inputs needed to derive k for the marketplace-scaled join
// rule, PER LINE, rather than assuming one number covers all three:
//
//   1. The roster, and the ELIGIBLE roster per line. selectStartingLineMembers
//      skips any member with exposure <= 0 in the line, so a line's real
//      prospect universe is "members with positive exposure in THIS line",
//      not MARKET_MEMBER_COUNT.
//   2. Starting enrolled COUNT per line, across seeds. Starting books are drawn
//      as an exposure SHARE (25-35%), not a count, so the count is emergent and
//      its per-line spread is exactly the thing that decides whether one k
//      works for all three lines or each needs its own.
//   3. The realised candidate pool after the canReenroll cooldown filter — the
//      pool the join draw actually sees, which is smaller than
//      (roster - enrolled) whenever anyone is inside their 2-year cooldown.
//
// REPORTS ONLY. Changes nothing.

import { PREDEFINED_MARKET_MEMBERS, MARKET_MEMBER_COUNT } from '../../src/data/memberCatalog';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { BASE_RETENTION, BASE_NEW_MEMBERS_PER_YEAR } from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const OPENING_EXPOSURE_YEAR = 1;
const SEEDS = 40;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

console.log('=== MEMBERSHIP EQUILIBRIUM: FACTS BEFORE THE FIX ===\n');
console.log(`BASE_RETENTION ${BASE_RETENTION}  ->  ${((1 - BASE_RETENTION) * 100).toFixed(1)}% leave/yr`);
console.log(`BASE_NEW_MEMBERS_PER_YEAR ${BASE_NEW_MEMBERS_PER_YEAR}\n`);

// --- 1. roster and per-line eligible roster ---------------------------------
console.log('--- 1. ROSTER ---');
console.log(`  MARKET_MEMBER_COUNT (full roster): ${MARKET_MEMBER_COUNT}`);
const eligible: Record<string, number> = {};
for (const line of LINES) {
  const n = PREDEFINED_MARKET_MEMBERS.filter(m => getMemberExposure(m, line, OPENING_EXPOSURE_YEAR) > 0).length;
  eligible[line] = n;
  console.log(`  eligible roster for ${line} (exposure > 0): ${n}`);
}

// --- 2. starting enrolled count per line, across seeds ----------------------
console.log('\n--- 2. STARTING ENROLLED COUNT PER LINE (emergent from a 25-35% EXPOSURE share) ---');
console.log('  Counted by running year 1 and backing its movement out:');
console.log('    starting = activeMembers(Y1) - newMembers(Y1) + withdrawnMembers(Y1)');
console.log('  which is by construction the currentMembers simulateMemberMovement received.');
console.log('  It agrees with filtering poolState.lines[line].members on status — that array is');
console.log('  PER-LINE, so it is not the fold-corrupted one. The corruption membershipEngine.ts');
console.log('  warns about is on the SHARED allMarketMembers roster, where one status field is');
console.log('  folded sequentially across all three lines.\n');
const startCounts: Record<string, number[]> = { WC: [], GL: [], Property: [] };
for (let i = 0; i < SEEDS; i++) {
  const seed = 8_100_000 + i * 7919;
  const inst = generateGameInstance(`FACTS${i}`, seed);
  const setup = {
    poolName: 'Facts', gameLength: 10, startingYear: 2026,
    instanceId: `FACTS${i}`, activeLines: LINES,
  };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  const gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as Parameters<typeof processYear>[0];
  const p = processYear(gs, defaultDecisionSet(1));
  for (const line of LINES) {
    const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
    startCounts[line].push(r.activeMembers - r.newMembers + r.withdrawnMembers);
  }
}
for (const line of LINES) {
  const c = startCounts[line];
  console.log(`  ${line.padEnd(9)} min ${q(c, 0)}, p10 ${q(c, 0.1)}, median ${q(c, 0.5)}, p90 ${q(c, 0.9)}, ` +
    `max ${q(c, 1)}, mean ${mean(c).toFixed(1)}   (of ${eligible[line]} eligible)`);
}

// --- 3. the k each line implies, at ITS OWN starting book -------------------
console.log('\n--- 3. IMPLIED k, PER LINE (FIRST-CUT ONLY — see the note below) ---');
console.log('  Equilibrium condition: k x (eligibleRoster - enrolled) = enrolled x (1 - BASE_RETENTION)');
console.log('  =>  k = enrolled x (1 - BASE_RETENTION) / (eligibleRoster - enrolled)\n');
console.log('  ⚠ THIS IS NOT THE SHIPPED k, and the gap is the interesting part. This form assumes');
console.log('  BOTH sides are neutral at default decisions. Neither is: the join ladder contributes');
console.log('  +0.60 members/yr at defaults, and the realised departure rate is 4.2%, not the nominal');
console.log('  5.0%, because the retention ladder is also net-positive there. The shipped derivation');
console.log('  corrects both — see MEMBERSHIP_EQUILIBRIUM_ENROLLMENT in defaultAssumptions.ts and the');
console.log('  measurements in membership-equilibrium-report.ts. The per-line SPREAD below is still');
console.log('  the useful output here: it is what says one k serves all three lines.\n');
console.log('  line       enrolled(median)  prospects  leave/yr  implied k');
const impliedK: Record<string, number> = {};
for (const line of LINES) {
  const enrolled = q(startCounts[line], 0.5);
  const prospects = eligible[line] - enrolled;
  const leave = enrolled * (1 - BASE_RETENTION);
  const k = leave / prospects;
  impliedK[line] = k;
  console.log(`  ${line.padEnd(10)} ${String(enrolled).padStart(14)} ${String(prospects).padStart(10)} ` +
    `${leave.toFixed(2).padStart(9)} ${k.toFixed(5).padStart(10)}`);
}
const spread = Math.max(...LINES.map(l => impliedK[l])) / Math.min(...LINES.map(l => impliedK[l]));
console.log(`\n  spread across lines (max/min): ${spread.toFixed(3)}x`);

// --- 4. what the current fixed base actually does ---------------------------
console.log('\n--- 4. THE CURRENT IMBALANCE, PER LINE (base rule only, before adjustments) ---');
console.log('  line       enrolled  leave/yr  join/yr(base)  net/yr   drift');
for (const line of LINES) {
  const enrolled = q(startCounts[line], 0.5);
  const leave = enrolled * (1 - BASE_RETENTION);
  const join = BASE_NEW_MEMBERS_PER_YEAR;
  const net = join - leave;
  console.log(`  ${line.padEnd(10)} ${String(enrolled).padStart(8)} ${leave.toFixed(2).padStart(9)} ` +
    `${join.toFixed(2).padStart(14)} ${net.toFixed(2).padStart(7)}   ${net < 0 ? 'DECLINE' : 'growth'}`);
}
console.log('\n  Fixed-count equilibrium (where join == leave) = BASE_NEW / (1 - BASE_RETENTION) = ' +
  `${(BASE_NEW_MEMBERS_PER_YEAR / (1 - BASE_RETENTION)).toFixed(1)} members, the same for every line ` +
  'regardless of that line\'s book — which is the defect.');

console.log('\nDONE — facts only. Nothing changed.');
