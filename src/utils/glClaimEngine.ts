// General Liability claim-level loss generator (design doc Part B).
//
// Second line on the WC architecture (wcClaimEngine is the template). The
// same four invariants hold and are only summarized here — full rationale at
// their original sites:
//
// 1. ONE BASIS: generateGlClaims (draw) and expectedGlGrossLoss (analytic)
//    are a matched pair; GL's pure premium derives from the expectation.
//    Change a factor in one, change it in the other.
// 2. RISK CONTROL HITS THE DRAW ONLY — absent from the expectation.
// 3. PURE PREMIUM HELD, k_GL ADAPTS — k_GL is GL's own normalizer, separate
//    from WC's (a good public-works program is not a good use-of-force
//    policy), recomputed annually against the enrolled book.
// 4. DOLLAR VINTAGE NEVER AMBIGUOUS — severities drawn in ACCIDENT-YEAR
//    dollars, carried to each claim's own settlement year at
//    GL_SOCIAL_INFLATION through trendToSettlement (indemnity AND ALAE).
//    Per-claim drawn-lag trending (ruled J13); the analytic integrates the
//    identical truncated lag x stage mix. Every GL report lag is truncated-
//    and-renormalised — the WC presumption lesson: E[(1.07)^lag] over an
//    unbounded lognormal lag is DIVERGENT, so a bound is mandatory, not
//    tuning.
//
// What is genuinely new versus WC:
// - THE LIABILITY GATE (B2): a latent claim strength M ~ Normal(0,1) decides
//   IF a claim pays indemnity (M above the sub-coverage's threshold) and HOW
//   MUCH, through one draw — the gate quantile maps onto the severity
//   distribution, so a barely-cleared gate is a small loss and a strong claim
//   is a large one. Risk quality shifts the THRESHOLD only (gamma channel):
//   pay rates move with RQ, but the severity distribution of paid claims
//   stays exactly B3's (ruled J9) — indemnity severity is never RQ-scaled.
// - STAGE-KEYED ALAE (B4): defense cost is a multiple of the sub's ALAE draw
//   keyed to how far the claim litigates, NOT a ratio of indemnity — so the
//   most expensive defense is a claim tried to verdict and WON (stage
//   multiple 6.0x, indemnity zero). Deliberately non-monotone.
// - PARETO TAIL (B3): 5% of paid law-enforcement claims come from
//   Pareto(x_m $1M, alpha 1.3) — infinite variance; verification of anything
//   it touches uses medians/counts, never tight means.
// - MULTI-CLAIM OCCURRENCES: an abuse incident is ONE occurrence owning MANY
//   claimant claims (correlated severities via a shared batch factor). The
//   occurrence is the unit the $1M retention waterfall nets against.
// - LEGAL-BASIS FLAG (B6): stateLaw (capped, indemnity only) vs federal1983
//   (uncapped) drawn at generation; the cap itself applies in the waterfall
//   phase, not here.

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence } from '../types/simulation';
import { deriveSubRng } from './random';
import { shockFactorFor } from './shockEffects';
import {
  drawLognormal,
  drawTruncatedLognormal,
  expectedOverLognormal,
  lognormalInvCdf,
  lognormalParams,
  normalCdf,
  normalInvCdf,
  trendToSettlement,
} from './claimMath';
import {
  GL_LITIGATION_STAGES,
  GL_LOSS_MODEL,
  GL_RELATIVITIES,
  GL_SOCIAL_INFLATION,
  GL_SUB_KEYS,
  WC_CLASS_MIX,
  type GlLitigationStage,
  type GlSubKey,
} from '../data/defaultAssumptions';

const M = GL_LOSS_MODEL;
const LINE: CoverageLine = 'GL';
const NEUTRAL_RQ = 5;
const SINGLE_CLAIM_SUBS: GlSubKey[] = ['general', 'epl', 'lawEnforcement'];

// --- exposure bases -----------------------------------------------------------

// general/epl/abuse run off the member's total payroll; lawEnforcement runs
// off its POLICE payroll (WC_CLASS_MIX's police share — the same class split
// WC rates against).
function subBasePayroll(member: Member, sub: GlSubKey): number {
  const payroll = member.exposureByLine.GL ?? 0;
  if (sub === 'lawEnforcement') {
    return payroll * (WC_CLASS_MIX[member.type]?.police ?? 0);
  }
  return payroll;
}

