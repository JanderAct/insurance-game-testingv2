// ROLLING MEMBER LOSS HISTORY CHECK — stage 3 of the experience-modifier work.
//
//   npx tsx scripts/diagnostics/member-loss-history-check.ts
//
// ============================================================================
// WHAT THIS GUARDS.
//
// PoolState.memberLossHistory keeps a rolling per-member, per-line record of
// actual and expected loss, marketplace-wide, so the experience modifier
// (stage 4) has something to read — including for prospects. It is accumulated
// as it happens and never regenerated, because recomputing a past year's
// expectation later would evaluate it at the member's CURRENT risk quality and
// make a member whose RQ improved look retroactively favourable.
//
// FOUR WAYS THIS CAN BE WRONG, ALL OF THEM QUIET:
//
//   1. THE ASYMMETRY SILENTLY SYMMETRISED. k_line must be INCLUDED in the
//      stored expected (it is a pool pricing artifact, so it must cancel in the
//      modifier); risk control must be EXCLUDED (so safety investment earns a
//      favourable mod, as NCCI experience rating does). Getting either wrong
//      biases every enrolled member's mod by a couple of percent — small,
//      systematic, and sign-flipping as the roster mix drifts. Asserted here
//      against kLineApplied, which stage 2 exposed for exactly this purpose.
//
//   2. PROSPECTS RATED ON POOL TERMS. Prospects generate at k = 1 and rc = 0,
//      so both their legs must be unadjusted. If k leaked in, a non-member's
//      history would depend on the enrolled book's RQ mix.
//
//   3. A Map INSTEAD OF A RECORD. The whole GameState goes through
//      JSON.stringify in App.tsx, where a Map serialises to {} SILENTLY. The
//      round-trip check below is what catches that class of mistake.
//
//   4. THE STORE TOUCHING THE DRAW PATH. Recording happens in processYear after
//      processLineYear returns, so it is downstream of every draw. That is
//      verified by value-identity-check and solo-export-guard, not here — but it
//      is the reason those two must stay green across this change.
//
// PROPERTY IS ENROLLED-ONLY AND THAT IS EXPECTED, NOT A GAP IN THE STORE.
// Property still runs the legacy aggregate path, which produces per-member
// figures for the enrolled book only (marketMemberLossResults is undefined for
// it). It gains marketplace coverage automatically when its generator cuts over.
// Reported explicitly below so the asymmetry is visible rather than mistaken for
// a bug in the accumulation.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { expectedWcGrossLossForPricing } from '../../src/utils/wcClaimEngine';
import { expectedGlGrossLossForPricing } from '../../src/utils/glClaimEngine';
import {
  EXPERIENCE_WINDOW_YEARS,
  LOSS_HISTORY_CAP_YEARS,
  experienceWindow,
  storedLossYears,
} from '../../src/utils/memberLossHistory';
import type {
  CoverageLine,
  GameState,
  Member,
  MemberLossHistory,
  PoolState,
} from '../../src/types/simulation';

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };
const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
function seedOf(id: string) { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; }

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const CLAIM_LINES: CoverageLine[] = ['WC', 'GL'];

function playGame(id: string, years: number, riskControlPct?: number) {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= years; y++) {
    let decisions = defaultDecisionSet(y);
    // SET IT POOL-WIDE, NOT PER LINE. riskControlPct is a pool-wide decision:
    // processYear PROJECTS rawDecisions.riskControlPct into every line slice,
    // overwriting anything set on byLine. Setting it per-line was this check's
    // other first bug — the override was silently discarded, RC effectiveness
    // stayed 0, and the assertion "expected did not move" passed vacuously
    // because nothing had moved at all.
    if (riskControlPct !== undefined) {
      decisions = { ...decisions, riskControlPct };
    }
    const p = processYear(gs, decisions);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { gs, instance };
}

console.log('=== MEMBER LOSS HISTORY (stage 3) ===\n');

const SEED = 'MAMC6EA4';
const { gs, instance } = playGame(SEED, 1);
const history = gs.poolState.memberLossHistory!;
const market = gs.poolState.allMarketMembers;

