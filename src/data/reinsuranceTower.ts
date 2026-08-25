// PER-OCCURRENCE REINSURANCE TOWER — structure, measured expected-loss constants
// and the aggregate stop-loss parameters.
//
// Replaces the aggregate quota-share model (REINSURANCE_PROGRAMS) for WC, GL and
// (as of the retention/aggregate commit) Property. REINSURANCE_PROGRAMS and
// reinsuranceEngine.ts are gone — Property was the model's last consumer.
//
// ============================================================================
// PROPERTY'S TOWER IS ONE LAYER, NOT THREE, AND THAT IS THE WHOLE STRUCTURE.
//
// $70M xs $5M, to the fitted severity mixture's own cap ($75M) — see
// PROPERTY_LOSS_MODEL.severityCap. There is no band above it to retain
// unlimited, unlike WC/GL: the model itself caps every claim at $75M, so
// TOWER_TOP.Property equals the severity cap exactly and `retainedAboveTower`
// is always ~0 by construction, not a market-capacity choice.
//
// RETENTION IS $5M, decided before this commit (perRiskRetention in
// PROPERTY_LOSS_MODEL was $2M, inherited from roster v3 and explicitly flagged
// there as needing re-derivation "when Property gets its per-occurrence tower" —
// this is that commit, and $5M supersedes it).
//
// OCCURRENCE == CLAIM for the fitted (attritional) severity mixture, so
// min(claim, $5M) is the correct per-occurrence retained amount today. THIS IS
// NOT GUARANTEED TO STAY TRUE. If a cat band is ever added, a single
// catastrophe must be modeled as ONE OCCURRENCE whose claims (one per member
// hit) share that occurrence's id — see the Occurrence/Claim note below. Get
// the grouping wrong and a $74M storm hitting 20 members becomes 20 claims
// averaging $3.7M each, none of which reaches the $5M retention, and the
// programme cedes nothing on the exact event it exists to cover.
//
// THE MECHANISM ALREADY HANDLES THIS CORRECTLY, TODAY, WITH ZERO CAT CLAIMS.
// `occurrenceTotals` (below) groups by `occurrenceId` and sums every claim in
// an occurrence BEFORE the layer sees it — it does not assume one claim per
// occurrence, it is simply never exercised on more than one because
// `generatePropertyClaims` does not yet emit a multi-claim occurrence. A future
// cat band only has to construct its Occurrence/Claim objects correctly
// (multiple claims, one shared occurrenceId, all in `occurrence.claimIds`); the
// tower requires no change to layer them as one event. This is written here,
// now, so the requirement is load-bearing on the generator from day one rather
// than discovered the day the first cat claim silently under-cedes.
// ============================================================================
//
// ============================================================================
// THE TOWER, AND WHY IT IS ASYMMETRIC
//
//   WC:  $4M xs $1M | $5M xs $5M | $15M xs $10M | $25M xs $25M
//   GL:  $4M xs $1M | $5M xs $5M | $15M xs $10M | NOTHING ABOVE $25M
//
// ⚠ GL STOPS AT $25M BECAUSE MARKET CAPACITY ABOVE THAT IS HARD TO FIND. That
// is a MARKET constraint, not a statement that the exposure is remote — the
// opposite: GL law-enforcement severity is Pareto(alpha 1.3), infinite
// variance, and the generator produces occurrences past $1 BILLION. The pool
// retains everything above $25M on GL, unlimited, and that band is what surplus
// stands behind. It is surfaced as `retainedAboveTower` precisely because it
// exceeds the top layer the pool actually buys.
//
// DO NOT "FIX" THIS ASYMMETRY by extending GL to match WC. The gap is the point.
// Adding an unlimited GL top layer asserts that a market exists to write it, and
// that assertion needs its own evidence.
// ============================================================================
//
// OCCURRENCE BASIS (J14). Layers attach to the OCCURRENCE total, not to any one
// claim — a GL abuse batch is one occurrence across several claimant claims and
// the treaty sees their sum. Two rules interact and are easy to transpose:
//
//   the STATUTORY CAP applies to INDEMNITY ONLY, per claim, stateLaw only
//   the RETENTION applies to INDEMNITY + ALAE COMBINED, per occurrence
//
// So a state-law claim can be capped on damages and still reach the treaty on
// defense costs. Order: cap each claim's indemnity, add its ALAE, sum the claims
// in the occurrence, then layer that total.
//
// ============================================================================
// ⚠ KNOWN SIMPLIFICATION: NO ANNUAL AGGREGATE LIMIT MEANS NO REINSTATEMENTS.
//
// Every layer here responds to every qualifying occurrence, without limit, all
// year. Real excess-of-loss treaties cap that with an annual aggregate limit or
// one to two reinstatements, so THIS TOWER IS MORE GENEROUS THAN MARKET — it
// understates cost and overstates protection.
//
// This is not a rare edge. Share of years seeing 2+ penetrations of a layer,
// every one covered in full:
//   GL $4M xs $1M    62.6%
//   WC $4M xs $1M    18.0%
//   GL $5M xs $5M     9.9%
//   GL $15M xs $10M   3.7%
//
// DELIBERATELY NOT BUILT. Recorded so it is a known simplification rather than
// an unnoticed one. Adding reinstatements would need a mechanic (annual
// consumption tracked per layer) and would change every price here.
// ============================================================================

