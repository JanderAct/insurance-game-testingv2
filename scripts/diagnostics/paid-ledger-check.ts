// ============================================================================
// THE PAID LEDGER — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/paid-ledger-check.ts
//
// ============================================================================
// THE ASSERTION THAT MATTERS: PER-CLAIM PAYMENTS ARE A SPLIT, NOT A SCHEDULE.
//
// Per-claim gross payments must sum to the cohort's own gross paydown TO THE
// CENT, at every valuation. That single equality is the whole of the paid
// ledger's cession-neutrality, and the reason is indirect enough to be worth
// stating where it is enforced rather than only where it is written.
//
// cedeDevelopment reads `c.current` and the deltas and nothing else, so a paid
// figure cannot reach the cession function directly. The danger is that the
// engine develops the RESERVE:
//
//     newUnpaid = (netUnpaid - paydown) x factor
//
// so the cohort's paydown TOTAL sets the base development multiplies. Pay more
// this year and the same factor moves fewer dollars; development shrinks and
// cession shrinks with it. Allocation is neutral ONLY because the payout pattern
// fixes that total before anything splits it.
//
// So a claim that drew its own payment schedule would change the total, move the
// development base, and reopen the free-lunch surface somewhere no cession gate
// is looking — development-sign-symmetry would not see it, because the routing
// would still be symmetric. This is the check that would.
//
// WHAT ELSE IT ASSERTS
//   PARALLEL      the gross ledger never feeds the net one. Asserted as the
//                 net rollforward still closing exactly: ultimate = paid +
//                 unpaid on the NET side, unchanged by the gross ledger's
//                 existence. value-identity carries the stronger version of this
//                 claim (0 fields moved); this states it locally so a future
//                 change that couples the two fails here too.
//   MONOTONE      cumulative gross paid never decreases. Paid is history.
//   BOUNDED       gross paid never exceeds the gross ledger ultimate, so the
//                 paid-to-incurred ratio the exhibit prints is always <= 1.
//   CONVERGENT    a CLOSED cohort has paid its ledger out entirely — ratio 1.
//                 Without this a closed year would print a ratio short of 100%
//                 forever, which reads as money still owed on a finished year.
//   SERIES        the ledger's paidByValuation matches the cohort's own NET
//                 paid at the valuation it was written for. The recording and
//                 the thing recorded cannot drift.
//   BASIS         and it is asserted against netPaid SPECIFICALLY, not against
//                 whichever paid figure is to hand. The ledger series is NET
//                 (it feeds the actuarial exhibit, a net document) while the
//                 cohort's own ledger is GROSS (it feeds the claims workbook, a
//                 gross document). Those two numbers differ by the whole tower,
//                 so a check written against the wrong one passes on a
//                 tower-less line and fails everywhere else — which is exactly
//                 what happened when this file was first written against
//                 grossPaid, and is why the assertion names its basis.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { claimPaidToDate, claimPaidWeight } from '../../src/utils/claimClosure';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { conditionalPaydown } from '../../src/utils/payoutPattern';
import type { CoverageLine, GameState, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 12);
const YEARS = Number(process.env.YEARS ?? 12);

// A cent. The split is a multiplication by weights that sum to 1 in float, so
// the residual is float noise on a figure that can run to $100M — nanodollars in
// practice. A cent is far above that and far below anything a mis-split could
// hide in.
const CENT = 0.01;

const fails: string[] = [];
const fail = (s: string) => { if (fails.length < 40) fails.push(s); };

let splits = 0;
let worstSplit = 0;
let rolls = 0;
let worstRoll = 0;
let closedSeen = 0;
let worstClosedRatio = 1;
let seriesChecked = 0;
let worstSeries = 0;
let monotoneChecked = 0;
let maxRatio = 0;

