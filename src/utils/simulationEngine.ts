// Core simulation engine for Risk Pool Simulation v1
// Premium formula: Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import type { Claim, GameState, Occurrence, PoolState, DecisionSet, LinePoolState, LineDecisionSet, ResultSet, LineResultSet, ReserveCohort, ReserveDevelopmentRow, Member, MemberLossResult, MembershipHistory, CoverageLine, GameInstance, AssetAllocation } from '../types/simulation';
import type { LineShockEffects, ShockFiring, ShockRecord } from '../types/shocks';
import { resolveShocks, ownFreqMultipliers, ownComponentFreqMultipliers, ownSevMultipliers } from './shockResolver';
import { WHOLE_LINE } from './shockEffects';

// Collapse the per-line shock records into one row per EVENT for the pool
// result, summing each cost across the lines that event touched and unioning
// the lines it affected. Returns undefined when no line recorded anything, so
// the pool result carries no empty array.
function mergeShockRecords(lineResults: LineResultSet[]): ShockRecord[] | undefined {
  const merged = new Map<string, ShockRecord>();
  for (const r of lineResults) {
    for (const rec of r.shockEvents ?? []) {
      const existing = merged.get(rec.shockId);
      if (!existing) { merged.set(rec.shockId, { ...rec, linesAffected: [...rec.linesAffected] }); continue; }
      existing.attributableGrossLoss += rec.attributableGrossLoss;
      existing.attributableClaims += rec.attributableClaims;
      existing.expectedGrossLossAdded += rec.expectedGrossLossAdded;
    }
  }
  return merged.size > 0 ? [...merged.values()] : undefined;
}
import { SeededRandom, deriveSubRng } from './random';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, AGGREGATE_LOSS_DISTRIBUTION, FUNDING_CLF_TABLE, IBNER_BOOKING_BIAS_COEFF, IBNER_HORIZON, IBNER_STEP_MIXTURE, IBNER_TOTAL_SD, IBNER_UNWIND_DECAY, LINE_PAYOUT_PATTERN, MEMBER_LOSS_VOLATILITY, OPERATING_CASH_PCT_OF_PREMIUM, PROPERTY_HELD_PURE_PREMIUM_PER_100, RISK_CONTROL_PARAMS, WC_LOSS_MODEL, resolveClosureCurve } from '../data/defaultAssumptions';
import type { TowerLine } from '../data/reinsuranceTower';
import {
  DEVELOPMENT_ALLOCATION, DEVELOPMENT_CESSION_ENABLED, STOCHASTIC_ALLOCATION_MODE,
  allocateDevelopment, buildTrackedSet, cedeDevelopment, markDownForBooking, reselectCarriers,
} from './developmentAllocation';
import { isClaimClosed } from './claimClosure';
import {
  aggregateRecovery,
  cedeOccurrences,
  normalizeAggregateStopLevel,
  normalizeLayersPlaced,
  occurrenceTotals,
  quoteAggregate,
} from './reinsuranceTower';
import { simulateMarketReturns, blendInvestmentReturn } from './investmentEngine';
import { cohortCloseBelow, conditionalPaydown, unpaidShare } from './payoutPattern';
import { simulateMemberMovement } from './membershipEngine';
import { cloneMembershipHistory, openInterval, closeInterval } from './membershipHistory';
import { cloneMemberLossHistory, recordMemberLossYear } from './memberLossHistory';
import { computeKLine, deriveNeutralClassRatesPer100, deriveNeutralPurePremiumPer100, expectedWcGrossLossForPricing, generateWcClaims, ratingGroupOf, wcFrequencyTrend, wcSeverityTrend } from './wcClaimEngine';
import { hasStaticClf, staticClf } from '../data/clfTables';
import { computeKGl, deriveNeutralGlPurePremiumPer100, expectedGlGrossLossForPricing, generateGlClaims, glCappedSeverityTrend } from './glClaimEngine';
import { computeKPr, generatePropertyClaims } from './propertyClaimEngine';
import { generateNarrative } from './narrativeEngine';
import { quoteLineRates } from './linePricing';
import { getMemberExposure } from './lineHelpers';
import { wageFactor } from '../data/exposureTrend';
import { getPredefinedMarketMembers } from '../data/memberCatalog';

export function lookupCLF(level: number): number {
  const rounded = Math.round(level * 20) / 20;
  const keys = Object.keys(FUNDING_CLF_TABLE).map(Number).sort((a, b) => a - b);

  let best = keys[0];
  let bestDiff = Math.abs(rounded - keys[0]);

  for (const k of keys) {
    const diff = Math.abs(rounded - k);
    if (diff < bestDiff) {
      best = k;
      bestDiff = diff;
    }
  }

  return FUNDING_CLF_TABLE[best];
}

// THE LOSS PROVISION THE POOL PREMIUM ACTUALLY FUNDS — the numerator every
// expected-loss ratio must use, and the reason it is a function rather than an
// inlined expression at each of its two call sites (line scope and pool
// aggregation).
//
// ⚠ WHY NOT expectedLoss. Since the net-funding change, poolPremium funds
// (gross expected - expected ceded) x CLF x rateLevel/100, while expectedLoss
// stays GROSS on purpose. Pairing gross expectedLoss with a denominator built
// on the net-funded poolPremium counts the ceded loss TWICE — once in the loss
// numerator and again as reinsuranceCost in the expense ratio — which is what
// pushed the Expected Combined Ratio to 130.0% on GL and 118.9% on WC while
// the pool was funding exactly its expected cost.
//
// ⚠ WHY DIVIDING BY THE CLF IS THE RIGHT INVERSION, and not merely convenient.
// poolPremium = exposure x netPurePremiumPer100 x CLF x pricingAdjustment x
// 10_000, so this returns net expected loss AT THE PRICED RATE LEVEL. That
// matters: the identity below has to close for any pricingAdjustment, not just
// the 1.0 it currently sits at, and re-deriving the net loss from the pure
// premium instead would drop the rate-level factor and reopen the gap the
// moment rateLevel moves off 100.
//
// THE IDENTITY THIS EXISTS TO PRESERVE. poolPremium + adminExpense +
// reinsuranceCost is identically totalMemberCharge, so at CLF 1.000 this
// numerator IS poolPremium and the Expected Combined Ratio is EXACTLY 1.0000 —
// not approximately. Above CLF 1.000 the shortfall below 1.0000 is the funding
// margin, which is the whole point of a confidence level. Asserted to float
// precision in scripts/diagnostics/ratio-basis-check.ts; if it stops closing
// exactly, this function or its callers are wrong.
//
// ⚠ THE PROPERTY CONTROL THIS NOTE RELIED ON IS GONE. It used to read
// "PROPERTY IS UNCHANGED BY CONSTRUCTION... Property is deliberately not
// netted, so its netPurePremiumPer100 IS its gross pure premium and this
// returns exactly the expectedLoss it already used. Property-solo must stay
// byte-identical." That was true of the expected-combined-ratio fix this
// function was written for, and it is what made that fix a diagnosis rather
// than a guess. It stopped being true when Property got its own occurrence
// layer: Property nets now, so this returns a genuinely net figure on all
// three lines and PR-solo is no longer a control for anything here.
// The function itself is unchanged and still correct — only the isolation
// argument in this comment expired.
function fundedNetExpectedLoss(r: { poolPremium: number; selectedFundingCLF: number }): number {
  return r.poolPremium / Math.max(r.selectedFundingCLF, 1e-9);
}

// The claim lines' pure premiums: derived ONCE, at module load, from each
// claim generator's analytic expectation over the FULL canonical roster at
// neutral risk quality, then held for every line-year of every game. This is
// the finding-6 fix — losses and premium are two views of the same model
// rather than two independent assertions that drift apart. Computed rather
// than hardcoded so they can never fall out of step with the generators'
// parameters.
// KNOWN AND ACCEPTED BY DESIGN — the enrolled-book composition effect.
// Holding these off the NEUTRAL FULL BOOK means a given year's enrolled roster
// is priced at the full market's average loss cost per exposure dollar, not its
// own. k_line/k_GL correct the risk-quality tilt but deliberately NOT the
// payroll/relativity mix of who actually enrolled. Measured for GL at 40 seeds
// x 5 years: enrolled-book neutral pure premium 6.7807 vs the held 6.8305, so
// the book is priced ~0.7% high, which moves the analytic gross loss ratio from
// 66.8% to 66.36% — inside tolerance.
// This is the PRICE of Correction 1, not a defect. Making the pure premium
// track the enrolled mix would rebuild exactly the pricing-chases-roster
// feedback loop Correction 1 exists to prevent: premium would fall as good
// risks left, which changes who leaves next year, and the loss ratio would
// wander instead of holding. Do not "fix" this.
const WC_HELD_PURE_PREMIUM_PER_100 = deriveNeutralPurePremiumPer100(getPredefinedMarketMembers());

// ⚠ HELD AS A LITERAL, NOT DERIVED AT MODULE LOAD LIKE WC's AND GL's, and the
// asymmetry is deliberate. Two thirds of the difference is that this figure has
// two parts with different provenance — a derived non-cat component and an
// ASSERTED cat load no generator produces — so deriving it here would silently
// drop the asserted half. See PROPERTY_HELD_PURE_PREMIUM_PER_100's own comment.
// property-fit-check.ts asserts the derived half against the generator's
// analytic expectation, which is the check that would otherwise be missing.
const GL_HELD_PURE_PREMIUM_PER_100 = deriveNeutralGlPurePremiumPer100(getPredefinedMarketMembers());

// THIS YEAR'S GROSS PURE PREMIUM PER $100 — exported because the Decisions
// panel needs the SAME number the engine is about to price with.
//
// ⚠ IT IS NOT lineState.purePremiumPer100. That field holds LAST year's value,
// and the panel used to price off it directly — so on WC and GL, which
// re-derive from held constants times the year's own trend factors, the panel
// was a year stale before anything else went wrong with it. Small (~2%/yr on
// WC) but structural, and it compounds with the funding-basis gap rather than
// cancelling it.
//
// Extracted from processLineYear VERBATIM, operation order included: these are
// float products feeding every downstream premium, and reassociating them
// would move engine values.
// ⚠ THE PRIOR VALUE, THE LOSS TREND AND RISK-CONTROL EFFECTIVENESS ARE GONE
// FROM THE SIGNATURE, not left unused. They existed only for Property's
// compounding random walk; with Property held, every line's pure premium is a
// pure function of the line and the year. Dropping the parameters rather than
// ignoring them is what stops a future reader believing the pure premium can
// still be moved by a decision — it cannot, and risk control now acts on the
// DRAW ONLY, in all three generators (finding 17).
// WC'S FOUR HELD CLASS RATES, derived once at module load exactly as the single
// blended rate above is. See deriveNeutralClassRatesPer100.
const WC_HELD_CLASS_RATES_PER_100 = deriveNeutralClassRatesPer100(getPredefinedMarketMembers());

// THE BOOK'S OWN BLENDED WC RATE — the exposure-weighted average of the four
// held class rates over whoever is actually enrolled.
//
// ⚠ THIS IS WHY THE SCALAR DOWNSTREAM STAYS A SCALAR. The vector lives here and
// collapses before it leaves: every consumer of purePremiumPer100 sees one
// number, and `activeExposure x blend = sum(exposure_i x rate_i)` holds exactly,
// so expectedLoss, the admin base, the net-of-ceded step and the display all
// stay correct without knowing a vector exists.
//
// ⚠ WEIGHTED BY THE SAME EXPOSURE THE PREMIUM IS CHARGED ON, not by raw stored
// payroll. Wage inflation is uniform across members so the two give the same
// blend today, but tying the weights to the charged basis is what keeps the
// identity above exact if that ever stops being true.
//
// An empty book falls back to the blended rate: with no members there is no mix
// to reflect, and returning 0 would price the first enrolment off a zero base.
function wcBlendedRatePer100(members: Member[], yearNumber: number): number {
  let exposure = 0, weighted = 0;
  for (const m of members) {
    const e = getMemberExposure(m, 'WC', yearNumber);
    if (!(e > 0)) continue;
    exposure += e;
    weighted += e * WC_HELD_CLASS_RATES_PER_100[ratingGroupOf(m)];
  }
  return exposure > 0 ? weighted / exposure : WC_HELD_PURE_PREMIUM_PER_100;
}

export function currentPurePremiumPer100(
  line: CoverageLine,
  yearNumber: number,
  // WC ONLY. The book whose class mix sets the blend. GL and Property ignore it
  // — both are flat across member types, so a vector-of-one would be a scalar
  // wearing a costume and would invite a reader to think it meant something.
  members: Member[] = [],
): number {
  return line === 'WC'
    ? wcBlendedRatePer100(members, yearNumber)
      * wcFrequencyTrend(yearNumber)
      * wcSeverityTrend(yearNumber)
      / wageFactor('WC', yearNumber)
    : line === 'GL'
    ? GL_HELD_PURE_PREMIUM_PER_100
      * glCappedSeverityTrend(yearNumber)
      / wageFactor('GL', yearNumber)
    // ⚠ PROPERTY IS NOW HELD LIKE THE OTHER TWO. It used to be the ONLY line
    // whose pure premium was a compounding random walk — prior x (1 + lossTrend)
    // x (1 - rcEffectiveness), seeded from STARTING_FINANCIALS' ratePer100 and
    // drifting thereafter — so two games with identical decisions priced
    // Property differently for no modelled reason, and no roster fit could ever
    // anchor it. It is a pure function of the year now, which is to say a
    // constant: the fit found no frequency trend, and severity trend is already
    // inside the payout-pattern convention the generator applies. Adding a
    // factor here would double-count it, which is the finding-37 trap.
    : PROPERTY_HELD_PURE_PREMIUM_PER_100;
}

// The risk-control effectiveness this year's decision produces.
//
// ⚠ NO LONGER EXPORTED, and its old comment was stale. It said Property's pure
// premium depends on it "so the panel cannot reach a matching pure premium
// without it" — that stopped being true when Property was held (see the block
// above): heldPurePremiumPer100 is now a pure function of the year for all
// three lines and reads no rcEffectiveness at all. The only caller left is
// processLineYear below, in this file. File-local now; re-export it if a panel
// ever needs to project effectiveness itself.
function projectedRcEffectiveness(
  priorRCEffectiveness: number,
  riskControlPct: number,
): number {
  const maxRC = RISK_CONTROL_PARAMS.maxEffectiveness;
  const rcGain =
    (riskControlPct / 0.08) *
    (maxRC / RISK_CONTROL_PARAMS.lagYears);
  const rcDecay =
    priorRCEffectiveness *
    RISK_CONTROL_PARAMS.decayRate *
    (riskControlPct < 0.01 ? 2 : 1);
  return Math.max(0, Math.min(maxRC, priorRCEffectiveness + rcGain - rcDecay));
}

// Line-specific label for a seeded sub-RNG stream. WC keeps its original,
// unsuffixed label so a WC-only game's random draws (and therefore the Stage
// 1.2 regression baseline) are completely unaffected by other lines existing.
// Every other line gets its own independent stream via a suffixed label.
function lineRngLabel(base: string, line: CoverageLine): string {
  return line === 'WC' ? base : `${base}_${line}`;
}

// ============================================================================
// THE RESELECTION STREAM — ITS OWN, AND THAT IS THE WHOLE POINT.
//
// Reselecting the developing subset draws size-weighted, and a size-weighted
// draw consumes RNG. Taking those draws from `ibner` would move every
// subsequent draw in that stream — the lognormal step, the horizon, the step
// multiplier, the inception carrier picks — so a commit that changes WHICH
// claims develop would arrive as an indistinguishable mixture of that change
// and a reseed of everything else, and no before-and-after could separate them.
//
// So reselection gets streams keyed on (seed, valuation year, line, accident
// year, purpose). `ibner` is untouched by this commit: it still takes its ten
// carrier picks at inception, in the same order, at the same point.
//
// ⚠ THE ACCIDENT YEAR IS IN THE KEY, NOT JUST THE VALUATION YEAR. Every open
// cohort reselects at the same valuation, so a key without it would hand a
// dozen cohorts the same stream and correlate their replacements.
// ============================================================================
// Shared empty set — a valuation with no promotions allocates nothing.
const EMPTY_PROMOTIONS: Set<string> = new Set();

function reselectRng(
  seed: number, line: CoverageLine, accidentYear: number, valuationYear: number, purpose: string,
): SeededRandom {
  return deriveSubRng(seed, valuationYear, `${lineRngLabel('reselect', line)}:ay${accidentYear}:${purpose}`);
}

// Context needed to process a single line's year. cash is this line's
// allocated SHARE of the pool's shared operating cash (see processYear).
// investments/investedAssets are this line's OWN
// segregated portfolio (Stage 2.9 — carried on LinePoolState, not split from a
// shared pot), and investmentIncome/investmentReturnRate come from this line's
// own seeded draw against its own allocation.
interface LineYearContext {
  instance: GameInstance;
  yearNumber: number;
  calendarYear: number;
  allMarketMembers: Member[];
  // The authoritative per-line enrollment ledger (as of this year's entry,
  // plus earlier-processed lines' same-year updates — irrelevant to this
  // line's own per-line reads). Recruitment eligibility reads from THIS,
  // never from Member.status (see membershipHistory.ts).
  membershipHistory: MembershipHistory;
  // The year's pool-wide loss factor (mean 1), drawn ONCE in processYear and
  // shared by every line — the cross-line aggregate correlation that the
  // per-line commonLossFactor could not express. The WC and GL claim
  // generators consume it; Property still draws its own commonLossFactor and
  // IGNORES this, so there is no double application while it awaits its own
  // generator.
  gPool: number;
  // This line's slice of the year's shock resolution, PROJECTED DOWN from
  // processYear. Absent when nothing is in force, which keeps the no-shock code
  // path textually identical to what it was before shocks existed.
  //
  // A line receives only its OWN effects and cannot see another line's, which
  // is the point: events emit into several lines from one cause, but the
  // coordination happens at pool level and a line-local generator never learns
  // that another line exists.
  shock?: LineShockEffects;
  // The firings that touched this line, for RECORDING. Separate from `shock`
  // because effects are what the generators consume and firings are what the
  // audit page reads — a compounded frequency multiplier no longer knows which
  // events produced it, so the narrative has to travel alongside it.
  shockFirings?: ShockFiring[];
  cash: number;
  investments: number;
  assetAllocation: AssetAllocation;
  investedAssets: number;
  investmentIncome: number;
  investmentReturnRate: number;
  dividendBlocked: boolean; // true when this line carried a negative surplus in from last year
  priorResult?: LineResultSet;
}

// Shared fields this line's year processing updates. Investments are absent —
// each line's ending portfolio goes to its own LinePoolState.investedAssets.
interface LineYearShared {
  cash: number;
  unearnedPremium: number;
  allMarketMembers: Member[];
}

