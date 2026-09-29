// PROPERTY'S CATASTROPHE BAND — the EXACT event-loss distribution, and every
// price that reads it.
//
// ============================================================================
// WHY THIS IS EXACT, AND WHY THAT IS A REQUIREMENT RATHER THAN A NICETY.
//
// PROPERTY_CAT_MODEL fixes each member's loss when hit, so a member is a
// two-point variable {0 w.p. 1-f, L_i w.p. f}, and one event's gross loss is:
//
//   pick a region r with probability w_r, then sum r's members' two-point draws
//
// Its distribution is therefore a MIXTURE over three regions of a CONVOLUTION
// of two-point distributions — no sampling needed, and none is done. Built
// that way it is bit-reproducible: the same book gives the same array to the
// last bit on every call, which every baseline in this project asserts.
//
// The sampled alternative was measured and rejected. At 400,000 event draws its
// far tail was ~30% light at two different seeds (P(event retained > $150M)),
// which priced the remote aggregate stop ~5% cheap; a 4,000,000-draw run
// converged onto THIS construction within 2 SE at every threshold. And a
// sampled price depends on a seed and on how many draws precede it, so any
// upstream change would move every baseline — the failure class the
// per-member stream keying was introduced to end.
//
// ⚠ ONE APPROXIMATION REMAINS, AND IT IS MEAN-PRESERVING. A member's L_i does
// not generally fall on the $25k lattice, so it is SPLIT between its two
// bounding lattice points in the proportion that keeps its mean — the same
// construction propertyAggregate's Gerber discretisation uses for the
// attritional severity. E[event gross] on the lattice equals the closed form to
// float precision. Retention ($37.5M) and ceiling ($500M) are lattice points,
// so the per-event retained/ceded mapping adds no further approximation.
//
// ⚠ MEMBERS ARE CONVOLVED IN A FIXED ORDER — BY id — NOT IN ROSTER ORDER.
// Convolution is commutative in exact arithmetic and not in floating point: a
// roster reordered by an unrelated change would move the last bit of every
// price here. Sorting first makes the array a function of the book's CONTENT.
//
// ⚠ CACHED BY BOOK, NOT BY PLACEMENT. The event distribution depends on the
// enrolled members and the footprint and on nothing the player decides this
// turn — the Decisions panel re-quotes on every render and must not rebuild
// it. The key is the book's content (id, region, loss-if-hit), which is
// stricter than a year key: a year whose book changed mid-turn cannot be served
// a stale distribution.
// ============================================================================

import { PROPERTY_CAT_MODEL } from '../data/defaultAssumptions';
import type { Member, Region } from '../types/simulation';

const C = PROPERTY_CAT_MODEL;

// THE LATTICE. Shared with propertyAggregate — the combined attritional + cat
// convolution needs both distributions on one lattice, so that module reads
// this constant rather than keeping its own.
export const PROPERTY_LATTICE_BIN = 25_000;

export const CAT_REGIONS: readonly Region[] = ['North', 'Central', 'South'];

// What a member loses when an event hits it. TIV is stored in $M
// (exposureByLine.Property), hence the 1e6 — getting this wrong prices a
// catastrophe a million times too small and still produces plausible-looking
// arrays.
export function catLossIfHit(member: Member): number {
  const tiv = member.exposureByLine.Property ?? 0;
  if (!(tiv > 0)) return 0;
  return C.damageRatio * member.primaryAssetShare * tiv * 1e6;
}

// A member's own expected annual cat loss: events x P(its region) x P(hit) x L.
// ADDITIVE over members — which is what keeps the book's cat AAL independent
// of who else is enrolled.
export function memberExpectedCatLoss(member: Member): number {
  const w = C.regionWeights[member.region as keyof typeof C.regionWeights] ?? 0;
  return C.eventsPerYear * w * C.footprint * catLossIfHit(member);
}

export function expectedPropertyCatLoss(members: Member[]): number {
  let total = 0;
  for (const m of sortedCatBook(members)) total += memberExpectedCatLoss(m);
  return total;
}

