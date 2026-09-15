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
// ⚠ THERE ARE NOW TWO QUANTITIES HERE AND THEY ANSWER DIFFERENT QUESTIONS.
//
//   marketRateChangePct   what the market's rate DID this year. Derived from
//                         mean-1 components through a trailing window; the index
//                         has no absolute meaning, only its ratio does.
//   marketLevelGapPct     where the pool's price SITS against the market's.
//                         Modelled from a target loss ratio — see below.
//
// The change term alone had a hole the level closes: a pool that has been 20%
// above the market forever and holds steady shows NO rate change and costs
// nothing. A member does not compare changes. They compare their bill to what
// they would pay elsewhere, and that is a level.
//
// ⚠ AND THE LEVEL IS NOT NEUTRAL, WHICH IS THE POINT OF BUILDING IT. A carrier
// funds ABOVE expected loss for expenses and profit and a pool does not, so the
// pool holds a CUSHION it can spend before members object. That cushion is what
// gives the funding slider a price it did not have.
//
// prospectCaptureRate wants this same level and not the change —
// RATE_NEUTRAL_LOAD's own header says "a pool overpriced for five straight years
// shows NO rate change" — so the derivation below serves it when it is rebuilt.
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

// ============================================================================
// THE MARKET'S LEVEL — WHAT A CARRIER WOULD CHARGE FOR THE SAME RISK.
//
//     market rate per $100  =  expected loss per $100 / TARGET LOSS RATIO
//
// ⚠ MODELLED, NOT MEASURED, AND LABELLED THAT WAY. There is no carrier data in
// this project and there is not going to be any. What is available is the
// STRUCTURE of commercial pricing, which needs nothing from this pool: a carrier
// prices to a target loss ratio, with expenses and profit on top of expected
// loss. The target itself is a JUDGEMENT.
//
// ⚠ AND THE EXPECTED LOSS IS THE POOL'S OWN, WHICH IS NOT THE CIRCULARITY THAT
// KILLED THE FIRST ATTEMPT. A loss cost is a property of the RISK, not of who
// carries it: the same school district generates the same claims whoever writes
// it. What was circular about reading a market level off FUNDING_CLF_TABLE or
// RATE_NEUTRAL_LOAD is that both describe THIS POOL'S OWN LOAD — its confidence
// level, its admin ratio, its reinsurance tower — so a "market" built from
// either was the pool measured against itself. The loss cost is shared; only
// the load is contested, and only the load is modelled here.
//
// ============================================================================
// ⚠ THE CUSHION IS ABOUT 7%, NOT 35%, AND THE DIFFERENCE IS THE POOL'S OWN
// LOAD. This corrects the figure the level term was commissioned on.
//
// "A pool funding at 1.000 is about 35% cheaper" compares CLF 1.000 against
// 1/0.65 = 1.538 — but CLF 1.000 prices only the POOL PREMIUM leg, and a
// member's bill also carries admin expense on the gross pure premium and the
// whole occurrence tower. The comparison that matters is total member charge
// against total carrier charge, both per unit of GROSS expected loss. Measured
// on the engine, 4 games x 8 years, at a 65% target:
//
//   stop        WC load / cushion    GL load / cushion    Property load / cushion
//   Expected    1.4052   -8.66%      1.4392   -6.45%      1.4255   -7.34%
//   0.30        1.3415  -12.80%      1.3064  -15.09%      1.2921  -16.01%
//   0.50        1.4085   -8.45%      1.4040   -8.74%      1.4054   -8.65%
//   0.65        1.4619   -4.98%      1.4885   -3.25%      1.4991   -2.56%
//   0.70        1.4820   -3.67%      1.5217   -1.09%      1.5344   -0.26%
//   0.75        1.5044   -2.21%      1.5621   +1.54%      1.5782   +2.59%
//   0.80        1.5324   -0.39%      1.6032   +4.21%      1.6238   +5.55%
//   0.90        1.6085   +4.55%      1.7391  +13.04%      1.7778  +15.55%
//   0.95        1.6905   +9.88%      1.8454  +19.95%      1.8951  +23.18%
//
// THE SLIDER CROSSES FROM CHEAPER TO DEARER AT ABOUT THE 0.80 STOP ON WC, 0.72
// ON GL AND 0.70 ON PROPERTY, and that crossing is the mechanic: a pool can
// fund well above expected and still be the cheaper option, until it cannot.
// The three lines cross in different places because their own loads differ, not
// because the market target does.
//
// ⚠ AND RATE_NEUTRAL_LOAD IS STALE AGAINST THIS. It records WC 1.472 / GL 1.457
// / Property 1.521 as the load at all-default decisions; measured here the same
// quantity reads 1.405 / 1.439 / 1.426. WC is 4.6% out. That constant asks to be
// re-measured "if any trend constant moves, if DEFAULT_LAYERS_PLACED changes, or
// if the admin ratio changes", and several of those have. Nothing acts on it —
// its only consumer, RATE_LEVEL_SENSITIVITY, went dormant with the recruitment
// ladder — so this is a finding rather than a defect, and this file does NOT
// read it: `marketLevelGapPct` takes the live rate and the live pure premium.
//
// ============================================================================
// SHOULD THE TARGET VARY BY LINE? YES — AND IT IS A SCALAR HERE ON PURPOSE.
//
// A carrier's expense ratio on Property is not its expense ratio on WC. The
// direction is even fairly clear: long-tail casualty carries more claims
// handling and more capital per premium dollar than short-tail property, so a
// property target loss ratio usually sits BELOW a workers' compensation one.
// So the right structure is per line.
//
// It ships as a SCALAR anyway, and that is the honest form of not knowing. A
// Record<CoverageLine, number> holding the same number three times reads like
// three measurements and invites exactly one of them to be nudged; a scalar
// cannot be misread. Differentiating it is a one-line type change plus three
// numbers, and the three numbers are the part nobody has.
//
// ⚠ AND THE TARGET IS LOW-RISK IN A SPECIFIC WAY WORTH STATING. It does NOT set
// how hard satisfaction reacts — that scale is absorbed by the level weight, so
// a 60% target and a 70% one produce the same behaviour with a different weight.
// What it DOES set is WHERE THE CUSHION CROSSES ZERO, and the level reaction is
// kinked there (see memberSatisfaction.ts). So the number nobody has measured
// moves the crossing point, not the sensitivity.
// ============================================================================

