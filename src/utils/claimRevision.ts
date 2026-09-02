// ============================================================================
// THE PER-CLAIM REVISION LAW — MECHANISM. STAGE 1, FLAG-GATED AND OFF.
//
// ⚠ NOTHING HERE IS WIRED INTO THE ENGINE. PER_CLAIM_REVISION_ENABLED is false,
// the cohort IBNER path is untouched, and this module has no caller in src/.
// Its callers today are the four Stage 1 gates. The fitted parameters and the
// reasoning behind each component live at CLAIM_REVISION_* in
// defaultAssumptions.ts; this file is only how they are applied.
//
// ============================================================================
// DERIVED, NEVER STORED — AND THAT IS NOW AFFORDABLE.
//
// A claim's whole revision path is a pure function of (gameId, claimId, age).
// Nothing about it is persisted, exactly as claimClosureUnit persists nothing:
// Ruling 8 keeps the claim register out of the save, and claimRegeneration.ts
// (dbcfed7) makes the register reachable again on demand, so a consumer that
// needs a claim's carried value at some age can redraw the register and walk
// this law forward. Before regeneration existed that was not true and Stage 1
// was blocked on it.
//
// The hash is claimClosureUnit's, with the age and a purpose label folded in.
// It is deliberately NOT the project's SeededRandom, for claimClosureUnit's
// reason: consuming from a seeded stream would move every downstream draw and
// re-roll the game, for a quantity that is a read-time property of a claim that
// already exists.
//
// ⚠ THE PURPOSE LABELS MUST STAY DISTINCT, and the frequency/sign/magnitude
// draws at one age must not share a unit. They did in a first cut, and the
// symptom was invisible from the totals: a claim that moved always moved in the
// same direction, because the same uniform decided both.
// ============================================================================

import {
  CLAIM_REVISION_COMBINE,
  CLAIM_REVISION_FREQUENCY,
  CLAIM_REVISION_MAGNITUDE_NUMERATOR,
  CLAIM_REVISION_PERSISTENCE_RHO,
  CLAIM_REVISION_PHI,
  CLAIM_REVISION_SIZE_TREND,
  CLAIM_SETTLEMENT_FACTOR,
} from '../data/defaultAssumptions';

/**
 * A uniform on [0,1) for one claim, one age, one purpose.
 *
 * FNV-1a over (gameId, claimId, age, purpose) with claimClosureUnit's
 * avalanche. Separators are bytes that cannot occur in any of the strings, so
 * no two different splits of the same concatenation can collide.
 */
export function claimRevisionUnit(gameId: string, claimId: string, age: number, purpose: string): number {
  let h = 2166136261 >>> 0;
  const feed = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x1f;
    h = Math.imul(h, 16777619) >>> 0;
  };
  feed(gameId);
  feed(claimId);
  // The age as four bytes, so age 1 and age 10 cannot alias through a decimal
  // string sharing a prefix with the purpose label.
  const a = age | 0;
  for (let b = 0; b < 4; b++) {
    h ^= (a >>> (b * 8)) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= 0x1e;
  h = Math.imul(h, 16777619) >>> 0;
  feed(purpose);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/**
 * Standard normal from a uniform — Acklam's inverse-CDF rational approximation,
 * |error| < 1.15e-9 over the whole range.
 *
 * ⚠ AN INVERSE CDF AND NOT BOX-MULLER, DELIBERATELY. Box-Muller needs two
 * uniforms and returns two normals, which would either waste a hash or couple
 * two claims' draws together. One uniform in, one normal out, keyed per claim
 * per age per purpose — that is what keeps the path a pure function.
 */
export function normalQuantile(p: number): number {
  // Clamp off the open endpoints; the hash can return exactly 0.
  const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const a = [-3.969683028665376e+1, 2.209460984245205e+2, -2.759285104469687e+2,
    1.383577518672690e+2, -3.066479806614716e+1, 2.506628277459239e+0];
  const b = [-5.447609879822406e+1, 1.615858368580409e+2, -1.556989798598866e+2,
    6.680131188771972e+1, -1.328068155288572e+1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e+0,
    -2.549732539343734e+0, 4.374664141464968e+0, 2.938163982698783e+0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e+0,
    3.754408661907416e+0];
  const pLow = 0.02425;
  if (q < pLow) {
    const u = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * u + c[1]) * u + c[2]) * u + c[3]) * u + c[4]) * u + c[5])
      / ((((d[0] * u + d[1]) * u + d[2]) * u + d[3]) * u + 1);
  }
  if (q > 1 - pLow) {
    const u = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * u + c[1]) * u + c[2]) * u + c[3]) * u + c[4]) * u + c[5])
      / ((((d[0] * u + d[1]) * u + d[2]) * u + d[3]) * u + 1);
  }
  const u = q - 0.5;
  const r = u * u;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * u
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * The revision magnitude on the INCURRED, as a fraction, before phi.
 *
 * The smaller of the age curve and the size trend — see CLAIM_REVISION_COMBINE
 * for why the product double-counts. `product` is kept as a runnable arm so the
 * measurement that rejected it stays reproducible rather than quoted.
 */
