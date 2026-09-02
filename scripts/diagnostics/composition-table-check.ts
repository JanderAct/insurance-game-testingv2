// ============================================================================
// THE COMPOSITION TABLE — the magnitude law, and the two open-share series.
// A GATE. IT CARRIES A RETRACTION: READ THE SECOND BLOCK BEFORE THE NUMBERS.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/composition-table-check.ts
//   REPS=80 npx tsx scripts/diagnostics/composition-table-check.ts
//
// The law's form was validated on the source by the composition
//
//     movement(age) = magnitude(age) x open share(age)
//
// reproducing the pool's measured movement-by-age series. Both halves of that
// product are needed, and only ONE of them is the revision law's.
//
// ============================================================================
// ⚠ THIS FILE SHIPPED A FINDING THAT WAS AN ARITHMETIC ARTEFACT. RETRACTED HERE.
//
// b206cc6's header said the open-share term was source experience, that the
// model reproduced it at a ratio widening to 2.28x, and that "GL's closure
// curves hold value open far longer than the pool's own claim development did".
// THE MODEL'S CLOSURE CURVES ARE NOT IMPLICATED. There is no closure-curve
// finding and there never was one.
//
// WHAT ACTUALLY HAPPENED. The open-share accumulator read
//
//     if (a + 1 <= closureAge - 1 + 1 && a + 1 <= closureAge) openEnd[a] += ...
//
// in which `closureAge - 1 + 1` is `closureAge`, so both conjuncts are
// `a + 1 <= closureAge` — which for integers is `a < closureAge`, the loop guard
// four lines above. The branch was unconditionally true wherever it was reached.
// `openEnd` was labelled END-of-age and held the START-of-age share, and it was
// then compared against a series measured at the end of each age. The entire
// "widening ratio" was that one-age offset. Corrected, it reads
// 1.00 / 0.99 / 0.99 / 1.07 / 1.27.
//
// AND THE SERIES WAS MIS-LABELLED TOO — it is this model's own earlier reading,
// not the pool's. It is now CLAIM_OPEN_SHARE_MODEL_RECORDED, and its note
// carries how that was settled.
//
// ⚠ WHAT SURVIVES, BECAUSE THE MEASUREMENTS WERE NOT WRONG — THE EXPLANATION WAS.
// Arm 1 and the control arm never read `openEnd`, so the magnitude assertion and
// its resolution statement stand unchanged. The realised-movement numbers stand:
// at the shipped phi the model's value-weighted movement is 9.8 / 8.4 / 6.8 /
// 4.9 / 3.2% against a target of 110 / 65 / 42 / 17 / 6%, and no single phi
// reaches it because the target decays 18.3x across the five ages while the
// model decays 3.0x. What changes is the diagnosis: that gap is NOT the exposure
// term being short.
//
// ============================================================================
// WHAT IS OPEN, STATED SO IT IS NOT RE-DISCOVERED AS A SURPRISE.
//
// With the ages aligned, the composition tracks the way it was briefed to:
// count-weighted magnitude x leaving open share gives 84 / 50 / 30 / 17 / 8
// against the target's 110 / 65 / 42 / 17 / 6 — about a quarter low at ages 1-3
// and on target after.
//
// THE REMAINING GAP IS BETWEEN THAT COMPOSITION AND THE LAW'S REALISED MOVEMENT:
// 84% against 9.8% at age 1. The composition is a statement about the law's
// PARAMETERS; the realised movement is what the law actually does, and between
// them sit the frequency q = 0.70, phi = 0.63, the fact that E|X-1| for a
// mean-one lognormal is below its log-sigma, and the count-versus-value
// weighting. That stack is the next question after the engine wiring. It is NOT
// what this file asserts and nothing here fails on it.
//
// ============================================================================
// WHAT IS ASSERTED: THE HALF THAT IS THE LAW'S OWN.
//
// The realised, count-weighted revision magnitude must reproduce 200/(age+1).
// That is a statement about claimRevision.ts and nothing else — it does not
// touch closure, payment or the target series — and it is the one thing in the
// composition this model is entitled to be held to.
//
//   LEVEL   realised / (200/(age+1)) in [0.85, 1.00] at every age. Bounded ABOVE
//           by 1 by construction: the law takes min(age curve, size trend), so
//           the realised magnitude can only sit at or below the age curve. The
//           0.85 floor is what says the size trend is not swallowing the age
//           law — count-weighted it currently binds on 3-7% of the magnitude.
//   SHAPE   the age-to-age decay ratio matches the age curve's within 0.03. This
//           is the stronger arm: a wrong NUMERATOR shifts the level and leaves
//           the shape, a wrong CURVE moves the shape.
//
// ============================================================================
// GL ONLY, AND THE OTHER TWO LINES ARE REPORTED RATHER THAN GATED.
//
// The target is GL experience. WC and Property have no movement-by-age series of
// their own, so holding them to this one would be asserting a carried-across
// number — the same thing the anchor's note refuses for the emergent SD, and
// the same shape as this project's four full-market/enrolled basis errors. One
// honest assertion beats three where two are inherited. The other two lines are
// printed so a reader can see what the law does on them; nothing below fails on
// their account.
// ============================================================================

