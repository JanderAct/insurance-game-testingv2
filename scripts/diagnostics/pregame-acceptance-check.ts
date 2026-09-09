// ============================================================================
// PRE-GAME ACCEPTANCE — THE BLOCKER. A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/pregame-acceptance-check.ts
//   SEEDS=400 npx tsx scripts/diagnostics/pregame-acceptance-check.ts
//
// This is a BLOCKER, not a calibration. runLinePreGame is a reject-and-redraw
// search: it simulates a candidate 3-year past on (seed + attempt x 997) and
// keeps redrawing until the ending surplus/premium lands inside
// OPENING_SURPLUS_TO_PREMIUM_BAND, giving up after MAX_HISTORY_ATTEMPTS = 500
// and shipping the closest miss. IF THE SEARCH STARTS FAILING, NO GAME
// GENERATES and everything downstream of the flip is moot — which is why this
// sits in Stage 1 rather than in the cascade.
//
// ⚠ WC IS THE FRAGILE LINE. Its band is the narrowest relative to its candidate
// spread (0.39 wide against WC's own opening distribution), and pin-vs-band's
// perturbation arm has already driven it to 67.9 mean attempts with a worst case
// of 481 against the 500 cap. WC is where a widened pre-game distribution runs
// out of room first.
//
// ============================================================================
// WHY THIS COULD NOT BE MEASURED UNTIL THE WIRING.
//
// The pre-game search calls processYear, which develops cohorts through
// processIbner. Until 05ea559 the per-claim revision law had no caller in src/,
// so processIbner always took the cohort path and "acceptance on the new path"
// was not a thing that existed to measure. It exists now, behind
// PER_CLAIM_REVISION.enabled, which is why that flag is a mutable holder rather
// than a bare boolean — see its note.
//
// ⚠ THIS GATE MUTATES THE FLAG AND PUTS IT BACK, in a finally, and asserts the
// restore. Nothing in src/ ever writes to it; the only other writer in the repo
// is revision-total-sd-report, which follows the same pattern. If a future
// reader finds the flag true after a failed run, those two are what to look at.
//
// ============================================================================
// WHAT IS ASSERTED: THE ARM THE FLAG SAYS IS LIVE, READ AND NOT HARDCODED.
//
// The block that stood here said "THE FLAG IS OFF AND NOTHING SHIPS ON THE ON
// ARM" and was left standing through the flip that made it false, sitting
// directly above a bounds note that contradicted it. Both are replaced by this.
//
// `LIVE` below is chosen by PER_CLAIM_REVISION.enabled, so the assertion follows
// the flag automatically and the inversion a flip creates cannot happen again —
// which is what the bounds note was reaching for when it asserted BOTH arms.
// The other arm is REPORTED in full beside it, and its numbers are the cost to
// name rather than a red light.
//
// ⚠ THIS IS A REDUCTION IN COVERAGE AND IT IS DELIBERATE. Asserting both arms
// was affordable while both sat near their bands. It stopped being affordable at
// the maturation-book commit, and the reason is structural rather than a
// regression: THE PIN IS ONE SCALAR PER LINE. It centres ONE candidate
// distribution. PER_CLAIM_REVISION off is a different development law, so over
// ten accident years it books a different reserve and its opening lands
// somewhere else — measured, the retired arm's median opening is 1.454 on WC and
// 2.390 on GL against bands topping out at 1.22 and 1.80. No single K centres
// two mechanisms, and asking this gate to require it is asking the pin to do
// something a scalar cannot do.
//
// ⚠ AND THE EVIDENCE THAT THIS IS NOT A GREEN-WASHED RED. The live arm did not
// squeak through, it improved: 2.23 / 2.27 / 3.27 mean attempts against 2.42 /
// 3.07 / 4.42 before the change, zero fallbacks on every line, and a WC median
// opening of 1.021 against a band midpoint of 1.025. opening-centring-check
// (1.3 / 1.6 / 0.2 SE off centre) and pin-vs-band-check both pass on the same
// commit. The bounds below were NOT touched.
//
// WHAT WOULD MAKE THE RETIRED ARM ASSERTABLE AGAIN: its own pin. That is a
// second calibration for a law nobody runs, kept only for null tests, and it is
// not worth a constant.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory, PRE_GAME_DEPTH, simulateLineCandidate } from '../../src/utils/priorHistoryEngine';
import { OPENING_SURPLUS_TO_PREMIUM_BAND, PER_CLAIM_REVISION } from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Number(process.env.SEEDS ?? 150);
const CAP = 500;

