// SHOCK EVENT verification. Read-only.
//
//   npx tsx scripts/diagnostics/shock-check.ts
//
// TWO JOBS, AND THE FIRST ONE MATTERS MORE.
//
// 1. THE NULL-EFFECT GATE. Shock machinery that changes default behaviour is a
//    defect, and the most dangerous version of that defect is an RNG stream
//    shift, which moves every seed while looking like a rounding difference.
//    This harness plays real games three ways — field absent, field present but
//    empty, and a scheduled shock — and asserts the first two are IDENTICAL
//    across every numeric field of every line and year.
//
//    The two export gates (value-identity-check, solo-export-guard) already
//    cover the field-absent case, since they construct instances through the
//    real generateGameInstance. What they cannot cover is `scheduledShocks: []`,
//    because nothing constructs that. This does.
//
// 2. WHAT EACH EVENT COSTS, AT BOTH BASES. Full market AND the enrolled pool.
//    A treaty-facing or premium-facing figure quoted at full-market scale runs
//    roughly 4x high, and this project has made that mistake more than once.
//
// CALIBRATION IS DEFERRED, DELIBERATELY. Nothing here asserts that an event's
// cost is the RIGHT cost for its band. The pool currently cannot lose money at
// default decisions (finding 24) and that is being fixed on the economics side;
// tuning shocks against a pool that cannot lose would make the game brutal the
// moment it can. Costs are REPORTED. The balance decision stays open.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { resolveShocks, ownFreqMultipliers } from '../../src/utils/shockResolver';
import { computeKGl, expectedGlGrossLoss, generateGlClaims } from '../../src/utils/glClaimEngine';
import { computeKLine, generateWcClaims, nominalSumOfStream } from '../../src/utils/wcClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import type { Claim, Member } from '../../src/types/simulation';
import { SHOCK_CATALOG } from '../../src/data/shockCatalog';
import { buildResultsWorkbook } from '../../src/utils/resultsExport';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import type { CoverageLine, GameInstance, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';
import type { ScheduledShock } from '../../src/types/shocks';

const problems: string[] = [];
const note = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); return ok ? 'OK' : 'FAIL'; };

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}

// Plays a real game through the real engine. `shocks` undefined leaves the
// instance field ABSENT; an array sets it, empty or not.
function play(id: string, years: number, shocks?: ScheduledShock[]): ResultSet[] {
  const base = generateGameInstance(id, seedOf(id));
  const instance: GameInstance = shocks === undefined ? base : { ...base, scheduledShocks: shocks };
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}

const fmt$ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

// Undiscounted sum of an annuity's two legs, for confirming a catastrophic
// claim books PRESENT VALUE rather than the nominal stream.
function nominalOf(a: NonNullable<Claim['annuity']>): number {
  return nominalSumOfStream(a.medicalFirstYearPayment, a.medicalInflationPct, a.medicalYears)
    + nominalSumOfStream(a.indemnityAnnualPayment, a.indemnityInflationPct, a.indemnityYears);
}

// A REAL enrolled book for one line, taken from the game's own enrollment path
// rather than reconstructed — the share is drawn per seed inside
// STARTING_EXPOSURE_SHARE (25-35% of market exposure), so a hand-rolled subset
// would drift from what the engine actually enrolls.
function enrolledBook(instanceId: string, line: CoverageLine): Member[] {
  const instance = generateGameInstance(instanceId, seedOf(instanceId));
  const setup = { poolName: 'G', gameLength: 5, startingYear: 2026, instanceId, activeLines: [line] };
  const { poolState } = runPriorHistory(instance, setup as never);
  return poolState.lines[line].members.filter(m => m.status === 'active');
}

// Every finite numeric field on every line result AND the pool result, keyed
// the same way value-identity-check keys them.
function fieldsOf(results: ResultSet[], tag: string): Record<string, number> {
  const out: Record<string, number> = {};
  results.forEach((r, i) => {
    const scopes: [string, ResultSet | LineResultSet][] = [
      ['pool', r],
      ...LINES.map(l => [l, r.byLine[l]] as [string, LineResultSet]),
    ];
    for (const [scope, res] of scopes) {
      if (!res) continue;
      for (const [k, v] of Object.entries(res)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[`${tag}|Y${i + 1}|${scope}|${k}`] = v;
      }
    }
  });
  return out;
}

function diffFields(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) if (a[k] !== b[k]) changed.push(k);
  return changed;
}

console.log('=== SHOCK EVENTS ===\n');

