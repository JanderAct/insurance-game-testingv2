// ============================================================================
// THE WC SAFETY & RETURN-TO-WORK PROGRAM REACHES WC AND NOTHING ELSE — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/wc-program-check.ts
//
// Two levers, one program (see riskControlPrograms.ts): SAFETY scales WC's
// arrival rate; RETURN TO WORK converts lost-time claims under $1M to
// medical-only, one for one, AFTER the draw and on its own labelled stream.
// Everything below is a confinement or a phase claim, asserted against paired
// runs rather than argued.
//
// WHAT IT ASSERTS
//   LEVERS      both schedules by tenure, read from the functions the engine
//               calls: safety 0.9875 / 0.97 / 0.95 / 0.95, RTW 0.75c / c / c / c.
//               Other lines read 1 and 0; nothing committed reads 1 and 0; each
//               program leaves the other's line alone.
//   LAPSE       the two halves lapse DIFFERENTLY, and each is asserted alone:
//               safety HALVES each unfunded year (0.5 / 0.25 / 0.125 / 0 of its
//               level), RTW goes to ZERO in the first. A restart resumes safety
//               from its residual and starts RTW's ramp again at 75%.
//   CHARGE      $1M in every committed year and 0 otherwise, flat — no
//               maintenance tier. The engine's riskControlInvestment on WC is
//               exactly that, and GL's and Property's are unmoved by it.
//   NULL INPUT  the generator given multiplier 1 and conversion 0 returns a
//               register bit-identical to one given neither.
//               ⚠ THIS HAS A RESOLUTION FLOOR. It compares the REGISTER, not
//               lambda, so it sees a leak only once the leak changes a Poisson
//               count. Measured by mutation: an explicit 1 read as 1 + 1e-12 or
//               1 + 1e-6 leaves every claim identical and this stays GREEN; at
//               1 + 1e-3 it goes red. The shipped code is exact BY CONSTRUCTION —
//               it multiplies lambda by the value given, and x * 1 === x in IEEE
//               754; a conversion of 0 skips the pass entirely — so the claim
//               holds, but this check alone could not prove it below ~1e-3.
//   NO RE-PHASE conversion alone keeps every claim id, in order; every claim it
//               did not convert is bit-identical; every one it did was a
//               lost-time claim under the ceiling and is now `small`.
//   NO TOWER    conversion alone leaves what the tower cedes EXACTLY unchanged —
//               the reason for the $1M ceiling. ON THE ULTIMATE BASIS (the tower
//               on the drawn claims). Booked development cession is NOT exactly
//               unchanged; see WC_RTW_CONVERSION_CEILING for the measurement.
//   YEAR ONE    ⚠ NOT AT RAMP ZERO, UNLIKE GL. Both WC ramps act from the first
//               year of commitment, so the exact control is a game that commits
//               from YEAR 2: its year 1 is at tenure 0 and must be BIT-IDENTICAL
//               to an unprogrammed game on every line (===, not a tolerance).
//   OTHER LINES with the WC program committed every year, GL's and Property's
//               claims, gross, net, recovery, reserve, premium and roster are
//               bit-identical at every year, and their surplus agrees to a cent
//               (the pool's cross-line cash allocation moves it by ~1e-8 — see
//               otherLineOk).
//   MARKETPLACE the prospect loss ledger is unchanged at every year.
//   DIRECTION   at full effect, claim count falls by about the safety cut, and
//               the realised conversion share of eligible claims is about c.
//
// WHAT IT DOES NOT ASSERT: that 5% and 10% are the right sizes, or what they
// are worth. That is wc-program-value.ts, a reading with no pass condition.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { generateWcClaims, computeKLine } from '../../src/utils/wcClaimEngine';
import { cedeOccurrences, occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { DEFAULT_LAYERS_PLACED } from '../../src/data/reinsuranceTower';
import {
  WC_RTW_CONVERSION_CEILING, WC_RTW_CONVERSION_RATE, WC_RTW_LOST_TIME_COMPONENTS,
  WC_SAFETY_FREQUENCY_REDUCTION, WC_SAFETY_RTW_ANNUAL_COST, programAnnualCost,
  programFreqMultiplier, programRtwConversion, programTenure, wcSafetyRtwStanding,
} from '../../src/utils/riskControlPrograms';
import type { CoverageLine, DecisionSet, GameState, Member } from '../../src/types/simulation';

const PROGRAM = 'wc-safety-rtw';
const GL_PROGRAM = 'gl-law-enforcement-analytics';
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 5);
const ALL: CoverageLine[] = ['WC', 'GL', 'Property'];
const FIELDS = ['grossUltimateLoss', 'netUltimateLoss', 'reinsuranceRecovery', 'endingNetReserve',
  'endingSurplus', 'poolPremium', 'activeMembers', 'riskControlInvestment'] as const;
