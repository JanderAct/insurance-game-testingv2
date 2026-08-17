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
import { resolveShocks, ownFreqMultipliers, ownComponentFreqMultipliers } from '../../src/utils/shockResolver';
import { WHOLE_LINE } from '../../src/utils/shockEffects';
import { computeKGl, expectedGlGrossLossForPricing, generateGlClaims } from '../../src/utils/glClaimEngine';
import { computeKLine, componentMean, expectedWcGrossLossForPricing, generateWcClaims } from '../../src/utils/wcClaimEngine';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import type { Member } from '../../src/types/simulation';
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
  // ⚠ RE-TARGETED BY THE GL SUB-COVERAGE REBUILD. This used to isolate EPL
  // claims specifically (freqMultiplier on sub 'epl') and had to separate an
  // "EPL-only" delta from a "whole-line" delta because GL drew one Poisson
  // PER SUB-COVERAGE — multiplying EPL's lambda reshaped every draw after it
  // in the shared gl_freq stream, contaminating the whole-line comparison
  // with independent-sample noise from abuse's own heavy tail. GL now draws
  // ONE Poisson per member (no sub-coverages left to separate), so there is
  // no "EPL-only vs whole-line" distinction anymore — #22 IS a whole-line
  // event now, by construction, and the claim-count ratio is directly
  // comparable to the shocked factor with no contamination to worry about.
  //
  // BOTH BASES, ALWAYS. Full market is what mu and the AAL targets are
  // calibrated against; the enrolled pool is what a game actually pays. A
  // treaty- or premium-facing figure quoted at full-market scale runs ~4x high,
  // and this project has made that mistake more than once.
  const roster = getPredefinedMarketMembers();
  const kFull = computeKGl(roster);
  const own = ownFreqMultipliers('#22', 'GL')!;
  const fullBase = expectedGlGrossLossForPricing(roster, { kGl: kFull });
  const fullShocked = expectedGlGrossLossForPricing(roster, { kGl: kFull, freqMultipliers: own });
  console.log(`  effect: ${JSON.stringify(own)}`);
  console.log(`  FULL MARKET   GL expected gross ${fmt$(fullBase)} -> ${fmt$(fullShocked)}   added ${fmt$(fullShocked - fullBase)} (+${((fullShocked / fullBase - 1) * 100).toFixed(1)}% of GL)`);

  const pool = enrolledBook('MAMC6EA4', 'GL');
  const kPool = computeKGl(pool);
  const poolBase = expectedGlGrossLossForPricing(pool, { kGl: kPool });
  const poolShocked = expectedGlGrossLossForPricing(pool, { kGl: kPool, freqMultipliers: own });
  const share = pool.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0) / roster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0);
  console.log(`  ENROLLED POOL ${pool.length} members at ${(share * 100).toFixed(1)}% of market payroll`);
  console.log(`                GL expected gross ${fmt$(poolBase)} -> ${fmt$(poolShocked)}   added ${fmt$(poolShocked - poolBase)} (+${((poolShocked / poolBase - 1) * 100).toFixed(1)}% of GL)`);
  console.log(`  CALIBRATION DEFERRED: this reports what the event costs and asserts nothing about whether`);
  console.log(`    that is right for a Moderate band. Shocks must be sized against a pool that already has`);
  console.log(`    two-sided risk (finding 24), which it does not yet have.`);

  // The DRAW must move with the multiplier, and by about the analytic amount.
  // Paired seeds are directly comparable now: one Poisson per member, so
  // shifting lambda shifts exactly that one count draw (severity streams
  // still diverge after a shifted count, which is the expected consequence
  // of a frequency shock, not contamination).
  const YEARS = 400;
  const drawn = (mult?: Record<string, number>) => {
    let sum = 0, count = 0;
    for (let y = 1; y <= YEARS; y++) {
      const g = generateGlClaims({
        members: pool, yearNumber: y, calendarYear: 2025 + y, instanceSeed: 4242 + y * 7919,
        kGl: kPool, gPool: 1, riskControlEffectiveness: 0, freqMultipliers: mult,
      });
      sum += g.grossUltimateLoss;
      count += g.claimCount;
    }
    return { gross: sum / YEARS, count: count / YEARS };
  };
  const a = drawn(undefined), b = drawn(own);
  const expectRatio = own[WHOLE_LINE];
  console.log(`  drawn over ${YEARS} yrs: claims ${a.count.toFixed(1)}/yr -> ${b.count.toFixed(1)}/yr (ratio ${(b.count / a.count).toFixed(3)}, expect ${expectRatio})  ${note(Math.abs(b.count / a.count - expectRatio) / expectRatio < 0.05, `claim count ratio ${(b.count / a.count).toFixed(3)} vs ${expectRatio}`)}`);
  console.log(`    WHOLE LINE      ${fmt$(a.gross)} -> ${fmt$(b.gross)}   added ${fmt$(b.gross - a.gross)} vs analytic ${fmt$(poolShocked - poolBase)}`);

  // INVARIANT 2, the shock version: the multiplier must move the DRAW and stay
  // out of the PRICING expectation. Nothing that prices GL passes it.
  console.log(`  pricing expectation is shock-blind: ${fmt$(expectedGlGrossLossForPricing(pool, { kGl: kPool }))} unchanged  ${note(expectedGlGrossLossForPricing(pool, { kGl: kPool }) === poolBase, 'the priced expectation moved with the shock')}`);
}

