// ============================================================================
// SIGN PERSISTENCE — rho, ASSERTED. A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/revision-persistence-check.ts
//   REPS=2 npx tsx scripts/diagnostics/revision-persistence-check.ts
//
// ============================================================================
// WHY THIS EXISTS, AND IT IS A DEFECT THAT ALREADY HAPPENED.
//
// The first cut of reviseDevelopingSet passed `lastSign: 0` into every step.
// That makes reviseOnce take its FIRST-SIGN branch every time — a fair coin —
// so rho was zero at every step while CLAIM_REVISION_PERSISTENCE_RHO went on
// reading 0.18. Nothing caught it and nothing could have: persistence lives
// ENTIRELY in the autocorrelation of successive signs. It does not move a
// cohort total, a mean, an SD, or a martingale test, because a run of same-sign
// moves and an alternating pair of the same magnitudes reach the same place.
// The call site was fixed with signBefore. Nothing stopped the same silent
// zeroing coming back through the next refactor of it. This does.
//
// ============================================================================
// WHAT IS ASSERTED, AND WHY IT IS MEASURED AT A PROBE phi.
//
// The target is the source's own: successive revisions on the same claim share
// a sign 59% of the time, against 50% for independence, which is exactly
// (1 + rho)/2 at rho = 0.18. See CLAIM_REVISION_PERSISTENCE_RHO.
//
// The only thing reviseDevelopingSet hands back is a DELTA, and at the shipped
// phi the delta's sign is not the chain's sign. The factor is
// exp(sign.s.|Z| - s^2/2), so a POSITIVE sign still produces a negative delta
// whenever |Z| < s/2 — the mean-one correction. At the shipped phi that is a
// quarter to a half of all positive-sign steps, and the misreading is not
// symmetric: it turns the movement direction into a marginally biased coin,
// which is same-signed more often than a fair one for reasons that have nothing
// to do with rho. Section 3 measures exactly that and shows how large it is.
//
// So the chain is read at a PROBE phi of 0.005, where s is small enough that
// P(|Z| > s/2) exceeds 0.998 and the delta's sign IS the chain's sign. This is
// not a different mechanism: phi is a pure SCALE on the magnitude and the sign
// draw does not read it. Turning the scale down makes the same chain legible;
// it does not make a new one. Section 1 asserts the probe is faithful by
// checking the marginal share of upward moves is 50% — the chain is stationary
// at 1/2, so a probe that reads anything else is not reading the chain.
//
// ⚠ IT RUNS THROUGH reviseDevelopingSet, ONE AGE AT A TIME, WHICH IS THE POINT.
// Reading signBefore directly would assert that signBefore is correct — it was
// never the thing that broke. The defect was at the CALL SITE, so the walk below
// calls the engine's entry point once per age with the whole tracked set, the
// same way processIbner does, and reads the chain out of what comes back.
//
// ============================================================================
// POWER, BECAUSE A 9-POINT GAP ON A BINARY IS NOT A LARGE EFFECT.
//
// The same-sign indicators are i.i.d. Bernoulli: each transition consumes its
// own hash, so pairs do not share randomness and the binomial SE is exact
// rather than a lower bound. At p = 0.59 the SE is sqrt(0.2419/n).
//
// TOLERANCE ±2.0 POINTS, chosen against both ends. For the tolerance to be 4 SE
// — so a healthy run essentially never trips it — n must be at least
// 0.2419/(0.005^2) = 9,676 pairs per line. This gate collects roughly 40,000,
// giving SE ~0.25 points, so the tolerance is ~8 SE wide and independence at
// 50% sits ~36 SE below the target. An underpowered arm would reproduce the
// defect it exists to catch, which is why the pair counts are printed.
//
// ============================================================================
// THE CONTROL ARM, per d8736ab: the constant must be shown to be DOING
// something. rho = 0 is passed through the same call path and must collapse the
// rate to 1/2 and break the section 1 tolerance. `rho` is a parameter on
// reviseOnce/signBefore/reviseDevelopingSet for this and only this — it defaults
// to the constant and nothing in src/ ever passes it, the same arrangement phi
// already has.
//
// ⚠ rho = 0 AND `lastSign: 0` ARE THE SAME DEFECT FROM TWO ENDS. Both make every
// step's sign a fair draw independent of the last one — rho = 0 by setting the
// stay probability to 1/2, lastSign = 0 by never entering the Markov branch at
// all. They do not produce the same SEQUENCE, but they produce the same
// same-sign RATE, so one control covers both.
// ============================================================================

import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { reviseDevelopingSet, type RevisableClaim } from '../../src/utils/claimRevision';
import {
  CLAIM_REVISION_PERSISTENCE_RHO, CLAIM_REVISION_PHI, IBNER_HORIZON,
  LINE_PAYOUT_PATTERN, resolveClosureCurve,
} from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const members = getPredefinedMarketMembers();
const REG_YEARS = 3;
// Scaled per line so every line clears the 9,676-pair floor above with room.
// Property writes two orders of magnitude fewer occurrences than WC and has a
// four-year horizon, so it needs far more registers for the same pair count.
const SCALE = Number(process.env.REPS ?? 1);
const REPS: Record<string, number> = {
  WC: Math.max(1, Math.round(10 * SCALE)),
  GL: Math.max(1, Math.round(30 * SCALE)),
  Property: Math.max(1, Math.round(350 * SCALE)),
};