function subWeight(member: Member, sub: GlSubKey): number {
  const rel = GL_RELATIVITIES[member.type];
  if (!rel) return 0;
  switch (sub) {
    case 'general': return rel.general;
    case 'epl': return rel.epl;
    case 'lawEnforcement': return rel.lawEnforcement;
    case 'abuse': return rel.abuse;
  }
}

// --- risk quality --------------------------------------------------------------

function thetaGl(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// Gate threshold for a sub at a given risk quality. Worse RQ (below neutral)
// LOWERS the threshold — claims become harder to defend, more of them pay.
const baseThreshold: Record<GlSubKey, number> = {
  general: normalInvCdf(1 - M.subCoverages.general.payRate),
  epl: normalInvCdf(1 - M.subCoverages.epl.payRate),
  lawEnforcement: normalInvCdf(1 - M.subCoverages.lawEnforcement.payRate),
  abuse: normalInvCdf(1 - M.subCoverages.abuse.payRate),
};

function gateThreshold(sub: GlSubKey, riskQuality: number): number {
  return baseThreshold[sub] + M.rqGateGamma * (riskQuality - NEUTRAL_RQ);
}

function payRateAt(sub: GlSubKey, riskQuality: number): number {
  return 1 - normalCdf(gateThreshold(sub, riskQuality));
}

// --- severity means (analytic side of the matched pair) ------------------------

// E[indemnity | paid]. RQ-independent by construction (J9): the gate rescale
// maps the surviving latent tail onto the FULL severity distribution, so B3's
// means are the paid-claim marginals at every RQ.
function meanIndemnityWhenPaid(sub: GlSubKey): number {
  const spec = M.subCoverages[sub];
  if (spec.paretoTail) {
    const p = spec.paretoTail;
    // Pareto mean is finite for alpha > 1: x_m * alpha / (alpha - 1).
    return (1 - p.weight) * spec.indemnity.mean + p.weight * (p.xm * p.alpha / (p.alpha - 1));
  }
  return spec.indemnity.mean;
}

// Expected social-inflation factor per sub PER STAGE: E[(1+i)^round(lag + stageLag)]
// over the truncated report-lag density — the same rounding and the same
// truncation the draw applies. Cached (independent of RQ and of accident year:
// only offsets enter the exponent).
const stageTrendFactor: Record<GlSubKey, Record<GlLitigationStage, number>> = (() => {
  const out = {} as Record<GlSubKey, Record<GlLitigationStage, number>>;
  for (const sub of GL_SUB_KEYS) {
    const lag = M.subCoverages[sub].reportLag;
    const perStage = {} as Record<GlLitigationStage, number>;
    for (const stage of GL_LITIGATION_STAGES) {
      const stageLag = M.stageSettlementLagYears[stage];
      perStage[stage] = expectedOverLognormal(
        lag.meanYears,
        lag.cv,
        rl => Math.pow(1 + GL_SOCIAL_INFLATION, Math.round(rl + stageLag)),
        lag.maxYears,
      );
    }
    out[sub] = perStage;
  }
  return out;
})();

// E[trend] and E[stageMultiple x trend] across the stage mix — the indemnity
// and ALAE legs weight the same per-stage factors differently.
function expectedIndemnityTrend(sub: GlSubKey): number {
  const probs = M.stageProbabilities[sub];
  return GL_LITIGATION_STAGES.reduce((s, stage, i) => s + probs[i] * stageTrendFactor[sub][stage], 0);
}
function expectedAlaeMultipleTimesTrend(sub: GlSubKey): number {
  const probs = M.stageProbabilities[sub];
  return GL_LITIGATION_STAGES.reduce(
    (s, stage, i) => s + probs[i] * M.stageAlaeMultiple[stage] * stageTrendFactor[sub][stage],
    0,
  );
}

// Truncated-NegBin claimant expectation: E[n | n >= 1] = mean / (1 - P0),
// P0 = (r / (r + mean))^r — the draw truncates to >= 1 by reject-and-redraw.
function expectedClaimantsPerIncident(): number {
  const { claimantMean: m, claimantDispersion: r } = M.abuseBatch;
  const p0 = Math.pow(r / (r + m), r);
  return m / (1 - p0);
}

// --- exported: analytic expectation --------------------------------------------

export interface ExpectedGlLossOptions {
  riskQualityOverride?: number;
  kGl?: number;        // default 1
  yearNumber?: number; // accepted for interface symmetry; GL frequency is flat
                       // and trend factors depend only on lag offsets, so the
                       // expectation is year-invariant.
  // Shock frequency multipliers, for MEASURING a shock's expected cost —
  // NEVER for pricing. The difference between this expectation with and without
  // the multipliers IS the analytic expected addition, which is why it is
  // computed here rather than reconstructed: reconstructing it would create a
  // second definition of GL's expected loss, and the two would drift.
  //
  // ⚠ RISK CONTROL IS ABSENT FROM THIS EXPECTATION BY DESIGN (invariant 2), and
  // so is the SHOCK when this option is omitted. Passing multipliers here does
  // not make the shock part of the pricing basis — nothing that prices GL calls
  // it with this set.
  freqMultipliers?: Record<string, number>;
}

// The analytic expected GROSS loss (indemnity + ALAE, booked settlement-year
// dollars) for a book of members. Excludes risk control (invariant 2);
// E[member noise] = E[gPool] = E[batch factor] = 1.
export function expectedGlGrossLoss(members: Member[], options: ExpectedGlLossOptions = {}): number {
  const rqOverride = options.riskQualityOverride;
  const kGl = options.kGl ?? 1;

  let total = 0;
  for (const member of members) {
    const rq = rqOverride ?? member.riskQuality;
    const theta = thetaGl(rq);

    for (const sub of SINGLE_CLAIM_SUBS) {
      let lambda = subBasePayroll(member, sub) * subWeight(member, sub) * M.ratePer1M[sub] * theta * kGl;
      if (options.freqMultipliers) lambda *= shockFactorFor(options.freqMultipliers, sub);
      if (lambda <= 0) continue;
      const spec = M.subCoverages[sub];
      const costPerClaim =
        payRateAt(sub, rq) * meanIndemnityWhenPaid(sub) * expectedIndemnityTrend(sub) +
        spec.alae.mean * expectedAlaeMultipleTimesTrend(sub);
      total += lambda * costPerClaim;
    }

    // Abuse: incidents x truncated-mean claimants x per-claimant cost.
    {
      let lambdaIncidents = subBasePayroll(member, 'abuse') * subWeight(member, 'abuse') * M.ratePer1M.abuse * theta * kGl;
      if (options.freqMultipliers) lambdaIncidents *= shockFactorFor(options.freqMultipliers, 'abuse');
      if (lambdaIncidents > 0) {
        const spec = M.subCoverages.abuse;
        const costPerClaimant =
          payRateAt('abuse', rq) * spec.indemnity.mean * expectedIndemnityTrend('abuse') +
          spec.alae.mean * expectedAlaeMultipleTimesTrend('abuse');
        total += lambdaIncidents * expectedClaimantsPerIncident() * costPerClaimant;
      }
    }
  }
  return total;
}

// --- exported: k_GL and the held pure premium ----------------------------------

// GL's risk-quality-mix normalizer over the enrolled book — same semantics as
// WC's computeKLine (pool-level RQ effects neutralized so the held pick stays
// honest; RQ differentiates members WITHIN the pool). Every sub participates
// (GL has no statutory RQ-invariant process like WC presumption).
export function computeKGl(members: Member[]): number {
  const neutral = expectedGlGrossLoss(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedGlGrossLoss(members);
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// GL's purePremiumPer100: derived ONCE from the full canonical roster at
// neutral risk quality and then HELD (Correction 1 discipline). Per $100 of
// payroll — GL's exposure base.
export function deriveNeutralGlPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedGlGrossLoss(fullRoster, { riskQualityOverride: NEUTRAL_RQ, kGl: 1 });
  const payrollUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0) * 10_000;
  if (!(payrollUnits > 0)) return 0;
  return expected / payrollUnits;
}

// --- exported: the generator ----------------------------------------------------

export interface GlGenerationInputs {
  members: Member[];
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kGl: number;
  gPool: number;                    // the year's shared pool factor (from processYear)
  riskControlEffectiveness: number; // DRAW ONLY
  // Shock-event frequency multipliers, sub-coverage key -> factor, with '*' for
  // the whole line. DRAW ONLY, like risk control and for the same reason: a
  // shock is a realized event, not a repricing, so it must move the loss ratio
  // rather than cancel out of it.
  //
  // Absent when no shock is in force, and the apply site GUARDS rather than
  // multiplying by a defaulted 1. x * 1 is exact in IEEE-754 so both are safe,
  // but poisson() consumes a VARIABLE number of uniforms, so anything that
  // touches lambda reshapes every subsequent draw in that stream. Making the
  // no-shock path textually the original arithmetic removes the need to reason
  // about it at all.
  freqMultipliers?: Record<string, number>;
}

export interface GlGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCountsBySub: Record<string, number>;   // claims per sub (+ abuseIncidents)
  maxOccurrenceGross: number;                 // GL's shock signal: any occurrence > $1M (ruled J11)
}

