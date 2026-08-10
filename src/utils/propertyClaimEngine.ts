// Property ATTRITIONAL claim-level loss generator (design doc
// property_noncat_design section NC1).
//
// UNWIRED BY DESIGN. Nothing in simulationEngine calls this yet, and Property
// still runs the legacy aggregate member-Gamma path. That is deliberate:
// Property has THREE bands — attritional (~$16.8M), cat (~$7.5M) and weather
// (~$4.5M) — and attritional alone is 58% of the ~$28.8M book. A pure premium
// derived from this band alone would price Property at 58% of its eventual
// loss, and the loss ratio would break the moment the other two landed.
// Cutover happens once all three bands exist, not before.
//
// The invariants are WC's and GL's, unchanged:
//
// 1. ONE BASIS. generatePropertyClaims (the draw) and expectedPropertyGrossLoss
//    (the analytic expectation) are a matched pair over the same factors. The
//    expectation differs only by taking E[eps] = E[gPool] = 1 and using
//    analytic means. Change a factor in one, change it in the other.
//
// 2. RISK CONTROL HITS THE DRAW ONLY (finding 17). It multiplies the realized
//    Poisson lambda and is ABSENT from the expectation.
//
// 3. PURE PREMIUM HELD, k_PR ADAPTS — see deriveNeutralPropertyPurePremiumPer100,
//    which exists for measurement only until all three bands are built.
//
// 4. DOLLAR VINTAGE NEVER AMBIGUOUS. Severity is drawn and stored in
//    accident-year dollars; patternTrendFactor (claimMath, shared with WC) is
//    the only conversion, applied over the 70/25/5 payout vector at
//    construction-cost inflation.
//
// WHAT MAKES THIS BAND DIFFERENT FROM WC/GL:
//
// Severity is NOT drawn as a dollar amount. It is emerged from the book —
// a damage RATIO against the TIV of the specific location that was hit — which
// is what bounds every claim at insured value and is why Property needs a
// location schedule at all. Frequency likewise comes off the stored LOCATION
// COUNT, not off TIV: how often something burns is a function of how many
// buildings you have, not what they are worth.

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence, Region } from '../types/simulation';
import { deriveSubRng, SeededRandom } from './random';
import { drawLognormal, lognormalParams, lognormalPartialMoment, patternTrendFactor } from './claimMath';
import { PROPERTY_LOSS_MODEL, PROPERTY_WEATHER_MODEL } from '../data/defaultAssumptions';

const M = PROPERTY_LOSS_MODEL;
const LINE: CoverageLine = 'Property';
const NEUTRAL_RQ = 5;
const ATTRITIONAL = 'attritional';

// --- the location schedule ------------------------------------------------
//
// Two stored roster columns define it (NC1.2):
//   primary location            = TIV x primaryAssetShare
//   each of the other (n - 1)   = TIV x (1 - primaryAssetShare) / (n - 1)
//
// PRIMARY MEANS DESIGNATED, NOT LARGEST. For 9 v3 members the nominal primary
// is the smaller site (a 2-location member at share 0.41 holds 59% elsewhere).
// The schedule still sums to member TIV and severity is still capped at the
// hit location's value, so nothing downstream cares — but do not assume
// index 0 is the maximum.

export function locationCount(member: Member): number {
  const n = Math.round(member.locations ?? 0);
  return n >= 1 ? n : 1;
}

// The TIV of location `index` (0 = the designated primary). O(1): the schedule
// is never materialized, because it is drawn from ~112 times a year across a
// 1,866-location book.
export function locationTivAt(member: Member, index: number): number {
  const tiv = member.exposureByLine.Property ?? 0;
  const n = locationCount(member);
  // Locations == 1 never occurs in roster v3 (the minimum is 2), but a
  // single-location member must not divide by zero.
  if (n === 1) return tiv;
  const share = member.primaryAssetShare ?? 1 / n;
  return index === 0 ? tiv * share : (tiv * (1 - share)) / (n - 1);
}

// Sample one of the member's locations UNIFORMLY BY COUNT (NC1.2). Count
// weighting, deliberately not value weighting — an earlier draft tilted this
// "lightly by value" and that was removed. It also matters for the analytic:
// under count weighting E[hit location TIV] = TIV / n exactly, which is what
// makes the location count cancel out of the expected-loss identity (NC1.5).
function sampleLocationTiv(rng: SeededRandom, member: Member): number {
  const n = locationCount(member);
  const index = Math.min(n - 1, Math.floor(rng.next() * n));
  return locationTivAt(member, index);
}

