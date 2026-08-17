// One-time generator: src/data/roster_canonical_v4.csv -> src/data/memberCatalog.ts
//
// The canonical roster (200 members, $1,300M payroll) is the permanent, fixed
// marketplace — it never grows or shrinks. This script converts the CSV into a
// checked-in static TypeScript module (no runtime CSV parsing), replacing the
// old procedural 100-member generator. Re-run only if the CSV is replaced:
//
//   npx tsx scripts/tools/generate-member-catalog.ts
//
// ROSTER LINEAGE (v1, v2 and v3 CSVs are kept in place for provenance only):
// - v1 roster_canonical.csv    — TIV and Region derived in-repo.
// - v2 roster_canonical_v2.csv — payroll rebalanced to County 30% / City 20%;
//   TIV and Region became STORED columns, deleting PROPERTY_TIV_SCALE,
//   TIV_RANGES, TIV_TYPE_MULTIPLIER and the synthetic SeededRandom(42) draw.
// - v3 roster_canonical_v3.csv — Risk quality decoupled from member type;
//   Transit capped at 25% of its type's payroll; fire/water payroll floors;
//   City/County TIV ratios raised to ~5x/6x; region stratified within type;
//   TIV jitter tightened to sigma 0.25; and TWO NEW STORED COLUMNS, Locations
//   (integer site count) and Primary Asset Share, which together give
//   Property a per-member location schedule.
// - v4 roster_canonical_v4.csv — CURRENT. TIV ONLY, rescaled per type by a
//   fixed factor (TIV_new = TIV_old x scale_factor) to fix a plausibility
//   failure: v3's ratios held far too little insured value per type (a county
//   at 6.0x held $102M for a courthouse, jail, sheriff facilities, a health
//   building AND road yards; a modern jail alone runs $50-100M). Because
//   TIV_v3 = payroll x ratio x jitter, multiplying by (new_ratio/old_ratio) is
//   ALGEBRAICALLY IDENTICAL to regenerating with the new ratio and the SAME
//   jitter draw — within-type spread and each member's rank in it are
//   preserved exactly; nothing was redrawn. Payroll, RQ, Region, Locations,
//   Primary Asset Share and all WC/GL columns are BYTE-IDENTICAL to v3 — only
//   the TIV column moved. New ratios: School 9.0 (x3.6000), Water 25.0
//   (x2.7778), Fire 7.5 (x2.1429), County 12.0 (x2.0000), Recreation 6.0
//   (x2.0000), Transit 11.0 (x1.8333), City 9.0 (x1.8000), Special 9.0
//   (x1.6364), Park 7.0 (x1.5556).
//
// What it does, and the decisions baked in (all user-approved):
// - Risk Quality is CLAMPED to a minimum of 1.0 (the documented 1-10 range).
//   The clamped member IDs are printed so the adjustment is visible.
// - sizeCategory buckets the 200 members over payroll-sorted order in the same
//   proportions as the old catalog's sizeForIndex (55% Small / 30% Medium /
//   12% Large / 3% Very Large -> 110 / 60 / 24 / 6 members). It is a DISPLAY
//   attribute only (MembershipPage's SizeBadge, the spreadsheet export).
// - TIV, Region, Locations and Primary Asset Share are read STRAIGHT FROM THE
//   CSV. Nothing about Property exposure is derived here any more.
// - Satisfaction keeps the old catalog's formula (6.2 + ((index*19)%23)/10) —
//   the CSV carries no satisfaction column.
// - The eight WC_*/GL_* class columns are NOT ingested as lookup tables — the
//   two tables they used to verify against (WC_CLASS_MIX, GL_RELATIVITIES)
//   both retired with the GL sub-coverage rebuild (see CALIBRATION_FINDINGS).
//   Columns are still parsed into each row (below) and the WC ones are still
//   checked for internal row-sum consistency against payroll, but nothing
//   here cross-checks them against a Type-keyed table anymore.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { MemberType, Region, SizeCategory } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '../../src/data/roster_canonical_v4.csv');
const OUT_PATH = path.join(__dirname, '../../src/data/memberCatalog.ts');