export function processLineYear(
  line: CoverageLine,
  lineState: LinePoolState,
  lineDecisions: LineDecisionSet,
  ctx: LineYearContext
): { updatedLineState: LinePoolState; updatedShared: LineYearShared; result: LineResultSet } {
  const { instance, yearNumber, calendarYear, priorResult } = ctx;

  const priorYearLossRatio = priorResult
    ? priorResult.grossUltimateLoss / Math.max(priorResult.grossPremium, 1)
    : undefined;

  // Moved ahead of the CLF lookup below (was declared just before member
  // movement) — WC's own CLF now needs the book BEFORE it can price, and this
  // is the only book available at that point: last year's ending enrolled
  // members, before this year's movement is computed. Real underwriting has
  // the same constraint (you price off the book you have, not one that
  // hasn't been determined yet); the "preliminary vs final" split already
  // used for estimatedExposure/estimatedPremium below is the same tolerance.
  const currentActiveMembers = lineState.members.filter(m => m.status === 'active');

  // --- Selected Funding Confidence ---
  // CLF is selected by the player and applied after the expected actuarial loss-cost rate is calculated.
  //
  // WC AND GL READ THEIR OWN MEASURED TABLES, NOT FUNDING_CLF_TABLE (finding 38,
  // then repeated for GL). FUNDING_CLF_TABLE is the real pool's measured curve
  // at $20-30B of payroll and cannot describe either line's own distribution.
  //
  // ⚠ THOSE TABLES ARE NOW STATIC AND MEASURED FROM THIS ENGINE — see
  // src/data/clfTables.ts. They replace the interpolated CV-indexed (WC) and
  // lambda-indexed (GL) Monte Carlo grids, which were derived from a MODEL of
  // the draw rather than the draw: measured against the engine, WC's grid
  // over-delivered at every one of nine stops. A static table backtested on the
  // engine cannot carry that class of error.
  //
  // Two consequences of the table being one curve per line: it takes NO book
  // argument (the book holds near 62 members since the membership equilibrium
  // fix, so the size axis bought little), and it is calibrated at the DEFAULT
  // layer placement (declining layers costs up to ~8.9pp of label accuracy —
  // measured, and recorded at clfTables.ts).
  //
  // ⚠ PROPERTY STILL READS THE GENERIC FUNDING_CLF_TABLE, and the REASON it
  // used to be unaffected has expired. This said "it has no Claim/Occurrence
  // objects, was never in scope"; it has had both since its loss-model cutover,
  // and a tower and net funding since dbd9138. The DISPATCH is simply unchanged
  // — Property has no derived table to dispatch to yet.
  //
  // That is now a measured defect, not a neutral gap: the generic table is a
  // gross-basis chart and Property funds net, so its 60% stop delivers 54.3%
  // (-5.7pp) and the error runs -18.7pp to +7.5pp across the range. Sized in
  // scripts/diagnostics/property-clf-basis-report.ts; Property's own derived
  // table is what corrects it.
  const selectedFundingConfidenceLevel = lineDecisions.fundingConfidenceLevel;
  // ⚠ THE PRE-MOVEMENT k_line / k_GL THAT USED TO BE COMPUTED HERE IS GONE.
  // It existed only to index the retired CV/lambda grids, and the static tables
  // take no book argument. The DRAW's own k is unaffected and is still computed
  // further down (computeKLine / computeKGl on memberResult.activeMembers) —
  // that is a different quantity on a different book, and deleting this one does
  // not touch it. Net effect: one full pass over the book, computing two
  // expected-loss sums, removed from the pricing path each line-year.
  // fundingAtExpected bypasses the table entirely: "Expected" is CLF = 1.000
  // exactly, at every book size, every year — not an interpolated value that
  // happens to land close (see the LineDecisionSet.fundingAtExpected comment).
  // Property ignores the flag, same as before.
  const selectedFundingCLF = hasStaticClf(line)
    ? (lineDecisions.fundingAtExpected ? 1.0 : staticClf(line, selectedFundingConfidenceLevel))
    : lookupCLF(selectedFundingConfidenceLevel);

  // --- Expected Actuarial Loss-Cost Rate ---
  // Expected losses evolve independently from pricing decisions.
  //
  // CLF-ONLY PRICING: the Rate Change decision was removed (funding confidence
  // is now the sole pricing lever), so rateLevel no longer has anything to move
  // it — it stays at its starting value forever and pricingAdjustment is
  // therefore permanently 1. Both fields are kept (rateLevel is still stored
  // and displayed) rather than deleted, since removing them was not requested
  // and they remain harmlessly accurate: the rate level really is unchanged.
  const newRateLevel = lineState.rateLevel;
  const pricingAdjustment = newRateLevel / 100;

  const priorRCEffectiveness = lineState.riskControlEffectiveness;

  const newRCEffectiveness = projectedRcEffectiveness(priorRCEffectiveness, lineDecisions.riskControlPct);

  // WC and GL price off their claim generators' OWN analytic expectations, so
  // premium and losses share one basis by construction — the finding-6
  // constraint.
  //
  // Derived ONCE from the neutral book (full canonical roster at RQ 5) and
  // then HELD: they do not track the roster year to year, because k_line/k_GL
  // already make the per-year roster/risk-quality-mix correction. Letting
  // both chase enrollment would double-correct and make the loss ratio wander.
  //
  // Risk control is deliberately ABSENT here while multiplying the draws'
  // frequency (finding 17): applying it to both sides would cancel and rebuild
  // the no-op. Instance lossTrend is likewise absent from the claim lines —
  // GL's 7% social inflation acts on the accident-to-settlement lag, which is
  // year-invariant, so its expectation (and held premium) is constant.
  // lossTrend remains Property-only.
  //
  // ⚠ WC'S FREQUENCY TREND IS NOW PRICED, AND IT DID NOT USE TO BE. The draw has
  // always trended frequency at -1.5%/yr with year 1 as the reference; the price
  // was a single held constant that never saw the year. So realized loss ran below
  // the priced level BY CONSTRUCTION and the gap compounded — 93.5% of expected
  // averaged over ten years, which turned an expected 100.0% combined ratio into a
  // measured 93.9% and accounted for essentially all of the pool's underwriting
  // drift. It was documented as deliberate and inherited from the retired model;
  // it is overturned here.
  //
  // THIS DOES NOT BREAK THE HELD-PURE-PREMIUM RULE. The rule exists because
  // RE-DERIVING the pick each year double-corrects against k_line, which already
  // makes the roster/risk-quality-mix correction, and creates a pricing-chases-
  // roster feedback loop. wcFrequencyTrend is a pure function of yearNumber and
  // one constant — it cannot see the roster — so the derivation stays held and
  // only a deterministic factor is applied on top. Note the WC branch reads the
  // HELD CONSTANT, never lineState.purePremiumPer100, so the factor is applied
  // fresh each year rather than compounding off last year's stored value; only
  // Property's branch compounds, and deliberately.
  // WC'S RATE CARRIES THREE DETERMINISTIC FACTORS, and all three must be here or
  // the draw and the price diverge — the defect finding 37 corrected, and it is
  // reintroduced by adding any one of them without the others.
  //
  //   x wcFrequencyTrend    -1.5%/yr   claims per worker fall
  //   x wcSeverityTrend     +3.67%/yr  each claim costs more
  //   / wageFactor          +3.63%/yr  the rate is per $100 of NOMINAL payroll,
  //                                    and the denominator has grown
  //
  //   net: 0.985 x 1.0367 / 1.0363 = 0.98538  ->  -1.462%/yr
  //
  // The severity and wage factors nearly cancel BY CONSTRUCTION (indemnity
  // benefits are a statutory fraction of wage), which is why the rate trend is
  // very close to the frequency trend alone. Dividing by wageFactor is what makes
  // premium growth come out at freqTrend x sevTrend = +2.115%/yr INDEPENDENT of
  // the wage rate — a useful check: if premium growth moves when only
  // WAGE_INFLATION_PER_YEAR changes, one of these three is missing.
  //
  // Still HELD: WC_HELD_PURE_PREMIUM_PER_100 is derived once from the neutral
  // full-roster expectation. All three factors are pure functions of the year and
  // cannot see the roster, so k_line keeps sole responsibility for the
  // roster/risk-quality-mix correction.
  const newPurePremiumPer100 = currentPurePremiumPer100(line, yearNumber, currentActiveMembers);

  // Preliminary contribution estimate used only for member movement.
  // Final premium is recalculated after member movement because exposure changes.
  // (currentActiveMembers is now declared above, ahead of the CLF lookup.)
  const estimatedExposure = currentActiveMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);

  // --- THE PRICE SIGNAL MEMBERS RESPOND TO ---------------------------------
  //
  // Members react to what they are CHARGED, which is the total member charge
  // rate — pool premium + admin + reinsurance, per $100 of exposure — not the
  // pool premium rate alone. Two derived quantities go into member movement,
  // and they deliberately drive different things:
  //
  //   RATE CHANGE, vs last year's rate, drives RETENTION and SATISFACTION.
  //     Members notice increases year over year.
  //   RATE LEVEL, as the load over pure premium, drives NEW BUSINESS.
  //     Prospects compare levels. A pool overpriced for five straight years
  //     shows no rate CHANGE at all and would otherwise escape entirely.
  //
  // ⚠ A RATE COMPARISON, NOT A BILL COMPARISON, and that is the whole point.
  // Payroll grows every year, so bills grow every year; a member whose payroll
  // rose 4% and whose bill rose 4% has not been asked for more. The rate has
  // the exposure growth already divided out. This is the same basis and the
  // same field pairing fundingConsequence.ts's derivedRateChangePct uses —
  // this year's total member charge rate against lineState.ratePer100, which
  // IS last year's total member charge rate. It is not a second definition of
  // the quantity; it is the same one, sourced inside the engine where the
  // reinsurance cost is tower-aware. fundingConsequence's own reinsurance term
  // is still the legacy percentage-of-premium one and is therefore blind to
  // layersPlaced — calling it here would have made the tower, the single
  // biggest price event in the game, invisible to the channel built to see it.
  //
  // PRELIMINARY, exactly like estimatedPremium above and for the same reason:
  // movement has to run before the final exposure is known, so it is priced off
  // the book we have. For WC/GL the occurrence tower cost is not an estimate at
  // all — occurrenceProgramCost reads the pre-movement book and the year, so
  // the value hoisted here is bit-identical to the one the final charge uses,
  // and it is reused below rather than recomputed.
  const isWcClaimLine = line === 'WC';
  const isGlClaimLine = line === 'GL';
  const isPropertyClaimLine = line === 'Property';
  // ⚠ TWO DIFFERENT QUESTIONS, AND THEY STOPPED HAVING THE SAME ANSWER WHEN
  // PROPERTY GOT ITS GENERATOR. `isClaimLine` used to mean both "draws
  // individual claims" and "runs the per-occurrence tower", which was safe only
  // while exactly the same two lines did both.
  //
  //   isClaimLine  — draws individual Claim/Occurrence objects. All three now.
  //   hasTractableCeded    — prices and cedes through the per-occurrence tower. All
  //                  three now, as of Property's own occurrence layer and
  //                  aggregate. REINSURANCE_PROGRAMS is gone rather than dead.
  //
  // Kept as two separate flags rather than collapsed into one, even though
  // they agree today: the distinction is what let Property's claim generator
  // and its tower land in separate commits, and collapsing them would make
  // that impossible to do again if a fourth line ever needs the same staging.
  //
  // linePricing.quoteLineRates keeps its OWN tower-only test, now also
  // widened to include Property, so the panel and the engine agree without a
  // second definition here.
  const isClaimLine = isWcClaimLine || isGlClaimLine || isPropertyClaimLine;
  const hasTractableCeded = isWcClaimLine || isGlClaimLine || isPropertyClaimLine;
  // WC and Property are the only lines with an aggregate stop-loss (see
  // reinsuranceTower.ts's header on why GL has neither).
  const isAggregateLine = isWcClaimLine || isPropertyClaimLine;

  // --- THE PRE-MOVEMENT QUOTE ------------------------------------------------
  //
  // EXTRACTED TO utils/linePricing.ts AND SHARED WITH THE DECISIONS PANEL. The
  // whole rate stack (tower quote, net-funding deduction, admin on gross,
  // runtime reinsurance price) used to live inline here while the panel that
  // EXPLAINS the price to the player re-derived it from its own formulas — and
  // drifted, silently, to a 73%-high pool premium rate on GL. Parity is
  // structural now: there is one definition and both callers use it.
  //
  // The long notes that lived here on why funding is NET, why the deduction
  // must reflect which layers are placed, and why the aggregate must be netted
  // alongside the occurrence layers, all moved WITH the code — see
  // quoteLineRates. (That list used to end "and why Property is deliberately
  // excluded"; Property is not excluded any more — it nets like the other two
  // as of its own occurrence layer.)
  const estimatedQuote = quoteLineRates({
    line,
    yearNumber,
    members: currentActiveMembers,
    exposure: estimatedExposure,
    purePremiumPer100: newPurePremiumPer100,
    clf: selectedFundingCLF,
    pricingAdjustment,
    layersPlaced: lineDecisions.layersPlaced,
    aggregateStopLevel: lineDecisions.aggregateStopLevel,
  });

  // The occurrence quote is REUSED by the post-movement pass below rather than
  // re-priced: it reads only the pre-movement book and the year, so re-quoting
  // would be a second version of a figure that cannot legitimately differ.
  const placedForCost = hasTractableCeded
    ? normalizeLayersPlaced(line as TowerLine, lineDecisions.layersPlaced)
    : null;
  const towerQuote = estimatedQuote.towerQuote;

  const estimatedPremium = estimatedQuote.poolPremium;
  const estimatedTotalMemberRatePer100 = estimatedQuote.totalMemberChargeRatePer100;

  // vs last year's total member charge rate. NULL when there is no usable
  // prior — see priceSignalFor in membershipEngine for how null is treated.
  const priorTotalMemberRatePer100 = lineState.ratePer100 > 0 ? lineState.ratePer100 : null;
  const rateChangePct = priorTotalMemberRatePer100 !== null
    ? (estimatedTotalMemberRatePer100 / priorTotalMemberRatePer100 - 1) * 100
    : null;
  // Scale-free, so it is comparable across lines and years: what the pool
  // charges per dollar of expected loss.
  const rateLoad = newPurePremiumPer100 > 0
    ? estimatedTotalMemberRatePer100 / newPurePremiumPer100
    : null;

  const memberRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('members', line));

  const memberResult = simulateMemberMovement({
    currentMembers: currentActiveMembers,
    allMarketMembers: ctx.allMarketMembers,
    membershipHistory: ctx.membershipHistory,
    decisions: lineDecisions,
    line,
    currentMemberSatisfaction: lineState.memberSatisfaction,
    currentRiskQuality: lineState.averageRiskQuality,
    surplus: lineState.surplus,
    annualPremium: estimatedPremium,
    priorYearLossRatio,
    rateChangePct,
    rateLoad,
    competitivePressure: instance.marketEnvironment.competitivePressure,
    memberSensitivity: instance.marketEnvironment.memberSensitivity,
    yearNumber,
    calendarYear,
    rng: memberRng,
  });

  const activeExposure = memberResult.activeExposure;

  // ⚠ THE RATE IS RECOMPUTED ON THE POST-MOVEMENT BOOK, and with class rates it
  // genuinely differs from the quoted one. `newPurePremiumPer100` above is the
  // rate members were QUOTED — computed on the book as it stood before anyone
  // joined or left, which is the right basis for a price signal they respond
  // to. Everything from here on prices what the pool ACTUALLY carries, and
  // `activeExposure` is the post-movement exposure, so the rate multiplying it
  // has to be the post-movement blend or the two describe different books.
  //
  // This distinction did not exist before class rates: the held rate was
  // roster-blind, so quoted and charged were the same number and one binding
  // served both. The first cut of this commit kept one binding and left
  // expectedLoss mixing a post-movement exposure with a pre-movement blend —
  // measured worst error 10.8% on a single line-year, mean 0.18%. Caught by
  // asserting the composition residual is exactly zero, which is the check that
  // only becomes possible once four rates are exact.
  const pricedPurePremiumPer100 = currentPurePremiumPer100(line, yearNumber, memberResult.activeMembers);

  const totalMarketExposure = memberResult.totalMarketExposure;
  const marketShare = activeExposure / Math.max(totalMarketExposure, 0.01);

  const updatedAllMembers: Member[] = ctx.allMarketMembers.map(m => {
    const active = memberResult.activeMembers.find(a => a.id === m.id);
    if (active) return active;

    const withdrawn = memberResult.withdrawnMembers.find(w => w.id === m.id);
    if (withdrawn) return withdrawn;

    return m;
  });

  const writtenExposure = activeExposure;

  // Expected loss is based only on payroll and Pure Premium.
  //
  // ⚠ STAYS GROSS, and every consumer of it depends on that. It is the aggregate
  // stop-loss's attachment basis, the reserve basis, and the finding-6 pricing
  // denominator. The net-funding change moves the PREMIUM basis only — it must
  // not move the loss quantities.
  const expectedLoss = activeExposure * pricedPurePremiumPer100 * 10_000;

  // The WC/Property aggregate, priced on the REAL post-movement expectedLoss.
  // Its expected ceded is netted out of the pool premium below alongside the
  // occurrence layers'.
  // ⚠ READ THROUGH normalizeAggregateStopLevel, NOT OFF THE DECISION. Property's
  // aggregate is conditional on its occurrence layer being placed, so a save or
  // a hand-edited decision holding aggregate-with-layer-declined must price as
  // no aggregate rather than as the treaty nobody writes. See that function.
  // Inert on every default run — the default places the layer.
  const aggLevel = placedForCost
    ? normalizeAggregateStopLevel(line as TowerLine, placedForCost, lineDecisions.aggregateStopLevel)
    : -1;
  const aggregateQuote = isAggregateLine && placedForCost && aggLevel >= 0
    ? quoteAggregate(
        line as 'WC' | 'Property', placedForCost, currentActiveMembers,
        expectedLoss, aggLevel, yearNumber,
      )
    : null;

  // NET FUNDING, ALL THREE LINES — see the long note at the preliminary rate
  // above for why the pool premium funds net rather than gross. Property is no
  // longer the exception this line used to name: `hasTractableCeded` is what gates
  // netting, so widening it for Property's occurrence layer widened netting
  // with it, without a second decision being taken here.
  const expectedCededDollars =
    (towerQuote?.expectedCeded ?? 0) + (aggregateQuote?.expectedCeded ?? 0);
  const expectedCededPer100 = expectedCededDollars / Math.max(activeExposure * 10_000, 1);
  const netPurePremiumPer100 = Math.max(0, pricedPurePremiumPer100 - expectedCededPer100);

  const rateAtConfidenceLevelPer100 =
    netPurePremiumPer100 * selectedFundingCLF * pricingAdjustment;

  // ⚠ `poolPremiumRatePer100` AND `adminRatePer100` WERE LOCALS HERE AND ARE GONE.
  // Both existed only to build indicatedFundingRatePer100, and both died with it.
  // The identically-named fields on linePricing's LineRateQuote, on
  // fundingConsequence's book and on HistoricalYear are DIFFERENT declarations in
  // different files and are live — HistoryPage, DecisionsPage and
  // panel-engine-parity-check all read them. Do not follow the name across files
  // and conclude something is still needed here.
  const poolPremium =
    activeExposure * rateAtConfidenceLevelPer100 * 10_000;

  // ⚠ ADMIN STAYS ON THE GROSS EXPECTED LOSS, deliberately. The pool adjusts,
  // reserves and pays a ceded claim in full and only then recovers from the
  // reinsurer, so administering it costs exactly what administering a retained
  // claim costs — ceding transfers the LOSS, not the handling. Moving admin to
  // the net basis would understate the pool's real expense by the cession share:
  // worth 0.13 per $100 on GL at the default all-layers placement, which on a
  // $400M book is about $0.5M/yr of expense the pool would stop collecting for
  // work it still has to do.
  const adminExpense = expectedLoss * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;
  const poolPremiumAndAdminExpense = poolPremium + adminExpense;

  // isWcClaimLine / isGlClaimLine / isClaimLine are now declared further up,
  // above member movement, because the price signal fed into movement needs the
  // reinsurance cost and therefore needs to know which product this line buys.

  // REINSURANCE COST. Sum of the PLACED occurrence layers' premiums, each
  // priced as E[ceded] + lambda x SD[ceded] off the measured
  // per-$100-of-exposure constants, PLUS the aggregate's (WC and Property)
  // runtime-computed premium. This replaced a flat percentage of pool
  // premium, which scaled with the CLF and therefore charged 69% more at 85%
  // confidence than at 60% for IDENTICAL cover — a price with no connection
  // to the risk transferred.
  //
  // COMPUTED FROM THE BOOK AND THE YEAR, not a frozen per-$100 rate times
  // nominal exposure. The old form charged a premium that grew at the wage
  // rate while the cover's value grew with the severity trend, and it applied
  // one book's SD/E to every book size. See towerMoments.ts.
  //
  // The occurrence component is REUSED from above rather than recomputed: it
  // reads only the pre-movement book and the year, so hoisting it to build the
  // price signal did not change it. The aggregate is quoted once, just above,
  // off the real post-movement expectedLoss, and both its premium and its
  // expected ceded come from that single quote.
  //
  // `hasTractableCeded` is exhaustive over CoverageLine today, so towerQuote
  // is never actually null — thrown rather than silently defaulted, so a
  // future line without one fails here instead of billing nothing.
  if (towerQuote === null || !placedForCost) {
    throw new Error(`processLineYear: no tower quote for line ${line}`);
  }
  const reinsuranceCost = towerQuote.premium + (aggregateQuote?.premium ?? 0);

  const totalMemberCharge = poolPremiumAndAdminExpense + reinsuranceCost;
  const totalMemberRatePer100 = totalMemberCharge / Math.max(activeExposure * 10_000, 1);

  // Legacy names remain populated for compatibility with older screens and exports.
  const grossPremium = totalMemberCharge;
  const operatingExpense = adminExpense;
  const riskControlInvestment = poolPremium * lineDecisions.riskControlPct;

  // --- Loss Simulation ---
  // WC and GL generate individual claims (design doc Parts A and B); Property
  // still draws the aggregate member-Gamma below until its generator exists.

  const lossRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('losses', line));

  // The aggregate annual factor for the NON-claim lines.
  //
  // WC IS NOW 1, NOT ctx.gPool. The WC severity rebuild removed the pool-year
  // factor from WC's generation path entirely, so there is no shared factor to
  // report — WC's year-to-year variation comes from its own frequency noise and
  // its severity tail. GL still consumes ctx.gPool, which is why the draw stays
  // (see WC_LOSS_MODEL.poolYearFactor).
  //
  // CONSEQUENCE, DELIBERATE: gPool was the model's ONLY cross-line correlation,
  // so WC is now independent of GL and Property. A bad WC year carries no
  // information about the others.
  // ⚠ PROPERTY NOW JOINS WC AT 1, LEAVING GL THE ONLY CONSUMER OF gPool. Its
  // generator draws its own frequency noise and carries its own tail;
  // multiplying that by a shared annual factor would double-count volatility
  // the fitted mixture already contains. The consequence is that gPool — the
  // model's only cross-line correlation — now links nothing, GL being its sole
  // reader. A REDUCTION IN CROSS-LINE CORRELATION, deliberate, and one to argue
  // for explicitly if a shared factor is ever wanted back.
  const commonLossFactor = isWcClaimLine || isPropertyClaimLine
    ? 1
    : isClaimLine
    ? ctx.gPool
    : lossRng.lognormal(
        AGGREGATE_LOSS_DISTRIBUTION.logMean,
        AGGREGATE_LOSS_DISTRIBUTION.logSigma
      ) * AGGREGATE_LOSS_DISTRIBUTION.actualLossLevelMultiplier;
  const catastropheThreshold =
    FUNDING_CLF_TABLE[AGGREGATE_LOSS_DISTRIBUTION.catastropheThresholdConfidence];
  const catastropheFactor = 1;

  let generatedClaims: Claim[] | undefined;
  let generatedOccurrences: Occurrence[] | undefined;
  let wcCountsByClass: Record<string, number> | undefined;
  let wcCountsByTier: Record<string, number> | undefined;
  let glClaimCount: number | undefined;
  let memberLossResults: MemberLossResult[];
  let aggregateMemberLoss: number;
  let marketMemberLossResults: MemberLossResult[] | undefined;
  // The mix correction actually applied to the draw — see LineResultSet.kLineApplied.
  let kLineApplied: number | undefined;
  let shockOccurred: boolean;

  // --- MARKETPLACE-WIDE GENERATION -------------------------------------------
  //
  // Claims are generated for ALL 200 canonical members every year. Only the
  // ENROLLED subset feeds pool losses, premium, reserves and reinsurance;
  // prospect claims exist solely as loss HISTORY, so that a prospect arrives
  // with a readable record instead of a blank one and adverse selection becomes
  // something the player can actually read.
  //
  // TWO GENERATOR CALLS, NOT ONE OVER 200, AND THAT IS THE POINT. k_line and
  // riskControlEffectiveness are properties of POOL MEMBERSHIP — k_line is the
  // enrolled book's risk-quality-mix correction, and risk control is a service
  // members buy. Applying either to a prospect would be wrong twice over: it
  // would give non-members free safety consulting, and it would make a
  // prospect's loss history depend on the enrolled book's RQ mix, which is
  // exactly the incoherence the per-member stream keying removed. So prospects
  // generate at kLine/kGl = 1 and rc = 0.
  //
  // Splitting the call costs nothing in draw terms: since stage 1, every
  // member-level stream is keyed on (seed, year, memberId), so a member's claims
  // are identical whether generated alone, with the pool, or with the whole
  // marketplace. Enrolment independence is what makes the split free —
  // asserted in scripts/diagnostics/enrolment-independence-check.ts.
  const enrolledMemberIds = new Set(memberResult.activeMembers.map(m => m.id));
  const marketplaceProspects = ctx.allMarketMembers.filter(m => !enrolledMemberIds.has(m.id));

  // Shock cost, accumulated per shockId by the effect application below and
  // read once at result assembly. Empty when no shock is in force.
  //
  // TWO SEPARATE NUMBERS, ON PURPOSE. An injected claim has an exactly
  // attributable cost. A frequency multiplier does NOT — a multiplied Poisson
  // draw cannot be decomposed into "the base claims" and "the extra ones", and
  // recovering it would need a counterfactual second draw of the whole line. So
  // the exact figure is reported where it exists and the analytic expectation
  // where it does not, and they are never summed into one misleading total.
  const shockAttributableLoss: Record<string, number> = {};
  const shockAttributableClaims: Record<string, number> = {};
  const shockExpectedAdded: Record<string, number> = {};

  if (isWcClaimLine) {
    // k_line is recomputed against the CURRENTLY ENROLLED book, after member
    // movement — it is the roster/risk-quality-mix correction, and the reason
    // purePremiumPer100 can be held constant instead of chasing enrollment.
    //
    // ⚠ ENROLLED BOOK, NOT THE FULL ROSTER. Marketplace-wide generation makes it
    // tempting to hand the 200-member roster to everything below; doing it here
    // would drive k_line to ~1 permanently and silently disable the correction.
    const kLine = computeKLine(memberResult.activeMembers);

    const generated = generateWcClaims({
      members: memberResult.activeMembers,
      yearNumber,
      calendarYear,
      instanceSeed: instance.seed,
      kLine,
      // Current-horizon component arrival-rate multipliers, DRAW ONLY like risk
      // control.
      //
      // ⚠ THEY DO NOT REACH PREMIUM, AND THAT IS THE POINT (ruled). The priced
      // expectedLoss is activeExposure x the HELD purePremiumPer100, not this
      // generator's analytic, so a legislative change raises realized losses
      // while premium stands still. The player must re-rate or bleed — a law
      // that makes claims more expensive does not politely raise your rates
      // for you. Do not "fix" this.
      componentFreqMultipliers: ctx.shock?.componentFreqMultipliers,
      // Risk control acts on the DRAW ONLY (finding 17): it reduces realized
      // frequency without touching the pricing expectation, so it genuinely
      // moves the loss ratio instead of cancelling out.
      riskControlEffectiveness: newRCEffectiveness,
      injections: ctx.shock?.injections,
    });
    // PROSPECTS: the rest of the 200-member marketplace, generated at kLine = 1
    // and rc = 0. See the marketplaceProspects note above for why those two are
    // withheld and why this is a SECOND CALL rather than one call over 200.
    const prospectGenerated = marketplaceProspects.length > 0
      ? generateWcClaims({
        members: marketplaceProspects,
        yearNumber,
        calendarYear,
        instanceSeed: instance.seed,
        kLine: 1,
        riskControlEffectiveness: 0,
        // Market-wide conditions DO reach prospects: a statutory change or a bad
        // year is not a pool membership benefit. Pool-specific claim injections
        // do NOT — those are events landing on the pool's own book.
        componentFreqMultipliers: ctx.shock?.componentFreqMultipliers,
      })
      : undefined;
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    wcCountsByClass = generated.claimCountsByGroup;
    wcCountsByTier = generated.claimCountsByComponent;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    marketMemberLossResults = [
      ...generated.memberLossResults,
      ...(prospectGenerated?.memberLossResults ?? []),
    ];
    kLineApplied = kLine;

    // WC's shock flag: a claim from the heavy mixture component large enough to
    // matter. Replaces the retired "a catastrophic-tier claim occurred" test,
    // which named a tier that no longer exists. $1M is the per-occurrence
    // retention, so this reads as "the pool had a claim that pierced retention".
    shockOccurred = generated.claims.some(c => c.grossUltimate >= 1_000_000);

    // EXACT attribution: the engine returns one outcome per requested
    // injection, in order, and ctx.shock.injections carries the shockId that
    // asked for each. No estimation involved — these are specific claims.
    (ctx.shock?.injections ?? []).forEach((injection, i) => {
      const outcome = generated.injectionResults[i];
      if (!outcome) return;
      shockAttributableLoss[injection.shockId] = (shockAttributableLoss[injection.shockId] ?? 0) + outcome.gross;
      shockAttributableClaims[injection.shockId] = (shockAttributableClaims[injection.shockId] ?? 0) + outcome.count;
    });

    // EXPECTED cost of any component multiplier in force, per event, measured
    // against the unshocked book with WC's own analytic. Reconstructing the
    // expectation here would create a second definition of WC's expected loss.
    //
    // PRICING BASIS on both sides: the difference is what the EVENT adds, and
    // measuring it on a basis that includes the risk-quality severity tilt would
    // fold the book's RQ mix into a figure attributed to the shock.
    if (ctx.shock?.componentFreqMultipliers && ctx.shockFirings?.length) {
      const baseline = expectedWcGrossLossForPricing(memberResult.activeMembers, { kLine, yearNumber });
      for (const firing of ctx.shockFirings) {
        const multipliers = ownComponentFreqMultipliers(firing.shockId, 'WC');
        if (!multipliers) continue;
        shockExpectedAdded[firing.shockId] = expectedWcGrossLossForPricing(memberResult.activeMembers, {
          kLine, yearNumber, componentFreqMultipliers: multipliers,
        }) - baseline;
      }
    }
  } else if (isGlClaimLine) {
    // Same discipline as WC: k_GL is the per-year roster/risk-quality-mix
    // correction against the currently enrolled book; the pure premium itself
    // is held (step 6b) rather than chasing enrollment.
    // ⚠ ENROLLED BOOK, NOT THE FULL ROSTER — same trap as WC's k_line above.
    const kGl = computeKGl(memberResult.activeMembers, yearNumber);
    const generated = generateGlClaims({
      members: memberResult.activeMembers,
      yearNumber,
      calendarYear,
      instanceSeed: instance.seed,
      kGl,
      gPool: ctx.gPool,
      // Risk control acts on the DRAW ONLY (finding 17), as in WC.
      riskControlEffectiveness: newRCEffectiveness,
      // Shock frequency multipliers, also DRAW ONLY and for the same reason: a
      // shock is a realized event, not a repricing.
      freqMultipliers: ctx.shock?.freqMultipliers,
      sevMultipliers: ctx.shock?.sevMultipliers,
    });
    // PROSPECTS at kGl = 1, rc = 0 — see the marketplaceProspects note above.
    const prospectGenerated = marketplaceProspects.length > 0
      ? generateGlClaims({
        members: marketplaceProspects,
        yearNumber,
        calendarYear,
        instanceSeed: instance.seed,
        kGl: 1,
        riskControlEffectiveness: 0,
        freqMultipliers: ctx.shock?.freqMultipliers,
        sevMultipliers: ctx.shock?.sevMultipliers,
        gPool: ctx.gPool,
      })
      : undefined;
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    glClaimCount = generated.claimCount;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    marketMemberLossResults = [
      ...generated.memberLossResults,
      ...(prospectGenerated?.memberLossResults ?? []),
    ];
    kLineApplied = kGl;
    // GL's shock event (ruled J11): any single occurrence exceeds $1M.
    // Occurrence == claim for GL now, so this is the largest single claim.
    shockOccurred = generated.maxOccurrenceGross > 1_000_000;

    // The EXPECTED cost of any frequency shock on this line, attributed per
    // event. Computed as the difference between GL's own analytic expectation
    // with and without the multipliers, rather than reconstructed — a second
    // definition of GL's expected loss would drift from the first.
    //
    // PER EVENT INDEPENDENTLY: each firing is priced against the unshocked
    // baseline using only its OWN effects. When two events compound on GL
    // (both are whole-line multipliers now — no sub-coverage left to target)
    // their individual figures therefore do not sum to the combined effect,
    // which is correct — each answers "what did this event add", not "how do
    // we split the interaction".
    if ((ctx.shock?.freqMultipliers || ctx.shock?.sevMultipliers) && ctx.shockFirings?.length) {
      const baseline = expectedGlGrossLossForPricing(memberResult.activeMembers, { yearNumber, kGl });
      for (const firing of ctx.shockFirings) {
        const ownFreq = ownFreqMultipliers(firing.shockId, 'GL');
        const ownSev = ownSevMultipliers(firing.shockId, 'GL');
        if (!ownFreq && !ownSev) continue;
        // A SEVERITY multiplier scales the whole expectation linearly, so it is
        // applied here rather than threaded into the expectation's options: the
        // analytic has no severity-shock parameter, and giving it one would put
        // a shock inside the PRICING function, which is exactly what must not
        // happen. This stays a measurement of the event's cost.
        const sevFactor = ownSev?.[WHOLE_LINE] ?? 1;
        const shocked = expectedGlGrossLossForPricing(memberResult.activeMembers, {
          yearNumber, kGl, ...(ownFreq ? { freqMultipliers: ownFreq } : {}),
        }) * sevFactor;
        shockExpectedAdded[firing.shockId] = shocked - baseline;
      }
    }
  } else if (isPropertyClaimLine) {
    // PROPERTY, CUT OVER. Same discipline as WC and GL: the pure premium is
    // HELD and k_Pr is the per-year roster/risk-quality-mix correction against
    // the ENROLLED book — not the full roster, which is the trap both other
    // lines carry a warning about.
    const kPr = computeKPr(memberResult.activeMembers);
    const generated = generatePropertyClaims({
      members: memberResult.activeMembers,
      yearNumber,
      calendarYear,
      instanceSeed: instance.seed,
      kPr,
      // Risk control acts on the DRAW ONLY (finding 17), as in WC and GL.
      riskControlEffectiveness: newRCEffectiveness,
    });
    generatedClaims = generated.claims;
    generatedOccurrences = generated.occurrences;
    memberLossResults = generated.memberLossResults;
    aggregateMemberLoss = generated.grossUltimateLoss;
    kLineApplied = kPr;
    glClaimCount = generated.claimCount;
    // ⚠ NO SHOCK CHANNEL, AND NO CAT LOAD EITHER — the two facts belong
    // together. Property's shock used to arrive as an aggregate add-on keyed
    // off commonLossFactor, which went with the Gamma path; its replacement is
    // the cat shock events, still gated off. The held pure premium therefore no
    // longer carries the ASSERTED 0.0247 cat load: a line that cannot incur a
    // peril must not be priced for it, and the load is now recorded as retired
    // at PROPERTY_HELD_PURE_PREMIUM_PER_100 rather than collected.
    //
    // WHEN THE CAT BAND LANDS, THE LOAD AND THE LOSSES GO BACK IN THE SAME
    // COMMIT. Restoring either alone recreates the defect: the load alone is a
    // certain over-collection, the losses alone a certain under-collection.
    //
    // ⚠ AND WHEN IT DOES, EACH CAT EVENT MUST BE ONE OCCURRENCE, NOT ONE
    // OCCURRENCE PER MEMBER HIT. The occurrence tower above already groups
    // claims by occurrenceId before layering (see reinsuranceTower.ts's
    // occurrenceTotals and the header note in data/reinsuranceTower.ts) — it
    // requires no change to price a multi-claim cat event correctly. The
    // requirement is entirely on the generator: `generatePropertyClaims`'s cat
    // band must emit one Occurrence per event with every hit member's claim in
    // that occurrence's claimIds, the same shape a GL abuse batch or WC's
    // (retired) weather band used. Get this wrong — one occurrence per claim,
    // as today's attritional band correctly does for a single loss — and a
    // catastrophe that should pierce the $5M retention as one $74M occurrence
    // instead looks like twenty $3.7M claims, none of which reaches it.
    shockOccurred = false;
  } else {
    shockOccurred = commonLossFactor > catastropheThreshold;
    memberLossResults = memberResult.activeMembers.map(member => {
      const memberExposureAmount = getMemberExposure(member, line, yearNumber);
      const memberExpectedLoss = memberExposureAmount * pricedPurePremiumPer100 * 10_000;
      const riskQuality = Math.max(1, Math.min(10, member.riskQuality));
      const coefficientOfVariation = MEMBER_LOSS_VOLATILITY.worstRiskCV
        + ((riskQuality - 1) / 9)
          * (MEMBER_LOSS_VOLATILITY.bestRiskCV - MEMBER_LOSS_VOLATILITY.worstRiskCV);
      const standardDeviation = memberExpectedLoss * coefficientOfVariation;
      const shape = 1 / (coefficientOfVariation * coefficientOfVariation);
      const scale = memberExpectedLoss * coefficientOfVariation * coefficientOfVariation;
      const independentLoss = lossRng.gamma(shape, scale);

      return {
        memberId: member.id,
        memberName: member.name,
        exposure: memberExposureAmount,
        riskQuality: member.riskQuality,
        expectedLoss: memberExpectedLoss,
        coefficientOfVariation,
        standardDeviation,
        simulatedLoss: independentLoss * commonLossFactor * catastropheFactor,
      };
    });
    aggregateMemberLoss = memberLossResults.reduce(
      (sum, memberLoss) => sum + memberLoss.simulatedLoss,
      0
    );
  }

  // ⚠ shockLossAmount WAS COMPUTED HERE AND IS DELETED. It read
  // `shockOccurred && !isClaimLine ? ... : 0`, and its own comment said the
  // add-on "only exists for the aggregate (Property) path" — but isClaimLine
  // became true for all three lines when Property got its claim generator, so the
  // condition had been `shockOccurred && false` ever since. Structurally zero, not
  // merely unobserved: measured at exactly 0 on every line-year, both arms.
  //
  // KEEP-THE-DRAW: the expression consumed no RNG. It read expectedLoss,
  // commonLossFactor and catastropheThreshold, all already computed, and both of
  // the latter remain referenced by the aggregate path below — so no stream moves.
  //
  // ⚠ THE AGGREGATE PATH ITSELF IS ALSO UNREACHABLE and is NOT removed here. The
  // `else` branch below (`shockOccurred = commonLossFactor > catastropheThreshold`
  // and the Gamma member-loss draw under it) is the `!isClaimLine` path, dead by
  // the same test — and it contains lossRng draws, so removing it is a
  // keep-the-draw question of its own rather than a tidy-up. Left standing and
  // reported.

  let grossUltimateLoss = aggregateMemberLoss;

  grossUltimateLoss = Math.max(0, grossUltimateLoss);

  // --- REINSURANCE: the per-occurrence tower, all three lines ---------------
  //
  // WC, GL and Property all run the PER-OCCURRENCE TOWER (cap -> retention ->
  // layers, then the aggregate stop-loss — WC and Property only — on what
  // remains retained). REINSURANCE_PROGRAMS, `reinsuranceLevel` and
  // reinsuranceEngine.ts are gone; `hasTractableCeded` is exhaustive over
  // CoverageLine today, so the branch below never actually takes the `else` —
  // kept as a real predicate (rather than collapsed to `true`) and thrown
  // rather than silently defaulted, so a future line without a closed-form
  // E[ceded] fails here instead of silently retaining everything.
  let reinsuranceRecovery: number;
  let cededByLayer: number[] = [];
  let retainedAboveTower = 0;
  let aggregateRecoveryAmount = 0;
  let aggregatePremium = 0;
  let aggregateAttachment = 0;

  if (hasTractableCeded) {
    const towerLine = line as TowerLine;
    const placed = normalizeLayersPlaced(towerLine, lineDecisions.layersPlaced);
    const totals = occurrenceTotals(generatedClaims ?? [], generatedOccurrences ?? []);
    const cession = cedeOccurrences(towerLine, totals, placed);
    cededByLayer = cession.cededByLayer;
    retainedAboveTower = cession.retainedAboveTower;

    // The aggregate sits on RETAINED loss, so it applies AFTER the occurrence
    // layers — including loss retained through layers the player DECLINED. That
    // scope is what makes the aggregate respond to the layer selection at all.
    // Same normalization as the pricing side above, so the cession and the
    // price can never disagree about whether an aggregate exists.
    const cededAggLevel = normalizeAggregateStopLevel(towerLine, placed, lineDecisions.aggregateStopLevel);
    if ((towerLine === 'WC' || towerLine === 'Property') && cededAggLevel >= 0) {
      const quote = quoteAggregate(
        towerLine,
        placed,
        currentActiveMembers,
        expectedLoss,
        cededAggLevel,
        yearNumber,
      );
      aggregatePremium = quote.premium;
      aggregateAttachment = quote.attachment;
      aggregateRecoveryAmount = aggregateRecovery(cession.retained, quote);
    }

    reinsuranceRecovery = cession.totalCeded + aggregateRecoveryAmount;
  } else {
    throw new Error(`processLineYear: no tractable ceded reinsurance for line ${line}`);
  }

  const netUltimateLoss = grossUltimateLoss - reinsuranceRecovery;

  // --- Investment Income ---
  // This line's own segregated portfolio (Stage 2.9): drawn in processYear from
  // this line's own invested assets and its own asset allocation.
  const investedAssets = ctx.investedAssets;
  const investmentIncome = ctx.investmentIncome;
  const investmentReturnRate = ctx.investmentReturnRate;

  // --- Reserve Development (IBNER) ---
  // Process existing reserve cohorts. These are accounting reserve cohorts.
  // CLF does not multiply booked reserves.
  //
  // ⚠ A NEW NAMED SUB-STREAM, NOT `dev`. The old mechanism drew one uniform per
  // open cohort from `dev`, and separately spent a `dev` draw filling the
  // never-read developmentFactor field. IBNER's draw count and shape both
  // differ, so reusing that label would have re-rolled the stream in a way that
  // confounds the mechanism change with a reseed. `ibner` is its own stream;
  // `dev` is retired with the function that consumed it.
  const ibnerRng = deriveSubRng(instance.seed, yearNumber, lineRngLabel('ibner', line));

  const {
    developmentImpact,
    updatedCohorts,
    netPaidThisYear,
    developmentCeded,
    unallocatedDevelopment,
  } = processIbner(lineState.reserveCohorts, line, ibnerRng, instance.instanceId, instance.seed, yearNumber);
  void unallocatedDevelopment;   // surfaced by the harness, not by the result

  // Current year reserve assumption: 60% unpaid, 40% paid. NET basis —
  // reinsurance recovery cash arrives in lockstep with the claim payments it
  // offsets, so losses enter the reserve rollforward net of recoveries and no
  // separate recoverable receivable exists.
  //
  // THE ACCIDENT YEAR'S INITIAL BOOKING. netUltimateLoss is the register sum —
  // exactly what the generator drew, net of the tower — and it is frozen as
  // `registerSum`. What gets BOOKED is that figure less the optimistic bias,
  // which then unwinds over the horizon (see the IBNER_* block).
  const bookingBias = ibnerBookingBias(selectedFundingCLF);

  // ⚠ THE REGISTER IS BUILT AND MARKED DOWN BEFORE THE RESERVE IS BOOKED, and
  // the ordering is load-bearing: bookedUltimate depends on the give-back the
  // markdown produces. Tracked occurrences are everything at or above the
  // retention plus the carriers; the layers in force THIS year are frozen with
  // them, because occurrence cover attaches to the accident year rather than the
  // valuation year.
  //
  // ⚠ THE rng ARGUMENT IS ONLY REACHED ON THE sizeWeighted BRANCH. Under the
  // default selection this consumes no draw, which is what lets the null test
  // read against the pre-mechanism parent.
  const placedAtInception = hasTractableCeded
    ? normalizeLayersPlaced(line as TowerLine, lineDecisions.layersPlaced)
    : undefined;

  //
  // ⚠ THE BENCH TAKES ITS PICKS FROM A DIFFERENT STREAM, and that is why this
  // commit does not re-roll a single game. The carriers still take exactly
  // DEVELOPMENT_ALLOCATION.claimCount draws from `ibnerRng`, in the same order,
  // at the same point; the bench's draws come from a reselection stream. See
  // reselectRng above and developmentAllocation.ts's RESELECTION block.
  const trackedSet = DEVELOPMENT_CESSION_ENABLED && hasTractableCeded
    ? buildTrackedSet(
        line as TowerLine,
        (generatedOccurrences ?? []).map(o => o.id),
        (generatedOccurrences ?? []).map(o => o.claimIds[0] ?? o.id),
        occurrenceTotals(generatedClaims ?? [], generatedOccurrences ?? []),
        DEVELOPMENT_ALLOCATION,
        ibnerRng,
        reselectRng(instance.seed, line, yearNumber, yearNumber, 'bench'),
      )
    : { tracked: [], untrackedTotal: 0, bench: [] };

  // ⚠ MARKED DOWN BY THE COHORT'S OWN BIAS DOLLARS — registerSum x bias, the
  // same amount the unwind will add back — so the unwind restores the claims TO
  // their drawn values rather than pushing them PAST. Not subsetDrawn x bias:
  // the unwind's total is set by the cohort, so the markdown has to be too or
  // the two do not cancel and the residual cedes.
  const markdown = DEVELOPMENT_CESSION_ENABLED && hasTractableCeded && placedAtInception
    ? markDownForBooking(line as TowerLine, trackedSet, netUltimateLoss * bookingBias, placedAtInception)
    : { tracked: trackedSet.tracked, bench: trackedSet.bench, untrackedTotal: trackedSet.untrackedTotal, giveBack: 0, markedDown: 0 };

  // THE ACCIDENT YEAR'S INITIAL BOOKING. netUltimateLoss is the register sum —
  // exactly what the generator drew, net of the tower — and it is frozen as
  // `registerSum`. What gets BOOKED is that figure less the optimistic bias,
  // which then unwinds over the horizon (see the IBNER_* block).
  //
  // ⚠ LESS THE BIAS, PLUS THE RECOVERABLE FORFEITED BY BOOKING LOW. Marking the
  // claim register down removes GROSS dollars, and part of those dollars would
  // have been the reinsurer's — so the pool's NET liability falls by less than
  // the gross markdown. `markdown.giveBack` is negative, hence the subtraction.
  //
  // Without this term the reserve identity breaks: netUltimate lands short of
  // registerSum at maturity by exactly the give-back, because the unwind's
  // cession then has nothing to offset against. With no bias, or with the
  // mechanism off, giveBack is 0 and this is netUltimateLoss x (1 - bias)
  // unchanged — which is what the null test asserts.
  const bookedUltimate = netUltimateLoss * (1 - bookingBias) - markdown.giveBack;

  // ⚠ ONE PATTERN, READ IN TWO PLACES. reserveStepSigma derives its scale from
  // the SAME payout pattern, because the share of the ultimate still unpaid is
  // exactly what sets how much leverage a reserve walk has. Writing the opening
  // split here and again in the derivation would let a change to one drift from
  // the other, and the symptom would be a line quietly developing at the wrong
  // scale. This was IBNER_OPEN_FRACTION, one number for all three lines; it is
  // now each line's own, and they are 59.0% / 90.4% / 49.6%.
  const openFraction = unpaidShare(LINE_PAYOUT_PATTERN[line], 1);
  const currentYearNetReserve = bookedUltimate * openFraction;
  const netPaidCurrentYear = bookedUltimate * (1 - openFraction);

  // --- THE GROSS PAID LEDGER OPENS HERE ------------------------------------
  // The BOOKED GROSS register: the tracked occurrences at their booked values
  // plus the untracked remainder, which is what markDownForBooking left behind.
  // Not grossUltimateLoss — that is the register BEFORE the optimistic markdown,
  // and opening the gross ledger above the net one would make paid-to-incurred
  // read low for a reason that is a booking decision rather than payment.
  //
  // ⚠ THE SAME openFraction AS THE NET SPLIT, deliberately: the payout pattern
  // is a property of the LINE, not of a basis. Gross and net pay down on one
  // schedule and differ only by what the tower takes off the development.
  //
  // A cohort with no register — mechanism off, or a line without a tractable
  // tower — has nothing gross to track, so the ledger opens at the net figures
  // and stays equal to them. That is the honest default: without claims there is
  // no gross/net distinction to record.
  const grossRegisterBooked = markdown.tracked.length > 0 || (markdown.untrackedTotal ?? 0) > 0
    ? markdown.tracked.reduce((s, d) => s + d.original, 0) + (markdown.untrackedTotal ?? 0)
    : bookedUltimate;
  const grossUnpaidCurrentYear = grossRegisterBooked * openFraction;
  const grossPaidCurrentYear = grossRegisterBooked * (1 - openFraction);

  const currentYearCohort: ReserveCohort = {
    yearNumber,
    calendarYear,
    netUltimate: bookedUltimate,
    netPaid: netPaidCurrentYear,
    netUnpaid: currentYearNetReserve,
    grossPaid: grossPaidCurrentYear,
    grossUnpaid: grossUnpaidCurrentYear,
    closed: false,
    registerSum: netUltimateLoss,
    horizon: ibnerRng.intRange(IBNER_HORIZON[line].min, IBNER_HORIZON[line].max),
    age: 0,
    stepMultiplier: drawStepMultiplier(ibnerRng),
    bookingBias,
    developingClaims: markdown.tracked,
    untrackedTotal: markdown.untrackedTotal,
    // Omitted rather than stored empty, so a cohort with no replacements to
    // offer carries no field at all.
    developmentBench: markdown.bench.length > 0 ? markdown.bench : undefined,
    cededDevelopmentToDate: markdown.giveBack,
    placedAtInception,
  };

  const allCohorts = [...updatedCohorts, currentYearCohort];

  // ⚠ THE IBNR PROVISION THAT STOOD HERE IS GONE, WITH WC'S REPORT LAG.
  //
  // WHY, so the intent survives the deletion. WC was the only line with a report
  // lag: GL had zero references to one and Property a single comment. That made
  // WC's grossUltimateLoss a CALENDAR-year reported figure while GL's and
  // Property's were ACCIDENT-year — one field meaning two different things
  // depending on the line, which is what surfaced this.
  //
  // ⚠ THIS IS A REPLACEMENT, NOT AN ABANDONMENT. IBNR is retired in favour of
  // IBNER: claims reported immediately but booked at an initial estimate below
  // ultimate, converging over several years. That is the better mechanic on four
  // counts, and each is a reason this removal loses nothing:
  //   it applies to ALL THREE LINES, not to WC alone
  //   it needs no deferral architecture — no inventory, no carry-forward, no
  //     per-claim reportYear, none of the machinery just deleted
  //   it makes reserve development a REAL quantity rather than a random wobble
  //   and it is already open item 9: claims are drawn at ultimate and never
  //     develop, so the reserve cannot currently be wrong in an interesting way
  //
  // What went with it: the per-component p_delayed draw and the lognormal lag,
  // the unreported-claim inventory and its carry-forward, wcIbnr.ts and its
  // chain-ladder, emergedGross / newlyDelayed / delayedGross / delayedCount, and
  // ibnrReserve / ibnrAccrual. currentAccidentYearGross collapsed into
  // grossUltimateLoss because with no deferral they are the same number.
  //
  // ⚠ THE GAP THIS NOTE PREDICTED IS NOW CLOSED. It read: "priorYearDevelopment
  // IS NOW PURE WOBBLE... reserve development is a random walk with nothing
  // behind it until IBNER lands, which is precisely the gap IBNER is meant to
  // fill." IBNER has landed — see processIbner below and the IBNER_* block in
  // defaultAssumptions. priorYearDevelopment now reads a per-cohort estimate of
  // ultimate that develops on its own horizon and stops, biased at inception by
  // the funding decision, so it is a reserving quantity rather than noise.

  // --- Accounting Reserves ---
  // These are expected unpaid losses (net of reinsurance) from all accident
  // years. They are the booked balance sheet reserves and are NOT CLF-loaded.
  //
  // Case cohorts only, now that IBNR is gone. Every line's reserve is the same
  // quantity again.
  const endingNetReserve = allCohorts.reduce((s, c) => s + c.netUnpaid, 0);

  // Reserve-weighted across the cohorts actually held, at each one's own age.
  // `age` has already been incremented for the cohorts that ran through
  // processIbner and is 0 on the year's own, so `age + 2` is the pattern age of
  // the step each will take NEXT year in both cases.
  const nextYearPaydownRate = endingNetReserve > 0
    ? allCohorts.reduce(
        (s, c) => s + c.netUnpaid * conditionalPaydown(LINE_PAYOUT_PATTERN[line], c.age + 2), 0,
      ) / endingNetReserve
    : 0;

  const expectedNetUnpaidLoss = endingNetReserve;

  const beginningNetReserve = lineState.reserveCohorts.reduce((s, c) => s + c.netUnpaid, 0);

  // --- Income Statement ---
  // Use reserve-rollforward incurred loss so the income statement and balance sheet tie.
  // This keeps the financial statement logic consistent with the reserve accounting.
  const assessments = poolPremium * lineDecisions.assessmentPct;
  // A line carrying a negative surplus into the year (declined a loan) cannot pay
  // a dividend — the decision is blocked regardless of what was requested.
  const effectiveDividendPct = ctx.dividendBlocked ? 0 : lineDecisions.dividendPct;
  const dividends = poolPremium * effectiveDividendPct;

  // Keep this as a displayed reserve development metric (net basis).
  // Do not add it separately to net income because reserve development is already captured
  // in the incurred loss formula below through the change in unpaid reserves.
  const priorYearDevelopment = developmentImpact;

  const netPaidLossesThisYear = netPaidCurrentYear + netPaidThisYear;

  const netIncurredLoss =
    netPaidLossesThisYear +
    endingNetReserve -
    beginningNetReserve;

  // Underwriting Income excludes investment income: it is the pool's premium/assessment
  // revenue net of losses (incl. reserve development), expenses, risk control, reinsurance,
  // and dividends returned to members. Assessments and dividends are treated as offsets to
  // premium since they are collected/returned through the same member-charge mechanism.
  const underwritingIncome =
    totalMemberCharge +
    assessments -
    netIncurredLoss -
    operatingExpense -
    riskControlInvestment -
    reinsuranceCost -
    dividends;

  const netIncome = underwritingIncome + investmentIncome;

  // --- Balance Sheet ---
  // Balance sheet liabilities use expected unpaid losses, not CLF-loaded targets.
  // To keep the game model clean, written premium is treated as collected and earned in the year.
  // Unearned premium is held at zero rather than creating a separate timing layer.
  const beginingSurplus = lineState.surplus;

  const unearnedPremium = 0;

  const beginningCash = ctx.cash;

  const newCash =
    beginningCash +
    totalMemberCharge +
    assessments -
    netPaidLossesThisYear -
    operatingExpense -
    riskControlInvestment -
    reinsuranceCost -
    dividends;

  const beginningInvestments = ctx.investments;
  const investmentsBeforeSweep = Math.max(0, beginningInvestments + investmentIncome);

  // Sweep cash above the operating target into investments (where it earns a
  // return going forward); draw down investments to cover a cash shortfall
  // instead of letting it silently vanish. Total assets (cash + investments)
  // are conserved by this reallocation, except at the floor below.
  const operatingCashTarget = totalMemberCharge * OPERATING_CASH_PCT_OF_PREMIUM;
  let endingCash: number;
  let endingInvestments: number;
  if (newCash >= operatingCashTarget) {
    endingCash = operatingCashTarget;
    endingInvestments = investmentsBeforeSweep + (newCash - operatingCashTarget);
  } else {
    const shortfall = operatingCashTarget - newCash;
    const drawFromInvestments = Math.min(shortfall, investmentsBeforeSweep);
    endingCash = newCash + drawFromInvestments;
    endingInvestments = investmentsBeforeSweep - drawFromInvestments;
  }
  // No flooring at zero here: a line in deep distress can legitimately carry
  // negative cash (its portfolio is exhausted and it owes more than it holds).
  // Flooring would silently create assets and break the surplus tie-out.
  // Healthy games never reach this state (v4 baselines all tie out at 0).

  const totalAssets =
    endingCash +
    endingInvestments;

  const totalLiabilities =
    endingNetReserve +
    unearnedPremium;

  const endingSurplus = totalAssets - totalLiabilities;

  // --- Surplus Rollforward Validation ---
  const surplusFromIncome = beginingSurplus + netIncome;
  const surplusTieOutDifference = endingSurplus - surplusFromIncome;

  // --- CLF / Funding Confidence Logic ---
  // CLF is used to build the funding rate. It is NOT used to book accounting reserves.
  const clfAdjustedExpectedLoss = expectedLoss * selectedFundingCLF;

  // In this simplified contribution model, the selected CLF produces the contribution rate charged to members.
  // Operating expense, reinsurance, and risk control remain separate expenses.

  // B. Reserve Confidence View
  // This is an indicated confidence-level view, not the booked accounting reserve.
  const netFundingTarget = expectedNetUnpaidLoss * selectedFundingCLF;
  const indicatedNetReserveAtConfidenceLevel = netFundingTarget;

  // Required reserve margin is always measured at the 90% CLF, independent of
  // the player's selected annual pricing confidence level. WC and GL read their
  // own tables here too, for the same reason as selectedFundingCLF above.
  //
  // ⚠ THIS SITE BECAME BASIS-CONSISTENT FOR THE FIRST TIME WITH THE STATIC
  // TABLES, and the effect is large enough to name. expectedNetUnpaidLoss is a
  // NET reserve, and the retired grids' 90% CLF was a percentile of the GROSS
  // annual loss distribution — a net quantity multiplied by a gross-basis
  // loading. The static tables are measured on RETAINED loss, so both sides of
  // this product are now net. GL's 90% CLF falls from ~1.79 to 1.3642 and WC's
  // from ~1.54 to 1.3893 as a result.
  //
  // ⚠ IT NO LONGER MOVES OPENING SURPLUS — and that is a deliberate repair, not
  // an accident of the current numbers. This margin USED to be the pre-game's
  // acceptance basis: runPriorHistory accepted an opening only inside
  // OPENING_MULTIPLE_BAND x THIS quantity, so every change to the reserve, to
  // the reserve-margin CLF, or to the funding basis re-rated every game's
  // starting surplus. It did, three commits running (f328d65, fab85e4, 962ef60);
  // the worst of it moved GL's median opening from $21.29M to $11.72M and needed
  // a MEDIAN OF 28 REDRAWS to land in band. The pre-game now tests against
  // PREMIUM (OPENING_SURPLUS_TO_PREMIUM_BAND), so this margin has no consumer on
  // the opening path at all. KEEP IT THAT WAY: if a future change wants to
  // condition the opening on reserve risk, that is a decision to argue for
  // explicitly, not a side effect to reintroduce.
  //
  // ⚠ THE ONE THING THAT MAY LEGITIMATELY READ THIS RATIO IS A ONE-OFF
  // CALIBRATION. Because reserveMarginCLF is a static per-line table, the line
  // below makes margin/reserve an EXACT constant — WC 0.3294, GL 0.5020,
  // Property 0.5923, zero dispersion across seeds and across both payout-pattern
  // arms. So any "hold J x reserve" capital rule is "hold T x this margin"
  // wearing a different denominator, and adopting one puts the 90% CLF back on
  // the opening path. The consequences are worked through beside
  // OPENING_SURPLUS_TO_PREMIUM_BAND in defaultAssumptions.ts, together with the
  // reserve pin that was measured and rejected. Read that before wiring anything
  // here to the opening.
  const reserveMarginCLF = hasStaticClf(line)
    ? staticClf(line, 0.90)
    : lookupCLF(0.90);
  const reserveRiskMarginNeeded = Math.max(
    0,
    expectedNetUnpaidLoss * (reserveMarginCLF - 1)
  );

  const fundingMarginNeeded = reserveRiskMarginNeeded;

  // C. Capital / Surplus Cushion
  // Surplus is compared to the extra CLF margin, not the full CLF-loaded unpaid loss.
  const availableFunding = endingSurplus;
  const availableSurplus = endingSurplus;

  const capitalFundingGap = availableSurplus - reserveRiskMarginNeeded;
  const excessAvailableSurplus = capitalFundingGap;
  const excessCapitalRatio = reserveRiskMarginNeeded > 0
    ? excessAvailableSurplus / reserveRiskMarginNeeded
    : null;
  const capitalAdequacyRatio = excessCapitalRatio;

  const capitalAdequacyStatus =
    excessCapitalRatio === null
      ? 'N/A'
      : excessCapitalRatio >= 0.25
      ? 'Strong'
      : excessCapitalRatio >= 0
        ? 'Adequate'
        : excessCapitalRatio >= -0.10
          ? 'Thin'
          : 'Deficient';

  // Legacy compatibility fields.
  const fundingGap = capitalFundingGap;
  const fundingCLF = selectedFundingCLF;

  // --- Ratios ---
  // Use net incurred loss instead of net ultimate loss so the ratios match the accounting income statement.
  //
  // TWO DENOMINATORS EXIST AND THEY ARE NOT INTERCHANGEABLE (finding 6). Every
  // ratio below states which one it uses in its name, because mixing them is
  // the single most repeated error in this project:
  //
  //   PRICING BASIS      poolPremiumAndAdminExpense  = poolPremium + admin
  //                      -> the finding-6 reconciliation basis.
  //   MEMBER-CHARGE BASIS totalMemberCharge          = the above + reinsurance
  //                      -> what members actually pay, and the only basis on
  //                         which a loss ratio and an expense ratio may be
  //                         ADDED, since a combined ratio is meaningless unless
  //                         both terms share a denominator.
  //
  // ⚠ AND A DENOMINATOR IS ONLY HALF OF A BASIS. Both denominators now contain
  // the NET-funded poolPremium, so a GROSS numerator over either of them is
  // mixed even though it names its denominator correctly. That is the defect
  // this block carried from the net-funding change until it was measured: the
  // rule "state your denominator" was followed and was not enough. Both
  // expected-loss ratios below therefore take fundedNetExpectedLoss (see its
  // header for the identity and the inversion), not expectedLoss.
  //
  // ⚠ THE 66.8% TARGET IS OBSOLETE AND IS NOT WHAT THESE MEASURE. It was
  // gross / (gross x 1.346 + 0.15 x gross) — a GROSS-funded pool at the old
  // 75%-confidence default. Funding is net now and the default CLF is exactly
  // 1.000, so neither input survives. The two cutover harnesses still compare
  // their OWN gross numerator against it (gl-cutover-check.ts:156,
  // wc-cutover-check.ts) and read 139.21% on GL; those asserts sit behind a
  // non-default `6b` argv flag, so they never fire. Reported, deliberately NOT
  // silently re-pointed here: re-deriving a reconciliation target is its own
  // decision, and quietly moving the constant to match the code would destroy
  // the only record that the old one ever meant something.
  const expectedLossRatio =
    fundedNetExpectedLoss({ poolPremium, selectedFundingCLF }) / Math.max(poolPremiumAndAdminExpense, 1);
  const expectedLossRatioMemberBasis =
    fundedNetExpectedLoss({ poolPremium, selectedFundingCLF }) / Math.max(totalMemberCharge, 1);
  // Computed from the LIVE expense values, not as 1 - lossRatio. The old form
  // was a residual reverse-engineered to force the combined ratio to 1.000,
  // which is why the display insisted the pool broke even while surplus
  // tripled over five years.
  const expectedExpenseRatio =
    (adminExpense + reinsuranceCost) / Math.max(totalMemberCharge, 1);
  // Both terms on the member-charge basis AND both numerators on the net basis,
  // so this is a real combined ratio.
  //
  // AT CLF 1.000 IT IS EXACTLY 1.0000 — a closed identity, not a coincidence and
  // not an approximation, because poolPremium + adminExpense + reinsuranceCost
  // is identically totalMemberCharge. Above CLF 1.000 the shortfall below
  // 1.0000 IS the funding margin, which is what a confidence level above
  // expected is for. A reading above 1.0000 at CLF 1.000 means a numerator has
  // drifted off the net basis again.
  const expectedCombinedRatio = expectedLossRatioMemberBasis + expectedExpenseRatio;

  const actualLossRatio = netIncurredLoss / Math.max(totalMemberCharge, 1);
  const actualExpenseRatio =
    (adminExpense + reinsuranceCost) / Math.max(totalMemberCharge, 1);
  const actualCombinedRatio = actualLossRatio + actualExpenseRatio;

  const combinedRatio = actualCombinedRatio;
  const lossRatio = actualLossRatio;
  const expenseRatio = actualExpenseRatio;

  const result: LineResultSet = {
    yearNumber,
    calendarYear,
    line,
    decisions: lineDecisions,
    assetAllocation: ctx.assetAllocation,

    activeMembers: memberResult.activeMembers.length,
    newMembers: memberResult.newMembers.length,
    withdrawnMembers: memberResult.withdrawnMembers.length,
    // At line scope one member is one enrolment, so these two agree with the
    // counts above by construction. Both exist so the POOLED row can tell
    // members from enrolments — see the block on ResultSet.
    enrolmentCount: memberResult.activeMembers.length,
    newMemberIds: memberResult.newMembers.map(m => m.id),
    withdrawnMemberIds: memberResult.withdrawnMembers.map(m => m.id),
    activeExposure: parseFloat(activeExposure.toFixed(2)),
    totalMarketExposure: parseFloat(totalMarketExposure.toFixed(2)),
    marketShare: parseFloat(marketShare.toFixed(4)),
    memberRetentionRate: parseFloat(memberResult.retentionRate.toFixed(3)),
    memberSatisfaction: memberResult.memberSatisfaction,
    averageRiskQuality: memberResult.averageRiskQuality,
    memberList: memberResult.activeMembers,

    rateLevel: parseFloat(newRateLevel.toFixed(2)),
    ratePer100: parseFloat(totalMemberRatePer100.toFixed(4)),
    purePremiumPer100: parseFloat(pricedPurePremiumPer100.toFixed(4)),
    purePremium: parseFloat(pricedPurePremiumPer100.toFixed(4)),
    // Unrounded — see the type's comment for why these two skip the toFixed(4)
    // every sibling per-$100 field above gets.
    expectedCededPer100,
    netPurePremiumPer100,
    writtenExposure: parseFloat(writtenExposure.toFixed(2)),

    poolPremium,
    adminExpense,
    poolPremiumAndAdminExpense,
    totalMemberCharge,
    grossPremium,
    assessments,
    dividends,

    kLineApplied,
    memberLossResults,
    aggregateMemberLoss,
    marketMemberLossResults,
    claims: generatedClaims,
    occurrences: generatedOccurrences,
    claimCountsByClass: wcCountsByClass,
    claimCountsByTier: wcCountsByTier,
    claimCount: glClaimCount,
    commonLossFactor,
    catastropheFactor,
    grossUltimateLoss,
    shockLossIncurred: shockOccurred,
    shockEvents: ctx.shockFirings?.length
      ? ctx.shockFirings.map((f): ShockRecord => ({
          ...f,
          attributableGrossLoss: shockAttributableLoss[f.shockId] ?? 0,
          attributableClaims: shockAttributableClaims[f.shockId] ?? 0,
          expectedGrossLossAdded: shockExpectedAdded[f.shockId] ?? 0,
        }))
      : undefined,
    reinsuranceCost,
    reinsuranceRecovery,
    priorYearDevelopmentCeded: developmentCeded,
    bookingGiveBack: markdown.giveBack,
    cededByLayer,
    retainedAboveTower,
    aggregateRecovery: aggregateRecoveryAmount,
    aggregatePremium,
    aggregateAttachment,
    netUltimateLoss,
    netIncurredLoss,

    operatingExpense,
    riskControlInvestment,
    priorYearDevelopment,

    beginningNetReserve,
    currentYearNetReserve,
    netPaidLosses: netPaidLossesThisYear,
    endingNetReserve,

    investmentReturnRate,
    investedAssets,
    investmentIncome,

    // Inter-line loan fields — zero/false here; the loan overlay is applied in
    // processYear's post-pass (repayment) and applyLoanAuthorizations (origination).
    outstandingLoanBalance: 0,
    loanRepaymentApplied: 0,
    loanInterestAccrued: 0,
    loanOriginatedThisYear: 0,
    interLineTransfer: 0,
    interLineCashTransfer: 0,
    dividendBlocked: ctx.dividendBlocked,

    // CLF / funding confidence fields
    selectedFundingConfidenceLevel,
    selectedFundingCLF,

    expectedLoss,
    clfAdjustedExpectedLoss,

    expectedNetUnpaidLoss,
    netFundingTarget,
    indicatedNetReserveAtConfidenceLevel,
    reserveRiskMarginNeeded,
    fundingMarginNeeded,

    availableFunding,
    availableSurplus,
    fundingGap,
    capitalFundingGap,
    excessAvailableSurplus,
    excessCapitalRatio,
    capitalAdequacyRatio,
    capitalAdequacyStatus,

    // Legacy fields
    fundingCLF,

    // Income and balance sheet
    underwritingIncome,
    netIncome,
    beginningCash,
    nextYearPaydownRate,
    endingCash,
    beginningInvestments,
    endingInvestments,
    totalAssets,
    unearnedPremium,
    totalLiabilities,
    beginingSurplus,
    endingSurplus,

    // Surplus rollforward validation
    surplusFromIncome,
    surplusTieOutDifference,

    // Ratios
    expectedLossRatio,
    expectedLossRatioMemberBasis,
    expectedExpenseRatio,
    expectedCombinedRatio,
    actualLossRatio,
    actualExpenseRatio,
    actualCombinedRatio,
    combinedRatio,
    lossRatio,
    expenseRatio,

    // Narrative is generated once at the pool level (see processYear), not per line.
    narrativeExplanation: '',
  };

  const updatedLineState: LinePoolState = {
    rateLevel: newRateLevel,
    ratePer100: totalMemberRatePer100,
    purePremiumPer100: pricedPurePremiumPer100,
    purePremium: pricedPurePremiumPer100,

    memberSatisfaction: memberResult.memberSatisfaction,
    averageRiskQuality: memberResult.averageRiskQuality,
    riskControlEffectiveness: newRCEffectiveness,

    reserveCohorts: allCohorts,
    reserveDevelopment: recordReserveDevelopment(
      lineState.reserveDevelopment ?? [],
      lineState.reserveCohorts,
      updatedCohorts,
      currentYearCohort,
      yearNumber,
    ),
    members: memberResult.activeMembers,

    netUnpaidReserve: endingNetReserve,
    surplus: endingSurplus,
    investedAssets: endingInvestments,

    totalMarketExposure,
  };

  const updatedShared: LineYearShared = {
    cash: endingCash,
    unearnedPremium,
    allMarketMembers: updatedAllMembers,
  };

  return { updatedLineState, updatedShared, result };
}

