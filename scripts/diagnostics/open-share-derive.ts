// ============================================================================
// THE OPEN-SHARE CURVE — A GENERATOR, AND THE VALIDATION THAT MAKES IT
// CHECKABLE RATHER THAN ASSUMED.
//
// Emits TRIANGLE_OPEN_SHARE for defaultAssumptions.ts, then measures the curve
// it just produced against the ENGINE's own realised open share by age. Run:
//   npx tsx scripts/diagnostics/open-share-derive.ts
//
// ============================================================================
// WHAT THE CURVE IS FOR. Forward booking drifts a cohort's WHOLE value once a
// year. A claim that closed at age 1 is still inside that value, so it keeps
// receiving development it should not — and the drift is front-loaded at
// 2/(age+1), so those are the largest steps. Scaling each step by the share of
// value still OPEN gives the cohort a per-claim clock with no per-claim state:
//
//     V(a) = V(a-1) . (1 + g . 2/(a+1) . s_a)
//          = V(a-1) + g . 2/(a+1) . (value still open)
//
// which is exactly the sum of the per-claim steps over the open claims. That is
// an identity, not an approximation, and it is asserted below.
//
// ⚠ TWO INDEX CHOICES, BOTH LOAD-BEARING, BOTH GOT WRONG ONCE. s_a applies to
// STEP a, which carries value from age a-1 to age a and multiplies by
// step(a) = 1 + g.2/(a+1). So it is weighted on value AT AGE a-1, and a claim
// takes that step iff its closure age ca > a. Pairing step(a) with the share at
// age a instead under-corrects by 10-27%.
//
// ⚠ AND IT IS VALUE-WEIGHTED ON THE DRIFTED VALUE, NOT ON THE OPENING. A claim
// still open at age 5 has been drifting for five steps and is worth more than
// it was booked at, so it carries more weight in the share than its opening
// value implies. Weighting on the opening understates the curve.
//
// ⚠ NOT resolveClosureCurve(line, 0). That is the smallest SIZE BAND, and it
// closes far faster than the value-weighted mix, which runs up to the retention.
// Measured when that proxy was tried at commit 1a, proxy / true open share:
//   WC 0.285 / 0.178 / 0.063 at ages 1 / 3 / 8;  GL 0.189 / 0.034 / 0.001;
//   Property 0.257 / 0.264 / 0.343.
// Three times to a thousand times too small. The curve has to be derived over
// the line's own size mix, which is what this file does.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { initialEstimate } from '../../src/utils/claimTriangle';
import { closedShare, claimClosureUnit } from '../../src/utils/claimClosure';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { generateGlClaims } from '../../src/utils/glClaimEngine';
import { generatePropertyClaims } from '../../src/utils/propertyClaimEngine';
import {
  resolveClosureCurve, CLAIM_REVISION_MAGNITUDE_NUMERATOR,
  TRIANGLE_DEVELOPMENT_DRIFT, OPEN_SHARE_MAX_AGE,
} from '../../src/data/defaultAssumptions';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const N = CLAIM_REVISION_MAGNITUDE_NUMERATOR;
/** Accident years drawn per line. The curve is a population statistic. */
const YEARS = Number(process.env.YEARS ?? 40);
const members = getPredefinedMarketMembers();

function register(line: CoverageLine) {
  const rows: { init: number; drawn: number; ca: number }[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const gameId = `OS${line}${y}`;
    const base = {
      members, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 6_100_000 + y * 7919, riskControlEffectiveness: 0,
    };
    const r = line === 'WC' ? generateWcClaims({ ...base, kLine: 1 })
      : line === 'GL' ? generateGlClaims({ ...base, kGl: 1, gPool: 1 })
        : generatePropertyClaims({ ...base, kPr: 1 });
    for (const c of r.claims) {
      const curve = resolveClosureCurve(line, c.grossUltimate);
      const u = claimClosureUnit(gameId, c.id);
      let ca = 40;
      for (let k = 1; k <= 40; k++) if (closedShare(curve, k) >= u) { ca = k; break; }
      rows.push({ init: initialEstimate(line, c.grossUltimate), drawn: c.grossUltimate, ca });
    }
  }
  return rows;
}

console.log(RULE);
console.log('OPEN-SHARE CURVE — DERIVER AND VALIDATION');
console.log(RULE);
console.log(`${YEARS} accident years per line, value-weighted on drifted value.\n`);

const emitted: string[] = [];
const TABLE: Record<string, number[]> = {};
let failures = 0;

