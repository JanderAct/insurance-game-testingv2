// EXPERIENCE PRICING — the three measurements that justify PRICING_TRIANGLE,
// and whose passing retires it.
//
// ============================================================================
// ⚠ THIS GATE IS THE FLAG'S RETIREMENT CONDITION, WRITTEN ON DAY ONE. It is
// entered in scripts/gates.ts's EXPECTED_RED. When all three arms pass, the
// XPASS guard fails the sweep until the entry is removed — and removing it is
// the moment PRICING_TRIANGLE goes with it. PER_CLAIM_REVISION lasted weeks
// because there was always one more thing to measure; this one cannot.
//
//   1. DOES THE TRIANGLE PRICE SANELY?  Experience rate against the held rate,
//      and both against the REALISED ultimate loss cost on mature accident
//      years. The realised comparison is the one that matters: "close to the
//      held rate" is not the test, because the held rate is itself heavy.
//   2. WHAT DOES THE RATE DO YEAR TO YEAR?  A rolling window should give a few
//      points of movement. Twenty is unusable.
//   3. DOES THE LOOP STAY STABLE?  Price chases the roster and the roster
//      chases price. NOT BUILT — and its absence is asserted, so this gate
//      cannot go green while the measurement that replaces finding 17's
//      protection does not exist.
//
// ⚠ ARM 3 FAILING IS THE POINT, NOT AN OVERSIGHT. The held pure premium existed
// to stop pricing chasing the roster. S3 removes that protection and nothing
// yet replaces it. Turning the flag on before arm 3 exists would ship an
// ungated feedback loop, so the gate refuses to go green and says so.
//
// ============================================================================
// ⚠ EVERY ARM BELOW RUNS ON THE SHIPPED ARM, AND ARM 1 MUST BE RE-MEASURED WITH
// FORWARD_BOOKING ON BEFORE EITHER FLAG SHIPS. RECORDED, NOT DONE.
//
// This module chain-ladders PAID, and that choice was made because the played
// INCURRED triangle was flat — cumulative 0.9857 / 0.9912 / 1.0005, a mean-one
// law producing no development. That is a fact about the SHIPPED arm and it is
// no longer true with FORWARD_BOOKING on: within horizon the engine develops
// incurred at 1.1041 / 1.2599 / 1.1584, and ratemaking-loop-check's condition 3
// separates the two arms on every line.
//
// So the method selection changes underneath this gate. On the flagged arm an
// incurred chain ladder is no longer exact-by-construction, paid is no longer
// the only honest basis, and arm 1's -2.0% / +1.7% / +2.6% is a reading of a
// pricing basis the shipped game will not have. It is not this commit's to fix
// — the loop had to exist before the arm could be re-run against it — but it is
// a PRECONDITION for flipping either flag, alongside arm 3.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear, currentPurePremiumPer100 } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { experienceRatePer100, type ExperienceBasis } from '../../src/utils/experienceRating';
import { windowRows } from '../../src/utils/pricingTriangle';
import { wasActiveInLine } from '../../src/utils/membershipHistory';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import type { CoverageLine, GameState, Member, ReserveDevelopmentRow } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 40);
const YEARS = Number(process.env.YEARS ?? 15);

// Arm 1: the experience rate must land within this of the REALISED loss cost.
// A gross-error detector — it is asking "is this a rate at all", not "is it
// precise". GL is expected to sit low against it; see the report below.
const MAX_LEVEL_ERROR = 0.25;
// Arm 2: share of year-on-year moves above 20%, the brief's own unusable bar.
const MAX_BIG_MOVE_SHARE = 0.05;

const failed: string[] = [];
const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);

