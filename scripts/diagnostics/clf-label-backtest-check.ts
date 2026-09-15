// CLF LABEL BACKTEST — does the funding slider's PERCENTAGE mean what it says,
// on the mechanism that actually ships?
//
// ============================================================================
// ⚠ NOT EXPECTED RED. An earlier header here said this gate was entered in
// scripts/gates.ts's EXPECTED_RED with "re-derive all three tables" named as
// the fix. That entry was retired at the maturation-book commit and gates.ts
// keeps the retraction at its own EXPECTED_RED block: the worst error is not
// +14.5pp on GL, no table was re-derived, and GL still reads GL_SUPPLIED. What
// changed was what the tables were being asked to describe. The header is
// corrected here rather than deleted, because a reader who has seen the old
// +14.5pp figure quoted needs to find out where it went.
//
// ============================================================================
// WHAT IT MEASURES, AND WHY THIS BASIS.
//
// A CLF table maps a confidence level to a MULTIPLE OF EXPECTED loss. So it is
// a set of percentiles of the line's own net loss distribution divided by that
// line's expected loss, and the label is testable directly: fund at the stop's
// multiplier and count how often the year's loss came in under it.
//
//     realised confidence at stop p
//       = share of line-years with netIncurredLoss <= staticClf(line, p) x poolPremium
//
// ⚠ THE DENOMINATOR IS EACH YEAR'S OWN PREMIUM, NOT THE POOLED MEAN LOSS, AND
// THE CHANGE IS NOT COSMETIC. This gate used to divide every line-year by one
// pooled mean of netUltimateLoss. That is correct only while the book holds its
// size: a single constant can stand in for expected loss when exposure does not
// move. Since the membership target came out the book is a trajectory — WC runs
// roughly 76 -> 92 enrolled members across ten years — so a pooled mean sits
// above early years' exposure and below late years'. Under that denominator an
// early year looks cheap and a late year looks dear FROM EXPOSURE ALONE, and a
// per-book-size breakdown would report growth as label error. The per-band
// numbers below could not have been read off the old basis at all.
//
// ⚠ NO CIRCULARITY, AND IT IS STRUCTURAL RATHER THAN ARGUED. At all-defaults
// fundingAtExpected is true, so CLF is pinned to exactly 1.000 and poolPremium
// is the priced expected net loss with no table lookup anywhere in it. The
// denominator therefore cannot carry the table it is being used to test. This
// is the same denominator clf-table-derive.ts derives against, which is the
// second reason for the change: gate and derivation now share a basis, so a
// disagreement between them is a real disagreement rather than two conventions.
//
// ⚠ INCURRED ONLY, AND ULTIMATE IS NOT A SECOND OPINION ON THE SAME SCALE.
// netIncurredLoss is what the P&L charges against the premium
// (underwritingIncome = poolPremium - netIncurredLoss), so it is what the
// player's surplus does, and it is the basis clf-table-derive.ts derives on.
// netUltimateLoss is NOT the same quantity divided differently: it is the
// accident year's own register AFTER forward booking marks it down, while
// netIncurredLoss is that booked figure plus development on every prior year.
// Against premium the two sit nowhere near each other — measured at 250
// line-years, median netIncurredLoss / netUltimateLoss is 1.845 on WC, 2.491 on
// GL, 1.196 on Property. An earlier revision of this gate printed both columns
// side by side; on the ultimate column every stop from 30% up reported 100.0%
// delivered, which is not a label error of +70pp but a scale mismatch. The
// column was removed rather than left to be misread.
//
// ⚠ POSITIVE CONTROL ON THE BASIS ITSELF, because changing a gate's denominator
// and then reporting that the result moved is worth nothing on its own.
// gl-supplied-clf-check measures the same defect by a different route — GL solo,
// all defaults, 1,000 games, supplied CLF against realised line-years — and at
// this commit it reads +14.6pp at the 60% stop and +19.4pp at the 70%. This gate
// reads +11.0pp at the 60%. Same sign, same order, both far outside the 5pp bar,
// on two populations that do not overlap (this one is pooled across three lines
// and four appetite arms; that one is GL alone at defaults), which is why they
// are not expected to match to the point.
//
// ⚠ AND AN EARLIER REVISION OF THIS NOTE OVERCLAIMED THAT CONTROL. It said the
// two "agree" at +11.0 against +10.5. The +10.5 is the figure recorded in
// clfTables.ts's GL_SUPPLIED block, which was measured BEFORE the membership
// target came out — it is not a like-for-like reading at this commit, and
// comparing a live measurement against a stale recorded one is not a control.
// The live cross-check above is, and it is looser.
//
// What the replaced pooled-mean basis could not do either way: it reported GL's
// worst error as -3.2pp, against a defect two other measurements put between 11
// and 19pp.
//
// ⚠ REPORTED WITH A CI, GATED ON THE WORST STOP IN THE WORST BAND. Realised
// confidence is a binomial proportion, so its own standard error is knowable and
// printed. The gate fires on the largest absolute label error across stops AND
// across book bands, against a tolerance wide enough to be a gross-error
// detector and no wider. Gating the pooled figure alone would pass a table that
// averages to 2pp while reading 8pp at one end of the book's range, which is
// precisely the failure a size-free table is exposed to.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { STATIC_CLF_TABLE, staticClf } from '../../src/data/clfTables';
import { PER_CLAIM_REVISION } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(72);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// PER ARM, so the run is GAMES x ARMS.length games and the collected sample is
// GAMES x ARMS.length x YEARS line-years per line. 60 x 4 keeps the total at the
// 240 games the two-arm version cost, rather than paying four times over for a
// mix correction.
const GAMES = Number(process.env.GAMES ?? 60);
// Ten years, not eight, and the reason is the book rather than the sample. The
// enrolled book is now a trajectory, and its top band is reached only in the
// later years — at eight years the large band holds too few line-years to carry
// a per-band figure. Ten also matches clf-table-derive.ts's horizon, so the gate
// evaluates the table over the same span of book sizes it was derived across.
const YEARS = 10;

