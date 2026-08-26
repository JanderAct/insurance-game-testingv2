// ============================================================================
// CLAIM-LEVEL DEVELOPMENT ALLOCATION — which claims a reserve movement lands on.
//
// Reserve development used to move a net reserve BALANCE, so a pool that had
// bought per-occurrence cover was not protected against it. Development lands on
// CLAIMS now, and the tower sees it.
//
// ============================================================================
// ⚠ ALLOCATION IS ASYMMETRIC, AND THE ASYMMETRY IS THE MODEL RATHER THAN A
// GUARD AGAINST AN EDGE CASE.
//
//   ADVERSE      -> the CARRIERS. Deterioration is concentrated: one claim
//                   blows up, or a few do. That is what adverse development IS.
//   FAVOURABLE   -> the WHOLE REGISTER, proportionally. Redundancy is diffuse:
//                   many claims settle a little under their estimate. A single
//                   claim collapsing to nothing is not what favourable
//                   development looks like.
//
// A symmetric rule models both as concentrated and only one of them is. It also
// drove the subset to exactly zero 15 times in 4,320 line-years, and a claim at
// zero permanently loses its position above the retention — re-inflating from
// zero, the first dollars back up are retained even though the claim was
// originally above. Spread over ~500 occurrences instead of 3, that vanishes.
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
// ⚠ A SIZE-WEIGHTED RANDOM DRAW IS PROBABLY MORE DEFENSIBLE THAN ALWAYS-LARGEST
// AND IS NOT THE DEFAULT. `largest` always picks claims ALREADY over the
// retention, which is why WC cedes 83.6% — the subset is chosen for the property
// that makes it cede. Not the default because it CONSUMES RNG DRAWS, which moves
// every downstream stream and makes the null test unreadable. Deferred to after
// the playtest, deliberately.
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
  claimCount: 3,
  weighting: 'sized',
  selection: 'largest',
};

// ⚠ THE NULL-TEST SWITCH. False restores the pre-mechanism behaviour exactly:
// no markdown, no cession, development moves the net reserve whole, and no RNG
// draw is spent. Asserted against the parent baseline bit-for-bit.
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

  // A favourable movement cannot take away more than exists. With proportional
  // allocation over the WHOLE register this is essentially unreachable — the
  // whole book would have to vanish in one step — but it is still bounded
  // rather than assumed.
  const pool = mode === 'proportional' ? wholeTotal : trackedTotal;
  const applied = amount < 0 ? -Math.min(-amount, pool) : amount;
  if (applied === 0) return zero;

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
    // ADVERSE, to the carriers. Falls back to every tracked occurrence if this
    // cohort has none flagged, and to the untracked mass if it has nothing
    // tracked at all.
    const idx = tracked.map((c, i) => [c, i] as const).filter(([c]) => c.carrier).map(([, i]) => i);
    const use = idx.length > 0 ? idx : tracked.map((_, i) => i);
    if (use.length === 0) return { deltas, untrackedDelta: applied, applied, unallocated: amount - applied };
    const w = use.map(i => (weighting === 'sized' ? Math.max(0, tracked[i].current) : 1));
    const sw = w.reduce((a, b) => a + b, 0);
    if (sw <= 0) {
      deltas[use[0]] = applied;
    } else {
      let acc = 0;
      for (let j = 0; j < use.length - 1; j++) { deltas[use[j]] = (applied * w[j]) / sw; acc += deltas[use[j]]; }
      deltas[use[use.length - 1]] = applied - acc;   // exact
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
