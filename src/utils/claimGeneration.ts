// ============================================================================
// ONE MAPPING FROM A LINE-YEAR'S INPUTS TO ITS GENERATOR CALL.
//
// ⚠ THIS EXISTS SO THE ENGINE AND THE REGENERATOR CANNOT DRIFT. processYear
// draws a year's claims live; claimRegeneration redraws a PAST year on demand
// from what the result persisted. If each built its generator arguments
// separately, the two would be two descriptions of one fact — the shape that
// let the claims workbook's line sheets and its Development sheet disagree about
// which years existed. So the argument-building is here, once, and both call it.
// The engine is NOT calling the regenerator: it has its claims already, and a
// second path producing the same objects is exactly the drift being avoided.
// It is calling the same INPUT mapping the regenerator calls, then running the
// generator itself — for the three ENROLLED draws. The marketplace-prospect
// draws (k = 1, rc = 0, claims discarded) stay inline at their call sites: they
// are not what regeneration reproduces, and rewriting them would be churn on a
// path nothing redraws.
//
// ⚠ NOTHING HERE DRAWS. Every function is pure in its arguments. The randomness
// is inside the three generators, keyed per member on (seed, year, memberId) —
// enrolment-independence-check's guarantee — and in poolYearFactor below, keyed
// on (seed, year). That is what makes a redraw exact rather than approximate.
// ============================================================================

import type { CoverageLine, Member, Claim, Occurrence } from '../types/simulation';
import type { LineShockEffects } from '../types/shocks';
import { deriveSubRng } from './random';
import { WC_LOSS_MODEL } from '../data/defaultAssumptions';
import { generateWcClaims, type WcGenerationInputs } from './wcClaimEngine';
import { generateGlClaims, type GlGenerationInputs } from './glClaimEngine';
import { generatePropertyClaims, type PropertyGenerationInputs } from './propertyClaimEngine';

// THE POOL-YEAR LOSS FACTOR — one draw per year, shared by every line, and a
// PURE FUNCTION OF (seed, year). It lived inline in processYear until claim
// regeneration needed the same number: a past year's GL register cannot be
// redrawn without the gPool that year saw, and storing a value derivable from
// two things already stored would be a second copy of one fact. So it is a
// function, and processYear and claimRegeneration both call it.
//
// ⚠ ITS OWN PURPOSE LABEL, so it consumes nothing from any other stream. That
// was true inline and stays true here — the derivation is byte-identical, which
// value-identity-check asserts across the extraction.
export function poolYearFactor(seed: number, yearNumber: number): number {
  return deriveSubRng(seed, yearNumber, 'wc_gpool')
    .gamma(WC_LOSS_MODEL.poolYearFactor.shape, WC_LOSS_MODEL.poolYearFactor.scale);
}

/** Everything a line-year's generator call needs, before the line is known. */
export interface LineYearGenerationBase {
  members: Member[];
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  /** k_line / k_GL / k_Pr — the enrolled book's mix correction, as applied. */
  k: number;
  riskControlEffectiveness: number;
  /** GL's shared pool-year factor. Ignored by WC and Property, which run at 1. */
  gPool: number;
  /** This line's shock effects for the year, or undefined when none is in force. */
  shock: LineShockEffects | undefined;
}

export interface LineYearGenerationOutput {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
}

/**
 * The three generators take different input shapes and different shock
 * channels. These three functions are the ONLY place that mapping is written;
 * processYear passes their output to the generators for the live draw, and
 * regenerateLineYearClaims passes it for the redraw.
 *
 * ⚠ THE SHOCK CHANNELS DIFFER BY LINE AND THAT IS NOT AN OVERSIGHT. WC takes
 * component arrival-rate multipliers and explicit injections; GL takes
 * whole-line frequency and severity multipliers plus gPool; Property takes no
 * shock channel and no gPool (its fitted mixture already contains what gPool
 * would add — see the note at its engine call site). A shock effect the line
 * does not read is dropped here, exactly as the engine always dropped it.
 *
 * ⚠ THESE RETURN INPUTS, NOT RESULTS, and that is deliberate. The engine reads
 * generator outputs the regenerator has no use for — WC's per-component counts
 * and injection attribution, GL's maxOccurrenceGross — so a shared function
 * that RAN the generator would have to return every line's full result type.
 * Sharing the argument construction and letting each caller run the generator
 * itself keeps one mapping without forcing one output shape.
 */
export function wcGenerationInputs(b: LineYearGenerationBase): WcGenerationInputs {
  return {
    members: b.members, yearNumber: b.yearNumber, calendarYear: b.calendarYear,
    instanceSeed: b.instanceSeed, kLine: b.k, riskControlEffectiveness: b.riskControlEffectiveness,
    componentFreqMultipliers: b.shock?.componentFreqMultipliers,
    injections: b.shock?.injections,
  };
}

export function glGenerationInputs(b: LineYearGenerationBase): GlGenerationInputs {
  return {
    members: b.members, yearNumber: b.yearNumber, calendarYear: b.calendarYear,
    instanceSeed: b.instanceSeed, kGl: b.k, gPool: b.gPool,
    riskControlEffectiveness: b.riskControlEffectiveness,
    freqMultipliers: b.shock?.freqMultipliers,
    sevMultipliers: b.shock?.sevMultipliers,
  };
}

export function propertyGenerationInputs(b: LineYearGenerationBase): PropertyGenerationInputs {
  return {
    members: b.members, yearNumber: b.yearNumber, calendarYear: b.calendarYear,
    instanceSeed: b.instanceSeed, kPr: b.k, riskControlEffectiveness: b.riskControlEffectiveness,
  };
}

/** Draw one line-year through the shared mapping. Used by the regenerator. */
export function generateLineYearClaims(line: CoverageLine, b: LineYearGenerationBase): LineYearGenerationOutput {
  switch (line) {
    case 'WC': { const r = generateWcClaims(wcGenerationInputs(b));
      return { claims: r.claims, occurrences: r.occurrences, grossUltimateLoss: r.grossUltimateLoss }; }
    case 'GL': { const r = generateGlClaims(glGenerationInputs(b));
      return { claims: r.claims, occurrences: r.occurrences, grossUltimateLoss: r.grossUltimateLoss }; }
    case 'Property': { const r = generatePropertyClaims(propertyGenerationInputs(b));
      return { claims: r.claims, occurrences: r.occurrences, grossUltimateLoss: r.grossUltimateLoss }; }
  }
}
