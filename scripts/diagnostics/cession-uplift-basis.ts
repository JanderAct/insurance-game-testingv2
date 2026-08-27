// ============================================================================
// THE DEVELOPMENT-CESSION UPLIFT — A GATE, AND THE SINGLE-ARM ASSERTION.
//
// ⚠ THIS EXITS NON-ZERO. It began as the test of whether the uplift a
// developed-register price would need is decision-dependent (it is not; the
// apparent dependence was the give-back on the wrong side of the decomposition),
// and it now also carries the SINGLE-ARM DOLLAR ASSERTION that development
// cession is not a free lunch.
//
// ⚠ WHY THE ASSERTION IS HERE AND NOT IN development-sign-symmetry. That script
// measures recovery per dollar of movement over a fixed WINDOW, and a window is
// the wrong unit: it counts a cohort's adverse phase and cuts off its
// settlement, so it reads +6.2% at defaults with a perfectly symmetric
// mechanism. Only a COMPLETE cohort life is a fair statement, and only against
// inception cession is it scale-free. That is what is asserted below.
//
// ⚠ IT IS NOT ASSERTED TO BE ZERO, and it must not be. Cession is a CONVEX
// function of occurrence size, so a driftless walk through it has positive
// expected cession by Jensen — that is the option value of an excess-of-loss
// treaty on a claim that is still moving, and it is real. What the gate forbids
// is the ROUTING asymmetry that manufactured recovery on top of it: WC read
// +9.9% before symmetric routing and +4.1% after, against a limit of 6%.
//
// READ-ONLY on the engine. Nothing here changes it.
//
// allocation-grid measured the uplift a developed-register price would need as
// +3.1% at defaults and +15.4% squeezed, and concluded a single constant cannot
// serve both arms. That conclusion is under test here, because 6c535d1
// established that TOTAL cession is path-independent: the booking bias moves
// cession between inception and development without changing the sum.
//
// ============================================================================
// ⚠ THE GIVE-BACK IS AN INCEPTION-SIDE ITEM AND THE EARLIER FIGURE PUT IT ON THE
// DEVELOPMENT SIDE. That is the whole suspected artefact, and it is a one-field
// mistake.
//
// A cohort's `cededDevelopmentToDate` OPENS at markDownForBooking's give-back —
// negative, the recoverable the pool forfeits by booking its claims low — and
// then accumulates development cession on top. So:
//
//     final cededDevelopmentToDate  =  giveBack  +  lifetime development cession
//
// `priorYearDevelopmentCeded` reports only the INCREMENTS, so summing it over a
// cohort's life gives (final - giveBack): the development cession GROSS of the
// inception-side deferral it is earning back. At defaults the bias is zero, the
// give-back is zero, and the two agree. Under squeeze they cannot.
//
// So the corrected decomposition is simply to use the cohort's FINAL
// cededDevelopmentToDate, which already nets the give-back where it belongs:
//
//     INCEPTION    cede(drawn register)              = sum of cededByLayer that year
//     DEVELOPMENT  giveBack + lifetime increments    = final cededDevelopmentToDate
//     TOTAL        the two added
//
// ============================================================================
// ⚠ AND THE ARMS DO NOT HAVE THE SAME BOOK. Squeezed funding charges less, more
// members enrol, more claims are drawn — so absolute cession differs between the
// arms for a reason that has nothing to do with development. Every headline here
// is therefore a RATIO with the cohort's own inception cession as denominator,
// and the arm comparison is PAIRED on (game, line) with an interval, not two
// totals side by side. The enrolment gap is reported so the confound is visible
// rather than assumed away.
//
// ⚠ AND A COHORT MUST BE ALLOWED TO FINISH. WC's horizon runs to 12 years, so a
// 10-year game truncates most of its development and understates the uplift in
// both arms. This runs 20 years and splits MATURED cohorts (age >= horizon) from
// those the game end cut off.
//
// The aggregate stop-loss is excluded throughout: it attaches to current-year
// retained loss and development never reaches it. This is the occurrence tower's
// price and nothing else.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

