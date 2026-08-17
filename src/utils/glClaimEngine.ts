// General Liability claim-level loss generator — REBUILT onto a fitted
// per-claim 3-component lognormal mixture. See GL_LOSS_MODEL in
// defaultAssumptions.ts for the full rationale and an inventory of what this
// rebuild deleted (sub-coverages, the liability gate, litigation stages,
// GL_SOCIAL_INFLATION, the statutory cap, multi-claimant abuse batches).
//
// Same architecture as WC (wcClaimEngine.ts is the template), narrower now
// that the gate and batches are gone:
// 1. ONE BASIS: generateGlClaims (draw) and expectedGlGrossLossForKLine
//    (analytic on the draw's own basis) are a matched pair; GL's pure premium
//    derives from expectedGlGrossLossForPricing. See GlLossBasis for which
//    risk-quality channels each of the two sees, and why there are two.
// 2. RISK CONTROL HITS THE DRAW ONLY — absent from both expectations.
// 3. PURE PREMIUM HELD, k_GL ADAPTS — k_GL is GL's own normalizer, separate
//    from WC's, recomputed annually against the enrolled book. It neutralises
//    BOTH risk-quality channels, so the drawn expected loss equals the held
//    priced expectation whatever the book's RQ mix.
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
import { limitedExpectedValue } from './claimMath';

const M = GL_LOSS_MODEL;
const LINE: CoverageLine = 'GL';
const NEUTRAL_RQ = 5;

// --- risk quality ------------------------------------------------------------

