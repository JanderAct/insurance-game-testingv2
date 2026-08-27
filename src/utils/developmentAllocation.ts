// ============================================================================
// CLAIM-LEVEL DEVELOPMENT ALLOCATION — which claims a reserve movement lands on.
//
// Reserve development used to move a net reserve BALANCE, so a pool that had
// bought per-occurrence cover was not protected against it. Development lands on
// CLAIMS now, and the tower sees it.
//
// ============================================================================
// ⚠ ALLOCATION IS SYMMETRIC. BOTH DIRECTIONS GO TO THE SAME TEN OCCURRENCES,
// SIZE-WEIGHTED, AND THE SYMMETRY IS LOAD-BEARING RATHER THAN TIDY.
//
// ⚠ THE ARGUMENT THAT STOOD HERE WAS "DETERIORATION IS CONCENTRATED, REDUNDANCY
// IS DIFFUSE", and it sent adverse movements to the largest 3 while favourable
// ones spread across the whole register. It is recorded rather than deleted,
// because it is the reason the asymmetry existed and it is weaker than it looked:
//
//   A LARGE CASE RESERVE TAKEN DOWN IS CONCENTRATED FAVOURABLE DEVELOPMENT. That
//   is one of the most ordinary events in a claims department — the reserve on a
//   serious injury is set high, the case settles for a fraction of it, and one
//   claim releases millions. "Redundancy is diffuse" describes attritional
//   redundancy and quietly asserts that the concentrated kind does not happen.
//
// ⚠ AND THE MISMATCH, NOT THE CONCENTRATION, WAS THE DEFECT. Cession is a convex
// function of occurrence size and is SIGN-BLIND: on identical state, +X and -X
// cede at the same rate to within 1.02x. Composing that with an asymmetric
// ROUTING is what manufactured recovery. Adverse dollars were steered onto the
// largest claims — the ones deepest inside placed layers, marginal cession 83.8%
// on WC — while favourable dollars spread across a register that is 56% below the
// attachment and cedes nothing there, marginal give-back 36.7%. Forty-seven
// points of free recovery per dollar of wobble, on a walk with no drift.
//
// Measured at defaults over 450 line-years before this commit: WC's register
// moved $17.7M FAVOURABLE and the reinsurer paid $48.2M.
//
// ⚠ THE GRID SAYS IT IS THE MISMATCH AND NOT THE RULE. Every adverse rule lands
// at 1.04-1.11x once favourable routes the same way, and NO cell reaches 1.00
// with the two sides differing (scripts/diagnostics/allocation-grid.ts):
//
//   adverse        favourable          ratio     WC     recovery at defaults
//   largest-1      proportional        2.15x   2.49x    $115.16M
//   largest-3      proportional        1.85x   2.13x     $87.32M   <- retired here
//   sizeWtd-3      proportional        1.63x   1.79x     $58.59M
//   sizeWtd-10     proportional        1.50x   1.67x     $38.29M
//   largest-3      same-as-adverse     1.06x   1.07x    -$28.26M
//   sizeWtd-10     same-as-adverse     1.04x   1.05x    -$28.16M   <- THIS RULE
//   proportional   proportional        1.01x   1.01x    -$28.95M
//
// Widening the adverse rule alone gets to 1.50x and stops: 3 -> 10 carriers buys
// only 0.13x, because its limit is proportional adverse, which is the bottom row.
//
// ⚠ WHY TEN AND NOT THREE. Ten answers the old objection at the point where it
// is actually true. "A single claim collapsing to nothing" is a real worry for
// one claim and much less of one for ten, and the symmetric rule at ten carriers
// truncated a give-back 9 times against largest-1's 51 — the fewest in the
// family. Three would have been 17.
//
// ⚠ WHY SIZE-WEIGHTED AND NOT LARGEST. `largest` is deterministic, so which
// claims develop is in principle learnable from the register. It also selects
// claims FOR THE PROPERTY THAT MAKES THEM CEDE — always picking occurrences
// already over the retention is why the old rule cedes 83.6% on WC. A
// size-weighted draw keeps deterioration landing on big claims without making it
// a certainty that it lands on the ones the treaty covers.
//
// ⚠ THE ZERO-SUBSET PROBLEM THE ASYMMETRY WAS ALSO GUARDING AGAINST. A symmetric
// rule drove the subset to exactly zero 15 times in 4,320 line-years, and a claim
// at zero permanently loses its position above the retention. That guard is now
// structural rather than incidental: allocateDevelopment bounds a favourable
// movement by the total of the occurrences it will actually land on, and
// size-weights it within them, so no occurrence can be taken below zero at all.
// See THE POOL IS THE OCCURRENCES THAT RECEIVE THE DOLLARS, below.
//
// ⚠ THE TIME MISMATCH IS STILL A MECHANISM AND IS NO LONGER A MEASURABLE ONE.
// The markdown and the unwind are both proportional but applied at DIFFERENT
// TIMES — the markdown once at inception, the unwind spread over the horizon and
// interleaved with stochastic steps — so the shares the unwind restores are not
// the shares the markdown took, and the tower is convex. Recorded here because
// it is the same shape as the direction mismatch one order down and should not
// be rediscovered as new.
//
// This commit was expected to leave it standing and did not. Measured as the
// squeezed-minus-default difference in lifetime development cession, paired on
// (game, line) over 50 games x 20 years (cession-uplift-basis.ts):
//
//   WC   before  +2.4%  95% CI [ 0.6%,  4.1%]   EXCLUDES ZERO
//   WC   after   -0.6%  95% CI [-2.2%,  1.0%]   contains zero
//
// with GL and Property containing zero in both. Symmetric routing shrank it
// below what 50 games can resolve, because the carriers' cession stopped being
// sensitive to WHICH shares moved once both directions move the same ten.
// The mechanism remains; its magnitude does not. Do not chase it without
// re-measuring first.
//
// ⚠ WHAT IS LEFT IS CONVEXITY, AND IT IS NOT A DEFECT. Cession is a convex
// function of occurrence size, so a driftless walk through it has positive
// expected cession by Jensen. That is what an excess-of-loss treaty on a claim
// that is still moving is worth. At defaults, over complete cohort lives:
// WC +4.1%, GL -0.5%, Property -0.1%, pool +0.3% of inception cession — against
// WC +9.9% and pool +2.8% under the retired asymmetric routing. Gated, with the
// limits set above the option value and below the asymmetry.
// ============================================================================
//
// ============================================================================
// ⚠ THE ALLOCATION RULE IS INVENTED AND IT IS THE CALIBRATION, for the ADVERSE
// side. There is no data behind "how many claims take the deterioration". The
// dollar-weighted share of adverse development that CEDES, measured over 60
// games x 10 years x 3 lines (scripts/diagnostics/development-cession-size.ts):
//
//   rule                  WC      GL   Property
//   largest-1          86.3%   72.6%     70.1%
//   largest-3 sized    83.6%   74.5%     52.2%     <- the default
//   largest-3 flat     86.3%   85.2%     38.4%
//   largest-10 sized   67.0%   62.1%     39.1%
//   largest-10 flat    46.7%   52.3%      8.6%
//   all sized          44.8%   47.5%     35.2%
//   all flat            0.5%    1.3%      1.8%
//
// FROM 0.5% TO 86% ON THE SAME EVENTS. That spread is why this is a named
// constant. Nothing in the model anchors it.
//
// ⚠ SIZE-WEIGHTED IS NOW THE DEFAULT, AND ITS DEFERRED COST WAS PAID HERE. It
// CONSUMES RNG DRAWS — one per carrier picked, before this year's horizon and
// stepMultiplier draws — so every downstream draw in the `ibner` stream reseeds
// and a line-by-line null test against the parent baseline is unreadable. The
// stream is derived fresh per (seed, year, line), so the shift cannot accumulate
// across years; it re-aligns every January. How this commit was verified without
// that test is recorded in the commit message and in the mechanism switch below.
// ============================================================================
//
// ============================================================================
// ⚠ ONLY OCCURRENCES THAT CAN EVER AFFECT CESSION ARE TRACKED, AND THAT IS WHAT
// KEEPS PROPORTIONAL ALLOCATION INSIDE RULING 8's STORAGE BUDGET.
//
// Spreading favourable development across the whole register sounds like it
// needs the whole register — ~500 occurrences per WC accident year. It does not.
// An occurrence BELOW the retention cedes nothing, and a favourable movement
// only shrinks it, so it can never begin to cede. Its value is therefore
// irrelevant to every cession this cohort will ever make; only its SHARE of the
// register matters, and one scalar carries that.
//
// So the cohort stores the occurrences at or above the retention, plus the
// carriers, plus `untrackedTotal`. Measured: 2.6 occurrences per WC accident
// year reach the $1M retention, 4.8 on GL, 0.4 on Property, worst case 13.
// A handful of records, and the cession arithmetic is EXACT rather than
// approximated.
// ============================================================================

