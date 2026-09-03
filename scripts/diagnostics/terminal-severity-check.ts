// ============================================================================
// TERMINAL SEVERITY — THE ANCHOR THAT DERIVES phi. A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/terminal-severity-check.ts
//   PHI=2.5 npx tsx scripts/diagnostics/terminal-severity-check.ts   # one value
//   SWEEP=1 npx tsx scripts/diagnostics/terminal-severity-check.ts   # the curve
//
// This is the load-bearing gate of Stage 1 and it runs FIRST. Everything else
// in the per-claim revision law is calibrated through phi, and phi has exactly
// one external anchor: the pool's settled-claim log-SD of 2.29
// (CLAIM_SETTLED_LOG_SD_ANCHOR). If no single shared phi lands the model's
// terminal severity near that number, the mechanism does not work and the rest
// of Stage 1 should not be built.
//
// ============================================================================
// WHAT IT MEASURES, AND THE ONE METHODOLOGICAL CHOICE IN IT.
//
// A model claim's SETTLED value is its drawn severity walked through the
// revision law to closure and then multiplied by the settlement factor. The
// log-SD of that distribution is what the anchor is about.
//
// ⚠ ZEROS ARE EXCLUDED FROM THE LOG-SD AND THAT IS NOT A CONVENIENCE. 19% of
// claims settle at zero and ln(0) does not exist, so a settled-value log-SD is
// necessarily a statement about the non-zero settlements — in the source as much
// as here. The zero mass is reported separately and asserted against its own
// fitted probability, so it is measured rather than quietly dropped.
//
// ============================================================================
// ⚠ THE DECOMPOSITION, BECAUSE THE ANCHOR IS NOT ALL phi's TO HIT.
//
// The terminal log-variance has three independent parts:
//
//   Var[ln terminal] = Var[ln drawn] + Var[accumulated ln revision] + Var[ln settle | non-zero]
//
// The first is the severity fit's own, about 2.14^2 — this is the "already
// spent" term in phi's note. The third is the settlement SHAPE's, whose
// log-sigma is a fitted 0.5297 and is NOT a free parameter. Only the middle
// term is phi's. So phi is solved against a much smaller residual than
// 2.29 - 2.14 suggests, and this file prints all three so the budget is visible
// rather than inferred.
//
// ⚠ AND THAT IS WHY phi COULD FAIL EVEN IF THE LAW IS RIGHT: if the fitted
// drawn spread plus the fitted settlement spread already exceed the anchor, the
// residual is negative and NO phi >= 0 can land it. That is a real outcome, it
// is checked for explicitly below, and it would be the finding rather than a
// bug to work around.
//
// ============================================================================
// WHY THIS READS NO CLF TABLE, WHICH WILL LOOK WRONG.
//
// It runs the claim generator and the revision law and nothing else — no
// pricing, no funding, no premium. The CLF tables cannot reach a drawn severity
// or a revision factor, so the ordering objection ("these gates run against the
// old tables") does not apply here. Only pre-game acceptance is table-dependent.
//
// THE CONTROL ARM: phi = 0 must land BELOW the anchor, and the drawn-only
// log-SD must land below that again. If either did not, the sweep would be
// measuring something other than the revision law's contribution and a phi
// solved on it would be meaningless.
// ============================================================================

import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
// claimClosureUnit comes through its own module rather than being re-derived:
// re-implementing the hash here is how the closure gate and this one would
// silently disagree about which claims are open.
import { closedShare, claimClosureUnit as claimClosureUnitLocal } from '../../src/utils/claimClosure';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { reviseOnce, settlementFactor, settlementFactorMean, type RevisionState } from '../../src/utils/claimRevision';
import {
  CLAIM_REVISION_PHI, CLAIM_SETTLED_LOG_SD_ANCHOR, CLAIM_SETTLEMENT_FACTOR,
  LINE_PAYOUT_PATTERN, resolveClosureCurve,
} from '../../src/data/defaultAssumptions';

const YEARS = Number(process.env.YEARS ?? 8);
const GAMES = Number(process.env.GAMES ?? 12);
// Tolerance on the log-SD, in log units. The anchor is a sample statistic of a
// heavy-tailed distribution and 0.05 is about 2% of 2.29 — tight enough that a
// double-counted phi (which would land near 2.6+) cannot pass, loose enough
// that the model's own sampling error at this size does not flap. The bootstrap
// SE is printed so the margin is visible rather than trusted.
const TOL = Number(process.env.TOL ?? 0.05);
const MAX_AGE = 40;

const failed: string[] = [];
const RULE = '='.repeat(72);

interface DrawnClaim { gameId: string; claimId: string; value: number; closureAge: number }

