// ============================================================================
// THE SAVE FITS — asserted at the reachable worst case, with the curve printed.
//
// Run:  npx tsx scripts/diagnostics/save-size-check.ts
//
// ⚠ THIS GATE EXISTS BECAUSE THE GAME SILENTLY STOPPED SAVING AT YEAR 4 AND
// NOTHING NOTICED FOR THE LIFE OF THE PROJECT. `persistState` was a bare
// JSON.stringify in a bare catch {}; the payload passed localStorage's ~5 MiB
// quota at year 4 and every write from then on threw and was swallowed. No gate
// could have caught it, because the write was a closure inside App.tsx that
// nothing outside React could call, and because every gate in this directory
// runs straight through in one process and never touches storage.
//
// THE WORST CASE IS REACHABLE, NOT HYPOTHETICAL. SetupPage's slider offers 3-10
// years, so 10 years x 3 lines is the largest save a player can produce. That is
// what this asserts, at defaults.
//
// THE BUDGET AND THE MEASURED QUOTA ARE DIFFERENT NUMBERS AND BOTH ARE IN
// gameSave.ts. The budget is a CI threshold set below the browser's real limit
// so this goes red about a game-year before a player would. See that header for
// the Chromium measurement (5,242,613 characters, QuotaExceededError) and for
// why the accounting had to be measured rather than assumed.
//
// ⚠ THIS ASSERTS THE COMPRESSED FIGURE, AND POINTING IT AT THE RAW ONE WOULD
// NOW BE THE BUG. The save goes to storage through packSave — stripped,
// serialised, DEFLATE'd, base64'd. Measuring serialiseSave's output would
// measure a string that is never stored, against a budget that is about a
// string that is. The raw column is still printed, because it is what the codec
// has to chew through on every write and it is the number that governs how long
// that takes; it is just not the one the budget is about.
//
// ⚠ AND IT ASSERTS THE PAYLOAD IS ASCII, WHICH IS THE ASSERTION THAT KEEPS THE
// REST OF THE MEASUREMENT HONEST. Chromium charges one byte per character for
// an ASCII value and two for anything else, so for a non-ASCII payload
// `length` understates storage by exactly 2x. base64's alphabet is ASCII, so
// today length IS the stored byte count — but that is a property of the codec,
// not of the gate, and a future codec that packs denser into UTF-16 would make
// every number below a half-truth while the gate went greener. So it is
// checked rather than assumed.
//
// ⚠ WHAT THIS DOES NOT CHECK. That the stripped save still RESTORES to a
// playable, identical game is a different question and a harder one — it is
// save-round-trip-check, and neither gate is sufficient alone. A save can fit
// and be useless.
//
// ============================================================================
// ⚠ AND SIZE IS NO LONGER THE BINDING CONSTRAINT ON THIS PATH — FREQUENCY WAS,
// AND IT IS NOW FIXED. The timing below is what ONE write costs; it used to be
// multiplied by 80.
//
// App.tsx called persistState from handleDecisionsChange, which is wired to
// SliderInput's onChange, which is a bare <input type="range"> onChange and
// therefore fires on EVERY INTERMEDIATE VALUE OF A DRAG. The Dividend /
// Assessment slider spans -0.25..0.15 at step 0.005 — 81 positions, 80 steps
// end to end — so one drag across it wrote the whole save 80 times. A
// pre-existing defect rather than one compression introduced, and compression
// made it five times more expensive, which is how it was found.
//
// saveScheduler.ts now coalesces a drag into ONE write, 400 ms after the last
// movement, with visibilitychange and pagehide covering the window in between.
// save-debounce-check owns that claim — 80 writes at delay 0 against 1 at the
// shipped delay, 2,000 randomised interleavings, three controls. This gate owns
// only what a single write costs, and prints the drag arithmetic from it.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  serialiseSave, packSave, decodeSave, SAVE_BUDGET_CHARS, MEASURED_QUOTA_CHARS,
  SAVE_STRIPPED_KEYS,
} from '../../src/utils/gameSave';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
/** The setup slider's maximum. The worst case a player can reach. */
const YEARS = Number(process.env.YEARS ?? 10);
const GAMES = Number(process.env.GAMES ?? 3);

