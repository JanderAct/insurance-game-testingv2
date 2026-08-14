// RE-DERIVES every WC constant in data/reinsuranceTower.ts that the severity
// rebuild invalidated, from the NEW generator.
//
// Run: npx tsx scripts/diagnostics/wc-tower-rederive.ts
//
// WHY THIS IS A SEPARATE COMMIT FROM THE SEVERITY REBUILD. Each of these
// constants is a MEASUREMENT TAKEN FROM THE GENERATOR, so it can only be
// re-derived once the new generator exists. Doing both at once would make a
// severity bug and a tower-pricing bug indistinguishable.
//
// WHY THE TWO COMMITS ARE BACK-TO-BACK WITH NOTHING PLAYED BETWEEN. The stale
// constants are not uniformly conservative — they are wrong in BOTH directions
// by layer, and at the top of the tower they price genuine catastrophe cover at
// almost nothing. Shipping a playable build in between would let a pool buy that.
//
// UPDATED FOR THE THREE-LAYER MERGE: `$15M xs $10M` + `$25M xs $25M` -> a single
// `$40M xs $10M`. The mask set therefore halves, from 16 to 8.
//
// ⚠ THE $5M FREQUENCY THAT MOTIVATED THIS ORDERING WAS ITSELF A STALE FIGURE.
// The rebuild spec said claims over $5M arrive "roughly once per 41 years" and
// concluded the upper layers would be massively OVER-priced. That figure came
// from the pre-assertion heavy component. The real rate is ~0.70/yr — one every
// 1.4 years, a 21% reduction against the retired catastrophic tier's 0.89/yr, not
// a 36x one — and the direction of the error inverts: the top of the tower is
// UNDER-priced, not over. See CALIBRATION_FINDINGS 31 and 32.

import { REINSURANCE_TOWER, AGG_OVERDISPERSION, type TowerLine } from '../../src/data/reinsuranceTower';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { computeKLine, generateWcClaims } from '../../src/utils/wcClaimEngine';
import { cedeOccurrences, occurrenceTotals } from '../../src/utils/reinsuranceTower';

// Raw layer cession for ONE occurrence. Deliberately NOT cedeOccurrences: that
// function skips layers flagged non-purchasable, which is correct for pricing a
// PLACEMENT and wrong for MEASURING a layer — it would report the $25M xs $25M
// layer's expected cost as exactly 0 by construction, which is the very question
// this run exists to answer.
const cededTo = (t: number, a: number, lim: number) => Math.min(Math.max(t - a, 0), lim);
import { WC_LOSS_MODEL, WC_SEVERITY_COMPONENTS } from '../../src/data/defaultAssumptions';
import { ratingGroupOf, regionMultiplier, tiltedWeights } from '../../src/utils/wcClaimEngine';
import { limitedExpectedValue } from '../../src/utils/wcIbnr';
import type { Member } from '../../src/types/simulation';

const M = WC_LOSS_MODEL;
const LINE: TowerLine = 'WC';
const LAYERS = REINSURANCE_TOWER.WC;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// THE REFERENCE BOOK. The stored constants were measured on "a real year-1
// ENROLLED book (WC 45 members / $290M exposure)". Reproduced here so the new
// figures sit on the same basis as the ones they replace — per-$100 constants are
// verified linear in exposure, so the basis should not matter, and this run
// re-verifies that rather than assuming it.
const roster = getPredefinedMarketMembers();
const enrolled = roster.filter((_, i) => i % 4 === 0);
const enrolledExposure = enrolled.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);
const fullExposure = roster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0);

console.log('=== WC TOWER RE-DERIVATION, from the rebuilt severity model ===');
console.log(`ENROLLED reference book: ${enrolled.length} members, $${enrolledExposure.toFixed(1)}M exposure`);
console.log(`FULL MARKET: ${roster.length} members, $${fullExposure.toFixed(1)}M exposure\n`);

const YEARS = 12000;

