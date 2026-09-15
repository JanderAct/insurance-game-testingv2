// CLF LABEL BACKTEST — does the funding slider's PERCENTAGE mean what it says,
// on the mechanism that actually ships?
//
// ============================================================================
// ⚠ THE BASIS CHANGED HERE, AND IT IS THE SECOND TIME. Read this before
// quoting any figure that predates it.
//
// This gate has now been wrong twice about WHAT to divide by, and both times the
// wrongness produced a headline number that people then reasoned from:
//
//   v1  loss / pooled mean loss     reported GL's worst error as -3.2pp and
//                                   called the labels sound. Valid only while
//                                   the book holds its size, which it stopped
//                                   doing when the membership target came out.
//   v2  netIncurredLoss / premium   reported -21.9pp on GL. Correct denominator,
//                                   WRONG NUMERATOR — see below.
//   v3  accidentYearUltimate / premium   this file. ~0 on GL.
//
// The -21.9pp of v2 was not a defect in GL_SUPPLIED, was not evidence about the
// loss model, and was not a book-size error. It was an artefact of comparing a
// curve about accident years against a statistic about calendar years.
//
// ============================================================================
// WHY THE CALENDAR-YEAR FIGURE IS LOWER. THIS IS THE WHOLE 22pp AND IT WILL BE
// ASKED AGAIN, SO IT IS WRITTEN OUT.
//
// netIncurredLoss in calendar year t is not one accident year's cost. It is:
//
//     this year's accident year, booked at a marked-down initial estimate
//   + development on EVERY open prior accident year, each at a different age
//
// On GL that is up to eight prior years at once, against a cohort whose estimate
// develops 2.6x from inception to settlement. Summing eight partly-independent
// development draws and one booking is an AVERAGE, and averaging cuts spread.
// Measured on the same accident years, same books, same tables:
//
//     GL accident-year ratio    mean 1.0288   CV 0.3878
//     GL calendar-year ratio    mean 0.9633   CV 0.1818
//
// The calendar basis has LESS THAN HALF the volatility. GL_SUPPLIED's own
// implied CV, read off its quartiles, is 0.3979 — within 2.5% of the
// accident-year figure and more than double the calendar-year one.
//
// ⚠ AND A PERCENTILE MOVES FAR MORE THAN THE CV GAP SUGGESTS, which is why the
// error looked catastrophic rather than merely wrong. Halving the spread pulls
// every stop toward the mean, so a multiplier set for the wide distribution
// covers almost everything in the narrow one at the top and almost nothing at
// the bottom. That is exactly the shape v2 reported: +20pp at the 70% stop and
// -22pp at the 30%, on a curve that is within 2pp of right.
//
// ⚠ SO THE 22pp WAS NEVER EVIDENCE ABOUT THE LOSS MODEL. Two readers in
// succession took it as a reason to change the model — once by replacing the
// real-pool curve with a derived one, once by raising GL's claim frequency. Both
// were rejected on measurement. clfTables.ts's own note still names the
// frequency route as "the real fix"; it is not, and the reason is here.
//
// ============================================================================
// WHAT IT MEASURES, AND WHY THIS BASIS.
//
// A CLF stop is a promise about a FUNDING DECISION. A player funding at the 75%
// stop is buying confidence that THIS year's claims will come in under THIS
// year's premium. That is an accident-year question and it is answered only once
// the year has run off.
//
//     realised confidence at stop p
//       = share of ACCIDENT YEARS whose settled net ultimate came in at or under
//         staticClf(line, p) x that same year's poolPremium
//
// Calendar-year incurred answers a different and narrower question — "will
// underwriting income be positive this year" — and its prior-year development
// belongs to years that were funded separately, by premiums already collected.
// clfTables.ts chose the calendar basis for the derivation because
// underwritingIncome = poolPremium - netIncurredLoss is an exact identity, which
// is true and is about the P&L rather than about the funding decision the slider
// labels. Both arms are printed below; only the accident-year one gates.
//
// ⚠ THE DENOMINATOR IS EACH YEAR'S OWN PREMIUM, NOT A POOLED MEAN, and that part
// of v2 stands. A single constant can stand in for expected loss only while
// exposure holds still, and the book is a trajectory — roughly 76 -> 92 enrolled
// members at defaults. Under a pooled mean an early year looks cheap and a late
// year dear from exposure alone, and the per-band split would report growth as
// label error.
//
// ⚠ NO CIRCULARITY, AND IT IS STRUCTURAL. At all-defaults fundingAtExpected is
// true, so CLF is pinned to exactly 1.000 and poolPremium is the priced expected
// net loss with no table lookup in it. The appetite arms vary newBusinessAppetite
// only and never touch the funding flag, so the pin holds on every observation.
//
// ============================================================================
// THE SOURCE IS THE APPEND-ONLY LEDGER, AND MATURITY IS TESTED PER ROW.
//
// ReserveCohort is filtered out of reserveCohorts the year after it closes, so a
// settled cohort's final estimate is not readable there. LinePoolState.
// reserveDevelopment keeps a ReserveDevelopmentRow per accident year carrying
// ultimateByValuation (NET, oldest first) and survives closure.
//
// ⚠ ITS TYPE COMMENT SAYS "NOTHING IN THE ENGINE CONSUMES THIS" AND THAT IS NO
// LONGER TRUE. simulationEngine builds experienceBasis.rows from
// windowRows(lineState.reserveDevelopment) and PRICES off it — S3 experience
// rating, exactly the event the type comment warned about ("if a priced or
// booked quantity ever starts reading this ledger, the ledger has become engine
// state"). The warning fired and was never updated. Noted at the type as well.
//
// THAT DOES NOT MAKE THIS GATE CIRCULAR, and the reason is worth being precise
// about rather than waving at. Premium for accident year t now does depend on
// the ledger's rows up to t-1, so numerator and denominator are not independent
// — a pool that developed badly prices higher next year. That is a real feedback
// in the model and the player lives inside it. The circularity that WOULD matter
// is the table entering its own test, and it does not: at all-defaults
// fundingAtExpected pins the CLF to exactly 1.000, so no stop of the curve being
// scored is consulted anywhere in forming poolPremium.
//
// Each row carries its OWN drawn `horizon` and development stops once age passes
// it, so a row counts only when its last valuation is at or past that horizon.
// No worst-case bound, no fixed maturity age. Seeded cohorts are excluded: they
// are apportioned from a drawn reserve total rather than summed from claims, so
// their first entry is a game-start estimate and not an inception register.
//
// ⚠ THIS IS WHY THE RUN IS 22 YEARS. WC's horizon is drawn on [5, 12], so a WC
// accident year needs up to twelve further years to settle. At ten years the
// sample would be a handful of short-horizon cohorts — a biased subset, not a
// small one, because short horizons are not a random sample of accident years.
//
// ============================================================================
// ⚠ WC AND PROPERTY KEEP THEIR CALENDAR-BASIS TABLES. RULED, NOT OUTSTANDING.
//
// This is a DECISION and not an unresolved red. A reader who finds WC at -11.0
// below should not spend a day re-deriving it: that was costed and declined.
//
//   WC        -7.0 / -11.0 / -7.5 on this basis, and green on the calendar basis
//             it was derived on. Re-deriving would raise every off-Expected stop
//             by 3.2% to 6.0% — see the INDICATED CURVE section the run prints.
//
//   Property  +7.9 (thin, ungated) / -4.4 / -1.7. Close enough on both bases
//             that re-deriving buys almost nothing; its indicated curve moves
//             -2.6% to +4.0% and is inside a point at the stops that matter.
//
//   GL        stays on GL_SUPPLIED, and is the case that carried the basis
//             change: -0.5 to +1.7pp from the 70% stop up, against -21.7pp on
//             the calendar basis. Its accident-year ratio CV is 0.4168 against
//             the supplied curve's implied 0.3979.
//
// ⚠ AND WC CARRIES AN OBJECTION THE OTHER TWO DO NOT, which is what decided it.
// A default game is ten years and WC's runoff horizon is drawn on [5, 12], so a
// WC accident year written in a game can outlive it. Measured: only 16.4% of WC
// accident years written in a ten-year game reach their own horizon before it
// ends, against GL 45.3% and Property 71.0%. A WC table derived on settled
// ultimate would charge for cost the player never sees land in their own P&L in
// FIVE GAMES OUT OF SIX.
//
// That does not make the basis wrong — funding IS a claim about ultimate cost,
// and ultimate cost is unobservable at the moment of the decision in real
// ratemaking too. It makes WC the line where the accident-year basis buys the
// least and costs the most, and the ruling followed the measurement.
//
// ⚠ WHAT THE RULING ACCEPTS, NAMED SO IT IS NOT DISCOVERED LATER. The slider
// carries the same words on all three lines while GL's curve now describes
// accident years and WC's and Property's describe calendar years. So "75%
// confidence" does not mean exactly the same thing per line. That is a real
// user-facing inconsistency, it was chosen with the numbers above in view, and
// closing it means re-deriving two tables and accepting a 3-6% WC premium rise
// for cost most players never see.
//
// ============================================================================
// ⚠ OPEN QUESTION: SHOULD WC AND PROPERTY BE GATED ON THIS BASIS AT ALL?
//
// They are, today. Every line is scored on accident-year ultimate and the worst
// band on any line fails the run. The alternative raised when the ruling above
// was taken: REPORT WC and Property, and assert only GL.
//
// WHAT THAT WOULD LOSE, and it is not nothing. The calendar-year panel below is
// printed but not gated. So dropping WC and Property from the accident-year gate
// would leave them asserted by NOTHING — a regression that moved WC's table, or
// moved the loss model underneath it, would produce no red anywhere in this file.
// The positive control would still fire, but proving the instrument works is not
// the same as asserting the curve is right.
//
// THE VERSION THAT LOSES LESS: gate each line on the basis ITS OWN table was
// built on — GL on accident-year, WC and Property on calendar-year — and report
// both for all three. Every line stays under a live bar, and every red is then
// actionable rather than definitional.
//
// ⚠ AND IT WOULD NOT PRODUCE A GREEN GATE EITHER, which is the honest part.
// Measured at this commit, WC on its OWN calendar basis still reads -7.2pp on
// the small band, and GL on accident-year reads -11.6pp at the 30% stop. Both
// are real residuals, neither is a basis artefact, and neither would be silenced
// by re-pointing the gate. So the choice is about what a red MEANS, not about
// turning the gate green — and no version of it should be adopted on the grounds
// that it reads better.
//
// Recorded rather than taken: changing what the gate asserts is a decision about
// coverage, and it belongs to whoever owns the ruling above.
//
// ============================================================================
// ⚠ REPORTED WITH A CI, GATED ON THE WORST STOP IN THE WORST BAND, AND CARRYING
// A POSITIVE CONTROL. A gate that reads near zero needs proof it can move at
// all, more than one reading 22pp did. Every run re-scores a deliberately
// mis-scaled copy of each shipped table and asserts it FAILS. If the control
// goes quiet the gate is blind and the run fails on that alone.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { STATIC_CLF_TABLE, staticClf, clfFromTable } from '../../src/data/clfTables';
import { PER_CLAIM_REVISION } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ReserveDevelopmentRow } from '../../src/types/simulation';

