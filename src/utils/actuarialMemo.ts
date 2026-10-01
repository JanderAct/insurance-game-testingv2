// THE ACTUARIAL MEMORANDUM — the reserve development exhibit.
//
// One row per accident year, oldest first, showing how this pool's ESTIMATE of
// that year's ultimate loss has moved since it was first booked.
//
// ⚠ ULTIMATE, NOT INCURRED, AND THE WORD IS LOAD-BEARING. Friedland reserves
// "reported claims" for paid plus case outstanding. This exhibit is about the
// GAP between that reported figure and the estimate of where the year finally
// lands, so using the ambiguous word exactly where the distinction is the point
// would defeat the exhibit. Every figure here is an estimate of ultimate, net
// of reinsurance, on the same basis as the reserve rollforward.
//
// ⚠ WHAT IT DELIBERATELY DOES NOT SHOW: the true ultimate (registerSum) and the
// booking bias. The player sees the estimate develop and works out the cause.
// Printing the bias would hand over the answer to the only question the exhibit
// asks. The single exception is at GAME END, where the un-emerged deficiency is
// disclosed — the game is over and the reveal is the point.
//
// ⚠ SIGN CONVENTION, STATED BECAUSE THE ENGINE'S IS THE OPPOSITE. Here a
// POSITIVE development means the estimate ROSE — adverse. The engine's
// `developmentImpact` is positive for FAVOURABLE development (it is subtracted
// from incurred), which is right for that arithmetic and wrong for a reader:
// an actuary reading a development exhibit expects adverse to be positive. The
// two are negatives of each other and the memo says so in prose.

import type {
  CoverageLine, GameState, LinePoolState, ReserveDevelopmentRow,
} from '../types/simulation';
import { ibnerUnwindWeight } from './simulationEngine';
import { cumulativePaid } from './payoutPattern';
import { LINE_PAYOUT_PATTERN, TRIANGLE_HISTORY_YEARS } from '../data/defaultAssumptions';
import { pricingExperienceBasis, windowRows } from './pricingTriangle';
import { experienceRatePer100 } from './experienceRating';
import { clfFor } from './fundingConsequence';
import { lineDisplayName } from './lineDisplay';

// A line's share of ultimate paid by the end of its accident year, from the
// payout pattern the engine pays on — so the memo's "GL near 10%, Property past
// 50%" follows the pattern rather than restating it.
function firstYearPaidPct(line: string): string {
  return `${Math.round(100 * cumulativePaid(LINE_PAYOUT_PATTERN[line], 1))}%`;
}

// One accident year as the exhibit presents it, at a chosen valuation year.
// Nulls are EMPTY CELLS, not zeros: a year with no prior valuation has not
// failed to develop, it has had no opportunity to.
export interface ExhibitRow {
  yearNumber: number;
  calendarYear: number;
  seeded: boolean;
  initial: number;
  prior: number | null;
  current: number;
  oneYear: number | null;
  total: number | null;
  // ⚠ PAST THE HORIZON. NOT "matured", AND NOT "settled" BEFORE THAT — THE NAME
  // HAS NOW BEEN WRONG TWICE AND BOTH TIMES THE SAME WAY.
  //
  // Reaching the horizon means IBNER has stopped developing the cohort. It does
  // NOT mean the accident year is finished, and it does NOT mean the estimate
  // cannot move: claims revise while they are open, and under PER_CLAIM_REVISION
  // they go on doing so long past the cohort's horizon. processIbner's own header
  // draws the first distinction — "runoff and development are separate clocks:
  // the horizon governs how long the ESTIMATE is uncertain, the payout pattern
  // governs how fast it is settled".
  //
  // "settled" collapsed maturity into CLOSURE and was renamed for it. "matured"
  // then collapsed the horizon into FINALITY — this file blanked the 1-year
  // column on the strength of it, asserting the year could not move — and that
  // was false under the cohort law too, just less often: 345 exhibits moved after
  // their horizon with PER_CLAIM_REVISION off, and 759 with it on. The rename
  // fixed the word and left the claim.
  //
  // `pastHorizon` states the fact and nothing more. Nothing printed may infer
  // finality from it.
  pastHorizon: boolean;
  /** True only for the collapsed Prior row. */
  isPrior: boolean;

