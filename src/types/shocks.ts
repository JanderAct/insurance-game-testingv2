// SHOCK EVENTS — the effect vocabulary.
//
// THE GOVERNING PRINCIPLE: EVENTS ARE DATA, NOT CODE. There are ~40 events in
// the design matrix. If each one is a function they will drift and each will
// grow its own quirks, so what is built here is an EFFECT VOCABULARY, and the
// events themselves live in a TABLE (src/data/shockCatalog.ts). Adding event
// #23 is adding a row, not writing a generator.
//
// SCOPE. Eight effect kinds are DEFINED so the shape is right. Only three are
// IMPLEMENTED, because only three are needed by the representative events
// built so far. An effect kind with no consumer is NOT silently ignored — the
// resolver throws on it (see shockResolver.ts). A shock that quietly does
// nothing is worse than one that fails loudly.
//
// RETRO HORIZON IS OUT OF SCOPE and is not represented here at all. It requires
// prior accident years to be re-valuable, which needs Phase 3 reserving; the
// current model carries aggregate cohorts with a random developmentFactor
// wobble, so there is nothing to reach back into. Roughly a third of the matrix
// waits on that.

import type { CoverageLine, Region } from './simulation';

export type ShockHorizon = 'current' | 'future';
export type ShockBand = 'moderate' | 'high' | 'severe';

// ---------------------------------------------------------------------------
// The eight effects.
//
// CURRENT-horizon effects apply to their year and no other. FUTURE-horizon
// effects persist from their year forward, for the rest of that game.
// ---------------------------------------------------------------------------

export type ShockEffect =
  // --- CURRENT ---
  //
  // NOT IMPLEMENTED — and cannot be until the Property cat band exists. There
  // is no cat generator: propertyClaimEngine carries an attritional band and a
  // weather band, both unwired, and PROPERTY_CAT_MODEL is inert constants.
  // There is no quake peril to force. Kept in the vocabulary because event #2
  // is in the catalog as data (see shockCatalog.ts).
  | { kind: 'forceEvent'; line: 'Property'; peril: string; region: Region; intensity: number; span?: boolean }
  // IMPLEMENTED for WC. Injects `count` claims of an EXISTING tier through that
  // line's own generator, so the claims are real: they carry ids, join the
  // occurrence list, and flow into reserving and reinsurance like any other.
  | { kind: 'injectClaim'; line: CoverageLine; tier: string; count: number; ratingClass?: string }
  // IMPLEMENTED for GL sub-coverages and for WC presumption. Multiplies a
  // realized frequency for one year. `sub` omitted means the whole line.
  | { kind: 'freqMultiplier'; line: CoverageLine; sub?: string; factor: number }
  // NOT IMPLEMENTED.
  | { kind: 'sevMultiplier'; line: CoverageLine; sub?: string; factor: number }
  // NOT IMPLEMENTED.
  | { kind: 'investmentShock'; assetClass: 'cash' | 'bonds' | 'equities'; returnDelta: number }
  // NOT IMPLEMENTED.
  | { kind: 'exposureChange'; line: CoverageLine; factor: number }
  // NOT IMPLEMENTED.
  | { kind: 'poolExpense'; amount: number; label: string }
  // --- FUTURE ---
  //
  // IMPLEMENTED for WC only. A dotted path into that line's loss model plus
  // either a multiplier or an absolute value, persisting from its year forward.
  // Paths are validated against the real object at module load (see
  // shockCatalog.ts) so a typo fails at startup, not silently in year 7.
  | { kind: 'paramOverride'; line: CoverageLine; path: string; multiplier?: number; value?: number };

export type ShockEffectKind = ShockEffect['kind'];

// The effect kinds a generator can actually execute today. The resolver checks
// against this rather than against a comment, so the two cannot drift.
export const IMPLEMENTED_EFFECTS: ReadonlySet<ShockEffectKind> = new Set<ShockEffectKind>([
  'injectClaim',
  'freqMultiplier',
  'paramOverride',
]);

// ---------------------------------------------------------------------------
// An event: one CAUSE, one or more effects, possibly across several lines.
//
// Cross-line is the whole reason effects are a list. Event #28 (pandemic) emits
// into WC and GL from a single cause; resolving that at pool level and
// projecting per-line effects downward is what keeps line-local generators from
// ever having to reach across lines.
// ---------------------------------------------------------------------------

export interface ShockDefinition {
  id: string;               // the design-matrix number ('#22'), so table and matrix stay mapped
  name: string;
  horizon: ShockHorizon;
  band: ShockBand;
  // Prose from the matrix. Shown on the audit page, so a player or instructor
  // sees WHY the numbers moved, not just that they did.
  description: string;
  effects: ShockEffect[];
}

// What an instance carries. Absent by default — see GameInstance.scheduledShocks
// and the byte-identity note there.
export interface ScheduledShock {
  shockId: string;
  yearNumber: number;
}

// ---------------------------------------------------------------------------
// Recording. A shock that changes the numbers invisibly is worse than no shock.
// ---------------------------------------------------------------------------

// What fired, known BEFORE the generators run.
export interface ShockFiring {
  shockId: string;
  name: string;
  band: ShockBand;
  horizon: ShockHorizon;
  description: string;
  yearFired: number;        // the year the event fired (may be < the result year, for future-horizon)
  linesAffected: CoverageLine[];
  effects: { kind: ShockEffectKind; detail: string }[];
}

// What it cost, known AFTER.
//
// TWO DIFFERENT NUMBERS, ON PURPOSE. An injected claim has an exactly
// attributable cost — it is a specific claim with a specific amount. A
// frequency multiplier does NOT: a multiplied Poisson draw cannot be
// decomposed into "the base claims" and "the extra ones", and inferring it
// would need a counterfactual second draw. So attributable cost is reported
// where it exists and the analytic expectation where it does not, and the two
// are never added together into a single misleading figure.
export interface ShockRecord extends ShockFiring {
  attributableGrossLoss: number;  // exact; injections only
  attributableClaims: number;     // exact; injections only
  expectedGrossLossAdded: number; // analytic; multipliers and overrides
}

// ---------------------------------------------------------------------------
// What a single line receives. Built by the resolver at pool level and handed
// down through LineYearContext — a line-local generator never sees another
// line's effects, or knows that another line exists.
// ---------------------------------------------------------------------------

export interface LineShockEffects {
  // Sub-coverage key -> factor. '*' means the whole line.
  freqMultipliers?: Record<string, number>;
  injections?: { tier: string; count: number; ratingClass?: string }[];
}

export interface ShockResolution {
  byLine: Partial<Record<CoverageLine, LineShockEffects>>;
  // Resolved dotted path -> absolute value, per line. Accumulated across every
  // future-horizon event fired in THIS year or any earlier one.
  paramOverrides: Partial<Record<CoverageLine, Record<string, number>>>;
  firings: ShockFiring[];
}