console.log('--- 1. coverage: marketplace-wide, and the bootstrap years are present ---');
{
  // SCOPE THE COVERAGE ASSERTION TO ONE YEAR. The store spans four recorded
  // years (-2, -1, 0, 1) and enrolment CHURNS between them, so "members with any
  // history" is a union over four different enrolled books and does not equal
  // any single year's roster. Comparing the two was this check's own first bug:
  // it read 64 against an opening 58 for Property and looked like an
  // accumulation fault when the store was exactly right.
  console.log(`  marketplace ${market.length} members`);
  const y1 = gs.lockedResults[0];
  for (const line of LINES) {
    const y1Enrolled = new Set(y1.byLine[line]!.memberLossResults.map(m => m.memberId));
    const y1Entries = market.filter(m => storedLossYears(history, m.id, line).some(y => y.yearNumber === 1));
    const everCount = market.filter(m => storedLossYears(history, m.id, line).length > 0).length;
    const expectAll = CLAIM_LINES.includes(line);
    console.log(`  ${line.padEnd(9)} Y1 enrolled ${String(y1Enrolled.size).padStart(3)}  Y1 entries ${String(y1Entries.length).padStart(3)}/${market.length}  ever-recorded ${String(everCount).padStart(3)}`);
    if (expectAll) {
      console.log(`            marketplace-wide: ${note(y1Entries.length === market.length, `${line}: only ${y1Entries.length}/${market.length} members have a year-1 entry — marketplace-wide generation is not reaching the store`)}`);
    } else {
      const exact = y1Entries.length === y1Enrolled.size && y1Entries.every(m => y1Enrolled.has(m.id));
      console.log(`            Y1 entries === Y1 enrolled book exactly: ${note(exact, `${line}: the year-1 entry set does not match the year-1 enrolled book`)}`);
      console.log(`            (enrolled-only BY DESIGN: Property is still on the legacy aggregate path, which`);
      console.log(`             produces no per-member figures for prospects. Gains coverage at its cutover.)`);
    }
    if (everCount > y1Enrolled.size && !expectAll) {
      console.log(`            ever-recorded (${everCount}) exceeds Y1 enrolled (${y1Enrolled.size}) because enrolment churns:`);
      const perYear = [-2, -1, 0, 1].map(y => `${y}:${market.filter(m => storedLossYears(history, m.id, line).some(e => e.yearNumber === y)).length}`);
      console.log(`            members per stored year ${perYear.join('  ')} — a member who LEFT keeps its history,`);
      console.log(`            which is exactly what the modifier needs if the pool re-recruits it later.`);
    }
  }

  // Bootstrap years are the point of including the pre-game: a member must not
  // arrive blank on turn one.
  const sample = market[0];
  for (const line of CLAIM_LINES) {
    const years = storedLossYears(history, sample.id, line).map(y => y.yearNumber);
    console.log(`  ${line} years stored after Y1 for ${sample.id}: [${years.join(', ')}]`);
    const hasBootstrap = years.includes(-2) && years.includes(-1) && years.includes(0);
    console.log(`    three bootstrap years present: ${note(hasBootstrap, `${line}: bootstrap years missing — members start blank on turn one`)}`);
    console.log(`    live year 1 present: ${note(years.includes(1), `${line}: year 1 missing from the store`)}`);
  }
  // The experience window is applied at READ time, so after one live year the
  // window already returns three years rather than one.
  const win = experienceWindow(history, sample.id, 'WC');
  console.log(`  read window (${EXPERIENCE_WINDOW_YEARS}y) after Y1 returns years [${win.map(y => y.yearNumber).join(', ')}]  ${note(win.length === EXPERIENCE_WINDOW_YEARS, `window returned ${win.length} years, expected ${EXPERIENCE_WINDOW_YEARS}`)}`);
}

