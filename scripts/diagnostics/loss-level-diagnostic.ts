// LOSS-LEVEL DIAGNOSTIC — why do realized gross losses run below the exported
// Pure Premium in live games?
//
// Read-only. Changes nothing, decides nothing. Four independent tests, each
// isolating one candidate cause, reported together so the calibration decision
// can be made on evidence rather than on whichever test ran first.
//
//   npx tsx scripts/diagnostics/loss-level-diagnostic.ts
//
// THE OBSERVATION THIS EXISTS TO EXPLAIN. Three 5-year games at default
// decisions (WC + GL, Property on the legacy path) came in at 0.912 / 0.757 /
// 0.701 of expected, mean 0.790. The exported shared annual loss factor over
// those 15 line-years averaged 0.886 against a theoretical 1.000, with a
// realized sd of 0.197 against a theoretical 0.200 — the spread is right and
// the centre is 2.2 SE low, which is the signature of a mis-centred
// distribution rather than a mis-scaled one. But 15 draws cannot distinguish
// that from luck, which is what TEST 1 settles.
//
// TEST 1  is gPool centred at 1.0, through the real engine path?
// TEST 2  does the ENROLLED book's own expected loss differ from what the held
//         pure premium charges it? (composition / class-mix effect)
// TEST 3  does k_line / k_GL fully neutralise RQ on the enrolled book?
// TEST 4  realized vs exported Pure Premium through the GAME path, at a sample
//         large enough to have a usable confidence interval.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { deriveSubRng } from '../../src/utils/random';
import { WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import { computeKLine, expectedWcGrossLossForPricing } from '../../src/utils/wcClaimEngine';
import { computeKGl, expectedGlGrossLossForPricing } from '../../src/utils/glClaimEngine';
import type { CoverageLine, GameState, Member } from '../../src/types/simulation';

// Sections run independently so each fits in a foreground run and prints as it
// goes: pass 1, 2 (tests 2+3, which share one pass of games) or 4. No argument
// runs everything.
const SECTION = process.argv[2] ?? 'all';
const runs1 = SECTION === 'all' || SECTION === '1';
const runs23 = SECTION === 'all' || SECTION === '2' || SECTION === '3';
const runs4 = SECTION === 'all' || SECTION === '4';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}
const seedIds = (n: number) =>
  Array.from({ length: n }, (_, i) => (((i + 1) * 2654435761) >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8));