const RULE = '='.repeat(78);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// PER ARM, so the run is GAMES x ARMS.length games.
const GAMES = Number(process.env.GAMES ?? 40);
// Long enough for WC to settle — see the maturity note in the header. Shortening
// this does not shrink the sample evenly; it selects short-horizon cohorts.
const YEARS = Number(process.env.YEARS ?? 22);
// The game length a player actually chooses, used only to report how much of an
// accident year's runoff falls outside it.
const PLAYER_GAME_YEARS = 10;

// The label error tolerance, in percentage points. A GROSS-ERROR DETECTOR: at
// the sample this collects a realised proportion carries a standard error near
// 1pp pooled and near 2pp in the smallest gated band, so anything under ~5pp
// cannot be cleanly separated from sampling here and belongs to a re-derivation
// rather than to a gate.
const MAX_LABEL_ERROR_PP = 5.0;

// How far the control perturbs each table. Large enough to clear the tolerance
// on a correct table, small enough that it is testing detection rather than
// arithmetic.
const CONTROL_SCALE = 1.10;

// The book bands, on enrolled members, matching clf-table-derive.ts's BAND mode
// so the two can be read against each other line for line. The labels name the
// band's approximate median book rather than its edges.
const BOOK_BANDS: [number, number, string][] = [
  [0, 72, 'small ~64'], [72, 88, 'mid ~80'], [88, 9999, 'large ~97'],
];
const bandOf = (n: number) => BOOK_BANDS.findIndex(([lo, hi]) => n >= lo && n < hi);
// A band below this many accident years is reported but not gated: its standard
// error is too wide for a 5pp bar to mean anything. Reporting it anyway keeps
// the thinness visible instead of hiding the band.
const MIN_BAND_N = 250;