console.log('\n--- 2. the actual leg ties to the claims actually generated, to the cent ---');
{
  // ENROLLED members: verified against result.claims, which is literally the
  // claim list the year produced. Prospect claims are deliberately discarded,
  // so they are covered by the per-member expectation identity in section 3
  // plus the separate enrolment-independence guarantee from stage 1.
  const y1 = gs.lockedResults[0];
  for (const line of CLAIM_LINES) {
    const lr = y1.byLine[line]!;
    const byMember = new Map<string, number>();
    for (const c of lr.claims ?? []) byMember.set(c.memberId, (byMember.get(c.memberId) ?? 0) + c.grossUltimate);

    let checked = 0, worst = 0, worstId = '';
    for (const mlr of lr.memberLossResults) {
      const stored = storedLossYears(history, mlr.memberId, line).find(y => y.yearNumber === 1);
      if (!stored) { note(false, `${line}: enrolled member ${mlr.memberId} has no year-1 entry`); continue; }
      const claimSum = byMember.get(mlr.memberId) ?? 0;
      const err = Math.abs(stored.actual - claimSum);
      if (err > worst) { worst = err; worstId = mlr.memberId; }
      checked++;
    }
    console.log(`  ${line.padEnd(9)} ${checked} enrolled members: worst |stored.actual - sum(claims)| = $${worst.toFixed(6)}${worstId ? ` (${worstId})` : ''}`);
    console.log(`            ${note(worst < 0.01, `${line}: stored actual differs from the generated claim sum by $${worst.toFixed(4)} — off by more than a cent`)}`);
  }

  // And the whole store ties to the line total, which catches a member being
  // dropped or double-counted rather than merely mis-valued.
  for (const line of CLAIM_LINES) {
    const lr = y1.byLine[line]!;
    const enrolledIds = new Set(lr.memberLossResults.map(m => m.memberId));
    let sum = 0;
    for (const id of enrolledIds) {
      sum += storedLossYears(history, id, line).find(y => y.yearNumber === 1)?.actual ?? 0;
    }
    console.log(`  ${line.padEnd(9)} sum over enrolled = ${fmt$(sum)} vs line gross ${fmt$(lr.grossUltimateLoss)}  ${note(Math.abs(sum - lr.grossUltimateLoss) < 0.01, `${line}: enrolled stored actuals sum to ${fmt$(sum)} against a line gross of ${fmt$(lr.grossUltimateLoss)}`)}`);
  }
}

