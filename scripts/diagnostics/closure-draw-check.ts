// ============================================================================
// THE CLOSURE DRAW — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/closure-draw-check.ts
//
// A claim's status is `closedShare(curve, t) >= unit(gameId, claimId)`. If the
// unit is uniform on [0,1) then the realised closure share MUST equal the
// curve's own expectation. Everything here asserts that, and the two ways it
// silently failed.
//
// ============================================================================
// WHAT IT ASSERTS
//
//   UNIFORM, PER LINE      the unit's mean is 0.5 and its deciles are flat, on
//                          EACH LINE SEPARATELY. This is the one that matters,
//                          and per-line is the whole point: the shipped hash was
//                          plain FNV-1a returning the TOP 24 bits, which is
//                          clean on GL (mean 0.4994, ids fixed-shape ending
//                          `-c1`) and badly biased on WC (mean 0.4882,
//                          chi-squared(9) 258 against a 21.7 critical value,
//                          ids 23-32 chars ending in a variable-length component
//                          token). A pooled check would have read acceptable. A
//                          check written against GL first would have read clean.
//
//   CALIBRATED             realised closure equals the curve's expectation on
//                          the claims actually drawn, per line and per age. This
//                          is the consequence of uniformity and is asserted
//                          separately because it is the quantity that matters —
//                          the bias above moved WC's age-1 closure +1.75 points.
//
//   MONOTONE               a closed claim stays closed as age increases. Free
//                          given a fixed unit and a monotone curve, and asserted
//                          because a future change to either could break it
//                          without anything else noticing.
//
//   SEED-INDEPENDENT       two games with different identities give UNCORRELATED
//                          closure on the claim ids they share. Claim ids carry
//                          no seed — `wc-1-member-004-large-0` is the same string
//                          in every game, and 21.9% of WC ids collide between two
//                          unrelated games — so hashing the id ALONE gave the
//                          same closure to the same slot in every game, on
//                          entirely different claims. That is the defect
//                          enrolment-independence-check exists to prevent
//                          elsewhere, arriving through a display derivation.
//                          This is the arm that would catch its return.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { claimClosureUnit, closedShare, isClaimClosed } from '../../src/utils/claimClosure';
import { resolveClosureCurve, WC_LARGE_CLAIM_THRESHOLD } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 10);
const YEARS = Number(process.env.YEARS ?? 6);
const MAX_AGE = 6;

// The unit's mean, over thousands of claims. 0.005 is far inside what the
// measured defect produced (0.0118 on WC) and far outside float noise.
const MAX_MEAN_DRIFT = 0.005;
// Chi-squared(9) at 99.9% is 27.9. The shipped hash read 258 on WC.
const MAX_CHI2 = 27.9;
// ⚠ A Z-SCORE, NOT SHARE POINTS, AND THE FIRST VERSION OF THIS CHECK GOT IT
// WRONG. An absolute 1-point bound failed Property at -1.15 points — which is
// 1.08 sigma on its 2,205 claims and pure noise, while the same 1 point on WC's
// 27,745 would be 3.8 sigma and real. A bound that means different things on
// different lines is the same mistake as a hash that is uniform on one line.
//
// 3.5 sigma across ~18 line-age cells, which are strongly correlated within a
// line (same claims, nested ages), so this is roughly three independent tests.
// For scale, the defect this gate was built to catch — WC's +1.75 points on
// 27,745 claims — scores 5.8 sigma.
const MAX_CALIBRATION_Z = 3.5;
// |Pearson r| between two games' closure decisions on the ids they share.
// Identical decisions score 1.0; the shipped hash scored exactly that.
const MAX_CROSS_GAME_R = 0.10;

interface C { line: string; game: string; id: string; size: number }
const claims: C[] = [];

function play(gameId: string, seed: number): C[] {
  const out: C[] = [];
  const inst = generateGameInstance(gameId, seed);
  const setup = { poolName: 'D', gameLength: YEARS, startingYear: 2026, instanceId: gameId, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      const cs = (p.result.byLine[l] as never as { claims?: { id: string; grossUltimate: number }[] }).claims ?? [];
      for (const c of cs) out.push({ line: l, game: gameId, id: c.id, size: c.grossUltimate });
    }
    gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result], currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
  return out;
}

for (let g = 0; g < GAMES; g++) claims.push(...play(`CDC${g}`, 7_100_000 + g * 6367));