// ⚠ FOUR ARMS, AND THE MIDDLE TWO ARE NOT PADDING. At all defaults the book only
// grows, so a small book is almost always an EARLY YEAR, and gating that would
// test book age wearing a book-size label. The new-business appetite bar is what
// separates them: a strict bar shrinks the book instead. Every arm is real play.
//
// ⚠ AND RUNNING ONLY THE TWO EXTREMES WAS TRIED AND WAS WRONG. With just Accept
// All and the 0.75 bar, the small band is almost entirely 0.75-arm years and the
// large band almost entirely Accept-All ones, so BAND BECOMES A PROXY FOR ARM —
// and since the bar changes the book's COMPOSITION as well as its size, the
// per-band error then reports underwriting selection under a book-size heading.
// These are the same four arms clf-table-derive.ts samples, so the gate evaluates
// on the population the tables were fitted on.
const ARMS: (number | null)[] = [null, 1.50, 1.00, 0.75];

const failed: string[] = [];

/** One settled accident year: what it cost, and what was charged for it. */
interface AccidentYear {
  members: number;
  premium: number;
  /** The accident year's own net ultimate, after all development. THE GATE. */
  ultimate: number;
  /** netIncurredLoss in that same calendar year. Reported, never gated. */
  incurred: number;
}

interface Collected {
  ay: Record<string, AccidentYear[]>;
  /** Share of accident years reaching their own horizon within PLAYER_GAME_YEARS. */
  settledInPlayerGame: Record<string, { reached: number; total: number }>;
}

