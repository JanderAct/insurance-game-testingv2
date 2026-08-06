// Canonical 200-member marketplace — GENERATED FILE, do not edit by hand.
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
  R('member-001', 'Brookhaven School District 001', 'School District', 'Medium', 'North', 5.54, 5.5, 10.889),
  R('member-002', 'Summit County 002', 'County', 'Very Large', 'North', 32.282, 8.3, 127.066),
  R('member-003', 'Ridgeway City 003', 'City', 'Medium', 'North', 4.246, 3.8, 16.5),
  R('member-004', 'Summit Fire District 004', 'Fire District', 'Small', 'South', 0.952, 3.5, 3.634),
  R('member-005', 'Northvale Water District 005', 'Water District', 'Small', 'South', 1.125, 6.2, 16.756),
  R('member-006', 'Clearwater Park District 006', 'Park District', 'Medium', 'South', 4.293, 6.8, 13.877),
  R('member-007', 'Eastbrook County 007', 'County', 'Large', 'Central', 23.509, 6.2, 36.788),
  R('member-008', 'Clearwater Water District 008', 'Water District', 'Small', 'South', 1.322, 7.4, 8.064),
  R('member-009', 'Glenmoor Recreation District 009', 'Recreation District', 'Small', 'North', 2.276, 1.6, 4.947),
  R('member-010', 'Cedar Falls City 010', 'City', 'Small', 'North', 3.659, 5.1, 4.454),
  R('member-011', 'Brookhaven School District 011', 'School District', 'Small', 'North', 2.165, 4.4, 7.328),
  R('member-012', 'Westfield Park District 012', 'Park District', 'Large', 'South', 17.071, 5.7, 62.452),
  R('member-013', 'Lakeside Water District 013', 'Water District', 'Small', 'South', 0.452, 7, 3.102),
  R('member-014', 'Eastbrook Water District 014', 'Water District', 'Small', 'South', 2.605, 7.6, 22.315),
  R('member-015', 'Lakeside School District 015', 'School District', 'Medium', 'South', 5.402, 8.9, 18.264),
  R('member-016', 'Summit Transit Authority 016', 'Transit Authority', 'Small', 'Central', 1.775, 7.3, 11.59),
  R('member-017', 'Southgate County 017', 'County', 'Medium', 'North', 7.201, 9.2, 23.78),
  R('member-018', 'Clearwater County 018', 'County', 'Large', 'South', 23.163, 6.9, 50.168),
  R('member-019', 'Maplewood City 019', 'City', 'Large', 'South', 14.538, 2.9, 27.609),
  R('member-020', 'Pinecrest County 020', 'County', 'Small', 'South', 2.805, 6.6, 8.089),
  R('member-021', 'Summit County 021', 'County', 'Large', 'North', 26.826, 8.8, 81.059),
  R('member-022', 'Glenmoor Fire District 022', 'Fire District', 'Small', 'North', 0.493, 3.2, 1.548),
  R('member-023', 'Riverton Water District 023', 'Water District', 'Small', 'Central', 3.524, 5.6, 31.09),
  R('member-024', 'Lakeside City 024', 'City', 'Medium', 'North', 7.978, 3.8, 18.791),
  R('member-025', 'Glenmoor Recreation District 025', 'Recreation District', 'Small', 'North', 1.922, 4.6, 5.307),
  R('member-026', 'Summit School District 026', 'School District', 'Small', 'South', 1.069, 5.6, 4.65),
  R('member-027', 'Summit Recreation District 027', 'Recreation District', 'Large', 'South', 14.054, 4.4, 102.18),
  R('member-028', 'Stonehill Park District 028', 'Park District', 'Small', 'Central', 2.73, 5, 11.613),
  R('member-029', 'Clearwater Water District 029', 'Water District', 'Small', 'North', 0.277, 7.4, 3.067),
  R('member-030', 'Westfield Special District 030', 'Special District', 'Small', 'South', 2.99, 5.5, 17.377),
  R('member-031', 'Valley Recreation District 031', 'Recreation District', 'Small', 'North', 1.718, 7.1, 3.755),
  R('member-032', 'Oakdale County 032', 'County', 'Medium', 'Central', 9.284, 7.3, 36.887),
  R('member-033', 'Westfield Special District 033', 'Special District', 'Small', 'South', 1.077, 6, 5.501),
  R('member-034', 'Stonehill Special District 034', 'Special District', 'Medium', 'North', 10.578, 5.4, 46.397),
  R('member-035', 'Eastbrook Fire District 035', 'Fire District', 'Small', 'North', 2.328, 5.6, 9.283),
  R('member-036', 'Summit City 036', 'City', 'Small', 'South', 3.659, 3.7, 5.762),
  R('member-037', 'Summit Park District 037', 'Park District', 'Medium', 'North', 5.35, 6.7, 21.791),
  R('member-038', 'Ridgeway County 038', 'County', 'Medium', 'North', 4.756, 6.2, 27.067),
  R('member-039', 'Stonehill Special District 039', 'Special District', 'Small', 'North', 2.877, 5.2, 17.931),
  R('member-040', 'Oakdale Water District 040', 'Water District', 'Small', 'Central', 1.473, 3.4, 16.892),
  R('member-041', 'Northvale Transit Authority 041', 'Transit Authority', 'Small', 'Central', 2.385, 5.5, 19.636),
  R('member-042', 'Eastbrook School District 042', 'School District', 'Small', 'North', 2.608, 7, 3.593),
  R('member-043', 'Southgate Park District 043', 'Park District', 'Small', 'Central', 3.469, 6, 16.716),
  R('member-044', 'Riverton Recreation District 044', 'Recreation District', 'Medium', 'Central', 5.356, 4.9, 14.629),
  R('member-045', 'Harbor County 045', 'County', 'Very Large', 'South', 39.04, 9.6, 78.636),
  R('member-046', 'Ashford School District 046', 'School District', 'Small', 'North', 2.504, 8.2, 9.679),
  R('member-047', 'Ashford County 047', 'County', 'Large', 'North', 23.468, 7.6, 48.505),
  R('member-048', 'Westfield Water District 048', 'Water District', 'Small', 'North', 2.652, 5, 26.883),
  R('member-049', 'Westfield City 049', 'City', 'Medium', 'North', 4.137, 1.7, 6.066),
  R('member-050', 'Ashford Fire District 050', 'Fire District', 'Small', 'North', 3.032, 5.3, 10.539),
  R('member-051', 'Eastbrook County 051', 'County', 'Small', 'Central', 3.011, 7.4, 10.225),
  R('member-052', 'Southgate Water District 052', 'Water District', 'Medium', 'South', 4.451, 3.1, 49.252),
  R('member-053', 'Eastbrook School District 053', 'School District', 'Small', 'North', 1.985, 5.1, 4.791),
  R('member-054', 'Riverton Special District 054', 'Special District', 'Small', 'Central', 3.872, 6.2, 24.4),
  R('member-055', 'Lakeside Transit Authority 055', 'Transit Authority', 'Medium', 'North', 10.136, 3.5, 50.226),
  R('member-056', 'Pinecrest Water District 056', 'Water District', 'Medium', 'South', 4.327, 5.4, 64.328),
  R('member-057', 'Summit Fire District 057', 'Fire District', 'Small', 'Central', 1.423, 2.8, 5.83),
  R('member-058', 'Ridgeway School District 058', 'School District', 'Small', 'South', 1.188, 5.3, 2.473),
  R('member-059', 'Maplewood Special District 059', 'Special District', 'Small', 'Central', 0.923, 6.1, 4.938),
  R('member-060', 'Oakdale City 060', 'City', 'Small', 'North', 2.011, 3, 4.534),
  R('member-061', 'Lakeside County 061', 'County', 'Large', 'North', 16.673, 6.4, 37.375),
  R('member-062', 'Glenmoor City 062', 'City', 'Very Large', 'South', 27.998, 4.5, 66.322),
  R('member-063', 'Valley City 063', 'City', 'Medium', 'Central', 8.914, 3.1, 30.451),
  R('member-064', 'Harbor City 064', 'City', 'Large', 'South', 16.989, 4.4, 64.043),
  R('member-065', 'Maplewood Transit Authority 065', 'Transit Authority', 'Medium', 'North', 4.467, 4.8, 22.235),
  R('member-066', 'Stonehill Fire District 066', 'Fire District', 'Small', 'South', 0.84, 5.2, 2.006),
  R('member-067', 'Northvale Transit Authority 067', 'Transit Authority', 'Large', 'South', 20.501, 4.1, 83.803),
  R('member-068', 'Eastbrook Transit Authority 068', 'Transit Authority', 'Very Large', 'Central', 70.902, 5.1, 641.83),
  R('member-069', 'Cedar Falls Transit Authority 069', 'Transit Authority', 'Small', 'South', 1.379, 5.1, 8.159),
  R('member-070', 'Lakeside Recreation District 070', 'Recreation District', 'Medium', 'North', 5.535, 2.8, 17.883),
  R('member-071', 'Oakdale Water District 071', 'Water District', 'Small', 'Central', 1.076, 5, 8.393),
  R('member-072', 'Westfield City 072', 'City', 'Medium', 'South', 7.163, 2.8, 12.247),
  R('member-073', 'Westfield Special District 073', 'Special District', 'Small', 'South', 3.791, 7.1, 22.471),
  R('member-074', 'Ridgeway Park District 074', 'Park District', 'Small', 'North', 3.857, 6.6, 13.777),
  R('member-075', 'Clearwater Park District 075', 'Park District', 'Small', 'Central', 3.68, 7.2, 11.401),
  R('member-076', 'Southgate Transit Authority 076', 'Transit Authority', 'Small', 'South', 2.336, 7.3, 8.543),
  R('member-077', 'Northvale City 077', 'City', 'Small', 'South', 2.676, 4.1, 4.922),
  R('member-078', 'Lakeside Fire District 078', 'Fire District', 'Medium', 'North', 10.23, 6.3, 45.136),
  R('member-079', 'Northvale Park District 079', 'Park District', 'Small', 'North', 0.912, 5.6, 3.057),
  R('member-080', 'Fairmont City 080', 'City', 'Large', 'North', 19.87, 3.1, 49.712),
  R('member-081', 'Fairmont Transit Authority 081', 'Transit Authority', 'Medium', 'Central', 4.701, 4, 24.776),
  R('member-082', 'Southgate Water District 082', 'Water District', 'Medium', 'North', 4.879, 6.2, 39.003),
  R('member-083', 'Westfield Special District 083', 'Special District', 'Small', 'South', 3.297, 7.4, 15.29),
  R('member-084', 'Valley Water District 084', 'Water District', 'Small', 'North', 0.421, 3.7, 7.084),
  R('member-085', 'Lakeside Park District 085', 'Park District', 'Medium', 'North', 4.707, 5.6, 12.113),
  R('member-086', 'Northvale Special District 086', 'Special District', 'Medium', 'South', 5.862, 4.8, 40.494),
  R('member-087', 'Ashford County 087', 'County', 'Very Large', 'North', 38.359, 5.2, 88.773),
  R('member-088', 'Clearwater Recreation District 088', 'Recreation District', 'Medium', 'North', 9.325, 1.3, 24.22),
  R('member-089', 'Southgate County 089', 'County', 'Medium', 'South', 10.127, 5, 21.684),
  R('member-090', 'Pinecrest Recreation District 090', 'Recreation District', 'Small', 'Central', 3.729, 8.1, 16.096),
  R('member-091', 'Brookhaven Water District 091', 'Water District', 'Medium', 'Central', 4.666, 1, 25.836),
  R('member-092', 'Eastbrook City 092', 'City', 'Medium', 'North', 6.945, 4.6, 21.303),
  R('member-093', 'Glenmoor Special District 093', 'Special District', 'Small', 'North', 2.114, 8.1, 8.283),
  R('member-094', 'Northvale Park District 094', 'Park District', 'Small', 'South', 4.023, 5.2, 16.025),
  R('member-095', 'Clearwater City 095', 'City', 'Medium', 'North', 9.219, 3.5, 22.009),
  R('member-096', 'Maplewood City 096', 'City', 'Small', 'Central', 2.571, 3.1, 7.792),
  R('member-097', 'Harbor Water District 097', 'Water District', 'Small', 'Central', 3.367, 5.5, 20.672),
  R('member-098', 'Oakdale County 098', 'County', 'Large', 'Central', 26.296, 7.1, 39.289),
  R('member-099', 'Ridgeway Special District 099', 'Special District', 'Small', 'South', 0.591, 6.3, 3.502),
  R('member-100', 'Maplewood Water District 100', 'Water District', 'Medium', 'South', 7.014, 7.2, 58.138),
  R('member-101', 'Stonehill School District 101', 'School District', 'Small', 'Central', 1.784, 4, 8.775),
  R('member-102', 'Stonehill Transit Authority 102', 'Transit Authority', 'Small', 'North', 1.51, 4.3, 9.44),
  R('member-103', 'Glenmoor Transit Authority 103', 'Transit Authority', 'Small', 'South', 4.069, 6.5, 24.45),
  R('member-104', 'Stonehill Park District 104', 'Park District', 'Medium', 'North', 7.542, 5.1, 18.459),
  R('member-105', 'Ridgeway Water District 105', 'Water District', 'Small', 'South', 3.179, 3.7, 24.527),
  R('member-106', 'Pinecrest Water District 106', 'Water District', 'Small', 'North', 0.721, 3.8, 8.052),
  R('member-107', 'Lakeside Water District 107', 'Water District', 'Small', 'Central', 1.372, 2.9, 21.715),
  R('member-108', 'Valley School District 108', 'School District', 'Small', 'South', 1.701, 9, 3.584),
  R('member-109', 'Stonehill Fire District 109', 'Fire District', 'Small', 'South', 3.849, 2.8, 6.069),
  R('member-110', 'Brookhaven County 110', 'County', 'Large', 'Central', 13.183, 7, 34.074),
  R('member-111', 'Pinecrest Special District 111', 'Special District', 'Small', 'North', 0.748, 5.6, 6.692),
  R('member-112', 'Glenmoor Water District 112', 'Water District', 'Small', 'South', 1.481, 4.4, 11.99),
  R('member-113', 'Northvale Transit Authority 113', 'Transit Authority', 'Small', 'Central', 2.511, 6.5, 8.646),
  R('member-114', 'Ashford Special District 114', 'Special District', 'Medium', 'North', 10.225, 5.1, 27.766),
  R('member-115', 'Pinecrest County 115', 'County', 'Large', 'Central', 18.156, 4.1, 57.512),
  R('member-116', 'Pinecrest City 116', 'City', 'Medium', 'Central', 5.244, 5.7, 10.947),
  R('member-117', 'Summit County 117', 'County', 'Medium', 'Central', 5.279, 7.1, 14.399),
  R('member-118', 'Valley School District 118', 'School District', 'Large', 'Central', 20.267, 3.5, 51.48),
  R('member-119', 'Summit Recreation District 119', 'Recreation District', 'Medium', 'South', 6.298, 2.8, 26.557),
  R('member-120', 'Pinecrest Water District 120', 'Water District', 'Medium', 'North', 5.582, 9.9, 94.974),
  R('member-121', 'Oakdale Fire District 121', 'Fire District', 'Small', 'South', 2.237, 5.7, 19.625),
  R('member-122', 'Stonehill Transit Authority 122', 'Transit Authority', 'Small', 'North', 2.556, 6.2, 15.045),
  R('member-123', 'Eastbrook Fire District 123', 'Fire District', 'Small', 'Central', 0.91, 6.1, 2.729),
  R('member-124', 'Ridgeway County 124', 'County', 'Large', 'North', 14.276, 9.2, 32.997),
  R('member-125', 'Ashford City 125', 'City', 'Small', 'South', 1.965, 4.4, 4.311),
  R('member-126', 'Harbor City 126', 'City', 'Medium', 'North', 8.229, 2.7, 22.562),
  R('member-127', 'Harbor Special District 127', 'Special District', 'Large', 'Central', 20.753, 6.9, 131.575),
  R('member-128', 'Glenmoor Water District 128', 'Water District', 'Medium', 'North', 4.925, 5.7, 30.142),
  R('member-129', 'Summit Recreation District 129', 'Recreation District', 'Medium', 'South', 7.568, 3.6, 11.675),
  R('member-130', 'Clearwater Recreation District 130', 'Recreation District', 'Medium', 'North', 7.03, 2.7, 14.807),
  R('member-131', 'Glenmoor Water District 131', 'Water District', 'Medium', 'South', 4.756, 6, 36.932),
  R('member-132', 'Valley Park District 132', 'Park District', 'Medium', 'South', 8.133, 4, 69.164),
  R('member-133', 'Northvale Transit Authority 133', 'Transit Authority', 'Medium', 'Central', 7.412, 4.4, 49.556),
  R('member-134', 'Lakeside City 134', 'City', 'Small', 'North', 0.966, 4.6, 1.651),
  R('member-135', 'Maplewood City 135', 'City', 'Small', 'South', 3.264, 4.2, 8.418),
  R('member-136', 'Ashford Fire District 136', 'Fire District', 'Small', 'South', 3.528, 3.8, 15.013),
  R('member-137', 'Summit Fire District 137', 'Fire District', 'Small', 'South', 2.52, 4.4, 8.448),
  R('member-138', 'Eastbrook City 138', 'City', 'Medium', 'South', 9.783, 3.4, 11.423),
  R('member-139', 'Brookhaven Recreation District 139', 'Recreation District', 'Small', 'Central', 0.978, 1.3, 2.282),
  R('member-140', 'Fairmont County 140', 'County', 'Large', 'South', 18.9, 6.7, 51.608),
  R('member-141', 'Pinecrest Transit Authority 141', 'Transit Authority', 'Large', 'North', 15.329, 6.7, 140.796),
  R('member-142', 'Valley Park District 142', 'Park District', 'Small', 'Central', 2.619, 5.3, 10.017),
  R('member-143', 'Lakeside Special District 143', 'Special District', 'Small', 'North', 1.95, 5, 13.667),
  R('member-144', 'Stonehill Special District 144', 'Special District', 'Small', 'South', 3.262, 6.8, 18.593),
  R('member-145', 'Ridgeway School District 145', 'School District', 'Medium', 'South', 5.662, 3.8, 12.605),
  R('member-146', 'Westfield City 146', 'City', 'Small', 'Central', 3.227, 2.2, 5.075),
  R('member-147', 'Westfield Park District 147', 'Park District', 'Small', 'Central', 1.523, 7.3, 6.816),
  R('member-148', 'Summit Recreation District 148', 'Recreation District', 'Small', 'Central', 2.035, 4, 5.895),
  R('member-149', 'Maplewood Water District 149', 'Water District', 'Small', 'North', 1.077, 7.8, 6.829),
  R('member-150', 'Ashford City 150', 'City', 'Small', 'South', 2.018, 4.3, 4.933),
  R('member-151', 'Fairmont Special District 151', 'Special District', 'Small', 'South', 0.804, 5.3, 5.691),
  R('member-152', 'Clearwater Water District 152', 'Water District', 'Small', 'Central', 1.743, 1, 7.891),
  R('member-153', 'Pinecrest School District 153', 'School District', 'Medium', 'South', 11.953, 3, 32.145),
  R('member-154', 'Brookhaven Water District 154', 'Water District', 'Small', 'North', 2.02, 3.6, 24.963),
  R('member-155', 'Brookhaven Recreation District 155', 'Recreation District', 'Large', 'Central', 16.843, 6.5, 30.757),
  R('member-156', 'Maplewood Park District 156', 'Park District', 'Small', 'North', 0.649, 5.3, 4.457),
  R('member-157', 'Ridgeway City 157', 'City', 'Medium', 'North', 7.368, 3.1, 15.997),
  R('member-158', 'Valley Water District 158', 'Water District', 'Small', 'Central', 2.113, 7.7, 19.979),
  R('member-159', 'Ridgeway Park District 159', 'Park District', 'Small', 'North', 2.401, 6, 11.029),
  R('member-160', 'Brookhaven City 160', 'City', 'Medium', 'South', 4.249, 2.4, 10.977),
  R('member-161', 'Northvale Park District 161', 'Park District', 'Small', 'North', 1.221, 5, 5.572),
  R('member-162', 'Stonehill City 162', 'City', 'Medium', 'Central', 6.695, 5.3, 9.709),
  R('member-163', 'Cedar Falls School District 163', 'School District', 'Small', 'South', 0.942, 7.6, 1.087),
  R('member-164', 'Pinecrest Water District 164', 'Water District', 'Small', 'Central', 2.149, 3.3, 20.14),
  R('member-165', 'Ridgeway Fire District 165', 'Fire District', 'Small', 'North', 2.184, 4.8, 10.843),
  R('member-166', 'Lakeside Fire District 166', 'Fire District', 'Small', 'North', 2.005, 1.9, 13.35),
  R('member-167', 'Harbor County 167', 'County', 'Large', 'South', 12.027, 5.2, 33.693),
  R('member-168', 'Westfield Special District 168', 'Special District', 'Small', 'Central', 1.232, 6.6, 3.813),
  R('member-169', 'Stonehill Recreation District 169', 'Recreation District', 'Small', 'North', 2.022, 6.1, 3.589),
  R('member-170', 'Southgate City 170', 'City', 'Small', 'Central', 2.509, 3.5, 5.772),
  R('member-171', 'Riverton Transit Authority 171', 'Transit Authority', 'Small', 'North', 1.999, 4.6, 12.595),
  R('member-172', 'Riverton City 172', 'City', 'Medium', 'Central', 11.095, 3.7, 32.896),
  R('member-173', 'Riverton Water District 173', 'Water District', 'Small', 'Central', 2.455, 6.4, 16.073),
  R('member-174', 'Harbor City 174', 'City', 'Large', 'North', 14.013, 4.2, 43.279),
  R('member-175', 'Harbor School District 175', 'School District', 'Medium', 'South', 4.214, 5.7, 13.697),
  R('member-176', 'Summit Special District 176', 'Special District', 'Medium', 'Central', 5.207, 7.1, 27.679),
  R('member-177', 'Brookhaven Park District 177', 'Park District', 'Small', 'North', 0.621, 4.8, 1.564),
  R('member-178', 'Stonehill Park District 178', 'Park District', 'Small', 'Central', 0.505, 7.4, 1.454),
  R('member-179', 'Valley Recreation District 179', 'Recreation District', 'Medium', 'South', 6.502, 4.1, 12.453),
  R('member-180', 'Ridgeway City 180', 'City', 'Medium', 'Central', 7.844, 3.5, 14.746),
  R('member-181', 'Brookhaven School District 181', 'School District', 'Small', 'North', 2.279, 6.3, 4.252),
  R('member-182', 'Pinecrest County 182', 'County', 'Large', 'South', 13.139, 6.7, 67.524),
  R('member-183', 'Stonehill Park District 183', 'Park District', 'Small', 'Central', 1.913, 5.9, 5.21),
  R('member-184', 'Brookhaven Park District 184', 'Park District', 'Small', 'North', 1.79, 4.9, 8.943),
  R('member-185', 'Ridgeway Special District 185', 'Special District', 'Small', 'Central', 3.794, 5.4, 34.681),
  R('member-186', 'Clearwater Water District 186', 'Water District', 'Small', 'Central', 0.655, 4.6, 2.291),
  R('member-187', 'Stonehill Recreation District 187', 'Recreation District', 'Medium', 'Central', 4.714, 4.8, 14.881),
  R('member-188', 'Pinecrest School District 188', 'School District', 'Medium', 'South', 7.023, 1, 23.249),
  R('member-189', 'Clearwater County 189', 'County', 'Medium', 'North', 8.239, 4.1, 34.456),
  R('member-190', 'Southgate Transit Authority 190', 'Transit Authority', 'Small', 'Central', 1.563, 5.1, 10.697),
  R('member-191', 'Northvale Recreation District 191', 'Recreation District', 'Small', 'Central', 2.337, 1.3, 6.37),
  R('member-192', 'Harbor City 192', 'City', 'Very Large', 'South', 28.958, 3.2, 54.74),
  R('member-193', 'Clearwater School District 193', 'School District', 'Large', 'South', 14.43, 5.8, 76.868),
  R('member-194', 'Oakdale School District 194', 'School District', 'Small', 'South', 2.507, 3.6, 8.53),
  R('member-195', 'Harbor School District 195', 'School District', 'Medium', 'South', 4.261, 4.4, 14.885),
  R('member-196', 'Riverton Water District 196', 'Water District', 'Medium', 'Central', 5.397, 1, 87.943),
  R('member-197', 'Lakeside Water District 197', 'Water District', 'Small', 'North', 1.147, 8.9, 13.128),
  R('member-198', 'Glenmoor Fire District 198', 'Fire District', 'Small', 'Central', 1.739, 3.5, 8.011),
  R('member-199', 'Maplewood Recreation District 199', 'Recreation District', 'Small', 'Central', 0.902, 3.5, 1.724),
  R('member-200', 'Oakdale Fire District 200', 'Fire District', 'Medium', 'Central', 6.204, 5.4, 21.574),
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
