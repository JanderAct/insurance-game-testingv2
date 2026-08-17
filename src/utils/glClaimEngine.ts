// General Liability claim-level loss generator — REBUILT onto a fitted
// per-claim 3-component lognormal mixture. See GL_LOSS_MODEL in
// defaultAssumptions.ts for the full rationale and an inventory of what this
// rebuild deleted (sub-coverages, the liability gate, litigation stages,
// GL_SOCIAL_INFLATION, the statutory cap, multi-claimant abuse batches).
//
// Same architecture as WC (wcClaimEngine.ts is the template), narrower now
// that the gate and batches are gone:
// 1. ONE BASIS: generateGlClaims (draw) and expectedGlGrossLoss (analytic)
//    are a matched pair; GL's pure premium derives from the expectation.
// 2. RISK CONTROL HITS THE DRAW ONLY — absent from the expectation.
// 3. PURE PREMIUM HELD, k_GL ADAPTS — k_GL is GL's own normalizer, separate
//    from WC's, recomputed annually against the enrolled book.
// 4. NO DOLLAR VINTAGE CONVERSION. The fitted mixture's amounts come from a
//    real pool's real claim experience and are booked exactly as drawn, at
//    accident-year value. GL carries no severity or frequency trend of any
//    kind (see exposureTrend.ts's GL note) and no report lag — every claim
//    reports in its own accident year.
//
// OCCURRENCE == CLAIM, exactly like WC. GL's batch mechanism is deleted, not
// layered differently — see GL_LOSS_MODEL's header comment for why.

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence } from '../types/simulation';
import { deriveSubRng } from './random';
import { WHOLE_LINE } from './shockEffects';
import { GL_HEAVY_COMPONENT_INDEX, GL_LOSS_MODEL, GL_SEVERITY_COMPONENTS, type GlSeverityComponent } from '../data/defaultAssumptions';

const M = GL_LOSS_MODEL;
const LINE: CoverageLine = 'GL';
const NEUTRAL_RQ = 5;

// --- risk quality ------------------------------------------------------------

function thetaGl(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// THE RISK-QUALITY SEVERITY TILT — mirrors wcClaimEngine.ts's tiltedWeights
// exactly:
//   w_heavy' = min(w_heavy x exp(-rqSeverityBeta x (RQ - 5)), 0.999)
//   scale    = (1 - w_heavy') / (sum of the other weights)
// Renormalises the remaining components, preserving their ratio to each
// other. At RQ 5 (neutral) this is the identity.
//
// ⚠ DRAW ONLY — never the pricing expectation. See invariant 2. GL has only
// one mixture (no rating groups to look a heavy component up per-group the
// way WC does), so the heavy index is the fixed constant
// GL_HEAVY_COMPONENT_INDEX rather than a per-group field.
export function tiltedGlWeights(riskQuality: number, params = M): number[] {
  void params; // kept for signature symmetry with wcClaimEngine's tiltedWeights
  const components = GL_SEVERITY_COMPONENTS;
  const factor = Math.exp(-M.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
  const baseHeavy = components[GL_HEAVY_COMPONENT_INDEX].weight;
  const tiltedHeavy = Math.min(baseHeavy * factor, 0.999);
  const otherTotal = components.reduce((s, c, i) => (i === GL_HEAVY_COMPONENT_INDEX ? s : s + c.weight), 0);
  const scale = otherTotal > 0 ? (1 - tiltedHeavy) / otherTotal : 0;
  return components.map((c, i) => (i === GL_HEAVY_COMPONENT_INDEX ? tiltedHeavy : c.weight * scale));
}

// The untilted mix — the pricing basis. A plain array copy of the stored
// weights, kept as a named function so callers read "pricing basis" rather
// than reaching into GL_SEVERITY_COMPONENTS directly.
function untiltedGlWeights(): number[] {
  return GL_SEVERITY_COMPONENTS.map(c => c.weight);
}

// --- severity means (analytic side of the matched pair) ----------------------

function componentMean(c: GlSeverityComponent): number {
  return Math.exp(c.mu + (c.sigma * c.sigma) / 2);
}

// Expected claim severity under a given weight vector. The pricing basis
// always passes untiltedGlWeights() — RQ never moves the analytic severity
// (invariant 2) — so this is RQ-INDEPENDENT for every real caller; only the
// draw calls it (indirectly, via tiltedGlWeights) with a tilted vector.
export function expectedClaimSeverity(weights: number[]): number {
  let total = 0;
  for (let i = 0; i < GL_SEVERITY_COMPONENTS.length; i++) total += weights[i] * componentMean(GL_SEVERITY_COMPONENTS[i]);
  return total;
}

// --- exported: analytic expectation --------------------------------------------

export interface ExpectedGlLossOptions {
  riskQualityOverride?: number;
  kGl?: number;        // default 1
  // Shock frequency multipliers, for MEASURING a shock's expected cost — NEVER
  // for pricing. GL has no sub-coverages left to key by, so the only key that
  // means anything is WHOLE_LINE ('*'); both of GL's shock events are
  // whole-line multipliers (see shockCatalog.ts #22 and #28).
  //
  // ⚠ RISK CONTROL IS ABSENT FROM THIS EXPECTATION BY DESIGN (invariant 2), and
  // so is the SHOCK when this option is omitted. Nothing that prices GL calls
  // it with this set.
  freqMultipliers?: Record<string, number>;
}

// The analytic expected GROSS loss (accident-year dollars, ALAE included in
// the mixture) for a book of members. Excludes risk control (invariant 2);
// E[member noise] = E[gPool] = 1. Severity is always drawn from the UNTILTED
// mixture here — the RQ severity tilt is draw-only.
export function expectedGlGrossLoss(members: Member[], options: ExpectedGlLossOptions = {}): number {
  const rqOverride = options.riskQualityOverride;
  const kGl = options.kGl ?? 1;
  const meanSeverity = expectedClaimSeverity(untiltedGlWeights());
  const wholeLineMult = options.freqMultipliers?.[WHOLE_LINE] ?? 1;

  let total = 0;
  for (const member of members) {
    const rq = rqOverride ?? member.riskQuality;
    const theta = thetaGl(rq);
    const payroll = member.exposureByLine.GL ?? 0;
    const lambda = payroll * M.ratePer1M * theta * kGl * wholeLineMult;
    if (lambda <= 0) continue;
    total += lambda * meanSeverity;
  }
  return total;
}

// --- exported: k_GL and the held pure premium ----------------------------------

// GL's risk-quality-mix normalizer over the enrolled book — same semantics as
// WC's computeKLine (pool-level RQ effects neutralized so the held pick stays
// honest; RQ differentiates members WITHIN the pool).
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
  // Shock-event frequency multipliers. WHOLE_LINE ('*') is the only key that
  // means anything for GL now — see ExpectedGlLossOptions.freqMultipliers.
  // DRAW ONLY, like risk control and for the same reason: a shock is a
  // realized event, not a repricing, so it must move the loss ratio rather
  // than cancel out of it.
  freqMultipliers?: Record<string, number>;
}

export interface GlGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCount: number;          // total claims generated this line-year
  maxOccurrenceGross: number;  // GL's shock signal: any occurrence > $1M (ruled J11) — occurrence == claim, so this is the largest single claim
}