function shippedRun(): Collected {
  const ay: Record<string, AccidentYear[]> = { WC: [], GL: [], Property: [] };
  const settled: Record<string, { reached: number; total: number }> = {
    WC: { reached: 0, total: 0 }, GL: { reached: 0, total: 0 }, Property: { reached: 0, total: 0 },
  };

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

      // What was charged for each accident year, and the book that year carried.
      const charged: Record<string, Map<number, { premium: number; members: number; incurred: number }>> = {
        WC: new Map(), GL: new Map(), Property: new Map(),
      };
      for (let y = 1; y <= YEARS; y++) {
        const d = defaultDecisionSet(y);
        for (const line of LINES) d.byLine[line].newBusinessAppetite = arm;
        const p = processYear(gs, d);
        for (const line of LINES) {
          const lr = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
          if (lr && lr.poolPremium > 0 && Number.isFinite(lr.netIncurredLoss)) {
            charged[line].set(y, {
              premium: lr.poolPremium, members: lr.activeMembers, incurred: lr.netIncurredLoss,
            });
          }
        }
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      }

      const ps = gs.poolState as never as {
        lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[] }>;
      };
      for (const line of LINES) {
        for (const row of ps.lines[line]?.reserveDevelopment ?? []) {
          if (row.seeded) continue;
          const u = row.ultimateByValuation ?? [];
          if (u.length === 0) continue;
          const age = row.ageAtFirstValuation + (u.length - 1);

          // Would this accident year have settled inside a game the player
          // actually plays? Counted on every row, mature or not.
          if (row.yearNumber >= 1 && row.yearNumber <= PLAYER_GAME_YEARS) {
            settled[line].total++;
            if (PLAYER_GAME_YEARS - row.yearNumber >= row.horizon) settled[line].reached++;
          }

          if (age < row.horizon) continue;
          const c = charged[line].get(row.yearNumber);
          if (!c || !(c.premium > 0)) continue;
          ay[line].push({
            members: c.members, premium: c.premium,
            ultimate: u[u.length - 1], incurred: c.incurred,
          });
        }
      }
    }
  }
  return { ay, settledInPlayerGame: settled };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const cvOf = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1)) / m;
};

