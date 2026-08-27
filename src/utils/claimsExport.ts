// Claim-level export — a SEPARATE workbook from resultsExport.ts's summary
// export, deliberately. That one is a per-metric summary table; bolting
// thousands of claim rows onto it would make it slow and unwieldy for what it
// is actually used for. This one exists only to make the claims already sitting
// on the result objects, and the development that has landed on them,
// inspectable directly.
//
// RULING 8 STANDS: nothing here persists. This reads Claim[] off
// ResultSet.byLine[line], which is already in-memory-only (see the comment on
// LineResultSet.claims), and DevelopingClaim[] off the reserve cohorts, which
// persist for the engine's own reasons and not for this module's — it never
// regenerates, recomputes, or stores anything, it only reformats what
// processYear already produced into rows.
//
// ============================================================================
// READ THIS BEFORE TRUSTING A ROW COUNT FROM THIS FILE.
//
// LineResultSet.claims (WC, GL) is ENROLLED-ONLY, not marketplace-wide, even
// though claim generation itself runs marketplace-wide. simulationEngine.ts
// generates a SEPARATE prospect draw (`prospectGenerated`) to produce
// marketMemberLossResults for the whole 200-member roster, but only merges its
// MemberLossResult summaries — prospectGenerated.claims and .occurrences are
// never read anywhere and are discarded the moment that year finishes. So
// every claim and occurrence exported here already belongs to an enrolled
// member; there is no retained prospect claim-level detail to filter out.
//
// The `enrolled` column is still a REAL membership check against each result's
// own memberLossResults, not a hardcoded true, for two reasons: it documents
// the scope explicitly on the sheet itself (per the note row), and it costs
// nothing to make correct now so that if a future engine change ever starts
// retaining prospect claims (a natural next step given how much of this
// project is marketplace-wide already), this export flags them correctly
// without being touched again.
//
// ⚠ THE PARAGRAPH THAT STOOD HERE SAID PROPERTY CONTRIBUTES ZERO ROWS BECAUSE IT
// STILL RUNS THE LEGACY AGGREGATE PATH. Property cut over to a claim-level
// generator at 645c15e and its sheet carries real rows — 2,915 occurrences over
// 8 games x 10 years when this was measured. The claim was false in both halves
// and it was the worst kind of false: it told a reader checking Property's claims
// that an EMPTY SHEET WAS NORMAL, so a genuine generator failure would have read
// as expected behaviour.
//
// ⚠ AND IT SURVIVED BECAUSE NOBODY RE-READS AN EXPORT HEADER. Six statements in
// this file were true when written and false by the time they were found, all in
// one pass. When a mechanic is retired, grep the export layer — it describes the
// engine and is never exercised by a test.
// ============================================================================

import * as XLSX from 'xlsx';
import type { Claim, CoverageLine, Member, PoolState, ResultSet } from '../types/simulation';
import { FIXED_LINE_ORDER, LINE_ABBREV } from './resultsExport';

type Row = (string | number)[];

const CLAIM_LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const ENROLLED_NOTE =
  'Pool losses are the ENROLLED subset only. Claims here already belong to enrolled members — ' +
  'claim-level detail for prospects is generated but discarded after year-end aggregation, so no ' +
  'prospect rows exist to filter. The Enrolled column is a real per-row membership check, kept for ' +
  'documentation and so this stays correct if that ever changes.';

const PROPERTY_NOTE =
  'Property claims are drawn from a mixture fitted to the pool\'s own nine years of claims. Band is ' +
  'a tier label kept so Claim.tier stays populated — there is ONE band, not a set: the separate ' +
  'weather and catastrophe bands went with the fit (weather is inside the mixture; catastrophes are ' +
  'shock events now). Reported Year always equals Accident Year: Property carries no report lag.';

function safeStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function roundOrBlank(v: number | undefined): number | string {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : '';
}