import { PROPERTY_LOSS_MODEL } from './defaultAssumptions';

export type TowerLine = 'WC' | 'GL' | 'Property';

export interface TowerLayer {
  name: string;
  attachment: number;
  limit: number;
  // Layers that exist but cannot currently be bought. See WC's top layer.
  purchasable: boolean;
}

// ============================================================================
// ⚠ THERE ARE NO PRICING CONSTANTS IN THIS FILE ANY MORE. A LAYER IS ITS BOUNDS.
//
// `expectedCededPer100` and `sdOverExpected` used to live on TowerLayer, measured
// from the generators and frozen. Both are gone; the price is computed at runtime
// from the enrolled book and the current year in src/utils/towerMoments.ts. The
// full argument is in that module's header, but the short version, because the
// second half of it is the part that was missed for a long time:
//
//   expectedCededPer100 FROZE LEGITIMATELY BUT WENT STALE. A per-occurrence
//   layer's expected ceded loss really is LINEAR in exposure (verified across a
//   4.4x range, within 2%), so a per-$100 constant was the right SHAPE. But it
//   was multiplied by NOMINAL exposure, which grows at the wage rate, while the
//   actual ceded loss grows with the SEVERITY trend through a convex layer.
//   Over a decade: GL +22% / +33% / +41% by layer, WC +17% on its top layer.
//
//   sdOverExpected NEVER FROZE LEGITIMATELY AT ALL. SD/E scales as
//   ~1/sqrt(exposure) — its basis IS its value, so a single stored number is
//   wrong at every book size but one. Frozen at GL's stored 0.97, an $82M pool
//   was undercharged 19.9% and the full market overcharged 24.5%. The pools with
//   the least surplus standing behind the retention were paying the least for it.
//   The two lines were not even on the same basis: GL's figures came from a
//   ~$380M enrolled book, WC's from full market.
//
// WHAT STILL INVALIDATES THE *STRUCTURE* (attachments, limits, purchasability) —
// these are judgment calls, not measurements, and should be revisited if:
//   - the layer attachments or limits change
//   - a band's pierce frequency moves far enough to change whether it is a real
//     purchase decision (WC merged its top two layers when $25M xs $25M fell to
//     once per 27 years; GL's top layer pierces every 1.2 years and stays)
//   - market capacity above GL's $25M changes
// Severity, frequency, trend and roster changes NO LONGER invalidate anything
// here — that is the point of computing the price. GL_SEVERITY_CAP in particular
// is EXACTLY irrelevant to every band inside the tower: every GL layer bound is
// <= $25M and the cap is $100M, so min(X, cap) > 25M exactly when X > 25M and a
// cession is bit-identical either way (measured: 0.0e+0 relative difference). It
// reaches only the retained band above the tower, which it bounds at $75M.
// ============================================================================

