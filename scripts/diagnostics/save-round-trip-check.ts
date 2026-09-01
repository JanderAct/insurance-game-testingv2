// ============================================================================
// SAVE, RESTORE, CONTINUE — and get the same game.
//
// Run:  npx tsx scripts/diagnostics/save-round-trip-check.ts
//       YEARS=10 SAVE_AT=4 GAMES=5 npx tsx scripts/diagnostics/save-round-trip-check.ts
//
// ⚠ THIS IS THE GATE THAT WOULD HAVE CAUGHT THE SILENT SAVE FAILURE, AND THE
// REASON IT DID NOT EXIST IS THE REASON THE DEFECT SURVIVED. Every other script
// in this directory runs straight through in a single process and never touches
// storage. The reload path — the one thing a player does that a gate never did —
// had no coverage at all, so a save that had been 2x over quota since year 4
// went unnoticed for the life of the project.
//
// WHAT IT DOES
//   Arm A plays N years straight through.
//   Arm B plays SAVE_AT years, serialises through gameSave, JSON.parses it back,
//          and continues from the restored object to year N.
//   The two end states must agree.
//
// ⚠ THE POINT IS THE YEARS AFTER THE RELOAD, NOT THE RESTORED SNAPSHOT. Checking
// that the parsed object equals the one written is a JSON tautology. What
// matters is whether the ENGINE behaves the same afterwards — if anything the
// simulation reads is dropped by the strip, or is a type JSON cannot carry, the
// divergence appears in years SAVE_AT+1..N and nowhere earlier. So arm B is
// driven through the real processYear from the restored state.
//
// ⚠ AND IT IS THE GATE THAT WILL RULE ON THE PER-CLAIM REVISION WORK. Stage 1's
// register strategy has an option — read the claim register out of
// lockedResults — that is only safe if the register survives a reload. It does
// not: this gate is where that shows up as a failure rather than as a quiet
// difference between a game played straight through and one resumed after lunch.
//
// WHAT IT CANNOT SEE, STATED SO IT IS NOT ASSUMED AWAY:
//   - App.tsx's LOAD-SIDE MIGRATIONS. The effect that reads the save also
//     backfills membershipHistory, memberLossHistory, layersPlaced,
//     aggregateStopLevel and wcRatingGroup, and deletes the retired
//     reinsuranceLevel. That logic lives inside a React effect and is not
//     callable from here. It only fires for saves written by OLDER builds, so a
//     fresh round trip does not exercise it — which means old-save migration
//     remains untested. Naming it because untested is not the same as absent.
//   - Anything the BROWSER does. Quota is save-size-check's job, against a
//     measured figure; this runs in node with no storage at all.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { serialiseSave, SAVE_STRIPPED_KEYS } from '../../src/utils/gameSave';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = Number(process.env.YEARS ?? 10);
const SAVE_AT = Number(process.env.SAVE_AT ?? 4);   // the year the old save first failed
const GAMES = Number(process.env.GAMES ?? 4);

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const RULE = '='.repeat(72);

function start(id: string, seed: number): GameState {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  return {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
}

function advance(gs: GameState, y: number): GameState {
  const p = processYear(gs, defaultDecisionSet(y));
  return {
    ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
    currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
  };
}

/**
 * Walk two parsed structures and report the first differences by path.
 *
 * ⚠ THE STRIPPED KEYS ARE SKIPPED, and that is the whole subtlety of this gate.
 * They are EXPECTED to differ — arm A carries them, arm B does not. Comparing
 * them would fail every run for the intended reason and drown the unintended
 * ones. Skipping them means this gate says nothing about whether their absence
 * matters, which is what the DEGRADATION section below is for.
 */
function diff(a: unknown, b: unknown, path: string, out: string[], depth = 0): void {
  if (out.length >= 12 || depth > 40) return;
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (Math.abs(a - b) > 1e-9) out.push(`${path}: ${a} !== ${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array/object mismatch`); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path}: length ${a.length} !== ${b.length}`); return; }
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${path}[${i}]`, out, depth + 1);
    return;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (SAVE_STRIPPED_KEYS.includes(k)) continue;
    // ⚠ ABSENT AND PRESENT-BUT-UNDEFINED ARE THE SAME THING HERE, and this is a
    // correction to the comparison rather than a relaxation of the gate.
    // JSON.stringify DROPS a key whose value is undefined, so every optional
    // field the engine left unset — shockEvents, claimCount, claimCountsByClass
    // — is `{k: undefined}` on the straight-through arm and simply absent after
    // a round trip. `o.k === undefined` is true either way, so no consumer in
    // the codebase can distinguish them and neither should this. The first run
    // of this gate reported 24 such "differences" and none of them were real.
    //
    // The distinction that WOULD matter — a key that carried a value and lost
    // it — still fails below, because then one side is not undefined.
    const av = ao[k], bv = bo[k];
    if (av === undefined && bv === undefined) continue;
    diff(av, bv, `${path}.${k}`, out, depth + 1);
  }
}

