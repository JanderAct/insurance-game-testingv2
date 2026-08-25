// SHOCK EVENTS — the effect vocabulary.
//
// THE GOVERNING PRINCIPLE: EVENTS ARE DATA, NOT CODE. There are ~40 events in
// the design matrix. If each one is a function they will drift and each will
// grow its own quirks, so what is built here is an EFFECT VOCABULARY, and the
// events themselves live in a TABLE (src/data/shockCatalog.ts). Adding event
// #23 is adding a row, not writing a generator.
//
// SCOPE. Nine effect kinds are DEFINED so the shape is right. Only three are
// IMPLEMENTED, because only three are needed by the representative events
// built so far. An effect kind with no consumer is NOT silently ignored — the
// resolver throws on it (see shockResolver.ts). A shock that quietly does
// nothing is worse than one that fails loudly.
//
// RETRO HORIZON IS OUT OF SCOPE and is not represented here at all. It requires
// prior accident years to be re-valuable, which needs Phase 3 reserving.
//
// ⚠ THE REASON CHANGED SHAPE WITH IBNER AND IS WORTH RE-READING BEFORE ANYONE
// ACTS ON IT. This said "the current model carries aggregate cohorts with a
// random developmentFactor wobble, so there is nothing to reach back into".
// The wobble is gone; cohorts now carry a real IBNER state — registerSum, a
// horizon, an age, a step multiplier and a booking bias — and DO get re-valued
// each year. So prior accident years are no longer inert.
//
// That does NOT make retro horizon in scope. What is still missing is the
// ability to re-value a prior year under CHANGED PARAMETERS: IBNER walks a
// cohort's estimate forward, but the claim register behind it is pinned at the
// draw (see ReserveCohort's header on why that pinning is deliberate), so a
// retroactive shock has nothing to re-draw against. The blocker moved from "no
// reserving state" to "the register is immutable by design", which is a
// narrower and more specific obstacle. Roughly a third of the matrix waits on
// that.

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
  // IMPLEMENTED for WC. Injects `count` claims through that line's own
  // generator, so the claims are real: they carry ids, join the occurrence
  // list, and flow into reserving and reinsurance like any other.
  //
  // ⚠ `amount` IS REQUIRED, AND THAT IS THE POINT. This used to inject "a claim
  // of tier X" and let the generator draw it. Under the mixture model that
  // silently guts the event: two claims of the heavy component drawn at its MEAN
  // is $0.19M, against the retired catastrophic tier's $17.91M — 93x smaller.
  // $9.0M is the heavy component's 99.95th percentile, not its mean. An
  // instructor-triggered event wants a REPRODUCIBLE amount, not a tail draw.
  //
  // ⚠ `accidentYearOffset` IS GONE, with WC's report lag. It BACKDATED a claim
  // so a presumption expansion could add claims dated to prior accident years,
  // which only meant anything while a deferral mechanism existed to recognise
  // them later. With every claim reported in its own accident year, a backdated
  // claim still lands in THIS year's loss — the offset changed a label and
  // nothing else once the chain-ladder that read it was removed. #10 now files
  // its three claims on enactment for the same money in the same year.
  //
  // `firstYearOnly` exists because HORIZON IS PER-EVENT, NOT PER-EFFECT. #10 is
  // future-horizon so its frequency multiplier persists forward — but enactment
  // is a one-off, and without this flag the resolver would re-inject the same
  // three claims every single year.
  | {
      kind: 'injectClaim';
      line: CoverageLine;
      count: number;
      amount: number;
      firstYearOnly?: boolean;
    }
  // IMPLEMENTED for GL sub-coverages. Multiplies a realized frequency for one
  // year. `sub` omitted means the whole line.
  //
  // NOT USED BY WC ANY MORE — WC's frequency is now per mixture component, so it
  // uses componentFreqMultiplier below.
  | { kind: 'freqMultiplier'; line: CoverageLine; sub?: string; factor: number }
  // IMPLEMENTED for WC. Multiplies the ARRIVAL RATE of ONE MIXTURE COMPONENT,
  // leaving the others alone. `component` is a WC_SEVERITY_COMPONENTS key, or
  // '*' for the whole line.
  //
  // ⚠ THIS IS NOT "RAISE THE COMPONENT'S WEIGHT", AND THE DIFFERENCE IS THE
  // WHOLE REASON THE EFFECT EXISTS. Weights must sum to 1, so raising the heavy
  // component's weight forces the others DOWN — at w_large x 1.5, County's
  // small-claim weight falls 0.4415 -> 0.3752. A presumption expansion does not
  // make sprained backs rarer. The generator draws one Poisson PER COMPONENT
  // (thinning), so this multiplies a rate and the other components genuinely do
  // not move.
  //
  // SIZING: the loss multiplier is `1 + share_i x (k - 1)` where share_i is that
  // component's share of loss (the heavy component is ~94.9% of it), so
  // `k = 1 + target / 0.949`.
  | { kind: 'componentFreqMultiplier'; line: CoverageLine; component: string; factor: number }
  // IMPLEMENTED for GL. Multiplies drawn SEVERITY for one year (current
  // horizon) or permanently from the firing year (future horizon). `sub`
  // omitted means the whole line, and for GL that is the ONLY valid form —
  // shockCatalog throws at load on a GL sevMultiplier carrying a `sub`, because
  // GL has no sub-coverages and both its draw and its analytic read only '*'.
  //
  // ⚠ A FUTURE-HORIZON sevMultiplier IS A RATCHET, and that is the intended
  // shape for a social-inflation episode. Swiss Re's index has been above zero
  // every year since 2014 — a hard market does not unwind when it ends, it
  // leaves the severity LEVEL permanently higher. So the factor is sized as the
  // CUMULATIVE excess an episode leaves behind, and the episode's duration is an
  // authoring-time input to that number rather than a runtime mechanic.
  //
  // ⚠ WHAT THIS IS NOT: an elevated TREND RATE that runs for N years and then
  // returns to baseline with the accumulated level retained. That is the
  // physically correct model and it is the eventual answer, but it needs a new
  // effect kind (a trend-rate delta with a duration) and the resolver has no
  // bounded-duration horizon at all today — `active` is
  // `horizon === 'future' || firedYear === yearNumber`, so an effect is either
  // one year or permanent. Recorded here so the ratchet is not mistaken for the
  // finished design.
  //
  // Applied through glClaimEngine's trendedMuGl log-location shift, so it shares
  // one mechanism with the severity trend and leaves sigma — and therefore the
  // per-claim CV — untouched.
  | { kind: 'sevMultiplier'; line: CoverageLine; sub?: string; factor: number }
  // NOT IMPLEMENTED.
  | { kind: 'investmentShock'; assetClass: 'cash' | 'bonds' | 'equities'; returnDelta: number }
  // NOT IMPLEMENTED.
  | { kind: 'exposureChange'; line: CoverageLine; factor: number }
  // NOT IMPLEMENTED.
  | { kind: 'poolExpense'; amount: number; label: string }
  // --- FUTURE ---
  //
  // NOT IMPLEMENTED. It was implemented for WC alone, against an allow-list
  // (WC_OVERRIDABLE_PATHS) that held exactly one path:
  // `presumption.ratePer1MPoliceFire`. The WC severity rebuild retired the
  // presumption process, which left the allow-list empty and every WC parameter
  // unreachable — so the mechanism was deleted rather than parked, and the
  // effect kind moved here with the other five.
  //
  // GL and Property never supported it: both compute constants at module load
  // (GL's `baseThreshold` and `stageTrendFactor`, Property's four trend/intensity
  // factors) which would silently ignore any override.
  //
  // FUTURE-HORIZON PERSISTENCE STILL WORKS WITHOUT IT: horizon is a property of
  // the EVENT, so a future-horizon componentFreqMultiplier applies every year
  // from its firing onward. That is how #10 persists.
  //
  // TO BRING IT BACK: reinstate a path allow-list next to the parameters it
  // reaches, grep every read of each path first (a read inside a module-level
  // helper must be refactored to take params), and add the kind back to
  // IMPLEMENTED_EFFECTS.
  | { kind: 'paramOverride'; line: CoverageLine; path: string; multiplier?: number; value?: number };

export type ShockEffectKind = ShockEffect['kind'];

// The effect kinds a generator can actually execute today. The resolver checks
// against this rather than against a comment, so the two cannot drift.
export const IMPLEMENTED_EFFECTS: ReadonlySet<ShockEffectKind> = new Set<ShockEffectKind>([
  'injectClaim',
  'freqMultiplier',
  'componentFreqMultiplier',
  'sevMultiplier',
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
  // Sub-coverage key -> COMPOUNDED factor. '*' means the whole line. Two events
  // raising the same frequency compound rather than the later one winning: two
  // independent causes genuinely do both.
  freqMultipliers?: Record<string, number>;
  // WC mixture component -> COMPOUNDED arrival-rate factor. Same compounding
  // rule. '*' means every component.
  componentFreqMultipliers?: Record<string, number>;
  sevMultipliers?: Record<string, number>;
  // shockId is carried so an injected claim's cost maps back to the event that
  // caused it. Frequency multipliers carry no such tag because their cost is
  // not exactly attributable in the first place — see ShockRecord.
  injections?: { count: number; amount: number; shockId: string }[];
}

export interface ShockResolution {
  byLine: Partial<Record<CoverageLine, LineShockEffects>>;
  firings: ShockFiring[];
}
