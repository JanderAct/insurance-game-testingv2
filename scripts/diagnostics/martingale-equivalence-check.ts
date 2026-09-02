// ============================================================================
// MARTINGALE EQUIVALENCE — DECOMPOSED, NOT TOTALLED. A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/martingale-equivalence-check.ts
//   REG=16 REPS=80 npx tsx scripts/diagnostics/martingale-equivalence-check.ts
//
// The requirement: with bookingBias forced to zero, a cohort's expected
// ultimate at maturity equals what it booked at inception. The per-claim
// revision law has to deliver that from two terms that pull in opposite
// directions, and the whole point of this file is that it reports them
// SEPARATELY WITH THEIR OWN INTERVALS.
//
//   PERSISTENCE   sum(carried at closure) / sum(drawn).  Sign persistence makes
//                 each step conditionally non-mean-one, so a runoff drifts UP.
//   SETTLEMENT    E[settlement factor], whose LEVEL is solved to pay that back.
//   TOTAL         their product, which is the martingale statement.
//
// ⚠ A TOTAL NEAR ZERO FROM TWO LARGE OFFSETTING TERMS IS THE FAILURE MODE THIS
// PROJECT KEEPS HITTING, which is why the total is never reported alone. If
// persistence were +15% and settlement -13%, the total would look fine and both
// halves would be wrong. Each term is asserted against its own bound.
//
// ============================================================================
// ⚠ THE ESTIMATOR IS PAIRED, AND WITHOUT THAT THIS TEST CANNOT RESOLVE ITS OWN
// SUBJECT. THIS IS THE LOAD-BEARING METHODOLOGICAL NOTE IN THE FILE.
//
// The obvious design is to play many games and take sum(terminal)/sum(drawn).
// MEASURED, and it does not work: GL's severity has a log-SD of 2.17 under a
// $100M cap, so a value-weighted ratio is dominated by a handful of claims per
// game. Two INDEPENDENT bases of 1.55 million claims each (150 games x 10 years)
// read 0.802128 and 0.812052 — a 1.24% disagreement on a statistic being held to
// 1% — and the persistence term flipped sign between them, 0.999813 against
// 1.006042. Raising the sample cannot fix that at a practical cost: the noise is
// the claim MIX, and it falls as 1/sqrt(games).
//
// SO THE REGISTER IS FIXED AND THE gameId VARIES. Every replicate revises THE
// SAME CLAIMS, so the mix cancels and what is left is the law's own noise. At 8
// registers x 40 replicates — about 82,000 claim-walks, a twentieth of the
// unpaired compute — the persistence SE is 0.00126 against the unpaired 0.0063.
// A 5x tighter interval for a twentieth of the work, because it is measuring the
// right thing.
//
// This is the same lesson as "shock and no-shock runs on the same seed are NOT
// paired", inverted: there the pairing was impossible because the draw counts
// diverged, here it is available because the register is an input.
//
// ⚠ AND THE TWO SPREADS ARE BOTH REPORTED, because they answer different
// questions. The WITHIN-register SE is the law's noise and is what the assertion
// is sized against. The ACROSS-register spread is the mix's, and it is what a
// single game will actually show a player — a cohort can miss its booked
// ultimate by several percent and the law still be a martingale.
//
// ============================================================================
// WHY THIS IS TABLE-INDEPENDENT BY CONSTRUCTION, which will look wrong given
// the CLF tables have not been re-derived.
//
// bookingBias is zero exactly when the line funds at or above break-even, and
// funding-at-expected pins selectedFundingCLF at 1.000 — which d8736ab now
// asserts against the engine's own stored field on all three lines across all 14
// reachable confidence levels, with a flag-off control arm. So "bias zero" does
// not depend on which CLF table is in force, and neither does anything below:
// this file runs the claim generator and the revision law and reads no premium,
// no CLF and no funding decision at all.
// ============================================================================

import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { reviseOnce, settlementFactor, settlementFactorMean, type RevisionState } from '../../src/utils/claimRevision';
import {
  CLAIM_REVISION_PHI, CLAIM_SETTLEMENT_FACTOR, LINE_PAYOUT_PATTERN, resolveClosureCurve,
} from '../../src/data/defaultAssumptions';

