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
import type { BenchClaim, DevelopingClaim } from '../types/simulation';

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

// ============================================================================
// ⚠ RESELECTION — THE DEVELOPING SUBSET FOLLOWS CLOSURE, AND THE BENCH IS WHAT
// MAKES A SIZE-WEIGHTED REPLACEMENT POSSIBLE AT ALL.
//
// Claims close now (claimClosure.ts). A closed claim has paid everything it
// will ever pay, so it cannot be the one an accident year's deterioration lands
// on, and a subset frozen at inception ends its life pointing entirely at
// settled files. The alternative to replacing them — letting the set SHRINK —
// leaves a cohort with no open carriers retaining its development ENTIRE, like
// a seed cohort with no register: no cession at all on a cohort that still
// carries an unpaid balance and still develops. Measured before this commit at
// 0.59% of GL cohort-valuations and 0.61% of Property's. That is wrong at any
// rate, so the set is replenished.
//
// ⚠ THE REPLACEMENT IS DRAWN SIZE-WEIGHTED FROM THE OPEN POOL — THE SAME RULE
// AS INCEPTION — AND NOT "THE LARGEST OPEN CLAIM". Two reasons, and the second
// is the one that would have cost money:
//
//   A DIFFERENT REPLACEMENT RULE MAKES THE SET'S COMPOSITION DEPEND ON HOW MANY
//   CLAIMS HAVE CLOSED. Draw one way at inception and another at replacement
//   and the subset drifts toward the replacement rule's preference as the
//   cohort ages — a second-order asymmetry of exactly the kind the free-lunch
//   work removed, arriving through the passage of time instead of through the
//   sign of a movement.
//
//   AND `largest-open` PULLS THE SET TOWARD THE TOP OF THE REMAINING
//   DISTRIBUTION, which is the concentration that raises clamping and spill.
//   The header above already records what always picking the claims the treaty
//   covers does to the cession rate: 83.6% on WC under `largest`.
//
// ⚠ WHY A BENCH RATHER THAN A RULE OVER THE TRACKED SET. "Draw size-weighted
// from the open pool" needs the pool, and by valuation time there isn't one:
// everything not tracked has collapsed into `untrackedTotal`, a single scalar,
// which is precisely what keeps this mechanism inside Ruling 8's storage
// budget. Promoting from the tracked non-carriers instead is not an option —
// tracked is carriers plus the occurrences at or above the retention, of which
// there are 2.6 per WC accident year, 4.8 on GL and 0.4 on Property, and almost
// all of those are carriers already. There is nothing to promote.
//
// So the draw happens at INCEPTION, while the register still exists, and the
// result waits on the cohort. The bench is drawn size-weighted WITHOUT
// REPLACEMENT from the register with the carriers and the tracked occurrences
// already removed, i.e. it is the continuation of the same successive-sampling
// sequence that chose the carriers. Drawing size-weighted from the bench at
// valuation time is therefore a draw from a size-weighted sample of the
// register rather than from the register itself — the honest statement of what
// this buys and what it does not.
//
// ⚠ AND THE BENCH DRAW TAKES ITS OWN STREAM, WHICH IS WHAT KEEPS THE CHANGE
// MEASURABLE. sizeWeighted consumes one draw per pick. Taking the bench's picks
// from `ibner` would move every downstream draw in that stream and re-roll
// every game, so the whole commit would arrive as an indistinguishable mixture
// of mechanism and reseed. The carriers still take their ten picks from `ibner`
// in the same order and the same place, bit for bit; the bench and every
// reselection draw come from streams derived per (seed, accident year,
// valuation year, purpose). The `ibner` stream is untouched by this commit.
//
// ⚠ THE BENCH CAN RUN OUT, AND WHEN IT DOES THE SET SHRINKS. It is a fixed
// depth, so a cohort that closes more carriers than the bench can replace ends
// up short — the shrink case, arriving late instead of immediately. That is a
// bounded, measured cost rather than an argument against the bench:
// development-cession-check counts it.
//
// ⚠ THE DEPTH IS 40 BECAUSE THAT IS WHERE PROPERTY STOPS IMPROVING, and that
// is a fact about the registers rather than a taste. Occurrences per accident
// year, and how many of them are still open at curve age t:
//
//   line        occ/AY   open t2   t3     t4     t6     t8
//   WC           474.7     168.7  118.6   89.0   52.9   34.7
//   GL           315.8     135.7   70.5   34.5    8.3    1.3
//   Property      39.0      10.1    5.2    2.7    0.8    0.1
//
// Property's whole register is 39 occurrences, so a bench of 40 IS the register
// and no deeper bench can help it. Measured over 12 games x 20 years, the share
// of developing cohort-valuations with NO open carrier at all — the shrink
// pathology, where a cohort that still carries an unpaid balance and still
// develops retains its development entire and cedes nothing:
//
//   bench depth        WC       GL   Property    poolState at yr 20
//    0 (shrink)      0.40%   11.24%    27.53%          505.8 KB
//   20               0.00%    6.87%     7.67%          581.2 KB
//   40               0.00%    5.62%     5.21%          610.8 KB   <- THIS
//   80               0.00%    5.15%     5.21%          642.2 KB
//
// Property is FLAT from 40 to 80 because the register is exhausted, not the
// bench: its residual 5.21% is accident years with genuinely nothing open left.
// GL buys 0.47 points for another 31 KB and WC buys nothing. 40 is where the
// curve turns.
//
// ⚠ AND FOR PROPERTY THAT MEANS STORING THE WHOLE REGISTER, which is worth
// saying plainly because it weakens the argument at the top of this file for
// exactly one line. `untrackedTotal` exists so a cohort does not carry ~500
// occurrences; that argument is about WC (475/yr) and GL (316/yr). Property
// writes 39 occurrences a year and was never the case the scalar was protecting
// against.
//
// ============================================================================
// ⚠ RECORDED, NOT FIXED: THE FULLY-CLOSED REGISTER THAT IS STILL UNPAID.
//
// The residual above — accident years with nothing open left to promote — is
// where the next reader meets a state this model does not currently explain,
// so it is written down here rather than left to be rediscovered.
//
// A cohort can reach a valuation with EVERY claim in its register closed while
// the cohort still carries an unpaid balance and still develops. Measured
// before this commit at 0.59% of GL cohort-valuations and 0.61% of Property's,
// with the worst case carrying 19.2% of its ultimate still unpaid on a
// register where every file is settled.
//
// ⚠ IT IS NEITHER REOPENING NOR LATE EMERGENCE. Closure here is monotone by
// construction — a claim closed at one valuation is closed at every later one,
// which is the property claimClosure.ts's fixed per-claim uniform exists to
// guarantee — and there is no late reporting anywhere in the model: the report
// lag went with WC's IBNR and the closure curves were refitted onto a
// no-late-reporting basis precisely so that nothing arrives after inception.
// So neither of the two mechanisms that would explain a settled register still
// owing money is present.
//
// ⚠ IT IS TWO CLOCKS THAT NEVER TALK, and that is by design one level down.
// Payment runs on the payout pattern, in DOLLARS, per cohort. Closure runs on
// the closure curve, in COUNTS, per claim. claimClosure.ts's header sets out
// why they must not be derived from each other — a closed claim has paid
// everything it will pay, an open one has not, and the share of a cohort's
// dollars that has left is not the share of its files that are finished. What
// nothing enforces is the other direction: that the count clock cannot reach
// 100% while the dollar clock is short. Closure by count runs ahead of payment
// by dollars everywhere (GL at age 2: 56.7% of files closed against 31.0% of
// dollars paid), and at the tail that lead occasionally laps it.
//
// NOT FIXED HERE because the fix is a change to one of the two clocks — either
// the closure curve is conditioned on the cohort's paid position, or the payout
// pattern is conditioned on the closed count — and both re-fit calibrated
// parameters that this commit is not touching. Reselection makes the state
// VISIBLE (a set with no open member to promote) where it was previously
// invisible; it does not create it and does not cure it.
// ============================================================================
export const DEVELOPMENT_BENCH_DEPTH = 40;

