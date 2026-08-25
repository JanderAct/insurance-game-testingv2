// Workers' Compensation claim-level loss generator.
//
// Draws ONE loss amount per claim from a per-rating-group lognormal mixture,
// then a REPORT LAG. Replaces the four-tier structure (medical-only /
// temporary / permanent / catastrophic plus a separate presumption process)
// whose parameters were authored as priors and then fitted to each other.
//
// FOUR INVARIANTS THIS MODULE EXISTS TO HOLD
//
// 1. ONE BASIS FOR LOSSES AND PRICING (finding 6). generateWcClaims (the draw)
//    and the expectation below are written as a matched pair over the same
//    factors — same group rates, same theta, same mixture weights, same
//    component means. (Region multipliers were on that list until region left
//    chronic severity; they are shock-only now.) The expectation differs from the
//    draw ONLY by taking E[member noise] = 1 and using analytic component
//    means. WC's purePremiumPer100 is derived from the expectation, so premium
//    and losses cannot drift onto different bases. Change a factor in one and
//    you must change it in the other.
//
// 2. TWO CHANNELS ARE DRAW-ONLY (finding 17). riskControlEffectiveness AND the
//    risk-quality SEVERITY TILT multiply the draw and are ABSENT from the
//    pricing expectation. Applying either to both sides would move premium and
//    losses together and cancel — exactly the no-op finding 17 identified for
//    loss trend. Keeping them one-sided is what makes risk control and risk
//    quality genuinely move the loss ratio.
//
//    ⚠ THE TILT IS NOT ABSENT FROM k_line. k_line's job is to normalise the
//    book's risk-quality MIX, so it must see every channel RQ acts on or the
//    held pure premium drifts as the roster changes. That is why there are TWO
//    named expectation wrappers below rather than one function with a boolean.
//
// 3. PURE PREMIUM IS HELD, k_line ADAPTS. The pick is derived once from the
//    neutral book (deriveNeutralPurePremiumPer100) and does not track the
//    roster; computeKLine does the per-year risk-quality-mix correction. Both
//    tracking enrolment would double-correct.
//
// 4. A CLAIM'S AMOUNT IS FIXED AT DRAW, AND THE LAG DOES NOT TREND IT.
//    Severity carries no trend at all in this model, so there is no dollar
//    vintage to track and no truncation to impose. That is not a simplification
//    for its own sake: trending severity over the lag would make
//    E[(1 + r)^lag] over an unbounded lognormal DIVERGENT, which is precisely
//    why the retired presumption process had to bound its lag at 40 years. The
//    severity fit stays exactly as fitted.

import type {
  Claim,
  CoverageLine,
  Member,
  MemberLossResult,
  Occurrence,
  Region,
} from '../types/simulation';
import { deriveSubRng } from './random';
import { limitedExpectedValue, memoizeByYear } from './claimMath';
import {
  WC_LOSS_MODEL,
  WC_RATING_GROUPS,
  WC_SEVERITY_CAP,
  WC_SEVERITY_COMPONENTS,
  type WcComponentKey,
  type WcRatingGroup,
} from '../data/defaultAssumptions';
import { shockFactorFor } from './shockEffects';

const M = WC_LOSS_MODEL;
const LINE: CoverageLine = 'WC';
const NEUTRAL_RQ = 5;

// --- small shared helpers ---------------------------------------------------

// A member's rating group. STORED on the member, never derived — see
// WC_HIGH_SAFETY_CITIES for why deriving it from WC_CLASS_MIX is impossible.
// Throws rather than defaulting: a member with no group would silently generate
// no WC claims at all, which is the kind of hole that reads as a calibration
// drift months later.
export function ratingGroupOf(member: Member): WcRatingGroup {
  const g = member.wcRatingGroup;
  if (!g) {
    throw new Error(
      `member '${member.id}' (${member.name}) has no wcRatingGroup. It is a STORED attribute assigned `
      + `in memberCatalog.ts and cannot be derived — see WC_HIGH_SAFETY_CITIES.`,
    );
  }
  return g;
}

