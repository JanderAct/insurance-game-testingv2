// ============================================================================
// MOVEMENT DIRECTION — THE OBSERVABLE, ASSERTED. A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/revision-direction-check.ts
//   REPS=2 npx tsx scripts/diagnostics/revision-direction-check.ts
//
// ============================================================================
// WHAT THIS REPLACED, AND WHY THE SUBJECT CHANGED.
//
// This file was revision-persistence-check. It asserted the SIGN CHAIN's stay
// probability, (1 + rho)/2 = 0.59, read at a probe phi where the delta's sign is
// the chain's sign. rho is now 0 and the chain is gone from the code — see
// CLAIM_REVISION_PERSISTENCE_RHO for the ruling — so that assertion would be a
// 50% constant asserting nothing.
//
// ⚠ AND THE OLD SUBJECT WAS THE WRONG ONE ANYWAY, WHICH IS THE DURABLE PART. The
// pool's 59% was measured on OBSERVED reserve-change directions. The old gate
// held the model to it as a LATENT rate, at a phi chosen so the two coincide.
// That is a gate agreeing with a parameter, not with the data. The model's
// ACTUAL observable — the direction of the movements it produces at the SHIPPED
// phi — is what the pool measured, and asserting it is what would have caught
// the double-count that retired rho: the model already delivered most of the
// 59% through the mean-one correction, so fitting a chain to the same statistic
// counted it twice.
//
// ============================================================================
// WHAT IS ASSERTED, AND IT IS THE PROBE ARM.
//
// At a probe phi the magnitude s goes to zero, the -s^2/2 correction with it,
// and the sign of a movement IS the sign the law drew. So the same-sign rate
// there is the LATENT rate, and with no chain it must be 50% on every line. That
// is the assertion, and it is what fails if a sign chain is ever reintroduced —
// including by accident, which is how rho got in. At rho = 0.18 this arm would
// read 59%, nine points and forty standard errors away.
//
// ⚠ ITS OWN CONTROL IS THE SHIPPED ARM, WHICH READS 55-67%. A gate asserting
// "50%" would be worthless if the statistic could only ever read 50%. The same
// statistic on the same claims at the shipped phi is nowhere near it, so the
// probe arm is a measurement and not a tautology.
//
// ============================================================================
// WHAT IS REPORTED, AND WHY IT IS NOT ASSERTED.
//
// 1. THE LEVEL AGAINST THE POOL'S OBSERVED RATE. GL reads 55.47% against
//    CLAIM_MOVEMENT_DIRECTION_TARGET of 59%. That is 3.5 points, and at an SE of
//    0.23 points it is fifteen standard errors — a real gap, not noise. NO BAND
//    CONTAINS BOTH, and a band wide enough to would be seven times the
//    estimator's noise and chosen to pass. So the gap is RECORDED rather than
//    asserted. WC reads 57.15% and Property 67.40%; the target is a GL figure
//    and those two are carried across, so they were never assertable anyway.
//
// 2. THE EXCESS OVER A BIASED COIN, AND MY FIRST CUT ASSERTED THIS AND WAS WRONG.
//    For a single Bernoulli with a fixed p, P(same) = p^2 + (1-p)^2 exactly. I
//    took that as an independence identity and it failed on GL by 1.4pp and
//    Property by 4.6pp against an engine with no chain in it at all. THE IDENTITY
//    DOES NOT HOLD ACROSS A MIXTURE: p varies by claim, age and size, and
//    p^2 + (1-p)^2 is convex, so E[P(same)] exceeds the prediction at E[p] by
//    Jensen for any spread in p.
//
//    ⚠ AND PART OF THE EXCESS IS REAL DEPENDENCE, WHICH IS THE INTERESTING PART.
//    The size trend falls with claim size, so a claim that moves DOWN gets a
//    larger magnitude, a larger s, and a more downward-biased next move. The
//    model therefore produces direction persistence WITHOUT a sign chain, through
//    the carried value feeding back into the magnitude. Property, whose s runs
//    highest, shows it most. Reported here; it belongs with the s-unbounded item
//    at CLAIM_REVISION_SIZE_TREND and is not chased in this file.
//
// ============================================================================
// POWER. On the PROBE arm the signs are i.i.d. Bernoulli — each comes from its
// own hash and nothing couples them — so the binomial SE is exact there, which
// is the arm that is asserted. At p = 0.5 the SE is sqrt(0.25/n); this gate
// collects roughly 40,000 pairs per line for an SE near 0.25 points, so the
// +/-2 point tolerance is 8 SE wide and a rho = 0.18 chain sits 36 SE outside
// it. On the SHIPPED arm the signs are NOT independent (see 2 above), so that
// SE is a lower bound and is printed as an indication rather than a budget.
// ============================================================================