// ============================================================================
// DEVELOPMENT, KEYED BY OCCURRENCE — the one lookup both the line sheets and the
// Development sheet read, so the two cannot disagree about what developed.
//
// ⚠ KEYED ON OCCURRENCE ID, NOT CLAIM ID, AND THE GRAIN IS THE REASON. The
// developing-claim record stores an OCCURRENCE total (developmentAllocation.ts
// cedes per occurrence, because the tower attaches per occurrence), while the
// line sheets are per CLAIM. Its `claimId` is the occurrence's FIRST claim —
// `o.claimIds[0]` — so joining on it would hand that one claim the whole
// occurrence's development and leave its siblings BLANK, which reads as "they did
// not develop" when they are part of an occurrence that did.
//
// Joining on occurrence id has no such failure mode: every claim in a developed
// occurrence shows the same figures, and the columns are NAMED "Occurrence ..."
// so nobody reads them as that claim's share. The alternative — apportioning the
// occurrence's development across its claims pro rata — would invent a split the
// model does not have.
//
// ⚠ VACUOUS TODAY, LIVE THE DAY A CAT BAND LANDS. Measured across 65,817
// occurrences on all three lines: ZERO carry more than one claim, so occurrence
// and claim are the same grain and every resolution agrees. But reinsuranceTower's
// header already requires a future catastrophe to be emitted as ONE occurrence
// with many claims, and on that day a claim-id join starts misattributing
// silently. This is written for that day rather than for today.
interface OccDevelopment {
  /** As the generator drew the occurrence. Never moves. */
  drawn: number;
  /** As first BOOKED — `drawn` less the cohort's optimistic markdown. */
  booked: number;
  current: number;
  /** current - booked. */
  dev: number;
  pct: number | '';
  accidentYear: number;
  /** Valuation year -> that year's change. Only years the occurrence actually
   *  moved in appear; a year it was valued at and did not move in is absent. */
  byYear: Map<number, number>;
}

function developmentByOccurrence(poolState: PoolState | undefined, line: CoverageLine): Map<string, OccDevelopment> {
  const m = new Map<string, OccDevelopment>();
  for (const c of poolState?.lines[line]?.reserveCohorts ?? []) {
    for (const d of c.developingClaims ?? []) {
      const dev = d.current - d.original;
      // ⚠ THE VALUATION YEAR IS DERIVED, NOT STORED. Index k of movementByStep
      // is the step from age k to age k+1, and a cohort takes its first step the
      // year AFTER the accident year it was written for — so k belongs to
      // valuation year `yearNumber + k + 1`. Storing the year on every entry
      // would carry the cohort's own accident year once per claim per step.
      const byYear = new Map<number, number>();
      (d.movementByStep ?? []).forEach((mv, k) => {
        if (mv !== 0) byYear.set(c.yearNumber + k + 1, mv);
      });
      m.set(d.occurrenceId, {
        drawn: d.drawn, booked: d.original, current: d.current, dev,
        pct: d.original > 0 ? Number(((dev / d.original) * 100).toFixed(1)) : '',
        accidentYear: c.yearNumber,
        byYear,
      });
    }
  }
  return m;
}

// The contiguous span of valuation years anything developed in, across every
// line — one span for the whole workbook so the sheets stay comparable and a
// column means the same thing on each. Contiguous rather than only the years
// that moved: a gap in the sequence reads as a missing column, not as a quiet
// year, and quiet is exactly what a blank is for.
function valuationYearSpan(devs: Map<string, OccDevelopment>[]): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of devs) {
    for (const d of m.values()) {
      for (const y of d.byYear.keys()) { if (y < lo) lo = y; if (y > hi) hi = y; }
    }
  }
  if (!Number.isFinite(lo)) return [];
  const out: number[] = [];
  for (let y = lo; y <= hi; y++) out.push(y);
  return out;
}

