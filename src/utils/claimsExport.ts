// Claim-level export — a SEPARATE workbook from resultsExport.ts's summary
// export, deliberately. That one is a per-metric summary table; bolting
// thousands of claim rows onto it would make it slow and unwieldy for what it
// is actually used for. This one exists only to make the claims and
// occurrences already sitting on the result objects inspectable directly.
//
// RULING 8 STANDS: nothing here persists. This reads Claim[]/Occurrence[] off
// ResultSet.byLine[line], which are already in-memory-only (see the comment on
// LineResultSet.claims) — this module never regenerates, recomputes, or stores
// anything, it only reformats what processYear already produced into rows.
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
// Property currently contributes ZERO rows, not an enrolled subset — it still
// runs the legacy aggregate path (fd77636), which never constructs a Claim or
// Occurrence at all. propertyClaimEngine.ts's attritional and weather
// generators exist but are unwired (e45232f, 7c2a97e). The Property sheet
// carries a note saying so, rather than reading as a bug.
// ============================================================================

import * as XLSX from 'xlsx';
import type { Claim, CoverageLine, Member, Occurrence, ResultSet } from '../types/simulation';
import { FIXED_LINE_ORDER, LINE_ABBREV } from './resultsExport';

type Row = (string | number)[];

const CLAIM_LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const ENROLLED_NOTE =
  'Pool losses are the ENROLLED subset only. Claims here already belong to enrolled members — ' +
  'claim-level detail for prospects is generated but discarded after year-end aggregation, so no ' +
  'prospect rows exist to filter. The Enrolled column is a real per-row membership check, kept for ' +
  'documentation and so this stays correct if that ever changes.';

const PROPERTY_NOTE =
  'Property still runs the legacy aggregate loss model (no claim-level generator wired into the live ' +
  'engine yet), so this sheet has NO rows today — that is expected, not missing data. ' +
  'propertyClaimEngine.ts has attritional and weather generators built but unwired.';

function safeStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function roundOrBlank(v: number | undefined): number | string {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : '';
}

function numOrBlank(v: number | undefined, digits = 4): number | string {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(digits)) : '';
}

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
const SHARED_TAIL_HEADER = ['Status', 'Gross Incurred', 'Gross Paid', 'Reported Year', 'Enrolled'];

function sharedCells(row: LineClaimRow): Row {
  const { claim, member } = row;
  return [
    claim.id, claim.occurrenceId, claim.memberId, safeStr(member?.name), safeStr(member?.type),
    claim.accidentYear, claim.calendarYear,
  ];
}

function sharedTailCells(row: LineClaimRow): Row {
  const { claim, enrolled } = row;
  return [claim.status, roundOrBlank(claim.grossUltimate), roundOrBlank(claim.paidToDate), claim.reportedYear, enrolled ? 'Yes' : 'No'];
}

function buildWcSheetRows(rows: LineClaimRow[]): Row[] {
  const header = [...SHARED_HEADER, 'Rating Class', 'Tier', ...SHARED_TAIL_HEADER];
  const body = sortClaimRows(rows).map(row => [
    ...sharedCells(row),
    safeStr(row.claim.ratingClass), row.claim.tier,
    ...sharedTailCells(row),
  ]);
  return [[`WC claims. ${ENROLLED_NOTE}`], header, ...body];
}

function buildGlSheetRows(rows: LineClaimRow[]): Row[] {
  const header = [
    ...SHARED_HEADER, 'Sub-Coverage', 'Legal Basis', 'Litigation Stage',
    'Status', 'Gross Incurred', 'Gross Paid', 'Indemnity', 'ALAE',
    'Reported Year', 'Settlement Year', 'Enrolled',
  ];
  const body = sortClaimRows(rows).map(({ claim, member, enrolled }) => [
    claim.id, claim.occurrenceId, claim.memberId, safeStr(member?.name), safeStr(member?.type),
    claim.accidentYear, claim.calendarYear,
    claim.tier, safeStr(claim.legalBasis), safeStr(claim.litigationStage),
    claim.status, roundOrBlank(claim.grossUltimate), roundOrBlank(claim.paidToDate),
    roundOrBlank(claim.indemnity), roundOrBlank(claim.alae),
    claim.reportedYear, claim.settlementYear ?? '', enrolled ? 'Yes' : 'No',
  ]);
  return [[`GL claims. ${ENROLLED_NOTE}`], header, ...body];
}