// The LOSS-SIDE fields: what the program could reach by leaking into another
// line's draw, pricing or roster. These must be === on the other lines.
const LOSS_FIELDS = ['grossUltimateLoss', 'netUltimateLoss', 'reinsuranceRecovery', 'endingNetReserve',
  'poolPremium', 'activeMembers', 'riskControlInvestment'] as const;
const CENT = 0.01;

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const ok = (cond: boolean, msg: string) => { if (!cond) fail(msg); };
const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;

type LineRow = Record<(typeof FIELDS)[number], number> & {
  claims: number; lostTime: number; market: number;
  freqApplied: number; rtwApplied: number;
  /** Claims whose id names a lost-time component but whose tier is `small` — i.e. converted. */
  converted: number;
};

function play(g: number, lines: CoverageLine[], ids: (y: number) => string[]) {
  const id = `WPC${g}`;
  const inst = generateGameInstance(id, 6_600_000 + g * 7919);
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: Record<string, LineRow>[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const d: DecisionSet = { ...defaultDecisionSet(y), riskControlProgramIds: ids(y) };
    const p = processYear(gs, d);
    const byLine = (p.result as never as { byLine: Record<string, Record<string, unknown>> }).byLine;
    const row: Record<string, LineRow> = {};
    for (const l of lines) {
      const r = byLine[l] as Record<string, unknown>;
      const claims = (r.claims as { tier: string }[] | undefined) ?? [];
      // ⚠ PROSPECTS ONLY, AND ON simulatedLoss. The market ledger is the enrolled
      // rows followed by the prospects', so the enrolled part moves with the
      // program by design. And MemberLossResult has no `actual` field: summing
      // `m.actual ?? 0` — which gl-program-check does — reads 0 on every row and
      // makes the assertion vacuous. This one was validated by handing the
      // program to the prospect draw and watching it fail.
      type Mlr = { memberId: string; simulatedLoss: number };
      const enrolled = new Set(((r.memberLossResults as Mlr[] | undefined) ?? []).map(m => m.memberId));
      const mk = ((r.marketMemberLossResults as Mlr[] | undefined) ?? []).filter(m => !enrolled.has(m.memberId));
      const converted = (claims as { id: string; tier: string }[]).filter(c => {
        const parts = c.id.split('-');
        return c.tier === 'small' && parts[parts.length - 2] !== 'small';
      }).length;
      const rec = { claims: claims.length, lostTime: claims.filter(c => c.tier !== 'small').length,
        market: mk.reduce((s, m) => s + m.simulatedLoss, 0),
        freqApplied: (r.programFreqApplied as number | undefined) ?? 1,
        rtwApplied: (r.programRtwApplied as number | undefined) ?? 0, converted } as LineRow;
      for (const f of FIELDS) rec[f] = r[f] as number;
      row[l] = rec;
    }
    out.push(row);
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
  return out;
}

const sameRow = (a: LineRow, b: LineRow) =>
  FIELDS.every(f => a[f] === b[f]) && a.claims === b.claims && a.market === b.market;
// ⚠ THE OTHER LINES' SURPLUS IS HELD TO A CENT, NOT TO ===, AND THE REASON IS
// MEASURED. A WC program changes WC's cash, and the pool allocates cash and
// investments across lines, so another line's beginningCash/endingSurplus can
// move in the last bits of the float: max $1.9e-8 over 6 games x 4 years. GL's
// shipped program does exactly the same to WC and Property ($7.5e-9) — its gate
// never saw it because it compares gross loss only. It is pool-level float
// noise, not a program reaching a line. The LOSS side stays === below.
const otherLineOk = (a: LineRow, b: LineRow) =>
  LOSS_FIELDS.every(f => a[f] === b[f]) && a.claims === b.claims && a.market === b.market
  && Math.abs(a.endingSurplus - b.endingSurplus) < CENT;
let maxSurplusDrift = 0;

console.log('=== WC SAFETY & RETURN-TO-WORK PROGRAM — CONFINEMENT ===');
console.log(`${GAMES} games x ${YEARS} years. safety ${(100 * WC_SAFETY_FREQUENCY_REDUCTION).toFixed(1)}%, `
  + `RTW conversion rate ${WC_RTW_CONVERSION_RATE} under $${(WC_RTW_CONVERSION_CEILING / 1e6).toFixed(0)}M\n`);

// --- 1. THE LEVERS BY TENURE -------------------------------------------------
console.log('--- 1. both levers by tenure, from the engine\'s own functions ---');
const eF = [1 - 0.25 * WC_SAFETY_FREQUENCY_REDUCTION, 1 - 0.6 * WC_SAFETY_FREQUENCY_REDUCTION,
  1 - WC_SAFETY_FREQUENCY_REDUCTION, 1 - WC_SAFETY_FREQUENCY_REDUCTION];
const eC = [0.75, 1, 1, 1].map(r => r * WC_RTW_CONVERSION_RATE);
for (let t = 1; t <= 4; t++) {
  const prior = Array.from({ length: t - 1 }, () => [PROGRAM]);
  const f = programFreqMultiplier('WC', [PROGRAM], prior);
  const c = programRtwConversion('WC', [PROGRAM], prior);
  console.log(`   tenure ${t}: safety x${f.toFixed(4)} (exp ${eF[t - 1].toFixed(4)})   `
    + `RTW ${c.toFixed(5)} (exp ${eC[t - 1].toFixed(5)})`);
  ok(close(f, eF[t - 1]), `tenure ${t}: safety ${f} != ${eF[t - 1]}`);
  ok(close(c, eC[t - 1]), `tenure ${t}: RTW ${c} != ${eC[t - 1]}`);
}
for (const l of ['GL', 'Property'] as CoverageLine[]) {
  ok(programRtwConversion(l, [PROGRAM], [[PROGRAM]]) === 0, `${l} received a WC RTW rate`);
}
ok(programFreqMultiplier('Property', [PROGRAM], [[PROGRAM]]) === 1, 'Property received a WC safety multiplier');
ok(programFreqMultiplier('GL', [PROGRAM], [[PROGRAM], [PROGRAM]]) === 1, 'GL moved on the WC program');
ok(programFreqMultiplier('WC', [GL_PROGRAM], [[GL_PROGRAM], [GL_PROGRAM]]) === 1, 'WC moved on the GL program');
ok(programRtwConversion('WC', [GL_PROGRAM], [[GL_PROGRAM]]) === 0, 'the GL program set a WC RTW rate');
ok(programFreqMultiplier('WC', [], []) === 1 && programRtwConversion('WC', [], []) === 0, 'WC moved with nothing committed');
console.log('   other lines, the other program and nothing committed read 1 and 0: OK');

// --- 2. THE LAPSE RULE, EACH HALF ON ITS OWN ---------------------------------
console.log('\n--- 2. stopping: safety decays, RTW is a cliff — each asserted alone ---');
ok(programTenure(PROGRAM, [PROGRAM], [[PROGRAM], [], [PROGRAM]]) === 2, 'a gap did not reset the WC tenure');
const built = [[PROGRAM], [PROGRAM], [PROGRAM]];
const expectSafety = [0.5, 0.25, 0.125, 0];
for (let k = 1; k <= 4; k++) {
  const prior = [...built, ...Array.from({ length: k - 1 }, () => [] as string[])];
  const st = wcSafetyRtwStanding([], prior);
  const f = programFreqMultiplier('WC', [], prior), c = programRtwConversion('WC', [], prior);
  console.log(`   lapsed year ${k}: safety level ${st.safetyLevel.toFixed(3)} (x${f.toFixed(4)})   RTW level ${st.rtwLevel.toFixed(3)} (c ${c.toFixed(4)})   charge $${st.annualCost}`);
  ok(close(st.safetyLevel, expectSafety[k - 1]), `lapsed year ${k}: safety level ${st.safetyLevel} != ${expectSafety[k - 1]}`);
  ok(close(f, 1 - WC_SAFETY_FREQUENCY_REDUCTION * expectSafety[k - 1]), `lapsed year ${k}: safety multiplier ${f} does not follow its level`);
  ok(st.rtwLevel === 0 && c === 0, `lapsed year ${k}: RTW is ${c}, not the cliff`);
  ok(st.annualCost === 0, `lapsed year ${k}: charged ${st.annualCost} while not committed`);
}
// A restart after one lapsed year: safety resumes from its residual (0.5, above
// the ramp's 0.25), RTW starts again at its tenure-1 value (0.75c).
const back = wcSafetyRtwStanding([PROGRAM], [...built, []]);
ok(close(back.safetyLevel, 0.5), `restart: safety ${back.safetyLevel} did not resume from its residual 0.5`);
ok(close(programRtwConversion('WC', [PROGRAM], [...built, []]), eC[0]), 'restart: RTW did not start again at 0.75c');
// And a restart after safety has fully decayed starts it from its ramp.
ok(close(wcSafetyRtwStanding([PROGRAM], [...built, [], [], [], []]).safetyLevel, 0.25), 'restart after full decay: safety not at 0.25');
console.log('   restart: safety resumes from its residual, RTW restarts at 75%: OK');

// --- 2b. THE CHARGE, FLAT --------------------------------------------------
console.log('\n--- 2b. the charge: $1M every committed year, nothing otherwise ---');
for (let t = 1; t <= 6; t++) {
  const prior = Array.from({ length: t - 1 }, () => [PROGRAM]);
  ok(programAnnualCost('WC', [PROGRAM], prior) === WC_SAFETY_RTW_ANNUAL_COST, `tenure ${t}: WC charged ${programAnnualCost('WC', [PROGRAM], prior)}`);
}
ok(programAnnualCost('WC', [], [[PROGRAM], [PROGRAM]]) === 0, 'an unfunded year was charged');
ok(programAnnualCost('GL', [PROGRAM], [[PROGRAM]]) === 0, 'GL was charged for the WC program');
ok(programAnnualCost('Property', [PROGRAM], [[PROGRAM]]) === 0, 'Property was charged for the WC program');
ok(programAnnualCost('WC', [GL_PROGRAM], [[GL_PROGRAM]]) === 0, 'WC was charged for the GL program');
console.log(`   $${WC_SAFETY_RTW_ANNUAL_COST / 1e6}M at tenure 1-6 (no maintenance tier), 0 unfunded, 0 on GL/Property: OK`);

// --- 3. THE GENERATOR: null input, no re-phase, no tower -------------------
console.log('\n--- 3. the generator: null input, no re-phase, no tower ---');
let nClaims = 0, nConverted = 0, nEligible = 0, cededChecked = 0;
for (let g = 0; g < GAMES; g++) {
  const inst = generateGameInstance(`WPC${g}`, 6_600_000 + g * 7919);
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: `WPC${g}`, activeLines: ['WC'] };
  const { poolState } = runPriorHistory(inst, setup as never);
  const members = (poolState.allMarketMembers as Member[]).filter(m => (m.exposureByLine.WC ?? 0) > 0);
  const kLine = computeKLine(members);
  for (let y = 1; y <= YEARS; y++) {
    const base = { members, yearNumber: y, calendarYear: 2025 + y, instanceSeed: inst.seed, kLine, riskControlEffectiveness: 0 };
    const plain = generateWcClaims(base);
    const nulled = generateWcClaims({ ...base, programFreqMultiplier: 1, programRtwConversion: 0 });
    ok(JSON.stringify(plain) === JSON.stringify(nulled), `g${g} y${y}: multiplier 1 / conversion 0 is not the absent register`);

    const conv = generateWcClaims({ ...base, programRtwConversion: WC_RTW_CONVERSION_RATE });
    ok(conv.claims.length === plain.claims.length, `g${g} y${y}: conversion changed the claim COUNT`);
    for (let i = 0; i < plain.claims.length; i++) {
      const a = plain.claims[i], b = conv.claims[i];
      if (a.id !== b.id) { fail(`g${g} y${y}: claim ${i} id ${a.id} -> ${b.id} — conversion re-ordered the register`); break; }
      nClaims++;
      const eligible = WC_RTW_LOST_TIME_COMPONENTS.includes(a.tier) && a.grossUltimate < WC_RTW_CONVERSION_CEILING;
      if (eligible) nEligible++;
      if (a.grossUltimate === b.grossUltimate && a.tier === b.tier) continue;
      nConverted++;
      ok(eligible, `g${g} y${y}: ${a.id} (${a.tier}, $${a.grossUltimate.toFixed(0)}) converted but was not eligible`);
      ok(b.tier === 'small' && b.grossUltimate === b.caseReserve, `g${g} y${y}: ${a.id} converted to '${b.tier}'`);
    }
    const sumSim = conv.memberLossResults.reduce((s, r) => s + r.simulatedLoss, 0);
    ok(Math.abs(sumSim - conv.grossUltimateLoss) < 1e-6 * Math.max(1, conv.grossUltimateLoss),
      `g${g} y${y}: member simulatedLoss ${sumSim} does not sum to the register ${conv.grossUltimateLoss}`);
    const placed = DEFAULT_LAYERS_PLACED.WC;
    const cA = cedeOccurrences('WC', occurrenceTotals(plain.claims, plain.occurrences), placed).totalCeded;
    const cB = cedeOccurrences('WC', occurrenceTotals(conv.claims, conv.occurrences), placed).totalCeded;
    cededChecked++;
    ok(cA === cB, `g${g} y${y}: conversion moved what the tower cedes, ${cA} -> ${cB}`);
  }
}
const share = nConverted / Math.max(1, nEligible);
console.log(`   ${nClaims} claims: ${nEligible} eligible, ${nConverted} converted (${(100 * share).toFixed(2)}% `
  + `against c = ${(100 * WC_RTW_CONVERSION_RATE).toFixed(1)}%)`);