import type { SeededRandom } from './random';
import { cedeToLayer } from './reinsuranceTower';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import type { DevelopingClaim } from '../types/simulation';

export type ClaimSelection = 'largest' | 'sizeWeighted';
export type DevelopmentWeighting = 'sized' | 'flat';

export interface DevelopmentAllocationRule {
  /** How many occurrences carry ADVERSE development. */
  claimCount: number;
  /** How adverse development splits between the carriers. */
  weighting: DevelopmentWeighting;
  /** How the carriers are chosen at inception. */
  selection: ClaimSelection;
}

export const DEVELOPMENT_ALLOCATION: DevelopmentAllocationRule = {
  claimCount: 10,
  weighting: 'sized',
  selection: 'sizeWeighted',
};

// ⚠ THE NULL-TEST SWITCH, AND IT IS THE ONLY NULL TEST THIS RULE HAS. False
// restores the pre-mechanism behaviour exactly: no markdown, no cession,
// development moves the net reserve whole, and — the part that matters here —
// buildTrackedSet is NOT CALLED, so no RNG draw is spent no matter what
// DEVELOPMENT_ALLOCATION says.
//
// That is what makes it readable when a line-by-line comparison is not. A
// selection change reseeds the `ibner` stream and moves every value in both
// arms, so the parent baseline cannot be compared against. But the OFF path is
// untouched by the selection rule, so flipping this to false must reproduce
// exactly the same fingerprint before and after such a change — and if it does,
// nothing outside the mechanism moved. Do that rather than assuming it.
export const DEVELOPMENT_CESSION_ENABLED = true;

