// ============================================================================
// THE MARKET — what a carrier with no pool-specific news would have done with
// its rate this year.
//
//     marketRateChangePct(line, t)  =  100 x ( I(line, t) / I(line, t-1) - 1 )
//
//     I(line, t)  =  GEOMETRIC mean over the last TRIANGLE_HISTORY_YEARS
//                    COMPLETED years of  C(line, y),  the market's COST index
//                    for accident year y
//
//     C(line, y)  =  product over MARKET_COMPONENTS of component.factor(line, y)
//
// ============================================================================
// ONE DERIVATION, THREE CONSUMERS — AND IT LIVES HERE SO THE OTHER TWO DO NOT
// HAVE TO READ A DISPLAY FIELD TO GET AT IT.
//
//   memberSatisfaction.ts   SHIPPED. A member's bill change against this is the
//                           part of their increase the pool has to answer for.
//   prospectCaptureRate     NOT BUILT. The recruitment ladder was retired with
//                           the membership target and membershipEngine.ts's
//                           deletion note says explicitly that it "returns with
//                           the market derivation, which satisfaction needs
//                           anyway". This is that derivation. What it still
//                           needs is a LEVEL, not a change — see below.
//   departure marketability NOT REPOINTED. memberDeparture.ts derives
//                           marketability from the credibility differential
//                           (Z_out > Z) and normalises it by the clamp. That is
//                           a statement about ONE MEMBER's shoppability and it
//                           is fully derived; this module is a statement about
//                           THE YEAR. They multiply, they do not replace one
//                           another, and pointing departure at this is a
//                           separate measurement because it moves who leaves.
//
// ⚠ IT IS A CHANGE, NOT A LEVEL, AND THAT IS THE BIGGEST THING MISSING FROM
// THIS FILE — BIGGER THAN ANY UNBUILT COMPONENT BELOW.
//
// Every component is mean 1 by construction, so the INDEX has no absolute
// meaning — only its year-over-year ratio does. Satisfaction compares two
// CHANGES, which means A POOL THAT HAS BEEN 20% ABOVE THE MARKET FOREVER AND
// HOLDS STEADY COSTS NOTHING. A member does not compare changes. They compare
// their BILL to what they would pay elsewhere, and that is a level.
//
// AND THE LEVEL IS NOT A NEUTRAL ONE, WHICH IS THE PART WORTH BUILDING TOWARD.
// A commercial carrier funds ABOVE its expected loss — risk load and profit —
// and a pool does not. That difference IS the pool's reason to exist, and it
// means the pool holds a COMPETITIVE CUSHION it can spend before members
// object: some amount of funding above expected still leaves a member cheaper
// than the alternative. Today the funding slider has no natural price at all,
// because every level reads the same once the year-over-year change has passed.
// A market CLF would give it one.
//
// ⚠ IT NEEDS A NUMBER NEITHER THE MODEL NOR THIS FILE HAS: what a carrier
// charges over expected loss for these lines. FUNDING_CLF_TABLE and the three
// derived tables in clfTables.ts describe what THIS BOOK's own losses do at a
// confidence level — they are not a market price and must not be read as one.
// RATE_NEUTRAL_LOAD (WC 1.472 / GL 1.457 / Property 1.521) is the POOL's own
// load over pure premium at defaults, which is the pool's expense and
// reinsurance stack, not a competitor's margin. Recorded here as the gap rather
// than half-built, because a level derived from either of those would be this
// pool measured against itself.
//
// The join ladder needs the same level for the same reason — RATE_NEUTRAL_LOAD's
// own header says "a pool overpriced for five straight years shows NO rate
// change" — so one derivation would serve both.
//
// ============================================================================
// ⚠ PURE. NO DRAWS. THIS CANNOT MOVE A BASELINE AND THE PROPERTY IS STRUCTURAL.
//
// Every component is a pure function of (line, yearNumber) and the game's own
// identifiers. `poolYearFactor` builds its own sub-stream from (seed, year) —
// the same pure function processYear already calls, so reading it here consumes
// nothing from any stream and returns the identical value. Nothing in this file
// takes a SeededRandom. A module that cannot draw cannot re-phase anything.
//
// It is also defined at EVERY integer year, including the negative pre-game
// ones, which is what makes the trailing window full from year 1 rather than
// filling over the first ten played years. A window that filled would put a
// warm-up bias into the benchmark for exactly the years a player is learning
// the game.
//
// ============================================================================
// THE WINDOW IS THE POOL'S OWN RATEMAKING WINDOW, AND THAT IS WHAT FIXES THE
// PASS-THROUGH WITHOUT A FREE CONSTANT.
//
// An accident year's cost is not a rate. The step between them is how much of
// one year's experience a ratemaker actually passes into next year's price, and
// picking that number by feel is exactly the kind of invented constant this
// repo spends its commits removing. It does not have to be picked: a carrier
// prices off an experience window, TRIANGLE_HISTORY_YEARS is the window this
// pool prices off, and a trailing mean over N years passes a single year's
// deviation through at 1/N by arithmetic.
//
// The trend passes through EXACTLY, which is the property that makes the
// benchmark usable at defaults. With only the deterministic component in the
// list, every window is the same fixed-width window one year later, so
// I(t)/I(t-1) = (1+tau) with no residual at all, at every year — and the gate
// asserts that identity to float rather than to a tolerance. A pool pricing at
// its own trend therefore reads a market gap of exactly zero, year after year,
// and any gap a player sees is a decision.
//
// THE WINDOW MEAN IS GEOMETRIC, WHICH IS THE NATURAL FORM FOR A PRODUCT OF
// MULTIPLICATIVE FACTORS: in logs the change is
//
//     log(1+tau) + [log g(t-1) - log g(t-1-N)] / N
//
// whose noise term has expectation EXACTLY 0 for any IID component rather than
// approximately 0.
//
// ⚠ AND A +0.8pp BIAS WAS ATTRIBUTED TO THE ARITHMETIC MEAN THIS REPLACED, AND
// THAT WAS SAMPLING NOISE READ AS A MECHANISM. Recorded because the reasoning
// was plausible and wrong. The arithmetic form is a ratio of two random sums
// sharing nine of their ten terms, E[X/Y] > E[X]/E[Y] genuinely holds, and the
// first measurement — 8 games x 10 years — read +0.78 / +0.85 / +0.81 against
// the trend on the three lines. Three lines agreeing looked like confirmation
// and is not: g_pool is ONE draw shared by all three, so the three readings are
// one observation, and its standard error at 8 games is about 0.3pp.
//
// Re-measured at 4,000 games, mean marketRateChangePct over years 1-10 against
// the trend constant, both window forms on the same draws:
//
//   line      trend     arithmetic         geometric
//   WC        -1.45     -1.3905 +/- 0.014  -1.3885 +/- 0.014
//   GL        +1.26     +1.3192 +/- 0.015  +1.3232 +/- 0.015
//   Property  -0.21     -0.1509 +/- 0.014  -0.1477 +/- 0.014
//
// THE TWO FORMS ARE INDISTINGUISHABLE and the residual +0.06pp is common to
// both, so it is not a property of the mean at all: it is E[exp] over the log
// change, sigma^2/2 with sigma = 0.029, which predicts +0.04. It is 2% of the
// benchmark's own per-year SD of 2.82pp and nothing is done about it. The
// geometric form is kept on the argument above and NOT on the measurement,
// which is the honest order.
//
// ⚠ A GEOMETRIC MEAN NEEDS EVERY COMPONENT STRICTLY POSITIVE. Both built
// components are — a power of (1+tau) and a Gamma draw — and the gate asserts
// it, because a component that could return 0 would send the index to zero and
// a negative one would send it to NaN.
//
// ⚠ AND THE BENCHMARK IS QUIETER THAN THE THING IT BENCHMARKS, WHICH IS THE
// SANITY TEST EVERY FUTURE COMPONENT HAS TO PASS. Per-year SD, 16 games x 10
// years on the engine against 4,000 games of the index:
//
//   line       market benchmark    the pool's own rate change
//   WC              2.82                     3.44
//   GL              2.90                     3.75
//   Property        2.86                     4.47
//
// A benchmark noisier than the rate it judges would make every member's
// grievance a reading of the benchmark's own draw. That is what disqualified
// the calendar component below, and market-conditions-check asserts the
// inequality so the next component cannot be added without meeting it.
//
// ============================================================================
// ⚠ g_pool IS IN, AND THE QUESTION WAS ASKED BECAUSE IT IS ARGUABLE.
//
// Against: it is drawn from the GAME's seed, once per year, so it is this
// instance's year rather than the industry's, and only GL's generator still
// consumes it (WC's severity rebuild took it out of WC's path, and Property
// never had it).
//
// For, and this is the side taken:
//
//   1. IT IS NOT A DECISION. Nothing the player does moves it. Charging the
//      pool for it — by leaving it out of the benchmark, which is what "the
//      pool did this" means — would penalise a pool for weather. Everything
//      this benchmark exists to isolate is a decision.
//   2. A Gamma multiplier on every enrolled member of a line at once IS "a bad
//      year generally". That is the shape of a market-wide year, not of a
//      pool-specific one, whatever the draw is keyed on.
//   3. IT COSTS NOTHING TESTABLE. E[g] = 1, so including it does not move the
//      benchmark's MEAN at all — only its dispersion. And the dispersion is the
//      entire point: without a year-varying term the benchmark is a constant
//      and "a year the whole market moved" is indistinguishable from "a year
//      the pool moved alone", which is the distinction this was built for.
//
// ⚠ AND IT IS APPLIED TO ALL THREE LINES THOUGH ONLY GL CONSUMES IT. Deliberate.
// The benchmark is what OTHER carriers' costs did, and a carrier writing this
// book writes more than one line. Restricting it to GL would say the WC market
// has no years, which is a stronger claim than including it.
//
// ⚠ THE ONE THING IT IS NOT: a statement that the pool's OWN losses moved. The
// pool's realised losses already contain this year's g_pool; the benchmark
// contains the same draw at 1/N through the window. Reading the gap as "the
// pool's losses minus the market's losses" is wrong — it is "the pool's PRICE
// minus what the market's price would have done".
//
// ============================================================================
// ⚠ THE CALENDAR FACTOR IS DECLARED AND NOT BUILT, AND THE REASON IS A
// MEASUREMENT RATHER THAN AN OMISSION. IT WAS THE THIRD COMPONENT ASKED FOR.
//
// The engine's calendar-year term is exactly the right SHAPE: one shared shock
// per line-year, hashed from (gameId, line, valuationYear), that every open
// cohort of a line takes together — see calendarBlendedZ and IBNER_CALENDAR_RHO.
// It is pure, it costs no draw, and reading it here would have been four lines.
//
// What is missing is its SIZE. The only magnitude available is
// reserveStepSigma(line), and that constant's own header forbids this reading:
// "THE PRODUCT IS NOT A PREDICTION ABOUT ANY OBSERVABLE. WC's effective target
// reads 0.25 x 2.80 = 0.70, and that is not a claim that a WC accident year's
// ultimate has a 60% standard deviation." It is a dial, set to make reserves
// surprise the player. Taken at face value here it puts a 20.4% standard
// deviation on WC's market restatement (sqrt(rho) x sigma = 0.2863 against a
// value-weighted open share of 0.698 over the ten-year window), i.e. it would
// claim the market's rate moves twenty points a year on calendar-year news. The
// pool's OWN measured rate jitter is 4.58% (IBNER_CALENDAR_RHO's cost table),
// so the benchmark would be four times noisier than the thing it benchmarks and
// every member's grievance would be a reading of one hashed number.
//
// THE MISSING PIECE IS A PASS-THROUGH, AND IT IS NOT THE WINDOW'S. g_pool is an
// ACCIDENT-YEAR cost and the trailing mean passes it at 1/N by arithmetic. A
// calendar-year shock RESTATES THE WHOLE TRIANGLE AT ONCE, so the window does
// not damp it, and how much of a restatement a ratemaker passes into next
// year's price is a property of the METHOD rather than of the window. Building
// it means building a market ratemaker, and inventing a single number for it
// instead is the exact move this file's window rule exists to avoid.
//
// WHAT WOULD BUILD IT: an observable for the calendar term's effect on an
// INDICATED RATE rather than on a reserve. IBNER_CALENDAR_RHO's own cost table
// has the shape of one — year-over-year log change in purePremiumPer100, null
// against shipped, 3.88% -> 4.58% on WC and flat on GL and Property — and the
// quadrature difference (2.43pp on WC) is a first candidate. It is not adopted
// here because it is measured on THIS POOL's pricing path, which is the thing
// the benchmark is supposed to be independent of.
//
// ============================================================================
// SHOCKS ARE THE FOURTH COMPONENT AND THE LIST IS THE EXTENSION POINT.
//
// Four of nine effect kinds are built (shock-check's catalog section), so a
// shock component today would describe a market that feels earthquakes and
// employment-practices surges and is blind to the other five. It drops in as
// ONE ENTRY in MARKET_COMPONENTS and nothing else changes: the index is a
// product over the list, the window is a mean over the index, and the rate
// change is a ratio of windows. No consumer of this module names a component.
//
// ⚠ THE ONE THING A NEW COMPONENT MUST BE IS MEAN 1. Everything above rests on
// it — the trend passing through exactly, g_pool costing nothing in the mean,
// the benchmark reading zero at defaults. A component with a mean away from 1
// silently retunes the neutral point, which is the defect RATE_NEUTRAL_CHANGE_PCT
// was written to prevent. market-conditions-check asserts it per component.
//
// ⚠ AND A SHOCK COMPONENT IS ACCIDENT-YEAR KIND OR CALENDAR-YEAR KIND, WHICH IS
// NOT A DETAIL. #22 Employment Practices Surge multiplies GL frequency in its
// own year — accident-year, and the window damps it at 1/N. #19 Social
// Inflation Hard Market multiplies GL severity and is the calendar-year shape.
// The second kind has the pass-through problem the calendar factor has, so the
// first half of the shock component is buildable now and the second half is not.
// ============================================================================

