// PER-OCCURRENCE CEDED/RETAINED MOMENTS FOR THE REINSURANCE TOWER — the closed
// form that replaced six frozen constants.
//
// ============================================================================
// WHY THIS MODULE EXISTS: sdOverExpected WAS NEVER A RATE-CARD QUANTITY.
//
// The tower used to price off two stored per-layer constants,
// `expectedCededPer100` and `sdOverExpected`. The first freezes legitimately —
// a per-occurrence layer's expected ceded loss is LINEAR in exposure, because
// only occurrence FREQUENCY scales with the book while E[ceded per occurrence]
// is exposure-invariant. The second does NOT:
//
//   SD/E scales as ~1/sqrt(exposure), so ITS BASIS IS ITS VALUE.
//
// Measured on GL's $4M xs $1M band, analytically:
//   $87M book (10 members)     SD/E 1.581
//   $380M book (55 members)    SD/E 0.776     <- where the stored 0.97 sat
//   $1300M book (200, full)    SD/E 0.452
//   $26,000M book (4,000)      SD/E 0.220
//
// Frozen at one book's value, the risk load is wrong everywhere else — and
// wrong in the WORST direction. Holding GL's 4xs1 SD/E at the stored 0.97:
//   $82M pool     true 1.976x    frozen 1.582x    -19.9%  UNDERCHARGED
//   $1300M pool   true 1.271x    frozen 1.582x    +24.5%  overcharged
// The pools with the least surplus behind the retention were paying the least
// for it. That is a larger error than the trend drift this commit also fixes,
// and unlike the drift it does not need ten years to appear.
//
// The two lines were additionally on DIFFERENT bases for the same field: GL's
// stored SD/E was measured on a ~$380M enrolled book, WC's full-market.
// ============================================================================
//
// WHAT IS COMPUTED HERE, AND ON WHAT BASIS.
//
// NEUTRAL RISK QUALITY (RQ 5), deliberately, and this is a DELIBERATE
// NON-CHANGE. The retired constants were a neutral-RQ rate card
// (reinsuranceTower.ts's derivation note, and the retired wc-tower-rederive's "a per-$100
// rate card should not carry one book's risk-quality mix"). Keeping that basis
// means the ONLY things this commit changes about the price are the two that
// were actually broken — responsiveness to the YEAR and to the BOOK'S SIZE.
// Moving to actual RQ would additionally put the severity TILT into a price,
// which invariant 2 forbids (tilt is draw-and-k_line only, never pricing), and
// would confound three changes where the plan approved two.
//
// THE BOOK'S RATING-GROUP AND REGION MIX *is* now reflected, for WC, because the
// computation walks the actual enrolled members. wc-tower-rederive recorded
// that the frozen constant "does not correct for a book that is unusually
// safety-heavy" as a known limitation; walking the book removes it for free.
// GL has no such dimension — its rate and mixture are flat across member types
// — so GL's expected ceded PER $100 is exactly roster-blind, a pure function of
// the year.
//
// ⚠ THE MEMO KEY IS THE DANGEROUS PART OF THIS MODULE. A wrong key silently
// prices one year's tower with another year's moments, and every downstream
// figure stays self-consistent, so no value gate would catch it. The key must
// capture EXACTLY what the cached value depends on, no more and no less:
//
//   band moments depend on: line, layer bounds, SEVERITY-trended year,
//                           and (WC only) rating group + region
//   they do NOT depend on:  the book, exposure, frequency trend, RQ
//
// The frequency trend is applied OUTSIDE the cache, in the accumulation, which
// is why it is absent from the key. And the year is FLOORED before keying,
// because wcSeverityTrend/glSeverityTrend both floor at year 1 — so year -2 and
// year 1 are genuinely the same moments and must share a slot rather than
// occupying two that could drift apart.
//
// scripts/diagnostics/tower-runtime-check.ts asserts all of this on every run:
// cold-cache and warm-cache interleaved evaluation must agree exactly, distinct
// years must produce distinct values, and year 1 full-market must reproduce the
// closed-form reference literals.