// Each active line's share of the shared cash/other-assets pool. The weight is
// exactly what makes the line's allocated slice of the shared pot reproduce its
// own stored surplus (so the surplus rollforward ties out every year):
//   slice_needed = surplus + netReserve − investedAssets
// because surplus = [cash slice] + investedAssets − netReserve.
// Stage 2.9 subtracts investedAssets
// (each line's own portfolio is no longer part of the shared pot); before that,
// the pot included investments and the weight was surplus + netReserve. The sum
// of these weights equals the pot total by balance-sheet identity, so slices are
// exact and the rollforward ties out by construction. A weight may legitimately
// be NEGATIVE (a line whose shared-liabilities slice exceeds its shared-assets
// slice) — no flooring, or the identity breaks and every line's tie-out drifts.
// For a single active line the share is always 1 regardless of the formula, so
// a WC-only game is unaffected.
function computeContributionShares(
  poolState: PoolState,
  activeLines: CoverageLine[]
): Record<CoverageLine, number> {
  const raw = activeLines.map(line => {
    const ls = poolState.lines[line];
    const netReserve = Math.max(0, ls.netUnpaidReserve);
    return ls.surplus + netReserve - ls.investedAssets;
  });
  const total = raw.reduce((s, v) => s + v, 0);
  const shares = {} as Record<CoverageLine, number>;
  if (total === 0) {
    activeLines.forEach(line => { shares[line] = 1 / activeLines.length; });
    return shares;
  }
  activeLines.forEach((line, i) => { shares[line] = raw[i] / total; });
  return shares;
}

