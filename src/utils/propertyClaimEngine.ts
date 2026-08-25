// PROPERTY claim generator — FITTED to the pool's own nine years of claims.
//
// ===========================================================================
// WHAT THIS REPLACED, AND WHY THE OLD ONE LOOKED FINE.
//
// The retired design drew ~112 claims a year at a $190,179 mean, from a
// per-LOCATION frequency and a severity of damageRatio x the hit location's
// TIV. The fit says 15.5 claims a year at $435,254: eleven times too many
// claims at 44% of the size. The AAL therefore landed within a factor of three
// BY ACCIDENT, because only the PRODUCT was ever anchored and the two factors
// were free to be wrong in opposite directions.
//
// That is finding 37's defect in a different line: a product can be right
// while both of its factors are wrong, and only fitting them separately finds
// it. The lesson generalises — anchor factors, not products.
//
// WHAT WENT WITH IT:
//   - the per-location frequency basis (frequency is now per $1M of TIV)
//   - damageRatio x locationTiv severity (now a free-standing mixture)
//   - the location schedule, primary-asset chopping and the insured-value cap
//     they produced — severity no longer references a location at all
//   - the separate WEATHER band. Weather is 21% of the non-cat book and IS IN
//     the mixture: baking it in moves the annual CV by 0.02 (0.26 -> 0.24),
//     which does not buy a 345-line event/zone/footprint simulator.
//   - the CAT band. Catastrophes are shock events now.
//
// ⚠ SEVERITY IS NO LONGER BOUNDED BY INSURED VALUE. The old structure capped
// each claim at its location's TIV by construction. A free-standing mixture has
// no such bound, which is why severityCap exists and why it is not optional —
// see PROPERTY_LOSS_MODEL. Do not reintroduce a location cap on top: the
// mixture was fitted to claim AMOUNTS, which already embody whatever real
// insured-value limits applied.
// ===========================================================================

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence } from '../types/simulation';
import { deriveSubRng } from './random';
import { PROPERTY_LOSS_MODEL } from '../data/defaultAssumptions';

const M = PROPERTY_LOSS_MODEL;
const LINE: CoverageLine = 'Property';
const NEUTRAL_RQ = 5;
// One band now. Kept as a tier label so Claim.tier stays populated and the
// claims export keeps a stable column, not because a second band is pending.
const BAND = 'property';

// Risk quality scales the Poisson mean. Neutral RQ 5 is the reference, so a
// neutral book reproduces the fitted frequency exactly.
function thetaFrequency(riskQuality: number): number {
  const rq = Math.max(1, Math.min(10, riskQuality));
  return 1 + M.rqFrequencyBeta * (NEUTRAL_RQ - rq);
}

// Risk quality scales severity MULTIPLICATIVELY, by shifting every component's
// location parameter by log(factor). That moves the whole mixture and leaves
// its shape — the weights and sigmas — untouched, which is what keeps the
// fitted tail intact under an RQ the fit never saw.
function severityFactor(riskQuality: number): number {
  const rq = Math.max(1, Math.min(10, riskQuality));
  return 1 + M.rqSeverityBeta * (NEUTRAL_RQ - rq);
}

// ⚠ PROPERTY DOES NOT APPLY AN ACCIDENT-YEAR -> SETTLEMENT TREND, and it is
// the only line that does not. This is a property of the FIT, not a
// simplification.
//
// WC and GL parameterise severity at ACCIDENT-year level and multiply by
// patternTrendFactor to reach settlement dollars. Property's mixture was fitted
// to claim AMOUNTS ALREADY TRENDED TO 2024 — that is, to what those claims
// actually cost when settled. Multiplying again would apply the settlement lag
// twice.
//
// Measured, because the size is small enough to have been shrugged off: the
// factor is 1.04^0.35 = 1.013822 on a 70/25/5 pattern, so applying it makes the
// generator draw 1.35% above the price it is funded at. Small, but it is
// finding 37's defect exactly — a factor in the DRAW that is not in the PRICE —
// and the fact that it is 1.35% rather than 35% is what would have kept it
// hidden.
//
// severityTrendPerYear and payoutPattern both stay live: the PATTERN still
// governs cash timing (70/25/5 over three years), and the trend rate is still
// the right number should an accident-year parameterisation ever replace this
// one. Neither is dead; only the multiplication is gone.
const PAYOUT_TREND_FACTOR = 1;