// Keyed lookup over the roster's authored Region.
//
// ⚠ NO LONGER IN THE SEVERITY PATH. Region used to multiply every WC claim's
// severity, chronically and permanently. It is retained as DATA because shock
// events need it — a regional catastrophe is a real thing for region to scale —
// but a standing +/-5% on every claim in the south was asserted with nothing
// behind it, and it is gone from both the draw and the analytic.
//
// ⚠ AND THE CLAIM IT USED TO CARRY WAS FALSE. This said "Mean-neutral by
// construction, so region shifts the DISTRIBUTION of severity across members
// without moving the book's expected loss." The MULTIPLIERS are mean-neutral
// (0.95/1.00/1.05 average to exactly 1.00); the ROSTER is not. Payroll shares
// run North 35.2% / Central 34.4% / South 30.4%, so the payroll-weighted mean
// is 0.99759 and the book's expected loss WAS moved, by -0.24%.
//
// That 0.24% is not a curiosity. It is exactly why four rating-group class
// rates left a -0.34% composition residual: within a rating group, members
// still differed by region, so a group's expectation was not proportional to
// its payroll. With region out of severity, a rating group is genuinely
// homogeneous and four rates become exact.
export function regionMultiplier(region: Region): number {
  return M.regionMultiplier[region] ?? 1;
}

