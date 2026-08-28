// ============================================================================
// RESERVE COHORTS ARE A BOUNDED STOCK — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Ruling 8 keeps `ResultSet.claims` out of storage
// because a claim log is an UNBOUNDED FLOW, and it admits `reserveCohorts` as an
// exception on the grounds that a cohort inventory is a BOUNDED STOCK. That
// argument was true and nothing enforced it, so when the payout patterns landed
// it stopped being true without a single check going red: WC's unpaid share
// reaches the old flat $1,000 close floor at AGE 98, so cohorts accumulated one
// a year — 46 open by year 40 and still climbing, with poolState growing +7.4 KB
// a year forever.
//
// A claim about boundedness that nothing can falsify is not an argument, it is a
// hope. This is the falsifier.
//
// WHAT IT ASSERTS
//   PLATEAU    the open cohort count stops growing. Measured as year 60 against
//              year 40 — twenty years apart, so a stock that is still
//              accumulating one a year cannot pass by rounding.
//   MAX AGE    no cohort survives past a stated per-line bound. The count can
//              plateau for the wrong reason (a line that stopped writing), so
//              the age is asserted separately and is the direct statement.
//   DECELERATION  the serialised poolState grows materially LESS over years
//              40-60 than over 20-40. That is the quantity Ruling 8 is actually
//              about, and it is asserted as deceleration rather than as a flat
//              line for a measured reason: two OTHER stocks in poolState are
//              still growing, neither of them cohort closure's doing, and a
//              threshold picked to accommodate a known defect means nothing.
//              Linear accumulation — one cohort a year forever — grows by the
//              same amount in both windows and fails this; a saturating stock
//              does not.
//
// ⚠ THE TWO RESIDUAL GROWERS, NAMED SO THEY ARE NOT REDISCOVERED HERE. Measured
// over 3 games x 60 years, poolState by part in KB:
//
//   year   total   allMarketMembers   reserveCohorts   line members   other
//     10   421.8               67.7             95.6           62.6   195.9
//     20   488.6               68.4            138.3           65.2   216.8
//     40   601.2               69.1            211.1           64.8   256.2
//     60   668.9               69.4            239.9           64.9   294.7
//
//   1. reserveCohorts keeps growing after the COUNT plateaus, because the
//      TRACKED SET per cohort grows: buildTrackedSet keeps every occurrence at
//      or above the retention, the retention is a fixed nominal $1M, and
//      severity TRENDS. Measured on the year's own new cohorts, tracked
//      occurrences go 32.0 at year 5 to 52.0 at year 60 while the number of
//      occurrences DRAWN falls from 894 to 525 — so it is the threshold moving
//      in real terms, not the book growing. Bounded in principle (the share
//      above a fixed threshold saturates at 100%) and not bounded in practice
//      within any horizon anyone would run.
//   2. `other` — everything on LinePoolState that is neither the cohorts nor the
//      member lists — grows from 195.9 to 294.7 KB and is NOT yet attributed.
//
//   Neither is cohort closure's doing and neither is fixed here.
//
// ⚠ IT RUNS 60 YEARS BECAUSE A PLATEAU CANNOT BE SEEN IN 10. Every other guard
// in this directory runs 10 to 25 years, which is why none of them saw this. The
// game is played at 10; the INVARIANT is about the mechanism, not the game
// length, and a mechanism that only stays bounded for as long as anyone looks is
// the failure being guarded against.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { COHORT_CLOSE_SHARE, unpaidShare } from '../../src/utils/payoutPattern';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 4);
const YEARS = Number(process.env.YEARS ?? 60);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

// ⚠ THE AGE BOUND IS DERIVED FROM THE PATTERN, NOT TYPED IN. The age at which a
// line's unpaid share crosses COHORT_CLOSE_SHARE is what the close rule promises;
// asserting a hand-written number would let the two drift and would need
// re-tuning every time a parameter moves — the exact property the share-based
// rule was adopted to remove.
//
// The allowance on top is for DEVELOPMENT: a cohort that deteriorated late sits
// above its pattern share for a few years before paying back down, so the
// realised close age runs past the analytic one. It is a factor rather than a
// constant so it scales with the line's own tail.
const AGE_SLACK = 1.6;
function analyticCloseAge(line: CoverageLine): number {
  let t = 1;
  while (t < 800 && unpaidShare(LINE_PAYOUT_PATTERN[line], t) >= COHORT_CLOSE_SHARE) t++;
  return t;
}
const PLATEAU_TOLERANCE = 0.10;   // year 60 may exceed year 40 by no more than this
// Growth over years 40-60 as a share of growth over 20-40. Linear accumulation
// scores 1.0; the measured value with the share-based close is 0.60.
const MAX_GROWTH_RATIO = 0.75;

const fails: string[] = [];
const fail = (s: string) => fails.push(s);

