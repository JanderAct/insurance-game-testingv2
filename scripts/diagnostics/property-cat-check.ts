// PROPERTY'S CATASTROPHE BAND — the exact event distribution, held against an
// INDEPENDENT simulation of the same mechanism.
//
// Run: npx tsx scripts/diagnostics/property-cat-check.ts
//
// ============================================================================
// ⚠ INDEPENDENT MEANS INDEPENDENT OF EVERYTHING THE PRICE USES. The exact
// distribution (propertyCatastrophe.ts) is a convolution; the simulation here
// draws events one at a time — region, then a hit/no-hit per member — with ITS
// OWN generator (xoshiro128**, not the engine's LCG) seeded apart from any
// engine stream, and it draws FRESH EVENTS for every comparison rather than
// re-reading a pool. That last point is the one that mattered: the first proof
// of the combined pricing re-drew years from a 200,000-event pool, so both sides
// inherited the same thin tail and agreed. It validated the convolution and
// said nothing about the event tail, which a 400,000-draw sample understated
// by ~30%. This check is the one that can see that.
//
// WHAT IS ASSERTED (fails the run):
//   1. The lattice mean equals the closed-form E[event gross] to 1e-9.
//   2. The distribution is bit-identical rebuilt cold and rebuilt from a
//      shuffled roster — the fixed member order is what makes it so — and the
//      annual recursion's cached prefix, extended or sliced, is bit-identical
//      to a fresh run.
//   3. Event tail probabilities and the tower's per-event moments agree
//      with 4,000,000 independently simulated events, within 4 SE, on two
//      books.
//   4. The ANNUAL cat retained distribution (Panjer, Poisson count) agrees with
//      1,000,000 independently simulated years, layer placed and declined.
//   5. The GENERATOR draws the process the price describes: event rate, cat
//      AAL, one occurrence per event with every claim in its region, and a
//      member's cat claims unchanged by who else is enrolled.
//
// WHAT IS REPORTED (not gated): the $1B top's exceedance rate, the realised
// cat share of expected loss on each book, and P(an event) in a 5-year game.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { PROPERTY_CAT_EARTHQUAKE, PROPERTY_CAT_MODEL } from '../../src/data/defaultAssumptions';
import { PROPERTY_PERIL_DEDUCTIBLE, REINSURANCE_TOWER, PROPERTY_TOWER_TOP } from '../../src/data/reinsuranceTower';
import {
  CAT_REGIONS, PROPERTY_LATTICE_BIN, catAnnualRetainedPmf, catEventGrossDistribution, catEventRetained,
  catLayerAnnualMoments, catLossIfHit, expectedPropertyCatLoss, propertyCatInternals,
} from '../../src/utils/propertyCatastrophe';
import { expectedPropertyAttritionalLoss, generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import type { Member, Region } from '../../src/types/simulation';

const C = PROPERTY_CAT_MODEL;
const BIN = PROPERTY_LATTICE_BIN;
const Z = 4;

const failed: string[] = [];
const RULE = '='.repeat(72);
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failed.push(`${label}${detail ? '  — ' + detail : ''}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

// xoshiro128** — a different algorithm from the engine's LCG, so no structural
// artefact of that generator can be shared by both sides of a comparison.
function xoshiro(seed: number) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  let z = seed >>> 0;
  const splitmix = () => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b) >>> 0;
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
    return (t ^ (t >>> 16)) >>> 0;
  };
  s0 = splitmix(); s1 = splitmix(); s2 = splitmix(); s3 = splitmix();
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
    s0 >>>= 0; s1 >>>= 0; s2 >>>= 0;
    return result / 4294967296;
  };
}

const roster = getPredefinedMarketMembers();
// A representative ENROLLED-size book: every third member of the market.
const BOOKS: [string, Member[]][] = [['full market', roster], ['one-third book', roster.filter((_, i) => i % 3 === 0)]];
// Property's ONE layer — it answers catastrophe occurrences like any other, so
// the event distribution is checked through the layer the engine actually cedes
// to: $5M retained, covered to the $1B top.
const towerLayer = REINSURANCE_TOWER.Property[0];
const LAYER = { attachment: towerLayer.attachment, ceiling: towerLayer.attachment + towerLayer.limit };
// A drawn event is an earthquake with probability EQ_SHARE and then retains the
// earthquake deductible instead of the attachment. The simulator draws that
// independently of the event, as the generator does.
const EQ_SHARE = PROPERTY_CAT_EARTHQUAKE.share;
const EQ_ATTACH = Math.max(LAYER.attachment, PROPERTY_PERIL_DEDUCTIBLE[PROPERTY_CAT_EARTHQUAKE.peril] ?? 0);
const fmt = (x: number) => `$${(x / 1e6).toFixed(2)}M`;

function tailOf(pmf: Float64Array, x: number): number {
  let s = 0;
  for (let k = pmf.length - 1; k >= 0 && k * BIN > x; k--) s += pmf[k];
  return s;
}

// One simulated event on a book: region by the market weights, then each of
// that region's members hit with probability f.
function simulator(book: Member[], seed: number) {
  const rng = xoshiro(seed);
  const byRegion = new Map<Region, number[]>(CAT_REGIONS.map(r => [r, book.filter(m => m.region === r).map(catLossIfHit)]));
  const cum: [Region, number][] = [];
  let acc = 0;
  for (const r of CAT_REGIONS) { acc += C.regionWeights[r as keyof typeof C.regionWeights]; cum.push([r, acc]); }
  const event = () => {
    const u = rng();
    const region = (cum.find(([, c]) => u < c) ?? cum[cum.length - 1])[0];
    let g = 0;
    for (const L of byRegion.get(region)!) if (rng() < C.footprint) g += L;
    return g;
  };
  // Poisson by inversion — again, not the engine's sampler.
  const poisson = (lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  };
  const attachment = () => (rng() < EQ_SHARE ? EQ_ATTACH : LAYER.attachment);
  return { event, poisson, attachment };
}

console.log('=== PROPERTY CATASTROPHE BAND ===\n');

for (const [name, book] of BOOKS) {
  console.log(`--- ${name}: ${book.length} members ---`);

  // 1. Lattice mean against the closed form.
  const dist = catEventGrossDistribution(book);
  let latticeMean = 0, mass = 0;
  for (let k = 0; k < dist.pmf.length; k++) { latticeMean += dist.pmf[k] * k * BIN; mass += dist.pmf[k]; }
  check(Math.abs(latticeMean / dist.expectedGross - 1) < 1e-9, 'lattice mean == closed-form E[event gross]',
    `${fmt(latticeMean)} vs ${fmt(dist.expectedGross)}, rel ${(latticeMean / dist.expectedGross - 1).toExponential(2)}`);
  check(Math.abs(mass - 1) < 1e-12, 'distribution sums to 1', (mass - 1).toExponential(2));

  // 2. Bit-identity, cold and shuffled.
  propertyCatInternals.resetCache();
  const shuffled = book.slice().reverse();
  const again = catEventGrossDistribution(shuffled);
  let identical = again.pmf.length === dist.pmf.length;
  for (let k = 0; identical && k < dist.pmf.length; k++) if (again.pmf[k] !== dist.pmf[k]) identical = false;
  check(identical, 'rebuilt cold from a REVERSED roster: bit-identical');

  // The annual recursion's cached prefix, EXTENDED, against a fresh run to the
  // same length. The cache claims these are the same operations in the same
  // order; this is where that claim is held to the last bit.
  {
    propertyCatInternals.resetCache();
    const fresh = catAnnualRetainedPmf(catEventRetained(book, LAYER), 3000);
    propertyCatInternals.resetCache();
    const evX = catEventRetained(book, LAYER);
    catAnnualRetainedPmf(evX, 800);
    const extended = catAnnualRetainedPmf(evX, 3000);
    const sliced = catAnnualRetainedPmf(evX, 1200);
    let same = fresh.length === extended.length;
    for (let k = 0; same && k < fresh.length; k++) if (fresh[k] !== extended[k]) same = false;
    for (let k = 0; same && k < sliced.length; k++) if (sliced[k] !== fresh[k]) same = false;
    check(same, 'annual cat distribution: extended and sliced cache == fresh recursion, bit for bit');
  }

  // 2b. TWO ATTACHMENTS, ONE DISTRIBUTION — the earthquake mixture is exact.
  // With the share at zero the mapping is the single-attachment one, bit for
  // bit; at the shipped share it is (1 - s) x the $5M mapping + s x the $10M
  // mapping, pmf and moments, to float precision; and it is deterministic cold.
  {
    const eq = PROPERTY_CAT_EARTHQUAKE as unknown as { share: number };
    const s = eq.share;
    eq.share = 0;
    const at5 = catEventRetained(book, LAYER);
    const at10 = catEventRetained(book, { attachment: EQ_ATTACH, ceiling: LAYER.ceiling });
    eq.share = s;
    const mix = catEventRetained(book, LAYER);
    let worst = 0;
    for (let k = 0; k < mix.pmf.length; k++) {
      const want = (1 - s) * (at5.pmf[k] ?? 0) + s * (at10.pmf[k] ?? 0);
      if (want > 0) worst = Math.max(worst, Math.abs(mix.pmf[k] / want - 1));
      else if (mix.pmf[k] !== 0) worst = Infinity;
    }
    const rel = (x: number, y: number) => Math.abs(x / y - 1);
    const mOk = rel(mix.m1Ceded, (1 - s) * at5.m1Ceded + s * at10.m1Ceded) < 1e-12
      && rel(mix.m2Ceded, (1 - s) * at5.m2Ceded + s * at10.m2Ceded) < 1e-12
      && rel(mix.m1Retained, (1 - s) * at5.m1Retained + s * at10.m1Retained) < 1e-12;
    check(s > 0 && worst < 1e-12 && mOk, `earthquake ${s * 100}%: per-event mapping == (1-s) x $5M + s x $${EQ_ATTACH / 1e6}M, pmf and moments`,
      `worst relative pmf error ${worst.toExponential(2)}; E[ceded/event] ${fmt(at5.m1Ceded)} -> ${fmt(mix.m1Ceded)}`);
    propertyCatInternals.resetCache();
    const cold = catEventRetained(book, LAYER);
    let same = cold.pmf.length === mix.pmf.length && cold.m2Ceded === mix.m2Ceded;
    for (let k = 0; same && k < cold.pmf.length; k++) if (cold.pmf[k] !== mix.pmf[k]) same = false;
    check(same, 'the mixture rebuilt cold: bit-identical');
  }

  // 3. Independent events.
  const N = 4_000_000;
  const sim = simulator(book, name === 'full market' ? 0x5eed_0001 : 0x5eed_0002);
  const thresholds = [37.5e6, 75e6, 150e6, 250e6, 500e6];
  const over = thresholds.map(() => 0);
  let sumG = 0, sumC = 0, sumC2 = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const g = sim.event();
    sumG += g;
    const a = sim.attachment();
    const c = Math.max(0, Math.min(g - a, LAYER.ceiling - a));
    sumC += c; sumC2 += c * c;
    for (let t = 0; t < thresholds.length; t++) if (g > thresholds[t]) over[t]++;
  }
  const tSim = performance.now() - t0;
  console.log(`  ${N.toLocaleString()} independent events in ${(tSim / 1000).toFixed(1)}s`);
  thresholds.forEach((x, t) => {
    const p = tailOf(dist.pmf, x);
    const pHat = over[t] / N;
    if (p < 1e-6) { console.log(`        P(gross > ${fmt(x)}): exact ${p.toExponential(3)}, simulated ${pHat.toExponential(3)} (below resolution, not gated)`); return; }
    const z = (pHat - p) / Math.sqrt(p * (1 - p) / N);
    check(Math.abs(z) < Z, `P(event gross > ${fmt(x)})`, `exact ${p.toExponential(4)} vs simulated ${pHat.toExponential(4)}, z ${z.toFixed(2)}`);
  });
  const ev = catEventRetained(book, LAYER);
  const cMean = sumC / N, cVar = sumC2 / N - cMean * cMean;
  const zc = (cMean - ev.m1Ceded) / Math.sqrt(cVar / N);
  check(Math.abs(zc) < Z, 'E[ceded per event] (the tower, on the event)', `exact ${fmt(ev.m1Ceded)} vs simulated ${fmt(cMean)}, z ${zc.toFixed(2)}`);
  const gMean = sumG / N;
  console.log(`        E[event gross]: exact ${fmt(dist.expectedGross)}, simulated ${fmt(gMean)}`);
  console.log(`        events above the $${PROPERTY_TOWER_TOP / 1e6}M tower top: ${(tailOf(dist.pmf, PROPERTY_TOWER_TOP) * 100).toFixed(4)}% (exact)`);

  // 4. The annual cat retained distribution, both placements.
  const YEARS = 1_000_000;
  for (const placed of [true, false]) {
    const evR = catEventRetained(book, placed ? LAYER : null);
    const maxIdx = Math.round(150e6 / BIN);
    const annual = catAnnualRetainedPmf(evR, maxIdx);
    const ysim = simulator(book, (placed ? 0xa11 : 0xa12) + (name === 'full market' ? 0 : 7));
    const yThresh = [1, 10e6, 37.5e6, 75e6];
    const yOver = yThresh.map(() => 0);
    for (let y = 0; y < YEARS; y++) {
      const n = ysim.poisson(C.eventsPerYear);
      let r = 0;
      for (let e = 0; e < n; e++) {
        const g = ysim.event();
        const a = ysim.attachment();
        r += placed ? Math.min(g, a) + Math.max(0, g - LAYER.ceiling) : g;
      }
      for (let t = 0; t < yThresh.length; t++) if (r > yThresh[t]) yOver[t]++;
    }
    const below = (x: number) => { let s = 0; for (let k = 0; k <= maxIdx && k * BIN <= x; k++) s += annual[k]; return s; };
    yThresh.forEach((x, t) => {
      const p = 1 - below(x);
      const pHat = yOver[t] / YEARS;
      const z = (pHat - p) / Math.sqrt(Math.max(p * (1 - p), 1e-12) / YEARS);
      check(Math.abs(z) < Z, `annual cat retained > ${x === 1 ? 'zero' : fmt(x)}, layer ${placed ? 'placed' : 'declined'}`,
        `Panjer ${p.toExponential(4)} vs simulated ${pHat.toExponential(4)}, z ${z.toFixed(2)}`);
    });
  }

  // Reported, not gated: the realised share against the 12% budget.
  const cat = expectedPropertyCatLoss(book);
  const attr = expectedPropertyAttritionalLoss(book, { riskQualityOverride: 5, kPr: 1 });
  const m = catLayerAnnualMoments(book, LAYER);
  console.log(`        cat AAL ${fmt(cat)} on attritional ${fmt(attr)} (neutral): cat share ${(cat / (cat + attr) * 100).toFixed(2)}% against the ${C.budgetShareOfExpectedLoss * 100}% budget`);
  console.log(`        tower's cession on events, annual: E ${fmt(m.expected)}, SD ${fmt(m.sd)}`);
  console.log('');
}

// 5. The generator draws what the price describes.
console.log('--- 5. THE GENERATOR ---');
{
  const book = BOOKS[1][1];
  const Y = Number(process.env.GEN_YEARS ?? 20_000);
  let events = 0, catLoss = 0, catLoss2 = 0, occOk = true, regionOk = true, catOccs = 0, quakes = 0, perilOk = true;
  const t0 = performance.now();
  for (let y = 1; y <= Y; y++) {
    const r = generatePropertyClaims({
      members: book, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 424_242, kPr: 1, riskControlEffectiveness: 0,
    });
    events += r.catEvents;
    catLoss += r.catGrossLoss; catLoss2 += r.catGrossLoss * r.catGrossLoss;
    const byId = new Map(r.claims.map(c => [c.id, c]));
    for (const o of r.occurrences.filter(o => o.isCatastrophe)) {
      catOccs++;
      if (o.peril === PROPERTY_CAT_EARTHQUAKE.peril) quakes++;
      else if (o.peril !== 'cat') perilOk = false;
      const cs = o.claimIds.map(id => byId.get(id)!);
      if (cs.some(c => !c || c.occurrenceId !== o.id || c.tier !== 'cat')) occOk = false;
      if (o.memberIds.length !== cs.length) occOk = false;
      if (cs.some(c => book.find(m => m.id === c.memberId)!.region !== o.region)) regionOk = false;
    }
    const catClaimIds = r.claims.filter(c => c.tier === 'cat').map(c => c.id).sort();
    const inOcc = r.occurrences.filter(o => o.isCatastrophe).flatMap(o => o.claimIds).sort();
    if (catClaimIds.join() !== inOcc.join()) occOk = false;
  }
  const tGen = performance.now() - t0;
  const rate = events / Y;
  const zr = (rate - C.eventsPerYear) / Math.sqrt(C.eventsPerYear / Y);
  check(Math.abs(zr) < Z, 'generator event rate == eventsPerYear', `${rate.toFixed(5)} vs ${C.eventsPerYear}, z ${zr.toFixed(2)} over ${Y.toLocaleString()} years (${(tGen / 1000).toFixed(1)}s)`);
  const aal = expectedPropertyCatLoss(book);
  const mean = catLoss / Y, sd = Math.sqrt(catLoss2 / Y - mean * mean);
  const za = (mean - aal) / (sd / Math.sqrt(Y));
  check(Math.abs(za) < Z, 'generator cat loss == analytic cat AAL', `${fmt(mean)} vs ${fmt(aal)}, z ${za.toFixed(2)}`);
  check(occOk, 'one occurrence per event, holding every cat claim and only cat claims');
  check(regionOk, 'every claim in an event is in the region the event struck');
  const qs = quakes / Math.max(1, catOccs);
  const zq = (qs - EQ_SHARE) / Math.sqrt(EQ_SHARE * (1 - EQ_SHARE) / Math.max(1, catOccs));
  check(perilOk && Math.abs(zq) < Z, `drawn events are '${PROPERTY_CAT_EARTHQUAKE.peril}' or 'cat', earthquake share == ${EQ_SHARE}`,
    `${quakes} of ${catOccs} occurrences, ${(qs * 100).toFixed(2)}%, z ${zq.toFixed(2)}`);

  // Enrolment independence for cat claims: a member's cat claims do not move
  // when the rest of the book changes. Years chosen where the member was hit.
  let tested = 0, moved = 0;
  const sub = book.filter((_, i) => i % 2 === 0);
  for (let y = 1; y <= Y && tested < 25; y++) {
    const a = generatePropertyClaims({ members: book, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 424_242, kPr: 1, riskControlEffectiveness: 0 });
    const hit = a.claims.filter(c => c.tier === 'cat' && sub.some(m => m.id === c.memberId));
    if (!hit.length) continue;
    const b = generatePropertyClaims({ members: sub, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 424_242, kPr: 1, riskControlEffectiveness: 0 });
    const proj = (cs: typeof hit) => JSON.stringify(cs.map(c => [c.id, c.memberId, c.grossUltimate]).sort());
    const bHit = b.claims.filter(c => c.tier === 'cat');
    if (proj(hit) !== proj(bHit)) moved++;
    tested++;
  }
  check(tested > 0 && moved === 0, "a member's cat claims do not move with who else is enrolled",
    `${tested} event-years compared, ${moved} moved`);
}

console.log('\n--- REPORTED ---');
console.log(`  P(at least one event in a 5-year game) = 1 - exp(-5 x ${C.eventsPerYear}) = ${((1 - Math.exp(-5 * C.eventsPerYear)) * 100).toFixed(1)}%`);
console.log(`  (an event that hits no enrolled member produces no claim; see the measurement in the commit message for the enrolled-book figure)`);

console.log(failed.length === 0 ? '\nALL PROPERTY CAT CHECKS PASS.'
  : `\n${RULE}\n${failed.length} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failed.length > 0) process.exit(1);
