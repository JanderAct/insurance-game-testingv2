// ============================================================================
// THE CLAIMS DEPARTMENT — the large-loss listing.
//
// A register of individual claims as at a valuation date: who, what status,
// what has been paid, what it is incurred at. It replaced a development
// schedule (as first written / now / development), and that is a change of
// SUBJECT rather than of presentation — development is the actuarial memo's
// question, and that memo keeps the count and a pointer to here.
//
// ============================================================================
// ⚠ IT READS THE CLAIM REGISTER, NOT THE TRACKED DEVELOPING SET, AND THE
// DIFFERENCE DECIDES EVERYTHING BELOW.
//
// The exhibit this replaces read `reserveCohorts[].developingClaims` — the 3-10
// occurrences per cohort that development is allocated across. That set can
// answer "what moved". It cannot answer "what has been paid", and the reason is
// not that the field is missing but that the QUESTION is about the whole
// accident year: paid is allocated across every claim in the year, so a split
// computed over ten of them would hand each claim roughly fifty times its
// share. A second allocation would also be a second IMPLEMENTATION, and the
// claims workbook already has one — so the same claim would carry two different
// Gross Paid figures in two documents.
//
// So this reads the register, through the same two functions the workbook uses:
// `claimPaidSplit` for the paid allocation and `isClaimClosed` for status. One
// implementation, and the two documents cannot disagree.
//
// ⚠ WHAT THAT COSTS: THE MATURATION YEARS DROP OUT. The seven years simulated
// to build the opening book are never carried into priorHistory, so they have
// no ResultSet and no register — the register spans accident years -2..N, the
// cohorts span -9..N. Those years contributed 211 of 839 rows to the old
// development ranking. They cannot contribute here, because the columns this
// exhibit now has do not exist for them at all, and the note at the foot says
// so rather than letting the absence read as quiet.
//
// ⚠ AND IT COSTS 41 ms, WHICH IS WHY THE DECISION WAS NOT A PERFORMANCE ONE.
// On a reloaded game every year's register has to be redrawn by
// claimRegeneration. Measured over a full year-10 book: 39 line-years, 10,596
// claims, 41 ms — against 1 ms when the claims are still in memory. Estimated
// beforehand at several seconds, which would have changed the answer; it was
// measured instead.
//
// ============================================================================
// THREE SECTIONS AGAIN, AND BOTH PREMISES BEHIND THE ONE-TABLE DECISION MOVED.
//
// The single table was right for the exhibit as it then was, and it rested on
// two things that the open filter changed underneath it:
//
//   the dominance was gone       a single ranking by INCURRED ran WC 4 / GL 8 /
//                                PR 8 in one game and WC 4 / GL 6 / PR 10 in
//                                another, so no line crowded the others out.
//   Program earned its column    with one table, the line had to be on the row.
//
// Filtering to open files changes the first — open inventories differ sharply by
// line, so one ranking would be a WC ranking — and sections carrying the line
// name make the second redundant by construction. So: three sections, ten rows
// each, ranked by current incurred within each.
//
// ============================================================================
// OPEN FILES ONLY, AND THE TENTH ROW IS SMALL ON TWO OF THE THREE LINES.
//
// Settled files cannot move again, so an inventory of them is a history. The
// filter is severe: measured at year 10, open files are a small minority of each
// register, and what the tenth row reaches down to is worth stating plainly.
//
//   as at year 10       register   open        #1        #5       #10
//     WC   game 0          5,720    766 (13%)  $6.54M   $1.84M   $1.15M
//     WC   game 1          6,270    901 (14%)  $3.44M   $1.48M   $1.05M
//     GL   game 0          4,268    661 (15%)  $1.75M   $0.67M   $0.37M
//     GL   game 1          4,596    572 (12%)  $5.93M   $2.03M   $1.49M
//     PR   game 0            608     36  (6%)  $6.23M   $0.57M   $0.24M
//     PR   game 1            507     44  (9%)  $3.32M   $1.64M   $0.61M
//
// ⚠ SO THERE IS NO MATERIALITY FLOOR, AND THAT IS A DECISION RATHER THAN AN
// OMISSION. GL's and Property's tenth rows are small — $0.37M and $0.24M in one
// game — and a listing padded to ten with immaterial rows is worse than a short
// one. Every floor considered was either invented or borrowed:
//
//   a fixed dollar threshold   arbitrary, and wrong across lines whose top open
//                              file ranges from $1.75M to $6.54M in one game.
//   a share of the section's   cuts Property to four rows and leaves GL's ten
//   largest                    untouched, because GL's open book is flat.
//   the first-layer retention  $1M / $1M / $5M. DERIVED, and it gives sections
//                              of 10 / 2 / 1 — because it is calibrated for what
//                              a reinsurer attaches on, not for what a claims
//                              reader watches. Borrowing it here is the
//                              well-derived-but-wrong-question trap.
//
// What a small tenth row actually says is that the line's open inventory IS
// small, which is true and worth seeing. So each section prints its own count
// and range — "10 of 661 open GL files, $1.75M down to $0.37M" — and a reader
// judges materiality with the numbers in front of them.
//
// ⚠ AND A SHORT OR EMPTY SECTION SAYS SO. Every line had at least 36 open files
// in every game and valuation measured, so neither case arises at defaults — but
// both are reachable on an early valuation or a line the pool has barely
// written, and a three-row Property section that does not explain itself reads
// as a bug. A short section names the count; an empty one says the register has
// wholly settled and points at the workbook.
//
// ============================================================================
// ⚠ INCURRED HERE IS NOT THE WORKBOOK'S Gross Incurred, AND THE DIFFERENCE IS
// DELIBERATE. Both documents say so.
//
//   this listing        the claim's share of its cohort's CURRENT gross
//                       ultimate — one figure per claim, on the same vintage as
//                       the Paid beside it.
//   claims workbook     Gross Incurred is the claim AS DRAWN and never
//                       develops, and the workbook carries the developed
//                       figures separately in its Drawn / Booked / Current
//                       Occurrence block.
//
// A workbook is a data export and can carry both vintages in adjacent columns;
// a one-line-per-claim listing can carry one, and for a large-loss listing it
// has to be the one the Paid column is on. The workbook's own note already
// warned that its two columns are not the same vintage and that their ratio is
// not a paid-to-incurred; that warning is now narrower, because the document it
// pointed a reader towards is this one.
//
// ⚠ SO Paid / Incurred IS A REAL RATIO HERE AND IS NOT ONE IN THE WORKBOOK.
// That is the whole reason for the difference and it is worth stating plainly,
// because two documents disagreeing about one claim is exactly what this file
// went out of its way to avoid on the Paid column.
//
// ============================================================================
// ⚠ THE DESCRIPTION COLUMN RENDERS ONLY WHEN SOMETHING POPULATES IT.
//
// `Claim.description` exists and nothing writes one. An always-empty column
// reads as a defect to anyone looking at it — a reader cannot tell a column
// waiting for content from a column whose content failed to load. So the field
// is built, the reader is here, and the column appears the day a claim has one.
//
// The alternative considered was rendering it empty so the shape is visible.
// Rejected: the shape is visible in this file and in the type, which is where
// someone who needs to know looks; a player only sees a blank column.
// ============================================================================