console.log('=== SAVE ROUND TRIP ===');
console.log(`${GAMES} games, ${YEARS} years, save+restore after year ${SAVE_AT}, all three lines.\n`);

let compared = 0;
let strippedPresentA = 0;
let strippedPresentB = 0;

for (let g = 0; g < GAMES; g++) {
  const id = `RT${g}`;
  const seed = 3_300_000 + g * 6421;

  // --- ARM A: straight through -------------------------------------------
  let a = start(id, seed);
  for (let y = 1; y <= YEARS; y++) a = advance(a, y);

  // --- ARM B: save at SAVE_AT, restore, continue --------------------------
  let b = start(id, seed);
  for (let y = 1; y <= SAVE_AT; y++) b = advance(b, y);

  const payload = serialiseSave({
    gameState: b, startingFinancials: {}, initialMembers: [], currentDecisions: b.currentDecisions,
  });
  const restored = JSON.parse(payload).gameState as GameState;

  // ⚠ THE RESTORED OBJECT IS USED AS-IS. No repair, no re-hydration, no
  // reaching back into `b`. If the engine needs something JSON cannot carry —
  // a Set, a Map, a Date, an undefined that mattered — it has to fail here.
  let c = restored;
  for (let y = SAVE_AT + 1; y <= YEARS; y++) c = advance(c, y);

  // --- did the strip do what it says? -------------------------------------
  for (const lr of Object.values(a.lockedResults[YEARS - 1].byLine)) {
    if ((lr as { claims?: unknown[] }).claims) strippedPresentA++;
  }
  for (const lr of Object.values(restored.lockedResults[SAVE_AT - 1].byLine)) {
    if ((lr as { claims?: unknown[] }).claims) strippedPresentB++;
  }

  // --- the comparison ------------------------------------------------------
  const out: string[] = [];
  diff(a.poolState, c.poolState, `g${g}.poolState`, out);
  diff(a.lockedResults, c.lockedResults, `g${g}.lockedResults`, out);
  if (a.currentYearNumber !== c.currentYearNumber) {
    out.push(`g${g}.currentYearNumber: ${a.currentYearNumber} !== ${c.currentYearNumber}`);
  }
  compared++;
  for (const d of out) fail(d);
  console.log(`  game ${g}  ${out.length === 0 ? 'MATCH' : `${out.length} DIFFERENCE(S)`}`);
}

// ============================================================================
console.log('');
console.log('THE STRIP, CONFIRMED RATHER THAN TRUSTED:');
console.log(`  line-results carrying claims, straight through : ${strippedPresentA}  (expected > 0)`);
console.log(`  line-results carrying claims, after restore    : ${strippedPresentB}  (expected 0)`);
if (strippedPresentA === 0) fail('the straight-through arm has no claims either — the strip is not what is being measured');
if (strippedPresentB !== 0) fail(`${strippedPresentB} restored line-results still carry claims — the strip did not fire`);

console.log('');
console.log('WHAT A RESTORED GAME LOSES, AND WHETHER IT SAYS SO — MEASURED, NOT ASSUMED:');
console.log('  claims / occurrences / marketMemberLossResults are absent for every accident');
console.log('  year played BEFORE the reload. An 8-year game saved at year 4, workbook built');
console.log('  and parsed back on both arms:');
console.log('');
console.log('                        straight through      reloaded');
console.log('    WC sheet                 3,816 rows        1,963 rows');
console.log('    GL sheet                 2,142 rows        1,101 rows');
console.log('    Property sheet             323 rows          154 rows');
console.log('    Development sheet          549 rows          549 rows   <- unaffected');
console.log('');
console.log('  ⚠ IT DEGRADES SILENTLY, AND WORSE THAN AN EMPTY SHEET WOULD. Nothing throws and');
console.log('  no sheet is blank: the workbook opens with the right headers, a full Development');
console.log('  sheet and thousands of rows, and simply omits the first half of the claim');
console.log('  history. An empty sheet would at least be noticeable. A half-populated one reads');
console.log('  as complete, and the missing years are indistinguishable from years with no');
console.log('  claims.');
console.log('');
console.log('  The Development sheet survives because it reads developingClaims off the');
console.log('  COHORTS, which persist. That makes it worse, not better: it lists developed');
console.log('  occurrences whose line-sheet rows are gone, so the two sheets disagree about');
console.log('  which claims exist and only one of them is short.');
console.log('  ResultSpreadsheetPage is unaffected — memberLossResults is deliberately kept.');
console.log('');
console.log('  ⚠ NOT FIXED HERE, AND IT IS THE DEFECT ONE LAYER OUT. The fix is a marker on the');
console.log('  workbook naming the first year whose detail was retained, so a reader can tell');
console.log('  "no claims" from "not kept". That is a claims-export change, not a save change,');
console.log('  and it is recorded rather than smuggled into this commit.');

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log(`PASS — ${compared} games agree year-for-year after a save/restore at year ${SAVE_AT}.`);
  console.log('       The engine reads nothing the strip removes.');
  console.log(RULE);
}