console.log('--- 1. the null-effect gate: scheduledShocks: [] === field absent ---');
{
  // THE STRICTEST FORM OF THE GATE. Not "close", not "within tolerance" —
  // every numeric field bit-identical across three seeds and five years of a
  // three-line game. An RNG stream shift cannot hide from this.
  let total = 0, moved = 0;
  for (const id of SEEDS) {
    const absent = fieldsOf(play(id, 5, undefined), id);
    const empty = fieldsOf(play(id, 5, []), id);
    const changed = diffFields(absent, empty);
    total += Object.keys(absent).length;
    moved += changed.length;
    console.log(`  ${id}  ${Object.keys(absent).length} fields, ${changed.length} moved${changed.length ? `  e.g. ${changed[0]}` : ''}`);
  }
  console.log(`  ${total} fields across ${SEEDS.length} seeds: ${moved} moved  ${note(moved === 0, `${moved} fields move when scheduledShocks: [] is set — the shock path is not inert`)}`);
  console.log(`    (the two export gates cover the field-ABSENT case, since they build instances through the`);
  console.log(`     real generateGameInstance. Only this covers the field-present-but-empty case.)`);
}

console.log('\n--- 2. resolver contract ---');
{
  const base = generateGameInstance('MAMC6EA4', seedOf('MAMC6EA4'));
  console.log(`  no field      -> ${resolveShocks(base, 1) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(base, 1) === undefined, 'resolver returns a resolution when no shocks are configured')}`);
  const empty = { ...base, scheduledShocks: [] as ScheduledShock[] };
  console.log(`  empty list    -> ${resolveShocks(empty, 1) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(empty, 1) === undefined, 'resolver returns a resolution for an empty list')}`);
  // A CURRENT event in another year contributes nothing and is not recorded.
  const other = { ...base, scheduledShocks: [{ shockId: '#22', yearNumber: 3 }] };
  console.log(`  #22 in Y3, asked for Y1 -> ${resolveShocks(other, 1) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(other, 1) === undefined, 'a current-horizon shock leaks outside its own year')}`);
  console.log(`  #22 in Y3, asked for Y3 -> ${resolveShocks(other, 3) !== undefined ? 'RESOLUTION' : 'undefined'}  ${note(resolveShocks(other, 3) !== undefined, 'a current-horizon shock does not fire in its own year')}`);
  console.log(`  #22 in Y3, asked for Y4 -> ${resolveShocks(other, 4) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(other, 4) === undefined, 'a current-horizon shock persists past its year')}`);
  // A FUTURE event persists forward.
  const future = { ...base, scheduledShocks: [{ shockId: '#10', yearNumber: 3 }] };
  const y5 = resolveShocks(future, 5);
  console.log(`  #10 in Y3, asked for Y5 -> ${y5 ? 'RESOLUTION' : 'undefined'}  ${note(y5 !== undefined, 'a future-horizon shock does not persist forward')}`);
  console.log(`  #10 in Y3, asked for Y2 -> ${resolveShocks(future, 2) === undefined ? 'undefined' : 'RESOLUTION'}  ${note(resolveShocks(future, 2) === undefined, 'a future-horizon shock applies before its own year')}`);

  // An unimplemented effect must THROW, not be silently skipped.
  const blocked = { ...base, scheduledShocks: [{ shockId: '#2', yearNumber: 1 }] };
  let threw = false;
  try { resolveShocks(blocked, 1); } catch { threw = true; }
  console.log(`  #2 (forceEvent, unimplemented) throws: ${note(threw, '#2 does not throw — an unimplemented effect is being silently skipped')}`);
  let unknownThrew = false;
  try { resolveShocks({ ...base, scheduledShocks: [{ shockId: '#999', yearNumber: 1 }] }, 1); } catch { unknownThrew = true; }
  console.log(`  unknown shock id throws: ${note(unknownThrew, 'an unknown shock id is silently ignored')}`);
}

console.log('\n--- 3. catalog ---');
{
  const byHorizon = { current: 0, future: 0 };
  for (const def of Object.values(SHOCK_CATALOG)) byHorizon[def.horizon]++;
  console.log(`  ${Object.keys(SHOCK_CATALOG).length} events: ${byHorizon.current} current, ${byHorizon.future} future`);
  for (const def of Object.values(SHOCK_CATALOG)) {
    console.log(`    ${def.id.padEnd(5)} ${def.band.padEnd(8)} ${def.horizon.padEnd(7)} ${def.name}`);
    for (const e of def.effects) console.log(`          - ${e.kind}${'line' in e ? ` (${e.line})` : ''}`);
  }
  console.log(`  paramOverride paths validated against the real models at module load (shockCatalog.ts)`);
}

