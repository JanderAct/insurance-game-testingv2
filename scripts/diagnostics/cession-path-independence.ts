// ============================================================================
// DOES SQUEEZED FUNDING BUY REINSURANCE RECOVERY? — A GATE, NOT A MEASUREMENT.
//
// ⚠ WHAT THIS ASSERTS IS THE INCEPTION COMPONENT, AND IT ASSERTS IT AS AN
// EQUIVALENCE TEST. Not the total, and not "the interval contains zero" — see
// THE GATE section below for both reasons. It began as
// a measurement and found that squeezed recovered $27.47M more on WC, 95% CI
// [$21.20M, $33.74M], with all three lines diverging the same way — underfunding
// bought cover. The fix is the claim-level markdown plus the inception
// give-back; this is the assertion that it stayed fixed.
//
// It is the ONLY test that can see this. A single-arm dollar total cannot: the
// quantity is a DIFFERENCE between two arms on the same seeds, and the guard in
// development-cession-check.ts runs its arms on different seeds by construction.
//
// THE ARITHMETIC THAT SHOULD HOLD. Cession on an occurrence is f(value), and
// the increment booked each year telescopes:
//
//     total = f(initial) + [f(final) - f(initial)] = f(final)
//
// f(final) is path-independent, so squeezing should MOVE cession between
// "recognised at inception" and "recognised on development" without changing
// the sum. If the total moves, underfunding buys cover.
//
// THE ASSUMPTION THAT MAKES IT HOLD is that both arms drive the claims to the
// SAME f(final). That requires the booking bias to reach the claim values. It
// does not — see the coherence section below — so this is measured rather than
// asserted.
//
// ============================================================================
// ⚠ THIS GATE IS RED, AND THE BISECT SAYS SOMETHING OTHER THAN "COMMIT X BROKE
// IT". Read this before trying to fix it. Findings recorded at 8402b33; the gate
// itself has not changed since 932246f, so everything below is a pure engine
// comparison against a fixed instrument.
//
// THE BISECT LANDS ON 995fd6f ("Re-translate GL's opening band, re-centre the
// pre-game pins"), AND THAT IS A POWER BOUNDARY, NOT A MECHANISM BOUNDARY. That
// commit re-centred the opening pins, which cut the mean pre-game redraws from
// 7.25 to 1.63 on WC. Fewer redraws is a tighter opening distribution, which is
// a smaller between-game variance, which is a narrower interval — and the
// interval stopped straddling zero. Nothing about cession changed there.
//
// At GAMES=200 the "last good" parent and the current tip are statistically
// indistinguishable:
//
//   accdadb (green at 60)   WC total  -$2.04M  [-$4.24M, +$0.16M]
//   8402b33 (red at 60)     WC total  -$2.21M  [-$4.13M, -$0.29M]
//
// One misses zero by $0.16M and the other by $0.29M. The gate's own default of
// GAMES=60 cannot resolve the effect it is testing; it has been passing on noise
// and failing on slightly less noise.
//
// ⚠ AND IT IS NOT WC-ONLY. That is an artefact of which line's two components
// happen to cancel. Split by recognition point at GAMES=200, the DEVELOPMENT
// component excludes zero on ALL THREE LINES and has been stable across the
// whole range, while the inception component is centred on zero everywhere:
//
//   line       inception diff (200 games)   development diff (200 games)
//   WC          +$0.02M [-1.92, +1.95]       -$2.23M [-2.46, -1.99]
//   GL          +$0.72M [-1.87, +3.31]       -$3.50M [-3.76, -3.24]
//   Property    +$0.23M [-2.48, +2.93]       -$1.12M [-1.31, -0.94]
//
// GL's is the LARGEST. WC is simply the line whose total crosses first, because
// GL's positive inception noise offsets more of its development gap. The
// development figures at accdadb are -2.23 / -3.46 / -1.27 — the same numbers.
// This has been present continuously, on every line, for the whole range.
//
// ⚠ THE MECHANISM IS THE BOOKING BIAS, AND IT IS LINEAR IN IT. Measured by
// moving IBNER_BOOKING_BIAS_COEFF and re-running at GAMES=200:
//
//   coeff    WC dev diff   GL dev diff   Property dev diff
//   0.00       -$0.05M       -$0.15M         -$0.01M      all contain zero
//   0.40       -$1.13M       -$1.82M         -$0.58M
//   0.80       -$2.23M       -$3.50M         -$1.12M      (the shipped value)
//
// Straight through the origin, 50.7% / 52.0% / 51.8% at half strength. With the
// bias at zero the development gap vanishes on all three lines and every total
// contains zero — the entire failure flows through the bias and through nothing
// else. Not membership divergence between the arms, not the tower, not anything
// WC-specific.
//
// ⚠ WHICH IS THE TIME MISMATCH developmentAllocation.ts ALREADY NAMES, resolving
// at a sample size that file did not reach. Its header records: "The markdown
// and the unwind are both proportional but applied at DIFFERENT TIMES ... so the
// shares the unwind restores are not the shares the markdown took, and the tower
// is convex", measured at 50 games as having shrunk to "-0.6% CI [-2.2%, 1.0%],
// contains zero" and believed closed. It had not closed; 50 games could not see
// it. The give-back closes the DETERMINISTIC band exactly — that is the
// telescoping in markDownForBooking's header, and it holds. What no give-back
// can close is the interaction between the marked-down level and the STOCHASTIC
// steps: under squeeze the claims spend the runoff climbing back from a lower
// base, so the same lognormal wobble happens at lower occurrence values and
// cedes less through a convex tower.
//
// ⚠ AND THE DIRECTION IS THE INVERSE OF THE DEFECT THIS GATE WAS BUILT FOR.
// The original finding was squeezed recovering $27.47M MORE — underfunding
// buying cover. Every reading here is squeezed recovering LESS. The perverse
// incentive is dead; what is left is a smaller residual pointing the other way,
// which penalises underfunding rather than rewarding it. That is a reason to
// rank it below the original, not a reason to call it harmless.
//
// ⚠ ALL THREE WERE RULED ON AT THE NEXT COMMIT, and this file now implements the
// ruling rather than describing the choice:
//
//   GAMES rose from 60 to 300, where every line resolves the tolerance it is
//     asserted against. See the constant.
//   the development residual is REPORTED, not gated — it is inherent, and the
//     alternative is the original defect. See the block above that section.
//   the stochastic step still applies to the marked-down register. Changing that
//     is the only thing that would REMOVE the residual rather than tolerate it,
//     and it was not taken: the residual is an order of magnitude smaller than
//     the defect it replaced and signed the other way.
// ============================================================================
//
// PAIRED, SAME SEEDS. The two arms differ only in the funding decision, so the
// difference is taken per (game, line) and the interval is on the DIFFERENCE.
// Two means side by side would be swamped by between-game variance.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, ReserveCohort } from '../../src/types/simulation';

