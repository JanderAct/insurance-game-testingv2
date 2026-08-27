// ============================================================================
// DEVELOPMENT SIGN SYMMETRY — A GATE, NOT A MEASUREMENT.
//
// ⚠ THIS EXITS NON-ZERO. It began as the diagnostic for a pool-year reading
// gross -$676,463 adverse, recovery $997,044, net +$320,580 FAVOURABLE — the
// reinsurer paying more than the loss — and it is now the standing assertion
// that the mechanism it found stays fixed.
//
// ⚠ IT EXISTS BECAUSE NEITHER STANDING GATE CAN SEE THIS, and that is worth
// stating before anyone folds it into one of them:
//
//   cession-path-independence takes a PAIRED DIFFERENCE between two funding
//   arms. Both arms were equally asymmetric, so the difference was zero and it
//   passed throughout. Its own header says why: "A single-arm dollar total
//   cannot: the quantity is a DIFFERENCE between two arms." True for the
//   question it was built for, and exactly what left this one unwatched.
//
//   development-cession-check asserts that E[ultimate] is unchanged on the
//   GROSS side. It is. The gate never asks whether NET is, and net was drifting
//   favourable by the whole expected recovery.
//
// So the two assertions here are deliberately the shapes those cannot take: a
// SINGLE-ARM dollar statement, and a PAIRED-PROBE statement about the mechanism
// rather than about two runs of it.
//
//   THE PROBE       +X and -X on identical cohort state, through the engine's
//                   OWN routing (STOCHASTIC_ALLOCATION_MODE, imported rather
//                   than restated). The adverse/favourable marginal cession
//                   ratio must be near 1. It read 2.28x on WC before the
//                   symmetric-routing commit.
// ⚠ THE SINGLE-ARM DOLLAR ASSERTION LIVES IN cession-uplift-basis.ts, NOT HERE,
// and the reason is a measurement error this script made first. Recovery per
// dollar of movement over a fixed WINDOW is not zero even under perfectly
// symmetric routing, because a window truncates cohorts mid-life: their adverse
// phase is counted and their settlement is not. It reads +6.2% here at defaults
// with the mechanism working correctly. The honest single-arm statement is over
// COMPLETE cohort lives and against inception cession, which is what that script
// measures and gates. The window figure is still printed below, unasserted,
// because it is the number the original symptom was reported in.
//
// READ-ONLY on the engine. Nothing here changes it.
//
// THE SYMPTOM: a pool-year reading gross -$676,463 adverse, recovery $997,044,
// net +$320,580 FAVOURABLE — the reinsurer paying more than the loss.
//
// The card is net = gross + recovery and is internally consistent, so this
// decomposes the two inputs:
//
//   PER COHORT   retained = d(netUltimate), ceded = d(cededDevelopmentToDate),
//                gross = retained + ceded. Cross-checked against the claim
//                register's own movement so the decomposition cannot be an
//                artefact of reading the wrong field.
//   THE TEST     does any cohort with a FAVOURABLE gross movement carry a
//                NON-NEGATIVE cession increment? That is the hypothesis: gross
//                nets adverse against favourable while recovery only counts the
//                adverse side.
//   THE RATE     marginal cession rate ceded/gross, adverse cohorts vs
//                favourable ones. If both sides cede back at the same rate the
//                hypothesis is dead and the cancellation is something else.
// ============================================================================

import { STOCHASTIC_ALLOCATION_MODE, allocateDevelopment, cedeDevelopment } from '../../src/utils/developmentAllocation';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, ReserveCohort } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 25);
const YEARS = Number(process.env.YEARS ?? 10);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

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

const clone = (cs: ReserveCohort[]): ReserveCohort[] =>
  cs.map(c => ({ ...c, developingClaims: c.developingClaims?.map(d => ({ ...d })) }));

