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
import type { Claim, CoverageLine, Member, Occurrence, PoolState, ResultSet } from '../types/simulation';
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
interface OccDevelopment { original: number; current: number; dev: number; pct: number | ''; accidentYear: number }

function developmentByOccurrence(poolState: PoolState | undefined, line: CoverageLine): Map<string, OccDevelopment> {
  const m = new Map<string, OccDevelopment>();
  for (const c of poolState?.lines[line]?.reserveCohorts ?? []) {
    for (const d of c.developingClaims ?? []) {
      const dev = d.current - d.original;
      m.set(d.occurrenceId, {
        original: d.original, current: d.current, dev,
        pct: d.original > 0 ? Number(((dev / d.original) * 100).toFixed(1)) : '',
        accidentYear: c.yearNumber,
      });
    }
  }
  return m;
}

const DEV_HEADER = [
  'Occurrence Original', 'Occurrence Current', 'Occurrence Development', 'Occurrence Development %',
];

// ⚠ BLANK, NOT ZERO, FOR A CLAIM THAT NEVER DEVELOPED — and that is a THIRD
// state, not a restatement of the -0.00 rule. "Moved by nothing" and "moved by
// too little to print" are the two that rule separates; "was never in the subset
// that can move at all" is neither, and a 0 in these columns would assert the
// claim was watched and held still.
function devCells(dev: OccDevelopment | undefined): Row {
  if (!dev) return ['', '', '', ''];
  return [roundOrBlank(dev.original), roundOrBlank(dev.current), roundOrBlank(dev.dev), dev.pct];
}

const DEV_NOTE =
  'The four Occurrence Development columns are the claim\'s OCCURRENCE, joined on Occurrence ID. ' +
  'Blank means the claim was never in the subset that carries development — a different thing from ' +
  'developing by zero. ⚠ DO NOT SUM THESE COLUMNS: on an occurrence with several claims the same ' +
  'figure repeats on each of its rows. Every occurrence carries exactly one claim today, so the sum ' +
  'happens to be right, and it will stop being right the day a catastrophe band emits a multi-claim ' +
  'event. Use the Development sheet for a total.';

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

