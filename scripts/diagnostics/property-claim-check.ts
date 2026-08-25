// PROPERTY'S FITTED GENERATOR — the invariants that guard it.
//
// Run: npx tsx scripts/diagnostics/property-claim-check.ts
//
// Replaces the check for the retired attritional/weather/cat design. What
// carries over is the DISCIPLINE, not the assertions: invariant 1 (the draw
// reproduces the analytic expectation) is the same test WC and GL are held to,
// and it is the one that would have caught the defect this rebuild fixed —
// eleven times too many claims at 44% of the size, a product right by accident
// while both factors were wrong.
//
// WHAT IS ASSERTED (hard, fails the run):
//   1. The capped mixture's mean reproduces the fit's $435,254.
//   2. Held pure premium = frequency x mean severity x trend + the asserted cat
//      load, i.e. 0.0962 + 0.0247 = 0.1209, reconciled from the parameters.
//   3. The draw reproduces the analytic expectation (invariant 1).
//   4. Severity never exceeds the cap, and the cap binds rarely.
//   5. Expected loss is exactly proportional to TIV — the identity that
//      replaced the retired design's location-count cancellation.
//
// WHAT IS MEASURED AND REPORTED (not gated — heavy-tailed sample means, and
// gating on one is finding 26):
//   claim counts, annual aggregate CV, per-risk breaches, the realised AAL.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { PROPERTY_LOSS_MODEL, PROPERTY_HELD_PURE_PREMIUM_PER_100, PROPERTY_PURE_PREMIUM_SPLIT } from '../../src/data/defaultAssumptions';
import {
  computeKPr, deriveNeutralPropertyPurePremiumPer100, expectedPropertyGrossLoss,
  generatePropertyClaims, propertySeverityMoment, propertySeverityCap, PROPERTY_MEAN_SEVERITY,
} from '../../src/utils/propertyClaimEngine';

