// ============================================================================
// THE WC PROGRAM, VERIFIED A SECOND WAY — the instrument that checked the gate.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/wc-program-verify.ts        # 24 games x 5, ~40s
//
// wc-program-check is the every-commit gate. This is a SECOND, INDEPENDENT
// instrument for the same five claims, written after the gate and deliberately
// not sharing its code: different seeds (VER*), five years instead of four,
// three-line games throughout, and a recursive Object.is deep-equality (so -0
// and NaN count) instead of JSON.stringify or a field list. Where the two
// agree, the agreement means something; where the gate had a hole, this is how
// it was found.
//
// WHAT IT ASSERTS
//   NULL ARM     the generator with neither argument vs multiplier 1 and
//                conversion 0: deep-identical. AND the engine's own unprogrammed
//                register === a direct no-argument generator call on the same
//                roster, k_line and seed — so the engine's plumbing adds nothing.
//   CONFINEMENT  GL and Property, program on vs off: every CLAIM deep-identical,
//                and eight loss-side fields === (gross, net, recovery,
//                development ceded, reserve, premium, members, claim count).
//                Surplus is reported, not asserted: the pool's cross-line cash
//                allocation moves it by ~1e-8 for either program.
//   YEAR 1       ⚠ WC's ramps start at 25% and 75%, not 0, so year 1 of a
//                commitment is NOT a control. The control is a game committing
//                from YEAR 2: its WHOLE year-1 ResultSet, every line and field,
//                must deep-equal the unprogrammed game's. And a game committing
//                IN year 1 must move WC in year 1 — if it does not, the ramp is
//                not being applied.
//   COUNT        conversion alone, redrawn on the enrolled book through
//                claimRegeneration: count in = count out, and lost-time claims
//                lost = small claims gained = claims converted. A moved count
//                would be REMOVAL wearing conversion's name.
//   TOWER        conversion alone: ceded by layer and in total Object.is-equal,
//                ON THE ULTIMATE BASIS. Booked development cession is not
//                exactly zero — see WC_RTW_CONVERSION_CEILING — and is not
//                asserted here.
//
// ============================================================================
// ⚠ THE NULL ARM HAS A RESOLUTION FLOOR — IN THIS INSTRUMENT AND THE GATE.
// Both compare the REGISTER, so a leak in the ARRIVAL RATE is visible only once
// it changes a Poisson count. Measured: an explicit multiplier of 1 read as
// 1 + 1e-12 or 1 + 1e-6 changed no claim in 24 of 24 line-years and the gate
// stayed green; at 1 + 1e-3 it went red. The shipped code is exact by
// construction (lambda x 1 is exact in IEEE 754; conversion 0 skips the pass),
// so the claim holds — but neither instrument can prove it below ~1e-3. A check
// that could would have to read lambda, which the generator does not expose.
//
// ⚠ WHAT THE GATE WAS PROVED AGAINST — six mutants, each in a throwaway copy of
// the tree, each run through wc-program-check:
//
//   the $1M ceiling removed                       RED   converted a $2.1M claim; ceded moved
//   the program handed to the prospect draw       RED   marketplace ledger moved
//   both ramps started at zero                    RED   "WC did not move in year 1"
//   conversion consumed the severity stream       RED   unconverted claims changed (re-phase)
//   converted claims removed instead              RED   claim count changed
//   an explicit 1 read as 1 + 1e-12               GREEN the resolution floor above
//
// The second one was green on the gate's FIRST version: it summed a market
// ledger field (`actual`) that does not exist, read 0 on every row, and could
// never fail. gl-program-check still sums that field; its marketplace
// assertion is vacuous for the same reason.
//
// Not reproducible from here without a code change, and recorded instead: the
// booked-basis tower measurement needed RTW ALONE in the engine, which the one
// program id cannot express — it was run on a copy with
// WC_SAFETY_FREQUENCY_REDUCTION set to 0.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { generateWcClaims } from '../../src/utils/wcClaimEngine';
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
import { cedeOccurrences, occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { DEFAULT_LAYERS_PLACED } from '../../src/data/reinsuranceTower';
import { WC_RTW_CONVERSION_RATE, WC_RTW_LOST_TIME_COMPONENTS } from '../../src/utils/riskControlPrograms';
import type { GameState, ResultSet, CoverageLine } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 24), YEARS = 5;
const P = 'wc-safety-rtw';

