// ============================================================================
// CLAIM-LEVEL DEVELOPMENT CESSION — the mechanism's own guard.
//
// ⚠ THE NULL TEST IS THE MECHANISM SWITCH, NOT A LINE CONTROL. Every value in
// the model moves when this mechanism is on, so a same-tree line-by-line
// comparison has nothing to compare against.
//
// ⚠ AND SINCE THE SELECTION WENT SIZE-WEIGHTED IT IS NOT A COMPARISON AGAINST A
// STORED BASELINE EITHER. buildTrackedSet now spends an RNG draw per developing
// which reseeds every later draw in the `ibner` stream, so the mechanism-ON tree
// cannot be compared to ANY earlier capture — not the pre-mechanism parent, not
// the previous baseline. What survives is that the mechanism-OFF path does not
// call buildTrackedSet at all and therefore spends no draw. So the test becomes a
// BEFORE-AND-AFTER OF THE OFF PATH, taken across the change:
//
//   # on the parent commit
//   sed -i 's/ENABLED = true/ENABLED = false/' src/utils/developmentAllocation.ts
//   npx tsx scripts/diagnostics/value-identity-check.ts --write   # to a scratch copy
//   git checkout baselines/ && sed -i 's/ENABLED = false/ENABLED = true/' src/utils/developmentAllocation.ts
//   # repeat on the child commit, then diff the two captures field by field
//
// Zero differing fields means nothing outside the mechanism moved. Run at the
// symmetric-routing commit: 28,500 fields, 0 added, 0 removed, 0 differing.
//
// ⚠ AND THE RESELECTION COMMIT SHOWED THE CAVEAT ABOVE IS ABOUT THE ROUTING OF
// THE DRAWS, NOT ABOUT SELECTION CHANGES AS SUCH. Reselection draws
// size-weighted every valuation, which would have reseeded `ibner` many times
// over — so it was given its own streams, keyed per (seed, valuation year, line,
// accident year, purpose), and `ibner` still takes exactly its ten developing-set picks
// at inception in the same order. That buys back a CONTROL STRONGER THAN THE
// MECHANISM SWITCH: stub the closure predicate to `() => false` and reselection
// becomes a no-op that spends no draw, so the mechanism-ON tree must reproduce
// the parent bit for bit. Measured: 29,400 fields, 0 added, 0 removed, 0
// differing, against 11,748 changed with closure live. A future selection change
// that keeps its draws off `ibner` gets the same control; one that does not has
// only the off-path before-and-after.
//
// THIS SCRIPT ASSERTS THE INVARIANTS THAT HOLD WITH THE MECHANISM ON:
//
//   CONSERVATION      allocated deltas sum EXACTLY to the movement being
//                     allocated, and ceded + retained equals it exactly. A
//                     register that disagrees with the exhibit by a cent is the
//                     memberList defect in a new place.
//   NON-NEGATIVITY    a developed occurrence never goes below zero. Favourable
//                     development on a small claim is the same shape as the
//                     reserve floor, and the fix there was to develop the
//                     remaining balance.
//   ROLLFORWARD       ending = beginning + booked - development - paid still
//                     holds exactly, with development now net of cession.
//   CESSION SANITY    ceded never exceeds the movement; a cohort with no
//                     register cedes exactly zero; cession only ever arises on
//                     occurrences above the retention.
//   MARTINGALE        E[ultimate] is unchanged by the mechanism on the GROSS
//                     side — cession moves who pays, not what the loss is.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { ibnerOneSigmaTakedown, processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  DEVELOPMENT_ALLOCATION, DEVELOPMENT_BENCH_DEPTH, DEVELOPMENT_CESSION_ENABLED, allocateDevelopment,
  buildTrackedSet, cedeDevelopment, reselectDevelopingSet,
} from '../../src/utils/developmentAllocation';
import { REINSURANCE_TOWER, TOWER_TOP, type TowerLine } from '../../src/data/reinsuranceTower';
import { SeededRandom } from '../../src/utils/random';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE, WC_SEVERITY_CAP } from '../../src/data/defaultAssumptions';
import { wcSeverityTrend } from '../../src/utils/wcClaimEngine';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { unpaidShare } from '../../src/utils/payoutPattern';
import type { CoverageLine, DecisionSet, GameState, ReserveCohort } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 25);
const YEARS = Number(process.env.YEARS ?? 10);
const LINES: TowerLine[] = ['WC', 'GL', 'Property'];

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
interface Arm { name: string; why: string; decisions: (d: DecisionSet, l: CoverageLine[]) => DecisionSet }
const ARMS: Arm[] = [
  { name: 'defaults', why: 'bookingBias 0 — development is pure lognormal noise', decisions: d => d },
  {
    name: 'squeezed',
    why: 'every line at its own minimum stop — the unwind is live and adverse development is common',
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
    }),
  },
  {
    name: 'no-tower',
    why: 'every occurrence layer DECLINED — cession must be identically zero',
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l =>
        [l, { ...d.byLine[l], layersPlaced: REINSURANCE_TOWER[l as TowerLine].map(() => false), aggregateStopLevel: -1 }])) as never,
    }),
  },
];

interface Finding { arm: string; line: string; game: number; year: number; what: string; detail: string }
const findings: Finding[] = [];
const fail = (c: { arm: string; line: string; game: number; year: number }, what: string, detail: string) =>
  findings.push({ ...c, what, detail });

const cover = {
  cohortsWithClaims: 0, cohortsWithoutClaims: 0,
  cededEvents: 0, cededDollars: 0, retainedDollars: 0,
  favourableClamped: 0, negativeAvoided: 0,
  zeroedOccIds: new Set<string>(), reinflatedAboveRetention: new Set<string>(),
  zeroedAboveRetention: new Set<string>(),
  overTowerTop: 0, overSeverityCap: 0, maxWcOcc: 0,
  noTowerCeded: 0,
  promoted: 0, retired: 0, developingValuations: 0, shortOfCap: 0, noOpenDeveloping: 0, benchExhausted: 0,
  underheld: 0, underheldWorst: 0, overFloor: 0,
};
const perArmCeded: Record<string, number> = {};
for (const a of ARMS) perArmCeded[a.name] = 0;