// A deficient line at year-end that the player may cover with an inter-line loan.
// Stage 2.9: the loan is a real transfer from specific lending lines' invested
// assets. lenderShares (fixed at origination) says which lines fund it and in
// what proportion. An offer only exists when the other lines can cover the FULL
// deficit without any lender's own surplus going negative — otherwise no offer
// is made and the line simply carries its negative surplus (the player can
// respond with an assessment).
export interface LoanOffer {
  line: CoverageLine;
  deficit: number;              // positive amount needed to bring the line to zero surplus
  rateAtOrigination: number;    // this year's pool return, floored at 0 (see poolReturnRateThisYear).
                                // Genuinely a one-time value for the OFFER — becomes the new loan's
                                // starting InterLineLoan.currentRate, which then re-floats every year.
  lenderShares: Partial<Record<CoverageLine, number>>; // each lender's share of the loan, sums to 1
}

// Full output of a processed year. loanOffers is non-empty only when one or
// more lines ended negative without an existing loan — the caller must resolve
// those (authorize/decline) via applyLoanAuthorizations before committing.
export interface ProcessYearResult {
  updatedPoolState: PoolState;
  result: ResultSet;
  lineResults: Array<{ line: CoverageLine; result: LineResultSet }>;
  loanOffers: LoanOffer[];
  priorPoolResult?: ResultSet;
}