for (const line of LINES) {
  const rows = register(line);
  const g = TRIANGLE_DEVELOPMENT_DRIFT[line];
  const step = (a: number) => 1 + g * (N / (a + 1));
  const cum = (upto: number) => { let f = 1; for (let k = 1; k <= upto; k++) f *= step(k); return f; };
  const valueAt = (r: { init: number; ca: number }, a: number) => r.init * cum(Math.min(r.ca - 1, a));

  const s: number[] = [];
  for (let a = 1; a <= OPEN_SHARE_MAX_AGE; a++) {
    let openV = 0, allV = 0;
    for (const r of rows) { const v = valueAt(r, a - 1); allV += v; if (r.ca > a) openV += v; }
    s.push(allV > 0 ? openV / allV : 0);
  }

  // --- THE IDENTITY. Compounding the curve to full runoff must reproduce the
  // per-claim mean-of-products exactly. If it does not, the curve is wrong.
  const initSum = rows.reduce((t, r) => t + r.init, 0);
  const perClaim = rows.reduce((t, r) => t + r.init * cum(r.ca - 1), 0) / initSum;
  let cohort = 1;
  for (let a = 1; a <= OPEN_SHARE_MAX_AGE; a++) cohort *= 1 + g * (N / (a + 1)) * s[a - 1];
  const idw = cohort / perClaim;
  const ok = Math.abs(idw - 1) <= 0.01;
  if (!ok) failures++;

  console.log(`--- ${line} ---`);
  console.log(`  identity: cohort compounding ${cohort.toFixed(4)} against per-claim `
    + `${perClaim.toFixed(4)} — ratio ${idw.toFixed(4)}  ${ok ? 'PASS' : 'FAIL'}`);
  console.log('  curve: ' + s.slice(0, 12).map((v, i) => `${i + 1}:${v.toFixed(3)}`).join(' '));
  emitted.push(`  ${line}: [${s.map(v => v.toFixed(5)).join(', ')}],`);
  TABLE[line] = s;
  console.log('');
}

console.log(RULE);
console.log('PASTE INTO defaultAssumptions.ts:');
console.log(RULE);
console.log('export const TRIANGLE_OPEN_SHARE: Record<string, number[]> = {');
for (const e of emitted) console.log(e);
console.log('};');
// ============================================================================
// ⚠ VALIDATION AGAINST THE ENGINE'S OWN REALISED OPEN SHARE. The curve above is
// derived from standalone generator draws; this reads the ENGINE's played claim
// registers, on different seeds, and recomputes the same statistic from them.
// That is an out-of-sample check on a different claim population, which is what
// makes the curve checkable rather than assumed.
// ============================================================================
console.log(RULE);
console.log('VALIDATION — the curve against the ENGINE\'s realised open share');
console.log(RULE);
{
  const VG = Number(process.env.VGAMES ?? 6);
  const realised: Record<string, { open: number; all: number }[]> = {};
  for (const l of LINES) { realised[l] = []; for (let a = 0; a <= 14; a++) realised[l].push({ open: 0, all: 0 }); }
  for (let gi = 0; gi < VG; gi++) {
    const id = `OSV${gi}`;
    const instance = generateGameInstance(id, 8_800_000 + gi * 7919);
    const setup = { poolName: 'O', gameLength: 12, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    let st = poolState;
    for (let y = 1; y <= 12; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      st = p.updatedPoolState;
      for (const lr of p.lineResults) {
        const l = lr.line;
        const claims = (lr.result as { claims?: { id: string; grossUltimate: number }[] }).claims;
        if (!claims) continue;
        const g2 = TRIANGLE_DEVELOPMENT_DRIFT[l];
        const cum2 = (upto: number) => { let f = 1; for (let k = 1; k <= upto; k++) f *= 1 + g2 * (N / (k + 1)); return f; };
        for (const c of claims) {
          const curve = resolveClosureCurve(l, c.grossUltimate);
          const u = claimClosureUnit(id, c.id);
          let ca = 40; for (let k = 1; k <= 40; k++) if (closedShare(curve, k) >= u) { ca = k; break; }
          const init = initialEstimate(l, c.grossUltimate);
          for (let a = 1; a <= 14; a++) {
            const v = init * cum2(Math.min(ca - 1, a - 1));
            realised[l][a].all += v;
            if (ca > a) realised[l][a].open += v;
          }
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: st, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
  console.log(`  ${VG} games, engine-played registers, seeds disjoint from the deriver's.\n`);
  console.log('  line      ' + [1, 2, 3, 4, 6, 8, 10].map(a => `step${String(a).padStart(2)}`).join('   '));
  let worst = 0;
  for (const l of LINES) {
    const curveRow: string[] = [], realRow: string[] = [];
    for (const a of [1, 2, 3, 4, 6, 8, 10]) {
      const cv = TABLE[l][a - 1];
      const rr = realised[l][a].all > 0 ? realised[l][a].open / realised[l][a].all : 0;
      curveRow.push(cv.toFixed(3).padStart(6));
      realRow.push(rr.toFixed(3).padStart(6));
      if (cv > 0.02 || rr > 0.02) worst = Math.max(worst, Math.abs(cv - rr));
    }
    console.log(`  ${l.padEnd(9)} curve ` + curveRow.join('   '));
    console.log(`  ${''.padEnd(9)} engin ` + realRow.join('   '));
  }
  console.log(`\n  worst absolute difference where either exceeds 0.02: ${worst.toFixed(4)}`);
  if (worst > 0.10) {
    console.log('  ⚠ THE CURVE DOES NOT DESCRIBE THE ENGINE\'S OWN REGISTERS.');
    failures++;
  } else {
    console.log('  The curve describes the engine\'s own played registers out of sample.');
  }
}

console.log(RULE);
if (failures > 0) {
  console.log(`${failures} LINE(S) FAILED THE IDENTITY — the curve does not reproduce the per-claim clock.`);
  process.exitCode = 1;
} else {
  console.log('THE IDENTITY HOLDS ON EVERY LINE — the curve reproduces the per-claim clock');
  console.log('at cohort level, which is the whole claim being made for it.');
}
console.log(RULE);
