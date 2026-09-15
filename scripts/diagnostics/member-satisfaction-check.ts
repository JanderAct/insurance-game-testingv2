// ============================================================================
// PER-MEMBER SATISFACTION — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/member-satisfaction-check.ts
//   GAMES=8 YEARS=10 npx tsx scripts/diagnostics/member-satisfaction-check.ts
//
// ============================================================================
// THE FIRST ASSERTION IS THAT THE FIELD MOVES AT ALL, AND IT IS THE ONE THAT
// WOULD HAVE CAUGHT THE THING THIS REPLACES.
//
// Member.satisfaction was drawn once at enrolment and never updated — measured
// on the version this rebuild replaced, it changed in 70 of 18,239 member-year
// pairs, and every one of those was a member re-joining and drawing afresh. It
// stayed that way for months, through a departure rebuild that deleted its only
// consumer, because NOTHING IN THE REPO EVER ASKED IT TO MOVE. A frozen field
// with no reader is invisible to every other gate here: it breaks no identity,
// moves no baseline and fails no null.
//
// So section 1 is not a formality. It is the specific gate whose absence let a
// dead mechanic ship, and it is stated as a share of member-years rather than
// as "not constant" because "not constant" would have passed on the re-joins.
//
// ============================================================================
// AND THE SECOND ASSERTION IS THAT IT STILL FEEDS NOTHING.
//
// The ruling is that this is a SCOREBOARD: measured, displayed, consumed by no
// decision. That is not a property a run can demonstrate — an engine test can
// only show that today's seeds do not happen to route through it. Section 2 is
// therefore STATIC: it reads src/ and asserts that the set of files touching
// `.satisfaction` is exactly the allow-list below.
//
// ⚠ WHICH MEANS THE ALLOW-LIST IS THE RULING, AND ADDING A FILE TO IT IS THE
// DECISION. Anyone wiring satisfaction into departure or recruitment will have
// to edit this list, and at that moment memberSatisfaction.ts's three
// preconditions are what they should be reading. That is the point of putting
// the ruling in a gate rather than in a comment. Same discipline as
// surface-privacy-check, which holds risk quality off every render path.
//
// ============================================================================
// FIVE SECTIONS.
//
//   1. IT MOVES. Share of member-years that change, per line, against a null
//      arm at weight 0 which must move NONE.
//   2. IT FEEDS NOTHING. Static allow-list over src/.
//   3. DRIFT AT DEFAULTS. All-defaults is the neutral point of this model, and
//      a scoreboard that slides at defaults is a scoreboard measuring its own
//      calibration error. This is also precondition 3 for ever promoting the
//      field into departure — see memberSatisfaction.ts.
//   4. THE INTERACTION IS REAL. The design's whole claim is that the loss term
//      MODULATES the price term rather than adding to it: among members facing
//      the same increase, the blameless ones must be unhappier than the ones
//      whose own claims explain their bill. If that ordering does not hold, the
//      model is two independent penalties wearing an interaction's name.
//   5. POSITIVE CONTROL. A seed-matched pool priced above the market must end
//      unhappier. A satisfaction model that never responds to price is the
//      frozen field again with more arithmetic in front of it.
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { SATISFACTION, satisfactionMoves } from '../../src/utils/memberSatisfaction';
import { marketRateChangePct } from '../../src/utils/marketConditions';
import type { CoverageLine, DecisionSet, GameState, Member } from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 10);
/** Share of member-years that must move for the field to count as alive. */
const MIN_MOVED_SHARE = 0.50;
/**
 * What the NULL arm is allowed to move. Not zero: re-enrolment draws a fresh
 * satisfaction, so a member who leaves and comes back changes it with the
 * mechanism switched off. Measured at 0.86% here; the frozen field this
 * replaces measured 0.4% and that residue was the whole of its movement.
 */
const MAX_NULL_SHARE = 0.02;
/** Satisfaction points per member-year. See section 3 for where it came from. */
const MAX_DEFAULTS_DRIFT = 0.020;
/** The priced-up arm: fundingAtExpected off, confidence climbing to the cap. */
const RAMP_START = 0.60;
const RAMP_STEP = 0.035;