const failed: string[] = [];
const RULE = '='.repeat(72);

const MiB = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const pad = (n: number) => n.toLocaleString().padStart(11);

/**
 * Chromium's localStorage accounting: one byte per character for an all-ASCII
 * value, two for anything else. Here rather than in gameSave.ts because it is
 * a measurement device, not something the app does.
 */
function storedBytes(s: string): number {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return s.length * 2;
  return s.length;
}
function firstNonAscii(s: string): number {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return i;
  return -1;
}
function ms<T>(f: () => T): [T, number] {
  const t = process.hrtime.bigint();
  const r = f();
  return [r, Number(process.hrtime.bigint() - t) / 1e6];
}

console.log('=== SAVE SIZE ===');
console.log(`${GAMES} games x ${YEARS} years x ${LINES.length} lines, default decisions.`);
console.log(`budget ${SAVE_BUDGET_CHARS.toLocaleString()} chars ON THE COMPRESSED PAYLOAD`
  + `   measured browser quota ${MEASURED_QUOTA_CHARS.toLocaleString()} chars`);
console.log(`stripped on the way out: ${SAVE_STRIPPED_KEYS.join(', ')}`);
console.log('then DEFLATE + base64 — see gameSave.ts for the codec bake-off.\n');

let worstPacked = 0;
let worstYear = 0;
let worstRaw = 0;
let worstPayload = '';
let worstEnv!: Parameters<typeof serialiseSave>[0];
const curve: { y: number; full: number; stripped: number; packed: number }[] = [];

for (let g = 0; g < GAMES; g++) {
  const id = `SAVESZ${g}`;
  const inst = generateGameInstance(id, 9_090_909 + g * 7717);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory, startingFinancials } = runPriorHistory(inst, setup as never) as never as {
    poolState: GameState['poolState']; priorHistory: GameState['priorHistory']; startingFinancials: unknown;
  };
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
    };
    const env = {
      gameState: gs, startingFinancials, initialMembers: [], currentDecisions: gs.currentDecisions,
    };
    const stripped = serialiseSave(env).length;
    const payload = packSave(env);
    const packed = storedBytes(payload);
    // The old behaviour, for the before-and-after. Not what ships.
    const full = JSON.stringify(env).length;
    if (g === 0) curve.push({ y, full, stripped, packed });
    if (packed > worstPacked) {
      worstPacked = packed; worstYear = y; worstRaw = stripped;
      worstPayload = payload; worstEnv = env;
    }
  }
}

console.log('   yr |   OLD (no strip)  |     raw (stripped) |    STORED (packed) | ratio | % budget | % quota');
for (const r of curve) {
  const overOld = r.full > MEASURED_QUOTA_CHARS ? '  <- over quota' : '';
  console.log(
    `   ${String(r.y).padStart(2)} | ${pad(r.full)} ${MiB(r.full).padStart(9)}`
    + ` | ${pad(r.stripped)} ${MiB(r.stripped).padStart(9)}`
    + ` | ${pad(r.packed)} ${MiB(r.packed).padStart(9)} |`
    + ` ${(r.stripped / r.packed).toFixed(2).padStart(5)} |`
    + ` ${((r.packed / SAVE_BUDGET_CHARS) * 100).toFixed(0).padStart(6)}% |`
    + ` ${((r.packed / MEASURED_QUOTA_CHARS) * 100).toFixed(0).padStart(5)}%${overOld}`
  );
}

// Per-year growth on the COMPRESSED figure — the number gameSave.ts's budget
// derivation cites for how many further game-years the margin buys.
if (curve.length >= 2) {
  const first = curve[0], last = curve[curve.length - 1];
  const perYear = (last.packed - first.packed) / (last.y - first.y);
  console.log(`\ncompressed growth ${Math.round(perYear).toLocaleString()} chars/game-year; `
    + `budget headroom ${(SAVE_BUDGET_CHARS - worstPacked).toLocaleString()} chars = `
    + `${((SAVE_BUDGET_CHARS - worstPacked) / perYear).toFixed(1)} further game-years.`);
}