export interface TrackedSet {
  tracked: DevelopingClaim[];
  /** Gross total of every occurrence NOT tracked. Below the retention by
   *  construction, so it never cedes — carried only for proportional shares. */
  untrackedTotal: number;
}

// Build the tracked set: every occurrence at or above the retention, plus the
// carriers, whichever way those overlap.
export function buildTrackedSet(
  line: TowerLine,
  occurrenceIds: string[],
  claimIds: string[],
  totals: number[],
  rule: DevelopmentAllocationRule = DEVELOPMENT_ALLOCATION,
  rng?: SeededRandom,
): TrackedSet {
  const n = totals.length;
  if (n === 0) return { tracked: [], untrackedTotal: 0 };
  const retention = REINSURANCE_TOWER[line][0].attachment;

  // The carriers.
  const k = Math.min(Math.max(0, rule.claimCount), n);
  let carrierIdx: number[];
  if (rule.selection === 'largest') {
    carrierIdx = totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i);
  } else {
    if (!rng) throw new Error('buildTrackedSet: sizeWeighted selection needs an rng');
    const pool = totals.map((t, i) => ({ t: Math.max(0, t), i }));
    carrierIdx = [];
    for (let pick = 0; pick < k && pool.length > 0; pick++) {
      const sum = pool.reduce((s, p) => s + p.t, 0);
      if (sum <= 0) { carrierIdx.push(pool[0].i); pool.splice(0, 1); continue; }
      let u = rng.next() * sum;
      let j = 0;
      for (; j < pool.length - 1; j++) { u -= pool[j].t; if (u <= 0) break; }
      carrierIdx.push(pool[j].i);
      pool.splice(j, 1);
    }
  }
  const isCarrier = new Set(carrierIdx);

  const tracked: DevelopingClaim[] = [];
  let untrackedTotal = 0;
  for (let i = 0; i < n; i++) {
    if (isCarrier.has(i) || totals[i] >= retention) {
      tracked.push({
        claimId: claimIds[i] ?? occurrenceIds[i],
        occurrenceId: occurrenceIds[i],
        drawn: totals[i],
        original: totals[i],
        current: totals[i],
        carrier: isCarrier.has(i),
      });
    } else {
      untrackedTotal += totals[i];
    }
  }
  // Carriers first, largest first — the register reads better and the
  // proportional maths does not care about order.
  tracked.sort((a, b) => (Number(b.carrier) - Number(a.carrier)) || (b.drawn - a.drawn));
  return { tracked, untrackedTotal };
}

export interface AllocationResult {
  /** Per-tracked-occurrence increment. */
  deltas: number[];
  /** The part of the movement that landed on untracked occurrences. Real, in
   *  the reserve, and cedes nothing. */
  untrackedDelta: number;
  /** deltas + untrackedDelta, EXACTLY. */
  applied: number;
  /** Requested minus applied — non-zero only if a favourable movement exceeded
   *  the whole register. */
  unallocated: number;
}