  // ============================================================================
  // PAID, AND THE PAID-TO-INCURRED RATIO — BOTH NET, LIKE EVERY COLUMN ABOVE.
  //
  // ⚠ THE GROSS VERSION WAS BUILT FIRST AND WAS REJECTED ON MEASUREMENT, not on
  // taste. A gross paid column beside a net ultimate is the mixed-basis reading
  // this project produces most, and making the RATIO gross needed a second
  // stored series for its denominator — which took cohort-stock-check's
  // poolState growth ratio from 0.65 to 0.76 against a 0.75 limit. So the
  // exhibit is net throughout: every cell here is subtractable against every
  // other, and paidToIncurred is netPaid over netUltimate with no conversion in
  // it. See ReserveDevelopmentRow.paidByValuation.
  //
  // The claims workbook is GROSS throughout for the same reason in reverse. The
  // two documents do not tie to each other and are not meant to; the difference
  // is what the tower is carrying.
  //
  // WHY THE RATIO IS WORTH A COLUMN: it is what says whether an accident year is
  // nearly settled or still moving, and it only became informative once the
  // payout patterns made the three lines differ — before them every line paid
  // down at one rate and the ratio carried no per-line signal. Net Paid Losses is
  // one calendar-year total per line, so nothing anywhere showed a year-one GL
  // accident year sitting at 10% paid.
  //
  // Null where the ledger has no entry — the same empty-cell-is-not-a-zero rule
  // the rest of this exhibit follows.
  // ============================================================================
  paid: number | null;
  paidToIncurred: number | null;
}

// ============================================================================
// THE PRIOR BOUNDARY — accident years OLDER than this collapse into one row.
//
// ⚠ NOT AN ARBITRARY CUT-OFF. It is exactly the line between cohorts that have a
// claim register and cohorts that do not. Accident years -2, -1 and 0 were run
// through processLineYear and have real registers behind them, so their INITIAL
// column is a real original estimate. Everything older is a SEED cohort,
// apportioned from a drawn reserve total at generation with no claims behind it
// at all — its "initial" is a game-start valuation and not an original estimate.
//
// So the collapse separates rows whose initial value means something from rows
// whose does not, and the "as at game start" caveat now attaches to ONE row
// rather than being sprinkled across four that a reader has to check
// individually. Collapsing to a Prior row is also simply what a development
// exhibit does.
// ============================================================================
export const PRIOR_BOUNDARY = -2;
/** Sentinel accident year for the collapsed row, so it sorts first. */
export const PRIOR_ROW_YEAR = -9999;

// The estimate as at valuation year `v`, clamped at both ends.
//
// ⚠ CLAMPING FORWARD IS CORRECT, NOT A FALLBACK. Recording stops when a cohort
// closes, but a cohort may only close once MATURED, and a matured cohort's
// ultimate is frozen — paydown moves dollars from unpaid to paid and
// `ultimate = paid + unpaid` is unchanged by it, closure included. So the last
// recorded figure IS the estimate at every later valuation.
function ultimateAt(row: ReserveDevelopmentRow, v: number): number {
  const i = v - row.firstValuationYear;
  const h = row.ultimateByValuation;
  return h[Math.max(0, Math.min(i, h.length - 1))];
}

// A ledger series at valuation `v`, clamped forward exactly as ultimateAt is and
// for the same reason: recording stops when a cohort closes, and a closed cohort
// has paid everything it will pay, so the last entry IS the figure at every later
// valuation. Null when the series is absent — a row written before the paid
// ledger existed has no paid history, which is not the same as having paid zero.
function seriesAt(series: number[] | undefined, row: ReserveDevelopmentRow, v: number): number | null {
  if (!series || series.length === 0) return null;
  const i = v - row.firstValuationYear;
  return series[Math.max(0, Math.min(i, series.length - 1))];
}

// Could this accident year have developed during valuation year `v`?
//
// processIbner tests `age < horizon` with the age the cohort held ENTERING the
// year, then increments. Age entering v is ageAt(v) - 1, so development was
// possible iff ageAt(v) - 1 < horizon, i.e. ageAt(v) <= horizon. A cohort that
// matured DURING year v therefore still shows that year's movement, and only
// the years after it read as settled.
function ageAt(row: ReserveDevelopmentRow, v: number): number {
  return row.ageAtFirstValuation + (v - row.firstValuationYear);
}

export function exhibitRows(ledger: ReserveDevelopmentRow[], asAt: number): ExhibitRow[] {
  return ledger
    .filter(r => asAt >= r.firstValuationYear)
    .map(r => {
      const current = ultimateAt(r, asAt);
      const initial = r.ultimateByValuation[0];
      const isFirst = asAt === r.firstValuationYear;
      const prior = isFirst ? null : ultimateAt(r, asAt - 1);
      const paid = seriesAt(r.paidByValuation, r, asAt);
      return {
        yearNumber: r.yearNumber,
        calendarYear: r.calendarYear,
        seeded: r.seeded,
        initial,
        current,
        prior,
        oneYear: prior === null ? null : current - prior,
        total: isFirst ? null : current - initial,
        pastHorizon: ageAt(r, asAt) > r.horizon,
        isPrior: false,
        paid,
        // NET over NET — `current` is this row's net ultimate at the same
        // valuation, so no conversion enters the quotient.
        paidToIncurred: paid !== null && current > 0 ? paid / current : null,
      };
    })
    .sort((a, b) => a.yearNumber - b.yearNumber);
}