import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { reviseOnce, revisionMagnitudeOnIncurred, type RevisionState } from '../../src/utils/claimRevision';
import {
  CLAIM_MOVEMENT_BY_AGE_TARGET, CLAIM_OPEN_SHARE_MODEL_RECORDED, CLAIM_REVISION_MAGNITUDE_NUMERATOR,
  CLAIM_REVISION_PHI, CLAIM_REVISION_SIZE_TREND, LINE_PAYOUT_PATTERN, resolveClosureCurve,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const YEARS = Number(process.env.YEARS ?? 10);
const REPS = Number(process.env.REPS ?? 40);
const AGES = 5;
const MAX_AGE = 40;

// TOL_SHAPE is on the age-to-age decay RATIO, so it is dimensionless and the
// same number means the same thing at every age.
//
// ⚠ SIZED ABOVE THE ESTIMATOR AND BELOW THE EFFECT, both stated — the pattern
// from opening-centring-check, whose 15% draft was 1.4-3.0 SE and would have
// flapped. THE NOISE: the realised magnitude is a count-weighted mean over
// ~10,000 claims x REPS replicates and its replicate SE is 0.0001 in magnitude
// terms (printed per age below), which puts the SE on a decay RATIO under
// 0.0005 — so 0.03 is more than 50 SE and cannot flap on noise. THE EFFECT: the
// control arm below removes the age law and moves the first decay ratio from
// 0.683 to 0.982, ten times this tolerance. Between those two the number is not
// delicate. What it is NOT sized for is a defect that shows only at age 4, and
// the control's own resolution line below says so rather than leaving it
// implied.
const TOL_SHAPE = Number(process.env.TOL_SHAPE ?? 0.03);
const LEVEL_FLOOR = 0.85;

const failed: string[] = [];
const RULE = '='.repeat(72);
const members = getPredefinedMarketMembers();

interface Entry { value: number; id: string }

function register(line: CoverageLine, seed: number): Entry[] {
  const out: Entry[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const base = { members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: seed, riskControlEffectiveness: 0 };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
        : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) out.push({ value: c.grossUltimate, id: c.id });
  }
  return out;
}

interface Reading {
  /** Count-weighted realised magnitude at each age — the law's own term. */
  magnitude: number[];
  /** Value-weighted open share ENTERING age a — open at the start of the year. */
  openStart: number[];
  /** Value-weighted open share LEAVING age a — still open at the start of a+1.
   *  openEnd[a] === openStart[a+1] identically, and the gate asserts it. */
  openEnd: number[];
  /** Value-weighted |movement| / cohort incurred at each age. */
  movement: number[];
  /** Same, count-weighted as mean |delta| / the claim's own value. */
  movementCw: number[];
}

