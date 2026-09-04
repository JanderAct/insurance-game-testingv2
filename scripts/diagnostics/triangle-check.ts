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
//   4. THE MEAN IS PRESERVED THROUGH THE DRIFT. A is solved to hold
//      E[TERMINAL] = E[drawn]. The initial is deliberately BELOW the drawn now —
//      by 1/cumulative, so 0.28 on GL — and it develops up; asserting on the
//      initial would fail by exactly that factor and would be asserting the wrong
//      invariant. The triangle is read as a loss cost, so a drift that quietly
//      moved the terminal mean would misprice while every spread statistic still
//      looked right.
//
//   5. FORWARD DEVELOPMENT IS REAL. The incurred triangle must actually develop.
//      On the shipped engine path it does not — age-to-age factors there are
//      0.992-1.002 and a chain ladder returns the truth — and S1's triangle read
//      flat for a different reason: a mean-one law gives E[terminal] = E[initial]
//      whatever the initial spread. TRIANGLE_DEVELOPMENT_DRIFT is what fixed it,
//      and this asserts the fix reaches the walk. The floor is loose because the
//      SIZE is the constant's business; what fails here is a drift that is not
//      being applied at all.
//
// ⚠ IT ASSERTS NOTHING ABOUT PRICING, AND THAT IS THE POINT OF S1. The flag is
// off, no path in src/ consumes a triangle, and both standing gates are
// byte-identical against the parent with no recapture.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { claimTerminalValue, reviseOnce, settlementFactor, type RevisionState } from '../../src/utils/claimRevision';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import {
  ageToAgeFactors, cellAt, cumulativeDevelopment, developmentDrift,
  generateClaimTriangle, initialEstimate,
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
const MEAN_TOL = 0.05;
// Seed families averaged over. The statistics below are value-weighted on a
// heavy tail, so one family is not a measurement — see assertion 3 & 4's note.
const FAMILIES = Number(process.env.FAMILIES ?? 6);

const members = getPredefinedMarketMembers();
const failed: string[] = [];
const RULE = '='.repeat(72);
const note = (ok: boolean, msg: string) => { if (!ok) failed.push(msg); return ok ? 'OK' : '*** FAIL ***'; };
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
            st = { ...st, value: st.value * developmentDrift(line, age) };
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
console.log('  ⚠ AVERAGED ACROSS SEED FAMILIES, AND THE SPREAD IS PRINTED. Both statistics');
console.log('    are value-weighted on a severity with a blended CV near 30, so a single');
console.log('    family swings several percent on nothing — finding 26, which already forced');
console.log('    gl-cutover-check and marketplace-generation-check onto a bounded basis. A');
console.log('    single sample here read 1.055 / 0.926 / 0.964 on the mean and would have');
console.log('    failed a 2% tolerance while the constants were correct.\n');
console.log('  line       k         A       sd(ln terminal) +/- sd   target   mean term/drawn +/- sd');
for (const line of LINES) {
  const { k, A } = TRIANGLE_INITIAL_CONTRACTION[line];
  const pattern = LINE_PAYOUT_PATTERN[line];
  const reps = line === 'Property' ? 30 : line === 'GL' ? 6 : 5;
  const sds: number[] = [], mrs: number[] = [];
  for (let fam = 0; fam < FAMILIES; fam++) {
    const lnT: number[] = [];
    let sumTerm = 0, sumDrawn = 0;
    for (let g = 0; g < reps; g++) {
      const gameId = `SPR${line}${fam}_${g}#tri1`;
      for (let y = 1; y <= 4; y++) {
        const base = { members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 4_300_000 + fam * 131_071 + g * 7919, riskControlEffectiveness: 0 };
        const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
          : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
            : generatePropertyClaims({ ...base, kPr: 1 });
        for (const c of r.claims) {
          const init = initialEstimate(line, c.grossUltimate);
          sumDrawn += c.grossUltimate;
          const curve = resolveClosureCurve(line, c.grossUltimate);
          const u = claimClosureUnit(gameId, c.id);
          let ca = 40;
          for (let t = 1; t <= 40; t++) if (closedShare(curve, t) >= u) { ca = t; break; }
          // The drift is deterministic given the closure age, so the terminal is
          // claimTerminalValue's mean-one walk scaled by the whole cumulative.
          const term = cumulativeDevelopment(line, ca)
            * claimTerminalValue(gameId, c.id, init, ca, undefined,
              age => Math.min(0.999, cumulativePaid(pattern, age)));
          sumTerm += term;
          if (term > 0) lnT.push(Math.log(term));
        }
      }
    }
    sds.push(sd(lnT)); mrs.push(sumTerm / sumDrawn);
  }
  const s0 = mean(sds), mr = mean(mrs), tgt = TERMINAL_TARGET[line];
  console.log(`  ${line.padEnd(9)} ${k.toFixed(6)} ${A.toFixed(4).padStart(8)}  ${s0.toFixed(4).padStart(10)} +/- ${sd(sds).toFixed(4)}  ${tgt.toFixed(3)}   ${mr.toFixed(4).padStart(8)} +/- ${sd(mrs).toFixed(4)}  `
    + `${note(Math.abs(s0 - tgt) <= SD_TOL,
      `${line}: the developed terminal spread is ${s0.toFixed(4)} against a ${tgt} target, off by ${Math.abs(s0 - tgt).toFixed(4)} on a ${SD_TOL} tolerance `
      + '— TRIANGLE_INITIAL_CONTRACTION has drifted from the law it was solved against (phi, the headroom exponent, the settlement level or the drift moved). Re-solve it; do not widen this.')} `
    + `${note(Math.abs(mr - 1) <= MEAN_TOL,
      `${line}: the DEVELOPED terminal averages ${mr.toFixed(4)} of the drawn values against 1.000 (across-family sd ${sd(mrs).toFixed(4)}) — A no longer preserves the mean through the drift, so a triangle read as a loss cost would misprice by that factor`)}`);
}

