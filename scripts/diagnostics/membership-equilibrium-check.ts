// MEMBERSHIP EQUILIBRIUM — does the enrolled book hold flat at all defaults?
//
// Run: npx tsx scripts/diagnostics/membership-equilibrium-check.ts
//
// THE CLAIM UNDER TEST. Joins now scale with the remaining marketplace
// (k x (roster - enrolled), k pinned so joins == departures at the measured
// starting book) instead of being a flat count against a proportional leave
// rate. If that is right, a pool run at ALL-DEFAULT decisions should hold
// roughly flat in REAL terms over ten years — neither growing nor decaying
// toward the old fixed-count attractor at 20 members.
//
// ⚠ REAL, NOT NOMINAL. WC and GL exposure inflates at 3.63%/yr (wageFactor);
// Property's does not (WAGE_INFLATION_APPLIES.Property is false, its base is
// TIV). Nominal exposure would therefore show ~+42% on WC/GL over ten years
// from wage inflation alone and say nothing whatever about membership. Every
// exposure figure below is deflated by that line's OWN wageFactor, which is
// exactly 1.0 for Property — so Property's real and nominal series coincide by
// construction, and that is correct rather than a missing deflator.
//
// Member COUNT is reported alongside real exposure because the two can move
// apart: recruitment is exposure-blind (the candidate pool is shuffled), so a
// flat count with drifting exposure would mean the joiners differ in size from
// the leavers. Both are shown so that cannot hide.
//
// REPORTS. Gates nothing.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { wageFactor } from '../../src/data/exposureTrend';
import {
  BASE_RETENTION, MEMBERSHIP_EQUILIBRIUM_ENROLLMENT, MEMBERSHIP_DEFAULT_ADJUSTMENT,
  MEMBERSHIP_DEFAULT_DEPARTURE_RATE,
  MAX_NEW_MEMBERS_PER_YEAR, MAX_WITHDRAWN_PER_YEAR,
} from '../../src/data/defaultAssumptions';
import { prospectCaptureRate } from '../../src/utils/membershipEngine';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// ⚠ 40 GAMES CANNOT ANSWER THE QUESTION THIS CHECK ASKS, and that was not
// visible until two successive recalibrations were compared against each other.
// The headline "games ending with a smaller book" is a proportion over GAMES,
// so its standard error is sqrt(0.25 / GAMES) — +/-7.9pp at 40. Every value
// this check has ever reported (47.5 / 50.0 / 47.5 at fab85e4, 52.5 / 50.0 /
// 45.0 before Property's recalibration, 52.5 / 42.5 / 60.0 after) sits inside
// one standard error of 50%, so NONE of them distinguished a flat equilibrium
// from a mildly tilted one, and comparing two such readings to each other says
// even less.
//
// GAMES is now an env override so the question can actually be resolved when it
// matters: 200 games brings the share's standard error to +/-3.5pp and the
// Y1->Y10 median ratio's to about +/-1.4pp. The default stays 40 for a fast
// routine run; use GAMES=200 when a calibration has moved.
const GAMES = Number(process.env.GAMES ?? 40);
const YEARS = 10;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface YearObs { count: number; realExposure: number; joined: number; left: number; }

console.log('=== MEMBERSHIP EQUILIBRIUM CHECK — all-default decisions, 3 lines, 40 games x 10 years ===\n');
{
  const roster = 200;
  const N = MEMBERSHIP_EQUILIBRIUM_ENROLLMENT;
  const k = prospectCaptureRate(roster);
  const departures = N * MEMBERSHIP_DEFAULT_DEPARTURE_RATE;
  console.log(`k from the engine's own prospectCaptureRate: N* = ${N}, roster ${roster}, ` +
    `realised departure rate ${MEMBERSHIP_DEFAULT_DEPARTURE_RATE} (nominal 1-BASE_RETENTION would be ` +
    `${(1 - BASE_RETENTION).toFixed(3)}), default adj ${MEMBERSHIP_DEFAULT_ADJUSTMENT}`);
  console.log(`  k = (${N} x ${MEMBERSHIP_DEFAULT_DEPARTURE_RATE} - ${MEMBERSHIP_DEFAULT_ADJUSTMENT}) / ` +
    `${roster - N} = ${k.toFixed(6)}`);
  console.log(`  at N*: base ${(k * (roster - N)).toFixed(3)} + adj ${MEMBERSHIP_DEFAULT_ADJUSTMENT.toFixed(3)} ` +
    `= ${(k * (roster - N) + MEMBERSHIP_DEFAULT_ADJUSTMENT).toFixed(3)} joins/yr ` +
    `against ${departures.toFixed(3)} departures/yr — balanced by construction.`);
  console.log('  Self-correction, expected joins vs departures away from N*:');
  for (const n of [30, 45, 62, 80, 100, 120]) {
    const j = k * (roster - n) + MEMBERSHIP_DEFAULT_ADJUSTMENT;
    const d = n * MEMBERSHIP_DEFAULT_DEPARTURE_RATE;
    console.log(`    N=${String(n).padStart(3)}  joins ${j.toFixed(2)}  departures ${d.toFixed(2)}  ` +
      `net ${(j - d >= 0 ? '+' : '')}${(j - d).toFixed(2)}`);
  }
  console.log('');
}

