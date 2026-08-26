// ============================================================================
// CLAIM-LEVEL DEVELOPMENT ALLOCATION — which claims a reserve movement lands on.
//
// Reserve development used to move a net reserve BALANCE, so a pool that had
// bought per-occurrence cover was not protected against it: an accident year
// could double in size and the tower would pay nothing, because nothing had
// happened to any claim. Development now lands on CLAIMS, and the tower sees it.
//
// ⚠ THE ALLOCATION RULE IS INVENTED AND IT IS THE CALIBRATION. There is no data
// behind "how many claims take the development". It is a free parameter, and it
// is the single most consequential one in this mechanism — the dollar-weighted
// share of adverse development that CEDES, measured over 60 games x 10 years x
// 3 lines at defaults (scripts/diagnostics/development-cession-size.ts):
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
// constant and not a hardcode: moving it is a calibration decision with a
// bigger effect than most of the loss parameters, and it has to be visible as
// one. Nothing about the model anchors it.
//
// THE DEFAULT IS largest-3, SIZE-WEIGHTED. Three matches "a few claims
// deteriorate" rather than "the whole book restates", and sized beats flat
// because a bigger claim genuinely moves more in dollars than a smaller one.
//
// ⚠ A SIZE-WEIGHTED RANDOM DRAW IS PROBABLY MORE DEFENSIBLE THAN ALWAYS-LARGEST,
// AND IT IS NOT THE DEFAULT. Stated plainly because it is a real reservation and
// not a footnote. `largest` always selects claims that are ALREADY over the
// retention, which is precisely why WC cedes 83.6% — the subset is chosen for
// the property that makes it cede. A real book does not work that way: the claim
// that deteriorates is usually a bad one, but not reliably the three worst, and
// a modest claim that turns catastrophic is the classic case. `sizeWeighted`
// implements that (probability proportional to size, sampled without
// replacement) and lands LOWER, because it sometimes picks claims under the
// retention whose development is retained in full.
//
// It is not the default for one reason only, and it is a process reason rather
// than an actuarial one: it CONSUMES RNG DRAWS, so switching it on moves every
// downstream stream and makes the null test against the pre-mechanism parent
// impossible to read. The playtest should be run on `largest` first so the
// mechanism can be judged against a clean baseline, and `sizeWeighted`
// evaluated straight after as a calibration decision on its own. If the two
// playtests disagree about how the mechanism FEELS, sizeWeighted is the more
// defensible of the two and should win.
// ============================================================================

import type { SeededRandom } from './random';
import { cedeToLayer } from './reinsuranceTower';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import type { DevelopingClaim } from '../types/simulation';

export type ClaimSelection = 'largest' | 'sizeWeighted';
export type DevelopmentWeighting = 'sized' | 'flat';

export interface DevelopmentAllocationRule {
  /** How many of the accident year's occurrences take the development. */
  claimCount: number;
  /** How ADVERSE development splits within the subset. */
  weighting: DevelopmentWeighting;
  /** How the subset is chosen at inception. */
  selection: ClaimSelection;
}

export const DEVELOPMENT_ALLOCATION: DevelopmentAllocationRule = {
  claimCount: 3,
  weighting: 'sized',
  selection: 'largest',
};

// ⚠ THE NULL-TEST SWITCH. False restores the pre-mechanism behaviour exactly:
// development moves the net reserve whole, nothing cedes, and no RNG draw is
// spent on selection. ibner-development-cession-check asserts that this
// reproduces the parent bit-for-bit, which is the only way to know the
// mechanism is the thing that moved the numbers.
export const DEVELOPMENT_CESSION_ENABLED = true;

// Pick the occurrences that will carry this accident year's development, once,
// at inception. FIXED FOR THE COHORT'S LIFE — the same claims keep deteriorating
// rather than a fresh subset each year, which is both how a real book reads and
// what makes "which claims developed" a coherent story in the register.
//
// ⚠ CONSUMES NO RNG UNDER THE DEFAULT. rng is touched only on the sizeWeighted
// branch. Drawing unconditionally would shift every downstream stream for a
// selection that is deterministic anyway.
export function selectDevelopingClaims(
  occurrenceIds: string[],
  claimIds: string[],
  totals: number[],
  rule: DevelopmentAllocationRule = DEVELOPMENT_ALLOCATION,
  rng?: SeededRandom,
): DevelopingClaim[] {
  const n = totals.length;
  if (n === 0 || rule.claimCount <= 0) return [];
  const k = Math.min(rule.claimCount, n);

  let idx: number[];
  if (rule.selection === 'largest') {
    idx = totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i);
  } else {
    // Probability proportional to size, WITHOUT replacement.
    if (!rng) throw new Error('selectDevelopingClaims: sizeWeighted selection needs an rng');
    const pool = totals.map((t, i) => ({ t: Math.max(0, t), i }));
    idx = [];
    for (let pick = 0; pick < k && pool.length > 0; pick++) {
      const sum = pool.reduce((s, p) => s + p.t, 0);
      if (sum <= 0) { idx.push(pool[0].i); pool.splice(0, 1); continue; }
      let u = rng.next() * sum;
      let j = 0;
      for (; j < pool.length - 1; j++) { u -= pool[j].t; if (u <= 0) break; }
      idx.push(pool[j].i);
      pool.splice(j, 1);
    }
  }

  return idx.map(i => ({
    claimId: claimIds[i] ?? occurrenceIds[i],
    occurrenceId: occurrenceIds[i],
    original: totals[i],
    current: totals[i],
  }));
}