const fails: string[] = [];
const fail = (s: string) => fails.push(s);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);

console.log('=== THE CLOSURE DRAW ===');
console.log(`${GAMES} games x ${YEARS} years, ${claims.length.toLocaleString()} claims.\n`);

console.log('--- UNIFORM, PER LINE ---');
console.log('  line       claims     mean unit   drift     chi2(9)   limit');
for (const line of LINES) {
  const u = claims.filter(c => c.line === line).map(c => claimClosureUnit(c.game, c.id));
  if (u.length < 100) { console.log(`  ${line.padEnd(10)} too few claims to test`); continue; }
  const m = mean(u);
  const bins = new Array(10).fill(0);
  for (const v of u) bins[Math.min(9, Math.floor(v * 10))]++;
  const e = u.length / 10;
  const chi = bins.reduce((a, b) => a + (b - e) ** 2 / e, 0);
  const badMean = Math.abs(m - 0.5) > MAX_MEAN_DRIFT;
  const badChi = chi > MAX_CHI2;
  if (badMean) fail(`${line}: the closure unit's mean is ${m.toFixed(4)}, off 0.5 by `
    + `${Math.abs(m - 0.5).toFixed(4)} — every claim on this line is biased toward ${m < 0.5 ? 'CLOSING' : 'STAYING OPEN'}`);
  if (badChi) fail(`${line}: decile chi-squared ${chi.toFixed(1)} over ${MAX_CHI2} — the hash is not `
    + 'uniform on this line\'s id shape, whatever it does on the others');
  console.log(`  ${line.padEnd(10)} ${u.length.toLocaleString().padStart(8)}   ${m.toFixed(4).padStart(9)} `
    + `${(m - 0.5 >= 0 ? '+' : '') + (m - 0.5).toFixed(4)}`.padStart(9)
    + `${chi.toFixed(1).padStart(10)}   ${MAX_CHI2}  ${badMean || badChi ? 'FAIL' : 'ok'}`);
}

console.log('\n--- CALIBRATED: realised closure vs the curve\'s own expectation ---');
console.log('  line       age    expected   realised    diff   sigma     verdict');
for (const line of LINES) {
  const C = claims.filter(c => c.line === line);
  if (C.length < 100) continue;
  for (let t = 1; t <= MAX_AGE; t++) {
    const ps = C.map(c => closedShare(resolveClosureCurve(line, c.size), t));
    const exp = mean(ps);
    const real = C.filter(c => isClaimClosed(resolveClosureCurve(line, c.size), c.game, c.id, t)).length / C.length;
    // Poisson-binomial: each claim has its own closure probability, so the
    // variance is sum p(1-p) rather than n p(1-p).
    const sd = Math.sqrt(ps.reduce((a, q) => a + q * (1 - q), 0)) / C.length;
    const z = sd > 0 ? (real - exp) / sd : 0;
    const bad = Math.abs(z) > MAX_CALIBRATION_Z;
    if (bad) fail(`${line} age ${t}: realised closure ${(real * 100).toFixed(2)}% against the curve's own `
      + `${(exp * 100).toFixed(2)}% — ${z.toFixed(1)} sigma on ${C.length.toLocaleString()} claims. `
      + 'The draw is not delivering the curve it is given.');
    console.log(`  ${line.padEnd(10)} ${String(t).padStart(3)}  ${(exp * 100).toFixed(2).padStart(9)}% `
      + `${(real * 100).toFixed(2).padStart(9)}% ${((real - exp) * 100 >= 0 ? '+' : '') + ((real - exp) * 100).toFixed(2)}`.padStart(9)
      + `${z.toFixed(1).padStart(8)}     ${bad ? 'FAIL' : 'ok'}`);
  }
}

// ⚠ WHAT THIS CHECK CANNOT SEE, stated because a gate's blind spot belongs
// beside its output. The smallest bias each line can resolve at 3.5 sigma
// depends entirely on how many claims that line draws, and Property draws few.
console.log('\n  resolution at this sample size — the smallest bias each line could detect:');
for (const line of LINES) {
  const C = claims.filter(c => c.line === line);
  if (C.length < 100) continue;
  const ps = C.map(c => closedShare(resolveClosureCurve(line, c.size), 1));
  const sd = Math.sqrt(ps.reduce((a, q) => a + q * (1 - q), 0)) / C.length;
  console.log(`    ${line.padEnd(10)} ${C.length.toLocaleString().padStart(7)} claims -> `
    + `${(sd * MAX_CALIBRATION_Z * 100).toFixed(2)} share points at age 1`);
}
console.log('    Property cannot resolve a one-point bias at any sample this gate will run;');
console.log('    raise GAMES if a Property-specific closure defect is ever suspected.');

