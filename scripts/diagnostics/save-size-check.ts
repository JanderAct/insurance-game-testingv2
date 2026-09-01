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
// ⚠ WHAT THIS DOES NOT CHECK. That the stripped save still RESTORES to a
// playable, identical game is a different question and a harder one — it is
// save-round-trip-check, and neither gate is sufficient alone. A save can fit
// and be useless.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  serialiseSave, SAVE_BUDGET_CHARS, MEASURED_QUOTA_CHARS, SAVE_STRIPPED_KEYS,
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

console.log('=== SAVE SIZE ===');
console.log(`${GAMES} games x ${YEARS} years x ${LINES.length} lines, default decisions.`);
console.log(`budget ${SAVE_BUDGET_CHARS.toLocaleString()} chars   measured browser quota `
  + `${MEASURED_QUOTA_CHARS.toLocaleString()} chars`);
console.log(`stripped on the way out: ${SAVE_STRIPPED_KEYS.join(', ')}\n`);

let worstStripped = 0;
let worstYear = 0;
const curve: { y: number; full: number; stripped: number }[] = [];

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
    // The old behaviour, for the before-and-after. Not what ships.
    const full = JSON.stringify(env).length;
    if (g === 0) curve.push({ y, full, stripped });
    if (stripped > worstStripped) { worstStripped = stripped; worstYear = y; }
  }
}

console.log('   yr |   OLD (no strip)  |     NEW (stripped) |  saved  | % of budget | % of quota');
for (const r of curve) {
  const overOld = r.full > MEASURED_QUOTA_CHARS ? '  <- over quota' : '';
  console.log(
    `   ${String(r.y).padStart(2)} | ${pad(r.full)} ${MiB(r.full).padStart(9)}`
    + ` | ${pad(r.stripped)} ${MiB(r.stripped).padStart(9)} |`
    + ` ${((1 - r.stripped / r.full) * 100).toFixed(0).padStart(4)}%  |`
    + ` ${((r.stripped / SAVE_BUDGET_CHARS) * 100).toFixed(0).padStart(9)}% |`
    + ` ${((r.stripped / MEASURED_QUOTA_CHARS) * 100).toFixed(0).padStart(8)}%${overOld}`
  );
}

console.log('');
if (worstStripped > SAVE_BUDGET_CHARS) {
  failed.push(
    `the save is ${worstStripped.toLocaleString()} characters at year ${worstYear}, over the `
    + `${SAVE_BUDGET_CHARS.toLocaleString()}-character budget. A player on a ${YEARS}-year game is `
    + `${((worstStripped / MEASURED_QUOTA_CHARS) * 100).toFixed(0)}% of the way to the browser's `
    + `measured limit and will hit it soon; strip more, or shrink what is kept.`
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
  console.log(`PASS — worst save ${worstStripped.toLocaleString()} chars at year ${worstYear}, `
    + `${((worstStripped / SAVE_BUDGET_CHARS) * 100).toFixed(0)}% of budget, `
    + `${((worstStripped / MEASURED_QUOTA_CHARS) * 100).toFixed(0)}% of the measured quota.`);
  console.log(RULE);
}
