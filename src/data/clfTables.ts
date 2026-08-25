// STATIC CLF TABLES for WC and GL.
//
// CLF(p) is the multiplier applied to the pool premium so that the funded
// amount covers the year's retained loss p% of the time.
//
// ============================================================================
// ⚠ READ THIS FIRST: THE TWO LINES NO LONGER COME FROM THE SAME PLACE.
//
//   WC  DERIVED  — backtested on this engine. Everything in the derivation
//                  note below applies to it, and its stop labels mean what
//                  they say against WC's own retained distribution.
//   GL  SUPPLIED — a real pool's measured curve at a scale this model does not
//                  have. It is IN FORCE for GL, it does NOT describe GL's own
//                  distribution, and it over-delivers by about 10pp through the
//                  working range. See GL_SUPPLIED below for the measured cost;
//                  GL's own derived curve is kept beside it as GL_DERIVED.
//
// The derivation note that follows describes how the DERIVED tables were made.
// It is the provenance of WC's shipped curve and of GL_DERIVED — NOT of the
// GL curve the engine actually reads.
//
// ============================================================================
// HOW THESE WERE DERIVED, AND WHY IT IS A BACKTEST.
//
// The engine was run at ALL-DEFAULT decisions for 3,000 games x 10 years per
// line, each line SOLO so inter-line loans could not couple them, and for every
// line-year the realised retained loss was divided by the retained loss that was
// funded:
//
//     ratio = netIncurredLoss / poolPremium
//
// The percentiles of that ratio ARE this table. See
// scripts/diagnostics/clf-table-derive.ts.
//
// ⚠ THIS REPLACES A MONTE CARLO THAT WAS WRONG IN A WAY ONLY A BACKTEST COULD
// SEE. The previous WC_CLF_GRID and GL_CLF_GRID were derived from a separate
// Monte Carlo of the annual loss distribution and interpolated at runtime on a
// CV (WC) or lambda (GL) axis. Measured against the engine, WC's over-delivered
// at EVERY ONE of nine stops, by +3.5pp at the working stops — a mismatch
// between the grid's model of the draw and the draw itself, invisible to the
// grid's own held-out validation because that check compared the grid against
// its own generating process. Deriving from the engine absorbs any such
// mismatch by construction: there is no second model left to disagree with.
//
// ⚠ NO CIRCULARITY. At all-defaults fundingAtExpected pins CLF to exactly 1.000
// and no table is consulted, so the derivation run does not depend on its own
// output.
//
// ============================================================================
// THE NUMERATOR IS netIncurredLoss, NOT netUltimateLoss, AND THE CHOICE MATTERS
// ON WC.
//
// netIncurredLoss is what the P&L charges against the premium —
// underwritingIncome = poolPremium - netIncurredLoss is an exact identity at
// defaults. So "adequate at stop p" means precisely "underwriting income is
// non-negative p% of the time", which is the outcome the player actually
// experiences in surplus.
//
// WC's grossUltimateLoss is the CALENDAR-year REPORTED loss (its own header
// says so): it carries prior-year emergence and excludes this year's delayed
// claims. The two bases give crossings 4.6pp apart on WC (47.2% incurred vs
// 51.8% ultimate) and 1.9pp apart on GL (68.6% vs 70.5%, the gap being reserve
// paydown timing since GL has no IBNR; both are pre-trending-ceiling figures,
// the GL incurred crossing now being 70.9%). Choosing the ultimate basis would have
// made every stop label overstate what the player's surplus does, which is the
// same class of defect the net-funding change removed.
//
// ============================================================================
// ⚠ CALIBRATED AT THE DEFAULT LAYER CONFIGURATION AND THE EQUILIBRIUM BOOK.
//
// TWO SIMPLIFICATIONS ARE BAKED IN, both deliberate and both measured:
//
//   NO LAYER-MASK DIMENSION. The table is measured with DEFAULT_LAYERS_PLACED
//   (every purchasable occurrence layer). Retained-distribution SHAPE is not
//   invariant to the placement — standardising three configurations by their own
//   retained CV does NOT make the curves overlay, and the decisive case is GL,
//   where all-layers CV 0.7794 and no-layers CV 0.7940 sit 1.9% apart while
//   their standardised tails differ by 2.1-2.3x at p80/p90/p95. So a CV-indexed
//   single curve was ruled out on measurement, not assumed. Declining layers
//   costs UP TO ~8.9pp of label accuracy (worst measured: GL no-layers at the
//   90% stop delivers 81.1%). A MASK-INDEXED derivation is the eventual answer
//   if that ever matters — 8 masks per line, applied to the same draws in one
//   pass, not 8 passes.
//
//   NO BOOK-SIZE DIMENSION. Since the membership equilibrium fix the enrolled
//   book holds near 62 members rather than drifting toward 20, so the size axis
//   the old grids interpolated over buys little. Median book in the derivation
//   run: 62 members on both lines.
//
// ⚠ RE-DERIVE THIS TABLE if DEFAULT_LAYERS_PLACED changes, if the funding basis
// changes again, if the membership equilibrium moves materially, or if any loss
// model is re-fitted. It is a measurement of the engine, so any change to the
// engine's loss or pricing path invalidates it.
//
// ============================================================================
// ⚠ WC'S TABLE WAS RE-DERIVED WHEN THE REPORT LAG AND IBNR WERE REMOVED, and
// the move went the OPPOSITE way to what was expected. The prediction was that
// removing IBNR would close the 4.6pp incurred-vs-ultimate gap and lift WC's
// crossing from 47.2% toward 51.9%. Measured, it FELL to 44.0% incurred / 47.0%
// ultimate, and the gap narrowed only to 3.0pp rather than closing.
//
// TWO EFFECTS, OPPOSITE SIGNS, and the larger one was not in the prediction:
//   the IBNR BUILD used to inflate netIncurredLoss, so removing it lowers the
//     ratio and lifts the crossing — worth the ~1.6pp of gap that did close
//   the REPORT LAG used to DEFER ~17% of dollars out of each year's reported
//     loss. In a book growing ~2.1%/yr nominal, deferral out exceeds emergence
//     in, so reported loss ran systematically BELOW the accident-year loss the
//     premium was funding. Removing the lag removes that suppression, raising
//     the ratio and lowering the crossing. Mean ratio moved 1.0476 -> 1.0624,
//     +1.5% of premium, against ~1.2% predicted by 17% x (1 - 1.021^-3.5).
// The second dominates, so the crossing fell 3.2pp.
//
// ⚠ IT MOVED AWAY FROM THE ~55% REAL-POOL BENCHMARK, NOT TOWARD IT. That was
// hoped for as a side effect of the removal and did not happen.
//
// The residual 3.0pp incurred-vs-ultimate gap is CASE-reserve rollforward — the
// paydown schedule and the per-cohort development on top of it — which this
// change did not touch. So the gap was never purely IBNR.
//
// (That mechanism was `developmentFactor`, a uniform wobble, when this was
// written. IBNER replaced it, and the gap SURVIVED the replacement at
// essentially the same size — 2.8pp measured on the merged branch, 44.3%
// incurred against 47.1% ultimate. Naming the old mechanism here would now
// point at code that does not exist, and would also imply the wobble was the
// cause when swapping it out did not move the gap.)
//
// ============================================================================
// THE MEASURED CROSSING of the DERIVED curves — where the ratio reaches 1.000,
// i.e. what "Expected" (CLF exactly 1.000) delivers against each line's own
// distribution:
//
//     WC 44.1%  (95% CI 43.4-45.0)      GL 70.9%  (95% CI 70.2-71.5)
//
// ⚠ WC's CROSSING MOVED 47.2% -> 44.1% WITH WC_SEVERITY_CAP, outside its own
// old CI, and the direction is the informative part. The cap lowers EXPECTED
// gross loss by 0.32%, but per-layer expected CEDED loss is BIT-IDENTICAL
// (every WC layer bound tops at $50M, below the $85M ceiling — measured, not
// assumed). So E[retained] = E[gross] - E[ceded] falls by MORE than 0.32% in
// relative terms, the pool premium falls with it, and typical realised losses
// fall only on the rare years the cap binds. The ratio therefore rises on an
// ordinary year and "Expected" reaches break-even at a LOWER percentile.
//
// The 3.1pp size is amplified by something already recorded below: WC's
// crossing sits where the ratio density is highest, so a small distributional
// shift moves it a lot.
//
// ⚠ GL's CROSSING THEN MOVED 68.6% -> 70.9% WHEN THE CEILINGS STARTED TRENDING,
// outside its own old CI, and WC's did NOT move at all (44.1% both times, and
// its table shifted only in the 4th decimal). The asymmetry is the diagnostic
// part, so do not read the two as one effect:
//
//   - GL's severity trend is 5.7026% against WC's 3.67%, and its old ceiling
//     was proportionally tighter, so a stationary $100M was truncating far
//     more of GL's later-year tail than $85M was of WC's.
//   - GL's PRICE moved and WC's did not. GL prices at glCappedSeverityTrend,
//     which was BELOW the raw trend and is now equal to it (+2.24% at year 10).
//     WC already priced at its raw trend, so only WC's DRAW moved.
//
// The mechanism behind the 2.3pp: mean and price still match, but the shape
// changed. GL's 99th stop rose 5.6018 -> 6.5251 while its median FELL
// 0.8509 -> 0.8307 — mass moved out of the middle and into the extreme tail,
// because the trending ceiling stops truncating exactly the largest later-year
// claims. A more right-skewed ratio distribution crosses 1.000 at a HIGHER
// percentile. That skew is not a side effect to be tidied away: a fixed ceiling
// lightening a line's tail a little more every year was the defect.
//
// ⚠ GL's SHIPPED crossing is 57.7%, not 70.9%, because the supplied curve is in
// force — and the supplied curve did NOT move, so GL's shipped pricing is
// unchanged by the trending ceiling. 70.9% is the truth about GL's
// distribution; 57.7% is what the supplied curve reports. See GL_SUPPLIED.
//
// THE SANITY CHECK AGAINST REAL EXPERIENCE, and it needs the right basis to
// read. Real public-entity pools put the mean year near the 55th percentile.
// WC's ULTIMATE-basis crossing is 51.8% — about 3pp under that, and within 2pp
// of the 54% an independent measurement of the retained distribution's shape
// predicted. Close, not identical, and the residual is not explained here.
// WC's incurred-basis crossing of 47.2% is a further 4.6pp below, and that gap
// is IBNR: the two bases are answering different questions, so the apparent
// disagreement between this backtest and the shape measurement dissolves once
// they are compared on the same one.
//
// GL is expected NOT to match the 55th-percentile benchmark and does not,
// landing at 70.9%. That is structural rather than an error: GL retains 8.0% of
// ground-up loss ABOVE the tower, unhedgeable, against WC's 0.7%. A retained
// distribution carrying a large untransferable spike has a median well below its
// mean, so funding at the mean covers the median year comfortably.
//
// ⚠ BOTH LINES ARE UNDERFUNDED AT CLF 1.000 ON THE INCURRED BASIS: WC by a mean
// 4.8% of premium (mean ratio 1.0476), GL by 2.1% (1.0205). "Expected" funds the
// accident-year expectation while the P&L charges a reserve that grows with the
// book, so the two differ in a growing pool. That is a property of the pure
// premium, NOT something this table should paper over, and it is left visible
// rather than absorbed.
//
// ============================================================================
// ⚠ THE TABLE IS SELF-REFERENTIAL, AND IT WAS ITERATED TO A FIXED POINT.
//
// Installing the table changes the engine it was measured from. The route is
// the 90% stop: reserveMarginCLF reads it, the Required Reserve Margin scales
// with it, and runPriorHistory's reject-and-redraw accepted a pre-game only if
// the opening surplus landed inside OPENING_MULTIPLE_BAND x that margin. So a
// first-pass table measured under the old grids sat in an engine with
// different opening surplus than the one it was derived from.
//
// ⚠ THAT ROUTE IS NOW CLOSED, and the iteration record below is kept anyway.
// The pre-game tests the opening against PREMIUM, not against the margin, so
// installing a table no longer moves the opening and the self-reference is
// broken at its only link. A re-derivation from here should converge in ONE
// pass. Confirm that rather than assume it — the fixed-point discipline below
// is what caught the problem in the first place, and it costs one extra run.
//
// Measured rather than assumed, and iterated until it stopped moving:
//
//   pass 1 (derived under the retired grids)   WC 49.9%   GL 68.8%
//   pass 2 (derived with pass 1 installed)     WC 47.2%   GL 68.6%
//   pass 3 (derived with pass 2 installed)     WC 47.2%   GL 68.6%   converged
//
// AND AGAIN when the report lag and IBNR came out, which moved WC's whole
// distribution and so required the same iteration from scratch:
//   pass 1 (under the pre-removal table)       WC 44.0%
//   pass 2 (with pass 1 installed)             WC 43.5%   <- SHIPPED
//   pass 3 (with pass 2 installed)             WC 43.5%   converged
// Pass 3 reproduces pass 2 to three decimals at every stop (p50 1.0384 vs
// 1.0385, p90 1.3709 vs 1.3714).
//
// AND AGAIN at the WC severity cap, and AGAIN at the trending ceilings. Both of
// those converged in ONE pass rather than three, and both were CONFIRMED by a
// second run rather than assumed from the note above:
//
//   WC severity cap        pass 1 and pass 2 BIT-IDENTICAL at all 20 stops
//   trending ceilings      pass 1 and pass 2 BIT-IDENTICAL at all 20 stops,
//                          BOTH LINES, crossings 44.1% (WC) and 70.9% (GL)
//                          identical across the two passes
//
// One pass is now the expected outcome, not a lucky one — a3d7760 cut the link
// that made installing a table move the opening book. The second run is still
// worth its two minutes: it is what distinguishes "converged" from "happened to
// land on the same numbers", and it is cheap against re-deriving a table that
// silently did not.
// GL's derived curve re-measured at 68.7% across that change, unmoved — WC's
// report lag never touched it, which is the same thing the GL-solo leak check
// says byte-for-byte.
//
// Pass 3 reproduces pass 2 to three decimals at every stop (WC p50 1.0184 vs
// 1.0187, p90 1.3893 vs 1.3887; GL identical at 0.5397 and 5.6018), so the
// tables below are a fixed point of the engine they sit in, not a snapshot of
// the engine that preceded them.
//
// GL barely moved at any pass; WC moved 2.7pp on the first and then stopped.
// WC's crossing sits where the ratio density is highest, so a small shift in the
// distribution moves the crossing further there than in GL's flat tail region.