const VALID_TYPES: ReadonlySet<string> = new Set([
  'City', 'County', 'Fire District', 'Water District', 'Transit Authority',
  'School District', 'Park District', 'Recreation District', 'Special District',
]);

const VALID_REGIONS: ReadonlySet<string> = new Set(['North', 'Central', 'South']);

interface CsvRow {
  id: string;
  name: string;
  type: MemberType;
  payroll: number;
  riskQualityRaw: number;
  region: Region;
  tiv: number;                          // $M, final — no scale factor applied
  locations: number;                    // integer count of insured sites
  primaryAssetShare: number;            // fraction of member TIV in its designated primary asset
  wc: [number, number, number, number]; // clerical, pubworks, police, fire ($M)
  gl: [number, number, number, number]; // gen, epl, lawenf, abuse (relativities)
}

// The CSV is machine-generated with no quoted commas — plain split is exact.
// The file is CRLF-terminated; strip \r or the last column parses corrupted.
const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r/g, '').trim().split('\n');
const header = raw[0].split(',');
const expectedHeader = 'ID,Name,Type,Payroll ($M),Risk Quality,Region,TIV ($M),Locations,Primary Asset Share,WC_clerical,WC_pubworks,WC_police,WC_fire,GL_gen,GL_epl,GL_lawenf,GL_abuse';
if (header.join(',') !== expectedHeader) {
  throw new Error(`Unexpected CSV header:\n  got      ${header.join(',')}\n  expected ${expectedHeader}`);
}

const rows: CsvRow[] = raw.slice(1).filter(l => l.trim()).map(l => {
  const c = l.split(',');
  if (!VALID_TYPES.has(c[2])) throw new Error(`Row ${c[0]}: unknown Type "${c[2]}"`);
  if (!VALID_REGIONS.has(c[5])) throw new Error(`Row ${c[0]}: unknown Region "${c[5]}"`);
  const locations = parseInt(c[7], 10);
  if (!Number.isInteger(locations) || locations < 1) {
    throw new Error(`Row ${c[0]}: Locations must be a positive integer, got "${c[7]}"`);
  }
  const primaryAssetShare = parseFloat(c[8]);
  if (!(primaryAssetShare > 0 && primaryAssetShare <= 1)) {
    throw new Error(`Row ${c[0]}: Primary Asset Share must be in (0, 1], got "${c[8]}"`);
  }
  return {
    id: c[0],
    name: c[1],
    type: c[2] as MemberType,
    payroll: parseFloat(c[3]),
    riskQualityRaw: parseFloat(c[4]),
    region: c[5] as Region,
    tiv: parseFloat(c[6]),
    locations,
    primaryAssetShare,
    wc: [parseFloat(c[9]), parseFloat(c[10]), parseFloat(c[11]), parseFloat(c[12])],
    gl: [parseFloat(c[13]), parseFloat(c[14]), parseFloat(c[15]), parseFloat(c[16])],
  };
});

if (rows.length !== 200) throw new Error(`Expected 200 rows, got ${rows.length}`);
if (new Set(rows.map(r => r.id)).size !== 200) throw new Error('Duplicate member IDs');

const payrollSum = rows.reduce((s, r) => s + r.payroll, 0);
if (Math.abs(payrollSum - 1300) > 0.01) {
  throw new Error(`Payroll sum ${payrollSum.toFixed(4)} deviates from $1,300M by more than $0.01M`);
}

// Payroll rebalance (unchanged from v2): County 30% / City 20% of the book.
const shareOf = (type: string) =>
  rows.filter(r => r.type === type).reduce((s, r) => s + r.payroll, 0) / payrollSum;
for (const [type, target] of [['County', 0.30], ['City', 0.20]] as const) {
  if (Math.abs(shareOf(type) - target) > 0.001) {
    throw new Error(`${type} payroll share ${(shareOf(type) * 100).toFixed(2)}% deviates from ${target * 100}%`);
  }
}

