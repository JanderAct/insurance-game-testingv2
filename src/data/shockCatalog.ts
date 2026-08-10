// THE SHOCK EVENT TABLE.
//
// Events are DATA. Adding event #23 is adding a row here — no new function, no
// new branch in the engine. The machinery lives in src/utils/shockResolver.ts
// and the effect vocabulary in src/types/shocks.ts.
//
// IDs are the design-matrix numbers so the table and the matrix stay mapped to
// each other. Five of the ~40 events are present: four representative events
// chosen to exercise the machinery, plus #2, which is present as DATA ONLY.
//
// EVERY MAGNITUDE HERE IS PROVISIONAL AND CALIBRATION IS DEFERRED. These are
// sized to their stated MECHANISM, never tuned to make the game feel risky. The
// pool currently cannot lose money at default decisions (0 of 50 five-year games
// ended below starting surplus, finding 24), and that is being fixed on the
// economics side. Shocks must be calibrated against a pool that already has
// two-sided risk — tuning them now, against a pool that cannot lose, would make
// the game brutal the moment the economics are fixed. scripts/diagnostics/
// shock-check.ts reports what each event actually costs and asserts nothing
// about whether that is the right amount.

import type { ShockDefinition } from '../types/shocks';
import { WC_LOSS_MODEL, GL_LOSS_MODEL, PROPERTY_LOSS_MODEL } from './defaultAssumptions';
import type { CoverageLine } from '../types/simulation';

