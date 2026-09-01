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
// ⚠ AND IT IS THE GATE FOR CLAIM REGENERATION, WHICH IS THE WHOLE OF THAT
// COMMIT'S RISK. A restored game has no claims on the years before the reload;
// claimRegeneration redraws them from the roster, k, rc and year the result
// kept. A redraw that is not EXACT is worse than none, because every consumer
// would read plausible claims that were never drawn — silently. So the third
// section below regenerates EVERY line-year of the restored arm and compares it
// to the straight-through arm's in-memory register CLAIM BY CLAIM ON EVERY
// FIELD — ids, amounts, components, occurrence grouping — never on totals, which
// this project has seen agree while the register underneath differed. It then
// perturbs one input and requires the redraw to DIFFER, so the comparison is
// known to have teeth rather than assumed to.
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
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
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
  // ⚠ priorHistory IS COMPARED TOO, and it was not before. The pre-game years
  // are ResultSets like any other and carry their own claim registers, so the
  // strip empties them exactly as it empties the game years — which matters now
  // that the claims workbook reads them. This asserts the ENGINE still does not
  // care: everything on those three years except the per-claim flow survives.
  diff(a.priorHistory, c.priorHistory, `g${g}.priorHistory`, out);
  if (a.currentYearNumber !== c.currentYearNumber) {
    out.push(`g${g}.currentYearNumber: ${a.currentYearNumber} !== ${c.currentYearNumber}`);
  }
  compared++;
  for (const d of out) fail(d);
  console.log(`  game ${g}  ${out.length === 0 ? 'MATCH' : `${out.length} DIFFERENCE(S)`}`);
}

// ============================================================================
// REGENERATION — every line-year of the RESTORED arm, redrawn and compared to
// the straight-through arm's original objects, field by field.
// ============================================================================
let regenClaims = 0, regenOccs = 0, regenYears = 0;
const regenFail: string[] = [];
const canon = (o: unknown) => JSON.stringify(o, (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(15)) : v));
const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((x, y) => x.id.localeCompare(y.id));