// Stage 1.3: loops over all active lines. Stage 1.6 adds the inter-line loan
// system: an existing loan is serviced (repayment pass) during processing, and
// any line that ends negative without a loan produces a loanOffer for the
// player to resolve. When no line is deficient and no loan is outstanding, all
// of the loan logic is inert — a healthy WC-only game is byte-identical to v3.
export function processYear(
  gameState: GameState,
  rawDecisions: DecisionSet
): ProcessYearResult {
  // Pool-wide decisions (investment allocation, risk-control intensity) are
  // projected into every line's decision slice here — single source of truth
  // at the DecisionSet level, while the engine below and each line's locked
  // result snapshot keep their existing per-line shape untouched.
  const decisions: DecisionSet = {
    ...rawDecisions,
    byLine: Object.fromEntries(
      (Object.keys(rawDecisions.byLine) as CoverageLine[]).map(l => [l, {
        ...rawDecisions.byLine[l],
        assetAllocation: { ...rawDecisions.assetAllocation },
        riskControlPct: rawDecisions.riskControlPct,
      }])
    ) as Record<CoverageLine, LineDecisionSet>,
  };
  const { instance, poolState, currentYearNumber, setup } = gameState;
  const yearNumber = currentYearNumber;
  const calendarYear = setup.startingYear + yearNumber - 1;

  // Stage 2.10: live Year 1 sees the last pre-game year (year 0) as its prior
  // year — the game continues from its simulated history. Inside the pre-game
  // sim itself, priorHistory is empty, so year -2 has no prior (correct).
  const priorPoolResult = gameState.lockedResults[gameState.lockedResults.length - 1]
    ?? gameState.priorHistory[gameState.priorHistory.length - 1];

  const activeLines = setup.activeLines;
  const shares = computeContributionShares(poolState, activeLines);

  // Working copy of the loan ledger — repayments mutate balances / remove
  // paid-off loans below.
  let interLineLoans = poolState.interLineLoans.map(loan => ({ ...loan }));

  // Working copy of the membership-history ledger. Maintained by ROSTER DIFF
  // per line below (prior actives vs updated actives), so it records exactly
  // the transitions that actually happened regardless of internal movement
  // mechanics — a member withdrawn and re-recruited within the same year
  // never leaves the active roster and correctly records no transition.
  const membershipHistory = cloneMembershipHistory(poolState.membershipHistory);
  // Working clone, same contract as the ledger above. Defaulted for saves and
  // bootstrap states that predate stage 3.
  const memberLossHistory = cloneMemberLossHistory(poolState.memberLossHistory ?? {});

  let currentAllMarketMembers = poolState.allMarketMembers;
  const lineResults: Array<{ line: CoverageLine; result: LineResultSet }> = [];
  const updatedLineStates: Partial<Record<CoverageLine, LinePoolState>> = {};
  let sharedCash = 0;
  let sharedUnearnedPremium = 0;
  // Loan repayments owed back to each lending line this year (principal +
  // interest, since interest is embedded in the growing balance). Credited to
  // the lenders after the line loop so processing order doesn't matter.
  const lenderCredits: Partial<Record<CoverageLine, number>> = {};

  // Draw the shared market ONCE per year at the asset-class level (cash, bonds,
  // equities) and apply it to every line. Randomness lives at the asset class,
  // not per line, so two lines with the same allocation earn the same return
  // rate; each line differs only by its allocation and its own asset base. The
  // stream is the unsuffixed 'invest' label (unchanged for a WC-only game).
  const marketReturns = simulateMarketReturns(
    deriveSubRng(instance.seed, yearNumber, 'invest')
  );

  // THIS YEAR'S POOL RETURN RATE, for the inter-line loan (Stage 2.9): each
  // active line's realized return weighted by its BEGINNING invested assets.
  // With the pool-wide allocation every line earns the same rate, so the
  // blend trivially equals that shared rate — kept as a weighted blend so the
  // loan rate stays correct-by-construction either way. Computed in a pre-pass
  // (blendInvestmentReturn is pure — no RNG, no dependency on the main loop's
  // per-line mutations) because the loan's interest accrual, below, runs
  // INSIDE the per-line loop and needs this year's rate before any line has
  // been processed. It is deliberately recomputed from scratch every year,
  // never carried over from a loan's origination year — the loan represents
  // capital the lender could otherwise have invested, and that opportunity
  // cost is a CURRENT-year quantity, not a fact frozen at the moment the loan
  // was struck.
  //
  // FLOORED AT ZERO. A negative blended return is a real possibility (the
  // uploaded WC seed alone showed a year at -1.08%), and letting a loan accrue
  // at a negative rate would mean the debt SHRINKS on its own — the pool
  // paying the borrower for having borrowed, in a bad market year, is wrong
  // under any reading. The floor's worst case is "no interest this year," not
  // "the lenders lose principal to a market downturn that wasn't theirs to
  // absorb." DO NOT REMOVE THIS FLOOR as an unnecessary guard — it is the
  // entire fix for the defect verify/interline-loan@c4a2ecc found.
  const poolReturnRateThisYear = Math.max(0, (() => {
    let invested = 0, income = 0;
    for (const line of activeLines) {
      const r = blendInvestmentReturn(
        poolState.lines[line].investedAssets,
        decisions.byLine[line].assetAllocation,
        marketReturns
      );
      invested += poolState.lines[line].investedAssets;
      income += r.income;
    }
    return invested > 0 ? income / invested : 0;
  })());

  // The pool-wide loss factor for this year: ONE draw, SHARED by every line.
  // It has to live here rather than inside processLineYear because a per-line
  // deriveSubRng cannot express a draw common to all lines. Its own purpose
  // label means it consumes nothing from any existing stream.
  const gPool = deriveSubRng(instance.seed, yearNumber, 'wc_gpool')
    .gamma(WC_LOSS_MODEL.poolYearFactor.shape, WC_LOSS_MODEL.poolYearFactor.scale);

  // Shock resolution — pool level, for the same reason gPool is drawn here: a
  // per-line deriveSubRng cannot express something common to all lines, and a
  // single event can emit into several of them. Per-line effects are projected
  // into each LineYearContext below.
  //
  // CONSUMES NO RANDOMNESS, and returns undefined rather than an empty object
  // when nothing is in force, so a game with no shocks takes exactly the code
  // path it took before shocks existed.
  const shocks = resolveShocks(instance, yearNumber);

  // Sequential fold: each line sees the shared roster as updated by lines
  // already processed this year (a member withdrawing from one line becomes
  // ineligible for new recruitment into the next, but isn't retroactively
  // removed from lines it's already active on).
  for (const line of activeLines) {
    const share = shares[line];
    const lineState = poolState.lines[line];
    const lineDecisions = decisions.byLine[line];
    // A line that carried a negative surplus in from last year (declined a
    // loan) has its dividend blocked this year.
    //
    // KNOWN GAP, RULED NOT WORTH FIXING (verify/interline-loan@c4a2ecc): this
    // checks only the SIGN of last year's surplus, and a line that AUTHORIZED
    // a loan lands at exactly zero, not negative (applyLoanAuthorizations
    // makes endingSurplus = 0 an unconditional assignment) — so a line is NOT
    // dividend-blocked the year immediately after it borrows, even though it
    // is carrying the full loan balance as debt. Confirmed real: a line that
    // borrowed and landed at $0 was not dividend-blocked the following year
    // while still owing the loan. outstandingLoanBalance reaches no decision
    // gate or solvency check anywhere in this file — it is read only for
    // display, in resultMetrics.ts and the two results pages. Left as-is
    // because the repayment skim already takes the money out of net income
    // before a dividend could be declared from it, and a player who chooses
    // to distribute while indebted is choosing to make the line's position
    // worse, not exploiting an unintended path.
    const priorLineSurplus = priorPoolResult?.byLine[line]?.endingSurplus;
    const dividendBlocked = priorLineSurplus !== undefined && priorLineSurplus < 0;

    // Blend this year's shared market by this line's own allocation and asset
    // base (pure, no per-line draw): same allocation -> same rate across lines.
    const invResult = blendInvestmentReturn(
      lineState.investedAssets,
      lineDecisions.assetAllocation,
      marketReturns
    );

    const ctx: LineYearContext = {
      instance,
      yearNumber,
      calendarYear,
      allMarketMembers: currentAllMarketMembers,
      membershipHistory,
      gPool,
      shock: shocks?.byLine[line],
      shockFirings: shocks?.firings.filter(f => f.linesAffected.includes(line)),
      cash: poolState.cash * share,
      investments: lineState.investedAssets,
      assetAllocation: lineDecisions.assetAllocation,
      investedAssets: lineState.investedAssets,
      investmentIncome: invResult.income,
      investmentReturnRate: invResult.returnRate,
      dividendBlocked,
      priorResult: priorPoolResult?.byLine[line],
    };

    const { updatedLineState, updatedShared, result } = processLineYear(
      line,
      lineState,
      lineDecisions,
      ctx
    );

    // Ledger maintenance by roster diff: compare this line's active roster
    // before and after the year. Joins open an interval (active from this
    // year); departures close it (last active year = yearNumber - 1).
    {
      const prevActive = new Set(
        lineState.members.filter(m => m.status === 'active').map(m => m.id)
      );
      const nowActive = new Set(
        updatedLineState.members.filter(m => m.status === 'active').map(m => m.id)
      );
      for (const id of nowActive) {
        if (!prevActive.has(id)) openInterval(membershipHistory, id, line, yearNumber);
      }
      for (const id of prevActive) {
        if (!nowActive.has(id)) closeInterval(membershipHistory, id, line, yearNumber - 1);
      }
    }

    // Rolling loss history for this line — stage 3. Recorded HERE, after
    // processLineYear has returned, reading only the finished result: this is
    // downstream of every draw, so it cannot consume randomness or move a value.
    // That is what keeps both export gates green.
    //
    // MARKETPLACE-WIDE where the line has it. marketMemberLossResults carries
    // all 200 members (enrolled + prospects) for the claim-level lines; it is
    // undefined for Property, which still runs the legacy aggregate path and
    // therefore only produces per-member figures for its ENROLLED book. Falling
    // back to memberLossResults means Property gets real enrolled history now
    // and gains marketplace coverage automatically when its generator cuts over
    // — rather than being silently absent from the store, or forcing a special
    // case here that would have to be removed later.
    //
    // Both legs are read straight off the result. See memberLossHistory.ts for
    // why `expected` includes k_line and excludes risk control, and why that
    // asymmetry is held by invariant 2 rather than by convention.
    for (const mlr of result.marketMemberLossResults ?? result.memberLossResults) {
      recordMemberLossYear(memberLossHistory, mlr.memberId, line, {
        yearNumber,
        actual: mlr.simulatedLoss,
        expected: mlr.expectedLoss,
      });
    }

    // --- Inter-line loan repayment pass (existing loans only) ---
    const loan = interLineLoans.find(l => l.borrowingLine === line);
    if (loan) {
      // Re-blend at THIS year's floored pool return, not whatever rate the
      // loan happened to carry last year — see poolReturnRateThisYear above.
      loan.currentRate = poolReturnRateThisYear;
      const interest = loan.remainingBalance * loan.currentRate;
      loan.remainingBalance += interest;
      const aggressiveness = Math.max(0, Math.min(1, lineDecisions.loanRepaymentAggressiveness));
      const skim = aggressiveness * Math.max(0, result.netIncome);
      // A repayment can't exceed what the line actually holds in liquid assets
      // (investments + cash) — paying more would drive balances negative and
      // fabricate money on next year's balance sheet.
      const liquidAssets = Math.max(0, result.endingInvestments + result.endingCash);
      const applied = Math.min(skim, loan.remainingBalance, liquidAssets);
      loan.remainingBalance -= applied;

      // The skimmed income leaves the borrowing line (diverted to debt
      // service) and flows back to the lending lines in their fixed
      // origination shares; interest is this year's carrying cost. The
      // payment comes out of investments first, then cash.
      const fromInvestments = Math.min(applied, Math.max(0, result.endingInvestments));
      const fromCash = applied - fromInvestments;
      result.loanInterestAccrued = interest;
      result.loanRepaymentApplied = applied;
      result.endingSurplus -= applied;
      result.endingInvestments -= fromInvestments;
      result.endingCash -= fromCash;
      result.totalAssets -= applied;
      result.interLineTransfer -= applied;
      result.interLineCashTransfer -= fromCash;
      resyncSurplusDerived(result);
      updatedShared.cash = result.endingCash;

      for (const [lender, lenderShare] of Object.entries(loan.lenderShares)) {
        lenderCredits[lender as CoverageLine] =
          (lenderCredits[lender as CoverageLine] ?? 0) + applied * (lenderShare ?? 0);
      }

      updatedLineState.surplus = result.endingSurplus;
      updatedLineState.investedAssets = result.endingInvestments;

      // Close the loan once effectively repaid.
      if (loan.remainingBalance <= 1) {
        interLineLoans = interLineLoans.filter(l => l.borrowingLine !== line);
        result.outstandingLoanBalance = 0;
      } else {
        result.outstandingLoanBalance = loan.remainingBalance;
      }
    }

    currentAllMarketMembers = updatedShared.allMarketMembers;
    updatedLineStates[line] = updatedLineState;
    lineResults.push({ line, result });

    sharedCash += updatedShared.cash;
    sharedUnearnedPremium += updatedShared.unearnedPremium;
  }

  // --- Credit this year's loan repayments back to the lending lines ---
  // Applied after the loop so it works regardless of the order the borrower
  // and lenders were processed in.
  for (const [lenderKey, credit] of Object.entries(lenderCredits)) {
    const lender = lenderKey as CoverageLine;
    if (!credit) continue;
    const entry = lineResults.find(lr => lr.line === lender);
    const lenderState = updatedLineStates[lender];
    if (!entry || !lenderState) continue;
    entry.result.endingSurplus += credit;
    entry.result.endingInvestments += credit;
    entry.result.totalAssets += credit;
    entry.result.interLineTransfer += credit;
    resyncSurplusDerived(entry.result);
    lenderState.surplus = entry.result.endingSurplus;
    lenderState.investedAssets = entry.result.endingInvestments;
  }

  const updatedPoolState: PoolState = {
    cash: sharedCash,
    unearnedPremium: sharedUnearnedPremium,
    allMarketMembers: currentAllMarketMembers,
    lines: {
      ...poolState.lines,
      ...updatedLineStates,
    },
    interLineLoans,
    membershipHistory,
    memberLossHistory,
  };

  // Detect deficient lines that don't already carry a loan — these become
  // offers the player resolves before the year is committed. Stage 2.9: an
  // offer only exists when the OTHER lines can fund the full deficit without
  // any lender's own surplus (or portfolio) going negative. Lending capacity
  // is consumed offer-by-offer so that authorizing every offer can never
  // overdraw a lender. A deficit no one can cover gets no offer — the line
  // carries its negative surplus (dividend blocked next year) and the player
  // can respond with an assessment.
  const lendingCapacity: Partial<Record<CoverageLine, number>> = {};
  for (const { line, result } of lineResults) {
    lendingCapacity[line] = Math.max(0, Math.min(result.endingSurplus, result.endingInvestments));
  }

  const loanOffers: LoanOffer[] = [];
  for (const { line, result } of lineResults) {
    if (result.endingSurplus >= 0 || interLineLoans.some(l => l.borrowingLine === line)) continue;
    const deficit = -result.endingSurplus;

    const lenders = activeLines.filter(l => l !== line && (lendingCapacity[l] ?? 0) > 0);
    const totalCapacity = lenders.reduce((s, l) => s + (lendingCapacity[l] ?? 0), 0);
    if (totalCapacity < deficit) continue; // no viable loan — auto-declined

    const lenderShares: Partial<Record<CoverageLine, number>> = {};
    for (const l of lenders) {
      const lenderShare = (lendingCapacity[l] ?? 0) / totalCapacity;
      lenderShares[l] = lenderShare;
      lendingCapacity[l] = (lendingCapacity[l] ?? 0) - deficit * lenderShare;
    }

    loanOffers.push({
      line,
      deficit,
      rateAtOrigination: poolReturnRateThisYear,
      lenderShares,
    });
  }

  const result = aggregateLineResults(lineResults, priorPoolResult);

  return { updatedPoolState, result, lineResults, loanOffers, priorPoolResult };
}

// ============================================================================
// RE-DERIVE EVERYTHING THAT HANGS OFF endingSurplus, AFTER AN INTER-LINE LOAN
// HAS MOVED IT.
//
// ⚠ SEVEN FIELDS WERE LEFT STALE, AND THEY WERE STALE IN THE SHIPPED ENGINE
// RATHER THAN ONLY ON THE AUDIT PAGE. processLineYear computes the capital
// cushion, the legacy aliases and the surplus tie-out from endingSurplus, and
// THEN the loan passes move endingSurplus and update only `availableSurplus` and
// `availableFunding` beside it. A line that lent $43M went on reporting the
// excess surplus, the adequacy ratio and the adequacy STATUS it had before
// lending — a "Strong" label on a balance sheet $43M lighter.
//
// ⚠ AND surplusTieOutDifference IS NOT SUPPOSED TO STAY ZERO. It is
// endingSurplus - surplusFromIncome, and an inter-line loan legitimately moves
// surplus WITHOUT touching the income statement, so after a transfer the tie-out
// SHOULD equal that transfer exactly. Holding it at zero was not a conservative
// choice; it was the balance sheet and the income statement disagreeing with
// nothing to say so. `interLineTransfer` is written from the transfer side and
// the tie-out from the surplus side, so the two agreeing is a real check.
//
// Called from every site that moves endingSurplus after processLineYear has
// returned: the repayment pass, the lender credit pass, and both halves of
// applyLoanAuthorizations.
// ============================================================================
function resyncSurplusDerived(r: LineResultSet): void {
  r.availableSurplus = r.endingSurplus;
  r.availableFunding = r.endingSurplus;
  r.capitalFundingGap = r.availableSurplus - r.reserveRiskMarginNeeded;
  r.excessAvailableSurplus = r.capitalFundingGap;
  r.fundingGap = r.capitalFundingGap;
  const excess = r.reserveRiskMarginNeeded > 0
    ? r.excessAvailableSurplus / r.reserveRiskMarginNeeded
    : null;
  r.excessCapitalRatio = excess;
  r.capitalAdequacyRatio = excess;
  r.capitalAdequacyStatus =
    excess === null ? 'N/A'
      : excess >= 0.25 ? 'Strong'
      : excess >= 0 ? 'Adequate'
      : excess >= -0.10 ? 'Thin'
      : 'Deficient';
  r.surplusTieOutDifference = r.endingSurplus - r.surplusFromIncome;
}