// --- risk quality ----------------------------------------------------------
// Two channels, total beta 0.12 (NC1.3).

function thetaFrequency(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// Scales the Beta MEAN only, nu held fixed. RQ therefore acts on the DAMAGE
// RATIO and never on the dollar amount, which is what preserves the
// insured-value cap: a ratio <= 1 stays <= 1 however RQ moves it.
function damageRatioMean(riskQuality: number): number {
  return M.damageRatio.mean * Math.exp(-M.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
}

// Mean-concentration -> standard Beta shape parameters.
function betaShape(mean: number): { a: number; b: number } {
  const nu = M.damageRatio.concentration;
  return { a: mean * nu, b: (1 - mean) * nu };
}

// The accident-year -> settlement multiple for this band's payout vector.
// Constant in accidentYear (patternTrendFactor is translation-invariant), so
// it is computed once at module load rather than per claim.
const PAYOUT_TREND_FACTOR = patternTrendFactor(M.payoutPattern, M.severityTrendPerYear, 0);

// The largest factor by which a BOOKED severity can exceed its accident-year
// value. Exported so harnesses can state the insured-value cap correctly:
// damageRatio x locationTiv is capped at locationTiv exactly, and the booked
// figure at locationTiv x this, because rebuilding in a later year costs more.
export const PROPERTY_BOOKED_TREND_FACTOR = PAYOUT_TREND_FACTOR;

// --- analytic expectation (invariant 1) -------------------------------------

export interface ExpectedPropertyLossOptions {
  riskQualityOverride?: number;
  kPr?: number;
}

// Expected ATTRITIONAL gross loss for a book, in booked (settlement-trended)
// dollars.
//
// THE IDENTITY (NC1.5). Because the hit location is sampled uniformly by count,
// E[hit location TIV] = memberTIV / locations, so the location count CANCELS:
//
//   E[loss] = locations x baseFreq x theta x E[dr] x (memberTIV / locations)
//           = memberTIV x baseFreq x E[dr] x theta
//
// Expected attritional loss is therefore exactly proportional to member TIV,
// and pool-wide it is three numbers: total TIV x 0.06 x 0.04 = TIV x 0.0024.
// The location/asset chopping drives VARIANCE and per-risk firing only — never
// the loss level.
//
// E[dr] is the closed form (the Beta mean IS mu under the mean-concentration
// parameterization). Deliberately not integrated: the density is unbounded at
// zero for a < 1 and fixed-grid quadrature silently mis-integrates it.
export function expectedPropertyGrossLoss(
  members: Member[],
  options: ExpectedPropertyLossOptions = {},
): number {
  const kPr = options.kPr ?? 1;
  let total = 0;
  for (const member of members) {
    const tiv = member.exposureByLine.Property ?? 0;
    if (!(tiv > 0)) continue;
    const rq = options.riskQualityOverride ?? member.riskQuality;
    total += tiv
      * M.baseFrequencyPerLocation
      * thetaFrequency(rq)
      * damageRatioMean(rq)
      * kPr
      * PAYOUT_TREND_FACTOR;
  }
  // TIV is carried in $M.
  return total * 1e6;
}

// k_PR: the per-year roster/risk-quality-mix correction, same construction as
// k_line and k_GL — the ratio of the book's expected loss at neutral RQ to its
// expected loss at actual RQ.
//
// IT IS ALREADY TIV-WEIGHTED, with no separate weighting term. Expected
// attritional loss is exactly proportional to member TIV (the identity above),
// so a ratio of expected losses weights each member by its TIV by construction.
// Adding an explicit TIV weight would double-count it.
//
// It normalizes BOTH RQ channels — frequency and severity — because it is
// built from total expected loss, in which both appear.
export function computeKPr(members: Member[]): number {
  const neutral = expectedPropertyGrossLoss(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedPropertyGrossLoss(members);
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// Attritional-only pure premium per $100 of TIV.
//
// MEASUREMENT ONLY — DO NOT PRICE OFF THIS. It covers 58% of Property's
// expected loss; the weather and cat bands are not built. It exists so the
// harness can report what this band implies and so the eventual three-band
// pure premium has a component to check against.
export function deriveNeutralPropertyPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedPropertyGrossLoss(fullRoster, { riskQualityOverride: NEUTRAL_RQ, kPr: 1 });
  const tivUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0) * 10_000;
  if (!(tivUnits > 0)) return 0;
  return expected / tivUnits;
}

// --- the generator ----------------------------------------------------------

export interface PropertyGenerationInputs {
  members: Member[];
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kPr: number;
  gPool: number;                    // the year's shared pool factor (from processYear)
  riskControlEffectiveness: number; // DRAW ONLY
}

export interface PropertyGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCountsByBand: Record<string, number>;  // { attritional: n } — weather/cat later
  maxClaimGross: number;                      // per-risk signal: largest single claim
  perRiskBreaches: number;                    // claims exceeding the $2M per-risk retention
}

export function generatePropertyClaims(inputs: PropertyGenerationInputs): PropertyGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kPr, gPool, riskControlEffectiveness } = inputs;

  // Purpose-keyed streams; new labels, so nothing existing is disturbed.
  const freqRng = deriveSubRng(instanceSeed, yearNumber, 'pr_freq');
  const epsRng = deriveSubRng(instanceSeed, yearNumber, 'pr_eps');
  const locRng = deriveSubRng(instanceSeed, yearNumber, 'pr_loc');
  const sevRng = deriveSubRng(instanceSeed, yearNumber, 'pr_sev');

  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  const claimCountsByBand: Record<string, number> = { [ATTRITIONAL]: 0 };
  let grossUltimateLoss = 0;
  let maxClaimGross = 0;
  let perRiskBreaches = 0;

  for (const member of members) {
    const tiv = member.exposureByLine.Property ?? 0;
    const n = locationCount(member);
    let memberLoss = 0;

    if (tiv > 0) {
      // ONE eps per member-year, shared across that member's claims — the same
      // convention WC uses. k = 44.4 gives SD 0.15: this band is genuinely
      // stable, so its noise is far tighter than WC's or GL's.
      const eps = epsRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);

      // Poisson, not NegBin. Frequency trend is FLAT for this band, so no
      // trend factor appears here — that is NC1.1, not an omission.
      const lambda = n
        * M.baseFrequencyPerLocation
        * thetaFrequency(member.riskQuality)
        * eps
        * gPool
        * kPr
        * rcFactor;
      const count = freqRng.poisson(Math.max(0, lambda));

      const { a, b } = betaShape(damageRatioMean(member.riskQuality));

      for (let i = 0; i < count; i++) {
        const hitTiv = sampleLocationTiv(locRng, member);
        const damageRatio = sevRng.beta(a, b);
        // Severity EMERGED FROM THE BOOK: a ratio against the hit location's
        // insured value, so accident-year severity <= that value by
        // construction. The booked figure trends over the payout window,
        // which can exceed the location's accident-year TIV by at most
        // PROPERTY_BOOKED_TREND_FACTOR — rebuilding later genuinely costs
        // more, and that is not a breach of the cap.
        const accidentYearSeverity = damageRatio * hitTiv * 1e6; // TIV is $M
        const gross = accidentYearSeverity * PAYOUT_TREND_FACTOR;

        const occurrenceId = `PR-${yearNumber}-${member.id}-${i}`;
        const claimId = `${occurrenceId}-c1`;
        claims.push({
          id: claimId,
          occurrenceId,
          memberId: member.id,
          line: LINE,
          accidentYear: yearNumber,
          calendarYear,
          tier: ATTRITIONAL,
          status: 'open',
          // Report lag ~0: property damage is known the day it happens.
          reportedYear: yearNumber,
          grossUltimate: gross,
          paidToDate: 0,
          caseReserve: gross,
          paymentPattern: [...M.payoutPattern],
          damageRatio,
          locationTiv: hitTiv * 1e6,
        });
        // Attritional claims are independent single-location events, so
        // occurrence and claim are 1:1. The weather and cat bands are what
        // will emit one occurrence owning many claims.
        occurrences.push({
          id: occurrenceId,
          line: LINE,
          memberId: member.id,
          memberIds: [member.id],
          accidentYear: yearNumber,
          calendarYear,
          region: member.region,
          isCatastrophe: false,
          claimIds: [claimId],
          peril: ATTRITIONAL,
          // No intensity: an attritional loss has no hazard-intensity draw.
        });
        memberLoss += gross;
        grossUltimateLoss += gross;
        claimCountsByBand[ATTRITIONAL]++;
        if (gross > maxClaimGross) maxClaimGross = gross;
        if (gross > M.perRiskRetention) perRiskBreaches++;
      }
    }

    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: tiv,
      riskQuality: member.riskQuality,
      expectedLoss: expectedPropertyGrossLoss([member], { kPr }),
      coefficientOfVariation: 0,
      standardDeviation: 0,
      simulatedLoss: memberLoss,
    });
  }

  return {
    claims,
    occurrences,
    grossUltimateLoss,
    memberLossResults,
    claimCountsByBand,
    maxClaimGross,
    perRiskBreaches,
  };
}

