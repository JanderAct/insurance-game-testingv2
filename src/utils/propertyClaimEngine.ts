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

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence } from '../types/simulation';
import { deriveSubRng, SeededRandom } from './random';
import { patternTrendFactor } from './claimMath';
import { PROPERTY_LOSS_MODEL } from '../data/defaultAssumptions';

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
          accidentYear: yearNumber,
          calendarYear,
          region: member.region,
          isCatastrophe: false,
          claimIds: [claimId],
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

// Internals the harness needs to check the model against its own parameters
// without duplicating them.
export const propertyInternals = {
  thetaFrequency,
  damageRatioMean,
  betaShape,
  payoutTrendFactor: PAYOUT_TREND_FACTOR,
};