import { poolYearFactor } from './claimGeneration';
import { RATE_NEUTRAL_CHANGE_PCT, TRIANGLE_HISTORY_YEARS } from '../data/defaultAssumptions';
import type { CoverageLine } from '../types/simulation';

/** Everything a component may read. Identifiers only — never pool state. */
export interface MarketContext {
  /** GameInstance.seed. */
  seed: number;
  /** GameInstance.instanceId, for components that hash rather than draw. */
  gameId: string;
}

export interface MarketComponent {
  name: string;
  /**
   * ACCIDENT-YEAR components price one year's cost and reach the rate through
   * the trailing window at 1/N. CALENDAR-YEAR components restate the whole
   * window at a valuation and the window does not damp them — see the header.
   */
  kind: 'accidentYear' | 'calendarYear';
  /** Mean-1 multiplicative factor on the market's cost for this line-year. */
  factor(line: CoverageLine, yearNumber: number, ctx: MarketContext): number;
}

/**
 * The deterministic part: what a rate does on trends alone, with nobody
 * deciding anything.
 *
 * ⚠ THIS IS RATE_NEUTRAL_CHANGE_PCT AND NOT A SECOND MEASUREMENT OF IT. That
 * constant is already "the rate change at all-default decisions, per line",
 * measured over 30 games x 10 years — WC's falls on its frequency trend, GL's
 * rises, Property's is flat because its exposure base does not inflate while
 * its losses do. It IS the trend component, and this module generalises it from
 * a CONSTANT that every year is compared against into an INDEX that other
 * components can multiply into. With this component alone,
 * marketRateChangePct returns RATE_NEUTRAL_CHANGE_PCT[line] exactly, at every
 * year — which is the compatibility statement worth having, and the gate
 * asserts it.
 *
 * ⚠ SO IT INHERITS THAT CONSTANT'S RE-MEASUREMENT RULE. "RE-MEASURE THESE if
 * any trend constant moves, if DEFAULT_LAYERS_PLACED changes, or if the admin
 * ratio changes." A stale trend here biases every member's grievance in one
 * direction, permanently, which is the same failure mode the constant's own
 * header describes for the retention penalty.
 */
