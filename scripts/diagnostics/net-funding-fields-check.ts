// THE TWO NEW STORED FIELDS — expectedCededPer100 and netPurePremiumPer100.
//
// Run: npx tsx scripts/diagnostics/net-funding-fields-check.ts
//
// Purely additive commit: these were locals inside processLineYear
// (simulationEngine.ts) that nothing outside the engine could reach, which
// meant poolPremium could not be reproduced from the export by any route and
// the audit page's Funding Rate Build-Up card displayed a gross derivation
// beside a net value (38-73% apart on WC/GL). This asserts the one identity
// that justifies storing them: poolPremium is reconstructable from STORED
// fields alone, to float precision.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 30);
const YEARS = 8;
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way,
// attributing a failure in one section to a paragraph in another that happened
// to say "is NOT a defect". `failed` exists so the last line of output is the
// list, not the count.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? '  — ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

console.log('=== NET-FUNDING FIELDS: expectedCededPer100 / netPurePremiumPer100 ===\n');

const worstReconstruct: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
const worstReconstructVsBound: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
const worstIdentity: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
let propertyZero = 0;
let floorBound = 0;
let n = 0;
const cededShare: Record<string, number[]> = { WC: [], GL: [], Property: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `NFF${g}`;
  const inst = generateGameInstance(id, 4_400_000 + g * 7331);
  const setup = { poolName: 'N', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const l of LINES) {
      const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
      if (!r) continue;
      n++;

      // 1. THE IDENTITY THE COMMIT EXISTS FOR: poolPremium from stored fields alone.
      const reconstructed =
        r.activeExposure * r.netPurePremiumPer100 * r.selectedFundingCLF * (r.rateLevel / 100) * 10_000;
      const relErr = Math.abs(reconstructed - r.poolPremium) / Math.max(Math.abs(r.poolPremium), 1);
      worstReconstruct[l] = Math.max(worstReconstruct[l], relErr);
      // activeExposure itself is stored rounded to 2dp (pre-existing, not
      // touched by this commit) — that alone bounds the achievable relative
      // error at roughly 0.005 / activeExposure. Track the ratio to the new
      // fields' own error against that bound rather than against float noise.
      const roundingBound = 0.005 / Math.max(r.activeExposure, 1);
      worstReconstructVsBound[l] = Math.max(worstReconstructVsBound[l], relErr / Math.max(roundingBound, 1e-12));

      // 2. netPurePremiumPer100 + expectedCededPer100 == gross pure premium.
      // purePremiumPer100 is rounded to 4dp for display; compare at that
      // tolerance, not float tolerance, since that rounding is the one place
      // this identity is expected to be inexact.
      const identityGap = Math.abs(
        (r.netPurePremiumPer100 + r.expectedCededPer100) - r.purePremiumPer100
      );
      worstIdentity[l] = Math.max(worstIdentity[l], identityGap);

      if (l === 'Property' && r.expectedCededPer100 === 0) propertyZero++;

      const floored = r.netPurePremiumPer100 === 0 && r.expectedCededPer100 > 0;
      if (floored) floorBound++;

      if (r.purePremiumPer100 > 0) cededShare[l].push(r.expectedCededPer100 / r.purePremiumPer100);
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

console.log(`${n} line-years across ${GAMES} games x ${YEARS} years.\n`);

console.log('--- 1. poolPremium RECONSTRUCTED FROM STORED FIELDS ALONE ---');
console.log('  activeExposure x netPurePremiumPer100 x selectedFundingCLF x (rateLevel/100) x 10_000\n');
console.log('  ⚠ NOT gated at float precision. activeExposure is already stored rounded to 2dp');
console.log('  (pre-existing, simulationEngine.ts:1333 — untouched by this commit), which alone');
console.log('  bounds the achievable relative error at ~0.005/activeExposure, several orders above');
console.log('  float noise. Gated instead on the residual staying WITHIN that pre-existing bound —');
console.log('  i.e. that netPurePremiumPer100/expectedCededPer100 add NO error of their own.\n');
for (const l of LINES) {
  check(worstReconstruct[l] < 5e-4, `${l}: worst relative error`, worstReconstruct[l].toExponential(2));
  check(worstReconstructVsBound[l] < 1.5,
    `${l}: worst error stays within the activeExposure-rounding bound (ratio to bound)`,
    worstReconstructVsBound[l].toFixed(2));
}

console.log('\n--- 2. netPurePremiumPer100 + expectedCededPer100 == gross pure premium ---');
console.log('  Compared against purePremiumPer100 (rounded to 4dp for display) at 5e-5 tolerance —');
console.log('  that rounding, not float noise, is the only source of gap this identity should show.\n');
for (const l of LINES) {
  check(worstIdentity[l] < 5e-5, `${l}: worst |sum - grossPurePremium|`, worstIdentity[l].toExponential(2));
}

console.log('\n--- 3. PROPERTY NETS TOO, as of its own occurrence layer and aggregate ---');
check(propertyZero === 0, 'expectedCededPer100 is nonzero on every Property line-year (the default: layer placed)', `${propertyZero} counterexample(s)`);

console.log('\n--- 4. DOES THE max(0, ...) FLOOR EVER BIND? ---');
console.log('  If it never does, netPurePremiumPer100 is a pure subtraction with no information');
console.log('  the floor could hide — reported because it affects whether storing both fields is');
console.log('  redundancy or genuinely necessary precision.\n');
console.log(`  floor bound (net priced at 0 while ceded > 0): ${floorBound} of ${n} line-years`);
for (const l of LINES) {
  const s = cededShare[l];
  if (s.length === 0) continue;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const max = Math.max(...s);
  console.log(`  ${l.padEnd(10)} expectedCeded / grossPurePremium: mean ${(mean * 100).toFixed(1)}%  max ${(max * 100).toFixed(1)}%`);
}

console.log(failures === 0 ? '\nALL NET-FUNDING FIELD CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