function deepEq(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    if (!Object.is(a, b)) out.push(`${path}: ${String(a)} vs ${String(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array/object mismatch`); return out; }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) { out.push(`${path}: keys differ`); }
  for (const k of new Set([...ka, ...kb])) deepEq((a as never)[k], (b as never)[k], `${path}.${k}`, out);
  return out;
}

function play(g: number, lines: CoverageLine[], ids: (y: number) => string[]) {
  const id = `VER${g}`; const inst = generateGameInstance(id, 7_700_000 + g * 5003);
  const setup = { poolName: 'V', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = { setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const res: ResultSet[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, { ...defaultDecisionSet(y), riskControlProgramIds: ids(y) });
    res.push(p.result);
    gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result], currentYearNumber: y + 1,
      currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS };
  }
  return { inst, res };
}

const ALL: CoverageLine[] = ['WC', 'GL', 'Property'];
const report: Record<string, string[]> = { null: [], confine: [], y1: [], count: [], tower: [] };
let nullYears = 0, engineVsDirect = 0, confineYears = 0, confineClaims = 0, countYears = 0, towerYears = 0;
let converted = 0, eligible = 0, maxDrift = 0, y1Rows = 0;
let y1CommitMoved = 0, y1CommitGames = 0;
const LOSS = ['grossUltimateLoss', 'netUltimateLoss', 'reinsuranceRecovery', 'priorYearDevelopmentCeded',
  'endingNetReserve', 'poolPremium', 'activeMembers', 'claimCount'];