/**
 * ⚠ THE RULING, AS A LIST. Every file in src/ that may touch `.satisfaction` on
 * a Member. Adding one is a decision about whether this stays a scoreboard.
 */
const ALLOWED: Record<string, string> = {
  'src/types/simulation.ts': 'the field declaration',
  'src/data/memberCatalog.ts': 'the roster\'s opening spread',
  'src/utils/memberSatisfaction.ts': 'the model itself',
  'src/utils/membershipEngine.ts': 'the enrolment draw, the one call that advances the stock — '
    + 'AND the retention weight below, which is a different quantity with the same name',
  'src/utils/memberDeparture.ts': 'PROSE ONLY — the header records why the old key was wrong',
  'src/pages/MembershipPage.tsx': 'the roster column and its sort',
  // ⚠ FOUND BY THIS GATE, NOT KNOWN BEFORE IT. The spreadsheet page carries a
  // per-member Satisfaction column AND a CSV export of it, and neither export
  // baseline covers that path — solo-export-guard hashes buildResultsWorkbook,
  // which has no per-member roster. So this is a player-facing export surface
  // that no baseline sees, which is also why both baselines held bit-identical
  // across the commit that made the field move.
  'src/pages/ResultSpreadsheetPage.tsx': 'a per-member column and its CSV — UNGATED BY EITHER BASELINE',
  // ⚠ A NAME COLLISION AND NOT A CONSUMER. MEMBER_MOVEMENT_WEIGHTS.retention
  // has a field literally called `satisfaction`; it weights the POOL-LEVEL
  // scalar into retention and never sees a Member. Allow-listed rather than
  // excluded by a cleverer regex, because the collision is real and the next
  // reader should be told it exists rather than have it filtered away.
  'src/data/defaultAssumptions.ts': 'MEMBER_MOVEMENT_WEIGHTS.retention.satisfaction — the POOL scalar\'s weight',
};

const failures: string[] = [];
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const sd = (v: number[]) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

interface LineYear {
  line: string; year: number; members: Member[];
  moves: ReturnType<typeof satisfactionMoves>;
}

function play(g: number, ramp: boolean): LineYear[] {
  const id = `MS${g}`;
  const instance = generateGameInstance(id, 61_000_000 + g * 6779);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: LineYear[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y) as DecisionSet;
    if (ramp) {
      for (const l of LINES) {
        d.byLine[l].fundingAtExpected = false;
        d.byLine[l].fundingConfidenceLevel = Math.min(0.95, RAMP_START + RAMP_STEP * (y - 1));
      }
    }
    // The book and the ledger as they stand ENTERING the year, so the moves
    // recomputed below are the ones the engine just made rather than a
    // re-derivation against next year's state.
    const entering: Record<string, Member[]> = {};
    for (const l of LINES) entering[l] = gs.poolState.lines[l].members.filter(m => m.status === 'active');
    // The ledger as it stands ENTERING the year. `?? {}` covers the first year
    // of a state built without one; a member with no history is unrated, which
    // is the same thing an empty ledger says.
    const enteringLedger = gs.poolState.memberLossHistory ?? {};
    const enteringRate: Record<string, number> = {};
    for (const l of LINES) enteringRate[l] = gs.poolState.lines[l].ratePer100;

    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };

    for (const lr of p.lineResults) {
      const line = lr.line as CoverageLine;
      const x = lr.result as never as Record<string, unknown>;
      const charged = x.ratePer100 as number;
      const priorRate = enteringRate[line];
      const rateChangePct = priorRate > 0 ? (charged / priorRate - 1) * 100 : null;
      out.push({
        line, year: y,
        members: x.memberList as Member[],
        moves: satisfactionMoves(
          entering[line], line, enteringLedger, rateChangePct,
          marketRateChangePct(line, y, { seed: instance.seed, gameId: id }),
        ),
      });
    }
  }
  return out;
}