/** The chain's own stay probability — the target, and the source's 59%. */
const TARGET = (1 + CLAIM_REVISION_PERSISTENCE_RHO) / 2;
const INDEPENDENT = 0.5;
const TOL = 0.02;
const MIN_PAIRS = 9_676;
/** Small enough that the delta's sign is the chain's sign — see the header. */
const PROBE_PHI = 0.005;

const failed: string[] = [];
const RULE = '='.repeat(72);

function register(line: CoverageLine, seed: number): RevisableClaim[] {
  const out: RevisableClaim[] = [];
  for (let y = 1; y <= REG_YEARS; y++) {
    const base = { members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: seed, riskControlEffectiveness: 0 };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
        : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) out.push({ claimId: c.id, current: c.grossUltimate });
  }
  return out;
}

interface Tally { pairs: number; same: number; moves: number; up: number }
const zero = (): Tally => ({ pairs: 0, same: 0, moves: 0, up: 0 });
const add = (a: Tally, b: Tally) => { a.pairs += b.pairs; a.same += b.same; a.moves += b.moves; a.up += b.up; };

/**
 * Walk one register age by age THROUGH THE ENGINE'S ENTRY POINT and read the
 * realised sign of every movement.
 *
 * The loop mirrors processIbner's call: one reviseDevelopingSet per age over the
 * whole tracked set, `modelAge` the step about to be taken, `paidShare` the
 * cohort's from the line's own payout pattern. Closed occurrences leave the set,
 * as reselection takes them out there. The untracked mass is passed as 0 — it
 * carries no per-claim sign and is not part of this measurement.
 */
function walk(line: CoverageLine, reg: RevisableClaim[], gameId: string, phi: number, rho: number): Tally {
  const pattern = LINE_PAYOUT_PATTERN[line];
  const ages = IBNER_HORIZON[line].max;
  const closeAt = new Map<string, number>();
  for (const c of reg) {
    const curve = resolveClosureCurve(line, c.current);
    const u = claimClosureUnit(gameId, c.claimId);
    let k = Number.POSITIVE_INFINITY;
    for (let t = 1; t <= 40; t++) if (closedShare(curve, t) >= u) { k = t; break; }
    closeAt.set(c.claimId, k);
  }
  const t = zero();
  const last = new Map<string, 1 | -1>();
  let live: RevisableClaim[] = reg.map(c => ({ ...c }));
  for (let a = 1; a <= ages; a++) {
    live = live.filter(c => a < (closeAt.get(c.claimId) ?? 0));
    if (live.length === 0) break;
    const paidShare = Math.min(0.999, cumulativePaid(pattern, a));
    const alloc = reviseDevelopingSet(gameId, live, 0, a, paidShare, phi, rho);
    live = live.map((c, i) => {
      const d = alloc.deltas[i];
      if (d !== 0) {
        t.moves++;
        const s: 1 | -1 = d > 0 ? 1 : -1;
        if (s > 0) t.up++;
        const prev = last.get(c.claimId);
        if (prev !== undefined) { t.pairs++; if (prev === s) t.same++; }
        last.set(c.claimId, s);
      }
      return { ...c, current: c.current + d };
    });
  }
  return t;
}

interface Arm { probe: Tally; probeNull: Tally; ship: Tally; shipNull: Tally }

const arms: Record<string, Arm> = {};
for (const line of LINES) {
  const a: Arm = { probe: zero(), probeNull: zero(), ship: zero(), shipNull: zero() };
  for (let g = 0; g < REPS[line]; g++) {
    // One register per replicate, a fresh seed each time, so the rate is not a
    // property of one claim mix.
    const reg = register(line, 77_000_000 + g * 6151);
    const id = `RHO${line}${g}`;
    add(a.probe, walk(line, reg, id, PROBE_PHI, CLAIM_REVISION_PERSISTENCE_RHO));
    add(a.probeNull, walk(line, reg, id, PROBE_PHI, 0));
    add(a.ship, walk(line, reg, id, CLAIM_REVISION_PHI, CLAIM_REVISION_PERSISTENCE_RHO));
    add(a.shipNull, walk(line, reg, id, CLAIM_REVISION_PHI, 0));
  }
  arms[line] = a;
}

const rate = (t: Tally) => t.same / Math.max(1, t.pairs);
const se = (t: Tally) => Math.sqrt(rate(t) * (1 - rate(t)) / Math.max(1, t.pairs));
const upShare = (t: Tally) => t.up / Math.max(1, t.moves);
const pc = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log('=== SIGN PERSISTENCE — the realised same-sign rate of successive revisions ===');
console.log(`rho = ${CLAIM_REVISION_PERSISTENCE_RHO}, so the chain's stay probability is ${pc(TARGET)}; independence is ${pc(INDEPENDENT)}.`);
console.log(`Read through reviseDevelopingSet at a probe phi of ${PROBE_PHI}. Tolerance ±${pc(TOL)}.\n`);