import {
  GL_LOSS_MODEL,
  GL_SEVERITY_CAP,
  GL_SEVERITY_COMPONENTS,
  WC_LOSS_MODEL,
  WC_RATING_GROUPS,
  WC_SEVERITY_COMPONENTS,
  type WcRatingGroup,
} from '../data/defaultAssumptions';
import { REINSURANCE_TOWER, TOWER_TOP, type TowerLine } from '../data/reinsuranceTower';
import { normalCdf } from './claimMath';
import { glSeverityTrend, thetaGl, untiltedGlWeights } from './glClaimEngine';
import { ratingGroupOf, regionMultiplier, thetaWc, trendedMu, wcFrequencyTrend } from './wcClaimEngine';
import type { Member, Region } from '../types/simulation';

const GM = GL_LOSS_MODEL;
const WM = WC_LOSS_MODEL;

// gPool's variance. GL's generator multiplies EVERY member's rate by one shared
// Gamma(25, 1/25) draw per year; WC's equivalent (commonLossFactor) is pinned to
// 1, so WC has no analogous term. This is the whole reason GL's SD/E has a floor
// and WC's does not — see layerRiskMoments.
const VG = 1 / WM.poolYearFactor.shape;
const GL_ALPHA_FREQ = GM.memberFrequencyNoise.shape;
const WC_ALPHA_FREQ = WM.memberFrequencyNoise.shape;

// Index lookups as RECORDS, not Array.indexOf. These run once per member per
// layer on the pricing path; an indexOf is a linear scan with string compares
// and it showed up as a measurable share of the cold-key cost.
const REGIONS: Region[] = ['North', 'Central', 'South'];
const REGION_INDEX: Record<Region, number> = { North: 0, Central: 1, South: 2 };
const GROUP_INDEX: Record<WcRatingGroup, number> =
  WC_RATING_GROUPS.reduce((acc, g, i) => { acc[g] = i; return acc; }, {} as Record<WcRatingGroup, number>);
const NEUTRAL_RQ = 5;

// E[X^k x 1{X <= t}] for X ~ LogNormal(mu, sigma) — the mu/sigma-parameterized
// partial moment. claimMath's lognormalPartialMoment takes (mean, cv); every
// mixture component here is already stated as (mu, sigma), so converting to
// (mean, cv) and back would add a round trip and a rounding step for nothing.
function partialMoment(mu: number, sigma: number, k: number, t: number): number {
  const full = Math.exp(k * mu + (k * k * sigma * sigma) / 2);
  if (!(t > 0)) return 0;
  if (!Number.isFinite(t)) return full;
  return full * normalCdf((Math.log(t) - mu - k * sigma * sigma) / sigma);
}

export interface BandMoments {
  m1: number;   // E[ceded to this band, per occurrence]
  m2: number;   // E[(ceded to this band)^2, per occurrence]
}

// --- the memo -----------------------------------------------------------------
//
// NUMERIC keys, module level. Both properties matter for the performance budget:
// numeric because building 600 string keys per line-year dominated the cost when
// this was prototyped (1,164 us naive -> 288 us with a per-call string-keyed
// Map -> under budget only once the cache persisted across calls with an integer
// key), and module level because a per-call cache only ever saves work WITHIN one
// call and rebuilds the same 12 entries on the next.
const glBandCache = new Map<number, BandMoments[]>();
const wcBandCache = new Map<number, BandMoments[]>();

// Exported for the harness, which must be able to force a cold cache to prove
// warm and cold agree. Nothing in the engine calls this.
export function resetTowerMomentCache(): void {
  glBandCache.clear();
  wcBandCache.clear();
  edgeMomentCache.clear();
}

// Both severity trends floor at year 1 (see wcSeverityTrend / glSeverityTrend).
// Keying on the RAW year would give year -2 and year 1 separate slots holding
// identical values — harmless today, and exactly the kind of near-duplicate that
// later drifts. Key on what the value actually depends on.
const severityYearKey = (yearNumber: number) => Math.max(1, Math.floor(yearNumber));