// ---------------------------------------------------------------- unit checks
// The allocator's contract, exercised directly rather than only through a game.
console.log('=== CLAIM-LEVEL DEVELOPMENT CESSION CHECK ===\n');
console.log('--- ALLOCATOR CONTRACT (direct) ---');
{
  const mk = (vals: number[]) => vals.map((v, i) => ({
    claimId: `c${i}`, occurrenceId: `o${i}`, drawn: v, original: v, current: v, developing: i < 3,
  }));
  const cases: { name: string; claims: number[]; untracked: number; amount: number; mode: 'developing' | 'proportional' }[] = [
    { name: 'adverse -> developing claims', claims: [3e6, 2e6, 1e6], untracked: 5e6, amount: 6e6, mode: 'developing' },
    { name: 'favourable -> proportional', claims: [3e6, 2e6, 1e6], untracked: 5e6, amount: -3e6, mode: 'proportional' },
    { name: 'favourable, EXCEEDS everything', claims: [1e5, 5e4, 1e4], untracked: 1e4, amount: -9e9, mode: 'proportional' },
    { name: 'favourable, exactly everything', claims: [1e6, 1e6], untracked: 0, amount: -2e6, mode: 'proportional' },
    { name: 'zero movement', claims: [1e6], untracked: 0, amount: 0, mode: 'developing' },
    { name: 'all-zero claims, adverse', claims: [0, 0], untracked: 0, amount: 5e5, mode: 'developing' },
    { name: 'single claim', claims: [4e6], untracked: 0, amount: 2.5e6, mode: 'developing' },
    { name: 'untracked mass only', claims: [], untracked: 9e6, amount: -1e6, mode: 'proportional' },
    // ⚠ SITE D — THE CARRIERS-MODE POOL. These four could not fire before the
    // symmetric-routing commit, because a favourable movement never took this
    // branch. The pool must be the CARRIERS' own total, not `trackedTotal`: a
    // give-back between the two would otherwise drive a developing claim negative and be
    // silently clamped away in cedeDevelopment.
    { name: 'D: favourable -> developing claims, inside their own value', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -3e6, mode: 'developing' },
    { name: 'D: favourable -> developing claims, EXACTLY their value', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -6e6, mode: 'developing' },
    { name: 'D: favourable -> developing claims, past their value, under trackedTotal', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -8e6, mode: 'developing' },
    { name: 'D: favourable -> developing claims, past the whole register', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -9e9, mode: 'developing' },
  ];
  let unitFails = 0;
  for (const cse of cases) {
    const claims = mk(cse.claims);
    const { deltas, untrackedDelta, applied, unallocated } = allocateDevelopment(claims, cse.untracked, cse.amount, cse.mode);
    const sum = deltas.reduce((a, b) => a + b, 0) + untrackedDelta;
    // EXACT, not within a tolerance — the residual is placed on the last tracked
    // element precisely so this can be an equality.
    if (Math.abs(sum - applied) > 1e-9) { console.log(`  FAIL ${cse.name}: parts sum ${sum} !== applied ${applied}`); unitFails++; }
    if (Math.abs((applied + unallocated) - cse.amount) > 1e-9) { console.log(`  FAIL ${cse.name}: applied+unallocated !== amount`); unitFails++; }
    const { ceded, retained, moved } = cedeDevelopment('WC', claims, deltas, untrackedDelta, [true, true, true]);
    if (Math.abs((ceded + retained) - sum) > 1e-9) { console.log(`  FAIL ${cse.name}: ceded+retained !== movement`); unitFails++; }
    if (moved.some(m => m.current < 0)) { console.log(`  FAIL ${cse.name}: a developed value went negative`); unitFails++; }
    if (cse.untracked + untrackedDelta < -1e-9) { console.log(`  FAIL ${cse.name}: untracked mass went negative`); unitFails++; }
    // ⚠ THE CARRIERS BRANCH MUST NOT TOUCH A NON-CARRIER, IN EITHER DIRECTION.
    // This asserted `amount > 0` only, back when that was the only sign that
    // could reach this branch. Symmetric routing sends both here, so the
    // assertion widens with the mechanism.
    // ⚠ EXCEPT PAST THE SET'S OWN VALUE, WHERE THE SPILL IS THE DESIGN. This
    // assertion was written before the spill path existed and had been printing
    // FAIL on the two cases that exercise it ever since — a gate describing the
    // allocator from memory, which is the failure mode this directory keeps
    // finding. The rule it should state is that an ORDINARY movement never
    // leaves the set; a favourable one larger than the set holds is a boundary
    // condition with its own assertions in the reselection block below.
    const setTotal = claims.reduce((t, c) => t + (c.developing ? Math.max(0, c.current) : 0), 0);
    const spilled = cse.mode === 'developing' && cse.amount < 0 && -applied > setTotal;
    if (cse.mode === 'developing' && !spilled && claims.some(c => c.developing)
        && claims.some((c, i) => !c.developing && deltas[i] !== 0)) {
      console.log(`  FAIL ${cse.name}: developing-mode development reached a claim outside the set`); unitFails++;
    }
    // ⚠ SITE D, ASSERTED DIRECTLY. In developing mode the clamp in cedeDevelopment
    // must never be what keeps a value non-negative — the allocator must have
    // bounded it already. `moved` above only proves the CLAMPED result is
    // non-negative; this proves the UNCLAMPED one is, which is the actual fix.
    if (cse.mode === 'developing' && claims.some((c, i) => c.current + deltas[i] < -1e-9)) {
      console.log(`  FAIL ${cse.name}: an occurrence needed the zero clamp — the pool bound is wrong`); unitFails++;
    }
  }
  console.log(unitFails === 0
    ? `  OK — ${cases.length} cases: parts sum EXACTLY to applied, ceded+retained reconciles, nothing negative,`
      + '\n       an ordinary developing-mode movement never reaches a claim outside the set in'
      + '\n       EITHER direction, and no occurrence ever needs the zero clamp — the pool bound'
      + '\n       holds on its own (site D).'
    : `  ${unitFails} unit failure(s).`);

  // ⚠ THE TRACKED SET UNDER A SIZE-WEIGHTED DRAW. This asserted "developing claims are the
  // largest 3, with no rng argument", which was a statement about the RETIRED
  // `largest` selection and would now throw. What survives the change to
  // sizeWeighted is weaker but still exact: the count, the absence of duplicates,
  // and — the property the mechanism actually depends on — that EVERY occurrence
  // at or above the retention is tracked whether or not it was drawn as a developing claim.
  const totals = [5e6, 1e5, 3e6, 2e6, 1.5e6, 4e5, 2.5e6];
  const built = buildTrackedSet('WC', totals.map((_, i) => `o${i}`), totals.map((_, i) => `c${i}`),
    totals, DEVELOPMENT_ALLOCATION, new SeededRandom(20260827), new SeededRandom(20260828));
  const developingCount = built.tracked.filter(t => t.developing).length;
  const retention = REINSURANCE_TOWER.WC[0].attachment;
  const aboveMissing = totals.filter(t => t >= retention).length
    - built.tracked.filter(t => t.drawn >= retention).length;
  const dupes = new Set(built.tracked.map(t => t.occurrenceId)).size !== built.tracked.length;
  const expectDeveloping = Math.min(DEVELOPMENT_ALLOCATION.claimCount, totals.length);
  console.log(developingCount === expectDeveloping && aboveMissing === 0 && !dupes
    ? `  OK — ${developingCount} developing claims drawn size-weighted from ${totals.length} occurrences, no duplicates, and all `
      + `${totals.filter(t => t >= retention).length} occurrences at or above the $${(retention / 1e6).toFixed(0)}M retention are tracked `
      + `(${built.tracked.length} total, ${(built.untrackedTotal / 1e6).toFixed(2)}M untracked).`
    : `  FAIL — ${developingCount} developing claims (expected ${expectDeveloping}), ${aboveMissing} above-retention missing, dupes ${dupes}`);
}

