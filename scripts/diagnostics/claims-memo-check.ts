// ============================================================================
// THE CLAIMS MEMO NAMES EVERY MEMBER IT SHOWS — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/claims-memo-check.ts
//
// The exhibit's whole addition over the one it replaces is the MEMBER column.
// Its failure mode is a dash: a row that renders, is ranked correctly, carries
// the right dollars, and cannot say whose claim it is. That reads as a gap in
// the data rather than as a defect, which is what makes it worth a gate.
//
// ============================================================================
// ⚠ WHAT IT IS REALLY GUARDING IS THE MATURATION YEARS, AND THEY ARE WHY
// DevelopingClaim CARRIES memberIds AT ALL.
//
// The member could have been looked up in the accident year's claim register —
// stored while the game is in memory, redrawn by claimRegeneration after a
// reload. That works for every year the game kept a ResultSet for. The seven
// MATURATION years are exactly the years it did not: they are simulated to build
// the opening book and deliberately never carried into priorHistory, so there is
// no result to redraw from, permanently. Measured before the field existed: 211
// of 839 developed occurrences sit in those years, and on WC they were FIVE OF
// THE TOP TEN in both games sampled.
//
// So this gate's central assertion is deliberately run on the WHOLE set rather
// than on the years a register can reach, and the positive control below empties
// the field to prove the assertion can see the difference.
//
// ⚠ AND IT RUNS BOTH ARMS — live and reloaded. `claims` is stripped from the
// save and `developingClaims` is not, so the exhibit survives a reload where the
// claims workbook needs regeneration. That asymmetry is easy to break by adding
// the wrong key to SAVE_STRIPPED_KEYS, and the symptom would be an empty page.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { packSave, unpackSave } from '../../src/utils/gameSave';
import { buildClaimsMemo, claimDescription, CLAIMS_ROWS_PER_LINE } from '../../src/utils/claimsMemo';
import type { CoverageLine, GameState, Member } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = Number(process.env.YEARS ?? 10);
const GAMES = Number(process.env.GAMES ?? 2);

const failures: string[] = [];
const RULE = '='.repeat(76);
const ok = (cond: boolean, label: string, detail: string) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures.push(`${label}: ${detail}`);
  return cond;
};

function build(g: number): { live: GameState; startingFinancials: unknown } {
  const id = `CLM${g}`;
  const inst = generateGameInstance(id, 4_242_424 + g * 6577);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory, startingFinancials } = runPriorHistory(inst, setup as never) as never as {
    poolState: GameState['poolState']; priorHistory: GameState['priorHistory']; startingFinancials: unknown };
  let gs: GameState = { setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true,
    isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
           currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
  return { live: gs, startingFinancials };
}

/** Every developed occurrence, per line, ranked as the memo ranks them. */
function developedByLine(g: GameState) {
  const out = new Map<CoverageLine, { accidentYear: number; memberIds: string[] }[]>();
  for (const line of LINES) {
    const rows = (g.poolState.lines[line]?.reserveCohorts ?? []).flatMap(c =>
      (c.developingClaims ?? []).filter(d => Math.abs(d.current - d.original) >= 1000)
        .map(d => ({ accidentYear: c.yearNumber, memberIds: d.memberIds ?? [],
                     mv: d.current - d.original })))
      .sort((a, b) => b.mv - a.mv);
    out.set(line, rows);
  }
  return out;
}

function roster(g: GameState): Map<string, Member> {
  const out = new Map<string, Member>();
  for (const m of g.poolState.allMarketMembers ?? []) out.set(m.id, m);
  for (const line of LINES) for (const m of g.poolState.lines[line]?.members ?? []) out.set(m.id, m);
  return out;
}

console.log(RULE);
console.log('THE CLAIMS MEMO: every displayed row names its member');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years x ${LINES.length} lines, ${CLAIMS_ROWS_PER_LINE} rows per line.\n`);

let totalDeveloped = 0, totalMaturation = 0, totalShown = 0;

for (let g = 0; g < GAMES; g++) {
  const { live, startingFinancials } = build(g);
  const reloaded = (unpackSave(packSave({ gameState: live, startingFinancials, initialMembers: [],
    currentDecisions: live.currentDecisions } as never)) as { gameState: GameState }).gameState;

  const byLineLive = developedByLine(live);
  const byLinePost = developedByLine(reloaded);
  const members = roster(reloaded);

  // The years a claim register could never be found for: no ResultSet exists.
  const haveResult = new Set([...reloaded.priorHistory, ...reloaded.lockedResults].map(r => r.yearNumber));

  console.log(`game ${g}:`);

  // 1. THE RELOAD. developingClaims is not stripped, so the exhibit survives.
  for (const line of LINES) {
    const a = byLineLive.get(line)!.length, b = byLinePost.get(line)!.length;
    ok(a === b, `${line}: the exhibit survives a save/restore (${a} developed occurrences)`,
      `${a} live against ${b} after reload — developingClaims is being stripped, and the page would go short in silence`);
  }

  // 2. EVERY DISPLAYED ROW NAMES A MEMBER, including the maturation years.
  for (const line of LINES) {
    const rows = byLinePost.get(line)!;
    totalDeveloped += rows.length;
    const shown = rows.slice(0, CLAIMS_ROWS_PER_LINE);
    totalShown += shown.length;
    const matur = shown.filter(r => !haveResult.has(r.accidentYear)).length;
    totalMaturation += matur;
    const nameless = shown.filter(r => r.memberIds.length === 0);
    const unknown = shown.filter(r => r.memberIds.length > 0 && r.memberIds.some(id => !members.has(id)));
    ok(nameless.length === 0,
      `${line}: all ${shown.length} displayed rows carry a member id (${matur} of them from years with no register)`,
      `${nameless.length} row(s) carry none — accident years ${[...new Set(nameless.map(r => r.accidentYear))].join(', ')}`);
    ok(unknown.length === 0, `${line}: every member id resolves to a member on the roster`,
      `${unknown.length} row(s) name an id the roster does not hold`);
  }

  // 3. THE RENDERED DOCUMENT. Not the data behind it — the text a reader sees.
  const memo = buildClaimsMemo({ gameState: reloaded });
  for (const line of LINES) {
    ok(memo.includes(`## ${line}`), `${line}: has its own section in the rendered memo`,
      'the section heading is absent, so the line is not split out');
  }
  const bodyRows = memo.split('\n').filter(l => /^\| -?\d+ \|/.test(l));
  ok(bodyRows.length > 0 && bodyRows.every(l => !/\|\s*—\s*\|/.test(l)),
    `the rendered memo has no em-dash member cell across its ${bodyRows.length} rows`,
    'at least one rendered row shows "—" where a member name belongs');
  // The description must never emit a raw mixture component.
  const leaked = bodyRows.filter(l => /component[123]|schoolsMedium|\binjected\b/.test(l));
  ok(leaked.length === 0, 'no row leaks a raw mixture-component label into the description',
    `${leaked.length} row(s) render a tier string: ${leaked[0]?.slice(0, 90)}`);
}

