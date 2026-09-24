// PLANNING MEASUREMENT — feature/property-program, off feature/risk-control.
// No source changes; nothing built. Measures what Property's losses actually
// look like (frequency, severity, concentration, tower interaction) to inform
// sizing the Property Mitigation program. See the chat report for the
// analysis this feeds.
import { writeFileSync } from 'fs';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { generatePropertyClaims, expectedPropertyGrossLoss } from '../../src/utils/propertyClaimEngine';
import { PROPERTY_LOSS_MODEL } from '../../src/data/defaultAssumptions';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sortNum = (xs: number[]) => [...xs].sort((a, b) => a - b);
const q = (xs: number[], p: number) => { const s = sortNum(xs); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const sdOf = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2)) * xs.length / Math.max(1, xs.length - 1)); };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(3)}M`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const FULL_ROSTER = getPredefinedMarketMembers();
const propertyMembers = FULL_ROSTER.filter(m => (m.exposureByLine.Property ?? 0) > 0);
const totalTiv = propertyMembers.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
const expectedGross = expectedPropertyGrossLoss(propertyMembers, { kPr: 1 });

console.log('=== PROPERTY LOSS MEASUREMENT (full market roster, kPr=1, no risk control) ===\n');
console.log(`full-market Property members: ${propertyMembers.length} of ${FULL_ROSTER.length}`);
console.log(`full-market TIV: ${fmt$(totalTiv)}   analytic E[gross]: ${fmt$(expectedGross)}\n`);

const N_DRAWS = 20_000;
const annualGross: number[] = [];
const annualClaimCount: number[] = [];
const allClaimSizes: number[] = [];
const annualTopClaimShare: number[] = [];
const annualTop3Share: number[] = [];
const annualBelowTower: number[] = [];  // dollars from claims <= $5M retention
const annualAboveTower: number[] = [];  // dollars from claims > $5M retention (net of the $5M itself)
const annualAboveTowerExcess: number[] = []; // just the excess over $5M per claim, summed
let maxClaim = 0;
let zeroClaimYears = 0;

for (let i = 0; i < N_DRAWS; i++) {
  const g = generatePropertyClaims({
    members: propertyMembers, yearNumber: 1, calendarYear: 2026,
    instanceSeed: 90210 + i * 7919, kPr: 1, riskControlEffectiveness: 0,
  });
  annualGross.push(g.grossUltimateLoss);
  annualClaimCount.push(g.claimCount);
  if (g.claimCount === 0) zeroClaimYears++;

  const sizes = g.claims.map(c => c.grossUltimate).sort((a, b) => b - a);
  for (const s of sizes) { allClaimSizes.push(s); if (s > maxClaim) maxClaim = s; }

  const total = g.grossUltimateLoss;
  if (total > 0) {
    annualTopClaimShare.push((sizes[0] ?? 0) / total);
    annualTop3Share.push(sizes.slice(0, 3).reduce((a, b) => a + b, 0) / total);
  }

  let below = 0, aboveGross = 0, aboveExcess = 0;
  for (const s of sizes) {
    if (s <= PROPERTY_LOSS_MODEL.perRiskRetention) below += s;
    else { aboveGross += s; aboveExcess += s - PROPERTY_LOSS_MODEL.perRiskRetention; }
  }
  annualBelowTower.push(below);
  annualAboveTower.push(aboveGross);
  annualAboveTowerExcess.push(aboveExcess);

  if ((i + 1) % 5000 === 0) console.log(`  ${i + 1}/${N_DRAWS} years drawn`);
}

console.log('\n=== FREQUENCY ===');
const meanFreq = mean(annualClaimCount);
console.log(`  claims/year, full market: mean ${meanFreq.toFixed(2)}   ${sortNum(annualClaimCount)[0]}-${sortNum(annualClaimCount)[annualClaimCount.length - 1]} range`);
console.log(`  claims per member-year: ${(meanFreq / propertyMembers.length).toFixed(4)}`);
console.log(`  fraction of years with ZERO claims (full market): ${pct(zeroClaimYears / N_DRAWS)}`);
// Per-member-year frequency directly from the model's own lambda (no draw noise).
const perMemberLambdas = propertyMembers.map(m => {
  const tiv = m.exposureByLine.Property ?? 0;
  return tiv * PROPERTY_LOSS_MODEL.frequencyPer1mTiv; // theta(rq)~1 near neutral, ignored for this summary stat
});
console.log(`  analytic mean per-member lambda (frequencyPer1mTiv x TIV, theta~1): ${mean(perMemberLambdas).toFixed(4)}`);
console.log(`  member TIV: mean ${fmt$(mean(propertyMembers.map(m => m.exposureByLine.Property ?? 0)))}   ` +
  `median ${fmt$(q(sortNum(propertyMembers.map(m => m.exposureByLine.Property ?? 0)), 0.5))}`);

console.log('\n=== SEVERITY (individual claim sizes, full market, all draws pooled) ===');
const sortedClaims = sortNum(allClaimSizes);
console.log(`  n = ${sortedClaims.length} claims across ${N_DRAWS} years`);
console.log(`  mean ${fmt$(mean(allClaimSizes))}   median ${fmt$(q(sortedClaims, 0.5))}   sd ${fmt$(sdOf(allClaimSizes))}   CV ${(sdOf(allClaimSizes) / mean(allClaimSizes)).toFixed(3)}`);
console.log(`  p50 ${fmt$(q(sortedClaims, 0.5))}  p90 ${fmt$(q(sortedClaims, 0.9))}  p99 ${fmt$(q(sortedClaims, 0.99))}  p99.9 ${fmt$(q(sortedClaims, 0.999))}  max ${fmt$(sortedClaims[sortedClaims.length - 1])}`);
const above5m = allClaimSizes.filter(s => s > PROPERTY_LOSS_MODEL.perRiskRetention).length;
console.log(`  claims exceeding the $5M per-risk retention: ${above5m}/${sortedClaims.length} = ${pct(above5m / sortedClaims.length)} of claims BY COUNT`);
const dollarsAbove5m = allClaimSizes.filter(s => s > PROPERTY_LOSS_MODEL.perRiskRetention).reduce((a, b) => a + b, 0);
const dollarsTotal = allClaimSizes.reduce((a, b) => a + b, 0);
console.log(`  dollars from claims > $5M: ${pct(dollarsAbove5m / dollarsTotal)} of all claim dollars`);

console.log('\n=== ANNUAL TOTAL, AND HOW CONCENTRATED IT IS ===');
console.log(`  annual gross loss: ${fmt$(mean(annualGross))} mean, ${fmt$(q(sortNum(annualGross), 0.5))} median, CV ${(sdOf(annualGross) / mean(annualGross)).toFixed(3)}`);
console.log(`  largest single claim's share of its own year's total (years with >=1 claim): mean ${pct(mean(annualTopClaimShare))}   median ${pct(q(sortNum(annualTopClaimShare), 0.5))}`);
console.log(`  top-3 claims' share of their year's total: mean ${pct(mean(annualTop3Share))}   median ${pct(q(sortNum(annualTop3Share), 0.5))}`);

console.log('\n=== DOES A MITIGATION PROGRAM REACH THE TOWER? (annual dollars, below vs above $5M retention) ===');
console.log(`  annual dollars retained below $5M/claim (pool keeps 100% of any cut here): ${fmt$(mean(annualBelowTower))} mean = ${pct(mean(annualBelowTower) / mean(annualGross))} of annual gross`);
console.log(`  annual dollars in claims above $5M (gross, pre-cession):                   ${fmt$(mean(annualAboveTower))} mean = ${pct(mean(annualAboveTower) / mean(annualGross))} of annual gross`);
console.log(`  of which, the EXCESS over $5M per claim (what the occurrence layer/tower actually prices): ${fmt$(mean(annualAboveTowerExcess))} mean`);
console.log(`  so a severity cut applied uniformly to all claims splits its benefit roughly ` +
  `${pct(mean(annualBelowTower) / mean(annualGross))} pool / ${pct(mean(annualAboveTowerExcess) / mean(annualGross))} reinsurer-side (by annual dollar exposure, if the tower is purchased)`);

console.log('\n=== IS THE LINE SUBSTANTIAL ENOUGH TO MATTER? ===');
console.log(`  annual gross loss mean ${fmt$(mean(annualGross))} against the $1,000,000/yr placeholder program cost:`);
console.log(`  placeholder is ${pct(1_000_000 / mean(annualGross))} of mean annual gross loss`);
console.log(`  a program that reduced ALL severity by X% would be worth (in expectation) X% x ${fmt$(mean(annualGross))} = ${fmt$(mean(annualGross) * 0.01)} per 1pp of severity cut`);

// CSV of the claim-size sample for external inspection.
{
  const header = 'claim_size';
  const csv = [header, ...sortedClaims.map(s => s.toFixed(2))].join('\n') + '\n';
  writeFileSync('scripts/diagnostics/_scratch-property-program-claimsizes.csv', csv);
  console.log('\nCSV written: scripts/diagnostics/_scratch-property-program-claimsizes.csv');
}

console.log('\nDone.');
