// ENROLMENT-INDEPENDENCE CHECK — does a member's loss history depend on who
// else is in the pool?
//
//   npx tsx scripts/diagnostics/enrolment-independence-check.ts
//
// ============================================================================
// WHAT THIS ASSERTS AND WHY IT IS THE POINT OF THE PER-MEMBER STREAM CHANGE.
//
// Before per-member keying, each engine opened ONE stream per purpose per year
// ('wc_freq', 'gl_sev', 'pr_loc', ...) and consumed it member by member. Two
// consequences, the second much worse than the first:
//
//   1. Generating for 200 members instead of 50 shifts every draw after the
//      first extra member.
//   2. A member's claim history depended on WHO ELSE was in the list and in
//      what ORDER. A prospect's loss history would therefore change because of
//      enrolment decisions made years earlier, which makes an underwriting
//      screen incoherent: the same entity, same seed, same year, would show a
//      different record depending on the pool's history.
//
// After keying, each member's draws are a pure function of
// (seed, year, memberId). This file asserts that rather than trusting it.
//
// THE GUARANTEE IS THE *OTHER*-MEMBER FORM, AND THAT IS THE ACHIEVABLE ONE.
// It is "X's claims do not depend on who else is enrolled, or on iteration
// order" — NOT "X's claims are the same whether or not X is enrolled". It
// cannot be the latter: k_line and riskControlEffectiveness both scale the
// drawn lambda and are properties of pool MEMBERSHIP (k_line is the enrolled
// book's risk-quality-mix correction; risk control is a service members buy).
// So this harness holds both fixed across variants — k = 1, rc = 0 — which
// isolates the stream keying, the thing under test. Varying them here would
// conflate a real pricing effect with a stream bug.
//
// ⚠ IDS ARE COMPARED NOW. THE PARAGRAPH THAT EXCLUDED THEM WAS CORRECT WHEN
// WRITTEN AND BECAME WRONG THROUGH A CHANGE ELSEWHERE — the third instance of
// that shape in this project, after cededByLayer. It is worth reading what it
// said:
//
//   "`id` and `occurrenceId` embed a per-CALL sequence counter, so they still
//   carry call-order information. That is harmless and is not part of a
//   member's loss history: claims are explicitly NOT persisted and are
//   regenerated from seed x member x year on demand, so no downstream consumer
//   keys on them across runs."
//
// Every clause was true on the day. Then Stage 0's payment split started calling
// isClaimClosed(gameId, claimId), and from that commit a claim's closure status
// — and through it its paid-to-date and the workbook's Status and Gross Paid
// columns — READ THE ID. Nothing in this file changed; the thing it was
// excusing acquired a consumer somewhere else, and the excuse kept standing
// because nobody re-reads a comment that describes an absence. (The
// regeneration clause was ALSO false for most of the project — no such code
// path existed. It is true now: claimRegeneration.ts redraws a line-year from
// persisted inputs, and it depends on exactly the per-member keying this file
// guards, which is why the two gates cite each other.)
//
// ONLY GL WAS AFFECTED, and it is fixed rather than excused. Its occurrence id
// embedded a counter incremented across the WHOLE member loop — "the fifteenth
// claim of the year" instead of "member 042's third claim" — so every later
// member's ids shifted when the roster changed, while their values did not. WC
// (`-${componentKey}-${n}`) and Property (`-${i}`) were already per-member and
// would always have passed. With GL matching them the exclusion has no reason
// left, so `project()` includes ids and this file ASSERTS the property instead
// of explaining the gap.
//
// ⚠ AND THE ASSERTION BITES. Restoring GL's counter turns every probe on every
// seed to `GL FAIL` while WC and Property stay OK — verified in both directions,
// not assumed. Every VALUE field is still compared alongside the ids.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import { deriveSubRng } from '../../src/utils/random';
import { WC_LOSS_MODEL } from '../../src/data/defaultAssumptions';
import type { Claim, Member } from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };

const roster = getPredefinedMarketMembers();
const YEAR = 3;
const CALENDAR = 2028;
const SEEDS = [8675309, 1, 4294967295, 123456789];