console.log('\n--- 4. recording surface ---');
{
  // A shock that changes the numbers invisibly is worse than no shock, so the
  // record has to actually arrive: on the line it hit, on the pool, and in the
  // export — and NOWHERE when nothing fires.
  const results = play('MAMC6EA4', 5, [{ shockId: '#22', yearNumber: 2 }]);
  const y1 = results[0], y2 = results[1], y3 = results[2];
  console.log(`  Y1 (no shock) pool record: ${y1.shockEvents === undefined ? 'absent' : 'PRESENT'}  ${note(y1.shockEvents === undefined, 'a shock record appears in a year with no shock')}`);
  console.log(`  Y2 (#22) pool record: ${y2.shockEvents?.length ?? 0} event(s)  ${note(y2.shockEvents?.length === 1, 'the pool record is missing in the shock year')}`);
  console.log(`  Y3 (after) pool record: ${y3.shockEvents === undefined ? 'absent' : 'PRESENT'}  ${note(y3.shockEvents === undefined, 'a current-horizon record persists past its year')}`);
  const rec = y2.shockEvents?.[0];
  if (rec) {
    console.log(`    ${rec.shockId} ${rec.name} — ${rec.band}/${rec.horizon}, lines ${rec.linesAffected.join('+')}`);
    console.log(`    effects: ${rec.effects.map(e => e.detail).join('; ')}`);
    console.log(`    attributable $${Math.round(rec.attributableGrossLoss).toLocaleString()} / ${rec.attributableClaims} claims, expected added $${Math.round(rec.expectedGrossLossAdded).toLocaleString()}`);
  }
  console.log(`  recorded on the GL line: ${y2.byLine.GL?.shockEvents?.length ?? 0}  ${note(y2.byLine.GL?.shockEvents?.length === 1, 'the affected line carries no record')}`);
  console.log(`  NOT recorded on WC: ${y2.byLine.WC?.shockEvents === undefined ? 'absent' : 'PRESENT'}  ${note(y2.byLine.WC?.shockEvents === undefined, 'an unaffected line carries a record')}`);

  // The export sheet must be CONDITIONAL. A RESULT_METRICS entry would render a
  // row every year of every game and move all 12 hashes in solo-export-guard
  // whether or not a shock ever fired.
  const clean = buildResultsWorkbook(play('MAMC6EA4', 5, []), LINES, RESULT_METRICS);
  const shocked = buildResultsWorkbook(results, LINES, RESULT_METRICS);
  console.log(`  export sheets, no shock: ${clean.SheetNames.join(', ')}`);
  console.log(`  export sheets, shocked:  ${shocked.SheetNames.join(', ')}`);
  console.log(`  'Shock Events' sheet absent when clean: ${note(!clean.SheetNames.includes('Shock Events'), 'the shock sheet is emitted with no shocks — every export hash will move')}`);
  console.log(`  'Shock Events' sheet present when shocked: ${note(shocked.SheetNames.includes('Shock Events'), 'the shock sheet is missing when a shock fired')}`);
}