// ------------------------------------------------------- 1. the assertion
console.log('--- 1. ASSERTED: the chain, through the engine\'s own call path ---');
console.log('  line       pairs   same-sign      SE    tol width in SE   share up (must be ~50%)');
for (const line of LINES) {
  const t = arms[line].probe;
  console.log(`  ${line.padEnd(9)} ${String(t.pairs).padStart(6)}   ${pc(rate(t)).padStart(7)}  ${(100 * se(t)).toFixed(3)}pp`
    + `           ${(TOL / Math.max(1e-9, se(t))).toFixed(1)}   ${pc(upShare(t))}`);

  if (t.pairs < MIN_PAIRS) {
    failed.push(`${line}: only ${t.pairs} pairs against the ${MIN_PAIRS} floor — at this sample the ±${pc(TOL)} `
      + 'tolerance is under 4 SE and the arm would pass on a chain that had been zeroed.');
  }
  if (Math.abs(rate(t) - TARGET) > TOL) {
    failed.push(`${line}: successive revisions share a sign ${pc(rate(t))} of the time against the target ${pc(TARGET)} `
      + `(= (1 + rho)/2 at rho = ${CLAIM_REVISION_PERSISTENCE_RHO}). Either rho is not reaching reviseOnce — the `
      + '`lastSign: 0` defect, see this file\'s header — or the constant and the law have come apart.');
  }
  if (Math.abs(upShare(t) - 0.5) > TOL) {
    failed.push(`${line}: ${pc(upShare(t))} of movements are upward at the probe phi, against 50%. The chain is `
      + 'stationary at 1/2, so the probe is NOT reading the chain faithfully and section 1 is measuring '
      + 'the mean-one drift instead of the persistence. Lower PROBE_PHI.');
  }
}

// ------------------------------------------------------- 2. the control arm
console.log('');
console.log('--- 2. CONTROL ARM: rho forced to 0 through the same path ---');
console.log('  line       same-sign      shift from the shipped arm');
for (const line of LINES) {
  const t = arms[line].probeNull, live = arms[line].probe;
  console.log(`  ${line.padEnd(9)}   ${pc(rate(t)).padStart(7)}      ${((rate(t) - rate(live)) * 100).toFixed(2)}pp`);
  if (Math.abs(rate(t) - INDEPENDENT) > TOL) {
    failed.push(`CONTROL ${line}: rho = 0 reads ${pc(rate(t))} rather than ${pc(INDEPENDENT)}. The control arm is not `
      + 'removing the persistence, so section 1 is not measuring it either.');
  }
  if (Math.abs(rate(t) - TARGET) <= TOL) {
    failed.push(`CONTROL ${line}: rho = 0 lands INSIDE section 1's tolerance at ${pc(rate(t))}, so section 1 would `
      + 'pass on a chain with no persistence in it at all — which is the defect this gate exists to catch.');
  }
}
console.log(`  rho = 0 must read ${pc(INDEPENDENT)} and must break section 1's ±${pc(TOL)} band`
  + `  ${failed.length === 0 ? '— both hold' : '— SEE FAILURES'}`);

// ------------------------------------------------------- 3. the observable
console.log('');
console.log('--- 3. REPORTED: the same rate at the SHIPPED phi, which is NOT persistence ---');
console.log('  line       same-sign   at rho = 0   rho\'s share   share up');
for (const line of LINES) {
  const s = arms[line].ship, n = arms[line].shipNull;
  console.log(`  ${line.padEnd(9)}   ${pc(rate(s)).padStart(7)}      ${pc(rate(n)).padStart(7)}      `
    + `${((rate(s) - rate(n)) * 100).toFixed(2)}pp      ${pc(upShare(s))}`);
}
console.log('');
console.log('  ⚠ READ THE rho = 0 COLUMN BEFORE THE FIRST ONE. At the shipped phi most of the');
console.log('    apparent persistence is not persistence: the -s^2/2 correction makes the median');
console.log('    move DOWNWARD (the share-up column), and a biased coin repeats itself more often');
console.log('    than a fair one. Removing rho entirely leaves most of the rate standing.');
console.log('');
console.log('  ⚠ AND THE MODEL\'S OBSERVABLE IS NOT THE SOURCE\'S 59%. The pool measured the');
console.log('    direction of successive reserve CHANGES; this model\'s movement directions read');
console.log('    well above that on every line, because a mean-one multiplicative factor is not');
console.log('    a median-one one. rho was fitted as though the latent chain were the observable.');
console.log('    That is a phi-scale question — the magnitude sets s, s sets the gap — and it');
console.log('    belongs with the 84% / 9.8% work, not here. Recorded, not chased.');

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log(`SIGN PERSISTENCE HOLDS — successive revisions share a sign ${pc(TARGET)} of the`);
  console.log('time on every line, read out of reviseDevelopingSet rather than out of the');
  console.log('constant, and forcing rho to 0 through the same path collapses it to a coin.');
  console.log(RULE);
}
