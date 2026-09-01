// ============================================================================
// PAID HEADROOM — CAN AN OPEN CLAIM STILL BE REVISED DOWN?
//
// Run:  npx tsx scripts/diagnostics/paid-headroom-check.ts
//       GAMES=40 npx tsx scripts/diagnostics/paid-headroom-check.ts
//
// HEADROOM is `1 - paid / incurred` on a claim that is still OPEN. It is the
// room a downward revision has before it would unpay money that has already
// left. A claim at zero headroom cannot be revised down at all.
//
// ⚠ WHY THIS GATE EXISTS, AND WHY IT IS NOT A STYLE CHECK. Under the retired
// pro-rata split every open claim carried the cohort's AVERAGE paid share, so
// the workbook printed GL files that were open and 99.8% paid. Two consequences,
// both fatal to the per-claim revision work this is Stage 0 of:
//
//   1. A mean-zero revision law floored at paid-to-date has its floor binding on
//      essentially every large open claim, and the truncation injects a
//      systematic UPWARD drift. Measured on the old split at the law's own
//      magnitudes: WC +18.8%, GL +6.7%, Property +2.3% of the cohort ultimate.
//      WC's is three quarters of that line's whole development SD.
//   2. "The claim closes at zero" — which real settlement experience shows for
//      about a fifth of claims — is arithmetically impossible for a file already
//      booked 94.7% paid.
//
// So this measures the thing that decides whether Stage 1 can start, rather than
// asserting a property nobody has looked at.
//
// ============================================================================
// WHAT IS ASSERTED, AND WHAT IS ONLY REPORTED.
//
// ASSERTED:
//   - the split ties to the cohort's gross paid, to the cent (paid-ledger-check
//     asserts this too, at a different site; both are cheap and the failure
//     modes differ — this one sees every accident year, that one sees the
//     ledger's own rollforward)
//   - no claim takes a negative payment
//   - no OPEN claim sits at zero headroom while its cohort still has unpaid
//     dollars to distribute
//
// REPORTED, NOT ASSERTED:
//   - the headroom distribution by line and age, old split against new. There is
//     no threshold to assert here that would not be an invented number; the
//     table is the deliverable and a reader compares it against the law's own
//     magnitudes.
//   - the share of open sum(v^2) whose headroom is thinner than the revision
//     law's magnitude at that age and size. This is the number that says whether
//     the floor still binds where it matters, weighted the way cohort variance
//     is actually weighted.
//   - PROPERTY'S OPEN CLAIMS NOW SIT AT OR NEAR 100% HEADROOM at the early ages
//     (median 96.9% at age 1, 100.0% at age 2), which means most of them are
//     booked at ZERO paid. That is the two-tier rule working as specified rather
//     than a fault — Property closes faster than it pays, so its closed files
//     absorb the whole paydown and there is nothing left for the open ones — and
//     it is coherent in a way the old 25.6%-for-everyone was not. But it is a
//     strong claim about a real book (an open property loss with no payment
//     against it two years on) and it is the visible edge of the two curves
//     being independent by design. Recorded so it is a known consequence rather
//     than a surprise in a playtest.
//   - PAID OVER INCURRED on a developed cohort. `registerGrossSum` is frozen at
//     inception and the cohort's gross ultimate develops above it, so a cohort
//     late in an adverse runoff can have paid more than its register sums to and
//     the open tier's scale factor passes one. Pre-existing — the old rule did it
//     to every claim at once — and NOT fixed here, because the fix is Stage 1's
//     per-claim revision making a claim's carried value track its cohort, not a
//     payment rule. Counted so the size of it is known.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { claimPaidSplit, isClaimClosed } from '../../src/utils/claimClosure';
import { resolveClosureCurve } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 20);
const YEARS = Number(process.env.YEARS ?? 12);
const CENT = 0.01;
const MAXAGE = 10;

// The Stage 1 revision law, present ONLY as the yardstick the headroom table is
// read against. Nothing here applies it; it is not installed anywhere yet.
// magnitude = min( 200% / (age + 1), size trend ), the size trend fitted to the
// pool's own revision experience at 20.12 * v^-0.2891.
const lawMagnitude = (age: number, v: number) =>
  Math.min(2.0 / (age + 1), 20.1203 * Math.pow(Math.max(v, 1), -0.2891));

// ⚠ THE VERDICT NAMES WHAT FAILED. IT DOES NOT COUNT. A bare "N FAILED" at the
// end of a long report makes the reader scroll back, and whatever prose they
// land on on the way gets read as the explanation — this project has
// misdiagnosed a red gate exactly that way.
const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 40) failed.push(s); };
const RULE = '='.repeat(72);