console.log('\n--- 6. #15 Catastrophic WC Mega-Claim — measured at both bases ---');
{
  const roster = getPredefinedMarketMembers();
  const pool = enrolledBook('MAMC6EA4', 'WC');
  // RE-TARGETED: was `{ tier: 'catastrophic', count: 2 }`. The tier is retired
  // and an amount is now REQUIRED — see below for why that requirement is the
  // whole point of this section.
  const INJECT_AMOUNT = 9_000_000;
  const inject = [{ count: 2, amount: INJECT_AMOUNT }];

  const run = (book: Member[], injections?: typeof inject) => generateWcClaims({
    members: book, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601,
    kLine: computeKLine(book), riskControlEffectiveness: 0, injections,
  });

  for (const [label, book] of [['FULL MARKET  ', roster], ['ENROLLED POOL', pool]] as [string, Member[]][]) {
    const base = run(book);
    const shocked = run(book, inject);
    const outcome = shocked.injectionResults[0];
    console.log(`  ${label} gross ${fmt$(base.grossUltimateLoss)} at this seed`);
    console.log(`                injected ${outcome.count} claims, ${fmt$(outcome.gross)} — ${fmt$(outcome.gross / outcome.count)} each`);
    console.log(`                line gross ${fmt$(base.grossUltimateLoss)} -> ${fmt$(shocked.grossUltimateLoss)} (+${((shocked.grossUltimateLoss / base.grossUltimateLoss - 1) * 100).toFixed(1)}%)`);
    // The injected claims must be the ONLY difference: natural claims are drawn
    // from their own streams and an injection opens a separate label.
    const delta = shocked.grossUltimateLoss - base.grossUltimateLoss;
    console.log(`                delta === injected gross exactly: ${note(Math.abs(delta - outcome.gross) < 1e-6, `${label} injection perturbed the natural draw by ${delta - outcome.gross}`)}`);
    console.log(`                natural claim count unchanged (${base.claims.length} -> ${shocked.claims.length - outcome.count}): ${note(shocked.claims.length - outcome.count === base.claims.length, 'injection changed the natural claim count')}`);
  }

  // ⚠ WHY THE AMOUNT IS EXPLICIT, MEASURED RATHER THAN ASSERTED. Injecting two
  // claims of the heavy component and letting them DRAW would book its MEAN.
  // The retired catastrophic pair was $17.91M. If that ratio is not ~93x, the
  // reasoning in the #15 catalog comment has drifted from the parameters.
  const heavyMean = componentMean('large');
  const ratio = INJECT_AMOUNT / heavyMean;
  console.log(`  explicit $${(INJECT_AMOUNT / 1e6).toFixed(1)}M vs the heavy component's MEAN $${Math.round(heavyMean).toLocaleString()}: ${ratio.toFixed(0)}x`);
  console.log(`    a mean-drawn pair would be ${fmt$(2 * heavyMean)} against the retired pair's $17.91M  ` +
    `${note(ratio > 80 && ratio < 110, `explicit/mean ratio ${ratio.toFixed(0)}x is outside the ~93x the catalog comment claims`)}`);

  // An injected claim must be a REAL claim, not a bolt-on amount.
  const s = run(pool, inject);
  const injected = s.claims.slice(-2);
  const occIds = new Set(s.occurrences.map(o => o.id));
  console.log(`  injected claims are real claims:`);
  console.log(`    booked at the requested amount: ${note(injected.every(c => c.grossUltimate === INJECT_AMOUNT), 'injected claim was not booked at its explicit amount')}`);
  console.log(`    have an occurrence: ${note(injected.every(c => occIds.has(c.occurrenceId)), 'injected claim has no occurrence')}`);
  console.log(`    component and rating group set: ${note(injected.every(c => c.tier === 'injected' && !!c.ratingClass), 'injected claim missing component or rating group')}`);
  console.log(`    reported in the accident year (not backdated): ${note(injected.every(c => c.accidentYear === 3 && c.reportedYear === 3), 'an un-offset injection was backdated')}`);
  console.log(`    member losses reconcile to the line total: ${note(Math.abs(s.memberLossResults.reduce((t, m) => t + m.simulatedLoss, 0) - s.grossUltimateLoss) < 1e-6, 'injected claims are missing from memberLossResults')}`);
  console.log(`    a zero/absent amount throws: ${note(throws(() => run(pool, [{ count: 1, amount: 0 }])), 'an injection without a positive amount is silently accepted')}`);

  // BACKDATING — the retroactive mechanism #10 needs. A claim dated to a prior
  // accident year is RECOGNISED now and ATTRIBUTED back; that is dual booking,
  // and it must show up as emerged prior-year loss rather than current-year.
  const back = generateWcClaims({
    members: pool, yearNumber: 3, calendarYear: 2028, instanceSeed: 24601,
    kLine: computeKLine(pool), riskControlEffectiveness: 0,
    injections: [{ count: 1, amount: 900_000, accidentYearOffset: -2 }],
  });
  const bc = back.claims[back.claims.length - 1];
  console.log(`  backdated injection: accidentYear ${bc.accidentYear}, reportedYear ${bc.reportedYear}  ` +
    `${note(bc.accidentYear === 1 && bc.reportedYear === 3, 'a backdated injection did not split accident and report year')}`);
  console.log(`    counted as EMERGED prior-year loss, not current-accident-year: ` +
    `${note(Math.abs(back.emergedGross - 900_000) < 1e-6, `backdated injection landed in the wrong bucket (emerged ${back.emergedGross})`)}`);
}

