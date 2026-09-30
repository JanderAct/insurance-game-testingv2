// THE SHOCK EVENT TABLE.
//
// Events are DATA. Adding event #23 is adding a row here — no new function, no
// new branch in the engine. The machinery lives in src/utils/shockResolver.ts
// and the effect vocabulary in src/types/shocks.ts.
//
// IDs are the design-matrix numbers so the table and the matrix stay mapped to
// each other — except WILDFIRE and WATER-CONTAMINATION, whose matrix numbers
// are not in the repository and which carry provisional names (see their
// rows). Eight of the ~40 events are present, and all eight are executable:
// #2 was data only until the Property cat band gave it something to force.
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

import type { ShockDefinition, ShockRange } from '../types/shocks';
import type { CoverageLine } from '../types/simulation';
import { WC_SEVERITY_COMPONENTS } from './defaultAssumptions';
import { WHOLE_LINE } from '../utils/shockEffects';
import { CAT_REGIONS } from '../utils/propertyCatastrophe';

export const SHOCK_CATALOG: Record<string, ShockDefinition> = {
  // -------------------------------------------------------------------------
  // THE CATASTROPHE EVENTS — forceEvent, one kind for every regional peril.
  //
  // ⚠ #2 WAS DATA ONLY AND IS NOW EXECUTABLE. Its two blockers were "no cat
  // generator" and "no occurrence tower for a cat event to pierce". Both went
  // with the cat band (propertyCatastrophe.ts, PROPERTY_CAT_MODEL): a regional
  // event summed into ONE occurrence, answered by the $462.5M xs $37.5M cat
  // layer. A forced event reuses all of it — the occurrence, the catastrophe
  // flag the tower reads, the cat layer, development and the claims export — and
  // adds only a named region and a stated size. So wildfire, earthquake,
  // flooding and windstorm are rows of ONE effect kind, not four mechanisms.
  //
  // WHAT CHANGED IN #2's ROW, AND WHY:
  //   - `span: true` and `intensity: 5.3` are gone. The cat band's ruling is one
  //     occurrence per region; a quake reaching an adjacent region is a second
  //     forceEvent, and the matrix row asks for one large Property loss.
  //   - its WC half was `freqMultiplier` on WC, which WC's generator never read
  //     (WC takes componentFreqMultiplier) — it would have fired as a
  //     Property-only event while describing crew injuries. It is now an
  //     explicit WC injection, and shockCatalog below now REJECTS a
  //     freqMultiplier on WC outright.
  //
  // THE SIZE, $25M-$100M, is the matrix's range, drawn uniformly per firing
  // from a stream keyed on the shock id. Against the $37.5M cat retention that
  // is a real reinsurance question: the bottom of the range is retained in
  // full, the top cedes $62.5M.
  //
  // THE WC HALVES ARE JUDGMENT CALLS, stated. The matrix row says Property and
  // WC "both take a large loss" for the earthquake and names WC only as
  // secondary for the wildfire, with no WC figure for either. Both reuse
  // magnitudes this catalog already documents rather than inventing new ones:
  //   earthquake  one claim at $9.0M — #15's catastrophic-injury amount, the
  //               heavy component's 99.95th percentile
  //   wildfire    two claims at $900,000 — #10's serious-occupational amount,
  //               the heavy component's ~98.3rd percentile
  // DISPLACED BY: a WC figure in the matrix row.
  //
  // BANDS. The matrix grades wildfire at severity 4 and contamination at 3 on
  // its own 1-5 scale; this catalog's three bands map 3 -> moderate and
  // 4 -> high. #2 keeps the 'severe' it already had.
  // -------------------------------------------------------------------------
  '#2': {
    id: '#2',
    name: 'Major Earthquake',
    horizon: 'current',
    band: 'severe',
    description:
      'A major earthquake strikes the Central region. Damage runs across the members there as one '
      + 'catastrophe — one occurrence, answered by the catastrophe layer — and building collapse '
      + 'brings a catastrophic workers\' compensation injury with it.',
    effects: [
      { kind: 'forceEvent', line: 'Property', peril: 'earthquake', region: 'Central', loss: { min: 25_000_000, max: 100_000_000 } },
      { kind: 'injectClaim', line: 'WC', count: 1, amount: 9_000_000 },
    ],
  },

  // -------------------------------------------------------------------------
  // WILDFIRE — PROVISIONAL ID. The design matrix numbers its events ('#2',
  // '#22'), and its number for this row is not in the repository. Rather than
  // guess one that may collide with a real row, this carries a name. Renumber
  // it when the matrix number is known — BEFORE any room schedules it, since a
  // room's schedule stores the id.
  //
  // NORTH, because the cat design's wildfire hazard weights put 45% of the
  // peril there (North 0.45 / Central 0.35 / South 0.20 — the wildland-urban
  // interface), in docs/PROPERTY_CAT_ENGINE_DESIGN.md.
  // -------------------------------------------------------------------------
  'WILDFIRE': {
    id: 'WILDFIRE',
    name: 'Major Wildfire',
    horizon: 'current',
    band: 'high',
    description:
      'A major wildfire burns through the North region\'s wildland-urban interface. The damage across the '
      + 'members it reaches is one catastrophe — one occurrence, answered by the catastrophe layer — and '
      + 'staff responding to it are seriously injured.',
    effects: [
      { kind: 'forceEvent', line: 'Property', peril: 'wildfire', region: 'North', loss: { min: 25_000_000, max: 100_000_000 } },
      { kind: 'injectClaim', line: 'WC', count: 2, amount: 900_000 },
    ],
  },

  // -------------------------------------------------------------------------
  // WATER SYSTEM CONTAMINATION — PROVISIONAL ID, for the same reason as
  // WILDFIRE. GL primary, severity 3, current year.
  //
  // THE FIRST GL INJECTION. glClaimEngine read no injections until this row:
  // the resolver bucketed them and the generator's input mapping dropped them,
  // so a GL injectClaim would have fired, been recorded, and cost nothing.
  //
  // TWO TO FIVE CLAIMS ABOVE $5M is the matrix's statement, and both halves are
  // ranges here, drawn from a stream keyed on the shock id. The count is
  // uniform on {2,3,4,5}. Each claim is uniform on $5M-$10M: the floor is the
  // matrix's "above $5M", which is also the attachment of GL's $5M xs $5M layer;
  // the ceiling is that layer's top, so every claim lands in one layer's band
  // and the event tests the tower rather than GL's unreinsurable band above
  // $25M. The ceiling is a JUDGMENT CALL — the matrix gives no upper bound.
  // DISPLACED BY: an upper bound in the matrix row.
  // -------------------------------------------------------------------------
  'WATER-CONTAMINATION': {
    id: 'WATER-CONTAMINATION',
    name: 'Water System Contamination',
    horizon: 'current',
    band: 'moderate',
    description:
      'Contamination of a member\'s public water system brings a cluster of large bodily-injury and '
      + 'property claims against the pool\'s members — two to five claims, each above $5M.',
    effects: [
      { kind: 'injectClaim', line: 'GL', count: { min: 2, max: 5 }, amount: { min: 5_000_000, max: 10_000_000 } },
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
  // Sized to mirror the forward rate over a three-year reach-back: 3 claims at
  // $900,000 each, $2.70M against an enrolled annual WC loss near $9.70M, i.e.
  // ~9.3% per year reached back — the same rate as the forward effect. $900,000
  // is the heavy component's ~98.3rd percentile, the right neighbourhood for a
  // serious occupational-disease claim and well below #15's $9.0M mega-claim.
  // DISPLACED BY: any real reach-back window from comparable legislation.
  //
  // ⚠ THE THREE CLAIMS ARE NO LONGER BACKDATED, and the magnitude is unchanged.
  // They carried accidentYearOffset -1/-2/-3 so they would be attributed to
  // prior accident years; with WC's report lag removed there is no mechanism by
  // which a prior-year claim becomes known now — it would have reported in its
  // own accident year. The claims were never inert (emit added them to this
  // year's loss regardless of their label), so what the offset actually bought
  // was an attribution that fed the chain-ladder, and that consumer is gone.
  // Keeping it would have left a field that changes a label and nothing else.
  //
  // The narrative survives intact: legislation makes previously non-compensable
  // conditions compensable, and the claims are FILED ON ENACTMENT. Three claims,
  // $2.70M, in the year the event fires — the same money at the same time.
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
      + 'work-related, raising the rate of severe claims from this year forward. On enactment, three '
      + 'claims are filed at once for conditions that were not previously compensable.',
    effects: [
      { kind: 'componentFreqMultiplier', line: 'WC', component: 'large', factor: 1.096 },
      { kind: 'injectClaim', line: 'WC', count: 3, amount: 900_000, firstYearOnly: true },
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
  // #19 — FUTURE horizon. Tests sevMultiplier, and it is the first SEVERITY
  // effect in the catalogue.
  //
  // THE SOCIAL-INFLATION HARD MARKET. GL's baseline severity trend already
  // carries LONG-RUN social inflation at 2.0%/yr (glClaimEngine's
  // GL_SEVERITY_TREND_PER_YEAR). This event is the EPISODE on top of it —
  // nuclear verdicts, litigation funding, eroding damages caps — running
  // severity toward Swiss Re's 2023 peak of 7% social while it lasts.
  //
  // ⚠ IT IS A RATCHET, NOT A TEMPORARY SPIKE, AND THAT IS THE WHOLE MODELLING
  // POINT. Swiss Re's Social Inflation Index has been above zero EVERY YEAR
  // since 2014: when a hard market ends, severity does not fall back: the LEVEL
  // it reached stays. So this is future-horizon and permanent, and its factor is
  // sized as the CUMULATIVE EXCESS an episode leaves behind rather than as a
  // per-year rate. The episode's duration is an authoring-time input to that
  // number, not a runtime mechanic.
  //
  // MAGNITUDE, DERIVED: the excess of the peak over the baseline is
  // 1.07 / 1.02 = 1.04902, i.e. +4.90%/yr while the episode runs. Compounded:
  //     2 years  1.1004      3 years  1.1544      4 years  1.2110
  //
  // TWO YEARS (x1.1004) IS CHOSEN, for two reasons:
  //   1. 7% IS A PEAK, NOT A PLATEAU. Swiss Re's index peaked at 7% in 2023; the
  //      elevated 2017-2022 stretch averaged 5.4%. Holding the maximum observed
  //      value for three or four years asserts a plateau the data does not show.
  //      Two years at the peak is the defensible end of the range.
  //   2. THE RATCHET IS PERMANENT, so even 1.1004 is not a small event. GL's
  //      enrolled gross runs ~$17.8M/yr, so +10.04% is ~$1.79M EVERY REMAINING
  //      YEAR. Firing mid-game that is ~$14M cumulative against a ~$30M starting
  //      surplus — roughly 3.7x the lifetime cost of #22, which is a one-year
  //      +21.7% of line. Hence the `high` band rather than `moderate`.
  //
  // ⚠ WHAT THIS IS NOT, AND WHAT SHOULD REPLACE IT EVENTUALLY: an elevated TREND
  // RATE that runs for N years and then reverts to baseline with the accumulated
  // level retained. That is the physically correct model. It needs a new effect
  // kind (a trend-rate delta with a duration) because the resolver has NO
  // bounded-duration horizon — an effect is either one year (`current`) or
  // permanent (`future`). The ratchet reproduces the END STATE of an episode
  // exactly and only approximates its path, front-loading the whole step into
  // the firing year. Recorded so the approximation is not mistaken for the
  // finished design. See types/shocks.ts on sevMultiplier.
  //
  // DISPLACED BY: a social-inflation index covering the pre-2014 period, which
  // would let both this magnitude and the 2.0% baseline be measured rather than
  // judged.
  // -------------------------------------------------------------------------
  '#19': {
    id: '#19',
    name: 'Social Inflation Hard Market',
    horizon: 'future',
    band: 'high',
    description:
      'Nuclear verdicts, third-party litigation funding and eroding damages caps drive a liability hard '
      + 'market. General Liability claim severity steps up permanently — when the episode passes, the '
      + 'level it reached does not come back down.',
    effects: [
      { kind: 'sevMultiplier', line: 'GL', factor: 1.1004 },
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

// Which shock channel each line's generator actually reads — the single table
// the rejections below check against. claimGeneration.ts is where these are
// mapped; a line reading a new channel is added in both places.
const READS: Record<string, readonly CoverageLine[]> = {
  forceEvent: ['Property'],
  injectClaim: ['WC', 'GL'],
  freqMultiplier: ['GL'],
  componentFreqMultiplier: ['WC'],
  sevMultiplier: ['GL'],
};
const isRange = (v: unknown): v is ShockRange => typeof v === 'object' && v !== null && 'min' in v && 'max' in v;

// One definition's checks, exported so shock-check can hand it rows the
// catalog must never contain and assert each one throws — a validator nothing
// ever sees fail is a validator nobody has tested.
export function validateShockDefinition(def: ShockDefinition): void {
  for (const effect of def.effects) {
    // ⚠ AN EFFECT ON A LINE THAT DOES NOT READ IT IS REJECTED. This is the class
    // of defect that has now bitten three times — #28's WC half, #22's EPL sub,
    // and #2's freqMultiplier on WC — where an effect resolves, is recorded as
    // firing, and costs nothing because the line's generator never looks at it.
    // It used to be unvalidated because #2 carried exactly such an effect and
    // was kept unschedulable by an unimplemented forceEvent. #2 is executable
    // now, so the hole is closed rather than documented.
    const readers = READS[effect.kind];
    if (readers && 'line' in effect && !readers.includes(effect.line)) {
      throw new Error(
        `shockCatalog ${def.id}: ${effect.kind} on ${effect.line}, but only ${readers.join(' and ')} `
        + `read${readers.length === 1 ? 's' : ''} ${effect.kind}` + (effect.kind === 'forceEvent'
          ? ' — Property is the only line with a cat band.'
          : '. As written this effect would fire, be recorded, and silently cost nothing.'),
      );
    }

    // A forced catastrophe must name a region the cat band has, and a size
    // range that is a range. It is the region the tower and the claims land in.
    if (effect.kind === 'forceEvent') {
      if (!CAT_REGIONS.includes(effect.region)) {
        throw new Error(`shockCatalog ${def.id}: forceEvent region '${effect.region}' is not one of ${CAT_REGIONS.join('/')}.`);
      }
      if (!(effect.loss.min > 0) || !(effect.loss.max >= effect.loss.min)) {
        throw new Error(`shockCatalog ${def.id}: forceEvent loss range [${effect.loss.min}, ${effect.loss.max}] is not a positive range.`);
      }
      if (!effect.peril) throw new Error(`shockCatalog ${def.id}: forceEvent needs a peril.`);
    }

    // An injected claim MUST carry a positive explicit amount. The generator
    // throws too, but that is at fire time, possibly years into a game; this
    // catches a bad row at startup. See the #15 comment for why a missing
    // amount is the dangerous case rather than an obviously broken one.
    if (effect.kind === 'injectClaim') {
      // A RANGE IS GL-ONLY. GL's injection path draws ranges from a shock-keyed
      // stream; WC's takes explicit values, and a range reaching it would throw
      // at fire time instead of here.
      if ((isRange(effect.count) || isRange(effect.amount)) && effect.line !== 'GL') {
        throw new Error(`shockCatalog ${def.id}: injectClaim on ${effect.line} uses a range, and only GL draws ranges. Give an explicit count and amount.`);
      }
      const amountMin = isRange(effect.amount) ? effect.amount.min : effect.amount;
      const amountMax = isRange(effect.amount) ? effect.amount.max : effect.amount;
      if (!(amountMin > 0) || !(amountMax >= amountMin)) {
        throw new Error(`shockCatalog ${def.id}: injectClaim needs a positive explicit amount, got ${JSON.stringify(effect.amount)}`);
      }
      const countMin = isRange(effect.count) ? effect.count.min : effect.count;
      const countMax = isRange(effect.count) ? effect.count.max : effect.count;
      if (!(countMin > 0) || !(countMax >= countMin) || !Number.isInteger(countMin) || !Number.isInteger(countMax)) {
        throw new Error(`shockCatalog ${def.id}: injectClaim needs a positive integer count, got ${JSON.stringify(effect.count)}`);
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
    // THE GL COUNTERPART, and it exists for the same reason. The GL sub-coverage
    // rebuild deleted general/epl/lawEnforcement/abuse, and BOTH GL's draw and
    // GL's analytic now read only the WHOLE_LINE key. A `sub` on a GL
    // freqMultiplier is therefore inert in both halves at once — the event would
    // cost nothing, price at nothing, and still describe itself as a surge. That
    // is strictly worse than the WC case above, where at least the two halves
    // could disagree visibly; here they agree on doing nothing.
    if (effect.kind === 'freqMultiplier' && effect.line === 'GL' && effect.sub !== undefined) {
      throw new Error(
        `shockCatalog ${def.id}: freqMultiplier on GL names sub '${effect.sub}', but GL has no `
        + `sub-coverages since the severity rebuild — both the draw and the analytic read only `
        + `'${WHOLE_LINE}'. Omit ` + '`sub`' + ` to target the whole line. As written this effect would be silently inert.`,
      );
    }
    // sevMultiplier has the identical trap and the identical fix.
    if (effect.kind === 'sevMultiplier' && effect.line === 'GL' && effect.sub !== undefined) {
      throw new Error(
        `shockCatalog ${def.id}: sevMultiplier on GL names sub '${effect.sub}', but GL has no `
        + `sub-coverages since the severity rebuild — both the draw and the analytic read only `
        + `'${WHOLE_LINE}'. Omit ` + '`sub`' + ` to target the whole line. As written this effect would be silently inert.`,
      );
    }
  }
}

for (const def of Object.values(SHOCK_CATALOG)) validateShockDefinition(def);
