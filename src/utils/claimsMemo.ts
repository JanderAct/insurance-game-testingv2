// ============================================================================
// THE CLAIMS DEPARTMENT — which claims developed, per line, and whose they are.
//
// This exhibit was inside the actuarial memorandum. It moved because it answers
// a different question from the one that memo asks. The memo's subject is the
// reserve: how much, on what basis, moving which way. This is the claims behind
// the movement — named occurrences, named members. The actuarial page keeps a
// pointer to it, because a reserve development figure standing on its own is
// the thing the pointer exists to prevent.
//
// ============================================================================
// SPLIT BY LINE, BECAUSE ONE RANKED LIST IS A GL LIST.
//
// GL's severity is the heaviest of the three, so a single ranking by movement is
// dominated by it and the other two lines barely appear. Measured over two games
// at year 10, the old single top-25:
//
//   game 0   GL 17   WC 5   Property 3
//   game 1   GL 15   WC 4   Property 6
//
// Three tables, each ranked within its own line, is the fix. It is not a
// presentation preference — a Property claims manager reading the old exhibit
// saw three rows and could not tell whether that was because Property is quiet
// or because GL is loud.
//
// ⚠ TEN ROWS PER LINE, AND THE REASON IS WHERE THE MATERIALITY RUNS OUT RATHER
// THAN THE ROUND NUMBER. Measured, the movement at each rank (game 0 / game 1):
//
//   rank        WC              GL              Property
//     #5   $1.24M / $1.39M  $3.45M / $2.76M  $1.06M / $1.74M
//     #8   $1.12M / $1.19M  $2.23M / $2.42M  $0.77M / $1.37M
//    #10   $1.01M / $1.08M  $1.92M / $2.27M  $0.72M / $1.21M
//    #15   $0.71M / $0.88M  $1.34M / $1.68M  $0.40M / $0.65M
//
// Row 10 is still a million-dollar movement on every line in both games; row 15
// is not, on WC or Property. So ten is where the table stops being a list of
// material claims and starts being a list of claims — and thirty rows across
// three headed tables reads more easily than the twenty-five in one that this
// replaces, because each table is a complete ranking of something.
// ============================================================================
// THE DESCRIPTION IS GENERATED FROM STORED FIELDS, AND IT IS THINNER THAN THE
// BRIEF EXPECTED BECAUSE THE VOCABULARY IT ASSUMED DOES NOT EXIST.
//
// ⚠ NO LINE HAS A SUB-COVERAGE VOCABULARY. Checked on all three rather than
// inferred, because the natural expectation is that a claim knows it is "law
// enforcement liability" or "weather". None of them does:
//
//   GL         Claim.tier is component1 / component2 / component3 — a MIXTURE
//              COMPONENT. The four sub-lines (general, EPL, law enforcement,
//              abuse) were a GL_RELATIVITIES concept that one flat mixture
//              replaced; simulation.ts's own comment on the field says so and
//              warns that anything pattern-matching those strings needs
//              revisiting rather than recompiling.
//   WC         Claim.tier is small / medium / large / schoolsMedium — also a
//              mixture component. ('injected' marks a shock claim, which is a
//              generator concept rather than a coverage.)
//   PROPERTY   Occurrence.peril is documented as attritional / weather / cat,
//              and the ENGINE EMITS THE CONSTANT 'property'. Measured: 267 of
//              267 developed Property occurrences carry that one value, and
//              propertyClaimEngine says why in passing — "with the weather band
//              gone". The type's comment is stale, not the engine.
//
// Rendering `component2` to a player would be worse than rendering nothing, so
// the description is assembled from the only thing that does carry meaning —
// THE MEMBER's own authored risk attributes:
//
//   WC         the member's rating group — County / Schools / High safety /
//              Low safety. A rating CLASS, so it is labelled as the kind of
//              employer rather than the kind of injury.
//   GL, PROP   the member's size band and region, which are the only authored
//              risk descriptors those lines have.
//
// ⚠ ENTITY TYPE IS NOT USED, AND THE FIRST DRAFT OF THIS FILE USED IT. It
// rendered "General liability — School District" beside a member column reading
// "Valley School District 118", under a heading reading "## GL". Three
// restatements of one fact. Member names embed their type, so type in the
// description is redundant by construction; size band and region are not in the
// name and are not anywhere else on the row.
//
// ⚠ ALL OF IT IS READ OFF THE MEMBER, SO THE DESCRIPTION COSTS NO STORAGE.
// Only the member LINK had to be stored — see DevelopingClaim.memberIds. An
// earlier draft also carried Occurrence.peril for Property's sake; it was
// removed once measurement showed it to be the constant 'property', on the
// grounds this project has already paid for once: a stored field nothing reads
// is how the claim register ended up in the save.
//
// ============================================================================
// AND A STATUS COLUMN, WHICH IS THE ONE GENUINELY CLAIM-SIDE FACT AVAILABLE.
//
// `DevelopingClaim.closed` is already stored and already exact. It is also the
// thing a claims reader most wants next to a movement: a settled claim is
// settled AT that number and cannot move again, an open one can. Measured at
// year 10 on one game — WC 254 of 375 developed occurrences closed, GL 160 of
// 206, Property 258 of 272, and 7 of WC's displayed 10 — so it varies both
// across the book and within the rows shown.
//
import type {
  CoverageLine, DevelopingClaim, GameState, LinePoolState, Member,
} from '../types/simulation';

