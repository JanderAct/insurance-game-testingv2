// ============================================================================
// THE PER-CLAIM REVISION LAW — MECHANISM. STAGE 1, FLAG-GATED AND OFF.
//
// ⚠ THE FLAG IS OFF AND THE COHORT PATH IS UNTOUCHED. PER_CLAIM_REVISION.enabled
// is false, so processIbner never reaches reviseDevelopingSet below and the
// engine develops cohorts exactly as it did before Stage 1 — bit-identically, on
// both standing gates. This module IS now wired: simulationEngine imports
// reviseDevelopingSet, behind that one flag. The fitted parameters and the
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

/** One claim's state as the law walks it forward.
 *
 *  ⚠ `lastSign` IS GONE WITH THE SIGN CHAIN — see CLAIM_REVISION_PERSISTENCE_RHO.
 *  The state is now memoryless in the direction as well as in the frequency, so
 *  a claim's whole path is a pure function of (gameId, claimId, age) with no
 *  carried state at all. */
export interface RevisionState {
  /** Carried value — the claim's current estimate of its own ultimate. */
  value: number;
  /** Paid to date, as a share of the carried value. Headroom is 1 - this. */
  paidShare: number;
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
 *
 * ⚠ `rho` IS A PARAMETER FOR THE SAME REASON `phi` IS: SO A CONTROL ARM CAN
 * REMOVE IT. It defaults to the constant and nothing in src/ ever passes it.
 * revision-persistence-check runs the whole call path at rho = 0 and asserts
 * the same-sign rate collapses to 1/2 — without that arm the 0.59 assertion
 * would pass on a chain that had been silently reduced to fair coin flips,
 * which is precisely the defect it exists to catch.
 */
export function reviseOnce(
  gameId: string,
  claimId: string,
  modelAge: number,
  state: RevisionState,
  phi: number = CLAIM_REVISION_PHI,
): RevisionState {
  const factor = revisionFactor(gameId, claimId, modelAge, state.value, state.paidShare, phi);
  if (factor === 1) return state;

  // The RESERVE moves; the paid stays put. So the carried value moves by the
  // reserve's share of it, and the paid share is restated against the new value.
  const paid = state.value * state.paidShare;
  const reserve = state.value - paid;
  const newValue = paid + reserve * factor;
  return {
    value: newValue,
    paidShare: newValue > 0 ? paid / newValue : 1,
  };
}

/**
 * ONE STEP'S FACTOR, WITHOUT DECIDING WHAT BALANCE IT APPLIES TO.
 *
 * ⚠ EXTRACTED FROM reviseOnce SO THERE IS STILL ONE IMPLEMENTATION OF THE LAW.
 * The engine has to scale the factor onto the COHORT's own remaining balance
 * rather than onto the claim's pattern-implied reserve — see
 * reviseDevelopingSet's closure argument — and it must not do that by
 * reimplementing the draw. Every expression below is reviseOnce's, in
 * reviseOnce's order, so nothing about the law's arithmetic moved.
 *
 * A factor of exactly 1 means THE FREQUENCY DRAW DID NOT FIRE — a quiet year.
 */
export function revisionFactor(
  gameId: string,
  claimId: string,
  modelAge: number,
  value: number,
  paidShare: number,
  phi: number = CLAIM_REVISION_PHI,
): number {
  // FREQUENCY IS I.I.D. — see the memoryless note at CLAIM_REVISION_FREQUENCY.
  if (claimRevisionUnit(gameId, claimId, modelAge, 'rev_freq') >= CLAIM_REVISION_FREQUENCY) {
    return 1;
  }

  const headroom = Math.max(1e-9, 1 - paidShare);
  const onIncurred = phi * revisionMagnitudeOnIncurred(modelAge, value);
  // THE BASIS CONVERSION, AND IT IS THE ONLY DIVISION IN THE LAW.
  const s = onIncurred / headroom;

  // SIGN — A FAIR COIN, AND NOTHING CARRIES BETWEEN AGES. See
  // CLAIM_REVISION_PERSISTENCE_RHO for why the two-state chain that used to be
  // here is gone.
  const sign = claimRevisionUnit(gameId, claimId, modelAge, 'rev_sign') < 0.5 ? 1 : -1;

  const z = Math.abs(normalQuantile(claimRevisionUnit(gameId, claimId, modelAge, 'rev_mag')));
  return Math.exp(sign * s * z - (s * s) / 2);
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
  let state: RevisionState = { value: drawnValue, paidShare: 0 };
  for (let age = 1; age < closureAge; age++) {
    state = { ...state, paidShare: paidShareAt(age) };
    state = reviseOnce(gameId, claimId, age, state, phi);
  }
  return state.value * settlementFactor(gameId, claimId, nonZeroScale);
}

// ============================================================================
// THE ENGINE WIRING — one cohort step, bottom-up.
//
// ⚠ THIS IS THE ONLY FUNCTION IN THIS MODULE THE ENGINE CALLS, and it is called
// only when PER_CLAIM_REVISION.enabled is true. With the flag false
// processIbner never reaches it and the cohort path above is untouched.
//
// It returns allocateDevelopment's shape deliberately, so processIbner's
// existing cession machinery consumes it unchanged: the deltas go straight to
// cedeDevelopment, which is what puts a developed occurrence through the tower.
// Producing the same shape is what makes this a WIRING rather than a rebuild of
// the allocation path.
//
// ============================================================================
// ⚠ TWO BOUNDARIES OF THIS WIRING, BOTH OF WHICH THE FLIP MUST CLOSE.
//
// 1. THE UNTRACKED MASS KEEPS THE COHORT FACTOR. It is a single scalar standing
//    for ~490 sub-retention occurrences, and the law needs a per-claim value it
//    does not have. Giving the blob one claim's revision would overstate its
//    movement by the diversification it actually has (490 independent draws
//    average out; one does not), and giving it none would understate the
//    cohort's total movement badly, since most of the COUNT lives there. So it
//    keeps exactly what it gets today — `untracked * (factor - 1)` from the
//    cohort lognormal, passed in — and the law reaches the tracked set, which
//    is every occurrence that can ever cede. Named here rather than discovered
//    at the flip.
//
// 2. SEED COHORTS ARE UNCHANGED. A cohort with no register has nothing to
//    revise; processIbner's no-register branch keeps the cohort factor whether
//    the flag is on or off. That is the same honest default as today, where a
//    seed cohort retains its development entire.
// ============================================================================

/** allocateDevelopment's result shape, reproduced so the engine's cession path
 *  consumes this identically. `unallocated` is always 0: a per-claim delta is
 *  applied to the claim that produced it, so nothing can fail to land. */
export interface RevisionAllocation {
  deltas: number[];
  untrackedDelta: number;
  applied: number;
  unallocated: number;
}

/** One tracked occurrence, as this function needs to see it. */
export interface RevisableClaim {
  claimId: string;
  /** The occurrence total now, gross — DevelopingClaim.current. */
  current: number;
}

/**
 * Revise every tracked occurrence of one cohort by one annual step.
 *
 * ⚠ THE MOVEMENT IS A SHARE OF THE COHORT'S OWN REMAINING BALANCE, NOT OF EACH
 * CLAIM'S PATTERN-IMPLIED RESERVE. This is the fix for the ledger crossing and
 * the closure argument is an INEQUALITY, not a claim. Write v_i for the
 * occurrence values, U for `untracked`, R = sum(v_i) + U for the register total,
 * B for `balance` (the cohort's reserve after paydown, before development), and
 * h = B / R. Then with w_i = v_i / R and w_U = U / R, so that sum(w) = 1:
 *
 *     d_i = v_i . h . (f_i - 1) = B . w_i . (f_i - 1)   >=  -B . w_i
 *
 * because every f_i >= 0 — the factor is a lognormal and is strictly positive.
 * Summing over the tracked set and the untracked mass:
 *
 *     sum(d) >= -B . sum(w) = -B      so      B + sum(d) >= 0
 *
 * ⚠ AND THE BOUND SURVIVES CESSION, which is where it has to hold. cedeDevelopment
 * returns the pool's retained share, retained_i = P(v_i + d_i) - P(v_i) for the
 * pool's retained function P, which is non-decreasing with P(0) = 0 and is
 * 1-Lipschitz (the ceded derivative is never negative). So retained_i >= d_i
 * wherever d_i < 0, and retained_i >= 0 wherever d_i >= 0. Hence
 * sum(retained) >= -B and the NET balance cannot cross zero either. Nothing
 * above requires any relationship between the register and netUltimate — which
 * is exactly why the alternative, h = netUnpaid / netUltimate, does NOT close:
 * measured, the register exceeds netUltimate on 89% of cohort-valuations
 * (median 1.31x, p95 2.86x) because the register is GROSS and netUltimate is NET.
 *
 * ⚠ THE SAME h GOES INTO THE FACTOR, AND THAT IS WHAT KEEPS THE DOLLAR SCALE.
 * `revisionStep` divides the magnitude by the headroom to put it on the reserve,
 * so s = phi.m/h, and the delta multiplies by h again: to first order
 * d_i ~ v_i . h . s . Z = v_i . phi . m . Z and the h cancels. Scaling by the
 * cohort's realised balance therefore corrects WHICH reserve the movement is a
 * share of without rescaling how much a claim moves. Passing the pattern's
 * headroom to one and the cohort's to the other would break the cancellation and
 * silently shrink every movement.
 *
 * ⚠ WHAT IT COSTS, STATED: h is smaller than the pattern headroom on an
 * exhausted cohort, so s is correspondingly larger there, and s is already
 * unbounded as headroom falls (see CLAIM_REVISION_SIZE_TREND's note and
 * revision-total-sd-report). This fix makes the reserve arithmetic exact and
 * makes that tail worse. It is a recorded open item, not a surprise.
 *
 * `cohort.untrackedFactor` is the cohort lognormal, applied to the mass that has
 * no claim ids to revise. It is inside the same h and the same weights, so it is
 * inside the bound — under the previous form it was `U . (factor - 1)`, with no
 * headroom scaling at all, and was one of the two ways the balance was overdrawn.
 *
 * ⚠ THE COHORT ARGUMENTS ARE AN OBJECT AND THAT IS NOT STYLE. This function took
 * four bare numbers for one commit, and adding them silently broke
 * revision-persistence-check: every parameter is a `number`, so a caller left on
 * the old order compiled, ran, and reported 0% upward movements against 50%. It
 * was caught in FAST the same run, which is the system working — but a signature
 * where a mis-order is a type error rather than a red gate is the better one.
 */
export interface CohortStep {
  /** The sub-retention mass, gross. It has no claim ids to revise. */
  untracked: number;
  /** The cohort lognormal, applied to that mass. Strictly positive. */
  untrackedFactor: number;
  /** The cohort's own reserve after paydown, before development. The bound. */
  balance: number;
  /** The step about to be taken, 1-based — the cohort's `age + 1`. */
  modelAge: number;
}

export function reviseDevelopingSet(
  gameId: string,
  tracked: RevisableClaim[],
  cohort: CohortStep,
  phi: number = CLAIM_REVISION_PHI,
): RevisionAllocation {
  const { untracked, untrackedFactor, balance, modelAge } = cohort;
  const mass = Math.max(0, untracked);
  const register = tracked.reduce((a, t) => a + Math.max(0, t.current), 0) + mass;
  // Nothing to move, and nothing to move it out of. A non-positive balance is
  // returned untouched rather than developed — the bound above says the balance
  // can never GET there, and if it somehow has, developing it is not the answer.
  if (!(balance > 0) || !(register > 0)) {
    return { deltas: tracked.map(() => 0), untrackedDelta: 0, applied: 0, unallocated: 0 };
  }
  const h = balance / register;
  // The share ALREADY PAID, as the law's headroom convention wants it. h may
  // exceed 1 on a cohort whose register has fallen below its own reserve, and a
  // negative paidShare is the honest reading of that: headroom is h either way,
  // since revisionStep takes 1 - paidShare.
  const paidShare = 1 - h;

  const deltas: number[] = [];
  let applied = 0;
  for (const t of tracked) {
    const factor = revisionFactor(gameId, t.claimId, modelAge, t.current, paidShare, phi);
    const d = Math.max(0, t.current) * h * (factor - 1);
    deltas.push(d);
    applied += d;
  }
  const untrackedDelta = mass * h * (untrackedFactor - 1);
  return { deltas, untrackedDelta, applied: applied + untrackedDelta, unallocated: 0 };
}

/**
 * The settlement movement for occurrences closing at this valuation, on the same
 * basis and inside the same bound.
 *
 * ⚠ THE FACTOR IS ON THE RESERVE, NOT ON THE WHOLE VALUE, AND THAT IS WHAT MAKES
 * "CLOSES AT ZERO" LITERALLY TRUE. A claim settling at factor 0 lands at
 * v.(1 - h) = v.paidShare — its paid to date — rather than at nothing. The
 * previous form was `v.(f - 1)`, i.e. h implicitly 1, which removed a claim's
 * whole carried value from a balance that had only ever held h of it. That was
 * the second of the two overdrafts and it doubled the crossing rate.
 *
 *     d_i = v_i . h . (f_i - 1) >= -v_i . h   for the settling set only,
 *     sum(d) >= -h . sum(v over settling) >= -h . R = -B
 *
 * ⚠ IT RE-OPENS CLAIM_SETTLEMENT_FACTOR.nonZeroScale. That level was solved so
 * E[f] cancels the persistence drift on a WHOLE-VALUE basis. On the reserve basis
 * the expected effect on a claim's value is 1 + h.(E[f] - 1), so the offset is
 * scaled by h and is weaker — and h varies by cohort, so no single scalar
 * cancels the drift exactly any more. See the measurement recorded at
 * CLAIM_SETTLEMENT_FACTOR.
 */
export function settleClosingSet(
  gameId: string,
  tracked: RevisableClaim[],
  settling: readonly boolean[],
  untracked: number,
  balance: number,
  nonZeroScale: number = CLAIM_SETTLEMENT_FACTOR.nonZeroScale,
): RevisionAllocation {
  const mass = Math.max(0, untracked);
  const register = tracked.reduce((a, t) => a + Math.max(0, t.current), 0) + mass;
  if (!(balance > 0) || !(register > 0)) {
    return { deltas: tracked.map(() => 0), untrackedDelta: 0, applied: 0, unallocated: 0 };
  }
  const h = balance / register;
  const deltas: number[] = [];
  let applied = 0;
  tracked.forEach((t, i) => {
    if (!settling[i]) { deltas.push(0); return; }
    const d = Math.max(0, t.current) * h * (settlementFactor(gameId, t.claimId, nonZeroScale) - 1);
    deltas.push(d);
    applied += d;
  });
  return { deltas, untrackedDelta: 0, applied, unallocated: 0 };
}