// Finalize a processed year after the player has chosen which loan offers to
// authorize. Stage 2.9: authorization is a REAL transfer — each lending line's
// invested assets are debited by its share of the deficit (its surplus drops
// accordingly, never below zero by construction of the offer), and the
// borrowing line's invested assets are credited by the full deficit, which
// brings its surplus to zero by balance-sheet identity. Declined lines keep
// their negative surplus. Re-aggregates the pool result so pool-level totals
// reflect the authorizations.
export function applyLoanAuthorizations(
  processed: ProcessYearResult,
  yearNumber: number,
  authorizedLines: CoverageLine[]
): { updatedPoolState: PoolState; result: ResultSet } {
  const authorized = new Set(authorizedLines);
  const newLoans = [...processed.updatedPoolState.interLineLoans];
  const updatedLines = { ...processed.updatedPoolState.lines };

  for (const offer of processed.loanOffers) {
    if (!authorized.has(offer.line)) continue;

    newLoans.push({
      borrowingLine: offer.line,
      principal: offer.deficit,
      remainingBalance: offer.deficit,
      currentRate: offer.rateAtOrigination,
      yearOriginated: yearNumber,
      lenderShares: offer.lenderShares,
    });

    // Debit each lending line by its share of the deficit.
    for (const [lenderKey, lenderShare] of Object.entries(offer.lenderShares)) {
      const lender = lenderKey as CoverageLine;
      const amount = offer.deficit * (lenderShare ?? 0);
      if (amount <= 0) continue;
      const lenderEntry = processed.lineResults.find(lr => lr.line === lender);
      if (lenderEntry) {
        lenderEntry.result.endingSurplus -= amount;
        lenderEntry.result.endingInvestments -= amount;
        lenderEntry.result.totalAssets -= amount;
        lenderEntry.result.interLineTransfer -= amount;
        resyncSurplusDerived(lenderEntry.result);
      }
      updatedLines[lender] = {
        ...updatedLines[lender],
        surplus: updatedLines[lender].surplus - amount,
        investedAssets: updatedLines[lender].investedAssets - amount,
      };
    }

    // Credit the borrowing line with the full deficit.
    const entry = processed.lineResults.find(lr => lr.line === offer.line);
    if (entry) {
      entry.result.endingSurplus = 0;
      entry.result.endingInvestments += offer.deficit;
      entry.result.totalAssets += offer.deficit;
      entry.result.outstandingLoanBalance = offer.deficit;
      entry.result.loanOriginatedThisYear = offer.deficit;
      entry.result.interLineTransfer += offer.deficit;
      resyncSurplusDerived(entry.result);
    }
    updatedLines[offer.line] = {
      ...updatedLines[offer.line],
      surplus: 0,
      investedAssets: updatedLines[offer.line].investedAssets + offer.deficit,
    };
  }

  const updatedPoolState: PoolState = {
    ...processed.updatedPoolState,
    lines: updatedLines,
    interLineLoans: newLoans,
  };

  const result = aggregateLineResults(processed.lineResults, processed.priorPoolResult);

  return { updatedPoolState, result };
}

// Combines each active line's own LineResultSet into the pool-level ResultSet.
// Dollar/count fields are summed across lines; ratios are recomputed from the
// summed components (never summed directly); a handful of line-ambiguous
// descriptive/rate fields (rate level, CLF, decisions echo, status strings)
// show the first active line's value as a placeholder until Stage 2.1 adds a
// real per-line view. byLine always carries the full accurate per-line data.
export function aggregateLineResults(
  lineResults: Array<{ line: CoverageLine; result: LineResultSet }>,
  priorPoolResult: ResultSet | undefined
): ResultSet {
  const results = lineResults.map(r => r.result);
  const first = results[0];

  // ==========================================================================
  // HOW TO ADD A FIELD TO THIS FUNCTION — read before writing `+`.
  //
  // ⚠ THERE IS DELIBERATELY NO GENERIC `sum` HELPER ANY MORE. There was one, and
  // every field went through it, and SEVEN pool-scope defects reached players
  // that way. THREE of them landed directly beside a comment warning about this
  // exact class, which is the evidence that a comment cannot fix it: a warning
  // naming three fields did not stop the fourth being added underneath it.
  //
  // Adding across lines is only valid for some KINDS of quantity. Pick the
  // helper that says which kind you have. The name is the argument — a call site
  // reading `addDollars('netIncome')` states its own justification, and
  // `noPoolMeaning` forces you to write down why there isn't one.
  //
  //   addDollars              extensive money. Two lines' dollars are the same
  //                           unit and genuinely add. The large majority.
  //   addEnrolments           per-line enrolment counts. A member with two lines
  //                           counts twice. LEGITIMATE AS A WEIGHT, never as a
  //                           headcount — see distinctMembers below for that.
  //   addMixedUnitExposure    WC/GL payroll ($M) plus Property TIV ($M). Adding
  //                           them is a category error; the result is retained
  //                           only because display code still reads it, and it
  //                           must never be labelled with a unit at pool scope.
  //   noPoolMeaning           the quantity has no pool-level referent at all.
  //                           Returns the stated placeholder and records why.
  //
  // Ratios are NOT in this list on purpose: never add a ratio across lines.
  // Recompute it from its own summed components, as every ratio below does.
  // ==========================================================================
  const reduceKey = (key: keyof LineResultSet): number =>
    results.reduce((total, r) => total + (r[key] as unknown as number), 0);

  /** Extensive money. Same unit on every line, so addition is meaningful. */
  const addDollars = reduceKey;
  /** Per-line enrolment counts. A weight, never a headcount. */
  const addEnrolments = reduceKey;
  /** WC/GL payroll + Property TIV. A category error, retained for display only. */
  const addMixedUnitExposure = reduceKey;
  /**
   * No pool-level referent exists. `why` is REQUIRED and is the point of the
   * helper: it forces the author to write down what the reader should do
   * instead, at the call site, rather than leaving a bare value that looks
   * aggregated. Discarded at runtime — the record is the source line.
   */
  const noPoolMeaning = <T>(placeholder: T, why: string): T => { void why; return placeholder; };

  // ⚠ ENROLMENTS, NOT MEMBERS, AND THE TWO DIVERGE BY ~47% ON A THREE-LINE POOL.
  // This is a plain sum of each line's active count, so a member carrying WC and
  // GL contributes 2. Measured 205 enrolments against a 139-member roster.
  //
  // IT HAS TWO JOBS AND ONLY ONE OF THEM WANTS A HEADCOUNT:
  //
  //   AS A WEIGHT (memberSatisfaction, averageRiskQuality below) it is CORRECT
  //   and must not be deduplicated. Those two average a per-line figure weighted
  //   by r.activeMembers, and a member carrying two lines genuinely has two
  //   enrolment experiences to average. Dividing by a distinct headcount there
  //   would inflate both.
  //
  //   AS THE EXPORTED `activeMembers` FIELD it is what it has always been — the
  //   enrolment sum — and RESULT_METRICS ships it under the label "Active
  //   Members". DISPLAY CODE MUST NOT READ IT AS A HEADCOUNT. Use
  //   `memberList.length`, which is deduplicated by id a few lines below and is
  //   the distinct roster at both pool and line scope. HistoryPage (via
  //   toHistoricalYear) and CalculationAuditPage's member-count row read it that
  //   way; MembershipPage always did.
  //
  // Renamed from `activeMembersSum` because that name invited exactly the wrong
  // one of the two jobs, and three display sites took the invitation.
  const enrolmentCount = addEnrolments('activeMembers');
  // ⚠ DIMENSIONALLY MEANINGLESS AT POOL SCOPE. WC/GL exposure is $M of payroll;
  // Property's is $M of insured value (TIV). Summing across lines adds two
  // different units together — these two sums (and any ratio built from them,
  // like the exposure-ratio marketShare below) are pool-scope hazards, not
  // pool-scope facts. Kept only because active display code still reads them
  // (Dashboard/Membership/History pages, the on-screen Year-by-Year Results
  // table, and the pool-scope Calculation Audit rows for Payroll Units / Pool
  // Premium Rate at Selected CLF) — see marketShare below for the fix applied
  // to the one field this bug actually corrupted at pool scope.
  const totalMarketExposureSum = addMixedUnitExposure('totalMarketExposure');
  const activeExposureSum = addMixedUnitExposure('activeExposure');

  const memberSatisfaction = enrolmentCount > 0
    ? results.reduce((s, r) => s + r.memberSatisfaction * r.activeMembers, 0) / enrolmentCount
    : first.memberSatisfaction;
  const averageRiskQuality = enrolmentCount > 0
    ? results.reduce((s, r) => s + r.averageRiskQuality * r.activeMembers, 0) / enrolmentCount
    : first.averageRiskQuality;

  const seenMemberIds = new Set<string>();
  const memberList: Member[] = [];
  for (const r of results) {
    for (const m of r.memberList) {
      if (!seenMemberIds.has(m.id)) {
        seenMemberIds.add(m.id);
        memberList.push(m);
      }
    }
  }
  const memberLossResults = results.flatMap(r => r.memberLossResults);

  // ==========================================================================
  // DISTINCT MEMBERS, not enrolments. All three counts below dedupe by member
  // id, because a member carrying WC and GL is one member however many lines
  // they hold. `memberList` above is already deduplicated; these apply the same
  // treatment to the joiner and leaver counts, which previously summed per-line
  // enrolment EVENTS. That overstated the roster by ~47% and joiners by up to 2
  // in a pool-year.
  //
  // In a SOLO configuration every one of these equals the single line's own
  // count, so nothing about a one-line pool changes.
  // ==========================================================================
  const distinctMembers = memberList.length;

  // A joiner is a member who entered AT LEAST ONE line this year — the union of
  // the per-line joiner sets, so simultaneous WC+GL entry is one joiner.
  //
  // ⚠ NOT `memberList.filter(m => m.yearJoined === yearNumber)`, which is the
  // obvious-looking version and is wrong. Every opening member carries
  // yearJoined 1 (see the field's own comment), so in year 1 that filter counts
  // the whole book: 140 joiners against a true 41. pool-aggregation-check's
  // union-vs-sum assertion caught it.
  const distinctNewIds = new Set<string>();
  for (const r of results) for (const id of r.newMemberIds) distinctNewIds.add(id);
  const distinctNewMembers = distinctNewIds.size;

  // A leaver is a member who left AT LEAST ONE line this year — the union of the
  // per-line withdrawal sets. Counting the union rather than the sum is why
  // LineResultSet carries withdrawnMemberIds at all.
  const distinctWithdrawnIds = new Set<string>();
  for (const r of results) for (const id of r.withdrawnMemberIds) distinctWithdrawnIds.add(id);
  const distinctWithdrawnMembers = distinctWithdrawnIds.size;

  // ⚠ ON A DISTINCT-MEMBER BASIS, matching the numerator and denominator to the
  // counts above. It previously divided summed per-line enrolment counts, which
  // silently made it an ENROLMENT retention rate wearing a member label: a
  // member who dropped one of two lines counted as a whole withdrawal against a
  // doubled base. Both readings are defensible quantities; only one matches the
  // name and the "Member Retention Rate" row that displays it, and the per-line
  // field it aggregates is itself a distinct-member rate — so the pooled row now
  // measures the same thing its own line rows do.
  const distinctRetained = distinctMembers - distinctNewMembers;
  const distinctPriorActive = distinctRetained + distinctWithdrawnMembers;
  const memberRetentionRate = distinctPriorActive > 0
    ? parseFloat((distinctRetained / distinctPriorActive).toFixed(3))
    : 1;

  const poolPremiumAndAdminExpenseSum = addDollars('poolPremiumAndAdminExpense');
  const expectedLossSum = addDollars('expectedLoss');
  const totalMemberChargeSum = addDollars('totalMemberCharge');

  // Pool market share as the PREMIUM-WEIGHTED AVERAGE of each line's own
  // (dimensionless) market share, not activeExposureSum / totalMarketExposureSum.
  // That exposure-ratio summed $M of payroll (WC/GL) against $M of TIV
  // (Property) before dividing — a mixed-unit fraction that read as a real
  // number by coincidence only while the lines' shares were near-equal, and
  // drifted as they diverged (worse the larger Property's TIV grew relative
  // to WC/GL payroll). Each line's marketShare field is already a clean,
  // scale-free ratio (that line's enrolled exposure over that line's own
  // market exposure), so averaging them is legitimate — the only remaining
  // choice is the weight, and totalMemberCharge (what members actually pay,
  // reinsurance cost included) is the common currency across lines. Weighting
  // by exposure again would reintroduce the identical defect one level up.
  const marketShareChargeWeightSum = results.reduce((s, r) => s + r.marketShare * r.totalMemberCharge, 0);
  const marketShare = totalMemberChargeSum > 0
    ? marketShareChargeWeightSum / totalMemberChargeSum
    // Degenerate only: no line has charged any premium yet (e.g. an all-zero
    // bootstrap state). Falls back to a simple average of the per-line shares
    // rather than the exposure sum, since every per-line share is still valid.
    : results.reduce((s, r) => s + r.marketShare, 0) / results.length;
  const netIncurredLossSum = addDollars('netIncurredLoss');
  const adminExpenseSum = addDollars('adminExpense');
  const reinsuranceCostSum = addDollars('reinsuranceCost');
  const reserveRiskMarginNeededSum = addDollars('reserveRiskMarginNeeded');
  const excessAvailableSurplusSum = addDollars('excessAvailableSurplus');

  // Same two-denominator AND same net-numerator discipline as the line level
  // (see the block there, and fundedNetExpectedLoss's header).
  //
  // ⚠ SUMMED PER LINE, NOT DIVIDED ONCE. Each line carries its own CLF, so
  // poolPremiumSum / someCLF is not the pool's funded net loss for any choice
  // of someCLF once two lines price at different confidence levels. Reducing
  // over the line results is the only inversion that stays correct in a mixed
  // book — and at pool scope `first.selectedFundingCLF` is a placeholder, which
  // is exactly the trap this avoids.
  const fundedNetExpectedLossSum = results.reduce((a, r) => a + fundedNetExpectedLoss(r), 0);
  const expectedLossRatio = fundedNetExpectedLossSum / Math.max(poolPremiumAndAdminExpenseSum, 1);
  const expectedLossRatioMemberBasis = fundedNetExpectedLossSum / Math.max(totalMemberChargeSum, 1);
  const expectedExpenseRatio =
    (adminExpenseSum + reinsuranceCostSum) / Math.max(totalMemberChargeSum, 1);
  const expectedCombinedRatio = expectedLossRatioMemberBasis + expectedExpenseRatio;
  const actualLossRatio = netIncurredLossSum / Math.max(totalMemberChargeSum, 1);
  const actualExpenseRatio = (adminExpenseSum + reinsuranceCostSum) / Math.max(totalMemberChargeSum, 1);
  const actualCombinedRatio = actualLossRatio + actualExpenseRatio;

  const excessCapitalRatio = reserveRiskMarginNeededSum > 0
    ? excessAvailableSurplusSum / reserveRiskMarginNeededSum
    : null;
  const capitalAdequacyStatus =
    excessCapitalRatio === null
      ? 'N/A'
      : excessCapitalRatio >= 0.25
      ? 'Strong'
      : excessCapitalRatio >= 0
        ? 'Adequate'
        : excessCapitalRatio >= -0.10
          ? 'Thin'
          : 'Deficient';

  const byLine = {} as Record<CoverageLine, LineResultSet>;
  for (const { line, result } of lineResults) {
    byLine[line] = result;
  }

  const pooled: ResultSet = {
    yearNumber: first.yearNumber,
    calendarYear: first.calendarYear,
    decisions: first.decisions,
    assetAllocation: first.assetAllocation,

    activeMembers: distinctMembers,
    newMembers: distinctNewMembers,
    withdrawnMembers: distinctWithdrawnMembers,
    enrolmentCount,
    newMemberIds: [...distinctNewIds],
    withdrawnMemberIds: [...distinctWithdrawnIds],
    activeExposure: activeExposureSum,
    totalMarketExposure: totalMarketExposureSum,
    marketShare,
    memberRetentionRate,
    memberSatisfaction,
    averageRiskQuality,
    memberList,

    rateLevel: first.rateLevel,
    ratePer100: first.ratePer100,
    purePremiumPer100: first.purePremiumPer100,
    purePremium: first.purePremium,
    // Same one-line placeholder as the per-100 fields above, for the same
    // reason: a per-100 RATE cannot be summed across lines, and blending it
    // needs an exposure weighting sum() does not do. Do not read these at pool
    // scope; each line's own value is exact and is what the identity in
    // fundedNetExpectedLoss's header is asserted against.
    expectedCededPer100: first.expectedCededPer100,
    netPurePremiumPer100: first.netPurePremiumPer100,
    writtenExposure: addMixedUnitExposure('writtenExposure'),

    poolPremium: addDollars('poolPremium'),
    adminExpense: adminExpenseSum,
    poolPremiumAndAdminExpense: poolPremiumAndAdminExpenseSum,
    totalMemberCharge: totalMemberChargeSum,
    grossPremium: addDollars('grossPremium'),
    assessments: addDollars('assessments'),
    dividends: addDollars('dividends'),

    memberLossResults,
    aggregateMemberLoss: addDollars('aggregateMemberLoss'),
    // ⚠ AN UNWEIGHTED MEAN OF A FACTOR ONLY ONE LINE USES, and that is why it is
    // not a pool figure. WC and Property are pinned at exactly 1 (neither reads
    // the legacy aggregate path); only GL carries a live value. Averaging the
    // three therefore drags GL's factor a fixed two-thirds of the way toward 1 —
    // a measured 1.1759 on GL reported as 1.0586 at pool scope — and the
    // dilution changes with the NUMBER of active lines rather than with anything
    // economic. Left as the mean rather than repaired because the field is
    // legacy and has no engine consumer; the pool value is documented here as
    // not meaning what it appears to, and GL's own row is the one to read.
    commonLossFactor: noPoolMeaning(
      results.reduce((s, r) => s + r.commonLossFactor, 0) / results.length,
      'legacy aggregate-path factor; only GL carries a live value — read the GL row',
    ),
    catastropheFactor: first.catastropheFactor,
    grossUltimateLoss: addDollars('grossUltimateLoss'),
    shockLossIncurred: results.some(r => r.shockLossIncurred),
    // ONE ROW PER EVENT, costs summed across the lines it hit — not one row per
    // line. A cross-line event like #28 is a single cause, and showing it twice
    // would read as two events.
    shockEvents: mergeShockRecords(results),
    reinsuranceCost: reinsuranceCostSum,
    // ⚠ WC AND GL ONLY. PROPERTY IS EXCLUDED AND ITS ABSENCE IS THE FIX.
    //
    // This sums ELEMENTWISE, so index 0 means "the first layer of every line
    // added together". That was defensible when only WC and GL had towers: they
    // share identical attachments and limits on their first three layers, so
    // index 0 really was $4M xs $1M everywhere. WC's fourth has no GL
    // counterpart and simply carries WC's own figure.
    //
    // Property then got a tower of its own — a SINGLE layer, $70M xs $5M — and
    // it landed in index 0 alongside those two $4M xs $1M layers. The pooled
    // cell became three different treaties added together: measured 31.49 =
    // 0.30 (WC $4M xs $1M) + 17.11 (GL $4M xs $1M) + 14.08 (Property $70M xs
    // $5M). The comment that justified the elementwise sum was written before
    // Property had a tower and was never revisited when it got one — the same
    // way the exposure warning above failed to cover writtenExposure.
    //
    // Excluded rather than widened: there is no index that means anything
    // across all three, because Property's tower does not share a single
    // attachment with the other two. Property's own array is the authoritative
    // one and CalculationAuditPage's per-line view already shows it. Anything
    // reading this at pool scope is reading a WC+GL figure and should say so.
    cededByLayer: (() => {
      const aligned = lineResults.filter(r => r.line !== 'Property').map(r => r.result);
      const width = Math.max(0, ...aligned.map(r => r.cededByLayer.length));
      const out = new Array(width).fill(0);
      for (const r of aligned) r.cededByLayer.forEach((v, i) => { out[i] += v; });
      return out;
    })(),
    retainedAboveTower: addDollars('retainedAboveTower'),
    aggregateRecovery: addDollars('aggregateRecovery'),
    aggregatePremium: addDollars('aggregatePremium'),
    // ⚠ 0, NOT A SUM, BECAUSE NO POOL AGGREGATE TREATY EXISTS TO HAVE AN
    // ATTACHMENT. WC and Property each buy their own aggregate stop-loss; GL is
    // offered none. Adding two attachment points produces a dollar figure that
    // is the attachment of nothing — no single retained-loss total triggers it,
    // because there are two separate treaties triggering on two separate
    // retained-loss totals. aggregateRecovery and aggregatePremium above ARE
    // summable: those are realised dollars, and dollars from two treaties add.
    // An attachment is a THRESHOLD, and thresholds do not.
    //
    // Nothing reads this at pool scope today (checked across pages and
    // RESULT_METRICS), so 0 costs nothing and is the honest reading: there is no
    // pool attachment. Read byLine.WC / byLine.Property for the real ones.
    aggregateAttachment: noPoolMeaning(0, 'two separate treaties; a threshold is not additive — read byLine'),
    reinsuranceRecovery: addDollars('reinsuranceRecovery'),
    priorYearDevelopmentCeded: addDollars('priorYearDevelopmentCeded'),
    bookingGiveBack: addDollars('bookingGiveBack'),
    netUltimateLoss: addDollars('netUltimateLoss'),
    netIncurredLoss: netIncurredLossSum,

    operatingExpense: addDollars('operatingExpense'),
    riskControlInvestment: addDollars('riskControlInvestment'),
    priorYearDevelopment: addDollars('priorYearDevelopment'),

    beginningNetReserve: addDollars('beginningNetReserve'),
    currentYearNetReserve: addDollars('currentYearNetReserve'),
    // ⚠ THE COMMENT THAT STOOD HERE WAS FALSE AND IS WORTH RECORDING AS SUCH.
    // It read "Non-WC lines contribute 0, so the pool total IS WC's — correct,
    // since only WC has a report lag." WC's report lag was removed at the IBNER
    // cutover and all three lines pay from their own reserves now: measured WC
    // $8.04M + GL $11.67M + Property $8.87M, with WC the SMALLEST of the three.
    // The sum itself was always right — these are dollars — but the reasoning
    // under it had been inverted by a change elsewhere, which is how a reader
    // checking this line would have been misled about which lines contribute.
    netPaidLosses: addDollars('netPaidLosses'),
    endingNetReserve: addDollars('endingNetReserve'),

    // Stage 2.9: per-line portfolios make the pool return an asset-weighted
    // blend of each line's own realized return, not any single line's rate.
    investmentReturnRate: addDollars('investedAssets') > 0
      ? addDollars('investmentIncome') / addDollars('investedAssets')
      : first.investmentReturnRate,
    investedAssets: addDollars('investedAssets'),
    investmentIncome: addDollars('investmentIncome'),

    outstandingLoanBalance: addDollars('outstandingLoanBalance'),
    loanRepaymentApplied: addDollars('loanRepaymentApplied'),
    loanInterestAccrued: addDollars('loanInterestAccrued'),
    loanOriginatedThisYear: addDollars('loanOriginatedThisYear'),
    // Sums to zero across lines by construction — see the field comment.
    // ⚠ RESERVE-WEIGHTED, NOT SUMMED. A rate summed across lines is nonsense;
    // this is the pool's own next-year payment over the pool's own reserve,
    // which is the same blend the balance sheet takes.
    nextYearPaydownRate: (() => {
      const res = addDollars('endingNetReserve');
      return res > 0
        ? lineResults.reduce((s, { result }) => s + result.endingNetReserve * result.nextYearPaydownRate, 0) / res
        : 0;
    })(),
    interLineTransfer: addDollars('interLineTransfer'),
    interLineCashTransfer: addDollars('interLineCashTransfer'),
    dividendBlocked: results.some(r => r.dividendBlocked),

    selectedFundingConfidenceLevel: first.selectedFundingConfidenceLevel,
    selectedFundingCLF: first.selectedFundingCLF,

    expectedLoss: expectedLossSum,
    clfAdjustedExpectedLoss: addDollars('clfAdjustedExpectedLoss'),

    expectedNetUnpaidLoss: addDollars('expectedNetUnpaidLoss'),
    netFundingTarget: addDollars('netFundingTarget'),
    indicatedNetReserveAtConfidenceLevel: addDollars('indicatedNetReserveAtConfidenceLevel'),
    reserveRiskMarginNeeded: reserveRiskMarginNeededSum,
    fundingMarginNeeded: addDollars('fundingMarginNeeded'),

    availableFunding: addDollars('availableFunding'),
    availableSurplus: addDollars('availableSurplus'),
    fundingGap: addDollars('fundingGap'),
    capitalFundingGap: addDollars('capitalFundingGap'),
    excessAvailableSurplus: excessAvailableSurplusSum,
    excessCapitalRatio,
    capitalAdequacyRatio: excessCapitalRatio,
    capitalAdequacyStatus,

    fundingCLF: first.fundingCLF,

    underwritingIncome: addDollars('underwritingIncome'),
    netIncome: addDollars('netIncome'),
    beginningCash: addDollars('beginningCash'),
    endingCash: addDollars('endingCash'),
    beginningInvestments: addDollars('beginningInvestments'),
    endingInvestments: addDollars('endingInvestments'),
    totalAssets: addDollars('totalAssets'),
    unearnedPremium: addDollars('unearnedPremium'),
    totalLiabilities: addDollars('totalLiabilities'),
    beginingSurplus: addDollars('beginingSurplus'),
    endingSurplus: addDollars('endingSurplus'),

    surplusFromIncome: addDollars('surplusFromIncome'),
    surplusTieOutDifference: addDollars('surplusTieOutDifference'),

    expectedLossRatio,
    expectedLossRatioMemberBasis,
    expectedExpenseRatio,
    expectedCombinedRatio,
    actualLossRatio,
    actualExpenseRatio,
    actualCombinedRatio,
    combinedRatio: actualCombinedRatio,
    lossRatio: actualLossRatio,
    expenseRatio: actualExpenseRatio,

    narrativeExplanation: '',
    byLine,
  };

  pooled.narrativeExplanation = generateNarrative(pooled, priorPoolResult);

  return pooled;
}