function run(members: Member[], years: number) {
  const k = computeKLine(members);
  const out: { totals: number[] }[] = [];
  for (let y = 1; y <= years; y++) {
    const g = generateWcClaims({
      members, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 777 + y * 7919, kLine: k, riskControlEffectiveness: 0,
    });
    // ⚠ INCLUDES CLAIMS DEFERRED BY THE REPORT LAG. The treaty responds to a
    // claim when it is REPORTED, not when it occurs — but for pricing the layer
    // what matters is the annual distribution of occurrence sizes, and a delayed
    // claim is the same size whenever it lands. Excluding them would understate
    // frequency by 8.4% and, because the delay is tilted onto the heavy
    // component, understate the UPPER layers by far more (17.1% of dollars).
    const claims = [...g.claims, ...g.newlyDelayed.map(u => ({
      id: u.id, occurrenceId: `wc-occ-${u.id}`, memberId: u.memberId, line: 'WC' as const,
      accidentYear: u.accidentYear, calendarYear: 2026, tier: u.component, status: 'open' as const,
      reportedYear: u.reportYear, grossUltimate: u.amount, paidToDate: 0, caseReserve: u.amount,
    }))];
    const occurrences = claims.map(c => ({
      id: c.occurrenceId, line: 'WC' as const, memberId: c.memberId, memberIds: [c.memberId],
      accidentYear: c.accidentYear, calendarYear: 2026, region: 'Central' as const,
      isCatastrophe: false, claimIds: [c.id],
    }));
    out.push({ totals: occurrenceTotals(claims, occurrences, LINE) });
  }
  return out;
}

console.log(`--- measuring ${YEARS.toLocaleString()} FULL-MARKET years ---`);
const t0 = Date.now();
const years = run(roster, YEARS);
console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);

const exposureUnits = fullExposure * 1e4; // $100s of payroll

// --- 1. per-layer expected ceded and SD/E -----------------------------------
// ⚠ MEASURED FULL-MARKET, and that is a CHANGE OF BASIS from the stored
// constants, which were taken on one seed's enrolled book. Per-$100 layer cost is
// linear in exposure but NOT invariant to the book's RATING-GROUP MIX — High
// Safety carries a 0.4113 heavy-component weight against Low Safety's 0.2637, so
// a book with more High Safety exposure cedes more per $100. Enrollment is a
// random 25-35% subset, so its EXPECTED mix is the full-market mix; measuring on
// the canonical 200 makes the constant seed-independent and reproducible, and the
// seed-to-seed spread is reported below as the uncertainty it is.
console.log('--- 1. PER-LAYER CONSTANTS (per $100 of exposure, FULL MARKET) ---');
console.log('  layer            stored    new       change     stored SD/E   new SD/E');
const newLayers: { expectedCededPer100: number; sdOverExpected: number }[] = [];
for (let i = 0; i < LAYERS.length; i++) {
  const l0 = LAYERS[i];
  const perYear = years.map(y => y.totals.reduce((s2, t) => s2 + cededTo(t, l0.attachment, l0.limit), 0));
  const m = mean(perYear);
  const sd = Math.sqrt(mean(perYear.map(x => (x - m) ** 2)));
  const per100 = m / exposureUnits;
  const sdOverE = m > 0 ? sd / m : 0;
  newLayers.push({ expectedCededPer100: per100, sdOverExpected: sdOverE });
  const stored = LAYERS[i];
  console.log(`  ${stored.name.padEnd(14)} ${stored.expectedCededPer100.toFixed(4).padStart(8)} ${per100.toFixed(4).padStart(8)} ` +
    `${(((per100 / stored.expectedCededPer100) - 1) * 100).toFixed(0).padStart(8)}%   ${stored.sdOverExpected.toFixed(2).padStart(11)} ${sdOverE.toFixed(2).padStart(10)}`);
}