import type { CoverageLine } from '../types/simulation';

export type StaticClfLine = 'WC' | 'GL' | 'Property';

// A line's curve. `stops` and `clf` are index-aligned and ascending.
//
// STOPS ARE PER LINE, not shared, because the two lines' curves no longer come
// from the same place: WC's is derived from this engine over 10-99, GL's is a
// supplied real-pool curve over 25-95. A single shared stop array would have
// forced GL's curve to be extrapolated into a range it does not cover.
export interface ClfTable {
  stops: number[];
  clf: number[];
  source: 'derived' | 'supplied';
}

// ============================================================================
// WC — DERIVED from this engine. Unchanged. See the derivation note above.
//
// ⚠ WC's TOP STOPS ARE PRECISE; GL's DERIVED ONES WERE NOT. At 30,000 line-years
// WC's 95th stop has a 95% CI half-width of +/-0.0085.
const WC_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.7652, 0.8138, 0.8541, 0.8865, 0.9195, 0.9485, 0.9771, 1.0042, 1.0334, 1.0635,
    1.0933, 1.1237, 1.1598, 1.1992, 1.2419, 1.2969, 1.3677, 1.4731, 1.5749, 1.7015,
  ],
};

// ============================================================================
// GL — SUPPLIED, NOT DERIVED. THIS IS THE ONE IN FORCE.
//
// A real public-entity pool's measured curve, at a scale this model does not
// have. It REPLACES GL's own derived table (kept below as GL_DERIVED), and the
// substitution is a deliberate placeholder rather than a correction — the
// derived curve is the more accurate description of THIS model's GL book.
//
// ⚠ IT DESCRIBES A BIGGER, SMOOTHER BOOK. Its implied annual CV is about 0.40
// against GL's own measured 0.79. Everything below follows from that one fact.
//
// MEASURED CONSEQUENCE — this curve OVER-DELIVERS against GL's own distribution
// by roughly 10pp through the working range, because it is priced off a less
// volatile book than the one the engine draws. Measured, not predicted (see
// scripts/diagnostics/gl-supplied-clf-check.ts):
//
//     label      30%    40%    50%    60%    70%    80%    90%    95%
//     delivers  35.5%  47.8%  59.6%  70.5%  80.1%  87.4%  92.4%  94.0%
//     error     +5.5   +7.8   +9.6  +10.5  +10.1   +7.4   +2.4   -1.0
//
// Peak over-delivery is +10.5pp at the 60% stop. It converges at the top and
// slightly UNDER-delivers at 95%. And its top stop of 1.701 covers only 94.0% of
// GL line-years against GL's own 99th percentile of 6.53, so on this curve
// NEAR-CERTAINTY IS NOT PURCHASABLE at any slider position — the most a player
// can buy is about the 94th percentile of the real retained distribution.
//
// THE CROSSING MOVES 70.9% -> 57.7% AS DISPLAYED, and the difference is BOOK
// SIZE. Note what does NOT move: "Expected" still covers 68.1% of GL line-years
// in measurement, because it bypasses the table entirely. (That 68.1% is a
// BACKTEST COVERAGE figure, not the crossing, and it has not been re-measured
// since the ceilings started trending — the 10.4pp below is therefore on the
// pre-trending basis. The crossing it is often confused with moved 68.6% ->
// 70.9%; these are two different quantities and only one was re-derived.) So the displayed
// figure now UNDERSTATES GL's real coverage at Expected by 10.4pp. GL's
// derived curve crosses at 70.9% because a 62-member pool's retained loss is
// genuinely more volatile and more skewed than the pool this curve came from;
// a skewed distribution has its median well below its mean, so funding at the
// mean covers more than half the years. The supplied curve, from a larger and
// smoother book, crosses much closer to the middle.
//
// ⚠ RAISING GL'S FREQUENCY IS THE LEVER THAT WOULD CLOSE THE GAP — more claims
// per year at the same expected loss lowers the annual CV toward the supplied
// curve's 0.40 and moves the crossing down toward 57.7% on the model's own
// terms. That is the real fix. This table is not it.
//
// RANGE: 25-95, narrower than the derived table's 10-99. No slider change was
// needed: SLIDER_RANGES.fundingConfidenceLevel is 0.30-0.95, and the only other
// request in the engine is reserveMarginCLF at 0.90, so every reachable request
// already falls inside 25-95. staticClf still clamps outside the range, but on
// GL that clamp is unreachable from any UI control.
const GL_SUPPLIED: ClfTable = {
  source: 'supplied',
  stops: [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95],
  clf: [
    0.704, 0.750, 0.794, 0.837, 0.881, 0.926, 0.973, 1.023, 1.075,
    1.135, 1.201, 1.279, 1.376, 1.502, 1.701,
  ],
};

