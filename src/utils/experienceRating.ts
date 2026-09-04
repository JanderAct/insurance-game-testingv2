// ============================================================================
// EXPERIENCE RATING — the pool prices off its own played PAID triangle.
//
// ⚠ THIS READS reserveDevelopment, NOT claimTriangle.ts. That is the whole
// point of S3 and it reverses what S1 assumed. The pool ALREADY had a triangle:
// LinePoolState.reserveDevelopment is an append-only ledger, one row per
// accident year, carrying ultimateByValuation and paidByValuation. It is the
// game's own experience. claimTriangle.ts builds a SECOND, SYNTHETIC ten-year
// history from the member catalog, which the pool never lived.
//
// ⚠ AND THE INCURRED SIDE CANNOT BE PRICED OFF. Measured on the shipped engine,
// 40 games x 15 years, aged correctly:
//
//     played incurred age-to-age    WC 0.997 0.995 0.997 ...  cumulative 0.9857
//                                   GL 0.995 1.000 1.002 ...  cumulative 0.9912
//                             Property 1.000 1.000 1.000 ...  cumulative 1.0005
//
// Flat, on every line. The engine's development law is MEAN-ONE, so
// E[terminal] = E[initial] and a cohort's booked estimate does not drift. The
// per-claim flip did not change that and could not — it changed WHICH law moves
// a claim, not whether the law has a drift. The synthetic triangle develops only
// because claimTriangle.ts applies developmentDrift, and NOTHING IN src/ OUTSIDE
// THAT FILE APPLIES IT (verified by grep). GL's synthetic cumulative is anchored
// at 3.60 against a played 0.9912 — a factor of 3.6 apart.
//
// The PAID side is the opposite, and is a real estimation problem:
//
//     played paid age-to-age        WC 1.367 1.168 1.100 1.067 ...  cum  2.2513
//                                   GL 3.232 1.764 1.356 1.176 ...  cum 10.3701
//                             Property 1.477 1.165 1.073 1.036 ...  cum  2.0143
//
// So this module chain-ladders PAID. GL's first factor of 3.2 is a genuine
// selection with consequences, which is what S5 will eventually be wrong about.
//
// ============================================================================
// ⚠ THE METHOD SELECTION IS ONE-SIDED TODAY, AND THE NEXT READER MUST NOT TREAT
// THE FOUR-METHOD DESIGN AS FINISHED.
//
// On a FLAT incurred triangle the incurred chain ladder returns the BOOKED
// ULTIMATE, which on this engine is the truth. So incurred CL is exact BY
// CONSTRUCTION and paid CL is light by whatever tail sits beyond the observed
// factors. A player learns in two games that incurred is always right, and a
// puzzle with one answer is not a decision — the same objection that killed the
// deterministic markdown, the reserve drift and the booking overshoot.
//
// The four-method design is therefore currently TWO methods, one of which is a
// cheat. Making the choice real needs the ENGINE to produce incurred
// development, and claimTriangle.ts is the reference implementation for how:
// it draws an initial estimate and walks it forward to a terminal landing on
// the severity fit (verified at 2.052 / 2.141 / 1.619). That is the follow-on
// piece. It is not a fifth ledger-side mechanism and it is not this commit.
//
// ============================================================================
// TWO CONSTRAINTS FOUND IN THE DATA, BOTH OF WHICH SHAPE THE ARITHMETIC BELOW.
//
// 1. SEEDED ACCIDENT YEARS ARE BORN ALREADY AGED. ReserveDevelopmentRow carries
//    ageAtFirstValuation, POSITIVE for a seed cohort, and index k is age
//    (ageAtFirstValuation + k) — NOT k. Aligning on the array index mixes a seed
//    cohort's age-6 cell into the age-1 column. The first measurement of this
//    triangle did exactly that and had to be redone.
//
// 2. SEEDED YEARS HAVE NO RECONSTRUCTABLE EXPOSURE. They are apportioned from a
//    drawn reserve total rather than summed from a register, and membershipHistory
//    holds no enrolment intervals for them. Measured at game start: WC carries
//    accident years -7..-4 seeded with NO exposure and -2, -1, 0 simulated WITH
//    exposure. (Year -3 has no row at all on any line.)
//
// ⚠ SO FACTORS AND LEVEL COME FROM DIFFERENT ROW SETS, DELIBERATELY. Every row
// contributes AGE-TO-AGE FACTORS, because a factor is a ratio of two paid cells
// and needs no exposure. Only rows with known exposure contribute a LOSS COST.
// That is what makes a three-accident-year book workable at game start: the
// thin part (the level) is thin, but the part that needs the most data (the
// development pattern, out to age 12+) is fed by every row the pool has.
// ============================================================================

import { getMemberExposure } from './lineHelpers';
import { wasActiveInLine } from './membershipHistory';
import type {
  CoverageLine, Member, MembershipHistory, ReserveDevelopmentRow,
} from '../types/simulation';

/** Ages beyond this are not developed. Past every line's runoff horizon. */
const MAX_AGE = 30;