/** Every claim the GL generator draws over GAMES x YEARS, with its closure age. */
function drawRegister(): DrawnClaim[] {
  const members = getPredefinedMarketMembers();
  const out: DrawnClaim[] = [];
  for (let g = 0; g < GAMES; g++) {
    const gameId = `TSC${g}`;
    for (let y = 1; y <= YEARS; y++) {
      const r = generateGlClaims({
        members, yearNumber: y, calendarYear: 2025 + y,
        instanceSeed: 83_000_000 + g * 7919, kGl: 1, gPool: 1, riskControlEffectiveness: 0,
      });
      for (const c of r.claims) {
        const curve = resolveClosureCurve('GL', c.grossUltimate);
        const u = claimClosureUnitLocal(gameId, c.id);
        // The first age at which this claim's own closure share reaches its unit.
        let closureAge = MAX_AGE;
        for (let t = 1; t <= MAX_AGE; t++) {
          if (closedShare(curve, t) >= u) { closureAge = t; break; }
        }
        out.push({ gameId, claimId: c.id, value: c.grossUltimate, closureAge });
      }
    }
  }
  return out;
}

const pattern = LINE_PAYOUT_PATTERN.GL;
/** The claim's paid share at an age — its cohort's, not a per-claim schedule.
 *  claimClosure.ts's prohibition stands: no claim draws its own schedule. */
const paidShareAt = (age: number) => Math.min(0.999, cumulativePaid(pattern, age));

function terminalValues(reg: DrawnClaim[], phi: number, nonZeroScale: number): number[] {
  const out: number[] = [];
  for (const c of reg) {
    let st: RevisionState = { value: c.value, paidShare: 0 };
    for (let age = 1; age < c.closureAge; age++) {
      st = { ...st, paidShare: paidShareAt(age) };
      st = reviseOnce(c.gameId, c.claimId, age, st, phi);
    }
    out.push(st.value * settlementFactor(c.gameId, c.claimId, nonZeroScale));
  }
  return out;
}

const sd = (xs: number[]): number => {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const logSd = (vs: number[]): number => sd(vs.filter(v => v > 0).map(Math.log));

console.log('=== TERMINAL SEVERITY — the anchor that derives phi ===');
console.log(`${GAMES} games x ${YEARS} years of the GL generator, full 200-member market.\n`);

const reg = drawRegister();
// The settlement level is held at 1 here — its MEAN is solved against the
// martingale, not against this anchor, and the two are separate measurements.
// What this file needs from settlement is its SHAPE, which the level does not
// move: scaling every non-zero factor by a constant shifts ln by a constant and
// leaves the log-SD untouched. Stated because it looks like an omission.
const SCALE_HERE = 1;

const drawnLogSd = logSd(reg.map(c => c.value));
console.log(`  register            ${reg.length.toLocaleString()} GL claims`);
console.log(`  closure age         mean ${(reg.reduce((a, c) => a + c.closureAge, 0) / reg.length).toFixed(2)}`
  + `  p90 ${[...reg].sort((a, b) => a.closureAge - b.closureAge)[Math.floor(0.9 * reg.length)].closureAge}`
  // ⚠ reduce, NOT Math.max(...arr). The spread blew the call stack at 148k
  // claims — a bug in this gate, found by raising GAMES, and the kind that only
  // appears at a sample size nobody ran until the robustness sweep.
  + `  max ${reg.reduce((m, c) => Math.max(m, c.closureAge), 0)}`);
console.log('');

// ---------------------------------------------------------------- the budget
console.log('--- THE VARIANCE BUDGET, and how much of the anchor is phi\'s to hit ---');
const settleShapeVar = CLAIM_SETTLEMENT_FACTOR.nonZeroLogSigma ** 2;
const anchorVar = CLAIM_SETTLED_LOG_SD_ANCHOR ** 2;
const residualVar = anchorVar - drawnLogSd ** 2 - settleShapeVar;
console.log(`  Var[ln drawn]                  ${(drawnLogSd ** 2).toFixed(4)}   (log-SD ${drawnLogSd.toFixed(4)} — the "already spent 2.14")`);
console.log(`  Var[ln settle | non-zero]      ${settleShapeVar.toFixed(4)}   (log-SD ${CLAIM_SETTLEMENT_FACTOR.nonZeroLogSigma} — FITTED, not free)`);
console.log(`  Var[ln terminal] target        ${anchorVar.toFixed(4)}   (anchor ${CLAIM_SETTLED_LOG_SD_ANCHOR})`);
console.log(`  ------------------------------------------`);
console.log(`  RESIDUAL for the revision law  ${residualVar.toFixed(4)}   ${residualVar > 0
  ? `(log-SD ${Math.sqrt(residualVar).toFixed(4)})`
  : '*** NEGATIVE — no phi >= 0 can reach the anchor ***'}`);
console.log('');

// ---------------------------------------------------------------- control arm
console.log('--- CONTROL ARM: the sweep must be measuring the revision law and nothing else ---');
const atZero = logSd(terminalValues(reg, 0, SCALE_HERE));
console.log(`  drawn only, no settlement       log-SD ${drawnLogSd.toFixed(4)}`);
console.log(`  phi = 0 (settlement only)       log-SD ${atZero.toFixed(4)}`);
console.log(`  anchor                          log-SD ${CLAIM_SETTLED_LOG_SD_ANCHOR.toFixed(4)}`);
if (!(drawnLogSd < atZero)) {
  failed.push('CONTROL: phi = 0 does not widen the drawn distribution, so the settlement shape is not reaching the measurement — the sweep below is not measuring what it claims');
}
if (!(atZero < CLAIM_SETTLED_LOG_SD_ANCHOR)) {
  failed.push(`CONTROL: phi = 0 already reads ${atZero.toFixed(4)} against an anchor of ${CLAIM_SETTLED_LOG_SD_ANCHOR}`
    + ' — the fitted draw and settlement shape ALREADY exceed the pool\'s settled spread, so no revision magnitude can land it.'
    + ' THIS KILLS THE MECHANISM AS SPECIFIED rather than failing a calibration: phi is not the parameter at fault.');
}
console.log('');

// ---------------------------------------------------------------- solve phi
console.log('--- SOLVING phi AGAINST THE ANCHOR ---');
const at = (phi: number) => logSd(terminalValues(reg, phi, SCALE_HERE));

const GRID = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1.0, 1.4, 1.9, 2.5, 3.2, 4.2];
console.log('    phi      terminal log-SD    vs anchor');
const curve: { phi: number; sd: number }[] = [];
for (const phi of GRID) {
  const v = at(phi);
  curve.push({ phi, sd: v });
  const d = v - CLAIM_SETTLED_LOG_SD_ANCHOR;
  console.log(`  ${phi.toFixed(2).padStart(5)}      ${v.toFixed(4).padStart(8)}         ${(d >= 0 ? '+' : '') + d.toFixed(4)}`);
}

