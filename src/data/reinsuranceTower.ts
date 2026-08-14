// PER-OCCURRENCE REINSURANCE TOWER — structure, measured expected-loss constants
// and the aggregate stop-loss parameters.
//
// Replaces the aggregate quota-share model (REINSURANCE_PROGRAMS) for WC and GL.
// PROPERTY STILL USES THE OLD MODEL: it runs the legacy aggregate loss path and
// has no Claim/Occurrence objects to layer, so `reinsuranceLevel` and
// REINSURANCE_PROGRAMS remain live for Property and ONLY for Property. The seam
// is simulationEngine's existing `isClaimLine` flag.
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

export type TowerLine = 'WC' | 'GL';

export interface TowerLayer {
  name: string;
  attachment: number;
  limit: number;
  // E[ceded] PER $100 OF ENROLLED EXPOSURE. See the derivation note below for
  // why a per-exposure constant is the correct shape rather than a dollar one.
  expectedCededPer100: number;
  // Ratio SD/E of ANNUAL ceded loss for this layer, measured. Drives the risk
  // load; stored rather than recomputed so the price is a pure lookup-and-scale.
  sdOverExpected: number;
  // Layers that exist but cannot currently be bought. See WC's top layer.
  purchasable: boolean;
}

// ============================================================================
// ⚠ EVERY expectedCededPer100 AND sdOverExpected BELOW WAS MEASURED FROM THE
// GENERATORS, NOT DERIVED IN CLOSED FORM. Same status as the Property mu
// constants: inert values with a recorded derivation, not live computation.
//
// HOW THEY WERE MEASURED: scripts/diagnostics/reinsurance-layer-check.ts drives
// generateWcClaims / generateGlClaims directly on a real year-1 ENROLLED book
// (WC 45 members / $290M exposure, GL 54 / $379M), buckets by occurrence total
// with the cap-then-sum rule above, and averages ceded loss per layer over
// 3,000 WC years and 20,000 GL years. gPool held at 1.
//
// WHY PER-$100-OF-EXPOSURE IS THE RIGHT SHAPE — and this is load-bearing, not a
// convenience. A per-occurrence layer's expected ceded loss is LINEAR in
// exposure, because only the occurrence FREQUENCY scales with the book while
// E[ceded per occurrence] is exposure-invariant. Verified across a 4.4x exposure
// range (enrolled vs full-market), ratio of ceded against ratio of exposure:
//   WC 4xs1   0.225 vs 0.223     GL 4xs1    0.284 vs 0.292
//   WC 5xs5   0.221 vs 0.223     GL 5xs5    0.286 vs 0.292
//   WC 15xs10 0.228 vs 0.223     GL 15xs10  0.290 vs 0.292
// Linear to within 2%. So these constants stay correct as the book grows,
// shrinks, or is re-underwritten — which a dollar constant would not.
//
// (An AGGREGATE stop-loss is NOT linear in exposure, which is exactly why the
// aggregate below is computed at runtime instead of stored. See its comment.)
//
// WHAT INVALIDATES THESE — re-run the diagnostic and re-derive if any of:
//   - any WC or GL severity, frequency or tier-mix parameter moves
//   - the canonical roster changes (a new roster version)
//   - GL_STATUTORY_CAP moves, or the cap's scope changes from indemnity-only
//   - medicalTrend or indemnityTrend moves
//   - the catastrophic annuity costing changes (medicalFirstYear, the discount
//     rate, the age range, the disability adjustment)
//   - the layer attachments or limits below change
// Underwriting strictness does NOT invalidate them: the per-exposure form
// absorbs book-size and book-selection changes, which is the point of the shape.
// ============================================================================

