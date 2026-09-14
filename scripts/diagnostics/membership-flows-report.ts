// ============================================================================
// THE TWO MEMBERSHIP FLOWS, AND WHERE THEY CROSS — A PROBE. Measures and
// prints; asserts nothing and always exits 0.
//
//   npx tsx scripts/diagnostics/membership-flows-report.ts
//   GAMES=10 YEARS=20 npx tsx scripts/diagnostics/membership-flows-report.ts
//
// ⚠ THIS REPLACES membership-equilibrium-report, WHOSE SUBJECT WAS DELETED.
// That file printed the trajectory of a book steered toward
// MEMBERSHIP_EQUILIBRIUM_ENROLLMENT and the k solved to hold it there. There is
// no k and no target. Printing them would be printing a constant that no longer
// exists, which is worse than printing nothing.
//
// ============================================================================
// WHAT IT ASKS INSTEAD, AND WHY IT IS THE DISCRIMINATOR RATHER THAN A READING.
//
// Intake is now a share of the UNENROLLED marketplace, so it FALLS as the book
// grows. Departures are proportional to the book, so they RISE with it. Two
// opposed flows in one variable cross exactly once:
//
//     APPLICATION_RATE x acceptance x (roster - N)  =  N x (1 - retention)
//
// ⚠ A PLATEAU IS THEREFORE EXPECTED, AND THE QUESTION IS WHERE IT SITS. That is
// the whole test. A book settling at the crossing is two independent rates
// meeting — an outcome. A book settling near 63 would mean something is still
// steering it, because 63 was the deleted target and nothing in the new model
// knows that number. The two look identical on a trajectory chart and are
// completely different mechanisms.
//
// So this reports the crossing MEASURED from the engine's own flows, against
// the crossing PREDICTED by the arithmetic above, and the gap between them is
// the reading. A large gap means something else is acting on the book.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { NEW_BUSINESS_TIERS } from '../../src/utils/newBusinessAppetite';
import {
  APPLICATION_RATE, MAX_NEW_MEMBER_SHARE, BASE_RETENTION,
} from '../../src/data/defaultAssumptions';
import { MARKET_MEMBER_COUNT } from '../../src/data/memberCatalog';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(92);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RATED: CoverageLine[] = ['WC', 'GL'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 20);
const ARMS: (number | null)[] = [null, ...NEW_BUSINESS_TIERS];

interface Row {
  line: string; game: number; year: number;
  bookBefore: number; bookAfter: number;
  joined: number; withdrew: number; applicants: number; eligible: number; room: number;
}

function play(appetite: number | null): Row[] {
  const rows: Row[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `FLOW${g}`;
    const instance = generateGameInstance(id, 97_000_000 + g * 3571);
    const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y) as DecisionSet;
      for (const l of LINES) d.byLine[l].newBusinessAppetite = appetite;
      const before: Record<string, number> = {};
      for (const l of LINES) before[l] = gs.poolState.lines[l].members.length;
      const p = processYear(gs, d);
      for (const lr of p.lineResults) {
        const l = lr.line as string;
        const x = lr.result as never as Record<string, number>;
        rows.push({
          line: l, game: g, year: y,
          bookBefore: before[l],
          bookAfter: p.updatedPoolState.lines[l as CoverageLine].members.length,
          joined: x.newMembers, withdrew: x.withdrawnMembers,
          applicants: x.applicants ?? 0, eligible: x.eligibleApplicants ?? 0,
          room: x.intakeRoom ?? 0,
        });
      }
      gs = {
        ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState,
        lockedResults: [...gs.lockedResults, p.result],
      };
    }
  }
  return rows;
}