const trendComponent: MarketComponent = {
  name: 'trend',
  kind: 'accidentYear',
  factor(line, yearNumber) {
    const tau = (RATE_NEUTRAL_CHANGE_PCT[line] ?? 0) / 100;
    return Math.pow(1 + tau, yearNumber - 1);
  },
};

/**
 * The year. Gamma(25, 1/25), mean 1, drawn once per (seed, year) and shared by
 * every line — the same pure function processYear calls, so this reads the
 * game's actual pool-year factor rather than a second one like it.
 */
const poolYearComponent: MarketComponent = {
  name: 'poolYear',
  kind: 'accidentYear',
  factor(_line, yearNumber, ctx) {
    return poolYearFactor(ctx.seed, yearNumber);
  },
};

/** In force. See the header for what is declared and not in it, and why. */
export const MARKET_COMPONENTS: readonly MarketComponent[] = [
  trendComponent,
  poolYearComponent,
];

/**
 * Named, costed and not built. Kept as data rather than as prose so that
 * market-conditions-check can PRINT the gap on every run — an unbuilt component
 * that only exists in a comment is one nobody is reminded of.
 */
export const MARKET_COMPONENTS_UNBUILT: ReadonlyArray<{
  name: string; kind: MarketComponent['kind']; blockedOn: string;
}> = [
  {
    name: 'calendar',
    kind: 'calendarYear',
    blockedOn: 'no observable for the calendar term\'s effect on an INDICATED RATE; '
      + 'reserveStepSigma is a dial and reading it as one puts 20.4% SD on WC',
  },
  {
    name: 'shock',
    kind: 'accidentYear',
    blockedOn: 'four of nine effect kinds built; the calendar-year half also needs the '
      + 'pass-through the calendar component needs',
  },
];

