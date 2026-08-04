// Canonical 200-member marketplace — GENERATED FILE, do not edit by hand.
// Source of truth: src/data/roster_canonical.csv, converted by
// scripts/tools/generate-member-catalog.ts (see that script for every rule:
// risk-quality clamping, size bucketing, TIV construction, satisfaction).
//
// The roster is permanent and fixed: it never grows or shrinks, no entity is
// ever created or deleted, and it is deliberately independent of the game
// seed. Every game uses these same 200 entities; the seed only determines
// which of them begin in the pool. Payroll totals $1,300M and drives both WC
// and GL exposure (public-entity pools have one payroll base, not a separate
// commercial-style GL revenue base). Property uses TIV — an independently
// constructed exposure base that deliberately does NOT track payroll (see
// TIV_TYPE_MULTIPLIER).
//
// Each member's WC class-payroll split and GL sub-line relativities are exact
// functions of its Type — see WC_CLASS_MIX and GL_RELATIVITIES in
// defaultAssumptions.ts. They are intentionally NOT stored per member.

import type { CoverageLine, Member, MemberType, SizeCategory } from '../types/simulation';
import { PROPERTY_TIV_SCALE } from './defaultAssumptions';

export interface CanonicalRosterRow {
  id: string;
  name: string;
  type: MemberType;
  sizeCategory: SizeCategory;
  payroll: number;      // $M; the WC and GL exposure base
  riskQuality: number;  // 1-10 (clamped up to 1.0 at generation where the CSV was lower)
  unscaledTiv: number;  // $M before PROPERTY_TIV_SCALE; the Property exposure base
}

function R(
  id: string, name: string, type: MemberType, sizeCategory: SizeCategory,
  payroll: number, riskQuality: number, unscaledTiv: number,
): CanonicalRosterRow {
  return { id, name, type, sizeCategory, payroll, riskQuality, unscaledTiv };
}