export const REINSURANCE_TOWER: Record<TowerLine, TowerLayer[]> = {
  // ⚠ RE-DERIVED FOR THE WC SEVERITY REBUILD, THEN RESTRUCTURED TO THREE LAYERS
  // (the retired scripts/diagnostics/wc-tower-rederive.ts; its Monte Carlo
  // machinery now lives in tower-runtime-check.ts, which validates the runtime
  // pricing that replaced the constants that script used to emit).
  //
  // THE TOP TWO LAYERS ARE MERGED. `$15M xs $10M` and `$25M xs $25M` are now one
  // `$40M xs $10M` band covering the same $10M-$50M. Two reasons, and the second
  // is the actuarial one:
  //
  //   1. FOUR BUYABLE LAYERS IS ONE DECISION TOO MANY. WC and GL now carry the
  //      same three-layer shape.
  //   2. $25M xs $25M FIRED ONCE PER 27 YEARS, which is too thin to be a real
  //      purchase decision — a player would never see it pay inside a game.
  //      Merged, the band fires ONCE EVERY 4.7 YEARS.
  //
  // THE LOADING MULTIPLE RISES MONOTONICALLY WITH ATTACHMENT and it EMERGES from
  // SD/E rather than being chosen — that is the whole point of the SD risk load.
  // It survived the restructure (a merged $10M-$50M band is more remote than the
  // $15M xs $10M it absorbs, so its SD/E and its multiple both rise) and it
  // survives the move to runtime pricing. Asserted in reinsurance-tower-check.
  //
  // ⚠ THE MULTIPLES ARE NO LONGER FIXED NUMBERS, because SD/E is no longer a
  // fixed number: a small book is more volatile per dollar of expected ceded loss
  // and now correctly pays a higher multiple for the same layer. At the full
  // market in year 1 they are 1.33x / 1.87x / 3.02x on WC and 1.27x / 1.51x /
  // 1.82x on GL; on a $82M GL book the working layer's rises to ~1.98x.
  WC: [
    { name: '$4M xs $1M', attachment: 1e6, limit: 4e6, purchasable: true },
    { name: '$5M xs $5M', attachment: 5e6, limit: 5e6, purchasable: true },
    // THE MERGED BAND, $10M-$50M. Absorbs the retired `$15M xs $10M` and
    // `$25M xs $25M`. Pierced 0.22/yr — once every 4.6 years, against the
    // 1-per-26-years of the `$25M xs $25M` layer it swallowed, which is what
    // makes it a real purchase decision rather than a line item.
    //
    // Above it the pool retains, unreinsurable but now BOUNDED: one occurrence
    // over $50M per ~109 years, and WC_SEVERITY_CAP ends the band at $85M, so
    // the exposure above this layer is at most $35M per occurrence. It read
    // "UNBOUNDED (WC has no severity cap)" until that cap was imposed.
    { name: '$40M xs $10M', attachment: 10e6, limit: 40e6, purchasable: true },
  ],
  // GL KEEPS THREE LAYERS — re-confirmed at the runtime-pricing change against
  // the rebuilt severity model. The merge test WC failed is pierce frequency, and
  // GL passes it comfortably: its top band is pierced 0.833/yr (once every 1.2
  // years) against the 1-per-27-years that got WC's top layer merged away. All
  // three GL bands are working layers.
  GL: [
    { name: '$4M xs $1M', attachment: 1e6, limit: 4e6, purchasable: true },
    { name: '$5M xs $5M', attachment: 5e6, limit: 5e6, purchasable: true },
    { name: '$15M xs $10M', attachment: 10e6, limit: 15e6, purchasable: true },
    // No fourth layer. Market capacity — see the header. The pool retains above
    // $25M and it is DISPLAYED as retainedAboveTower.
    //
    // ⚠ THE REASON NARROWED WHEN THE SEVERITY CAP LANDED, and the header above
    // still needs reading with that in mind. It used to be capacity AND
    // pricing-honesty: an unbounded band cannot be priced with a straight face.
    // GL_SEVERITY_CAP bounds this band at $75M per occurrence, so it is now
    // priceable — the remaining objection is capacity alone, which has not
    // changed. Adding the layer would still assert a market exists to write it.
  ],
  // ONE LAYER. See the header note above for why this is the whole structure
  // rather than a starting point: occurrence == claim for the fitted
  // (attritional) mixture, the retention is $5M, and the layer runs to the
  // model's own severity cap because nothing the generator produces exceeds
  // it. BOTH BOUNDS READ FROM PROPERTY_LOSS_MODEL rather than restating the
  // numbers — perRiskRetention and severityCap are the single source for
  // both this tower and propertyAggregate.ts's Panjer pricing.
  Property: [
    {
      name: `$${(PROPERTY_LOSS_MODEL.severityCap - PROPERTY_LOSS_MODEL.perRiskRetention) / 1e6}M xs $${PROPERTY_LOSS_MODEL.perRiskRetention / 1e6}M`,
      attachment: PROPERTY_LOSS_MODEL.perRiskRetention,
      limit: PROPERTY_LOSS_MODEL.severityCap - PROPERTY_LOSS_MODEL.perRiskRetention,
      purchasable: true,
    },
  ],
};

