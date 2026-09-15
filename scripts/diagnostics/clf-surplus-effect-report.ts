// WHAT RE-DERIVING THE CLF TABLE DOES TO THE GAME.
//
// A report, not a gate. Run it, commit the table, run it again, diff the two.
// It cannot hold both tables in one process — STATIC_CLF_TABLE is a module
// constant and putting a test seam into it to make this script easier would put
// a seam into the pricing path, which is the wrong trade.
//
// ============================================================================
// ⚠ THE TABLE REACHES SURPLUS THROUGH TWO CHANNELS THAT PULL OPPOSITE WAYS, and
// the obvious one is not the one that fires at defaults.
//
//   PRICING. simulationEngine.ts:580. Only when the player moves the funding
//   slider off Expected: at fundingAtExpected the CLF is pinned to 1.000 and the
//   table is not consulted at all. A re-derivation that lowers the curve lowers
//   premium at a given stop, so it lowers surplus and lowers float. HARDER.
//
//   RESERVE RISK MARGIN. simulationEngine.ts:1870, staticClf(line, 0.90), read on
//   EVERY run whatever the player decides. The margin is expectedNetUnpaidLoss x
//   (reserveMarginCLF - 1).
//
// ⚠ AND THE SECOND CHANNEL DOES NOT REACH SURPLUS AT ALL, WHICH THIS SCRIPT GOT
// WRONG BEFORE IT WAS RUN. The header here said a lower 90th stop "holds a
// smaller margin and REPORTS a larger surplus. EASIER." It does not.
// reserveRiskMarginNeeded is a DISCLOSURE figure: it feeds capitalFundingGap and
// excessAvailableSurplus, both of which are reported, and endingSurplus is
// computed independently of all three (availableSurplus = endingSurplus, not the
// other way round). Measured, the EXPECTED arm came back byte-identical across a
// re-derivation that moved WC's 90th stop 1.3294 -> 1.2776 and Property's
// 1.5923 -> 1.4247: same mean, same p10, same median, same p90, same premium to
// the dollar.
//
// So the reserve channel moves what the pool REPORTS about its own adequacy and
// nothing about what it has. That is worth measuring rather than dropping —
// reserveRiskMarginNeeded is a captured field, so the value-identity baseline
// moves on it even though the game does not — but it is not a difficulty
// channel, and the arm below is printed to show exactly that.
//
// TWO ARMS, therefore:
//   EXPECTED   every line at fundingAtExpected — pricing channel off entirely
//   AT 75%     every line pinned to the 75% funding stop — both channels
//
// 75% is not arbitrary: it is inside every line's table range (GL_SUPPLIED stops
// at 25-95) and it is above every line's crossing, so it is a stop at which a
// player is deliberately funding for margin and the pricing channel is carrying
// real weight.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { staticClf } from '../../src/data/clfTables';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 150);
const YEARS = Number(process.env.YEARS ?? 10);
const STOP = 0.75;

const q = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const usd = (x: number) => (x >= 0 ? ' ' : '-') + `$${(Math.abs(x) / 1e6).toFixed(3)}M`;

interface Game { surplus: number; premium: number; loss: number; members: number; insolvent: boolean; margin: number }

function play(atExpected: boolean): Game[] {
  const out: Game[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `CLFS${g}`;
    const instance = generateGameInstance(id, 4_100_000 + g * 6971);
    const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    let premium = 0; let loss = 0; let members = 0; let insolvent = false; let surplus = 0; let margin = 0;
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y);
      if (!atExpected) {
        for (const line of LINES) {
          d.byLine[line].fundingAtExpected = false;
          d.byLine[line].fundingConfidenceLevel = STOP;
        }
      }
      const p = processYear(gs, d);
      const r = p.result as never as {
        endingSurplus: number;
        byLine: Record<string, Record<string, number>>;
      };
      for (const line of LINES) {
        const lr = r.byLine[line];
        if (!lr) continue;
        premium += lr.poolPremium;
        loss += lr.netIncurredLoss;
        if (y === YEARS) { members += lr.activeMembers; margin += lr.reserveRiskMarginNeeded; }
      }
      surplus = r.endingSurplus;
      if (surplus < 0) insolvent = true;
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    out.push({ surplus, premium, loss, members, insolvent, margin });
  }
  return out;
}

function report(name: string, gs: Game[]) {
  const s = gs.map(x => x.surplus).sort((a, b) => a - b);
  console.log(`  ${name.padEnd(10)} ending surplus  mean ${usd(mean(s))}   `
    + `p10 ${usd(q(s, 0.1))}   median ${usd(q(s, 0.5))}   p90 ${usd(q(s, 0.9))}`);
  console.log(`  ${''.padEnd(10)} cumulative      premium ${usd(mean(gs.map(x => x.premium)))}   `
    + `net incurred ${usd(mean(gs.map(x => x.loss)))}   `
    + `loss ratio ${(mean(gs.map(x => x.loss)) / mean(gs.map(x => x.premium))).toFixed(4)}`);
  console.log(`  ${''.padEnd(10)} ending book ${mean(gs.map(x => x.members)).toFixed(1)} enrolments   `
    + `games touching negative surplus ${gs.filter(x => x.insolvent).length}/${gs.length}`);
  // The reserve channel, which moves the DISCLOSURE and not the surplus beside it.
  console.log(`  ${''.padEnd(10)} final-year reserveRiskMarginNeeded ${usd(mean(gs.map(x => x.margin)))} `
    + `— a reported adequacy figure, not a charge against the surplus above`);
}

console.log(RULE);
console.log(`CLF SURPLUS EFFECT — ${GAMES} games x ${YEARS} years, full pool`);
console.log(RULE);
console.log('The table as it stands in this working tree:');
for (const line of LINES) {
  console.log(`  ${line.padEnd(9)} 90% stop (reserve margin) ${staticClf(line, 0.90).toFixed(4)}   `
    + `75% stop (pricing arm) ${staticClf(line, STOP).toFixed(4)}   `
    + `50% stop ${staticClf(line, 0.50).toFixed(4)}`);
}
console.log('');
console.log('EXPECTED — fundingAtExpected on every line. Pricing channel INERT (CLF pinned to');
console.log('1.000). This is the default game, and the table should not reach its surplus at all.');
report('EXPECTED', play(true));
console.log('');
console.log(`AT ${(100 * STOP).toFixed(0)}% — every line pinned to the ${(100 * STOP).toFixed(0)}% funding stop. BOTH channels live.`);
report(`AT ${(100 * STOP).toFixed(0)}%`, play(false));
console.log('');
console.log(RULE);
console.log('Diff this against the same script run on the other table. A report, not a gate:');
console.log('it has no pass condition, because "the game got harder" is a judgement and not a');
console.log('property of the code.');
console.log(RULE);