// ⚠ SIZED SO THE ESTIMATOR'S OWN NOISE CLEARS THE TOLERANCE, AND THE FIRST
// DRAFT OF THIS FILE DID NOT. At 8 x 40 the total read 1.00127 with an SE of
// 0.01431 — it PASSED a 1% tolerance while its own interval was 1.4x that
// tolerance wide, which is the exact defect WORKING_PRACTICES records from
// opening-centring-check. Measured sizing:
//   8 x 40      SE 0.01431   0.7 x TOL   24s     flaps
//   16 x 120    SE 0.00364   2.7 x TOL   141s
//   24 x 200    SE 0.00205   4.9 x TOL   348s    <- shipped
// The persistence term needed the same treatment for a different reason: at
// 8 x 40 it read 1.00082 +/- 0.00126 and looked like zero drift, and at 24 x 200
// it resolves to 1.00460 +/- 0.00065. The settlement level is solved against
// that second figure.
const REG = Number(process.env.REG ?? 24);
const REPS = Number(process.env.REPS ?? 200);
const YEARS = Number(process.env.YEARS ?? 10);
const MAX_AGE = 40;

// TOL is 1% of booked ultimate on the TOTAL, per the ruling. The per-term
// bounds are looser because each term is legitimately non-zero — persistence is
// SUPPOSED to drift up and settlement is SUPPOSED to sit below one — so what is
// asserted per term is that neither is LARGE, i.e. that the total is not a
// cancellation of two big numbers.
const TOL_TOTAL = Number(process.env.TOL ?? 0.01);
const MAX_TERM = 0.05;

const failed: string[] = [];
const RULE = '='.repeat(72);

const members = getPredefinedMarketMembers();
const pattern = LINE_PAYOUT_PATTERN.GL;
/** The claim's cohort's paid share. NO claim draws its own schedule — see
 *  claimClosure.ts's prohibition, which this file does not breach. */
const paidShareAt = (age: number) => Math.min(0.999, cumulativePaid(pattern, age));

interface Entry { value: number; id: string }

function register(seedIndex: number): Entry[] {
  const out: Entry[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const r = generateGlClaims({
      members, yearNumber: y, calendarYear: 2025 + y,
      instanceSeed: 61_000_000 + seedIndex * 104729, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
    });
    for (const c of r.claims) out.push({ value: c.grossUltimate, id: c.id });
  }
  return out;
}

function replicate(reg: Entry[], gameId: string): { persistence: number; total: number } {
  let drawn = 0, carried = 0, terminal = 0;
  for (const c of reg) {
    const curve = resolveClosureCurve('GL', c.value);
    const u = claimClosureUnit(gameId, c.id);
    let closureAge = MAX_AGE;
    for (let t = 1; t <= MAX_AGE; t++) if (closedShare(curve, t) >= u) { closureAge = t; break; }
    let st: RevisionState = { value: c.value, paidShare: 0, lastSign: 0 };
    for (let a = 1; a < closureAge; a++) {
      st = { ...st, paidShare: paidShareAt(a) };
      st = reviseOnce(gameId, c.id, a, st, CLAIM_REVISION_PHI);
    }
    drawn += c.value;
    carried += st.value;
    terminal += st.value * settlementFactor(gameId, c.id);
  }
  return { persistence: carried / drawn, total: terminal / drawn };
}

const stat = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  return { m, sd, se: sd / Math.sqrt(xs.length) };
};

console.log('=== MARTINGALE EQUIVALENCE — decomposed, with the paired estimator ===');
console.log(`${REG} registers x ${REPS} gameId replicates x ${YEARS} years, bookingBias identically zero.`);
console.log(`phi = ${CLAIM_REVISION_PHI}, settlement nonZeroScale = ${CLAIM_SETTLEMENT_FACTOR.nonZeroScale}\n`);

const regs = Array.from({ length: REG }, (_, i) => register(i));
const claimWalks = regs.reduce((a, r) => a + r.length, 0) * REPS;

console.log('  reg   claims     persistence (mean +/- se)     total (mean +/- se)');
const regP: number[] = [], regT: number[] = [];
const withinSeP: number[] = [], withinSeT: number[] = [];
for (let s = 0; s < REG; s++) {
  const ps: number[] = [], ts: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const v = replicate(regs[s], `MEC${s}_${r}`);
    ps.push(v.persistence); ts.push(v.total);
  }
  const P = stat(ps), T = stat(ts);
  regP.push(P.m); regT.push(T.m);
  withinSeP.push(P.se); withinSeT.push(T.se);
  console.log(`  ${String(s).padStart(3)}  ${String(regs[s].length).padStart(7)}     ${P.m.toFixed(5)} +/- ${P.se.toFixed(5)}        ${T.m.toFixed(5)} +/- ${T.se.toFixed(5)}`);
}

const P = stat(regP), T = stat(regT);
const settleMean = settlementFactorMean();