/** The ratemaker's experience window. The pool's own, deliberately. */
export const MARKET_RATING_WINDOW = TRIANGLE_HISTORY_YEARS;

/**
 * The market's cost for one accident year. Product over the built components.
 *
 * ⚠ THE `components` ARGUMENT EXISTS FOR THE GATE'S POSITIVE CONTROL AND FOR
 * NOTHING ELSE. market-conditions-check has to run the same window over a
 * deliberately noisier component list, and the alternative was a second copy of
 * the geometric window inside the gate — which is the duplicate that drifts.
 * The engine never passes it.
 */
export function marketCostIndex(
  line: CoverageLine, yearNumber: number, ctx: MarketContext,
  components: readonly MarketComponent[] = MARKET_COMPONENTS,
): number {
  let v = 1;
  for (const c of components) v *= c.factor(line, yearNumber, ctx);
  return v;
}

/**
 * The market's rate for year `yearNumber`: the trailing GEOMETRIC mean of the
 * cost index over the last MARKET_RATING_WINDOW COMPLETED years. See the header
 * on why geometric and what the arithmetic one measured.
 *
 * ⚠ COMPLETED YEARS ONLY — y runs to yearNumber - 1. A market that could price
 * off the year it is pricing would have foreknowledge the pool does not, and
 * the gap would then be measuring an information asymmetry rather than a
 * decision.
 */