console.log('\n--- 5. #22 Employment Practices Surge — measured at both bases ---');
{
  // BOTH BASES, ALWAYS. Full market is what mu and the AAL targets are
  // calibrated against; the enrolled pool is what a game actually pays. A
  // treaty- or premium-facing figure quoted at full-market scale runs ~4x high,
  // and this project has made that mistake more than once.
  const roster = getPredefinedMarketMembers();
  const kFull = computeKGl(roster);
  const own = ownFreqMultipliers('#22', 'GL')!;
  const fullBase = expectedGlGrossLoss(roster, { kGl: kFull });
  const fullShocked = expectedGlGrossLoss(roster, { kGl: kFull, freqMultipliers: own });
  console.log(`  effect: ${JSON.stringify(own)}`);
  console.log(`  FULL MARKET   GL expected gross ${fmt$(fullBase)} -> ${fmt$(fullShocked)}   added ${fmt$(fullShocked - fullBase)} (+${((fullShocked / fullBase - 1) * 100).toFixed(1)}% of GL)`);

  const pool = enrolledBook('MAMC6EA4', 'GL');
  const kPool = computeKGl(pool);
  const poolBase = expectedGlGrossLoss(pool, { kGl: kPool });
  const poolShocked = expectedGlGrossLoss(pool, { kGl: kPool, freqMultipliers: own });
  const share = pool.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0) / roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0);
  console.log(`  ENROLLED POOL ${pool.length} members at ${(share * 100).toFixed(1)}% of market payroll`);
  console.log(`                GL expected gross ${fmt$(poolBase)} -> ${fmt$(poolShocked)}   added ${fmt$(poolShocked - poolBase)} (+${((poolShocked / poolBase - 1) * 100).toFixed(1)}% of GL)`);
  console.log(`  ⚠ ALAE IS INCURRED ON EVERY CLAIM, PAID OR NOT (design B3/B4), and a frequency multiplier`);
  console.log(`    multiplies the GATE count — so the unpaid claims and their ALAE scale too. Counting only`);
  console.log(`    paid claims understates this by ~43%.`);
  console.log(`  CALIBRATION DEFERRED: this reports what the event costs and asserts nothing about whether`);
  console.log(`    that is right for a Moderate band. Shocks must be sized against a pool that already has`);
  console.log(`    two-sided risk (finding 24), which it does not yet have.`);

  // The DRAW must move with the multiplier, and by about the analytic amount.
  const YEARS = 400;
  const drawn = (mult?: Record<string, number>) => {
    let sum = 0, epl = 0, eplGross = 0;
    for (let y = 1; y <= YEARS; y++) {
      const g = generateGlClaims({
        members: pool, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 4242 + y * 7919,
        kGl: kPool, gPool: 1, riskControlEffectiveness: 0, freqMultipliers: mult,
      });
      sum += g.grossUltimateLoss;
      epl += g.claimCountsBySub.epl;
      for (const c of g.claims) if (c.tier === 'epl') eplGross += c.grossUltimate;
    }
    return { gross: sum / YEARS, epl: epl / YEARS, eplGross: eplGross / YEARS };
  };
  const a = drawn(undefined), b = drawn(own);
  console.log(`  drawn over ${YEARS} yrs: EPL claims ${a.epl.toFixed(1)}/yr -> ${b.epl.toFixed(1)}/yr (ratio ${(b.epl / a.epl).toFixed(3)}, expect ${own.epl})  ${note(Math.abs(b.epl / a.epl - own.epl) / own.epl < 0.05, `EPL claim count ratio ${(b.epl / a.epl).toFixed(3)} vs ${own.epl}`)}`);
  console.log(`    EPL gross only  ${fmt$(a.eplGross)} -> ${fmt$(b.eplGross)}   added ${fmt$(b.eplGross - a.eplGross)} vs analytic ${fmt$(poolShocked - poolBase)}`);
  console.log(`    WHOLE LINE      ${fmt$(a.gross)} -> ${fmt$(b.gross)}   added ${fmt$(b.gross - a.gross)}`);
  console.log(`  ⚠ THE TWO RUNS ARE NOT PAIRED, THOUGH THEY SHARE SEEDS. poisson() consumes a VARIABLE number`);
  console.log(`    of uniforms, so multiplying the EPL lambda reshapes everything drawn from gl_freq after it —`);
  console.log(`    including abuse. The whole-line delta therefore carries the FULL independent-sample noise of`);
  console.log(`    two heavy-tailed totals, and abuse alone is ~47% of GL gross. The EPL-only delta is the`);
  console.log(`    tighter read; the claim-count ratio, being a stable statistic, is the assertable one.`);

  // INVARIANT 2, the shock version: the multiplier must move the DRAW and stay
  // out of the PRICING expectation. Nothing that prices GL passes it.
  console.log(`  pricing expectation is shock-blind: ${fmt$(expectedGlGrossLoss(pool, { kGl: kPool }))} unchanged  ${note(expectedGlGrossLoss(pool, { kGl: kPool }) === poolBase, 'the priced expectation moved with the shock')}`);
}