// ⚠ THE ASCII ASSERTION. Without it every figure above is a claim about
// `length` wearing the label "stored bytes" — see the header.
const bad = firstNonAscii(worstPayload);
if (bad >= 0) {
  failed.push(
    `the stored payload is NOT ASCII (first non-ASCII character at index ${bad}, code `
    + `0x${worstPayload.charCodeAt(bad).toString(16)}). Chromium then stores it as UTF-16 at TWO `
    + `bytes per character, so the codec's apparent ratio is double the real one and every `
    + `figure above understates storage by 2x. Either restore an ASCII-alphabet codec or make `
    + `this gate and the budget measure bytes rather than characters.`
  );
}

// Timing, on the worst save. REPORTED, NOT ASSERTED: a wall-clock threshold on
// a shared CI runner is a flaky gate. The number is wanted for the frequency
// reason in the header, not as a pass/fail. Best of three, so a stray GC pause
// does not become the headline.
{
  const best = (f: () => unknown) => {
    let b = Infinity;
    for (let i = 0; i < 3; i++) b = Math.min(b, ms(f)[1]);
    return b;
  };
  const serMs = best(() => serialiseSave(worstEnv));
  const encMs = best(() => packSave(worstEnv));
  const decMs = best(() => decodeSave(worstPayload));
  console.log(`\ncodec on the worst save (${worstRaw.toLocaleString()} raw -> `
    + `${worstPacked.toLocaleString()} stored):`);
  console.log(`  serialise only ${serMs.toFixed(0)} ms   serialise+compress ${encMs.toFixed(0)} ms`
    + `   decompress+parse ${decMs.toFixed(0)} ms`);
  // ⚠ THE DRAG ARITHMETIC, WHICH IS WHY THIS FIGURE IS PRINTED AT ALL. The
  // decision path used to write once per slider STEP; saveScheduler now
  // coalesces a drag into one write. save-debounce-check owns the 80 -> 1
  // claim on a fake clock; this owns what each write actually costs.
  console.log(`\nA FULL-WIDTH DRAG of the Dividend / Assessment slider (80 steps):`);
  console.log(`  before the debounce   80 writes   ${(encMs * 80 / 1000).toFixed(1)} s blocked`
    + `   (${(serMs * 80 / 1000).toFixed(1)} s of it before the save was compressed)`);
  console.log(`  after  the debounce    1 write    ${(encMs / 1000).toFixed(2)} s blocked`
    + `, once the player stops moving`);
}

console.log('');
if (worstPacked > SAVE_BUDGET_CHARS) {
  failed.push(
    `the stored save is ${worstPacked.toLocaleString()} characters at year ${worstYear}, over the `
    + `${SAVE_BUDGET_CHARS.toLocaleString()}-character budget. That is `
    + `${((worstPacked / MEASURED_QUOTA_CHARS) * 100).toFixed(0)}% of the browser's measured limit, `
    + `from ${worstRaw.toLocaleString()} raw characters at a ${(worstRaw / worstPacked).toFixed(2)}x `
    + `compression ratio. Strip more, shrink what is kept, or — if the ratio has collapsed rather `
    + `than the payload grown — find out what stopped compressing.`
  );
}

// The old payload, asserted to have been over the line, so this gate documents
// the defect it was written for rather than only guarding against its return.
const oldWorst = curve.length > 0 ? curve[curve.length - 1].full : 0;
console.log(`the payload this replaces reached ${pad(oldWorst)} chars (${MiB(oldWorst)}) at year ${YEARS},`);
console.log(`which is ${(oldWorst / MEASURED_QUOTA_CHARS).toFixed(2)}x the measured browser quota — the defect.`);
console.log(`the first year it crossed: ${curve.find(r => r.full > MEASURED_QUOTA_CHARS)?.y ?? 'never'}`);

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log(`PASS — worst STORED save ${worstPacked.toLocaleString()} chars at year ${worstYear}, `
    + `${((worstPacked / SAVE_BUDGET_CHARS) * 100).toFixed(0)}% of budget, `
    + `${((worstPacked / MEASURED_QUOTA_CHARS) * 100).toFixed(0)}% of the measured quota, `
    + `from ${worstRaw.toLocaleString()} raw at ${(worstRaw / worstPacked).toFixed(2)}x.`);
  console.log(RULE);
}