// ===========================================================================
// NON-CAT WEATHER band (design doc property_noncat section NC2).
//
// ALSO UNWIRED. Same reason as the attritional band above, and nothing calls
// either one — cutover happens when all three bands exist.
//
// Hail, wind, freeze, non-catastrophic flood: event-driven like cat but
// frequent and light. The signature is MANY SIMULTANEOUS MID-SIZED CLAIMS AND
// NO SINGLE LARGE ONE, which is exactly why weather lives in the gap between
// the two occurrence treaties (every claim too small for the per-risk XoL, the
// occurrence total below the $5M cat attachment) and erodes into the aggregate
// instead. That gap is the reason an aggregate treaty exists at all.
//
// THREE THINGS THIS BAND DOES DIFFERENTLY FROM ATTRITIONAL:
//
// 1. THE UNIT IS THE EVENT, NOT THE MEMBER. Frequency is drawn PER ZONE, not
//    per member, and one event hits many members at once. This is the first
//    genuinely multi-member occurrence in the model — hence Occurrence.memberIds.
//
// 2. WITHIN-EVENT CORRELATION IS THE MECHANIC. Every claim in an event shares
//    the event's damage-ratio MEAN, so a severe storm makes all of its claims
//    worse together. Independent per-claim severity would destroy the band's
//    whole reason for existing.
//
// 3. INTENSITY ENTERS TWICE — once through the footprint
//    (hit_rate = min(base x I, cap)) and once through the damage ratio
//    (event mean dr = mu x I). Expected loss per event therefore scales with a
//    SECOND moment of intensity, not with E[I] = 1 (finding 22).
//
// NO gPool, AND NO RISK CONTROL. Both are deliberate exclusions:
//   - gPool is an ECONOMIC-CYCLE factor. Hazard bands are not modulated by the
//     economic cycle. This generalises: the cat band must exclude it too, for
//     the same reason. (What gPool would actually do here is raise variance and
//     induce cross-line correlation — it would NOT move the AAL, since its mean
//     is exactly 1.000.)
//   - Risk control multiplies a member's realized frequency, and weather
//     frequency is a per-zone hazard count with no member attribution, so there
//     is nothing for it to multiply. The design locks RQ's frequency channel to
//     zero for the same reason: the hazard is nature's, not the member's.
//
// NOT SCALED BY k_PR either — but do not read that as "weather is not
// normalised." Weather HAS an RQ channel (severity, beta 0.04), so at an
// enrolled book's risk-quality mix its expected loss sits slightly off the
// priced level, and that drift is real. It needs its own normalisation ON ITS
// OWN CHANNEL; that lands at cutover, when there is a premium to normalise
// against. expectedWeatherGrossLoss takes a riskQualityOverride so the size of
// the drift can be measured now.