// Top of each tower. Above this the pool retains, unlimited.
//
// PROPERTY IS NOT "UNLIMITED" IN THE SAME SENSE AS WC/GL. Their tops are market
// capacity limits with real unbounded severity above them. Property's $75M
// equals PROPERTY_LOSS_MODEL.severityCap exactly — nothing the generator draws
// exceeds it, so `retainedAboveTower` is a structural ~0, not a market retention.
export const TOWER_TOP: Record<TowerLine, number> = { WC: 50e6, GL: 25e6, Property: PROPERTY_LOSS_MODEL.severityCap };

// ============================================================================
// THE RISK LOAD — one market parameter, not four chosen multiples.
//
//   premium = E[ceded] + RISK_LOAD_LAMBDA x SD[ceded]
//
// A standard-deviation risk load. It RISES WITH ATTACHMENT automatically,
// because SD/E rises with remoteness — the reinsurer charges for CAPITAL, and SD
// is the capital proxy. Nothing here was hand-tuned per layer.
//
// Resulting multiples at lambda 0.60, and the measured SD/E behind each:
//   WC 4xs1    SD/E 1.54 -> 1.92x     GL 4xs1    SD/E 0.97 -> 1.58x
//   WC 5xs5    SD/E 2.32 -> 2.39x     GL 5xs5    SD/E 1.51 -> 1.91x
//   WC 15xs10  SD/E 3.87 -> 3.32x     GL 15xs10  SD/E 2.16 -> 2.29x
//
// WHY 0.60: it lands working layers at 1.6-1.9x and top layers at 2.3-3.3x,
// against real-market multiples of roughly 1.2-1.6x for working layers and 2-3x
// for middle layers. The top-layer multiples look modest for "high excess"
// because THESE LAYERS ARE NOT REMOTE IN THIS BOOK — GL's top layer is
// penetrated 0.30 times a year, once every three years. That is a working layer,
// and a 6-10x multiple would be wrong for it.
//
// THE BEHAVIOUR THAT VALIDATES THE APPROACH: GL's top layer prices at 1.6155 per
// $100 against WC's 0.2874, despite a LOWER multiple (2.29x vs 3.32x), because
// it is genuinely more exposed. A uniform loading would have been wrong in both
// directions at once — too dear on WC's top layer and far too cheap on GL's.
export const RISK_LOAD_LAMBDA = 0.60;