/** Share of `rows`, in percent, coming in at or under `mult` x their own premium. */
const delivered = (rows: AccidentYear[], mult: number, pick: (r: AccidentYear) => number) =>
  (100 * rows.filter(r => pick(r) <= mult * r.premium).length) / Math.max(1, rows.length);

const ULT = (r: AccidentYear) => r.ultimate;
const INC = (r: AccidentYear) => r.incurred;

const stopsOf = (line: string) => STATIC_CLF_TABLE[line as 'WC' | 'GL' | 'Property'].stops
  .map(s => s / 100)
  .filter(c => c >= 0.30 && c <= 0.95)   // the slider's own reachable range
  .sort((a, b) => b - a);

console.log(RULE);
console.log('CLF LABEL BACKTEST — what the funding slider\'s percentage actually delivers');
console.log(RULE);
console.log(`${GAMES} games x ${ARMS.length} appetite arms x ${YEARS} years on the SHIPPED mechanism `
  + `(PER_CLAIM_REVISION.enabled = ${PER_CLAIM_REVISION.enabled}).`);
console.log('ACCIDENT-YEAR basis: each settled accident year\'s own net ultimate against the');
console.log('premium charged for that same year. Only years past their own drawn horizon.\n');

const { ay: obs, settledInPlayerGame } = shippedRun();

// --- 0. how much of the runoff a real game actually sees -------------------
console.log('--- WHAT A TEN-YEAR GAME OBSERVES ---');
console.log('  Share of accident years written in a player-length game that reach their own');
console.log('  horizon before it ends. A low share means this basis charges for cost the');
console.log('  player never sees land in their own P&L.\n');
for (const line of LINES) {
  const s = settledInPlayerGame[line];
  const pct = s.total > 0 ? (100 * s.reached) / s.total : NaN;
  console.log(`  ${line.padEnd(9)} ${Number.isFinite(pct) ? pct.toFixed(1).padStart(5) : '  n/a'}%  `
    + `(${s.reached.toLocaleString()} of ${s.total.toLocaleString()} accident years)`);
}

// --- 1. the two bases side by side ----------------------------------------
console.log('\n--- THE TWO BASES, on the same settled accident years ---');
console.log('  line       settled AYs   accident-year  CV        calendar-year  CV        table CV');
for (const line of LINES) {
  const o = obs[line];
  if (o.length === 0) { failed.push(`${line}: no settled accident years collected`); continue; }
  const T = STATIC_CLF_TABLE[line as 'WC' | 'GL' | 'Property'];
  const gi = (p: number) => T.clf[T.stops.indexOf(p)];
  const impliedCv = T.stops.includes(75) && T.stops.includes(25) && T.stops.includes(50)
    ? ((gi(75) - gi(25)) / 1.349) / gi(50) : NaN;
  const a = o.map(r => r.ultimate / r.premium);
  const c = o.map(r => r.incurred / r.premium);
  console.log(`  ${line.padEnd(9)} ${String(o.length).padStart(12)}   `
    + `${mean(a).toFixed(4).padStart(10)}  ${cvOf(a).toFixed(4)}   `
    + `${mean(c).toFixed(4).padStart(12)}  ${cvOf(c).toFixed(4)}   `
    + `${(Number.isFinite(impliedCv) ? impliedCv.toFixed(4) : 'n/a').padStart(8)}`);
}