interface Snap { count: number; maxAge: number }
const at40: Record<string, Snap[]> = {};
const at60: Record<string, Snap[]> = {};
for (const l of LINES) { at40[l] = []; at60[l] = []; }
const kb20: number[] = [];
const kb40: number[] = [];
const kb60: number[] = [];
const worstAge: Record<string, number> = {};
for (const l of LINES) worstAge[l] = 0;

for (let g = 0; g < GAMES; g++) {
  const id = `STOCK${g}`;
  const inst = generateGameInstance(id, 4_400_000 + g * 6367);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const st = p.updatedPoolState;
    if (y === 20) kb20.push(JSON.stringify(st).length / 1024);
    if (y === 40 || y === YEARS) {
      const into = y === 40 ? at40 : at60;
      for (const l of LINES) {
        const cs = st.lines[l].reserveCohorts;
        const maxAge = cs.length ? Math.max(...cs.map(c => c.age)) : 0;
        into[l].push({ count: cs.length, maxAge });
        worstAge[l] = Math.max(worstAge[l], maxAge);
      }
      (y === 40 ? kb40 : kb60).push(JSON.stringify(st).length / 1024);
    }
    // ⚠ lockedResults IS NOT ACCUMULATED HERE. It is in-memory-only under Ruling
    // 8 and holding 60 years of it would measure this harness rather than the
    // save. poolState is what persists and is the only thing sized.
    gs = { ...gs, poolState: st, currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

console.log('=== RESERVE COHORTS ARE A BOUNDED STOCK ===');
console.log(`${GAMES} games x ${YEARS} years. Close share ${(COHORT_CLOSE_SHARE * 100).toFixed(1)}% of each cohort's own ultimate.\n`);

console.log('--- PLATEAU: open cohorts at year 40 vs year 60 ---');
console.log('  line       yr40    yr60    growth   analytic close age   worst age seen   bound');
for (const l of LINES) {
  const c40 = mean(at40[l].map(s => s.count));
  const c60 = mean(at60[l].map(s => s.count));
  const growth = c40 > 0 ? c60 / c40 - 1 : 0;
  const analytic = analyticCloseAge(l);
  const bound = Math.ceil(analytic * AGE_SLACK);
  const badGrowth = growth > PLATEAU_TOLERANCE;
  const badAge = worstAge[l] > bound;
  if (badGrowth) fail(`${l}: open cohorts grew ${(growth * 100).toFixed(1)}% between year 40 and year 60 `
    + `(${c40.toFixed(1)} -> ${c60.toFixed(1)}), limit ${(PLATEAU_TOLERANCE * 100).toFixed(0)}% — the stock is not bounded`);
  if (badAge) fail(`${l}: a cohort reached age ${worstAge[l]}, past the bound of ${bound} `
    + `(analytic close age ${analytic} x ${AGE_SLACK} for development) — the close rule is not terminating`);
  console.log(`  ${l.padEnd(10)} ${c40.toFixed(1).padStart(5)} ${c60.toFixed(1).padStart(7)} `
    + `${((growth * 100).toFixed(1) + '%').padStart(9)} ${String(analytic).padStart(20)} `
    + `${String(worstAge[l]).padStart(16)} ${String(bound).padStart(7)}  ${badGrowth || badAge ? 'FAIL' : 'ok'}`);
}

console.log('\n--- DECELERATION: poolState growth must be slowing, not linear ---');
{
  const a = mean(kb20);
  const b = mean(kb40);
  const c = mean(kb60);
  const first = b - a;
  const second = c - b;
  const ratio = first > 0 ? second / first : 0;
  const bad = ratio > MAX_GROWTH_RATIO;
  if (bad) fail(`poolState grew ${second.toFixed(1)} KB over years 40-60 against ${first.toFixed(1)} KB `
    + `over 20-40, a ratio of ${ratio.toFixed(2)} against a limit of ${MAX_GROWTH_RATIO} — that is `
    + `accumulation, not saturation. A stock gaining one cohort a year scores 1.0.`);
  console.log(`  yr20 ${a.toFixed(1)} KB   yr40 ${b.toFixed(1)} KB   yr60 ${c.toFixed(1)} KB`);
  console.log(`  growth  20-40 +${first.toFixed(1)} KB   40-60 +${second.toFixed(1)} KB   `
    + `ratio ${ratio.toFixed(2)} (limit ${MAX_GROWTH_RATIO})   ${bad ? 'FAIL' : 'ok'}`);
  console.log('  ⚠ the residual growth is the trending retention and the unattributed `other`,');
  console.log('    neither of them cohort closure\'s doing — see this file\'s header.');
}

console.log(fails.length === 0
  ? '\nTHE STOCK IS BOUNDED. Every line\'s cohort inventory plateaus, no cohort outlives the age its own'
    + '\npayout pattern implies, and the save\'s growth is decelerating rather than accumulating — so'
    + '\nRuling 8\'s exception for reserveCohorts rests on something that could have failed and did not.'
  : `\n${fails.length} FAILURE(S):\n` + fails.map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