/** The reachable worst case still fits on a page; see the header. */
export const CLAIMS_ROWS_PER_LINE = 10;

/** A movement smaller than this is not a development anyone acts on. Same
 *  threshold the exhibit used inside the actuarial memo, kept so the move does
 *  not silently change what appears. */
const MATERIAL_MOVEMENT = 1000;

interface DevelopedRow {
  accidentYear: number;
  claim: DevelopingClaim;
}

const m = (v: number): string => {
  const millions = v / 1_000_000;
  const s = Math.abs(millions) < 10 ? millions.toFixed(2) : millions.toFixed(1);
  return millions < 0 ? `(${s.replace('-', '')})` : s;
};

/** Every member the game knows about, by id. The roster is on the pool state
 *  and on every line, so a member who has since withdrawn is still resolvable. */
function memberIndex(gameState: GameState): Map<string, Member> {
  const out = new Map<string, Member>();
  for (const m of gameState.poolState.allMarketMembers ?? []) out.set(m.id, m);
  for (const ls of Object.values(gameState.poolState.lines) as (LinePoolState | undefined)[]) {
    for (const mem of ls?.members ?? []) out.set(mem.id, mem);
  }
  return out;
}

/**
 * Who the claim is. One member by name; several, counted.
 *
 * ⚠ "N members" RATHER THAN THE FIRST ONE, and Occurrence's own comment is the
 * authority: memberId there is optional precisely so the compiler forces every
 * consumer to handle the multi-member case instead of silently attributing a
 * pool-wide event to one member. A weather or catastrophe occurrence is exactly
 * that case.
 */
function memberLabel(claim: DevelopingClaim, members: Map<string, Member>): string {
  const ids = claim.memberIds ?? [];
  if (ids.length === 0) return '—';
  if (ids.length === 1) return members.get(ids[0])?.name ?? ids[0];
  return `${ids.length} members`;
}

const RATING_GROUP_LABEL: Record<string, string> = {
  county: 'County employer',
  schools: 'Schools employer',
  highSafety: 'High-safety employer',
  lowSafety: 'Low-safety employer',
};

/** Settled at this number, or still able to move. See the header. */
export function claimStatus(claim: DevelopingClaim): string {
  return claim.closed === true ? 'Settled' : 'Open';
}

/**
 * The description, assembled from stored fields — see the header for why it is
 * as thin as it is on GL.
 *
 * ⚠ IT NEVER INVENTS AND IT NEVER REPEATS A TEMPLATE OVER A MISSING FIELD. When
 * a line has nothing to say beyond the member's type, it says that and stops,
 * rather than emitting a sentence whose only variable is the member name.
 */
export function claimDescription(
  line: CoverageLine,
  claim: DevelopingClaim,
  members: Map<string, Member>,
): string {
  const ids = claim.memberIds ?? [];
  const only = ids.length === 1 ? members.get(ids[0]) : undefined;

  if (!only) return '—';

  if (line === 'WC') {
    // The rating group is WC's own risk descriptor and is not in the member's
    // name. Absent only on a member the roster has not stamped, which the
    // load-side repair in App.tsx exists to prevent.
    const group = only.wcRatingGroup ? RATING_GROUP_LABEL[only.wcRatingGroup] : undefined;
    if (group) return group;
  }
  return `${only.sizeCategory}, ${only.region}`;
}