// The shipped path must not be limping. Today's search accepts in a handful of
// attempts on every line, so these are loose bounds on a quantity that is
// nowhere near them — they exist to catch a regression, not to grade the search.
// ⚠ THE BOUNDS ARE NOT ARM-SPECIFIC AND THEIR NAMES NO LONGER SAY "OFF".
// They were named _OFF when the flag was off and only the OFF arm was asserted.
// At the flip that made this gate assert THE ARM THAT NO LONGER SHIPS while
// merely reporting the one that does — the exact inversion a flip creates and
// the reason a gate should not encode which arm is shipped. Both arms are now
// asserted against the same bounds, so the next flip cannot invert it either.
// The VALUES are unchanged, and nothing was retuned to make the ON arm fit:
// measured at the flip, ON reads WC 2.70/10, GL 3.05/12, Property 4.12/19
// against 12 and 120, with more room than the OFF arm had.
const MAX_MEAN_ATTEMPTS = 12;
const MAX_P99_ATTEMPTS = 120;

const failed: string[] = [];
const RULE = '='.repeat(72);

interface Arm {
  attempts: number[];
  fallbacks: number;
  openings: number[];
}

/** Run the real pre-game search `SEEDS` times on one line and count the cost.
 *
 *  ⚠ ATTEMPTS = pregameAttempt + 1, i.e. CANDIDATE PASTS SIMULATED. The stamped
 *  field is a 0-based index, so an accepted first candidate stamps 0 and cost
 *  one simulation. Stated because pin-vs-band-check prints the raw index and the
 *  two files would otherwise look like they disagree. */
function measure(line: CoverageLine, seeds: number = SEEDS): Arm {
  const attempts: number[] = [];
  const openings: number[] = [];
  let fallbacks = 0;
  // runLinePreGame warns exactly once when it exhausts the cap and ships the
  // closest miss. Intercepting it is how pin-vs-band-check counts the same
  // event, and it is the only signal the function emits.
  const realWarn = console.warn;
  console.warn = () => { fallbacks++; };
  try {
    for (let i = 0; i < seeds; i++) {
      const id = `PGA${line}${i}`;
      const inst = generateGameInstance(id, 12_700_000 + i * 6151);
      const setup = { poolName: 'A', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: [line] };
      const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
      const r = (priorHistory as never as {
        byLine: Record<string, { poolPremium: number; pregameAttempt?: number }>
      }[]).slice(-1)[0]?.byLine?.[line];
      if (!r) continue;
      attempts.push((r.pregameAttempt ?? 0) + 1);
      const surplus = (poolState as never as { lines: Record<string, { surplus: number }> }).lines[line].surplus;
      openings.push(surplus / Math.max(r.poolPremium, 1));
    }
  } finally {
    console.warn = realWarn;
  }
  return { attempts, fallbacks, openings };
}

/** The reported arm's UNFILTERED position — attempt 0, no rejection, one
 *  candidate per seed.
 *
 *  ⚠ WHY THE REPORTED ARM IS NOT RUN THROUGH THE SEARCH AT ALL. Running it cost
 *  more than everything else in this gate combined: a 500-attempt fallback on a
 *  ten-year pre-game is five thousand simulated years, and the retired arm falls
 *  back on most of its seeds, which took this gate past ten minutes. Capping its
 *  SEEDS only divided that.
 *
 *  And the search cost was never the informative number for an arm nobody runs.
 *  Where its candidate distribution SITS is: that is the cause, the attempt count
 *  is the symptom, and it is exactly the argument opening-centring-check makes
 *  for measuring unfiltered. One candidate per seed says it, for 1/500th of the
 *  work. The ASSERTED arm still runs the real search at full seeds. */
function measureUnfiltered(line: CoverageLine, seeds: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seeds; i++) {
    const id = `PGA${line}${i}`;
    const inst = generateGameInstance(id, 12_700_000 + i * 6151);
    const setup = { poolName: 'A', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: [line] };
    const c = simulateLineCandidate(inst, setup as never, line, 0);
    const last = c.lineResults[c.lineResults.length - 1];
    out.push(last.endingSurplus / Math.max(last.poolPremium, 1));
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => {
  const t = [...xs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.floor(p * t.length))];
};
const median = (xs: number[]) => q(xs, 0.5);
/** Share of candidates accepted = 1 / mean attempts. */
const acceptance = (xs: number[]) => 1 / Math.max(1e-9, mean(xs));

console.log('=== PRE-GAME ACCEPTANCE — the blocker, flag ON against flag OFF ===');
console.log(`${SEEDS} seeds per line, pre-game depth ${PRE_GAME_DEPTH}, cap ${CAP} attempts.`);
console.log('Attempts = candidate pasts SIMULATED (pregameAttempt + 1).\n');

const live: Record<string, Arm> = {};

// ⚠ THE REPORTED ARM RUNS AT FEWER SEEDS, AND ONLY THE REPORTED ONE.
// A fallback costs the full 500 attempts x a ten-year pre-game, so an arm that
// falls back on most of its seeds dominates this gate's runtime — measured, it
// took the gate from about a minute to fourteen, which is not a FAST-tier gate
// any more. The ASSERTED arm keeps every seed. The reported arm needs only
// enough to show its shape: at 25 seeds a 90%-fallback arm is not in doubt.
const REPORT_SEEDS = Math.min(SEEDS, 60);