function buildWcSheetRows(rows: LineClaimRow[], dev: Map<string, OccDevelopment>): Row[] {
  const header = [
    ...SHARED_HEADER, 'Rating Group', 'Component', 'Status', 'Gross Incurred',
    'Gross Paid', 'Reported Year', 'Enrolled', ...DEV_HEADER,
  ];
  const body = sortClaimRows(rows).map(row => [
    ...sharedCells(row),
    safeStr(row.claim.ratingClass), row.claim.tier,
    row.claim.status, roundOrBlank(row.claim.grossUltimate),
    roundOrBlank(row.claim.paidToDate), row.claim.reportedYear, row.enrolled ? 'Yes' : 'No',
    ...devCells(dev.get(row.claim.occurrenceId)),
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

function buildGlSheetRows(rows: LineClaimRow[], dev: Map<string, OccDevelopment>): Row[] {
  const header = [
    ...SHARED_HEADER, 'Component', 'Status', 'Gross Incurred',
    'Gross Paid', 'Reported Year', 'Enrolled', ...DEV_HEADER,
  ];
  const body = sortClaimRows(rows).map(row => [
    ...sharedCells(row),
    row.claim.tier,
    row.claim.status, roundOrBlank(row.claim.grossUltimate),
    roundOrBlank(row.claim.paidToDate), row.claim.reportedYear, row.enrolled ? 'Yes' : 'No',
    ...devCells(dev.get(row.claim.occurrenceId)),
  ]);
  return [[`GL claims. ${GL_COMPONENT_NOTE} ${DEV_NOTE} ${ENROLLED_NOTE}`], header, ...body];
}

function buildPropertySheetRows(rows: LineClaimRow[], dev: Map<string, OccDevelopment>): Row[] {
  const header = [
    ...SHARED_HEADER, 'Band',
    // Damage Ratio and Location TIV are GONE with Property's rebuild. They were
    // components of the retired damageRatio x locationTiv severity and were
    // populated on no other line; the fitted mixture draws an amount directly,
    // so there is nothing for either column to hold.
    'Status', 'Gross Incurred', 'Gross Paid',
    'Reported Year', 'Enrolled', ...DEV_HEADER,
  ];
  const body = sortClaimRows(rows).map(({ claim, member, enrolled }) => [
    claim.id, claim.occurrenceId, claim.memberId, safeStr(member?.name), safeStr(member?.type),
    claim.accidentYear, claim.calendarYear,
    claim.tier,
    claim.status, roundOrBlank(claim.grossUltimate), roundOrBlank(claim.paidToDate),
    claim.reportedYear, enrolled ? 'Yes' : 'No',
    ...devCells(dev.get(claim.occurrenceId)),
  ]);
  return [[PROPERTY_NOTE], [`${DEV_NOTE} ${ENROLLED_NOTE}`], header, ...body];
}

// One row per occurrence, pooled across every active claim line — a Line
// column is what makes that legible, the same way the shock-events sheet uses
// one row per event rather than one sheet per line.
//
// TOTAL GROSS is summed from the claims list by id, not read off any
// occurrence-level field (Occurrence carries no gross total of its own). The
// multi-claim events that made grouping matter — GL abuse batches, Property
// weather — are both retired, so the sum currently runs over exactly one claim
// every time. Kept summing rather than collapsed to a lookup because a cat band
// brings them straight back, and the tower's correctness depends on the grouping
// being right on the day it does.
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
    'One row per occurrence, pooled across lines. ⚠ EVERY OCCURRENCE CARRIES EXACTLY ONE CLAIM TODAY ' +
    'on all three lines — measured at 0 multi-claim occurrences out of 65,817 — because GL\'s abuse ' +
    'batches and Property\'s weather band, the two multi-claim events this sheet was built to make ' +
    'legible, were both removed. Claim Count and Member Count are kept because a catastrophe band ' +
    'would reintroduce multi-claim occurrences immediately, and the reinsurance tower REQUIRES such ' +
    'an event to be modelled as ONE occurrence (see reinsuranceTower.ts) — these two columns are how ' +
    'a reader would check that it was. ' + ENROLLED_NOTE;
  const body = rows.map(({ occ, line, totalGross, memberCount }) => [
    occ.id, line, occ.accidentYear, occ.calendarYear,
    occ.claimIds.length, memberCount, Math.round(totalGross),
    safeStr(occ.peril), occ.region,
  ]);
  return [[note], header, ...body];
}

// ⚠ WHICH CLAIMS DEVELOPED, AND BY HOW MUCH — the sheet the $25.65M hit did not
// have a story for. A reserve deterioration used to be a number with nothing
// behind it: no claim moved, so the register looked identical before and after.
// It lands on claims now, and this is where a player can go and see WHICH.
//
// ⚠ READ FROM POOL STATE, NOT FROM lockedResults, because the developing claims
// live on the cohort and the cohort is current-state. That also means this sheet
// is AS AT NOW rather than per-year: it shows each accident year's developing
// claims at their latest value, not a year-by-year triangle of them. The
// Actuarial memorandum carries the per-year view.
function buildDevelopmentRows(poolState: PoolState, activeLines: CoverageLine[]): Row[] {
  const header = [
    'Line', 'Accident Year', 'Occurrence ID', 'Original Occurrence',
    'Current Occurrence', 'Development', 'Development %',
  ];
  const body: Row[] = [];
  for (const line of FIXED_LINE_ORDER.filter(l => activeLines.includes(l))) {
    // ⚠ THE SAME LOOKUP THE LINE SHEETS READ. This sheet is now a filtered VIEW
    // of what they carry, and building it from a second traversal of the cohorts
    // is exactly how two views of one fact drift apart. One source, two
    // presentations.
    const rows = [...developmentByOccurrence(poolState, line).entries()]
      .sort((a, b) => (a[1].accidentYear - b[1].accidentYear) || a[0].localeCompare(b[0]));
    for (const [occurrenceId, d] of rows) {
      body.push([
        line, d.accidentYear, occurrenceId,
        roundOrBlank(d.original), roundOrBlank(d.current), roundOrBlank(d.dev), d.pct,
      ]);
    }
  }
  const note =
    'Development on an accident year lands on these occurrences (see developmentAllocation.ts). Only ' +
    'the chosen subset is carried, not the whole register — cession is per occurrence and independent ' +
    'between occurrences, so the ones that did not move cede exactly what they always did. Amounts are ' +
    'OCCURRENCE totals, GROSS of reinsurance. A blank sheet means no accident year has developed yet, ' +
    'or the cohorts carrying it are all seed cohorts, which have no claim register. ' +
    '⚠ KEPT ALONGSIDE THE PER-CLAIM COLUMNS ON THE LINE SHEETS, not instead of them: this is the only ' +
    'view that is POOLED ACROSS LINES and one row per developed occurrence, so "what developed?" reads ' +
    'in tens of rows rather than by filtering three sheets of thousands. It cannot drift from them — ' +
    'both read one lookup — and it is the column to total, because these rows do not repeat. ' +
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

  const sheetBuilders: Partial<Record<CoverageLine, (rows: LineClaimRow[], dev: Map<string, OccDevelopment>) => Row[]>> = {
    WC: buildWcSheetRows, GL: buildGlSheetRows, Property: buildPropertySheetRows,
  };

  for (const line of orderedLines) {
    const builder = sheetBuilders[line];
    if (!builder) continue;
    const rows = collectLineClaims(lockedResults, line);
    const dev = developmentByOccurrence(poolState, line);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(builder(rows, dev)), line);
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(buildOccurrenceRows(lockedResults, activeLines)),
    'Occurrences'
  );

  if (poolState) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(buildDevelopmentRows(poolState, activeLines)),
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