export type AllocationMode = 'carriers' | 'proportional';

// ⚠ THE MODE THE STOCHASTIC STEP USES, IN BOTH DIRECTIONS — exported so that
// processIbner and the sign-symmetry gate cannot disagree about it.
//
// This is not decoration. The gate's whole job is to measure the adverse and
// favourable marginal rates UNDER THE ENGINE'S OWN ROUTING, and it did that by
// hardcoding `carriers` and `proportional`. The moment the engine's routing
// changed, the gate went on measuring the retired one and read 1.78x for a
// mechanism that was symmetric — a gate describing the engine from memory, which
// is the failure mode claimsExport.ts's header already records for the export
// layer. One constant, read in both places.
export const STOCHASTIC_ALLOCATION_MODE: AllocationMode = 'carriers';

// Split a movement.
//
// ⚠ THE MODE IS CHOSEN BY THE CALLER, NOT BY THE SIGN, because processIbner has
// two movements with different characters arriving in the same step: the
// stochastic one (adverse -> carriers, favourable -> proportional) and the
// deterministic unwind, which is ALWAYS proportional because it reverses a
// markdown that was applied proportionally. Inferring the mode from the sign
// here would send the unwind to the carriers and the claims would not return to
// their drawn values.
//
// The residual is placed on the last tracked element so the parts sum to
// `applied` EXACTLY rather than to within float error.
export function allocateDevelopment(
  tracked: DevelopingClaim[],
  untrackedTotal: number,
  amount: number,
  mode: AllocationMode,
  weighting: DevelopmentWeighting = DEVELOPMENT_ALLOCATION.weighting,
): AllocationResult {
  const n = tracked.length;
  const zero = { deltas: new Array<number>(n).fill(0), untrackedDelta: 0, applied: 0, unallocated: amount };
  if (amount === 0) return { ...zero, unallocated: 0 };
  if (n === 0 && untrackedTotal <= 0) return zero;

  const trackedTotal = tracked.reduce((s, c) => s + Math.max(0, c.current), 0);
  const wholeTotal = trackedTotal + Math.max(0, untrackedTotal);

  // ⚠ THE CARRIERS ARE RESOLVED BEFORE THE POOL IS, and the ordering is the fix.
  // Which occurrences receive the dollars decides how many dollars there are to
  // give back, so the bound cannot be computed first.
  const carrierIdx = tracked.map((c, i) => [c, i] as const).filter(([c]) => c.carrier).map(([, i]) => i);
  const use = mode === 'carriers'
    ? (carrierIdx.length > 0 ? carrierIdx : tracked.map((_, i) => i))
    : [];
  const useTotal = use.reduce((s, i) => s + Math.max(0, tracked[i].current), 0);

  // ============================================================================
  // ⚠ THE POOL IS THE OCCURRENCES THAT RECEIVE THE DOLLARS, NOT EVERY TRACKED ONE.
  //
  // This read `mode === 'proportional' ? wholeTotal : trackedTotal`, and in
  // carriers mode that was wrong in both directions at once. The dollars land on
  // the CARRIERS, a subset of `tracked`, so bounding a favourable movement by
  // `trackedTotal` permits one larger than the carriers hold — which drives an
  // individual carrier negative, gets clamped to zero in cedeDevelopment, and
  // loses register dollars the reserve has already counted. Meanwhile the bound
  // is also too SMALL relative to the register, so the untracked mass can never
  // absorb the remainder in this mode.
  //
  // ⚠ IT COULD NOT FIRE BEFORE THIS COMMIT AND FIRES BECAUSE OF IT. Favourable
  // movements never took the carriers branch, so the wrong bound was unreachable
  // — measured at $15.5B latent across 4,258 cohort states, the largest
  // one-sidedness in this file. Routing favourable movements through the same
  // branch as adverse ones is exactly what wakes it, so it is fixed in the same
  // commit that wakes it rather than left as a known hazard.
  //
  // Bounding by `useTotal` and size-weighting within `use` makes a favourable
  // movement unable to take ANY occurrence below zero: each share is
  // proportional to what that occurrence currently holds, and the total is
  // capped at what they hold together. The zero-subset failure the old
  // asymmetry was partly guarding against is therefore structurally impossible
  // now rather than merely improbable.
  // ============================================================================
  // ⚠ AND A FAVOURABLE MOVEMENT LARGER THAN THE CARRIERS SPILLS ONTO THE REST OF
  // THE REGISTER RATHER THAN GOING UNALLOCATED. Capping at `useTotal` and
  // dropping the remainder into `unallocated` would be a one-sided truncation of
  // its own, and the worst-rated kind: `unallocated` reaches the reserve but
  // cedes NOTHING, so that tail would give back at 0% while adverse dollars cede
  // at 80%+. That is the defect this commit exists to remove, reappearing at the
  // boundary. The spill is a boundary condition and not a routing rule — it
  // engages only past the carriers' whole value, so the marginal rate at any
  // ordinary movement is untouched and the +/-X probe reads the same.
  const pool = mode === 'proportional' ? wholeTotal : Math.min(wholeTotal, useTotal + Math.max(0, wholeTotal - useTotal));
  const applied = amount < 0 ? -Math.min(-amount, pool) : amount;
  if (applied === 0) return zero;
  const spill = mode === 'carriers' && applied < 0 ? Math.max(0, -applied - useTotal) : 0;

  const deltas = new Array<number>(n).fill(0);
  let untrackedDelta = 0;

  if (mode === 'proportional') {
    // Every occurrence moves in proportion to what it currently holds, tracked
    // or not. Nothing can go negative: a share of a reduction bounded by the
    // total is bounded by each part.
    if (wholeTotal <= 0) return zero;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      deltas[i] = (applied * Math.max(0, tracked[i].current)) / wholeTotal;
      acc += deltas[i];
    }
    untrackedDelta = applied - acc;   // exact
  } else {
    // TO THE CARRIERS, IN EITHER DIRECTION. Falls back to every tracked
    // occurrence if this cohort has none flagged, and to the untracked mass if
    // it has nothing tracked at all.
    if (use.length === 0) return { deltas, untrackedDelta: applied, applied, unallocated: amount - applied };

    // The part the carriers take. Equal to `applied` unless a favourable movement
    // has spilled past their whole value.
    const onCarriers = applied + spill;

    // ⚠ A FAVOURABLE MOVEMENT IS ALWAYS SIZE-WEIGHTED, WHATEVER `weighting` SAYS,
    // and that is a correctness requirement rather than a preference. A FLAT
    // give-back hands every carrier the same dollars regardless of what it holds,
    // so the smallest one goes negative while the pool bound is still satisfied —
    // the clamp in cedeDevelopment would then swallow the difference. You cannot
    // take $X off a claim holding less than $X. With the default 'sized' the two
    // branches coincide and this changes nothing.
    const w = use.map(i => (weighting === 'sized' || onCarriers < 0 ? Math.max(0, tracked[i].current) : 1));
    const sw = w.reduce((a, b) => a + b, 0);
    if (sw <= 0) {
      deltas[use[0]] = onCarriers;
    } else {
      let acc = 0;
      for (let j = 0; j < use.length - 1; j++) { deltas[use[j]] = (onCarriers * w[j]) / sw; acc += deltas[use[j]]; }
      deltas[use[use.length - 1]] = onCarriers - acc;   // exact
    }

    // The spill, proportionally over everything the carriers are not.
    if (spill > 0) {
      const isUse = new Set(use);
      const restTracked = tracked.map((c, i) => (isUse.has(i) ? 0 : Math.max(0, c.current)));
      const restTotal = restTracked.reduce((a, b) => a + b, 0) + Math.max(0, untrackedTotal);
      if (restTotal > 0) {
        let acc = 0;
        for (let i = 0; i < n; i++) {
          if (isUse.has(i)) continue;
          const d = (-spill * restTracked[i]) / restTotal;
          deltas[i] += d;
          acc += d;
        }
        untrackedDelta = -spill - acc;   // exact
      }
    }
  }

  return { deltas, untrackedDelta, applied, unallocated: amount - applied };
}