import { isClaimClosed, claimPaidSplit, claimIncurredSplit } from './claimClosure';
import { resolveClosureCurve } from '../data/defaultAssumptions';
import { regenerateLineYearClaims, ClaimRegenerationError } from './claimRegeneration';
import type {
  Claim, CoverageLine, GameState, LinePoolState, Member, ResultSet,
} from '../types/simulation';

/** Rows per line section. See OPEN FILES ONLY for what this reaches down to. */
export const CLAIMS_ROWS_PER_LINE = 10;

export interface ClaimListingRow {
  line: CoverageLine;
  claim: Claim;
  member: Member | undefined;
  /** ALLOCATED, not a payment record — see paidNote(). Undefined when the
   *  cohort's paid total is not available and a figure would be invented. */
  paid: number | undefined;
  /**
   * The claim's CURRENT incurred — its share of the cohort's developed gross
   * ultimate, with a closed file holding its drawn value and the development
   * landing on the open ones.
   *
   * ⚠ NOT claim.grossUltimate, WHICH IS THE VALUE DRAWN AT INCEPTION. Showing
   * that beside an allocated Paid put two vintages in adjacent columns — see
   * claimIncurredSplit. Falls back to the drawn value only when the cohort's
   * current ultimate is unavailable, which is the same corner Paid goes blank
   * in and is marked the same way.
   */
  incurred: number;
  /** False when `incurred` is the drawn value because the cohort is gone. */
  developed: boolean;
  closed: boolean;
}

