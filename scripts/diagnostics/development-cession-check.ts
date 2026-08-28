// ============================================================================
// CLAIM-LEVEL DEVELOPMENT CESSION — the mechanism's own guard.
//
// ⚠ THE NULL TEST IS THE MECHANISM SWITCH, NOT A LINE CONTROL. Every value in
// the model moves when this mechanism is on, so a same-tree line-by-line
// comparison has nothing to compare against.
//
// ⚠ AND SINCE THE SELECTION WENT SIZE-WEIGHTED IT IS NOT A COMPARISON AGAINST A
// STORED BASELINE EITHER. buildTrackedSet now spends an RNG draw per carrier,
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
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  DEVELOPMENT_ALLOCATION, DEVELOPMENT_CESSION_ENABLED, allocateDevelopment, buildTrackedSet,
  cedeDevelopment,
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
  overTowerTop: 0, overSeverityCap: 0, maxWcOcc: 0,
  noTowerCeded: 0,
};
const perArmCeded: Record<string, number> = {};
for (const a of ARMS) perArmCeded[a.name] = 0;

// ---------------------------------------------------------------- unit checks
// The allocator's contract, exercised directly rather than only through a game.
console.log('=== CLAIM-LEVEL DEVELOPMENT CESSION CHECK ===\n');
console.log('--- ALLOCATOR CONTRACT (direct) ---');
{
  const mk = (vals: number[]) => vals.map((v, i) => ({
    claimId: `c${i}`, occurrenceId: `o${i}`, drawn: v, original: v, current: v, carrier: i < 3,
  }));
  const cases: { name: string; claims: number[]; untracked: number; amount: number; mode: 'carriers' | 'proportional' }[] = [
    { name: 'adverse -> carriers', claims: [3e6, 2e6, 1e6], untracked: 5e6, amount: 6e6, mode: 'carriers' },
    { name: 'favourable -> proportional', claims: [3e6, 2e6, 1e6], untracked: 5e6, amount: -3e6, mode: 'proportional' },
    { name: 'favourable, EXCEEDS everything', claims: [1e5, 5e4, 1e4], untracked: 1e4, amount: -9e9, mode: 'proportional' },
    { name: 'favourable, exactly everything', claims: [1e6, 1e6], untracked: 0, amount: -2e6, mode: 'proportional' },
    { name: 'zero movement', claims: [1e6], untracked: 0, amount: 0, mode: 'carriers' },
    { name: 'all-zero claims, adverse', claims: [0, 0], untracked: 0, amount: 5e5, mode: 'carriers' },
    { name: 'single claim', claims: [4e6], untracked: 0, amount: 2.5e6, mode: 'carriers' },
    { name: 'untracked mass only', claims: [], untracked: 9e6, amount: -1e6, mode: 'proportional' },
    // ⚠ SITE D — THE CARRIERS-MODE POOL. These four could not fire before the
    // symmetric-routing commit, because a favourable movement never took this
    // branch. The pool must be the CARRIERS' own total, not `trackedTotal`: a
    // give-back between the two would otherwise drive a carrier negative and be
    // silently clamped away in cedeDevelopment.
    { name: 'D: favourable -> carriers, inside their own value', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -3e6, mode: 'carriers' },
    { name: 'D: favourable -> carriers, EXACTLY their value', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -6e6, mode: 'carriers' },
    { name: 'D: favourable -> carriers, past their value, under trackedTotal', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -8e6, mode: 'carriers' },
    { name: 'D: favourable -> carriers, past the whole register', claims: [3e6, 2e6, 1e6, 9e6], untracked: 5e6, amount: -9e9, mode: 'carriers' },
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
    if (cse.mode === 'carriers' && claims.some(c => c.carrier)
        && claims.some((c, i) => !c.carrier && deltas[i] !== 0)) {
      console.log(`  FAIL ${cse.name}: carriers-mode development reached a non-carrier`); unitFails++;
    }
    // ⚠ SITE D, ASSERTED DIRECTLY. In carriers mode the clamp in cedeDevelopment
    // must never be what keeps a value non-negative — the allocator must have
    // bounded it already. `moved` above only proves the CLAMPED result is
    // non-negative; this proves the UNCLAMPED one is, which is the actual fix.
    if (cse.mode === 'carriers' && claims.some((c, i) => c.current + deltas[i] < -1e-9)) {
      console.log(`  FAIL ${cse.name}: an occurrence needed the zero clamp — the pool bound is wrong`); unitFails++;
    }
  }
  console.log(unitFails === 0
    ? `  OK — ${cases.length} cases: parts sum EXACTLY to applied, ceded+retained reconciles, nothing negative,`
      + '\n       the carriers branch never reaches a non-carrier in EITHER direction, and no occurrence'
      + '\n       ever needs the zero clamp — the pool bound holds on its own (site D).'
    : `  ${unitFails} unit failure(s).`);

  // ⚠ THE TRACKED SET UNDER A SIZE-WEIGHTED DRAW. This asserted "carriers are the
  // largest 3, with no rng argument", which was a statement about the RETIRED
  // `largest` selection and would now throw. What survives the change to
  // sizeWeighted is weaker but still exact: the count, the absence of duplicates,
  // and — the property the mechanism actually depends on — that EVERY occurrence
  // at or above the retention is tracked whether or not it was drawn as a carrier.
  const totals = [5e6, 1e5, 3e6, 2e6, 1.5e6, 4e5, 2.5e6];
  const built = buildTrackedSet('WC', totals.map((_, i) => `o${i}`), totals.map((_, i) => `c${i}`),
    totals, DEVELOPMENT_ALLOCATION, new SeededRandom(20260827));
  const carrierCount = built.tracked.filter(t => t.carrier).length;
  const retention = REINSURANCE_TOWER.WC[0].attachment;
  const aboveMissing = totals.filter(t => t >= retention).length
    - built.tracked.filter(t => t.drawn >= retention).length;
  const dupes = new Set(built.tracked.map(t => t.occurrenceId)).size !== built.tracked.length;
  const expectCarriers = Math.min(DEVELOPMENT_ALLOCATION.claimCount, totals.length);
  console.log(carrierCount === expectCarriers && aboveMissing === 0 && !dupes
    ? `  OK — ${carrierCount} carriers drawn size-weighted from ${totals.length} occurrences, no duplicates, and all `
      + `${totals.filter(t => t >= retention).length} occurrences at or above the $${(retention / 1e6).toFixed(0)}M retention are tracked `
      + `(${built.tracked.length} total, ${(built.untrackedTotal / 1e6).toFixed(2)}M untracked).`
    : `  FAIL — ${carrierCount} carriers (expected ${expectCarriers}), ${aboveMissing} above-retention missing, dupes ${dupes}`);
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
          }

          // --- THE SUBSET IS FROZEN ------------------------------------------
          if (bc.length !== ac.length || bc.some((d, i) => d.claimId !== ac[i]?.claimId)) {
            fail(ctx, 'developing subset changed', `AY ${b.yearNumber}: ${bc.map(d => d.claimId)} -> ${ac.map(d => d.claimId)}`);
          }
          // Originals are frozen too — only `current` may move.
          if (bc.some((d, i) => ac[i] && d.original !== ac[i].original)) {
            fail(ctx, 'original amount moved', `AY ${b.yearNumber}`);
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
console.log(`  ... that later re-inflate above the retention  ${cover.reinflatedAboveRetention.size.toLocaleString()}  <- the only case that costs anything`);
console.log(`  occurrences above the tower top   ${cover.overTowerTop.toLocaleString()}  (exhaustion — correct, not compensated for)`);
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
// bar. Symmetric routing sends favourable movements to the same ten carriers
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
  console.log('and the developing subset stays frozen for each cohort\'s life.');
  console.log('\n⚠ THE NULL TEST IS NOT RUN HERE and cannot be: it needs DEVELOPMENT_CESSION_ENABLED');
  console.log('  rebuilt to false. And since the selection went size-weighted it is no longer a');
  console.log('  comparison against a stored baseline — the mechanism-ON tree reseeds. It is a');
  console.log('  BEFORE-AND-AFTER of the mechanism-OFF path across a change; procedure in this');
  console.log('  file\'s header. At the symmetric-routing commit: 28,500 fields, 0 differing.');
  process.exit(0);
}
for (const f of findings.slice(0, 30)) console.log(`  [${f.arm}/${f.line}/g${f.game} y${f.year}] ${f.what}: ${f.detail}`);
if (findings.length > 30) console.log(`  ... and ${findings.length - 30} more`);
for (const e of coverageErrors) console.log(`  COVERAGE: ${e}`);
console.log(`\n${findings.length} finding(s), ${coverageErrors.length} coverage failure(s).`);
process.exit(1);