// THE TRUNCATION DRIFT, which is the number this whole stage exists to move.
//
// A mean-zero revision floored at paid-to-date is not mean-zero: the mass that
// would have gone below the floor comes back as an upward push. For r ~ N(0, s)
// truncated below at -h, that push is E[(-h - r)+] = s.phi(h/s) - h.PHI(-h/s),
// in units of the claim's own value. Summed over open claims and divided by the
// cohort's register, it is the drift the ultimate takes per year.
const npdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const ncdf = (z: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = npdf(z) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - d : d;
};
const truncationPush = (s: number, h: number) =>
  (s <= 0 ? 0 : s * npdf(h / s) - h * ncdf(-h / s));
const Q_REVISE = 0.70;                    // measured revision frequency, flat in age and size
const PHIS = [1.0, 1.9];                  // 1.0 = the basis the +18.8/6.7/2.3 figures were quoted on

interface Bucket {
  head: number[]; bindW2: number; allW2: number; overIncurred: number; open: number;
  /** drift dollars, indexed by PHIS. */ drift: number[];
  /** cohort register dollars this age was measured over. */ denom: number;
}
const mk = (): Bucket => ({
  head: [], bindW2: 0, allW2: 0, overIncurred: 0, open: 0,
  drift: PHIS.map(() => 0), denom: 0,
});
const now: Record<string, Bucket[]> = {};
const old: Record<string, Bucket[]> = {};
for (const l of LINES) {
  now[l] = Array.from({ length: MAXAGE + 1 }, mk);
  old[l] = Array.from({ length: MAXAGE + 1 }, mk);
}

let splitsChecked = 0;
let worstTie = 0;
let zeroHeadroomWithSlack = 0;

for (let g = 0; g < GAMES; g++) {
  const id = `PH${g}`;
  const inst = generateGameInstance(id, 6_100_000 + g * 7127);
  const setup = { poolName: 'H', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  // The register is only in hand for the accident year written this year, so it
  // is captured at inception and re-aged against later valuations.
  const registers: Record<string, Map<number, { id: string; v: number }[]>> = {};
  for (const l of LINES) registers[l] = new Map();

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));

    for (const l of LINES) {
      const claims = (p.result.byLine[l] as never as {
        claims?: { id: string; accidentYear: number; grossUltimate: number }[]
      }).claims ?? [];
      const mine = claims.filter(c => c.accidentYear === y);
      if (mine.length > 0) registers[l].set(y, mine.map(c => ({ id: c.id, v: c.grossUltimate })));

      const ls = (p.updatedPoolState as never as {
        lines: Record<string, { reserveCohorts: { yearNumber: number; grossPaid?: number }[] }>
      }).lines[l];

      for (const c of ls.reserveCohorts) {
        const reg = registers[l].get(c.yearNumber);
        const gp = c.grossPaid;
        if (!reg || gp === undefined || reg.length === 0) continue;
        const age = y - c.yearNumber + 1;               // curve age of this valuation
        if (age < 1 || age > MAXAGE) continue;

        const entries = reg.map(r => ({
          grossUltimate: r.v,
          closed: isClaimClosed(resolveClosureCurve(l, r.v), id, r.id, age),
        }));
        const split = claimPaidSplit(entries, gp);

        // --- ASSERT: the split ties, and nothing goes negative ---------------
        splitsChecked++;
        const summed = split.reduce((s, v) => s + v, 0);
        worstTie = Math.max(worstTie, Math.abs(summed - gp));
        if (Math.abs(summed - gp) > CENT) {
          fail(`${l} AY${c.yearNumber} age ${age}: split sums to ${summed.toFixed(4)} against cohort `
            + `gross paid ${gp.toFixed(4)} — the paydown the pattern set is not being distributed`);
        }
        const neg = split.findIndex(v => v < -CENT);
        if (neg >= 0) {
          fail(`${l} AY${c.yearNumber} age ${age}: claim ${reg[neg].id} takes a NEGATIVE payment `
            + `${split[neg].toFixed(4)}`);
        }

        // --- the old rule, reconstructed for the side-by-side ---------------
        const registerSum = reg.reduce((s, r) => s + r.v, 0);
        const cohortSlack = registerSum - gp;
        now[l][age].denom += registerSum;
        old[l][age].denom += registerSum;

        for (let i = 0; i < reg.length; i++) {
          if (entries[i].closed) continue;
          const v = reg[i].v;
          if (!(v > 0)) continue;
          const hNew = 1 - split[i] / v;
          const hOld = registerSum > 0 ? 1 - (gp * v / registerSum) / v : 1;
          const mag = lawMagnitude(age, v);

          for (const [store, h] of [[now[l][age], hNew], [old[l][age], hOld]] as const) {
            store.open++;
            store.head.push(h);
            store.allW2 += v * v;
            if (h < mag) store.bindW2 += v * v;
            if (h < 0) store.overIncurred++;
            // ⚠ A NEGATIVE HEADROOM IS FLOORED AT ZERO FOR THE DRIFT, not
            // dropped. The claim is already booked above its own incurred, so
            // the whole downward half of its revision is truncated; treating
            // that as h = 0 is the largest push the formula admits and is the
            // conservative reading, whereas skipping the claim would quietly
            // report a smaller drift than the model would actually take.
            PHIS.forEach((phi, k) => {
              store.drift[k] += Q_REVISE * v * truncationPush(phi * mag, Math.max(0, h));
            });
          }

          // --- ASSERT: an open claim at zero headroom while the cohort still
          // has unpaid dollars means the allocation over-paid it — the exact
          // defect the naive progress reweight produced.
          if (hNew <= 0 && cohortSlack > CENT) {
            zeroHeadroomWithSlack++;
            fail(`${l} AY${c.yearNumber} age ${age}: OPEN claim ${reg[i].id} sits at ${(100 * hNew).toFixed(2)}% `
              + `headroom while the cohort still holds ${cohortSlack.toFixed(2)} unpaid — the split is `
              + `over-allocating to open files`);
          }
        }
      }
    }

    gs = {
      ...gs, poolState: p.updatedPoolState,
      lockedResults: [...gs.lockedResults, p.result], currentYearNumber: y + 1,
    };
  }
}