/**
 * Always millions, two decimals.
 *
 * ⚠ ONE UNIT PER COLUMN, AND THE MIXED VERSION WAS UNREADABLE. This used to
 * render millions as "6.23M" and anything smaller as a plain "635,675", so a
 * Property section spanning $6.23M down to $236,797 put both forms in one
 * column and a reader had to parse each cell before comparing it to the one
 * above. Open inventories span exactly that range, so the mixed form failed
 * precisely where this exhibit lives.
 */
const money = (v: number): string => `${(v / 1_000_000).toFixed(2)}M`;

/** 12/31 of the calendar year the valuation year maps to. */
export function evaluationDate(gameState: GameState, yearNumber: number): string {
  return `12/31/${gameState.setup.startingYear + yearNumber - 1}`;
}

/**
 * The accident year as a CALENDAR year, matching the evaluation date's form.
 *
 * ⚠ THE COLUMN THE RESTRUCTURE DROPPED AND THIS PUTS BACK. Without it an
 * eight-year-old file and a current-year one are indistinguishable, which is the
 * first thing a claims reader wants and the only thing on the row that varies
 * with age. Measured, it is not cosmetic: a single line's top ten open files
 * span accident years -2 to 10 in one game — a thirteen-year spread reading as
 * one undated block.
 *
 * Pre-game years render as calendar years like any other (year 0 at a 2026 start
 * is 2025), because a reader does not need the game's internal numbering to read
 * a date.
 */
export function programYear(gameState: GameState, accidentYear: number): string {
  return String(gameState.setup.startingYear + accidentYear - 1);
}

function memberIndex(gameState: GameState): Map<string, Member> {
  const out = new Map<string, Member>();
  for (const m of gameState.poolState.allMarketMembers ?? []) out.set(m.id, m);
  for (const ls of Object.values(gameState.poolState.lines) as (LinePoolState | undefined)[]) {
    for (const mem of ls?.members ?? []) out.set(mem.id, mem);
  }
  return out;
}

/**
 * The register for one line-year: stored if the game still holds it, redrawn if
 * a reload stripped it, undefined if it cannot be had at all.
 *
 * ⚠ THE SAME THREE-WAY SHAPE claimsExport USES, and deliberately so. A stripped
 * year is redrawn and counts as present; what is left is a result that cannot be
 * redrawn — one written before `kLineApplied` was recorded — which is rare,
 * permanent for that save, and silently dropping it is not an option, so it is
 * counted and named at the foot of the listing.
 */
function registerFor(gameState: GameState, r: ResultSet, line: CoverageLine): Claim[] | undefined {
  const lr = r.byLine[line];
  if (!lr) return undefined;
  if (lr.claims !== undefined) return lr.claims;
  try {
    return regenerateLineYearClaims(gameState.instance, r, line).claims;
  } catch (e) {
    if (e instanceof ClaimRegenerationError) return undefined;
    throw e;
  }
}

export interface ClaimsMemoInput {
  gameState: GameState;
  /** The valuation the listing is struck at. Status and paid both resolve here. */
  asAtYear: number;
}

/**
 * Every claim in the book at this valuation, with paid and status resolved.
 *
 * ⚠ PAID IS SPLIT PER ACCIDENT YEAR OVER THE WHOLE REGISTER, which is why this
 * builds the entire book before taking the top 25 rather than ranking first and
 * costing less. Taking the largest claims and then splitting the cohort's paid
 * across only those would be the subset error this file exists to avoid, one
 * layer in.
 */