for (let g = 0; g < GAMES; g++) {
  const id = `RT${g}`;
  const seed = 3_300_000 + g * 6421;
  let a = start(id, seed);
  for (let y = 1; y <= YEARS; y++) a = advance(a, y);
  let b = start(id, seed);
  for (let y = 1; y <= SAVE_AT; y++) b = advance(b, y);
  const restored = JSON.parse(serialiseSave({
    gameState: b, startingFinancials: {}, initialMembers: [], currentDecisions: b.currentDecisions,
  })).gameState as GameState;
  let c = restored;
  for (let y = SAVE_AT + 1; y <= YEARS; y++) c = advance(c, y);

  // Pre-game and game years alike, indexed by yearNumber on both arms.
  const originals = new Map([...a.priorHistory, ...a.lockedResults].map(r => [r.yearNumber, r]));
  for (const r of [...c.priorHistory, ...c.lockedResults]) {
    const orig = originals.get(r.yearNumber);
    if (!orig) { regenFail.push(`g${g} y${r.yearNumber}: no straight-through result to compare against`); continue; }
    for (const line of LINES) {
      const lrA = orig.byLine[line];
      if (!lrA?.claims) continue;
      let regen;
      try { regen = regenerateLineYearClaims(c.instance, r, line); }
      catch (e) { regenFail.push(`g${g} y${r.yearNumber} ${line}: regeneration THREW — ${(e as Error).message}`); continue; }
      regenYears++;
      const ca = sortById(lrA.claims), cb = sortById(regen.claims);
      if (ca.length !== cb.length) {
        regenFail.push(`g${g} y${r.yearNumber} ${line}: ${cb.length} regenerated claims vs ${ca.length} drawn`);
        continue;
      }
      for (let i = 0; i < ca.length; i++) {
        regenClaims++;
        if (canon(ca[i]) !== canon(cb[i])) {
          regenFail.push(`g${g} y${r.yearNumber} ${line} claim ${ca[i].id}: regenerated object differs from the drawn one`);
          break;
        }
      }
      const oa = sortById(lrA.occurrences ?? []), ob = sortById(regen.occurrences);
      if (canon(oa) !== canon(ob)) {
        regenFail.push(`g${g} y${r.yearNumber} ${line}: occurrence grouping differs (${oa.length} vs ${ob.length})`);
      } else regenOccs += oa.length;
    }
  }

  // ⚠ THE POSITIVE CONTROL. Perturb ONE stored input at a time and require the
  // redraw to differ from the original. If any of these still matches, the
  // comparison above cannot detect a changed input and everything it "proved"
  // is a JSON tautology. Three inputs, three separate perturbations.
  if (g === 0) {
    const r = c.lockedResults[0];
    const orig = originals.get(r.yearNumber)!;
    const control = (label: string, mutate: (lr: (typeof r.byLine)['GL']) => (typeof r.byLine)['GL']) => {
      const pr = { ...r, byLine: { ...r.byLine, GL: mutate(r.byLine.GL) } } as typeof r;
      const regen = regenerateLineYearClaims(c.instance, pr, 'GL');
      const same = canon(sortById(regen.claims)) === canon(sortById(orig.byLine.GL.claims ?? []));
      if (same) regenFail.push(`POSITIVE CONTROL FAILED: perturbing ${label} did not change the regenerated GL register — the comparison has no teeth`);
      return !same;
    };
    const c1 = control('rcEffectivenessApplied (+0.01)', lr => ({ ...lr, rcEffectivenessApplied: (lr.rcEffectivenessApplied ?? 0) + 0.01 }));
    const c2 = control('kLineApplied (x1.01)', lr => ({ ...lr, kLineApplied: (lr.kLineApplied ?? 1) * 1.01 }));
    const c3 = control('roster (first member removed)', lr => ({ ...lr, memberList: lr.memberList.slice(1) }));
    console.log(`  positive controls: rc ${c1 ? 'DIFFERS' : 'same!'}, k ${c2 ? 'DIFFERS' : 'same!'}, roster ${c3 ? 'DIFFERS' : 'same!'}`);
    // And the loud path: a result with no k must THROW, not redraw at k = 1.
    try {
      regenerateLineYearClaims(c.instance, { ...r, byLine: { ...r.byLine, GL: { ...r.byLine.GL, kLineApplied: undefined } } } as typeof r, 'GL');
      regenFail.push('a result without kLineApplied was regenerated instead of throwing');
    } catch { /* expected */ }
  }
}
for (const f of regenFail) fail(f);
console.log('');
console.log('REGENERATION, FIELD BY FIELD:');
console.log(`  line-years redrawn ${regenYears}, claims compared ${regenClaims}, occurrences compared ${regenOccs}`);
console.log(`  ${regenFail.length === 0 ? 'every regenerated claim and occurrence is identical to the one originally drawn' : `${regenFail.length} difference(s) — see FAILED`}`);

// ============================================================================
console.log('');
console.log('THE STRIP, CONFIRMED RATHER THAN TRUSTED:');
console.log(`  line-results carrying claims, straight through : ${strippedPresentA}  (expected > 0)`);
console.log(`  line-results carrying claims, after restore    : ${strippedPresentB}  (expected 0)`);
if (strippedPresentA === 0) fail('the straight-through arm has no claims either — the strip is not what is being measured');
if (strippedPresentB !== 0) fail(`${strippedPresentB} restored line-results still carry claims — the strip did not fire`);

console.log('');
console.log('WHAT A RESTORED GAME LOSES NOW: NOTHING A READER CAN SEE.');
console.log('  claims / occurrences / marketMemberLossResults are still absent from the save for');
console.log('  every year played before the reload — the strip is unchanged. The save grew by one');
console.log('  number per line-year (rcEffectivenessApplied, ~3.4 KB at year 10) and nothing else.');
console.log('  The claims workbook redraws those years through claimRegeneration and comes');
console.log('  back with the same accident years and row counts as a game played straight through');
console.log('  (claims-workbook-check asserts this). The reload marker that 5c3d9cc added is now');
console.log('  reserved for a result that CANNOT be redrawn — a save from before kLineApplied was');
console.log('  recorded — and names the reason when it fires.');
console.log('  marketMemberLossResults is the one thing not rebuilt: the prospect view is a');
console.log('  second generator call over the 200-member roster whose claims the engine discards,');
console.log('  and nothing exported reads it.');

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