function sortedCatBook(members: Member[]): Member[] {
  return members
    .filter(m => catLossIfHit(m) > 0)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface CatEventDistribution {
  bin: number;
  // P(one event's GROSS loss = k x bin), k = 0..pmf.length-1. Mass at 0 is real:
  // an event can strike a region where no enrolled member is hit.
  pmf: Float64Array;
  // Closed-form E[event gross], for the harness to hold the lattice against.
  expectedGross: number;
}

// Bounded cache — a game touches a handful of books a year and the Decisions
// panel re-reads the same one; 16 slots is ample and cannot grow without bound
// across a long session.
const CACHE_SLOTS = 16;
const eventCache = new Map<string, CatEventDistribution>();

// THE EXACT EVENT GROSS DISTRIBUTION.
//
// Per region, each member's two-point variable is folded in IN PLACE, walking
// the occupied range from the top down: every write lands at or above the index
// being read, so no source value is overwritten before it is used and no
// per-member array is allocated.
export function catEventGrossDistribution(members: Member[], bin = PROPERTY_LATTICE_BIN): CatEventDistribution {
  const book = sortedCatBook(members);
  const key = `${bin}|` + book.map(m => `${m.id}:${m.region}:${catLossIfHit(m)}`).join(',');
  const hit = eventCache.get(key);
  if (hit) return hit;

  const f = C.footprint;
  // Lattice length: each member moves the top by floor(L/bin) + 1 at most.
  let maxTop = 0;
  for (const r of CAT_REGIONS) {
    let top = 0;
    for (const m of book) if (m.region === r) top += Math.floor(catLossIfHit(m) / bin) + 1;
    maxTop = Math.max(maxTop, top);
  }
  const pmf = new Float64Array(maxTop + 1);
  const g = new Float64Array(maxTop + 1);
  let expectedGross = 0;

  for (const r of CAT_REGIONS) {
    const w = C.regionWeights[r as keyof typeof C.regionWeights];
    g.fill(0);
    g[0] = 1;
    let top = 0;
    let regionLoss = 0;
    for (const m of book) {
      if (m.region !== r) continue;
      const L = catLossIfHit(m);
      regionLoss += L;
      const x = L / bin;
      const lo = Math.floor(x);
      const frac = x - lo;
      const pLo = f * (1 - frac), pHi = f * frac;
      for (let k = top; k >= 0; k--) {
        const p = g[k];
        if (p === 0) continue;
        g[k] = p * (1 - f);
        g[k + lo] += p * pLo;
        if (pHi > 0) g[k + lo + 1] += p * pHi;
      }
      top += lo + 1;
    }
    for (let k = 0; k <= top; k++) pmf[k] += w * g[k];
    expectedGross += w * f * regionLoss;
  }

  const out: CatEventDistribution = { bin, pmf, expectedGross };
  if (eventCache.size >= CACHE_SLOTS) eventCache.delete(eventCache.keys().next().value as string);
  eventCache.set(key, out);
  return out;
}

// The cat layer's cession of ONE event's gross, and what the pool keeps of it.
// Everything above the ceiling is retained — there is no layer to cede it to.
export function catCeded(gross: number, attachment: number, ceiling: number): number {
  return Math.max(0, Math.min(gross - attachment, ceiling - attachment));
}

export interface CatEventRetained {
  bin: number;
  // P(one event's RETAINED loss = k x bin) under the given placement.
  pmf: Float64Array;
  // Per event: E[retained], E[retained^2], E[ceded], E[ceded^2]. On the lattice.
  m1Retained: number;
  m2Retained: number;
  m1Ceded: number;
  m2Ceded: number;
}

// Map the event gross distribution through the cat layer. With the layer
// declined the pool keeps the whole event. The mapping is EXACT here because
// the attachment and the ceiling are lattice points, so retained(k x bin) is
// again a lattice point — asserted, since a retention off the lattice would
// silently need the mean-preserving split this skips.
//
// Cached per (book, placement) on the event distribution it maps, so a quote
// repeated with the same placement — every re-render of the Decisions panel —
// neither re-maps the event nor re-runs the annual recursion below.
const retainedCache = new WeakMap<CatEventDistribution, Map<string, CatEventRetained>>();

export function catEventRetained(
  members: Member[], layer: { attachment: number; ceiling: number } | null, bin = PROPERTY_LATTICE_BIN,
): CatEventRetained {
  const dist = catEventGrossDistribution(members, bin);
  const { pmf: gross } = dist;
  if (layer && (layer.attachment % bin !== 0 || layer.ceiling % bin !== 0)) {
    throw new Error(`catEventRetained: cat layer bounds must be lattice points ($${bin} bins)`);
  }
  const layerKey = layer ? `${layer.attachment}|${layer.ceiling}` : 'declined';
  let byLayer = retainedCache.get(dist);
  if (!byLayer) { byLayer = new Map(); retainedCache.set(dist, byLayer); }
  const hit = byLayer.get(layerKey);
  if (hit) return hit;
  const aIdx = layer ? layer.attachment / bin : 0;
  const cIdx = layer ? layer.ceiling / bin : 0;
  const retainedIdx = (k: number) => layer ? Math.min(k, aIdx) + Math.max(0, k - cIdx) : k;
  const pmf = new Float64Array(retainedIdx(gross.length - 1) + 1);
  let m1r = 0, m2r = 0, m1c = 0, m2c = 0;
  for (let k = 0; k < gross.length; k++) {
    const p = gross[k];
    if (p === 0) continue;
    const ri = retainedIdx(k);
    pmf[ri] += p;
    const r = ri * bin, c = (k - ri) * bin;
    m1r += p * r; m2r += p * r * r;
    m1c += p * c; m2c += p * c * c;
  }
  const out: CatEventRetained = { bin, pmf, m1Retained: m1r, m2Retained: m2r, m1Ceded: m1c, m2Ceded: m2c };
  byLayer.set(layerKey, out);
  return out;
}

// The cat layer's ANNUAL moments: a compound Poisson sum of per-event
// cessions, so E = lambda E[c] and Var = lambda E[c^2] exactly. No frailty term
// — the event count has none.
export function catLayerAnnualMoments(
  members: Member[], layer: { attachment: number; ceiling: number },
): { expected: number; sd: number } {
  const ev = catEventRetained(members, layer);
  const lambda = C.eventsPerYear;
  return { expected: lambda * ev.m1Ceded, sd: Math.sqrt(lambda * ev.m2Ceded) };
}

// The ANNUAL retained cat distribution on the lattice, up to index `maxIndex`
// inclusive, by Panjer's recursion for a Poisson count (a = 0, b = lambda):
//
//   g_0 = exp(-lambda (1 - f_0))                 the Poisson pgf at f_0
//   g_s = sum_{j=1..min(s,J)} (lambda j / s) f_j g_{s-j}
//
// EXACT for a Poisson count, with no moment fit — unlike the attritional side,
// whose frailty-mixed count is fit to a negative binomial. The f_0 mass at zero
// needs no divisor correction here because a = 0.
//
// ⚠ TRUNCATION IS EXACT FOR WHAT IT IS USED FOR. g_s depends only on f_j and
// g_{s-j} with smaller indices, so stopping at `maxIndex` changes nothing below
// it. The aggregate stop needs the combined distribution only below its top;
// every dollar above lands on the limit, and 1 - (mass below) is that tail.
//
// ⚠ THE PREFIX IS CACHED AND EXTENDED, NOT RECOMPUTED. g_s is a function of
// f and g_0..g_{s-1} alone, so the values up to any index are the same whatever
// index the recursion is later run to — continuing a stored prefix performs the
// same operations in the same order as starting again, and is bit-identical to
// it. The aggregate's two levels ask for different lengths; the second is a
// slice or an extension of the first. Returned as a copy, so no caller can
// write into the cache.
const annualCache = new WeakMap<CatEventRetained, Float64Array>();

export function catAnnualRetainedPmf(ev: CatEventRetained, maxIndex: number): Float64Array {
  const stored = annualCache.get(ev);
  if (stored && stored.length > maxIndex) return stored.slice(0, maxIndex + 1);
  const lambda = C.eventsPerYear;
  const f = ev.pmf;
  const J = f.length - 1;
  const g = new Float64Array(maxIndex + 1);
  let from = 1;
  if (stored) { g.set(stored); from = stored.length; } else g[0] = Math.exp(-lambda * (1 - f[0]));
  for (let s = from; s <= maxIndex; s++) {
    let sum = 0;
    const upper = Math.min(s, J);
    for (let j = 1; j <= upper; j++) {
      const fj = f[j];
      if (fj === 0) continue;
      sum += j * fj * g[s - j];
    }
    g[s] = (lambda / s) * sum;
  }
  annualCache.set(ev, g);
  return g.slice();
}

// Harness access only. Nothing in the engine calls these.
export const propertyCatInternals = {
  sortedCatBook,
  resetCache: () => eventCache.clear(),
  cacheSize: () => eventCache.size,
};