export const CANONICAL_ROSTER: ReadonlyArray<CanonicalRosterRow> = [
  R('member-001', 'Brookhaven School District 001', 'School District', 'Medium', 8.551, 5.5, 10.2),
  R('member-002', 'Summit County 002', 'County', 'Medium', 8.769, 8.3, 16.89),
  R('member-003', 'Ridgeway City 003', 'City', 'Small', 3.117, 3.8, 4.67),
  R('member-004', 'Summit Fire District 004', 'Fire District', 'Small', 1.47, 3.5, 5.87),
  R('member-005', 'Northvale Water District 005', 'Water District', 'Small', 1.736, 6.2, 13.2),
  R('member-006', 'Clearwater Park District 006', 'Park District', 'Medium', 6.626, 6.8, 17.91),
  R('member-007', 'Eastbrook County 007', 'County', 'Medium', 6.386, 6.2, 9.11),
  R('member-008', 'Clearwater Water District 008', 'Water District', 'Small', 2.041, 7.4, 14.4),
  R('member-009', 'Glenmoor Recreation District 009', 'Recreation District', 'Small', 3.513, 1.6, 7.8),
  R('member-010', 'Cedar Falls City 010', 'City', 'Small', 2.686, 5.1, 4),
  R('member-011', 'Brookhaven School District 011', 'School District', 'Small', 3.341, 4.4, 3.4),
  R('member-012', 'Westfield Park District 012', 'Park District', 'Very Large', 26.348, 5.7, 156),
  R('member-013', 'Lakeside Water District 013', 'Water District', 'Small', 0.698, 7, 8.4),
  R('member-014', 'Eastbrook Water District 014', 'Water District', 'Small', 4.021, 7.6, 4.8),
  R('member-015', 'Lakeside School District 015', 'School District', 'Medium', 8.337, 8.9, 31.36),
  R('member-016', 'Summit Transit Authority 016', 'Transit Authority', 'Small', 2.74, 7.3, 8.53),
  R('member-017', 'Southgate County 017', 'County', 'Small', 1.956, 9.2, 3.33),
  R('member-018', 'Clearwater County 018', 'County', 'Medium', 6.292, 6.9, 20),
  R('member-019', 'Maplewood City 019', 'City', 'Large', 10.671, 2.9, 42.67),
  R('member-020', 'Pinecrest County 020', 'County', 'Small', 0.762, 6.6, 4),
  R('member-021', 'Summit County 021', 'County', 'Medium', 7.287, 8.8, 6),
  R('member-022', 'Glenmoor Fire District 022', 'Fire District', 'Small', 0.761, 3.2, 14.67),
  R('member-023', 'Riverton Water District 023', 'Water District', 'Medium', 5.439, 5.6, 22),
  R('member-024', 'Lakeside City 024', 'City', 'Medium', 5.856, 3.8, 7.56),
  R('member-025', 'Glenmoor Recreation District 025', 'Recreation District', 'Small', 2.967, 4.6, 9.53),
  R('member-026', 'Summit School District 026', 'School District', 'Small', 1.65, 5.6, 9.07),
  R('member-027', 'Summit Recreation District 027', 'Recreation District', 'Large', 21.691, 4.4, 34.09),
  R('member-028', 'Stonehill Park District 028', 'Park District', 'Small', 4.214, 5, 10.4),
  R('member-029', 'Clearwater Water District 029', 'Water District', 'Small', 0.428, 7.4, 10.8),
  R('member-030', 'Westfield Special District 030', 'Special District', 'Small', 4.615, 5.5, 4),
  R('member-031', 'Valley Recreation District 031', 'Recreation District', 'Small', 2.652, 7.1, 2.6),
  R('member-032', 'Oakdale County 032', 'County', 'Small', 2.522, 7.3, 6.67),
  R('member-033', 'Westfield Special District 033', 'Special District', 'Small', 1.663, 6, 4.67),
  R('member-034', 'Stonehill Special District 034', 'Special District', 'Large', 16.326, 5.4, 22.11),
  R('member-035', 'Eastbrook Fire District 035', 'Fire District', 'Small', 3.593, 5.6, 16.13),
  R('member-036', 'Summit City 036', 'City', 'Small', 2.686, 3.7, 5.33),
  R('member-037', 'Summit Park District 037', 'Park District', 'Medium', 8.257, 6.7, 11.84),
  R('member-038', 'Ridgeway County 038', 'County', 'Small', 1.292, 6.2, 8),
  R('member-039', 'Stonehill Special District 039', 'Special District', 'Small', 4.441, 5.2, 6),
  R('member-040', 'Oakdale Water District 040', 'Water District', 'Small', 2.274, 3.4, 7.2),
  R('member-041', 'Northvale Transit Authority 041', 'Transit Authority', 'Small', 3.681, 5.5, 3.2),
  R('member-042', 'Eastbrook School District 042', 'School District', 'Small', 4.025, 7, 11.33),
  R('member-043', 'Southgate Park District 043', 'Park District', 'Medium', 5.354, 6, 15.89),
  R('member-044', 'Riverton Recreation District 044', 'Recreation District', 'Medium', 8.266, 4.9, 9.82),
  R('member-045', 'Harbor County 045', 'County', 'Large', 10.605, 9.6, 50.89),
  R('member-046', 'Ashford School District 046', 'School District', 'Small', 3.864, 8.2, 9.07),
  R('member-047', 'Ashford County 047', 'County', 'Medium', 6.375, 7.6, 9.11),
  R('member-048', 'Westfield Water District 048', 'Water District', 'Small', 4.093, 5, 14.4),
  R('member-049', 'Westfield City 049', 'City', 'Small', 3.037, 1.7, 6),
  R('member-050', 'Ashford Fire District 050', 'Fire District', 'Small', 4.679, 5.3, 8.8),
  R('member-051', 'Eastbrook County 051', 'County', 'Small', 0.818, 7.4, 2),
  R('member-052', 'Southgate Water District 052', 'Water District', 'Medium', 6.87, 3.1, 30.4),
  R('member-053', 'Eastbrook School District 053', 'School District', 'Small', 3.064, 5.1, 7.93),
  R('member-054', 'Riverton Special District 054', 'Special District', 'Medium', 5.976, 6.2, 7.56),
  R('member-055', 'Lakeside Transit Authority 055', 'Transit Authority', 'Large', 15.644, 3.5, 81.42),
  R('member-056', 'Pinecrest Water District 056', 'Water District', 'Medium', 6.679, 5.4, 24.8),
  R('member-057', 'Summit Fire District 057', 'Fire District', 'Small', 2.197, 2.8, 7.33),
  R('member-058', 'Ridgeway School District 058', 'School District', 'Small', 1.834, 5.3, 13.6),
  R('member-059', 'Maplewood Special District 059', 'Special District', 'Small', 1.424, 6.1, 6),
  R('member-060', 'Oakdale City 060', 'City', 'Small', 1.476, 3, 4),
  R('member-061', 'Lakeside County 061', 'County', 'Small', 4.529, 6.4, 2),
  R('member-062', 'Glenmoor City 062', 'City', 'Large', 20.551, 4.5, 46.78),
  R('member-063', 'Valley City 063', 'City', 'Medium', 6.543, 3.1, 12.22),
  R('member-064', 'Harbor City 064', 'City', 'Large', 12.47, 4.4, 22.11),
  R('member-065', 'Maplewood Transit Authority 065', 'Transit Authority', 'Medium', 6.894, 4.8, 29.51),
  R('member-066', 'Stonehill Fire District 066', 'Fire District', 'Small', 1.297, 5.2, 11.73),
  R('member-067', 'Northvale Transit Authority 067', 'Transit Authority', 'Very Large', 31.641, 4.1, 112),
  R('member-068', 'Eastbrook Transit Authority 068', 'Transit Authority', 'Very Large', 109.43, 5.1, 224),
  R('member-069', 'Cedar Falls Transit Authority 069', 'Transit Authority', 'Small', 2.128, 5.1, 9.6),
  R('member-070', 'Lakeside Recreation District 070', 'Recreation District', 'Medium', 8.543, 2.8, 13.87),
  R('member-071', 'Oakdale Water District 071', 'Water District', 'Small', 1.661, 5, 3.6),
  R('member-072', 'Westfield City 072', 'City', 'Medium', 5.258, 2.8, 16.89),
  R('member-073', 'Westfield Special District 073', 'Special District', 'Medium', 5.851, 7.1, 12.22),
  R('member-074', 'Ridgeway Park District 074', 'Park District', 'Medium', 5.953, 6.6, 9.82),
  R('member-075', 'Clearwater Park District 075', 'Park District', 'Medium', 5.679, 7.2, 23.98),
  R('member-076', 'Southgate Transit Authority 076', 'Transit Authority', 'Small', 3.606, 7.3, 8.53),
  R('member-077', 'Northvale City 077', 'City', 'Small', 1.964, 4.1, 3.33),
  R('member-078', 'Lakeside Fire District 078', 'Fire District', 'Large', 15.789, 6.3, 121),
  R('member-079', 'Northvale Park District 079', 'Park District', 'Small', 1.408, 5.6, 7.8),
  R('member-080', 'Fairmont City 080', 'City', 'Large', 14.585, 3.1, 30.33),
  R('member-081', 'Fairmont Transit Authority 081', 'Transit Authority', 'Medium', 7.255, 4, 9.6),
  R('member-082', 'Southgate Water District 082', 'Water District', 'Medium', 7.531, 6.2, 30.4),
  R('member-083', 'Westfield Special District 083', 'Special District', 'Medium', 5.088, 7.4, 12.22),
  R('member-084', 'Valley Water District 084', 'Water District', 'Small', 0.65, 3.7, 4.8),
  R('member-085', 'Lakeside Park District 085', 'Park District', 'Medium', 7.265, 5.6, 23.98),
  R('member-086', 'Northvale Special District 086', 'Special District', 'Medium', 9.048, 4.8, 13.78),
  R('member-087', 'Ashford County 087', 'County', 'Large', 10.42, 5.2, 26.22),
  R('member-088', 'Clearwater Recreation District 088', 'Recreation District', 'Large', 14.392, 1.3, 71.5),
  R('member-089', 'Southgate County 089', 'County', 'Small', 2.751, 5, 6),
  R('member-090', 'Pinecrest Recreation District 090', 'Recreation District', 'Medium', 5.756, 8.1, 13.87),
  R('member-091', 'Brookhaven Water District 091', 'Water District', 'Medium', 7.202, 1, 10.8),
  R('member-092', 'Eastbrook City 092', 'City', 'Medium', 5.098, 4.6, 16.89),
  R('member-093', 'Glenmoor Special District 093', 'Special District', 'Small', 3.263, 8.1, 4.67),
  R('member-094', 'Northvale Park District 094', 'Park District', 'Medium', 6.209, 5.2, 9.82),
  R('member-095', 'Clearwater City 095', 'City', 'Medium', 6.767, 3.5, 18.44),
  R('member-096', 'Maplewood City 096', 'City', 'Small', 1.887, 3.1, 5.33),
  R('member-097', 'Harbor Water District 097', 'Water District', 'Medium', 5.197, 5.5, 16.4),
  R('member-098', 'Oakdale County 098', 'County', 'Medium', 7.143, 7.1, 20),
  R('member-099', 'Ridgeway Special District 099', 'Special District', 'Small', 0.912, 6.3, 6),
  R('member-100', 'Maplewood Water District 100', 'Water District', 'Large', 10.826, 7.2, 54.6),
  R('member-101', 'Stonehill School District 101', 'School District', 'Small', 2.753, 4, 3.4),
  R('member-102', 'Stonehill Transit Authority 102', 'Transit Authority', 'Small', 2.331, 4.3, 10.67),
  R('member-103', 'Glenmoor Transit Authority 103', 'Transit Authority', 'Medium', 6.28, 6.5, 19.56),
  R('member-104', 'Stonehill Park District 104', 'Park District', 'Large', 11.641, 5.1, 28.74),
  R('member-105', 'Ridgeway Water District 105', 'Water District', 'Small', 4.907, 3.7, 13.2),
  R('member-106', 'Pinecrest Water District 106', 'Water District', 'Small', 1.113, 3.8, 9.6),
  R('member-107', 'Lakeside Water District 107', 'Water District', 'Small', 2.117, 2.9, 6),
  R('member-108', 'Valley School District 108', 'School District', 'Small', 2.626, 9, 13.6),
  R('member-109', 'Stonehill Fire District 109', 'Fire District', 'Medium', 5.941, 2.8, 33.73),
  R('member-110', 'Brookhaven County 110', 'County', 'Small', 3.581, 7, 4),
  R('member-111', 'Pinecrest Special District 111', 'Special District', 'Small', 1.155, 5.6, 2),
  R('member-112', 'Glenmoor Water District 112', 'Water District', 'Small', 2.286, 4.4, 12),
  R('member-113', 'Northvale Transit Authority 113', 'Transit Authority', 'Small', 3.876, 6.5, 7.47),
  R('member-114', 'Ashford Special District 114', 'Special District', 'Large', 15.781, 5.1, 22.11),
  R('member-115', 'Pinecrest County 115', 'County', 'Medium', 4.932, 4.1, 18.44),
  R('member-116', 'Pinecrest City 116', 'City', 'Small', 3.849, 5.7, 5.33),
  R('member-117', 'Summit County 117', 'County', 'Small', 1.434, 7.1, 3.33),
  R('member-118', 'Valley School District 118', 'School District', 'Very Large', 31.281, 3.5, 238),
  R('member-119', 'Summit Recreation District 119', 'Recreation District', 'Medium', 9.721, 2.8, 19.93),
  R('member-120', 'Pinecrest Water District 120', 'Water District', 'Medium', 8.615, 9.9, 19.2),
  R('member-121', 'Oakdale Fire District 121', 'Fire District', 'Small', 3.452, 5.7, 4.4),
  R('member-122', 'Stonehill Transit Authority 122', 'Transit Authority', 'Small', 3.945, 6.2, 10.67),
  R('member-123', 'Eastbrook Fire District 123', 'Fire District', 'Small', 1.404, 6.1, 10.27),
  R('member-124', 'Ridgeway County 124', 'County', 'Small', 3.878, 9.2, 2.67),
  R('member-125', 'Ashford City 125', 'City', 'Small', 1.442, 4.4, 7.33),
  R('member-126', 'Harbor City 126', 'City', 'Medium', 6.04, 2.7, 13.78),
  R('member-127', 'Harbor Special District 127', 'Special District', 'Very Large', 32.03, 6.9, 70),
  R('member-128', 'Glenmoor Water District 128', 'Water District', 'Medium', 7.602, 5.7, 36),
  R('member-129', 'Summit Recreation District 129', 'Recreation District', 'Large', 11.68, 3.6, 55.47),
  R('member-130', 'Clearwater Recreation District 130', 'Recreation District', 'Large', 10.85, 2.7, 39.43),
  R('member-131', 'Glenmoor Water District 131', 'Water District', 'Medium', 7.34, 6, 10.8),
  R('member-132', 'Valley Park District 132', 'Park District', 'Large', 12.553, 4, 60.81),
  R('member-133', 'Northvale Transit Authority 133', 'Transit Authority', 'Large', 11.44, 4.4, 55.11),
  R('member-134', 'Lakeside City 134', 'City', 'Small', 0.709, 4.6, 2.67),
  R('member-135', 'Maplewood City 135', 'City', 'Small', 2.396, 4.2, 7.33),
  R('member-136', 'Ashford Fire District 136', 'Fire District', 'Medium', 5.445, 3.8, 30.31),
  R('member-137', 'Summit Fire District 137', 'Fire District', 'Small', 3.89, 4.4, 7.33),
  R('member-138', 'Eastbrook City 138', 'City', 'Medium', 7.181, 3.4, 20),
  R('member-139', 'Brookhaven Recreation District 139', 'Recreation District', 'Small', 1.509, 1.3, 7.8),
  R('member-140', 'Fairmont County 140', 'County', 'Medium', 5.134, 6.7, 10.67),
  R('member-141', 'Pinecrest Transit Authority 141', 'Transit Authority', 'Large', 23.659, 6.7, 28.8),
  R('member-142', 'Valley Park District 142', 'Park District', 'Small', 4.042, 5.3, 8.67),
  R('member-143', 'Lakeside Special District 143', 'Special District', 'Small', 3.009, 5, 4.67),
  R('member-144', 'Stonehill Special District 144', 'Special District', 'Medium', 5.035, 6.8, 7.56),
  R('member-145', 'Ridgeway School District 145', 'School District', 'Medium', 8.739, 3.8, 31.36),
  R('member-146', 'Westfield City 146', 'City', 'Small', 2.369, 2.2, 5.33),
  R('member-147', 'Westfield Park District 147', 'Park District', 'Small', 2.35, 7.3, 4.33),
  R('member-148', 'Summit Recreation District 148', 'Recreation District', 'Small', 3.141, 4, 10.4),
  R('member-149', 'Maplewood Water District 149', 'Water District', 'Small', 1.663, 7.8, 10.8),
  R('member-150', 'Ashford City 150', 'City', 'Small', 1.481, 4.3, 4),
  R('member-151', 'Fairmont Special District 151', 'Special District', 'Small', 1.241, 5.3, 2),
  R('member-152', 'Clearwater Water District 152', 'Water District', 'Small', 2.69, 1, 12),
  R('member-153', 'Pinecrest School District 153', 'School District', 'Large', 18.448, 3, 58.56),
  R('member-154', 'Brookhaven Water District 154', 'Water District', 'Small', 3.118, 3.6, 4.8),
  R('member-155', 'Brookhaven Recreation District 155', 'Recreation District', 'Very Large', 25.995, 6.5, 169),
  R('member-156', 'Maplewood Park District 156', 'Park District', 'Small', 1.002, 5.3, 6.93),
  R('member-157', 'Ridgeway City 157', 'City', 'Medium', 5.408, 3.1, 9.11),
  R('member-158', 'Valley Water District 158', 'Water District', 'Small', 3.261, 7.7, 14.4),
  R('member-159', 'Ridgeway Park District 159', 'Park District', 'Small', 3.706, 6, 7.8),
  R('member-160', 'Brookhaven City 160', 'City', 'Small', 3.119, 2.4, 4),
  R('member-161', 'Northvale Park District 161', 'Park District', 'Small', 1.884, 5, 2.6),
  R('member-162', 'Stonehill City 162', 'City', 'Medium', 4.914, 5.3, 16.89),
  R('member-163', 'Cedar Falls School District 163', 'School District', 'Small', 1.454, 7.6, 7.93),
  R('member-164', 'Pinecrest Water District 164', 'Water District', 'Small', 3.317, 3.3, 4.8),
  R('member-165', 'Ridgeway Fire District 165', 'Fire District', 'Small', 3.371, 4.8, 16.13),
  R('member-166', 'Lakeside Fire District 166', 'Fire District', 'Small', 3.095, 1.9, 11.73),
  R('member-167', 'Harbor County 167', 'County', 'Small', 3.267, 5.2, 3.33),
  R('member-168', 'Westfield Special District 168', 'Special District', 'Small', 1.902, 6.6, 8),
  R('member-169', 'Stonehill Recreation District 169', 'Recreation District', 'Small', 3.121, 6.1, 7.8),
  R('member-170', 'Southgate City 170', 'City', 'Small', 1.842, 3.5, 4),
  R('member-171', 'Riverton Transit Authority 171', 'Transit Authority', 'Small', 3.085, 4.6, 3.2),
  R('member-172', 'Riverton City 172', 'City', 'Medium', 8.144, 3.7, 16.89),
  R('member-173', 'Riverton Water District 173', 'Water District', 'Small', 3.789, 6.4, 8.4),
  R('member-174', 'Harbor City 174', 'City', 'Large', 10.286, 4.2, 22.11),
  R('member-175', 'Harbor School District 175', 'School District', 'Medium', 6.504, 5.7, 31.36),
  R('member-176', 'Summit Special District 176', 'Special District', 'Medium', 8.036, 7.1, 13.78),
  R('member-177', 'Brookhaven Park District 177', 'Park District', 'Small', 0.959, 4.8, 4.33),
  R('member-178', 'Stonehill Park District 178', 'Park District', 'Small', 0.78, 7.4, 10.4),
  R('member-179', 'Valley Recreation District 179', 'Recreation District', 'Medium', 10.036, 4.1, 19.93),
  R('member-180', 'Ridgeway City 180', 'City', 'Medium', 5.758, 3.5, 10.67),
  R('member-181', 'Brookhaven School District 181', 'School District', 'Small', 3.518, 6.3, 3.4),
  R('member-182', 'Pinecrest County 182', 'County', 'Small', 3.569, 6.7, 6.67),
  R('member-183', 'Stonehill Park District 183', 'Park District', 'Small', 2.952, 5.9, 6.07),
  R('member-184', 'Brookhaven Park District 184', 'Park District', 'Small', 2.762, 4.9, 3.47),
  R('member-185', 'Ridgeway Special District 185', 'Special District', 'Medium', 5.855, 5.4, 18.44),
  R('member-186', 'Clearwater Water District 186', 'Water District', 'Small', 1.011, 4.6, 9.6),
  R('member-187', 'Stonehill Recreation District 187', 'Recreation District', 'Medium', 7.276, 4.8, 11.84),
  R('member-188', 'Pinecrest School District 188', 'School District', 'Large', 10.839, 1, 93.5),
  R('member-189', 'Clearwater County 189', 'County', 'Small', 2.238, 4.1, 6),
  R('member-190', 'Southgate Transit Authority 190', 'Transit Authority', 'Small', 2.413, 5.1, 6.4),
  R('member-191', 'Northvale Recreation District 191', 'Recreation District', 'Small', 3.607, 1.3, 2.6),
  R('member-192', 'Harbor City 192', 'City', 'Large', 21.256, 3.2, 46.78),
  R('member-193', 'Clearwater School District 193', 'School District', 'Large', 22.272, 5.8, 58.56),
  R('member-194', 'Oakdale School District 194', 'School District', 'Small', 3.869, 3.6, 4.53),
  R('member-195', 'Harbor School District 195', 'School District', 'Medium', 6.577, 4.4, 31.36),
  R('member-196', 'Riverton Water District 196', 'Water District', 'Medium', 8.33, 1, 24.8),
  R('member-197', 'Lakeside Water District 197', 'Water District', 'Small', 1.77, 8.9, 6),
  R('member-198', 'Glenmoor Fire District 198', 'Fire District', 'Small', 2.684, 3.5, 17.6),
  R('member-199', 'Maplewood Recreation District 199', 'Recreation District', 'Small', 1.392, 3.5, 7.8),
  R('member-200', 'Oakdale Fire District 200', 'Fire District', 'Medium', 9.575, 5.4, 23.47),
];

export const PREDEFINED_MARKET_MEMBERS: ReadonlyArray<Member> = CANONICAL_ROSTER.map(
  (row, index) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    sizeCategory: row.sizeCategory,
    exposureByLine: {
      WC: row.payroll,
      GL: row.payroll,
      Property: row.unscaledTiv * PROPERTY_TIV_SCALE,
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