// obs[line][yearIndex] = one entry per game
const obs: Record<string, YearObs[][]> = {};
for (const l of LINES) obs[l] = Array.from({ length: YEARS }, () => [] as YearObs[]);

const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const seed = 5_200_000 + g * 6353;
  const id = `MEQ${g}`;
  const inst = generateGameInstance(id, seed);
  const setup = {
    poolName: 'Equilibrium', gameLength: YEARS, startingYear: 2026,
    instanceId: id, activeLines: LINES,
  };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true,
    isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1),
    priorHistory,
  } as never as GameState;

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const line of LINES) {
      const r = (p.result as never as {
        byLine: Record<string, {
          activeExposure: number; activeMembers: number;
          newMembers: number; withdrawnMembers: number;
        }>
      }).byLine[line];
      if (!r) continue;
      // Count from the result's own activeMembers, not from poolState.members'
      // shared status field — that field is fold-corrupted across lines (one
      // status per member, folded sequentially per line), so filtering it would
      // miscount any member active here but withdrawn from a later-processed
      // line. The per-line result is the authoritative per-line answer.
      const count = r.activeMembers;
      obs[line][y - 1].push({
        count,
        realExposure: r.activeExposure / wageFactor(line, y),
        joined: r.newMembers,
        left: r.withdrawnMembers,
      });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  if ((g + 1) % 10 === 0) console.log(`  ...${g + 1}/${GAMES} games`);
}
console.log(`  done in ${Math.round((Date.now() - t0) / 1000)}s\n`);

for (const line of LINES) {
  console.log(`\n=== ${line} — enrolled book by year (all-default decisions) ===`);
  console.log('  REAL exposure = nominal / wageFactor(line, year). Property\'s wageFactor is 1.0 by design.');
  // activeExposure is denominated in $ MILLIONS (WC full market reads 1300 =
  // $1.3B payroll; premium = exposure x 10_000 x ratePer100 confirms the unit).
  console.log('\n  year   members (median)   real exp $M (median)   joined/yr   left/yr');
  for (let y = 0; y < YEARS; y++) {
    const rows = obs[line][y];
    const counts = rows.map(r => r.count);
    const exps = rows.map(r => r.realExposure);
    console.log(`  Y${String(y + 1).padStart(2)}   ${String(q(counts, 0.5)).padStart(16)}   ` +
      `${q(exps, 0.5).toFixed(1).padStart(20)}   ${mean(rows.map(r => r.joined)).toFixed(2).padStart(9)}   ` +
      `${mean(rows.map(r => r.left)).toFixed(2).padStart(7)}`);
  }

  const c1 = obs[line][0].map(r => r.count), cN = obs[line][YEARS - 1].map(r => r.count);
  const e1 = obs[line][0].map(r => r.realExposure), eN = obs[line][YEARS - 1].map(r => r.realExposure);
  // Per-game ratios, then a median of ratios — NOT a ratio of medians, so each
  // game is its own paired comparison and one large pool cannot dominate.
  const cRatio = c1.map((v, i) => cN[i] / Math.max(v, 1));
  const eRatio = e1.map((v, i) => eN[i] / Math.max(v, 1));
  console.log(`\n  Y1 -> Y10, per-game ratio (median of ratios, not ratio of medians):`);
  console.log(`    member count    median ${pct(q(cRatio, 0.5) - 1)}   p10 ${pct(q(cRatio, 0.1) - 1)}   p90 ${pct(q(cRatio, 0.9) - 1)}`);
  console.log(`    REAL exposure   median ${pct(q(eRatio, 0.5) - 1)}   p10 ${pct(q(eRatio, 0.1) - 1)}   p90 ${pct(q(eRatio, 0.9) - 1)}`);
  const share = cRatio.filter(r => r < 1).length / cRatio.length;
  console.log(`    games ending with a smaller book: ${pct(share)} (flat would be near 50%)`);
}