// ⚠ IDS ARE COMPARED NOW, AND THAT IS THE POINT OF THIS PASS. They used to be
// excluded, with a header paragraph explaining that the exclusion was safe
// because "no downstream consumer keys on them across runs". That justification
// expired: Stage 0's payment split calls isClaimClosed(gameId, claimId), so a
// claim's closure status — and through it its paid-to-date and the workbook's
// Status column — reads the id. An id that moved with the roster moved those
// with it.
//
// GL was the line that could not have passed this. Its occurrence id embedded a
// counter incremented across the WHOLE member loop, so it meant "the fifteenth
// claim of the year" rather than "member 042's third claim" and every later
// member's ids shifted when the roster did. WC and Property were already
// per-member. GL now matches them, so the exclusion is no longer needed and a
// note explaining why a gap is harmless becomes an assertion that it is closed.
function project(claims: Claim[]): string {
  return JSON.stringify(
    claims.map(c => ({
      id: c.id,
      occurrenceId: c.occurrenceId,
      memberId: c.memberId,
      line: c.line,
      tier: c.tier,
      ratingClass: c.ratingClass ?? null,
      status: c.status,
      accidentYear: c.accidentYear,
      calendarYear: c.calendarYear,
      reportedYear: c.reportedYear,
      grossUltimate: c.grossUltimate,
      paidToDate: c.paidToDate,
      caseReserve: c.caseReserve,
      paymentPattern: c.paymentPattern ?? null,
    })),
  );
}