// The label error tolerance, in percentage points. A GROSS-ERROR DETECTOR: at
// the ~2,400 pooled line-years this collects by default a realised proportion
// carries a standard error near 1pp, and the smallest gated band near 2pp, so
// anything under ~5pp cannot be cleanly separated from sampling here and belongs
// to a re-derivation rather than to a gate.
const MAX_LABEL_ERROR_PP = 5.0;

// The book bands, on enrolled members, matching clf-table-derive.ts's BAND mode
// so the two can be read against each other line for line. The labels name the
// band's approximate median book rather than its edges, because the edges are
// arbitrary and the median is the thing being reported on.
const BOOK_BANDS: [number, number, string][] = [
  [0, 72, 'small ~64'], [72, 88, 'mid ~80'], [88, 9999, 'large ~97'],
];
const bandOf = (n: number) => BOOK_BANDS.findIndex(([lo, hi]) => n >= lo && n < hi);
// A band below this many line-years is reported but not gated: its standard
// error is too wide for a 5pp bar to mean anything. Reporting it anyway keeps
// the thinness visible instead of hiding the band.
const MIN_BAND_N = 400;

interface Year { incurred: number; premium: number; members: number }

const failed: string[] = [];

// ⚠ FOUR ARMS, AND THE MIDDLE TWO ARE NOT PADDING. At all defaults the book only
// grows, so a small book is almost always an EARLY YEAR — at 120 games the small
// band held 169 line-years of 1,200, all of them young, and gating that would
// test book age wearing a book-size label. The new-business appetite bar is what
// separates them: a strict bar shrinks the book, so it reaches 64 members at
// year 10 with a mature history behind it. Every arm is real play — the control
// is on the Growth & Underwriting screen and a player who sets it is entitled to
// labels that hold.
//
// ⚠ AND RUNNING ONLY THE TWO EXTREMES WAS TRIED AND WAS WRONG. With just Accept
// All and the 0.75 bar, the small band is almost entirely 0.75-arm line-years
// and the large band almost entirely Accept-All ones, so BAND BECOMES A PROXY
// FOR ARM. Since the appetite bar changes the book's COMPOSITION as well as its
// size, the per-band error then reports underwriting selection under a
// book-size heading. Measured: on that two-arm mix WC read -8.6pp small / +6.6pp
// large, against -4.0 / +1.5 for the same table on the four-arm mix that
// clf-table-derive.ts uses. The middle arms fill the bands with a spread of
// selection strengths, which is what makes the split about size again. These are
// the same four arms the table is derived across, so the gate evaluates on the
// population it was fitted on and the band split asks whether it generalises
// within it.
const ARMS: (number | null)[] = [null, 1.50, 1.00, 0.75];