// ADVERSE-POSITIVE throughout this script, because the symptom is stated that
// way. The engine's priorYearDevelopment is favourable-positive; every figure
// below is its negation, and the sign is named on every column.
interface CohortMove {
  ay: number; retained: number; ceded: number; gross: number;
  registerGross: number; seed: boolean; tracked: number; age: number; horizon: number;
}
interface LineYear {
  arm: string; line: string; game: number; year: number;
  grossTotal: number; cededTotal: number; netTotal: number;
  absTotal: number;
  reportedNet: number; reportedCeded: number;
  cohorts: CohortMove[];
}

// GATE THRESHOLDS.
//
// ⚠ SET WITH HEADROOM OVER THE MEASURED VALUE AND UNDER THE DEFECT, which is the
// only way a threshold means anything. Measured at 15 games x 10 years:
//
//                        before symmetric routing    after
//   probe ratio, WC              2.28x               1.05x
//   probe ratio, GL              1.66x               1.02x
//   probe ratio, Property        1.36x               1.04x
//   recovery / |movement|, def   see below           see below
//
// A ratio of 1.02-1.05 is the tower's own convexity at the attachment and is
// irreducible; 1.20 is comfortably above it and far below the 1.36x of the
// mildest line under the retired rule.
const MAX_PROBE_RATIO = 1.20;

const all: LineYear[] = [];

// EVERY COHORT STATE THE RUN PASSED THROUGH, kept so the same state can be
// probed with a +X and a -X movement — the paired test that separates "the sign
// is treated differently" from "the sign lands somewhere different".
interface Probe { line: TowerLine; tracked: ReserveCohort['developingClaims']; untracked: number; placed: boolean[] }
const probes: Probe[] = [];

for (const arm of ARMS) {
  for (let g = 0; g < GAMES; g++) {
    const id = `DSS${arm.name}${g}`;
    const inst = generateGameInstance(id, 9_400_000 + g * 7717);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    for (let y = 1; y <= YEARS; y++) {
      const before: Record<string, ReserveCohort[]> = {};
      for (const l of LINES) before[l] = clone(gs.poolState.lines[l].reserveCohorts);

      const p = processYear(gs, arm.decisions(defaultDecisionSet(y)));

      for (const line of LINES) {
        const r = p.result.byLine[line];
        const afterBy = new Map(p.updatedPoolState.lines[line].reserveCohorts.map(c => [c.yearNumber, c]));
        const cohorts: CohortMove[] = [];
        for (const b of before[line]) {
          // A cohort marked closed last year is filtered out of processIbner and
          // contributes nothing; the accident year written THIS year is not in
          // `before` at all, so inception cession never lands in this sum.
          if (b.closed) continue;
          const a = afterBy.get(b.yearNumber);
          if (!a) continue;
          const retained = a.netUltimate - b.netUltimate;                                  // adverse +
          const ceded = (a.cededDevelopmentToDate ?? 0) - (b.cededDevelopmentToDate ?? 0);  // adverse +
          // The claim register's own movement, read independently of the two
          // ledger fields above — the cross-check that the decomposition is real.
          const beforeById = new Map((b.developingClaims ?? []).map(d => [d.occurrenceId, d.current]));
          let registerGross = (a.untrackedTotal ?? 0) - (b.untrackedTotal ?? 0);
          for (const d of a.developingClaims ?? []) registerGross += d.current - (beforeById.get(d.occurrenceId) ?? 0);
          cohorts.push({
            ay: b.yearNumber, retained, ceded, gross: retained + ceded, registerGross,
            seed: (b.developingClaims ?? []).length === 0,
            tracked: (b.developingClaims ?? []).length,
            age: b.age, horizon: b.horizon,
          });
          if ((b.developingClaims ?? []).length > 0 && b.age < b.horizon && b.placedAtInception) {
            probes.push({
              line: line as TowerLine, tracked: b.developingClaims,
              untracked: b.untrackedTotal ?? 0, placed: b.placedAtInception,
            });
          }
        }
        all.push({
          arm: arm.name, line, game: g, year: y,
          grossTotal: cohorts.reduce((s, c) => s + c.gross, 0),
          cededTotal: cohorts.reduce((s, c) => s + c.ceded, 0),
          netTotal: cohorts.reduce((s, c) => s + c.retained, 0),
          absTotal: cohorts.reduce((s, c) => s + Math.abs(c.gross), 0),
          reportedNet: -r.priorYearDevelopment,          // to adverse-positive
          reportedCeded: r.priorYearDevelopmentCeded,
          cohorts,
        });
      }

      gs = {
        ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
      };
    }
  }
}