// GL: one flat mixture for every member, capped at GL_SEVERITY_CAP.
//
// ⚠ THE CAP IS EXACTLY IRRELEVANT TO EVERY BAND INSIDE THE TOWER, and that is
// worth stating because it looks like it should matter. Every GL layer bound is
// <= $25M, the cap is $100M, and min(X, 100M) > 25M exactly when X > 25M — so a
// cession inside the tower is bit-identical capped or uncapped (verified: 0.0e+0
// relative difference). The cap reaches only the retained band ABOVE the tower,
// which it bounds at $75M per occurrence. GL_SEVERITY_CAP is therefore NOT in
// the tower's invalidation list.
// One component's M0/M1/M2 at every tower edge. THIS is the unit that repeats:
// WC's four rating groups draw from only FOUR distinct severity components
// between them (small, medium, large, schoolsMedium) across 11 group-component
// pairs, so keying the cache by GROUP recomputed the same component's moments up
// to three times per region. Keyed by (component identity, region, year) it is
// computed once and read by every group that uses it.
interface EdgeMoments { M0: Float64Array; M1: Float64Array; M2: Float64Array; }
const edgeMomentCache = new Map<string, EdgeMoments>();

function edgeMomentsFor(mu: number, sigma: number, edges: number[], cacheKey: string | null): EdgeMoments {
  if (cacheKey) { const hit = edgeMomentCache.get(cacheKey); if (hit) return hit; }
  const n = edges.length;
  const M0 = new Float64Array(n), M1 = new Float64Array(n), M2 = new Float64Array(n);
  const s2 = sigma * sigma;
  // Both scale factors depend only on the component, not the edge — computed
  // once here rather than once per (edge, k), which is twelve Math.exp calls
  // saved per component on a four-edge tower.
  const e1 = Math.exp(mu + s2 / 2);
  const e2 = Math.exp(2 * mu + 2 * s2);
  for (let i = 0; i < n; i++) {
    const t = edges[i];
    if (!(t > 0)) { M0[i] = 0; M1[i] = 0; M2[i] = 0; continue; }
    if (!Number.isFinite(t)) { M0[i] = 1; M1[i] = e1; M2[i] = e2; continue; }
    // ln(t) once, shared across k = 0, 1, 2.
    const z = (Math.log(t) - mu) / sigma;
    M0[i] = normalCdf(z);
    M1[i] = e1 * normalCdf(z - sigma);
    M2[i] = e2 * normalCdf(z - 2 * sigma);
  }
  const out = { M0, M1, M2 };
  if (cacheKey) edgeMomentCache.set(cacheKey, out);
  return out;
}

// ALL LAYERS AT ONCE, SHARING EDGE EVALUATIONS. The tower's bands are contiguous
// — WC's $4M xs $1M tops out at exactly $5M, where $5M xs $5M attaches — so
// evaluating each layer independently recomputes the partial moments at every
// shared boundary.
function bandMomentsForEdges(
  comps: { mu: number; sigma: number; weight: number; cacheKey: string | null }[],
  bounds: { lo: number; hi: number }[],
): BandMoments[] {
  const edges = [...new Set(bounds.flatMap(b => [b.lo, b.hi]))].sort((a, b) => a - b);
  const idx = new Map<number, number>(edges.map((e, i) => [e, i]));
  const out = bounds.map(() => ({ m1: 0, m2: 0 }));

  for (const c of comps) {
    const { M0, M1, M2 } = edgeMomentsFor(c.mu, c.sigma, edges, c.cacheKey);
    for (let k = 0; k < bounds.length; k++) {
      const b = bounds[k];
      const a = idx.get(b.lo)!, z = idx.get(b.hi)!;
      const width = b.hi - b.lo;
      const survives = 1 - M0[z];
      const t1 = Number.isFinite(width) ? width * survives : 0;
      const t2 = Number.isFinite(width) ? width * width * survives : 0;
      out[k].m1 += c.weight * Math.max(0, (M1[z] - M1[a]) - b.lo * (M0[z] - M0[a]) + t1);
      out[k].m2 += c.weight * Math.max(0,
        (M2[z] - M2[a]) - 2 * b.lo * (M1[z] - M1[a]) + b.lo * b.lo * (M0[z] - M0[a]) + t2);
    }
  }
  return out;
}