console.log('\n--- 7. #10 WC Presumption Expansion — componentFreqMultiplier and forward persistence ---');
{
  const roster = getPredefinedMarketMembers();
  const pool = enrolledBook('MAMC6EA4', 'WC');
  // RE-TARGETED: was a paramOverride on `presumption.ratePer1MPoliceFire`. That
  // path is gone with the presumption process, and the mechanism went with it —
  // the allow-list it needed had exactly one entry. The forward half is now an
  // ARRIVAL-RATE multiplier on the heavy mixture component.
  const own = ownComponentFreqMultipliers('#10', 'WC')!;
  console.log(`  component multipliers: ${JSON.stringify(own)}`);

  // ⚠ THE MISTAKE THIS EFFECT EXISTS TO PREVENT, ASSERTED. Raising the heavy
  // component's ARRIVAL RATE must leave the other components' counts alone. If
  // this were implemented by raising its WEIGHT, the others would be forced down
  // — a presumption expansion would make ordinary sprained backs rarer.
  const S = 150;
  for (const [label, book] of [['FULL MARKET  ', roster], ['ENROLLED POOL', pool]] as [string, Member[]][]) {
    const k = computeKLine(book);
    const base = expectedWcGrossLossForPricing(book, { kLine: k, yearNumber: 1 });
    const over = expectedWcGrossLossForPricing(book, { kLine: k, yearNumber: 1, componentFreqMultipliers: own });
    let heavyBase = 0, heavyOver = 0, smallBase = 0, smallOver = 0;
    for (let i = 1; i <= S; i++) {
      const args = { members: book, yearNumber: 1, calendarYear: 2026, instanceSeed: 5150 + i * 7919, kLine: k, riskControlEffectiveness: 0 };
      const b = generateWcClaims(args);
      const o = generateWcClaims({ ...args, componentFreqMultipliers: own });
      heavyBase += b.claimCountsByComponent.large; heavyOver += o.claimCountsByComponent.large;
      smallBase += b.claimCountsByComponent.small; smallOver += o.claimCountsByComponent.small;
    }
    const heavyRatio = heavyOver / heavyBase, smallRatio = smallOver / smallBase;
    console.log(`  ${label} heavy-component count ${(heavyBase / S).toFixed(1)}/yr -> ${(heavyOver / S).toFixed(1)}/yr (ratio ${heavyRatio.toFixed(3)}, expect ${own.large})  ` +
      `${note(Math.abs(heavyRatio - own.large) / own.large < 0.05, `${label} heavy-component ratio ${heavyRatio.toFixed(3)} vs ${own.large}`)}`);
    console.log(`                small-component count UNMOVED ${(smallBase / S).toFixed(1)} -> ${(smallOver / S).toFixed(1)} (ratio ${smallRatio.toFixed(3)}, expect 1.000)  ` +
      `${note(Math.abs(smallRatio - 1) < 0.03, `${label} small-component count moved ${smallRatio.toFixed(3)}x — the effect is scaling WEIGHTS, not the arrival rate`)}`);
    console.log(`                WC expected gross ${fmt$(base)} -> ${fmt$(over)}   added ${fmt$(over - base)}/yr FORWARD, PERMANENTLY (+${((over / base - 1) * 100).toFixed(2)}%)`);
  }

  // FORWARD PERSISTENCE through a real game: absent before the fire year,
  // present from it onward.
  const results = play('MAMC6EA4', 5, [{ shockId: '#10', yearNumber: 3 }]);
  const present = results.map(r => (r.shockEvents?.length ?? 0) > 0);
  console.log(`  fired in Y3, recorded in years: ${present.map((p, i) => (p ? i + 1 : null)).filter(Boolean).join(', ')}  ${note(!present[0] && !present[1] && present[2] && present[3] && present[4], 'a future-horizon shock does not persist correctly across the game')}`);
  const y4 = results[3].shockEvents![0];
  console.log(`    Y4 record still reports yearFired ${y4.yearFired} and ${fmt$(y4.expectedGrossLossAdded)} expected added`);

  // ⚠ THE ONE-OFF HALF MUST NOT REPEAT. #10 is FUTURE-horizon, so every effect
  // it carries applies every year from firing — except the three backdated
  // injections, which are marked firstYearOnly. Without that flag the same
  // reach-back would be re-injected annually for the rest of the game, which is
  // a silent, compounding overstatement.
  const injY3 = results[2].byLine.WC!.shockEvents?.[0]?.attributableClaims ?? 0;
  const injY4 = results[3].byLine.WC!.shockEvents?.[0]?.attributableClaims ?? 0;
  console.log(`  backdated injections: ${injY3} in the fire year, ${injY4} in each later year  ` +
    `${note(injY3 === 3 && injY4 === 0, `retroactive reach-back repeated (Y3 ${injY3}, Y4 ${injY4}) — firstYearOnly is not being honoured`)}`);

  // THE RULED DYNAMIC, ASSERTED. A legislative change raises realized losses
  // and leaves premium standing still, because expectedLoss is built from the
  // HELD purePremiumPer100 rather than the generator's analytic. The player must
  // re-rate or bleed. The reinsurance attachment, being 125% of that same
  // unchanged expectedLoss, does not adjust either. Both are deliberate.
  const clean = play('MAMC6EA4', 5, []);
  const wcShock = results[4].byLine.WC!, wcClean = clean[4].byLine.WC!;
  console.log(`  Y5 premium unchanged by the shock: pure premium ${wcShock.purePremiumPer100.toFixed(6)} vs ${wcClean.purePremiumPer100.toFixed(6)}  ${note(wcShock.purePremiumPer100 === wcClean.purePremiumPer100, 'the shock moved the pure premium — it must not')}`);
  console.log(`  Y5 expectedLoss unchanged: ${fmt$(wcShock.expectedLoss)} vs ${fmt$(wcClean.expectedLoss)}  ${note(wcShock.expectedLoss === wcClean.expectedLoss, 'the shock moved the priced expected loss')}`);
  console.log(`  Y5 attachment unchanged: ${fmt$(wcShock.attachment)} vs ${fmt$(wcClean.attachment)}  ${note(wcShock.attachment === wcClean.attachment, 'the shock moved the reinsurance attachment')}`);
  console.log(`    RULED AND INTENDED: a law that makes claims more expensive does not politely raise your`);
  console.log(`    rates for you, and the treaty does not adjust either. Do not "fix" either of these.`);
}

