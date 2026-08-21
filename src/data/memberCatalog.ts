// Canonical 200-member marketplace — GENERATED FILE, do not edit by hand.
// Source of truth: src/data/roster_canonical_v5.csv, converted by
// scripts/tools/generate-member-catalog.ts (see that script for every rule:
// risk-quality clamping, size bucketing, satisfaction, and the full v1->v5
// roster lineage).
//
// The roster is permanent and fixed: it never grows or shrinks, no entity is
// ever created or deleted, and it is deliberately independent of the game
// seed. Every game uses these same 200 entities; the seed only determines
// which of them begin in the pool. Payroll totals $1,300M (County 30% / City
// 20% by design) and drives both WC and GL exposure — public-entity pools have
// one payroll base, not a separate commercial-style GL revenue base.
//
// EVERYTHING PROPERTY NEEDS IS AUTHORED, NOT DERIVED. TIV totals $17,000.0M (a
// blended 13.08x payroll) and carries no scale factor.
//
// ⚠ 13.08x IS A DESIGN CHOICE, NOT A CALIBRATION, and it must not be read as
// one. The real pool this model is built from runs about 4.6x. The model pool
// is deliberately MORE PROPERTY-HEAVY than the book Property's severity was
// fitted from, so that Property is a line whose reinsurance decision can
// matter rather than a rounding error next to WC and GL.
//
// Measured, which is what the choice was made against: at v4's $14,303.6M
// Property was 8.1% of gross pool loss with 9.0 enrolled claims a year and an
// annual CV of 1.710; at $17,000.0M it is 10.4% with 11.1 claims and a CV of
// 1.419, against WC 0.526 and GL 0.784. Property remains the most volatile
// line — more claims damp it, they do not tame it.
//
// NOTHING ABOUT THE FIT MOVED. Frequency is per $1M of TIV and severity is
// independent of the member, so scaling TIV scales expected loss exactly and
// leaves the severity distribution, the pure premium per $100 and every fitted
// parameter untouched.
//
// v5 scaled TIV x1.188512 UNIFORMLY on every member from v4's $14,303.6M, so
// within-type and cross-type spread and rank are both preserved exactly.
// v4 rescaled TIV per
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
import { WC_HIGH_SAFETY_CITIES, WC_RATING_GROUP_BY_TYPE, type WcRatingGroup } from './defaultAssumptions';

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
  R('member-001', 'Brookhaven School District 001', 'School District', 'Medium', 'North', 5.462, 3.9, 59.328, 8, 0.222),
  R('member-002', 'Summit County 002', 'County', 'Very Large', 'Central', 32.282, 6.6, 516.035, 14, 0.324),
  R('member-003', 'Ridgeway City 003', 'City', 'Medium', 'Central', 4.246, 8, 41.741, 8, 0.28),
  R('member-004', 'Summit Fire District 004', 'Fire District', 'Small', 'North', 0.939, 5.6, 6.331, 5, 0.388),
  R('member-005', 'Northvale Water District 005', 'Water District', 'Small', 'North', 1.553, 7.8, 47.072, 3, 0.661),
  R('member-006', 'Clearwater Park District 006', 'Park District', 'Medium', 'Central', 4.233, 3.4, 39.662, 12, 0.268),
  R('member-007', 'Eastbrook County 007', 'County', 'Large', 'North', 23.509, 1.7, 273.039, 20, 0.343),
  R('member-008', 'Clearwater Water District 008', 'Water District', 'Small', 'South', 1.825, 3.1, 41.546, 6, 0.62),
  R('member-009', 'Glenmoor Recreation District 009', 'Recreation District', 'Small', 'Central', 2.244, 3.5, 12.553, 6, 0.373),
  R('member-010', 'Cedar Falls City 010', 'City', 'Small', 'South', 3.659, 1.9, 37.586, 9, 0.252),
  R('member-011', 'Brookhaven School District 011', 'School District', 'Small', 'North', 2.135, 6.7, 17.355, 5, 0.25),
  R('member-012', 'Westfield Park District 012', 'Park District', 'Large', 'North', 16.832, 4.1, 115.557, 11, 0.246),
  R('member-013', 'Lakeside Water District 013', 'Water District', 'Small', 'Central', 0.966, 3.7, 41.1, 4, 0.679),
  R('member-014', 'Eastbrook Water District 014', 'Water District', 'Small', 'North', 2.568, 4.9, 109.952, 4, 0.614),
  R('member-015', 'Lakeside School District 015', 'School District', 'Medium', 'Central', 5.326, 6.7, 61.287, 7, 0.21),
  R('member-016', 'Summit Transit Authority 016', 'Transit Authority', 'Small', 'South', 2.413, 5.6, 28.23, 33, 0.394),
  R('member-017', 'Southgate County 017', 'County', 'Medium', 'Central', 7.201, 5.7, 103.156, 12, 0.303),
  R('member-018', 'Clearwater County 018', 'County', 'Large', 'Central', 23.163, 3.4, 198.838, 10, 0.316),
  R('member-019', 'Maplewood City 019', 'City', 'Large', 'North', 14.538, 4.3, 136.058, 11, 0.275),
  R('member-020', 'Pinecrest County 020', 'County', 'Small', 'North', 2.805, 4.9, 41.061, 12, 0.389),
  R('member-021', 'Summit County 021', 'County', 'Large', 'Central', 26.826, 5.2, 479.926, 13, 0.312),
  R('member-022', 'Glenmoor Fire District 022', 'Fire District', 'Small', 'South', 0.887, 4.6, 8.285, 2, 0.41),
  R('member-023', 'Riverton Water District 023', 'Water District', 'Small', 'Central', 3.475, 5, 120.849, 6, 0.666),
  R('member-024', 'Lakeside City 024', 'City', 'Medium', 'South', 7.978, 5.4, 84.781, 13, 0.283),
  R('member-025', 'Glenmoor Recreation District 025', 'Recreation District', 'Small', 'Central', 1.895, 4.7, 20.067, 5, 0.323),
  R('member-026', 'Summit School District 026', 'School District', 'Small', 'Central', 1.054, 8, 10.478, 7, 0.249),
  R('member-027', 'Summit Recreation District 027', 'Recreation District', 'Large', 'South', 13.857, 9.8, 107.173, 6, 0.302),
  R('member-028', 'Stonehill Park District 028', 'Park District', 'Small', 'South', 2.692, 4.9, 27.061, 11, 0.286),
  R('member-029', 'Clearwater Water District 029', 'Water District', 'Small', 'Central', 0.966, 6.2, 35.88, 6, 0.688),
  R('member-030', 'Westfield Special District 030', 'Special District', 'Small', 'Central', 2.948, 5.4, 37.993, 6, 0.481),
  R('member-031', 'Valley Recreation District 031', 'Recreation District', 'Small', 'Central', 1.694, 3.5, 20.837, 7, 0.363),
  R('member-032', 'Oakdale County 032', 'County', 'Medium', 'North', 9.284, 6.6, 109.155, 20, 0.344),
  R('member-033', 'Westfield Special District 033', 'Special District', 'Small', 'North', 1.062, 4.8, 20.479, 4, 0.418),
  R('member-034', 'Stonehill Special District 034', 'Special District', 'Medium', 'North', 10.43, 4, 147.651, 6, 0.471),
  R('member-035', 'Eastbrook Fire District 035', 'Fire District', 'Small', 'Central', 2.295, 5.8, 20.642, 3, 0.428),
  R('member-036', 'Summit City 036', 'City', 'Small', 'South', 3.659, 3.3, 43.869, 15, 0.261),
  R('member-037', 'Summit Park District 037', 'Park District', 'Medium', 'South', 5.275, 4.6, 43.113, 12, 0.29),
  R('member-038', 'Ridgeway County 038', 'County', 'Medium', 'North', 4.756, 8.5, 54.472, 16, 0.385),
  R('member-039', 'Stonehill Special District 039', 'Special District', 'Small', 'North', 2.837, 5.8, 28.422, 6, 0.475),
  R('member-040', 'Oakdale Water District 040', 'Water District', 'Small', 'North', 2.033, 6.4, 39.069, 6, 0.636),
  R('member-041', 'Northvale Transit Authority 041', 'Transit Authority', 'Small', 'Central', 3.241, 6.8, 41.493, 27, 0.396),
  R('member-042', 'Eastbrook School District 042', 'School District', 'Small', 'Central', 2.571, 2, 25.822, 8, 0.247),
  R('member-043', 'Southgate Park District 043', 'Park District', 'Small', 'Central', 3.42, 5.5, 38.83, 8, 0.25),
  R('member-044', 'Riverton Recreation District 044', 'Recreation District', 'Medium', 'Central', 5.281, 4.7, 45.187, 5, 0.365),
  R('member-045', 'Harbor County 045', 'County', 'Very Large', 'South', 39.04, 3.1, 568.344, 14, 0.391),
  R('member-046', 'Ashford School District 046', 'School District', 'Small', 'Central', 2.469, 7.4, 23.584, 12, 0.25),
  R('member-047', 'Ashford County 047', 'County', 'Large', 'Central', 23.468, 3.2, 260.329, 18, 0.391),
  R('member-048', 'Westfield Water District 048', 'Water District', 'Small', 'North', 2.615, 5.8, 59.331, 3, 0.634),
  R('member-049', 'Westfield City 049', 'City', 'Small', 'South', 4.137, 2.9, 32.392, 11, 0.286),
  R('member-050', 'Ashford Fire District 050', 'Fire District', 'Small', 'Central', 2.989, 5.1, 26.997, 3, 0.436),
  R('member-051', 'Eastbrook County 051', 'County', 'Small', 'South', 3.011, 5.8, 26.387, 19, 0.358),
  R('member-052', 'Southgate Water District 052', 'Water District', 'Medium', 'South', 4.389, 6.2, 131.506, 4, 0.653),
  R('member-053', 'Eastbrook School District 053', 'School District', 'Small', 'North', 1.957, 5, 21.196, 12, 0.243),
  R('member-054', 'Riverton Special District 054', 'Special District', 'Small', 'Central', 3.818, 5.9, 47.663, 5, 0.457),
  R('member-055', 'Lakeside Transit Authority 055', 'Transit Authority', 'Large', 'North', 13.775, 4.1, 243.028, 28, 0.399),
  R('member-056', 'Pinecrest Water District 056', 'Water District', 'Medium', 'Central', 4.266, 7.8, 121.417, 4, 0.683),
  R('member-057', 'Summit Fire District 057', 'Fire District', 'Small', 'South', 1.403, 6, 18.097, 5, 0.387),
  R('member-058', 'Ridgeway School District 058', 'School District', 'Small', 'North', 1.171, 4.2, 13.093, 7, 0.21),
  R('member-059', 'Maplewood Special District 059', 'Special District', 'Small', 'Central', 0.91, 5, 10.263, 6, 0.42),
  R('member-060', 'Oakdale City 060', 'City', 'Small', 'South', 2.011, 5.2, 23.319, 13, 0.253),
  R('member-061', 'Lakeside County 061', 'County', 'Large', 'North', 16.673, 3.6, 302.224, 12, 0.37),
  R('member-062', 'Glenmoor City 062', 'City', 'Very Large', 'South', 27.998, 5.4, 231.028, 11, 0.269),
  R('member-063', 'Valley City 063', 'City', 'Medium', 'North', 8.914, 7.3, 94.168, 15, 0.279),
  R('member-064', 'Harbor City 064', 'City', 'Large', 'North', 16.989, 7.8, 216.326, 8, 0.256),
  R('member-065', 'Maplewood Transit Authority 065', 'Transit Authority', 'Medium', 'Central', 6.071, 4.2, 100.86, 15, 0.392),
  R('member-066', 'Stonehill Fire District 066', 'Fire District', 'Small', 'North', 0.887, 3.2, 9.036, 2, 0.444),
  R('member-067', 'Northvale Transit Authority 067', 'Transit Authority', 'Large', 'North', 27.862, 3.1, 511.935, 16, 0.373),
  R('member-068', 'Eastbrook Transit Authority 068', 'Transit Authority', 'Very Large', 'North', 38.338, 7.3, 481.19, 30, 0.383),
  R('member-069', 'Cedar Falls Transit Authority 069', 'Transit Authority', 'Small', 'Central', 1.874, 5.1, 26.147, 29, 0.421),
  R('member-070', 'Lakeside Recreation District 070', 'Recreation District', 'Medium', 'North', 5.457, 5.5, 28.926, 5, 0.361),
  R('member-071', 'Oakdale Water District 071', 'Water District', 'Small', 'Central', 1.485, 4.4, 37.557, 6, 0.7),
  R('member-072', 'Westfield City 072', 'City', 'Medium', 'South', 7.163, 3.7, 74.686, 11, 0.294),
  R('member-073', 'Westfield Special District 073', 'Special District', 'Small', 'South', 3.738, 5.5, 60.284, 6, 0.415),
  R('member-074', 'Ridgeway Park District 074', 'Park District', 'Small', 'Central', 3.803, 3.9, 24.225, 10, 0.207),
  R('member-075', 'Clearwater Park District 075', 'Park District', 'Small', 'South', 3.628, 3.2, 40.636, 5, 0.235),
  R('member-076', 'Southgate Transit Authority 076', 'Transit Authority', 'Small', 'Central', 3.175, 2.6, 33.618, 15, 0.379),
  R('member-077', 'Northvale City 077', 'City', 'Small', 'North', 2.676, 4.1, 26.402, 15, 0.258),
  R('member-078', 'Lakeside Fire District 078', 'Fire District', 'Medium', 'Central', 10.087, 6.4, 105.636, 2, 0.441),
  R('member-079', 'Northvale Park District 079', 'Park District', 'Small', 'North', 0.899, 3.6, 5.964, 9, 0.234),
  R('member-080', 'Fairmont City 080', 'City', 'Large', 'Central', 19.87, 5.7, 250.765, 15, 0.258),
  R('member-081', 'Fairmont Transit Authority 081', 'Transit Authority', 'Medium', 'South', 6.389, 4.5, 81.463, 8, 0.415),
  R('member-082', 'Southgate Water District 082', 'Water District', 'Medium', 'South', 4.811, 4.5, 209.774, 4, 0.686),
  R('member-083', 'Westfield Special District 083', 'Special District', 'Small', 'Central', 3.251, 4.3, 39.946, 5, 0.402),
  R('member-084', 'Valley Water District 084', 'Water District', 'Small', 'North', 0.966, 8.4, 41.225, 3, 0.604),
  R('member-085', 'Lakeside Park District 085', 'Park District', 'Medium', 'Central', 4.641, 2.2, 35.17, 5, 0.262),
  R('member-086', 'Northvale Special District 086', 'Special District', 'Medium', 'North', 5.78, 6.3, 88.335, 8, 0.472),
  R('member-087', 'Ashford County 087', 'County', 'Very Large', 'South', 38.359, 3.8, 510.088, 18, 0.303),
  R('member-088', 'Clearwater Recreation District 088', 'Recreation District', 'Medium', 'Central', 9.194, 4.4, 69.816, 3, 0.399),
  R('member-089', 'Southgate County 089', 'County', 'Medium', 'North', 10.127, 3.4, 277.327, 11, 0.303),
  R('member-090', 'Pinecrest Recreation District 090', 'Recreation District', 'Small', 'North', 3.677, 7.1, 30.043, 5, 0.386),
  R('member-091', 'Brookhaven Water District 091', 'Water District', 'Medium', 'South', 4.601, 2.6, 134.62, 3, 0.656),
  R('member-092', 'Eastbrook City 092', 'City', 'Medium', 'Central', 6.945, 6.8, 66.843, 11, 0.287),
  R('member-093', 'Glenmoor Special District 093', 'Special District', 'Small', 'North', 2.084, 3.4, 25.634, 8, 0.499),
  R('member-094', 'Northvale Park District 094', 'Park District', 'Small', 'Central', 3.967, 4.5, 21.82, 12, 0.272),
  R('member-095', 'Clearwater City 095', 'City', 'Medium', 'North', 9.219, 5.5, 97.35, 8, 0.294),
  R('member-096', 'Maplewood City 096', 'City', 'Small', 'Central', 2.571, 6.7, 21.866, 13, 0.272),
  R('member-097', 'Harbor Water District 097', 'Water District', 'Small', 'North', 3.32, 3.2, 103.695, 5, 0.617),
  R('member-098', 'Oakdale County 098', 'County', 'Large', 'South', 26.296, 1.5, 379.946, 16, 0.396),
  R('member-099', 'Ridgeway Special District 099', 'Special District', 'Small', 'South', 0.583, 5.5, 8.7, 5, 0.418),
  R('member-100', 'Maplewood Water District 100', 'Water District', 'Medium', 'North', 6.916, 4.7, 183.667, 5, 0.639),
  R('member-101', 'Stonehill School District 101', 'School District', 'Small', 'Central', 1.759, 8.7, 15.921, 10, 0.235),
  R('member-102', 'Stonehill Transit Authority 102', 'Transit Authority', 'Small', 'South', 2.052, 5.4, 33.825, 28, 0.409),
  R('member-103', 'Glenmoor Transit Authority 103', 'Transit Authority', 'Medium', 'North', 5.529, 5.2, 101.964, 10, 0.382),
  R('member-104', 'Stonehill Park District 104', 'Park District', 'Medium', 'Central', 7.436, 2, 67.474, 6, 0.262),
  R('member-105', 'Ridgeway Water District 105', 'Water District', 'Small', 'North', 3.134, 4.3, 105.93, 5, 0.644),
  R('member-106', 'Pinecrest Water District 106', 'Water District', 'Small', 'South', 0.995, 6.3, 24.596, 6, 0.604),
  R('member-107', 'Lakeside Water District 107', 'Water District', 'Small', 'Central', 1.894, 8.1, 63.269, 6, 0.682),
  R('member-108', 'Valley School District 108', 'School District', 'Small', 'Central', 1.677, 4.3, 30.049, 5, 0.247),
  R('member-109', 'Stonehill Fire District 109', 'Fire District', 'Small', 'South', 3.795, 1, 37.139, 3, 0.351),
  R('member-110', 'Brookhaven County 110', 'County', 'Large', 'Central', 13.183, 4.4, 170.254, 10, 0.388),
  R('member-111', 'Pinecrest Special District 111', 'Special District', 'Small', 'North', 0.738, 7.7, 10.211, 3, 0.414),
  R('member-112', 'Glenmoor Water District 112', 'Water District', 'Small', 'Central', 2.044, 4.6, 90.384, 3, 0.611),
  R('member-113', 'Northvale Transit Authority 113', 'Transit Authority', 'Small', 'North', 3.412, 2.2, 35.786, 17, 0.387),
  R('member-114', 'Ashford Special District 114', 'Special District', 'Medium', 'North', 10.082, 1.5, 103.53, 4, 0.464),
  R('member-115', 'Pinecrest County 115', 'County', 'Large', 'North', 18.156, 5.4, 216.017, 12, 0.399),
  R('member-116', 'Pinecrest City 116', 'City', 'Medium', 'North', 5.244, 4.8, 58.194, 14, 0.267),
  R('member-117', 'Summit County 117', 'County', 'Medium', 'South', 5.279, 4.7, 122.445, 13, 0.326),
  R('member-118', 'Valley School District 118', 'School District', 'Large', 'South', 19.983, 5.2, 142.966, 9, 0.232),
  R('member-119', 'Summit Recreation District 119', 'Recreation District', 'Medium', 'South', 6.21, 6.9, 48.106, 3, 0.314),
  R('member-120', 'Pinecrest Water District 120', 'Water District', 'Medium', 'South', 5.504, 8.5, 188.317, 3, 0.685),
  R('member-121', 'Oakdale Fire District 121', 'Fire District', 'Small', 'North', 2.206, 10, 19.379, 5, 0.373),
  R('member-122', 'Stonehill Transit Authority 122', 'Transit Authority', 'Small', 'South', 3.474, 5, 52.664, 28, 0.35),
  R('member-123', 'Eastbrook Fire District 123', 'Fire District', 'Small', 'North', 0.897, 4.3, 7.425, 4, 0.384),
  R('member-124', 'Ridgeway County 124', 'County', 'Large', 'Central', 14.276, 3.8, 197.614, 18, 0.331),
  R('member-125', 'Ashford City 125', 'City', 'Small', 'North', 1.965, 5, 16.34, 14, 0.266),
  R('member-126', 'Harbor City 126', 'City', 'Medium', 'Central', 8.229, 6.2, 93.708, 9, 0.287),
  R('member-127', 'Harbor Special District 127', 'Special District', 'Large', 'Central', 20.462, 5.9, 180.277, 3, 0.408),
  R('member-128', 'Glenmoor Water District 128', 'Water District', 'Medium', 'Central', 4.856, 3.1, 120.288, 3, 0.672),
  R('member-129', 'Summit Recreation District 129', 'Recreation District', 'Medium', 'South', 7.462, 1.7, 40.592, 3, 0.363),
  R('member-130', 'Clearwater Recreation District 130', 'Recreation District', 'Medium', 'North', 6.931, 3.3, 53.697, 3, 0.323),
  R('member-131', 'Glenmoor Water District 131', 'Water District', 'Medium', 'South', 4.689, 4.4, 119.961, 4, 0.696),
  R('member-132', 'Valley Park District 132', 'Park District', 'Medium', 'North', 8.019, 8.5, 55.575, 10, 0.281),
  R('member-133', 'Northvale Transit Authority 133', 'Transit Authority', 'Medium', 'South', 10.073, 5.7, 102.837, 22, 0.405),
  R('member-134', 'Lakeside City 134', 'City', 'Small', 'North', 0.966, 3.7, 7.984, 11, 0.287),
  R('member-135', 'Maplewood City 135', 'City', 'Small', 'North', 3.264, 5.9, 24.223, 9, 0.299),
  R('member-136', 'Ashford Fire District 136', 'Fire District', 'Small', 'South', 3.479, 6.2, 23.889, 2, 0.434),
  R('member-137', 'Summit Fire District 137', 'Fire District', 'Small', 'Central', 2.485, 4.9, 13.941, 3, 0.386),
  R('member-138', 'Eastbrook City 138', 'City', 'Medium', 'Central', 9.783, 1.7, 118.43, 14, 0.28),
  R('member-139', 'Brookhaven Recreation District 139', 'Recreation District', 'Small', 'South', 0.964, 3.8, 8.467, 3, 0.326),
  R('member-140', 'Fairmont County 140', 'County', 'Large', 'Central', 18.9, 4.7, 411.772, 12, 0.335),
  R('member-141', 'Pinecrest Transit Authority 141', 'Transit Authority', 'Large', 'North', 20.833, 7.4, 216.145, 26, 0.353),
  R('member-142', 'Valley Park District 142', 'Park District', 'Small', 'South', 2.582, 4.3, 24.734, 7, 0.273),
  R('member-143', 'Lakeside Special District 143', 'Special District', 'Small', 'Central', 1.923, 6.4, 15.345, 7, 0.435),
  R('member-144', 'Stonehill Special District 144', 'Special District', 'Small', 'Central', 3.216, 5.3, 45.291, 3, 0.436),
  R('member-145', 'Ridgeway School District 145', 'School District', 'Medium', 'Central', 5.583, 4.5, 63.987, 12, 0.235),
  R('member-146', 'Westfield City 146', 'City', 'Small', 'South', 3.227, 3.3, 36.694, 8, 0.258),
  R('member-147', 'Westfield Park District 147', 'Park District', 'Small', 'North', 1.502, 5.1, 17.92, 14, 0.24),
  R('member-148', 'Summit Recreation District 148', 'Recreation District', 'Small', 'North', 2.006, 5, 9.137, 8, 0.37),
  R('member-149', 'Maplewood Water District 149', 'Water District', 'Small', 'Central', 1.487, 3.3, 39.525, 3, 0.67),
  R('member-150', 'Ashford City 150', 'City', 'Small', 'South', 2.018, 5.6, 25.362, 14, 0.265),
  R('member-151', 'Fairmont Special District 151', 'Special District', 'Small', 'South', 0.793, 6.5, 8.053, 3, 0.433),
  R('member-152', 'Clearwater Water District 152', 'Water District', 'Small', 'North', 2.406, 1.6, 66.59, 6, 0.628),
  R('member-153', 'Pinecrest School District 153', 'School District', 'Medium', 'South', 11.785, 5.5, 137.425, 11, 0.245),
  R('member-154', 'Brookhaven Water District 154', 'Water District', 'Small', 'North', 2.788, 6.8, 79.79, 4, 0.657),
  R('member-155', 'Brookhaven Recreation District 155', 'Recreation District', 'Large', 'South', 16.607, 2.6, 155.771, 3, 0.356),
  R('member-156', 'Maplewood Park District 156', 'Park District', 'Small', 'South', 0.64, 7.4, 8.057, 8, 0.289),
  R('member-157', 'Ridgeway City 157', 'City', 'Medium', 'South', 7.368, 5, 77.55, 8, 0.279),
  R('member-158', 'Valley Water District 158', 'Water District', 'Small', 'South', 2.917, 5.4, 62.939, 6, 0.665),
  R('member-159', 'Ridgeway Park District 159', 'Park District', 'Small', 'North', 2.367, 5.3, 14.669, 7, 0.266),
  R('member-160', 'Brookhaven City 160', 'City', 'Medium', 'Central', 4.249, 5.9, 37.879, 12, 0.277),
  R('member-161', 'Northvale Park District 161', 'Park District', 'Small', 'North', 1.204, 5.2, 10.616, 15, 0.272),
  R('member-162', 'Stonehill City 162', 'City', 'Medium', 'Central', 6.695, 2.9, 84.126, 8, 0.287),
  R('member-163', 'Cedar Falls School District 163', 'School District', 'Small', 'North', 0.929, 1.1, 8.712, 7, 0.249),
  R('member-164', 'Pinecrest Water District 164', 'Water District', 'Small', 'South', 2.119, 5.4, 104.563, 6, 0.641),
  R('member-165', 'Ridgeway Fire District 165', 'Fire District', 'Small', 'South', 2.153, 7, 21.088, 5, 0.418),
  R('member-166', 'Lakeside Fire District 166', 'Fire District', 'Small', 'Central', 1.977, 8.5, 18.79, 2, 0.382),
  R('member-167', 'Harbor County 167', 'County', 'Medium', 'South', 12.027, 4.8, 180.506, 13, 0.381),
  R('member-168', 'Westfield Special District 168', 'Special District', 'Small', 'South', 1.215, 2.1, 12.103, 3, 0.47),
  R('member-169', 'Stonehill Recreation District 169', 'Recreation District', 'Small', 'North', 1.994, 2.4, 14.547, 7, 0.382),
  R('member-170', 'Southgate City 170', 'City', 'Small', 'North', 2.509, 5.3, 25.319, 15, 0.252),
  R('member-171', 'Riverton Transit Authority 171', 'Transit Authority', 'Small', 'Central', 2.716, 5.4, 45.772, 30, 0.411),
  R('member-172', 'Riverton City 172', 'City', 'Medium', 'Central', 11.095, 6.6, 101.312, 15, 0.286),
  R('member-173', 'Riverton Water District 173', 'Water District', 'Small', 'South', 2.421, 3.5, 76.835, 4, 0.696),
  R('member-174', 'Harbor City 174', 'City', 'Large', 'North', 14.013, 6.8, 111.4, 8, 0.263),
  R('member-175', 'Harbor School District 175', 'School District', 'Medium', 'South', 4.155, 6.5, 52.678, 5, 0.23),
  R('member-176', 'Summit Special District 176', 'Special District', 'Medium', 'South', 5.134, 5, 55.324, 6, 0.463),
  R('member-177', 'Brookhaven Park District 177', 'Park District', 'Small', 'South', 0.612, 2.1, 3.721, 8, 0.203),
  R('member-178', 'Stonehill Park District 178', 'Park District', 'Small', 'Central', 0.498, 2.8, 2.745, 9, 0.244),
  R('member-179', 'Valley Recreation District 179', 'Recreation District', 'Medium', 'North', 6.411, 2.8, 59.361, 6, 0.4),
  R('member-180', 'Ridgeway City 180', 'City', 'Medium', 'Central', 7.844, 4.2, 52.202, 11, 0.267),
  R('member-181', 'Brookhaven School District 181', 'School District', 'Small', 'South', 2.247, 3.6, 26.891, 11, 0.21),
  R('member-182', 'Pinecrest County 182', 'County', 'Large', 'North', 13.139, 8, 108.01, 14, 0.307),
  R('member-183', 'Stonehill Park District 183', 'Park District', 'Small', 'North', 1.886, 2.5, 12.084, 12, 0.252),
  R('member-184', 'Brookhaven Park District 184', 'Park District', 'Small', 'South', 1.765, 5.7, 16.016, 8, 0.225),
  R('member-185', 'Ridgeway Special District 185', 'Special District', 'Small', 'South', 3.741, 7.8, 45.514, 5, 0.498),
  R('member-186', 'Clearwater Water District 186', 'Water District', 'Small', 'North', 0.966, 1, 25.772, 5, 0.666),
  R('member-187', 'Stonehill Recreation District 187', 'Recreation District', 'Medium', 'Central', 4.648, 5.4, 31.265, 5, 0.337),
  R('member-188', 'Pinecrest School District 188', 'School District', 'Medium', 'North', 6.925, 6.6, 81.482, 8, 0.22),
  R('member-189', 'Clearwater County 189', 'County', 'Medium', 'South', 8.239, 6.9, 148.528, 20, 0.318),
  R('member-190', 'Southgate Transit Authority 190', 'Transit Authority', 'Small', 'Central', 2.124, 5.8, 26.933, 30, 0.386),
  R('member-191', 'Northvale Recreation District 191', 'Recreation District', 'Small', 'North', 2.304, 4.6, 14.935, 6, 0.36),
  R('member-192', 'Harbor City 192', 'City', 'Very Large', 'Central', 28.958, 4.2, 229.442, 15, 0.287),
  R('member-193', 'Clearwater School District 193', 'School District', 'Large', 'North', 14.228, 9.1, 158.408, 10, 0.211),
  R('member-194', 'Oakdale School District 194', 'School District', 'Small', 'South', 2.472, 6.8, 31.71, 10, 0.219),
  R('member-195', 'Harbor School District 195', 'School District', 'Medium', 'South', 4.201, 6.9, 40.583, 5, 0.207),
  R('member-196', 'Riverton Water District 196', 'Water District', 'Medium', 'Central', 5.321, 8.3, 107.625, 4, 0.652),
  R('member-197', 'Lakeside Water District 197', 'Water District', 'Small', 'Central', 1.583, 6.4, 40.63, 5, 0.67),
  R('member-198', 'Glenmoor Fire District 198', 'Fire District', 'Small', 'North', 1.715, 6.6, 14.723, 5, 0.434),
  R('member-199', 'Maplewood Recreation District 199', 'Recreation District', 'Small', 'South', 0.889, 2.8, 6.532, 8, 0.312),
  R('member-200', 'Oakdale Fire District 200', 'Fire District', 'Medium', 'North', 6.117, 5.1, 57.948, 2, 0.415),
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
    wcRatingGroup: wcRatingGroupFor(row.type, row.name),
  })
);

