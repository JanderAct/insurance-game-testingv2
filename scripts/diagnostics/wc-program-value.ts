// ============================================================================
// WHAT THE WC SAFETY & RETURN-TO-WORK PROGRAM IS WORTH — a READING, not a gate.
//
//   GAMES=96 YEARS=5 npx tsx scripts/diagnostics/wc-program-value.ts
//
// TWO PARTS.
//
// 1. EACH LEVER ALONE, AT FULL EFFECT, ON THE BOOK THE GAME ACTUALLY ENROLLED.
//    Every played WC year of the unprogrammed arm is redrawn through
//    claimRegeneration with ONE lever overridden on a copy of its result — the
//    same roster, k_line, seed and shock the engine used — so the difference is
//    that lever and nothing else. This is where WC_RTW_CONVERSION_RATE is
//    solved against WC_RTW_TARGET_REDUCTION, and where the tower's share of the
//    RTW saving is read (it should be exactly zero: see the $1M ceiling).
//
// 2. THE PROGRAM AS COMMITTED — both levers, both ramps — PAIRED ON SEEDS over a
//    five-year WC game, program committed every year against never.
//
// ⚠ ON THE ULTIMATE BASIS, NOT netUltimateLoss. "Pool keeps" is the drawn
//   register minus what the tower cedes on the DRAWN occurrences. netUltimateLoss
//   is booked gross minus the recovery booked at inception; under forward booking
//   the tower attaches to the booked occurrence, and comparing that against drawn
//   gross roughly doubles the apparent tower share.
//
// ⚠ THE WC COST IS NOT CHARGED. programAnnualCost is 0 for WC (only GL's program
//   has a cost shape in the engine), so
//   every figure is GROSS OF COST and the $1,000,000/yr placeholder comparison is
//   arithmetic done here. The spend is the next commit.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
import { cedeOccurrences, occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { DEFAULT_LAYERS_PLACED } from '../../src/data/reinsuranceTower';
import { RISK_CONTROL_PLACEHOLDER_ANNUAL_COST } from '../../src/data/riskControlCategories';
import {
  WC_RTW_CONVERSION_CEILING, WC_RTW_CONVERSION_RATE, WC_RTW_RAMP, WC_RTW_TARGET_REDUCTION,
  WC_SAFETY_FREQUENCY_REDUCTION, WC_SAFETY_RAMP,
} from '../../src/utils/riskControlPrograms';
import type { Claim, GameInstance, GameState, Occurrence, ResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 24);
const YEARS = Number(process.env.YEARS ?? 5);
const PROGRAM = 'wc-safety-rtw';
const M = 1e6;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const ceded = (claims: Claim[], occ: Occurrence[]) =>
  cedeOccurrences('WC', occurrenceTotals(claims, occ), DEFAULT_LAYERS_PLACED.WC).totalCeded;

interface Row { gross: number; keep: number; prem: number; lr: number; res: number; sur: number }

function play(on: boolean) {
  const games: { inst: GameInstance; results: ResultSet[]; rows: Row[] }[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `WPV${g}`;
    const inst = generateGameInstance(id, 4_400_000 + g * 6379);
    const setup = { poolName: 'V', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: ['WC'] };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const results: ResultSet[] = [], rows: Row[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, { ...defaultDecisionSet(y), riskControlProgramIds: on ? [PROGRAM] : [] });
      const r = p.result.byLine.WC!;
      if ((r.aggregateRecovery ?? 0) !== 0) throw new Error('the aggregate fired; the ultimate basis would need it');
      const gross = r.grossUltimateLoss;
      rows.push({ gross, keep: gross - ceded(r.claims ?? [], r.occurrences ?? []), prem: r.poolPremium,
        lr: r.actualLossRatio, res: r.endingNetReserve, sur: r.endingSurplus });
      results.push(p.result);
      gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS };
    }
    games.push({ inst, results, rows });
  }
  return games;
}

console.log('='.repeat(78));
console.log('WC SAFETY & RETURN-TO-WORK PROGRAM — WHAT IT IS WORTH');
console.log('='.repeat(78));
console.log(`${GAMES} games x ${YEARS} years, WC solo. safety -${(100 * WC_SAFETY_FREQUENCY_REDUCTION).toFixed(0)}% `
  + `ramp [${WC_SAFETY_RAMP.join(', ')}]; RTW c = ${WC_RTW_CONVERSION_RATE} under $${WC_RTW_CONVERSION_CEILING / M}M `
  + `ramp [${WC_RTW_RAMP.join(', ')}]\n`);

const off = play(false);