console.log('\n--- 8. #28 Pandemic — THE CROSS-LINE TEST ---');
{
  // THE ARCHITECTURAL GAP THIS EVENT EXISTS TO PROVE. Every generator is
  // line-local: processLineYear only ever sees its own line. #28 is ONE cause
  // that has to reach two of them, so the resolution happens at pool level in
  // processYear (which has all three lines in scope) and per-line effects are
  // projected down. Both target lines are REAL cut-over claim-level generators,
  // not stubs.
  // WC's half is a COMPONENT multiplier (its presumption sub-key is gone).
  // GL's half is a WHOLE-LINE frequency multiplier now — GL has no
  // sub-coverage left to target either, since the GL rebuild deleted them
  // all. Reading the two from different accessors is still the point — they
  // are different mechanisms — even though GL's own key collapsed to WHOLE_LINE.
  const wcOwn = ownComponentFreqMultipliers('#28', 'WC')!;
  const glOwn = ownFreqMultipliers('#28', 'GL')!;
  console.log(`  WC component effects ${JSON.stringify(wcOwn)}   GL whole-line effects ${JSON.stringify(glOwn)}`);
  console.log(`  WC's half did NOT silently vanish: ${note(!!wcOwn && Object.keys(wcOwn).length > 0, "#28's WC half resolves to nothing — the event has silently become GL-only")}`);

  const results = play('MAMC6EA4', 5, [{ shockId: '#28', yearNumber: 2 }]);
  const clean = play('MAMC6EA4', 5, []);
  const y2 = results[1];
  const rec = y2.shockEvents?.[0];
  console.log(`  ONE pool record, not two: ${y2.shockEvents?.length ?? 0}  ${note(y2.shockEvents?.length === 1, 'a cross-line event produced more than one pool row')}`);
  console.log(`  lines affected: ${rec?.linesAffected.join(' + ')}  ${note(rec?.linesAffected.length === 2 && rec.linesAffected.includes('WC') && rec.linesAffected.includes('GL'), 'the cross-line event did not reach both lines')}`);
  console.log(`  recorded on BOTH line results: WC ${y2.byLine.WC?.shockEvents?.length ?? 0}, GL ${y2.byLine.GL?.shockEvents?.length ?? 0}  ${note((y2.byLine.WC?.shockEvents?.length === 1) && (y2.byLine.GL?.shockEvents?.length === 1), 'the event is missing from one of its lines')}`);
  console.log(`  NOT on Property: ${y2.byLine.Property?.shockEvents === undefined ? 'absent' : 'PRESENT'}  ${note(y2.byLine.Property?.shockEvents === undefined, 'an untouched line carries the record')}`);
  console.log(`  pool expected added ${fmt$(rec?.expectedGrossLossAdded ?? 0)} = WC ${fmt$(y2.byLine.WC?.shockEvents?.[0].expectedGrossLossAdded ?? 0)} + GL ${fmt$(y2.byLine.GL?.shockEvents?.[0].expectedGrossLossAdded ?? 0)}`);
  console.log(`    ${note(Math.abs((rec?.expectedGrossLossAdded ?? 0) - ((y2.byLine.WC?.shockEvents?.[0].expectedGrossLossAdded ?? 0) + (y2.byLine.GL?.shockEvents?.[0].expectedGrossLossAdded ?? 0))) < 1, 'the pool row does not sum its lines')} — the pool row sums the lines it touched`);

  // INVARIANT 1 FOR SHOCK EFFECTS, and this check earned its place. It caught a
  // real bug: the presumption multiplier was applied to the generator's lambda
  // but NOT to the analytic's presumption term, so WC reported $0.00M expected
  // added while its realized gross moved $2.92M -> $8.07M. Whatever moves the
  // draw must move the matched expectation.
  for (const line of ['WC', 'GL'] as CoverageLine[]) {
    const lineRec = y2.byLine[line]?.shockEvents?.[0];
    const movedGross = y2.byLine[line]!.grossUltimateLoss !== clean[1].byLine[line]!.grossUltimateLoss;
    const hasExpectation = (lineRec?.expectedGrossLossAdded ?? 0) > 0 || (lineRec?.attributableGrossLoss ?? 0) > 0;
    console.log(`  ${line}: gross moved ${movedGross}, cost reported ${fmt$((lineRec?.expectedGrossLossAdded ?? 0) + (lineRec?.attributableGrossLoss ?? 0))}  ${note(movedGross === hasExpectation, `${line} moved the draw without reporting a cost — the analytic is not matched to the draw`)}`);
  }

  // BOTH LINES MOVE IN THE SHOCK YEAR. WHAT HAPPENS AFTER IT DIFFERS BY LINE,
  // AND THE DIFFERENCE IS THE REPORT LAG.
  //
  // ⚠ THIS ASSERTION CHANGED WITH THE WC SEVERITY REBUILD, and the change is a
  // real consequence rather than a relaxation. It used to require every year but
  // the shock year to be byte-identical, on the reasoning that "a current-horizon
  // event that leaks forward would be indistinguishable from a future-horizon
  // one". That reasoning was correct when every claim reported in its accident
  // year. It no longer is:
  //
  //   #28 raises the arrival rate of WC's HEAVY component for one year. 18% of
  //   heavy-component claims report LATE. So the extra claims the shock causes in
  //   Y2 keep EMERGING through Y3, Y4 and Y5 — the pool learns about them later.
  //
  // That is what a report lag means, and a current-horizon shock now genuinely
  // has a multi-year reported tail. It is still distinguishable from a
  // future-horizon event: the DRAW is confined to the shock year (Y3+ opens
  // independent per-member streams), so the later movement can only be positive
  // and must decay as the lag distribution runs off. Both are asserted.
  //
  // GL has no report lag, so GL must still be confined to the single year — the
  // contrast between the two lines here is the check that this is the lag and
  // not state leaking somewhere.
  for (const line of ['WC', 'GL'] as CoverageLine[]) {
    const delta = [0, 1, 2, 3, 4].map(i => results[i].byLine[line]!.grossUltimateLoss - clean[i].byLine[line]!.grossUltimateLoss);
    const moved = delta.map(d => d !== 0);
    console.log(`  ${line} gross moved in years: ${moved.map((m, i) => (m ? i + 1 : null)).filter(Boolean).join(', ') || 'none'}`);
    console.log(`    Y2 ${fmt$(clean[1].byLine[line]!.grossUltimateLoss)} -> ${fmt$(results[1].byLine[line]!.grossUltimateLoss)}  ${note(moved[1], `${line} did not move in the shock year`)}`);
    // NOTHING LEAKS BACKWARDS, on either line. A pre-shock year moving would mean
    // the resolver is applying a current-horizon effect before its fire year.
    console.log(`    Y1 (pre-shock) untouched: ${note(!moved[0], `${line} moved BEFORE the shock year`)}`);
    if (line === 'GL') {
      console.log(`    Y3-Y5 untouched (GL has no report lag): ${note(!moved[2] && !moved[3] && !moved[4], 'GL moved after its current-horizon shock year')}`);
    } else {
      const tail = [delta[2], delta[3], delta[4]];
      console.log(`    Y3-Y5 emergence tail: ${tail.map(d => fmt$(d)).join(', ')}`);
      console.log(`      every tail year is an ADDITION, never a subtraction: ${note(tail.every(d => d >= 0), `WC's post-shock years moved DOWN (${tail.map(d => fmt$(d)).join(', ')}) — emergence can only add`)}`);
      console.log(`      and the tail is far smaller than the shock year (${fmt$(delta[1])}): ` +
        `${note(Math.max(...tail) < delta[1] * 0.5, 'the emergence tail is not small relative to the shock year — this looks like forward leakage, not a report lag')}`);
    }
  }

  // Property is not just unrecorded — it must be numerically untouched, which
  // is the real proof that a line receives only its own slice.
  const prMoved = [0, 1, 2, 3, 4].some(i => results[i].byLine.Property!.grossUltimateLoss !== clean[i].byLine.Property!.grossUltimateLoss);
  console.log(`  Property gross unmoved in every year: ${note(!prMoved, 'the cross-line event perturbed an untargeted line')}`);

  // And the heavy-component channel specifically — #28 and #10 act on the same
  // knob by different mechanisms, so they must compose rather than collide.
  const both = play('MAMC6EA4', 5, [{ shockId: '#10', yearNumber: 1 }, { shockId: '#28', yearNumber: 2 }]);
  const y2both = both[1];
  console.log(`  #10 + #28 together in Y2: ${y2both.shockEvents?.length} records, ${y2both.shockEvents?.map(s => s.shockId).join(' + ')}  ${note(y2both.shockEvents?.length === 2, 'two concurrent events did not both record')}`);
  console.log(`    #10 raises the heavy component's arrival rate permanently, #28 for one year —`);
  console.log(`    same knob, different horizons, and the resolver COMPOUNDS them rather than letting one win.`);
  const wcBoth = y2both.byLine.WC!.grossUltimateLoss;
  const wc28 = results[1].byLine.WC!.grossUltimateLoss;
  console.log(`    WC Y2 gross: clean ${fmt$(clean[1].byLine.WC!.grossUltimateLoss)}, #28 only ${fmt$(wc28)}, both ${fmt$(wcBoth)}`);
}

console.log(problems.length === 0
  ? '\nALL SHOCK CHECKS PASS.'
  : `\n${problems.length} PROBLEMS:\n  ${problems.join('\n  ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