export function revisionMagnitudeOnIncurred(modelAge: number, value: number): number {
  const byAge = CLAIM_REVISION_MAGNITUDE_NUMERATOR / (Math.max(1, modelAge) + 1);
  const { scale, exponent } = CLAIM_REVISION_SIZE_TREND;
  const bySize = scale * Math.pow(Math.max(1, value), exponent);
  return CLAIM_REVISION_COMBINE === 'product' ? byAge * bySize : Math.min(byAge, bySize);
}

/** One claim's state as the law walks it forward. */
export interface RevisionState {
  /** Carried value — the claim's current estimate of its own ultimate. */
  value: number;
  /** Paid to date, as a share of the carried value. Headroom is 1 - this. */
  paidShare: number;
  /** The sign of the last revision, or 0 before the first one. */
  lastSign: 0 | 1 | -1;
}

/**
 * ONE ANNUAL REVISION STEP on one open claim.
 *
 * ⚠ THE FACTOR IS MEAN-ONE AND STRICTLY POSITIVE, WHICH IS THE WHOLE POINT OF
 * THE RESERVE BASIS. It is exp(s.sign.|Z| - s^2/2) with s the magnitude on the
 * reserve. Marginally the sign is fair (the chain starts fair and is symmetric,
 * so it is stationary at 1/2), sign and |Z| are independent, and
 * E[cosh(s|Z|)] = e^{s^2/2} exactly — so E[factor] = 1 with no truncation
 * anywhere and no floor to hit.
 *
 * ⚠ CONDITIONALLY IT IS NOT MEAN-ONE, AND THAT IS THE PERSISTENCE. Given the
 * previous sign, E[sign] = rho rather than 0, so a run compounds and E[ultimate]
 * drifts UP over a runoff. The settlement factor's derived mean is what pays
 * that back — the two must be measured together, which is why
 * martingale-equivalence-check decomposes them instead of reading the total.
 */
