// Workers' Compensation claim-level loss generator (design doc Part A).
//
// Replaces WC's aggregate member-Gamma draw with individual Claim/Occurrence
// objects, so the $1M retention waterfall, per-claim reserving and per-tier
// development have real objects to work on. Pure and side-effect free: every
// random draw comes from a seed-derived stream, so the same inputs always
// produce the same claims.
//
// THREE INVARIANTS THIS MODULE EXISTS TO HOLD
//
// 1. ONE BASIS FOR LOSSES AND PRICING (finding 6). generateWcClaims (the
//    draw) and expectedWcGrossLoss (the analytic expectation) are written as
//    a matched pair over the same factors — same rates, same theta, same
//    tier mix, same severity means, same region multipliers. The expectation
//    differs from the draw ONLY by taking E[noise] = E[gPool] = 1 and using
//    analytic severity means. WC's purePremiumPer100 is derived from the
//    expectation, so premium and losses cannot drift onto different bases.
//    If you change a factor in one function, change it in the other.
//
// 2. RISK CONTROL HITS THE DRAW ONLY (finding 17). riskControlEffectiveness
//    multiplies the realized Poisson lambda in generateWcClaims and is
//    ABSENT from expectedWcGrossLoss. Applying it to both would move premium
//    and losses together and cancel — exactly the no-op finding 17
//    identified for loss trend. Keeping it one-sided is what makes risk
//    control genuinely reduce the loss ratio.
//
// 3. PURE PREMIUM IS HELD, k_line ADAPTS. The pick is derived once from the
//    neutral book (deriveNeutralPurePremiumPer100) and does not track the
//    roster; computeKLine does the per-year risk-quality-mix correction.
//    Both tracking enrollment would double-correct and make the loss ratio
//    wander.
//
// 4. DOLLAR VINTAGE IS NEVER AMBIGUOUS. Every severity is DRAWN and STORED in
//    ACCIDENT-YEAR dollars. trendToSettlement() below is the ONLY place a
//    value is carried to a different year's dollars, and it is applied
//    per leg — medical legs at WC medicalTrend, indemnity legs at
//    indemnityTrend. This is the input contract Phase 3 reserving reads:
//    reserving trends and discounts FROM accident-year dollars; it does not
//    have to reconstruct a vintage this module threw away.
//
//    Discounting is NOT done here, with exactly one exception: the
//    catastrophic tier books present value (see catastrophicStream). The
//    asymmetry is deliberate and is justified at that call site.

import type { Claim, ClaimAnnuity, CoverageLine, Member, MemberLossResult, Occurrence, Region } from '../types/simulation';
import { deriveSubRng } from './random';
import {
  drawLognormal,
  drawTruncatedLognormal,
  expectedOverLognormal,
  patternTrendFactor,
  trendToSettlement,
} from './claimMath';
import {
  WC_CLASS_KEYS,
  WC_CLASS_MIX,
  WC_LOSS_MODEL,
  type WcClassKey,
  type WcTier,
} from '../data/defaultAssumptions';

const M = WC_LOSS_MODEL;
const LINE: CoverageLine = 'WC';
const NEUTRAL_RQ = 5;

// --- small shared helpers ---------------------------------------------------

// trendToSettlement, patternTrendFactor, the lognormal helpers and the
// truncated-lognormal pair now live in claimMath.ts, shared with the GL and
// Property generators. Their invariants
// (single vintage-conversion point; truncate-and-renormalise with the draw
// and the analytic integrating the identical density) are documented there.

// Present value of a payment stream that starts at `firstPayment` in year 0
// (undiscounted) and escalates at `growth`, discounted at `discount`.
function presentValueOfStream(firstPayment: number, growth: number, discount: number, years: number): number {
  if (years <= 0) return 0;
  const ratio = (1 + growth) / (1 + discount);
  if (Math.abs(ratio - 1) < 1e-12) return firstPayment * years;
  return firstPayment * ((Math.pow(ratio, years) - 1) / (ratio - 1));
}