// ⚠ CHANGE, NOT LEVEL, IN THE YEAR COLUMNS, AND THAT IS THE WHOLE POINT OF THE
// SHAPE. A level column has to put SOMETHING in a year with no development, and
// the only honest candidate is the previous year's value — which says "valued
// and unmoved" in every cell where the truth is "not valued at all". That is the
// same defect as the reserve exhibit's retired "settled" label, in a wider grid.
// A change column has a natural empty: nothing happened, so nothing is printed.
//
// ⚠ FOUR LEVEL COLUMNS BRACKET THE CHANGES, AND THE ROW IS AN IDENTITY:
//
//     Booked Occurrence + sum(Yr ...) === Current Occurrence
//     Total Development === Current Occurrence - Booked Occurrence
//
// exactly, because movementByStep records precisely the per-valuation deltas
// from the booked value onward. Drawn Occurrence sits OUTSIDE that identity:
// drawn -> booked is the optimistic markdown, taken at inception rather than at
// a valuation, so it is deliberately not one of the Yr columns.
//
// ⚠ THE COLUMNS GROW WITH GAME LENGTH AND ARE NOT CAPPED. A 10-year game
// produces 12 of them — the span runs from Yr -1, when accident year -2 takes
// its first step, to the last locked year — for 30 columns on the widest sheet.
// A 20-year game would give 22 and about 40. That is wide, and it is the right
// wide: what fills it is a DIAGONAL, because a single row can never hold more
// than its cohort's horizon of entries (12 on WC, 8 on GL, 4 on Property) no
// matter how long the game runs. The band stays a fixed width and slides right.
//
// ⚠ THE "OCCURRENCE" PREFIX BECAME A SUFFIX, AND ONLY ON THE LEVEL COLUMNS.
// It used to lead every development column — Occurrence Original, Occurrence
// Development % — and it earned that when there were four of them and a separate
// Occurrences sheet to point at. It cannot survive onto twenty year columns:
// "Occurrence Yr 7" twenty times over is noise, and a HALF-prefixed block is
// worse than none, because the unprefixed columns then read as a different
// grain. So the levels carry it as a suffix (Drawn / Booked / Current
// Occurrence), matching what the Development sheet already called its own
// columns, and the year columns carry it in the note instead.
//
// This is a real, if small, loss and it is worth being honest about: the word in
// the header was never what stopped anyone summing a column. The DEV_NOTE's
// do-not-sum warning is, and the Development sheet being the one that totals
// correctly is the actual protection. Occurrence ID also sits on every row a few
// columns to the left, so the grain is visible in the data rather than only in a
// header word.
//
// Capping was considered and rejected. Every candidate — keep the last N years,
// fold the old ones into a "Prior" column, drop years nothing moved in —
// destroys the one thing the shape is for: a column that means the same
// valuation year on every row, so the diagonal is visible and a column can be
// totalled on the Development sheet. A triangle with its early columns folded up
// is not a triangle. If the width ever becomes the binding problem, the answer
// is a narrower ROW SET (filter to developed claims), not a narrower grid.
function devHeader(years: number[]): string[] {
  return [
    'Drawn Occurrence', 'Booked Occurrence',
    ...years.map(y => `Yr ${y}`),
    'Current Occurrence', 'Total Development',
  ];
}

// ⚠ BLANK, NOT ZERO, FOR A CLAIM THAT NEVER DEVELOPED — and that is a THIRD
// state, not a restatement of the -0.00 rule. "Moved by nothing" and "moved by
// too little to print" are the two that rule separates; "was never in the subset
// that can move at all" is neither, and a 0 in these columns would assert the
// claim was watched and held still.
//
// The year cells carry the same distinction one level down: blank is "this
// occurrence did not move this year" — whether because the cohort had matured,
// or because an adverse step went to the carriers and this is not one. A printed
// 0 is a real movement under a dollar, which the rounding is allowed to swallow.
//
// ⚠ WHAT THE CHANGE FORM GIVES UP, MEASURED. A blank cell BETWEEN two printed
// ones is a year the cohort was certainly still being valued in, so those blanks
// mean "valued and unmoved" while the leading and trailing ones mean "not
// valued". The shape cannot tell them apart. It costs almost nothing: over 6
// games x 10 years x 3 lines, 118 such cells out of 7,980 at defaults (1.5%) and
// 54 out of 8,136 under squeezed funding (0.7%). They arise where an ADVERSE
// step went to the carriers and this occurrence is a tracked non-carrier, so
// they thin out under squeeze — the unwind is live there, proportional, and
// moves every tracked occurrence every year. The ones that remain in that arm
// are pre-game accident years, which are written at default decisions in both
// arms and so never have an unwind.
//
// A level column would separate those two states and would then have to invent a
// value for the ~74% of cells that are blank because the claim's cohort had not
// started or had already finished — a far larger lie for a far smaller gain.
function devCells(dev: OccDevelopment | undefined, years: number[]): Row {
  if (!dev) return new Array<string>(years.length + 4).fill('');
  return [
    roundOrBlank(dev.drawn), roundOrBlank(dev.booked),
    ...years.map(y => (dev.byYear.has(y) ? roundOrBlank(dev.byYear.get(y)) : '')),
    roundOrBlank(dev.current), roundOrBlank(dev.dev),
  ];
}

