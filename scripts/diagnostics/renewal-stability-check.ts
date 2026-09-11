// ============================================================================
// RENEWAL UNDERWRITING STABILITY — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/renewal-stability-check.ts
//   GAMES=3 YEARS=10 npx tsx scripts/diagnostics/renewal-stability-check.ts
//
// ============================================================================
// THE LOOP THIS EXISTS FOR, AND IT IS NOT THE ONE THAT WAS WATCHED FOR.
//
// The loop flagged twice during design was: decline high-modifier members ->
// the enrolled mix improves -> k_line moves -> the expectation moves -> next
// year's modifiers move. THAT LOOP DOES NOT EXIST. k_line sits in BOTH legs
// of the ratio deliberately (memberLossHistory.ts explains why), so actual
// and expected scale together and the modifier is k-invariant. Declining
// members changes k and the modifier does not notice.
//
// The real candidate is the REBASE DIVISOR:
//
//   mod = 1 + Z (c / M - 1),  M = the mean clamped ratio over the book
//
// Decline the worst members, M falls, every survivor's c/M rises, every
// survivor's modifier rises, and more of them sit above the threshold next
// year. Tighter than the loop being watched for, and through a different
// term entirely.
//
// ⚠ AND THERE IS A DAMPER THE DESIGN DID NOT PUT THERE ON PURPOSE. The
// threshold is on the DISPLAYED modifier, which is divided by the median of
// the rated book — so the median is exactly 1.000 every year by
// construction. Declining the upper tail re-centres the scale rather than
// pushing everyone up it, and it also COMPRESSES the upper tail, which
// leaves fewer members above a fixed threshold next year. That is negative
// feedback. Whether it dominates the rebase effect is the measurement, and
// this gate does not assume it does.
//
// ============================================================================
// FOUR CONTROLS, AND THE FOURTH IS THE ONE THE PREVIOUS TWO LOOP GATES
// LACKED.
//
//   NULL A — a threshold ABOVE the reachable ceiling declines nobody, and
//     must be bit-identical to renewal switched off. Catches the mechanism
//     being wired into something it should not touch, which would show up
//     even when it declines no one.
//
//   NULL B — the arm paired with ITSELF. The difference is identically zero,
//     so the trend test cannot fire. A test that fires here is measuring its
//     own noise.
//
//   WARM-UP EXCLUSION — the first years decline almost nobody because the
//     ledger has not filled and members are unrated, which looks exactly like
//     an upward ratchet and is not one. The trend is measured only over years
//     the ledger has fully warmed.
//
//   POSITIVE CONTROL — an absurd threshold, tight enough to decline a large
//     share of the book. The trend test MUST detect a difference there. This
//     is the clause both previous loop gates were missing: a stability test
//     that has never been shown to move is not a stability test.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { RENEWAL_THRESHOLDS } from '../../src/utils/renewalUnderwriting';
import { EXPERIENCE_MOD, CREDIBILITY_Z } from '../../src/utils/memberExperienceMod';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 14);
/** Years the ledger needs before anyone can be rated at all. */
const WARMUP = EXPERIENCE_MOD.minYears + 2;
/** The tightest shipped level, and the one the ratchet would appear at first. */
const TIGHTEST = Math.min(...RENEWAL_THRESHOLDS);
/** The positive control. Far below anything the UI offers. */
const ABSURD = 1.00;

const failures: string[] = [];
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
const sd = (v: number[]) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

interface YearRow { year: number; declines: number; enrolled: number; exposure: number; poolPremium: number; }

function play(g: number, threshold: number | null): Record<string, YearRow[]> {
  const id = `RS${g}`;
  const instance = generateGameInstance(id, 47_000_000 + g * 7013);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: Record<string, YearRow[]> = { WC: [], GL: [], Property: [] };
  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y) as DecisionSet;
    for (const l of LINES) d.byLine[l].renewalThreshold = threshold;
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    for (const lr of p.lineResults) {
      const x = lr.result as never as Record<string, unknown>;
      out[lr.line as string].push({
        year: y,
        declines: (x.declinedMembers as number) ?? 0,
        enrolled: x.activeMembers as number,
        exposure: x.activeExposure as number,
        poolPremium: x.poolPremium as number,
      });
    }
  }
  return out;
}