// Nominal (undiscounted) sum of the same stream. Reported for comparison and
// used by diagnostics; deliberately NOT what a catastrophic claim books.
export function nominalSumOfStream(firstPayment: number, growth: number, years: number): number {
  if (years <= 0) return 0;
  if (Math.abs(growth) < 1e-12) return firstPayment * years;
  return firstPayment * ((Math.pow(1 + growth, years) - 1) / growth);
}

function classPayroll(member: Member, cls: WcClassKey): number {
  const mix = WC_CLASS_MIX[member.type];
  if (!mix) return 0;
  return (member.exposureByLine.WC ?? 0) * mix[cls];
}

// Weekly indemnity benefit: two-thirds of wage, subject to the statutory cap.
function weeklyBenefit(cls: WcClassKey): number {
  const weeklyWage = M.classAnnualWage[cls] / 52;
  return Math.min(M.indemnityWageReplacement * weeklyWage, M.statutoryWeeklyCap);
}

// Keyed lookup over the roster's authored Region. Mean-neutral by construction
// (see the table's comment) — unlike the superseded 1-5 array, region no longer
// shifts the book's expected severity, only its distribution across members.
export function regionMultiplier(region: Region): number {
  return M.regionMultiplier[region] ?? 1;
}

// Risk-quality frequency factor. RQ 10 (best) draws fewer claims, RQ 1 more.
function thetaWc(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// Risk-quality duration factor: worse risk quality means longer disability.
function durationFactor(riskQuality: number): number {
  return Math.exp(-M.rqDurationBeta * (riskQuality - NEUTRAL_RQ));
}

// Safety improves ~1.5%/yr. Live Year 1 is the reference (factor 1.0); the
// pre-game years sit slightly above 1 — the past was more dangerous.
function frequencyTrend(yearNumber: number): number {
  return Math.pow(1 + M.frequencyTrendPerYear, yearNumber - 1);
}

// Tier probabilities with the risk-quality tilt applied. Worse risk quality
// shifts weight toward costlier tiers; CATASTROPHIC PROBABILITY IS HELD FIXED
// (A6) and the other three renormalise to the remaining mass.
function tierProbabilities(cls: WcClassKey, riskQuality: number): Record<WcTier, number> {
  const base = M.tierProbabilities[cls];
  const delta = M.rqTierMixDelta * (NEUTRAL_RQ - riskQuality);
  const weighted = {
    medOnly: base.medOnly * Math.exp(delta * M.tierMixScores.medOnly),
    temp: base.temp * Math.exp(delta * M.tierMixScores.temp),
    perm: base.perm * Math.exp(delta * M.tierMixScores.perm),
  };
  const total = weighted.medOnly + weighted.temp + weighted.perm;
  const remaining = 1 - base.catastrophic;
  return {
    medOnly: (weighted.medOnly / total) * remaining,
    temp: (weighted.temp / total) * remaining,
    perm: (weighted.perm / total) * remaining,
    catastrophic: base.catastrophic,
  };
}

// --- catastrophic annuity ---------------------------------------------------

// A catastrophic claim's payment schedule, given the injured worker's age.
// Disability-adjusted remaining life is a deliberate closed-form PROXY
// ((lifeExpectancyAge - age) x disabilityAdjustment) standing in for a
// mortality table — the one place a table would otherwise be required.
//
// Returns the NOMINAL schedule (what gets stored on the claim, because Phase 3
// reserving needs the real payment stream) alongside both its nominal sum and
// its present value.
//
// THE CLAIM BOOKS PRESENT VALUE, and this is the only tier that discounts
// before Phase 3. Why the asymmetry is correct: med-only, temp and perm settle
// inside a 2-5 year payout window, so their trended-nominal value and their
// present value differ by less than the noise in the severity draw — booking
// trended-nominal there is fine. This tier compounds medical inflation over
// ~34 years, where undiscounted nominal runs roughly 2.5x present value; a
// number that large is not a meaningful booked liability, it is an artifact of
// refusing to discount. Phase 3 removes the asymmetry by discounting every
// cohort properly, at which point this flat rate goes away.
function catastrophicStream(
  age: number,
  cls: WcClassKey,
  regionMult: number,
): { annuity: ClaimAnnuity; nominalTotal: number; presentValue: number } {
  const c = M.catastrophic;
  const medicalYears = Math.max(0, (c.lifeExpectancyAge - age) * c.disabilityAdjustment);
  const indemnityYears = Math.max(0, c.retirementAge - age);
  const medicalFirstYearPayment = c.medicalFirstYear * regionMult;
  const indemnityAnnualPayment = weeklyBenefit(cls) * 52 * regionMult;

  const annuity: ClaimAnnuity = {
    medicalFirstYearPayment,
    medicalInflationPct: M.medicalTrend,
    medicalYears,
    indemnityAnnualPayment,
    indemnityInflationPct: M.indemnityTrend,
    indemnityYears,
  };

  const nominalTotal =
    nominalSumOfStream(medicalFirstYearPayment, M.medicalTrend, medicalYears) +
    nominalSumOfStream(indemnityAnnualPayment, M.indemnityTrend, indemnityYears);

  const presentValue =
    presentValueOfStream(medicalFirstYearPayment, M.medicalTrend, M.catastrophicDiscountRate, medicalYears) +
    presentValueOfStream(indemnityAnnualPayment, M.indemnityTrend, M.catastrophicDiscountRate, indemnityYears);

  return { annuity, nominalTotal, presentValue };
}

// E[catastrophic severity] over age ~ Uniform(ageMin, ageMax). The stream is
// non-linear in age (the medical leg is a geometric sum), so this is a
// deterministic midpoint quadrature rather than an evaluation at the mean age
// — no RNG, and stable across runs.
const AGE_QUADRATURE_POINTS = 1000;
function expectedCatastrophicSeverity(cls: WcClassKey, regionMult: number): number {
  const c = M.catastrophic;
  const width = (c.ageMax - c.ageMin) / AGE_QUADRATURE_POINTS;
  let sum = 0;
  for (let i = 0; i < AGE_QUADRATURE_POINTS; i++) {
    const age = c.ageMin + (i + 0.5) * width;
    // Present value, matching what the draw books.
    sum += catastrophicStream(age, cls, regionMult).presentValue;
  }
  return sum / AGE_QUADRATURE_POINTS;
}

// E[trend factor over the presumption report lag]. The lag enters as an
// exponent, so this is E[(1 + medicalTrend)^round(lag)] by quadrature, not the
// factor at the mean lag — matching the draw, which rounds each drawn lag to a
// whole reporting year.
function expectedPresumptionTrendFactor(): number {
  return expectedOverLognormal(
    M.presumption.reportLagYearsMean,
    M.presumption.reportLagYearsCv,
    lag => Math.pow(1 + M.medicalTrend, Math.round(lag)),
    // The SAME truncation the draw applies, renormalised. Without the bound
    // this expectation is divergent, not merely large.
    M.presumption.maxReportLagYears,
  );
}

// --- analytic severity means (matched pair with the draws below) ------------

// Settlement-year value of one claim of this tier, in the same terms the draw
// books it: accident-year severity carried over the tier's payout window at
// each leg's own trend rate (catastrophic instead books present value).
// Pattern factors depend only on the offsets within the pattern, so the
// accident year passed here cancels — it is routed through trendToSettlement
// anyway to keep vintage conversion in one place.
function expectedTierSeverity(tier: WcTier, cls: WcClassKey, riskQuality: number, regionMult: number): number {
  const dur = durationFactor(riskQuality);
  const ay = 0;
  switch (tier) {
    case 'medOnly': {
      const medFactor = patternTrendFactor(M.payoutPatterns.medOnly, M.medicalTrend, ay);
      return M.severity.medOnly.mean * medFactor * regionMult;
    }
    case 'temp':
    case 'perm': {
      const spec = tier === 'temp' ? M.severity.temp : M.severity.perm;
      const pattern = M.payoutPatterns[tier];
      const indemFactor = patternTrendFactor(pattern, M.indemnityTrend, ay);
      const medFactor = patternTrendFactor(pattern, M.medicalTrend, ay);
      const indemnity = weeklyBenefit(cls) * spec.durationWeeksMean * dur * indemFactor;
      const medical = spec.medicalMean * medFactor;
      return (indemnity + medical) * regionMult;
    }
    case 'catastrophic':
      return expectedCatastrophicSeverity(cls, regionMult);
  }
}

// Expected severity of a single claim from this class, across the tier mix.
function expectedClaimSeverity(cls: WcClassKey, riskQuality: number, regionMult: number): number {
  const probs = tierProbabilities(cls, riskQuality);
  let total = 0;
  for (const tier of ['medOnly', 'temp', 'perm', 'catastrophic'] as WcTier[]) {
    total += probs[tier] * expectedTierSeverity(tier, cls, riskQuality, regionMult);
  }
  return total;
}

// --- exported: analytic expectation ----------------------------------------

export interface ExpectedWcLossOptions {
  // Force every member to this risk quality (used for the neutral book and
  // for k_line's numerator). Omit to use each member's actual risk quality.
  riskQualityOverride?: number;
  kLine?: number;        // default 1
  yearNumber?: number;   // default 1 (trend factor 1.0)
  includePresumption?: boolean; // default true
}

// The analytic expected GROSS loss for a book of members — the pricing side
// of invariant 1. Deliberately excludes risk control (invariant 2) and takes
// E[member noise] = E[pool factor] = 1.
export function expectedWcGrossLoss(members: Member[], options: ExpectedWcLossOptions = {}): number {
  const rqOverride = options.riskQualityOverride;
  const kLine = options.kLine ?? 1;
  const trend = frequencyTrend(options.yearNumber ?? 1);
  const includePresumption = options.includePresumption ?? true;

  let total = 0;
  for (const member of members) {
    const rq = rqOverride ?? member.riskQuality;
    const regionMult = regionMultiplier(member.region);
    const theta = thetaWc(rq);

    for (const cls of WC_CLASS_KEYS) {
      const payroll = classPayroll(member, cls);
      if (payroll <= 0) continue;
      const lambda = payroll * M.rateClassPer1M[cls] * theta * kLine * trend;
      total += lambda * expectedClaimSeverity(cls, rq, regionMult);
    }

    if (includePresumption) {
      // Statutory exposure: no theta, no k_line, no frequency trend. Severity
      // is drawn in accident-year dollars and carried over the report lag at
      // the medical trend, so the expectation must use E[trend^round(lag)].
      const pfPayroll = classPayroll(member, 'police') + classPayroll(member, 'fire');
      if (pfPayroll > 0) {
        total +=
          pfPayroll *
          M.presumption.ratePer1MPoliceFire *
          M.presumption.severityMean *
          expectedPresumptionTrendFactor() *
          regionMult;
      }
    }
  }
  return total;
}

// --- exported: k_line -------------------------------------------------------

// The risk-quality-mix normaliser: expected loss if the enrolled book were all
// at neutral risk quality, over expected loss at its actual mix. Applied to
// lambda so that changing WHO is enrolled doesn't drift the pool's aggregate
// expected loss away from the held pick — the roster-mix correction that pure
// premium deliberately does not make.
//
// Presumption is excluded from both sides: it is risk-quality-invariant, so
// including it would dilute the correction rather than sharpen it.
export function computeKLine(members: Member[]): number {
  const opts = { includePresumption: false as const };
  const neutral = expectedWcGrossLoss(members, { ...opts, riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedWcGrossLoss(members, opts);
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// --- exported: the held neutral pure premium --------------------------------

// WC's purePremiumPer100, derived ONCE from the full canonical roster at
// neutral risk quality and then HELD (Correction 1). Expressed per $100 of
// payroll, matching the engine's expectedLoss = exposure x PP x 10,000.
export function deriveNeutralPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedWcGrossLoss(fullRoster, { riskQualityOverride: NEUTRAL_RQ, kLine: 1, yearNumber: 1 });
  const payrollUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0) * 10_000;
  if (!(payrollUnits > 0)) return 0;
  return expected / payrollUnits;
}

// --- exported: the generator ------------------------------------------------

export interface WcGenerationInputs {
  members: Member[];          // the book to generate for
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kLine: number;
  gPool: number;              // the year's pool-wide factor, drawn once in processYear
  riskControlEffectiveness: number; // DRAW ONLY — see invariant 2
}

export interface WcGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCountsByClass: Record<string, number>;
  claimCountsByTier: Record<string, number>;
}

export function generateWcClaims(inputs: WcGenerationInputs): WcGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kLine, gPool, riskControlEffectiveness } = inputs;

  // Purpose-keyed streams, distinct from the legacy 'losses' label so WC's
  // internals can be reordered without disturbing GL/Property.
  const freqRng = deriveSubRng(instanceSeed, yearNumber, 'wc_freq');
  const tierRng = deriveSubRng(instanceSeed, yearNumber, 'wc_tier');
  const sevRng = deriveSubRng(instanceSeed, yearNumber, 'wc_sev');
  const presumeRng = deriveSubRng(instanceSeed, yearNumber, 'wc_presume');

  const trend = frequencyTrend(yearNumber);
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  const claimCountsByClass: Record<string, number> = { clerical: 0, publicWorks: 0, police: 0, fire: 0, presumption: 0 };
  const claimCountsByTier: Record<string, number> = { medOnly: 0, temp: 0, perm: 0, catastrophic: 0, presumption: 0 };

  let sequence = 0;
  const emit = (
    member: Member,
    cls: WcClassKey,
    tier: string,
    grossUltimate: number,
    reportedYear: number,
    extras: { annuity?: ClaimAnnuity; paymentPattern?: number[] },
  ) => {
    sequence++;
    const occurrenceId = `wc-${yearNumber}-${member.id}-${sequence}`;
    occurrences.push({
      id: occurrenceId,
      line: LINE,
      memberId: member.id,
      accidentYear: yearNumber,
      calendarYear,
      region: member.region,
      // WC injuries are individual events; a shared catastrophe grouping is a
      // Property concept and stays false here.
      isCatastrophe: false,
      claimIds: [`${occurrenceId}-c1`],
    });
    claims.push({
      id: `${occurrenceId}-c1`,
      occurrenceId,
      memberId: member.id,
      line: LINE,
      accidentYear: yearNumber,
      calendarYear,
      tier,
      ratingClass: cls,
      status: 'open',
      reportedYear,
      grossUltimate,
      paidToDate: 0,
      caseReserve: grossUltimate,
      ...extras,
    });
  };

  for (const member of members) {
    const rq = member.riskQuality;
    const regionMult = regionMultiplier(member.region);
    const theta = thetaWc(rq);
    const dur = durationFactor(rq);
    const before = claims.length;

    for (const cls of WC_CLASS_KEYS) {
      const payroll = classPayroll(member, cls);
      if (payroll <= 0) continue;

      // A1: per member-year noise (mean 1) x the shared pool factor (mean 1).
      const epsilon = freqRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);
      const lambda = payroll * M.rateClassPer1M[cls] * theta * kLine * trend * epsilon * gPool * rcFactor;
      const count = freqRng.poisson(lambda);
      if (count <= 0) continue;
      claimCountsByClass[cls] += count;

      const probs = tierProbabilities(cls, rq);
      const tierWeights = [probs.medOnly, probs.temp, probs.perm, probs.catastrophic];
      const tierNames: WcTier[] = ['medOnly', 'temp', 'perm', 'catastrophic'];

      for (let i = 0; i < count; i++) {
        // A2: the multinomial over this class's claims, one categorical draw
        // per claim.
        const tier = tierNames[tierRng.categorical(tierWeights)];
        claimCountsByTier[tier] += 1;

        // A3/A4: severity is DRAWN in accident-year dollars, then carried to
        // settlement per leg (medical at medicalTrend, indemnity at
        // indemnityTrend) across the tier's payout window. Short windows make
        // this a small correction — but a correct one, where omitting it would
        // silently assert a factor of 1.0.
        if (tier === 'medOnly') {
          const accidentYearAmount = drawLognormal(sevRng, M.severity.medOnly.mean, M.severity.medOnly.cv) * regionMult;
          const pattern = M.payoutPatterns.medOnly;
          const amount = accidentYearAmount * patternTrendFactor(pattern, M.medicalTrend, yearNumber);
          emit(member, cls, tier, amount, yearNumber, { paymentPattern: pattern });
        } else if (tier === 'temp' || tier === 'perm') {
          const spec = tier === 'temp' ? M.severity.temp : M.severity.perm;
          const pattern = M.payoutPatterns[tier];
          const weeks = drawLognormal(sevRng, spec.durationWeeksMean, spec.durationWeeksCv) * dur;
          const indemnity = weeklyBenefit(cls) * weeks * patternTrendFactor(pattern, M.indemnityTrend, yearNumber);
          const medical = drawLognormal(sevRng, spec.medicalMean, spec.medicalCv) * patternTrendFactor(pattern, M.medicalTrend, yearNumber);
          const amount = (indemnity + medical) * regionMult;
          emit(member, cls, tier, amount, yearNumber, { paymentPattern: pattern });
        } else {
          const age = sevRng.range(M.catastrophic.ageMin, M.catastrophic.ageMax);
          const { annuity, presentValue } = catastrophicStream(age, cls, regionMult);
          // Books PV; the nominal schedule rides along on `annuity` for Phase 3.
          emit(member, cls, tier, presentValue, yearNumber, { annuity });
        }
      }
    }

    // A5: presumption claims (police/fire occupational disease). A separate
    // statutory process — theta_WC is deliberately NOT applied, and neither
    // is k_line or the frequency trend; only the shared pool factor.
    //
    // Severity is drawn in accident-year dollars and TRENDED FORWARD over the
    // ~8-year report lag at the medical trend — an occupational-disease claim
    // reported in 8 years settles in that year's medical dollars, ~1.6x the
    // accident-year figure. That trend factor is precisely the surface a
    // retroactive presumption expansion acts on in Phase 3: repricing an old
    // accident year means re-running this conversion. The HOOK IS NOT LIVE YET
    // (the claim is still booked at the accident year — there is no IBNR layer
    // until Phase 3), but the surface is now correctly in place, where before
    // it was inert because the stored severity had no defined vintage.
    const pfPayroll = classPayroll(member, 'police') + classPayroll(member, 'fire');
    if (pfPayroll > 0) {
      const lambda = pfPayroll * M.presumption.ratePer1MPoliceFire * gPool;
      const count = presumeRng.poisson(lambda);
      for (let i = 0; i < count; i++) {
        claimCountsByClass.presumption += 1;
        claimCountsByTier.presumption += 1;
        const accidentYearAmount = drawLognormal(presumeRng, M.presumption.severityMean, M.presumption.severityCv) * regionMult;
        const lag = drawTruncatedLognormal(
          presumeRng,
          M.presumption.reportLagYearsMean,
          M.presumption.reportLagYearsCv,
          M.presumption.maxReportLagYears,
        );
        const reportedYear = yearNumber + Math.round(lag);
        const amount = trendToSettlement(accidentYearAmount, M.medicalTrend, yearNumber, reportedYear);
        const cls: WcClassKey = classPayroll(member, 'fire') >= classPayroll(member, 'police') ? 'fire' : 'police';
        emit(member, cls, 'presumption', amount, reportedYear, {
          paymentPattern: M.payoutPatterns.perm,
        });
      }
    }

    const simulatedLoss = claims.slice(before).reduce((s, c) => s + c.grossUltimate, 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: member.exposureByLine.WC ?? 0,
      riskQuality: rq,
      expectedLoss: expectedWcGrossLoss([member], { kLine, yearNumber }),
      // Not modelled per member in the claim generator: dispersion is an
      // emergent property of frequency x tier mix x severity, not a single
      // per-member CV the way the aggregate Gamma model had.
      coefficientOfVariation: 0,
      standardDeviation: 0,
      simulatedLoss,
    });
  }

  const grossUltimateLoss = claims.reduce((s, c) => s + c.grossUltimate, 0);
  return { claims, occurrences, grossUltimateLoss, memberLossResults, claimCountsByClass, claimCountsByTier };
}