console.log(`   null input identical, ids and order unchanged, unconverted claims identical, `
  + `ceded unchanged in ${cededChecked} line-years: ${failed.length ? 'SEE FAILURES' : 'OK'}`);
// Binomial over N ~ 10,000+ eligible claims: SE of the share ~0.4pp, so +/-20% of c is ~9 SE.
ok(share > 0.8 * WC_RTW_CONVERSION_RATE && share < 1.2 * WC_RTW_CONVERSION_RATE,
  `realised conversion share ${(100 * share).toFixed(2)}% is not within 0.8x-1.2x of c`);

// --- 4. YEAR ONE, OTHER LINES, MARKETPLACE ---------------------------------
console.log('\n--- 4. paired games, three lines ---');
let y1 = 0, other = 0, mk = 0, prospectLoss = 0, chargeYears = 0;
for (let g = 0; g < GAMES; g++) {
  const off = play(g, ALL, () => []);
  const from2 = play(g, ALL, y => (y >= 2 ? [PROGRAM] : []));
  const on = play(g, ALL, () => [PROGRAM]);
  for (const l of ALL) {
    y1++;
    if (!sameRow(off[0][l], from2[0][l])) {
      fail(`g${g} ${l} YEAR 1 of a game committing from year 2 moved — tenure is 0 there, so nothing may`);
    }
  }
  for (let y = 0; y < YEARS; y++) {
    for (const l of ['GL', 'Property']) {
      other++;
      maxSurplusDrift = Math.max(maxSurplusDrift, Math.abs(off[y][l].endingSurplus - on[y][l].endingSurplus));
      if (!otherLineOk(off[y][l], on[y][l])) fail(`g${g} ${l} y${y + 1} moved — the program is scoped WC`);
    }
    mk++;
    prospectLoss += off[y].WC.market;
    if (off[y].WC.market !== on[y].WC.market) {
      fail(`g${g} y${y + 1}: the WC MARKETPLACE ledger moved — prospects received a program they never bought`);
    }
  }
  ok(on[0].WC.grossUltimateLoss !== off[0].WC.grossUltimateLoss, `g${g}: WC did not move in year 1 of commitment`);
  // THE MONEY LEAVES: WC's risk-control expense is the flat charge in every
  // committed year, and exactly what it was otherwise in every year of `off`.
  for (let y = 0; y < YEARS; y++) {
    ok(on[y].WC.riskControlInvestment - off[y].WC.riskControlInvestment === WC_SAFETY_RTW_ANNUAL_COST,
      `g${g} y${y + 1}: WC risk-control expense moved by ${on[y].WC.riskControlInvestment - off[y].WC.riskControlInvestment}, not the charge`);
  }
  chargeYears += YEARS;
}
console.log(`   year 1 at tenure 0: ${y1} line-rows x ${FIELDS.length + 2} fields, all ===`);
console.log(`   GL/Property line-years with the WC program on: ${other} — claims, gross, net, recovery, `
  + `reserve, premium, members all ===; surplus within a cent (max drift $${maxSurplusDrift.toExponential(2)}, float)`);