/** One replicate over one register. `sizeOnly` is the control arm. */
function walk(line: CoverageLine, reg: Entry[], gameId: string, phi: number, sizeOnly: boolean): Reading {
  const pattern = LINE_PAYOUT_PATTERN[line];
  const paidShareAt = (a: number) => Math.min(0.999, cumulativePaid(pattern, a));
  const total = reg.reduce((a, c) => a + c.value, 0);
  const mag = new Array(AGES + 1).fill(0), cnt = new Array(AGES + 1).fill(0);
  const openStart = new Array(AGES + 2).fill(0), openEnd = new Array(AGES + 2).fill(0);
  const move = new Array(AGES + 1).fill(0);
  const moveCw = new Array(AGES + 1).fill(0);

  for (const c of reg) {
    const curve = resolveClosureCurve(line, c.value);
    const u = claimClosureUnit(gameId, c.id);
    let closureAge = MAX_AGE;
    for (let t = 1; t <= MAX_AGE; t++) if (closedShare(curve, t) >= u) { closureAge = t; break; }
    let st: RevisionState = { value: c.value, paidShare: 0, lastSign: 0 };
    for (let a = 1; a <= AGES; a++) {
      if (a >= closureAge) break;
      // The magnitude the law would apply at this age to this claim.
      const m = sizeOnly
        // CONTROL: the size trend ALONE, i.e. the age law removed. It needs no
        // mutation of a constant — the same inputs, one term of the min dropped.
        ? CLAIM_REVISION_SIZE_TREND.scale * Math.pow(Math.max(1, st.value), CLAIM_REVISION_SIZE_TREND.exponent)
        : revisionMagnitudeOnIncurred(a, st.value);
      mag[a] += m; cnt[a] += 1;
      openStart[a] += c.value;
      const before = st.value;
      st = { ...st, paidShare: paidShareAt(a) };
      st = reviseOnce(gameId, c.id, a, st, phi);
      move[a] += Math.abs(st.value - before);
      moveCw[a] += Math.abs(st.value - before) / Math.max(1, before);
      // ⚠ `a + 1 < closureAge`, AND THE STRICT INEQUALITY IS THE WHOLE FIX.
      // This read `a + 1 <= closureAge - 1 + 1 && a + 1 <= closureAge`, in which
      // `closureAge - 1 + 1` is `closureAge`, so both conjuncts were
      // `a + 1 <= closureAge` — which for integers is `a < closureAge`, the loop
      // guard four lines up. The branch was unconditionally true wherever it was
      // reached, so `openEnd` was labelled end-of-age and held the START-of-age
      // share. See the retraction in this file's header.
      if (a + 1 < closureAge) openEnd[a] += c.value;
    }
  }
  return {
    magnitude: mag.map((v, i) => (cnt[i] ? v / cnt[i] : 0)),
    openStart: openStart.map(v => v / total),
    openEnd: openEnd.map(v => v / total),
    movement: move.map(v => v / total),
    movementCw: moveCw.map((v, i) => (cnt[i] ? v / cnt[i] : 0)),
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const se = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) / Math.sqrt(xs.length);
};

function aggregate(line: CoverageLine, phi: number, sizeOnly = false) {
  const reg = register(line, 61_000_000);
  const runs = Array.from({ length: REPS }, (_, r) => walk(line, reg, `CTC${r}`, phi, sizeOnly));
  const at = (pick: (x: Reading) => number[], a: number) => runs.map(x => pick(x)[a]);
  return { reg, runs, at };
}

console.log('=== THE COMPOSITION TABLE — magnitude x open share ===');
console.log(`${YEARS} years x ${REPS} gameId replicates on a fixed register, phi = ${CLAIM_REVISION_PHI}`);
console.log('Model age = data age - 1. GL is ASSERTED; WC and Property are REPORTED only.\n');

// ---------------------------------------------------------------- GL, asserted
const gl = aggregate('GL', CLAIM_REVISION_PHI);
const ageCurve = (a: number) => CLAIM_REVISION_MAGNITUDE_NUMERATOR / (a + 1);