// CLOSED-FORM CROSS-CHECK, ON BOTH RISK-QUALITY BASES.
//
// ⚠ THE BASIS IS THE WHOLE DIFFERENCE BETWEEN THE TWO COLUMNS, and it is worth
// several percent. NEUTRAL prices the layer as a rate card — no theta, no severity
// tilt — which is seed-independent and reproducible. ACTUAL embeds this roster's
// own risk-quality mix, which is ~3.9% dearer on the canonical 200 and a different
// number on any enrolled subset. The shipped constants use NEUTRAL, for the same
// reason they are measured full-market rather than on one seed's book.
function analyticLayer(i: number, basis: 'neutral' | 'actual'): number {
  const l = LAYERS[i];
  let total = 0;
  for (const m of roster) {
    const group = ratingGroupOf(m);
    const spec = M.ratingGroups[group];
    const rm = regionMultiplier(m.region);
    const rq = basis === 'neutral' ? 5 : m.riskQuality;
    const w = tiltedWeights(group, rq);
    const lambda = (m.exposureByLine.WC ?? 0) * spec.ratePer1M * Math.exp(-M.rqFrequencyBeta * (rq - 5));
    spec.mix.forEach(({ component }, j) => {
      const c = WC_SEVERITY_COMPONENTS[component];
      const mu = c.mu + Math.log(rm);
      total += lambda * w[j] * (limitedExpectedValue(mu, c.sigma, l.attachment + l.limit) - limitedExpectedValue(mu, c.sigma, l.attachment));
    });
  }
  return total / exposureUnits;
}
console.log('\n  closed-form, both bases (per $100), against the stated targets:');
console.log('  layer            NEUTRAL   ACTUAL   neutral vs target   simulated');
const TARGETS: Record<string, number> = { '$4M xs $1M': 0.6591, '$5M xs $5M': 0.1475, '$40M xs $10M': 0.1387 };
const neutral: number[] = [];
for (let i = 0; i < LAYERS.length; i++) {
  const n = analyticLayer(i, 'neutral'), a = analyticLayer(i, 'actual');
  neutral.push(n);
  const t = TARGETS[LAYERS[i].name];
  const resid = t ? ((n / t - 1) * 100).toFixed(2) + '%' : 'n/a';
  console.log(`  ${LAYERS[i].name.padEnd(14)} ${n.toFixed(4).padStart(7)} ${a.toFixed(4).padStart(8)}   ${resid.padStart(17)}   ${newLayers[i].expectedCededPer100.toFixed(4).padStart(9)}`);
}
console.log(`  actual/neutral ratio: ${(analyticLayer(0, 'actual') / analyticLayer(0, 'neutral')).toFixed(4)} — the roster's own risk-quality mix.`);

// PIERCE FREQUENCY per layer — what makes a layer a live purchase decision
// rather than a line item. $25M xs $25M fired once per 27 years, which is why
// it was merged.
console.log('\n  how often each band is pierced (FULL MARKET, measured):');
for (const l of LAYERS) {
  const hits = years.reduce((s2, y) => s2 + y.totals.filter(t => t > l.attachment).length, 0);
  const perYear = hits / YEARS;
  console.log(`  ${l.name.padEnd(14)} ${perYear.toFixed(2)}/yr` +
    (perYear < 1 ? `  (1 per ${(1 / perYear).toFixed(1)} yrs)` : ''));
}
const over50 = years.reduce((s2, y) => s2 + y.totals.filter(t => t > 50e6).length, 0) / YEARS;
console.log(`  above the tower ($50M+)  ${over50.toFixed(4)}/yr  (1 per ${(1 / over50).toFixed(0)} yrs)`);

// THE RISK LOAD MUST STILL RISE MONOTONICALLY WITH ATTACHMENT, and it must do so
// because SD/E rises — not because anyone chose the multiples.
console.log('\n  risk-load multiples, 1 + lambda x SD/E (lambda 0.60):');
let rising = true;
for (let i = 0; i < LAYERS.length; i++) {
  const mult = 1 + 0.60 * newLayers[i].sdOverExpected;
  if (i > 0 && mult <= 1 + 0.60 * newLayers[i - 1].sdOverExpected) rising = false;
  console.log(`  ${LAYERS[i].name.padEnd(14)} SD/E ${newLayers[i].sdOverExpected.toFixed(2)} -> ${mult.toFixed(2)}x   premium ${(neutral[i] * mult).toFixed(4)} per $100`);
}
console.log(`  monotonically rising: ${rising ? 'YES' : 'NO — INVESTIGATE'}`);
console.log(`  total ceded ${neutral.reduce((a, b) => a + b, 0).toFixed(4)} per $100, split ` +
  neutral.map(n => `${((n / neutral.reduce((a, b) => a + b, 0)) * 100).toFixed(0)}%`).join(' / '));

// LINEARITY IN EXPOSURE — the property that lets these constants be frozen.
console.log('\n  linearity in exposure (the property that lets these be constants):');
const encYears = run(enrolled, Math.max(2000, Math.floor(YEARS / 4)));
const encUnits = enrolledExposure * 1e4;
console.log(`  (a ${enrolled.length}-member / $${enrolledExposure.toFixed(0)}M subset — 4.5x smaller book)`);
for (let i = 0; i < LAYERS.length; i++) {
  const l0 = LAYERS[i];
  const e = mean(encYears.map(y => y.totals.reduce((s2, t) => s2 + cededTo(t, l0.attachment, l0.limit), 0))) / encUnits;
  console.log(`  ${l0.name.padEnd(14)} full-market ${newLayers[i].expectedCededPer100.toFixed(4)}  subset ${e.toFixed(4)}  ` +
    `ratio ${(e / newLayers[i].expectedCededPer100).toFixed(3)}`);
}
console.log(`  ⚠ A ratio away from 1.00 here is RATING-GROUP MIX, not non-linearity: this subset is`);
console.log(`    every 4th roster row, so its High Safety share differs from the market's. The constants`);
console.log(`    scale with EXPOSURE; they do not correct for a book that is unusually safety-heavy.`);