console.log('\n--- 3. THE ASYMMETRY: expected includes k_line, excludes risk control ---');
{
  const y1 = gs.lockedResults[0];
  const byId = new Map(market.map(m => [m.id, m]));

  for (const line of CLAIM_LINES) {
    const lr = y1.byLine[line]!;
    const k = lr.kLineApplied!;
    const enrolledIds = new Set(lr.memberLossResults.map(m => m.memberId));
    const expectFor = (m: Member, kUsed: number) => line === 'WC'
      ? expectedWcGrossLossForPricing([m], { kLine: kUsed, yearNumber: 1 })
      : expectedGlGrossLossForPricing([m], { kGl: kUsed });

    // ENROLLED: stored expected must equal the expectation AT kLineApplied, and
    // must NOT equal it at k = 1 — which is what proves k is genuinely included
    // rather than the two happening to coincide.
    let enrChecked = 0, enrWorst = 0, distinguishable = 0;
    for (const id of enrolledIds) {
      const m = byId.get(id); if (!m) continue;
      const stored = storedLossYears(history, id, line).find(y => y.yearNumber === 1);
      if (!stored) continue;
      const atK = expectFor(m, k);
      const atOne = expectFor(m, 1);
      enrWorst = Math.max(enrWorst, Math.abs(stored.expected - atK));
      if (Math.abs(atK - atOne) > 1e-9) distinguishable++;
      enrChecked++;
    }
    console.log(`  ${line} ENROLLED (k applied = ${k.toFixed(6)}):`);
    console.log(`    ${enrChecked} members, worst |stored.expected - E[loss | k]| = $${enrWorst.toFixed(6)}  ${note(enrWorst < 0.01, `${line}: enrolled stored expected does not match the expectation at kLineApplied (worst $${enrWorst.toFixed(4)})`)}`);
    console.log(`    of those, ${distinguishable} would differ at k = 1, so the check can actually tell k apart  ${note(distinguishable > 0, `${line}: k is indistinguishable from 1 here — this assertion cannot fail and proves nothing`)}`);

    // PROSPECTS: both legs unadjusted, i.e. the expectation at k = 1.
    let proChecked = 0, proWorst = 0, proWrongIfK = 0;
    for (const m of market) {
      if (enrolledIds.has(m.id)) continue;
      const stored = storedLossYears(history, m.id, line).find(y => y.yearNumber === 1);
      if (!stored) continue;
      proWorst = Math.max(proWorst, Math.abs(stored.expected - expectFor(m, 1)));
      if (Math.abs(stored.expected - expectFor(m, k)) > 0.01) proWrongIfK++;
      proChecked++;
    }
    console.log(`  ${line} PROSPECTS:`);
    console.log(`    ${proChecked} members, worst |stored.expected - E[loss | k=1]| = $${proWorst.toFixed(6)}  ${note(proWorst < 0.01, `${line}: prospect stored expected is not unadjusted — pool terms are leaking into prospect history`)}`);
    console.log(`    ${proWrongIfK} of them would MISMATCH at the pool's k, confirming they were not rated on pool terms  ${note(proWrongIfK > 0, `${line}: prospect expectations are indistinguishable from pool-k ones`)}`);
  }

  // RISK CONTROL IS EXCLUDED FROM THE EXPECTATION — but isolating that claim
  // needs care, and getting it wrong was this check's third first-attempt bug.
  //
  // The naive version compares two games differing only in riskControlPct and
  // demands the stored expected not move. It DOES move, and legitimately: RC
  // spending changes premium and expenses, which changes member movement, which
  // changes the ENROLLED BOOK, which changes k_line — and k_line is the leg the
  // ruling deliberately INCLUDES. Measured below: 50 vs 51 enrolled and k 1.03540
  // vs 1.03422. So the naive check fails on correct code, for the same reason the
  // shock/no-shock deltas are not paired: a single knob moves more than one thing.
  //
  // THE CORRECT ISOLATION is the per-member identity at each run's OWN k. If RC
  // leaked into the expectation, stored.expected would stop matching
  // E[loss | kLineApplied] in the HIGH-RC run while still matching in the zero-RC
  // run. That can genuinely fail, which asserting a pure function against itself
  // could not.
  const noRc = playGame(SEED, 1, 0);
  const hiRc = playGame(SEED, 1, 0.08);
  let actualMoved = 0, compared = 0;
  for (const line of CLAIM_LINES) {
    const enrolledIds = new Set(noRc.gs.lockedResults[0].byLine[line]!.memberLossResults.map(m => m.memberId));
    for (const id of enrolledIds) {
      const a = storedLossYears(noRc.gs.poolState.memberLossHistory!, id, line).find(y => y.yearNumber === 1);
      const b = storedLossYears(hiRc.gs.poolState.memberLossHistory!, id, line).find(y => y.yearNumber === 1);
      if (!a || !b) continue;
      if (a.actual !== b.actual) actualMoved++;
      compared++;
    }
  }
  console.log(`  RISK CONTROL, rc 0% vs 8% over ${compared} enrolled member-lines:`);
  console.log(`    stored ACTUAL moved for ${actualMoved}  ${note(actualMoved > 0, 'risk control did not move any realized loss — the RC channel is dead, so this check proves nothing')}`);

  for (const [label, run] of [['rc 0%', noRc], ['rc 8%', hiRc]] as [string, typeof noRc][]) {
    const h = run.gs.poolState.memberLossHistory!;
    const byId = new Map(run.gs.poolState.allMarketMembers.map(m => [m.id, m]));
    let worst = 0, n = 0;
    const ks: string[] = [];
    for (const line of CLAIM_LINES) {
      const lr = run.gs.lockedResults[0].byLine[line]!;
      const k = lr.kLineApplied!;
      ks.push(`${line} k=${k.toFixed(5)} n=${lr.memberLossResults.length}`);
      for (const mlr of lr.memberLossResults) {
        const m = byId.get(mlr.memberId); if (!m) continue;
        const stored = storedLossYears(h, mlr.memberId, line).find(y => y.yearNumber === 1);
        if (!stored) continue;
        const at = line === 'WC'
          ? expectedWcGrossLossForPricing([m], { kLine: k, yearNumber: 1 })
          : expectedGlGrossLossForPricing([m], { kGl: k });
        worst = Math.max(worst, Math.abs(stored.expected - at));
        n++;
      }
    }
    console.log(`    ${label}: ${ks.join(', ')}`);
    console.log(`      ${n} member-lines, worst |stored.expected - E[loss | k]| = $${worst.toFixed(6)}  ${note(worst < 0.01, `at ${label} the stored expectation stopped matching E[loss | kLineApplied] (worst $${worst.toFixed(4)}) — risk control has leaked into the expectation`)}`);
  }
  console.log(`    So RC reaches the ACTUAL leg and reaches the expected leg ONLY through k_line's`);
  console.log(`    dependence on who is enrolled — never as a frequency multiplier. Held structurally by`);
  console.log(`    invariant 2: no expected<Line>GrossLoss takes a risk-control argument at all.`);
}