console.log(RULE);
console.log('PER-MEMBER SATISFACTION — a scoreboard, and it has to move and feed nothing');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years. Weight ${SATISFACTION.priceWeight} points per pp, `
  + `fault discount ${SATISFACTION.faultDiscount}, stock clamped to `
  + `[${SATISFACTION.floor}, ${SATISFACTION.ceiling}].\n`);

const baseline = Array.from({ length: GAMES }, (_, g) => play(g, false));

// --- 1. it moves ------------------------------------------------------------
console.log('--- 1. the field moves ---');
function movedShare(runs: LineYear[][], line: string): { moved: number; total: number; clamped: number } {
  let moved = 0, total = 0, clamped = 0;
  for (const run of runs) {
    const prev = new Map<string, number>();
    for (const ly of run.filter(r => r.line === line)) {
      for (const m of ly.members) {
        const was = prev.get(m.id);
        if (was !== undefined) { total++; if (was !== m.satisfaction) moved++; }
        if (m.satisfaction <= SATISFACTION.floor || m.satisfaction >= SATISFACTION.ceiling) clamped++;
        prev.set(m.id, m.satisfaction);
      }
    }
  }
  return { moved, total, clamped };
}
for (const line of LINES) {
  const s = movedShare(baseline, line);
  const share = s.moved / Math.max(s.total, 1);
  const ok = share >= MIN_MOVED_SHARE;
  console.log(`  ${line.padEnd(9)} ${s.moved}/${s.total} member-years moved (${(100 * share).toFixed(1)}%)   `
    + `at a clamp ${s.clamped}   ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: only ${(100 * share).toFixed(1)}% of member-years moved, under the `
      + `${(100 * MIN_MOVED_SHARE).toFixed(0)}% floor. The field this replaced moved in 0.4% of them and `
      + `shipped that way for months — this is the assertion whose absence allowed it.`);
  }
}
{
  // The null arm. Weight 0 must freeze the field completely, which is also the
  // statement that every move above came from THIS mechanism and not from
  // members joining and drawing afresh.
  const keep = SATISFACTION.priceWeight;
  SATISFACTION.priceWeight = 0;
  const nullRuns = Array.from({ length: Math.min(3, GAMES) }, (_, g) => play(g, false));
  SATISFACTION.priceWeight = keep;
  let moved = 0, total = 0;
  for (const line of LINES) { const s = movedShare(nullRuns, line); moved += s.moved; total += s.total; }
  const share = moved / Math.max(total, 1);
  const ok = share <= MAX_NULL_SHARE;
  console.log(`  null arm (weight 0): ${moved}/${total} member-years moved (${(100 * share).toFixed(2)}%)  ${ok ? 'OK' : 'FAIL'}`);
  console.log('    ⚠ NOT ZERO, AND THE RESIDUE IS THE POINT. A member who withdraws and re-enrols');
  console.log('      draws a fresh U(6.0, 8.5) at join, so the field moves for them even with the');
  console.log('      mechanism switched off. That residue is the ENTIRETY of what the frozen field');
  console.log('      this replaced ever did — 70 moves in 18,239 member-year pairs, 0.4% — which is');
  console.log('      why section 1 asserts a SHARE rather than "not constant".');
  if (!ok) {
    failures.push(`${(100 * share).toFixed(2)}% of member-years moved with the weight at 0, past the `
      + `${(100 * MAX_NULL_SHARE).toFixed(0)}% re-join allowance. Something other than the price term and `
      + `the enrolment draw is writing Member.satisfaction, so section 1's share is not measuring this `
      + `mechanism.`);
  }
}