// --- 2. occurrence frequency -------------------------------------------------
console.log('\n--- 2. AGG_OCC_FREQ_PER_1M ---');
const occPerYear = mean(years.map(y => y.totals.length));
const freqPer1M = occPerYear / fullExposure;
console.log(`  occurrences/yr ${occPerYear.toFixed(1)} over $${fullExposure.toFixed(1)}M -> ${freqPer1M.toFixed(4)} per $1M (stored 1.4310)`);

// --- 3. retained second moment by bitmask ------------------------------------
console.log('\n--- 3. WC_RETAINED_SECOND_MOMENT, by occurrence-layer bitmask ---');
const m2: number[] = [];
const MASKS = 1 << LAYERS.length;
for (let mask = 0; mask < MASKS; mask++) {
  const placed = LAYERS.map((_, i) => (mask & (1 << i)) !== 0);
  let sumSq = 0, n = 0;
  for (const y of years) {
    for (const t of y.totals) {
      const r = cedeOccurrences(LINE, [t], placed).retained;
      sumSq += r * r; n += 1;
    }
  }
  m2.push(sumSq / n);
}
console.log('  mask  bits  m2');
console.log(`  ${MASKS} masks (2^${LAYERS.length} layers), down from 16 when WC had four.`);
for (let i = 0; i < MASKS; i++) {
  const bits = LAYERS.map((_, b) => ((i & (1 << b)) ? '1' : '0')).join('');
  console.log(`  ${String(i).padStart(4)}  ${bits}  ${m2[i].toExponential(4)}`);
}

// --- 4. is the top layer reachable now? --------------------------------------
console.log('\n--- 4. THE $25M xs $25M LAYER — is its non-purchasable reason still true? ---');
const over25 = years.reduce((s, y) => s + y.totals.filter(t => t > 25e6).length, 0);
const singleClaimOver25 = over25; // WC emits one claim per occurrence, so every one is a single claim
console.log(`  occurrences over $25M in ${YEARS.toLocaleString()} FULL-MARKET years: ${over25}  (${(over25 / YEARS).toFixed(4)}/yr, one per ${(YEARS / Math.max(over25, 1)).toFixed(0)} years)`);
console.log(`  of which SINGLE-CLAIM: ${singleClaimOver25} — WC emits exactly one claim per occurrence, so all of them.`);
console.log(`  ⚠ THE STORED JUSTIFICATION SAYS a single claim "cannot reach $25M: the present value ceiling`);
console.log(`    is $15.51M". That ceiling belonged to the retired catastrophic annuity. The mixture has NO`);
console.log(`    ceiling, so the layer is reachable by exactly the mechanism the comment says cannot reach it.`);
const retainedAbove = mean(years.map(y => y.totals.reduce((s, t) => s + Math.max(0, t - 50e6), 0))) / exposureUnits;
console.log(`  retained ABOVE the full $50M tower: ${retainedAbove.toFixed(4)} per $100 (was structurally 0)`);

// --- 5. emit the replacement constants ---------------------------------------
console.log('\n--- 5. REPLACEMENT CONSTANTS ---');
console.log('  WC: [');
for (let i = 0; i < LAYERS.length; i++) {
  const l = LAYERS[i];
  console.log(`    { name: '${l.name}', attachment: ${l.attachment}, limit: ${l.limit}, ` +
    `expectedCededPer100: ${neutral[i].toFixed(4)}, sdOverExpected: ${newLayers[i].sdOverExpected.toFixed(2)}, purchasable: true },`);
}
console.log('  ],');
console.log(`  export const AGG_OCC_FREQ_PER_1M = ${freqPer1M.toFixed(4)};`);
console.log(`  export const AGG_OVERDISPERSION = ${AGG_OVERDISPERSION};  // unchanged: still Gamma(16,1/16) member noise`);
console.log('  export const WC_RETAINED_SECOND_MOMENT: number[] = [');
for (let r = 0; r < MASKS / 4; r++) {
  console.log('    ' + m2.slice(r * 4, r * 4 + 4).map(x => x.toExponential(4).replace('e+', 'e')).join(', ') + ',');
}
console.log('  ];');
console.log('\nDONE — measurement only. Paste the constants above into data/reinsuranceTower.ts.');