console.log('');
console.log('--- THE DECOMPOSITION, WHICH IS THE POINT OF THIS FILE ---');
console.log('  term                                       value        interval        bound');
console.log(`  PERSISTENCE  sum(carried)/sum(drawn)       ${P.m.toFixed(5)}    +/- ${P.se.toFixed(5)}     |drift| < ${MAX_TERM}`);
console.log(`  SETTLEMENT   E[factor], closed form        ${settleMean.toFixed(5)}    exact           |drift| < ${MAX_TERM}`);
console.log(`  TOTAL        sum(terminal)/sum(drawn)      ${T.m.toFixed(5)}    +/- ${T.se.toFixed(5)}     |drift| < ${TOL_TOTAL}`);
console.log('');
console.log(`  claim-walks           ${claimWalks.toLocaleString()}`);
console.log(`  WITHIN-register SE    persistence ${stat(withinSeP).m.toFixed(5)}   total ${stat(withinSeT).m.toFixed(5)}   <- the LAW's noise, what the bounds are sized against`);
console.log(`  ACROSS-register sd    persistence ${P.sd.toFixed(5)}   total ${T.sd.toFixed(5)}   <- the MIX's, what one game shows a player`);
console.log('');

// ---------------------------------------------------------------- assertions
if (Math.abs(P.m - 1) > MAX_TERM) {
  failed.push(`PERSISTENCE drifts ${((P.m - 1) * 100).toFixed(3)}% (+/- ${(P.se * 100).toFixed(3)}pp), over the ${MAX_TERM * 100}% per-term bound. `
    + 'A large persistence term offset by a large settlement term reads as a passing total and is not one.');
}
if (Math.abs(settleMean - 1) > MAX_TERM) {
  failed.push(`SETTLEMENT mean is ${settleMean.toFixed(5)}, over the ${MAX_TERM * 100}% per-term bound. `
    + 'CLAIM_SETTLEMENT_FACTOR.nonZeroScale is solved against the persistence term; if that term is small, this must be near one.');
}
if (Math.abs(T.m - 1) > TOL_TOTAL) {
  failed.push(`THE COHORT IS NOT A MARTINGALE: sum(terminal)/sum(drawn) = ${T.m.toFixed(5)}, drift `
    + `${((T.m - 1) * 100).toFixed(3)}% against a ${TOL_TOTAL * 100}% tolerance. Re-solve `
    + `CLAIM_SETTLEMENT_FACTOR.nonZeroScale as 1 / (persistence x shape mean) = `
    + `${(1 / (P.m * settlementFactorMean(1))).toFixed(6)}; do not widen the tolerance.`);
}

// ---------------------------------------------------------------- control arm
//
// ⚠ THE CONTROL: the bounds above are worthless if the statistic reads ~1 no
// matter what the law does. Two arms, both of which MUST move it off one.
console.log('--- CONTROL ARM: the statistic must be capable of reading off one ---');
const offScale = stat(regs.map((r, s) => {
  let drawn = 0, terminal = 0;
  for (const c of r) {
    const curve = resolveClosureCurve('GL', c.value);
    const u = claimClosureUnit(`CTL${s}`, c.id);
    let ca = MAX_AGE;
    for (let t = 1; t <= MAX_AGE; t++) if (closedShare(curve, t) >= u) { ca = t; break; }
    let st: RevisionState = { value: c.value, paidShare: 0, lastSign: 0 };
    for (let a = 1; a < ca; a++) { st = { ...st, paidShare: paidShareAt(a) }; st = reviseOnce(`CTL${s}`, c.id, a, st, CLAIM_REVISION_PHI); }
    drawn += c.value;
    // the FITTED settlement shape at its own level — i.e. the mean NOT derived
    terminal += st.value * settlementFactor(`CTL${s}`, c.id, 1);
  }
  return terminal / drawn;
})).m;
console.log(`  settlement at the FITTED level (scale 1, mean ${settlementFactorMean(1).toFixed(4)}):  total ${offScale.toFixed(5)}`);
if (Math.abs(offScale - 1) <= TOL_TOTAL) {
  failed.push('CONTROL: the total reads within tolerance even with the settlement level left at its FITTED value, '
    + 'whose mean is 0.808. The statistic is therefore not sensitive to the level it is supposed to be solving, '
    + 'and the martingale assertion above proves nothing.');
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('MARTINGALE EQUIVALENCE HOLDS, and it holds TERM BY TERM rather than');
  console.log('as a total: neither the persistence drift nor the settlement mean is large,');
  console.log('so the near-one total is not two big numbers cancelling.');
  console.log(RULE);
}