export const REINSURANCE_TOWER: Record<TowerLine, TowerLayer[]> = {
  // ⚠ RE-DERIVED FOR THE WC SEVERITY REBUILD, THEN RESTRUCTURED TO THREE LAYERS
  // (scripts/diagnostics/wc-tower-rederive.ts).
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
  // THE PRICES ARE THE CLOSED FORM, NOT THE SIMULATION. Layer expectation over a
  // lognormal mixture has an exact solution (limitedExpectedValue on each
  // component, differenced across the layer bounds), so the constant carries no
  // sampling error. Simulation over 12,000 full-market years agrees within ~4%;
  // the residual is the simulation being short of a sigma-2.0 tail, not the
  // analytic being wrong. sdOverExpected has no convenient closed form and IS
  // the measured figure.
  //
  // ⚠ NEUTRAL-RISK-QUALITY BASIS, AND THIS CHANGED AT THE MERGE. The previous
  // values were computed at each member's ACTUAL risk quality, which embeds both
  // the frequency theta and the severity tilt of one particular roster — 3.9%
  // above neutral on the canonical 200, and a different number on any enrolled
  // subset. A per-$100 rate card should not carry one book's risk-quality mix, for
  // the same reason it is measured full-market rather than on one seed's enrolled
  // book: the constant has to be reproducible. Neutral RQ is also the basis
  // deriveNeutralPurePremiumPer100 already uses for the pure premium pick.
  //
  // WHAT MOVED FROM THE RETIRED FOUR-TIER MODEL. That model's catastrophic annuity
  // had a HARD CEILING of $15.51M present value; the mixture has none.
  //   $4M xs $1M     0.4662 -> 0.6620   +42%   more claims pierce $1M
  //   $5M xs $5M     0.2697 -> 0.1474   -45%   the old annuity clustered here
  //   $40M xs $10M   0.0873 -> 0.1383   +58%   (vs the two old layers summed)
  //
  // THE LOADING MULTIPLE STILL RISES MONOTONICALLY WITH ATTACHMENT — 1.32x, 1.83x,
  // 3.00x — and it EMERGES from SD/E rather than being chosen. That is the whole
  // point of the SD risk load, and it had to survive the restructure: a merged
  // layer spanning $10M-$50M is more remote than the $15M xs $10M it absorbs, so
  // its SD/E and therefore its multiple both rise. Asserted in
  // reinsurance-tower-check.
  WC: [
    { name: '$4M xs $1M', attachment: 1e6, limit: 4e6, expectedCededPer100: 0.6620, sdOverExpected: 0.54, purchasable: true },
    { name: '$5M xs $5M', attachment: 5e6, limit: 5e6, expectedCededPer100: 0.1474, sdOverExpected: 1.44, purchasable: true },
    // THE MERGED BAND, $10M-$50M. Absorbs the retired `$15M xs $10M` and
    // `$25M xs $25M`. Pierced 0.22/yr — once every 4.6 years, against the
    // 1-per-26-years of the `$25M xs $25M` layer it swallowed, which is what
    // makes it a real purchase decision rather than a line item.
    //
    // Above it the pool retains 0.0252 per $100, unreinsurable and unbounded:
    // one occurrence over $50M per ~109 years.
    { name: '$40M xs $10M', attachment: 10e6, limit: 40e6, expectedCededPer100: 0.1383, sdOverExpected: 3.38, purchasable: true },
  ],
  GL: [
    { name: '$4M xs $1M', attachment: 1e6, limit: 4e6, expectedCededPer100: 0.9050, sdOverExpected: 0.97, purchasable: true },
    { name: '$5M xs $5M', attachment: 5e6, limit: 5e6, expectedCededPer100: 0.5311, sdOverExpected: 1.51, purchasable: true },
    { name: '$15M xs $10M', attachment: 10e6, limit: 15e6, expectedCededPer100: 0.7043, sdOverExpected: 2.16, purchasable: true },
    // No fourth layer. Market capacity — see the header. The pool retains above
    // $25M, unlimited, and it is DISPLAYED as retainedAboveTower.
  ],
};