// --- 1. each lever alone, full effect, redrawn on the enrolled book ---------
console.log('--- 1. EACH LEVER ALONE, FULL EFFECT, on the enrolled book (all played years) ---');
const lever = (name: string, override: (lr: Record<string, unknown>) => void) => {
  let g0 = 0, g1 = 0, c0 = 0, c1 = 0, n0 = 0, n1 = 0;
  for (const { inst, results } of off) {
    for (const res of results) {
      const base = regenerateLineYearClaims(inst, res, 'WC');
      const copy = { ...res, byLine: { ...res.byLine, WC: { ...res.byLine.WC! } } } as ResultSet;
      override(copy.byLine.WC as unknown as Record<string, unknown>);
      const alt = regenerateLineYearClaims(inst, copy, 'WC');
      g0 += base.grossUltimateLoss; g1 += alt.grossUltimateLoss;
      c0 += ceded(base.claims, base.occurrences); c1 += ceded(alt.claims, alt.occurrences);
      n0 += base.claims.length; n1 += alt.claims.length;
    }
  }
  const dG = g0 - g1, dC = c0 - c1;
  console.log(`  ${name.padEnd(30)} gross -${(100 * dG / g0).toFixed(2)}%   claims ${n0} -> ${n1}   `
    + `tower share of the saving ${(100 * dC / dG).toFixed(2)}%   pool keeps ${(100 * (dG - dC) / dG).toFixed(2)}%`);
  return dG / g0;
};
lever(`safety x${1 - WC_SAFETY_FREQUENCY_REDUCTION}`, lr => { lr.programFreqApplied = 1 - WC_SAFETY_FREQUENCY_REDUCTION; });
const rtwCut = lever(`RTW conversion c = ${WC_RTW_CONVERSION_RATE}`, lr => { lr.programRtwApplied = WC_RTW_CONVERSION_RATE; });
console.log(`  target ${(100 * WC_RTW_TARGET_REDUCTION).toFixed(1)}%: the rate that hits it here is `
  + `c = ${(WC_RTW_CONVERSION_RATE * WC_RTW_TARGET_REDUCTION / rtwCut).toFixed(4)} (linear in c)`);
console.log('  both levers at full effect:');
lever('safety + RTW', lr => { lr.programFreqApplied = 1 - WC_SAFETY_FREQUENCY_REDUCTION; lr.programRtwApplied = WC_RTW_CONVERSION_RATE; });

// --- 2. the program as committed, paired ------------------------------------
const on = play(true);
console.log('\n--- 2. THE PROGRAM AS COMMITTED, both ramps, paired on seeds ($M, ON minus OFF) ---');
console.log('  yr   gross avoided   pool keeps   tower%   premium back   loss ratio   reserve    surplus');
const tot = { g: 0, k: 0, p: 0 };
for (let y = 0; y < YEARS; y++) {
  const d = (f: (r: Row) => number) => mean(on.map((g, i) => f(g.rows[y]) - f(off[i].rows[y])));
  const dG = -d(r => r.gross), dK = -d(r => r.keep), dP = -d(r => r.prem);
  tot.g += dG; tot.k += dK; tot.p += dP;
  console.log(`  ${y + 1}    ${(dG / M).toFixed(3).padStart(8)}      ${(dK / M).toFixed(3).padStart(7)}    `
    + `${(100 * (1 - dK / dG)).toFixed(1).padStart(5)}    ${(dP / M).toFixed(3).padStart(8)}      `
    + `${(100 * d(r => r.lr)).toFixed(2).padStart(6)}pp  ${(d(r => r.res) / M).toFixed(3).padStart(7)}  ${(d(r => r.sur) / M).toFixed(3).padStart(8)}`);
}
const dSur = on.map((g, i) => g.rows[YEARS - 1].sur - off[i].rows[YEARS - 1].sur);
const se = sd(dSur) / Math.sqrt(dSur.length);
const cost = YEARS * RISK_CONTROL_PLACEHOLDER_ANNUAL_COST;
console.log(`\n  FIVE-YEAR TOTALS (${YEARS} yrs)`);
console.log(`    gross avoided                 $${(tot.g / M).toFixed(2)}M`);
console.log(`    pool keeps (ultimate basis)   $${(tot.k / M).toFixed(2)}M   tower ${(100 * (1 - tot.k / tot.g)).toFixed(1)}%`);
console.log(`    back to members as premium    $${(tot.p / M).toFixed(2)}M   (${(100 * tot.p / tot.k).toFixed(0)}% of what the pool keeps)`);
console.log(`    year-${YEARS} surplus               +$${(mean(dSur) / M).toFixed(2)}M   SE $${(se / M).toFixed(2)}M, t = ${(mean(dSur) / se).toFixed(1)}`);
console.log(`    placeholder cost, NOT CHARGED $${(cost / M).toFixed(2)}M`);
console.log(`    keep / cost ${(tot.k / cost).toFixed(2)}x    year-${YEARS} surplus / cost ${(mean(dSur) / cost).toFixed(2)}x    `
  + `surplus net of cost ${((mean(dSur) - cost) / M).toFixed(2)}M`);
console.log('\nREADING ONLY — no pass condition.');