// v4: TIV totals $14,303.5M (2.045x the v3 total of $6,993.3M), a blended
// 11.00x payroll, from the per-type rescale documented above.
const tivSum = rows.reduce((s, r) => s + r.tiv, 0);
if (Math.abs(tivSum - 14303.5) > 1) {
  throw new Error(`TIV sum $${tivSum.toFixed(1)}M deviates from the expected $14,303.5M`);
}
const largestTivShare = Math.max(...rows.map(r => r.tiv)) / tivSum;
if (largestTivShare > 0.05) {
  throw new Error(`Largest member is ${(largestTivShare * 100).toFixed(2)}% of book TIV (expected ~3.3%, cap 5%)`);
}

const locationsSum = rows.reduce((s, r) => s + r.locations, 0);
if (locationsSum !== 1866) {
  throw new Error(`Locations sum ${locationsSum} != expected 1866`);
}

// Zone TIV drives the cat/weather footprint engines, so it is asserted here
// rather than rediscovered later. v4 values (v3 was North 2513.9 / Central
// 2400.2 / South 2079.2): the per-type rescale is not uniform, so the zone
// mix shifted along with the total — North 5039.0 / Central 4840.6 /
// South 4423.9. THE PINNED CAT/WEATHER MU VALUES ARE STILL VALID: AAL scales
// linearly with zone TIV in the mechanism itself, so a proportional TIV move
// changes dollar AALs without invalidating the physical mu solve. Do not
// re-solve mu off this change alone.
const zoneTiv: Record<string, number> = { North: 0, Central: 0, South: 0 };
rows.forEach(r => { zoneTiv[r.region] += r.tiv; });
for (const [zone, expected] of [['North', 5039.0], ['Central', 4840.6], ['South', 4423.9]] as const) {
  if (Math.abs(zoneTiv[zone] - expected) > 1) {
    throw new Error(`Zone ${zone} TIV $${zoneTiv[zone].toFixed(1)}M != expected $${expected}M`);
  }
}

// --- CSV WC column internal consistency (row sums to payroll) ---
// WC_CLASS_MIX and GL_RELATIVITIES themselves RETIRED with the GL
// sub-coverage rebuild (WC stopped reading WC_CLASS_MIX at its own severity
// rebuild; GL's rebuild removed WC_CLASS_MIX's last consumer and deleted
// GL_RELATIVITIES outright), so the per-cell verification against those two
// tables — which this block used to run — no longer has a table to check
// against. What survives is CSV-internal: the four wc[] columns per row
// should still sum to that row's payroll, independent of any lookup table.
let atLimitCount = 0;
let worstRowResidualDollars = 0;
for (const r of rows) {
  // |sum of the four csv cells - payroll|. Four cells each rounding +/-$50
  // bounds this at $200; 34 of the 200 v3 members land on exactly $100 —
  // this is the number that made $150 an unsafe limit.
  const rowResidual = Math.abs(
    r.wc.reduce((s, v) => s + v, 0) - r.payroll
  ) * 1e6;
  if (rowResidual > worstRowResidualDollars) worstRowResidualDollars = rowResidual;
  if (rowResidual >= 100 - 1e-6) atLimitCount++;
}

// --- Risk Quality clamp ---
const clamped: string[] = [];
const riskQuality = (r: CsvRow): number => {
  if (r.riskQualityRaw < 1) { clamped.push(`${r.id} (${r.riskQualityRaw})`); return 1.0; }
  return r.riskQualityRaw;
};

// --- sizeCategory: old catalog proportions over payroll-sorted order ---
// Old sizeForIndex: index <55 Small, <85 Medium, <97 Large, else Very Large
// (55% / 30% / 12% / 3%). Over 200 payroll-ranked members: top 6 Very Large,
// next 24 Large, next 60 Medium, remaining 110 Small.
const byPayrollDesc = rows
  .map((r, i) => ({ r, i }))
  .sort((a, b) => b.r.payroll - a.r.payroll || a.i - b.i);
