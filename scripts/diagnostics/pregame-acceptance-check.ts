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
// ⚠ THIS GATE MUTATES THE FLAG AND PUTS IT BACK, in a finally. It is the only
// place in the repo that writes to it. If a future reader finds the flag true
// after a failed run, this is what to look at.
//
// ============================================================================
// WHAT IS ASSERTED, AND IT IS ONLY THE OFF ARM.
//
// THE FLAG IS OFF AND NOTHING SHIPS ON THE ON ARM. So the assertions hold the
// SHIPPED path — no fallbacks, and attempts inside a bound that today's search
// clears with room. The ON arm is REPORTED in full beside it: that is the
// number the flip has to be ruled on, and pre-committing a threshold to it now
// would be inventing a bar before anyone has decided the mechanism ships.
//
// A failing ON arm is therefore NOT a red light here. It is a cost to name.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory, PRE_GAME_YEARS } from '../../src/utils/priorHistoryEngine';
import { OPENING_SURPLUS_TO_PREMIUM_BAND, PER_CLAIM_REVISION } from '../../src/data/defaultAssumptions';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Number(process.env.SEEDS ?? 150);
const CAP = 500;

// The shipped path must not be limping. Today's search accepts in a handful of
// attempts on every line, so these are loose bounds on a quantity that is
// nowhere near them — they exist to catch a regression, not to grade the search.
const MAX_MEAN_ATTEMPTS_OFF = 12;
const MAX_P99_ATTEMPTS_OFF = 120;

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
function measure(line: CoverageLine): Arm {
  const attempts: number[] = [];
  const openings: number[] = [];
  let fallbacks = 0;
  // runLinePreGame warns exactly once when it exhausts the cap and ships the
  // closest miss. Intercepting it is how pin-vs-band-check counts the same
  // event, and it is the only signal the function emits.
  const realWarn = console.warn;
  console.warn = () => { fallbacks++; };
  try {
    for (let i = 0; i < SEEDS; i++) {
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

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => {
  const t = [...xs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.floor(p * t.length))];
};
const median = (xs: number[]) => q(xs, 0.5);
/** Share of candidates accepted = 1 / mean attempts. */
const acceptance = (xs: number[]) => 1 / Math.max(1e-9, mean(xs));

console.log('=== PRE-GAME ACCEPTANCE — the blocker, flag ON against flag OFF ===');
console.log(`${SEEDS} seeds per line, pre-game depth ${PRE_GAME_YEARS}, cap ${CAP} attempts.`);
console.log('Attempts = candidate pasts SIMULATED (pregameAttempt + 1).\n');

const off: Record<string, Arm> = {};
const on: Record<string, Arm> = {};

const wasEnabled = PER_CLAIM_REVISION.enabled;
try {
  PER_CLAIM_REVISION.enabled = false;
  for (const line of LINES) off[line] = measure(line);
  PER_CLAIM_REVISION.enabled = true;
  for (const line of LINES) on[line] = measure(line);
} finally {
  PER_CLAIM_REVISION.enabled = wasEnabled;
}
if (PER_CLAIM_REVISION.enabled !== wasEnabled) {
  failed.push('the flag was not restored — this gate mutates PER_CLAIM_REVISION.enabled and must put it back');
}

console.log('  line       arm    acceptance   mean attempts   p99   max   fallbacks (hit the 500 cap)');
for (const line of LINES) {
  for (const [label, arm] of [['OFF', off[line]], ['ON ', on[line]]] as const) {
    const a = arm.attempts;
    console.log(`  ${line.padEnd(9)}  ${label}    ${(100 * acceptance(a)).toFixed(1).padStart(5)}%       `
      + `${mean(a).toFixed(2).padStart(6)}      ${String(q(a, 0.99)).padStart(4)}  ${String(Math.max(...a)).padStart(4)}   ${arm.fallbacks}`);
  }
}

// ---------------------------------------------------------------- assertions
console.log('');
console.log('--- ASSERTED: the SHIPPED path only (the flag is off) ---');
for (const line of LINES) {
  const a = off[line].attempts;
  if (off[line].fallbacks > 0) {
    failed.push(`${line} OFF: the search exhausted all ${CAP} attempts on ${off[line].fallbacks} of ${SEEDS} seeds `
      + 'and shipped a closest-miss opening outside the band. On the SHIPPED path that must never happen — '
      + 'a game that cannot generate its own past is a game that cannot start.');
  }
  if (mean(a) > MAX_MEAN_ATTEMPTS_OFF) {
    failed.push(`${line} OFF: mean attempts ${mean(a).toFixed(2)} over the ${MAX_MEAN_ATTEMPTS_OFF} bound. `
      + 'The search is running near the edge of its own proposal distribution — see opening-centring-check, '
      + 'which measures the cause rather than the symptom.');
  }
  if (q(a, 0.99) > MAX_P99_ATTEMPTS_OFF) {
    failed.push(`${line} OFF: p99 attempts ${q(a, 0.99)} over the ${MAX_P99_ATTEMPTS_OFF} bound — the tail is `
      + `approaching the ${CAP} cap even though the mean looks healthy.`);
  }
}
console.log(`  no fallbacks on any line, mean under ${MAX_MEAN_ATTEMPTS_OFF}, p99 under ${MAX_P99_ATTEMPTS_OFF}`
  + `  ${failed.length === 0 ? '— holds' : '— SEE FAILURES'}`);

// ---------------------------------------------------------------- the cost
console.log('');
console.log('--- REPORTED: what the flip costs the search ---');
console.log('  line       mean attempts        p99            fallbacks       median opening');
for (const line of LINES) {
  const ao = off[line].attempts, an = on[line].attempts;
  const band = OPENING_SURPLUS_TO_PREMIUM_BAND[line];
  console.log(`  ${line.padEnd(9)}  ${mean(ao).toFixed(2)} -> ${mean(an).toFixed(2).padEnd(7)}`
    + `  ${String(q(ao, 0.99))} -> ${String(q(an, 0.99)).padEnd(6)}`
    + `  ${off[line].fallbacks} -> ${String(on[line].fallbacks).padEnd(6)}`
    + `  ${median(off[line].openings).toFixed(3)} -> ${median(on[line].openings).toFixed(3)}`
    + `   band [${band.min}, ${band.max}]`);
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('PRE-GAME ACCEPTANCE HOLDS ON THE SHIPPED PATH — every line accepts inside');
  console.log('the cap with room, and no seed fell back to a closest-miss opening. The ON');
  console.log('arm above is the flip\'s cost, reported and not gated.');
  console.log(RULE);
}
