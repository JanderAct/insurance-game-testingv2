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
  GameState, LinePoolState, ReserveDevelopmentRow,
} from '../types/simulation';
import { ibnerUnwindWeight } from './simulationEngine';

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
  // ⚠ MATURED, NOT "SETTLED", AND THE RENAME IS THE POINT. Reaching the horizon
  // means IBNER has stopped developing the cohort. It does NOT mean the accident
  // year is finished: it is still open and still paying. processIbner's own
  // header says so — "runoff and development are separate clocks: the horizon
  // governs how long the ESTIMATE is uncertain, paydownPct governs how fast it
  // is settled" — and the old label collapsed the two, telling a player a year
  // was done while it was still writing cheques.
  matured: boolean;
  /** True only for the collapsed Prior row. */
  isPrior: boolean;
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
      return {
        yearNumber: r.yearNumber,
        calendarYear: r.calendarYear,
        seeded: r.seeded,
        initial,
        current,
        prior,
        oneYear: prior === null ? null : current - prior,
        total: isFirst ? null : current - initial,
        matured: ageAt(r, asAt) > r.horizon,
        isPrior: false,
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
        matured: rows.every(r => r.matured),
        isPrior: false,
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
    seeded: old.every(r => r.seeded),
    initial: sum(r => r.initial),
    prior: anyNull(r => r.prior) ? null : sum(r => r.prior ?? 0),
    current: sum(r => r.current),
    oneYear: anyNull(r => r.oneYear) ? null : sum(r => r.oneYear ?? 0),
    total: anyNull(r => r.total) ? null : sum(r => r.total ?? 0),
    // Still developing if ANY constituent is. One live cohort inside Prior makes
    // the whole row live.
    matured: old.every(r => r.matured),
    isPrior: true,
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

function cell(value: number | null): string {
  return value === null ? EMPTY : m(value);
}

const HEADER =
  '| Accident year | Initial ultimate $M | Prior year ultimate $M | Current ultimate $M ' +
  '| 1-yr development $M | Total development $M |\n' +
  '|---|---:|---:|---:|---:|---:|';

function renderTable(rows: ExhibitRow[]): string {
  if (rows.length === 0) return '_No accident years on this exhibit yet._';
  const body = rows.map(r => {
    const label = r.isPrior
      ? `**Prior** (to ${r.calendarYear})${r.seeded ? ' †' : ''}`
      : `${r.yearNumber} (${r.calendarYear})${r.seeded ? ' †' : ''}`;
    // ⚠ BLANK, NOT "settled", AND NOT 0.00. A matured accident year cannot
    // develop further, so the 1-year cell has nothing to report — and printing
    // 0.00 would say "measured, and it did not move", which is a different and
    // weaker claim than "there was nothing to measure". Same distinction the
    // negative-zero rule draws in m() below.
    //
    // "settled" was worse than either: it collapsed MATURITY into CLOSURE and
    // told a player the year was finished while it was still paying out.
    const oneYear = r.matured ? EMPTY : cell(r.oneYear);
    return `| ${label} | ${m(r.initial)} | ${cell(r.prior)} | ${m(r.current)} | ${oneYear} | ${cell(r.total)} |`;
  });
  return [HEADER, ...body].join('\n');
}

// Counts the memo states in prose. Registered as guarded claims in
// actuarial-memo-check — every number in a sentence here is derivable, and a
// sentence beside a correct table is exactly the defect the Calculation Audit
// page needed a third kind of check to find.
function sectionProse(rows: ExhibitRow[], collapsed: number): string {
  const matured = rows.filter(r => r.matured).length;
  const developing = rows.length - matured;
  return `${rows.length} row(s) on this exhibit; ${matured} no longer developing and ` +
    `${developing} still developing; ${collapsed} accident year(s) collapsed into Prior.`;
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

  // WHICH CLAIMS MOVED — the schedule that gives a reserve deterioration a story.
  //
  // ⚠ AS AT NOW, NOT AS AT THE SELECTED YEAR — and the reason has narrowed.
  // These rows show each occurrence's CURRENT value against its booked one, so
  // they do not follow the year selector, and they are labelled rather than
  // quietly presented as if they did.
  //
  // The old reason — "the claim subset has no per-valuation history" — is no
  // longer true: DevelopingClaim.movementByStep carries one entry per valuation,
  // and the claims workbook renders it as a triangle. So this schedule COULD be
  // cut as at the selected year. It is not, because that is a change to the
  // memo's content rather than a correction, and nobody has asked for it.
  const developed = lines.flatMap(line =>
    (gameState.poolState.lines[line]?.reserveCohorts ?? []).flatMap(c =>
      (c.developingClaims ?? [])
        .filter(d => Math.abs(d.current - d.original) >= 1000)
        .map(d => ({ line, accidentYear: c.yearNumber, ...d })),
    ),
  ).sort((a, b) => (b.current - b.original) - (a.current - a.original));

  if (developed.length > 0) {
    out.push('### Which claims developed');
    out.push(
      'A reserve movement is not a number on its own — it is claims deteriorating. These are the ' +
      'occurrences this pool has seen development land on, largest movement first, **as at today ' +
      'rather than as at the year selected above**. Amounts are occurrence totals, gross of ' +
      'reinsurance. Every accident year listed here appears individually in the exhibit above: ' +
      'the years inside Prior have no claim register, so they can never contribute a row.',
    );
    out.push([
      '| Line | Accident year | Claim | As first written $M | Now $M | Development $M |',
      '|---|---:|---|---:|---:|---:|',
      ...developed.slice(0, 25).map(d =>
        `| ${d.line} | ${d.accidentYear} | ${d.claimId} | ${m(d.original)} | ${m(d.current)} | ${m(d.current - d.original)} |`),
    ].join('\n'));
    if (developed.length > 25) {
      out.push(`_${developed.length - 25} further developed claim(s) not shown; the claims workbook carries all of them._`);
    }
  }

  out.push('### Reading this exhibit');
  out.push(
    '- **Empty cells are not zeros.** The newest accident year has no prior valuation and no ' +
    'development, because it has had no opportunity to develop. That is different from a year ' +
    'that had the opportunity and did not move.\n' +
    '- **A blank development column means the year has run past its development horizon.** ' +
    'Its estimate will not move again, so there is nothing to report in that column — which is ' +
    'a different statement from measuring the movement and finding it was zero. **It does NOT ' +
    'mean the accident year is finished.** It is still open and still paying claims out; the ' +
    'horizon governs how long the ESTIMATE stays uncertain, not how long the year takes to pay.\n' +
    '- **Prior** collects every accident year older than ' + PRIOR_BOUNDARY + ', as a development ' +
    'exhibit normally does. Its columns are the sum of the years it replaces.\n' +
    '- **† carried in at game start.** The Prior row predates the pool\'s own record. Those ' +
    'accident years were apportioned from an opening reserve total rather than built up from ' +
    'claims, so the INITIAL column is the estimate as at game start, not at inception — there is ' +
    'no inception figure for them and none has been invented, and their development is measured ' +
    'from game start for the same reason. **That is exactly why the Prior boundary sits where it ' +
    'does:** every year shown individually has a real claim register behind it and a real ' +
    'original estimate; everything inside Prior has neither. They are also much smaller than a ' +
    'full accident year, being shares of one opening balance, so do not read the step up at ' +
    'year -2 as a jump in loss experience.\n' +
    '- **Short-tail lines stop developing and long-tail lines do not.** Property\'s accident ' +
    'years go blank after a few valuations while Workers\' Compensation keeps moving for a ' +
    'decade. That is not an inconsistency in the exhibit; it is the single most useful thing on ' +
    'it. On a short-tail line you know where you stand quickly. On a long-tail line you do not, ' +
    'and a funding decision made today is still being marked years after you made it.',
  );

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