// GL: one flat mixture for every member, capped at GL_SEVERITY_CAP.
//
// ⚠ THE CAP IS EXACTLY IRRELEVANT TO EVERY BAND INSIDE THE TOWER, and that is
// worth stating because it looks like it should matter. Every GL layer bound is
// <= $25M, the cap is $100M, and min(X, 100M) > 25M exactly when X > 25M — so a
// cession inside the tower is bit-identical capped or uncapped (verified: 0.0e+0
// relative difference). The cap reaches only the retained band ABOVE the tower,
// which it bounds at $75M per occurrence. GL_SEVERITY_CAP is therefore NOT in
// the tower's invalidation list.
function glBandMomentsAll(yearNumber: number): BandMoments[] {
  const yk = severityYearKey(yearNumber);
  const hit = glBandCache.get(yk);
  if (hit) return hit;
  const weights = untiltedGlWeights();
  const shift = Math.log(glSeverityTrend(yk));
  const comps = GL_SEVERITY_COMPONENTS.map((c, j) => ({
    mu: c.mu + shift, sigma: c.sigma, weight: weights[j], cacheKey: `gl|${c.key}|${yk}`,
  }));
  const bounds = REINSURANCE_TOWER.GL.map(l => ({
    lo: Math.min(l.attachment, GL_SEVERITY_CAP),
    hi: Math.min(l.attachment + l.limit, GL_SEVERITY_CAP),
  }));
  const out = bandMomentsForEdges(comps, bounds);
  glBandCache.set(yk, out);
  return out;
}

// WC: per rating group AND region (region enters as a multiplicative severity
// scale, i.e. a log-location shift, so it changes the band moments). 4 groups x
// 3 regions = 12 distinct entries per year.
function wcBandMomentsAll(yearNumber: number, group: WcRatingGroup, region: Region): BandMoments[] {
  const yk = severityYearKey(yearNumber);
  const key = (GROUP_INDEX[group] * 3 + REGION_INDEX[region]) + 16 * yk;
  const hit = wcBandCache.get(key);
  if (hit) return hit;
  const spec = WM.ratingGroups[group];
  const shift = Math.log(regionMultiplier(region));
  // UNTILTED group weights — the pricing basis (invariant 2). tiltedWeights is
  // the draw/k_line basis and must not reach a price.
  const comps = spec.mix.map(({ component, weight }) => {
    const c = WC_SEVERITY_COMPONENTS[component];
    // Keyed by COMPONENT and region, not by rating group — four groups share
    // four components across eleven pairs, so this is where the reuse is.
    return { mu: trendedMu(c.mu, yk) + shift, sigma: c.sigma, weight, cacheKey: `wc|${component}|${region}|${yk}` };
  });
  const bounds = REINSURANCE_TOWER.WC.map(l => ({ lo: l.attachment, hi: l.attachment + l.limit }));
  const out = bandMomentsForEdges(comps, bounds);
  wcBandCache.set(key, out);
  return out;
}

// Single-layer accessors, kept for the harness (which probes one band at a time
// to prove the memo key separates them).
export function glBandMoments(layerIndex: number, yearNumber: number): BandMoments {
  return glBandMomentsAll(yearNumber)[layerIndex];
}
export function wcBandMoments(layerIndex: number, yearNumber: number, group: WcRatingGroup, region: Region): BandMoments {
  return wcBandMomentsAll(yearNumber, group, region)[layerIndex];
}

// --- aggregation over a book ---------------------------------------------------

export interface LayerRiskMoments {
  expected: number;          // E[annual ceded to this layer], dollars
  sd: number;                // SD[annual ceded to this layer], dollars
  sdOverExpected: number;
  lambda: number;            // expected annual occurrence count for the book
}

// One member's expected annual occurrence count, at NEUTRAL risk quality.
//
// GL frequency reads REAL (frozen) payroll and carries no frequency trend; WC
// reads real payroll and DOES carry wcFrequencyTrend, which — unlike the
// severity trend — does not floor at year 1. Getting these two the wrong way
// round is the same defect class as finding 37, so both are read from the
// line's own engine rather than restated here.
function memberLambda(line: TowerLine, member: Member, yearNumber: number): number {
  if (line === 'GL') {
    const payroll = member.exposureByLine.GL ?? 0;
    return payroll <= 0 ? 0 : payroll * GM.ratePer1M * thetaGl(NEUTRAL_RQ);
  }
  const payroll = member.exposureByLine.WC ?? 0;
  if (payroll <= 0) return 0;
  const spec = WM.ratingGroups[ratingGroupOf(member)];
  return payroll * spec.ratePer1M * thetaWc(NEUTRAL_RQ) * wcFrequencyTrend(yearNumber);
}