// ============================================================================
// GL — DERIVED from this engine. NOT IN FORCE, KEPT DELIBERATELY.
//
// This is a measured property of the model and must not be lost: it is what
// GL's retained loss distribution actually does at the equilibrium book, and
// anyone revisiting the supplied curve needs both to compare. Derived by the
// same backtest and the same iteration-to-fixed-point as WC's — see the header.
//
// Crosses at 70.9%. Its 97.5 and 99 stops (3.3484, 6.5251) are imprecise and
// that is the distribution rather than the sample: GL's retained tail carries
// the unhedgeable above-tower band, so its upper percentiles are genuinely
// unstable (95% CI half-width +/-0.28 at the 97.5th against WC's +/-0.012).
//
// ⚠ THOSE TWO STOPS MOVED MOST WHEN THE CEILING STARTED TRENDING — the 99th
// from 5.6018 to 6.5251 — because they are exactly the region a fixed ceiling
// was truncating. Their imprecision means the MOVE is less well resolved than
// the bulk of the curve; the direction is not in doubt, the third decimal is.
//
// EXPORTED, and it has a real consumer: gl-supplied-clf-check.ts measures the
// supplied curve against it. That keeps it type-checked and honest rather than
// rotting in a comment.
export const GL_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.5306, 0.5822, 0.6230, 0.6622, 0.6982, 0.7316, 0.7646, 0.7963, 0.8307, 0.8662,
    0.9046, 0.9469, 0.9918, 1.0443, 1.1080, 1.1954, 1.3407, 1.8318, 3.3484, 6.5251,
  ],
};