const DEV_NOTE =
  'The development block at the right of this sheet is the claim\'s OCCURRENCE, joined on Occurrence ' +
  'ID — not the claim\'s own share of it. Gross Incurred is the CLAIM as drawn; Drawn Occurrence is ' +
  'the occurrence as drawn; Booked Occurrence is what the pool actually put on its register, which is ' +
  'LOWER than drawn whenever the line was funded below break-even and equal to it otherwise. Each ' +
  'Yr column is THAT YEAR\'S CHANGE, not the level, so Booked + all the Yr columns = Current exactly. ' +
  'A blank Yr cell means the occurrence did not move that year; a blank development block means the ' +
  'claim was never in the subset that carries development at all — a different thing from developing ' +
  'by zero. ⚠ DO NOT SUM DOWN THESE COLUMNS: on an occurrence with several claims every figure ' +
  'repeats on each of its rows. Every occurrence carries exactly one claim today, so the sum happens ' +
  'to be right, and it will stop being right the day a catastrophe band emits a multi-claim event. ' +
  'The Development sheet is one row per occurrence and is the one to total.';

// Every claim and its enrolled-membership flag, for one line across every
// locked year — the unit both the claim sheets and the occurrence totals are
// built from.
interface LineClaimRow {
  claim: Claim;
  member: Member | undefined;
  enrolled: boolean;
}

function collectLineClaims(lockedResults: ResultSet[], line: CoverageLine): LineClaimRow[] {
  const out: LineClaimRow[] = [];
  for (const r of lockedResults) {
    const lr = r.byLine[line];
    if (!lr?.claims?.length) continue;
    // memberLossResults is ENROLLED MEMBERS ONLY (see the type comment on
    // ResultSet) — exactly the check this column needs, computed fresh per
    // year since who is enrolled changes year to year.
    const enrolledIds = new Set(lr.memberLossResults.map(m => m.memberId));
    const memberById = new Map(lr.memberList.map(m => [m.id, m]));
    for (const claim of lr.claims) {
      out.push({ claim, member: memberById.get(claim.memberId), enrolled: enrolledIds.has(claim.memberId) });
    }
  }
  return out;
}

// Shared sort for every claim sheet: accident year, then member, then claim
// id, so one member's history reads as a consecutive block.
function sortClaimRows(rows: LineClaimRow[]): LineClaimRow[] {
  return [...rows].sort((a, b) =>
    (a.claim.accidentYear - b.claim.accidentYear) ||
    a.claim.memberId.localeCompare(b.claim.memberId) ||
    a.claim.id.localeCompare(b.claim.id)
  );
}

const SHARED_HEADER = [
  'Claim ID', 'Occurrence ID', 'Member ID', 'Member Name', 'Member Type',
  'Accident Year', 'Calendar Year',
];
function sharedCells(row: LineClaimRow): Row {
  const { claim, member } = row;
  return [
    claim.id, claim.occurrenceId, claim.memberId, safeStr(member?.name), safeStr(member?.type),
    claim.accidentYear, claim.calendarYear,
  ];
}