// Bisect on the monotone stretch, if the anchor is bracketed at all.
let solved: number | null = null;
for (let i = 0; i + 1 < curve.length; i++) {
  const a = curve[i], b = curve[i + 1];
  if ((a.sd - CLAIM_SETTLED_LOG_SD_ANCHOR) * (b.sd - CLAIM_SETTLED_LOG_SD_ANCHOR) <= 0) {
    let lo = a.phi, hi = b.phi;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (at(mid) < CLAIM_SETTLED_LOG_SD_ANCHOR) lo = mid; else hi = mid;
    }
    solved = (lo + hi) / 2;
    break;
  }
}

console.log('');
if (solved === null) {
  const lowest = curve[0].sd, highest = curve[curve.length - 1].sd;
  failed.push(`THE ANCHOR IS NOT BRACKETED. Over phi in [${GRID[0]}, ${GRID[GRID.length - 1]}] the terminal log-SD `
    + `runs ${lowest.toFixed(4)} to ${highest.toFixed(4)} and never crosses ${CLAIM_SETTLED_LOG_SD_ANCHOR}. `
    + 'No single shared phi lands the anchor, which is the STOP condition for Stage 1 — report it, do not widen the grid to force a crossing.');
} else {
  console.log(`  SOLVED: phi = ${solved.toFixed(4)} lands the terminal log-SD at ${at(solved).toFixed(4)}`);
  console.log(`  SHIPPED: phi = ${CLAIM_REVISION_PHI} reads ${at(CLAIM_REVISION_PHI).toFixed(4)}`);
  const shippedGap = Math.abs(at(CLAIM_REVISION_PHI) - CLAIM_SETTLED_LOG_SD_ANCHOR);
  if (shippedGap > TOL) {
    failed.push(`CLAIM_REVISION_PHI = ${CLAIM_REVISION_PHI} puts the terminal log-SD at `
      + `${at(CLAIM_REVISION_PHI).toFixed(4)} against the ${CLAIM_SETTLED_LOG_SD_ANCHOR} anchor — off by `
      + `${shippedGap.toFixed(4)} against a ${TOL} tolerance. The anchor IS reachable: phi = ${solved.toFixed(4)} `
      + 'lands it. Re-point the constant at the solved value; do not widen the tolerance.');
  }
}

// ---------------------------------------------------------------- zero mass
console.log('');
console.log('--- THE ZERO MASS, reported because the log-SD above cannot see it ---');
const terminal = terminalValues(reg, CLAIM_REVISION_PHI, SCALE_HERE);
const zeroShare = terminal.filter(v => v <= 0).length / terminal.length;
console.log(`  settled at zero    ${(100 * zeroShare).toFixed(2)}%   fitted ${(100 * CLAIM_SETTLEMENT_FACTOR.zeroProbability).toFixed(2)}%`);
console.log(`  settlement mean at scale 1     ${settlementFactorMean(1).toFixed(4)}`
  + '   (the LEVEL is solved against the martingale, not here)');
if (Math.abs(zeroShare - CLAIM_SETTLEMENT_FACTOR.zeroProbability) > 0.01) {
  failed.push(`the realised zero-settlement share is ${(100 * zeroShare).toFixed(2)}% against a fitted `
    + `${(100 * CLAIM_SETTLEMENT_FACTOR.zeroProbability).toFixed(2)}% — the settlement hash is not uniform on this register`);
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('TERMINAL SEVERITY HOLDS — a single shared phi lands the model\'s settled');
  console.log('log-SD on the pool\'s, with the control arm confirming the sweep measures');
  console.log('the revision law rather than the fit it sits on top of.');
  console.log(RULE);
}