console.log('--- 1. THE LAW\'S OWN TERM: realised magnitude against 200/(age+1) [GL, ASSERTED] ---');
console.log('  age   age curve   realised (count-wtd)      level      decay ratio   curve\'s   diff');
const realised: number[] = [], realisedSe: number[] = [];
for (let a = 1; a <= AGES; a++) {
  const xs = gl.at(r => r.magnitude, a);
  realised.push(mean(xs)); realisedSe.push(se(xs));
}
for (let a = 1; a <= AGES; a++) {
  const level = realised[a - 1] / ageCurve(a);
  const dr = a > 1 ? realised[a - 1] / realised[a - 2] : NaN;
  const cr = a > 1 ? ageCurve(a) / ageCurve(a - 1) : NaN;
  console.log(`   ${a}      ${(100 * ageCurve(a)).toFixed(1).padStart(5)}%       ${(100 * realised[a - 1]).toFixed(1).padStart(5)}% +/- ${(100 * realisedSe[a - 1]).toFixed(2)}      ${level.toFixed(3)}`
    + (a > 1 ? `      ${dr.toFixed(3)}       ${cr.toFixed(3)}    ${(dr - cr >= 0 ? '+' : '') + (dr - cr).toFixed(3)}` : '          —           —        —'));
  if (level > 1.0001) {
    failed.push(`GL age ${a}: realised magnitude ${(100 * realised[a - 1]).toFixed(1)}% EXCEEDS the age curve's `
      + `${(100 * ageCurve(a)).toFixed(1)}%. The law takes min(age, size), so this is impossible unless the combine rule changed.`);
  }
  if (level < LEVEL_FLOOR) {
    failed.push(`GL age ${a}: realised magnitude is ${level.toFixed(3)} of the age curve, under the ${LEVEL_FLOOR} floor — `
      + 'the size trend is swallowing the age law. Check CLAIM_REVISION_SIZE_TREND.scale before touching this bound.');
  }
  if (a > 1 && Math.abs(dr - cr) > TOL_SHAPE) {
    failed.push(`GL age ${a - 1}->${a}: the realised decay ratio is ${dr.toFixed(3)} against the age curve's `
      + `${cr.toFixed(3)}, off by ${(dr - cr).toFixed(3)} over a ${TOL_SHAPE} tolerance. The magnitude law's SHAPE is `
      + 'not in force; a level shift would leave this arm alone, so this is the curve and not the numerator.');
  }
}

// ---------------------------------------------------------------- control arm
console.log('');
console.log('--- 2. CONTROL ARM: the age law removed, size trend alone [GL] ---');
const ctl = aggregate('GL', CLAIM_REVISION_PHI, true);
const ctlMag: number[] = [];
for (let a = 1; a <= AGES; a++) ctlMag.push(mean(ctl.at(r => r.magnitude, a)));
console.log('  age   size-trend-only magnitude   decay ratio   age curve\'s   |diff|');
let controlBroke = 0;
const ctlDiffs: number[] = [];
for (let a = 1; a <= AGES; a++) {
  const dr = a > 1 ? ctlMag[a - 1] / ctlMag[a - 2] : NaN;
  const cr = a > 1 ? ageCurve(a) / ageCurve(a - 1) : NaN;
  if (a > 1) { ctlDiffs.push(Math.abs(dr - cr)); if (Math.abs(dr - cr) > TOL_SHAPE) controlBroke++; }
  console.log(`   ${a}          ${(100 * ctlMag[a - 1]).toFixed(1).padStart(5)}%`
    + (a > 1 ? `                ${dr.toFixed(3)}        ${cr.toFixed(3)}       ${Math.abs(dr - cr).toFixed(3)}`
      + `   ${Math.abs(dr - cr) > TOL_SHAPE ? `BREAKS (${(Math.abs(dr - cr) / TOL_SHAPE).toFixed(1)}x TOL)` : 'inside TOL'}`
      : '                  —            —           —'));
}
console.log('');
console.log(`  ⚠ THE ARM'S RESOLUTION, STATED RATHER THAN ASSUMED: the control breaks ${controlBroke} of the`);
console.log(`    ${ctlDiffs.length} decay ratios, at ${ctlDiffs.map(d => (d / TOL_SHAPE).toFixed(1) + 'x').join(' / ')} of tolerance. It is decisive at`);
console.log('    the EARLY ages, where the age curve falls fastest, and NOT at 3->4, where the');
console.log('    size trend happens to decay at nearly the same rate. So arm 1 resolves a broken');
console.log('    age law through ages 1-3 and would NOT catch one that failed only at age 4.');
if (controlBroke === 0) {
  failed.push('CONTROL: removing the age law entirely leaves EVERY decay ratio inside the tolerance, so arm 1 would '
    + 'pass with no age curve in force and asserts nothing. Tighten TOL_SHAPE or the arm is decorative.');
}