// THE COMPOUND-SUM VARIANCE, and it is NOT the same formula on both lines.
//
// Conditional on the shared factor g, members are independent and each one's
// annual ceded loss is an ordinary Gamma-mixed compound Poisson:
//   E[C_i | g] = g x lambda_i x m1
//   Var(C_i|g) = g x lambda_i x m2 + (g x lambda_i x m1)^2 / alpha_freq
// Summing over independent members and mixing over g ~ Gamma(shape, 1/shape),
// E[g] = 1, Var(g) = Vg, by the law of total variance:
//   Var(C) = A2 + B2 x (1 + Vg) + A1^2 x Vg
// with A1 = sum lambda_i m1, A2 = sum lambda_i m2, B2 = sum (lambda_i m1)^2/alpha.
//
// ⚠ GL HAS Vg = 1/25; WC HAS Vg = 0, because WC pins commonLossFactor to 1.
// The consequence is structural, not a detail: the A1^2 x Vg term does not
// diversify (it scales as exposure^2 against an exposure^2 denominator), so
//   GL's SD/E floors at exactly sqrt(1/25) = 0.2000 and approaches it from above
//   WC's SD/E decays toward 0 with no floor at all
// Same code, different limit. Asserted in tower-runtime-check.ts, in both
// directions — the floor is real, and it is NOT binding at any playable book
// size (GL full-market 4xs1 sits at 0.452 against the 0.200 floor; it only
// dominates past ~$26B of payroll).
// EVERY LAYER IN ONE PASS OVER THE BOOK. Pricing a program means pricing all
// three layers, and doing that as three independent calls walked the member list
// three times, re-resolving each member's rating group and lambda each time. One
// pass with an inner layer loop is the same arithmetic with a third of the
// member-level work; layerRiskMoments below delegates here so single-layer
// callers cannot drift from the program price.
export function allLayerRiskMoments(
  line: TowerLine,
  members: Member[],
  yearNumber: number,
): LayerRiskMoments[] {
  const layers = REINSURANCE_TOWER[line];
  const n = layers.length;
  const vg = line === 'GL' ? VG : 0;
  const alphaFreq = line === 'GL' ? GL_ALPHA_FREQ : WC_ALPHA_FREQ;

  // THE BOOK IS COLLAPSED TO ITS SUFFICIENT STATISTICS BEFORE ANY BAND MOMENT IS
  // TOUCHED. Every term in the variance depends on the members only through two
  // sums per (rating group, region) cell:
  //
  //   A1 = sum_i lambda_i m1        = sum_cells (sum lambda) x m1_cell
  //   A2 = sum_i lambda_i m2        = sum_cells (sum lambda) x m2_cell
  //   B2 = sum_i (lambda_i m1)^2/a  = sum_cells (sum lambda^2) x m1_cell^2 / a
  //
  // B2 needs the sum of SQUARES, which is why both are accumulated rather than
  // just the total — it does not factor out of a single total the way A1 and A2
  // do. With that, a 200-member book costs 200 cheap accumulations plus at most
  // 12 x 3 cached band lookups, instead of 200 x 3 lookups. GL has exactly one
  // cell (flat mixture, no group or region dimension).
  const CELLS = line === 'GL' ? 1 : WC_RATING_GROUPS.length * 3;
  const sumLam = new Float64Array(CELLS);
  const sumLamSq = new Float64Array(CELLS);
  let lambda = 0;

  // ⚠ THE YEAR FACTORS ARE HOISTED. wcFrequencyTrend is a Math.pow and thetaGl a
  // Math.exp, both of loop-INVARIANT arguments — calling them per member cost
  // more than every band moment in the function put together. thetaGl(5) is
  // identically 1 (neutral RQ is the exponent's own origin), so GL's rate needs
  // no per-member risk-quality term at all on this basis.
  const wcTrend = line === 'WC' ? wcFrequencyTrend(yearNumber) : 1;
  const wcTheta = line === 'WC' ? thetaWc(NEUTRAL_RQ) : 1;
  const glRate = line === 'GL' ? GM.ratePer1M * thetaGl(NEUTRAL_RQ) : 0;

  for (const member of members) {
    let lam: number, cell: number;
    if (line === 'GL') {
      const payroll = member.exposureByLine.GL ?? 0;
      if (payroll <= 0) continue;
      lam = payroll * glRate;
      cell = 0;
    } else {
      const payroll = member.exposureByLine.WC ?? 0;
      if (payroll <= 0) continue;
      const group = ratingGroupOf(member);
      lam = payroll * WM.ratingGroups[group].ratePer1M * wcTheta * wcTrend;
      cell = GROUP_INDEX[group] * 3 + REGION_INDEX[member.region];
    }
    if (lam <= 0) continue;
    lambda += lam;
    sumLam[cell] += lam;
    sumLamSq[cell] += lam * lam;
  }

  const A1 = new Float64Array(n), A2 = new Float64Array(n), B2 = new Float64Array(n);
  for (let cell = 0; cell < CELLS; cell++) {
    if (sumLam[cell] === 0) continue;
    const bands = line === 'GL'
      ? glBandMomentsAll(yearNumber)
      : wcBandMomentsAll(yearNumber, WC_RATING_GROUPS[Math.floor(cell / 3)], REGIONS[cell % 3]);
    for (let i = 0; i < n; i++) {
      const { m1, m2 } = bands[i];
      A1[i] += sumLam[cell] * m1;
      A2[i] += sumLam[cell] * m2;
      B2[i] += sumLamSq[cell] * m1 * m1 / alphaFreq;
    }
  }
  const out: LayerRiskMoments[] = [];
  for (let i = 0; i < n; i++) {
    const variance = A2[i] + B2[i] * (1 + vg) + A1[i] * A1[i] * vg;
    const sd = Math.sqrt(Math.max(0, variance));
    out.push({ expected: A1[i], sd, sdOverExpected: A1[i] > 0 ? sd / A1[i] : 0, lambda });
  }
  return out;
}