// ------------------------------------------------ 5. development is real
console.log('\n--- 5. THE INCURRED TRIANGLE ACTUALLY DEVELOPS ---');
console.log('  The shipped ENGINE path reads 0.992-1.002 and a chain ladder returns the');
console.log('  truth. S1\'s triangle read flat too, for a different reason: a mean-one law');
console.log('  gives E[terminal] = E[initial] whatever the initial spread. This asserts');
console.log('  TRIANGLE_DEVELOPMENT_DRIFT reaches the walk.\n');
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
  // ⚠ THE FLOOR IS LOW BECAUSE A SHORT-TAIL LINE CANNOT CLEAR A HIGH ONE.
  // Property's whole target cumulative is 1.25 and 92% of its value is closed by
  // age 4, so its observable six-step aggregate reads 1.08 with the drift working
  // perfectly. A floor at WC's or GL's level would fail Property for being
  // short-tailed. This catches a drift that is not applied; assertion 6 is what
  // pins the SIZE, and only GL has an anchor for that.
  console.log(`  ${' '.repeat(9)}           ${note(cum > 1.05,
    `${line}: the incurred triangle is FLAT — cumulative development ${cum.toFixed(4)} over ${nShow} steps. `
    + 'A chain ladder on it returns the truth and there is nothing for a factor selection to be wrong about. '
    + 'TRIANGLE_DEVELOPMENT_DRIFT is not reaching the walk.')}`);
}

// ------------------------------------------------ 6. GL lands on its own anchor
console.log('\n--- 6. GL\'s CUMULATIVE DEVELOPMENT LANDS ON ITS MEASURED 3.60 ---');
console.log('  1.872 x 1.439 x 1.265 x 1.031 x 1.024 = 3.60, the pool\'s own factors.');
console.log('  Deterministic given the closure ages, so this is an identity, not a sample.');
console.log('  ⚠ WC AND PROPERTY HAVE NO SUCH ANCHOR and are asserted only against the');
console.log('    judgement recorded at the constant — see its note.\n');
console.log('  line     value-weighted full cumulative   target   basis');
{
  const TARGET_CUM: Record<string, number> = { WC: 2.50, GL: 3.60, Property: 1.25 };
  for (const line of LINES) {
    const per: number[] = [];
    const reps = line === 'Property' ? 30 : line === 'GL' ? 8 : 6;
    for (let fam = 0; fam < FAMILIES; fam++) {
    let num = 0, den = 0;
    for (let g = 0; g < reps; g++) {
      const gameId = `CUM${line}${fam}_${g}#tri1`;
      for (let y = 1; y <= 4; y++) {
        const base = { members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 4_500_000 + fam * 131_071 + g * 7919, riskControlEffectiveness: 0 };
        const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
          : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
            : generatePropertyClaims({ ...base, kPr: 1 });
        for (const c of r.claims) {
          const curve = resolveClosureCurve(line, c.grossUltimate);
          const u = claimClosureUnit(gameId, c.id);
          let ca = 60;
          for (let t = 1; t <= 60; t++) if (closedShare(curve, t) >= u) { ca = t; break; }
          num += c.grossUltimate * cumulativeDevelopment(line, ca);
          den += c.grossUltimate;
        }
      }
    }
    per.push(num / den);
    }
    const got = mean(per), want = TARGET_CUM[line];
    console.log(`  ${line.padEnd(9)} ${got.toFixed(3).padStart(20)} +/- ${sd(per).toFixed(3)}   ${want.toFixed(2)}   ${line === 'GL' ? 'MEASURED' : 'judgement'}  `
      + `${note(Math.abs(got / want - 1) <= 0.08,
        `${line}: cumulative development is ${got.toFixed(3)} (across-family sd ${sd(per).toFixed(3)}) against ${want} — TRIANGLE_DEVELOPMENT_DRIFT no longer produces the level it was solved for. `
        + (line === 'GL' ? 'On GL that target is the pool\'s own measured factors and must not be moved to fit the code.' : 'On this line the target is judgement, recorded as such at the constant.'))}`);
  }
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S) — S1's own contract:`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE TRIANGLE HOLDS — ragged by construction, developed forward through');
  console.log('claimRevision\'s own law, landing on the severity fit as a TERMINAL target');
  console.log('with the mean preserved, and the incurred triangle genuinely develops.');
  console.log('');
  console.log('  ⚠ THE WINDOW TAIL IS WC\'s ALONE. GL and Property have 0.1% of value open at');
  console.log('    age 10, so no drift reaches past the window on either — their tail factors');
  console.log('    run 1.0001-1.027 across the whole plausible range of g. Only WC gets a');
  console.log('    structural window error, and its size is CHOSEN, not measured. S5\'s');
  console.log('    selection error carries the other two rather than supplementing them.');
  console.log(RULE);
}