// ------------------------------------------------- the two open-share series
//
// ⚠ THIS ARM EXISTS BECAUSE NEITHER A COMMENT NOR LINT WOULD HAVE CAUGHT THE
// DEFECT IT REPLACES. The condition behind b206cc6's retracted finding was
// `a + 1 <= closureAge - 1 + 1 && a + 1 <= closureAge` — two textually different
// conjuncts that both reduce to the loop guard. TESTED, so the next reader does
// not reach for the wrong tool: `no-constant-binary-expression` and
// `no-constant-condition` both return ZERO messages on that exact expression,
// because neither operand is constant and the two sides are not textually
// identical. There is no rule to switch on.
//
// THE PROPERTY IS AN EXACT IDENTITY, WHICH IS WHY IT IS CHEAPER THAN ANY
// THRESHOLD. A claim open at the END of age a is exactly a claim open at the
// START of age a+1, so openEnd[a] === openStart[a+1] to the cent — no tolerance,
// no sample size, no noise budget. A reintroduced tautology collapses openEnd
// onto openStart and breaks it at every age at once.
//
// The strict-decrease arm sits beside it because the identity alone would still
// hold if BOTH series were computed wrongly in the same way. Claims close during
// a year, so the share leaving must be strictly below the share entering. Two
// cheap assertions covering the two ways this can go wrong.
//
// CAN-FAIL, MEASURED: restoring the b206cc6 condition produces 9 FAILURES —
// both arms, at every age.
console.log('');
console.log('--- 3. THE TWO OPEN-SHARE SERIES, AND THE IDENTITY BETWEEN THEM [ASSERTED] ---');
console.log('  age   entering (vw)   leaving (vw)   leaving[a] vs entering[a+1]');
for (let a = 1; a <= AGES; a++) {
  const os = mean(gl.at(r => r.openStart, a));
  const oe = mean(gl.at(r => r.openEnd, a));
  const nextStart = mean(gl.at(r => r.openStart, a + 1));
  const gap = Math.abs(oe - nextStart);
  console.log(`   ${a}       ${(100 * os).toFixed(1).padStart(5)}%         ${(100 * oe).toFixed(1).padStart(5)}%          `
    + `${a < AGES ? `${(100 * nextStart).toFixed(1).padStart(5)}%   diff ${(100 * gap).toFixed(4)}pp` : '— (a+1 beyond the window)'}`);
  if (!(oe < os)) {
    failed.push(`age ${a}: the LEAVING open share ${(100 * oe).toFixed(1)}% is not strictly below the ENTERING `
      + `share ${(100 * os).toFixed(1)}%. Claims close during a year, so it must be. Equality is the signature of `
      + 'the b206cc6 defect — an end-of-age condition that reduces to the loop guard.');
  }
  if (a < AGES && gap > 1e-9) {
    failed.push(`age ${a}: openEnd[${a}] = ${(100 * oe).toFixed(4)}% but openStart[${a + 1}] = `
      + `${(100 * nextStart).toFixed(4)}%, differing by ${(100 * gap).toFixed(6)}pp. These are the same set of `
      + 'claims by definition and must agree exactly; a gap means one of the two conditions is wrong.');
  }
}

