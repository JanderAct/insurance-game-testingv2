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
// ONE TABLE, NOT THREE, AND THE MEASUREMENT REVERSED THE EXPECTATION.
//
// The development exhibit had to be split by line because GL's severity
// dominated a single ranking — measured, its top 25 ran GL 17 / WC 5 /
// Property 3. Ranking by INCURRED does not have that problem, because the
// dominance belonged to the sort key rather than to the book. Measured over two
// games at year 10, a single ranking by gross incurred:
//
//              top 20                 top 30
//   game 0     WC 4  GL 8  PR 8       WC 7  GL 12  PR 11
//   game 1     WC 4  GL 6  PR 10      WC 6  GL 10  PR 14
//
// Every line is represented in both. Property is the SMALLEST register — about
// 550 claims against WC's 7,000 — and appears most often, because its severity
// tail is the heaviest. So a Program column on one table costs nothing and
// three tables would carry a redundant column to solve a problem the new sort
// key had already removed.
//
// ⚠ RANKED BY GROSS INCURRED, ALL STATUSES. That is what a large-loss listing
// is: the pool's biggest exposures, whether or not the file is still open.
// Ranking open files only would make it a workload report — useful, and a
// different document. 25 rows, which at year 10 puts the floor around $4-5M.
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

import { isClaimClosed, claimPaidSplit } from './claimClosure';
import { resolveClosureCurve } from '../data/defaultAssumptions';
import { regenerateLineYearClaims, ClaimRegenerationError } from './claimRegeneration';
import type {
  Claim, CoverageLine, GameState, LinePoolState, Member, ResultSet,
} from '../types/simulation';

/** The listing's length. See the header for the floor this puts on it. */
export const CLAIMS_LISTING_ROWS = 25;

/** The column header's short form, as a claims department writes it. */
export const PROGRAM_LABEL: Record<CoverageLine, string> = {
  WC: 'WC', GL: 'GL', Property: 'PR',
};

export interface ClaimListingRow {
  line: CoverageLine;
  claim: Claim;
  member: Member | undefined;
  /** ALLOCATED, not a payment record — see paidNote(). Undefined when the
   *  cohort's paid total is not available and a figure would be invented. */
  paid: number | undefined;
  closed: boolean;
}

const money = (v: number): string =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${Math.round(v).toLocaleString()}`;

/** 12/31 of the calendar year the valuation year maps to. */
export function evaluationDate(gameState: GameState, yearNumber: number): string {
  return `12/31/${gameState.setup.startingYear + yearNumber - 1}`;
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
    // The cohort's cumulative GROSS paid, by accident year. Gross, to match the
    // register — the net ledger is the actuarial memo's basis, and mixing them
    // would put net dollars in a column headed Paid.
    const grossPaidByAy = new Map<number, number>();
    for (const c of gameState.poolState.lines[line]?.reserveCohorts ?? []) {
      if (c.grossPaid !== undefined) grossPaidByAy.set(c.yearNumber, c.grossPaid);
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

      claims.forEach((c, i) => rows.push({
        line, claim: c, member: members.get(c.memberId), paid: paid[i], closed: closed[i],
      }));
    }
  }

  rows.sort((a, b) => b.claim.grossUltimate - a.claim.grossUltimate);
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
    + 'year\'s payments rather than as a cheque that was written. A row can therefore show Paid '
    + 'ABOVE its Incurred, which is not an error: the accident year has developed since these '
    + 'claims were written, so the year has paid out more than its original register sums to, and '
    + 'the excess is shared over the files that are settled.';
}

export function buildClaimsMemo(input: ClaimsMemoInput): string {
  const { gameState, asAtYear } = input;
  const { rows, unpricedYears, missingRegisters } = claimListing(input);
  const out: string[] = [];

  out.push('# Claims Department');
  out.push(`**Large loss listing, evaluated ${evaluationDate(gameState, asAtYear)}.** `
    + `The ${CLAIMS_LISTING_ROWS} largest claims on the book by gross incurred, across all `
    + 'programs. Amounts are GROSS of reinsurance.');

  if (rows.length === 0) {
    out.push('_No claim detail is available at this valuation._');
    return out.join('\n\n');
  }

  const shown = rows.slice(0, CLAIMS_LISTING_ROWS);
  // ⚠ THE COLUMN APPEARS ONLY IF A DISPLAYED ROW HAS ONE — see the header.
  const anyDescription = shown.some(r => (r.claim.description ?? '').trim().length > 0);

  const head = ['Evaluation date', 'Program', 'Member', 'Claim status', 'Paid total', 'Incurred total'];
  const align = ['---', '---', '---', '---', '---:', '---:'];
  if (anyDescription) { head.push('Claim description'); align.push('---'); }

  out.push([
    `| ${head.join(' | ')} |`,
    `|${align.join('|')}|`,
    ...shown.map(r => {
      const cells = [
        evaluationDate(gameState, asAtYear),
        PROGRAM_LABEL[r.line],
        r.member?.name ?? r.claim.memberId,
        r.closed ? 'Closed' : 'Open',
        r.paid === undefined ? '' : money(r.paid),
        money(r.claim.grossUltimate),
      ];
      if (anyDescription) cells.push((r.claim.description ?? '').trim());
      return `| ${cells.join(' | ')} |`;
    }),
  ].join('\n'));

  out.push(`_${(rows.length - shown.length).toLocaleString()} further claims are on the book at this `
    + 'valuation; the claims workbook carries every one._');

  out.push(paidNote());

  out.push(
    '_The listing covers the accident years the pool holds a claim register for. The years carried '
    + 'in before the declared history were built as an opening position rather than from individual '
    + 'claims, so they have no files to list — their development still appears in the actuarial '
    + 'memorandum._',
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