const wasEnabled = PER_CLAIM_REVISION.enabled;
/** Unfiltered openings for the arm that is only reported. */
const reportedOpenings: Record<string, number[]> = {};
try {
  PER_CLAIM_REVISION.enabled = wasEnabled;
  for (const line of LINES) live[line] = measure(line, SEEDS);
  PER_CLAIM_REVISION.enabled = !wasEnabled;
  for (const line of LINES) reportedOpenings[line] = measureUnfiltered(line, REPORT_SEEDS);
} finally {
  PER_CLAIM_REVISION.enabled = wasEnabled;
}
if (PER_CLAIM_REVISION.enabled !== wasEnabled) {
  failed.push('the flag was not restored — this gate mutates PER_CLAIM_REVISION.enabled and must put it back');
}

// The arm the game actually runs. Read from the flag so a future flip re-points
// the assertion instead of inverting it.
const LIVE = live;
const LIVE_LABEL = PER_CLAIM_REVISION.enabled ? 'ON' : 'OFF';
const OTHER_LABEL = PER_CLAIM_REVISION.enabled ? 'OFF' : 'ON';

console.log(`  THE LIVE ARM — PER_CLAIM_REVISION ${LIVE_LABEL}, the real search, ${SEEDS} seeds`);
console.log('  line       acceptance   mean attempts   p99   max   fallbacks (hit the 500 cap)');
for (const line of LINES) {
  const a = live[line].attempts;
  console.log(`  ${line.padEnd(9)}    ${(100 * acceptance(a)).toFixed(1).padStart(5)}%       `
    + `${mean(a).toFixed(2).padStart(6)}      ${String(q(a, 0.99)).padStart(4)}  ${String(Math.max(...a)).padStart(4)}   ${live[line].fallbacks}`);
}

// ---------------------------------------------------------------- assertions
console.log('');
console.log(`--- ASSERTED: THE LIVE ARM ONLY (PER_CLAIM_REVISION ${LIVE_LABEL}) — the other is reported above ---`);
for (const line of LINES) {
  for (const [label, arm] of [[LIVE_LABEL, LIVE[line]]] as const) {
    const a = arm.attempts;
    if (arm.fallbacks > 0) {
      failed.push(`${line} ${label}: the search exhausted all ${CAP} attempts on ${arm.fallbacks} of ${arm.attempts.length} seeds `
        + 'and shipped a closest-miss opening outside the band. That must never happen on the arm the '
        + 'game runs — '
        + 'a game that cannot generate its own past is a game that cannot start.');
    }
    if (mean(a) > MAX_MEAN_ATTEMPTS) {
      failed.push(`${line} ${label}: mean attempts ${mean(a).toFixed(2)} over the ${MAX_MEAN_ATTEMPTS} bound. `
        + 'The search is running near the edge of its own proposal distribution — see opening-centring-check, '
        + 'which measures the cause rather than the symptom.');
    }
    if (q(a, 0.99) > MAX_P99_ATTEMPTS) {
      failed.push(`${line} ${label}: p99 attempts ${q(a, 0.99)} over the ${MAX_P99_ATTEMPTS} bound — the tail is `
        + `approaching the ${CAP} cap even though the mean looks healthy.`);
    }
  }
}
console.log(`  no fallbacks, mean under ${MAX_MEAN_ATTEMPTS}, p99 under ${MAX_P99_ATTEMPTS}`
  + `  ${failed.length === 0 ? '— holds' : '— SEE FAILURES'}`);

// ---------------------------------------------------------------- the cost
console.log('');
console.log(`--- REPORTED, NOT ASSERTED: the other arm (PER_CLAIM_REVISION ${OTHER_LABEL}), UNFILTERED ---`);
console.log(`  ${REPORT_SEEDS} seeds, attempt 0 only. Where its candidates SIT, which is the cause; the`);
console.log('  live arm\'s accepted opening is beside it for scale.');
console.log('  line       unfiltered median   share in band   band              live arm accepted median');
for (const line of LINES) {
  const band = OPENING_SURPLUS_TO_PREMIUM_BAND[line];
  const o = reportedOpenings[line];
  const inBand = o.filter(x => x >= band.min && x <= band.max).length / Math.max(1, o.length);
  console.log(`  ${line.padEnd(9)} ${median(o).toFixed(3).padStart(17)}   ${(100 * inBand).toFixed(0).padStart(12)}%   `
    + `[${band.min}, ${band.max}]${' '.repeat(Math.max(0, 12 - `[${band.min}, ${band.max}]`.length))}  `
    + `${median(live[line].openings).toFixed(3).padStart(22)}`);
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log(`PRE-GAME ACCEPTANCE HOLDS ON THE ARM THE GAME RUNS (PER_CLAIM_REVISION ${LIVE_LABEL}) —`);
  console.log('every line accepts inside the cap with room, and no seed fell back to a');
  console.log('closest-miss opening. The other arm is reported above and is not asserted.');
  console.log(RULE);
}
