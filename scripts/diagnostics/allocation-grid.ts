// ============================================================================
// THE ALLOCATION GRID, MEASURED AGAINST THE FREE-RECOVERY DEFECT.
//
// READ-ONLY. Nothing here changes the engine; every rule is applied to a
// RECONSTRUCTED register outside it.
//
// development-sign-symmetry established that cession is sign-blind once the
// allocation mode is held constant (1.02x) and that the whole asymmetry is the
// ROUTING: adverse to the largest 3 at 83.8% marginal on WC, favourable
// proportional at 36.7%. This measures the grid of routings rather than one
// candidate.
//
//   ADVERSE      largest-1, largest-3 (current), sizeWeighted-3,
//                sizeWeighted-10, proportional
//   FAVOURABLE   proportional (current), same-as-adverse,
//                reverse-through-carriers
//
// ============================================================================
// HOW THE COUNTERFACTUAL IS BUILT, AND WHAT IT CANNOT SEE.
//
// A different adverse rule chooses a different TRACKED SET, so the persisted
// cohort state is not enough — sizeWeighted-10 may track occurrences the current
// rule threw into `untrackedTotal` as a lump. So this script rebuilds the FULL
// occurrence register for every accident year from the locked results
// (occurrenceTotals over that year's claims and occurrences), then replays each
// cohort's actual movement sequence through each grid cell, evolving that
// cell's own register.
//
// ⚠ THE GROSS WALK IS HELD FIXED ACROSS CELLS, and that is both the point and
// the limitation. Each cohort-year's movement is the one the engine actually
// produced, so cumulative gross is IDENTICAL in every cell and only the cession
// moves — which is exactly the comparison being asked for. What it does not
// capture is compounding: a rule that cedes less leaves a larger net reserve,
// and next year's step is a fraction of that reserve, so the true dollars under
// a different rule would be scaled up. That scaling hits gross and recovery
// TOGETHER, so the RATIO — the headline — is first-order robust to it, while the
// absolute dollars are indicative rather than predictive.
//
// ⚠ GAME-BORN ACCIDENT YEARS ONLY. A pre-game or seeded cohort's full register
// is not in lockedResults, so it cannot be rebuilt. The coverage is reported
// rather than assumed.
//
// VALIDATION: the cell (largest-3, proportional) IS the live rule, so its
// replayed cession must reproduce the engine's own. That check runs first and
// everything else is worthless if it fails.
// ============================================================================