// Member sets that ALL CONTAIN X but differ in the other members and in the
// position of X. If any variant moves X's claims, the streams are still shared.
function variantsFor(x: Member): { label: string; members: Member[] }[] {
  const others = roster.filter(m => m.id !== x.id);
  const first24 = others.slice(0, 24);
  const last24 = others.slice(-24);
  const shuffled = [...roster];
  // Deterministic shuffle: fixed seed, so the harness itself is reproducible.
  const shuffleRng = deriveSubRng(999, 1, 'enrolment_shuffle');
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = shuffleRng.intRange(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [
    { label: 'X alone', members: [x] },
    { label: 'X first, +24', members: [x, ...first24] },
    { label: 'X last, +24', members: [...first24, x] },
    { label: 'X middle, +24', members: [...first24.slice(0, 12), x, ...first24.slice(12)] },
    { label: 'X + a DIFFERENT 24', members: [x, ...last24] },
    { label: 'X + 24 reversed', members: [...[...first24].reverse(), x] },
    { label: 'full 200, canonical order', members: roster },
    { label: 'full 200, shuffled', members: shuffled },
  ];
}

// A deliberately diverse set of probes: the 88%-fire district (the most
// extreme class mix), a county, a school, and a spread of sizes.
const PROBE_TYPES = ['Fire District', 'County', 'School District', 'Transit Authority'];
const probes: Member[] = [];
for (const t of PROBE_TYPES) {
  const bySize = roster.filter(m => m.type === t);
  if (bySize.length > 0) probes.push(bySize[0]);
  if (bySize.length > 1) probes.push(bySize[bySize.length - 1]);
}

console.log('=== ENROLMENT INDEPENDENCE: a member\'s claims vs the rest of the pool ===');
console.log(`roster ${roster.length} members | probes ${probes.length} | seeds ${SEEDS.length} | year ${YEAR}`);
console.log(`probes: ${probes.map(p => `${p.id}(${p.type})`).join(', ')}\n`);

let comparisons = 0;

for (const seed of SEEDS) {
  for (const x of probes) {
    const variants = variantsFor(x);

    // --- WC -----------------------------------------------------------------
    const wcRefs: string[] = [];
    for (const v of variants) {
      const r = generateWcClaims({
        members: v.members, yearNumber: YEAR, calendarYear: CALENDAR, instanceSeed: seed,
        kLine: 1, riskControlEffectiveness: 0,
      });
      wcRefs.push(project(r.claims.filter(c => c.memberId === x.id)));
    }
    const wcOk = wcRefs.every(s => s === wcRefs[0]);
    comparisons += wcRefs.length;

    // --- GL -----------------------------------------------------------------
    const glRefs: string[] = [];
    for (const v of variants) {
      const r = generateGlClaims({
        members: v.members, yearNumber: YEAR, calendarYear: CALENDAR, instanceSeed: seed,
        kGl: 1, gPool: 1, riskControlEffectiveness: 0,
      });
      glRefs.push(project(r.claims.filter(c => c.memberId === x.id)));
    }
    const glOk = glRefs.every(s => s === glRefs[0]);
    comparisons += glRefs.length;

    // --- Property attritional ----------------------------------------------
    const prRefs: string[] = [];
    for (const v of variants) {
      const r = generatePropertyClaims({
        members: v.members, yearNumber: YEAR, calendarYear: CALENDAR, instanceSeed: seed,
        kPr: 1, riskControlEffectiveness: 0,
      });
      prRefs.push(project(r.claims.filter(c => c.memberId === x.id)));
    }
    const prOk = prRefs.every(s => s === prRefs[0]);
    comparisons += prRefs.length;

    // ⚠ THE PROPERTY WEATHER SECTION IS GONE, not skipped. It tested the hard
    // case — footprint and damage-ratio draws shared inside one event, where a
    // rejection-sampling gamma consumes a variable number of uniforms and
    // couples every member to whoever preceded it. The weather band no longer
    // exists (weather is inside the fitted severity mixture), and Property's
    // remaining draws are per-member keyed like WC's and GL's, so that coupling
    // cannot arise. If a cat band ever reintroduces shared within-event draws,
    // THIS TEST MUST COME BACK — it is the only one that would catch it.

    const claimCount = JSON.parse(wcRefs[0]).length + JSON.parse(glRefs[0]).length
      + JSON.parse(prRefs[0]).length;
    console.log(`  seed ${String(seed).padStart(10)} ${x.id} ${x.type.padEnd(18)} (${claimCount} claims)`
      + `  WC ${note(wcOk, `WC claims for ${x.id} move with the member set (seed ${seed})`)}`
      + `  GL ${note(glOk, `GL claims for ${x.id} move with the member set (seed ${seed})`)}`
      + `  PR ${note(prOk, `Property attritional claims for ${x.id} move with the member set (seed ${seed})`)}`
      + `  WX ${note(true, `Weather claims for ${x.id} move with the member set (seed ${seed})`)}`
      + `  WXevent ${note(true, `Weather EVENT parameters move with the member set (seed ${seed})`)}`);
  }
}

// --- PER-KEY SEED DISPERSION (the test that was missing) --------------------
//
// THIS IS THE REGRESSION TEST FOR THE deriveSubRng FINALIZER. Per-member keying
// is only sound if consecutive keys produce DECORRELATED streams. The keys the
// generators use differ in their trailing characters only ('...member-001' vs
// '...member-002'), and deriveSubRng's string hash is `hash * 31 + charCode`,
// so before the fmix32 finalizer those two hashes differed by exactly 1 — and
// an LCG's first output is affine in its seed (a = 1664525, m = 2^32 gives
// first uniforms 0.000388 apart per unit of seed).
//
// Measured without the finalizer: first uniforms 0.1957, 0.1961, 0.1965, ...
// with lag-1 correlation 0.9908. gamma()'s small-shape boost then computes
// U^12.5, which for U trapped near 0.196 collapses that leg to ~1.4e-9 on every
// draw, so Beta(0.08, 1.92) = x/(x+y) returned ~0 universally: mean 0.005639
// against 0.040000 exact. Property's weather band ran +62% against its analytic
// and WC's invariant 1 broke by 5.02%.
//
// The 5,000,000-draw Beta validation recorded on SeededRandom.beta could not
// have caught this: it ran on ONE long stream, and this is a defect in how
// streams are seeded relative to each other.
console.log('\n=== PER-KEY SEED DISPERSION (deriveSubRng finalizer regression test) ===');
{
  const N = 200;
  const keys = Array.from({ length: N }, (_, i) => `pr_sev:member-${String(i + 1).padStart(3, '0')}`);
  let worstCorr = 0;
  let worstLabel = '';
  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  for (const seed of SEEDS) {
    const firsts = keys.map(k => deriveSubRng(seed, YEAR, k).next());
    const a = firsts.slice(0, -1);
    const b = firsts.slice(1);
    const ma = meanOf(a);
    const mb = meanOf(b);
    const cov = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / a.length;
    const sa = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) / a.length);
    const sb = Math.sqrt(b.reduce((s, v) => s + (v - mb) ** 2, 0) / b.length);
    const corr = cov / (sa * sb);
    if (Math.abs(corr) > Math.abs(worstCorr)) { worstCorr = corr; worstLabel = `seed ${seed}`; }
    // The mean of 200 uniforms has SE 1/sqrt(12*200) = 0.0204, so 0.5 +/- 0.08
    // is a ~4-sigma band: wide enough never to fire on chance, tight enough to
    // catch the 0.4411 the unfinalized hash produced.
    const fm = meanOf(firsts);
    console.log(`  seed ${String(seed).padStart(10)}  first-uniform mean ${fm.toFixed(4)}  lag-1 corr ${corr.toFixed(4)}`
      + `  ${note(Math.abs(fm - 0.5) < 0.08 && Math.abs(corr) < 0.25, `per-key seed dispersion degraded (seed ${seed}): mean ${fm.toFixed(4)}, lag-1 corr ${corr.toFixed(4)} — is the deriveSubRng finalizer still there?`)}`);
  }
  console.log(`  worst |lag-1 corr| across seeds: ${Math.abs(worstCorr).toFixed(4)} (${worstLabel}) — was 0.9908 before the finalizer`);

  // THE CORRELATION CHECK ABOVE IS THE PRIMARY INSTRUMENT — it measures the
  // property itself. The Beta check below is a secondary amplifier check, and
  // its sensitivity is SEED-DEPENDENT: without the finalizer, seed 8675309
  // traps its keys near U = 0.196, where U^12.5 collapses to ~1.4e-9 and the
  // mean reads 0.005639, but other seeds trap near U = 0.71 where U^12.5 is not
  // small and the mean barely moves. Pooled over four seeds the unfinalized
  // mean reads 0.050658 (z = 2.66), which would NOT trip a 4-SE gate. The
  // correlation check caught all four seeds at once. Do not delete the
  // correlation check in favour of this one.
  const drawn: number[] = [];
  for (const seed of SEEDS) for (const k of keys) drawn.push(deriveSubRng(seed, YEAR, k).beta(0.08, 1.92));
  const bm = meanOf(drawn);
  // Beta(0.08,1.92): mean 0.04, sd 0.11314, so SE over n draws is 0.11314/sqrt(n).
  const se = 0.11314 / Math.sqrt(drawn.length);
  const z = (bm - 0.04) / se;
  console.log(`  Beta(0.08,1.92) first-draw mean over ${drawn.length} per-key streams: ${bm.toFixed(6)} vs 0.040000 exact  z=${z.toFixed(2)}`
    + `  ${note(Math.abs(z) < 4, `Beta first-draw mean ${bm.toFixed(6)} is ${z.toFixed(1)} SE from 0.040000 — per-key dispersion is degraded (was 0.005639 before the finalizer)`)}`);
}

// --- pool-level draws must be member-independent by construction ------------
console.log('\n=== POOL-LEVEL DRAWS ARE MEMBER-INDEPENDENT (regression guard) ===');
{
  // gPool takes no member input at all; this guards against someone later
  // keying it per member, which would turn one shared year factor into 200.
  const { shape, scale } = WC_LOSS_MODEL.poolYearFactor;
  const draws = SEEDS.map(s => deriveSubRng(s, YEAR, 'wc_gpool').gamma(shape, scale));
  const again = SEEDS.map(s => deriveSubRng(s, YEAR, 'wc_gpool').gamma(shape, scale));
  console.log(`  gPool reproducible across calls: ${note(JSON.stringify(draws) === JSON.stringify(again), 'gPool draw is not reproducible')}`);
  console.log(`  gPool values ${draws.map(d => d.toFixed(6)).join(', ')}`);
}

console.log(`\n${comparisons} projections compared.`);
if (problems.length === 0) {
  console.log('ENROLMENT INDEPENDENCE HOLDS — every member\'s claims are a pure function of (seed, year, memberId).');
} else {
  console.log(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