// ============================================================================
// PROPERTY — DERIVED from this engine, on the NET basis.
//
// 20,000 line-years from 2,000 solo games at all defaults, via
// scripts/diagnostics/clf-table-derive.ts (LINES=Property GAMES=2000). Same
// statistic, same block bootstrap over whole games, same script that produced
// WC's. 95% CI half-widths run 0.007 at the working stops to 0.034 at the 99th.
//
// ⚠ A GROSS-BASIS TABLE FOR PROPERTY WAS OFFERED AND REJECTED, and the reason
// is the whole point of deriving this one. That candidate curve (crossing
// 65.5%, median 0.7774, CV 0.809) was checked against four candidate bases on
// this engine and reproduces `grossUltimateLoss / grossExpectedLoss` to within
// 2.0% at every stop — matching its mean (1.0053 v 1.0009), CV (0.805 v 0.809),
// median (0.7808 v 0.7774) and skew (1.287 v 1.288). It is a GROSS curve.
// Property funds NET, so installing it would have re-created the very basis
// error a derived table exists to remove, just with different numbers than
// FUNDING_CLF_TABLE's. The net distribution is far tighter — CV 0.434 against
// 0.809 — because the occurrence layer removes the top of every large claim,
// and that is exactly the difference a net-basis table has to capture.
//
// CROSSING 54.0% (95% CI 53.4-54.8), stationary across the ten years (52-55%).
// So "Expected" on Property is a ~54% stop, not the 60% the generic
// FUNDING_CLF_TABLE labelled it — the -5.7pp mislabelling measured in
// scripts/diagnostics/property-clf-basis-report.ts, now corrected at source.
//
// CONVERGENCE: the second pass, with this table installed, is BYTE-IDENTICAL to
// the first at every stop, CI and crossing. That is the outcome the derive-twice
// note above PREDICTS rather than a lucky result — a3d7760 moved the pre-game
// band onto premium, cutting the 90%-stop-to-opening-surplus loop, and at all
// defaults fundingAtExpected pins the CLF to 1.000 so the derivation never
// consults the table it is deriving. Property is the first line derived entirely
// after that link was cut, which is why it converges in one pass where WC moved
// 49.9% -> 47.2%.
//
// VALIDATED OUT OF SAMPLE, which the derivation alone cannot do: a derived table
// is by construction the percentiles of its own sample. property-clf-basis-report
// draws a different population and finds every labelled stop within 0.9pp of
// what it delivers, +0.1pp at the default.
const PROPERTY_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.4808, 0.5551, 0.6224, 0.6820, 0.7387, 0.7903, 0.8463, 0.8994, 0.9542, 1.0108,
    1.0688, 1.1339, 1.1998, 1.2754, 1.3594, 1.4608, 1.5923, 1.8043, 2.0037, 2.2466,
  ],
};

