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
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear, currentPurePremiumPer100 } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { experienceRatePer100, type ExperienceBasis } from '../../src/utils/experienceRating';
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
      const basis: ExperienceBasis = {
        rows: S.lines[line]?.reserveDevelopment ?? [],
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
    const basis: ExperienceBasis = {
      rows: S.lines[line]?.reserveDevelopment ?? [],
      allMarketMembers: S.allMarketMembers, membershipHistory: S.membershipHistory,
    };
    const expNow = experienceRatePer100(line, basis);
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