// ============================================================================
const q = (a: number[], p: number) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const pc = (x: number) => (Number.isNaN(x) ? '   -  ' : `${(100 * x).toFixed(1)}%`);

console.log(`=== PAID HEADROOM: ${GAMES} games x ${YEARS} years ===\n`);
console.log('HEADROOM ON OPEN CLAIMS — 1 - paid/incurred. Higher is more room for a');
console.log('downward revision. "binds" is the share of open sum(v^2) whose headroom is');
console.log('thinner than the revision law would want at that age and size.\n');

for (const l of LINES) {
  console.log(`--- ${l}`);
  console.log('  age |        OLD pro-rata split        |         NEW two-tier split       |');
  console.log('      |   p25    med    p75    binds     |   p25    med    p75    binds     | open claims');
  for (let a = 1; a <= MAXAGE; a++) {
    const o = old[l][a], n = now[l][a];
    if (n.open === 0) continue;
    console.log(
      `   ${String(a).padStart(2)} | ${pc(q(o.head, .25)).padStart(6)} ${pc(q(o.head, .5)).padStart(6)} `
      + `${pc(q(o.head, .75)).padStart(6)}  ${pc(o.allW2 > 0 ? o.bindW2 / o.allW2 : NaN).padStart(6)}     |`
      + ` ${pc(q(n.head, .25)).padStart(6)} ${pc(q(n.head, .5)).padStart(6)} `
      + `${pc(q(n.head, .75)).padStart(6)}  ${pc(n.allW2 > 0 ? n.bindW2 / n.allW2 : NaN).padStart(6)}     | ${n.open}`
    );
  }
  const oOver = old[l].reduce((s, b) => s + b.overIncurred, 0);
  const nOver = now[l].reduce((s, b) => s + b.overIncurred, 0);
  const oAll = old[l].reduce((s, b) => s + b.open, 0);
  console.log(`  open claims booked ABOVE their drawn incurred (developed cohorts, pre-existing):`);
  console.log(`    old ${oOver} / ${oAll} = ${pc(oAll > 0 ? oOver / oAll : NaN)}    new ${nOver} / ${oAll} = ${pc(oAll > 0 ? nOver / oAll : NaN)}`);
  console.log('');
}

// ============================================================================
console.log(RULE);
console.log('TRUNCATION DRIFT — what a mean-zero revision floored at paid-to-date would');
console.log('add to the cohort ultimate over the runoff. THE REASON THIS STAGE EXISTS.');
console.log('Not a threshold: reported so Stage 1 can size its martingale test against it.');
console.log('');
console.log('  line       phi |   OLD split   NEW split   |  change');
for (const l of LINES) {
  PHIS.forEach((phi, k) => {
    const cum = (bs: Bucket[]) => bs.reduce((s, b) => s + (b.denom > 0 ? b.drift[k] / b.denom : 0), 0);
    const o = cum(old[l]), n = cum(now[l]);
    console.log(`  ${l.padEnd(9)} ${phi.toFixed(1).padStart(3)} |   ${pc(o).padStart(7)}     ${pc(n).padStart(7)}   |  ${o > 0 ? `${(100 * (n / o - 1)).toFixed(0)}%` : '   -'}`);
  });
}
console.log('');
console.log('  phi 1.0 is the basis the recorded +18.8 / +6.7 / +2.3% figures were quoted on,');
console.log('  so that column is the like-for-like comparison. phi 1.9 is the ruled value,');
console.log('  derived from the terminal-severity anchor, and is what Stage 1 will run at.');
console.log('');

console.log(RULE);
console.log(`splits checked ${splitsChecked}, worst tie error $${worstTie.toFixed(6)}`);
console.log(`open claims at zero headroom with cohort slack remaining: ${zeroHeadroomWithSlack}`);
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('PASS — split ties to the cent, nothing negative, no open claim starved of headroom');
  console.log(RULE);
}
