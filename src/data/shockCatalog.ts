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
import { WC_SEVERITY_COMPONENTS } from './defaultAssumptions';
import { WHOLE_LINE } from '../utils/shockEffects';

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
  // #10 — FUTURE horizon. Tests componentFreqMultiplier, forward persistence,
  // and the backdated one-off injection.
  //
  // ⚠ RE-TARGETED BY THE WC SEVERITY REBUILD. This used to be a paramOverride on
  // `presumption.ratePer1MPoliceFire` x1.5. The presumption process is retired
  // and that path no longer exists — which would have THROWN AT MODULE LOAD and
  // stopped the app from starting, since paths are validated at import below.
  //
  // A LEGISLATIVE EXPANSION HAS TWO HALVES AND THEY ARE DIFFERENT MECHANISMS:
  //
  //   FORWARD — more severe claims are compensable from now on. That is an
  //   ARRIVAL-RATE change on the heavy mixture component, persisting forward
  //   because the event is future-horizon.
  //
  //   RETROACTIVE — conditions that were not compensable when they happened now
  //   are. That ADDS CLAIMS DATED TO PRIOR ACCIDENT YEARS. It is emphatically NOT
  //   "revise the unreported inventory", which would make already-drawn claims
  //   cost more; these are claims that did not previously exist.
  //
  // FORWARD MAGNITUDE, x1.096, DERIVED NOT INVENTED. The retired shock raised
  // presumption frequency 50%, and presumption was 18.26% of CLASS-ONLY loss, so
  // the old event added +9.13% of loss. The heavy component carries ~94.9% of
  // loss, so `k = 1 + 0.0911 / 0.949 = 1.096` reproduces that. (Measured on the
  // class-only base, which is the right one: with presumption retired, all WC
  // loss is now "class" loss and there is no separate channel to exclude.)
  //
  // ⚠ RETROACTIVE MAGNITUDE IS A JUDGMENT CALL — the spec requires the mechanism
  // but sets no number, and the retired event had no retroactive half at all.
  // Sized to mirror the forward rate over a three-year reach-back: 3 claims, one
  // dated to each of the three prior accident years, at $900,000 each. That is
  // $2.70M against an enrolled annual WC loss near $9.70M, i.e. ~9.3% per year
  // reached back — the same rate as the forward effect. $900,000 is the heavy
  // component's ~98.3rd percentile, which is the right neighbourhood for a
  // serious occupational-disease claim and well below #15's $9.0M mega-claim.
  // DISPLACED BY: any real reach-back window from comparable legislation.
  //
  // `firstYearOnly` on all three: the event is future-horizon so the frequency
  // multiplier persists, but enactment happens once. Without the flag the same
  // reach-back would be re-injected every year for the rest of the game.
  // -------------------------------------------------------------------------
  '#10': {
    id: '#10',
    name: 'WC Presumption Expansion',
    horizon: 'future',
    band: 'high',
    description:
      'Legislation permanently expands the presumption that police and fire occupational disease is '
      + 'work-related, raising the rate of severe claims from this year forward and reopening three '
      + 'prior accident years for conditions that were not previously compensable.',
    effects: [
      { kind: 'componentFreqMultiplier', line: 'WC', component: 'large', factor: 1.096 },
      { kind: 'injectClaim', line: 'WC', count: 1, amount: 900_000, accidentYearOffset: -1, firstYearOnly: true },
      { kind: 'injectClaim', line: 'WC', count: 1, amount: 900_000, accidentYearOffset: -2, firstYearOnly: true },
      { kind: 'injectClaim', line: 'WC', count: 1, amount: 900_000, accidentYearOffset: -3, firstYearOnly: true },
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
  // ⚠ RE-TARGETED BY THE WC SEVERITY REBUILD. This used to inject two claims of
  // tier 'catastrophic' and let the generator build each as a lifetime annuity
  // booked at present value (~$8.96M each, $17.91M for the pair). That tier is
  // retired, and the generator now THROWS on an injection without an explicit
  // amount — deliberately, because the silent failure here was far worse than a
  // loud one: injecting two claims of the heavy component and letting them DRAW
  // would produce its MEAN of $96,529, $0.19M for the pair. That is 93x smaller,
  // and the event would have looked like it still worked.
  //
  // $9.0M each preserves the retired event's magnitude. It is the heavy
  // component's 99.95th percentile — a claim this model genuinely produces, just
  // not one to leave to a draw when an instructor triggers the event.
  '#15': {
    id: '#15',
    name: 'Catastrophic WC Mega-Claim',
    horizon: 'current',
    band: 'high',
    description:
      'Two catastrophic workers-compensation injuries in one year — lifetime medical care plus wage '
      + 'indemnity to retirement.',
    effects: [
      { kind: 'injectClaim', line: 'WC', count: 2, amount: 9_000_000 },
    ],
  },

  // -------------------------------------------------------------------------
  // #22 — CURRENT horizon. Tests freqMultiplier at whole-line scope.
  //
  // ⚠ RE-TARGETED BY THE GL SUB-COVERAGE REBUILD. This used to be
  // `freqMultiplier` on sub 'epl' x2.0. That key no longer exists — GL has no
  // sub-coverages left to target, only WHOLE_LINE — and unlike a
  // componentFreqMultiplier typo this would NOT have thrown at load: it would
  // have silently done nothing every time it fired.
  //
  // x1.217 PRESERVES THE OLD EVENT'S SHARE OF GL's TOTAL, not its old dollar
  // amount or its old factor. Doubling EPL added EPL's own full-market analytic
  // ($19.84M) against the old four-sub-coverage total ($91.44M) — 21.7% of GL.
  // A whole-line frequency multiplier adds exactly (factor - 1) x 100% of GL's
  // total, so matching that same 21.7% share of the new total gives
  // factor = 1 + 19.84/91.44 = 1.217. This is a judgment call, not a
  // derivation from the new model the way the mixture parameters are: there is
  // no sub-coverage left to anchor the event's narrative "EPL surge" framing
  // to, so what's preserved is the moderate-band SCALE the event was
  // calibrated to read as, not a specific mechanism it now hits.
  // -------------------------------------------------------------------------
  '#22': {
    id: '#22',
    name: 'Employment Practices Surge',
    horizon: 'current',
    band: 'moderate',
    description:
      'A wave of employment-practices claims — discrimination, harassment, wrongful termination — '
      + 'raises General Liability claim frequency for one year.',
    effects: [
      { kind: 'freqMultiplier', line: 'GL', factor: 1.217 },
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
  // ⚠ THE WC HALF WAS RE-TARGETED BY THE SEVERITY REBUILD. It used to be
  // `freqMultiplier` on sub 'presumption' x3.0. That key no longer exists, and
  // unlike #10 this one would NOT have thrown — shockFactorFor returns 1 for an
  // unknown key, so the event would have SILENTLY become a GL-only shock while
  // still describing itself as a workers-comp surge.
  //
  // x1.620 IS A DELIBERATE CHOICE OF WHAT TO PRESERVE, stated rather than
  // stumbled into. It preserves the measured DOLLARS (+$5.71M) against the new
  // enrolled WC loss of $9.70M: the heavy component is ~94.9% of loss, so
  // 1 + 0.949 x 0.620 = 1.588, and 0.588 x $9.70M = $5.71M. The original
  // measurement was against an old enrolled base near $12.76M, where the same
  // dollars were +45%. Preserving dollars makes the event harsher in relative
  // terms; preserving the percentage would make it milder in dollars. Neither is
  // automatically right — dollars were chosen because the event's severity band
  // was set against a dollar figure.
  //
  // ⚠ THE GL HALF WAS RE-TARGETED BY THE GL SUB-COVERAGE REBUILD, for the
  // identical reason as #22: 'general' no longer exists. x1.057 preserves the
  // same SHARE-OF-LINE logic as #22's — 1.25x on 'general' added 0.25 x
  // $21.00M (general's old full-market analytic) against the old $91.44M GL
  // total, 5.74% of GL. factor = 1 + 5.25/91.44 = 1.057. Smaller than #22's
  // adjustment because 'general' was a smaller slice of the old line total
  // than 'epl' was multiplied by a smaller factor — this event was always the
  // secondary, lower-scale half of a cross-line pair, and stays that way.
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
      { kind: 'componentFreqMultiplier', line: 'WC', component: 'large', factor: 1.620 },
      { kind: 'freqMultiplier', line: 'GL', factor: 1.057 },
    ],
  },
};

// ---------------------------------------------------------------------------
// CATALOG VALIDATION AT MODULE LOAD.
//
// Effects are data, which keeps the catalog readable but gives up compile-time
// safety on their VALUES. This buys some of it back at startup, so a bad row
// throws when the app loads rather than silently doing nothing in year 7.
//
// ⚠ THE paramOverride PATH VALIDATOR WAS DELETED WITH THE MECHANISM. The WC
// severity rebuild retired the presumption process, which emptied
// WC_OVERRIDABLE_PATHS — the only allow-list there was — leaving paramOverride
// implemented for no line and used by no event. Validating paths for an effect
// the resolver refuses to execute is a parked mechanic, so both went. If
// paramOverride is ever reinstated, the walker and this loop come back with it;
// see types/shocks.ts for the full checklist.
//
// Consumes no randomness and reads no mutable state, so it cannot affect
// simulation output.
// ---------------------------------------------------------------------------

for (const def of Object.values(SHOCK_CATALOG)) {
  for (const effect of def.effects) {
    // An injected claim MUST carry a positive explicit amount. The generator
    // throws too, but that is at fire time, possibly years into a game; this
    // catches a bad row at startup. See the #15 comment for why a missing
    // amount is the dangerous case rather than an obviously broken one.
    if (effect.kind === 'injectClaim') {
      if (!(effect.amount > 0)) {
        throw new Error(`shockCatalog ${def.id}: injectClaim needs a positive explicit amount, got ${effect.amount}`);
      }
      if (!(effect.count > 0)) {
        throw new Error(`shockCatalog ${def.id}: injectClaim needs a positive count, got ${effect.count}`);
      }
      if (effect.accidentYearOffset !== undefined && effect.accidentYearOffset > 0) {
        throw new Error(
          `shockCatalog ${def.id}: injectClaim accidentYearOffset must be <= 0 (it BACKDATES a claim); got ${effect.accidentYearOffset}`,
        );
      }
    }
    // A component multiplier must name a component the model actually has, or
    // '*'. shockFactorFor returns 1 for an unknown key, so a typo would make the
    // event silently do nothing — which is exactly how #28 would have failed.
    if (effect.kind === 'componentFreqMultiplier' && effect.line === 'WC') {
      if (effect.component !== WHOLE_LINE && !(effect.component in WC_SEVERITY_COMPONENTS)) {
        throw new Error(
          `shockCatalog ${def.id}: componentFreqMultiplier names WC component '${effect.component}', `
          + `which is not in WC_SEVERITY_COMPONENTS. A typo here would silently do nothing.`,
        );
      }
    }
  }
}
