// ============================================================================
// THE CLAIMS LISTING IS A REGISTER, AND EVERY ROW IN IT IS REAL — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/claims-memo-check.ts
//
// The exhibit is a large-loss listing now: evaluation date, program, member,
// status, paid, incurred. Its failure modes are all QUIET ONES — a row that
// renders correctly and is wrong, or a column that is uniform and therefore
// carries nothing:
//
//   a dash where a member name belongs            (the member did not resolve)
//   a Paid figure that is not the workbook's      (a second allocation)
//   a Status that is not the workbook's           (a second closure draw)
//   every row Open, or every row Closed           (a column with no content)
//   a year's Paid not summing to the cohort's paydown  (dollars invented or lost)
//
// ============================================================================
// ⚠ THE CENTRAL ASSERTION IS AGREEMENT WITH THE CLAIMS WORKBOOK, because that
// is the property the design was chosen for.
//
// Paid is an ALLOCATION — no payment is recorded against an individual claim
// anywhere in this simulation. The listing could have computed its own split
// over the developing set; it reads the register and calls the same
// `claimPaidSplit` and `isClaimClosed` the workbook calls, precisely so one
// claim cannot carry two different numbers in two documents. A gate that only
// checked the listing internally would not notice that guarantee breaking, so
// this one recomputes the workbook's answer independently and compares.
//
// ⚠ AND IT RUNS BOTH ARMS — live and reloaded. The register is stripped from
// the save and redrawn by claimRegeneration, so the listing's whole source is
// reconstructed after a reload. Measured at 41 ms for a full year-10 book; what
// matters here is that it is the SAME book, claim for claim.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { packSave, unpackSave } from '../../src/utils/gameSave';
import { isClaimClosed, claimPaidSplit } from '../../src/utils/claimClosure';
import { resolveClosureCurve } from '../../src/data/defaultAssumptions';
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
import {
  buildClaimsMemo, claimListing, evaluationDate, CLAIMS_LISTING_ROWS, PROGRAM_LABEL,
} from '../../src/utils/claimsMemo';
import type { Claim, CoverageLine, GameState } from '../../src/types/simulation';

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

/**
 * The workbook's answer, recomputed here from first principles.
 *
 * ⚠ INDEPENDENT OF claimsMemo ON PURPOSE. It walks the register the same way
 * claimsExport does and calls the same two shared functions. If the listing ever
 * grows its own split, this diverges and says so.
 */
function workbookAnswer(g: GameState, asAt: number) {
  const paid = new Map<string, number>();
  const closedBy = new Map<string, boolean>();
  for (const line of LINES) {
    const grossPaidByAy = new Map<number, number>();
    for (const c of g.poolState.lines[line]?.reserveCohorts ?? []) {
      if (c.grossPaid !== undefined) grossPaidByAy.set(c.yearNumber, c.grossPaid);
    }
    for (const r of [...g.priorHistory, ...g.lockedResults].filter(x => x.yearNumber <= asAt)) {
      const lr = r.byLine[line];
      if (!lr) continue;
      let claims: Claim[];
      if (lr.claims !== undefined) claims = lr.claims;
      else { try { claims = regenerateLineYearClaims(g.instance, r, line).claims; } catch { continue; } }
      const age = asAt - r.yearNumber + 1;
      const cl = claims.map(c => isClaimClosed(
        resolveClosureCurve(line, c.grossUltimate), g.setup.instanceId, c.id, age));
      claims.forEach((c, i) => closedBy.set(c.id, cl[i]));
      const cohortPaid = grossPaidByAy.get(r.yearNumber);
      if (cohortPaid === undefined) continue;
      const split = claimPaidSplit(
        claims.map((c, i) => ({ grossUltimate: c.grossUltimate, closed: cl[i] })), cohortPaid);
      claims.forEach((c, i) => paid.set(c.id, split[i]));
    }
  }
  return { paid, closedBy };
}