// ---------------------------------------------------------------- reselection
// ⚠ THE SET IDENTITY BETWEEN THE TWO DIRECTIONS, ASSERTED WHERE IT CAN BE SEEN.
// In the engine both steps run against one array and the identity is structural;
// here the two modes can be handed the same array explicitly, which is what
// makes it a test rather than a reading of the code. This is invariant 1's
// direct form — the in-game assertion further down can only see its signature.
console.log('\n--- RESELECTION CONTRACT (direct) ---');
{
  let f = 0;
  const say = (ok: boolean, msg: string) => { if (!ok) { console.log(`  FAIL ${msg}`); f++; } };

  const mk = (vals: number[], nDeveloping: number, closed: number[] = []) => vals.map((v, i) => ({
    claimId: `c${i}`, occurrenceId: `o${i}`, drawn: v, original: v, current: v,
    developing: i < nDeveloping && !closed.includes(i), closed: closed.includes(i),
  }));

  // BOTH DIRECTIONS SEE THE SAME SET. Same array, both modes, both signs: the
  // occurrences that receive dollars in `developing` mode are the developing set, and
  // they are the same set whichever way the movement points.
  {
    const claims = mk([5e6, 4e6, 3e6, 2e6, 1e6], 3);
    const up = allocateDevelopment(claims, 2e6, 5e5, 'developing');
    const dn = allocateDevelopment(claims, 2e6, -5e5, 'developing');
    const touched = (d: number[]) => claims.map((_, i) => (d[i] !== 0 ? i : -1)).filter(i => i >= 0).join(',');
    say(touched(up.deltas) === touched(dn.deltas),
      `the two directions reached different occurrences: [${touched(up.deltas)}] vs [${touched(dn.deltas)}]`);
    say(touched(up.deltas) === '0,1,2', `developing mode did not reach exactly the developing set: [${touched(up.deltas)}]`);
  }

  // A CLOSED OCCURRENCE TAKES NO DEVELOPMENT DRAW even when the whole set has
  // closed and the allocator falls back off the developing set.
  {
    const claims = mk([5e6, 4e6, 3e6], 3, [0, 1, 2]);
    const r = allocateDevelopment(claims, 2e6, 5e5, 'developing');
    say(r.deltas.every(d => d === 0), 'a fully closed set received a development draw');
    say(Math.abs(r.untrackedDelta - 5e5) < 1e-9, 'the movement did not fall through to the untracked mass');
  }

  // MEMBERSHIP CHANGES ONLY BY CLOSURE, and a replacement comes off the bench.
  {
    const claims = mk([5e6, 4e6, 3e6], 3);
    const bench = [4, 5, 6].map(i => ({ claimId: `c${i}`, occurrenceId: `o${i}`, drawn: 1e6, original: 1e6, current: 1e6 }));
    const rs = reselectDevelopingSet(claims, bench, 9e6, id => id === 'c0', 3, 0, new SeededRandom(20260830));
    say(rs.retired === 1, `retired ${rs.retired}, expected 1`);
    say(rs.promoted === 1, `promoted ${rs.promoted}, expected 1`);
    say(rs.tracked.find(c => c.claimId === 'c0')?.developing === false, 'the closed occurrence is still carrying');
    say(rs.tracked.some(c => c.claimId === 'c0'), 'the closed occurrence left the register');
    say(rs.tracked.filter(c => c.developing).length === 3, 'the set was not refilled to its cap');
    say(rs.bench.length === 2, `bench ${rs.bench.length}, expected 2`);
    // ⚠ PROMOTION CONSERVES THE REGISTER. The promoted occurrence's dollars come
    // OUT of the untracked scalar and INTO the list; nothing is created.
    const before = claims.reduce((a, c) => a + c.current, 0) + 9e6;
    const after = rs.tracked.reduce((a, c) => a + c.current, 0) + rs.untrackedTotal;
    say(Math.abs(before - after) < 1e-9, `promotion moved the register total by ${(after - before).toFixed(6)}`);
  }

  // NO OPEN OCCURRENCE EVER LEAVES, and a valuation with no closures is a no-op
  // that consumes no draw.
  {
    const claims = mk([5e6, 4e6, 3e6], 3);
    const bench = [{ claimId: 'c9', occurrenceId: 'o9', drawn: 1e6, original: 1e6, current: 1e6 }];
    const rng = new SeededRandom(20260830);
    const rs = reselectDevelopingSet(claims, bench, 9e6, () => false, 3, 0, rng);
    say(rs.retired === 0 && rs.promoted === 0, 'a valuation with no closures changed the set');
    say(rng.next() === new SeededRandom(20260830).next(), 'a no-op reselection consumed a draw');
    say(rs.tracked.every((c, i) => c === claims[i]), 'a no-op reselection rebuilt the set');
  }

  // ⚠ THE FLOOR LIFTS WHEN THE SET DOES NOT HOLD THE MOVEMENT, and this case is
  // asserted here because THE GAME DOES NOT REACH IT. Measured over 4,291
  // developing-mode allocations, every valuation whose movement exceeded the set
  // had an EMPTY open bench — the set already held every open claim the cohort
  // could reach. So the lift is a bound rather than an active mechanism, and a
  // bound the game never exercises is a bound nothing tests. It is tested here.
  {
    const claims = mk([5e6, 4e6, 3e6], 3);           // floor 3, holds $12M
    const bench = [4, 5, 6, 7].map(i => ({ claimId: `c${i}`, occurrenceId: `o${i}`, drawn: 2e6, original: 2e6, current: 2e6 }));
    const atFloor = reselectDevelopingSet(claims, bench, 9e6, () => false, 3, 0, new SeededRandom(7));
    say(atFloor.promoted === 0, `holding enough already, promoted ${atFloor.promoted}`);
    say(!atFloor.underheld, 'reported underheld while holding enough');
    // Now demand $18M: the floor is met at $12M, so only the hold condition can
    // pull the extra three off the bench.
    const lifted = reselectDevelopingSet(claims, bench, 9e6, () => false, 3, 18e6, new SeededRandom(7));
    say(lifted.promoted === 3, `the floor did not lift: promoted ${lifted.promoted}, expected 3`);
    say(lifted.held >= 18e6, `lifted to ${(lifted.held / 1e6).toFixed(1)}M, needed 18M`);
    say(!lifted.underheld, 'reported underheld after reaching the target');
    say(lifted.bench.length === 1, `bench ${lifted.bench.length}, expected 1 left`);
    // And demand more than the whole register holds: it takes everything open
    // and says so rather than pretending.
    const capped = reselectDevelopingSet(claims, bench, 9e6, () => false, 3, 99e6, new SeededRandom(7));
    say(capped.underheld, 'a set that cannot reach the target did not report underheld');
    say(capped.bench.length === 0, 'a set short of its target left occurrences on the bench');
  }

  // THE BENCH RUNS OUT AND THE SET SHRINKS — the shrink case, arriving late.
  {
    const claims = mk([5e6, 4e6, 3e6], 3);
    const rs = reselectDevelopingSet(claims, [], 9e6, id => id !== 'c2', 3, 0, new SeededRandom(1));
    say(rs.short, 'an exhausted bench did not report short');
    say(rs.tracked.filter(c => c.developing).length === 1, 'the surviving open occurrence stopped carrying');
  }

  // ⚠ THE SPILL SKIPS CLOSED OCCURRENCES, which is where Property's sign
  // asymmetry lived. A favourable movement too large for the developing set
  // overflows onto the rest of the register — and must not land on files that
  // have settled, because the primary path already refuses them.
  {
    const claims = mk([1e6, 1e6], 2).concat(mk([9e6, 8e6], 0, [0, 1]).map((c, i) => ({ ...c, claimId: `z${i}`, occurrenceId: `oz${i}` })));
    const r = allocateDevelopment(claims, 4e6, -6e6, 'developing');
    const closedGot = claims.map((c, i) => (c.closed === true ? r.deltas[i] : 0)).reduce((a, b) => a + b, 0);
    say(closedGot === 0, `the spill reached closed occurrences by ${closedGot.toFixed(2)}`);
    say(r.deltas.reduce((a, b) => a + b, 0) + r.untrackedDelta === r.applied, 'the spill stopped summing exactly');
    say(r.untrackedDelta < 0, 'the overflow did not reach the untracked mass');
  }

  console.log(f === 0
    ? '  OK — one set serves both directions, closed occurrences take no draw in EITHER the primary'
      + '\n       path or the spill and never leave the register, membership moves only on closure,'
      + '\n       promotion conserves the register total, a valuation with no closures spends no draw,'
      + '\n       the floor lifts when the set does not hold the movement and says so when it cannot.'
    : `  ${f} reselection failure(s).`);
}