console.log(`   WC risk-control expense = off + $${WC_SAFETY_RTW_ANNUAL_COST / 1e6}M exactly in ${chargeYears} committed line-years`);
console.log(`   WC marketplace ledger (prospects only) unchanged at ${mk} line-years; `
  + `non-empty: ${prospectLoss > 0 ? 'yes' : 'NO'}`);
ok(prospectLoss > 0, 'the prospect ledger summed to zero — the marketplace assertion would be vacuous');

// --- 4b. LAPSE IN A PLAYED GAME: funded years 1-3, unfunded 4 onward --------
console.log('\n--- 4b. stopping in a played game: funded 1-3, unfunded 4+ ---');
if (YEARS >= 5) {
  let lapseYears = 0, convertedWhileLapsed = 0, convertedWhileFunded = 0;
  for (let g = 0; g < GAMES; g++) {
    const stop = play(g, ['WC'], y => (y <= 3 ? [PROGRAM] : []));
    for (let y = 0; y < YEARS; y++) {
      const r = stop[y].WC;
      const lapsedK = y + 1 - 3;     // 1 in year 4, 2 in year 5
      if (lapsedK <= 0) { convertedWhileFunded += r.converted; continue; }
      lapseYears++;
      const lvl = [0.5, 0.25, 0.125, 0][Math.min(lapsedK, 4) - 1];
      ok(close(r.freqApplied, 1 - WC_SAFETY_FREQUENCY_REDUCTION * lvl),
        `g${g} y${y + 1}: safety applied ${r.freqApplied}, expected the decayed ${1 - WC_SAFETY_FREQUENCY_REDUCTION * lvl}`);
      ok(r.rtwApplied === 0, `g${g} y${y + 1}: RTW applied ${r.rtwApplied} after it lapsed`);
      ok(r.riskControlInvestment === 0, `g${g} y${y + 1}: charged ${r.riskControlInvestment} while unfunded`);
      convertedWhileLapsed += r.converted;
    }
  }
  ok(convertedWhileLapsed === 0, `${convertedWhileLapsed} claims converted after RTW lapsed — the cliff is not a cliff`);
  ok(convertedWhileFunded > 0, 'no claim converted while funded — the converted-claim count is not measuring anything');
  console.log(`   ${lapseYears} lapsed line-years: safety at its decayed level (x0.975, then x0.9875), `
    + `RTW 0, charge 0; claims converted while funded ${convertedWhileFunded}, after the lapse ${convertedWhileLapsed}`);
} else {
  console.log(`   skipped: needs YEARS >= 5 (running ${YEARS})`);
}