export const SHOCK_CATALOG: Record<string, ShockDefinition> = {
  // -------------------------------------------------------------------------
  // #2 — DATA ONLY. NOT BUILDABLE, AND DELIBERATELY LEFT THAT WAY.
  //
  // Two independent blockers, both structural:
  //
  //   1. THERE IS NO CAT GENERATOR. propertyClaimEngine has an attritional band
  //      and a weather band, both unwired; PROPERTY_CAT_MODEL is inert. There is
  //      no quake peril, no region-span logic, and no intensity draw to force.
  //      A live game still runs Property through the legacy aggregate
  //      member-Gamma path.
  //
  //   2. THERE IS NO OCCURRENCE TOWER. The event's intended meaning — "the pool
  //      pays the $5M retention plus everything above the limit, which is
  //      solvency-threatening without protection" — describes a treaty the
  //      engine does not implement. The live reinsurance engine is an AGGREGATE
  //      QUOTA SHARE: attachment at 125% of expected gross loss, a flat recovery
  //      percentage of the excess, UNCAPPED (limitPctOfPremium is Infinity at
  //      every paid level). Its own header says occurrence-basis layering is
  //      deferred until a claim-level model exists. The occurrenceAttachment and
  //      occurrenceLimit constants sit in the inert cat block and nothing reads
  //      them.
  //
  // So the occurrence tower is a PREREQUISITE for #2 having its intended meaning
  // at all, not merely for it running. Against an uncapped aggregate quota share
  // a $400M gross quake produces roughly the opposite of the intended result.
  // The resolver will throw if this event is ever scheduled, which is correct:
  // it must not silently do half of what it says.
  // -------------------------------------------------------------------------
  '#2': {
    id: '#2',
    name: 'Major Earthquake',
    horizon: 'current',
    band: 'severe',
    description:
      'A major earthquake in the Central region spanning into an adjacent zone at near-99th-percentile '
      + 'intensity. Building damage plus crew injuries; no third-party GL assumed. NOT EXECUTABLE — '
      + 'requires the Property cat band and an occurrence-basis reinsurance tower, neither of which exists.',
    effects: [
      { kind: 'forceEvent', line: 'Property', peril: 'earthquake', region: 'Central', intensity: 5.3, span: true },
      { kind: 'freqMultiplier', line: 'WC', factor: 1.4 },
    ],
  },

  // -------------------------------------------------------------------------
  // #10 — FUTURE horizon. Tests paramOverride and forward persistence.
  //
  // The presumption generator was built with theta_WC deliberately NOT applied,
  // and the design doc calls that "the legislative-shock hook" — presumption
  // exposure is statutory, not a function of how well a member is run. This
  // event is what that hook exists for.
  //
  // MEASURED SCALE: presumption runs 14.94 claims/yr at FULL MARKET. At 1.5x
  // that is +7.5/yr full market — but the pool writes only ~27% of the market,
  // so the enrolled book sees roughly +2.0 claims/yr, about +$1.2M/yr, forward
  // and permanently. Quote both bases; a full-market figure is not what the
  // pool pays.
  // -------------------------------------------------------------------------
  '#10': {
    id: '#10',
    name: 'WC Presumption Expansion',
    horizon: 'future',
    band: 'high',
    description:
      'Legislation permanently expands the presumption that police and fire occupational disease is '
      + 'work-related, raising presumption claim frequency by 50% from this year forward.',
    effects: [
      { kind: 'paramOverride', line: 'WC', path: 'presumption.ratePer1MPoliceFire', multiplier: 1.5 },
    ],
  },

  // -------------------------------------------------------------------------
  // #15 — CURRENT horizon. Tests injectClaim.
  //
  // The catastrophic tier already exists with its annuity structure and its
  // present-value booking. It is REUSED, never re-synthesised: injecting a
  // hand-built severity would create a second definition of what a
  // catastrophic claim is, and the two would drift.
  //
  // TWO CLAIMS, NOT ONE. MEASURED at year 1 over 200 seeds: the tier fires
  // 3.43/yr at full market and 1.01/yr on the enrolled pool. The pool already
  // sees about one catastrophic claim a year unaided, so injecting ONE would be
  // indistinguishable from an ordinary year — and arguably two is still modest
  // for a High band. Each injected claim books ~$9.0M present value, so the
  // event adds ~$18M against an enrolled WC gross of ~$14M.
  //
  // Measure this by HOLDING yearNumber FIXED AND VARYING THE SEED. WC carries a
  // frequency trend of -1.5%/yr, so looping the year averages over a decline
  // rather than sampling one year repeatedly.
  // -------------------------------------------------------------------------
  '#15': {
    id: '#15',
    name: 'Catastrophic WC Mega-Claim',
    horizon: 'current',
    band: 'high',
    description:
      'Two catastrophic workers-compensation injuries in one year — lifetime medical care plus wage '
      + 'indemnity to retirement, booked at present value.',
    effects: [
      { kind: 'injectClaim', line: 'WC', tier: 'catastrophic', count: 2 },
    ],
  },

  // -------------------------------------------------------------------------
  // #22 — CURRENT horizon. Tests freqMultiplier with sub-coverage targeting.
  //
  // MEASURED SCALE, and the arithmetic here is easy to get wrong in two ways.
  //
  //   ALAE IS INCURRED ON EVERY CLAIM, PAID OR NOT (design B3/B4), and a
  //   frequency multiplier multiplies the GATE count, so the unpaid claims and
  //   their ALAE double too. Counting only paid claims understates the cost by
  //   about 43%. Full market: 41.5 paid x $265,973 = $11.04M, plus 67.7 unpaid
  //   x $125,021 = $8.46M, total $19.50M — confirmed by simulation at $19.79M.
  //
  //   THE COMPARISON BASE IS THE WHOLE LINE, NOT THE SUB-COVERAGE. GL's enrolled
  //   gross is ~$25.3M/yr (full market $93.80M measured). So 2x adds ~$5.3M
  //   enrolled, which is ~+21% of GL — material, and nothing like the
  //   +60-120% that comparing against EPL's own $5M would suggest.
  // -------------------------------------------------------------------------
  '#22': {
    id: '#22',
    name: 'Employment Practices Surge',
    horizon: 'current',
    band: 'moderate',
    description:
      'A wave of employment-practices claims — discrimination, harassment, wrongful termination — '
      + 'doubles EPL claim frequency for one year.',
    effects: [
      { kind: 'freqMultiplier', line: 'GL', sub: 'epl', factor: 2.0 },
    ],
  },

  // -------------------------------------------------------------------------
  // #28 — CURRENT horizon. THE CROSS-LINE TEST.
  //
  // One cause, two lines, both of them REAL: WC and GL are the two cut-over
  // claim-level generators, so this exercises pool-level resolution and
  // per-line projection against two live generators rather than against a stub.
  // It needs no effect type beyond the freqMultiplier #22 already requires.
  //
  // WC is primary and GL secondary, per the matrix. The WC half lands on
  // presumption — the same statutory police/fire channel #10 permanently
  // expands, which is exactly right for an infectious-disease surge and also
  // makes the two mechanisms compose on one knob: #10 moves the base rate
  // permanently, #28 multiplies the realized draw for one year.
  //
  // BOTH FACTORS ARE JUDGMENT CALLS — see the plan. 3.0x on presumption reflects
  // a COVID-style presumption surge; 1.25x on GL 'general' is the secondary
  // public-health liability exposure. 'general' is the natural GL target: the
  // exposure is duty-of-care to the public rather than employment practice
  // (epl), use of force (lawEnforcement) or custodial abuse.
  // -------------------------------------------------------------------------
  '#28': {
    id: '#28',
    name: 'Pandemic / Infectious Disease Surge',
    horizon: 'current',
    band: 'high',
    description:
      'A pandemic drives a surge of workers-compensation presumption claims among police and fire '
      + 'personnel, with secondary public-health liability exposure on the general liability line.',
    effects: [
      { kind: 'freqMultiplier', line: 'WC', sub: 'presumption', factor: 3.0 },
      { kind: 'freqMultiplier', line: 'GL', sub: 'general', factor: 1.25 },
    ],
  },
};

// ---------------------------------------------------------------------------
// PATH VALIDATION AT MODULE LOAD.
//
// paramOverride paths are dotted strings, which keeps the catalog readable as
// data but gives up compile-time safety. This buys it back at startup: every
// path in the table is walked against the real model object, so a typo throws
// when the app loads rather than silently doing nothing in year 7 of a game.
//
// Consumes no randomness and reads no mutable state, so it cannot affect
// simulation output.
// ---------------------------------------------------------------------------

const LINE_MODELS: Record<CoverageLine, unknown> = {
  WC: WC_LOSS_MODEL,
  GL: GL_LOSS_MODEL,
  Property: PROPERTY_LOSS_MODEL,
};

export function readModelPath(line: CoverageLine, path: string): number | undefined {
  let node: unknown = LINE_MODELS[line];
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'number' ? node : undefined;
}

for (const def of Object.values(SHOCK_CATALOG)) {
  for (const effect of def.effects) {
    if (effect.kind !== 'paramOverride') continue;
    if (readModelPath(effect.line, effect.path) === undefined) {
      throw new Error(
        `shockCatalog ${def.id}: paramOverride path '${effect.path}' does not resolve to a number on the ${effect.line} loss model`,
      );
    }
    if ((effect.multiplier === undefined) === (effect.value === undefined)) {
      throw new Error(`shockCatalog ${def.id}: paramOverride needs exactly one of multiplier or value`);
    }
  }
}