export function layerRiskMoments(
  line: TowerLine,
  layerIndex: number,
  members: Member[],
  yearNumber: number,
): LayerRiskMoments {
  return allLayerRiskMoments(line, members, yearNumber)[layerIndex];
}

// --- retained-loss moments, for the aggregate stop-loss -------------------------

// Retained loss per occurrence is PIECEWISE LINEAR in the occurrence total: on
// each band it is either passed through (retained) or flat (ceded). Its second
// moment is therefore exactly integrable band by band — no lognormal
// approximation at this level, and no stored table.
//
// On band k spanning [b_k, b_{k+1}), retained(t) = c_k + s_k x (t - b_k), where
// s_k is 1 if the band is retained and 0 if it is ceded, and c_k accumulates the
// retained amount from all lower bands. Writing it as alpha x t + beta with
// alpha = s_k and beta = c_k - s_k b_k:
//   E[retained^2 1{band k}] = alpha^2 M2 + 2 alpha beta M1 + beta^2 M0
// over that band's partial moments. Everything above the tower top is always
// retained (there is no layer to cede it to), and for GL that final band is
// BOUNDED by GL_SEVERITY_CAP rather than running to infinity.
export function retainedOccurrenceMoments(
  line: TowerLine,
  placed: boolean[],
  yearNumber: number,
  group?: WcRatingGroup,
  region?: Region,
): BandMoments {
  const layers = REINSURANCE_TOWER[line];
  const yk = severityYearKey(yearNumber);

  // Breakpoints: 0, each attachment, each layer top, then the tower top, then the
  // ceiling (the cap for GL, infinity for WC).
  const edges: number[] = [0];
  for (const l of layers) {
    if (!edges.includes(l.attachment)) edges.push(l.attachment);
    if (!edges.includes(l.attachment + l.limit)) edges.push(l.attachment + l.limit);
  }
  if (!edges.includes(TOWER_TOP[line])) edges.push(TOWER_TOP[line]);
  edges.sort((a, b) => a - b);
  const ceiling = line === 'GL' ? GL_SEVERITY_CAP : Number.POSITIVE_INFINITY;
  edges.push(ceiling);

  // Which layer, if any, covers the band starting at `from`?
  const cededBand = (from: number) =>
    layers.findIndex((l, i) => placed[i] && l.purchasable && from >= l.attachment && from < l.attachment + l.limit);

  // Component list differs by line; both are (mu, sigma, weight) triples once the
  // trend, region and group are resolved.
  const comps: { mu: number; sigma: number; weight: number }[] = [];
  if (line === 'GL') {
    const w = untiltedGlWeights();
    const shift = Math.log(glSeverityTrend(yk));
    GL_SEVERITY_COMPONENTS.forEach((c, j) => comps.push({ mu: c.mu + shift, sigma: c.sigma, weight: w[j] }));
  } else {
    const spec = WM.ratingGroups[group ?? 'county'];
    const shift = Math.log(regionMultiplier(region ?? 'Central'));
    spec.mix.forEach(({ component, weight }) => {
      const c = WC_SEVERITY_COMPONENTS[component];
      comps.push({ mu: trendedMu(c.mu, yk) + shift, sigma: c.sigma, weight });
    });
  }

  let m1 = 0, m2 = 0;
  for (const comp of comps) {
    let c = 0;   // retained accumulated at the current band's lower edge
    let cm1 = 0, cm2 = 0;
    for (let k = 0; k < edges.length - 1; k++) {
      const lo = edges[k], hi = edges[k + 1];
      if (hi <= lo) continue;
      const s = cededBand(lo) >= 0 ? 0 : 1;
      const beta = c - s * lo;
      const M0 = partialMoment(comp.mu, comp.sigma, 0, hi) - partialMoment(comp.mu, comp.sigma, 0, lo);
      const M1 = partialMoment(comp.mu, comp.sigma, 1, hi) - partialMoment(comp.mu, comp.sigma, 1, lo);
      const M2 = partialMoment(comp.mu, comp.sigma, 2, hi) - partialMoment(comp.mu, comp.sigma, 2, lo);
      cm1 += s * M1 + beta * M0;
      cm2 += s * s * M2 + 2 * s * beta * M1 + beta * beta * M0;
      c += s * (Number.isFinite(hi) ? hi - lo : 0);
    }
    // Mass at or above the ceiling: for GL every claim there is exactly the cap,
    // retained down to whatever the tower does not cover. For WC the ceiling is
    // infinite and the loop above already integrated to it.
    if (Number.isFinite(ceiling)) {
      const tail = 1 - partialMoment(comp.mu, comp.sigma, 0, ceiling);
      cm1 += c * tail;
      cm2 += c * c * tail;
    }
    m1 += comp.weight * cm1;
    m2 += comp.weight * cm2;
  }
  return { m1, m2 };
}