// GATE THRESHOLDS, set above the measured value and below the defect.
//   pool-wide, defaults:  0.3% now, 2.8% under the retired asymmetric routing.
//   worst line, defaults: 4.1% (WC) now, 9.9% then. WC is where the tower is
//   most convex, so it carries most of the irreducible option value.
const MAX_POOL_UPLIFT = 0.015;
const MAX_LINE_UPLIFT = 0.06;

const GAMES = Number(process.env.GAMES ?? 30);
const YEARS = Number(process.env.YEARS ?? 20);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
interface Arm { name: string; decisions: (d: DecisionSet) => DecisionSet }
// ⚠ A THIRD ARM AT HALF THE SQUEEZE, because a residual that is REAL must scale
// with the booking bias and a residual that is noise must not. Two arms cannot
// tell those apart; three can.
const half = (l: CoverageLine) => (MIN_STOP[l] + SLIDER_RANGES.fundingConfidenceLevel.max) / 2;
const ARMS: Arm[] = [
  { name: 'def', decisions: d => d },
  {
    name: 'mid',
    decisions: d => ({
      ...d,
      byLine: Object.fromEntries(LINES.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: half(l), fundingAtExpected: false }])) as never,
    }),
  },
  {
    name: 'sqz',
    decisions: d => ({
      ...d,
      byLine: Object.fromEntries(LINES.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
    }),
  },
];

// ONE ACCIDENT YEAR, FOLLOWED FROM INCEPTION TO WHEREVER IT GETS TO.
interface Cohort {
  arm: string; game: number; line: CoverageLine; ay: number;
  inceptionCeded: number;      // cede(drawn register), the price basis today
  giveBack: number;            // negative; opening cededDevelopmentToDate
  finalCededDev: number;       // giveBack + lifetime development increments
  registerSum: number;
  horizon: number; lastAge: number; matured: boolean;
}
const cohorts: Cohort[] = [];

// Book size, so the enrolment confound is visible.
const book: Record<string, { members: number; gross: number; n: number }> = {};

for (const arm of ARMS) {
  for (let g = 0; g < GAMES; g++) {
    const id = `CUB${g}`;   // SAME instance id in both arms: same seeds, same roster.
    const inst = generateGameInstance(id, 5_900_000 + g * 9769);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    // ay -> the record being accumulated, per line.
    const open = new Map<string, Cohort>();

    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, arm.decisions(defaultDecisionSet(y)));

      for (const line of LINES) {
        const lr = p.result.byLine[line];
        const after = p.updatedPoolState.lines[line].reserveCohorts;
        const born = after.find(c => c.yearNumber === y);
        const key = `${line}|${y}`;

        if (born) {
          open.set(key, {
            arm: arm.name, game: g, line, ay: y,
            inceptionCeded: (lr.cededByLayer ?? []).reduce((s, v) => s + v, 0),
            // ⚠ THE OPENING BALANCE IS THE GIVE-BACK, read the year the cohort is
            // written and before any development increment can have touched it.
            giveBack: born.cededDevelopmentToDate ?? 0,
            finalCededDev: born.cededDevelopmentToDate ?? 0,
            registerSum: born.registerSum,
            horizon: born.horizon, lastAge: born.age, matured: false,
          });
        }

        const bk = book[`${arm.name}|${line}`] ?? { members: 0, gross: 0, n: 0 };
        bk.members += lr.memberLossResults?.length ?? 0;
        bk.gross += lr.grossUltimateLoss;
        bk.n++;
        book[`${arm.name}|${line}`] = bk;

        // Refresh every cohort still visible. A cohort is dropped from the array
        // the year after it closes, so the last value seen is its final one.
        for (const c of after) {
          const rec = open.get(`${line}|${c.yearNumber}`);
          if (!rec) continue;
          rec.finalCededDev = c.cededDevelopmentToDate ?? 0;
          rec.lastAge = c.age;
          rec.matured = c.age >= c.horizon;
        }
      }

      gs = {
        ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
      };
    }
    for (const c of open.values()) cohorts.push(c);
  }
}