function buildPropertySheetRows(rows: LineClaimRow[]): Row[] {
  const header = [
    ...SHARED_HEADER, 'Band',
    'Status', 'Gross Incurred', 'Gross Paid', 'Damage Ratio', 'Location TIV',
    'Reported Year', 'Enrolled',
  ];
  const body = sortClaimRows(rows).map(({ claim, member, enrolled }) => [
    claim.id, claim.occurrenceId, claim.memberId, safeStr(member?.name), safeStr(member?.type),
    claim.accidentYear, claim.calendarYear,
    claim.tier,
    claim.status, roundOrBlank(claim.grossUltimate), roundOrBlank(claim.paidToDate),
    numOrBlank(claim.damageRatio), roundOrBlank(claim.locationTiv),
    claim.reportedYear, enrolled ? 'Yes' : 'No',
  ]);
  // Property's note leads with why the sheet is (currently) empty, since an
  // enrolled-scope note alone would read as "the prospects are missing" rather
  // than "nothing is generated yet" — a different and more important fact.
  return [[PROPERTY_NOTE], [ENROLLED_NOTE], header, ...body];
}

// One row per occurrence, pooled across every active claim line — a Line
// column is what makes that legible, the same way the shock-events sheet uses
// one row per event rather than one sheet per line.
//
// TOTAL GROSS is summed from the claims list by id, not read off any
// occurrence-level field (Occurrence carries no gross total of its own) — this
// is what turns a GL abuse batch's five claimant claims, or a weather event's
// forty location claims, into one legible row instead of an invisible grouping.
function buildOccurrenceRows(lockedResults: ResultSet[], activeLines: CoverageLine[]): Row[] {
  interface OccRow { occ: Occurrence; line: CoverageLine; totalGross: number; memberCount: number; }
  const rows: OccRow[] = [];

  for (const line of CLAIM_LINES) {
    if (!activeLines.includes(line)) continue;
    for (const r of lockedResults) {
      const lr = r.byLine[line];
      if (!lr?.occurrences?.length) continue;
      const grossByClaimId = new Map((lr.claims ?? []).map(c => [c.id, c.grossUltimate]));
      for (const occ of lr.occurrences) {
        let totalGross = 0;
        for (const claimId of occ.claimIds) totalGross += grossByClaimId.get(claimId) ?? 0;
        rows.push({ occ, line, totalGross, memberCount: occ.memberIds.length });
      }
    }
  }

  // "Member" has no single meaning for a multi-member event, so the closest
  // analogous sort to the claim sheets' (year, member, id) is (year, line, id).
  rows.sort((a, b) =>
    (a.occ.accidentYear - b.occ.accidentYear) ||
    a.line.localeCompare(b.line) ||
    a.occ.id.localeCompare(b.occ.id)
  );

  const header = [
    'Occurrence ID', 'Line', 'Accident Year', 'Calendar Year',
    'Claim Count', 'Member Count', 'Total Gross', 'Peril', 'Region',
  ];
  const note =
    'One row per occurrence, pooled across lines. Member Count is what distinguishes a multi-claim, ' +
    'single-member event (a GL abuse batch) from a genuinely multi-member one (a weather event) — ' +
    'Claim Count alone cannot tell the two apart. ' + ENROLLED_NOTE;
  const body = rows.map(({ occ, line, totalGross, memberCount }) => [
    occ.id, line, occ.accidentYear, occ.calendarYear,
    occ.claimIds.length, memberCount, Math.round(totalGross),
    safeStr(occ.peril), occ.region,
  ]);
  return [[note], header, ...body];
}

export function buildClaimsWorkbook(lockedResults: ResultSet[], activeLines: CoverageLine[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const orderedLines = FIXED_LINE_ORDER.filter(l => activeLines.includes(l));

  const sheetBuilders: Partial<Record<CoverageLine, (rows: LineClaimRow[]) => Row[]>> = {
    WC: buildWcSheetRows, GL: buildGlSheetRows, Property: buildPropertySheetRows,
  };

  for (const line of orderedLines) {
    const builder = sheetBuilders[line];
    if (!builder) continue;
    const rows = collectLineClaims(lockedResults, line);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(builder(rows)), line);
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildOccurrenceRows(lockedResults, activeLines)),
    'Occurrences'
  );

  return wb;
}

export function buildClaimsExportFilename(instanceId: string, activeLines: CoverageLine[], lockedResults: ResultSet[]): string {
  const lineTag = FIXED_LINE_ORDER.filter(l => activeLines.includes(l)).map(l => LINE_ABBREV[l]).join('_');
  const latestYear = lockedResults[lockedResults.length - 1]?.yearNumber ?? 0;
  return `SEED_${instanceId}_${lineTag}_CLAIMS_YR${latestYear}.xlsx`;
}