export function marketRateIndex(
  line: CoverageLine, yearNumber: number, ctx: MarketContext,
  components: readonly MarketComponent[] = MARKET_COMPONENTS,
): number {
  let logSum = 0;
  for (let y = yearNumber - MARKET_RATING_WINDOW; y <= yearNumber - 1; y++) {
    const c = marketCostIndex(line, y, ctx, components);
    if (!(c > 0)) return 0;
    logSum += Math.log(c);
  }
  return Math.exp(logSum / MARKET_RATING_WINDOW);
}

/**
 * What the market's rate did this year, in percentage points — the same units
 * and the same sign convention as `rateChangePct` in the engine and as
 * RATE_NEUTRAL_CHANGE_PCT.
 */
export function marketRateChangePct(
  line: CoverageLine, yearNumber: number, ctx: MarketContext,
  components: readonly MarketComponent[] = MARKET_COMPONENTS,
): number {
  const prior = marketRateIndex(line, yearNumber - 1, ctx, components);
  if (!(prior > 0)) return 0;
  return (marketRateIndex(line, yearNumber, ctx, components) / prior - 1) * 100;
}

/**
 * Per-component detail for the gate and for the audit surface. Reports each
 * component's factor and the change it would produce ON ITS OWN, so a reader
 * can see which part of a market year came from where rather than being handed
 * one number.
 */
export function marketBreakdown(line: CoverageLine, yearNumber: number, ctx: MarketContext): {
  totalChangePct: number;
  components: Array<{ name: string; kind: string; factor: number; soloChangePct: number }>;
} {
  const components = MARKET_COMPONENTS.map(c => {
    // The same geometric window the index uses, so a component's solo figure is
    // its actual contribution and the solo figures sum to the total rather than
    // nearly doing so.
    const windowMean = (at: number) => {
      let s = 0;
      for (let y = at - MARKET_RATING_WINDOW; y <= at - 1; y++) {
        const f = c.factor(line, y, ctx);
        if (!(f > 0)) return 0;
        s += Math.log(f);
      }
      return Math.exp(s / MARKET_RATING_WINDOW);
    };
    const prior = windowMean(yearNumber - 1);
    return {
      name: c.name,
      kind: c.kind,
      factor: c.factor(line, yearNumber, ctx),
      soloChangePct: prior > 0 ? (windowMean(yearNumber) / prior - 1) * 100 : 0,
    };
  });
  return { totalChangePct: marketRateChangePct(line, yearNumber, ctx), components };
}