// ⚠ THE THREE PAYOUT-COMPONENT COLUMNS (Medical / Indemnity / Impairment) WERE
// REMOVED BY THE WC SEVERITY REBUILD, and they are not coming back in this
// shape. They were a decomposition of a TIERED severity — medical care cost,
// wage replacement during healing, and the scheduled permanent-impairment
// award — and the mixture model draws ONE amount per claim with no legs. There
// is nothing to decompose.
//
// This changes the sheet's SHAPE, so solo-export-guard's WC hash moves. That is
// expected and is a shape change, not a value change.
//
// What went with them: the separate 6.0% medical and 3.5% indemnity trends
// (there is now no severity trend at all), the hook a medical-fee-schedule
// shock would have attached to, and Phase 3's ability to develop medical and
// indemnity on different payout patterns. Recorded in CALIBRATION_FINDINGS.
const WC_COMPONENT_NOTE =
  'One amount per claim: WC severity is a per-rating-group lognormal mixture with no medical / ' +
  'indemnity split. Tier is the MIXTURE COMPONENT the claim was drawn from (small / medium / large / ' +
  'schoolsMedium, or "injected" for a shock claim) — these are NOT the retired medOnly / temp / perm / ' +
  'catastrophic tiers. Rating Class is the rating GROUP (county / schools / highSafety / lowSafety). ' +
  'Reported Year always equals Accident Year: WC\'s report lag and the IBNR inventory it fed were ' +
  'both removed, and every claim is reported in the year it happens. The column is KEPT rather than ' +
  'dropped so that if a lag is ever reintroduced the divergence shows up here immediately — a ' +
  'column that is always a copy is cheap; a reintroduced lag that is invisible in the export is not. ' +
  'Measured across 65,817 claims on all three lines: 0 differ.';

function buildWcSheetRows(rows: LineClaimRow[], dev: Map<string, OccDevelopment>, years: number[]): Row[] {
  const header = [
    ...SHARED_HEADER, 'Rating Group', 'Component', 'Status', 'Gross Incurred',
    'Gross Paid', 'Reported Year', 'Enrolled', ...devHeader(years),
  ];
  const body = sortClaimRows(rows).map(row => [
    ...sharedCells(row),
    safeStr(row.claim.ratingClass), row.claim.tier,
    row.claim.status, roundOrBlank(row.claim.grossUltimate),
    roundOrBlank(row.claim.paidToDate), row.claim.reportedYear, row.enrolled ? 'Yes' : 'No',
    ...devCells(dev.get(row.claim.occurrenceId), years),
  ]);
  return [[`WC claims. ${WC_COMPONENT_NOTE} ${DEV_NOTE} ${ENROLLED_NOTE}`], header, ...body];
}

// ⚠ THE SUB-COVERAGE / LEGAL BASIS / LITIGATION STAGE / INDEMNITY / ALAE /
// SETTLEMENT YEAR COLUMNS WERE REMOVED BY THE GL SUB-COVERAGE REBUILD, and
// they are not coming back in this shape. GL draws one amount per claim from
// a flat 3-component mixture with no sub-coverage, no liability gate, no
// litigation stage, no statutory cap (so no indemnity/ALAE split to report),
// and no report-lag trending (so no settlement year). There is nothing left
// to decompose.
//
// This changes the sheet's SHAPE, so solo-export-guard's GL hash moves. That
// is expected and is a shape change, not a value change.
const GL_COMPONENT_NOTE =
  'One amount per claim: GL severity is a flat 3-component lognormal mixture clamped at a per-claim ' +
  'ceiling that TRENDS — GL_SEVERITY_CAP is $100M in YEAR 1 and is carried forward by ' +
  'glSeverityTrend, so a later accident year is capped higher. With no sub-coverage, ' +
  'gate, litigation stage, or indemnity/ALAE split (ALAE is included in the drawn amount). Tier is ' +
  'the MIXTURE COMPONENT the claim was drawn from (component1 / component2 / component3) — these are ' +
  'NOT the retired general / epl / lawEnforcement / abuse sub-coverages. Reported Year always equals ' +
  'Accident Year: GL carries no report lag.';