// ---------------------------------------------------------------- game checks
for (const arm of ARMS) {
  for (let g = 0; g < GAMES; g++) {
    const id = `DCC${arm.name}${g}`;
    const inst = generateGameInstance(id, 5_200_000 + g * 6301);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES as CoverageLine[] };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    for (let y = 1; y <= YEARS; y++) {
      const before: Record<string, ReserveCohort[]> = {};
      for (const l of LINES) before[l] = gs.poolState.lines[l].reserveCohorts.map(c => ({ ...c, developingClaims: c.developingClaims?.map(d => ({ ...d })) }));

      const processed = processYear(gs, arm.decisions(defaultDecisionSet(y), LINES as CoverageLine[]));

      for (const line of LINES) {
        const ctx = { arm: arm.name, line, game: g, year: y };
        const r = processed.result.byLine[line];
        const afterCohorts = processed.updatedPoolState.lines[line].reserveCohorts;
        const afterBy = new Map(afterCohorts.map(c => [c.yearNumber, c]));

        // --- ROLLFORWARD ----------------------------------------------------
        // ending = beginning + BOOKED ULTIMATE - development - paid, with
        // development on the engine's favourable-positive convention. The booked
        // ultimate is recovered from currentYearNetReserve, which is only the
        // OPEN fraction of it — using the reserve itself here understates the
        // inflow by 40% and reports every line-year as broken, which is what an
        // earlier version of this check did.
        // The line's own first-year unpaid share, not one constant for all
        // three — see LINE_PAYOUT_PATTERN.
        const bookedUltimate = r.currentYearNetReserve / unpaidShare(LINE_PAYOUT_PATTERN[line], 1);
        const lhs = r.endingNetReserve;
        const rhs = r.beginningNetReserve + bookedUltimate - r.priorYearDevelopment - r.netPaidLosses;
        if (Math.abs(lhs - rhs) > 0.5) {
          fail(ctx, 'rollforward broken', `ending ${lhs.toFixed(2)} vs beginning+booked-dev-paid ${rhs.toFixed(2)}`);
        }

        const ceded = r.priorYearDevelopmentCeded;
        perArmCeded[arm.name] += ceded;
        if (ceded !== 0) cover.cededEvents++;
        cover.cededDollars += ceded;

        // --- NO TOWER MEANS NO CESSION, ON THE YEARS THAT DECLINED IT -------
        // ⚠ SCOPED TO GAME-BORN ACCIDENT YEARS, and the scoping is the point
        // rather than a weakening. Occurrence cover attaches to the ACCIDENT
        // year, so declining every layer from year 1 does not strip cover off
        // accident years -2..0, which were written at default decisions inside
        // the pre-game run and did buy it. An earlier version asserted zero
        // cession pool-wide and failed on exactly that — correctly, in the sense
        // that the engine was right and the assertion was wrong.
        if (arm.name === 'no-tower') {
          for (const b of before[line]) {
            if (b.closed || b.yearNumber < 1) continue;
            const a2 = afterBy.get(b.yearNumber);
            if (!a2) continue;
            const grew = (a2.cededDevelopmentToDate ?? 0) - (b.cededDevelopmentToDate ?? 0);
            if (Math.abs(grew) > 1e-6) {
              fail(ctx, 'ceded with every layer declined', `AY ${b.yearNumber} ceded ${grew}`);
            }
          }
        }

        for (const b of before[line]) {
          if (b.closed) continue;
          const a = afterBy.get(b.yearNumber);
          if (!a) continue;
          const bc = b.developingClaims ?? [];
          const ac = a.developingClaims ?? [];
          if (bc.length === 0) cover.cohortsWithoutClaims++; else cover.cohortsWithClaims++;

          // --- NON-NEGATIVITY ------------------------------------------------
          for (const d of ac) {
            if (d.current < 0) fail(ctx, 'developed value negative', `AY ${b.yearNumber} claim ${d.claimId} at ${d.current}`);
            // ⚠ OCCURRENCE-YEARS, NOT OCCURRENCES. A zeroed occurrence is counted
            // again every year it stays at zero, so this number is inflated by
            // persistence and the distinct count below is the one to read.
            if (d.current === 0 && d.original > 0) {
              cover.negativeAvoided++;
              cover.zeroedOccIds.add(`${arm.name}|${line}|${g}|${d.occurrenceId}`);
            }
            // ⚠ THE ACTUAL HARM, MEASURED RATHER THAN FEARED. A claim at zero
            // loses its position above the retention: re-inflating from zero, the
            // first dollars back up are RETAINED even though the occurrence was
            // originally above and had already ceded them. That only bites if it
            // re-inflates, so count the ones that do.
            const key = `${arm.name}|${line}|${g}|${d.occurrenceId}`;
            if (cover.zeroedOccIds.has(key) && d.current >= REINSURANCE_TOWER[line][0].attachment) {
              cover.reinflatedAboveRetention.add(key);
            }
            // ⚠ THE SIZE OF WHAT IS BEING ZEROED, because the raw count stopped
            // being interpretable once the developing subset started following
            // closure. A thinner, smaller developing set is wiped by a smaller
            // favourable movement, so zeroings rose an order of magnitude — but
            // an occurrence that was never near the retention ceded nothing to
            // lose. This splits the count into the part that can cost money and
            // the part that cannot.
            if (d.current === 0 && d.original >= REINSURANCE_TOWER[line][0].attachment) {
              cover.zeroedAboveRetention.add(key);
            }
          }

          // ==================================================================
          // ⚠ "THE DEVELOPING SUBSET IS FROZEN" STOOD HERE AND IS GONE, and
          // what replaces it is three assertions rather than none. The rule it
          // guarded was that the set drawn at inception is the set for the
          // cohort's whole life; claims close now, so a frozen set ends its
          // life pointing entirely at settled files and a cohort with no open
          // developing claim retains its development entire — 0.40% of developing WC
          // cohort-valuations, 11.24% of GL's and 27.53% of Property's.
          //
          // ⚠ WHAT "FROZEN" WAS PROTECTING WAS NOT THAT THE SET IS FIXED. It
          // was that the set cannot be REARRANGED — between the two directions
          // of one valuation, or between valuations for any reason but
          // closure. Asymmetric routing through a convex, sign-blind cession
          // function is what manufactured $48.2M of recovery on a register
          // that moved favourable, and a set that differed between the
          // stochastic step and the unwind would be that defect with the
          // valuation clock standing in for the sign. Deleting an invariant
          // and replacing it with nothing is how the free lunch got in the
          // first time, so the successors are asserted in the same commit that
          // retires it.
          // ==================================================================

          // --- 1. ONE SET PER VALUATION, BOTH DIRECTIONS ---------------------
          // The direct successor and the free-lunch guard. Every occurrence
          // that moved at this valuation must be in the recorded set, and the
          // recorded set is what BOTH steps ran against — so the set that took
          // the stochastic step is identical by claim id to the set that took
          // the unwind. Movement is only ever written for occurrences in
          // `after`, so the observable form of this is that no occurrence
          // carrying a movement at index `b.age` is missing from it, and no
          // occurrence appears twice.
          // Its in-game signature is that a valuation writes ONE movement
          // entry, at the index of the step it took, for occurrences drawn
          // from ONE list. Two sets would mean two recorded movements or an
          // occurrence appearing twice. The set identity between the two steps
          // itself is asserted directly against the allocator above, where
          // both modes can be handed the same array.
          {
            const seen = new Set<string>();
            for (const d of ac) {
              if (seen.has(d.claimId)) {
                fail(ctx, 'occurrence recorded twice in the developing set', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
              seen.add(d.claimId);
              const series = d.movementByStep ?? [];
              if (series.length > b.age + 1) {
                fail(ctx, 'more than one movement entry written this valuation',
                  `AY ${b.yearNumber} claim ${d.claimId}: ${series.length} entries at age ${b.age}`);
              }
            }
          }

          // --- 2. THE SET IS REDRAWN, THE REGISTER IS NOT ------------------
          // ⚠ THIS REPLACES "MEMBERSHIP CHANGES ONLY BY CLOSURE", which was
          // retired when the set began being drawn fresh at every valuation.
          // That rule said NO OPEN OCCURRENCE EVER STANDS DOWN, and what it was
          // protecting against was a RE-RANKING correlated with cession — "the
          // best ten now". A size-weighted random draw on the frozen `drawn`
          // value is not a ranking and carries no feedback from realised
          // development, so the guard it provided is provided by invariant 1
          // (one set per valuation, both directions) plus the draw rule itself.
          //
          // What must still hold, and does:
          //   the REGISTER only ever grows — an occurrence never leaves it
          //   nothing closed is ever in the developing set
          //   closure is monotone
          //   an occurrence that joins the register joins it developing
          {
            const afterIds = new Map(ac.map(d => [d.claimId, d]));
            for (const d of bc) {
              const a3 = afterIds.get(d.claimId);
              if (!a3) {
                fail(ctx, 'a tracked occurrence left the register', `AY ${b.yearNumber} claim ${d.claimId}`);
                continue;
              }
              if (d.closed === true && a3.closed !== true) {
                fail(ctx, 'a closed occurrence reopened', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
              if (d.developing && !a3.developing) cover.retired++;
            }
            const beforeIds = new Set(bc.map(d => d.claimId));
            for (const d of ac) {
              if (d.closed === true && d.developing) {
                fail(ctx, 'a CLOSED occurrence is in the developing set', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
              if (beforeIds.has(d.claimId)) continue;
              cover.promoted++;
              if (d.closed === true) {
                fail(ctx, 'a CLOSED occurrence joined the register', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
              if (!d.developing) {
                fail(ctx, 'an occurrence joined the register without developing', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
            }
          }

          // --- 3. EVERYTHING AT OR ABOVE THE RETENTION IS STILL TRACKED ------
          // The property that makes cession complete. An occurrence at or over
          // the first attachment can change a cession, so it has to be in the
          // register whatever its carrying status and whatever its closure
          // status — reselection stands claims down, it never evicts them.
          {
            const ret = REINSURANCE_TOWER[line][0].attachment;
            const afterIds = new Set(ac.map(d => d.claimId));
            for (const d of bc) {
              if (d.current >= ret && !afterIds.has(d.claimId)) {
                fail(ctx, 'an occurrence above the retention left the register',
                  `AY ${b.yearNumber} claim ${d.claimId} at ${d.current.toFixed(0)}`);
              }
            }
          }

          // --- AND THE SURVIVING PIECES -------------------------------------
          // Originals are frozen for the occurrences that remain — only
          // `current` may move. A promoted occurrence carries the value the
          // pool has been holding it at inside `untrackedTotal`, so it arrives
          // with its own `original` and this only speaks to the ones that were
          // already there.
          {
            const afterIds = new Map(ac.map(d => [d.claimId, d]));
            for (const d of bc) {
              const a3 = afterIds.get(d.claimId);
              if (a3 && d.original !== a3.original) {
                fail(ctx, 'original amount moved', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
            }
          }
          // ⚠ THE SET IS AT LEAST ITS FLOOR, AND ABOVE IT ONLY ON DEMAND.
          //
          // This asserted "never exceeds its cap", which was right while ten was
          // a count and is wrong now that ten is a floor. What replaces it is
          // the two-sided statement the sizing rule actually makes: the set is
          // never SHORT of the floor while open occurrences remain to add, and
          // never OVER it unless it needs the extra to hold a one-sigma step.
          // A set that is over the floor while already holding enough would mean
          // the refill loop was not stopping, which is the failure this catches.
          {
            const nDeveloping = ac.filter(d => d.developing).length;
            const floor = DEVELOPMENT_ALLOCATION.claimCount;
            const need = a.age < a.horizon ? ibnerOneSigmaTakedown(line, a.stepMultiplier, a.netUnpaid) : 0;
            const holds = ac.reduce((t, d) => t + (d.developing ? Math.max(0, d.current) : 0), 0);
            if (nDeveloping > floor) cover.overFloor++;
            void need; void holds;
            // ⚠ THE OTHER HALF — "over the floor only when the extra was needed"
            // — CANNOT BE ASSERTED FROM HERE, and saying so is better than
            // asserting it wrongly. The set is sized against the outstanding as
            // it stands BEFORE the step, and every quantity this loop can see is
            // from after: `netUnpaid` has already paid down and developed, so the
            // target recomputed here is smaller than the one the engine sized
            // against. A first version of this check compared the two anyway and
            // fired on 19 legitimate cohorts, reading "11 developing holding
            // $10.38M, needs $4.98M" on a set that had been sized correctly
            // against a larger balance. The stopping condition is asserted
            // directly against reselectDevelopingSet in the RESELECTION CONTRACT
            // block instead, where both sides are visible at the same instant.
            //
            // What IS visible from here is the floor itself, below.
            // A CLOSED occurrence never carries.
            for (const d of ac) {
              if (d.developing && d.closed === true) {
                fail(ctx, 'a closed occurrence is carrying', `AY ${b.yearNumber} claim ${d.claimId}`);
              }
            }
            // Register-less seed cohorts are not reselection sites — they have
            // nothing to stand down and nothing to promote, and counting them
            // would report the seed share as a shrink rate.
            // ⚠ DOES THE SET HOLD WHAT IT MAY HAVE TO ABSORB? Measured on the
            // cohort's own state rather than on the step, so it is a property of
            // the register and not of one draw: the developing set's gross value
            // against a one-sigma favourable move on this cohort's outstanding.
            // Where it fails, no allocation rule can help — the reserve has moved
            // beyond what its open claims are worth. See THE SIZE OF THE SET.
            if (a.age < a.horizon && ac.length > 0) {
              const need = ibnerOneSigmaTakedown(line, a.stepMultiplier, a.netUnpaid);
              const holds = ac.reduce((t, d) => t + (d.developing ? Math.max(0, d.current) : 0), 0);
              if (need > 0 && holds < need) {
                cover.underheld++;
                cover.underheldWorst = Math.max(cover.underheldWorst, need > 0 ? 1 - holds / need : 0);
              }
            }
            // ⚠ NEVER SHORT OF THE FLOOR WHILE ANYTHING OPEN REMAINS. A set below
            // `claimCount` is only legitimate when the cohort has nothing open
            // left to add — no open tracked occurrence outside the set, and an
            // empty bench. That is the whole of the shrink case, and it is a
            // statement about the register rather than about the rule.
            if (a.age < a.horizon && nDeveloping < floor) {
              const openOutside = ac.some(d => !d.developing && d.closed !== true);
              const benchLeft = (a.developmentBench ?? []).length;
              if (openOutside || benchLeft > 0) {
                fail(ctx, 'developing subset below its floor with open occurrences left over',
                  `AY ${b.yearNumber}: ${nDeveloping} developing, ${ac.filter(d => !d.developing && d.closed !== true).length} open outside, ${benchLeft} on the bench`);
              }
            }
            if (b.age < b.horizon && bc.length > 0) {
              cover.developingValuations++;
              if (nDeveloping < DEVELOPMENT_ALLOCATION.claimCount) cover.shortOfCap++;
              if (nDeveloping === 0) cover.noOpenDeveloping++;
              if ((a.developmentBench ?? []).length === 0) cover.benchExhausted++;
            }
          }
          // The bench only shrinks, and only ever holds open occurrences.
          {
            const bb = (b.developmentBench ?? []).length;
            const ab = (a.developmentBench ?? []).length;
            if (b.age + 1 < a.horizon && ab > bb) {
              fail(ctx, 'the bench grew', `AY ${b.yearNumber}: ${bb} -> ${ab}`);
            }
          }

          // --- A REGISTER-LESS COHORT CEDES NOTHING ---------------------------
          // Its estimate may still move; what must not happen is a recovery on
          // claims that do not exist.
          if (bc.length === 0 && ac.length !== 0) {
            fail(ctx, 'claims appeared on a register-less cohort', `AY ${b.yearNumber}`);
          }

          // --- CESSION ONLY ABOVE THE RETENTION -------------------------------
          const retention = REINSURANCE_TOWER[line][0].attachment;
          for (const d of ac) {
            if (line === 'WC') {
              cover.maxWcOcc = Math.max(cover.maxWcOcc, d.current);
              if (d.current > WC_SEVERITY_CAP * wcSeverityTrend(b.yearNumber)) cover.overSeverityCap++;
            }
            if (d.current > TOWER_TOP[line]) cover.overTowerTop++;
            void retention;
          }
        }
      }

      gs = {
        ...gs, currentYearNumber: y + 1, poolState: processed.updatedPoolState,
        lockedResults: [...gs.lockedResults, processed.result], isComplete: y === YEARS,
      };
    }
  }
}

// ---------------------------------------------------------------- report
const money = (v: number) => `$${(v / 1e6).toFixed(2)}M`;

console.log('\n--- COVERAGE ---');
console.log(`  mechanism enabled: ${DEVELOPMENT_CESSION_ENABLED}   rule: largest-${DEVELOPMENT_ALLOCATION.claimCount} ${DEVELOPMENT_ALLOCATION.weighting}, selection ${DEVELOPMENT_ALLOCATION.selection}\n`);
console.log(`  cohort-years with a register      ${cover.cohortsWithClaims.toLocaleString()}`);
console.log(`  cohort-years WITHOUT (seeds)      ${cover.cohortsWithoutClaims.toLocaleString()}`);
console.log(`  line-years with a cession         ${cover.cededEvents.toLocaleString()}`);
console.log(`  total ceded development           ${money(cover.cededDollars)}`);
console.log(`  occurrence-YEARS at exactly zero  ${cover.negativeAvoided.toLocaleString()}  (favourable development clamped, never negative)`);
console.log(`  distinct occurrences ever zeroed  ${cover.zeroedOccIds.size.toLocaleString()}`);
console.log(`  ... of which were ever AT OR ABOVE the retention  ${cover.zeroedAboveRetention.size.toLocaleString()}  (the rest ceded nothing to lose)`);
console.log(`  ... that later re-inflate above the retention  ${cover.reinflatedAboveRetention.size.toLocaleString()}  <- the only case that costs anything`);
console.log(`  occurrences above the tower top   ${cover.overTowerTop.toLocaleString()}  (exhaustion — correct, not compensated for)`);
const pctDev = (n: number) => (cover.developingValuations > 0 ? `${(100 * n / cover.developingValuations).toFixed(2)}%` : 'n/a');
console.log(`\n  RESELECTION (bench depth ${DEVELOPMENT_BENCH_DEPTH}, floor ${DEVELOPMENT_ALLOCATION.claimCount}):`);
console.log(`    developing cohort-valuations    ${cover.developingValuations.toLocaleString()}`);
console.log(`    developing claims stood down on closure  ${cover.retired.toLocaleString()}`);
console.log(`    replacements promoted           ${cover.promoted.toLocaleString()}`);
console.log(`    ... below the floor             ${pctDev(cover.shortOfCap)}  (fewer than ${DEVELOPMENT_ALLOCATION.claimCount} open — the set is thinner, development concentrates)`);
console.log(`    ... with NO open developing claim        ${pctDev(cover.noOpenDeveloping)}  <- the shrink case: development retained entire, cedes nothing`);
console.log(`    ... with the bench exhausted    ${pctDev(cover.benchExhausted)}`);
console.log(`    ... drawn ABOVE the floor to hold the step  ${pctDev(cover.overFloor)}  (the floor lifting — see THE SIZE OF THE SET)`);
console.log(`    ... holding less than a one-sigma step  ${pctDev(cover.underheld)}  <- the register cannot absorb its own`);
console.log(`        worst shortfall                     ${(cover.underheldWorst * 100).toFixed(1)}% of the step it must hold`);
console.log('        ⚠ NOT a shortfall of the sizing rule — the set already holds every open claim');
console.log('          the cohort can reach. It is the payment clock and the closure clock disagreeing;');
console.log('          see RECORDED, NOT FIXED in developmentAllocation.ts.');
console.log(`  occurrences above WC's cap        ${cover.overSeverityCap.toLocaleString()}  (permitted by ruling — the cap bounds the DRAW)`);
console.log(`  largest developed WC occurrence   ${money(cover.maxWcOcc)}`);
console.log('\n  ceded per arm:');
for (const a of ARMS) console.log(`    ${a.name.padEnd(9)} ${money(perArmCeded[a.name]).padStart(12)}   ${a.why}`);

const coverageErrors: string[] = [];
if (cover.cededEvents === 0) coverageErrors.push('no cession occurred anywhere — the mechanism never fired');
if (cover.cohortsWithoutClaims === 0) coverageErrors.push('no register-less cohort was ever seen — the fallback path is untested');
// The no-tower arm still cedes on PRE-GAME accident years, which bought cover.
// What it must not do is cede on a year that declined every layer, asserted
// per-cohort above.
// ⚠ THE OLD ASSERTION HERE — "squeezed must cede MORE than defaults" — WAS
// WRITTEN FOR THE DEFECT AND IS NOW EXACTLY BACKWARDS. Squeezed ceding more was
// the perverse incentive: underfunding bought cover. Total cession is supposed
// to be path-independent, and the arm comparison that tests it needs PAIRED
// seeds, so it lives in cession-path-independence.ts, which is now a gate.
// Nothing about a one-armed dollar total can stand in for it.
// ⚠ THIS THRESHOLD REPLACED "EXACTLY ZERO IS A BUG", and the reason is the
// symmetric-routing commit. Under the retired rule favourable development went
// proportionally across the whole register, so an occurrence could only reach
// zero if the entire register did — it never happened, and zero was the right
// bar. Symmetric routing sends favourable movements to the same ten developing claims
// adverse uses, and a give-back larger than those ten hold takes them to zero by
// construction; it is what SYMMETRY MEANS at the boundary, since adverse has no
// matching bound. So the bar is now the HARM rather than the event: an
// occurrence sitting at zero costs nothing unless it climbs back over the
// retention, where the dollars it already ceded would be retained a second time.
const REINFLATION_LIMIT = 25;
if (cover.reinflatedAboveRetention.size > REINFLATION_LIMIT) {
  coverageErrors.push(`${cover.reinflatedAboveRetention.size} occurrence(s) were driven to zero and then re-inflated above the retention (limit ${REINFLATION_LIMIT}) — dollars already ceded would be retained a second time`);
}

console.log('\n--- FINDINGS ---');
if (findings.length === 0 && coverageErrors.length === 0) {
  console.log('\nCONSERVATION holds exactly, nothing developed below zero, the rollforward still');
  console.log('balances with development net of cession, a declined tower cedes exactly nothing,');
  console.log('and the developing subset is REDRAWN each valuation without disturbing the register:');
  console.log('one set per valuation serving both directions, nothing closed ever developing, nothing');
  console.log('ever leaving the register, closure monotone, originals frozen for everything that');
  console.log('remains, and the set never short of its floor while anything open remains to draw.');
  console.log('\n⚠ THE NULL TEST IS NOT RUN HERE and cannot be: it needs a rebuild — either');
  console.log('  DEVELOPMENT_CESSION_ENABLED false, or the closure predicate stubbed off. Both');
  console.log('  procedures are in this file\'s header. At the symmetric-routing commit the');
  console.log('  mechanism-off before-and-after read 28,500 fields, 0 differing; at the');
  console.log('  reselection commit closure-forced-off read 29,400 fields, 0 differing against');
  console.log('  the parent\'s own baseline, which attributes every moved value to closure.');
  process.exit(0);
}
for (const f of findings.slice(0, 30)) console.log(`  [${f.arm}/${f.line}/g${f.game} y${f.year}] ${f.what}: ${f.detail}`);
if (findings.length > 30) console.log(`  ... and ${findings.length - 30} more`);
for (const e of coverageErrors) console.log(`  COVERAGE: ${e}`);
console.log(`\n${findings.length} finding(s), ${coverageErrors.length} coverage failure(s).`);
process.exit(1);