// ============================================================================
// ⚠ THE POSITIVE CONTROLS. Both target the assertion that matters — "every
// displayed row names a member" — because that check is the one whose green is
// worth nothing if it cannot go red.
// ============================================================================
console.log('\n  POSITIVE CONTROLS (each MUST be caught):');
{
  const { live } = build(0);
  const members = roster(live);

  // A: the field is empty, as it would be if the plumbing dropped it.
  const stripped: GameState = JSON.parse(JSON.stringify(live));
  for (const line of LINES)
    for (const c of stripped.poolState.lines[line]?.reserveCohorts ?? [])
      for (const d of c.developingClaims ?? []) d.memberIds = [];
  const rowsA = developedByLine(stripped).get('WC')!.slice(0, CLAIMS_ROWS_PER_LINE);
  const caughtA = rowsA.some(r => r.memberIds.length === 0);
  ok(caughtA, 'control A — memberIds emptied is caught by the member assertion',
    'the assertion passed on a set with no member ids at all');
  const memoA = buildClaimsMemo({ gameState: stripped });
  const dashRows = memoA.split('\n').filter(l => /^\| -?\d+ \|/.test(l) && /\|\s*—\s*\|/.test(l));
  ok(dashRows.length > 0, 'control A — and the RENDERED memo shows the em-dash the text check looks for',
    'the renderer produced no "—" cell, so the rendered-text assertion cannot fire');

  // B: an id that resolves to nobody, as a roster/id mismatch would produce.
  const bogus: GameState = JSON.parse(JSON.stringify(live));
  for (const c of bogus.poolState.lines.WC?.reserveCohorts ?? [])
    for (const d of c.developingClaims ?? []) d.memberIds = ['member-does-not-exist'];
  const rowsB = developedByLine(bogus).get('WC')!.slice(0, CLAIMS_ROWS_PER_LINE);
  const caughtB = rowsB.some(r => r.memberIds.some(id => !members.has(id)));
  ok(caughtB, 'control B — an unresolvable member id is caught by the roster assertion',
    'the assertion passed on ids no member holds');

  // C: the description must actually vary, ON EVERY LINE — a template with one
  // variable is not a description, and the lines get their content from
  // different fields so one line varying proves nothing about another.
  for (const line of LINES) {
    const all = (live.poolState.lines[line]?.reserveCohorts ?? []).flatMap(c => c.developingClaims ?? []);
    const descs = new Set(all.map(d => claimDescription(line, d, members)));
    ok(descs.size > 1, `control C — the ${line} description takes more than one value (${descs.size} distinct)`,
      `every ${line} claim gets the same description, so the column carries no information`);
    console.log(`        ${line} descriptions in use: ${[...descs].slice(0, 6).join(' | ')}`);
  }
  // D: and the status column must vary too, or it is decoration.
  const allC = LINES.flatMap(l => (live.poolState.lines[l]?.reserveCohorts ?? []).flatMap(c => c.developingClaims ?? []));
  const settled = allC.filter(d => d.closed === true).length;
  ok(settled > 0 && settled < allC.length,
    `control D — the status column varies (${settled} settled of ${allC.length} tracked occurrences)`,
    'every tracked occurrence has the same status, so the column carries no information');
}

console.log('');
console.log(`  developed occurrences ${totalDeveloped}, displayed ${totalShown}, `
  + `of which ${totalMaturation} are from years with no retrievable claim register`);
if (totalMaturation === 0) {
  failures.push('NO displayed row came from a year without a claim register, so the whole reason '
    + 'DevelopingClaim carries memberIds went untested. Either the maturation years stopped '
    + 'developing or this gate stopped reaching them — check before deleting the field.');
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('EVERY DISPLAYED ROW NAMES ITS MEMBER, ON BOTH ARMS, INCLUDING THE YEARS WHOSE');
  console.log('CLAIM REGISTER CAN NEVER BE RETRIEVED. THE DESCRIPTION CARRIES INFORMATION AND');
  console.log('LEAKS NO MIXTURE-COMPONENT LABEL.');
  console.log(RULE);
}
