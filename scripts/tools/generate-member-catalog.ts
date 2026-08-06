// One-time generator: src/data/roster_canonical_v2.csv -> src/data/memberCatalog.ts
//
// The canonical roster (200 members, $1,300M payroll) is the permanent, fixed
// marketplace — it never grows or shrinks. This script converts the CSV into a
// checked-in static TypeScript module (no runtime CSV parsing), replacing the
// old procedural 100-member generator. Re-run only if the CSV is replaced:
//
//   npx tsx scripts/tools/generate-member-catalog.ts
//
// v2 (current) vs v1 (src/data/roster_canonical.csv, kept for provenance):
// payroll rebalanced to County 30% / City 20% with the rest scaled to fill the
// remaining 50%; TIV and Region are now STORED CSV COLUMNS rather than derived
// in-repo. IDs, Names, Types and all four GL relativity columns are unchanged;
// Risk Quality is unchanged except four members clamped to 1.0 at source; the
// WC class columns moved only because payroll moved.
//
// What it does, and the decisions baked in (all user-approved):
// - Risk Quality is CLAMPED to a minimum of 1.0 (the documented 1-10 range).
//   The clamped member IDs are printed so the adjustment is visible.
// - sizeCategory buckets the 200 members over payroll-sorted order in the same
//   proportions as the old catalog's sizeForIndex (55% Small / 30% Medium /
//   12% Large / 3% Very Large -> 110 / 60 / 24 / 6 members). It is a DISPLAY
//   attribute only (MembershipPage's SizeBadge, the spreadsheet export); since
//   v2 it is no longer an input to TIV.
// - Property TIV is read STRAIGHT FROM THE CSV in final $M. The old derivation
//   (tivFor() over TIV_RANGES x TIV_TYPE_MULTIPLIER, then a PROPERTY_TIV_SCALE
//   multiplier applied at module load) is DELETED along with those constants —
//   TIV is authored data now, not a calibration knob.
// - Region is read STRAIGHT FROM THE CSV as 'North' | 'Central' | 'South'. The
//   old synthetic SeededRandom(42) weighted draw over regions 1-5 is DELETED.
// - Satisfaction keeps the old catalog's formula (6.2 + ((index*19)%23)/10) —
//   the CSV carries no satisfaction column.
// - The CSV's eight WC_*/GL_* class columns are NOT ingested: they are exactly
//   Type-determined (WC_CLASS_MIX / GL_RELATIVITIES in defaultAssumptions.ts).
//   This script VERIFIES the tables reproduce every CSV cell (WC dollars to
//   within $100; GL relativities exactly) and refuses to emit if they don't.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  WC_CLASS_MIX,
  GL_RELATIVITIES,
} from '../../src/data/defaultAssumptions';
import type { MemberType, Region, SizeCategory } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '../../src/data/roster_canonical_v2.csv');
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
  wc: [number, number, number, number]; // clerical, pubworks, police, fire ($M)
  gl: [number, number, number, number]; // gen, epl, lawenf, abuse (relativities)
}

// The CSV is machine-generated with no quoted commas — plain split is exact.
// The file is CRLF-terminated; strip \r or the last column parses corrupted.
const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/\r/g, '').trim().split('\n');
const header = raw[0].split(',');
const expectedHeader = 'ID,Name,Type,Payroll ($M),Risk Quality,Region,TIV ($M),WC_clerical,WC_pubworks,WC_police,WC_fire,GL_gen,GL_epl,GL_lawenf,GL_abuse';
if (header.join(',') !== expectedHeader) {
  throw new Error(`Unexpected CSV header:\n  got      ${header.join(',')}\n  expected ${expectedHeader}`);
}

const rows: CsvRow[] = raw.slice(1).filter(l => l.trim()).map(l => {
  const c = l.split(',');
  if (!VALID_TYPES.has(c[2])) throw new Error(`Row ${c[0]}: unknown Type "${c[2]}"`);
  if (!VALID_REGIONS.has(c[5])) throw new Error(`Row ${c[0]}: unknown Region "${c[5]}"`);
  return {
    id: c[0],
    name: c[1],
    type: c[2] as MemberType,
    payroll: parseFloat(c[3]),
    riskQualityRaw: parseFloat(c[4]),
    region: c[5] as Region,
    tiv: parseFloat(c[6]),
    wc: [parseFloat(c[7]), parseFloat(c[8]), parseFloat(c[9]), parseFloat(c[10])],
    gl: [parseFloat(c[11]), parseFloat(c[12]), parseFloat(c[13]), parseFloat(c[14])],
  };
});

if (rows.length !== 200) throw new Error(`Expected 200 rows, got ${rows.length}`);
if (new Set(rows.map(r => r.id)).size !== 200) throw new Error('Duplicate member IDs');

const payrollSum = rows.reduce((s, r) => s + r.payroll, 0);
if (Math.abs(payrollSum - 1300) > 0.01) {
  throw new Error(`Payroll sum ${payrollSum.toFixed(4)} deviates from $1,300M by more than $0.01M`);
}

// v2 payroll rebalance: County 30% / City 20% of the book, by design.
const shareOf = (type: string) =>
  rows.filter(r => r.type === type).reduce((s, r) => s + r.payroll, 0) / payrollSum;
for (const [type, target] of [['County', 0.30], ['City', 0.20]] as const) {
  if (Math.abs(shareOf(type) - target) > 0.001) {
    throw new Error(`${type} payroll share ${(shareOf(type) * 100).toFixed(2)}% deviates from ${target * 100}%`);
  }
}

const tivSum = rows.reduce((s, r) => s + r.tiv, 0);
if (Math.abs(tivSum - 5250.8) > 0.5) {
  throw new Error(`TIV sum $${tivSum.toFixed(1)}M deviates from the expected $5,250.8M`);
}

