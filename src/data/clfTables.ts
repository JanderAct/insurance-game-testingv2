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
// paydown timing since GL has no IBNR). Choosing the ultimate basis would have
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
// THE MEASURED CROSSING of the DERIVED curves — where the ratio reaches 1.000,
// i.e. what "Expected" (CLF exactly 1.000) delivers against each line's own
// distribution:
//
//     WC 47.2%  (95% CI 46.6-47.8)      GL 68.6%  (95% CI 68.1-69.1)
//
// ⚠ GL's SHIPPED crossing is 57.7%, not 68.6%, because the supplied curve is in
// force. 68.6% remains the truth about GL's distribution; 57.7% is what the
// supplied curve reports. See GL_SUPPLIED.
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
// landing at 68.6%. That is structural rather than an error: GL retains 8.0% of
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
// with it, and runPriorHistory's reject-and-redraw accepts a pre-game only if
// the opening surplus lands inside OPENING_MULTIPLE_BAND x that margin. So a
// first-pass table measured under the old grids sits in an engine with
// different opening surplus than the one it was derived from.
//
// Measured rather than assumed, and iterated until it stopped moving:
//
//   pass 1 (derived under the retired grids)   WC 49.9%   GL 68.8%
//   pass 2 (derived with pass 1 installed)     WC 47.2%   GL 68.6%   <- SHIPPED
//   pass 3 (derived with pass 2 installed)     WC 47.2%   GL 68.6%   converged
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

export type StaticClfLine = 'WC' | 'GL';

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
    0.7106, 0.7644, 0.8098, 0.8481, 0.8855, 0.9198, 0.9523, 0.9846, 1.0184, 1.0514,
    1.0854, 1.1226, 1.1610, 1.2036, 1.2519, 1.3108, 1.3893, 1.5082, 1.6130, 1.7790,
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
// GL line-years against GL's own 99th percentile of 5.60, so on this curve
// NEAR-CERTAINTY IS NOT PURCHASABLE at any slider position — the most a player
// can buy is about the 94th percentile of the real retained distribution.
//
// THE CROSSING MOVES 68.6% -> 57.7% AS DISPLAYED, and the difference is BOOK
// SIZE. Note what does NOT move: "Expected" still covers 68.1% of GL line-years
// in measurement, because it bypasses the table entirely. So the displayed
// figure now UNDERSTATES GL's real coverage at Expected by 10.4pp. GL's
// derived curve crosses at 68.6% because a 62-member pool's retained loss is
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
// Crosses at 68.6%. Its 97.5 and 99 stops (3.5440, 5.6018) are imprecise and
// that is the distribution rather than the sample: GL's retained tail carries
// the unhedgeable above-tower band, so its upper percentiles are genuinely
// unstable (95% CI half-width +/-0.19 at the 97.5th against WC's +/-0.011).
//
// EXPORTED, and it has a real consumer: gl-supplied-clf-check.ts measures the
// supplied curve against it. That keeps it type-checked and honest rather than
// rotting in a comment.
export const GL_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.5397, 0.5924, 0.6385, 0.6778, 0.7139, 0.7492, 0.7812, 0.8161, 0.8509, 0.8874,
    0.9264, 0.9672, 1.0136, 1.0667, 1.1331, 1.2222, 1.3642, 1.8897, 3.5440, 5.6018,
  ],
};

// WHAT THE ENGINE ACTUALLY READS.
export const STATIC_CLF_TABLE: Record<StaticClfLine, ClfTable> = {
  WC: WC_DERIVED,
  GL: GL_SUPPLIED,
};

export const hasStaticClf = (line: CoverageLine): line is StaticClfLine =>
  line === 'WC' || line === 'GL';

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
// WC 47.2% (its own measured crossing, since its table is derived from that same
// sample); GL 57.7% on the supplied curve, against 68.6% on its derived one.
//
// ⚠ ON GL THIS IS NOW A DISPLAY FIGURE FOR A CURVE THAT IS NOT THE MODEL'S OWN.
// It correctly reports where the SUPPLIED table crosses, which is what the pool
// is actually being charged against; it is NOT where GL's real retained
// distribution crosses. Those differ by 10.9pp and the gap is recorded above.
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