const W = PROPERTY_WEATHER_MODEL;
const WEATHER = 'weather';

// Fixed iteration order, so the year's event sequence is deterministic.
const WEATHER_ZONES: Region[] = ['North', 'Central', 'South'];

// Intensity above which the footprint hits its cap.
const WX_CAP_INTENSITY = W.cap / W.baseFootprint;

// E[ min(baseFootprint x I, cap) x I ] for I ~ LogNormal(mean 1, cv) — the
// "intensity enters twice" factor, in closed form via partial moments.
//
// THE NAIVE 1 + CV^2 CORRECTION DOES NOT LAND, exactly as the design doc says:
// that would be E[I^2] = 1.36, giving 0.1360, while the true value is 0.13555
// because the footprint cap truncates the top of the intensity distribution.
// The doc concludes from this that no closed form lands. That is true of the
// naive correction only — splitting the expectation at the cap and using exact
// lognormal PARTIAL moments handles it precisely, with no quadrature and so no
// exposure to the singularity trap that fixed grids fall into.
const WX_INTENSITY_FACTOR =
  W.baseFootprint * lognormalPartialMoment(1, W.intensityCv, 2, WX_CAP_INTENSITY)
  + W.cap * (1 - lognormalPartialMoment(1, W.intensityCv, 1, WX_CAP_INTENSITY));