// Top of each tower. Above this the pool retains, unlimited.
export const TOWER_TOP: Record<TowerLine, number> = { WC: 50e6, GL: 25e6 };

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
// WHY THE PRICE IS COMPUTED AND NOT LOOKED UP. The per-occurrence constants
// above freeze safely because a per-occurrence layer is LINEAR in exposure. An
// aggregate is neither: its expected cost depends on the VOLATILITY of retained
// loss, which pools as 1/sqrt(exposure), and it additionally depends on a
// decision made in the same turn — which occurrence layers the player bought.
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
// THE MODEL. Annual retained loss R is treated as compound-Poisson and then
// lognormal-approximated:
//   lambda   = AGG_OCC_FREQ_PER_1M x enrolled exposure ($M)
//   E[R]     = lambda x m1(selection)
//   SD[R]    = AGG_OVERDISPERSION x sqrt(lambda x m2(selection))
// then the aggregate layer expectation and its SD come from lognormal partial
// moments in closed form (claimMath.lognormalPartialMoment).
//
// VALIDATION vs the empirical, WC, all 16 selections at three attachments: the
// closed form tracked the simulation closely at low attachments and low CV
// (e.g. no layers at 110%: $1,434k empirical vs $1,445k closed form; all layers
// at 125%: $50k vs $52k). It drifts where the value is small and the tail thin,
// which is the safe direction to be wrong.
//
// AGG_OVERDISPERSION 1.05: the draw is wider than pure Poisson because of the
// per-member Gamma frequency noise (k=16). Measured SD/Poisson-SD ranged 1.009
// (no layers) to 1.049 (all layers), so 1.05 covers the worst case and errs
// toward a slightly HIGHER price, which is the conservative direction for the
// pool. m2 below was back-solved through this same factor, so the round trip
// reproduces the measured SD exactly at the reference exposure and scales as
// 1/sqrt(exposure) away from it.
// RE-DERIVED: 1.4310 -> 1.3733. Measured FULL-MARKET now (1,785.3 occurrences/yr
// over $1,300M) rather than on one seed's enrolled book; the name keeps
// "PER_1M" because it is still applied to enrolled exposure at the call site.
export const AGG_OCC_FREQ_PER_1M = 1.3733;   // WC occurrences per $1M of exposure
export const AGG_OVERDISPERSION = 1.05;

// Per-occurrence RETAINED second moment, indexed by the occurrence-layer
// BITMASK (bit i = layer i placed). Measured over 4,000 enrolled WC years.
// m1 is deliberately NOT stored — it is derived as
// (E[gross] - sum of placed E[ceded]) / lambda, from the constants above, so the
// two cannot drift apart.
//
// RE-DERIVED over 12,000 full-market years, and RE-INDEXED for three layers.
//
// ⚠ THE MASK SET HALVED, 16 -> 8. It is 2^(number of layers), so merging the top
// two layers changed the index space, not just the values. Bit 2 is now the
// merged $40M xs $10M band; the old bit 3 is gone. Any stored 16-entry table read
// against this index would silently address the wrong mask — quoteAggregate falls
// back to WC_RETAINED_SECOND_MOMENT[0] on an out-of-range index, which would have
// priced every selection as if NO layers were placed.
//
// Every mask is far above the retired four-tier model's: that model's catastrophic
// annuity was capped at $15.51M present value, so the retained second moment was
// capped with it, and the mixture's tail is unbounded. Mask 7 (all three placed)
// is 2.23e10 against the old all-placed 5.39e9.
export const WC_RETAINED_SECOND_MOMENT: number[] = [
  1.1792e11, 7.7680e10, 9.0537e10, 5.9075e10,
  6.2558e10, 3.0598e10, 4.5523e10, 2.2339e10,
];

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
export const AGG_ATTACHMENT_LEVELS = [1.10, 1.25, 1.50] as const;

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
export const AGG_LIMIT_MULTIPLE = 1.00;

// Default placement for a NEW game and for any save that predates the tower:
// every PURCHASABLE layer placed, no aggregate. Length matches the longest tower
// (WC, 4 entries); normalizeLayersPlaced trims per line.
export const DEFAULT_LAYERS_PLACED: boolean[] = REINSURANCE_TOWER.WC.map(l => l.purchasable);