// --- does it actually SELF-CORRECT? -----------------------------------------
// Holding flat on average is necessary but not sufficient: a rule with no
// restoring force would also sit still on average while wandering freely. The
// claim is stronger — that a book displaced from N* is pulled back. Tested
// here as mean reversion on the observed line-years, with no manipulation:
// bucket every line-year by the book it started with, and measure the mean net
// change. A restoring force shows up as net change falling monotonically
// through zero as the starting book rises past N*.
console.log('\n\n=== DOES IT SELF-CORRECT? (mean reversion, observed line-years) ===');
console.log(`N* = ${MEMBERSHIP_EQUILIBRIUM_ENROLLMENT}. Net change should be positive below it,`);
console.log('negative above it, and cross zero near it. A flat row would mean no restoring force.\n');
console.log('  book at start of year   line-years   mean net change (joined - left)');
{
  const buckets: Array<[number, number]> = [
    [0, 45], [45, 53], [53, 59], [59, 65], [65, 71], [71, 79], [79, 999],
  ];
  const allYears = LINES.flatMap(l => obs[l].flat());
  for (const [lo, hi] of buckets) {
    const inB = allYears.filter(r => {
      const book = r.count - r.joined + r.left;
      return book >= lo && book < hi;
    });
    if (inB.length < 10) continue;
    const net = mean(inB.map(r => r.joined - r.left));
    const label = hi === 999 ? `${lo}+` : `${lo}-${hi - 1}`;
    console.log(`  ${label.padEnd(23)} ${String(inB.length).padStart(10)}   ` +
      `${(net >= 0 ? '+' : '')}${net.toFixed(2)}`);
  }
}

// --- is the DEPARTURE side neutral at defaults? -----------------------------
// The join side was not (newMemberAdjustment contributes +0.60 at defaults, now
// netted into k). The retention side has the same structure and must be checked
// the same way: calcRetentionProbability adds satisfaction and financial-
// strength terms on top of BASE_RETENTION, both positive at defaults, so the
// REALISED departure rate can sit well below the nominal 1 - BASE_RETENTION.
// If it does, an equilibrium pinned on 5.0% is pinned on the wrong number.
console.log('\n\n=== IS THE DEPARTURE SIDE NEUTRAL AT DEFAULTS? ===');
console.log(`  nominal 1 - BASE_RETENTION = ${((1 - BASE_RETENTION) * 100).toFixed(2)}%`);
console.log('\n  line       realised departures/book   realised joins/book   book (mean)');
const dRates: number[] = [];
for (const line of LINES) {
  const all = obs[line].flat();
  // book at START of year = end count - joined + left
  const books = all.map(r => r.count - r.joined + r.left);
  const bookMean = mean(books);
  const dRate = mean(all.map(r => r.left)) / bookMean;
  const jRate = mean(all.map(r => r.joined)) / bookMean;
  dRates.push(dRate);
  console.log(`  ${line.padEnd(10)} ${pct(dRate).padStart(24)} ${pct(jRate).padStart(21)} ${bookMean.toFixed(1).padStart(13)}`);
}
console.log(`\n  POOLED realised departure rate: ${pct(mean(dRates))}`);
console.log(`  vs nominal ${pct(1 - BASE_RETENTION)} — the gap is the retention ladder plus the`);
console.log('  MAX_WITHDRAWN_PER_YEAR truncation, and it is what any equilibrium must be pinned on.');

// --- do the hard movement caps bind? ----------------------------------------
console.log('\n\n=== DO THE HARD CAPS BIND? ===');
console.log(`MAX_NEW_MEMBERS_PER_YEAR ${MAX_NEW_MEMBERS_PER_YEAR}, MAX_WITHDRAWN_PER_YEAR ${MAX_WITHDRAWN_PER_YEAR}.`);
console.log('A cap that binds often would blunt the self-correction the new base exists to provide,');
console.log('since it truncates exactly the large-join years a shrunken book needs to recover.');
for (const line of LINES) {
  const all = obs[line].flat();
  const joinCap = all.filter(r => r.joined >= MAX_NEW_MEMBERS_PER_YEAR).length / all.length;
  const leaveCap = all.filter(r => r.left >= MAX_WITHDRAWN_PER_YEAR).length / all.length;
  console.log(`  ${line.padEnd(9)} join at cap ${pct(joinCap).padStart(6)}   withdrawals at cap ${pct(leaveCap).padStart(6)}`);
}

console.log('\nDONE — measured, not gated.');