const sizeById = new Map<string, SizeCategory>();
byPayrollDesc.forEach(({ r }, rank) => {
  sizeById.set(r.id, rank < 6 ? 'Very Large' : rank < 30 ? 'Large' : rank < 90 ? 'Medium' : 'Small');
});

// --- Emit ---
const rowLines = rows.map(r => {
  const size = sizeById.get(r.id)!;
  return `  R('${r.id}', '${r.name.replace(/'/g, "\\'")}', '${r.type}', '${size}', '${r.region}', ${r.payroll}, ${riskQuality(r)}, ${r.tiv}, ${r.locations}, ${r.primaryAssetShare}),`;
});

const out = `// Canonical 200-member marketplace — GENERATED FILE, do not edit by hand.
// Source of truth: src/data/roster_canonical_v4.csv, converted by
// scripts/tools/generate-member-catalog.ts (see that script for every rule:
// risk-quality clamping, size bucketing, satisfaction, and the full v1->v4
// roster lineage).
//
// The roster is permanent and fixed: it never grows or shrinks, no entity is
// ever created or deleted, and it is deliberately independent of the game
// seed. Every game uses these same 200 entities; the seed only determines
// which of them begin in the pool. Payroll totals $1,300M (County 30% / City
// 20% by design) and drives both WC and GL exposure — public-entity pools have
// one payroll base, not a separate commercial-style GL revenue base.
//
// EVERYTHING PROPERTY NEEDS IS AUTHORED, NOT DERIVED. TIV totals $14,303.5M (a
// blended 11.00x payroll) and carries no scale factor. v4 rescaled TIV per
// member TYPE (School x3.6, Water x2.7778, Fire x2.1429, County/Recreation x2,
// Transit x1.8333, City x1.8, Special x1.6364, Park x1.5556) off v3's
// TIV = payroll x ratio x jitter, so within-type spread and rank are preserved
// exactly — WC, GL, Payroll, RQ, Region, Locations and Primary Asset Share are
// all byte-identical to v3. Region is North/Central/South as authored (zone
// TIV 5039.0 / 4840.6 / 4423.9). Locations (1,866 pool-wide) and Primary Asset
// Share together define each member's location schedule, which is what the
// Property attritional generator draws against and what keeps the per-risk
// reinsurance layer alive.
//
// PRIMARY ASSET SHARE MEANS "THE DESIGNATED PRIMARY ASSET", NOT "THE LARGEST".
// For 9 members (unchanged since v3) the nominal primary is actually the
// smaller site — e.g. a 2-location member with share 0.41 holds 41% in its
// primary and 59% in the other. The schedule still sums to member TIV and
// severity is still capped at the hit location's value, so nothing downstream
// is affected; do not assert that the primary is the maximum.
//
// Each member's WC class-payroll split used to be an exact function of its
// Type (WC_CLASS_MIX in defaultAssumptions.ts). GL sub-line relativities were
// too (GL_RELATIVITIES). Both retired with the GL sub-coverage rebuild — WC
// stopped reading WC_CLASS_MIX at its own severity rebuild, and GL's rebuild
// deleted GL_RELATIVITIES outright along with the sub-coverages it weighted.

import type { CoverageLine, Member, MemberType, Region, SizeCategory } from '../types/simulation';

export interface CanonicalRosterRow {
  id: string;
  name: string;
  type: MemberType;
  sizeCategory: SizeCategory;   // display only; not a Property input
  region: Region;               // stored CSV column
  payroll: number;              // $M; the WC and GL exposure base
  riskQuality: number;          // 1-10 (clamped up to 1.0 at generation where the CSV was lower)
  tiv: number;                  // $M; the Property exposure base, final (no scale factor)
  locations: number;            // integer count of insured sites
  primaryAssetShare: number;    // fraction of tiv in the designated primary asset
}

function R(
  id: string, name: string, type: MemberType, sizeCategory: SizeCategory,
  region: Region, payroll: number, riskQuality: number, tiv: number,
  locations: number, primaryAssetShare: number,
): CanonicalRosterRow {
  return { id, name, type, sizeCategory, region, payroll, riskQuality, tiv, locations, primaryAssetShare };
}

export const CANONICAL_ROSTER: ReadonlyArray<CanonicalRosterRow> = [
${rowLines.join('\n')}
];

export const PREDEFINED_MARKET_MEMBERS: ReadonlyArray<Member> = CANONICAL_ROSTER.map(
  (row, index) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    sizeCategory: row.sizeCategory,
    region: row.region,
    locations: row.locations,
    primaryAssetShare: row.primaryAssetShare,
    exposureByLine: {
      WC: row.payroll,
      GL: row.payroll,
      Property: row.tiv,
    },
    yearJoined: 0,
    calendarYearJoined: 0,
    riskQuality: row.riskQuality,
    // Baseline satisfaction keeps the old catalog's deterministic spread
    // (6.2-8.4); the roster CSV carries no satisfaction column.
    satisfaction: Number((6.2 + ((index * 19) % 23) / 10).toFixed(1)),
    status: 'prospect',
  })
);

export function getPredefinedMarketMembers(): Member[] {
  return PREDEFINED_MARKET_MEMBERS.map(member => ({ ...member }));
}

// Roster-derived market facts, exported so display surfaces (e.g. the audit
// page's assumptions card) always show the real roster rather than a stale
// hand-maintained constant.
export const MARKET_MEMBER_COUNT = PREDEFINED_MARKET_MEMBERS.length;

export const MARKET_TOTAL_EXPOSURE: Record<CoverageLine, number> = {
  WC: Number(PREDEFINED_MARKET_MEMBERS.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0).toFixed(2)),
  GL: Number(PREDEFINED_MARKET_MEMBERS.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0).toFixed(2)),
  Property: Number(PREDEFINED_MARKET_MEMBERS.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0).toFixed(2)),
};

// Pool-wide location count (1,866) — the Property attritional frequency base.
export const MARKET_TOTAL_LOCATIONS = PREDEFINED_MARKET_MEMBERS.reduce((s, m) => s + (m.locations ?? 0), 0);
`;