export function claimListing(
  { gameState, asAtYear }: ClaimsMemoInput,
): { rows: ClaimListingRow[]; unpricedYears: number; missingRegisters: number } {
  const members = memberIndex(gameState);
  const results = [...gameState.priorHistory, ...gameState.lockedResults]
    .filter(r => r.yearNumber <= asAtYear);
  const rows: ClaimListingRow[] = [];
  let unpricedYears = 0, missingRegisters = 0;

  for (const line of gameState.setup.activeLines) {
    // The cohort's cumulative GROSS paid and its CURRENT gross ultimate, by
    // accident year. Gross throughout, to match the register — the net ledger is
    // the actuarial memo's basis, and mixing them would put net dollars in a
    // column headed Paid.
    //
    // ⚠ ULTIMATE IS grossPaid + grossUnpaid, WHICH IS THE COHORT AS CARRIED
    // TODAY. Both halves are needed, so a cohort missing either contributes
    // neither figure and its claims fall back to their drawn values.
    const grossPaidByAy = new Map<number, number>();
    const grossUltByAy = new Map<number, number>();
    for (const c of gameState.poolState.lines[line]?.reserveCohorts ?? []) {
      if (c.grossPaid !== undefined) grossPaidByAy.set(c.yearNumber, c.grossPaid);
      if (c.grossPaid !== undefined && c.grossUnpaid !== undefined) {
        grossUltByAy.set(c.yearNumber, c.grossPaid + c.grossUnpaid);
      }
    }

    for (const r of results) {
      const claims = registerFor(gameState, r, line);
      if (claims === undefined) { missingRegisters++; continue; }
      if (claims.length === 0) continue;

      const ay = r.yearNumber;
      const age = asAtYear - ay + 1;
      // ⚠ THE INSTANCE ID IS THE CLOSURE DRAW'S GAME KEY, and it is the same
      // value claimsExport passes — closure is a pure function of (gameId,
      // claimId, curve, age), so passing anything else here would give the same
      // claim a different status in the two documents.
      const closed = claims.map(c => isClaimClosed(
        resolveClosureCurve(line, c.grossUltimate), gameState.setup.instanceId, c.id, age,
      ));
      const cohortPaid = grossPaidByAy.get(ay);
      // ⚠ BLANK, NOT ZERO, when the cohort's paid total is gone — a closed
      // cohort is filtered out of reserveCohorts. The workbook's own convention,
      // and a wrong number is worse than a missing one.
      let paid: (number | undefined)[];
      if (cohortPaid === undefined) { paid = claims.map(() => undefined); unpricedYears++; }
      else {
        const split = claimPaidSplit(
          claims.map((c, i) => ({ grossUltimate: c.grossUltimate, closed: closed[i] })),
          cohortPaid,
        );
        paid = split;
      }

      // ⚠ THE SAME TWO-TIER SPLIT AS THE PAID COLUMN, over the cohort's current
      // ultimate instead of its paydown. Closed files keep their drawn value;
      // the cohort's development lands on the open ones. That is what makes
      // Paid <= Incurred hold by construction rather than by clamping.
      const cohortUlt = grossUltByAy.get(ay);
      const developed = cohortUlt !== undefined;
      const incurred = developed
        ? claimIncurredSplit(
            claims.map((c, i) => ({ grossUltimate: c.grossUltimate, closed: closed[i] })),
            cohortUlt,
          )
        : claims.map(c => c.grossUltimate);

      claims.forEach((c, i) => rows.push({
        line, claim: c, member: members.get(c.memberId), paid: paid[i],
        incurred: incurred[i], developed, closed: closed[i],
      }));
    }
  }

  rows.sort((a, b) => b.incurred - a.incurred);
  return { rows, unpricedYears, missingRegisters };
}

/** Why Paid is an allocation and must not be read as a payment record. */
function paidNote(): string {
  return '**Paid is an allocation, not a payment record.** No payment is recorded against an '
    + 'individual claim anywhere in this simulation — the payout pattern pays down an ACCIDENT '
    + 'YEAR, and this column splits that year\'s cumulative gross paid across its claims: a closed '
    + 'file takes its own incurred, because it has paid everything it ever will, and the open files '
    + 'share what is left in proportion. It is the same split the claims workbook shows, computed '
    + 'by the same function, so the two documents agree. Treat it as this claim\'s share of the '
    + 'year\'s payments rather than as a cheque that was written. Incurred is allocated the same '
    + 'way from the same register, so the two columns are on one basis and Paid never exceeds '
    + 'Incurred.';
}