// The pool total: the same exhibit summed across lines.
//
// SUMMING IS LEGITIMATE HERE and that is not true of every pool-scope figure on
// this project. All three lines' estimates are DOLLARS ON ONE BASIS — net of
// reinsurance, at ultimate, same valuation date — so addition is the operation
// the quantity supports. Contrast the rate and ratio fields, which have no pool
// meaning at all and are placeholdered rather than added.
export function poolExhibitRows(perLine: ExhibitRow[][]): ExhibitRow[] {
  const byYear = new Map<number, ExhibitRow[]>();
  for (const rows of perLine) {
    for (const r of rows) {
      const list = byYear.get(r.yearNumber);
      if (list) list.push(r); else byYear.set(r.yearNumber, [r]);
    }
  }
  return [...byYear.entries()]
    .map(([yearNumber, rows]) => {
      const sum = (pick: (r: ExhibitRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
      // A null in ANY contributing line makes the pool cell empty rather than a
      // partial sum. In practice every active line inceptes the same accident
      // year in the same valuation, so the nulls arrive in lockstep and this
      // only ever fires on the newest year — but a partial sum presented as a
      // total is the pool-aggregation defect class this project has already
      // fixed seven times, so the rule is written rather than assumed.
      const anyNull = (pick: (r: ExhibitRow) => number | null) => rows.some(r => pick(r) === null);
      return {
        yearNumber,
        calendarYear: rows[0].calendarYear,
        seeded: rows.every(r => r.seeded),
        initial: sum(r => r.initial),
        prior: anyNull(r => r.prior) ? null : sum(r => r.prior ?? 0),
        current: sum(r => r.current),
        oneYear: anyNull(r => r.oneYear) ? null : sum(r => r.oneYear ?? 0),
        total: anyNull(r => r.total) ? null : sum(r => r.total ?? 0),
        // Matured only when EVERY contributing line has stopped developing. One
        // line still moving makes the pool row still moving.
        pastHorizon: rows.every(r => r.pastHorizon),
        isPrior: false,
        // ⚠ THE RATIO IS RE-DERIVED FROM THE SUMMED DOLLARS, NEVER AVERAGED.
        // Adding three lines' paid-to-incurred ratios is meaningless and
        // averaging them is worse — it would weight a small line equally with a
        // large one and read as a pool figure. Sum the two dollar columns, then
        // divide once.
        paid: anyNull(r => r.paid) ? null : sum(r => r.paid ?? 0),
        paidToIncurred: anyNull(r => r.paid) || sum(r => r.current) <= 0
          ? null
          : sum(r => r.paid ?? 0) / sum(r => r.current),
      };
    })
    .sort((a, b) => a.yearNumber - b.yearNumber);
}

// Fold every accident year older than PRIOR_BOUNDARY into a single Prior row at
// the top. Applied LAST, to whichever row set is being rendered — per line, or to
// the pooled set — which is equivalent either way because both operations are
// sums.
//
// ⚠ PRIOR'S COLUMNS ARE SUMMED, NOT RE-DERIVED. initial, current, prior and the
// two development columns each add their constituents directly, so the row ties
// to the cohorts it replaces by construction rather than by a second calculation
// that could drift from them. actuarial-memo-check asserts the tie.
export function collapsePrior(rows: ExhibitRow[]): ExhibitRow[] {
  const old = rows.filter(r => r.yearNumber < PRIOR_BOUNDARY);
  const kept = rows.filter(r => r.yearNumber >= PRIOR_BOUNDARY);
  if (old.length === 0) return kept;

  const sum = (pick: (r: ExhibitRow) => number) => old.reduce((s, r) => s + pick(r), 0);
  const anyNull = (pick: (r: ExhibitRow) => number | null) => old.some(r => pick(r) === null);
  const priorRow: ExhibitRow = {
    yearNumber: PRIOR_ROW_YEAR,
    calendarYear: Math.min(...old.map(r => r.calendarYear)),
    // Every cohort inside Prior is a seed cohort by construction — that IS the
    // boundary. Asserted rather than assumed, because a non-seeded year falling
    // in here would mean the cut had drifted off the register line it is
    // supposed to trace.
    // ⚠ `some`, NOT `every`, AND THIS IS THE HALF THE GATE WAS ASSERTING WRONG.
    // When this collapse was written the pre-game was PRE_GAME_YEARS = 3 — years
    // -2, -1 and 0 — so everything older than PRIOR_BOUNDARY really was a seed
    // cohort and `every` and `some` agreed. MATURATION_YEARS = 7 (556cef5) then
    // put seven PLAYED accident years, -9 to -3, inside Prior, each with a real
    // claim register. `every` has read false ever since, so the dagger stopped
    // rendering at all and the caveat it carries stopped being shown.
    //
    // The honest claim is that the row CONTAINS carried-in years, which is what
    // the caveat is about: Prior's INITIAL column is now a mixture of real
    // original estimates and game-start valuations, and a reader needs to know
    // the mixture is there. `every` would only be true again if the boundary were
    // moved back onto the register line.
    seeded: old.some(r => r.seeded),
    initial: sum(r => r.initial),
    prior: anyNull(r => r.prior) ? null : sum(r => r.prior ?? 0),
    current: sum(r => r.current),
    oneYear: anyNull(r => r.oneYear) ? null : sum(r => r.oneYear ?? 0),
    total: anyNull(r => r.total) ? null : sum(r => r.total ?? 0),
    // Still developing if ANY constituent is. One live cohort inside Prior makes
    // the whole row live.
    pastHorizon: old.every(r => r.pastHorizon),
    isPrior: true,
    // Summed and then divided once, exactly as at pool scope and for the same
    // reason: a ratio of sums, never a sum or an average of ratios.
    paid: anyNull(r => r.paid) ? null : sum(r => r.paid ?? 0),
    paidToIncurred: anyNull(r => r.paid) || sum(r => r.current) <= 0
      ? null
      : sum(r => r.paid ?? 0) / sum(r => r.current),
  };
  return [priorRow, ...kept];
}

// ⚠ ONE UNIT, IN THE HEADER, NOT PER CELL. Every dollar figure in the exhibit
// is millions to two decimals, so a reader can add a column down and subtract
// across a row and get the printed answer exactly. That is a property the
// harness asserts (initial + total === current, prior + 1yr === current, both
// on the RENDERED strings), and a mixed $K/$M/$B compact format would destroy
// it — the same 10^6 unit trap the Calculation Audit page was carrying.
function m(value: number): string {
  const s = (value / 1_000_000).toFixed(2);
  // ⚠ NEGATIVE ZERO IS A PRINTING DEFECT, NOT A SMALL NEGATIVE. A cohort that
  // developed by -$400 prints "-0.00", which reads as "favourable, too small to
  // show" when the honest reading at this precision is "did not move". Both
  // signs collapse to 0.00 at the displayed precision, so print the one that
  // does not imply a direction the figure cannot support.
  return s === '-0.00' ? '0.00' : s;
}

// An empty cell. Em dash, never "0.00": the difference between "did not move"
// and "had no opportunity to move" is the exhibit's whole subject.
const EMPTY = '—';

// The paid-to-incurred ratio, as a percentage to one decimal. Not put through
// m(): it is not dollars and dividing it by 10^6 would render every row 0.00.
function ratioCell(value: number | null): string {
  return value === null ? EMPTY : `${(value * 100).toFixed(1)}%`;
}

function cell(value: number | null): string {
  return value === null ? EMPTY : m(value);
}

const HEADER =
  '| Accident year | Initial ultimate $M | Prior year ultimate $M | Current ultimate $M ' +
  '| 1-yr development $M | Total development $M | Paid to date $M | Paid / ultimate |\n' +
  '|---|---:|---:|---:|---:|---:|---:|---:|';

function renderTable(rows: ExhibitRow[]): string {
  if (rows.length === 0) return '_No accident years on this exhibit yet._';
  const body = rows.map(r => {
    const label = r.isPrior
      ? `**Prior** (to ${r.calendarYear})${r.seeded ? ' †' : ''}`
      : `${r.yearNumber} (${r.calendarYear})${r.seeded ? ' †' : ''}`;
    // ⚠ THE 1-YEAR CELL IS BLANK FOR EXACTLY ONE REASON: THERE IS NO EARLIER
    // VALUATION TO SUBTRACT. It used to blank whenever the row was past its
    // horizon as well, on the claim that such a year "cannot develop further" —
    // and that claim was false, so the exhibit printed a blank beside a figure
    // that had visibly moved. 759 of them on the current law.
    //
    // THE TWO MEANINGS LOOK IDENTICAL ON A PAGE AND ARE OPPOSITE: "nothing to
    // measure" (no prior valuation — the year is new) against "measured and it
    // cannot change" (a claim about the future). Only the first is ever true
    // here, and `cell` renders it from `oneYear === null`, which is set by
    // exhibitRows iff this is the row's first valuation. There is no longer a
    // second path to a blank, so the reader does not have to work out which
    // kind they are looking at.
    //
    // Still not 0.00: that would say "measured, and it did not move", a
    // different and weaker claim than "there was nothing to measure". Same
    // distinction the negative-zero rule draws in m() below.
    const oneYear = cell(r.oneYear);
    // ⚠ EVERY COLUMN ON THIS ROW IS NET, INCLUDING THE LAST TWO, which is what
    // makes the row internally subtractable — paid + remaining reserve = current
    // ultimate, exactly, on the printed figures. A gross paid column here would
    // break that silently and would look entirely reasonable in a spreadsheet.
    // If a gross paid figure is ever wanted on this exhibit it needs its own
    // gross denominator stored beside it; see ReserveDevelopmentRow.
    return `| ${label} | ${m(r.initial)} | ${cell(r.prior)} | ${m(r.current)} | ${oneYear} `
      + `| ${cell(r.total)} | ${cell(r.paid)} | ${ratioCell(r.paidToIncurred)} |`;
  });
  return [HEADER, ...body].join('\n');
}

// Counts the memo states in prose. Registered as guarded claims in
// actuarial-memo-check — every number in a sentence here is derivable, and a
// sentence beside a correct table is exactly the defect the Calculation Audit
// page needed a third kind of check to find.
function sectionProse(rows: ExhibitRow[], collapsed: number): string {
  // ⚠ "past their IBNER horizon", NOT "no longer developing". The old sentence
  // asserted the thing the blank asserted and was wrong the same way: a year past
  // its horizon can still move, and on this exhibit it frequently does. What the
  // horizon tells a reader is that IBNER has stopped driving the estimate — not
  // that the estimate has stopped.
  const past = rows.filter(r => r.pastHorizon).length;
  return `${rows.length} row(s) on this exhibit; ${past} past their IBNER horizon and ` +
    `${rows.length - past} still within it; ${collapsed} accident year(s) collapsed into Prior.`;
}

// THE UN-EMERGED DEFICIENCY, DISCLOSED AT GAME END ONLY.
//
// What the booked reserve is still short by, because the optimistic booking has
// not finished unwinding. Each open, still-developing cohort adds
// `registerSum x bias x w` to its reserve at step w, so what remains is that
// product summed over the steps not yet taken.
//
// ⚠ TWO DEPARTURES FROM THE FORMULA AS SPECIFIED, both because the exact figure
// was one line away and this exhibit is the reveal:
//
//   THE WEIGHTS ARE GEOMETRIC, NOT UNIFORM. The brief's (H - age)/H assumes the
//   unwind is spread evenly. It is not: ibnerUnwindWeight is geometric in
//   IBNER_UNWIND_DECAY = 0.5, so the FIRST step carries about half the bias.
//   At age 4 of horizon 8 the uniform form claims 50% is still to come when the
//   true remainder is 12.2% — an overstatement of about four times, and it grows
//   with age. Summing the actual remaining weights is exact.
//
//   THE BASE IS registerSum, NOT THE CURRENT ESTIMATE. The unwind adds dollars
//   computed from the register sum frozen at inception; the estimate has since
//   drifted stochastically away from it. Multiplying the drifted estimate would
//   make the disclosed figure depend on the very noise the unwind is separate
//   from.
export function unEmergedDeficiency(lineState: LinePoolState): number {
  return lineState.reserveCohorts.reduce((total, c) => {
    if (c.closed || c.bookingBias <= 0) return total;
    let remaining = 0;
    for (let step = c.age + 1; step <= c.horizon; step++) remaining += ibnerUnwindWeight(c.horizon, step);
    return total + c.registerSum * c.bookingBias * remaining;
  }, 0);
}

export interface ActuarialMemoInput {
  gameState: GameState;
  asAtYear: number;
}

// The most recent valuation the ledger actually holds.
//
// ⚠ THE YEAR SELECTOR CAN ASK FOR A YEAR THAT HAS NOT BEEN VALUED. It offers
// every year up to and including the one in progress, and the year in progress
// has no valuation until it is played. Clamping matters because ultimateAt()
// clamps forward by design — without this the memo would relabel the previous
// valuation with the requested year and read as a year that developed by
// exactly zero everywhere, which is a fabricated exhibit rather than an empty
// one. The heading states the valuation actually used.
function lastValuation(ledgers: ReserveDevelopmentRow[][]): number | null {
  let last: number | null = null;
  for (const ledger of ledgers) {
    for (const r of ledger) {
      const v = r.firstValuationYear + r.ultimateByValuation.length - 1;
      if (last === null || v > last) last = v;
    }
  }
  return last;
}

export function buildActuarialMemo({ gameState, asAtYear }: ActuarialMemoInput): string {
  const lines = gameState.setup.activeLines;
  const ledgers = lines.map(l => gameState.poolState.lines[l]?.reserveDevelopment ?? []);

  const latest = lastValuation(ledgers);
  if (latest === null) {
    return '# Actuarial Memorandum\n\n_No accident year has been valued yet. The reserve ' +
      'development exhibit is filed from the first valuation onward._';
  }
  const asAt = Math.min(asAtYear, latest);
  const calendarYear = gameState.setup.startingYear + asAt - 1;

  const perLine = lines.map((line, i) => ({
    line,
    state: gameState.poolState.lines[line],
    rows: exhibitRows(ledgers[i], asAt),
  }));

  const out: string[] = [];
  out.push('# Actuarial Memorandum');
  out.push(`**Reserve development, as at year ${asAt} (${calendarYear}).**`);
  if (asAt !== asAtYear) {
    out.push(
      `_Year ${asAtYear} has not been valued yet; this memorandum is filed as at year ${asAt}, ` +
      'the most recent valuation. Figures are not carried forward into an unvalued year._',
    );
  }
  out.push(
    'Every figure below is an estimate of ULTIMATE loss, net of reinsurance — not reported claims. ' +
    'Reported claims are paid plus case outstanding; the whole subject of this exhibit is the gap ' +
    'between that and where an accident year finally lands, so the two must not be confused.',
  );
  out.push(
    '**A positive development means the estimate ROSE — adverse.** Favourable development prints ' +
    'negative. Note this is the opposite sign to the development figure in the income statement, ' +
    'which is subtracted from incurred loss and is therefore positive when favourable.',
  );

  // ⚠ COLLAPSED LAST, AFTER POOLING, so the pool row set is built from the raw
  // per-line years and only then folded. Collapsing per line first and pooling
  // the Prior rows would give the same numbers — both are sums — but it would
  // make the pool's Prior depend on each line's Prior having been formed the
  // same way, which is a coupling with no benefit.
  for (const { line, rows } of perLine) {
    const shown = collapsePrior(rows);
    out.push(`## ${line}`);
    out.push(renderTable(shown));
    out.push(sectionProse(shown, rows.length - shown.length + (shown.some(r => r.isPrior) ? 1 : 0)));
  }

  if (lines.length > 1) {
    const poolRaw = poolExhibitRows(perLine.map(p => p.rows));
    const pool = collapsePrior(poolRaw);
    out.push('## Pool total');
    out.push(
      'The three lines added together. Addition is the right operation here and is not everywhere ' +
      'on this pool: these are dollars on one basis — net of reinsurance, at ultimate, same ' +
      'valuation date.',
    );
    out.push(renderTable(pool));
    out.push(sectionProse(pool, poolRaw.length - pool.length + (pool.some(r => r.isPrior) ? 1 : 0)));
  }

  // ⚠ THE "WHICH CLAIMS DEVELOPED" SCHEDULE LIVES IN THE CLAIMS DEPARTMENT NOW,
  // and only the COUNT and the pointer stay here.
  //
  // It answers a different question from the one this memo asks. This memo's
  // subject is the reserve — how much, on what basis, moving which way. Which
  // named occurrences moved, and whose they are, is a claims question, and it is
  // split by line there because one ranked list across three lines is a GL list
  // (measured: 17 of the old top 25). See claimsMemo.ts.
  //
  // ⚠ THE POINTER IS NOT OPTIONAL POLITENESS. The development figures above are
  // EXPLAINED by these claims, and a reserve movement left standing on its own
  // is the thing this sentence exists to prevent. Moving the exhibit without
  // leaving the pointer would have made this page harder to read, not tidier.
  const developed = lines.reduce((n, line) =>
    n + (gameState.poolState.lines[line]?.reserveCohorts ?? []).reduce((k, c) =>
      k + (c.developingClaims ?? []).filter(d => Math.abs(d.current - d.original) >= 1000).length,
    0), 0);

  if (developed > 0) {
    out.push(
      `**A reserve movement is not a number on its own — it is claims deteriorating.** ` +
      `${developed.toLocaleString()} occurrences across these lines have had development land on ` +
      'them. The **Claims Department** files them by name and by member, ranked within each line.',
    );
  }

  out.push('### Reading this exhibit');
  out.push(
    '- **Every column here is NET of reinsurance, paid included,** so the row is subtractable ' +
    'throughout: paid to date plus the remaining reserve is the current ultimate. The claims ' +
    'workbook is GROSS throughout, so its Gross Paid column is a larger number for the same ' +
    'accident year — the difference is what the reinsurance tower is carrying, and the two ' +
    'documents are not meant to tie.\n' +
    '- **Paid / incurred is what says whether a year is nearly settled or still moving,** and it ' +
    'is the reading that only became informative once the three lines got their own payout ' +
    `patterns. A GL year at its first valuation has paid about ${firstYearPaidPct('GL')} while a Property year of the same age has ` +
    `paid about ${firstYearPaidPct('Property')}: same age, same exhibit, entirely different amounts of money still to leave. Nothing ` +
    'else in the game shows that — Net Paid Losses is one calendar-year total per line.\n' +
    '- **A year can be well paid and still open.** Closure is slower than payment, deliberately ' +
    'and from the pool\'s own experience, so a high paid ratio does not mean the files are shut.\n' +
    '- **An empty development cell means there was nothing to subtract, not that nothing ' +
    'moved.** A blank appears on one row only: the newest accident year, which has no earlier ' +
    'valuation to compare against. Every other row shows its movement, including zero movement ' +
    'as 0.00. A blank never means "this year can no longer change".\n' +
    '- **Past the IBNER horizon is not finished.** The horizon governs how long IBNER drives the ' +
    'ESTIMATE, not how long the year takes to pay and not whether it can move. Claims revise ' +
    'while they are open, which outlasts the horizon, so a year past it can and does still ' +
    'develop — and this exhibit shows that movement rather than hiding it behind a blank.\n' +
    '- **Prior** collects every accident year older than ' + PRIOR_BOUNDARY + ', as a development ' +
    'exhibit normally does. Its columns are the sum of the years it replaces.\n' +
    '- **† this row CONTAINS years carried in at game start.** Not that every year in it was: ' +
    'Prior collapses by age, and the oldest few of the years it folds together predate the ' +
    'pool\'s own record while the rest were played before year 1 and have real claim registers. ' +
    'The carried-in ones were apportioned from an opening reserve total rather than built up ' +
    'from claims, so for those the INITIAL column is the estimate as at game start, not at ' +
    'inception — there is no inception figure for them and none has been invented, and their ' +
    'development is measured from game start for the same reason. **So Prior\'s INITIAL column ' +
    'is a mixture of the two**, and the dagger is there to say the mixture exists. The ' +
    'carried-in years are also much smaller than a ' +
    'year -2 as a jump in loss experience.\n' +
    '- **Short-tail lines stop developing and long-tail lines do not.** Property\'s accident ' +
    'years go blank after a few valuations while Workers\' Compensation keeps moving for a ' +
    'decade. That is not an inconsistency in the exhibit; it is the single most useful thing on ' +
    'it. On a short-tail line you know where you stand quickly. On a long-tail line you do not, ' +
    'and a funding decision made today is still being marked years after you made it.',
  );

  // ==========================================================================
  // THE INDICATION — what the triangle above says the NEXT year costs.
  //
  // ⚠ IT IS FILED ONLY AT THE LATEST VALUATION, and that is the same discipline
  // lastValuation() already applies to the exhibit. An indication is a statement
  // about the triangle AS IT STANDS; printing one under a back-dated heading
  // would date it to a year whose triangle is not the one it was computed from.
  // When the reader has selected an earlier valuation, the section says where to
  // find it rather than recomputing a historical indication nobody charged.
  //
  // ⚠ EVERY FIGURE HERE IS RETAINED LOSS COST PER $100, ON ONE BASIS, AND THAT
  // IS THE POINT OF READING netPurePremiumPer100 RATHER THAN purePremiumPer100.
  // The triangle is built on ReserveDevelopmentRow, whose ultimate and paid
  // series are both NET of reinsurance, so what it indicates is a RETAINED loss
  // cost. `purePremiumPer100` on the result is GROSS. Putting the indication
  // beside the gross figure would be a basis mismatch of exactly the family this
  // project has retracted more findings to than any other — and it would print
  // a movement that is mostly the reinsurance programme. pricingTriangle's own
  // header states the pairing: "it is netPurePremiumPer100 that equals this,
  // not purePremiumPer100".
  //
  // NOTHING BELOW IS RECOMPUTED. The charged figure is read off the locked
  // result; the indication comes from the one basis builder; the load comes from
  // the one CLF dispatch the funding panel uses.
  if (asAt === latest) {
    const chargedYear = gameState.currentYearNumber - 1;
    const indicatedYear = gameState.currentYearNumber;
    const lastLocked = gameState.lockedResults[gameState.lockedResults.length - 1];
    type IndRow = {
      line: CoverageLine; charged: number | null; indicated: number | null;
      entered: number | null; left: number | null;
    };
    const indRows: IndRow[] = lines.map(line => {
      const basis = pricingExperienceBasis(gameState.poolState, line);
      const indicated = experienceRatePer100(line, basis);
      const charged = (lastLocked?.byLine?.[line]?.netPurePremiumPer100) ?? null;
      // WHICH ACCIDENT YEARS MOVED, read off the two windows rather than
      // derived from the year number — a seeded ledger does not start at 1 and
      // an arithmetic guess would be wrong on exactly the lines that matter.
      // ⚠ `< chargedYear`, NOT `<= chargedYear`. The window that priced year N
      // was built from the state at the CLOSE OF YEAR N-1, which holds accident
      // years up to N-1; year N's own cohort joins the ledger at the close of
      // year N, after its price was set. The off-by-one here printed "window
      // unchanged" on every line, which is the one answer that cannot be true.
      const now = basis.rows.map(r => r.yearNumber);
      const before = windowRows(
        (gameState.poolState.lines[line]?.reserveDevelopment ?? [])
          .filter(r => r.yearNumber < chargedYear),
      ).map(r => r.yearNumber);
      const entered = now.find(y => !before.includes(y)) ?? null;
      const left = before.find(y => !now.includes(y)) ?? null;
      return { line, charged, indicated, entered, left };
    });

    if (indRows.some(r => r.indicated !== null)) {
      out.push('## Indicated pure premium');
      // ⚠ BEFORE THE FIRST YEAR IS LOCKED THERE IS NOTHING TO COMPARE AGAINST,
      // AND THE FIRST DRAFT INVENTED ONE. It printed a "Charged, year 0" column
      // of dashes under the sentence "what year 0 was actually charged" — but
      // year 0 is the seeded prior, nobody was charged in it, and the movement
      // column was differencing against a year that was never priced. The
      // opening indication is a real and useful figure; a movement is not.
      const haveCharged = lastLocked !== undefined && chargedYear >= 1;
      if (haveCharged) {
        out.push(
          `The pool prices off the triangle above. This is what it indicates for year ${indicatedYear}, ` +
          `against what year ${chargedYear} was actually charged. Both columns are **retained loss cost ` +
          'per $100** — net of reinsurance, which is the basis the triangle is built on.',
        );
      } else {
        out.push(
          `The pool prices off the triangle above. This is what it indicates for year ${indicatedYear}, ` +
          'the first year to be played. It is **retained loss cost per $100** — net of reinsurance, ' +
          'which is the basis the triangle is built on. There is nothing to compare it against yet: ' +
          'the opening triangle is seeded history, and no year of it was priced by this pool.',
        );
      }
      const body = indRows.map(r => {
        const ind = r.indicated === null ? '—' : r.indicated.toFixed(4);
        if (!haveCharged) return `| ${lineDisplayName(r.line)} | ${ind} |`;
        const mv = (r.charged && r.indicated) ? (r.indicated / r.charged - 1) : null;
        const moved = r.entered !== null || r.left !== null
          ? `year ${r.entered ?? '—'} in, year ${r.left ?? '—'} out`
          : 'window unchanged';
        return `| ${lineDisplayName(r.line)} | ${r.charged === null ? '—' : r.charged.toFixed(4)} `
          + `| ${ind} | ${mv === null ? '—' : `${mv >= 0 ? '+' : ''}${(100 * mv).toFixed(1)}%`} | ${moved} |`;
      }).join('\n');
      out.push(haveCharged
        ? `| Line | Charged, year ${chargedYear} | Indicated, year ${indicatedYear} | Movement | Why the triangle moved |\n`
          + '|---|---:|---:|---:|---|\n' + body
        : `| Line | Indicated, year ${indicatedYear} |\n|---|---:|\n` + body);
      if (haveCharged) {
        out.push(
          'The indication moves because the window moves. It holds the most recent '
          + `${TRIANGLE_HISTORY_YEARS} accident years, so each year one enters and one leaves, and the `
          + 'mean is taken over what is left. A line whose movement is large is telling you those two '
          + 'years were very different from each other — not that the pool got better or worse.',
        );
      }

      // ⚠ THE LEGIBILITY DEVICE, AND IT IS STRUCTURAL RATHER THAN A CAVEAT.
      // A single rate figure beside an indication reads as a forecast however it
      // is hedged, because one number per line is what a forecast looks like.
      // Two numbers per line, each labelled with the choice that produces it,
      // cannot be read that way: the reader has to pick one, which is precisely
      // the decision that has not been made yet. The caveat is carried by the
      // shape of the table instead of by a paragraph asking to be believed.
      // ⚠ PER LINE, NOT ONE LEVEL FOR ALL THREE. fundingConfidenceLevel is a
      // per-line decision and the first draft read lines[0]'s for every row,
      // which would print Property's indication at WC's chosen confidence and
      // label it as the reader's own choice. The chosen percentage rides in the
      // cell for the same reason — one column header cannot state three levels.
      const loadBody = indRows.filter(r => r.indicated !== null).map(r => {
        const lvl = gameState.currentDecisions?.byLine?.[r.line]?.fundingConfidenceLevel ?? 0.80;
        const ind = r.indicated as number;
        return `| ${lineDisplayName(r.line)} | ${ind.toFixed(4)} `
          + `| ${(ind * clfFor(r.line, lvl, true)).toFixed(4)} `
          + `| ${(ind * clfFor(r.line, lvl, false)).toFixed(4)} _(at ${(100 * lvl).toFixed(0)}%)_ |`;
      }).join('\n');
      out.push('### The indication is not a rate');
      out.push(
        '**A pure premium is a loss cost. A rate is a loss cost times a confidence load**, and the '
        + 'load comes from a funding stop nobody has chosen yet. The indication above is the pool\'s; '
        + 'the load is the board\'s. Below is the same indication under two of the choices open to '
        + `you — not two forecasts, and neither is year ${indicatedYear}'s rate until you pick one.`,
      );
      out.push(
        '| Line | Indicated | At Expected funding | At your chosen confidence |\n'
        + '|---|---:|---:|---:|\n' + loadBody,
      );
      out.push(
        '_That is what the funding slider does._ It chooses the multiplier between the first column '
        + 'and the others. The indication is what the pool costs; the slider decides how much of it '
        + 'to collect this year and how much to leave to surplus.',
      );
    }
  }

  if (gameState.isComplete && asAt === gameState.setup.gameLength) {
    const endingSurplus = gameState.lockedResults[gameState.lockedResults.length - 1]?.endingSurplus ?? 0;
    const deficiency = lines.reduce((s, l) => s + unEmergedDeficiency(gameState.poolState.lines[l]), 0);
    out.push('### Final position');
    out.push(
      `| | $M |\n|---|---:|\n| Ending surplus | ${m(endingSurplus)} |\n` +
      `| Reserve deficiency not yet emerged | ${m(deficiency)} |\n` +
      `| Ending surplus, net of it | ${m(endingSurplus - deficiency)} |`,
    );
    out.push(
      'Booking an accident year at less than its expected ultimate does not make the loss smaller; ' +
      'it defers recognition of it. The middle line is what the open accident years are still ' +
      'expected to add as that deferral unwinds. It is disclosed here, at the end, because until ' +
      'now the exhibit\'s question was whether you could infer it from the development.',
    );
  }

  return out.join('\n\n');
}