export function reviseOnce(
  gameId: string,
  claimId: string,
  modelAge: number,
  state: RevisionState,
  phi: number = CLAIM_REVISION_PHI,
): RevisionState {
  // FREQUENCY IS I.I.D. — see the memoryless note at CLAIM_REVISION_FREQUENCY.
  if (claimRevisionUnit(gameId, claimId, modelAge, 'rev_freq') >= CLAIM_REVISION_FREQUENCY) {
    return state;
  }

  const headroom = Math.max(1e-9, 1 - state.paidShare);
  const onIncurred = phi * revisionMagnitudeOnIncurred(modelAge, state.value);
  // THE BASIS CONVERSION, AND IT IS THE ONLY DIVISION IN THE LAW.
  const s = onIncurred / headroom;

  // SIGN — two-state Markov, first sign fair.
  const uSign = claimRevisionUnit(gameId, claimId, modelAge, 'rev_sign');
  let sign: 1 | -1;
  if (state.lastSign === 0) {
    sign = uSign < 0.5 ? 1 : -1;
  } else {
    const stay = (1 + CLAIM_REVISION_PERSISTENCE_RHO) / 2;
    sign = uSign < stay ? (state.lastSign as 1 | -1) : (-state.lastSign as 1 | -1);
  }

  const z = Math.abs(normalQuantile(claimRevisionUnit(gameId, claimId, modelAge, 'rev_mag')));
  const factor = Math.exp(sign * s * z - (s * s) / 2);

  // The RESERVE moves; the paid stays put. So the carried value moves by the
  // reserve's share of it, and the paid share is restated against the new value.
  const paid = state.value * state.paidShare;
  const reserve = state.value - paid;
  const newValue = paid + reserve * factor;
  return {
    value: newValue,
    paidShare: newValue > 0 ? paid / newValue : 1,
    lastSign: sign,
  };
}

/**
 * The settlement factor applied to a claim's carried value when it closes.
 *
 * SHAPE MEASURED, MEAN DERIVED. `nonZeroScale` is the solved level — see
 * CLAIM_SETTLEMENT_FACTOR. A scale of 1 leaves the fitted shape at its own
 * measured mean, which is NOT a martingale once rho is in force.
 */
export function settlementFactor(
  gameId: string,
  claimId: string,
  nonZeroScale: number = CLAIM_SETTLEMENT_FACTOR.nonZeroScale,
): number {
  const u = claimRevisionUnit(gameId, claimId, 0, 'settle_zero');
  if (u < CLAIM_SETTLEMENT_FACTOR.zeroProbability) return 0;
  const z = normalQuantile(claimRevisionUnit(gameId, claimId, 0, 'settle_size'));
  return nonZeroScale * Math.exp(CLAIM_SETTLEMENT_FACTOR.nonZeroLogMu
    + CLAIM_SETTLEMENT_FACTOR.nonZeroLogSigma * z);
}

/** The mean of the settlement factor at a given level scale. Closed form. */
export function settlementFactorMean(
  nonZeroScale: number = CLAIM_SETTLEMENT_FACTOR.nonZeroScale,
): number {
  const { zeroProbability, nonZeroLogMu, nonZeroLogSigma } = CLAIM_SETTLEMENT_FACTOR;
  return (1 - zeroProbability) * nonZeroScale
    * Math.exp(nonZeroLogMu + (nonZeroLogSigma * nonZeroLogSigma) / 2);
}

/**
 * Walk one claim from its drawn value to its SETTLED value.
 *
 * `closureAge` is the age at which the claim closes — the caller resolves it
 * from the claim's own closure curve and claimClosureUnit, so this function
 * takes no view on closure. `paidShareAt` is the same: the caller supplies the
 * payment path, because claimClosure.ts's split is a cohort-level allocation
 * and this module must not reimplement it.
 *
 * ⚠ THE SETTLEMENT FACTOR IS APPLIED ONCE, AT CLOSURE, AND NOT AT EVERY AGE.
 * It is the adjuster's final resolution against the last carried value, which
 * is why 19% of claims settling at zero is coherent: a file can be carried at a
 * real number for years and close for nothing.
 */
export function claimTerminalValue(
  gameId: string,
  claimId: string,
  drawnValue: number,
  closureAge: number,
  nonZeroScale: number = CLAIM_SETTLEMENT_FACTOR.nonZeroScale,
  paidShareAt: (age: number) => number = () => 0,
  phi: number = CLAIM_REVISION_PHI,
): number {
  let state: RevisionState = { value: drawnValue, paidShare: 0, lastSign: 0 };
  for (let age = 1; age < closureAge; age++) {
    state = { ...state, paidShare: paidShareAt(age) };
    state = reviseOnce(gameId, claimId, age, state, phi);
  }
  return state.value * settlementFactor(gameId, claimId, nonZeroScale);
}