// --- 2. pooled stops, the gated basis --------------------------------------
console.log('\n--- ACCIDENT-YEAR BASIS, pooled ---');
console.log('  line      stop   multiplier   nominal   delivered    error     +-1 SE');
for (const line of LINES) {
  const o = obs[line];
  if (o.length === 0) continue;
  for (const p of stopsOf(line)) {
    const mult = staticClf(line as 'WC' | 'GL' | 'Property', p);
    const hit = delivered(o, mult, ULT) / 100;
    const se = Math.sqrt(Math.max(1e-12, hit * (1 - hit) / o.length));
    const err = 100 * (hit - p);
    console.log(`  ${line.padEnd(9)} ${(100 * p).toFixed(1).padStart(5)}%  ${mult.toFixed(4).padStart(9)}   `
      + `${(100 * p).toFixed(1).padStart(6)}%   ${(100 * hit).toFixed(1).padStart(8)}%  `
      + `${`${err >= 0 ? '+' : ''}${err.toFixed(1)}`.padStart(6)}   ${(100 * se).toFixed(2)}pp`);
  }
  console.log('');
}

// --- 3. per band, both bases; only the accident-year one gates -------------
let worst = { line: '', stop: 0, err: 0, band: '' };
for (const [label, pick, gated] of [
  ['ACCIDENT-YEAR — THE GATE', ULT, true],
  ['CALENDAR-YEAR INCURRED — reported, NOT gated', INC, false],
] as const) {
  console.log(`--- BY BOOK SIZE: ${label} ---`);
  for (const line of LINES) {
    const o = obs[line];
    if (o.length === 0) continue;
    const stops = stopsOf(line);
    const books = o.map(r => r.members).sort((a, b) => a - b);
    console.log(`  ${line} — book p10 ${books[Math.floor(0.1 * books.length)]}, `
      + `median ${books[Math.floor(0.5 * books.length)]}, p90 ${books[Math.floor(0.9 * books.length)]}`);
    console.log('    band             n   ' + stops.map(p => `${(100 * p).toFixed(0)}%`.padStart(7)).join('')
      + '     worst');
    for (let b = 0; b < BOOK_BANDS.length; b++) {
      const cell = o.filter(r => bandOf(r.members) === b);
      if (cell.length === 0) continue;
      const errs = stops.map(p => delivered(cell, staticClf(line as 'WC' | 'GL' | 'Property', p), pick) - 100 * p);
      const w = errs.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
      const countable = gated && cell.length >= MIN_BAND_N;
      if (countable && Math.abs(w) > Math.abs(worst.err)) {
        worst = { line, stop: stops[errs.indexOf(w)], err: w, band: BOOK_BANDS[b][2] };
      }
      console.log(`    ${BOOK_BANDS[b][2].padEnd(11)}${String(cell.length).padStart(6)}   `
        + errs.map(e => `${e >= 0 ? '+' : ''}${e.toFixed(1)}`.padStart(7)).join('')
        + `   ${Math.abs(w) > MAX_LABEL_ERROR_PP ? '!' : ' '}${w >= 0 ? '+' : ''}${w.toFixed(1)}`
        + (gated && cell.length < MIN_BAND_N ? '  (thin, not gated)' : ''));
    }
    console.log('');
  }
}

// --- 4. what each failing line's table would have to be --------------------
// Printed, never written. Its only job is to put a number in front of the
// re-derivation decision instead of leaving it as "re-derive it".
const q = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))];
console.log('--- INDICATED CURVE on this basis, against what ships ---');
console.log('  The accident-year percentiles of each line\'s own settled ratio, beside the');
console.log('  shipped multiplier. The gap at a stop is what re-deriving would move.\n');
console.log('  line      stop    shipped   indicated     change');
for (const line of LINES) {
  const o = obs[line];
  if (o.length === 0) continue;
  const sorted = o.map(r => r.ultimate / r.premium).sort((a, b) => a - b);
  for (const p of [0.90, 0.75, 0.60, 0.50, 0.30]) {
    const ship = staticClf(line as 'WC' | 'GL' | 'Property', p);
    const ind = q(sorted, 100 * p);
    console.log(`  ${line.padEnd(9)} ${(100 * p).toFixed(0).padStart(3)}%  ${ship.toFixed(4).padStart(9)}   `
      + `${ind.toFixed(4).padStart(9)}   ${(ind >= ship ? '+' : '') + (100 * (ind / ship - 1)).toFixed(1)}%`);
  }
  console.log('');
}