export interface AllocationResult {
  /** Per-claim increment, index-aligned to the input. Sums EXACTLY to applied. */
  deltas: number[];
  /** What was actually allocated. Equals the requested amount unless a
   *  favourable movement was larger than the claims had left to give. */
  applied: number;
  /** Requested minus applied — non-zero only in the clamped favourable case. */
  unallocated: number;
}

// Split a development movement across the chosen claims.
//
// ⚠ FAVOURABLE DEVELOPMENT IS ALWAYS ALLOCATED IN PROPORTION TO WHAT IS LEFT,
// WHATEVER THE WEIGHTING SETTING SAYS, AND THAT ASYMMETRY IS DELIBERATE. A flat
// split of a negative movement drives a small claim below zero, which is the
// same shape as the reserve floor that processIbner was rebuilt to remove: the
// floor clipped favourable development while recognising adverse in full, so
// E[incurred] > E[ultimate] and the martingale broke. Proportional-on-remaining
// cannot go negative, for the same reason developing the remaining balance
// cannot. The weighting choice therefore governs ADVERSE development only.
//
// The residual is placed on the last element so the deltas sum to `applied`
// EXACTLY rather than to within float error — the register and the exhibit have
// to agree to the cent.
export function allocateDevelopment(
  claims: DevelopingClaim[],
  amount: number,
  weighting: DevelopmentWeighting = DEVELOPMENT_ALLOCATION.weighting,
): AllocationResult {
  const n = claims.length;
  if (n === 0 || amount === 0) return { deltas: new Array(n).fill(0), applied: 0, unallocated: amount };

  const available = claims.reduce((s, c) => s + Math.max(0, c.current), 0);
  // A favourable movement cannot take away more than the claims hold.
  const applied = amount < 0 ? -Math.min(-amount, available) : amount;
  if (applied === 0) return { deltas: new Array(n).fill(0), applied: 0, unallocated: amount };

  const useSized = applied < 0 || weighting === 'sized';
  const w = claims.map(c => (useSized ? Math.max(0, c.current) : 1));
  const sw = w.reduce((a, b) => a + b, 0);

  const deltas = new Array<number>(n).fill(0);
  if (sw <= 0) {
    deltas[0] = applied;
  } else {
    let acc = 0;
    for (let i = 0; i < n - 1; i++) { deltas[i] = (applied * w[i]) / sw; acc += deltas[i]; }
    deltas[n - 1] = applied - acc;   // exact by construction
  }
  return { deltas, applied, unallocated: amount - applied };
}

export interface DevelopmentCession {
  ceded: number;
  retained: number;
  /** The claims after the movement, with `current` advanced. */
  moved: DevelopingClaim[];
}

// Apply the allocated movement and cede the INCREMENT through the tower.
//
// ⚠ MARGINAL, NOT GROSS. Each occurrence's cession is recomputed at its new
// value and differenced against its old one. Ceding the development as if it
// were a fresh loss would attach every dollar at $0 and hand the pool a recovery
// on movements that never approach the retention.
//
// ⚠ THE DEVELOPED VALUE IS NOT CAPPED, AND THAT IS A RULING RATHER THAN AN
// OVERSIGHT. A WC claim can develop past WC_SEVERITY_CAP — the measurement saw
// $121.16M against an $85M ceiling under largest-1, 1.43x. The cap is a
// statement about the DRAWN SEVERITY DISTRIBUTION, not about how large a claim
// can eventually become once it deteriorates. Capping here would silently
// RETAIN the excess, because the amount above the cap would simply never be
// booked — the pool would lose both the loss and the cover on it.
//
// ⚠ TOWER EXHAUSTION IS CORRECT AND IS NOT COMPENSATED FOR. A claim developing
// past TOWER_TOP cedes 100% of the movement, then less, then nothing — measured
// at 100% / 31.8% / 0.0% over three successive valuations on one WC accident
// year. That is a treaty behaving exactly as written. The excess lands in
// retainedAboveTower, where it is already surfaced.
export function cedeDevelopment(
  line: TowerLine,
  claims: DevelopingClaim[],
  deltas: number[],
  placed: boolean[],
): DevelopmentCession {
  const layers = REINSURANCE_TOWER[line];
  let ceded = 0;
  const moved = claims.map((c, i) => {
    const next = Math.max(0, c.current + deltas[i]);
    layers.forEach((l, li) => {
      if (!placed[li] || !l.purchasable) return;
      ceded += cedeToLayer(next, l.attachment, l.limit) - cedeToLayer(c.current, l.attachment, l.limit);
    });
    return { ...c, current: next };
  });
  const total = deltas.reduce((s, d) => s + d, 0);
  return { ceded, retained: total - ceded, moved };
}