export interface DevelopmentCession {
  ceded: number;
  retained: number;
  moved: DevelopingClaim[];
}

// Apply the movement and cede the INCREMENT through the tower.
//
// ⚠ MARGINAL, NOT GROSS. Each occurrence's cession is recomputed at its new
// value and differenced against its old one. Ceding the movement as if it were a
// fresh loss would attach every dollar at $0.
//
// ⚠ THE DEVELOPED VALUE IS NOT CAPPED. A WC claim can develop past
// WC_SEVERITY_CAP. The cap is a statement about the DRAWN severity
// distribution, not about how large a claim can become once it deteriorates,
// and capping here would silently RETAIN the excess.
//
// ⚠ TOWER EXHAUSTION IS CORRECT AND IS NOT COMPENSATED FOR. A claim developing
// past TOWER_TOP cedes 100% of the movement, then less, then nothing. That is a
// treaty behaving as written; the excess lands in retainedAboveTower.
export function cedeDevelopment(
  line: TowerLine,
  tracked: DevelopingClaim[],
  deltas: number[],
  untrackedDelta: number,
  placed: boolean[],
): DevelopmentCession {
  const layers = REINSURANCE_TOWER[line];
  let ceded = 0;
  const moved = tracked.map((c, i) => {
    const next = Math.max(0, c.current + deltas[i]);
    layers.forEach((l, li) => {
      if (!placed[li] || !l.purchasable) return;
      ceded += cedeToLayer(next, l.attachment, l.limit) - cedeToLayer(c.current, l.attachment, l.limit);
    });
    return { ...c, current: next };
  });
  const total = deltas.reduce((s, d) => s + d, 0) + untrackedDelta;
  return { ceded, retained: total - ceded, moved };
}