function thetaGl(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// THE FITTED WEIGHTS, NORMALISED TO SUM TO EXACTLY 1.
//
// ⚠ THE SOURCE WEIGHTS DO NOT. 0.519201 + 0.0629521 + 0.417847 = 1.0000001 — a
// ~1e-7 rounding residual from the fit being stated to six decimal places. That
// is immaterial as a dollar figure and the stored constants are deliberately
// left exactly as the fit gave them, but EVERY consumer of a weight vector must
// see the SAME normalisation or the two expectation bases disagree at that
// residual and k_GL's identity stops being exact.
//
// It bit once already, and subtly. tiltedGlWeights renormalises by construction
// (it rescales the non-heavy weights so the vector sums to 1), while the untilted
// accessor used to hand back the raw weights unchanged. So the 'pricing' basis
// carried the 1e-7 excess and the 'kLine' basis did not, and the held-pure-premium
// identity held only to 1.9e-9 instead of to float precision. The arithmetic of
// that residual: the two small components are 0.926% of the mixture's dollars and
// were being scaled down by 2.08e-7, giving 0.00926 x 2.08e-7 = 1.93e-9 — exactly
// what was measured. Not a wrong answer at any scale that matters, but a real
// inconsistency between two things that must agree, so it is removed at the source
// rather than absorbed into a looser tolerance.
//
// SeededRandom.categorical normalises by its own total too, so the DRAW was never
// affected either way.
const NORMALISED_WEIGHTS: number[] = (() => {
  const raw = GL_SEVERITY_COMPONENTS.map(c => c.weight);
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map(w => w / total) : raw;
})();

// THE RISK-QUALITY SEVERITY TILT — mirrors wcClaimEngine.ts's tiltedWeights
// exactly:
//   w_heavy' = min(w_heavy x exp(-rqSeverityBeta x (RQ - 5)), 0.999)
//   scale    = (1 - w_heavy') / (sum of the other weights)
// Renormalises the remaining components, preserving their ratio to each
// other. At RQ 5 (neutral) this is the identity.
//
// ⚠ NOT THE PRICING BASIS — see GlLossBasis below. Used by the DRAW and by the
// k_GL basis; never by 'pricing'. GL has only one mixture (no rating groups to
// look a heavy component up per-group the way WC does), so the heavy index is
// the fixed constant GL_HEAVY_COMPONENT_INDEX rather than a per-group field.
//
// ⚠ NO `params` ARGUMENT, DELIBERATELY DIVERGING FROM WC's tiltedWeights.
// This function used to take `params = M` and then discard it (`void params`),
// reading module-level M regardless — a signature that promised
// parameterisation and silently ignored it. Removed rather than honoured,
// because honouring it could only ever be HALF true: WC's rating groups and
// its rqSeverityBeta both live inside WC_LOSS_MODEL, so WC's params really does
// parameterise its whole model, whereas GL's mixture lives in the separate
// GL_SEVERITY_COMPONENTS export. A GL `params` argument could carry the beta
// but never the components, so a caller passing an alternative model would
// still get the real mixture back — the same class of silent wrong answer,
// one level subtler. If GL ever needs a parameterised severity model, move
// GL_SEVERITY_COMPONENTS into GL_LOSS_MODEL first and add the argument then.
export function tiltedGlWeights(riskQuality: number): number[] {
  const base = NORMALISED_WEIGHTS;
  const factor = Math.exp(-M.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
  const tiltedHeavy = Math.min(base[GL_HEAVY_COMPONENT_INDEX] * factor, 0.999);
  const otherTotal = base.reduce((s, w, i) => (i === GL_HEAVY_COMPONENT_INDEX ? s : s + w), 0);
  const scale = otherTotal > 0 ? (1 - tiltedHeavy) / otherTotal : 0;
  return base.map((w, i) => (i === GL_HEAVY_COMPONENT_INDEX ? tiltedHeavy : w * scale));
}

// The untilted mix — the pricing basis. Normalised, exactly as tiltedGlWeights'
// base is, so the two bases agree at neutral RQ to float precision. Kept as a
// named function so callers read "pricing basis" rather than reaching into
// GL_SEVERITY_COMPONENTS directly.
function untiltedGlWeights(): number[] {
  return NORMALISED_WEIGHTS.slice();
}

// --- severity means (analytic side of the matched pair) ----------------------

function componentMean(c: GlSeverityComponent): number {
  return Math.exp(c.mu + (c.sigma * c.sigma) / 2);
}

// Expected severity of one claim under a given weight vector. `limit` caps each
// claim at that amount (E[min(X, limit)] per component) — see
// ExpectedGlLossOptions.severityLimit for why that exists.
export function expectedClaimSeverity(weights: number[], limit?: number): number {
  let total = 0;
  for (let i = 0; i < GL_SEVERITY_COMPONENTS.length; i++) {
    const c = GL_SEVERITY_COMPONENTS[i];
    total += weights[i] * (limit === undefined ? componentMean(c) : limitedExpectedValue(c.mu, c.sigma, limit));
  }
  return total;
}

// --- exported: analytic expectation --------------------------------------------

export interface ExpectedGlLossOptions {
  // Force every member to this risk quality (used for the neutral book and for
  // k_GL's numerator). Omit to use each member's actual risk quality.
  riskQualityOverride?: number;
  kGl?: number;        // default 1
  // Shock frequency multipliers, for MEASURING a shock's expected cost — NEVER
  // for pricing. GL has no sub-coverages left to key by, so the only key that
  // means anything is WHOLE_LINE ('*'); both of GL's shock events are
  // whole-line multipliers (see shockCatalog.ts #22 and #28, and the
  // load-time validator there that keeps it that way).
  //
  // ⚠ RISK CONTROL IS ABSENT FROM THIS EXPECTATION BY DESIGN (invariant 2), and
  // so is the SHOCK when this option is omitted. Nothing that prices GL calls
  // it with this set.
  freqMultipliers?: Record<string, number>;
  // Cap each claim's severity at this limit inside the expectation.
  //
  // ⚠ EXISTS FOR THE BOUNDED-VARIANCE GATES, NOT FOR PRICING. GL's blended CV is
  // 29.55, so a ground-up sample mean cannot be gated at any realistic sample
  // size (finding 26). gl-cutover-check and marketplace-generation-check
  // therefore gate the $1M-CAPPED loss, whose per-claim variance is bounded, and
  // they need a matched capped ANALYTIC to compare against. Defining it here
  // rather than hand-rolling it in each harness keeps one definition of GL's
  // capped expectation instead of two that can drift. Nothing that prices GL
  // passes this.
  severityLimit?: number;
}

// WHICH RISK-QUALITY CHANNELS THE EXPECTATION SEES.
//
//   'pricing'  frequency theta only. The severity tilt is draw-only, so
//              including it here would move premium and losses together and
//              cancel (finding 17).
//   'kLine'    BOTH channels. k_GL normalises the book's risk-quality mix, so
//              it has to see everything RQ does or the held pure premium drifts
//              as the roster changes.
//
// NO DEFAULT, and two named wrappers below rather than a boolean parameter: the
// call site should read its own intent. Mirrors wcClaimEngine.ts's WcLossBasis
// seam exactly — see the k_GL note on computeKGl for what went wrong when GL
// had only the 'pricing' basis and used it on both sides of k_GL.
type GlLossBasis = 'pricing' | 'kLine';

function expectedGlGrossLossCore(
  members: Member[],
  basis: GlLossBasis,
  options: ExpectedGlLossOptions,
): number {
  const rqOverride = options.riskQualityOverride;
  const kGl = options.kGl ?? 1;
  const wholeLineMult = options.freqMultipliers?.[WHOLE_LINE] ?? 1;
  // Hoisted for 'pricing', where severity does not depend on the member.
  const untiltedSeverity = expectedClaimSeverity(untiltedGlWeights(), options.severityLimit);

  let total = 0;
  for (const member of members) {
    const payroll = member.exposureByLine.GL ?? 0;
    if (payroll <= 0) continue;
    const rq = rqOverride ?? member.riskQuality;
    const lambda = payroll * M.ratePer1M * thetaGl(rq) * kGl * wholeLineMult;
    const severity = basis === 'kLine'
      ? expectedClaimSeverity(tiltedGlWeights(rq), options.severityLimit)
      : untiltedSeverity;
    total += lambda * severity;
  }
  return total;
}

// The analytic expected GROSS loss for PRICING (accident-year dollars, ALAE
// included in the mixture). Frequency theta only — see the GlLossBasis comment.
// This is what purePremiumPer100 and every displayed expected loss derive from.
// Excludes risk control (invariant 2); E[member noise] = E[gPool] = 1.
export function expectedGlGrossLossForPricing(members: Member[], options: ExpectedGlLossOptions = {}): number {
  return expectedGlGrossLossCore(members, 'pricing', options);
}

// The analytic expected GROSS loss on the k_GL basis — BOTH risk-quality
// channels, so it is also the DRAW's own expectation. computeKGl needs it;
// exported so the diagnostics can assert the two bases differ in the direction
// expected and that k_GL's identity holds.
export function expectedGlGrossLossForKLine(members: Member[], options: ExpectedGlLossOptions = {}): number {
  return expectedGlGrossLossCore(members, 'kLine', options);
}

// --- exported: k_GL and the held pure premium ----------------------------------

// The risk-quality-mix normaliser: expected loss if the enrolled book were all
// at neutral risk quality, over expected loss at its actual mix. Applied to
// lambda so that changing WHO is enrolled doesn't drift the pool's aggregate
// expected loss away from the held pick.
//
// BOTH SIDES USE THE k_GL BASIS, so the correction covers frequency theta AND
// the severity tilt. At neutral RQ the tilt is the identity, so the numerator is
// unaffected by it and the ratio measures exactly the mix effect.
//
// ⚠ THIS WAS THE DEFECT FOUND REVIEWING THE GL REBUILD, and the old comment
// here asserted the opposite of what the code did. Both sides used to call the
// PRICING basis, which is untilted — so the severity term cancelled out of the
// ratio and k_GL corrected FREQUENCY ONLY. The draw applied the tilt anyway, so
// it survived in losses with nothing offsetting it in price, and the drawn
// expected loss diverged from the held priced expectation by up to 26.6% as the
// book's RQ mix moved (measured: 3.0% at the observed enrolled book's mean RQ of
// 5.51, 11.2% at RQ 7). Because underwriting selection moves the book's mean RQ,
// a player who underwrote well earned a hidden margin that grew with their
// skill — where on WC the same skill lowers the PRICE and the loss ratio stays
// flat, which is the right lesson for a pool whose objective is affordable
// coverage rather than profit.
//
// The invariant this restores is asserted directly, across the whole RQ range
// rather than only at neutral, in gl-claim-check.ts: for any book,
//   expectedGlGrossLossForKLine(book, { kGl: computeKGl(book) })
//     === expectedGlGrossLossForPricing(book, { riskQualityOverride: 5, kGl: 1 })
export function computeKGl(members: Member[]): number {
  const neutral = expectedGlGrossLossForKLine(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedGlGrossLossForKLine(members, {});
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// GL's purePremiumPer100: derived ONCE from the full canonical roster at
// neutral risk quality and then HELD (Correction 1 discipline). Per $100 of
// payroll — GL's exposure base.
export function deriveNeutralGlPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedGlGrossLossForPricing(fullRoster, { riskQualityOverride: NEUTRAL_RQ, kGl: 1 });
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
      // PRICING basis, matching wcClaimEngine's memberLossResults: this figure is
      // what the member is charged against, not what the draw expects of them.
      expectedLoss: expectedGlGrossLossForPricing([member], { kGl }),
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