import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { reviseDevelopingSet, type RevisableClaim } from '../../src/utils/claimRevision';
import {
  CLAIM_MOVEMENT_DIRECTION_TARGET, CLAIM_REVISION_PHI, IBNER_HORIZON,
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
function walk(line: CoverageLine, reg: RevisableClaim[], gameId: string, phi: number): Tally {
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
    // ⚠ THE BALANCE, NOT THE PAID SHARE. reviseDevelopingSet takes the cohort's
    // reserve and derives h = balance / register from it, so the headroom this
    // file wants — the payout pattern's, since it is measuring the SIGN chain and
    // not the ledger — is expressed as a balance of that share of the register.
    // There is no untracked mass here, so its factor is the neutral 1.
    const register = live.reduce((acc, c) => acc + c.current, 0);
    const alloc = reviseDevelopingSet(
      gameId, live,
      { untracked: 0, untrackedFactor: 1, balance: register * (1 - paidShare), modelAge: a },
      phi,
    );
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


const TOL = Number(process.env.TOL ?? 0.02);
/** Small enough that s -> 0 and the direction is a fair coin. */
const PROBE_PHI = 0.005;
const failed: string[] = [];
const RULE = '='.repeat(72);

interface Arm { ship: Tally; probe: Tally }
const arms: Record<string, Arm> = {};
for (const line of LINES) {
  const a: Arm = { ship: zero(), probe: zero() };
  for (let g = 0; g < REPS[line]; g++) {
    const reg = register(line, 77_000_000 + g * 6151);
    const id = `DIR${line}${g}`;
    add(a.ship, walk(line, reg, id, CLAIM_REVISION_PHI));
    add(a.probe, walk(line, reg, id, PROBE_PHI));
  }
  arms[line] = a;
}

const rate = (t: Tally) => t.same / Math.max(1, t.pairs);
const se = (t: Tally) => Math.sqrt(rate(t) * (1 - rate(t)) / Math.max(1, t.pairs));
const up = (t: Tally) => t.up / Math.max(1, t.moves);
/** The same-sign rate an INDEPENDENT but biased coin produces. */
const independentPrediction = (p: number) => p * p + (1 - p) * (1 - p);
const pc = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log('=== MOVEMENT DIRECTION — the observable, at the shipped phi ===');
console.log(`phi = ${CLAIM_REVISION_PHI}, rho retired. Pool target ${pc(CLAIM_MOVEMENT_DIRECTION_TARGET)} (GL). Tolerance +/-${pc(TOL)}.\n`);

console.log('--- 1. REPORTED: the level against the pool\'s observed rate (a GL figure) ---');
console.log('  line       pairs   same-sign      SE      gap to target   tol in SE');
for (const line of LINES) {
  const t = arms[line].ship;
  const gap = rate(t) - CLAIM_MOVEMENT_DIRECTION_TARGET;
  console.log(`  ${line.padEnd(9)} ${String(t.pairs).padStart(6)}   ${pc(rate(t)).padStart(7)}  ${(100 * se(t)).toFixed(3)}pp   `
    + `${(gap >= 0 ? '+' : '') + (100 * gap).toFixed(2)}pp`.padStart(13) + `   ${(TOL / Math.max(1e-9, se(t))).toFixed(1)}`);
}
{
  const t = arms.GL.ship;
  const gap = rate(t) - CLAIM_MOVEMENT_DIRECTION_TARGET;
  console.log('');
  console.log(`  ⚠ GL SITS ${(100 * Math.abs(gap)).toFixed(2)}pp ${gap < 0 ? 'BELOW' : 'ABOVE'} THE POOL'S OBSERVED RATE, at `
    + `${(Math.abs(gap) / Math.max(1e-9, se(t))).toFixed(0)} SE. NOT ASSERTED, and the reason is in the header:`);
  console.log('    no defensible band contains both, and widening one until it does is the failure');
  console.log('    mode this repo names. The gap is the model reproducing three quarters of a');
  console.log('    measured statistic by a mechanism the pool never described.');
}

console.log('');
console.log('--- 2. REPORTED: excess over a biased coin — the value-feedback channel ---');
console.log('  line       share up   P(same) predicted   realised    excess    SE');
for (const line of LINES) {
  const t = arms[line].ship;
  const pred = independentPrediction(up(t));
  const excess = rate(t) - pred;
  console.log(`  ${line.padEnd(9)}  ${pc(up(t)).padStart(7)}   ${pc(pred).padStart(15)}   ${pc(rate(t)).padStart(8)}   `
    + `${(excess >= 0 ? '+' : '') + (100 * excess).toFixed(3)}pp`.padStart(9) + `   ${(100 * se(t)).toFixed(3)}pp`);
  void excess;
}

console.log('');
console.log('--- 3. ASSERTED: at a probe phi the direction is the LAW\'S OWN SIGN, and it is fair ---');
console.log('  line       share up   same-sign   (both must be 50% — no chain)   shipped arm, for contrast');
for (const line of LINES) {
  const t = arms[line].probe;
  console.log(`  ${line.padEnd(9)}  ${pc(up(t)).padStart(7)}   ${pc(rate(t)).padStart(9)}${' '.repeat(31)}${pc(rate(arms[line].ship))}`);
  if (Math.abs(rate(t) - 0.5) > TOL) {
    failed.push(`${line}: at phi = ${PROBE_PHI} the latent sign repeats ${pc(rate(t))} of the time rather than 50%. `
      + 'A SIGN CHAIN IS IN FORCE. rho was retired at this commit and nothing should carry between ages — see '
      + 'CLAIM_REVISION_PERSISTENCE_RHO for why, and revisionFactor for where the chain used to be.');
  }
  if (Math.abs(up(t) - 0.5) > TOL) {
    failed.push(`${line}: at phi = ${PROBE_PHI} the marginal share of upward moves is ${pc(up(t))} rather than 50%. `
      + 'The probe is not small enough for the delta sign to be the drawn sign, so this arm is measuring the '
      + 'mean-one drift instead of the chain. Lower PROBE_PHI.');
  }
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('NO SIGN CHAIN IS IN FORCE — at a probe phi, where a movement\'s direction is');
  console.log('the direction the law drew, every line reads a fair coin. The 55-67% the model');
  console.log('shows at the shipped phi is the mean-one correction and the value feedback,');
  console.log('not a persistence parameter. THE GL LEVEL GAP IN SECTION 1 IS OPEN AND IS');
  console.log('REPORTED, NOT ASSERTED — see this file\'s header.');
  console.log(RULE);
}