for (let g = 0; g < GAMES; g++) {
  const off = play(g, ALL, () => []);
  const on = play(g, ALL, () => [P]);
  const from2 = play(g, ALL, y => (y >= 2 ? [P] : []));

  // --- YEAR 1 CONTROL: the WHOLE year-1 ResultSet of a game committing from year 2
  y1Rows++;
  const d1 = deepEq(off.res[0], from2.res[0], `g${g}.y1`);
  if (d1.length) report.y1.push(...d1);
  // and a game committing IN year 1 must NOT be identical on WC (the ramp acts)
  y1CommitGames++;
  if (on.res[0].byLine.WC!.grossUltimateLoss !== off.res[0].byLine.WC!.grossUltimateLoss) y1CommitMoved++;

  for (let y = 0; y < YEARS; y++) {
    const r = off.res[y].byLine.WC!;
    // --- NULL ARM: direct generator, neither argument vs 1 and 0, AND vs the engine's own register
    const base = { members: r.memberList!, yearNumber: y + 1, calendarYear: off.res[y].calendarYear,
      instanceSeed: off.inst.seed, kLine: r.kLineApplied!, riskControlEffectiveness: r.rcEffectivenessApplied! };
    const neither = generateWcClaims(base);
    const nulled = generateWcClaims({ ...base, programFreqMultiplier: 1, programRtwConversion: 0 });
    nullYears++;
    report.null.push(...deepEq(neither, nulled, `g${g}.y${y + 1}.null`));
    engineVsDirect++;
    report.null.push(...deepEq(r.claims, neither.claims, `g${g}.y${y + 1}.engineVsDirect`));

    // --- CONFINEMENT: GL and Property, full claim register + loss-side fields, off vs on
    for (const l of ['GL', 'Property'] as CoverageLine[]) {
      const A = off.res[y].byLine[l]!, B = on.res[y].byLine[l]!;
      confineYears++; confineClaims += (A.claims ?? []).length;
      report.confine.push(...deepEq(A.claims, B.claims, `g${g}.y${y + 1}.${l}.claims`));
      for (const k of LOSS) if (!Object.is((A as never)[k], (B as never)[k])) report.confine.push(`g${g}.y${y + 1}.${l}.${k}`);
      maxDrift = Math.max(maxDrift, Math.abs(A.endingSurplus - B.endingSurplus));
    }

    // --- COUNT and TOWER: conversion ALONE on the enrolled book, through regeneration
    const plain = regenerateLineYearClaims(off.inst, off.res[y], 'WC');
    const copy = { ...off.res[y], byLine: { ...off.res[y].byLine, WC: { ...r, programRtwApplied: WC_RTW_CONVERSION_RATE } } } as ResultSet;
    const conv = regenerateLineYearClaims(off.inst, copy, 'WC');
    countYears++;
    if (plain.claims.length !== conv.claims.length) report.count.push(`g${g}.y${y + 1}: ${plain.claims.length} -> ${conv.claims.length}`);
    const byComp = (cs: { tier: string }[]) => cs.reduce((m, c) => (m[c.tier] = (m[c.tier] ?? 0) + 1, m), {} as Record<string, number>);
    const a = byComp(plain.claims), b = byComp(conv.claims);
    let movedOut = 0; for (const k of WC_RTW_LOST_TIME_COMPONENTS) movedOut += (a[k] ?? 0) - (b[k] ?? 0);
    const movedIn = (b.small ?? 0) - (a.small ?? 0);
    let conv1 = 0;
    for (let i = 0; i < plain.claims.length; i++) {
      const p = plain.claims[i], q = conv.claims[i];
      if (p.id !== q.id) { report.count.push(`g${g}.y${y + 1}: id order moved at ${i}`); break; }
      if (WC_RTW_LOST_TIME_COMPONENTS.includes(p.tier) && p.grossUltimate < 1e6) eligible++;
      if (p.tier !== q.tier) conv1++;
    }
    converted += conv1;
    if (movedOut !== movedIn || movedIn !== conv1) report.count.push(`g${g}.y${y + 1}: out ${movedOut} in ${movedIn} converted ${conv1}`);
    towerYears++;
    const cA = cedeOccurrences('WC', occurrenceTotals(plain.claims, plain.occurrences), DEFAULT_LAYERS_PLACED.WC);
    const cB = cedeOccurrences('WC', occurrenceTotals(conv.claims, conv.occurrences), DEFAULT_LAYERS_PLACED.WC);
    report.tower.push(...deepEq(cA.cededByLayer, cB.cededByLayer, `g${g}.y${y + 1}.cededByLayer`));
    if (!Object.is(cA.totalCeded, cB.totalCeded)) report.tower.push(`g${g}.y${y + 1}: ceded ${cA.totalCeded} -> ${cB.totalCeded}`);
  }
}
const say = (k: string, ok: string) => console.log(`${report[k].length ? 'FAIL' : 'PASS'}  ${ok}${report[k].length ? '\n      ' + report[k].slice(0, 5).join('\n      ') : ''}`);
console.log(`${GAMES} games x ${YEARS} years, three-line games, deep Object.is\n`);
say('null', `NULL ARM: ${nullYears} WC line-years, neither-argument vs (1, 0) register deep-identical; and the engine's own unprogrammed register === the direct no-argument call in ${engineVsDirect}`);
say('confine', `CONFINEMENT: ${confineYears} GL/Property line-years, ${confineClaims} claims deep-identical + ${LOSS.length} loss-side fields ===; surplus max drift $${maxDrift.toExponential(2)}`);
say('y1', `YEAR-1 CONTROL: ${y1Rows} whole year-1 ResultSets (every line, every field) of a from-year-2 game deep-identical to unprogrammed`);
console.log(`${y1CommitMoved === y1CommitGames ? 'PASS' : 'FAIL'}  RAMP APPLIED: WC moved in year 1 in ${y1CommitMoved}/${y1CommitGames} games committing IN year 1`);
say('count', `COUNT: ${countYears} WC line-years under conversion alone: count in = count out, lost-time out = small in = converted (${converted} of ${eligible} eligible, ${(100 * converted / eligible).toFixed(2)}% vs c ${(100 * WC_RTW_CONVERSION_RATE).toFixed(1)}%)`);
say('tower', `TOWER: ${towerYears} WC line-years under conversion alone: ceded by layer and total Object.is-identical (ultimate basis)`);

const failed = Object.values(report).some(r => r.length > 0) || y1CommitMoved !== y1CommitGames;
console.log(failed ? '\nFAIL' : '\nALL FIVE CLAIMS HOLD, AND THE RAMP IS APPLIED.');
process.exit(failed ? 1 : 0);