// A cohort is closed once it has matured and its remaining balance falls below
// this. The residual is PAID at closure, never dropped — see processIbner.

// ============================================================================
// THE DEVELOPMENT LEDGER — a recording, not a computation.
//
// Appends this valuation's estimate to each accident year's row, creating the
// row the first time an accident year is seen. Read only by the Actuarial
// memorandum; see ReserveDevelopmentRow for why the path cannot be recovered
// after the fact and therefore has to be written down as it happens.
//
// ⚠ TAKES BOTH SIDES OF THE STEP ON PURPOSE. `before` is needed only to open a
// row for a cohort the ledger has never seen — a SEED cohort, which exists
// before the first processed year and would otherwise have its opening estimate
// overwritten by its first development. For those the opening entry is the
// estimate as at GAME START, filed against valuation year `yearNumber - 1`,
// because that is the valuation it actually describes.
//
// ⚠ PURE, AND IT MUST STAY PURE. No RNG, no mutation of either input, and no
// return path into any booked or priced quantity. That is what keeps a display
// feature out of the value gates.
function recordReserveDevelopment(
  ledger: ReserveDevelopmentRow[],
  before: ReserveCohort[],
  after: ReserveCohort[],
  incepted: ReserveCohort,
  yearNumber: number,
): ReserveDevelopmentRow[] {
  // ⚠ paidByValuation IS NET, matching ultimateByValuation. The engine's own
  // paid ledger is GROSS and lives on the cohort; this row records the NET
  // figure because the exhibit it feeds is a net document. See the field's own
  // comment for why only one series is stored and why it is this one.
  const byYear = new Map(ledger.map(r => [r.yearNumber, {
    ...r,
    ultimateByValuation: [...r.ultimateByValuation],
    paidByValuation: [...(r.paidByValuation ?? [])],
  }]));

  // Open a row for any pre-existing cohort the ledger has not met yet. Only
  // seed cohorts reach this: an engine-written accident year is registered in
  // the year it inceptes, by the `incepted` block below.
  for (const c of before) {
    if (c.closed || byYear.has(c.yearNumber)) continue;
    byYear.set(c.yearNumber, {
      yearNumber: c.yearNumber,
      calendarYear: c.calendarYear,
      ultimateByValuation: [c.netUltimate],
      paidByValuation: [c.netPaid],
      firstValuationYear: yearNumber - 1,
      ageAtFirstValuation: c.age,
      horizon: c.horizon,
      seeded: true,
    });
  }

  // This valuation's estimate for every cohort that survived the step.
  for (const c of after) {
    const row = byYear.get(c.yearNumber);
    if (!row) continue;
    const idx = yearNumber - row.firstValuationYear;
    // Idempotent under a replayed year: write at the index the valuation year
    // maps to rather than pushing, so re-processing a year cannot lengthen the
    // history. Gaps cannot arise (every open cohort is valued every year), but
    // a short array is padded rather than left holed if one ever did.
    while (row.ultimateByValuation.length < idx) {
      row.ultimateByValuation.push(row.ultimateByValuation[row.ultimateByValuation.length - 1]);
    }
    row.ultimateByValuation[idx] = c.netUltimate;
    // The paid series is padded the same way and for the same reason. Carrying
    // the LAST figure forward is right for paid as it is for ultimate: a gap
    // would mean no payment happened, and a cohort that is not valued in a year
    // is one that has closed, whose paid is final.
    const paid = row.paidByValuation ?? (row.paidByValuation = []);
    while (paid.length < idx) paid.push(paid.length > 0 ? paid[paid.length - 1] : 0);
    paid[idx] = c.netPaid;
  }

  // The accident year written this year, at its inception estimate.
  if (!byYear.has(incepted.yearNumber)) {
    byYear.set(incepted.yearNumber, {
      yearNumber: incepted.yearNumber,
      calendarYear: incepted.calendarYear,
      ultimateByValuation: [incepted.netUltimate],
      paidByValuation: [incepted.netPaid],
      firstValuationYear: yearNumber,
      ageAtFirstValuation: 0,
      horizon: incepted.horizon,
      seeded: false,
    });
  }

  return [...byYear.values()].sort((a, b) => a.yearNumber - b.yearNumber);
}

// ============================================================================
// IBNER — the per-cohort development walk. See defaultAssumptions.ts's IBNER_*
// block for the model, the parameters, and why each is what it is.
//
// ⚠ THIS REPLACED processReserveDevelopment, WHOSE FUNDING TERM NEVER APPLIED.
// The old function multiplied each open cohort's UNPAID balance by
// rng.range(0.92, 1.10) shifted by `fundingImpactOnDevelopment`, which read
// priorFundingAdequacyRatio -> fundingAdequacyRatio -> premiumFundingRatio, a
// HARDCODED 1 (all three of those names are now DELETED — the chain is kept
// here because it is why this function exists). Measured over 40 games x 10
// years x 3 lines at funding levels
// 0.30/0.60/0.95, that ratio took exactly one distinct value, so the shift was
// identically zero on every path the game can reach.
//
// The wobble ITSELF worked and did reach the P&L — the rollforward identity
// netIncurredLoss === netUltimateLoss - developmentImpact held to the
// closed-cohort floor over 1,350 line-years, and forcing the band to a flat
// 1.40 swung year-10 WC surplus by $153.7M. What was broken was the INPUT to
// its only interesting term, not its plumbing. That is why this is a
// replacement rather than a retune: an unbiased wobble on the unpaid balance
// is not a reserving mechanic, it is noise.
//
// TWO STRUCTURAL CHANGES beyond the parameters:
//   THE ESTIMATE DEVELOPS, NOT THE UNPAID BALANCE. Development applies to the
//   cohort's whole estimate of ultimate and the unpaid balance follows. The old
//   form moved only what was still unpaid, so an old cohort that had already
//   paid most of its losses could barely develop at all — backwards, since
//   long-tail uncertainty is precisely about the years that have paid least.
//   IT STOPS. A cohort matures at its horizon and its ultimate is then fixed.
//   The old form developed every open cohort forever.
function processIbner(
  cohorts: ReserveCohort[],
  line: CoverageLine,
  rng: SeededRandom,
  // ⚠ THE GAME IDENTITY, NOT THE SEED, IS WHAT CLOSURE HASHES. See
  // claimClosure.ts: the numeric seed is a pure function of the instance id, so
  // the two carry identical information, and the id is the one the claims
  // workbook already uses — passing it here is what makes the engine's view of
  // "which claims are closed" and the workbook's view the SAME view rather than
  // two derivations that agree by inspection.
  gameId: string,
  // The seed, separately, because the reselection streams are derived from it.
  seed: number,
  valuationYear: number,
): {
  developmentImpact: number;
  updatedCohorts: ReserveCohort[];
  netPaidThisYear: number;
  developmentCeded: number;
  unallocatedDevelopment: number;
} {
  let developmentImpact = 0;
  let netPaidThisYear = 0;
  // What the occurrence tower absorbed of this year's development, and what
  // could not be pushed onto any claim because the cohort has no register.
  let developmentCeded = 0;
  let unallocatedDevelopment = 0;

  const updatedCohorts = cohorts
    .filter(c => !c.closed)
    .map(c => {
      // MATURED COHORTS STILL PAY, THEY JUST STOP MOVING. Runoff and
      // development are separate clocks: the horizon governs how long the
      // ESTIMATE is uncertain, the line's payout pattern governs how fast it is
      // settled.
      const developing = c.age < c.horizon;
      let developingClaimsOut = c.developingClaims;
      let cededToDate = c.cededDevelopmentToDate ?? 0;
      let untrackedOut = c.untrackedTotal;
      let benchOut = c.developmentBench;
      let promotedIds: Set<string> = EMPTY_PROMOTIONS;

      // ====================================================================
      // RESELECT THE DEVELOPING SUBSET — ONCE, HERE, BEFORE ANYTHING MOVES.
      //
      // ⚠ ONE SET PER VALUATION, USED BY BOTH DIRECTIONS. This is the direct
      // successor to the retired "developing subset changed" invariant, and it
      // is the same guard. What "frozen" was protecting was never that the set
      // is FIXED — it was that the set cannot be REARRANGED between the
      // stochastic step and the unwind, or between one valuation and the next
      // for any reason other than closure. Routing the two directions through
      // different sets is exactly the asymmetry that manufactured $48.2M of
      // recovery on WC against a register that moved favourable; doing it with
      // the valuation clock instead of the sign would be the same defect
      // wearing a different hat. So this is called ONCE, above the steps, and
      // `live` starts from what it returns.
      //
      // ⚠ THE AGE IS c.age + 2, THE VALUATION BEING STRUCK — the same age the
      // paydown lookup uses two lines below, and the same age the claims
      // workbook resolves a claim's Status at (`valuationYear - accidentYear +
      // 1`). That agreement is the reason for the choice rather than a
      // coincidence of conventions: a reader checking the register against the
      // workbook must never find an occurrence marked Closed carrying a
      // movement at the valuation that closed it.
      //
      // ⚠ THE CLOSURE CURVE IS RESOLVED ON `drawn`, THE OCCURRENCE TOTAL. That
      // is the claim's own gross ultimate today, because every occurrence sums
      // exactly one claim on all three lines (see occurrenceTotals). If a
      // multi-claim occurrence ever returns, this resolves the size split on a
      // sum rather than on a claim and has to be revisited — the workbook would
      // then be resolving a different curve for the same file.
      //
      // ⚠ AND THE CAP IS ZERO ONCE THE COHORT HAS MATURED. A matured cohort
      // takes no development, so there is nothing to carry and nothing to
      // replace; its statuses are still refreshed, so the register keeps
      // reading true, and its bench is dropped because nothing will ever draw
      // from it again. That is what bounds the bench's storage by the horizon
      // rather than by the length of the game.
      if (DEVELOPMENT_CESSION_ENABLED && c.developingClaims && c.developingClaims.length > 0) {
        const curveAge = c.age + 2;
        const rs = reselectCarriers(
          c.developingClaims,
          c.developmentBench ?? [],
          c.untrackedTotal ?? 0,
          (claimId, drawn) => isClaimClosed(resolveClosureCurve(line, drawn), gameId, claimId, curveAge),
          developing ? DEVELOPMENT_ALLOCATION.claimCount : 0,
          reselectRng(seed, line, c.yearNumber, valuationYear, 'carriers'),
        );
        developingClaimsOut = rs.tracked;
        untrackedOut = rs.untrackedTotal;
        promotedIds = rs.promotedIds;
        benchOut = developing && rs.bench.length > 0 ? rs.bench : undefined;
        // ⚠ rs.retired / rs.promoted / rs.short ARE NOT RETURNED, deliberately.
        // Every one of them is recoverable by differencing the cohort before
        // and after — retired is a carrier that is now closed, promoted is a
        // claim id present after and absent before, short is a developing
        // cohort carrying fewer than the cap. development-cession-check
        // already holds both sides of the step and derives them there, which
        // keeps the engine from carrying a counter nothing in the game reads.
      } else if (!developing) {
        benchOut = undefined;
      }

      // ⚠ PAY FIRST, THEN DEVELOP WHAT REMAINS. Paid is history and never moves.
      // This ordering is the whole fix — see the block comment above.
      // ⚠ THE RATE IS A PROPERTY OF THE LINE AND THE AGE, NOT OF THE COHORT.
      // This read `c.paydownPct`, a per-cohort copy of a line-level constant —
      // fine while the constant was flat, and a second description of one fact
      // the moment it stopped being. The field is gone; the rate is looked up.
      //
      // `age` counts STEPS TAKEN and pattern age counts YEARS SINCE THE ACCIDENT
      // YEAR STARTED, so they differ by one: a cohort at age `a` currently sits
      // at pattern age a + 1, and the step about to be taken carries it to
      // a + 2. See the age-convention note in payoutPattern.ts.
      let paydown = c.netUnpaid * conditionalPaydown(LINE_PAYOUT_PATTERN[line], c.age + 2);
      let newUnpaid = c.netUnpaid - paydown;
      let newPaid = c.netPaid + paydown;

      // --- THE GROSS PAID LEDGER, RUNNING ALONGSIDE ------------------------
      // ⚠ NOTHING BELOW READS THESE. They mirror the three lines above at the
      // same rate and absorb the same development, and the net path never
      // consults them — which is what lets value-identity stay green on every
      // pre-existing field while this commit adds a recording. If a future
      // change makes the net path read a gross figure, that is an engine change
      // and it must be argued for as one; it is not this.
      //
      // ⚠ NO CLAIM EVER DRAWS ITS OWN PAYMENT SCHEDULE, and this line is where
      // that would be violated. The engine develops the RESERVE — newUnpaid =
      // (netUnpaid - paydown) x factor — so the cohort's paydown TOTAL sets the
      // base development multiplies. Payment allocation is cession-neutral ONLY
      // because the pattern fixes that total here, before anything splits it
      // across claims. Give a claim its own curve and the total stops being the
      // pattern's, the development base moves, and the free-lunch surface
      // reopens where nothing is watching. claimClosure.ts carries the same
      // warning at the split, and paid-ledger-check.ts asserts the sum.
      // ⚠ THE GROSS UNPAID BALANCE IS FLOORED AT ZERO, AND THIS IS NOT THE
      // RESERVE FLOOR THAT WAS A BUG. They look identical. They are not, and the
      // difference is which quantity is being clipped.
      //
      // The retired `Math.max(0, newUltimate - c.netPaid)` clipped FAVOURABLE
      // development on the NET reserve — the quantity that drives the P&L — so
      // adverse movements were recognised in full and favourable ones truncated,
      // E[incurred] exceeded E[ultimate], and the martingale broke. That floor is
      // gone and stays gone. The net path below is untouched by any of this.
      //
      // This floor is on the GROSS LEDGER, which nothing reads. The register's
      // own claims are already floored individually in cedeDevelopment
      // (`Math.max(0, c.current + deltas[i])`), so a cohort whose claims settle
      // well below what it has already paid genuinely has a register beneath its
      // own paid-to-date. The honest ledger statement is then unpaid ZERO — fully
      // paid, and slightly over-paid against its own latest estimate — rather
      // than a negative balance, which would pay a NEGATIVE amount next year and
      // make cumulative paid fall.
      //
      // Found by paid-ledger-check on its first run: 9 cohort-valuations of
      // 4,386, every one a late favourable movement on an old cohort.
      const cGrossUnpaid = Math.max(0, c.grossUnpaid ?? c.netUnpaid);
      const cGrossPaid = c.grossPaid ?? c.netPaid;
      let grossPaydown = cGrossUnpaid * conditionalPaydown(LINE_PAYOUT_PATTERN[line], c.age + 2);
      let newGrossUnpaid = cGrossUnpaid - grossPaydown;
      let newGrossPaid = cGrossPaid + grossPaydown;
      // What the register moved by this valuation, GROSS — retained plus ceded.
      // The net reserve takes only the retained part; the difference between the
      // two ledgers is exactly what the tower absorbed.
      let grossMovement = 0;

      // ⚠ SIGN. developmentImpact is POSITIVE for FAVORABLE development
      // (the estimate FELL), matching priorYearDevelopment's documented
      // convention on LineResultSet. netIncurredLoss subtracts it.
      if (developing) {
        // ⚠ LOGNORMAL, NOT (1 + normal), AND THIS IS WHAT MAKES THE FLOOR
        // UNREACHABLE RATHER THAN MERELY UNLIKELY. exp(s z - s^2/2) has mean
        // EXACTLY 1 and is strictly positive for any s, so the reserve is a
        // martingale that cannot cross zero.
        //
        // A linear (1 + s z) step would NOT survive this change. Moving the
        // walk onto the reserve costs a factor of ~4.6-7.7 in leverage (see
        // reserveStepSigma), so preserving each line's stated total SD needs a
        // per-step sigma of 0.39-0.67 — and at those sizes the eventful decile
        // (stepMultiplier 2.596) drives 1 + s z below zero on 16% of GL steps,
        // 21% of WC's and 28% of Property's. The floor would have come straight
        // back, more often than before. Measured, not assumed.
        const sigma = c.stepMultiplier * reserveStepSigma(line);
        const factor = Math.exp(sigma * rng.normal(0, 1) - (sigma * sigma) / 2);

        // The deterministic unwind of the optimistic booking, front-loaded.
        // Zero unless the line was funded below break-even in this cohort's
        // accident year. `age` is the number of steps already taken, so the
        // step about to be taken is age + 1.
        //
        // ⚠ ADDITIVE DOLLARS NOW, NOT A MULTIPLICATIVE FACTOR, and the change
        // was forced by this commit rather than chosen. The old schedule
        // distributed L = -ln(1 - bias) in log space so that the PRODUCT of the
        // per-step factors was exactly 1/(1 - bias) — exact because it
        // multiplied the whole ULTIMATE. Applied to a reserve that is paying
        // down, the same factors deliver only a fraction of the bias, because
        // the base they multiply shrinks: the identical shrinking-base problem
        // this commit exists to fix, arriving through the deterministic term.
        //
        // Distributing the required DOLLARS instead makes it exact again, and
        // for a better reason than before: adding X to the reserve adds X to
        // paid + unpaid immediately, so the total added over the runoff is
        // exactly sum(w_t) x registerSum x bias = registerSum x bias for ANY
        // weights summing to 1 — pathwise, not merely in expectation, and
        // independent of the stochastic path. The weights stay geometric so the
        // front-loading decision is unchanged.
        const unwind = c.registerSum * c.bookingBias * ibnerUnwindWeight(c.horizon, c.age + 1);

        // ⚠ THE MOVEMENT LANDS ON CLAIMS, AND THE TOWER SEES IT. This is the
        // whole mechanism: an accident year that doubles now does so BY CLAIMS
        // DETERIORATING, and a claim already above the retention cedes its
        // deterioration like any other loss. The pool's reserve moves by the
        // RETAINED part only.
        //
        // A cohort with no register — a seed cohort, apportioned from a reserve
        // total at generation with no claims behind it — retains its
        // development ENTIRE. That is the honest default rather than inventing
        // claims to cede against, and it is 0.4% of all adverse development, so
        // it does not matter much either.
        //
        // ⚠ THE RESELECTED SET, NOT THE COHORT'S STORED ONE. Reselection ran
        // above and may have stood carriers down and promoted replacements
        // in; taking `c.developingClaims` here would develop the set as it was
        // at the LAST valuation and then overwrite it with the reselected one,
        // which is a rearrangement between the set that moves and the set that
        // is recorded.
        const claims = developingClaimsOut;
        const canCede = DEVELOPMENT_CESSION_ENABLED && claims !== undefined && claims.length > 0;

        if (canCede) {
          const placed = c.placedAtInception ?? normalizeLayersPlaced(line as TowerLine, undefined);
          let live = claims;
          let untracked = untrackedOut ?? 0;
          const untrackedAtStep = untracked;

          // ⚠ TWO MOVEMENTS, TWO MODES, APPLIED SEPARATELY — and they cannot be
          // summed first. The unwind REVERSES a markdown that was applied
          // proportionally across the whole register, so it has to come back the
          // same way or the claims do not return to their drawn values. The
          // stochastic step is real deterioration or real redundancy and goes to
          // the carriers. Adding them into one number and picking a mode by the
          // sign of the sum would send the unwind to the carriers whenever the
          // lognormal step happened to dominate.
          //
          // ⚠ THE STOCHASTIC MODE NO LONGER DEPENDS ON THE SIGN, and that is this
          // commit. It read `stochastic >= 0 ? 'carriers' : 'proportional'`:
          // deterioration onto the largest claims, redundancy across the whole
          // register. Cession is convex in occurrence size and sign-blind, so an
          // asymmetric ROUTING through it manufactured recovery on a driftless
          // walk — $48.2M paid on WC against a register that moved $17.7M
          // favourable. Both directions now take the same branch. The full
          // argument, the grid that rules out every other cell, and the
          // second-order residual this does NOT close are in
          // developmentAllocation.ts's header.
          //
          // ⚠ A CLOSED OCCURRENCE TAKES THE UNWIND AND TAKES NO DEVELOPMENT
          // DRAW, and the split is not an oversight in either direction.
          //
          // The stochastic step is real deterioration or real redundancy on a
          // file that is still moving, so it goes to the carriers and
          // reselection has already taken the closed ones out of that set.
          //
          // The unwind is not development. It is the REVERSAL OF A BOOKING
          // MARKDOWN taken proportionally across the whole register at
          // inception — closed occurrences included, since nothing had closed
          // yet — so it comes back the same way. Excluding closed occurrences
          // from it would do two things, both worse than the oddity it would
          // remove. It would leave them permanently marked down, so the
          // register never returns to what the generator drew. And it would
          // make every open occurrence's share of the unwind depend on HOW
          // MANY have closed, which is a composition dependency of exactly the
          // kind the replacement rule is chosen to avoid.
          //
          // The decisive one is the untracked mass: it is a scalar, closure is
          // invisible inside it, and the ~490 occurrences it stands for take
          // their proportional share whatever their status. A closed TRACKED
          // occurrence that did not would be behaving differently from a
          // closed UNTRACKED one of the same size, which is an asymmetry
          // created by a storage decision.
          const stochastic = newUnpaid * (factor - 1);
          const steps: { amount: number; mode: 'carriers' | 'proportional' }[] = [
            { amount: stochastic, mode: STOCHASTIC_ALLOCATION_MODE },
            { amount: unwind, mode: 'proportional' },
          ];

          for (const step of steps) {
            if (step.amount === 0) continue;
            const alloc = allocateDevelopment(live, untracked, step.amount, step.mode);
            const res = cedeDevelopment(line as TowerLine, live, alloc.deltas, alloc.untrackedDelta, placed);
            live = res.moved;
            untracked = Math.max(0, untracked + alloc.untrackedDelta);
            cededToDate += res.ceded;
            developmentCeded += res.ceded;
            unallocatedDevelopment += alloc.unallocated;
            // `unallocated` is non-zero only when a favourable movement exceeded
            // the WHOLE register — essentially unreachable now that favourable
            // movements are proportional. It still has to reach the reserve or
            // the rollforward stops balancing, so it is retained rather than
            // dropped.
            newUnpaid += res.retained + alloc.unallocated;
            // GROSS ledger only — read-only with respect to everything above.
            // `unallocated` never reached a claim, so the register did not move
            // by it and the gross ledger must not either.
            grossMovement += res.retained + res.ceded;
          }
          // ⚠ ONE ENTRY PER VALUATION, WRITTEN AFTER BOTH STEPS, AND THAT IS
          // DELIBERATE. A valuation revises an estimate once; the stochastic draw
          // and the unwind are how this engine gets there, not two things a
          // reader should see. Differencing against the values the year STARTED
          // with also makes the entry exactly what the claim moved by, with no
          // dependence on how many internal steps ran.
          //
          // Written at index `age` rather than pushed, for the same reason
          // recordReserveDevelopment writes at an index: a replayed year must
          // restate its own entry, not append a second one.
          //
          // ⚠ A PROMOTED OCCURRENCE IS DIFFERENCED AGAINST ITS BOOKED VALUE,
          // NOT ITS PROMOTION VALUE, and that is what keeps the per-claim
          // series reconcilable. It has been moving all along inside the
          // untracked mass — the proportional unwind reaches every dollar of
          // the register, tracked or not — and none of that movement is in a
          // series, because nothing was watching it individually. Differencing
          // against `current` would leave `original + sum(movements)` short of
          // `current` by exactly that drift, which claims-workbook-check
          // asserts per row and caught here on 151 rows, every one in the
          // squeezed arm where the unwind is live.
          //
          // So the whole of a promoted occurrence's history arrives as one
          // entry at the valuation it becomes visible in. That is the honest
          // statement of what the pool knows: it was carrying this file inside
          // an aggregate and started tracking it here.
          developingClaimsOut = live.map((d, i) => {
            const base = promotedIds.has(d.claimId) ? claims[i].original : claims[i].current;
            const moved = d.current - base;
            const series = [...(d.movementByStep ?? [])];
            while (series.length < c.age) series.push(0);
            series[c.age] = moved;
            return { ...d, movementByStep: series };
          });
          untrackedOut = untracked;
          // ⚠ THE BENCH FOLLOWS THE UNTRACKED MASS, because that is where its
          // dollars still are. Every allocation path gives the untracked total
          // a share PROPORTIONAL to what it holds, so one factor carries every
          // benched occurrence correctly — this is the same fact that lets the
          // mass be a single scalar in the first place. Applied after the
          // steps and after any promotion, so a promoted occurrence's dollars
          // are counted in the tracked list and not a second time here.
          if (benchOut && benchOut.length > 0 && untrackedAtStep > 0 && untracked !== untrackedAtStep) {
            const f = untracked / untrackedAtStep;
            benchOut = benchOut.map(b => ({ ...b, current: b.current * f }));
          }
        } else {
          // ⚠ THE DISABLED PATH IS THE ORIGINAL EXPRESSION, CHARACTER FOR
          // CHARACTER, AND IT HAS TO BE. An earlier version routed both paths
          // through `newUnpaid + newUnpaid * (factor - 1)`, which is the same
          // quantity in exact arithmetic and NOT the same in floating point:
          // the null test came back with 325 changed values at ~1e-12, e.g.
          // -260838.21407143585 -> -260838.21407143213. Nothing had changed
          // behaviourally and the gate was still right to fire — a null test
          // that tolerates reassociation cannot tell a reassociation from a
          // mechanism. Do not "simplify" these two lines into the branch above.
          // GROSS ledger only, read BEFORE the two net statements and differenced
          // AFTER them, so neither is touched. With no register to cede against
          // the whole movement is retained, so gross and net move together.
          const grossBefore = newUnpaid;
          if (DEVELOPMENT_CESSION_ENABLED) unallocatedDevelopment += newUnpaid * (factor - 1) + unwind;
          newUnpaid *= factor;
          newUnpaid += unwind;
          grossMovement += newUnpaid - grossBefore;
        }
      }
      // The register's movement lands on the gross ledger's unpaid balance, the
      // same way the retained part lands on the net one above — then floored,
      // for the reason set out where cGrossUnpaid is read.
      newGrossUnpaid = Math.max(0, newGrossUnpaid + grossMovement);

      // ⚠ THE FLOORS ARE GONE, AND THEY ARE NOW UNREACHABLE RATHER THAN MERELY
      // UNUSED. Three of them stood here:
      //
      //   Math.max(0, newUltimate)                 a negative estimate
      //   Math.max(0, newUltimate - c.netPaid)     the reserve floor — THE BUG
      //   Math.max(0, newUnpaid)                   a negative reserve
      //
      // The middle one was the defect this commit fixes. The walk moved the
      // ULTIMATE and the reserve was then recovered as ultimate - paid, so an
      // estimate revised below what the cohort had already paid was clipped:
      // favourable development truncated, adverse recognised in full. One-sided,
      // so E[incurred] > E[ultimate] and the martingale broke. It was NOT a tail
      // event — 9.04% of WC cohorts sat below their own paid-to-date, because by
      // age 5 WC has paid ~87% and the estimate only had to fall 13% to cross.
      //
      // Developing the reserve directly removes the crossing entirely: paid is
      // never revisited, and a lognormal factor on a positive balance stays
      // positive. ibner-null-check asserts the floored count is exactly 0.
      const newUltimate = newPaid + newUnpaid;
      developmentImpact += c.netUltimate - newUltimate;

      // ⚠ A COHORT MAY ONLY CLOSE ONCE IT HAS MATURED. Closing a still-
      // developing cohort would freeze its ultimate early and break
      // E[ultimate] = registerSum.
      //
      // ⚠ AND WHEN IT DOES CLOSE, THE RESIDUAL IS PAID, NOT DROPPED. The old
      // form marked a cohort closed at `newUnpaid < 1000` and then filtered it
      // out of the array the following year, so up to $1,000 of booked
      // liability silently vanished from the balance sheet — the source of the
      // audit page's declared closed-cohort variance (worst measured $2,278 at
      // pool scope). Paying it out instead makes the reserve rollforward an
      // EXACT identity, which is what lets ibner-null-check assert
      // netIncurredLoss === netUltimateLoss with no tolerance at all rather
      // than with an allowance that a real leak could hide under.
      //
      // Closing is ULTIMATE-NEUTRAL: the residual moves from unpaid to paid and
      // newUltimate = newPaid + newUnpaid is unchanged by it, so it cannot
      // disturb the martingale. That is why it is applied after newUltimate is
      // read off rather than before.
      // ⚠ A SHARE OF THIS COHORT'S OWN ULTIMATE, NOT A DOLLAR AMOUNT. This read
      // `newUnpaid < RESERVE_COHORT_CLOSE_FLOOR`, a flat $1,000, which terminated
      // a 35% geometric at about age 23 and does not terminate a Weibull at all:
      // WC reached $1,000 at age 98, so cohorts accumulated one a year and never
      // shed. See cohortCloseBelow for the fraction and what it costs.
      const closing = !developing && newUnpaid < cohortCloseBelow(LINE_PAYOUT_PATTERN[line], newUltimate);
      if (closing) {
        paydown += newUnpaid;
        newPaid += newUnpaid;
        newUnpaid = 0;
        // The gross ledger closes on the same event, for the same reason: a
        // closed cohort has paid everything it will pay, so leaving a gross
        // residual behind would make paid-to-incurred stall short of 1 forever
        // on exactly the cohorts that are finished.
        grossPaydown += newGrossUnpaid;
        newGrossPaid += newGrossUnpaid;
        newGrossUnpaid = 0;
      }
      netPaidThisYear += paydown;
      void grossPaydown;   // the cohort carries it; no net consumer reads it

      return {
        ...c,
        netUltimate: newUltimate,
        netUnpaid: newUnpaid,
        netPaid: newPaid,
        grossPaid: newGrossPaid,
        grossUnpaid: newGrossUnpaid,
        age: c.age + 1,
        closed: closing,
        developingClaims: developingClaimsOut,
        untrackedTotal: untrackedOut,
        developmentBench: benchOut,
        cededDevelopmentToDate: cededToDate,
      };
    });

  return {
    developmentImpact,
    updatedCohorts,
    netPaidThisYear,
    developmentCeded,
    unallocatedDevelopment,
  };
}