function buildGlSheetRows(rows: LineClaimRow[], dev: Map<string, OccDevelopment>, years: number[]): Row[] {
  const header = [
    ...SHARED_HEADER, 'Component', 'Status', 'Gross Incurred',
    'Gross Paid', 'Reported Year', 'Enrolled', ...devHeader(years),
  ];
  const body = sortClaimRows(rows).map(row => [
    ...sharedCells(row),
    row.claim.tier,
    row.claim.status, roundOrBlank(row.claim.grossUltimate),
    roundOrBlank(row.claim.paidToDate), row.claim.reportedYear, row.enrolled ? 'Yes' : 'No',
    ...devCells(dev.get(row.claim.occurrenceId), years),
  ]);
  return [[`GL claims. ${GL_COMPONENT_NOTE} ${DEV_NOTE} ${ENROLLED_NOTE}`], header, ...body];
}

function buildPropertySheetRows(rows: LineClaimRow[], dev: Map<string, OccDevelopment>, years: number[]): Row[] {
  const header = [
    ...SHARED_HEADER, 'Band',
    // Damage Ratio and Location TIV are GONE with Property's rebuild. They were
    // components of the retired damageRatio x locationTiv severity and were
    // populated on no other line; the fitted mixture draws an amount directly,
    // so there is nothing for either column to hold.
    'Status', 'Gross Incurred', 'Gross Paid',
    'Reported Year', 'Enrolled', ...devHeader(years),
  ];
  const body = sortClaimRows(rows).map(({ claim, member, enrolled }) => [
    claim.id, claim.occurrenceId, claim.memberId, safeStr(member?.name), safeStr(member?.type),
    claim.accidentYear, claim.calendarYear,
    claim.tier,
    claim.status, roundOrBlank(claim.grossUltimate), roundOrBlank(claim.paidToDate),
    claim.reportedYear, enrolled ? 'Yes' : 'No',
    ...devCells(dev.get(claim.occurrenceId), years),
  ]);
  return [[PROPERTY_NOTE], [`${DEV_NOTE} ${ENROLLED_NOTE}`], header, ...body];
}

// ============================================================================
// ⚠ THE OCCURRENCES SHEET IS GONE. It was one row per occurrence pooled across
// lines, carrying Claim Count, Member Count, Total Gross, Peril and Region.
//
// It existed to distinguish a multi-claim SINGLE-MEMBER event from a multi-claim
// MULTI-MEMBER one, and that distinction needs multi-claim occurrences to exist.
// Measured at 0 out of 65,817 on all three lines: GL's abuse batches and
// Property's weather band, the only two things that ever emitted them, are both
// retired. With one claim per occurrence the sheet was a re-presentation of the
// three line sheets with fewer columns, and its two headline columns were the
// constant 1.
//
// ⚠ IT COMES BACK WITH THE CAT BAND, IF THE CAT BAND NEEDS IT. reinsuranceTower's
// header requires a catastrophe to be emitted as ONE occurrence with many claims,
// and on that day "was this one event or fifty" becomes a real question again.
// The data it read — Occurrence.claimIds, .memberIds, .peril, .region — is
// untouched and still on every result; nothing was removed from the engine to
// retire this sheet, only a view of it.
// ============================================================================