const regionCounts: Record<string, number> = { North: 0, Central: 0, South: 0 };
rows.forEach(r => { regionCounts[r.region]++; });
for (const [region, expected] of [['North', 72], ['Central', 61], ['South', 67]] as const) {
  if (regionCounts[region] !== expected) {
    throw new Error(`Region ${region} count ${regionCounts[region]} != expected ${expected}`);
  }
}

// --- Verify WC_CLASS_MIX reproduces the CSV's WC dollar columns (<= $100/cell) ---
// and GL_RELATIVITIES matches the CSV's GL columns exactly.
let worstWcResidualDollars = 0;
let worstWcCell = '';
for (const r of rows) {
  const mix = WC_CLASS_MIX[r.type];
  const fracs = [mix.clerical, mix.publicWorks, mix.police, mix.fire];
  fracs.forEach((f, i) => {
    const residual = Math.abs(f * r.payroll - r.wc[i]) * 1e6; // $M -> $
    if (residual > worstWcResidualDollars) {
      worstWcResidualDollars = residual;
      worstWcCell = `${r.id} col ${i}`;
    }
  });
  const rel = GL_RELATIVITIES[r.type];
  const rels = [rel.general, rel.epl, rel.lawEnforcement, rel.abuse];
  rels.forEach((v, i) => {
    if (v !== r.gl[i]) throw new Error(`${r.id}: GL_RELATIVITIES[${r.type}][${i}] = ${v} but CSV has ${r.gl[i]}`);
  });
}
if (worstWcResidualDollars > 100) {
  throw new Error(`WC_CLASS_MIX x payroll misses the CSV by $${worstWcResidualDollars.toFixed(2)} at ${worstWcCell} (limit $100)`);
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
const rowLines = rows.map((r, i) => {
  const size = sizeById.get(r.id)!;
  void i;
  return `  R('${r.id}', '${r.name.replace(/'/g, "\\'")}', '${r.type}', '${size}', '${r.region}', ${r.payroll}, ${riskQuality(r)}, ${r.tiv}),`;
});

const out = `// Canonical 200-member marketplace — GENERATED FILE, do not edit by hand.
// Source of truth: src/data/roster_canonical_v2.csv, converted by
// scripts/tools/generate-member-catalog.ts (see that script for every rule:
// risk-quality clamping, size bucketing, satisfaction).
//
// The roster is permanent and fixed: it never grows or shrinks, no entity is
// ever created or deleted, and it is deliberately independent of the game
// seed. Every game uses these same 200 entities; the seed only determines
// which of them begin in the pool. Payroll totals $1,300M (County 30% / City
// 20% by design) and drives both WC and GL exposure — public-entity pools have
// one payroll base, not a separate commercial-style GL revenue base.
//
// Property uses TIV, and Region is a stored attribute: BOTH ARE AUTHORED CSV
// COLUMNS as of roster v2, not derived here. TIV totals $5,250.8M (a blended
// 4.04x payroll) and carries no scale factor — the former PROPERTY_TIV_SCALE,
// TIV_RANGES and TIV_TYPE_MULTIPLIER are deleted. Region is North/Central/
// South as authored, replacing the former synthetic SeededRandom(42) draw over
// regions 1-5.
//
// Each member's WC class-payroll split and GL sub-line relativities are exact
// functions of its Type — see WC_CLASS_MIX and GL_RELATIVITIES in
// defaultAssumptions.ts. They are intentionally NOT stored per member.

import type { CoverageLine, Member, MemberType, Region, SizeCategory } from '../types/simulation';

export interface CanonicalRosterRow {
  id: string;
  name: string;
  type: MemberType;
  sizeCategory: SizeCategory;   // display only; no longer a TIV input
  region: Region;               // stored CSV column
  payroll: number;              // $M; the WC and GL exposure base
  riskQuality: number;          // 1-10 (clamped up to 1.0 at generation where the CSV was lower)
  tiv: number;                  // $M; the Property exposure base, final (no scale factor)
}

function R(
  id: string, name: string, type: MemberType, sizeCategory: SizeCategory,
  region: Region, payroll: number, riskQuality: number, tiv: number,
): CanonicalRosterRow {
  return { id, name, type, sizeCategory, region, payroll, riskQuality, tiv };
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
`;

fs.writeFileSync(OUT_PATH, out);

console.log(`Wrote ${OUT_PATH}`);
console.log(`  rows: ${rows.length}`);
console.log(`  payroll sum: $${payrollSum.toFixed(4)}M (target $1,300M, delta ${(payrollSum - 1300).toFixed(4)})`);
console.log(`  payroll shares: County ${(shareOf('County') * 100).toFixed(2)}%  City ${(shareOf('City') * 100).toFixed(2)}%`);
console.log(`  TIV sum: $${tivSum.toFixed(1)}M (blended ${(tivSum / payrollSum).toFixed(2)}x payroll)`);
console.log(`  region counts: ${JSON.stringify(regionCounts)}`);
console.log(`  WC_CLASS_MIX worst residual: $${worstWcResidualDollars.toFixed(2)} at ${worstWcCell} (limit $100)`);
console.log(`  GL_RELATIVITIES: exact match on all 800 cells`);
console.log(`  risk quality clamped to 1.0: ${clamped.length ? clamped.join(', ') : 'none'}`);
const sizes: Record<string, number> = {};
rows.forEach(r => { const s = sizeById.get(r.id)!; sizes[s] = (sizes[s] ?? 0) + 1; });
console.log(`  size buckets: ${JSON.stringify(sizes)}`);
