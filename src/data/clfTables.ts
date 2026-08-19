// STATIC CLF TABLES for WC and GL — measured from the engine, not modelled.
//
// CLF(p) is the multiplier applied to the pool premium so that the funded
// amount covers the year's retained loss p% of the time.
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
// THE MEASURED CROSSING — where the ratio reaches 1.000, i.e. what "Expected"
// (CLF exactly 1.000) actually delivers:
//
//     WC 47.2%  (95% CI 46.6-47.8)      GL 68.6%  (95% CI 68.1-69.1)
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

// Percentile stops, ascending. 5-point intervals from 10 to 95, then the two
// tail stops. The funding slider's own range (0.30-0.95, step 0.05) lands
// exactly on stops, so the interpolation below is a safety net rather than the
// normal path.
export const CLF_TABLE_STOPS = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99,
] as const;

export type StaticClfLine = 'WC' | 'GL';

// Index-aligned to CLF_TABLE_STOPS.
//
// ⚠ GL's TOP TWO STOPS ARE IMPRECISE AND THAT IS THE DISTRIBUTION, NOT THE
// SAMPLE. At 30,000 line-years the 95% CI half-width is +/-0.0085 on WC's 95th
// stop but +/-0.0815 on GL's, +/-0.19 at GL's 97.5th. GL's retained tail carries
// the above-tower band, so its upper percentiles are genuinely unstable; more
// draws narrow them slowly. Treat GL's 97.5 and 99 stops as indicative.
export const STATIC_CLF_TABLE: Record<StaticClfLine, number[]> = {
  WC: [
    0.7106, 0.7644, 0.8098, 0.8481, 0.8855, 0.9198, 0.9523, 0.9846, 1.0184, 1.0514,
    1.0854, 1.1226, 1.1610, 1.2036, 1.2519, 1.3108, 1.3893, 1.5082, 1.6130, 1.7790,
  ],
  GL: [
    0.5397, 0.5924, 0.6385, 0.6778, 0.7139, 0.7492, 0.7812, 0.8161, 0.8509, 0.8874,
    0.9264, 0.9672, 1.0136, 1.0667, 1.1331, 1.2222, 1.3642, 1.8897, 3.5440, 5.6018,
  ],
};

export const hasStaticClf = (line: CoverageLine): line is StaticClfLine =>
  line === 'WC' || line === 'GL';

// CLF at a requested confidence level (0-1), linearly interpolated between
// stops and clamped to the table's own range.
export function staticClf(line: StaticClfLine, confidenceLevel: number): number {
  const table = STATIC_CLF_TABLE[line];
  const target = confidenceLevel * 100;
  if (target <= CLF_TABLE_STOPS[0]) return table[0];
  const last = CLF_TABLE_STOPS.length - 1;
  if (target >= CLF_TABLE_STOPS[last]) return table[last];
  for (let i = 0; i < last; i++) {
    const a = CLF_TABLE_STOPS[i], b = CLF_TABLE_STOPS[i + 1];
    if (target >= a && target <= b) {
      const w = b === a ? 0 : (target - a) / (b - a);
      return table[i] + w * (table[i + 1] - table[i]);
    }
  }
  return table[last];
}

// The percentile at which the table crosses 1.000 — what "Expected" delivers.
//
// DERIVED FROM THE TABLE, never stored alongside it, so the two cannot drift.
// This is the same property the retired grid's crossing functions had, and it
// reproduces the directly measured crossings (WC 47.2%, GL 68.6%) because the
// table and the crossing come from one sample.
//
// Returns a 0-1 fraction, clamped to the table's stop range.
export function staticClfCrossing(line: StaticClfLine): number {
  const table = STATIC_CLF_TABLE[line];
  for (let i = 0; i < table.length - 1; i++) {
    if (table[i] <= 1 && table[i + 1] >= 1) {
      const w = table[i + 1] === table[i] ? 0 : (1 - table[i]) / (table[i + 1] - table[i]);
      return (CLF_TABLE_STOPS[i] + w * (CLF_TABLE_STOPS[i + 1] - CLF_TABLE_STOPS[i])) / 100;
    }
  }
  return (table[0] > 1 ? CLF_TABLE_STOPS[0] : CLF_TABLE_STOPS[table.length - 1]) / 100;
}