console.log('\n--- 4. pruning: capped at ' + LOSS_HISTORY_CAP_YEARS + ', oldest dropped first ---');
{
  const long = playGame(SEED, 7);
  const h = long.gs.poolState.memberLossHistory!;
  const sample = long.gs.poolState.allMarketMembers[0];
  const years = storedLossYears(h, sample.id, 'WC').map(y => y.yearNumber);
  console.log(`  after 7 live years (+3 bootstrap = 10 candidate entries), stored: [${years.join(', ')}]`);
  console.log(`    length ${years.length} <= cap ${LOSS_HISTORY_CAP_YEARS}: ${note(years.length <= LOSS_HISTORY_CAP_YEARS, `stored ${years.length} entries against a cap of ${LOSS_HISTORY_CAP_YEARS}`)}`);
  console.log(`    oldest entries dropped (no bootstrap years left): ${note(!years.some(y => y <= 0), `bootstrap years survived pruning: [${years.filter(y => y <= 0).join(', ')}]`)}`);
  console.log(`    ascending and contiguous through the most recent year: ${note(years[years.length - 1] === 7 && years.every((y, i) => i === 0 || y === years[i - 1] + 1), `stored years are not the contiguous most-recent run: [${years.join(', ')}]`)}`);
  // Every member, not just the sample — a per-member prune bug would hide here.
  let overCap = 0;
  for (const m of long.gs.poolState.allMarketMembers) {
    for (const line of LINES) if (storedLossYears(h, m.id, line).length > LOSS_HISTORY_CAP_YEARS) overCap++;
  }
  console.log(`  member-lines over cap across all ${long.gs.poolState.allMarketMembers.length} members: ${overCap}  ${note(overCap === 0, `${overCap} member-lines exceed the cap`)}`);
}

console.log('\n--- 5. persistence: JSON round-trip, and an old save without the field ---');
{
  // THE Map TRAP. A Map here would stringify to {} with no error at all, so the
  // round-trip is asserted on content, not on the call succeeding.
  const serialised = JSON.stringify(gs);
  const revived = JSON.parse(serialised) as GameState;
  const rh = revived.poolState.memberLossHistory as MemberLossHistory | undefined;
  console.log(`  serialised game state: ${(serialised.length / 1024).toFixed(0)} KB total`);
  console.log(`  memberLossHistory alone: ${(JSON.stringify(history).length / 1024).toFixed(0)} KB`);
  console.log(`  survives round-trip with members intact: ${Object.keys(rh ?? {}).length}/${Object.keys(history).length}  ${note(Object.keys(rh ?? {}).length === Object.keys(history).length, 'memberLossHistory did not survive JSON round-trip — a Map serialises to {} silently')}`);
  const sampleId = Object.keys(history)[0];
  const before = storedLossYears(history, sampleId, 'WC');
  const after = storedLossYears(rh ?? {}, sampleId, 'WC');
  console.log(`  entries and values preserved for ${sampleId}: ${before.length} -> ${after.length}  ${note(before.length === after.length && before.every((b, i) => b.yearNumber === after[i].yearNumber && b.actual === after[i].actual && b.expected === after[i].expected), 'round-tripped entries differ in value or count')}`);

  // AN OLD SAVE LACKS THE FIELD. App.tsx defaults it to {} on load rather than
  // bumping the save key; the engine's own `?? {}` is what makes that safe, so
  // that is what is asserted — a pool state with the field absent must process
  // a year and come back populated.
  const stripped: PoolState = { ...gs.poolState };
  delete (stripped as { memberLossHistory?: unknown }).memberLossHistory;
  console.log(`  field absent on the loaded state: ${stripped.memberLossHistory === undefined ? 'yes' : 'NO'}  ${note(stripped.memberLossHistory === undefined, 'failed to construct a pre-stage-3 save for the test')}`);
  const revivedGs: GameState = { ...gs, poolState: stripped, currentYearNumber: 2 };
  const next = processYear(revivedGs, defaultDecisionSet(2));
  const recovered = next.updatedPoolState.memberLossHistory;
  const recoveredCount = Object.keys(recovered ?? {}).length;
  console.log(`  processes a year and repopulates: ${recoveredCount} members  ${note(recoveredCount > 0, 'a save without the field did not repopulate — the engine default is missing')}`);
  const y2 = storedLossYears(recovered ?? {}, sampleId, 'WC').map(y => y.yearNumber);
  console.log(`    ${sampleId} WC years after the defaulted year: [${y2.join(', ')}]  ${note(y2.length === 1 && y2[0] === 2, `expected only year 2 to be present after loading a stripped save, got [${y2.join(', ')}]`)}`);
  console.log(`    (history restarts from the next processed year rather than being fabricated — the read`);
  console.log(`     window refills within a few turns, which is a better trade than discarding the save)`);
  void instance;
}

console.log(problems.length === 0
  ? '\nALL MEMBER LOSS HISTORY CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