export interface ClaimsMemoInput {
  gameState: GameState;
}

/**
 * The Claims Department's filing.
 *
 * ⚠ NO YEAR SELECTOR, AND THE EXHIBIT SAYS SO IN ITS OWN HEADING. These rows
 * are each occurrence's CURRENT value against its booked one, so they do not
 * follow a valuation date. That was true inside the actuarial memo too and was
 * labelled there; it is labelled here rather than quietly dropped because the
 * page around it now has no other year-bound content to make the point.
 */
export function buildClaimsMemo({ gameState }: ClaimsMemoInput): string {
  const lines = gameState.setup.activeLines;
  const members = memberIndex(gameState);
  const out: string[] = [];

  out.push('# Claims Department');
  out.push(
    '**Which claims developed.** Every occurrence this pool has seen development land on, '
    + 'ranked within its own line by how far it moved. Amounts are occurrence totals, GROSS of '
    + 'reinsurance, and are **as at today** rather than as at any selected valuation. '
    + 'A **settled** claim is settled at the figure shown and cannot move again; an **open** one can.',
  );

  let anyRows = false;
  for (const line of lines) {
    const state = gameState.poolState.lines[line];
    const rows: DevelopedRow[] = (state?.reserveCohorts ?? []).flatMap(c =>
      (c.developingClaims ?? [])
        .filter(d => Math.abs(d.current - d.original) >= MATERIAL_MOVEMENT)
        .map(d => ({ accidentYear: c.yearNumber, claim: d })),
    ).sort((a, b) =>
      (b.claim.current - b.claim.original) - (a.claim.current - a.claim.original));

    out.push(`## ${line}`);
    if (rows.length === 0) {
      out.push(`_No ${line} occurrence has developed by more than `
        + `$${MATERIAL_MOVEMENT.toLocaleString()}._`);
      continue;
    }
    anyRows = true;
    const shown = rows.slice(0, CLAIMS_ROWS_PER_LINE);
    out.push([
      '| Accident year | Member | Description | Status | As first written $M | Now $M | Development $M |',
      '|---:|---|---|---|---:|---:|---:|',
      ...shown.map(r => {
        const d = r.claim;
        return `| ${r.accidentYear} | ${memberLabel(d, members)} | `
          + `${claimDescription(line, d, members)} | ${claimStatus(d)} | `
          + `${m(d.original)} | ${m(d.current)} | ${m(d.current - d.original)} |`;
      }),
    ].join('\n'));
    if (rows.length > shown.length) {
      out.push(`_${rows.length - shown.length} further ${line} occurrence(s) have developed and are `
        + 'not shown; the claims workbook carries all of them._');
    }
  }

  // ⚠ THE ONE NOTE THAT SURVIVED THE MOVE, AND IT EXPLAINS AN ABSENCE RATHER
  // THAN NARRATING A NUMBER. A reader who knows the pool has pre-game accident
  // years will look for them and needs to be told why the oldest cannot appear.
  // The development prose that stood beside this exhibit — "a reserve movement
  // is not a number on its own" — went back to the actuarial page, beside the
  // reserve movement it is about.
  //
  // ⚠ AND IT IS NARROWER THAN THE SENTENCE IT REPLACES, WHICH WAS WRONG. The
  // old note said "the years inside Prior have no claim register, so they can
  // never contribute a row". Prior is every year older than PRIOR_BOUNDARY
  // (-2), and the seven MATURATION years inside it were really simulated and do
  // carry registers — measured, they contribute 211 of 839 developed
  // occurrences, and five of Workers' Compensation's top ten. The years with no
  // register are only the SEED cohorts, which sit further back still (-11 to
  // -13 on WC, and no line has one inside the maturation window). The old
  // sentence was describing the seeds and naming the whole of Prior.
  if (anyRows) {
    out.push(
      '_The oldest accident years carried in at game start were apportioned from an opening '
      + 'reserve total rather than built up from occurrences, so they have no claims to list here '
      + 'however much they develop. Every other year does, including the pre-game years._',
    );
  }

  return out.join('\n\n');
}