const m = (v: number) => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(3)}M`;
const pct = (a: number, b: number) => (b === 0 ? '   n/a' : `${((a / b) * 100).toFixed(1)}%`);

console.log('=== DEVELOPMENT SIGN SYMMETRY ===');
console.log(`${GAMES} games x ${YEARS} years x ${LINES.length} lines x ${ARMS.length} arms `
  + `= ${all.length} line-years. ADVERSE-POSITIVE throughout.\n`);

// ---------------------------------------------------------------- 0. tie out
{
  let worstNet = 0;
  let worstCeded = 0;
  for (const ly of all) {
    worstNet = Math.max(worstNet, Math.abs(ly.netTotal - ly.reportedNet));
    worstCeded = Math.max(worstCeded, Math.abs(ly.cededTotal - ly.reportedCeded));
    for (const c of ly.cohorts) {
      if (Math.abs(c.gross - c.registerGross) > 1 && !c.seed) {
        console.log(`  ⚠ cohort ${ly.line} ay${c.ay}: ledger gross ${m(c.gross)} vs register ${m(c.registerGross)}`);
      }
    }
  }
  console.log('--- 0. THE DECOMPOSITION TIES TO THE REPORTED FIELDS ---');
  console.log(`  worst |sum(d netUltimate) - priorYearDevelopment|      ${worstNet.toExponential(2)}`);
  console.log(`  worst |sum(d cededToDate) - priorYearDevelopmentCeded| ${worstCeded.toExponential(2)}`);
  console.log('  (and every non-seed cohort\'s ledger gross equals its claim register\'s own movement)\n');
}

// ------------------------------------------------- 1. does the symptom occur?
const pathological = all.filter(ly => ly.grossTotal > 0 && ly.cededTotal > ly.grossTotal);
console.log('--- 1. THE SYMPTOM: GROSS ADVERSE, RECOVERY LARGER, NET FAVOURABLE ---');
console.log(`  ${pathological.length} of ${all.length} line-years (${((pathological.length / all.length) * 100).toFixed(1)}%)`);
{
  const byArm: Record<string, number> = {};
  const byLine: Record<string, number> = {};
  for (const ly of pathological) {
    byArm[ly.arm] = (byArm[ly.arm] ?? 0) + 1;
    byLine[ly.line] = (byLine[ly.line] ?? 0) + 1;
  }
  console.log(`  by arm  ${Object.entries(byArm).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  console.log(`  by line ${Object.entries(byLine).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  const worst = [...pathological].sort((a, b) => (b.cededTotal - b.grossTotal) - (a.cededTotal - a.grossTotal))[0];
  if (worst) {
    console.log(`\n  WORST: ${worst.arm} ${worst.line} game ${worst.game} year ${worst.year}`);
    console.log(`    gross ${m(worst.grossTotal)} adverse   recovery ${m(worst.cededTotal)}   `
      + `net ${m(worst.netTotal)}  (${worst.netTotal < 0 ? 'FAVOURABLE' : 'adverse'})`);
    console.log('    ay   age/hor  tracked  seed      gross      ceded   rate   retained');
    for (const c of [...worst.cohorts].sort((a, b) => b.gross - a.gross)) {
      console.log(`    ${String(c.ay).padStart(3)}   ${String(c.age).padStart(2)}/${String(c.horizon).padEnd(3)} `
        + `${String(c.tracked).padStart(6)}  ${c.seed ? 'SEED' : '    '}  ${m(c.gross).padStart(10)} `
        + `${m(c.ceded).padStart(10)}  ${pct(c.ceded, c.gross).padStart(6)}  ${m(c.retained).padStart(10)}`);
    }
  }
}

// ------------------------------------- 2. THE HYPOTHESIS, TESTED PER COHORT
console.log('\n--- 2. DOES A FAVOURABLE COHORT MOVEMENT GIVE CESSION BACK? ---');
{
  const fav = all.flatMap(ly => ly.cohorts).filter(c => c.gross < -1);
  const adv = all.flatMap(ly => ly.cohorts).filter(c => c.gross > 1);
  const favNonNeg = fav.filter(c => c.ceded >= 0);
  const favZero = fav.filter(c => c.ceded === 0);
  console.log(`  cohort-years with a FAVOURABLE gross movement   ${fav.length}`);
  console.log(`    of which cession increment is NEGATIVE        ${fav.length - favNonNeg.length}  <- gives it back`);
  console.log(`    of which cession increment is EXACTLY 0       ${favZero.length}`);
  console.log(`    of which cession increment is POSITIVE        ${favNonNeg.length - favZero.length}  <- would be the bug`);
  console.log(`  cohort-years with an ADVERSE gross movement     ${adv.length}`);
  console.log(`    of which cession increment is POSITIVE        ${adv.filter(c => c.ceded > 0).length}`);
  console.log(`    of which cession increment is EXACTLY 0       ${adv.filter(c => c.ceded === 0).length}`);

  const rate = (cs: CohortMove[]) => {
    const gs = cs.reduce((s, c) => s + c.gross, 0);
    const cd = cs.reduce((s, c) => s + c.ceded, 0);
    return { gs, cd, r: cd / gs };
  };
  const ra = rate(adv);
  const rf = rate(fav);
  console.log('\n  DOLLAR-WEIGHTED MARGINAL CESSION RATE, the number the hypothesis is really about:');
  console.log(`    ADVERSE     ${m(ra.gs).padStart(11)} gross -> ${m(ra.cd).padStart(11)} ceded   ${(ra.r * 100).toFixed(1)}%`);
  console.log(`    FAVOURABLE  ${m(rf.gs).padStart(11)} gross -> ${m(rf.cd).padStart(11)} ceded   ${(rf.r * 100).toFixed(1)}%`);
  console.log(`    ratio adverse/favourable  ${(ra.r / rf.r).toFixed(2)}x`);

  // Split by whether the cohort has a register at all — a seed cohort cedes
  // nothing in EITHER direction, which is symmetric per cohort but not across a
  // portfolio where seed cohorts and engine cohorts move independently.
  const withReg = (cs: CohortMove[]) => cs.filter(c => !c.seed);
  const rwa = rate(withReg(adv));
  const rwf = rate(withReg(fav));
  console.log('\n  SAME, RESTRICTED TO COHORTS THAT HAVE A CLAIM REGISTER (seed cohorts excluded):');
  console.log(`    ADVERSE     ${m(rwa.gs).padStart(11)} gross -> ${m(rwa.cd).padStart(11)} ceded   ${(rwa.r * 100).toFixed(1)}%`);
  console.log(`    FAVOURABLE  ${m(rwf.gs).padStart(11)} gross -> ${m(rwf.cd).padStart(11)} ceded   ${(rwf.r * 100).toFixed(1)}%`);
  console.log(`    ratio adverse/favourable  ${(rwa.r / rwf.r).toFixed(2)}x`);
}

// ---------------------------------------------- 3. is the portfolio net biased?
console.log('\n--- 3. OVER THE WHOLE RUN: IS CESSION A FREE LUNCH? ---');
{
  const gs = all.reduce((s, ly) => s + ly.grossTotal, 0);
  const cd = all.reduce((s, ly) => s + ly.cededTotal, 0);
  const nt = all.reduce((s, ly) => s + ly.netTotal, 0);
  console.log(`  gross development (adverse +)   ${m(gs)}`);
  console.log(`  recovery on it                  ${m(cd)}`);
  console.log(`  net development (adverse +)     ${m(nt)}`);
  console.log(`  recovery as a share of gross    ${pct(cd, gs)}`);
  for (const line of LINES) {
    const s = all.filter(ly => ly.line === line);
    const g2 = s.reduce((a, ly) => a + ly.grossTotal, 0);
    const c2 = s.reduce((a, ly) => a + ly.cededTotal, 0);
    const n2 = s.reduce((a, ly) => a + ly.netTotal, 0);
    console.log(`    ${line.padEnd(9)} gross ${m(g2).padStart(11)}  recovery ${m(c2).padStart(11)}  `
      + `net ${m(n2).padStart(11)}  (${pct(c2, g2)} of gross)`);
  }
  for (const arm of ARMS) {
    const s = all.filter(ly => ly.arm === arm.name);
    const g2 = s.reduce((a, ly) => a + ly.grossTotal, 0);
    const c2 = s.reduce((a, ly) => a + ly.cededTotal, 0);
    const n2 = s.reduce((a, ly) => a + ly.netTotal, 0);
    console.log(`    ${arm.name.padEnd(9)} gross ${m(g2).padStart(11)}  recovery ${m(c2).padStart(11)}  `
      + `net ${m(n2).padStart(11)}  (${pct(c2, g2)} of gross)`);
  }
}

// ============================================================================
// 4. THE PAIRED PROBE — THE TEST THAT SEPARATES THE TWO EXPLANATIONS.
//
// Sections 1-3 measure a PATH, so an asymmetric rate there could mean either
// "the sign is treated differently" or "the two signs land on different claims".
// This applies +X and -X to the SAME cohort state, through the real allocator
// and the real tower, and reads back what each cedes.
//
//   If the rates match, cession is sign-blind and the path result is a
//   composition effect.
//   If they differ on identical state, the rule itself is one-sided — and the
//   probe also says WHERE, because it reports the same pair under a forced
//   common mode.
// ============================================================================
console.log('\n--- 4. PAIRED PROBE: +X AND -X ON IDENTICAL COHORT STATE ---');
{
  const X = 500_000;
  const cede = (p: Probe, amount: number, mode: 'carriers' | 'proportional') => {
    const t = p.tracked ?? [];
    const a = allocateDevelopment(t, p.untracked, amount, mode);
    return cedeDevelopment(p.line, t, a.deltas, a.untrackedDelta, p.placed).ceded;
  };

  interface Acc { n: number; advCeded: number; favCeded: number; sameModeAdv: number; sameModeFav: number }
  const byLine: Record<string, Acc> = {};
  for (const l of LINES) byLine[l] = { n: 0, advCeded: 0, favCeded: 0, sameModeAdv: 0, sameModeFav: 0 };

  for (const p of probes) {
    const a = byLine[p.line];
    a.n++;
    // AS THE ENGINE ACTUALLY ROUTES THEM: adverse to the carriers, favourable
    // proportionally across the whole register.
    a.advCeded += cede(p, +X, STOCHASTIC_ALLOCATION_MODE);
    a.favCeded += -cede(p, -X, STOCHASTIC_ALLOCATION_MODE);
    // BOTH PROPORTIONAL — the allocation rule held constant, so anything left is
    // the tower's own shape.
    a.sameModeAdv += cede(p, +X, 'proportional');
    a.sameModeFav += -cede(p, -X, 'proportional');
  }

  console.log(`  ${probes.length} cohort states probed with +/-$${(X / 1e3).toFixed(0)}k each.\n`);
  console.log('               ------- AS ROUTED -------    --- BOTH PROPORTIONAL ---');
  console.log('  line          adverse  favourable  ratio     adverse  favourable  ratio');
  for (const l of LINES) {
    const a = byLine[l];
    if (a.n === 0) continue;
    const ar = a.advCeded / (a.n * X);
    const fr = a.favCeded / (a.n * X);
    const sar = a.sameModeAdv / (a.n * X);
    const sfr = a.sameModeFav / (a.n * X);
    console.log(`  ${l.padEnd(9)} ${(ar * 100).toFixed(1).padStart(9)}% ${(fr * 100).toFixed(1).padStart(10)}% `
      + `${(ar / fr).toFixed(2).padStart(6)}x ${(sar * 100).toFixed(1).padStart(11)}% `
      + `${(sfr * 100).toFixed(1).padStart(10)}% ${(sar / sfr).toFixed(2).padStart(6)}x`);
  }
}

// ============================================================================
// 5. WHERE THE REGISTER SITS RELATIVE TO THE ATTACHMENT.
//
// A proportional movement's cession is decided by what share of the register is
// ABOVE the first attachment, because cession is flat at zero below it. This is
// the number that explains section 4's second pair.
// ============================================================================
console.log('\n--- 4b. PER COHORT STATE: DOES ANY SINGLE SITE TREAT THE SIGNS DIFFERENTLY? ---');
{
  const X = 500_000;
  const cede = (p: Probe, amount: number, mode: 'carriers' | 'proportional') => {
    const t = p.tracked ?? [];
    const a = allocateDevelopment(t, p.untracked, amount, mode);
    return cedeDevelopment(p.line, t, a.deltas, a.untrackedDelta, p.placed).ceded;
  };
  let advOnly = 0;
  let favOnly = 0;
  let both = 0;
  let neither = 0;
  let propAdvOnly = 0;
  let propFavOnly = 0;
  for (const p of probes) {
    const a = cede(p, +X, STOCHASTIC_ALLOCATION_MODE);
    const f = -cede(p, -X, STOCHASTIC_ALLOCATION_MODE);
    if (a > 0.01 && f <= 0.01) advOnly++;
    else if (f > 0.01 && a <= 0.01) favOnly++;
    else if (a > 0.01) both++;
    else neither++;
    const pa = cede(p, +X, 'proportional');
    const pf = -cede(p, -X, 'proportional');
    if (pa > 0.01 && pf <= 0.01) propAdvOnly++;
    if (pf > 0.01 && pa <= 0.01) propFavOnly++;
  }
  console.log(`  AS ROUTED     adverse cedes but favourable gives back NOTHING   ${advOnly}`);
  console.log(`                favourable gives back but adverse cedes nothing   ${favOnly}`);
  console.log(`                both / neither                                    ${both} / ${neither}`);
  console.log(`  BOTH PROPORTIONAL  adverse-only ${propAdvOnly}   favourable-only ${propFavOnly}`
    + '   <- the mirror image, so the mode is the asymmetry, not the tower');
}

console.log('\n--- 5. HOW MUCH OF THE REGISTER IS EVEN INSIDE THE TOWER? ---');
for (const l of LINES) {
  const ps = probes.filter(p => p.line === l);
  if (ps.length === 0) continue;
  const retention = REINSURANCE_TOWER[l as TowerLine][0].attachment;
  let above = 0;
  let whole = 0;
  let trackedTotal = 0;
  let nAbove = 0;
  let nTracked = 0;
  for (const p of ps) {
    for (const d of p.tracked ?? []) {
      whole += d.current; trackedTotal += d.current; nTracked++;
      if (d.current >= retention) { above += d.current; nAbove++; }
    }
    whole += p.untracked;
  }
  console.log(`  ${l.padEnd(9)} retention $${(retention / 1e6).toFixed(0)}M   `
    + `tracked ${pct(trackedTotal, whole)} of the register, `
    + `of which ${nAbove}/${nTracked} occurrences are at or above it `
    + `(${pct(above, whole)} of the register)`);
}

// ============================================================================
// 6. THE FLOOR SWEEP — every site in the development path where a FAVOURABLE
// movement is bounded and an adverse one is not, whether or not it currently
// bites. Replayed on the observed cohort states rather than argued from source.
//
//   A  allocateDevelopment  applied = amount < 0 ? -min(-amount, pool) : amount
//   B  cedeDevelopment      next = max(0, current + delta)
//   C  processIbner         untracked = max(0, untracked + untrackedDelta)
//   D  allocateDevelopment  carriers-mode pool is trackedTotal, not the register
//
// A, B and C are the three the sweep can exercise directly. D cannot bite today
// because favourable movements never take the carriers branch; it is probed by
// forcing the branch, to size what would happen if the mode rule ever changed.
// ============================================================================
console.log('\n--- 6. FLOOR SWEEP: WHERE IS FAVOURABLE BOUNDED AND ADVERSE NOT? ---');
{
  let hitA = 0; let hitB = 0; let hitC = 0; let dollarsA = 0; let dollarsB = 0; let dollarsC = 0;
  let dGap = 0; let dCases = 0;
  // Sized to reach the floors: a movement large enough to exhaust a register is
  // what the header calls "essentially unreachable", so this asks how far from
  // reachable it actually is.
  for (const p of probes) {
    const t = p.tracked ?? [];
    const registerTotal = t.reduce((s, c) => s + c.current, 0) + p.untracked;
    for (const frac of [0.5, 0.95, 1.5]) {
      const amount = -registerTotal * frac;
      const a = allocateDevelopment(t, p.untracked, amount, 'proportional');
      if (Math.abs(a.unallocated) > 0.01) { hitA++; dollarsA += Math.abs(a.unallocated); }
      const r = cedeDevelopment(p.line, t, a.deltas, a.untrackedDelta, p.placed);
      const clamped = t.reduce((s, c, i) => s + Math.max(0, -(c.current + a.deltas[i])), 0);
      if (clamped > 0.01) { hitB++; dollarsB += clamped; }
      const cClamp = Math.max(0, -(p.untracked + a.untrackedDelta));
      if (cClamp > 0.01) { hitC++; dollarsC += cClamp; }
      void r;
    }
    // D: the same favourable movement routed through the carriers branch.
    const trackedTotal = t.reduce((s, c) => s + c.current, 0);
    if (trackedTotal > 0 && registerTotal > trackedTotal) {
      const amt = -Math.min(registerTotal, trackedTotal * 1.4);
      const prop = allocateDevelopment(t, p.untracked, amt, 'proportional');
      const carr = allocateDevelopment(t, p.untracked, amt, 'carriers');
      if (Math.abs(prop.applied - carr.applied) > 0.01) { dCases++; dGap += Math.abs(prop.applied - carr.applied); }
    }
  }
  const trials = probes.length * 3;
  console.log(`  ${trials} forced favourable movements at 50% / 95% / 150% of each register.`);
  console.log(`  A  unallocated remainder (movement exceeded the pool)   ${hitA} of ${trials}  ${m(dollarsA)}`);
  console.log(`  B  a tracked occurrence clamped at zero                 ${hitB} of ${trials}  ${m(dollarsB)}`);
  console.log(`  C  the untracked mass clamped at zero                   ${hitC} of ${trials}  ${m(dollarsC)}`);
  console.log(`  D  carriers-mode pool would have truncated a favourable movement in `
    + `${dCases} of ${probes.length} states, by ${m(dGap)} in total`);
}

// ============================================================================
// 7. THE DEFAULTS ARM OVER A WINDOW — the form the symptom was first reported in.
//
// bookingBias is zero at defaults, so the only movement is the mean-1 lognormal
// step and the gross walk has no drift.
//
// ⚠ THE DENOMINATOR IS TOTAL ABSOLUTE MOVEMENT, NOT CUMULATIVE GROSS. Cumulative
// gross is near zero by cancellation — that is the premise — so dividing by it
// produces a ratio that explodes on exactly the runs where the mechanism is
// working best.
//
// ⚠ AND THIS IS NOT ZERO EVEN WHEN THE MECHANISM IS RIGHT. Cession is a CONVEX
// function of occurrence size, so a driftless walk through it has positive
// expected cession by Jensen — that is what an excess-of-loss treaty on a
// diffusing claim is worth, not a defect. A window compounds it by cutting
// cohorts off mid-development. Gated over complete lives in cession-uplift-basis.
// ============================================================================
console.log('\n--- 7. REPORTED, NOT GATED: AT DEFAULTS, OVER A 10-YEAR WINDOW ---');
let gateFail = 0;
{
  const d = all.filter(ly => ly.arm === 'def');
  for (const line of [...LINES, 'ALL']) {
    const s2 = line === 'ALL' ? d : d.filter(ly => ly.line === line);
    const g = s2.reduce((a, ly) => a + ly.grossTotal, 0);
    const c = s2.reduce((a, ly) => a + ly.cededTotal, 0);
    const abs = s2.reduce((a, ly) => a + ly.absTotal, 0);
    console.log(`  ${String(line).padEnd(9)} gross ${m(g).padStart(10)}  recovery ${m(c).padStart(10)}  `
      + `absolute movement ${m(abs).padStart(11)}  recovery/movement ${pct(c, abs).padStart(7)}`);
  }
}

// ============================================================================
// 8. AT POOL SCOPE, which is where the symptom was reported. Pooling three lines
// gives the cancellation more to work with, so the rate should be at least as
// high as any single line's.
// ============================================================================
console.log('\n--- 8. THE SYMPTOM AT POOL SCOPE ---');
{
  const key = (ly: LineYear) => `${ly.arm}|${ly.game}|${ly.year}`;
  const byPool = new Map<string, { g: number; c: number }>();
  for (const ly of all) {
    const k = key(ly);
    const e = byPool.get(k) ?? { g: 0, c: 0 };
    e.g += ly.grossTotal; e.c += ly.cededTotal;
    byPool.set(k, e);
  }
  const rows = [...byPool.entries()];
  const bad = rows.filter(([, e]) => e.g > 0 && e.c > e.g);
  const favNetFromAdverseGross = rows.filter(([, e]) => e.g > 0 && e.g - e.c < 0);
  console.log(`  pool-years                                          ${rows.length}`);
  console.log(`  gross ADVERSE and recovery LARGER than it           ${bad.length} (${((bad.length / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  ... i.e. gross adverse but NET FAVOURABLE           ${favNetFromAdverseGross.length}`);
  const byArm: Record<string, [number, number]> = {};
  for (const [k, e] of rows) {
    const arm = k.split('|')[0];
    byArm[arm] = byArm[arm] ?? [0, 0];
    byArm[arm][1]++;
    if (e.g > 0 && e.c > e.g) byArm[arm][0]++;
  }
  for (const [arm, [b, n]] of Object.entries(byArm)) {
    console.log(`    ${arm}  ${b} of ${n}  (${((b / n) * 100).toFixed(1)}%)`);
  }
}


// ============================================================================
// 9. THE GATE: THE PROBE RATIO.
// ============================================================================
console.log('\n--- 9. GATE: ADVERSE / FAVOURABLE MARGINAL CESSION RATIO, ENGINE ROUTING ---');
{
  const X = 500_000;
  const cede = (p: Probe, amount: number) => {
    const t = p.tracked ?? [];
    const a = allocateDevelopment(t, p.untracked, amount, STOCHASTIC_ALLOCATION_MODE);
    return cedeDevelopment(p.line, t, a.deltas, a.untrackedDelta, p.placed).ceded;
  };
  for (const l of LINES) {
    const ps = probes.filter(p => p.line === l);
    if (ps.length === 0) continue;
    let adv = 0;
    let fav = 0;
    for (const p of ps) { adv += cede(p, +X); fav += -cede(p, -X); }
    const ratio = adv / fav;
    const bad = !(ratio > 1 / MAX_PROBE_RATIO && ratio < MAX_PROBE_RATIO);
    if (bad) gateFail++;
    console.log(`  ${l.padEnd(9)} adverse ${((adv / (ps.length * X)) * 100).toFixed(1).padStart(6)}%  `
      + `favourable ${((fav / (ps.length * X)) * 100).toFixed(1).padStart(6)}%  ratio ${ratio.toFixed(2)}x  `
      + `${bad ? `FAIL (limit ${MAX_PROBE_RATIO.toFixed(2)}x)` : 'ok'}`);
  }
}

console.log(gateFail === 0
  ? '\nDEVELOPMENT ALLOCATION IS SIGN-SYMMETRIC. Adverse and favourable movements cede at the same'
    + '\nmarginal rate under the engine\'s own routing, on identical cohort state. The dollar statement'
    + '\nover complete cohort lives is cession-uplift-basis.ts\'s gate, not this one.'
  : `\n${gateFail} GATE FAILURE(S) — see FAIL above.`);
process.exit(gateFail === 0 ? 0 : 1);