const mean = (v: readonly number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

console.log(RULE);
console.log(`MEMBERSHIP FLOWS — ${GAMES} games x ${YEARS} years, all other decisions at default`);
console.log(RULE);
console.log(`roster ${MARKET_MEMBER_COUNT}, application rate ${(100 * APPLICATION_RATE).toFixed(0)}%, `
  + `capacity guard ${(100 * MAX_NEW_MEMBER_SHARE).toFixed(0)}% of book, base retention ${BASE_RETENTION}`);
console.log('NO TARGET, NO INTAKE COUNT CAP, NO WITHDRAWAL CAP.\n');

for (const a of ARMS) {
  const label = a === null ? 'Accept All' : `below ${a.toFixed(2)}`;
  const rows = play(a);
  console.log(`--- ${label} ---`);

  // Flows as a function of book size, bucketed. This is the crossing, measured.
  console.log('  book size   n     joins/yr   departs/yr   net/yr   applicants   eligible   room');
  const buckets: [number, number][] = [[0, 50], [50, 65], [65, 80], [80, 100], [100, 130], [130, 200]];
  for (const [lo, hi] of buckets) {
    const rr = rows.filter(r => RATED.includes(r.line as CoverageLine)
      && r.bookBefore >= lo && r.bookBefore < hi);
    if (rr.length < 5) continue;
    const j = mean(rr.map(r => r.joined)), w = mean(rr.map(r => r.withdrew));
    console.log(
      `  ${`${lo}-${hi}`.padEnd(11)}${String(rr.length).padStart(4)}`
      + `${j.toFixed(2).padStart(11)}${w.toFixed(2).padStart(13)}${(j - w).toFixed(2).padStart(9)}`
      + `${mean(rr.map(r => r.applicants)).toFixed(1).padStart(13)}`
      + `${mean(rr.map(r => r.eligible)).toFixed(1).padStart(11)}`
      + `${mean(rr.map(r => r.room)).toFixed(1).padStart(7)}`,
    );
  }

  // Where net movement changes sign — the measured crossing.
  const signChange = (() => {
    const pts: { n: number; net: number }[] = [];
    for (let n = 30; n <= 190; n += 5) {
      const rr = rows.filter(r => RATED.includes(r.line as CoverageLine)
        && r.bookBefore >= n - 2.5 && r.bookBefore < n + 2.5);
      if (rr.length >= 8) pts.push({ n, net: mean(rr.map(r => r.joined - r.withdrew)) });
    }
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].net > 0 && pts[i].net <= 0) {
        const t = pts[i - 1].net / (pts[i - 1].net - pts[i].net);
        return pts[i - 1].n + t * (pts[i].n - pts[i - 1].n);
      }
    }
    return NaN;
  })();

  const acceptance = (() => {
    const rr = rows.filter(r => RATED.includes(r.line as CoverageLine) && r.applicants > 0);
    return rr.length ? mean(rr.map(r => r.eligible / r.applicants)) : NaN;
  })();
  // Solve rate x acceptance x (roster - N) = N x (1 - retention) for N.
  const dep = 1 - BASE_RETENTION;
  const predicted = (APPLICATION_RATE * acceptance * MARKET_MEMBER_COUNT)
    / (APPLICATION_RATE * acceptance + dep);

  const finals: number[] = [];
  for (const l of RATED) {
    for (let g = 0; g < GAMES; g++) {
      const gr = rows.filter(r => r.line === l && r.game === g);
      if (gr.length) finals.push(gr[gr.length - 1].bookAfter);
    }
  }
  console.log(`  measured acceptance ${(100 * acceptance).toFixed(0)}%   `
    + `predicted crossing ${predicted.toFixed(0)}   `
    + `measured crossing ${Number.isFinite(signChange) ? signChange.toFixed(0) : 'not reached in range'}   `
    + `book at year ${YEARS}: ${mean(finals).toFixed(1)}`);
  console.log('');
}

console.log(RULE);
console.log('READ IT AS: a plateau at the crossing is two flows meeting. A plateau near 63 would be');
console.log('the deleted target still acting. The gap between predicted and measured is the reading.');
console.log(RULE);