// --- the fitted severity distribution ---------------------------------------

// Standard normal CDF via Abramowitz & Stegun 7.1.26 — accurate to ~1e-7,
// which is well inside what a capped first and second moment need here.
function normCdf(z: number): number {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return 0.5 * (1 + s * (1 - poly * Math.exp(-x * x)));
}

// E[min(X, cap)^k] for one lognormal component, in CLOSED FORM.
//
// ⚠ CLOSED FORM ON PURPOSE, not quadrature. The top component has sigma 1.7417
// and the cap sits 3.4 sigma into its tail, which is precisely where a
// fixed-grid integration loses the mass that matters — the same trap the
// retired Beta severity carried a warning about, for the opposite reason.
//
//   E[X^k 1{X<=K}] = exp(k mu + k^2 s^2 / 2) Phi((lnK - mu - k s^2)/s)
//   plus K^k P(X > K) for the atom the cap creates at K.
function cappedComponentMoment(mu: number, sigma: number, k: number, cap: number): number {
  const lnK = Math.log(cap);
  const below = Math.exp(k * mu + (k * k * sigma * sigma) / 2) * normCdf((lnK - mu - k * sigma * sigma) / sigma);
  const atCap = Math.pow(cap, k) * (1 - normCdf((lnK - mu) / sigma));
  return below + atCap;
}

// PROPERTY'S SEVERITY TREND IS EXACTLY 1, AND THAT IS A REAL STATEMENT, not a
// placeholder. Property's severity does not trend at the DRAW: the construction-
// cost inflation in PROPERTY_LOSS_MODEL.severityTrendPerYear is consumed by the
// accident-year -> settlement dollar-vintage convention (PAYOUT_TREND_FACTOR),
// not by shifting mu each year. The fit found no second trending convention and
// adding one here would double-count it — the finding-37 trap the pure-premium
// comment in simulationEngine warns about.
//
// ⚠ THE RATE IS A NAMED CONSTANT AT ZERO, AND THE FUNCTION HAS THE SAME SHAPE
// AS wcSeverityTrend AND glSeverityTrend — including the year-1 floor — rather
// than being a stub that returns 1. That is the difference between "Property is
// special-cased" and "Property's rate happens to be zero": giving Property a
// draw-side severity trend is a one-constant edit here, and everything
// downstream (the ceiling, the capped moments, the draw) already routes through
// it. Read propertySeverityCap's header FIRST if you are about to make that
// edit — the tower is welded to Property's ceiling in three places.
//
// ⚠ NOT PROPERTY_LOSS_MODEL.severityTrendPerYear (0.04). That one is live and
// means something different: construction-cost inflation consumed by the
// accident-year -> settlement dollar-vintage convention. Setting THIS to 0.04
// would apply the same inflation twice — the finding-37 trap PAYOUT_TREND_FACTOR
// already documents. The two names are deliberately distinct.
export const PROPERTY_DRAW_SEVERITY_TREND_PER_YEAR = 0;

export function propertySeverityTrend(yearNumber: number): number {
  return Math.pow(1 + PROPERTY_DRAW_SEVERITY_TREND_PER_YEAR, Math.max(1, yearNumber) - 1);
}

// THE CEILING IN THAT YEAR'S DOLLARS — the Property member of the same family as
// wcSeverityCap and glSeverityCap. INERT TODAY because the trend above is 1.
//
// ⚠ IT CANNOT SIMPLY BE SWITCHED ON, AND THIS IS THE PART TO READ BEFORE GIVING
// PROPERTY A SEVERITY TREND. Property's ceiling is not only a severity
// statement — it is STRUCTURALLY WELDED TO THE REINSURANCE TOWER in three
// places that WC's and GL's are not:
//
//   reinsuranceTower.ts   TOWER_TOP.Property IS severityCap
//   reinsuranceTower.ts   the top layer's limit is severityCap - perRiskRetention
//   propertyAggregate.ts  the aggregate threshold falls back to severityCap
//
// So a trending Property ceiling would silently grow the purchased tower and
// move an aggregate threshold, which is a reinsurance change wearing a severity
// change's clothes. Three further things assume year-invariance and would need
// a year threaded or a key added: PROPERTY_MEAN_SEVERITY (a module-level
// const), expectedPropertyGrossLoss (ExpectedPropertyLossOptions carries no
// yearNumber at all, deliberately — Property's expectation is year-blind
// today), and towerMoments' propertyBandCache (a single slot with no year
// key). property-claim-check.ts
// ASSERTS the invariance rather than trusting this comment, so switching the
// trend on fails loudly at exactly these seams instead of drifting.
export function propertySeverityCap(yearNumber: number): number {
  return M.severityCap * propertySeverityTrend(yearNumber);
}