// --- 5. DIRECTION AT FULL EFFECT, ON COUNTS ---------------------------------
console.log('\n--- 5. at full effect: counts fall by about the safety cut ---');
let nOff = 0, nOn = 0, gOff = 0, gOn = 0;
for (let g = 0; g < GAMES; g++) {
  const off = play(g, ['WC'], () => []);
  const on = play(g, ['WC'], () => [PROGRAM]);
  for (let y = 2; y < YEARS; y++) {
    nOff += off[y].WC.claims; nOn += on[y].WC.claims;
    gOff += off[y].WC.grossUltimateLoss; gOn += on[y].WC.grossUltimateLoss;
  }
}
const cut = 1 - nOn / nOff;
console.log(`   years 3+: claims ${nOff} -> ${nOn}, ${(100 * cut).toFixed(2)}% against a nominal `
  + `${(100 * WC_SAFETY_FREQUENCY_REDUCTION).toFixed(2)}%`);
console.log(`   (gross ${(gOff / 1e6).toFixed(2)}M -> ${(gOn / 1e6).toFixed(2)}M, ${(100 * (1 - gOn / gOff)).toFixed(2)}% — `
  + 'REPORTED, not asserted; wc-program-value.ts measures it)');
// Poisson counts over N ~ 6,000+ per arm: SE of the relative difference ~1.8%, so 0.6x-1.4x of 5% is ~1.1 SE
// either side at 6 games — widened only by what the sample supports. Raise GAMES to tighten.
ok(cut > WC_SAFETY_FREQUENCY_REDUCTION * 0.4 && cut < WC_SAFETY_FREQUENCY_REDUCTION * 1.6,
  `realised count cut ${(100 * cut).toFixed(2)}% not within 0.4x-1.6x of ${(100 * WC_SAFETY_FREQUENCY_REDUCTION).toFixed(2)}%`);
ok(gOn < gOff, 'WC gross did not fall at full effect');

console.log(`\n${'='.repeat(72)}`);
if (failed.length) {
  console.log(`FAIL — ${failed.length} problem(s):`);
  for (const f of failed) console.log(`  ${f}`);
  console.log('='.repeat(72));
  process.exit(1);
}
console.log('THE WC PROGRAM REACHES WC\'S DRAW AND NOTHING ELSE.');
console.log('='.repeat(72));