export function generateGlClaims(inputs: GlGenerationInputs): GlGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kGl, gPool, riskControlEffectiveness } = inputs;
  const wholeLineMult = inputs.freqMultipliers?.[WHOLE_LINE] ?? 1;
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  let claimCount = 0;
  let maxOccurrenceGross = 0;
  let sequence = 0;

  for (const member of members) {
    // PER-MEMBER STREAMS, keyed on member.id — a pure function of
    // (seed, year, memberId), same discipline as WC and the same reason: the
    // marketplace generator draws for all 200 members, and a member's claim
    // history must not depend on who else is enrolled or on iteration order.
    // See scripts/diagnostics/enrolment-independence-check.ts.
    const freqRng = deriveSubRng(instanceSeed, yearNumber, `gl_freq:${member.id}`);
    const sevRng = deriveSubRng(instanceSeed, yearNumber, `gl_sev:${member.id}`);

    const rq = member.riskQuality;
    const theta = thetaGl(rq);
    const payroll = member.exposureByLine.GL ?? 0;
    const before = claims.length;

    if (payroll > 0) {
      // One frequency-noise draw per member-year, mean 1. With no
      // sub-coverages left, this is simply the line's own noise term.
      const epsilon = freqRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);
      const lambda = payroll * M.ratePer1M * theta * kGl * epsilon * gPool * rcFactor * wholeLineMult;

      if (lambda > 0) {
        const count = freqRng.poisson(lambda);
        if (count > 0) {
          // The RQ severity tilt applies to every claim this member draws
          // this year — computed once per member, not per claim, since RQ is
          // constant within a member-year.
          const weights = tiltedGlWeights(rq);
          for (let i = 0; i < count; i++) {
            sequence++;
            const componentIdx = sevRng.categorical(weights);
            const component = GL_SEVERITY_COMPONENTS[componentIdx];
            const grossUltimate = sevRng.lognormal(component.mu, component.sigma);

            const occurrenceId = `gl-${yearNumber}-${member.id}-${sequence}`;
            const claimId = `${occurrenceId}-c1`;
            claims.push({
              id: claimId,
              occurrenceId,
              memberId: member.id,
              line: LINE,
              accidentYear: yearNumber,
              calendarYear,
              tier: component.key,
              status: 'open',
              reportedYear: yearNumber,
              grossUltimate,
              paidToDate: 0,
              caseReserve: grossUltimate,
            });
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
            if (grossUltimate > maxOccurrenceGross) maxOccurrenceGross = grossUltimate;
          }
          claimCount += count;
        }
      }
    }

    const simulatedLoss = claims.slice(before).reduce((s, c) => s + c.grossUltimate, 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: payroll,
      riskQuality: rq,
      expectedLoss: expectedGlGrossLoss([member], { kGl }),
      // Dispersion is emergent (frequency x severity mixture), not a
      // per-member CV — same convention as the WC generator.
      coefficientOfVariation: 0,
      standardDeviation: 0,
      simulatedLoss,
    });
  }

  const grossUltimateLoss = claims.reduce((s, c) => s + c.grossUltimate, 0);
  return { claims, occurrences, grossUltimateLoss, memberLossResults, claimCount, maxOccurrenceGross };
}

// Exposed for the diagnostic harness: the exact internals the analytic uses,
// so harness checks integrate the same numbers rather than re-deriving them.
export const glInternals = {
  thetaGl,
  tiltedGlWeights,
  untiltedGlWeights,
  componentMean,
  expectedClaimSeverity,
};