import {
  allocateDevelopment, buildTrackedSet, cedeDevelopment, markDownForBooking,
  type AllocationMode, type DevelopmentAllocationRule,
} from '../../src/utils/developmentAllocation';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear, ibnerUnwindWeight } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SeededRandom } from '../../src/utils/random';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, DevelopingClaim, GameState, ReserveCohort } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 15);
const YEARS = Number(process.env.YEARS ?? 10);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const PROBE = 500_000;

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
interface Arm { name: string; decisions: (d: DecisionSet) => DecisionSet }
const ARMS: Arm[] = [
  { name: 'def', decisions: d => d },
  {
    name: 'sqz',
    decisions: d => ({
      ...d,
      byLine: Object.fromEntries(LINES.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
    }),
  },
];

// ============================================================================
// THE RULES
// ============================================================================
interface AdverseRule {
  name: string;
  /** undefined = route adverse proportionally across the whole register. */
  rule?: DevelopmentAllocationRule;
}
const ADVERSE: AdverseRule[] = [
  { name: 'largest-1', rule: { claimCount: 1, weighting: 'sized', selection: 'largest' } },
  { name: 'largest-3', rule: { claimCount: 3, weighting: 'sized', selection: 'largest' } },   // CURRENT
  { name: 'sizeWtd-3', rule: { claimCount: 3, weighting: 'sized', selection: 'sizeWeighted' } },
  { name: 'sizeWtd-10', rule: { claimCount: 10, weighting: 'sized', selection: 'sizeWeighted' } },
  { name: 'proportional', rule: undefined },
];

// ⚠ REVERSE-THROUGH-CARRIERS, DEFINED BEFORE IT IS MEASURED.
//
// Every tracked occurrence carries an ADVERSE STOCK: the cumulative adverse
// dollars allocated to it, less whatever has since been reversed off it. A
// favourable movement is allocated in proportion to that stock, so a claim that
// deteriorated and then settles cheap gives back on ITSELF. Symmetric by
// construction while stock lasts.
//
// ⚠ THE UNWIND IS NOT ADVERSE STOCK. The deterministic unwind of the optimistic
// booking is a booking correction, not deterioration, so it does not build stock
// a later favourable movement can reverse. Including it would let noise unwind
// the unwind and the claims would not return to their drawn values.
//
// ⚠ THE FALLBACK IS WHERE THE ASYMMETRY COMES BACK. A cohort with no stock — its
// first movement is favourable, or it has already given back everything it took
// — has nothing to reverse, and the movement falls through to proportional
// across the whole register, which is the current favourable rule and the
// current asymmetry. How often that happens, and what share of favourable
// dollars it carries, is measured below rather than assumed small.
type FavourableRule = 'proportional' | 'same-as-adverse' | 'reverse';
const FAVOURABLE: FavourableRule[] = ['proportional', 'same-as-adverse', 'reverse'];

// ============================================================================
// PHASE 1 — CAPTURE
// ============================================================================
interface Register { occIds: string[]; claimIds: string[]; totals: number[] }
interface Step { ay: number; gross: number; unwind: number; engineCeded: number }
interface CohortSpec {
  ay: number; registerSum: number; bookingBias: number; horizon: number; placed: boolean[];
  register: Register;
}
interface LineRun {
  arm: string; game: number; line: TowerLine;
  cohorts: Map<number, CohortSpec>;
  stepsByYear: Step[][];             // index = game year - 1
  inceptionCeded: number;            // occurrence cession recognised at inception
  towerPremium: number;
  engineDevCeded: number;            // what the engine actually ceded on development
  engineGross: number;               // adverse-positive
}

const runs: LineRun[] = [];

for (const arm of ARMS) {
  for (let g = 0; g < GAMES; g++) {
    const id = `AGR${arm.name}${g}`;
    const inst = generateGameInstance(id, 3_300_000 + g * 8221);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    const perLine = new Map<string, LineRun>();
    for (const l of LINES) {
      perLine.set(l, {
        arm: arm.name, game: g, line: l as TowerLine, cohorts: new Map(),
        stepsByYear: Array.from({ length: YEARS }, () => []),
        inceptionCeded: 0, towerPremium: 0, engineDevCeded: 0, engineGross: 0,
      });
    }

    for (let y = 1; y <= YEARS; y++) {
      const before: Record<string, ReserveCohort[]> = {};
      for (const l of LINES) {
        before[l] = gs.poolState.lines[l].reserveCohorts.map(c => ({ ...c }));
      }
      const p = processYear(gs, arm.decisions(defaultDecisionSet(y)));

      for (const line of LINES) {
        const lr = p.result.byLine[line];
        const run = perLine.get(line)!;
        const afterBy = new Map(p.updatedPoolState.lines[line].reserveCohorts.map(c => [c.yearNumber, c]));

        // The accident year written THIS year, with its full register.
        const born = afterBy.get(y);
        if (born) {
          run.cohorts.set(y, {
            ay: y, registerSum: born.registerSum, bookingBias: born.bookingBias, horizon: born.horizon,
            placed: born.placedAtInception ?? REINSURANCE_TOWER[line as TowerLine].map(() => false),
            register: {
              occIds: (lr.occurrences ?? []).map(o => o.id),
              claimIds: (lr.occurrences ?? []).map(o => o.claimIds[0] ?? o.id),
              totals: occurrenceTotals(lr.claims ?? [], lr.occurrences ?? []),
            },
          });
        }
        run.inceptionCeded += (lr.cededByLayer ?? []).reduce((s, v) => s + v, 0);
        run.towerPremium += lr.reinsuranceCost;
        run.engineDevCeded += lr.priorYearDevelopmentCeded;

        // Each open cohort's movement this year, and the deterministic part of it.
        for (const b of before[line]) {
          if (b.closed || b.age >= b.horizon) continue;
          const a = afterBy.get(b.yearNumber);
          if (!a) continue;
          const gross = (a.netUltimate - b.netUltimate)
            + ((a.cededDevelopmentToDate ?? 0) - (b.cededDevelopmentToDate ?? 0));
          const unwind = b.registerSum * b.bookingBias * ibnerUnwindWeight(b.horizon, b.age + 1);
          run.stepsByYear[y - 1].push({
            ay: b.yearNumber, gross, unwind,
            engineCeded: (a.cededDevelopmentToDate ?? 0) - (b.cededDevelopmentToDate ?? 0),
          });
          run.engineGross += gross;
        }
      }

      gs = {
        ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
      };
    }
    for (const r of perLine.values()) runs.push(r);
  }
}

// ============================================================================
// PHASE 2 — REPLAY ONE GRID CELL
// ============================================================================
interface CellResult {
  gross: number; ceded: number;               // adverse-positive, game-born cohorts only
  probeAdv: number; probeFav: number; probeN: number;
  byLine: Record<string, { adv: number; fav: number; n: number }>;
  reverseFellBack: number; reverseFallbackDollars: number; reverseDollars: number;
  favCarrierTruncated: number;
}

// A live register under replay: the tracked occurrences plus the untracked mass,
// with the adverse stock reverse-through-carriers reads.
interface Live { tracked: DevelopingClaim[]; untracked: number; stock: number[] }

function route(
  live: Live, line: TowerLine, amount: number, adverse: AdverseRule, fav: FavourableRule, placed: boolean[],
  tally?: CellResult,
): { ceded: number } {
  if (amount === 0) return { ceded: 0 };
  let ceded = 0;

  const apply = (amt: number, mode: AllocationMode, weights?: number[]) => {
    let deltas: number[];
    let untrackedDelta: number;
    if (weights) {
      // Reverse mode: proportional to the supplied weights, tracked only.
      const sw = weights.reduce((s, w) => s + w, 0);
      deltas = new Array<number>(live.tracked.length).fill(0);
      let acc = 0;
      for (let i = 0; i < weights.length - 1; i++) { deltas[i] = (amt * weights[i]) / sw; acc += deltas[i]; }
      deltas[weights.length - 1] = amt - acc;
      untrackedDelta = 0;
    } else {
      const a = allocateDevelopment(live.tracked, live.untracked, amt, mode, adverse.rule?.weighting ?? 'sized');
      deltas = a.deltas;
      untrackedDelta = a.untrackedDelta;
      if (tally && mode === 'carriers' && amt < 0 && Math.abs(a.unallocated) > 0.01) tally.favCarrierTruncated++;
    }
    const res = cedeDevelopment(line, live.tracked, deltas, untrackedDelta, placed);
    live.tracked = res.moved;
    live.untracked = Math.max(0, live.untracked + untrackedDelta);
    for (let i = 0; i < deltas.length; i++) {
      live.stock[i] = Math.max(0, live.stock[i] + (amt > 0 ? deltas[i] : Math.max(-live.stock[i], deltas[i])));
    }
    ceded += res.ceded;
  };

  if (amount > 0) {
    apply(amount, adverse.rule ? 'carriers' : 'proportional');
    return { ceded };
  }

  // FAVOURABLE
  if (fav === 'proportional' || !adverse.rule) {
    apply(amount, 'proportional');
  } else if (fav === 'same-as-adverse') {
    apply(amount, 'carriers');
  } else {
    const stockTotal = live.stock.reduce((s, v) => s + v, 0);
    const want = -amount;
    const viaStock = Math.min(want, stockTotal);
    if (viaStock > 0) {
      apply(-viaStock, 'proportional', [...live.stock]);
      if (tally) tally.reverseDollars += viaStock;
    }
    const rest = want - viaStock;
    if (rest > 0.01) {
      apply(-rest, 'proportional');
      if (tally) { tally.reverseFellBack++; tally.reverseFallbackDollars += rest; }
    }
  }
  return { ceded };
}

function runCell(adverse: AdverseRule, fav: FavourableRule, armFilter?: string): CellResult {
  const out: CellResult = {
    gross: 0, ceded: 0, probeAdv: 0, probeFav: 0, probeN: 0,
    byLine: Object.fromEntries(LINES.map(l => [l, { adv: 0, fav: 0, n: 0 }])),
    reverseFellBack: 0, reverseFallbackDollars: 0, reverseDollars: 0, favCarrierTruncated: 0,
  };

  for (const run of runs) {
    if (armFilter && run.arm !== armFilter) continue;
    const live = new Map<number, Live>();

    for (let y = 1; y <= YEARS; y++) {
      // Incept the accident year written this year, under THIS cell's rule.
      const spec = run.cohorts.get(y);
      if (spec) {
        const rng = new SeededRandom(1_000_003 + y * 7919 + run.game * 104_729
          + run.line.length * 31 + (run.arm === 'def' ? 0 : 1));
        const set = adverse.rule
          ? buildTrackedSet(run.line, spec.register.occIds, spec.register.claimIds, spec.register.totals, adverse.rule, rng)
          // Proportional adverse needs no carriers, but the tracked set still has
          // to hold everything at or above the retention or the cession is wrong.
          : buildTrackedSet(run.line, spec.register.occIds, spec.register.claimIds, spec.register.totals,
              { claimCount: 0, weighting: 'sized', selection: 'largest' }, rng);
        const md = markDownForBooking(run.line, set, spec.registerSum * spec.bookingBias, spec.placed);
        live.set(y, { tracked: md.tracked, untracked: md.untrackedTotal, stock: md.tracked.map(() => 0) });
      }

      for (const step of run.stepsByYear[y - 1]) {
        const l = live.get(step.ay);
        const spec2 = run.cohorts.get(step.ay);
        if (!l || !spec2) continue;               // pre-game / seeded: not reconstructible
        out.gross += step.gross;

        // THE PROBE, taken on the state as it stands BEFORE this year's movement:
        // +X and -X through this cell's own routing, on identical state.
        const snap = (): Live => ({ tracked: l.tracked.map(t => ({ ...t })), untracked: l.untracked, stock: [...l.stock] });
        const pa = route(snap(), run.line, +PROBE, adverse, fav, spec2.placed).ceded;
        const pf = -route(snap(), run.line, -PROBE, adverse, fav, spec2.placed).ceded;
        out.probeAdv += pa; out.probeFav += pf; out.probeN++;
        const bl = out.byLine[run.line];
        bl.adv += pa; bl.fav += pf; bl.n++;

        // ⚠ TWO MOVEMENTS, TWO MODES, exactly as processIbner applies them: the
        // stochastic part routes by sign under this cell's rules, the unwind is
        // always proportional because it reverses a proportional markdown.
        const stochastic = step.gross - step.unwind;
        out.ceded += route(l, run.line, stochastic, adverse, fav, spec2.placed, out).ceded;
        if (step.unwind !== 0) out.ceded += route(l, run.line, step.unwind, { name: 'p' }, 'proportional', spec2.placed).ceded;
      }
    }
  }
  return out;
}

// ============================================================================
// REPORT
// ============================================================================
const m = (v: number) => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}M`;
console.log('=== ALLOCATION GRID vs THE FREE-RECOVERY DEFECT ===');
console.log(`${GAMES} games x ${YEARS} years x 3 lines x 2 arms. Probe +/-$${(PROBE / 1e3).toFixed(0)}k. `
  + 'ADVERSE-POSITIVE throughout.\n');

// --- VALIDATION -------------------------------------------------------------
{
  const live = runCell(ADVERSE[1], 'proportional');
  const engineCeded = runs.reduce((s2, r) => s2 + r.engineDevCeded, 0);
  const engineGross = runs.reduce((s2, r) => s2 + r.engineGross, 0);
  // ⚠ LIKE FOR LIKE. The replay covers game-born accident years only, so it is
  // compared against the ENGINE'S OWN cession on exactly those cohorts, read off
  // cededDevelopmentToDate per cohort — not against the all-cohort total, which
  // would fold in pre-game years the replay never touched.
  const spec = (r: LineRun) => r.stepsByYear.flat().filter(st => r.cohorts.has(st.ay));
  const engGrossGB = runs.reduce((s2, r) => s2 + spec(r).reduce((t, st) => t + st.gross, 0), 0);
  const engCededGB = runs.reduce((s2, r) => s2 + spec(r).reduce((t, st) => t + st.engineCeded, 0), 0);
  const absAll = runs.reduce((s2, r) => s2 + r.stepsByYear.flat().reduce((t, st) => t + Math.abs(st.gross), 0), 0);
  const absGB = runs.reduce((s2, r) => s2 + spec(r).reduce((t, st) => t + Math.abs(st.gross), 0), 0);
  console.log('--- VALIDATION: THE REPLAY OF THE LIVE RULE AGAINST THE ENGINE ---');
  console.log(`  engine, ALL cohorts               gross ${m(engineGross).padStart(10)}  ceded ${m(engineCeded).padStart(10)}`);
  console.log(`  engine, GAME-BORN cohorts only    gross ${m(engGrossGB).padStart(10)}  ceded ${m(engCededGB).padStart(10)}`);
  console.log(`  REPLAY, game-born cohorts only    gross ${m(live.gross).padStart(10)}  ceded ${m(live.ceded).padStart(10)}`);
  console.log(`  replay vs engine on the same cohorts: gross ${(((live.gross - engGrossGB) / engGrossGB) * 100).toFixed(3)}%, `
    + `ceded ${(((live.ceded - engCededGB) / engCededGB) * 100).toFixed(3)}%`);
  console.log(`  coverage, on ABSOLUTE movement (signed sums cancel and mislead): `
    + `${((absGB / absAll) * 100).toFixed(1)}% of gross dollars moved\n`);
}

// --- THE GRID ---------------------------------------------------------------
interface Row { adv: string; fav: string; aRate: number; fRate: number; ratio: number; gross: number; ceded: number;
  perLine: Record<string, number> }
const rows: Row[] = [];
for (const a of ADVERSE) {
  for (const f of FAVOURABLE) {
    // (proportional, same-as-adverse) and (proportional, reverse) both collapse
    // onto (proportional, proportional): with no carriers there is nothing to
    // route differently. Reported once.
    if (!a.rule && f !== 'proportional') continue;
    const all = runCell(a, f);
    const def = runCell(a, f, 'def');
    rows.push({
      adv: a.name, fav: f,
      aRate: all.probeAdv / (all.probeN * PROBE),
      fRate: all.probeFav / (all.probeN * PROBE),
      ratio: all.probeAdv / all.probeFav,
      gross: def.gross, ceded: def.ceded,
      perLine: Object.fromEntries(LINES.map(l => [l, all.byLine[l].adv / all.byLine[l].fav])),
    });
  }
}

console.log('--- THE GRID ---');
console.log('  MARGINAL RATE is the +/-$500k probe on identical state, all arms.');
console.log('  DEFAULTS DOLLARS replay the same fixed gross walk; only the routing changes.\n');
console.log('  adverse       favourable        adv rate  fav rate   RATIO |   def gross   def recovery   rec/|gross| |   WC     GL   Prop');
console.log('  ' + '-'.repeat(126));
for (const r of rows) {
  const flag = r.adv === 'largest-3' && r.fav === 'proportional' ? '  <- CURRENT' : '';
  console.log(`  ${r.adv.padEnd(13)} ${r.fav.padEnd(17)} ${(r.aRate * 100).toFixed(1).padStart(7)}% `
    + `${(r.fRate * 100).toFixed(1).padStart(8)}% ${r.ratio.toFixed(2).padStart(7)}x | `
    + `${m(r.gross).padStart(11)} ${m(r.ceded).padStart(13)} ${(r.ceded / Math.abs(r.gross)).toFixed(2).padStart(11)}x | `
    + LINES.map(l => `${r.perLine[l].toFixed(2)}x`).join(' ') + flag);
}

// --- REVERSE'S FALLBACK -----------------------------------------------------
console.log('\n--- THE REVERSE RULE\'S FALLBACK, WHICH IS WHERE ITS RESIDUAL LIVES ---');
for (const a of ADVERSE) {
  if (!a.rule) continue;
  const c = runCell(a, 'reverse');
  const total = c.reverseDollars + c.reverseFallbackDollars;
  console.log(`  ${a.name.padEnd(13)} favourable dollars reversed onto stock ${m(c.reverseDollars).padStart(10)} `
    + `(${((c.reverseDollars / total) * 100).toFixed(1)}%), fell back to proportional `
    + `${m(c.reverseFallbackDollars).padStart(10)} (${((c.reverseFallbackDollars / total) * 100).toFixed(1)}%) `
    + `over ${c.reverseFellBack} movements`);
}

// --- SAME-AS-ADVERSE'S OWN FAILURE MODE -------------------------------------
console.log('\n--- SAME-AS-ADVERSE: HOW OFTEN THE CARRIERS-MODE POOL TRUNCATES A GIVE-BACK ---');
for (const a of ADVERSE) {
  if (!a.rule) continue;
  const c = runCell(a, 'same-as-adverse');
  console.log(`  ${a.name.padEnd(13)} ${c.favCarrierTruncated} favourable movements exceeded the carriers' own value`);
}

