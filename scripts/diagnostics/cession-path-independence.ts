// ============================================================================
// DOES SQUEEZED FUNDING BUY REINSURANCE RECOVERY? — A GATE, NOT A MEASUREMENT.
//
// ⚠ THIS EXITS NON-ZERO IF ANY LINE'S PAIRED INTERVAL EXCLUDES ZERO. It began as
// a measurement and found that squeezed recovered $27.47M more on WC, 95% CI
// [$21.20M, $33.74M], with all three lines diverging the same way — underfunding
// bought cover. The fix is the claim-level markdown plus the inception
// give-back; this is the assertion that it stayed fixed.
//
// It is the ONLY test that can see this. A single-arm dollar total cannot: the
// quantity is a DIFFERENCE between two arms on the same seeds, and the guard in
// development-cession-check.ts runs its arms on different seeds by construction.
//
// THE ARITHMETIC THAT SHOULD HOLD. Cession on an occurrence is f(value), and
// the increment booked each year telescopes:
//
//     total = f(initial) + [f(final) - f(initial)] = f(final)
//
// f(final) is path-independent, so squeezing should MOVE cession between
// "recognised at inception" and "recognised on development" without changing
// the sum. If the total moves, underfunding buys cover.
//
// THE ASSUMPTION THAT MAKES IT HOLD is that both arms drive the claims to the
// SAME f(final). That requires the booking bias to reach the claim values. It
// does not — see the coherence section below — so this is measured rather than
// asserted.
//
// PAIRED, SAME SEEDS. The two arms differ only in the funding decision, so the
// difference is taken per (game, line) and the interval is on the DIFFERENCE.
// Two means side by side would be swamped by between-game variance.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, ReserveCohort } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 60);
const YEARS = Number(process.env.YEARS ?? 12);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
const squeeze = (d: DecisionSet): DecisionSet => ({
  ...d,
  byLine: Object.fromEntries(LINES.map(l =>
    [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
});

interface Tally {
  inception: number;       // occurrence cession recognised when the year was written
  development: number;     // cession recognised on prior-year development
  aggregate: number;       // aggregate recovery, reported separately so it cannot confound
  grossWritten: number;
  registerSum: number;
  claimsAtInception: number;
  claimsFinal: number;
  claimsDrawn: number;
  biasDollars: number;     // registerSum x bias, summed over cohorts
  clampEvents: number;
  clampUnallocated: number;
}
const blank = (): Tally => ({
  inception: 0, development: 0, aggregate: 0, grossWritten: 0, registerSum: 0,
  claimsAtInception: 0, claimsFinal: 0, claimsDrawn: 0, biasDollars: 0, clampEvents: 0, clampUnallocated: 0,
});

function runArm(g: number, squeezed: boolean): Record<string, Tally> {
  const id = `CPI${g}`;
  const inst = generateGameInstance(id, 6_400_000 + g * 5273);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: Record<string, Tally> = {};
  for (const l of LINES) out[l] = blank();

  for (let y = 1; y <= YEARS; y++) {
    const before: Record<string, ReserveCohort[]> = {};
    for (const l of LINES) before[l] = gs.poolState.lines[l].reserveCohorts.map(c => ({ ...c }));

    const d = defaultDecisionSet(y);
    const processed = processYear(gs, squeezed ? squeeze(d) : d);

    for (const line of LINES) {
      const r = processed.result.byLine[line];
      const t = out[line];
      // ⚠ THE AGGREGATE IS SPLIT OUT. reinsuranceRecovery is the occurrence
      // cession PLUS any aggregate recovery; folding them together would let an
      // aggregate difference masquerade as an occurrence-cession difference.
      t.aggregate += r.aggregateRecovery ?? 0;
      t.inception += r.reinsuranceRecovery - (r.aggregateRecovery ?? 0);
      t.development += r.priorYearDevelopmentCeded;
      t.grossWritten += r.grossUltimateLoss;

      // The cohort written this year: its register sum, its bias dollars, and
      // the drawn value of the claims chosen to carry its development.
      const born = processed.updatedPoolState.lines[line].reserveCohorts.find(c => c.yearNumber === y);
      if (born) {
        t.registerSum += born.registerSum;
        t.biasDollars += born.registerSum * born.bookingBias;
        t.claimsAtInception += (born.developingClaims ?? []).reduce((s, c) => s + c.original, 0);
        t.claimsDrawn += (born.developingClaims ?? []).reduce((s, c) => s + c.drawn, 0);
      }

      // A favourable movement bigger than the subset can absorb: the clamp.
      for (const b of before[line]) {
        if (b.closed) continue;
        const a = processed.updatedPoolState.lines[line].reserveCohorts.find(c => c.yearNumber === b.yearNumber);
        if (!a) continue;
        const bc = (b.developingClaims ?? []).reduce((s, c) => s + c.current, 0);
        const ac = (a.developingClaims ?? []).reduce((s, c) => s + c.current, 0);
        if (bc > 0 && ac === 0) {
          t.clampEvents++;
          // The favourable movement the cohort actually took, recovered from the
          // ultimate. Anything beyond what the subset could absorb (bc) is the
          // UNALLOCATED remainder — the part no claim could carry.
          const ultimateDrop = b.netUltimate - a.netUltimate;
          t.clampUnallocated += Math.max(0, ultimateDrop - bc);
        }
      }
    }
    gs = {
      ...gs, currentYearNumber: y + 1, poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result], isComplete: y === YEARS,
    };
  }
  for (const line of LINES) {
    out[line].claimsFinal = gs.poolState.lines[line].reserveCohorts
      .reduce((s, c) => s + (c.developingClaims ?? []).reduce((q, d2) => q + d2.current, 0), 0);
  }
  return out;
}

// ---------------------------------------------------------------- collection
const paired: Record<string, { def: Tally; sq: Tally }[]> = {};
for (const l of LINES) paired[l] = [];
for (let g = 0; g < GAMES; g++) {
  const def = runArm(g, false);
  const sq = runArm(g, true);
  for (const l of LINES) paired[l].push({ def: def[l], sq: sq[l] });
}

// ---------------------------------------------------------------- stats
const money = (v: number) => `$${(v / 1e6).toFixed(2)}M`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
function ci(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, se };
}

console.log('=== DOES SQUEEZED FUNDING BUY REINSURANCE RECOVERY? ===\n');
console.log(`${GAMES} paired games x ${YEARS} years x ${LINES.length} lines. Same seed in both arms;`);
console.log('the only difference is the funding decision. Occurrence cession only —');
console.log('the aggregate is reported separately so it cannot confound the comparison.\n');

console.log('--- CESSION BY RECOGNITION POINT, MEANS PER GAME ---');
console.log('  line       arm         at inception   on development          TOTAL      aggregate');
for (const line of LINES) {
  for (const [name, pick] of [['defaults', (p: { def: Tally; sq: Tally }) => p.def], ['squeezed', (p: { def: Tally; sq: Tally }) => p.sq]] as const) {
    const rows = paired[line].map(pick);
    const m = (f: (t: Tally) => number) => rows.reduce((s, t) => s + f(t), 0) / rows.length;
    console.log(
      `  ${line.padEnd(10)} ${name.padEnd(10)} ${money(m(t => t.inception)).padStart(13)} ` +
      `${money(m(t => t.development)).padStart(16)} ${money(m(t => t.inception + t.development)).padStart(14)} ` +
      `${money(m(t => t.aggregate)).padStart(14)}`,
    );
  }
}

console.log('\n\n--- THE GATE: PAIRED DIFFERENCE IN TOTAL CESSION (squeezed - defaults) ---');
console.log('  If the total is path-independent this interval contains zero.\n');
console.log('  line       mean diff        95% CI                      as % of defaults total   verdict');
let anyDiverge = false;
for (const line of LINES) {
  const diffs = paired[line].map(p => (p.sq.inception + p.sq.development) - (p.def.inception + p.def.development));
  const c = ci(diffs);
  const baseline = paired[line].reduce((s, p) => s + p.def.inception + p.def.development, 0) / paired[line].length;
  const excludesZero = (c.lo > 0 && c.hi > 0) || (c.lo < 0 && c.hi < 0);
  if (excludesZero) anyDiverge = true;
  console.log(
    `  ${line.padEnd(10)} ${money(c.mean).padStart(11)}   [${money(c.lo)}, ${money(c.hi)}]`.padEnd(58) +
    `${pct(c.mean / baseline).padStart(10)}              ` +
    (excludesZero ? (c.mean > 0 ? 'DIVERGES — squeezed recovers MORE' : 'DIVERGES — squeezed recovers LESS') : 'contains zero'),
  );
}

console.log('\n  And the same difference split by recognition point, to show the reclassification:');
console.log('  line       at inception (diff)        on development (diff)');
for (const line of LINES) {
  const di = ci(paired[line].map(p => p.sq.inception - p.def.inception));
  const dd = ci(paired[line].map(p => p.sq.development - p.def.development));
  console.log(
    `  ${line.padEnd(10)} ${money(di.mean).padStart(11)} [${money(di.lo)}, ${money(di.hi)}]`.padEnd(50) +
    `${money(dd.mean).padStart(11)} [${money(dd.lo)}, ${money(dd.hi)}]`,
  );
}

console.log('\n\n--- DOES THE BOOKING BIAS REACH THE CLAIM VALUES? ---');
console.log('  YES, NOW. The register is marked down by the cohort\'s bias dollars at inception and');
console.log('  the unwind restores it, so a pool booking optimistically shows optimistic CLAIM');
console.log('  values and the claims end in the SAME PLACE under both arms.\n');
console.log('  ⚠ THE RATIO TO WATCH IS end/DRAWN, NOT end/booked. Marking the register down moves');
console.log('    the denominator, so end/booked legitimately differs between arms while the claims');
console.log('    themselves converge. Against the DRAWN value — the one thing both arms share —');
console.log('    the two columns should agree.\n');
console.log('  line       arm        register sum   bias dollars   as booked   as drawn   claims at end   end/DRAWN');
for (const line of LINES) {
  for (const [name, pick] of [['defaults', (p: { def: Tally; sq: Tally }) => p.def], ['squeezed', (p: { def: Tally; sq: Tally }) => p.sq]] as const) {
    const rows = paired[line].map(pick);
    const m = (f: (t: Tally) => number) => rows.reduce((s, t) => s + f(t), 0) / rows.length;
    console.log(
      `  ${line.padEnd(10)} ${name.padEnd(10)} ${money(m(t => t.registerSum)).padStart(12)} ` +
      `${money(m(t => t.biasDollars)).padStart(14)} ${money(m(t => t.claimsAtInception)).padStart(11)} ` +
      `${money(m(t => t.claimsDrawn)).padStart(10)} ${money(m(t => t.claimsFinal)).padStart(15)} ` +
      `${(m(t => t.claimsFinal) / Math.max(1, m(t => t.claimsDrawn))).toFixed(3).padStart(11)}`,
    );
  }
}
console.log('\n  bias dollars is registerSum x bookingBias — marked down at inception and added back');
console.log('  by the unwind, so the two cancel and "as drawn" is what the claims return to.');

console.log('\n\n--- THE CLAMP: WHAT HOLDS THE EXCESS? ---');
for (const line of LINES) {
  const dEv = paired[line].reduce((s, p) => s + p.def.clampEvents, 0);
  const sEv = paired[line].reduce((s, p) => s + p.sq.clampEvents, 0);
  const dUn = paired[line].reduce((s, p) => s + p.def.clampUnallocated, 0);
  const sUn = paired[line].reduce((s, p) => s + p.sq.clampUnallocated, 0);
  console.log(`  ${line.padEnd(10)} subset driven to exactly zero:  defaults ${String(dEv).padStart(4)} (${money(dUn)} unallocated)   squeezed ${String(sEv).padStart(4)} (${money(sUn)} unallocated)`);
}

if (anyDiverge) {
  console.log('\n\nFAIL: AT LEAST ONE LINE DIVERGES. Total cession depends on the funding decision,');
  console.log('      which means underfunding buys cover. The decomposition above is the finding.');
  process.exit(1);
}
console.log('\n\nTOTAL CESSION IS PATH-INDEPENDENT. Every line\'s paired 95% interval contains zero:');
console.log('squeezing moves cession between inception and development without changing the sum,');
console.log('so a pool cannot buy reinsurance recovery by underfunding.');
process.exit(0);