// Weather's own payout vector (80/20 over two years) at construction-cost
// inflation. Same shared machinery, a different vector — not a second trending
// convention.
const WEATHER_PAYOUT_TREND_FACTOR = patternTrendFactor(W.payoutPattern, M.severityTrendPerYear, 0);

export const WEATHER_BOOKED_TREND_FACTOR = WEATHER_PAYOUT_TREND_FACTOR;

// RQ acts on the damage ratio ONLY (rqFrequencyBeta is 0 by design, not by
// omission). Scales the Beta MEAN with nu held fixed, so a ratio <= 1 stays
// <= 1 however RQ moves it — the same construction the attritional band uses.
function weatherSeverityFactor(riskQuality: number): number {
  return Math.exp(-W.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
}

function weatherBetaShape(mean: number): { a: number; b: number } {
  const nu = W.betaConcentration;
  return { a: mean * nu, b: (1 - mean) * nu };
}

// --- analytic expectation (invariant 1) -------------------------------------

// Expected annual weather gross loss for a book, in booked dollars.
//
// THE IDENTITY. Locations are hit by INDEPENDENT per-location Bernoulli draws
// at hit_rate, and the damage ratio is independent of which locations were hit,
// so for one event in zone z:
//
//   E[loss | I] = hit_rate(I) x (mu x I) x zoneTIV(z)
//
// whatever the size mix of locations in the zone. Taking expectations over I
// gives mu x E[min(b I, c) I] x zoneTIV(z), and summing over zones at a COMMON
// lambda per zone collapses the zone structure entirely:
//
//   AAL = lambdaPerZone x mu x E[min(b I, c) I] x SUM_members(TIV x rqSev) x trend
//
// ⚠ THE MULTIPLIER IS lambdaPerZone, NOT 3 x lambdaPerZone. There are 7.5
// events a year, but each one exposes ONE zone — about a third of the book —
// so 2.5 x total TIV is the correct exposure, and 7.5 x total TIV triple-counts
// it. This is the easiest thing in the band to get wrong by a factor of three.
//
// Also note what is NOT here: no location count (it cancels, as in the
// attritional identity), and no zone TIVs (they sum to the book). Weather AAL
// is therefore EXACTLY LINEAR IN TIV, which is why roster v4 rescaled the
// target AAL without re-solving mu.
export interface ExpectedWeatherLossOptions {
  riskQualityOverride?: number;
}

export function expectedWeatherGrossLoss(
  members: Member[],
  options: ExpectedWeatherLossOptions = {},
): number {
  let weightedTiv = 0;
  for (const member of members) {
    const tiv = member.exposureByLine.Property ?? 0;
    if (!(tiv > 0)) continue;
    const rq = options.riskQualityOverride ?? member.riskQuality;
    weightedTiv += tiv * weatherSeverityFactor(rq);
  }
  return W.lambdaPerZone
    * W.betaMean
    * WX_INTENSITY_FACTOR
    * weightedTiv * 1e6          // TIV is carried in $M
    * WEATHER_PAYOUT_TREND_FACTOR;
}

// --- the generator ----------------------------------------------------------

export interface WeatherGenerationInputs {
  members: Member[];
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
}

// One event's outcome. gross, affectedLocations and memberGross are per-EVENT;
// the annual result below also carries per-member sums across all events,
// because at cutover a member's weather loss has to be added to its attritional
// loss and neither the event view nor the member view can be derived from the
// other after the fact.
export interface WeatherEventResult {
  // null when the footprint caught nothing — a drawn event that hits no
  // location produces NO occurrence, because an occurrence with no claims is
  // not a loss event, it is a weather report.
  occurrence: Occurrence | null;
  claims: Claim[];
  gross: number;
  memberGross: Map<string, number>;
  intensity: number;
  hitRate: number;
  locationsExposed: number;
  affectedLocations: number;
  maxClaimGross: number;
}

export interface WeatherEventSummary {
  id: string;
  region: Region;
  intensity: number;
  hitRate: number;
  locationsExposed: number;
  affectedLocations: number;
  membersAffected: number;
  gross: number;
  maxClaimGross: number;
}

export interface WeatherGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberGross: Map<string, number>;   // per-member sums across the year
  eventsDrawn: number;                // includes zero-footprint events
  eventsWithLoss: number;             // == occurrences.length
  events: WeatherEventSummary[];      // one row per event DRAWN
}