// WHAT THE ENGINE ACTUALLY READS.
export const STATIC_CLF_TABLE: Record<StaticClfLine, ClfTable> = {
  WC: WC_DERIVED,
  GL: GL_SUPPLIED,
  Property: PROPERTY_DERIVED,
};

// ⚠ ALL THREE LINES NOW HAVE A TABLE, so this is true universally and
// FUNDING_CLF_TABLE has no line left reading it for PRICING. It is still read
// for the catastrophe threshold (simulationEngine's
// catastropheThresholdConfidence lookup), which is a different use and not a
// per-line funding curve — so the generic table is not dead, just no longer a
// pricing fallback. Kept as a real predicate for the same reason
// hasTractableCeded is.
export const hasStaticClf = (line: CoverageLine): line is StaticClfLine =>
  line === 'WC' || line === 'GL' || line === 'Property';

// CLF at a requested confidence level (0-1), linearly interpolated between the
// LINE'S OWN stops and clamped to that line's range.
export function clfFromTable(table: ClfTable, confidenceLevel: number): number {
  const { stops, clf } = table;
  const target = confidenceLevel * 100;
  const last = stops.length - 1;
  if (target <= stops[0]) return clf[0];
  if (target >= stops[last]) return clf[last];
  for (let i = 0; i < last; i++) {
    const a = stops[i], b = stops[i + 1];
    if (target >= a && target <= b) {
      const w = b === a ? 0 : (target - a) / (b - a);
      return clf[i] + w * (clf[i + 1] - clf[i]);
    }
  }
  return clf[last];
}