/**
 * ⚠ JUDGEMENT. Not measured, not measurable here, and not derived from anything
 * in this repo. 65% is a plausible commercial target loss ratio for these lines
 * — a ~35% expense-and-profit load — and that is the whole of its provenance.
 * It is recorded as a judgement in the same terms RATE_RETENTION_SENSITIVITY's
 * own header uses, which is the house form for a number that had to be picked.
 */
export const MARKET_TARGET_LOSS_RATIO = 0.65;

/** What a carrier charges per unit of gross expected loss. 1.538 at a 65% target. */
export function marketLoadOverExpectedLoss(): number {
  return 1 / MARKET_TARGET_LOSS_RATIO;
}

/**
 * How the pool's price compares with the market's, in percentage points.
 * NEGATIVE is cheaper than the market — the pool's cushion.
 *
 *     gap = 100 . ( poolRate / (purePremium / target) - 1 )
 *         = 100 . ( load . target - 1 )
 *
 * Both sides are per $100 of the SAME exposure and both are over the same GROSS
 * expected loss, which is what makes the comparison meaningful: the pool's load
 * carries admin and the occurrence tower explicitly, and the carrier's carries
 * its expenses, its profit and its own reinsurance inside the 35%. That last
 * point is an assumption of the structure and is stated rather than buried.
 *
 * Returns 0 when there is no positive expected loss to compare against, which
 * is the same neutral-on-missing-data rule priceSignalFor uses.
 */
export function marketLevelGapPct(
  poolTotalRatePer100: number,
  grossPurePremiumPer100: number,
): number {
  if (!(grossPurePremiumPer100 > 0) || !(poolTotalRatePer100 > 0)) return 0;
  return ((poolTotalRatePer100 / grossPurePremiumPer100) * MARKET_TARGET_LOSS_RATIO - 1) * 100;
}

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
