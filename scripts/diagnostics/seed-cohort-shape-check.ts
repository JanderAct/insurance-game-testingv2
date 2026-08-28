// ============================================================================
// THE SEED BOOK'S IMPLIED ACCIDENT-YEAR ULTIMATES — A GATE.
//
// ⚠ THIS EXITS NON-ZERO, AND IT IS THE ONLY THING THAT CAN SEE THE CHANGE IT
// GUARDS. Moving the seed weights from 1/(i+1) to the pattern's own unpaid share
// moves NOTHING in aggregate — the drawn reserve total is the same total however
// it is split, so the steady-state reserve, the invested assets, and all seven
// endingSurplus-derived fields are identical to the cent. Measured across both
// arrangements: pool reserve 2.247 both ways, reserveRiskMarginNeeded $57.13M
// against $57.14M, capitalFundingGap $355.04M both ways.
//
// What moves is the SHAPE, and only at generation. So that is what is asserted.
//
// ============================================================================
// WHAT THE SHAPE IS AND WHY IT MATTERS.
//
// A seed cohort's ultimate is BACK-DERIVED: `netUltimate = netUnpaid / (1 -
// paidRatio)`. Feed that arbitrary weights and it returns arbitrary ultimates —
// the pool is implicitly written as having underwritten wildly different amounts
// in consecutive years, for no reason. Measured at generation under 1/(i+1),
// largest ultimate over smallest:
//
//   WC 2.10x   GL 1.50x   Property 2.91x
//
// Property's worst case read $0.49M / $0.52M / $0.68M / $0.95M / $1.43M across
// five consecutive accident years.
//
// Weight by unpaidShare(age) instead and the division stops inventing: if
// netUnpaid(a) = U x unpaidShare(a) and paidRatio = cumulativePaid(a), then
// netUltimate = U identically, for every a. The book becomes what a pool in
// equilibrium actually looks like — one accident year at each age, the same
// ultimate behind each.
//
// ⚠ ASSERTED AT GENERATION, NOT AFTER THE PRE-GAME. runPriorHistory then runs
// three real engine years on these cohorts and develops them stochastically,
// which spreads the ultimates apart again — correctly, because that is real
// development rather than an artefact of apportionment. Checking after the
// pre-game would measure the development and call it the shape.
// ============================================================================

import { generateGameInstance, generateStartingPoolState } from '../../src/utils/instanceGenerator';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import type { CoverageLine, ReserveCohort } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 40);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

// ⚠ NOT 1.00, BECAUSE THE LAST COHORT TAKES THE REMAINDER. The generator hands
// the final cohort `remainingReserve` rather than its own weighted share, so the
// drawn total is reproduced EXACTLY rather than to within float error. That
// leaves the last ultimate a few ulps off U. A tenth of a percent is far above
// that and far below the 1.50x the arbitrary weights produced.
const MAX_SPREAD = 1.001;
// The control keeps 1/(i+1), so it must still be visibly arbitrary. Asserting
// that too is what stops this check quietly passing because the seed book went
// empty or single-cohort.
const MIN_CONTROL_SPREAD = 1.15;

const isSeed = (c: ReserveCohort) => c.developingClaims === undefined;
const isControl = LINE_PAYOUT_PATTERN.WC.kind === 'geometric';

const fails: string[] = [];
const spreads: Record<string, number[]> = {};
const counts: Record<string, number> = {};
for (const l of LINES) { spreads[l] = []; counts[l] = 0; }

for (let g = 0; g < GAMES; g++) {
  const id = `SHAPE${g}`;
  const inst = generateGameInstance(id, 3_900_000 + g * 7517);
  // ⚠ generateStartingPoolState IS THE BOOTSTRAP, BEFORE runPriorHistory. This is
  // the only point at which the apportionment is visible on its own; three
  // pre-game years of real development follow and correctly spread the
  // ultimates apart again.
  // -2 is the first year the pre-game bootstrap simulates.
  const { poolState } = generateStartingPoolState(inst, 2026, LINES, -2);
  for (const l of LINES) {
    const seeds = (poolState.lines[l]?.reserveCohorts ?? []).filter(isSeed);
    if (seeds.length < 2) continue;
    counts[l] += seeds.length;
    const ults = seeds.map((c: ReserveCohort) => c.netUltimate).filter((u: number) => u > 0);
    if (ults.length < 2) continue;
    spreads[l].push(Math.max(...ults) / Math.min(...ults));
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

console.log('=== SEED BOOK SHAPE: THE IMPLIED ACCIDENT-YEAR ULTIMATES ===');
console.log(`${GAMES} instances, read at generation. Weights: ${isControl ? '1/(i+1) — THE CONTROL' : 'the pattern\'s own unpaid share'}\n`);
console.log('  line       seed cohorts   mean spread   worst spread   verdict');
for (const l of LINES) {
  if (spreads[l].length === 0) { console.log(`  ${l.padEnd(10)} no seed book`); continue; }
  const m = mean(spreads[l]);
  const w = Math.max(...spreads[l]);
  let bad: boolean;
  if (isControl) {
    bad = w < MIN_CONTROL_SPREAD;
    if (bad) fails.push(`${l}: the CONTROL's worst spread is ${w.toFixed(3)}x, under ${MIN_CONTROL_SPREAD}x — `
      + 'the arbitrary weights should still be visibly arbitrary, so this check is not measuring what it thinks');
  } else {
    bad = w > MAX_SPREAD;
    if (bad) fails.push(`${l}: worst implied-ultimate spread is ${w.toFixed(4)}x, over ${MAX_SPREAD}x — `
      + 'the back-derivation is still inventing an ultimate per age rather than recovering one');
  }
  console.log(`  ${l.padEnd(10)} ${String(counts[l]).padStart(12)} ${m.toFixed(4).padStart(13)}x `
    + `${w.toFixed(4).padStart(13)}x   ${bad ? 'FAIL' : 'ok'}`);
}

console.log(fails.length === 0
  ? (isControl
    ? '\nTHE CONTROL IS STILL ARBITRARY, as it must be — it is the retired apportionment and this check\n'
      + 'confirms it can tell the two apart.'
    : '\nTHE SEED BOOK IS A STEADY-STATE BOOK. Every seed cohort implies the same accident-year ultimate,\n'
      + 'so the back-derivation recovers a figure the weights already carried rather than inventing one\n'
      + 'per age — which is the quantity a deep pre-game would produce directly from claim draws.')
  : `\n${fails.length} FAILURE(S):\n` + fails.map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