// The capped mixture's k-th moment at a given severity scale factor. The
// factor enters as a shift of mu by log(factor), so it multiplies the k-th
// moment by factor^k only when the cap is absent — with the cap present the
// integral must be re-evaluated, which is why the factor is applied to mu here
// rather than to the result.
//
// ⚠ severityScale IS RISK QUALITY, NOT A YEAR, and the two are deliberately
// different in how they meet the ceiling. A high-RQ member genuinely draws
// larger claims against the SAME physical ceiling, so the cap does not scale
// with it — exactly as WC's cap does not scale with regionMult. `yearNumber`
// restates the whole distribution in later dollars, so the ceiling DOES move
// with it. Today that distinction costs nothing because Property's trend is 1;
// it is wired so it stays correct if that changes.
export function propertySeverityMoment(k: number, severityScale = 1, yearNumber = 1): number {
  const shift = Math.log(Math.max(severityScale, 1e-9));
  return M.severityMixture.reduce(
    (a, c) => a + c.weight * cappedComponentMoment(
      c.mu + shift, c.sigma, k, propertySeverityCap(yearNumber)),
    0,
  );
}

// Mean claim size at neutral risk quality — the figure the held pure premium
// is built from. Asserted against the brief's $435,254 by property-fit-check.
export const PROPERTY_MEAN_SEVERITY = propertySeverityMoment(1, 1);

// --- analytic expectation (invariant 1) -------------------------------------

export interface ExpectedPropertyLossOptions {
  riskQualityOverride?: number;
  kPr?: number;
}

// Expected gross loss for a book, in booked (settlement-trended) dollars.
//
// THE IDENTITY. Frequency is per $1M of TIV and severity is independent of the
// member, so expected loss is exactly proportional to TIV:
//
//   E[loss] = TIV_$M x frequencyPer1mTiv x theta(rq) x E[severity | rq] x trend
//
// Simpler than the retired form, which needed the location count to cancel out
// of a per-location frequency times a per-location severity. Nothing cancels
// here because nothing was introduced that had to.
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
    const lambda = tiv * M.frequencyPer1mTiv * thetaFrequency(rq) * kPr;
    total += lambda * propertySeverityMoment(1, severityFactor(rq));
  }
  return total;
}

// The roster/risk-quality mix correction, exactly as WC's k_line and GL's k_GL:
// the held pure premium is derived at NEUTRAL risk quality over the full
// roster, so a book whose actual RQ mix differs must be corrected back.
export function computeKPr(members: Member[]): number {
  const neutral = expectedPropertyGrossLoss(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedPropertyGrossLoss(members);
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// Pure premium per $100 of TIV, NON-CAT ONLY.
//
// ⚠ THIS IS NOW THE WHOLE PRICE, and it did not use to be. The held pure
// premium carried an ASSERTED cat load of 0.0247 on top of this figure; that
// load was removed because no generator produces it and Property's cat shock
// is gated off, so it was collected with certainty and incurred never. This
// function and PROPERTY_HELD_PURE_PREMIUM_PER_100 now agree exactly, which is
// asserted rather than assumed — see property-claim-check.ts.
//
// If a cat band arrives, the load and the losses return TOGETHER. See the
// constant's own comment for the derivation to reinstate.
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
  riskControlEffectiveness: number; // DRAW ONLY
}

export interface PropertyGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCount: number;
  maxClaimGross: number;   // per-risk signal: largest single claim
  perRiskBreaches: number; // claims exceeding the per-risk retention
  capBindings: number;     // claims that hit severityCap — should be very rare
}