function shippedRun(): Record<string, Year[]> {
  const out: Record<string, Year[]> = { WC: [], GL: [], Property: [] };
  for (const arm of ARMS) {
    for (let g = 0; g < GAMES; g++) {
      const id = `CLFB${arm ?? 'A'}${g}`;
      const instance = generateGameInstance(id, 6_200_000 + g * 7919);
      const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
      const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
      let gs: GameState = {
        setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      for (let y = 1; y <= YEARS; y++) {
        const d = defaultDecisionSet(y);
        for (const line of LINES) d.byLine[line].newBusinessAppetite = arm;
        const p = processYear(gs, d);
        for (const line of LINES) {
          const lr = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
          if (lr && lr.poolPremium > 0 && Number.isFinite(lr.netIncurredLoss)) {
            out[line].push({
              incurred: lr.netIncurredLoss,
              premium: lr.poolPremium, members: lr.activeMembers,
            });
          }
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      }
    }
  }
  return out;
}

/** Share of `ys` whose loss came in at or under the stop's multiple of that
 *  year's own premium — what the label actually delivered, in percent. */
const delivered = (ys: Year[], mult: number) =>
  ys.filter(y => y.incurred <= mult * y.premium).length / Math.max(1, ys.length);

console.log(RULE);
console.log('CLF LABEL BACKTEST — what the funding slider\'s percentage actually delivers');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years on the SHIPPED mechanism `
  + `(PER_CLAIM_REVISION.enabled = ${PER_CLAIM_REVISION.enabled}).`);
console.log('The flag is NOT toggled here — this gate asks about the shipped path only.\n');

const loss = shippedRun();

const stopsOf = (line: string) => STATIC_CLF_TABLE[line as 'WC' | 'GL' | 'Property'].stops
  .map(s => s / 100)
  .filter(c => c >= 0.30 && c <= 0.95)   // the slider's own reachable range
  .sort((a, b) => b - a);

// --- 1. POOLED across the whole trajectory ---------------------------------
console.log('  line      stop   multiplier   nominal   delivered    error     +-1 SE');
let worst = { line: '', stop: 0, err: 0, band: 'POOLED' };
// Tracked separately so the failure can say WHICH KIND of error it is: a table
// that is wrong everywhere and a table that is wrong only at one end of the
// book's range need different fixes, and naming the wrong one sends the next
// reader to the wrong file.
const worstPooled: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
for (const line of LINES) {
  const ys = loss[line];
  if (ys.length === 0) { failed.push(`${line}: no line-years collected`); continue; }
  for (const p of stopsOf(line)) {
    const mult = staticClf(line as 'WC' | 'GL' | 'Property', p);
    const hit = delivered(ys, mult);
    const se = Math.sqrt(Math.max(1e-12, hit * (1 - hit) / ys.length));
    const err = 100 * (hit - p);
    if (Math.abs(err) > Math.abs(worst.err)) worst = { line, stop: p, err, band: 'POOLED' };
    if (Math.abs(err) > Math.abs(worstPooled[line])) worstPooled[line] = err;
    console.log(`  ${line.padEnd(9)} ${(100 * p).toFixed(1).padStart(5)}%  ${mult.toFixed(4).padStart(9)}   `
      + `${(100 * p).toFixed(1).padStart(6)}%   `
      + `${(100 * hit).toFixed(1).padStart(8)}%  ${`${err >= 0 ? '+' : ''}${err.toFixed(1)}`.padStart(6)}   `
      + `${(100 * se).toFixed(2)}pp`);
  }
  console.log('');
}

// --- 2. BY BOOK BAND, on the primary basis ---------------------------------
// The whole point of this section: a size-free table on a book that moves can
// average to a small error while reading large at one end of the range. Only
// the per-band figures can show that, and only they are worth gating on.
console.log('--- BY BOOK SIZE: the same stops, split by the year\'s enrolled book ---');
console.log('  Incurred basis. A table with no size dimension is asked to hold across the');
console.log(`  whole trajectory; bands under ${MIN_BAND_N} line-years are reported but not gated.\n`);
for (const line of LINES) {
  const ys = loss[line];
  if (ys.length === 0) continue;
  const stops = stopsOf(line);
  const books = ys.map(y => y.members).sort((a, b) => a - b);
  console.log(`  ${line} — book p10 ${books[Math.floor(0.1 * books.length)]}, `
    + `median ${books[Math.floor(0.5 * books.length)]}, p90 ${books[Math.floor(0.9 * books.length)]}`);
  console.log('    band             n   ' + stops.map(p => `${(100 * p).toFixed(0)}%`.padStart(7)).join('')
    + '     worst');
  for (let b = 0; b < BOOK_BANDS.length; b++) {
    const cell = ys.filter(y => bandOf(y.members) === b);
    if (cell.length === 0) continue;
    const errs = stops.map(p => 100 * (delivered(cell, staticClf(line as 'WC' | 'GL' | 'Property', p)) - p));
    const w = errs.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
    const gated = cell.length >= MIN_BAND_N;
    if (gated && Math.abs(w) > Math.abs(worst.err)) {
      worst = { line, stop: stops[errs.indexOf(w)], err: w, band: BOOK_BANDS[b][2] };
    }
    console.log(`    ${BOOK_BANDS[b][2].padEnd(11)}${String(cell.length).padStart(6)}   `
      + errs.map(e => `${e >= 0 ? '+' : ''}${e.toFixed(1)}`.padStart(7)).join('')
      + `   ${Math.abs(w) > MAX_LABEL_ERROR_PP ? '!' : ' '}${w >= 0 ? '+' : ''}${w.toFixed(1)}`
      + (gated ? '' : '  (thin, not gated)'));
  }
  console.log('');
}

console.log(`  line-years per line: ${loss.WC.length}`);
console.log(`  WORST LABEL ERROR: ${worst.line} at the ${(100 * worst.stop).toFixed(1)}% stop `
  + `on the ${worst.band} book, `
  + `${(worst.err >= 0 ? '+' : '') + worst.err.toFixed(1)}pp against a ${MAX_LABEL_ERROR_PP}pp tolerance`);

if (Math.abs(worst.err) > MAX_LABEL_ERROR_PP) {
  failed.push(`${worst.line}'s ${(100 * worst.stop).toFixed(1)}% funding stop delivers `
    + `${(100 * worst.stop + worst.err).toFixed(1)}% on the ${worst.band} book — a `
    + `${(worst.err >= 0 ? '+' : '') + worst.err.toFixed(1)}pp label error. `
    + (Math.abs(worstPooled[worst.line]) > MAX_LABEL_ERROR_PP
      ? `The POOLED error on ${worst.line} is ${(worstPooled[worst.line] >= 0 ? '+' : '')}`
        + `${worstPooled[worst.line].toFixed(1)}pp, outside tolerance too, so this is THE CURVE `
        + 'rather than the size axis — it is wrong at every book size and re-deriving at a '
        + 'different book will not fix it. Check first whether the line reads a curve that was '
        + 'never derived from this engine at all.'
      : `The POOLED error on ${worst.line} is only ${(worstPooled[worst.line] >= 0 ? '+' : '')}`
        + `${worstPooled[worst.line].toFixed(1)}pp, so this is a SIZE error and averaging hides `
        + 'it. The table has no book-size dimension, and the band it was derived at is not where '
        + 'this line\'s book actually sits. Either re-derive it at the band containing the line\'s '
        + 'own median book, or accept a size axis and the membership-to-pricing feedback that '
        + 'comes with it.'));
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('');
  console.log('⚠ THIS IS A REAL RED, NOT AN EXPECTED ONE. The gate carries no EXPECTED_RED');
  console.log('  entry: the funding slider\'s percentages are shown to the player as meaningful,');
  console.log('  and a label that misses by more than 5pp is not a label. Fix the table.');
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('CLF LABELS HOLD — every funding stop delivers its nominal confidence within');
  console.log(`${MAX_LABEL_ERROR_PP}pp on the shipped mechanism, at every book size the game`);
  console.log('reaches, not merely on average across them.');
  console.log(RULE);
}