type Acc = {
  expOverHeld: number[]; yoy: number[];
  realised: number[]; heldAtMature: number[]; expAtMature: number[];
};
const acc: Record<string, Acc> = {};
for (const l of LINES) acc[l] = { expOverHeld: [], yoy: [], realised: [], heldAtMature: [], expAtMature: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `EP${g}`;
  const instance = generateGameInstance(id, 5_500_000 + g * 7919);
  const setup = { poolName: 'E', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let st = poolState;
  const prev: Record<string, number> = {};
  for (let y = 1; y <= YEARS; y++) {
    const S = st as never as {
      allMarketMembers: Member[]; membershipHistory: never;
      lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[]; members: Member[] }>;
    };
    for (const line of LINES) {
      // ⚠ WINDOWED, BECAUSE THE ENGINE IS. processLineYear builds its basis from
      // windowRows(reserveDevelopment) — ten accident years — so a gate reading
      // the FULL ledger would report on a rate the pool never charges. That is
      // the panel/engine parity defect one layer out, and it appeared the moment
      // the window landed rather than being latent.
      //
      // It is not cosmetic on WC. Windowed rate over full-ledger rate, 20 games:
      //   WC 0.9348 shipped / 0.8882 flagged;  GL 1.0059 / 0.9762;
      //   Property 0.9939 / 1.0006.
      // WC alone moves, for the reason the window rule turns on: it is the only
      // line with value still open when the window drops a year (23.9% at age
      // 10, against GL 0.4% and Property 0.2%), so retiring mature accident
      // years retires its most developed loss costs and leaves the level
      // greener. GL and Property have nothing left to lose by then.
      const basis: ExperienceBasis = {
        rows: windowRows(S.lines[line]?.reserveDevelopment ?? []),
        allMarketMembers: S.allMarketMembers,
        membershipHistory: S.membershipHistory,
      };
      const active = (S.lines[line]?.members ?? []).filter(m => m.status === 'active');
      const exp = experienceRatePer100(line, basis);
      // The HELD arm explicitly, with no experience passed — the baseline.
      const held = currentPurePremiumPer100(line, y, active);
      if (exp !== null && exp > 0 && held > 0) {
        acc[line].expOverHeld.push(exp / held);
        if (prev[line] !== undefined && prev[line] > 0) acc[line].yoy.push(Math.abs(exp / prev[line] - 1));
        prev[line] = exp;
      }
    }
    const p = processYear(gs, defaultDecisionSet(y));
    st = p.updatedPoolState;
    gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
  }
  // Realised loss cost on accident years the game ran to maturity.
  const S = st as never as {
    allMarketMembers: Member[]; membershipHistory: never;
    lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[]; members: Member[] }>;
  };
  for (const line of LINES) {
    // ⚠ TWO DIFFERENT ROW SETS HERE, DELIBERATELY. The RATE is windowed because
    // that is what the engine prices off. The REALISED loss cost is NOT: it is a
    // statement about what the pool's accident years actually cost, and the
    // window is a pricing convention rather than a fact about the losses. Using
    // the window for both would compare the rate against a truth the window had
    // already trimmed, and arm 1 would grade the estimate against itself.
    const basis: ExperienceBasis = {
      rows: S.lines[line]?.reserveDevelopment ?? [],
      allMarketMembers: S.allMarketMembers, membershipHistory: S.membershipHistory,
    };
    const expNow = experienceRatePer100(line, { ...basis, rows: windowRows(basis.rows) });
    for (const r of basis.rows) {
      if (r.seeded) continue;
      const u = r.ultimateByValuation ?? [];
      const lastAge = (r.ageAtFirstValuation ?? 0) + u.length - 1;
      if (lastAge < r.horizon || u.length === 0) continue;
      let e = 0;
      for (const m of S.allMarketMembers) {
        if (wasActiveInLine(S.membershipHistory, m.id, line, r.yearNumber)) e += getMemberExposure(m, line, r.yearNumber);
      }
      if (!(e > 0)) continue;
      acc[line].realised.push(u[u.length - 1] / (e * 10_000));
      acc[line].heldAtMature.push(currentPurePremiumPer100(line, r.yearNumber, S.lines[line]?.members ?? []));
      if (expNow !== null) acc[line].expAtMature.push(expNow);
    }
  }
}