// --- 2. it feeds nothing ----------------------------------------------------
console.log('\n--- 2. nothing reads it (static) ---');
{
  const roots = ['src'];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      const body = readFileSync(p, 'utf8');
      // `.satisfaction` on a value, or `satisfaction:` in an object literal or
      // type. The lookbehind is on `satisfaction` itself and excludes
      // `memberSatisfaction`, which is the POOL-LEVEL scalar and a different
      // quantity — see memberSatisfaction.ts's seam note.
      //
      // ⚠ THE FIRST CUT PUT THE LOOKBEHIND BEFORE THE DOT, which tested the
      // character before `.` rather than before `satisfaction` — so
      // `member.satisfaction` was EXCLUDED and MembershipPage, the field's
      // whole reason for existing, read as not touching it. A static allow-list
      // whose matcher misses the real consumers is worse than none: it reports
      // a clean surface it never looked at.
      if (/(?<![A-Za-z])satisfaction\s*:/.test(body) || /\.satisfaction\b/.test(body)) {
        hits.push(p.replace(/\\/g, '/'));
      }
    }
  };
  for (const r of roots) walk(r);
  const unexpected = hits.filter(h => !(h in ALLOWED));
  const missing = Object.keys(ALLOWED).filter(a => !hits.includes(a));
  for (const h of hits.sort()) console.log(`  ${h.padEnd(40)} ${ALLOWED[h] ?? '*** NOT ON THE ALLOW-LIST ***'}`);
  if (unexpected.length > 0) {
    failures.push(`Member.satisfaction is touched by ${unexpected.join(', ')}, which is not on the `
      + `allow-list. It is a SCOREBOARD: if this is a new consumer, read memberSatisfaction.ts's three `
      + `preconditions before adding the file here, because a consumer makes it a mechanic.`);
  }
  if (missing.length > 0) {
    console.log(`  ⚠ allow-listed but no longer matching: ${missing.join(', ')}`);
    failures.push(`the allow-list names ${missing.join(', ')}, which no longer touches the field. `
      + `A stale allow-list is a list nobody trusts; remove the entry.`);
  }
  console.log(`  ${hits.length} files, ${unexpected.length} unexpected  ${unexpected.length === 0 && missing.length === 0 ? 'OK' : 'FAIL'}`);
}

// --- 3. drift at defaults ---------------------------------------------------
console.log('\n--- 3. drift at defaults ---');
console.log('  MEASURED ON THE SHIPPED SERIES, NOT ON A RE-DERIVATION. Each member\'s year-over-year');
console.log('  change in the stored field, on members present in both years — so it is the move the');
console.log('  engine actually made. The re-derived `moves` used in section 4 cannot serve here: the');
console.log('  engine feeds movement the PRE-MOVEMENT quote (estimatedTotalMemberRatePer100 against');
console.log('  last year\'s rate), and a gate recomputing from the FINAL charged rate would report a');
console.log('  drift the game does not have.');
for (const line of LINES) {
  const deltas: number[] = [];
  for (const run of baseline) {
    const prev = new Map<string, number>();
    for (const ly of run.filter(r => r.line === line)) {
      for (const m of ly.members) {
        const was = prev.get(m.id);
        if (was !== undefined) deltas.push(m.satisfaction - was);
        prev.set(m.id, m.satisfaction);
      }
    }
  }
  const m = mean(deltas);
  const se = sd(deltas) / Math.sqrt(deltas.length);
  const ok = Math.abs(m) <= MAX_DEFAULTS_DRIFT;
  console.log(`  ${line.padEnd(9)} observed drift ${m >= 0 ? '+' : ''}${m.toFixed(4)} +/- ${se.toFixed(4)} pts/member-yr   `
    + `over ${YEARS} years ${(m * YEARS >= 0 ? '+' : '')}${(m * YEARS).toFixed(3)} pts   ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) {
    failures.push(`${line}: satisfaction drifts ${m.toFixed(4)} points per member-year AT DEFAULTS, `
      + `past the ${MAX_DEFAULTS_DRIFT} bound. All-defaults is this model's neutral point; a scoreboard `
      + `that slides there is reporting its own calibration error as a player's result, and it is `
      + `precondition 3 against ever promoting this field into departure.`);
  }
}
// WHERE THE RESIDUAL DRIFT COMES FROM. Printed, not asserted — the assertion is
// the drift above. A member's bill is the pool's rate change TIMES their own
// modifier change, so the gap against the market has two sources and they are
// worth separating: a pool pricing above the market is a decision, and a book
// whose modifiers are drifting is not.
//
// ⚠ AND THE BILL AND EXCESS COLUMNS ARE INDICATIVE, NOT THE ENGINE'S. They are
// re-derived on the FINAL charged rate; the engine signals movement with the
// PRE-MOVEMENT quote, and the difference is large enough to flip a sign — GL
// reads excess -0.73pp here while its observed drift is negative, which the
// re-derivation cannot produce. `market` and `own fault` ARE exact: the first is
// a pure function and the second does not read a rate at all. Do not quote the
// middle two columns as a measurement of the game; quote the drift above.
console.log('  decomposition:');
for (const line of LINES) {
  const rows = baseline.flatMap(r => r.filter(x => x.line === line).flatMap(x => x.moves));
  console.log(`    ${line.padEnd(9)} market ${mean(rows.map(m => m.marketChangePct)).toFixed(2)}pp (exact)   `
    + `mean own fault ${mean(rows.map(m => m.ownFault)).toFixed(3)} (exact)   `
    + `[indicative: bill ${mean(rows.map(m => m.billChangePct)).toFixed(2)}pp, `
    + `excess ${mean(rows.map(m => m.excessPct)).toFixed(2)}pp]`);
}