// Risk-quality frequency factor. RQ 10 (best) draws fewer claims, RQ 1 more.
// EXPORTED so wcLossDistribution's cumulant derivation reads the exact same
// formula the draw uses, rather than a second copy that could drift from it.
export function thetaWc(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// Safety improves ~1.5%/yr. Live Year 1 is the reference (factor 1.0); the
// pre-game years sit slightly above 1 — the past was more dangerous.
//
// EXPORTED SO PRICING CAN APPLY IT TOO. The draw has always trended; the PRICE
// did not, so WC losses ran below the priced level by construction and the gap
// compounded — 93.5% of expected over ten years, which is most of the pool's
// underwriting drift. See the note on WC_HELD_PURE_PREMIUM_PER_100's use site.
//
// ⚠ IT IS SAFE AT THE PRICING STEP PRECISELY BECAUSE IT IS ROSTER-BLIND: a pure
// function of yearNumber and one constant. The held-pure-premium rule forbids
// RECOMPUTING the pick annually (that double-corrects against k_line and makes
// pricing chase the roster); it does not forbid a deterministic factor that
// cannot see who is enrolled.
// MEMOIZED. Pure function of yearNumber, called once per DRAWN CLAIM inside
// expectedWcGrossLossCore's/generateWcClaims's member loops and once per
// member inside wcAggregateCumulants — up to ~1,825 calls/yr at full market on
// the claim-generation path alone. NO FLOOR here (the default identity key),
// deliberately unlike wageFactor/wcSeverityTrend — see this function's own
// header just above for why the pre-game is allowed to run frequency hotter.
export const wcFrequencyTrend = memoizeByYear(
  (yearNumber: number) => Math.pow(1 + M.frequencyTrendPerYear, yearNumber - 1),
);

// WC SEVERITY TREND — the other half of the wage-inflation pair.
//
// ⚠ NEVER APPLY THIS WITHOUT THE PAYROLL FACTOR, OR THE PAYROLL FACTOR WITHOUT
// THIS. They are a pair. Payroll growing while severity does not makes the rate
// fall 5.1%/yr instead of 1.46%; severity growing while payroll does not makes
// it rise 2.1%/yr. Together they nearly cancel and the rate trend is the
// frequency trend alone, adjusted by their 0.04% difference:
//
//   rate trend = 0.985 x 1.0367 / 1.0363 = 0.98538  ->  -1.462%/yr
//
// SOURCED: WCIRB blended severity 3.67% (52% medical @ 3.70%, 48% indemnity @
// 3.63%). See src/data/exposureTrend.ts for the full derivation, why the two
// trends cancel BY CONSTRUCTION rather than coincidence, and why CAS's
// prescribed separate medical/indemnity trends are not available to this model.
export const WC_SEVERITY_TREND_PER_YEAR = 0.0367;

// Live year 1 is the reference (factor 1.0).
//
// ⚠ FLOORS AT YEAR 1, exactly as wageFactor does, and for the same reason — see
// the long note there. The pre-game is an initial-conditions generator whose
// dollar constants are year-1 dollars, not a wage history. The two factors must
// floor TOGETHER: pinning payroll while letting severity deflate would make the
// drawn and priced loss diverge across the years that set opening reserves.
// MEMOIZED, FLOORED AT THE CACHE KEY. This is the one that fires once per
// DRAWN CLAIM in generateWcClaims's severity draw (the amount = ... line) —
// ~1,825/yr at full market, every single game-year, not just diagnostics —
// plus once per (member, component, k=1..4) inside wcAggregateCumulants. Both
// floor at year 1 (see the header on wageFactor for why the pre-game floors
// while wcFrequencyTrend above deliberately does not), so years -2, -1, 0 and
// 1 share one cache entry.
export const wcSeverityTrend = memoizeByYear(
  (yearNumber: number) => Math.pow(1 + WC_SEVERITY_TREND_PER_YEAR, Math.max(1, yearNumber) - 1),
  yearNumber => Math.max(1, yearNumber),
);

// A component's log-location shifted to a given year. exp(mu + ln(s)) = s x
// exp(mu), so a location shift in log space IS a multiplicative scale, and it
// keeps sigma untouched.
export function trendedMu(mu: number, yearNumber: number): number {
  return mu + Math.log(wcSeverityTrend(yearNumber));
}

// THE CEILING IN THAT YEAR'S DOLLARS. WC_SEVERITY_CAP is the YEAR-1 ceiling and
// this trends it at the same rate the severity itself trends.
//
// ⚠ THIS IS WHAT MAKES THE SEVERITY-SCALE INVARIANCE TRUE. A ceiling fixed in
// nominal dollars while mu walks up is a ceiling that tightens in real terms —
// $85M was 28% smaller by year 10 in year-1 terms. That is not a neutral
// choice: it silently changes the SHAPE of the modelled distribution over a
// game, which is why the aggregate CV drifted and why both this file's and
// wcClfGrid's severity-scale invariance had to be written down as FALSE.
//
// With the ceiling trending alongside the distribution the algebra closes:
//
//   min(s X, s L) = s min(X, L)   =>   E[min(s X, s L)] = s E[min(X, L)]
//
// so every capped moment scales by exactly s^k again, the CV is genuinely
// trend-invariant, and a held year-1 pure premium times the raw trend is once
// more the right price. Verified to 2.7e-15 relative, not assumed.
//
// FLOORED AT YEAR 1 and memoized on that floor, matching wcSeverityTrend
// exactly — the cap must floor with the trend it rides on, or the pre-game
// years would draw against a ceiling their severities never see.
export const wcSeverityCap = memoizeByYear(
  (yearNumber: number) => WC_SEVERITY_CAP * wcSeverityTrend(yearNumber),
  yearNumber => Math.max(1, yearNumber),
);

// Mean of one mixture component, CAPPED at that year's ceiling.
//
// ⚠ THERE IS NO REGION SCALING LEFT TO MATCH. This carried a long warning that
// the cap had to be divided by the region multiplier, because the draw was
// `min(lognormal(mu, sigma) x regionMult, CAP_t)` and the matching analytic was
// therefore `regionMult x E[min(X, CAP_t / regionMult)]`. Region is out of
// chronic severity, so both sides see the same unscaled distribution against
// the same ceiling. The warning is recorded rather than deleted because it
// describes a real trap that will return the moment a shock scales severity
// per-region: whatever scales the DRAW must divide the analytic's limit.
//
// ⚠ `limit` NOW DEFAULTS TO THE YEAR'S CAP, NOT THE YEAR-1 CONSTANT. It used to
// read `limit = WC_SEVERITY_CAP`, which was correct only while the ceiling was
// nominal; leaving it would have left every default-limit caller pricing year 10
// against a year-1 ceiling — the same matched-pair break this comment warns
// about, arriving through a default argument instead of a forgotten factor.
// Callers that scale by a region must still pass the scaled limit;
// expectedClaimSeverity below does.
export function componentMean(key: WcComponentKey, yearNumber = 1, limit?: number): number {
  const c = WC_SEVERITY_COMPONENTS[key];
  return limitedExpectedValue(
    trendedMu(c.mu, yearNumber), c.sigma, limit ?? wcSeverityCap(yearNumber));
}

// THE RISK-QUALITY SEVERITY TILT. Multiplies the HEAVY component's weight and
// renormalises the others, preserving their ratio to each other:
//
//   w_heavy' = clamp(w_heavy x exp(-rqSeverityBeta x (RQ - 5)))
//   scale    = (1 - w_heavy') / (sum of the other weights at group level)
//
// Returns weights in the group's own mix order. At RQ 5 this is the identity,
// so the neutral book is untouched.
//
// ⚠ DRAW AND k_line ONLY — never the pricing expectation. See invariant 2.
export function tiltedWeights(group: WcRatingGroup, riskQuality: number, params = M): number[] {
  const g = params.ratingGroups[group];
  const factor = Math.exp(-params.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
  const heavyIndex = g.mix.findIndex(m => m.component === g.heavyComponent);
  if (heavyIndex < 0) {
    throw new Error(`rating group '${group}' declares heavyComponent '${g.heavyComponent}', which is not in its mix`);
  }
  const baseHeavy = g.mix[heavyIndex].weight;
  // The clamp must exist even though it should not bind: the largest case is
  // High Safety at 0.4113 x 1.271 = 0.5228. 0.999 rather than 1.0 so the other
  // components keep a positive weight and `scale` stays finite.
  const tiltedHeavy = Math.min(baseHeavy * factor, 0.999);
  const otherTotal = g.mix.reduce((s, m, i) => (i === heavyIndex ? s : s + m.weight), 0);
  const scale = otherTotal > 0 ? (1 - tiltedHeavy) / otherTotal : 0;
  return g.mix.map((m, i) => (i === heavyIndex ? tiltedHeavy : m.weight * scale));
}

// Group weights with NO tilt — the pricing basis.
function groupWeights(group: WcRatingGroup, params = M): number[] {
  return params.ratingGroups[group].mix.map(m => m.weight);
}

// Expected severity of one claim from this group, over its mixture.
// `weights` is passed in so the caller decides tilted vs untilted rather than
// this function guessing — the same reason the two expectation wrappers exist.
export function expectedClaimSeverity(
  group: WcRatingGroup,
  weights: number[],
  yearNumber: number,
  params = M,
): number {
  const mix = params.ratingGroups[group].mix;
  // ⚠ THE regionMult PARAMETER IS GONE, and with it the CAP/regionMult limit
  // this function used to compute. Region no longer scales severity, so the
  // ceiling applies to the unscaled claim and the limit is simply that year's
  // cap. The scaled-limit reasoning that stood here was correct while region
  // was in the draw; it has nothing left to correct for.
  const limit = wcSeverityCap(yearNumber);
  let total = 0;
  for (let i = 0; i < mix.length; i++) total += weights[i] * componentMean(mix[i].component, yearNumber, limit);
  return total;
}

// --- exported: analytic expectation ------------------------------------------

export interface ExpectedWcLossOptions {
  // Force every member to this risk quality (used for the neutral book and for
  // k_line's numerator). Omit to use each member's actual risk quality.
  riskQualityOverride?: number;
  kLine?: number;        // default 1
  yearNumber?: number;   // default 1 (frequency trend factor 1.0)
  // Shock component-frequency multipliers, for MEASURING a shock's expected
  // cost — never for pricing. The difference between this expectation with and
  // without them IS the analytic expected addition.
  componentFreqMultipliers?: Record<string, number>;
}

// WHICH RISK-QUALITY CHANNELS THE EXPECTATION SEES.
//
//   'pricing'  frequency theta only. The severity tilt is draw-only
//              (invariant 2), so including it here would move premium and
//              losses together and cancel.
//   'kLine'    BOTH channels. k_line normalises the book's risk-quality mix,
//              so it has to see everything RQ does or the held pure premium
//              drifts as the roster changes.
//
// NO DEFAULT, and two named wrappers below rather than a boolean parameter:
// the call site should read its own intent. `expectedWcGrossLoss(members,
// true)` does not.
type WcLossBasis = 'pricing' | 'kLine';

function expectedWcGrossLossCore(
  members: Member[],
  basis: WcLossBasis,
  options: ExpectedWcLossOptions,
): number {
  const params = M;
  const rqOverride = options.riskQualityOverride;
  const kLine = options.kLine ?? 1;
  const trend = wcFrequencyTrend(options.yearNumber ?? 1);

  let total = 0;
  for (const member of members) {
    const payroll = member.exposureByLine.WC ?? 0;
    if (payroll <= 0) continue;
    const rq = rqOverride ?? member.riskQuality;
    const group = ratingGroupOf(member);
    const g = params.ratingGroups[group];
    const lambda = payroll * g.ratePer1M * thetaWc(rq) * kLine * trend;
    const weights = basis === 'kLine' ? tiltedWeights(group, rq, params) : groupWeights(group, params);

    for (let i = 0; i < g.mix.length; i++) {
      let componentLambda = lambda * weights[i];
      if (options.componentFreqMultipliers) {
        componentLambda *= shockFactorFor(options.componentFreqMultipliers, g.mix[i].component);
      }
      const yr = options.yearNumber ?? 1;
      total += componentLambda * componentMean(g.mix[i].component, yr, wcSeverityCap(yr));
    }
  }
  return total;
}

// The analytic expected GROSS loss for PRICING. Frequency theta only — see the
// WcLossBasis comment. This is what purePremiumPer100 and every displayed
// expected loss derive from.
export function expectedWcGrossLossForPricing(members: Member[], options: ExpectedWcLossOptions = {}): number {
  return expectedWcGrossLossCore(members, 'pricing', options);
}

// The analytic expected GROSS loss on the k_line basis — BOTH risk-quality
// channels. Only computeKLine should need this; it is exported so the
// diagnostic can assert the two bases differ in the direction expected.
export function expectedWcGrossLossForKLine(members: Member[], options: ExpectedWcLossOptions = {}): number {
  return expectedWcGrossLossCore(members, 'kLine', options);
}

// --- exported: k_line ---------------------------------------------------------

// The risk-quality-mix normaliser: expected loss if the enrolled book were all
// at neutral risk quality, over expected loss at its actual mix. Applied to
// lambda so that changing WHO is enrolled doesn't drift the pool's aggregate
// expected loss away from the held pick.
//
// BOTH SIDES USE THE k_line BASIS, so the correction covers frequency theta AND
// the severity tilt. At neutral RQ the tilt is the identity, so the numerator is
// unaffected by it and the ratio measures exactly the mix effect.
export function computeKLine(members: Member[]): number {
  const neutral = expectedWcGrossLossForKLine(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedWcGrossLossForKLine(members, {});
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// --- exported: the held neutral pure premium ----------------------------------

// WC's purePremiumPer100, derived ONCE from the full canonical roster at neutral
// risk quality and then HELD. Expressed per $100 of payroll, matching the
// engine's expectedLoss = exposure x PP x 10,000.
// THE FOUR HELD CLASS RATES — one per WC rating group, each derived over that
// group's own payroll on exactly the basis deriveNeutralPurePremiumPer100 uses
// for the single blended rate.
//
// ⚠ THIS IS NOT A SECOND WAY TO PRICE, IT IS THE SAME PRICE STOPPED ONE STEP
// EARLIER. The blended rate IS the payroll-weighted average of these four over
// the full roster — reproduced to 1.3e-15 — so nothing has been re-fitted or
// re-calibrated. What changes is that the blend is taken over the ENROLLED book
// rather than over the roster, so a pool that is unusually schools-heavy pays a
// schools-heavy price instead of the market's average price.
//
// ⚠ FOUR RATES ARE EXACT ONLY BECAUSE REGION LEFT SEVERITY, and that ordering is
// why this was worth two commits. While region multiplied severity, two members
// of the same rating group in different regions had different loss costs, so a
// group's expectation was not proportional to its payroll and four rates left a
// -0.34% composition residual. With region gone a rating group is genuinely
// homogeneous: measured over 4,000 random subsets of the roster, the worst
// residual is 2.1e-15. Twelve group-by-region cells would have been needed
// otherwise.
//
// DERIVED, NOT STORED, for the same reason the single rate is: a literal would
// go stale the first time a group's mixture, rate or roster membership moved,
// and the symptom would be a line priced slightly wrong with nothing pointing
// at the cause.
export function deriveNeutralClassRatesPer100(fullRoster: Member[]): Record<WcRatingGroup, number> {
  const out = {} as Record<WcRatingGroup, number>;
  for (const group of WC_RATING_GROUPS) {
    const members = fullRoster.filter(m => ratingGroupOf(m) === group);
    const payrollUnits = members.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0) * 10_000;
    out[group] = payrollUnits > 0
      ? expectedWcGrossLossForPricing(members, { riskQualityOverride: NEUTRAL_RQ, kLine: 1, yearNumber: 1 })
        / payrollUnits
      : 0;
  }
  return out;
}

export function deriveNeutralPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedWcGrossLossForPricing(fullRoster, {
    riskQualityOverride: NEUTRAL_RQ,
    kLine: 1,
    yearNumber: 1,
  });
  const payrollUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0) * 10_000;
  if (!(payrollUnits > 0)) return 0;
  return expected / payrollUnits;
}

// --- exported: the generator ---------------------------------------------------

export interface WcGenerationInputs {
  members: Member[];          // the book to generate for
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kLine: number;
  riskControlEffectiveness: number; // DRAW ONLY — see invariant 2
  // Claims a shock event injects this year, each with an EXPLICIT AMOUNT.
  //
  // ⚠ NO accidentYearOffset ANY MORE. Backdating existed so a retroactive shock
  // could add claims to prior accident years and have them surface through the
  // report-lag inventory. With claims reported in the year they occur there is
  // no channel for that, and a claim labelled to a prior year would still hit
  // this year's P&L — the label would be decoration. See shock #10, retargeted.
  injections?: { count: number; amount: number }[];
  // Current-horizon shock multipliers on a COMPONENT'S ARRIVAL RATE. Keys are
  // component names ('large', ...) or '*' for every component. DRAW ONLY.
  componentFreqMultipliers?: Record<string, number>;
}

export interface WcGenerationResult {
  // Every claim from THIS accident year. Every `accidentYear` equals yearNumber.
  //
  // ⚠ THIS IS NOW AN ACCIDENT-YEAR FIGURE ON ALL THREE LINES. It used to be
  // WC's CALENDAR-year reported loss — this accident year's non-delayed claims
  // plus prior years' emergence — while GL's and Property's were accident-year.
  // One field meaning two things by line is what surfaced the report lag in the
  // first place. currentAccidentYearGross is gone because it is now identical to
  // this, and keeping both would reintroduce the ambiguity under a second name.
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCountsByGroup: Record<string, number>;
  claimCountsByComponent: Record<string, number>;
  // One entry per requested injection, in the same order.
  injectionResults: { count: number; gross: number }[];
}

export function generateWcClaims(inputs: WcGenerationInputs): WcGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kLine, riskControlEffectiveness } = inputs;
  const params = M;
  const componentFreqMultipliers = inputs.componentFreqMultipliers;

  const trend = wcFrequencyTrend(yearNumber);
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  const claimCountsByGroup: Record<string, number> = {};
  const claimCountsByComponent: Record<string, number> = {};
  for (const g of WC_RATING_GROUPS) claimCountsByGroup[g] = 0;
  for (const c of Object.keys(WC_SEVERITY_COMPONENTS)) claimCountsByComponent[c] = 0;


  // Emit one claim + its occurrence. WC emits exactly ONE claim per occurrence,
  // which is what makes the per-occurrence tower's layer arithmetic exact at
  // claim level.
  const emit = (
    id: string,
    memberId: string,
    region: Region,
    ratingGroup: WcRatingGroup,
    component: WcComponentKey | 'injected',
    amount: number,
    accidentYear: number,
    reportedYear: number,
  ) => {
    const occurrenceId = `wc-occ-${id}`;
    occurrences.push({
      id: occurrenceId,
      line: LINE,
      memberId,
      memberIds: [memberId],
      accidentYear,
      calendarYear,
      region,
      // WC injuries are individual events; a shared catastrophe grouping is a
      // Property concept and stays false here.
      isCatastrophe: false,
      claimIds: [id],
    });
    claims.push({
      id,
      occurrenceId,
      memberId,
      line: LINE,
      accidentYear,
      calendarYear,
      // The mixture component replaces the retired tier. Kept on the field
      // named `tier` so the claims export, the tower and every count-by-type
      // readout keep working against one vocabulary rather than two.
      tier: component,
      ratingClass: ratingGroup,
      status: 'open',
      reportedYear,
      grossUltimate: amount,
      paidToDate: 0,
      caseReserve: amount,
    });
  };

  for (const member of members) {
    // PER-MEMBER STREAMS, KEYED ON member.id. deriveSubRng hashes the whole
    // purpose string, so the key space is free.
    //
    // WHY NOT ONE STREAM PER YEAR consumed in member order: the marketplace
    // generator draws for all 200 members, and a member's claim history must not
    // depend on WHO ELSE is enrolled or on iteration order. Keying per member
    // makes each member's draws a pure function of (seed, year, memberId) —
    // asserted in scripts/diagnostics/enrolment-independence-check.ts.
    const freqRng = deriveSubRng(instanceSeed, yearNumber, `wc_freq:${member.id}`);
    const sevRng = deriveSubRng(instanceSeed, yearNumber, `wc_sev:${member.id}`);

    const payroll = member.exposureByLine.WC ?? 0;
    const rq = member.riskQuality;
    const group = ratingGroupOf(member);
    const g = params.ratingGroups[group];

    const before = claims.length;

    if (payroll > 0) {
      // Per member-year noise, mean 1. NO POOL FACTOR — it was removed from WC
      // (see WC_LOSS_MODEL.poolYearFactor); the pool-level draw still happens for
      // GL, and WC simply does not read it.
      const epsilon = freqRng.gamma(params.memberFrequencyNoise.shape, params.memberFrequencyNoise.scale);
      const lambda = payroll * g.ratePer1M * thetaWc(rq) * kLine * trend * epsilon * rcFactor;
      const weights = tiltedWeights(group, rq, params);

      // ⚠ POISSON THINNING: one Poisson draw PER COMPONENT at rate
      // lambda x w_i x k_i, rather than one Poisson for the total followed by a
      // multinomial assignment. Absent a shock the two are distributionally
      // IDENTICAL, so this is not a behaviour change — but it is what makes a
      // component-frequency shock expressible without touching the weights.
      //
      // AND THAT MATTERS: raising a component's WEIGHT would force the others
      // DOWN to keep the mix summing to 1, so a presumption-style expansion of
      // severe claims would make ordinary sprained backs RARER. Under thinning
      // that mistake cannot be written.
      for (let i = 0; i < g.mix.length; i++) {
        const componentKey = g.mix[i].component;
        let componentLambda = lambda * weights[i];
        if (componentFreqMultipliers) {
          componentLambda *= shockFactorFor(componentFreqMultipliers, componentKey);
        }
        const count = freqRng.poisson(componentLambda);
        if (count <= 0) continue;
        claimCountsByGroup[group] += count;
        claimCountsByComponent[componentKey] += count;

        const spec = WC_SEVERITY_COMPONENTS[componentKey];
        for (let n = 0; n < count; n++) {
          // Severity: a single amount, no legs, no trend, no vintage.
          // TRENDED AT THE ACCIDENT YEAR, and fixed there forever.
          //
          // The trend-free-lag warning that stood here is retired with the lag
          // itself: there is no longer a gap between accident and report year for
          // a trend to be applied over, so E[(1+r)^lag] cannot arise.
          // ⚠ NO REGION MULTIPLIER. It used to scale this draw and the
          // matching analytic together; region no longer touches chronic
          // severity at all (see regionMultiplier). The scaled-ceiling
          // reasoning that stood here went with it — there is one ceiling now
          // and it applies to the unscaled claim.
          //
          // ⚠ AT THIS YEAR'S CEILING, not the year-1 constant. trendedMu above
          // already moved the distribution; the ceiling moves with it, so the
          // draw and expectedClaimSeverity stay the same truncated distribution
          // in every year rather than only in year 1.
          const amount = Math.min(
            sevRng.lognormal(trendedMu(spec.mu, yearNumber), spec.sigma),
            wcSeverityCap(yearNumber));
          const id = `wc-${yearNumber}-${member.id}-${componentKey}-${n}`;
          emit(id, member.id, member.region, group, componentKey, amount, yearNumber, yearNumber);
        }
      }
    }

    const reportedThisYear = claims.slice(before).reduce((s, c) => s + c.grossUltimate, 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: payroll,
      riskQuality: rq,
      expectedLoss: expectedWcGrossLossForPricing([member], { kLine, yearNumber }),
      // Not modelled per member: dispersion is an emergent property of frequency
      // x mixture, not a single per-member CV.
      coefficientOfVariation: 0,
      standardDeviation: 0,
      // ACCIDENT-YEAR BASIS, matching grossUltimateLoss. With the report lag
      // gone every claim this member incurred this year is already in here, so
      // there is nothing deferred to exclude and nothing emerging to add later.
      simulatedLoss: reportedThisYear,
    });
  }

  // --- shock injections ---------------------------------------------------------
  //
  // Emitted through the SAME `emit` closure the natural draws use, so an
  // injected claim is indistinguishable from a drawn one.
  //
  // ⚠ AN INJECTION CARRIES AN EXPLICIT AMOUNT, and that is deliberate. Injecting
  // "one claim of component `large`" and letting it draw would produce its MEAN
  // of $96,529 — against the retired catastrophic tier's $9.0M, which is 93x
  // smaller and would silently gut the event. $9.0M is component `large`'s
  // 99.95th percentile, not its mean. An instructor-triggered event wants a
  // reproducible amount, not a tail draw.
  //
  // ITS OWN RNG STREAM ('wc_inject'), so natural claims are bit-identical whether
  // or not anything is injected.
  const injectionResults: { count: number; gross: number }[] = [];
  if (inputs.injections?.length) {
    const injRng = deriveSubRng(instanceSeed, yearNumber, 'wc_inject');

    // WHO IT HAPPENS TO, drawn from the NATURAL INCIDENCE of severe claims:
    // payroll x group rate x the group's heavy-component weight. An injected
    // event lands where such an event actually lands, rather than on an
    // arbitrary or worst-case member.
    const targets: { member: Member; group: WcRatingGroup; weight: number }[] = [];
    let totalWeight = 0;
    for (const member of members) {
      const payroll = member.exposureByLine.WC ?? 0;
      if (payroll <= 0) continue;
      const group = ratingGroupOf(member);
      const g = params.ratingGroups[group];
      const heavy = g.mix.find(m => m.component === g.heavyComponent);
      const weight = payroll * g.ratePer1M * (heavy?.weight ?? 0);
      if (weight > 0) { targets.push({ member, group, weight }); totalWeight += weight; }
    }

    const injectedByMember = new Map<string, number>();
    let injSeq = 0;
    for (const injection of inputs.injections) {
      if (!(injection.amount > 0)) {
        throw new Error(`WC claim injection requires a positive explicit amount; got ${injection.amount}`);
      }
      let count = 0;
      let gross = 0;
      for (let i = 0; i < injection.count && totalWeight > 0; i++) {
        let pick = targets[targets.length - 1];
        let u = injRng.next() * totalWeight;
        for (const t of targets) { u -= t.weight; if (u <= 0) { pick = t; break; } }

        // Always THIS accident year. Backdating is gone with the report lag —
        // see the note on WcGenerationInputs.injections.
        injSeq += 1;
        const id = `wc-inject-${yearNumber}-${injSeq}`;
        // ⚠ AN INJECTED CLAIM IS CAPPED TOO, AT THIS YEAR'S CEILING. The cap is
        // a statement about what a WC claim can cost, so an instructor-triggered
        // event cannot exceed it either — otherwise "WC severity is bounded"
        // would be false on exactly the path most likely to be pointed at in a
        // classroom. Inert against the current catalog (its two WC injections
        // are $900k and $9M), so this changes no shipped scenario; it is here
        // so a future $200M event is clamped rather than silently reopening
        // the unbounded band.
        //
        // The injected amount is a NOMINAL instruction — the instructor names a
        // dollar figure — so it is not trended, but the ceiling it is clamped
        // against is. A $200M event injected in year 10 therefore lands at that
        // year's higher ceiling, not year 1's.
        const injectedAmount = Math.min(injection.amount, wcSeverityCap(yearNumber));
        emit(id, pick.member.id, pick.member.region, pick.group, 'injected', injectedAmount, yearNumber, yearNumber);
        claimCountsByGroup[pick.group] += 1;
        injectedByMember.set(pick.member.id, (injectedByMember.get(pick.member.id) ?? 0) + injectedAmount);
        count += 1;
        gross += injectedAmount;
      }
      injectionResults.push({ count, gross });
    }

    for (const result of memberLossResults) {
      const added = injectedByMember.get(result.memberId);
      if (added) result.simulatedLoss += added;
    }
  }

  const grossUltimateLoss = claims.reduce((s, c) => s + c.grossUltimate, 0);
  return {
    claims,
    occurrences,
    grossUltimateLoss,
    memberLossResults,
    claimCountsByGroup,
    claimCountsByComponent,
    injectionResults,
  };
}