// THE PER-STEP LOG SIGMA ON THE REMAINING RESERVE that delivers this line's
// stated IBNER_TOTAL_SD as the total relative SD of the ULTIMATE.
//
// ⚠ DERIVED AT RUNTIME FROM THE LINE'S OWN PAYOUT PATTERN, NOT STORED. It is a
// function of the payout pattern, the horizon range and the step mixture, and storing it
// would let it drift silently the first time any of those moved — which is the
// exact failure this file keeps finding elsewhere. Solved once per line and
// cached; the root-find is a few dozen closed-form evaluations.
//
// WHY A MULTIPLIER IS NEEDED AT ALL. Developing a SHRINKING balance moves the
// ultimate far less than developing the whole estimate did, because step k only
// reaches the fraction of the ultimate still unpaid. The leverage lost is large
// and it is NOT transferable between lines — it depends on how fast each line
// pays:
//
//   line       paydown   E[H]   sum r_k^2   sqrt   old sqrt(H)   multiplier
//   WC          0.35      8.5    0.26326   0.5131    2.9155         5.68x
//   GL          0.35      5.5    0.26188   0.5117    2.3452         4.58x
//   Property    0.65      3.0    0.05016   0.2240    1.7321         7.73x
//
// (r_k is the share of ultimate exposed to step k. Under a geometric paydown
// that is openFraction x (1 - p)^k; under a fitted pattern it is the pattern's
// own unpaid share at that age, and the two branches below say which is which.)
//
// THE CLOSED FORM, and it is exact rather than fitted. Writing R_k for the
// balance remaining at step k and f_k for its lognormal factor,
//
//   ultimate(k+1) - ultimate(k) = R_k (f_k - 1)
//
// and E[R_k(f_k - 1) | F_k] = 0, so the increments are MARTINGALE DIFFERENCES:
// uncorrelated, and their variances add with no covariance terms.
//
//   Var = sum_k E[R_k^2] (e^{s^2} - 1),  E[R_k^2] = OPEN^2 (1-p)^{2(k+1)} e^{k s^2}
//
// which is geometric in a = (1-p)^2 e^{s^2}. Verified against a term-by-term sum
// to 12 significant figures.
//
// ⚠ DO NOT "CHECK" THIS BY MONTE CARLO AND BELIEVE THE MONTE CARLO. At the
// eventful decile's sigma the per-step factor is lognormal with s ~ 0.8 over up
// to 12 steps, and the sample variance of that is not estimable at practical
// sample sizes: 1M trials reported 87.5% of the true variance, 48M reported
// 93.3%, climbing monotonically toward the closed form from below. A run that
// "disagrees by 7%" is the run being wrong. Same lesson as WC's calendar CV.
// ⚠ THE CACHE IS KEYED ON THE TARGET, NOT JUST THE LINE, and that is not
// premature generality. ibner-null-check ZEROES IBNER_TOTAL_SD at runtime and
// asserts development is then identically zero; a line-only key would hand it a
// sigma solved before the mutation and the null test would silently measure the
// wrong thing — passing or failing for a reason unrelated to the code under
// test. Keying on the value makes the mutation work by construction.
const RESERVE_STEP_SIGMA_CACHE = new Map<string, number>();
function reserveStepSigma(line: CoverageLine): number {
  const target = IBNER_TOTAL_SD[line];
  const key = `${line}|${target}`;
  const hit = RESERVE_STEP_SIGMA_CACHE.get(key);
  if (hit !== undefined) return hit;
  const pattern = LINE_PAYOUT_PATTERN[line];
  const h = IBNER_HORIZON[line];
  // Total SD of ultimate/booked at a given sigma, averaged over the horizon
  // draw (inclusive uniform) and the step mixture — the same two dimensions a
  // real cohort draws from.
  const sdAt = (sigma: number): number => {
    let v = 0, n = 0;
    for (let H = h.min; H <= h.max; H++) {
      for (const b of IBNER_STEP_MIXTURE) {
        const s2 = (b.multiplier * sigma) ** 2;
        if (pattern.kind === 'geometric') {
          // ⚠ THE CLOSED FORM, KEPT CHARACTER FOR CHARACTER AS THE NULL TEST'S
          // CONTROL. It is the general sum below collapsed on the assumption
          // that (1 - p) is CONSTANT in k, which is exactly what a geometric
          // pattern is and exactly what a fitted one is not. The two agree to 12
          // significant figures and NOT bit for bit, and a null test cannot tell
          // a reassociation from a mechanism — the same reason
          // DEVELOPMENT_CESSION_ENABLED's disabled path preserves its original
          // expression. Do not "simplify" this into the branch below.
          const openFraction = pattern.openFraction;
          const p = pattern.conditional;
          const a = (1 - p) ** 2 * Math.exp(s2);
          const geo = Math.abs(a - 1) < 1e-12 ? H : (Math.pow(a, H) - 1) / (a - 1);
          v += b.weight * openFraction ** 2 * (1 - p) ** 2 * (Math.exp(s2) - 1) * geo;
        } else {
          // ⚠ THE GENERAL FORM: sum the martingale increments term by term.
          // R_k, the balance exposed to step k, is no longer OPEN x (1-p)^(k+1)
          // because the paydown rate now varies with age — it is simply the
          // pattern's own unpaid share after the paydown that step makes, which
          // is `unpaidShare(pattern, k + 2)` (see the age convention). The
          // e^{k s^2} factor is the variance the balance has already accumulated
          // and is unchanged.
          //
          // This is the term-by-term sum the closed form above was originally
          // VERIFIED AGAINST to 12 significant figures, so it is the same
          // quantity computed the long way rather than a new approximation. H is
          // at most 12, so summing it directly costs nothing.
          for (let k = 0; k < H; k++) {
            const rem = unpaidShare(pattern, k + 2);
            v += b.weight * rem ** 2 * Math.exp(k * s2) * (Math.exp(s2) - 1);
          }
        }
        n += b.weight;
      }
    }
    return Math.sqrt(v / n);
  };
  if (!(target > 0)) { RESERVE_STEP_SIGMA_CACHE.set(key, 0); return 0; }
  // Monotonic in sigma, so bisection is safe. 200 halvings of [0, 8] is far
  // past double precision — cheap, and it makes the result deterministic
  // rather than tolerance-dependent.
  let lo = 0, hi = 8;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (sdAt(mid) < target) lo = mid; else hi = mid;
  }
  const sigma = (lo + hi) / 2;
  RESERVE_STEP_SIGMA_CACHE.set(key, sigma);
  return sigma;
}

// One draw from IBNER_STEP_MIXTURE. Drawn ONCE PER COHORT — see the constant.
function drawStepMultiplier(rng: SeededRandom): number {
  const u = rng.next();
  let acc = 0;
  for (const bucket of IBNER_STEP_MIXTURE) {
    acc += bucket.weight;
    if (u < acc) return bucket.multiplier;
  }
  return IBNER_STEP_MIXTURE[IBNER_STEP_MIXTURE.length - 1].multiplier;
}

// The optimistic booking bias for a cohort written at this funding level.
// CLF 1.000 is break-even by construction, so anything at or above it books
// honestly and returns 0.
export function ibnerBookingBias(selectedFundingCLF: number): number {
  return IBNER_BOOKING_BIAS_COEFF * Math.max(0, 1 - selectedFundingCLF);
}

// ============================================================================
// THE UNWIND SCHEDULE — front-loaded, and EXACT.
//
// Returns the relative step to apply on the `step`-th year of a cohort's runoff
// (step 1 is its first development), such that
//
//     PRODUCT over step = 1..H of (1 + u_step)  ===  1 / (1 - bias)
//
// exactly. That identity is the whole reason the unwind exists: the estimate is
// booked at registerSum x (1 - bias), so the unwind has to multiply it back to
// registerSum by maturity or the cohort permanently mis-states its ultimate.
//
// ⚠ IT IS COMPUTED IN LOG SPACE BECAUSE THE OBVIOUS ARITHMETIC IS WRONG, and it
// was wrong here until this was written. The previous schedule used a flat
// `bias / horizon` per step, reasoning that H steps of b/H total b. They do not:
// the steps COMPOUND, so the total is (1 + b/H)^H ~ e^b, while landing on
// registerSum needs 1/(1 - b). Those differ at second order in b, so the error
// grows with the bias and with SHORT horizons where each step is large.
// Measured before the fix, at each line's own reachable slider minimum: WC
// missed registerSum by -2.32%, GL by -4.14%, Property by -14.73% on a
// two-year horizon. A cohort would mature having quietly kept part of the
// optimism forever, which is precisely the thing the unwind is for.
//
// Distributing the required LOG-unwind L = -ln(1 - bias) across the steps by
// weights that sum to 1 makes the product exact for any weights at all, which
// is what lets the shape be chosen freely without re-deriving the arithmetic.
// The weights here are geometric (IBNER_UNWIND_DECAY), so the first step
// carries about half.
// ⚠ THIS RETURNS A WEIGHT, NOT A FACTOR, AND THE CHANGE IS LOAD-BEARING. It used
// to be `ibnerUnwindStep`, returning the MULTIPLICATIVE factor
// expm1(weight x -ln(1 - bias)) whose product over the horizon was exactly
// 1/(1 - bias). That exactness was a property of multiplying the whole ULTIMATE.
//
// Once development moves onto the reserve, a multiplicative unwind inherits the
// shrinking-base problem the reserve walk was introduced to fix: the factors
// would multiply a balance that is paying down, so a cohort would mature having
// recovered only part of its booked optimism. The bias is inert at default
// funding (measured: 0.00% on all three lines), so this would have been a defect
// visible only on squeezed play — the worst kind.
//
// The caller now multiplies this weight by registerSum x bias and ADDS the
// dollars to the reserve. Adding X to the reserve adds X to paid + unpaid at
// once, so the total delivered over the runoff is exactly registerSum x bias for
// ANY weights summing to 1 — pathwise, independent of the stochastic path, and
// with no second-order term to go wrong. Strictly stronger than the log-space
// identity it replaces.
//
// The weights are geometric in IBNER_UNWIND_DECAY, so the first step carries
// about half. That front-loading decision is unchanged.
export function ibnerUnwindWeight(horizon: number, step: number): number {
  if (horizon <= 0 || step < 1 || step > horizon) return 0;
  const rho = IBNER_UNWIND_DECAY;
  // Sum of rho^0..rho^(H-1), the normaliser that makes the weights total 1.
  const denom = rho === 1 ? horizon : (1 - Math.pow(rho, horizon)) / (1 - rho);
  return Math.pow(rho, step - 1) / denom;
}