// ⚠ WHICH CLAIMS DEVELOPED, AND BY HOW MUCH — the sheet the $25.65M hit did not
// have a story for. A reserve deterioration used to be a number with nothing
// behind it: no claim moved, so the register looked identical before and after.
// It lands on claims now, and this is where a player can go and see WHICH.
//
// ⚠ READ FROM POOL STATE, NOT FROM lockedResults, because the developing claims
// live on the cohort and the cohort is current-state. The per-valuation columns
// come off the claim's own movement series, so this sheet is a TRIANGLE now
// rather than a pair of endpoints — but the rows are still "every occurrence
// that has ever developed, as at today", not a snapshot as at some past year.
function buildDevelopmentRows(poolState: PoolState, activeLines: CoverageLine[], years: number[]): Row[] {
  const header = [
    'Line', 'Accident Year', 'Occurrence ID', ...devHeader(years), 'Development %',
  ];
  const body: Row[] = [];
  for (const line of FIXED_LINE_ORDER.filter(l => activeLines.includes(l))) {
    // ⚠ THE SAME LOOKUP THE LINE SHEETS READ. This sheet is a filtered VIEW of
    // what they carry, and building it from a second traversal of the cohorts is
    // exactly how two views of one fact drift apart. One source, two
    // presentations — and now literally the same header, from devHeader().
    const rows = [...developmentByOccurrence(poolState, line).entries()]
      .sort((a, b) => (a[1].accidentYear - b[1].accidentYear) || a[0].localeCompare(b[0]));
    for (const [occurrenceId, d] of rows) {
      body.push([line, d.accidentYear, occurrenceId, ...devCells(d, years), d.pct]);
    }
  }
  const note =
    'Development on an accident year lands on these occurrences (see developmentAllocation.ts). Only ' +
    'the chosen subset is carried, not the whole register — cession is per occurrence and independent ' +
    'between occurrences, so the ones that did not move cede exactly what they always did. Amounts are ' +
    'OCCURRENCE totals, GROSS of reinsurance. A blank sheet means no accident year has developed yet, ' +
    'or the cohorts carrying it are all seed cohorts, which have no claim register. ' +
    '⚠ THIS IS THE SHEET TO TOTAL, and it is the only one that can be. The line sheets repeat an ' +
    'occurrence figure on each of its claims; these rows are one per occurrence and do not repeat, so ' +
    'a Yr column summed here is the pool\'s GROSS development in that valuation year across every ' +
    'line — a figure no line sheet gives. It cannot drift from them: both read one lookup. ' +
    '⚠ AND IT IS NOW THE ONLY POOLED-ACROSS-LINES VIEW IN THIS WORKBOOK, since the Occurrences sheet ' +
    'was retired (see the block comment above buildDevelopmentRows) — though it is pooled over ' +
    'DEVELOPED occurrences only, which is a smaller set than Occurrences carried and is not a ' +
    'replacement for it. ' +
    '⚠ IT ALSO CARRIES ROWS NO LINE SHEET CAN. The line sheets are built from locked results, which ' +
    'start at year 1; this one reads pool state, so the PRE-GAME accident years (-2 to 0) and their ' +
    'development appear here and nowhere else in this workbook. That alone stops it being a filtered ' +
    'duplicate of the line sheets. ' +
    'The Claim ID column was DROPPED: it held the occurrence\'s FIRST claim beside an occurrence-level ' +
    'amount, which is a misattribution waiting for the first multi-claim event.';
  return [[note], header, ...body];
}

export function buildClaimsWorkbook(
  lockedResults: ResultSet[],
  activeLines: CoverageLine[],
  poolState?: PoolState,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const orderedLines = FIXED_LINE_ORDER.filter(l => activeLines.includes(l));

  const sheetBuilders: Partial<Record<CoverageLine, (rows: LineClaimRow[], dev: Map<string, OccDevelopment>, years: number[]) => Row[]>> = {
    WC: buildWcSheetRows, GL: buildGlSheetRows, Property: buildPropertySheetRows,
  };

  // ⚠ ONE YEAR SPAN FOR THE WHOLE WORKBOOK, not one per sheet, so "Yr 7" is the
  // same column on WC as on Property and the sheets read side by side. Property
  // runs off in 2-4 years against WC's 5-12, so a per-sheet span would give the
  // three sheets three different grids over the same calendar.
  const devByLine = new Map(CLAIM_LINES.map(l => [l, developmentByOccurrence(poolState, l)]));
  const years = valuationYearSpan([...devByLine.values()]);

  for (const line of orderedLines) {
    const builder = sheetBuilders[line];
    if (!builder) continue;
    const rows = collectLineClaims(lockedResults, line);
    const dev = devByLine.get(line) ?? new Map<string, OccDevelopment>();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(builder(rows, dev, years)), line);
  }

  if (poolState) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(buildDevelopmentRows(poolState, activeLines, years)),
      'Development'
    );
  }

  return wb;
}

export function buildClaimsExportFilename(instanceId: string, activeLines: CoverageLine[], lockedResults: ResultSet[]): string {
  const lineTag = FIXED_LINE_ORDER.filter(l => activeLines.includes(l)).map(l => LINE_ABBREV[l]).join('_');
  const latestYear = lockedResults[lockedResults.length - 1]?.yearNumber ?? 0;
  return `SEED_${instanceId}_${lineTag}_CLAIMS_YR${latestYear}.xlsx`;
}