// ---------------------------------------------------------------- the target
console.log('');
console.log('--- 4. THE MOVEMENT TARGET [GL, REPORTED — see this file\'s header] ---');
console.log('  age   model leaving (vw)   recorded model   ratio      model movement (vw)   target');
for (let a = 1; a <= AGES; a++) {
  const oe = mean(gl.at(r => r.openEnd, a));
  const mv = mean(gl.at(r => r.movement, a));
  const rec = CLAIM_OPEN_SHARE_MODEL_RECORDED[a - 1];
  console.log(`   ${a}        ${(100 * oe).toFixed(1).padStart(5)}%             ${(100 * rec).toFixed(1).padStart(5)}%      ${(oe / rec).toFixed(2)}          `
    + `${(100 * mv).toFixed(1).padStart(5)}%           ${(100 * CLAIM_MOVEMENT_BY_AGE_TARGET[a - 1]).toFixed(0).padStart(4)}%`);
}
console.log('');
console.log('  ⚠ THE MIDDLE COLUMN IS A REGRESSION REFERENCE, NOT AN EXTERNAL ANCHOR. It is');
console.log('    this model\'s own earlier reading of the same quantity — see the constant\'s');
console.log('    note. A ratio near 1 says the model has not moved; it says nothing about the');
console.log('    pool. b206cc6 read this column as source data and published a closure-curve');
console.log('    finding that does not exist.');

console.log('');
console.log('--- 5. NO SINGLE phi REACHES THE TARGET — a shape mismatch, not a level one ---');
console.log('   phi    model movement by age (vw)                target decay   model decay');
for (const phi of [CLAIM_REVISION_PHI, 1.0, 2.0]) {
  const g = aggregate('GL', phi);
  const mv = Array.from({ length: AGES }, (_, i) => mean(g.at(r => r.movement, i + 1)));
  const tDecay = CLAIM_MOVEMENT_BY_AGE_TARGET[0] / CLAIM_MOVEMENT_BY_AGE_TARGET[AGES - 1];
  console.log(`  ${phi.toFixed(2).padStart(5)}   ${mv.map(v => (100 * v).toFixed(1).padStart(5) + '%').join(' ')}        ${tDecay.toFixed(1)}x         ${(mv[0] / mv[AGES - 1]).toFixed(1)}x`);
}

// ---------------------------------------------------------------- other lines
console.log('');
console.log('--- 6. WC AND PROPERTY [REPORTED, NOT GATED — the target is GL experience] ---');
console.log('  line       realised magnitude by age (count-wtd)         movement by age (vw)');
for (const line of ['WC', 'Property'] as CoverageLine[]) {
  const L = aggregate(line, CLAIM_REVISION_PHI);
  const mg = Array.from({ length: AGES }, (_, i) => mean(L.at(r => r.magnitude, i + 1)));
  const mv = Array.from({ length: AGES }, (_, i) => mean(L.at(r => r.movement, i + 1)));
  console.log(`  ${line.padEnd(9)}  ${mg.map(v => (100 * v).toFixed(1).padStart(5) + '%').join(' ')}     ${mv.map(v => (100 * v).toFixed(1).padStart(5) + '%').join(' ')}`);
}
console.log('  Nothing above can fail this gate. Neither line has a movement-by-age series of');
console.log('  its own, and holding them to GL\'s would assert a carried-across number.');

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE MAGNITUDE LAW IS IN FORCE — GL\'s realised magnitude tracks 200/(age+1) in');
  console.log('both level and decay shape, and the control arm confirms that removing the age');
  console.log('law breaks the shape. The movement target is REPORTED, not asserted: its');
  console.log('exposure term is GL\'s closure curves and they are the short side.');
  console.log(RULE);
}