export function staticClf(line: StaticClfLine, confidenceLevel: number): number {
  return clfFromTable(STATIC_CLF_TABLE[line], confidenceLevel);
}

// The percentile at which a table crosses 1.000 — what "Expected" delivers.
//
// DERIVED FROM THE TABLE, never stored alongside it, so the two cannot drift.
// WC 44.1% (its own measured crossing, since its table is derived from that same
// sample); GL 57.7% on the supplied curve, against 70.9% on its derived one.
//
// ⚠ ON GL THIS IS NOW A DISPLAY FIGURE FOR A CURVE THAT IS NOT THE MODEL'S OWN.
// It correctly reports where the SUPPLIED table crosses, which is what the pool
// is actually being charged against; it is NOT where GL's real retained
// distribution crosses. Those differ by 13.2pp and the gap is recorded above.
//
// Returns a 0-1 fraction, clamped to the table's stop range.
export function crossingOf(table: ClfTable): number {
  const { stops, clf } = table;
  for (let i = 0; i < clf.length - 1; i++) {
    if (clf[i] <= 1 && clf[i + 1] >= 1) {
      const w = clf[i + 1] === clf[i] ? 0 : (1 - clf[i]) / (clf[i + 1] - clf[i]);
      return (stops[i] + w * (stops[i + 1] - stops[i])) / 100;
    }
  }
  return (clf[0] > 1 ? stops[0] : stops[clf.length - 1]) / 100;
}

export function staticClfCrossing(line: StaticClfLine): number {
  return crossingOf(STATIC_CLF_TABLE[line]);
}