// The per-zone member index plus the streams an event consumes. Built once a
// year by generateWeatherEvents; also the argument a harness builds directly
// when it wants to force events at chosen intensities.
export interface WeatherEventContext {
  membersByZone: Map<Region, Member[]>;
  yearNumber: number;
  calendarYear: number;
  hitRng: SeededRandom;
  sevRng: SeededRandom;
}

export function groupMembersByZone(members: Member[]): Map<Region, Member[]> {
  const byZone = new Map<Region, Member[]>();
  for (const zone of WEATHER_ZONES) byZone.set(zone, []);
  for (const member of members) {
    if (!((member.exposureByLine.Property ?? 0) > 0)) continue;
    byZone.get(member.region)?.push(member);
  }
  return byZone;
}

// FORCED-EVENT ENTRY POINT. Takes the zone and the realized intensity as
// arguments rather than drawing them, so a harness can hold intensity fixed and
// measure the footprint and severity response independently — the two channels
// intensity feeds — instead of inferring them through the frequency draw.
export function generateWeatherEvent(
  ctx: WeatherEventContext,
  region: Region,
  intensity: number,
  eventId: string,
): WeatherEventResult {
  const hitRate = Math.min(W.baseFootprint * intensity, W.cap);
  // The event's SHARED damage-ratio mean — the within-event correlation.
  const eventMeanDr = W.betaMean * intensity;

  const claims: Claim[] = [];
  const memberIds: string[] = [];
  const memberGross = new Map<string, number>();
  let gross = 0;
  let locationsExposed = 0;
  let affectedLocations = 0;
  let maxClaimGross = 0;

  for (const member of ctx.membersByZone.get(region) ?? []) {
    const n = locationCount(member);
    locationsExposed += n;

    // Per-member because RQ scales the event mean; nu is untouched.
    const { a, b } = weatherBetaShape(eventMeanDr * weatherSeverityFactor(member.riskQuality));
    let memberLoss = 0;
    let memberClaims = 0;

    for (let index = 0; index < n; index++) {
      // PER-LOCATION BERNOULLI, not a Binomial count followed by a selection.
      // Distributionally identical for the count, but this way the affected
      // set is made of ACTUAL locations carrying their ACTUAL TIVs, so
      // within-member concentration (Primary Asset Share) flows through to
      // event severity instead of being averaged away.
      if (!ctx.hitRng.chance(hitRate)) continue;
      affectedLocations++;

      const hitTiv = locationTivAt(member, index);
      const damageRatio = ctx.sevRng.beta(a, b);
      const accidentYearSeverity = damageRatio * hitTiv * 1e6;   // TIV is $M
      const claimGross = accidentYearSeverity * WEATHER_PAYOUT_TREND_FACTOR;

      claims.push({
        id: `${eventId}-${member.id}-L${index}`,
        occurrenceId: eventId,
        memberId: member.id,
        line: LINE,
        accidentYear: ctx.yearNumber,
        calendarYear: ctx.calendarYear,
        tier: WEATHER,
        status: 'open',
        // Report lag 0: storm damage is known the day it happens.
        reportedYear: ctx.yearNumber,
        grossUltimate: claimGross,
        paidToDate: 0,
        caseReserve: claimGross,
        paymentPattern: [...W.payoutPattern],
        damageRatio,
        locationTiv: hitTiv * 1e6,
      });

      memberLoss += claimGross;
      memberClaims++;
      gross += claimGross;
      if (claimGross > maxClaimGross) maxClaimGross = claimGross;
    }

    // Keyed on WHETHER A CLAIM WAS EMITTED, not on memberLoss > 0. The damage
    // ratio is Beta with a tiny shape parameter, so a hit location can produce
    // a genuinely negligible amount — but it was still hit, it still generated
    // a claim record, and dropping it from memberIds would leave the occurrence
    // disagreeing with its own claim list.
    if (memberClaims > 0) {
      memberIds.push(member.id);
      memberGross.set(member.id, memberLoss);
    }
  }

  const occurrence: Occurrence | null = claims.length === 0 ? null : {
    id: eventId,
    line: LINE,
    // Present ONLY when the event hit exactly one member. A weather event
    // normally hits dozens, and memberIds is the authoritative list.
    memberId: memberIds.length === 1 ? memberIds[0] : undefined,
    memberIds,
    accidentYear: ctx.yearNumber,
    calendarYear: ctx.calendarYear,
    // The zone struck — the correlation unit, not any one member's region.
    region,
    // FALSE AS A BAND LABEL, not as a claim about size. Weather and cat are
    // deliberately a fuzzy boundary: same process, overlapping ranges, and a
    // severe weather event can punch into the cat retention. This flag says
    // "generated by the weather band", and the treaty waterfall must decide
    // what responds from the occurrence TOTAL, never from this flag.
    isCatastrophe: false,
    claimIds: claims.map(c => c.id),
    peril: WEATHER,
    intensity,
  };

  return {
    occurrence, claims, gross, memberGross, intensity, hitRate,
    locationsExposed, affectedLocations, maxClaimGross,
  };
}