console.log('\n--- MONOTONE: a closed claim stays closed ---');
{
  let checked = 0, broken = 0;
  for (const c of claims) {
    const curve = resolveClosureCurve(c.line, c.size);
    let wasClosed = false;
    for (let t = 1; t <= MAX_AGE; t++) {
      const now = isClaimClosed(curve, c.game, c.id, t);
      checked++;
      if (wasClosed && !now) broken++;
      wasClosed = wasClosed || now;
    }
  }
  if (broken > 0) fail(`${broken} claim-ages reopened — closure is not monotone in age`);
  console.log(`  ${checked.toLocaleString()} claim-ages checked, ${broken} reopenings`);
}

console.log('\n--- SEED-INDEPENDENT: two games, the ids they share ---');
{
  const A = play('SEEDA', 2_200_000);
  const B = play('SEEDB', 9_900_001);
  console.log('  line       shared ids   share of A   agreement    Pearson r   limit');
  for (const line of LINES) {
    const a = new Map(A.filter(c => c.line === line).map(c => [c.id, c]));
    const b = new Map(B.filter(c => c.line === line).map(c => [c.id, c]));
    const shared = [...a.keys()].filter(k => b.has(k));
    if (shared.length < 20) { console.log(`  ${line.padEnd(10)} ${shared.length} shared — too few to test`); continue; }
    // The SAME curve for both, so only the unit differs. Anything else would
    // confound the hash with the claims' sizes.
    const curve = resolveClosureCurve(line, 0);
    const xs = shared.map(k => isClaimClosed(curve, 'SEEDA', k, 2) ? 1 : 0);
    const ys = shared.map(k => isClaimClosed(curve, 'SEEDB', k, 2) ? 1 : 0);
    const agree = xs.filter((v, i) => v === ys[i]).length / shared.length;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    const r = sxy / Math.sqrt(Math.max(sxx * syy, 1e-12));
    const bad = Math.abs(r) > MAX_CROSS_GAME_R;
    if (bad) fail(`${line}: two games' closure decisions on their ${shared.length} shared claim ids `
      + `correlate at r=${r.toFixed(3)} — the draw is not reading the game's identity, so a claim SLOT `
      + 'closes at the same age in every game that has it');
    console.log(`  ${line.padEnd(10)} ${String(shared.length).padStart(10)} ${(a.size > 0 ? shared.length / a.size * 100 : 0).toFixed(1).padStart(11)}% `
      + `${(agree * 100).toFixed(1).padStart(10)}% ${r.toFixed(3).padStart(12)}   ${MAX_CROSS_GAME_R}  ${bad ? 'FAIL' : 'ok'}`);
  }
  console.log('  Agreement near 50% and r near 0 is what independence looks like; the shipped hash');
  console.log('  scored 100% and r = 1.000 because the game identity was not an input.');
}

console.log('\n--- RECORDED, NOT ASSERTED: the model\'s share above the WC size threshold ---');
console.log(`  threshold $${(WC_LARGE_CLAIM_THRESHOLD / 1000).toFixed(0)}k. WC's mixture weight is calibrated to its own figure;`);
console.log('  GL and Property are size-blind and theirs are here for whoever fits them.');
for (const line of LINES) {
  const C = claims.filter(c => c.line === line);
  if (C.length === 0) continue;
  console.log(`    ${line.padEnd(10)} ${(C.filter(c => c.size >= WC_LARGE_CLAIM_THRESHOLD).length / C.length * 100).toFixed(2)}%`);
}

console.log(fails.length === 0
  ? '\nTHE DRAW DELIVERS THE CURVE IT IS GIVEN. The unit is uniform on every line separately, realised'
    + '\nclosure matches the curve\'s own expectation at every age, closure never reverses, and two games'
    + '\nreach independent conclusions about the claim ids they happen to share.'
  : `\n${fails.length} FAILURE(S):\n` + fails.map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