// --- 5. POSITIVE CONTROL ---------------------------------------------------
// A gate reading near zero has to prove it can read something else. Each
// shipped table is re-scored with every multiplier scaled by CONTROL_SCALE; a
// uniformly inflated curve must breach the tolerance somewhere on every line.
console.log('--- POSITIVE CONTROL: every table re-scored at ' + `x${CONTROL_SCALE}` + ' must FAIL ---');
const controlSilent: string[] = [];
for (const line of LINES) {
  const o = obs[line];
  if (o.length === 0) continue;
  const T = STATIC_CLF_TABLE[line as 'WC' | 'GL' | 'Property'];
  const bent = { ...T, clf: T.clf.map(v => v * CONTROL_SCALE) };
  const errs = stopsOf(line).map(p => delivered(o, clfFromTable(bent, p), ULT) - 100 * p);
  const w = errs.reduce((a, x) => (Math.abs(x) > Math.abs(a) ? x : a), 0);
  const fires = Math.abs(w) > MAX_LABEL_ERROR_PP;
  console.log(`  ${line.padEnd(9)} worst error on the bent curve `
    + `${(w >= 0 ? '+' : '') + w.toFixed(1)}pp   ${fires ? 'FIRES — the gate can see it' : '⚠ SILENT'}`);
  if (!fires) controlSilent.push(line);
}
if (controlSilent.length > 0) {
  failed.push(`POSITIVE CONTROL SILENT on ${controlSilent.join(', ')}: a table inflated by `
    + `${Math.round(100 * (CONTROL_SCALE - 1))}% still reads inside ${MAX_LABEL_ERROR_PP}pp. `
    + 'The measurement cannot detect a wrong curve, so nothing else this gate reports is worth '
    + 'anything. Fix the instrument before reading its verdict.');
}

console.log('');
console.log(`  settled accident years: ${LINES.map(l => `${l} ${obs[l].length}`).join(', ')}`);
if (worst.line) {
  console.log(`  WORST LABEL ERROR: ${worst.line} at the ${(100 * worst.stop).toFixed(1)}% stop `
    + `on the ${worst.band} book, ${(worst.err >= 0 ? '+' : '') + worst.err.toFixed(1)}pp `
    + `against a ${MAX_LABEL_ERROR_PP}pp tolerance`);
}

if (Math.abs(worst.err) > MAX_LABEL_ERROR_PP) {
  failed.push(`${worst.line}'s ${(100 * worst.stop).toFixed(1)}% funding stop delivers `
    + `${(100 * worst.stop + worst.err).toFixed(1)}% of accident years on the ${worst.band} book — a `
    + `${(worst.err >= 0 ? '+' : '') + worst.err.toFixed(1)}pp label error. The indicated curve above `
    + 'says what re-deriving on this basis would move. ⚠ CHECK THE CALENDAR-YEAR PANEL FIRST: a line '
    + 'that is green there and red here is not a broken table, it is a table derived on the other '
    + 'basis. ⚠ AND ON WC AND PROPERTY THAT HAS ALREADY BEEN RULED ON — both keep their '
    + 'calendar-basis tables, costed and declined, see the ruling note at the head of this file and '
    + 'the EXPECTED_RED entry in scripts/gates.ts. Do not re-derive either on the strength of this '
    + 'line. GL is not part of that ruling.');
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log(`${failed.length} FAILURE(S):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log('');
  console.log('⚠ READ THE BASIS NOTE AT THE HEAD OF THIS FILE BEFORE ACTING ON A NUMBER HERE.');
  console.log('  This gate has been wrong about its own basis twice, and both times the wrong');
  console.log('  figure was used to argue for changing the loss model.');
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('CLF LABELS HOLD — every funding stop delivers its nominal confidence within');
  console.log(`${MAX_LABEL_ERROR_PP}pp of the accident years it was charged for, at every book size`);
  console.log('the game reaches, not merely on average across them. The positive control fired');
  console.log('on every line, so the measurement can tell a wrong curve from a right one.');
  console.log(RULE);
}