const M = PROPERTY_LOSS_MODEL;
const YEARS = Number(process.env.YEARS ?? 3000);

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) { failures++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`); }
  else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

const roster = getPredefinedMarketMembers();
const fullTiv = roster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);

console.log('=== PROPERTY FITTED GENERATOR ===\n');

console.log('--- 1. THE SEVERITY MIXTURE ---');
check(Math.abs(PROPERTY_MEAN_SEVERITY - 435_254) < 500,
  'capped mixture mean reproduces the fit', `$${PROPERTY_MEAN_SEVERITY.toFixed(0)} vs $435,254`);
{
  const m1 = propertySeverityMoment(1), m2 = propertySeverityMoment(2);
  const cv = Math.sqrt(m2 - m1 * m1) / m1;
  check(Math.abs(cv - 4.78) < 0.02, 'capped severity CV is 4.78', cv.toFixed(3));
  const w = M.severityMixture.reduce((a, c) => a + c.weight, 0);
  check(Math.abs(w - 1) < 1e-9, 'mixture weights sum to 1', w.toFixed(6));
}

// ⚠ PROPERTY'S CEILING IS WIRED LIKE WC's AND GL's BUT IS INERT, AND THIS
// ASSERTS THE INERTNESS RATHER THAN TRUSTING THE COMMENT THAT CLAIMS IT.
//
// WC and GL trend their ceilings at their own severity trends. Property's
// propertySeverityTrend is exactly 1 — its severity does not trend at the DRAW,
// because the construction-cost inflation is consumed by the accident-year ->
// settlement convention instead. So propertySeverityCap must return the same
// number in every year.
//
// This matters more than an inert check usually would, because three things
// silently assume it: PROPERTY_MEAN_SEVERITY is a module-level const,
// expectedPropertyGrossLoss takes no yearNumber at all, and towerMoments'
// propertyBandCache is a single slot with no year key. Worse, Property's
// ceiling IS TOWER_TOP.Property and sets the top layer's limit — so switching
// the trend on would silently grow the purchased reinsurance tower. If someone
// gives Property a severity trend, this check is the tripwire that should fire
// first and send them to propertySeverityCap's header.
{
  const caps = [1, 2, 5, 10, 20].map(y => propertySeverityCap(y));
  const allSame = caps.every(c => c === caps[0]);
  check(allSame, 'Property ceiling is year-invariant (its severity trend is exactly 1)',
    `${caps.map(c => `$${(c / 1e6).toFixed(1)}M`).join(' ')}`);
  check(caps[0] === M.severityCap, 'and equals PROPERTY_LOSS_MODEL.severityCap, which TOWER_TOP.Property depends on',
    `$${(caps[0] / 1e6).toFixed(1)}M`);
  const momentSame = propertySeverityMoment(1, 1, 1) === propertySeverityMoment(1, 1, 20);
  check(momentSame, 'and the capped mixture moment is therefore year-invariant too');
}

console.log('\n--- 2. THE HELD PURE PREMIUM RECONCILES FROM ITS PARTS ---');
{
  const derived = deriveNeutralPropertyPurePremiumPer100(roster);
  check(Math.abs(derived - PROPERTY_PURE_PREMIUM_SPLIT.nonCatDerived) < 0.0005,
    'generator analytic == the derived non-cat figure (0.0962)', derived.toFixed(4));
  // THE INVARIANT THAT REPLACED THE OLD SPLIT: price and draw are now the same
  // number, so there is nothing in the premium the generator does not produce.
  check(Math.abs(derived - PROPERTY_HELD_PURE_PREMIUM_PER_100) < 0.0005,
    'the HELD constant IS the generator analytic — no unearned load in the price',
    `${PROPERTY_HELD_PURE_PREMIUM_PER_100} vs ${derived.toFixed(4)}`);
  check(Math.abs(PROPERTY_HELD_PURE_PREMIUM_PER_100 - (derived + PROPERTY_PURE_PREMIUM_SPLIT.catAssertedRetired)) > 0.001,
    'the RETIRED cat load is NOT summed into the held constant',
    `held ${PROPERTY_HELD_PURE_PREMIUM_PER_100}, retired load ${PROPERTY_PURE_PREMIUM_SPLIT.catAssertedRetired}`);
  console.log(`\n  The 0.0247 cat load is RETIRED, not applied: Property cannot incur a catastrophe`);
  console.log('  while the cat shock is gated, so pricing one was a certain over-collection. It');
  console.log('  returns WITH the cat band, in the same commit, or the two disagree again.');
}

console.log('\n--- 3. EXPECTED LOSS IS EXACTLY PROPORTIONAL TO TIV ---');
console.log('  The identity that replaced the retired design\'s location-count cancellation.');
{
  const half = roster.slice(0, 100), whole = roster;
  const eHalf = expectedPropertyGrossLoss(half, { riskQualityOverride: 5, kPr: 1 });
  const tHalf = half.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const eWhole = expectedPropertyGrossLoss(whole, { riskQualityOverride: 5, kPr: 1 });
  const perTivHalf = eHalf / tHalf, perTivWhole = eWhole / fullTiv;
  check(Math.abs(perTivHalf / perTivWhole - 1) < 1e-12,
    'loss per $1M TIV is identical on any subset at neutral RQ',
    `${perTivHalf.toFixed(4)} vs ${perTivWhole.toFixed(4)}`);
}

console.log('\n--- 4. INVARIANT 1: THE DRAW REPRODUCES THE ANALYTIC EXPECTATION ---');
console.log(`  ${YEARS.toLocaleString()} independent full-roster years at neutral kPr and no risk control.\n`);
{
  const analytic = expectedPropertyGrossLoss(roster, { kPr: computeKPr(roster) });
  const totals: number[] = [];
  let counts = 0, maxClaim = 0, breaches = 0, capBinds = 0;
  for (let y = 1; y <= YEARS; y++) {
    const r = generatePropertyClaims({
      members: roster, yearNumber: y, calendarYear: 2025 + y,
      instanceSeed: 990_000 + y * 7919, kPr: computeKPr(roster), riskControlEffectiveness: 0,
    });
    totals.push(r.grossUltimateLoss);
    counts += r.claimCount; breaches += r.perRiskBreaches; capBinds += r.capBindings;
    if (r.maxClaimGross > maxClaim) maxClaim = r.maxClaimGross;
  }
  const drawn = mean(totals);
  const ratio = drawn / analytic;
  // A heavy tail needs a wide band on a sample mean — this is a convergence
  // test, not a calibration gate. Finding 26.
  check(Math.abs(ratio - 1) < 0.06, 'drawn / analytic within 6%', ratio.toFixed(4));
  console.log(`\n  analytic $${(analytic / 1e6).toFixed(2)}M   drawn $${(drawn / 1e6).toFixed(2)}M   over ${YEARS.toLocaleString()} years`);
  console.log(`  claims/yr ${(counts / YEARS).toFixed(1)} (full market, ${fullTiv.toFixed(0)}M TIV)`);
  console.log(`  annual aggregate CV ${(Math.sqrt(mean(totals.map(t => (t - drawn) ** 2))) / drawn).toFixed(3)}`);
  console.log(`  p50 $${(q(totals, 0.5) / 1e6).toFixed(2)}M   p90 $${(q(totals, 0.9) / 1e6).toFixed(2)}M   p99 $${(q(totals, 0.99) / 1e6).toFixed(2)}M   worst $${(Math.max(...totals) / 1e6).toFixed(1)}M`);
  console.log(`  per-risk breaches/yr (>$${(M.perRiskRetention / 1e6).toFixed(0)}M) ${(breaches / YEARS).toFixed(2)}`);

  console.log('');
  // A HARD bound, not a trended one: Property books settlement dollars
  // directly, so the cap is the cap. See PAYOUT_TREND_FACTOR in the generator.
  check(maxClaim <= M.severityCap,
    'no booked claim exceeds the cap — Property books settlement dollars, so the bound is exact',
    `max $${(maxClaim / 1e6).toFixed(1)}M vs cap $${(M.severityCap / 1e6).toFixed(1)}M`);
  const bindRate = capBinds / Math.max(counts, 1);
  check(bindRate < 0.001, 'the cap binds rarely — it disciplines the 2nd moment, it is not a loss limit',
    `${capBinds} of ${counts} claims (1 in ${capBinds ? Math.round(counts / capBinds) : counts})`);
}

console.log(failures === 0 ? '\nALL PROPERTY GENERATOR CHECKS PASS.' : `\n${failures} CHECK(S) FAILED.`);
if (failures > 0) process.exit(1);