export interface BookingMarkdown {
  tracked: DevelopingClaim[];
  untrackedTotal: number;
  /** The cession the pool does NOT recognise at inception because it booked the
   *  claims low. Negative — a give-back against the inception recovery. */
  giveBack: number;
  /** Gross dollars removed from the register. */
  markedDown: number;
}

// ============================================================================
// MARK THE REGISTER DOWN FOR AN OPTIMISTIC BOOKING.
//
// ⚠ THIS IS WHAT STOPS UNDERFUNDING FROM BUYING REINSURANCE. Before it, the
// claims were seeded at their FULL DRAWN values while the reserve was booked at
// (1 - bias) of them, so the unwind pushed claims PAST their drawn value instead
// of restoring them TO it, and the extra height cedes. Measured: squeezed
// funding recovered $27.47M more on WC than defaults on the same seeds, 95% CI
// [$21.20M, $33.74M], with every line diverging the same way.
//
// ⚠ AND THE MARKDOWN ALONE DOES NOT FIX IT — the GIVE-BACK is required, and this
// is the part that is easy to miss. Writing the telescoping out:
//
//     total = cede(drawn) + [cede(final) - cede(marked)]
//           = cede(drawn) + cede(drawn) - cede(marked) + lognormal
//
// so squeezed would still exceed defaults by cede(drawn) - cede(marked) — about
// $30M on WC, the same order and the same sign as the divergence being fixed.
// The claims would end in the right place and the cession still would not.
//
// The reason is that inception cession is taken on the DRAWN register while the
// development ledger starts from the MARKED one, so a band of cession is
// recognised twice. Booking optimistically has to mean booking the RECOVERABLE
// optimistically too: the pool gives back cede(drawn) - cede(marked) at
// inception and earns it back as the unwind restores the claims. Then
//
//     total = cede(drawn) + G + (-G) + lognormal = cede(drawn) + lognormal
//
// which carries no reference to the bias at all, in either arm.
//
// ⚠ THE MARKDOWN IS PROPORTIONAL ACROSS THE WHOLE REGISTER, and the unwind must
// reverse it the same way. Sending the unwind to the carriers instead would
// restore three claims past their drawn values while the rest stayed marked
// down — the original defect with extra steps.
// ============================================================================
export function markDownForBooking(
  line: TowerLine,
  set: TrackedSet,
  biasDollars: number,
  placed: boolean[],
): BookingMarkdown {
  if (biasDollars <= 0 || (set.tracked.length === 0 && set.untrackedTotal <= 0)) {
    return { tracked: set.tracked, untrackedTotal: set.untrackedTotal, giveBack: 0, markedDown: 0 };
  }
  const { deltas, untrackedDelta, applied } = allocateDevelopment(
    set.tracked, set.untrackedTotal, -biasDollars, 'proportional',
  );
  const { ceded, moved } = cedeDevelopment(line, set.tracked, deltas, untrackedDelta, placed);
  return {
    // `original` becomes the BOOKED value — what the pool actually put on its
    // register — while `drawn` keeps what the generator produced. The exhibit
    // shows a pool that booked optimistically holding optimistic CLAIM values,
    // which is the coherence the old shape lacked.
    tracked: moved.map(c => ({ ...c, original: c.current })),
    untrackedTotal: Math.max(0, set.untrackedTotal + untrackedDelta),
    giveBack: ceded,          // negative
    markedDown: -applied,
  };
}