// ============================================================================
// WC AGGREGATE STOP-LOSS — priced at runtime, deliberately.
//
// SCOPE: total annual RETAINED loss, INCLUDING loss retained through UNPLACED
// occurrence layers, not merely loss below the $1M retention. That scope is
// load-bearing: an aggregate covering only sub-retention loss would not respond
// to the layer selection at all, and the interaction below is the whole reason
// the cover exists.
//
// WHY THE PRICE IS COMPUTED AND NOT LOOKED UP. Its expected cost depends on the
// VOLATILITY of retained loss, which pools as 1/sqrt(exposure), and it
// additionally depends on a decision made in the same turn — which occurrence
// layers the player bought.
//
// ⚠ THIS NOTE USED TO SAY "the per-occurrence constants above freeze safely" as
// the contrast. They did not, and they are gone — see the header. The aggregate
// was right to be computed; the occurrence layers have now joined it.
//
// Declining occurrence layers puts catastrophic claims back into the retention,
// raising retained volatility, raising the aggregate's expected cost. Measured
// on the enrolled book at a 125% attachment, E[ceded] by selection:
//   all four occurrence layers bought   $50k
//   none bought                       $1,058k
// A 21x swing. Freezing this price would make "decline every occurrence layer,
// buy the aggregate at 110%" free volatility transfer: the pool would shed its
// year-to-year swing at a price set for a book that had already capped every
// large claim. DESIGN INTENT: "retain more per occurrence, cap the annual
// total" IS a viable alternative strategy, and it is priced fairly rather than
// blocked.
//
// GL GETS NO AGGREGATE, and there is a second reason beyond market capacity: the
// lognormal fit below is valid for WC (retained-loss CV 0.15-0.41) and FAILS for
// GL (CV > 1, Pareto tail). Checked against the empirical, the closed form ran
// up to +195% wrong on GL. A pricing model that cannot price the cover honestly
// is a reason not to sell it.
//
// THE MODEL. Annual retained loss R is a compound sum, then
// lognormal-approximated for the layer integral:
//   E[R]     = E[gross] - E[ceded by the placed occurrence layers]
//   CV[R]    = from towerMoments.retainedRiskMoments, at the current year
//   SD[R]    = E[R] x CV[R]
// then the aggregate layer expectation and its SD come from lognormal partial
// moments in closed form (claimMath.lognormalPartialMoment).
//
// VALIDATION vs the empirical, WC, all selections at three attachments: the
// closed form tracked the simulation closely at low attachments and low CV
// (e.g. no layers at 110%: $1,434k empirical vs $1,445k closed form; all layers
// at 125%: $50k vs $52k). It drifts where the value is small and the tail thin,
// which is the safe direction to be wrong.
//
// ============================================================================
// ⚠ TWO CONSTANTS WERE DELETED HERE, AND THE SECOND DELETION FIXED A REAL BUG.
//
// AGG_OCC_FREQ_PER_1M (1.3733) was WC occurrences per $1M, applied at the call
// site to NOMINAL (wage-inflated) exposure. WC's occurrence COUNT tracks REAL
// (frozen) payroll x wcFrequencyTrend — payroll growth is pure wage inflation and
// letting claim counts ride it asserts that paying people more injures more of
// them. So modelled lambda grew 3.63%/yr while true lambda grew at the frequency
// trend. This was NOT a staleness problem and would have survived any
// re-measurement of the table: the constant was fine, the basis it was applied
// to was wrong. Worse, E[R] came from the correctly-trended expectedGrossLoss
// while SD[R] came from this lambda, so the CV handed to the lognormal was wrong
// in a way neither input revealed on its own.
//
// AGG_OVERDISPERSION (1.05) was a fudge back-solved to widen a pure-Poisson SD
// into the measured one, standing in for per-member Gamma frequency noise the
// stored table could not represent. retainedRiskMoments carries that noise
// analytically (its B2 term), so keeping the multiplier would double-count it.
//
// WC_RETAINED_SECOND_MOMENT was an 8-entry table indexed by placement bitmask,
// frozen at year-1 dollars. Retained loss is a SECOND moment, so it grows roughly
// as trend^2 and the table understated SD[R] by more every year — the aggregate
// got cheaper in real terms exactly as the risk grew. It is now integrated in
// closed form band by band (retained loss is piecewise linear in the occurrence
// total, so this is exact, not an approximation), which also retires the
// bitmask-index hazard the old comment warned about: there is no index to get
// wrong, because there is no table.
// ============================================================================