export function generateGlClaims(inputs: GlGenerationInputs): GlGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kGl, gPool, riskControlEffectiveness } = inputs;
  const freqMultipliers = inputs.freqMultipliers;

  // PER-MEMBER STREAMS, keyed on member.id and REASSIGNED at the top of the
  // member loop below. See that block for why per-member rather than one
  // stream per year.
  //
  // ⚠ THEY ARE `let`, NOT `const`, AND THAT IS LOAD-BEARING. gateIndemnity and
  // emit are closures defined below but outside the loop; they capture these
  // BINDINGS, so reassigning per member is what makes them draw from the
  // current member's streams. Consequently NEITHER CLOSURE MAY BE CALLED FROM
  // OUTSIDE THE MEMBER LOOP — it would silently draw from whichever member
  // happened to be last. All three call sites are inside it today; keep them
  // there, or pass the streams explicitly instead.
  let freqRng = deriveSubRng(instanceSeed, yearNumber, 'gl_freq');
  let gateRng = deriveSubRng(instanceSeed, yearNumber, 'gl_gate');
  let sevRng = deriveSubRng(instanceSeed, yearNumber, 'gl_sev');
  let stageRng = deriveSubRng(instanceSeed, yearNumber, 'gl_stage');
  let lagRng = deriveSubRng(instanceSeed, yearNumber, 'gl_lag');
  let abuseRng = deriveSubRng(instanceSeed, yearNumber, 'gl_abuse');
  let legalRng = deriveSubRng(instanceSeed, yearNumber, 'gl_legal');

  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  const claimCountsBySub: Record<string, number> = { general: 0, epl: 0, lawEnforcement: 0, abuse: 0, abuseIncidents: 0 };
  const occurrenceGross = new Map<string, number>();

  // The abuse batch's two lognormal components: total CV 2.0 splits 50/50 in
  // log-variance between a shared per-occurrence factor (mean 1) and the
  // idiosyncratic per-claimant severity (mean = the sub's full mean, so the
  // product's marginal is exactly LogNormal(650k, CV 2.0)).
  const abuseSpec = M.subCoverages.abuse;
  const totalLogVar = Math.log(1 + abuseSpec.indemnity.cv ** 2);
  const sharedLogVar = totalLogVar * M.abuseBatch.logVarianceShare;
  const idioCv = Math.sqrt(Math.exp(totalLogVar - sharedLogVar) - 1);
  const batchSigma = Math.sqrt(sharedLogVar);
  const batchMu = -sharedLogVar / 2; // E[batch factor] = 1

  let sequence = 0;

  // The gate: latent strength M against threshold t'. Returns the ACCIDENT-
  // YEAR indemnity (0 if the gate holds). The quantile clamp guards the
  // u -> 1 numerical edge (normalInvCdf(1) = +inf).
  const gateIndemnity = (sub: GlSubKey, riskQuality: number): number => {
    const tPrime = gateThreshold(sub, riskQuality);
    const strength = gateRng.normal(0, 1);
    if (strength <= tPrime) return 0;
    const phiT = normalCdf(tPrime);
    const u = Math.min(1 - 1e-12, Math.max(1e-12, (normalCdf(strength) - phiT) / (1 - phiT)));
    const spec = M.subCoverages[sub];
    if (spec.paretoTail && sevRng.categorical([1 - spec.paretoTail.weight, spec.paretoTail.weight]) === 1) {
      // Component-first (J8): the gate quantile maps within the Pareto tail.
      return spec.paretoTail.xm * Math.pow(1 - u, -1 / spec.paretoTail.alpha);
    }
    return lognormalInvCdf(spec.indemnity.mean, spec.indemnity.cv, u);
  };

  const emit = (
    member: Member,
    sub: GlSubKey,
    occurrenceId: string,
    indemnityAY: number,
    riskQuality: number,
    lagYears: number,
    legalBasis: 'stateLaw' | 'federal1983',
    batchFactor: number,
  ): string => {
    void riskQuality;
    sequence++;
    const spec = M.subCoverages[sub];
    const stageIdx = stageRng.categorical(M.stageProbabilities[sub]);
    const stage = GL_LITIGATION_STAGES[stageIdx];
    const reportedYear = yearNumber + Math.round(lagYears);
    const settlementYear = yearNumber + Math.round(lagYears + M.stageSettlementLagYears[stage]);

    const indemnity = trendToSettlement(indemnityAY * batchFactor, GL_SOCIAL_INFLATION, yearNumber, settlementYear);
    const alaeAY = drawLognormal(sevRng, spec.alae.mean, spec.alae.cv) * M.stageAlaeMultiple[stage];
    const alae = trendToSettlement(alaeAY, GL_SOCIAL_INFLATION, yearNumber, settlementYear);
    const grossUltimate = indemnity + alae;

    const claimId = `${occurrenceId}-c${sequence}`;
    claims.push({
      id: claimId,
      occurrenceId,
      memberId: member.id,
      line: LINE,
      accidentYear: yearNumber,
      calendarYear,
      tier: sub,
      status: 'open',
      reportedYear,
      grossUltimate,
      paidToDate: 0,
      caseReserve: grossUltimate,
      indemnity,
      alae,
      legalBasis,
      litigationStage: stage,
      settlementYear,
    });
    occurrenceGross.set(occurrenceId, (occurrenceGross.get(occurrenceId) ?? 0) + grossUltimate);
    claimCountsBySub[sub] += 1;
    return claimId;
  };

  for (const member of members) {
    // PER-MEMBER STREAMS, KEYED ON member.id. deriveSubRng hashes the whole
    // purpose string, so the key space is free.
    //
    // WHY NOT ONE STREAM PER YEAR consumed in member order: the marketplace
    // generator draws for all 200 members, and a member's claim history must
    // not depend on WHO ELSE is enrolled or on the iteration order. With a
    // shared stream, inserting one extra member shifts every draw after it, so
    // a prospect's loss history would change because of enrolment decisions
    // made years earlier — which makes an underwriting screen incoherent.
    //
    // Keying per member makes each member's draws a pure function of
    // (seed, year, memberId). That is asserted, not assumed: see
    // scripts/diagnostics/enrolment-independence-check.ts.
    freqRng = deriveSubRng(instanceSeed, yearNumber, `gl_freq:${member.id}`);
    gateRng = deriveSubRng(instanceSeed, yearNumber, `gl_gate:${member.id}`);
    sevRng = deriveSubRng(instanceSeed, yearNumber, `gl_sev:${member.id}`);
    stageRng = deriveSubRng(instanceSeed, yearNumber, `gl_stage:${member.id}`);
    lagRng = deriveSubRng(instanceSeed, yearNumber, `gl_lag:${member.id}`);
    abuseRng = deriveSubRng(instanceSeed, yearNumber, `gl_abuse:${member.id}`);
    legalRng = deriveSubRng(instanceSeed, yearNumber, `gl_legal:${member.id}`);

    const rq = member.riskQuality;
    const theta = thetaGl(rq);
    // ONE frequency-noise draw per member-year, shared across the four subs
    // (the literal Part B reading; WC drew per class — noted divergence).
    const epsilon = freqRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);
    const before = claims.length;

    // Single-claim sub-coverages: one occurrence per claim.
    for (const sub of SINGLE_CLAIM_SUBS) {
      let lambda = subBasePayroll(member, sub) * subWeight(member, sub) * M.ratePer1M[sub]
        * theta * kGl * epsilon * gPool * rcFactor;
      if (freqMultipliers) lambda *= shockFactorFor(freqMultipliers, sub);
      if (lambda <= 0) continue;
      const count = freqRng.poisson(lambda);
      for (let i = 0; i < count; i++) {
        const spec = M.subCoverages[sub];
        const occurrenceId = `gl-${yearNumber}-${member.id}-${sequence + 1}`;
        const indemnityAY = gateIndemnity(sub, rq);
        const lag = drawTruncatedLognormal(lagRng, spec.reportLag.meanYears, spec.reportLag.cv, spec.reportLag.maxYears);
        const legalBasis = legalRng.chance(spec.federal1983Share) ? 'federal1983' as const : 'stateLaw' as const;
        const claimId = emit(member, sub, occurrenceId, indemnityAY, rq, lag, legalBasis, 1);
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
        });
      }
    }

    // Abuse: incidents own BATCHES of claimant claims — the first multi-claim
    // occurrence, and the shape Property's cat events will reuse. One report
    // lag and one legal basis per INCIDENT (the batch surfaces together under
    // one legal environment — that is what a revival statute does); stage,
    // gate and severity are per claimant.
    {
      let lambdaIncidents = subBasePayroll(member, 'abuse') * subWeight(member, 'abuse') * M.ratePer1M.abuse
        * theta * kGl * epsilon * gPool * rcFactor;
      if (freqMultipliers) lambdaIncidents *= shockFactorFor(freqMultipliers, 'abuse');
      const incidents = lambdaIncidents > 0 ? freqRng.poisson(lambdaIncidents) : 0;
      for (let inc = 0; inc < incidents; inc++) {
        claimCountsBySub.abuseIncidents += 1;
        // Claimant count: Gamma-Poisson (NegBin mean 5, r=2), reject-and-
        // redraw to >= 1 — a 0-claimant incident is a non-event.
        let claimants = 0;
        for (let attempt = 0; attempt < 64 && claimants < 1; attempt++) {
          const mixRate = abuseRng.gamma(M.abuseBatch.claimantDispersion, M.abuseBatch.claimantMean / M.abuseBatch.claimantDispersion);
          claimants = abuseRng.poisson(mixRate);
        }
        if (claimants < 1) claimants = 1;

        const occurrenceId = `gl-${yearNumber}-${member.id}-abuse${inc + 1}-${sequence + 1}`;
        const incidentLag = drawTruncatedLognormal(
          lagRng, abuseSpec.reportLag.meanYears, abuseSpec.reportLag.cv, abuseSpec.reportLag.maxYears,
        );
        const legalBasis = legalRng.chance(abuseSpec.federal1983Share) ? 'federal1983' as const : 'stateLaw' as const;
        const batchFactor = abuseRng.lognormal(batchMu, batchSigma);

        const claimIds: string[] = [];
        for (let c = 0; c < claimants; c++) {
          // Per-claimant gate over the IDIOSYNCRATIC severity component; the
          // shared batch factor multiplies inside emit, so the paid-claim
          // marginal is exactly LogNormal(650k, CV 2.0) and claimants within
          // a batch are correlated.
          const tPrime = gateThreshold('abuse', rq);
          const strength = gateRng.normal(0, 1);
          let indemnityAY = 0;
          if (strength > tPrime) {
            const phiT = normalCdf(tPrime);
            const u = Math.min(1 - 1e-12, Math.max(1e-12, (normalCdf(strength) - phiT) / (1 - phiT)));
            indemnityAY = lognormalInvCdf(abuseSpec.indemnity.mean, idioCv, u);
          }
          claimIds.push(emit(member, 'abuse', occurrenceId, indemnityAY, rq, incidentLag, legalBasis, batchFactor));
        }
        occurrences.push({
          id: occurrenceId,
          line: LINE,
          memberId: member.id,
          memberIds: [member.id],
          accidentYear: yearNumber,
          calendarYear,
          region: member.region,
          isCatastrophe: false,
          claimIds,
        });
      }
    }

    const simulatedLoss = claims.slice(before).reduce((s, c) => s + c.grossUltimate, 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: member.exposureByLine.GL ?? 0,
      riskQuality: rq,
      expectedLoss: expectedGlGrossLoss([member], { kGl }),
      // Dispersion is emergent (gate x stage x severity x batch), not a
      // per-member CV — same convention as the WC generator.
      coefficientOfVariation: 0,
      standardDeviation: 0,
      simulatedLoss,
    });
  }

  const grossUltimateLoss = claims.reduce((s, c) => s + c.grossUltimate, 0);
  let maxOccurrenceGross = 0;
  for (const total of occurrenceGross.values()) maxOccurrenceGross = Math.max(maxOccurrenceGross, total);

  return { claims, occurrences, grossUltimateLoss, memberLossResults, claimCountsBySub, maxOccurrenceGross };
}

// Exposed for the diagnostic harness: the exact per-sub trend expectations and
// abuse-batch parameters the analytic uses, so harness checks integrate the
// same numbers rather than re-deriving them.
export const glInternals = {
  gateThreshold,
  payRateAt,
  meanIndemnityWhenPaid,
  expectedIndemnityTrend,
  expectedAlaeMultipleTimesTrend,
  expectedClaimantsPerIncident,
  lognormalParams,
};