// A member's WC rating group.
//
// ⚠ THIS IS THE ONE MEMBER ATTRIBUTE THAT IS *STORED* RATHER THAN DERIVED FROM
// TYPE, and it contradicts the header note above only in appearance. The
// retired WC_CLASS_MIX and GL_RELATIVITIES really were exact functions of
// Type, so storing them per member would have been duplication. This is not:
// the old WC_CLASS_MIX gave EVERY city a safety share of exactly 0.3500, so
// no rule over it could separate the eight cities that run their own police
// and fire departments from the other 24. The list is genuine additional
// information and lives in WC_HIGH_SAFETY_CITIES.
//
// It is computed here, at catalog construction, and then travels ON the member —
// so it serialises into saved games with everything else and a member cannot
// arrive without one.
function wcRatingGroupFor(type: MemberType, name: string): WcRatingGroup {
  if (type === 'City') return WC_HIGH_SAFETY_CITIES.has(name) ? 'highSafety' : 'lowSafety';
  const group = WC_RATING_GROUP_BY_TYPE[type];
  if (!group) throw new Error(`no WC rating group for member type '${type}'`);
  return group;
}

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
// MARKET_TOTAL_LOCATIONS RETIRED with Property's rebuild — it had no consumer
// even before that, and the per-location frequency basis it existed to serve is
// gone.
//
// ⚠ `locations` AND `primaryAssetShare` ARE KEPT ON EVERY MEMBER AND NOTHING
// READS THEM. That is deliberate. They are AUTHORED roster facts, not derived
// values, and deleting authored source data to chase an unused-symbol warning
// would destroy something a future per-location treaty would have to invent
// again from nothing. They are recorded here as unread so the next reader does
// not spend time looking for the consumer.