export function buildClaimsMemo(input: ClaimsMemoInput): string {
  const { gameState, asAtYear } = input;
  const { rows, unpricedYears, missingRegisters } = claimListing(input);
  const out: string[] = [];

  out.push('# Claims Department');
  out.push(`**Open claim inventory, evaluated ${evaluationDate(gameState, asAtYear)}.** `
    + `The ${CLAIMS_ROWS_PER_LINE} largest OPEN files on each program by current incurred. `
    + 'Settled files are excluded: they cannot move again, so they belong to a history rather '
    + 'than to an inventory. Amounts are GROSS of reinsurance, and both money columns are shares '
    + 'of the same accident-year figures, so they are on one basis and subtractable.');

  if (rows.length === 0) {
    out.push('_No claim detail is available at this valuation._');
    return out.join('\n\n');
  }

  // ⚠ NO Claim status COLUMN, AND THAT IS THE OPEN FILTER'S DOING. Every row is
  // open by construction, so the column would be uniform and carry nothing —
  // the same objection this file applies to the description column. Status is a
  // property of the FILTER now, stated once above, not of the row. The
  // evaluation date stays despite also being constant, because it is a fact
  // ABOUT each row that happens to repeat rather than the criterion that
  // selected it, and a listing row copied out of context needs to carry it.
  let anyShown = false;
  for (const line of gameState.setup.activeLines) {
    const open = rows.filter(r => r.line === line && !r.closed);
    out.push(`## ${line}`);

    if (open.length === 0) {
      // ⚠ AN EMPTY SECTION SAYS WHY RATHER THAN LOOKING BROKEN. Reachable: a
      // line whose whole register has settled, or an early valuation on a line
      // the pool has barely written.
      out.push(`_No open ${line} file at this valuation — every claim on the `
        + `${rows.filter(r => r.line === line).length.toLocaleString()} in this program's register `
        + 'has settled. Settled claims are listed in the claims workbook._');
      continue;
    }

    anyShown = true;
    const shown = open.slice(0, CLAIMS_ROWS_PER_LINE);
    const anyDescription = shown.some(r => (r.claim.description ?? '').trim().length > 0);

    const head = ['Evaluation date', 'Program year', 'Member', 'Paid total', 'Incurred total'];
    const align = ['---', '---:', '---', '---:', '---:'];
    if (anyDescription) { head.push('Claim description'); align.push('---'); }

    out.push([
      `| ${head.join(' | ')} |`,
      `|${align.join('|')}|`,
      ...shown.map(r => {
        const cells = [
          evaluationDate(gameState, asAtYear),
          programYear(gameState, r.claim.accidentYear),
          r.member?.name ?? r.claim.memberId,
          r.paid === undefined ? '' : money(r.paid),
          money(r.incurred),
        ];
        if (anyDescription) cells.push((r.claim.description ?? '').trim());
        return `| ${cells.join(' | ')} |`;
      }),
    ].join('\n'));

    // ⚠ THE SECTION STATES ITS OWN SCALE RATHER THAN BEING CUT TO A THRESHOLD.
    // See OPEN FILES ONLY for why there is no materiality floor: every candidate
    // was either invented or borrowed from a constant calibrated for something
    // else. Printing the count and the range lets a reader judge for themselves,
    // which is the honest version of the same service.
    const lo = shown[shown.length - 1].incurred, hi = shown[0].incurred;
    out.push(`_${shown.length} of ${open.length.toLocaleString()} open ${line} files, `
      + `$${money(hi)} down to $${money(lo)}._`
      + (shown.length < CLAIMS_ROWS_PER_LINE
        ? ` _This program has fewer than ${CLAIMS_ROWS_PER_LINE} open files; the section is short `
          + 'because the inventory is, not because rows are missing._'
        : ''));
  }

  if (!anyShown) {
    out.push('_Every claim in the register has settled at this valuation, on every program._');
  }

  out.push(paidNote());

  out.push(
    '_The inventory covers the accident years the pool holds a claim register for. The years '
    + 'carried in before the declared history were built as an opening position rather than from '
    + 'individual claims, so they have no files to list — their development still appears in the '
    + 'actuarial memorandum._',
  );

  if (unpricedYears > 0) {
    out.push(`_${unpricedYears} accident year(s) show a blank Paid: their cohort has closed and its `
      + 'cumulative paid total is no longer carried. Blank rather than zero — those claims were '
      + 'paid, the figure is simply not retrievable on this basis._');
  }
  if (missingRegisters > 0) {
    out.push(`_${missingRegisters} line-year(s) could not be listed: the saved result predates the `
      + 'fields a register is redrawn from, so its claims cannot be recovered._');
  }

  return out.join('\n\n');
}
