// ============================================================================
// THE PRICING TRIANGLE — S1's GATE. IT EXITS NON-ZERO.
//
//   npx tsx scripts/diagnostics/triangle-check.ts
//   GAMES=12 npx tsx scripts/diagnostics/triangle-check.ts
//
// ⚠ WHAT THIS CAN FAIL ON, because a gate that only prints a table is the thing
// this project keeps deleting. Five assertions, each with a named failure:
//
//   1. THE SHAPE. Ten accident years, ragged, oldest at age 10 and newest at age
//      1. A rectangle would mean the lower-right had been filled in with
//      development nobody has observed, which is the one thing a triangle is
//      for. Verified as a shape, not asserted in prose.
//
//   2. THE WALK IS INDEPENDENTLY RIGHT. Every cell is rebuilt here from
//      reviseOnce and settlementFactor in a plain loop and must agree with the
//      module's to 1e-12 relative. This is a DIFFERENT COMPOSITION of the same
//      law, not a second copy of it, so it catches a mis-ordered walk, an
//      off-by-one in the ages, a wrong paid share or a settlement applied twice.
//      ⚠ WHAT IT DOES NOT CATCH is the module importing a private copy of the
//      law — nothing here could, and the structural guarantee is instead that
//      claimTriangle.ts contains no hash, no quantile and no factor arithmetic
//      of its own. revision-total-sd-report kept exactly such a copy and printed
//      a retired form's table for a whole commit.
//
//   3. THE TERMINAL LANDS ON THE TARGET. The contraction is derived, so if
//      TRIANGLE_INITIAL_CONTRACTION drifts from the law it sits on — a phi
//      change, a headroom-exponent change, a settlement re-solve — the terminal
//      spread moves off the fit and this fails by name. That is the coupling
//      that makes these constants derived rather than free.
//
//   4. THE MEAN IS PRESERVED. A is solved to hold E[initial] = E[drawn]. The
//      triangle is read as a loss cost, so a contraction that quietly moved the
//      mean would misprice by exp((1-k^2) sigma^2 / 2) — a factor of 1.5 on GL —
//      while every spread statistic still looked right.
//
//   5. FORWARD DEVELOPMENT IS REAL. The incurred triangle must actually develop.
//      On the shipped path it does not: age-to-age factors there are 0.992-1.002
//      and a chain ladder returns the truth. If this triangle reads flat too,
//      the rebuild has no mechanism and everything downstream of it is pointless.
//      The floor is deliberately loose — this asserts that development EXISTS,
//      not that it has any particular size, because the size is S2's to set.
//
// ⚠ IT ASSERTS NOTHING ABOUT PRICING, AND THAT IS THE POINT OF S1. The flag is
// off, no path in src/ consumes a triangle, and both standing gates are
// byte-identical against the parent with no recapture.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { claimTerminalValue, reviseOnce, settlementFactor, type RevisionState } from '../../src/utils/claimRevision';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import {
  ageToAgeFactors, cellAt, generateClaimTriangle, initialEstimate,
} from '../../src/utils/claimTriangle';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import {
  LINE_PAYOUT_PATTERN, PRICING_TRIANGLE, TRIANGLE_HISTORY_YEARS,
  TRIANGLE_INITIAL_CONTRACTION, resolveClosureCurve,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
// The terminal targets the contraction is solved against — the CURRENT severity
// fits, re-pointed as terminal rather than drawn. Local to this gate: they are
// not a live parameter until S2 moves the generator itself.
const TERMINAL_TARGET: Record<string, number> = { WC: 2.044, GL: 2.140, Property: 1.636 };
// Wide enough that ordinary sampling noise on a heavy tail cannot flap it,
// tight enough that a real drift in phi or the exponent cannot pass. The spread
// is a sample statistic of a distribution with CV near 30 on GL.
const SD_TOL = 0.08;
const MEAN_TOL = 0.02;

const members = getPredefinedMarketMembers();
const failed: string[] = [];
// ⚠ THE FLAT-TRIANGLE ITEM EXITS 3, NOT 1, AND THE SPLIT IS cohort-ledger-check's.
// Assertions 1-4 are S1's own contract and exit 1 — a real regression on them can
// never hide behind the expected redness, because EXPECTED_RED excuses the exact
// code 3 and nothing else.
const openItem: string[] = [];
const RULE = '='.repeat(72);
const note = (ok: boolean, msg: string) => { if (!ok) failed.push(msg); return ok ? 'OK' : '*** FAIL ***'; };
const noteOpen = (ok: boolean, msg: string) => { if (!ok) openItem.push(msg); return ok ? 'OK' : '*** RED, EXPECTED ***'; };
const sd = (x: number[]) => {
  if (x.length < 2) return NaN;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
};
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

console.log('=== THE PRICING TRIANGLE — S1 ===');
console.log(`PRICING_TRIANGLE.enabled = ${PRICING_TRIANGLE.enabled}; ${TRIANGLE_HISTORY_YEARS} accident years; ${GAMES} instances.\n`);
if (PRICING_TRIANGLE.enabled) {
  failed.push('PRICING_TRIANGLE.enabled is TRUE — S1 ships the triangle OFF and nothing reads it. '
    + 'Flipping it is S3, and S3 also needs PER_CLAIM_REVISION on first.');
}

// ---------------------------------------------------------------- 1. shape
console.log('--- 1. THE SHAPE IS A TRIANGLE, NOT A RECTANGLE ---');
{
  const t = generateClaimTriangle('GL', members, 'TRICHK0', 4_100_000);
  let shapeOk = t.years === TRIANGLE_HISTORY_YEARS;
  for (let ay = 1; ay <= t.years; ay++) {
    const ages = t.cells.filter(c => c.accidentYear === ay).map(c => c.age).sort((a, b) => a - b);
    const want = t.years + 1 - ay;
    if (ages.length !== want || ages[0] !== 1 || ages[ages.length - 1] !== want) shapeOk = false;
  }
  const belowDiagonal = t.cells.filter(c => c.accidentYear + c.age > t.years + 1).length;
  console.log(`  accident years ${t.years}   cells ${t.cells.length}   expected ${t.years * (t.years + 1) / 2}`);
  console.log(`  oldest reaches age ${Math.max(...t.cells.filter(c => c.accidentYear === 1).map(c => c.age))}`
    + `   newest reaches age ${Math.max(...t.cells.filter(c => c.accidentYear === t.years).map(c => c.age))}`);
  console.log(`  cells past the valuation diagonal ${belowDiagonal}  `
    + `${note(shapeOk && belowDiagonal === 0 && t.cells.length === t.years * (t.years + 1) / 2,
      'the triangle is not ragged: an accident year is observed past the valuation date, which is development nobody has seen')}`);
  console.log(`  exposure recorded per year ${t.exposureByYear.length}   counts per year ${t.countByYear.length}  `
    + `${note(t.exposureByYear.length === t.years && t.exposureByYear.every(x => x > 0),
      'exposureByYear is missing or non-positive — a Bornhuetter-Ferguson needs it and it must be stored as written')}`);
}

// ------------------------------------------- 2. the walk is independently right
console.log('\n--- 2. THE TRIANGLE\'S WALK, RECOMPUTED INDEPENDENTLY ---');
console.log('  Every cell rebuilt here from reviseOnce and settlementFactor in a plain loop,');
console.log('  a different composition from the module\'s. Catches a mis-ordered walk, an');
console.log('  off-by-one in the ages, a wrong paid share, a settlement applied twice.');
{
  let worstInc = 0, worstPaid = 0, cells = 0;
  for (const line of LINES) {
    const pattern = LINE_PAYOUT_PATTERN[line];
    const instanceId = 'LAWCHK', seed = 4_200_000;
    const t = generateClaimTriangle(line, members, instanceId, seed);
    for (let ay = 1; ay <= t.years; ay++) {
      const maturity = t.years + 1 - ay;
      const gameId = `${instanceId}#tri${ay}`;
      const base = { members, yearNumber: ay, calendarYear: 2025 + ay, instanceSeed: seed + ay * 7919, riskControlEffectiveness: 0 };
      const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
        : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
          : generatePropertyClaims({ ...base, kPr: 1 });
      const inc = new Array<number>(maturity).fill(0);
      const pd = new Array<number>(maturity).fill(0);
      for (const c of r.claims) {
        const curve = resolveClosureCurve(line, c.grossUltimate);
        const u = claimClosureUnit(gameId, c.id);
        let ca = 40;
        for (let k = 1; k <= 40; k++) if (closedShare(curve, k) >= u) { ca = k; break; }
        let st: RevisionState = { value: initialEstimate(line, c.grossUltimate), paidShare: 0 };
        let settled = false;
        for (let age = 1; age <= maturity; age++) {
          if (!settled && age >= ca) {
            st = { ...st, value: st.value * settlementFactor(gameId, c.id) };
            settled = true;
          } else if (!settled) {
            st = { ...st, paidShare: Math.min(0.999, cumulativePaid(pattern, age)) };
            st = reviseOnce(gameId, c.id, age, st);
          }
          const share = settled ? 1 : Math.min(0.999, cumulativePaid(pattern, age));
          inc[age - 1] += st.value;
          pd[age - 1] += st.value * share;
        }
      }
      for (let age = 1; age <= maturity; age++) {
        const cell = cellAt(t, ay, age);
        if (!cell) { failed.push(`${line}: cell (${ay}, ${age}) is missing from the triangle`); continue; }
        cells++;
        worstInc = Math.max(worstInc, Math.abs(cell.incurred - inc[age - 1]) / Math.max(1, inc[age - 1]));
        worstPaid = Math.max(worstPaid, Math.abs(cell.paid - pd[age - 1]) / Math.max(1, pd[age - 1]));
      }
    }
  }
  console.log(`  cells compared ${cells}   worst relative gap: incurred ${worstInc.toExponential(2)}  paid ${worstPaid.toExponential(2)}  `
    + `${note(worstInc < 1e-12 && worstPaid < 1e-12,
      `the triangle disagrees with an independent walk of the same law by ${Math.max(worstInc, worstPaid).toExponential(2)} — the module's loop is not doing what claimRevision does`)}`);
}

// --------------------------------------- 3 & 4. terminal spread, and the mean
console.log('\n--- 3 & 4. THE TERMINAL LANDS ON THE FIT, AND THE MEAN IS PRESERVED ---');
console.log('  line       k         A        sd(ln terminal)  target   mean initial/drawn');
for (const line of LINES) {
  const { k, A } = TRIANGLE_INITIAL_CONTRACTION[line];
  const pattern = LINE_PAYOUT_PATTERN[line];
  const lnT: number[] = [];
  let sumInit = 0, sumDrawn = 0;
  const reps = line === 'Property' ? 40 : line === 'GL' ? 8 : 6;
  for (let g = 0; g < reps; g++) {
    const gameId = `SPR${line}${g}#tri1`;
    for (let y = 1; y <= 4; y++) {
      const base = { members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 4_300_000 + g * 7919, riskControlEffectiveness: 0 };
      const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
        : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
          : generatePropertyClaims({ ...base, kPr: 1 });
      for (const c of r.claims) {
        const init = initialEstimate(line, c.grossUltimate);
        sumInit += init; sumDrawn += c.grossUltimate;
        const curve = resolveClosureCurve(line, c.grossUltimate);
        const u = claimClosureUnit(gameId, c.id);
        let ca = 40;
        for (let t = 1; t <= 40; t++) if (closedShare(curve, t) >= u) { ca = t; break; }
        const term = claimTerminalValue(gameId, c.id, init, ca, undefined,
          age => Math.min(0.999, cumulativePaid(pattern, age)));
        if (term > 0) lnT.push(Math.log(term));
      }
    }
  }
  const s = sd(lnT), mr = sumInit / sumDrawn, tgt = TERMINAL_TARGET[line];
  console.log(`  ${line.padEnd(9)} ${k.toFixed(6)} ${A.toFixed(4).padStart(9)}  ${s.toFixed(4).padStart(13)}  ${tgt.toFixed(3)}   ${mr.toFixed(5).padStart(9)}  `
    + `${note(Math.abs(s - tgt) <= SD_TOL,
      `${line}: the developed terminal spread is ${s.toFixed(4)} against a ${tgt} target, off by ${Math.abs(s - tgt).toFixed(4)} on a ${SD_TOL} tolerance `
      + '— TRIANGLE_INITIAL_CONTRACTION has drifted from the law it was solved against (phi, the headroom exponent or the settlement level moved). Re-solve it; do not widen this.')} `
    + `${note(Math.abs(mr - 1) <= MEAN_TOL,
      `${line}: the initial estimates average ${mr.toFixed(5)} of the drawn values against a 1.000 target — A no longer preserves the mean, so a triangle read as a loss cost would misprice by that factor`)}`);
}

// ------------------------------------------------ 5. development is real
console.log('\n--- 5. THE INCURRED TRIANGLE ACTUALLY DEVELOPS ---');
console.log('  The shipped path reads 0.992-1.002 and a chain ladder returns the truth.');
console.log('  This asserts development EXISTS; its SIZE is S2\'s to set.\n');
console.log('  line       basis      age-to-age factors (mean over instances), first six');
for (const line of LINES) {
  const inc: number[][] = [], pd: number[][] = [];
  for (let g = 0; g < GAMES; g++) {
    const t = generateClaimTriangle(line, members, `TRI${g}`, 4_400_000 + g * 7919);
    inc.push(ageToAgeFactors(t, 'incurred'));
    pd.push(ageToAgeFactors(t, 'paid'));
  }
  const avg = (rows: number[][], i: number) => mean(rows.map(r => r[i]).filter(Number.isFinite));
  const nShow = Math.min(6, inc[0].length);
  const incAvg = Array.from({ length: nShow }, (_, i) => avg(inc, i));
  const pdAvg = Array.from({ length: nShow }, (_, i) => avg(pd, i));
  const cum = incAvg.reduce((a, b) => a * b, 1);
  console.log(`  ${line.padEnd(9)} incurred  ` + incAvg.map(x => x.toFixed(3).padStart(8)).join('')
    + `   cumulative ${cum.toFixed(3)}`);
  console.log(`  ${' '.repeat(9)} paid      ` + pdAvg.map(x => x.toFixed(3).padStart(8)).join(''));
  console.log(`  ${' '.repeat(9)}           ${noteOpen(cum > 1.02,
    `${line}: the incurred triangle is FLAT — cumulative development ${cum.toFixed(4)} over ${nShow} steps. `
    + 'A chain ladder on it returns the truth and there is nothing for a factor selection to be wrong about, '
    + 'which is the shipped path\'s defect arriving in the replacement. The forward walk is not developing.')}`);
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S) — S1's own contract:`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else if (openItem.length > 0) {
  console.log('S1\'S CONTRACT HOLDS: ragged by construction, walked through');
  console.log('claimRevision\'s own law, landing on the severity fit as a TERMINAL target');
  console.log('with the mean preserved.');
  console.log('');
  console.log(`RED ON THE OPEN ITEM (${openItem.length}) — EXPECTED, exit 3:`);
  for (const f of openItem) console.log(`  - ${f}`);
  console.log('');
  console.log('  ⚠ WHY THIS IS STRUCTURAL AND NOT A BUG IN THE WALK. The revision law is');
  console.log('    MEAN-ONE (martingale-equivalence-check reads persistence 1.00034), and A is');
  console.log('    solved to hold E[initial] = E[drawn]. So E[terminal] = E[initial] by');
  console.log('    construction and the AGGREGATE incurred triangle cannot develop, however the');
  console.log('    initial spread is contracted. Contracting buys DISPERSION around the first');
  console.log('    estimate; a chain ladder estimates the MEAN factor, and that is 1.000.');
  console.log('');
  console.log('    The pool\'s own GL factors are 1.872 / 1.439 / 1.265, cumulative ~3.6 — a');
  console.log('    first estimate near a quarter of ultimate. Reproducing that needs');
  console.log('    E[terminal] >> E[initial], which a mean-one law cannot supply.');
  console.log('');
  console.log('  WHAT TURNS IT GREEN, AND IT IS S2 RATHER THAN A PATCH HERE: the synthetic');
  console.log('    history\'s development needs a DRIFT, with the initial estimate scaled down');
  console.log('    by the cumulative factor so the terminal still lands on the fit. That is');
  console.log('    safe in a way the last three attempts were not — this triangle is DATA the');
  console.log('    pool reads, not a ledger it books, so the drift is meant to be visible and');
  console.log('    the error stays on the PICK. It is a new parameter and a ruling, so it is');
  console.log('    not taken here.');
  console.log(RULE);
  process.exitCode = 3;
} else {
  console.log('THE TRIANGLE HOLDS — ragged by construction, developed forward through');
  console.log('claimRevision\'s own law, landing on the severity fit as a TERMINAL target');
  console.log('with the mean preserved, and the incurred triangle genuinely develops.');
  console.log(RULE);
}