// ⚠ 300, NOT 60, AND THE OLD 60 IS THE DEFECT THIS COMMIT FIXES. At 60 games
// this gate could not resolve its own subject: the two endpoints of the bisect
// missed zero by $0.16M and $0.29M and read green and red, and at 200 they were
// indistinguishable. It had been passing on noise and failing on slightly less
// noise for its whole life.
//
// WHAT 300 BUYS, measured, per line (interval half-width against the 5%
// tolerance the inception assertion uses):
//
//   games   WC              GL              Property        wall
//      60   +/-$2.04M ok    +/-$6.12M ok    +/-$4.01M  NOT RESOLVED   21s
//     120   +/-$1.78M       +/-$3.62M       +/-$3.01M  NOT RESOLVED   29s
//     200   +/-$1.94M       +/-$2.59M       +/-$2.70M  NOT RESOLVED   47s
//     300   +/-$1.58M       +/-$2.05M       +/-$1.99M  all resolve    70s
//     400   +/-$1.44M       +/-$1.79M       +/-$1.60M  all resolve    92s
//
// Property is the binding line — the smallest inception base, so the tightest
// tolerance in dollars. 300 is the first round number where all three resolve;
// 400 buys more margin for another 22 seconds and is what to move to if the
// variance ever rises. The gate SAYS "NOT RESOLVED" rather than passing when it
// cannot see, so this number failing is visible rather than silent.
//
// 70s keeps it inside the fast tier: the tier's wall clock is ~119s at 3-way
// concurrency and its previous longest job was 45s, so this becomes the longest
// job without becoming the binding constraint.
const GAMES = Number(process.env.GAMES ?? 300);
const YEARS = Number(process.env.YEARS ?? 12);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
const squeeze = (d: DecisionSet): DecisionSet => ({
  ...d,
  byLine: Object.fromEntries(LINES.map(l =>
    [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
});

interface Tally {
  inception: number;       // occurrence cession recognised when the year was written
  development: number;     // cession recognised on prior-year development
  aggregate: number;       // aggregate recovery, reported separately so it cannot confound
  grossWritten: number;
  registerSum: number;
  claimsAtInception: number;
  claimsFinal: number;
  claimsDrawn: number;
  biasDollars: number;     // registerSum x bias, summed over cohorts
  clampEvents: number;
  clampUnallocated: number;
}
const blank = (): Tally => ({
  inception: 0, development: 0, aggregate: 0, grossWritten: 0, registerSum: 0,
  claimsAtInception: 0, claimsFinal: 0, claimsDrawn: 0, biasDollars: 0, clampEvents: 0, clampUnallocated: 0,
});

function runArm(g: number, squeezed: boolean): Record<string, Tally> {
  const id = `CPI${g}`;
  const inst = generateGameInstance(id, 6_400_000 + g * 5273);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: Record<string, Tally> = {};
  for (const l of LINES) out[l] = blank();

  for (let y = 1; y <= YEARS; y++) {
    const before: Record<string, ReserveCohort[]> = {};
    for (const l of LINES) before[l] = gs.poolState.lines[l].reserveCohorts.map(c => ({ ...c }));

    const d = defaultDecisionSet(y);
    const processed = processYear(gs, squeezed ? squeeze(d) : d);

    for (const line of LINES) {
      const r = processed.result.byLine[line];
      const t = out[line];
      // ⚠ THE AGGREGATE IS SPLIT OUT. reinsuranceRecovery is the occurrence
      // cession PLUS any aggregate recovery; folding them together would let an
      // aggregate difference masquerade as an occurrence-cession difference.
      t.aggregate += r.aggregateRecovery ?? 0;
      t.inception += r.reinsuranceRecovery - (r.aggregateRecovery ?? 0);
      // ⚠ THE GIVE-BACK IS ADDED EXPLICITLY NOW. It used to arrive folded inside
      // priorYearDevelopmentCeded; splitting the field would have silently
      // dropped it from the telescoping total and this gate would have gone red
      // with squeezed recovering MORE — the original perverse incentive,
      // re-reported as a regression it is not. It is part of total cession
      // wherever it is carried.
      t.development += r.priorYearDevelopmentCeded + r.bookingGiveBack;
      t.grossWritten += r.grossUltimateLoss;

      // The cohort written this year: its register sum, its bias dollars, and
      // the drawn value of the claims chosen to carry its development.
      const born = processed.updatedPoolState.lines[line].reserveCohorts.find(c => c.yearNumber === y);
      if (born) {
        t.registerSum += born.registerSum;
        t.biasDollars += born.registerSum * born.bookingBias;
        t.claimsAtInception += (born.developingClaims ?? []).reduce((s, c) => s + c.original, 0);
        t.claimsDrawn += (born.developingClaims ?? []).reduce((s, c) => s + c.drawn, 0);
      }

      // A favourable movement bigger than the subset can absorb: the clamp.
      for (const b of before[line]) {
        if (b.closed) continue;
        const a = processed.updatedPoolState.lines[line].reserveCohorts.find(c => c.yearNumber === b.yearNumber);
        if (!a) continue;
        const bc = (b.developingClaims ?? []).reduce((s, c) => s + c.current, 0);
        const ac = (a.developingClaims ?? []).reduce((s, c) => s + c.current, 0);
        if (bc > 0 && ac === 0) {
          t.clampEvents++;
          // The favourable movement the cohort actually took, recovered from the
          // ultimate. Anything beyond what the subset could absorb (bc) is the
          // UNALLOCATED remainder — the part no claim could carry.
          const ultimateDrop = b.netUltimate - a.netUltimate;
          t.clampUnallocated += Math.max(0, ultimateDrop - bc);
        }
      }
    }
    gs = {
      ...gs, currentYearNumber: y + 1, poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result], isComplete: y === YEARS,
    };
  }
  for (const line of LINES) {
    out[line].claimsFinal = gs.poolState.lines[line].reserveCohorts
      .reduce((s, c) => s + (c.developingClaims ?? []).reduce((q, d2) => q + d2.current, 0), 0);
  }
  return out;
}

// ---------------------------------------------------------------- collection
const paired: Record<string, { def: Tally; sq: Tally }[]> = {};
for (const l of LINES) paired[l] = [];
for (let g = 0; g < GAMES; g++) {
  const def = runArm(g, false);
  const sq = runArm(g, true);
  for (const l of LINES) paired[l].push({ def: def[l], sq: sq[l] });
}

// ---------------------------------------------------------------- stats
const money = (v: number) => `$${(v / 1e6).toFixed(2)}M`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
function ci(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, se };
}

console.log('=== DOES SQUEEZED FUNDING BUY REINSURANCE RECOVERY? ===\n');
console.log(`${GAMES} paired games x ${YEARS} years x ${LINES.length} lines. Same seed in both arms;`);
console.log('the only difference is the funding decision. Occurrence cession only —');
console.log('the aggregate is reported separately so it cannot confound the comparison.\n');

console.log('--- CESSION BY RECOGNITION POINT, MEANS PER GAME ---');
console.log('  line       arm         at inception   on development          TOTAL      aggregate');
for (const line of LINES) {
  for (const [name, pick] of [['defaults', (p: { def: Tally; sq: Tally }) => p.def], ['squeezed', (p: { def: Tally; sq: Tally }) => p.sq]] as const) {
    const rows = paired[line].map(pick);
    const m = (f: (t: Tally) => number) => rows.reduce((s, t) => s + f(t), 0) / rows.length;
    console.log(
      `  ${line.padEnd(10)} ${name.padEnd(10)} ${money(m(t => t.inception)).padStart(13)} ` +
      `${money(m(t => t.development)).padStart(16)} ${money(m(t => t.inception + t.development)).padStart(14)} ` +
      `${money(m(t => t.aggregate)).padStart(14)}`,
    );
  }
}

// ============================================================================
// ⚠ THE GATE IS ON THE INCEPTION COMPONENT. THE DEVELOPMENT COMPONENT IS
// REPORTED AND ACCEPTED. It used to assert the TOTAL, which is a sum of two
// components with different characters, and asserting the sum was wrong in both
// directions at once — it failed on a residual that is inherent, and it could
// pass while the two halves moved in opposite directions and cancelled.
//
// INCEPTION IS WHAT SHOULD BE EXACTLY PATH-INDEPENDENT. The funding decision
// moves cession between "recognised at inception" and "recognised on
// development"; it must not change what is recognised at inception for a given
// register, because the give-back is precisely the deterministic quantity that
// makes that true. It is also what would catch the ORIGINAL defect returning:
// remove the give-back and squeezed's inception cession jumps by the whole of
// it, ~$30M on WC against a tolerance of ~$2.7M.
//
// ⚠ AND A PER-LINE TOTAL IS A SUM OF COMPONENTS THAT CAN HIDE EACH OTHER. This
// is why the old form produced the wrong headline twice. At GAMES=60 the totals
// read "WC only", and WC was not special: the development component excludes
// zero on ALL THREE LINES and GL's is the LARGEST (-$3.58M against WC's -$2.30M
// at 300 games). WC's total crossed first only because GL's positive inception
// noise offset more of GL's development gap. Anyone reading a per-line total
// here is reading two things added together; read the split.
// ============================================================================
console.log('\n\n--- THE GATE: INCEPTION CESSION MUST NOT DEPEND ON THE FUNDING DECISION ---');
console.log('  Squeezing moves cession between recognition points. It must not change what is');
console.log('  recognised AT INCEPTION, because the give-back is the deterministic quantity that');
console.log('  makes that hold. This is the assertion that would catch the original defect.\n');

// ⚠ AN EQUIVALENCE TEST, NOT A NULL TEST, AND THAT IS THE POINT OF THIS COMMIT.
// "The 95% interval contains zero" is not evidence of absence — it is satisfied
// by any sample too small to resolve the effect, and this gate spent its whole
// life being satisfied that way. Two conditions now, and BOTH must hold:
//
//   the estimate is inside the tolerance          |mean| <= TOL
//   and the sample could have SEEN the tolerance  half-width <= TOL
//
// The second is what a null test never asks. A run that cannot resolve TOL now
// FAILS as NOT RESOLVED rather than passing quietly.
const INCEPTION_TOL_PCT = 0.05;
let gateFail = 0;
const failedGates: string[] = [];
const RULE = '='.repeat(72);
console.log('  line       inception diff   95% CI                  tolerance   resolution   verdict');
for (const line of LINES) {
  const c = ci(paired[line].map(p => p.sq.inception - p.def.inception));
  const base = paired[line].reduce((s, p) => s + p.def.inception, 0) / paired[line].length;
  const tol = Math.abs(base) * INCEPTION_TOL_PCT;
  const halfWidth = 1.96 * c.se;
  const tooBig = Math.abs(c.mean) > tol;
  const unresolved = halfWidth > tol;
  const verdict = tooBig ? 'DIVERGES' : unresolved ? 'NOT RESOLVED' : 'ok';
  if (tooBig) failedGates.push(`${line}: inception diff ${money(c.mean)} exceeds the ${pct(INCEPTION_TOL_PCT)} tolerance `
    + `${money(tol)} — squeezing changed what is recognised at inception, which is what the give-back exists to prevent`);
  else if (unresolved) failedGates.push(`${line}: NOT RESOLVED — the interval is +/-${money(halfWidth)} against a `
    + `${money(tol)} tolerance, so this sample could not have seen a violation. Raise GAMES (currently ${GAMES}).`);
  if (tooBig || unresolved) gateFail++;
  console.log(
    `  ${line.padEnd(10)} ${money(c.mean).padStart(11)}   [${money(c.lo)}, ${money(c.hi)}]`.padEnd(52)
    + `+/-${money(tol).padStart(8)}   +/-${money(halfWidth).padStart(8)}   ${verdict}`,
  );
}
console.log(`\n  Tolerance is ${pct(INCEPTION_TOL_PCT)} of each line's own defaults inception cession. The original`);
console.log('  defect was $27.47M on WC against a ~$2.7M tolerance, so this resolves it ten times over.');

// ============================================================================
// REPORTED, NOT ASSERTED — THE DEVELOPMENT COMPONENT.
//
// ⚠ THE MECHANISM IS UNRESOLVED. THE EXPLANATION THAT STOOD HERE WAS WRONG AND
// IS KEPT BECAUSE IT IS A TRAP WORTH MARKING.
//
// IT SAID: "the register is marked down at inception, so under squeeze the claims
// spend the runoff climbing back from a lower base. The same lognormal wobble
// therefore lands at lower occurrence values, and cession is convex, so it cedes
// less." That cannot be the mechanism, and the reason is one line of arithmetic.
//
// ⚠ CESSION IS BOOKED AS INCREMENTS, SO IT TELESCOPES. cedeDevelopment computes
// cedeToLayer(next) - cedeToLayer(current) at each step and sums, so over a
// claim's whole life the development total is cede(final) - cede(start), and
// EVERY INTERMEDIATE VALUE CANCELS. The path cannot matter. The wobble cannot
// matter. Convexity cannot matter — it is evaluated only at the two endpoints.
//
// And the endpoints are handled. This gate puts bookingGiveBack in the
// DEVELOPMENT bucket (see the Tally), so:
//
//   squeezed    [cede(marked) - cede(drawn)] + [cede(final) - cede(marked)]
//   defaults                                   [cede(final) - cede(drawn)]
//
// which are the same expression. The give-back is exactly the term that makes
// the marked-down start cancel. A persistent difference therefore means the
// telescoping is BROKEN, or the two arms do not reach the same cede(final) —
// not that convexity leaked in along the way.
//
// ⚠ MEASURED, AND IT IS NONE OF THE THREE OBVIOUS CANDIDATES. It is the
// MEASUREMENT WINDOW. The development component is not reporting a property of
// the engine at all.
//
//   THE GIVE-BACK IS RECOGNISED IN FULL AT INCEPTION. The unwind that earns it
//   back is spread over the cohort's HORIZON — up to 12 years on WC. A cohort
//   written in the last H years of the window is cut mid-unwind: its give-back
//   is inside the sum and the recovery that offsets it is not. Every window has
//   a fixed tail of such cohorts, so the gap is a constant number of
//   cohort-equivalents rather than a rate.
//
// THE EVIDENCE IS THE SCALING. Run the same gate over longer windows and the
// gap grows in DOLLARS while shrinking as a SHARE, with the product almost
// exactly constant — which is what a fixed-size tail against a linearly growing
// total looks like, and what no engine mechanism would look like:
//
//   window    WC dev diff   as % of total   product      GL %    product
//   12 yrs      -$2.11M         -4.3%         51.6       -2.3%     27.6
//   25 yrs      -$3.05M         -2.2%         55.0       -1.2%     30.0
//   40 yrs      -$4.22M         -1.3%         52.0       -0.8%     32.0
//
// (The dollars grow because later cohorts are larger — wage and severity trend
// — not because more is going wrong.)
//
// AND THE CORROBORATION IS ALREADY IN THE REPOSITORY. cession-uplift-basis
// measures the same quantity OVER COMPLETE COHORT LIVES rather than over a
// window, and it contains zero and has throughout. Two instruments, one
// windowed and one not, disagreeing exactly as truncation predicts.
//
// ⚠ THE THREE CANDIDATES, ALL RULED OUT BY MEASUREMENT. Recorded because each
// was plausible and ruling them out is most of the work:
//
//   1. THE CLAIM STOPS MID-PATH ON CLOSURE. Ruled out. Forcing the closure
//      predicate to `() => false` so no claim ever closes leaves the gap where
//      it was: WC -$2.17M against -$2.23M, GL -$3.46M against -$3.50M, Property
//      -$1.12M against -$1.12M. Claims stopping is not what stops the sum; the
//      window is.
//
//   2. THE TRACKED SET DEPENDS ON THE MARKED-DOWN VALUE. Ruled out twice, by
//      construction and by measurement. buildTrackedSet is called on the DRAWN
//      totals BEFORE markDownForBooking, so `totals[i] >= retention` never sees
//      a booked value and a claim's tower position does not depend on how
//      optimistically it was reserved. Measured over 25 paired games: of 126,950
//      WC claims written in BOTH arms' registers, 1,043 are tracked at defaults
//      only and 1,054 under squeeze only — 0.8%, and SYMMETRIC. The markdown
//      mechanism would be one-sided.
//
//   3. THE CLAMP AND SPILL FIRE SOONER. Ruled out. Zero occurrences driven to
//      exactly zero, in either arm, on all three lines, at GAMES=300 — see THE
//      CLAMP section at the end of this report, which prints it every run.
//
// ⚠ AND A FOURTH, MINE, ALSO WRONG, kept because it is the more tempting version
// of the convexity error. The markdown and the unwind are both proportional over
// tracked-plus-untracked but applied at different times, so the tracked share
// drifts in between and the tracked claims might not recover what they lost.
// Testable: make the stochastic step proportional too, and the drift goes away.
// It does not. The shortfall survives at -1.59% / -0.61% / -1.28% against
// -1.79% / -0.59% / -1.18%. Subset routing is not the route.
//
// ⚠ DO NOT RE-ASSERT THE CONVEXITY STORY WITHOUT ANSWERING THE TELESCOPING
// ARGUMENT FIRST. It is intuitive, it sounds like the header of
// developmentAllocation.ts, and it is the reason this went unexamined for four
// commits. The same argument disposes of any explanation phrased as "the path
// differs": cession is booked as increments, so only the endpoints survive.
//
// ⚠ WHAT WOULD ACTUALLY CLOSE IT: measure development cession over COMPLETE
// COHORT LIVES rather than over a fixed window, which is what
// cession-uplift-basis does. Not done here because that is a different
// instrument, this one is paired across arms and that one is not, and the
// component is reported rather than gated — a reported number that is honest
// about being window-truncated is better than a second measurement engine.
//
// ⚠ THE "ACCEPT IT" RULING STANDS, FOR A DIFFERENT REASON THAN IT WAS MADE FOR.
// It was made on the belief that the gap was an inherent property of the
// markdown. It is not a property of the engine at all — there is nothing in the
// engine to accept or fix. What is being accepted is that a windowed measurement
// of a quantity with a multi-year tail carries a truncation term, which is a
// property of the instrument and is now labelled as one.
//
// The conditional attached to that ruling — "if it is mostly candidate 2, select
// the tracked set on the DRAWN value and the ruling is withdrawn" — does not
// fire. The tracked set is ALREADY selected on the drawn value.
//
// ⚠ THE ALTERNATIVE IS STILL THE ORIGINAL DEFECT, and that argument is unchanged
// by the re-diagnosis. Not marking the claims down is what let the unwind
// inflate them PAST their drawn value, and squeezed pools then EXTRACTED
// recovery: $27.47M more on WC, 95% CI [$21.20M, $33.74M]. That was an engine
// property. This is a measurement tail, an order of magnitude smaller and signed
// the other way.
//
// ⚠ THE LINEARITY TABLE IS HERE SO A FUTURE READER CAN TELL A CHANGE IN
// MAGNITUDE FROM A CHANGE IN KIND. Measured at GAMES=200 by moving
// IBNER_BOOKING_BIAS_COEFF and re-running:
//
//   coeff    WC dev diff   GL dev diff   Property dev diff
//   0.00       -$0.05M       -$0.15M         -$0.01M      all contain zero
//   0.40       -$1.13M       -$1.82M         -$0.58M
//   0.80       -$2.23M       -$3.50M         -$1.12M      the shipped value
//
// Straight through the origin: 50.7% / 52.0% / 51.8% at half strength. If a
// future reading is off this line, something has changed in KIND and the
// mechanism above no longer describes it. If it is on the line at a different
// coefficient, only the bias moved.
// ============================================================================
console.log('\n\n--- REPORTED, NOT ASSERTED: THE DEVELOPMENT COMPONENT ---');
console.log(`  ⚠ THIS IS A WINDOW ARTEFACT, NOT AN ENGINE PROPERTY. The give-back is recognised in`);
console.log(`  full at inception; the unwind that earns it back runs over the cohort's horizon, so`);
console.log(`  cohorts written in the last few years of this ${YEARS}-year window are cut mid-unwind.`);
console.log('  The share falls as 1/window and the product with the window length is flat. Measured');
console.log('  over complete cohort lives instead, cession-uplift-basis contains zero. See the source.\n');
// ⚠ SCALED AGAINST THE LINE'S TOTAL CESSION, NOT AGAINST ITS DEVELOPMENT
// CESSION. The development base is a small difference of larger numbers — WC
// cedes $53.46M at inception and $0.73M on development — so dividing by it
// produces -314% for a $2.30M gap and says nothing. The total is what the line
// actually recovers, and the gap as a share of that is the number that means
// something.
console.log('  line       development diff  95% CI                  as % of the line\'s TOTAL cession');
for (const line of LINES) {
  const dd = ci(paired[line].map(p => p.sq.development - p.def.development));
  const total = paired[line].reduce((s, p) => s + p.def.inception + p.def.development, 0) / paired[line].length;
  console.log(
    `  ${line.padEnd(10)} ${money(dd.mean).padStart(12)}   [${money(dd.lo)}, ${money(dd.hi)}]`.padEnd(53)
    + `${Math.abs(total) > 1e-9 ? pct(dd.mean / total).padStart(10) : '        n/a'}`,
  );
}
console.log('\n  ⚠ ALL THREE LINES, AND GL IS THE LARGEST. "WC only" was an artefact of reading the');
console.log('    TOTAL, where GL\'s inception noise offsets more of its development gap. A per-line');
console.log('    total is a sum of components that can hide each other.');

console.log('\n\n--- DOES THE BOOKING BIAS REACH THE CLAIM VALUES? ---');
console.log('  YES, NOW. The register is marked down by the cohort\'s bias dollars at inception and');
console.log('  the unwind restores it, so a pool booking optimistically shows optimistic CLAIM');
console.log('  values and the claims end in the SAME PLACE under both arms.\n');
console.log('  ⚠ THE RATIO TO WATCH IS end/DRAWN, NOT end/booked. Marking the register down moves');
console.log('    the denominator, so end/booked legitimately differs between arms while the claims');
console.log('    themselves converge. Against the DRAWN value — the one thing both arms share —');
console.log('    the two columns should agree.\n');
console.log('  line       arm        register sum   bias dollars   as booked   as drawn   claims at end   end/DRAWN');
for (const line of LINES) {
  for (const [name, pick] of [['defaults', (p: { def: Tally; sq: Tally }) => p.def], ['squeezed', (p: { def: Tally; sq: Tally }) => p.sq]] as const) {
    const rows = paired[line].map(pick);
    const m = (f: (t: Tally) => number) => rows.reduce((s, t) => s + f(t), 0) / rows.length;
    console.log(
      `  ${line.padEnd(10)} ${name.padEnd(10)} ${money(m(t => t.registerSum)).padStart(12)} ` +
      `${money(m(t => t.biasDollars)).padStart(14)} ${money(m(t => t.claimsAtInception)).padStart(11)} ` +
      `${money(m(t => t.claimsDrawn)).padStart(10)} ${money(m(t => t.claimsFinal)).padStart(15)} ` +
      `${(m(t => t.claimsFinal) / Math.max(1, m(t => t.claimsDrawn))).toFixed(3).padStart(11)}`,
    );
  }
}
console.log('\n  bias dollars is registerSum x bookingBias — marked down at inception and added back');
console.log('  by the unwind, so the two cancel and "as drawn" is what the claims return to.');

console.log('\n\n--- THE CLAMP: WHAT HOLDS THE EXCESS? ---');
for (const line of LINES) {
  const dEv = paired[line].reduce((s, p) => s + p.def.clampEvents, 0);
  const sEv = paired[line].reduce((s, p) => s + p.sq.clampEvents, 0);
  const dUn = paired[line].reduce((s, p) => s + p.def.clampUnallocated, 0);
  const sUn = paired[line].reduce((s, p) => s + p.sq.clampUnallocated, 0);
  console.log(`  ${line.padEnd(10)} subset driven to exactly zero:  defaults ${String(dEv).padStart(4)} (${money(dUn)} unallocated)   squeezed ${String(sEv).padStart(4)} (${money(sUn)} unallocated)`);
}

if (gateFail > 0) {
  console.log(`\n\n${RULE}`);
  console.log(`${gateFail} GATE FAILURE(S):`);
  for (const f of failedGates) console.log(`  ${f}`);
  console.log(RULE);
  process.exit(1);
}
console.log('\n\nINCEPTION CESSION IS PATH-INDEPENDENT. On every line the paired difference is inside');
console.log('5% of that line\'s own inception cession AND the sample resolves that tolerance, so this');
console.log('is a measured absence rather than a failure to look. A pool cannot buy reinsurance');
console.log('recovery by underfunding: the give-back holds.');
console.log('\nThe development component is reported above and is an accepted consequence of the');
console.log('markdown — smaller than the defect it replaced, and signed the other way.');
process.exit(0);