// --- OPTION 3: PRICING ON THE DEVELOPED REGISTER ----------------------------
console.log('\n--- OPTION 3: WHAT E[CEDED] BECOMES IF THE TREATY IS PRICED ON THE DEVELOPED REGISTER ---');
for (const armName of ['def', 'sqz']) {
  const s = runs.filter(r => r.arm === armName);
  console.log(`  ${armName}:`);
  for (const line of LINES) {
    const t = s.filter(r => r.line === line);
    const inc = t.reduce((a, r) => a + r.inceptionCeded, 0);
    const dev = t.reduce((a, r) => a + r.engineDevCeded, 0);
    const prem = t.reduce((a, r) => a + r.towerPremium, 0);
    console.log(`    ${line.padEnd(9)} inception ceded ${m(inc).padStart(10)}   development ceded ${m(dev).padStart(9)}   `
      + `uplift to E[ceded] ${((dev / inc) * 100).toFixed(1).padStart(6)}%   tower premium ${m(prem).padStart(9)}`);
  }
  const inc = s.reduce((a, r) => a + r.inceptionCeded, 0);
  const dev = s.reduce((a, r) => a + r.engineDevCeded, 0);
  const prem = s.reduce((a, r) => a + r.towerPremium, 0);
  console.log(`    ${'ALL'.padEnd(9)} inception ceded ${m(inc).padStart(10)}   development ceded ${m(dev).padStart(9)}   `
    + `uplift to E[ceded] ${((dev / inc) * 100).toFixed(1).padStart(6)}%   tower premium ${m(prem).padStart(9)}`);
  console.log(`    -> holding the risk load, the tower premium would rise ${((dev / inc) * 100).toFixed(1)}% `
    + `= ${m(prem * (dev / inc))} over ${YEARS} years, ${m(prem * (dev / inc) / (GAMES * YEARS))} per pool-year.`);
}

// --- AND UNDER EACH ROUTING -------------------------------------------------
console.log('\n--- THE SAME UPLIFT UNDER EACH ROUTING, since the rule chosen sets what has to be priced ---');
{
  const incDef = runs.filter(r => r.arm === 'def').reduce((a, r) => a + r.inceptionCeded, 0);
  for (const r of rows) {
    console.log(`  ${r.adv.padEnd(13)} ${r.fav.padEnd(17)} development ceded ${m(r.ceded).padStart(9)} `
      + `-> E[ceded] uplift ${((r.ceded / incDef) * 100).toFixed(1).padStart(6)}%`);
  }
  console.log('  (game-born cohorts only, so these understate the full-book uplift by the coverage gap above)');
}