// ---------------------------------------------------------------- helpers
const m = (v: number) => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}M`;
const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;

function sum<T>(xs: T[], f: (x: T) => number): number { return xs.reduce((s, x) => s + f(x), 0); }

// Paired 95% interval on a per-(game,line) difference.
function pairedCI(diffs: number[]): { mean: number; lo: number; hi: number } {
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const varc = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(varc / n);
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}

console.log('=== CESSION UPLIFT: WHICH SIDE DOES THE GIVE-BACK BELONG ON? ===');
console.log(`${GAMES} games x ${YEARS} years x 3 lines x 2 arms, SAME instance ids in both arms.`);
console.log(`${cohorts.length} accident-year cohorts followed from inception.\n`);

// --- 0. THE CONFOUND, STATED ------------------------------------------------
console.log('--- 0. THE ARMS DO NOT HAVE THE SAME BOOK ---');
for (const line of LINES) {
  const d = book[`def|${line}`];
  const s = book[`sqz|${line}`];
  console.log(`  ${line.padEnd(9)} mean enrolled  def ${(d.members / d.n).toFixed(1).padStart(6)}  `
    + `sqz ${(s.members / s.n).toFixed(1).padStart(6)}  (${((s.members / d.members - 1) * 100).toFixed(1)}%)   `
    + `gross loss  def ${m(d.gross).padStart(10)}  sqz ${m(s.gross).padStart(10)}  `
    + `(${((s.gross / d.gross - 1) * 100).toFixed(1)}%)`);
}
console.log('  -> every figure below is a RATIO with the cohort\'s own inception cession as denominator.\n');

// --- 1. MATURITY ------------------------------------------------------------
{
  const mat = cohorts.filter(c => c.matured);
  console.log('--- 1. HOW MANY COHORTS ACTUALLY FINISHED ---');
  for (const line of LINES) {
    const all = cohorts.filter(c => c.line === line);
    const mm = all.filter(c => c.matured);
    console.log(`  ${line.padEnd(9)} ${mm.length} of ${all.length} matured (horizon ${Math.min(...all.map(c => c.horizon))}-${Math.max(...all.map(c => c.horizon))})`);
  }
  console.log(`  ${mat.length} of ${cohorts.length} overall. Everything below is MATURED COHORTS ONLY `
    + 'unless it says otherwise — a truncated cohort understates its own uplift.\n');
}

// --- 2. THE DECOMPOSITION, THE OLD WAY AND THE CORRECTED WAY ----------------
console.log('--- 2. THE DECOMPOSITION, BOTH WAYS ---');
console.log('  OLD  = lifetime development increments only  (= final cededDevToDate - giveBack),');
console.log('         which is what summing priorYearDevelopmentCeded gives and what allocation-grid used.');
console.log('  NEW  = final cededDevToDate, so the give-back nets against the development it is earning back.\n');
console.log('  arm  line       inception ceded     give-back   dev increments |  OLD uplift   NEW uplift');
console.log('  ' + '-'.repeat(98));
const upliftRows: Record<string, { old: number; nw: number }> = {};
for (const arm of ARMS) {
  for (const line of LINES) {
    const cs = cohorts.filter(c => c.matured && c.arm === arm.name && c.line === line);
    if (cs.length === 0) continue;
    const inc = sum(cs, c => c.inceptionCeded);
    const gb = sum(cs, c => c.giveBack);
    const dev = sum(cs, c => c.finalCededDev - c.giveBack);
    const oldU = dev / inc;
    const newU = (gb + dev) / inc;
    upliftRows[`${arm.name}|${line}`] = { old: oldU, nw: newU };
    console.log(`  ${arm.name}  ${line.padEnd(9)} ${m(inc).padStart(14)} ${m(gb).padStart(13)} ${m(dev).padStart(16)} | `
      + `${p1(oldU).padStart(10)}   ${p1(newU).padStart(10)}`);
  }
}
{
  for (const arm of ARMS) {
    const cs = cohorts.filter(c => c.matured && c.arm === arm.name);
    const inc = sum(cs, c => c.inceptionCeded);
    const gb = sum(cs, c => c.giveBack);
    const dev = sum(cs, c => c.finalCededDev - c.giveBack);
    console.log(`  ${arm.name}  ${'ALL'.padEnd(9)} ${m(inc).padStart(14)} ${m(gb).padStart(13)} ${m(dev).padStart(16)} | `
      + `${p1(dev / inc).padStart(10)}   ${p1((gb + dev) / inc).padStart(10)}`);
  }
}

// --- 3. THE TEST: IS THE UPLIFT THE SAME IN BOTH ARMS? ----------------------
console.log('\n--- 3. PAIRED ON (game, line): DOES THE UPLIFT DIFFER BY ARM? ---');
console.log('  A CI containing zero says the uplift is a per-line CONSTANT and the arm split was the');
console.log('  artefact. A CI excluding zero says Option 3 is a genuine coupling to the funding decision.\n');
for (const which of ['OLD (development increments only)', 'NEW (give-back on the inception side)'] as const) {
  const useNew = which.startsWith('NEW');
  console.log(`  ${which}`);
  for (const line of LINES) {
   for (const other of ['mid', 'sqz']) {
    const diffs: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const pick = (arm: string) => cohorts.filter(c => c.matured && c.arm === arm && c.line === line && c.game === g);
      const D = pick('def');
      const S = pick(other);
      if (D.length === 0 || S.length === 0) continue;
      const u = (cs: Cohort[]) => {
        const inc = sum(cs, c => c.inceptionCeded);
        return inc === 0 ? NaN : (useNew ? sum(cs, c => c.finalCededDev) : sum(cs, c => c.finalCededDev - c.giveBack)) / inc;
      };
      const d = u(S) - u(D);
      if (Number.isFinite(d)) diffs.push(d);
    }
    const ci = pairedCI(diffs);
    const verdict = ci.lo <= 0 && ci.hi >= 0 ? 'CONTAINS ZERO' : 'EXCLUDES ZERO';
    console.log(`    ${line.padEnd(9)} n=${String(diffs.length).padStart(3)}  ${other} - def uplift `
      + `${p1(ci.mean).padStart(8)}  95% CI [${p1(ci.lo).padStart(8)}, ${p1(ci.hi).padStart(8)}]  ${verdict}`);
   }
  }
  console.log('');
}

// ⚠ THE DIRECT PATH-INDEPENDENCE STATEMENT, PAIRED. Section 4 below shows this
// unpaired; this is the same quantity with an interval on it, which is the only
// form that can distinguish a real shift from between-book noise.
console.log('  TOTAL CESSION / registerSum, the quantity 6c535d1 says is fixed');
for (const line of LINES) {
  for (const other of ['mid', 'sqz']) {
    const diffs: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const pick = (arm: string) => cohorts.filter(c => c.matured && c.arm === arm && c.line === line && c.game === g);
      const share = (cs: Cohort[]) => sum(cs, c => c.registerSum) === 0 ? NaN
        : (sum(cs, c => c.inceptionCeded) + sum(cs, c => c.finalCededDev)) / sum(cs, c => c.registerSum);
      const d = share(pick(other)) - share(pick('def'));
      if (Number.isFinite(d)) diffs.push(d);
    }
    const ci = pairedCI(diffs);
    console.log(`    ${line.padEnd(9)} n=${String(diffs.length).padStart(3)}  ${other} - def share `
      + `${p1(ci.mean).padStart(8)}  95% CI [${p1(ci.lo).padStart(8)}, ${p1(ci.hi).padStart(8)}]  `
      + `${ci.lo <= 0 && ci.hi >= 0 ? 'CONTAINS ZERO' : 'EXCLUDES ZERO'}`);
  }
}
console.log('');

// --- 4. TOTAL CESSION, THE PATH-INDEPENDENCE STATEMENT ITSELF ---------------
console.log('--- 4. TOTAL CESSION AS A SHARE OF THE REGISTER, which is what path-independence says is fixed ---');
console.log('  arm  line       total ceded / registerSum   (inception + final cededDevToDate, over the drawn register)');
for (const line of LINES) {
  const vals: Record<string, number> = {};
  for (const arm of ARMS) {
    const cs = cohorts.filter(c => c.matured && c.arm === arm.name && c.line === line);
    vals[arm.name] = (sum(cs, c => c.inceptionCeded) + sum(cs, c => c.finalCededDev)) / sum(cs, c => c.registerSum);
  }
  console.log(`       ${line.padEnd(9)} def ${p1(vals.def).padStart(8)}   mid ${p1(vals.mid).padStart(8)}   `
    + `sqz ${p1(vals.sqz).padStart(8)}   sqz-def ${p1(vals.sqz - vals.def).padStart(8)}`);
}

// --- 5. WHAT THE PRICE WOULD HAVE TO BE -------------------------------------
console.log('\n--- 5. THE NUMBER OPTION 3 WOULD NEED, on the corrected basis ---');
console.log('  ⚠ MONOTONE IN THE BIAS = a real coupling. FLAT = the arm split was the give-back artefact.');
for (const line of LINES) {
  const d = upliftRows[`def|${line}`];
  const i = upliftRows[`mid|${line}`];
  const s = upliftRows[`sqz|${line}`];
  console.log(`  ${line.padEnd(9)} NEW basis  def ${p1(d.nw).padStart(7)}  mid ${p1(i.nw).padStart(7)}  sqz ${p1(s.nw).padStart(7)}`
    + `   spread ${p1(Math.abs(s.nw - d.nw)).padStart(7)}`);
  console.log(`  ${' '.repeat(9)} OLD basis  def ${p1(d.old).padStart(7)}  mid ${p1(i.old).padStart(7)}  sqz ${p1(s.old).padStart(7)}`
    + `   spread ${p1(Math.abs(s.old - d.old)).padStart(7)}`);
}


// ============================================================================
// 6. THE GATE.
// ============================================================================
console.log('\n--- 6. GATE: LIFETIME DEVELOPMENT CESSION AGAINST INCEPTION CESSION, AT DEFAULTS ---');
{
  let fails = 0;
  const cs = cohorts.filter(c => c.matured && c.arm === 'def');
  for (const line of LINES) {
    const t = cs.filter(c => c.line === line);
    const u = sum(t, c => c.finalCededDev) / sum(t, c => c.inceptionCeded);
    const bad = Math.abs(u) > MAX_LINE_UPLIFT;
    if (bad) fails++;
    console.log(`  ${line.padEnd(9)} uplift ${p1(u).padStart(7)}   `
      + `${bad ? `FAIL (limit ${p1(MAX_LINE_UPLIFT)})` : 'ok'}`);
  }
  const uAll = sum(cs, c => c.finalCededDev) / sum(cs, c => c.inceptionCeded);
  const badAll = Math.abs(uAll) > MAX_POOL_UPLIFT;
  if (badAll) fails++;
  console.log(`  ${'POOL'.padEnd(9)} uplift ${p1(uAll).padStart(7)}   `
    + `${badAll ? `FAIL (limit ${p1(MAX_POOL_UPLIFT)})` : 'ok'}`);
  console.log(fails === 0
    ? '\nDEVELOPMENT CESSION IS NOT A FREE LUNCH. Over complete cohort lives at defaults, where the'
      + '\nbooking bias is zero and the gross walk has no drift, the reinsurer pays a small positive'
      + '\namount that is the convexity of its own treaty and nothing more.'
    : `\n${fails} GATE FAILURE(S) — development cession is running ahead of the losses it is paid on.`);
  process.exit(fails === 0 ? 0 : 1);
}
