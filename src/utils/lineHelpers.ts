import type { CoverageLine, LinePoolState, LineResultSet, LineView, Member, ResultSet } from '../types/simulation';
import { wageFactor } from '../data/exposureTrend';

// A member's exposure in THIS YEAR'S DOLLARS — the NOMINAL, rating-side figure.
//
// ⚠ THIS IS THE RATING/PREMIUM/DISPLAY READER. There is a second exposure basis
// and confusing them is the whole design of the wage-inflation change:
//
//   NOMINAL (here)      frozen roster payroll x wageFactor(line, year).
//                       Premium, member charge, market share, every display.
//
//   REAL (raw           `member.exposureByLine.WC` read directly, no factor.
//    exposureByLine)    CLAIM FREQUENCY, and only claim frequency.
//                       wcClaimEngine reads it raw.
//
// WHY FREQUENCY MUST NOT SEE THE FACTOR: the roster is frozen, so payroll growth
// here is PURE WAGE INFLATION — same members, same workers, same injuries.
// Letting claim counts rise 3.63%/yr would assert that paying people more
// injures more of them, and it would move WC's rate trend from -1.46%/yr to
// +2.12%/yr, growing premium 5.82%/yr instead of 2.115%.
//
// yearNumber is REQUIRED, with no default. A default would silently price some
// call site at year 1 forever, which is exactly the class of defect the
// frequency-trend fix corrected (finding 37).
export function getMemberExposure(member: Member, line: CoverageLine, yearNumber: number): number {
  return (member.exposureByLine[line] ?? 0) * wageFactor(line, yearNumber);
}

// Stage 2.1 view filter: 'pool' returns lockedResults unchanged (by reference —
// this is what makes the Pool view provably identical to pre-Stage-2.1
// behavior, not just tested to match). A specific line maps each locked
// year to that line's own unaggregated slice.
// ⚠ THE RETURN TYPE USED TO BE `LineResultSet[]` FOR BOTH VIEWS, AND THAT ONE
// SIGNATURE IS WHY THE PLACEHOLDER READS SPREAD AS FAR AS THEY DID. It handed
// every caller a pool row wearing a line row's type, so `rows[0].ratePer100` at
// pool scope compiled everywhere and returned the first active line's rate. The
// overloads below give a caller that knows its view statically the exact type,
// and a caller that does not the union it actually has — which is what makes the
// compiler ask the question at each site instead of at none of them.
export function selectResultView(lockedResults: ResultSet[], view: 'pool'): ResultSet[];
export function selectResultView(lockedResults: ResultSet[], view: CoverageLine): LineResultSet[];
export function selectResultView(
  lockedResults: ResultSet[], view: LineView,
): Array<ResultSet | LineResultSet>;
export function selectResultView(
  lockedResults: ResultSet[], view: LineView,
): Array<ResultSet | LineResultSet> {
  if (view === 'pool') return lockedResults;
  return lockedResults.map(r => r.byLine[view]);
}

/**
 * NARROW A VIEW ROW TO A LINE ROW, OR null IF IT IS THE POOL.
 *
 * ⚠ `byLine` IS THE DISCRIMINATOR AND IT IS THE ONLY HONEST ONE. A pool row is
 * the only row that carries a per-line breakdown; every other candidate (a line
 * field being present, a count, a label) is a guess about shape. This narrows
 * for the compiler and at runtime with the same test.
 *
 * A page holding a view row cannot know whether it is pooled — that is the
 * reader's question, and before the result type was split nothing made them ask
 * it. `const line = asLineRow(r); line ? line.ratePer100 : '—'` is the shape of
 * the answer: the per-line figure where one exists, and a dash where none does.
 */
export function isPoolRow(r: ResultSet | LineResultSet): r is ResultSet {
  return 'byLine' in r;
}

/** The value form of the same test, for `const line = asLineRow(r)` reads. */
export function asLineRow(r: ResultSet | LineResultSet): LineResultSet | null {
  return isPoolRow(r) ? null : r;
}

export function emptyLinePoolState(): LinePoolState {
  return {
    rateLevel: 100,
    ratePer100: 0,
    purePremiumPer100: 0,
    purePremium: 0,
    memberSatisfaction: 0,
    averageRiskQuality: 0,
    riskControlEffectiveness: 0,
    reserveCohorts: [],
    members: [],
    netUnpaidReserve: 0,
    surplus: 0,
    investedAssets: 0,
    totalMarketExposure: 0,
  };
}