export function generatePropertyClaims(inputs: PropertyGenerationInputs): PropertyGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kPr, riskControlEffectiveness } = inputs;
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  let grossUltimateLoss = 0;
  let claimCount = 0;
  let maxClaimGross = 0;
  let perRiskBreaches = 0;
  let capBindings = 0;

  // Cumulative mixture weights, built once. Weights are the fitted ones and
  // are assumed to sum to 1; the final component absorbs any rounding residue
  // by construction of the search below.
  const cumulative: number[] = [];
  let acc = 0;
  for (const c of M.severityMixture) { acc += c.weight; cumulative.push(acc); }

  for (const member of members) {
    // PER-MEMBER STREAMS, KEYED ON member.id — unchanged from the retired
    // generator and for the same reason. A member's claim history must not
    // depend on WHO ELSE is enrolled or on iteration order, or a prospect's
    // losses would move because of an enrolment decision made years earlier
    // and an underwriting screen would be incoherent. Asserted by
    // scripts/diagnostics/enrolment-independence-check.ts.
    //
    // The `pr_loc` stream is GONE with the location schedule. The remaining
    // three keep their labels, so a member's frequency and severity draws are
    // unchanged in derivation even though what they feed has changed.
    const freqRng = deriveSubRng(instanceSeed, yearNumber, `pr_freq:${member.id}`);
    const epsRng = deriveSubRng(instanceSeed, yearNumber, `pr_eps:${member.id}`);
    const sevRng = deriveSubRng(instanceSeed, yearNumber, `pr_sev:${member.id}`);

    const tiv = member.exposureByLine.Property ?? 0;
    let memberLoss = 0;

    if (tiv > 0) {
      // One eps per member-year, shared across that member's claims — the same
      // convention WC and GL use.
      const eps = epsRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);

      // ⚠ NO gPool. Property drew the shared pool factor under the aggregate
      // path; it does not now. gPool was the model's cross-line correlation and
      // WC already left it, so Property leaving means GL is the only line still
      // consuming it. That is a REDUCTION IN CROSS-LINE CORRELATION and it is
      // deliberate: a compound-Poisson book's year-to-year variation comes from
      // its own frequency and tail, and layering a shared multiplier on top
      // would double-count volatility the mixture already carries.
      const lambda = tiv * M.frequencyPer1mTiv * thetaFrequency(member.riskQuality) * eps * kPr * rcFactor;
      const count = freqRng.poisson(Math.max(0, lambda));
      const sevScale = severityFactor(member.riskQuality);

      for (let i = 0; i < count; i++) {
        // Component, then a lognormal draw from it, then the cap.
        const u = sevRng.next();
        let idx = 0;
        while (idx < cumulative.length - 1 && u > cumulative[idx]) idx++;
        const comp = M.severityMixture[idx];
        const raw = sevRng.lognormal(comp.mu + Math.log(sevScale), comp.sigma);
        // Already settlement dollars — see PAYOUT_TREND_FACTOR above.
        // THAT YEAR'S ceiling, wired like WC's and GL's; inert while
        // propertySeverityTrend is 1. See propertySeverityCap.
        const cap = propertySeverityCap(yearNumber);
        const gross = Math.min(raw, cap);
        if (raw > cap) capBindings++;

        const occurrenceId = `PR-${yearNumber}-${member.id}-${i}`;
        const claimId = `${occurrenceId}-c1`;
        claims.push({
          id: claimId,
          occurrenceId,
          memberId: member.id,
          line: LINE,
          accidentYear: yearNumber,
          calendarYear,
          tier: BAND,
          status: 'open',
          // Property damage is known the day it happens.
          reportedYear: yearNumber,
          grossUltimate: gross,
          paidToDate: 0,
          caseReserve: gross,
          paymentPattern: [...M.payoutPattern],
        });
        // One claim per occurrence. With the weather band gone there is no
        // structure that makes one event own several claims; if a cat band
        // arrives it is what will.
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
          peril: BAND,
        });
        memberLoss += gross;
        grossUltimateLoss += gross;
        claimCount++;
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
    claimCount,
    maxClaimGross,
    perRiskBreaches,
    capBindings,
  };
}

export const propertyInternals = {
  payoutTrendFactor: PAYOUT_TREND_FACTOR,
  thetaFrequency,
  severityFactor,
  propertySeverityMoment,
  normCdf,
};