// ATTACHMENT SET, as a multiple of EXPECTED RETAINED LOSS — recalculated from
// the player's occurrence-layer selection every year, never a fixed dollar
// figure (which would go stale as the book grows and would ignore the retention
// structure entirely).
//
// 110 / 125 / 150 spans the market range for aggregate stop-loss. Measured
// E[ceded] across the set shows why all three are meaningful choices when
// occurrence layers are declined ($1,434k / $1,058k / $588k with none bought)
// and why only the lowest is meaningful once they are bought ($263k / $50k /
// $1k with all four). THAT IS THE CORRECT SIGNAL, NOT A BUG: an aggregate on top
// of full occurrence cover genuinely is nearly worthless, and the price says so.
//
// ⚠ ONLY WC AND PROPERTY HAVE AN AGGREGATE. GL does not (market capacity, and —
// separately — its retained-loss CV fails the lognormal fit quoteAggregate uses
// for WC; see that function's header). Keyed on the two lines that actually
// have one rather than carrying a meaningless GL entry.
export const AGG_ATTACHMENT_LEVELS: Record<'WC' | 'Property', readonly number[]> = {
  WC: [1.10, 1.25, 1.50],

  // TWO LEVELS, chosen for a WIDE FREQUENCY SPREAD rather than a market-range
  // triple like WC's — two levels close together would be one decision with a
  // nudge. Derived by Monte Carlo against the roster v6 enrolled book
  // (scripts/diagnostics/property-tower-mc.ts), NOT the pre-rescale plan's
  // figures — the roster moved twice since that plan and would have made those
  // numbers wrong by construction, not just stale.
  //
  // Measured at that book (E[retained[ $12.12M, occurrence layer purchased):
  //   0.83 x E[R] -> attachment rounds to $10M, fires ~61% of years (~3-in-5,
  //                  matching the real-market aggregate reference the decision
  //                  to build one at all was argued from)
  //   1.49 x E[R] -> attachment rounds to $18M, fires ~14% of years (~1-in-7)
  // A >4x gap in firing frequency and an $8M gap in dollar attachment — a real
  // choice between "smooths a bad year" and "catastrophe backstop only", not
  // two numbers a player would treat as the same decision.
  Property: [0.83, 1.49],
};

// LIMIT, as a multiple of expected retained loss. A LIMIT IS REQUIRED: an
// unlimited aggregate is hard to price honestly and would make the upper
// occurrence layers pointless, since the annual cap would absorb any single
// large occurrence too.
//
// 100% of expected retained loss, because it covers roughly a +3 sigma year on
// the smoothed configurations (enrolled E[R] $10.4M, SD $1.6M with all layers
// bought) while leaving a single catastrophic occurrence LARGELY RETAINED — a
// $37M occurrence against a ~$12.8M limit still leaves the pool most of it. So
// the aggregate complements the occurrence tower instead of substituting for it,
// and it scales with the book automatically.
//
// SHARED ACROSS WC AND PROPERTY, not re-derived per line — a limit expressed as
// a multiple of the line's OWN expected retained loss already scales with that
// line's book, which is the property that made re-deriving it for Property
// unnecessary. Re-derive it separately only if a line-specific reason to differ
// ever appears.
export const AGG_LIMIT_MULTIPLE = 1.00;

// Default placement for a NEW game and for any save that predates the tower:
// every PURCHASABLE layer placed, no aggregate. KEYED PER LINE, not one flat
// array — a flat array sized to WC's layer count silently discarded every
// placement decision on any line whose tower has a different number of layers,
// via normalizeLayersPlaced's length check (`placed.length !== layers.length`
// -> revert to all-purchasable). Property's one-layer tower is exactly that
// case: reusing WC's 3-element array would have made every Property placement
// a no-op.
export const DEFAULT_LAYERS_PLACED: Record<TowerLine, boolean[]> = {
  WC: REINSURANCE_TOWER.WC.map(l => l.purchasable),
  GL: REINSURANCE_TOWER.GL.map(l => l.purchasable),
  Property: REINSURANCE_TOWER.Property.map(l => l.purchasable),
};