console.log(RULE);
console.log('THE CLAIMS LISTING: a register, agreeing with the workbook');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years x ${LINES.length} lines, ${CLAIMS_LISTING_ROWS} rows.\n`);

let totalRows = 0, totalShown = 0;

for (let g = 0; g < GAMES; g++) {
  const { live, startingFinancials } = build(g);
  const reloaded = (unpackSave(packSave({ gameState: live, startingFinancials, initialMembers: [],
    currentDecisions: live.currentDecisions } as never)) as { gameState: GameState }).gameState;
  const asAt = YEARS;

  console.log(`game ${g}:`);

  // 1. THE RELOAD — the register is stripped and redrawn, claim for claim.
  const liveList = claimListing({ gameState: live, asAtYear: asAt });
  const postList = claimListing({ gameState: reloaded, asAtYear: asAt });
  ok(liveList.rows.length === postList.rows.length,
    `the listing survives a save/restore (${liveList.rows.length.toLocaleString()} claims)`,
    `${liveList.rows.length} live against ${postList.rows.length} after reload`);
  const liveTop = liveList.rows.slice(0, CLAIMS_LISTING_ROWS).map(r => r.claim.id).join(',');
  const postTop = postList.rows.slice(0, CLAIMS_LISTING_ROWS).map(r => r.claim.id).join(',');
  ok(liveTop === postTop, 'and the displayed rows are the same claims in the same order',
    'the reloaded book ranks differently, so the register was not reproduced exactly');

  const shown = postList.rows.slice(0, CLAIMS_LISTING_ROWS);
  totalRows += postList.rows.length;
  totalShown += shown.length;

  // 2. EVERY DISPLAYED ROW NAMES A MEMBER.
  const nameless = shown.filter(r => r.member === undefined);
  ok(nameless.length === 0, `all ${shown.length} displayed rows resolve their member`,
    `${nameless.length} row(s) do not — member ids ${nameless.map(r => r.claim.memberId).join(', ')}`);

  // 3. SORTED BY INCURRED, DESCENDING.
  const sorted = shown.every((r, i) => i === 0 || shown[i - 1].claim.grossUltimate >= r.claim.grossUltimate);
  ok(sorted, 'the listing is ranked by gross incurred, descending', 'it is not in order');

  // 4. AGREEMENT WITH THE WORKBOOK — the assertion the design exists for.
  const wb = workbookAnswer(reloaded, asAt);
  const paidDiff = shown.filter(r => {
    const w = wb.paid.get(r.claim.id);
    if (r.paid === undefined) return w !== undefined;
    return w === undefined || Math.abs(w - r.paid) > 1e-6;
  });
  ok(paidDiff.length === 0, 'every displayed Paid equals the workbook\'s allocation for that claim',
    `${paidDiff.length} row(s) differ — the listing has grown its own split, so one claim now `
    + 'carries two numbers in two documents');
  const statusDiff = shown.filter(r => wb.closedBy.get(r.claim.id) !== r.closed);
  ok(statusDiff.length === 0, 'every displayed Status equals the workbook\'s closure draw',
    `${statusDiff.length} row(s) differ — two closure draws for one claim`);

  // 5. THE SPLIT SUMS TO THE COHORT'S PAID, per line and accident year.
  //
  // ⚠ THIS ASSERTION REPLACED A WRONG ONE, AND THE CORRECTION IS WORTH KEEPING.
  // The first version asserted that a closed file never shows Paid above its own
  // Incurred. That is not the split's contract and claimPaidSplit explicitly
  // refuses it: when a cohort has paid more than its register sums to — an
  // adversely developed year — and no open claim is left to take the residual,
  // the dollars go back onto the closed files pro rata rather than being
  // dropped. The claims workbook's own note says the ratio can exceed 100% and
  // that it is not an error. The assertion failed on 1 and 2 rows across two
  // games, which was the gate being wrong about shipped behaviour.
  //
  // What the function DOES promise is that the split sums to the cohort's
  // paydown, and that is the property the residual clause exists to preserve —
  // so it is the one worth gating.
  const paidByAy = new Map<string, number>();
  for (const r of postList.rows) {
    if (r.paid === undefined) continue;
    const k = `${r.line}|${r.claim.accidentYear}`;
    paidByAy.set(k, (paidByAy.get(k) ?? 0) + r.paid);
  }
  let sumMismatch = 0, worstRel = 0;
  for (const line of LINES) {
    for (const c of reloaded.poolState.lines[line]?.reserveCohorts ?? []) {
      if (c.grossPaid === undefined) continue;
      const got = paidByAy.get(`${line}|${c.yearNumber}`);
      if (got === undefined) continue;          // no register for that year
      const rel = c.grossPaid > 0 ? Math.abs(got - c.grossPaid) / c.grossPaid : 0;
      if (rel > 1e-9) { sumMismatch++; worstRel = Math.max(worstRel, rel); }
    }
  }
  ok(sumMismatch === 0, 'each accident year\'s allocated Paid sums to the cohort\'s gross paid',
    `${sumMismatch} cohort(s) do not, worst relative error ${(worstRel * 100).toFixed(4)}% — the `
    + 'split is dropping or manufacturing dollars');

  // 6. THE RENDERED DOCUMENT.
  const memo = buildClaimsMemo({ gameState: reloaded, asAtYear: asAt });
  const bodyRows = memo.split('\n').filter(l => /^\| 12\/31\//.test(l));
  ok(bodyRows.length === shown.length, `the rendered memo has ${shown.length} body rows`,
    `it rendered ${bodyRows.length}`);
  ok(memo.includes(evaluationDate(reloaded, asAt)), 'the evaluation date is rendered and formatted',
    'the 12/31 evaluation date is absent');
  ok(!/\|\s*—\s*\|/.test(memo), 'no row renders an em-dash where a value belongs',
    'at least one cell rendered as "—"');
  // No mixture-component label may reach a reader — the vocabulary is internal.
  const leaked = bodyRows.filter(l => /component[123]|schoolsMedium|\binjected\b/.test(l));
  ok(leaked.length === 0, 'no row leaks a raw mixture-component label',
    `${leaked.length} row(s) render a tier string: ${leaked[0]?.slice(0, 90)}`);
  // Programs are the short forms, and more than one appears.
  const programs = new Set(bodyRows.map(l => l.split('|')[2]?.trim()));
  ok([...programs].every(p => Object.values(PROGRAM_LABEL).includes(p)),
    `the Program column uses the short forms (${[...programs].join(', ')})`,
    `it renders something else: ${[...programs].join(', ')}`);
  ok(programs.size > 1, 'more than one program appears in the listing',
    'one program fills the whole listing, which is the dominance the single table was checked against');
  // The description column is absent while nothing populates it.
  ok(!memo.includes('Claim description'),
    'the Claim description column is not rendered while no claim has one',
    'an always-empty column is being rendered');
}

// ============================================================================
// ⚠ THE POSITIVE CONTROLS. Each targets one assertion above; without them a
// green run says only that the code ran.
// ============================================================================
console.log('\n  POSITIVE CONTROLS (each MUST be caught):');
{
  const { live } = build(0);
  const asAt = YEARS;
  const base = claimListing({ gameState: live, asAtYear: asAt });
  const shown = base.rows.slice(0, CLAIMS_LISTING_ROWS);

  // A: a member id that resolves to nobody.
  const broken: GameState = JSON.parse(JSON.stringify(live));
  for (const r of [...broken.priorHistory, ...broken.lockedResults])
    for (const line of LINES)
      for (const c of r.byLine[line]?.claims ?? []) c.memberId = 'member-does-not-exist';
  const brokenShown = claimListing({ gameState: broken, asAtYear: asAt })
    .rows.slice(0, CLAIMS_LISTING_ROWS);
  ok(brokenShown.some(r => r.member === undefined),
    'control A — an unresolvable member id is caught by the member assertion',
    'the assertion passed on ids no member holds');

  // B: a Paid that disagrees with the workbook.
  const wb = workbookAnswer(live, asAt);
  const tampered = shown.map((r, i) => (i === 0 ? { ...r, paid: (r.paid ?? 0) + 1 } : r));
  ok(tampered.some(r => {
    const w = wb.paid.get(r.claim.id);
    return r.paid !== undefined && w !== undefined && Math.abs(w - r.paid) > 1e-6;
  }), 'control B — a Paid moved by $1 is caught by the workbook-agreement assertion',
    'a disagreeing Paid was accepted, so the agreement check has no teeth');

  // C: a status that disagrees.
  const flipped = shown.map((r, i) => (i === 0 ? { ...r, closed: !r.closed } : r));
  ok(flipped.some(r => wb.closedBy.get(r.claim.id) !== r.closed),
    'control C — a flipped Status is caught by the workbook-agreement assertion',
    'a disagreeing Status was accepted');

  // D: the STATUS COLUMN VARIES. A column that is uniform carries nothing, and
  // this is the one the brief asked for explicitly.
  const closedN = shown.filter(r => r.closed).length;
  ok(closedN > 0 && closedN < shown.length,
    `control D — the Status column varies within the displayed rows (${closedN} closed of ${shown.length})`,
    `every displayed row reads ${closedN === 0 ? 'Open' : 'Closed'}, so the column carries no information`);

  // E: the description column APPEARS when a claim has one — the other half of
  // the conditional. Without this, "the column is absent" would also pass on a
  // renderer that had no column at all.
  const withDesc: GameState = JSON.parse(JSON.stringify(live));
  const target = claimListing({ gameState: withDesc, asAtYear: asAt }).rows[0];
  for (const r of [...withDesc.priorHistory, ...withDesc.lockedResults])
    for (const line of LINES)
      for (const c of r.byLine[line]?.claims ?? []) {
        if (c.id === target.claim.id) c.description = 'Fall from height, disputed liability';
      }
  const memoD = buildClaimsMemo({ gameState: withDesc, asAtYear: asAt });
  ok(memoD.includes('Claim description') && memoD.includes('Fall from height, disputed liability'),
    'control E — the Claim description column APPEARS once a claim carries one',
    'populating a description did not produce the column, so the field is unreachable');
}

console.log('');
console.log(`  ${totalRows.toLocaleString()} claims on the book across ${GAMES} games, `
  + `${totalShown} displayed`);

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE LISTING IS A REGISTER: EVERY ROW NAMES ITS MEMBER, PAID AND STATUS AGREE WITH');
  console.log('THE CLAIMS WORKBOOK CLAIM FOR CLAIM, THE STATUS COLUMN VARIES, NO MIXTURE LABEL');
  console.log('LEAKS, AND THE DESCRIPTION COLUMN APPEARS ONLY WHEN A CLAIM CARRIES ONE.');
  console.log(RULE);
}