/**
 * Everything the rate needs that is not already at a pricing call site.
 * Passed as one object so the three call sites and the decisions panel cannot
 * drift apart on which inputs they supply — panel/engine parity is asserted.
 */
export interface ExperienceBasis {
  rows: ReserveDevelopmentRow[];
  allMarketMembers: Member[];
  membershipHistory: MembershipHistory;
}

/**
 * Volume-weighted paid age-to-age factors, indexed by TRUE age.
 *
 * Every row contributes, seeded included — see constraint 2 above. A missing
 * age returns 1.0, which is a tail factor of 1.0 and is the honest default: the
 * pool has not observed development there and must not invent it.
 */
export function paidAgeToAgeFactors(rows: ReserveDevelopmentRow[]): number[] {
  const num = new Array<number>(MAX_AGE).fill(0);
  const den = new Array<number>(MAX_AGE).fill(0);
  for (const r of rows) {
    const a0 = r.ageAtFirstValuation ?? 0;
    const p = r.paidByValuation ?? [];
    for (let k = 0; k + 1 < p.length; k++) {
      const age = a0 + k;
      if (age + 1 >= MAX_AGE) continue;
      if (p[k] > 0) { den[age] += p[k]; num[age] += p[k + 1]; }
    }
  }
  return num.map((_, a) => (den[a] > 0 ? num[a] / den[a] : 1));
}

/** The cumulative development factor from `age` to ultimate, tail 1.0. */
function cdfFrom(factors: number[], age: number): number {
  let v = 1;
  for (let a = age; a < MAX_AGE; a++) v *= factors[a];
  return v;
}

/** The exposure enrolled in `line` in accident year `ay`, or 0 if unknowable. */
function exposureFor(basis: ExperienceBasis, line: CoverageLine, ay: number): number {
  let e = 0;
  for (const m of basis.allMarketMembers) {
    if (!wasActiveInLine(basis.membershipHistory, m.id, line, ay)) continue;
    e += getMemberExposure(m, line, ay);
  }
  return e;
}

/** One accident year's developed ultimate loss cost per $100 of exposure. */
export interface ExperiencePoint {
  accidentYear: number;
  latestPaid: number;
  age: number;
  developed: number;
  exposure: number;
  /** Rate per $100 — dollars = exposure x rate x 10,000 (simulationEngine). */
  lossCostPer100: number;
}

export function experiencePoints(
  line: CoverageLine, basis: ExperienceBasis,
): { points: ExperiencePoint[]; factors: number[] } {
  const factors = paidAgeToAgeFactors(basis.rows);
  const points: ExperiencePoint[] = [];
  for (const r of basis.rows) {
    const p = r.paidByValuation ?? [];
    if (p.length === 0) continue;
    const latestPaid = p[p.length - 1];
    if (!(latestPaid > 0)) continue;
    const age = (r.ageAtFirstValuation ?? 0) + p.length - 1;
    const exposure = exposureFor(basis, line, r.yearNumber);
    if (!(exposure > 0)) continue;              // seeded: contributes factors only
    const developed = latestPaid * cdfFrom(factors, age);
    points.push({
      accidentYear: r.yearNumber, latestPaid, age, developed, exposure,
      // ⚠ x 10,000 IS THE ENGINE'S OWN CONVERSION, not a scaling choice:
      // simulationEngine computes `expectedLoss = activeExposure x rate x 10_000`,
      // because exposure is carried in $M and the rate is per $100.
      lossCostPer100: developed / (exposure * 10_000),
    });
  }
  return { points, factors };
}

/**
 * The prospective pure premium per $100, off the pool's own experience.
 *
 * Returns null when the pool cannot price itself — no accident year with both a
 * paid figure and a known exposure. The caller falls back to the held rate,
 * which is the only honest thing to do rather than inventing a number.
 *
 * ⚠ THE WINDOW MEAN, NOT A FITTED TREND, AND THAT IS A MEASURED CHOICE RATHER
 * THAN A SIMPLIFICATION. A log-linear trend fitted across the pool's own
 * accident years is the textbook step and it makes the rate unusable. Measured,
 * 60 games x 15 years, share of years where the rate moves more than 20%:
 *
 *     line        fitted trend      window mean
 *     WC               9.2%              0.1%
 *     GL              26.1%              9.4%
 *     Property        28.8%              1.2%
 *
 * A trend fitted on at most ten noisy points is mostly estimating noise, and it
 * compounds out to the prospective year, so it amplifies. The window mean gives
 * WC and Property a few points of year-on-year movement — which is the
 * behaviour a rolling window is supposed to produce — and leaves GL marginal.
 * Restoring a trend needs credibility weighting first, not a better fit.
 */
export function experienceRatePer100(
  line: CoverageLine, basis: ExperienceBasis,
): number | null {
  const { points } = experiencePoints(line, basis);
  if (points.length === 0) return null;
  let s = 0;
  for (const q of points) s += q.lossCostPer100;
  return s / points.length;
}