console.log('\n--- 6. #15 Catastrophic WC Mega-Claim — measured at both bases ---');
{
  const roster = getPredefinedMarketMembers();
  const pool = enrolledBook('MAMC6EA4', 'WC');
  const inject = [{ tier: 'catastrophic', count: 2 }];

  const run = (book: Member[], injections?: typeof inject) => generateWcClaims({
    members: book, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601,
    kLine: computeKLine(book), gPool: 1, riskControlEffectiveness: 0, injections,
  });

  for (const [label, book] of [['FULL MARKET  ', roster], ['ENROLLED POOL', pool]] as [string, Member[]][]) {
    const base = run(book);
    const shocked = run(book, inject);
    const outcome = shocked.injectionResults[0];
    console.log(`  ${label} natural catastrophic ${base.claimCountsByTier.catastrophic}/yr at this seed, gross ${fmt$(base.grossUltimateLoss)}`);
    console.log(`                injected ${outcome.count} claims, ${fmt$(outcome.gross)} — average ${fmt$(outcome.gross / outcome.count)} each`);
    console.log(`                line gross ${fmt$(base.grossUltimateLoss)} -> ${fmt$(shocked.grossUltimateLoss)} (+${((shocked.grossUltimateLoss / base.grossUltimateLoss - 1) * 100).toFixed(1)}%)`);
    // The injected claims must be the ONLY difference: natural claims are drawn
    // from their own streams and an injection opens a separate label.
    const delta = shocked.grossUltimateLoss - base.grossUltimateLoss;
    console.log(`                delta === injected gross exactly: ${note(Math.abs(delta - outcome.gross) < 1e-6, `${label} injection perturbed the natural draw by ${delta - outcome.gross}`)}`);
    console.log(`                natural claim count unchanged (${base.claims.length} -> ${shocked.claims.length - outcome.count}): ${note(shocked.claims.length - outcome.count === base.claims.length, 'injection changed the natural claim count')}`);
  }

  // WHY TWO AND NOT ONE. The tier already fires ~2.97/yr at full market, so the
  // enrolled pool sees ~0.8/yr naturally. One injected claim adds roughly what
  // a bad-luck year already delivers.
  // ⚠ HOLD yearNumber FIXED AND VARY THE SEED. WC carries a frequency trend of
  // -1.5%/yr, so looping yearNumber 1..N averages over an N-year decline rather
  // than sampling one year N times: at year 200 lambda is 0.95^... of year 1's.
  // A first version of this check looped the year and reported 1.10/yr against
  // a true year-1 rate more than twice that.
  let naturalFull = 0, naturalPool = 0;
  const N = 200;
  const kFullWc = computeKLine(roster), kPoolWc = computeKLine(pool);
  for (let s = 1; s <= N; s++) {
    naturalFull += generateWcClaims({ members: roster, yearNumber: 1, calendarYear: 2026, instanceSeed: 909 + s * 7919, kLine: kFullWc, gPool: 1, riskControlEffectiveness: 0 }).claimCountsByTier.catastrophic;
    naturalPool += generateWcClaims({ members: pool, yearNumber: 1, calendarYear: 2026, instanceSeed: 909 + s * 7919, kLine: kPoolWc, gPool: 1, riskControlEffectiveness: 0 }).claimCountsByTier.catastrophic;
  }
  console.log(`  natural catastrophic rate, year 1, over ${N} seeds: full market ${(naturalFull / N).toFixed(2)}/yr, enrolled pool ${(naturalPool / N).toFixed(2)}/yr`);
  console.log(`    the pool already sees ~1 every ${(N / Math.max(naturalPool, 1)).toFixed(1)} years unaided, which is why the event injects TWO —`);
  console.log(`    one adds roughly what a bad-luck year already delivers, which under-delivers for a High band`);

  // An injected claim must be a REAL claim, not a bolt-on amount.
  const s = run(pool, inject);
  const injected = s.claims.slice(-2);
  const occIds = new Set(s.occurrences.map(o => o.id));
  console.log(`  injected claims are real claims:`);
  console.log(`    carry an annuity schedule: ${note(injected.every(c => c.annuity !== undefined), 'injected claim has no annuity')}`);
  console.log(`    booked at present value, not nominal: ${note(injected.every(c => c.annuity !== undefined && c.grossUltimate < nominalOf(c.annuity)), 'injected claim is not PV-booked')}`);
  console.log(`    have an occurrence: ${note(injected.every(c => occIds.has(c.occurrenceId)), 'injected claim has no occurrence')}`);
  console.log(`    tier and rating class set: ${note(injected.every(c => c.tier === 'catastrophic' && !!c.ratingClass), 'injected claim missing tier or rating class')}`);
  console.log(`    member losses reconcile to the line total: ${note(Math.abs(s.memberLossResults.reduce((t, m) => t + m.simulatedLoss, 0) - s.grossUltimateLoss) < 1e-6, 'injected claims are missing from memberLossResults')}`);
  console.log(`    an unsupported tier throws: ${note(throws(() => run(pool, [{ tier: 'perm', count: 1 }])), 'an unsupported injection tier is silently accepted')}`);
}

console.log(problems.length === 0
  ? '\nALL SHOCK CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