for (let g = 0; g < GAMES; g++) {
  const id = `PL${g}`;
  const inst = generateGameInstance(id, 5_900_000 + g * 6367);
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const prevPaid: Record<string, Map<number, number>> = {};
  for (const l of LINES) prevPaid[l] = new Map();

  for (let y = 1; y <= YEARS; y++) {
    const before: Record<string, Map<number, ReserveCohort>> = {};
    for (const l of LINES) {
      before[l] = new Map(((gs.poolState as never as {
        lines: Record<string, { reserveCohorts: ReserveCohort[] }>
      }).lines[l].reserveCohorts).map(c => [c.yearNumber, c]));
    }

    const p = processYear(gs, defaultDecisionSet(y));

    for (const l of LINES) {
      const ls = (p.updatedPoolState as never as {
        lines: Record<string, { reserveCohorts: ReserveCohort[]; reserveDevelopment?: {
          yearNumber: number; paidByValuation?: number[];
          firstValuationYear: number }[] }>
      }).lines[l];
      const claims = (p.result.byLine[l] as never as { claims?: { accidentYear: number; grossUltimate: number }[] }).claims ?? [];

      // The register for THIS year's accident year, which is the only one whose
      // claims are in hand at this valuation.
      const register = claims.reduce((s, c) => s + c.grossUltimate, 0);

      for (const c of ls.reserveCohorts) {
        const gp = c.grossPaid ?? 0;
        const gu = (c.grossPaid ?? 0) + (c.grossUnpaid ?? 0);

        // --- MONOTONE ------------------------------------------------------
        const was = prevPaid[l].get(c.yearNumber);
        if (was !== undefined) {
          monotoneChecked++;
          if (gp < was - CENT) {
            fail(`${l} AY${c.yearNumber} valuation ${y}: cumulative gross paid FELL, `
              + `${was.toFixed(2)} -> ${gp.toFixed(2)} — paid is history and cannot be revised`);
          }
        }
        prevPaid[l].set(c.yearNumber, gp);

        // --- BOUNDED -------------------------------------------------------
        if (gu > 0) {
          maxRatio = Math.max(maxRatio, gp / gu);
          if (gp > gu + CENT) {
            fail(`${l} AY${c.yearNumber} valuation ${y}: gross paid ${gp.toFixed(2)} exceeds gross `
              + `ledger ultimate ${gu.toFixed(2)} — the exhibit would print a paid-to-incurred over 100%`);
          }
        }

        // --- PARALLEL: the NET rollforward still closes exactly -------------
        rolls++;
        const rollErr = Math.abs(c.netUltimate - (c.netPaid + c.netUnpaid));
        worstRoll = Math.max(worstRoll, rollErr);
        if (rollErr > CENT) {
          fail(`${l} AY${c.yearNumber} valuation ${y}: NET ultimate ${c.netUltimate.toFixed(2)} != `
            + `paid + unpaid ${(c.netPaid + c.netUnpaid).toFixed(2)} — the gross ledger has coupled to the net path`);
        }

        // --- THE SPLIT, TO THE CENT ----------------------------------------
        // Only this year's own accident year has its register in hand.
        if (c.yearNumber === y && register > 0 && claims.length > 0) {
          splits++;
          const summed = claims
            .filter(cl => cl.accidentYear === y)
            .reduce((s, cl) => s + claimPaidToDate(gp, cl.grossUltimate, register), 0);
          const err = Math.abs(summed - gp);
          worstSplit = Math.max(worstSplit, err);
          if (err > CENT) {
            fail(`${l} AY${y}: per-claim gross payments sum to ${summed.toFixed(4)} against the cohort's `
              + `gross paid ${gp.toFixed(4)}, off by ${err.toFixed(4)} — a claim is not taking a pure `
              + `share of the paydown the pattern set`);
          }
          const wsum = claims.filter(cl => cl.accidentYear === y)
            .reduce((s, cl) => s + claimPaidWeight(cl.grossUltimate, register), 0);
          if (Math.abs(wsum - 1) > 1e-9) {
            fail(`${l} AY${y}: split weights sum to ${wsum} rather than 1`);
          }
        }

        // --- CONVERGENT ----------------------------------------------------
        if (c.closed && gu > 0) {
          closedSeen++;
          worstClosedRatio = Math.min(worstClosedRatio, gp / gu);
          if (gp < gu - CENT) {
            fail(`${l} AY${c.yearNumber} valuation ${y}: cohort is CLOSED with gross paid `
              + `${gp.toFixed(2)} against ledger ultimate ${gu.toFixed(2)} — a finished year would print `
              + `a paid-to-incurred short of 100% forever`);
          }
        }

        // --- SERIES: the recording matches the thing recorded ---------------
        const row = (ls.reserveDevelopment ?? []).find(r => r.yearNumber === c.yearNumber);
        const series = row?.paidByValuation;
        if (row && series && series.length > 0) {
          const idx = y - row.firstValuationYear;
          if (idx >= 0 && idx < series.length) {
            seriesChecked++;
            const d = Math.abs(series[idx] - c.netPaid);
            worstSeries = Math.max(worstSeries, d);
            if (d > CENT) {
              fail(`${l} AY${c.yearNumber} valuation ${y}: ledger records ${series[idx].toFixed(2)} NET paid `
                + `but the cohort holds ${c.netPaid.toFixed(2)} — the recording has drifted from the engine, `
                + `or has been pointed at the GROSS figure (${gp.toFixed(2)}), which is a different basis`);
            }
          }
        }
      }
    }

    gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result], currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
}