// Book-level retained moments: expected annual retained loss and its SD, on the
// same neutral-RQ basis and with the same gPool mixing as layerRiskMoments.
export function retainedRiskMoments(
  line: TowerLine,
  placed: boolean[],
  members: Member[],
  yearNumber: number,
): LayerRiskMoments {
  const vg = line === 'GL' ? VG : 0;
  const alphaFreq = line === 'GL' ? GL_ALPHA_FREQ : WC_ALPHA_FREQ;
  let A1 = 0, A2 = 0, B2 = 0, lambda = 0;

  const flat = line === 'GL' ? retainedOccurrenceMoments('GL', placed, yearNumber) : null;
  for (const member of members) {
    const lam = memberLambda(line, member, yearNumber);
    if (lam <= 0) continue;
    const { m1, m2 } = flat ?? retainedOccurrenceMoments('WC', placed, yearNumber, ratingGroupOf(member), member.region);
    lambda += lam;
    const a1 = lam * m1;
    A1 += a1; A2 += lam * m2; B2 += (a1 * a1) / alphaFreq;
  }
  const variance = A2 + B2 * (1 + vg) + A1 * A1 * vg;
  const sd = Math.sqrt(Math.max(0, variance));
  return { expected: A1, sd, sdOverExpected: A1 > 0 ? sd / A1 : 0, lambda };
}