export interface TrackedSet {
  tracked: DevelopingClaim[];
  /** Gross total of every occurrence NOT tracked. Below the retention by
   *  construction, so it never cedes — carried only for proportional shares.
   *  The bench's dollars are INSIDE this figure and stay there until promotion. */
  untrackedTotal: number;
  /** Replacements in waiting — see the RESELECTION block. */
  bench: BenchClaim[];
}

// Build the tracked set: every occurrence at or above the retention, plus the
// carriers, whichever way those overlap. Then the bench, from what is left.
export function buildTrackedSet(
  line: TowerLine,
  occurrenceIds: string[],
  claimIds: string[],
  totals: number[],
  rule: DevelopmentAllocationRule = DEVELOPMENT_ALLOCATION,
  rng?: SeededRandom,
  benchRng?: SeededRandom,
  benchDepth: number = DEVELOPMENT_BENCH_DEPTH,
): TrackedSet {
  const n = totals.length;
  if (n === 0) return { tracked: [], untrackedTotal: 0, bench: [] };
  const retention = REINSURANCE_TOWER[line][0].attachment;

  // The carriers.
  //
  // ⚠ THIS BLOCK IS UNCHANGED AND MUST STAY UNCHANGED. It takes exactly
  // `rule.claimCount` draws from `rng` in exactly the order it always did. The
  // bench below takes none of them.
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
  const benchPool: { t: number; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (isCarrier.has(i) || totals[i] >= retention) {
      tracked.push({
        claimId: claimIds[i] ?? occurrenceIds[i],
        occurrenceId: occurrenceIds[i],
        drawn: totals[i],
        original: totals[i],
        current: totals[i],
        carrier: isCarrier.has(i),
        closed: false,
      });
    } else {
      untrackedTotal += totals[i];
      // Everything the bench may be drawn from: untracked, therefore below the
      // retention, therefore currently ceding nothing.
      if (totals[i] > 0) benchPool.push({ t: totals[i], i });
    }
  }
  // Carriers first, largest first — the register reads better and the
  // proportional maths does not care about order.
  tracked.sort((a, b) => (Number(b.carrier) - Number(a.carrier)) || (b.drawn - a.drawn));

  // The bench — the same successive size-weighted sampling, on the remainder,
  // from its own stream. `largest` selection gets a `largest` bench for the
  // same reason: the replacement rule has to be the selection rule.
  const bench: BenchClaim[] = [];
  const depth = Math.min(Math.max(0, benchDepth), benchPool.length);
  if (depth > 0) {
    let order: number[];
    if (rule.selection === 'largest') {
      order = benchPool.slice().sort((a, b) => b.t - a.t).slice(0, depth).map(p => p.i);
    } else {
      if (!benchRng) throw new Error('buildTrackedSet: sizeWeighted bench needs a benchRng');
      order = [];
      const pool = benchPool.slice();
      for (let pick = 0; pick < depth && pool.length > 0; pick++) {
        const sum = pool.reduce((s, p) => s + p.t, 0);
        if (sum <= 0) { order.push(pool[0].i); pool.splice(0, 1); continue; }
        let u = benchRng.next() * sum;
        let j = 0;
        for (; j < pool.length - 1; j++) { u -= pool[j].t; if (u <= 0) break; }
        order.push(pool[j].i);
        pool.splice(j, 1);
      }
    }
    for (const i of order) {
      bench.push({
        claimId: claimIds[i] ?? occurrenceIds[i],
        occurrenceId: occurrenceIds[i],
        drawn: totals[i],
        original: totals[i],
        current: totals[i],
      });
    }
  }

  return { tracked, untrackedTotal, bench };
}