console.log('=== THE PAID LEDGER ===');
console.log(`${GAMES} games x ${YEARS} years, all three lines, default decisions.\n`);
console.log('  assertion                                          checked        worst        limit');
console.log(`  per-claim split sums to the cohort paydown   ${String(splits).padStart(12)}   `
  + `${('$' + worstSplit.toFixed(6)).padStart(10)}   ${('$' + CENT.toFixed(2)).padStart(10)}`);
console.log(`  NET rollforward still closes exactly        ${String(rolls).padStart(13)}   `
  + `${('$' + worstRoll.toFixed(6)).padStart(10)}   ${('$' + CENT.toFixed(2)).padStart(10)}`);
console.log(`  ledger series (NET) matches the cohort     ${String(seriesChecked).padStart(14)}   `
  + `${('$' + worstSeries.toFixed(6)).padStart(10)}   ${('$' + CENT.toFixed(2)).padStart(10)}`);
console.log(`  cumulative paid never decreases            ${String(monotoneChecked).padStart(14)}`);
console.log(`  paid never exceeds ledger ultimate                          `
  + `${('ratio ' + maxRatio.toFixed(6)).padStart(16)}   ${'1.0'.padStart(10)}`);
console.log(`  closed cohorts have paid out in full       ${String(closedSeen).padStart(14)}   `
  + `${('ratio ' + worstClosedRatio.toFixed(6)).padStart(16)}   ${'1.0'.padStart(10)}`);

// ⚠ A ZERO COUNT IS A FAILURE, not a pass. Every assertion above is vacuous if
// nothing reached it, and the closed-cohort arm in particular only fires on long
// enough games — the exact shape of blindness this directory keeps finding.
if (splits === 0) fail('the split assertion never fired — no accident year had both a register and a ledger entry');
if (seriesChecked === 0) fail('the series assertion never fired — nothing was recorded to compare against');
if (closedSeen === 0) {
  console.log(`\n  ⚠ NO COHORT CLOSED IN ${YEARS} YEARS, so the convergence arm did not fire. WC closes at`);
  console.log('    age 37 under the share-based rule, so this needs a long run to exercise —');
  console.log('    re-run with YEARS=45 to reach it. Reported rather than silently passing.');
}

// The paydown rate the split is a share OF, printed so the reader can see the
// ledger is on the line's own pattern rather than a flat rate.
console.log('\n  the rate the gross ledger pays down at, by line and cohort age (pattern age = age + 2):');
for (const l of LINES) {
  const rates = [0, 1, 2, 4].map(a => conditionalPaydown(LINE_PAYOUT_PATTERN[l], a + 2));
  console.log(`    ${l.padEnd(10)} ` + rates.map((r, i) => `age ${[0, 1, 2, 4][i]}: ${(r * 100).toFixed(1)}%`).join('   '));
}

console.log(fails.length === 0
  ? '\nTHE LEDGER IS A RECORDING AND THE SPLIT IS A SPLIT. Per-claim payments sum to the paydown the'
    + '\npayout pattern already set, so the cohort total the development base is built on is untouched'
    + '\nand cession cannot move. The net rollforward still closes to the cent with the gross ledger'
    + '\nrunning alongside it.'
  : `\n${fails.length} FAILURE(S):\n` + fails.map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