// --- 4. the interaction is real ---------------------------------------------
console.log('\n--- 4. the interaction: among members facing the same increase, who is unhappier ---');
console.log('  ⚠ RE-DERIVED, on the final charged rate rather than the engine\'s pre-movement quote,');
console.log('  because the per-member moves are not carried on a result. That is sound HERE and not');
console.log('  in section 3: the rate change is one number shared by every member of a line-year, so');
console.log('  it shifts both arms equally and cannot reorder them. It would bias a LEVEL, which is');
console.log('  exactly what section 3 measures and why section 3 does not use these rows.');
{
  const rows = baseline.flatMap(r => r.flatMap(x => x.moves))
    .filter(m => m.excessPct > 2 && Number.isFinite(m.delta));
  const blameless = rows.filter(m => m.ownFault <= 0.05).map(m => m.delta);
  const atFault = rows.filter(m => m.ownFault >= 0.20).map(m => m.delta);
  console.log(`  members facing an increase over +2pp past the market: ${rows.length}`);
  console.log(`    blameless (fault <= 0.05)  n ${String(blameless.length).padStart(6)}   mean delta ${mean(blameless).toFixed(4)}`);
  console.log(`    at fault  (fault >= 0.20)  n ${String(atFault.length).padStart(6)}   mean delta ${mean(atFault).toFixed(4)}`);
  if (blameless.length < 50 || atFault.length < 50) {
    failures.push(`too few members in one arm of the interaction test (${blameless.length} blameless, `
      + `${atFault.length} at fault). The ordering cannot be read, so the design's central claim is untested.`);
  } else {
    const ok = mean(blameless) < mean(atFault);
    console.log(`    blameless fall further: ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) {
      failures.push(`members at fault took at least as much satisfaction damage as blameless ones facing `
        + `the same increase. The loss term is supposed to MODULATE the price term — if this ordering `
        + `does not hold the model is two independent penalties wearing an interaction's name.`);
    }
  }
}

// --- 5. positive control ----------------------------------------------------
console.log('\n--- 5. positive control: seed-matched, priced above the market ---');
{
  const diffs: number[] = [];
  for (let g = 0; g < GAMES; g++) {
    const a = baseline[g], b = play(g, true);
    const last = (runs: LineYear[]) => {
      const w = runs.filter(x => x.line === 'WC');
      return mean(w[w.length - 1].members.map(m => m.satisfaction));
    };
    diffs.push(last(b) - last(a));
  }
  const m = mean(diffs);
  const t = Math.abs(m / (sd(diffs) / Math.sqrt(diffs.length)));
  const ok = m < 0 && t >= 3;
  console.log(`  WC year-${YEARS} mean satisfaction, priced-up minus defaults: ${m.toFixed(4)}  paired t ${t.toFixed(1)}  ${ok ? 'OK' : 'FAIL'}`);
  console.log(`  (the arm ramps fundingConfidenceLevel ${RAMP_START} -> `
    + `${Math.min(0.95, RAMP_START + RAMP_STEP * (YEARS - 1)).toFixed(3)} with fundingAtExpected off)`);
  if (!ok) {
    failures.push(`a pool priced above the market for ${YEARS} years ended ${m.toFixed(4)} points `
      + `${m < 0 ? 'lower' : 'HIGHER'} at t ${t.toFixed(1)}. It must end lower, and detectably. `
      + `A satisfaction model that does not respond to price is the frozen field again with more `
      + `arithmetic in front of it.`);
  }
}

console.log('\n' + RULE);
if (failures.length === 0) {
  console.log('MEMBER SATISFACTION HOLDS.');
  console.log(RULE);
  process.exit(0);
}
console.log(`${failures.length} FAILURE(S):`);
for (const f of failures) console.log(`  - ${f}`);
console.log(RULE);
process.exit(1);