console.log(RULE);
console.log('EXPERIENCE PRICING — the three measurements at PRICING_TRIANGLE');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, identical seeds on both arms.\n`);

console.log('--- ARM 1: DOES THE TRIANGLE PRICE SANELY? ---');
console.log('  Both rates against the REALISED ultimate loss cost on mature accident years.');
console.log('  "Close to the held rate" is NOT the test — the held rate is itself heavy.\n');
console.log('  line      realised/100   held/100   realised/held   experience/held   experience vs realised');
for (const line of LINES) {
  const a = acc[line];
  const realised = mean(a.realised), held = mean(a.heldAtMature);
  const expOverHeld = mean(a.expOverHeld);
  const expVsRealised = (expOverHeld * held) / realised - 1;
  console.log(`  ${line.padEnd(9)} ${realised.toFixed(4).padStart(12)}   ${held.toFixed(4).padStart(8)}   `
    + `${(realised / held).toFixed(3).padStart(13)}   ${expOverHeld.toFixed(3).padStart(15)}   `
    + `${(expVsRealised >= 0 ? '+' : '') + (100 * expVsRealised).toFixed(1)}%`);
  if (Math.abs(expVsRealised) > MAX_LEVEL_ERROR) {
    failed.push(`ARM 1 ${line}: the experience rate is ${(100 * expVsRealised).toFixed(1)}% from the realised `
      + `loss cost, outside the ${(100 * MAX_LEVEL_ERROR).toFixed(0)}% bound.`);
  }
}

console.log('\n--- ARM 2: WHAT DOES THE RATE DO YEAR TO YEAR? ---');
console.log('  line      median move   p90 move   share of years moving >20%');
for (const line of LINES) {
  const v = [...acc[line].yoy].sort((a, b) => a - b);
  const med = v[Math.floor(0.5 * v.length)] ?? NaN;
  const p90 = v[Math.floor(0.9 * v.length)] ?? NaN;
  const big = v.filter(x => x > 0.2).length / v.length;
  console.log(`  ${line.padEnd(9)} ${(100 * med).toFixed(1).padStart(10)}%   ${(100 * p90).toFixed(1).padStart(7)}%   ${(100 * big).toFixed(1).padStart(20)}%`);
  if (big > MAX_BIG_MOVE_SHARE) {
    failed.push(`ARM 2 ${line}: ${(100 * big).toFixed(1)}% of years move more than 20%, over the `
      + `${(100 * MAX_BIG_MOVE_SHARE).toFixed(0)}% bound. A rolling window should give a few points, not twenty.`);
  }
}

console.log('\n--- ARM 3: DOES THE LOOP STAY STABLE? ---');
console.log('  Price chases the roster through the enrolled book; the roster chases price');
console.log('  through member movement. The held pure premium is what broke that loop, and');
console.log('  S3 removes it. NOT BUILT.');
failed.push('ARM 3: loop stability is NOT MEASURED. It is the protection finding 17 relied on and '
  + 'S3 removes it, so PRICING_TRIANGLE must not be enabled until this arm exists and passes. '
  + 'Build it as: perturb the rate, run the roster forward, and assert enrolment and rate both '
  + 'settle rather than diverging or oscillating.');

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('');
  console.log('⚠ EXPECTED RED PENDING ARM 3 AND GL. This gate is PRICING_TRIANGLE\'s retirement');
  console.log('  condition: when all three arms pass, remove its EXPECTED_RED entry and the flag');
  console.log('  goes with it. Do not turn the flag on before then.');
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('ALL THREE MEASUREMENTS PASS — PRICING_TRIANGLE HAS NOTHING LEFT TO JUSTIFY IT.');
  console.log('Remove its EXPECTED_RED entry in scripts/gates.ts, delete the flag, and make the');
  console.log('experience rate unconditional.');
  console.log(RULE);
}