export function generateWeatherEvents(inputs: WeatherGenerationInputs): WeatherGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed } = inputs;

  // Purpose-keyed streams; new labels, so nothing existing is disturbed.
  const freqRng = deriveSubRng(instanceSeed, yearNumber, 'pr_wx_freq');
  const intensityRng = deriveSubRng(instanceSeed, yearNumber, 'pr_wx_intensity');
  const ctx: WeatherEventContext = {
    membersByZone: groupMembersByZone(members),
    yearNumber,
    calendarYear,
    hitRng: deriveSubRng(instanceSeed, yearNumber, 'pr_wx_hit'),
    sevRng: deriveSubRng(instanceSeed, yearNumber, 'pr_wx_sev'),
  };

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const events: WeatherEventSummary[] = [];
  const memberGross = new Map<string, number>();
  let grossUltimateLoss = 0;
  let eventsDrawn = 0;

  for (const region of WEATHER_ZONES) {
    // PER-ZONE Poisson at 2.5, giving 7.5 events/yr pool-wide. Each zone draws
    // its own count at the same rate: weather has no regional hazard
    // differentiation, so zones differ only through TIV.
    const count = freqRng.poisson(W.lambdaPerZone);
    for (let i = 0; i < count; i++) {
      // Mean exactly 1.0, CV 0.6, through the SAME lognormalParams the analytic
      // factor above is built from — the draw and the expectation are one basis
      // by construction, not by two matching hand-derivations.
      const intensity = drawLognormal(intensityRng, 1, W.intensityCv);
      const event = generateWeatherEvent(ctx, region, intensity, `PRWX-${yearNumber}-${region}-${i}`);
      eventsDrawn++;

      events.push({
        id: `PRWX-${yearNumber}-${region}-${i}`,
        region,
        intensity: event.intensity,
        hitRate: event.hitRate,
        locationsExposed: event.locationsExposed,
        affectedLocations: event.affectedLocations,
        membersAffected: event.memberGross.size,
        gross: event.gross,
        maxClaimGross: event.maxClaimGross,
      });

      if (event.occurrence) occurrences.push(event.occurrence);
      claims.push(...event.claims);
      grossUltimateLoss += event.gross;
      for (const [id, amount] of event.memberGross) {
        memberGross.set(id, (memberGross.get(id) ?? 0) + amount);
      }
    }
  }

  return {
    claims,
    occurrences,
    grossUltimateLoss,
    memberGross,
    eventsDrawn,
    eventsWithLoss: occurrences.length,
    events,
  };
}

// Internals the harness needs to check the model against its own parameters
// without duplicating them.
export const propertyInternals = {
  thetaFrequency,
  damageRatioMean,
  betaShape,
  payoutTrendFactor: PAYOUT_TREND_FACTOR,
  weatherSeverityFactor,
  weatherBetaShape,
  weatherPayoutTrendFactor: WEATHER_PAYOUT_TREND_FACTOR,
  wxIntensityFactor: WX_INTENSITY_FACTOR,
  wxCapIntensity: WX_CAP_INTENSITY,
  wxIntensityLogParams: lognormalParams(1, W.intensityCv),
  weatherZones: WEATHER_ZONES,
};