export interface ReselectionResult {
  tracked: DevelopingClaim[];
  bench: BenchClaim[];
  untrackedTotal: number;
  /** Carriers that closed at this valuation and stood down. */
  retired: number;
  /** Open occurrences promoted to replace them. */
  promoted: number;
  /** True if the set is below its cap with nothing left open to promote. */
  short: boolean;
  /** ⚠ THE CLAIM IDS THAT JOINED THE REGISTER AT THIS VALUATION, and the caller
   *  needs them for a reason that is not bookkeeping. A promoted occurrence has
   *  ALREADY MOVED — it sat inside the untracked mass while the proportional
   *  unwind pushed that mass up — and none of that movement is in its
   *  `movementByStep`, because nothing was tracking it individually. Differencing
   *  this valuation against its promotion value would leave the series short of
   *  `current - original` by exactly the drift it took while benched, and the
   *  claims workbook asserts that identity per row. See processIbner, which
   *  differences a promoted occurrence against its BOOKED value rather than its
   *  promotion value, so the whole of its history lands in the register at the
   *  valuation it becomes visible in. */
  promotedIds: Set<string>;
}

// ============================================================================
// RESELECT THE DEVELOPING SUBSET — ONCE PER VALUATION, BEFORE EITHER DIRECTION
// MOVES.
//
// ⚠ CALLED ONCE AND THE RESULT USED FOR BOTH STEPS. This is the direct
// successor to "the subset is frozen" and it is the same guard: the stochastic
// step and the unwind must land on the SAME set, identified by claim id, or the
// asymmetric-routing defect returns with the valuation clock standing in for
// the sign. Calling this between the two steps would be the bug.
//
// ⚠ MEMBERSHIP CHANGES ONLY BY CLOSURE. A carrier stands down if and only if it
// has closed; an occurrence joins only if it is open and was not carrying
// before. NO OPEN CARRIER EVER STANDS DOWN — there is no reshuffle, no
// re-ranking, no "best ten now". Between two valuations with no closures the
// set is bit-identical.
//
// ⚠ AND A CLOSED OCCURRENCE STAYS IN THE TRACKED SET. It stops carrying
// development; it does not leave the register. Removing it would push its
// dollars back into `untrackedTotal`, where the proportional paths would move
// them as part of an anonymous mass and its cession position would be lost.
// Everything at or above the retention is still tracked, which is what makes
// cession complete.
//
// `isClosed` is injected rather than imported so this file keeps no dependency
// on the closure curves: the rule here is about membership, not about when a
// claim closes.
// ============================================================================
export function reselectCarriers(
  tracked: DevelopingClaim[],
  bench: BenchClaim[],
  untrackedTotal: number,
  isClosed: (claimId: string, drawn: number) => boolean,
  cap: number,
  rng: SeededRandom,
  selection: ClaimSelection = DEVELOPMENT_ALLOCATION.selection,
): ReselectionResult {
  // 1. STATUS. Closure is monotone, so a claim already flagged stays flagged
  //    without re-deriving; the predicate is pure and agrees anyway.
  let retired = 0;
  const next: DevelopingClaim[] = tracked.map(c => {
    const closed = c.closed === true || isClosed(c.claimId, c.drawn);
    if (closed && c.carrier) retired++;
    const wasFlagged = c.closed === true;
    // A closed occurrence stands down. It keeps its place in the register.
    if (closed === wasFlagged && !(closed && c.carrier)) return c;
    return { ...c, closed, carrier: c.carrier && !closed };
  });

  // 2. The bench sheds its closed members. No dollars move — a benched
  //    occurrence's value lives inside `untrackedTotal` and stays there.
  const openBench = bench.filter(b => !isClosed(b.claimId, b.drawn));

  // 3. Refill to the cap from the open pool: tracked occurrences not currently
  //    carrying, plus the bench. One pool, one rule.
  let untracked = untrackedTotal;
  let promoted = 0;
  const cands: { kind: 'tracked' | 'bench'; idx: number; w: number }[] = [];
  next.forEach((c, i) => {
    if (!c.carrier && c.closed !== true) cands.push({ kind: 'tracked', idx: i, w: Math.max(0, c.current) });
  });
  openBench.forEach((b, i) => cands.push({ kind: 'bench', idx: i, w: Math.max(0, b.current) }));

  const takenBench = new Set<number>();
  const promotedIds = new Set<string>();
  let carrying = next.reduce((s, c) => s + (c.carrier ? 1 : 0), 0);
  while (carrying < cap && cands.length > 0) {
    let pos = 0;
    if (selection === 'largest') {
      for (let j = 1; j < cands.length; j++) if (cands[j].w > cands[pos].w) pos = j;
    } else {
      const sum = cands.reduce((s, c) => s + c.w, 0);
      if (sum <= 0) {
        pos = 0;
      } else {
        let u = rng.next() * sum;
        for (pos = 0; pos < cands.length - 1; pos++) { u -= cands[pos].w; if (u <= 0) break; }
      }
    }
    const pick = cands[pos];
    cands.splice(pos, 1);
    if (pick.kind === 'tracked') {
      next[pick.idx] = { ...next[pick.idx], carrier: true };
    } else {
      const b = openBench[pick.idx];
      takenBench.add(pick.idx);
      // ⚠ THE DOLLARS MOVE OUT OF THE SCALAR AND INTO THE LIST, EXACTLY ONCE.
      // The register total is unchanged by promotion; only where the value is
      // recorded changes.
      untracked -= b.current;
      promotedIds.add(b.claimId);
      next.push({
        claimId: b.claimId,
        occurrenceId: b.occurrenceId,
        drawn: b.drawn,
        original: b.original,
        current: b.current,
        carrier: true,
        closed: false,
      });
    }
    carrying++;
    promoted++;
  }

  return {
    tracked: next,
    bench: openBench.filter((_, i) => !takenBench.has(i)),
    untrackedTotal: Math.max(0, untracked),
    retired,
    promoted,
    short: carrying < cap,
    promotedIds,
  };
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
  //
  // ⚠ AND THE FALLBACK EXCLUDES CLOSED OCCURRENCES, which is the one place
  // closure reaches this function. `carriers` mode falls back to every tracked
  // occurrence when a cohort has none flagged; a set that has been reselected
  // down to nothing is exactly that case, and the fallback would hand the
  // stochastic step to the settled files reselection just stood down. The
  // proportional path deliberately does NOT filter — see processIbner for why
  // the unwind still reaches closed occurrences.
  const carrierIdx = tracked.map((c, i) => [c, i] as const).filter(([c]) => c.carrier).map(([, i]) => i);
  const openIdx = tracked.map((c, i) => [c, i] as const).filter(([c]) => c.closed !== true).map(([, i]) => i);
  const use = mode === 'carriers'
    ? (carrierIdx.length > 0 ? carrierIdx : (openIdx.length > 0 ? openIdx : []))
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
  bench: BenchClaim[];
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
    return { tracked: set.tracked, bench: set.bench, untrackedTotal: set.untrackedTotal, giveBack: 0, markedDown: 0 };
  }
  const { deltas, untrackedDelta, applied } = allocateDevelopment(
    set.tracked, set.untrackedTotal, -biasDollars, 'proportional',
  );
  const { ceded, moved } = cedeDevelopment(line, set.tracked, deltas, untrackedDelta, placed);
  // The bench is inside the untracked mass, so it is marked down by exactly the
  // factor that mass moved by. Booked, not drawn: a benched occurrence promoted
  // in year 4 has to arrive on the register at the value the pool has been
  // carrying it at, or promotion would create dollars.
  const benchFactor = set.untrackedTotal > 0
    ? Math.max(0, set.untrackedTotal + untrackedDelta) / set.untrackedTotal
    : 1;
  return {
    // `original` becomes the BOOKED value — what the pool actually put on its
    // register — while `drawn` keeps what the generator produced. The exhibit
    // shows a pool that booked optimistically holding optimistic CLAIM values,
    // which is the coherence the old shape lacked.
    tracked: moved.map(c => ({ ...c, original: c.current })),
    bench: set.bench.map(b => ({ ...b, original: b.drawn * benchFactor, current: b.drawn * benchFactor })),
    untrackedTotal: Math.max(0, set.untrackedTotal + untrackedDelta),
    giveBack: ceded,          // negative
    markedDown: -applied,
  };
}