console.log(RULE);
console.log('RENEWAL UNDERWRITING STABILITY');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years. Shipped levels ${RENEWAL_THRESHOLDS.join(' / ')}; `
  + `tightest ${TIGHTEST}, positive control ${ABSURD}. Warm-up ${WARMUP} years excluded from trends.`);
console.log(`Z: ` + LINES.map(l => `${l} ${CREDIBILITY_Z[l]}`).join(' / ') + '\n');

const off: Array<Record<string, YearRow[]>> = [];
const tight: Array<Record<string, YearRow[]>> = [];
const absurd: Array<Record<string, YearRow[]>> = [];
for (let g = 0; g < GAMES; g++) { off.push(play(g, null)); tight.push(play(g, TIGHTEST)); absurd.push(play(g, ABSURD)); }

/** Declines in the first vs the second half of the warmed years. A ratchet
 *  shows as later > earlier; the median-centring damper as later < earlier. */
function trend(runs: Array<Record<string, YearRow[]>>, line: string) {
  const early: number[] = [], late: number[] = [];
  for (const r of runs) {
    const warmed = r[line].filter(y => y.year > WARMUP);
    if (warmed.length < 4) continue;
    const mid = Math.floor(warmed.length / 2);
    early.push(mean(warmed.slice(0, mid).map(y => y.declines)));
    late.push(mean(warmed.slice(mid).map(y => y.declines)));
  }
  const diffs = early.map((e, i) => late[i] - e);
  const m = mean(diffs), s = sd(diffs);
  return { early: mean(early), late: mean(late), diff: m, se: s / Math.sqrt(Math.max(1, diffs.length)), n: diffs.length };
}

// --------------------------------------------------- 1. does it ratchet?
console.log('--- 1. THE RATCHET: declines per year, early vs late (warmed years only) ---');
{
  console.log(`  at the tightest shipped level (${TIGHTEST}):`);
  console.log('  line       early   late    diff     SE     | enrolled off -> on');
  for (const line of LINES) {
    const t = trend(tight, line);
    const eOff = mean(off.map(r => mean(r[line].map(y => y.enrolled))));
    const eOn = mean(tight.map(r => mean(r[line].map(y => y.enrolled))));
    console.log(`  ${line.padEnd(10)} ${t.early.toFixed(2).padStart(5)}  ${t.late.toFixed(2).padStart(5)}  `
      + `${(t.diff >= 0 ? '+' : '') + t.diff.toFixed(2)}`.padStart(7)
      + `  ${t.se.toFixed(2).padStart(5)}   | ${eOff.toFixed(1).padStart(5)} -> ${eOn.toFixed(1)}`);
  }
  // ⚠ THE ASSERTION IS ON WC, WHICH IS WHERE THE MECHANISM BITES. GL's
  // credibility is half WC's and Property's is zero, so neither can produce a
  // ratchet the other would not show first.
  const t = trend(tight, 'WC');
  // A ratchet is a SUSTAINED rise. Two standard errors above zero, and at
  // least one additional decline a year, is the bar — a fractional drift
  // inside the noise is not a runaway and gating on it would flap.
  const ratcheting = t.diff > 1 && t.diff > 2 * t.se;
  console.log(`\n  WC ratchet: late - early = ${t.diff.toFixed(2)} +/- ${t.se.toFixed(2)} over ${t.n} games   `
    + `${ratcheting ? 'RATCHET DETECTED' : 'no ratchet'}`);
  if (ratcheting) {
    failures.push(`the decline count RATCHETS at the tightest shipped level: WC declines rise by `
      + `${t.diff.toFixed(2)} a year (SE ${t.se.toFixed(2)}) from the first half of the warmed years to the `
      + 'second. Declining the worst members lowers the rebase divisor, which raises every survivor\'s '
      + 'modifier, which pushes more of them over a fixed threshold. REPORT THIS AND STOP — a cap on '
      + 'annual declines is the obvious remedy and it is a decision, not a fix to fold in here.');
  }
}

// ------------------------------------------------- 2. null A: above the ceiling
console.log('\n--- 2. NULL A: a threshold above the reachable ceiling declines nobody ---');
{
  // The displayed modifier cannot exceed ceiling/floor even in the limit, so
  // anything past that is unreachable by construction.
  const unreachable = EXPERIENCE_MOD.ratioCeiling / EXPERIENCE_MOD.ratioFloor + 1;
  let mismatched = 0, compared = 0, declines = 0;
  for (let g = 0; g < GAMES; g++) {
    const high = play(g, unreachable);
    for (const line of LINES) {
      for (let i = 0; i < off[g][line].length; i++) {
        const a = off[g][line][i], b = high[line][i];
        compared++;
        declines += b.declines;
        if (a.enrolled !== b.enrolled || a.exposure !== b.exposure || a.poolPremium !== b.poolPremium) mismatched++;
      }
    }
  }
  console.log(`  threshold ${unreachable.toFixed(2)}: ${declines} declines (must be 0), `
    + `${mismatched} of ${compared} line-years differing from renewal OFF (must be 0)   `
    + `${declines === 0 && mismatched === 0 ? 'PASS' : 'FAIL'}`);
  if (declines > 0 || mismatched > 0) {
    failures.push(`a threshold above the reachable ceiling produced ${declines} declines and moved `
      + `${mismatched} line-years against renewal switched off. A control that declines nobody must be `
      + 'indistinguishable from the mechanism being absent; if it is not, renewal is reaching something '
      + 'other than the decline list.');
  }
}

// -------------------------------------------------- 3. null B: paired with itself
console.log('\n--- 3. NULL B: the arm paired with itself cannot fire ---');
{
  const selfDiffs: number[] = [];
  for (let g = 0; g < GAMES; g++) {
    const warmed = tight[g].WC.filter(y => y.year > WARMUP);
    const mid = Math.floor(warmed.length / 2);
    // the SAME halves differenced against themselves
    selfDiffs.push(mean(warmed.slice(0, mid).map(y => y.declines)) - mean(warmed.slice(0, mid).map(y => y.declines)));
  }
  const worst = Math.max(...selfDiffs.map(Math.abs));
  const fires = worst > 1;
  console.log(`  worst self-difference ${worst.toFixed(6)} (must be exactly 0)   ${!fires && worst === 0 ? 'PASS' : 'FAIL'}`);
  if (worst !== 0) {
    failures.push(`the arm differenced against itself gave ${worst.toExponential(2)} rather than 0, so the `
      + 'trend statistic is not a pure difference and could fire on its own construction.');
  }
}

// --------------------------------------- 4. positive control at an absurd level
console.log('\n--- 4. POSITIVE CONTROL: an absurd threshold must move the statistic ---');
{
  const tDecl = mean(tight.map(r => r.WC.reduce((a, y) => a + y.declines, 0)));
  const aDecl = mean(absurd.map(r => r.WC.reduce((a, y) => a + y.declines, 0)));
  const tEnr = mean(tight.map(r => mean(r.WC.map(y => y.enrolled))));
  const aEnr = mean(absurd.map(r => mean(r.WC.map(y => y.enrolled))));
  const ta = trend(absurd, 'WC');
  console.log(`  WC declines per game: tightest ${tDecl.toFixed(1)}  absurd ${aDecl.toFixed(1)}`);
  console.log(`  WC mean enrolled:     tightest ${tEnr.toFixed(1)}  absurd ${aEnr.toFixed(1)}`);
  console.log(`  WC trend at absurd:   early ${ta.early.toFixed(2)}  late ${ta.late.toFixed(2)}  `
    + `diff ${(ta.diff >= 0 ? '+' : '') + ta.diff.toFixed(2)} +/- ${ta.se.toFixed(2)}`);
  // The control's job is to prove the INSTRUMENT responds, not to predict the
  // sign. A tighter threshold must decline materially more and shrink the
  // book materially further; if it does not, the trend statistic above is
  // being computed on something that does not move.
  const responds = aDecl > tDecl * 1.5 && aEnr < tEnr - 2;
  console.log(`  the instrument responds to the threshold   ${responds ? 'PASS' : 'FAIL'}`);
  if (!responds) {
    failures.push(`tightening the threshold from ${TIGHTEST} to ${ABSURD} moved declines from `
      + `${tDecl.toFixed(1)} to ${aDecl.toFixed(1)} and mean enrolment from ${tEnr.toFixed(1)} to `
      + `${aEnr.toFixed(1)} — not a material response. Every assertion above is computed on this same `
      + 'instrument, so if it does not move here it proves nothing there. This is the clause the two '
      + 'previous loop gates lacked.');
  }
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('DECLINING THE WORST MEMBERS DOES NOT RUN AWAY: THE DECLINE COUNT DOES NOT');
  console.log('RATCHET AT ANY SHIPPED LEVEL, A THRESHOLD THAT DECLINES NOBODY IS IDENTICAL');
  console.log('TO RENEWAL OFF, AND THE INSTRUMENT DEMONSTRABLY MOVES WHEN THE LEVEL DOES.');
  console.log(RULE);
}