// --- exact Gamma CDF and quantiles, for TEST 1's theory column ---------------
function lgamma(z: number): number {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1; let x = 0.99999999999980993;
  for (let i = 0; i < 8; i++) x += g[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
// Regularized lower incomplete gamma P(a, x): series below a+1, continued
// fraction above — the standard split, accurate to ~1e-14 either side.
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 1000; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
function gammaQuantile(a: number, scale: number, p: number): number {
  let lo = 0, hi = a * scale * 20;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (gammaP(a, mid / scale) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Play a game and return every line-year's result plus the enrolled book.
function play(id: string, lines: CoverageLine[], years: number) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'D', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  // ⚠ yearNumber IS CARRIED because both lines now trend. Computing a line-year's
  // analytic at year 1 against a year-5 draw would report a spurious gap — GL's
  // severity trends +5.7026%/yr and WC's frequency and severity both move. This
  // was latent for WC before GL's trend forced every call site to state its year.
  const out: { line: CoverageLine; yearNumber: number; gross: number; expected: number; members: Member[]; exposure: number; gPool: number }[] = [];
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of lines) {
      const x = p.result.byLine[l];
      out.push({ line: l, yearNumber: y, gross: x.grossUltimateLoss, expected: x.expectedLoss, members: x.memberList, exposure: x.writtenExposure, gPool: x.commonLossFactor });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return out;
}

// ============================================================================
if (runs1) {
console.log('=== TEST 1 — is gPool centred at 1.0 through the real engine path? ===\n');
  const { shape, scale } = WC_LOSS_MODEL.poolYearFactor;
  console.log(`  drawn as deriveSubRng(seed, year, 'wc_gpool').gamma(${shape}, ${scale.toFixed(4)})`);
  console.log(`  Gamma(shape=${shape}, scale=1/${1 / scale}) theory: mean ${(shape * scale).toFixed(4)}, sd ${(Math.sqrt(shape) * scale).toFixed(4)}`);
  console.log(`  (if gamma() were mis-reading scale as RATE the mean would be ${(shape * (1 / scale)).toFixed(1)}, not ~1)\n`);

  // Vary seed and year exactly as real games do: hashed 8-char instance ids,
  // years 1..5.
  const N_SEEDS = 20_000, YEARS = 5;
  const draws: number[] = [];
  for (const id of seedIds(N_SEEDS)) {
    const s = seedOf(id);
    for (let y = 1; y <= YEARS; y++) draws.push(deriveSubRng(s, y, 'wc_gpool').gamma(shape, scale));
  }
  const m = mean(draws), s = sd(draws);
  const se = s / Math.sqrt(draws.length);
  console.log(`  n = ${draws.length.toLocaleString()} (${N_SEEDS.toLocaleString()} seeds x ${YEARS} years)`);
  console.log(`  mean   ${m.toFixed(5)}   theory 1.00000   z = ${((m - 1) / se).toFixed(2)}   (SE ${se.toFixed(5)})`);
  console.log(`  sd     ${s.toFixed(5)}   theory ${(Math.sqrt(shape) * scale).toFixed(5)}`);
  const sorted = [...draws].sort((a, b) => a - b);
  console.log(`\n  percentile     empirical      theory      diff`);
  for (const p of [0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99]) {
    const e = pct(sorted, p), t = gammaQuantile(shape, scale, p);
    console.log(`     ${String(Math.round(p * 100)).padStart(3)}%        ${e.toFixed(5)}       ${t.toFixed(5)}    ${(e - t >= 0 ? '+' : '')}${(e - t).toFixed(5)}`);
  }
  const below = draws.filter(d => d < 1).length;
  console.log(`\n  fraction below 1.0: ${(below / draws.length * 100).toFixed(2)}%   theory ${(gammaP(shape, 1 / scale) * 100).toFixed(2)}%`);
  console.log(`  (a right-skewed Gamma has median < mean, so >50% below 1.0 is EXPECTED, not a defect)`);

  // The observed 15 line-years, scored against this distribution.
  const observed = [0.6722, 1.007, 1.083, 1.338, 0.8991, 0.717, 0.855, 0.633, 0.981, 0.643, 0.951, 1.080, 0.705, 0.903, 0.828];
  const om = mean(observed), ose = s / Math.sqrt(observed.length);
  console.log(`\n  the 15 observed line-years: mean ${om.toFixed(4)}, sd ${sd(observed).toFixed(4)}`);
  console.log(`  z of that mean against theory: ${((om - 1) / ose).toFixed(2)}  -> two-sided p ~ ${(2 * (1 - 0.5 * (1 + erf((Math.abs(om - 1) / ose) / Math.SQRT2)))).toFixed(4)}`);
  console.log(`  NOTE: those 15 are only 3 independent SEEDS x 5 years, and gPool is drawn per`);
  console.log(`  seed-year, so they are 15 independent draws — but 15 is a small sample.`);
}
function erf(x: number): number {
  const s = x < 0 ? -1 : 1, ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return s * y;
}

// ============================================================================
// TESTS 2 AND 3 share ONE pass of 50 games; replaying them would double the
// cost for identical books.
const sharedGames: ReturnType<typeof play>[] = [];
if (runs23) for (const id of seedIds(50)) sharedGames.push(play(id, ['WC', 'GL'], 5));
if (runs23) {
console.log('\n\n=== TEST 2 — composition: enrolled book vs what the held pure premium charges ===\n');
  const LINES: CoverageLine[] = ['WC', 'GL'];
  void LINES;
  const wcRatios: number[] = [], glRatios: number[] = [];
  for (const g of sharedGames) {
    for (const r of g) {
      if (!r.members.length || !(r.expected > 0)) continue;
      if (r.line === 'WC') {
        // (a) the enrolled book's OWN analytic expected loss, with its actual
        // class mix, theta at actual RQ, and k_line.
        const own = expectedWcGrossLossForPricing(r.members, { kLine: computeKLine(r.members), yearNumber: r.yearNumber });
        wcRatios.push(own / r.expected);   // (b) = exported Pure Premium
      } else {
        const own = expectedGlGrossLossForPricing(r.members, { yearNumber: r.yearNumber, kGl: computeKGl(r.members, r.yearNumber) });
        glRatios.push(own / r.expected);
      }
    }
  }
  for (const [label, xs] of [['WC', wcRatios], ['GL', glRatios]] as const) {
    const m = mean(xs);
    console.log(`  ${label}  own analytic / exported Pure Premium: mean ${m.toFixed(4)}  sd ${sd(xs).toFixed(4)}  n ${xs.length}`);
    console.log(`      -> the enrolled book's true expected loss is ${((m - 1) * 100).toFixed(2)}% ${m < 1 ? 'BELOW' : 'above'} what it is charged`);
  }
  const combined = mean([...wcRatios, ...glRatios]);
  console.log(`  combined mean ${combined.toFixed(4)}`);
  console.log(`\n  WC's class mix is the thing to watch: pure premium varies 10x across classes`);
  console.log(`  (clerical 0.15 vs fire 1.50 per $1M) and enrolment is exposure-targeted, not`);
  console.log(`  class-neutral, so an enrolled book can be systematically cheaper per dollar.`);
}

// ============================================================================
if (runs23) {
console.log('\n\n=== TEST 3 — does k_line / k_GL fully neutralise RQ on the ENROLLED book? ===\n');
  const LINES: CoverageLine[] = ['WC', 'GL'];
  void LINES;
  const rows: { line: string; rq: number; k: number; product: number; exact: number }[] = [];
  for (const g of sharedGames) {
    for (const r of g) {
      if (!r.members.length) continue;
      const expo = (m: Member) => m.exposureByLine[r.line] ?? 0;
      const totalExpo = r.members.reduce((s, m) => s + expo(m), 0);
      if (!(totalExpo > 0)) continue;
      const wRq = r.members.reduce((s, m) => s + expo(m) * m.riskQuality, 0) / totalExpo;
      const beta = r.line === 'WC' ? WC_LOSS_MODEL.rqFrequencyBeta : 0.055;
      // Naive exposure-weighted mean theta — the quantity that would have to be
      // cancelled if k acted on a simple exposure average.
      const wTheta = r.members.reduce((s, m) => s + expo(m) * Math.exp(-beta * (m.riskQuality - 5)), 0) / totalExpo;
      const k = r.line === 'WC' ? computeKLine(r.members) : computeKGl(r.members, r.yearNumber);
      // The EXACT statement of neutralisation: expected loss at actual RQ,
      // scaled by k, must equal expected loss at neutral RQ.
      const eAct = r.line === 'WC'
        ? expectedWcGrossLossForPricing(r.members, { kLine: k, yearNumber: r.yearNumber })
        : expectedGlGrossLossForPricing(r.members, { yearNumber: r.yearNumber, kGl: k });
      const eNeu = r.line === 'WC'
        ? expectedWcGrossLossForPricing(r.members, { riskQualityOverride: 5, yearNumber: r.yearNumber })
        : expectedGlGrossLossForPricing(r.members, { yearNumber: r.yearNumber, riskQualityOverride: 5 });
      rows.push({ line: r.line, rq: wRq, k, product: wTheta * k, exact: eAct / eNeu });
    }
  }
  for (const line of ['WC', 'GL']) {
    const rs = rows.filter(r => r.line === line);
    console.log(`  ${line}  enrolled exposure-weighted mean RQ ${mean(rs.map(r => r.rq)).toFixed(3)}  (roster mean 5.02)`);
    console.log(`      realized k: mean ${mean(rs.map(r => r.k)).toFixed(4)}  range ${Math.min(...rs.map(r => r.k)).toFixed(4)}-${Math.max(...rs.map(r => r.k)).toFixed(4)}`);
    console.log(`      (exposure-weighted mean theta) x k = ${mean(rs.map(r => r.product)).toFixed(4)}   <- NOT expected to be 1.000; see note`);
    console.log(`      EXACT neutralisation E_actual(k) / E_neutral = ${mean(rs.map(r => r.exact)).toFixed(6)}  (max dev ${Math.max(...rs.map(r => Math.abs(r.exact - 1))).toExponential(1)})`);
  }
  console.log(`\n  NOTE on the two rows. k is DEFINED as E_neutral / E_actual, so the exact ratio is`);
  console.log(`  1.000000 by construction and any deviation would be a bug. The exposure-weighted`);
  console.log(`  product is a DIFFERENT quantity: k neutralises theta under the EXPECTATION's own`);
  console.log(`  weights (class payroll x class rate for WC, relativity x rate for GL), not under a`);
  console.log(`  flat exposure average. The gap between the two rows is the weighting mismatch, and`);
  console.log(`  it does NOT indicate over- or under-correction of the loss level.`);
}

// ============================================================================
if (runs4) {
console.log('\n\n=== TEST 4 — realized vs exported Pure Premium through the GAME path ===\n');
  const LINES: CoverageLine[] = ['WC', 'GL'];
  const N = 200;
  const perSeed: { wc: number; gl: number; all: number }[] = [];
  let tWcG = 0, tWcE = 0, tGlG = 0, tGlE = 0;
  for (const id of seedIds(N)) {
    let sWcG = 0, sWcE = 0, sGlG = 0, sGlE = 0;
    for (const r of play(id, LINES, 5)) {
      if (r.line === 'WC') { sWcG += r.gross; sWcE += r.expected; }
      else { sGlG += r.gross; sGlE += r.expected; }
    }
    tWcG += sWcG; tWcE += sWcE; tGlG += sGlG; tGlE += sGlE;
    perSeed.push({
      wc: sWcE > 0 ? sWcG / sWcE : 1,
      gl: sGlE > 0 ? sGlG / sGlE : 1,
      all: (sWcE + sGlE) > 0 ? (sWcG + sGlG) / (sWcE + sGlE) : 1,
    });
  }
  const report = (label: string, xs: number[], pooled: number) => {
    const ci = 1.96 * sd(xs) / Math.sqrt(xs.length);
    const m = mean(xs);
    const covers1 = Math.abs(m - 1) <= ci;
    console.log(`  ${label.padEnd(9)} pooled ${pooled.toFixed(4)}   per-seed mean ${m.toFixed(4)} +/-${ci.toFixed(4)} (95%)   ${covers1 ? 'CI COVERS 1.00' : 'CI EXCLUDES 1.00'}`);
    console.log(`            per-seed sd ${sd(xs).toFixed(4)}, min ${Math.min(...xs).toFixed(3)}, max ${Math.max(...xs).toFixed(3)}`);
  };
  console.log(`  ${N} five-year games, WC + GL, default decisions (matching the observed runs)\n`);
  report('WC', perSeed.map(p => p.wc), tWcG / tWcE);
  report('GL', perSeed.map(p => p.gl), tGlG / tGlE);
  report('COMBINED', perSeed.map(p => p.all), (tWcG + tGlG) / (tWcE + tGlE));
  console.log(`\n  totals: WC gross ${fmt$(tWcG)} vs expected ${fmt$(tWcE)}; GL gross ${fmt$(tGlG)} vs expected ${fmt$(tGlE)}`);
  const obs = [0.912, 0.757, 0.701];
  const all = perSeed.map(p => p.all).sort((a, b) => a - b);
  console.log(`\n  the three observed games (0.912 / 0.757 / 0.701, mean 0.790) sit at percentiles`);
  console.log(`  ${obs.map(o => `${(all.filter(x => x < o).length / all.length * 100).toFixed(0)}%`).join(' / ')} of this distribution`);
  console.log(`  ${all.filter(x => x <= 0.790).length}/${all.length} games (${(all.filter(x => x <= 0.790).length / all.length * 100).toFixed(1)}%) came in at or below 0.790`);
}

console.log('\n\nDIAGNOSTIC COMPLETE — no parameter, constant or generator was changed.');