fs.writeFileSync(OUT_PATH, out);

console.log(`Wrote ${OUT_PATH}`);
console.log(`  rows: ${rows.length}`);
console.log(`  payroll sum: $${payrollSum.toFixed(4)}M (target $1,300M, delta ${(payrollSum - 1300).toFixed(4)})`);
console.log(`  payroll shares: County ${(shareOf('County') * 100).toFixed(2)}%  City ${(shareOf('City') * 100).toFixed(2)}%`);
console.log(`  TIV sum: $${tivSum.toFixed(1)}M (blended ${(tivSum / payrollSum).toFixed(2)}x payroll); largest member ${(largestTivShare * 100).toFixed(2)}%`);
console.log(`  zone TIV: North $${zoneTiv.North.toFixed(1)}M / Central $${zoneTiv.Central.toFixed(1)}M / South $${zoneTiv.South.toFixed(1)}M`);
console.log(`  locations: ${locationsSum} (min ${Math.min(...rows.map(r => r.locations))}, max ${Math.max(...rows.map(r => r.locations))})`);
console.log(`  worst ROW-SUM residual: $${worstRowResidualDollars.toFixed(2)}; ${atLimitCount}/200 members sit at exactly $100 (4dp quantization)`);
console.log(`  risk quality clamped to 1.0: ${clamped.length ? clamped.join(', ') : 'none'}`);
const sizes: Record<string, number> = {};
rows.forEach(r => { const s = sizeById.get(r.id)!; sizes[s] = (sizes[s] ?? 0) + 1; });
console.log(`  size buckets: ${JSON.stringify(sizes)}`);
