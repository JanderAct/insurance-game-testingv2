// STATIC CLF TABLES for WC, GL and Property.
//
// CLF(p) is the multiplier applied to the pool premium so that the funded
// amount covers the year's retained loss p% of the time.
//
// ============================================================================
// ⚠ READ THIS FIRST: THE THREE LINES DO NOT COME FROM THE SAME PLACE.
//
//   WC        DERIVED  — backtested on this engine. Everything in the derivation
//                        note below applies to it, and its stop labels mean what
//                        they say against WC's own retained distribution.
//   Property  DERIVED  — the same, on the net basis. Added after this block was
//                        first written, which is why it used to say "two lines".
//   GL        SUPPLIED — a real pool's measured curve at a scale this model does
//                        not have. It is IN FORCE for GL, it does NOT describe
//                        GL's own distribution, and it over-delivers by about
//                        15pp through the middle of the working range while
//                        UNDER-delivering by up to 18pp at the bottom of it.
//                        See GL_SUPPLIED below
//                        for the measured cost; GL's own derived curve is kept
//                        beside it as GL_DERIVED.
//
// The derivation note that follows describes how the DERIVED tables were made.
// It is the provenance of WC's and Property's shipped curves and of GL_DERIVED —
// NOT of the GL curve the engine actually reads.
//
// ============================================================================
// HOW THESE WERE DERIVED, AND WHY IT IS A BACKTEST.
//
// The engine is run over many games and years, and for every line-year the
// realised retained loss is divided by the retained loss that was funded:
//
//     ratio = netIncurredLoss / poolPremium
//
// The percentiles of that ratio ARE this table. See
// scripts/diagnostics/clf-table-derive.ts.
//
// ⚠ THE SAMPLE IS DESCRIBED AT EACH TABLE, NOT HERE, BECAUSE IT DIFFERS BY LINE.
// This block used to say "3,000 games x 10 years per line, at ALL-DEFAULT
// decisions, each line SOLO". Solo is still true and still deliberate — inter-line
// loans cannot then couple two lines' derivations, at a cost measured in the
// script's POOLED note. All-defaults is no longer true: the tables are now drawn
// from FOUR new-business appetite arms, because the appetite control is what
// moves the enrolled book, and a table meant to hold across the book's range has
// to be fitted across it. Each table's own header gives its games, arms, band and
// line-year count.
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
// ⚠ NO CIRCULARITY, AND THE APPETITE ARMS DO NOT WEAKEN IT. fundingAtExpected
// pins CLF to exactly 1.000 and no table is consulted, so the derivation run does
// not depend on its own output. The arms vary newBusinessAppetite only; not one
// of them touches the funding flag, so the pin holds on every line-year in the
// sample, not just the default ones.
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
//   NO BOOK-SIZE DIMENSION, AND THE REASON IS NO LONGER "THE BOOK HOLDS STILL".
//   This block used to say the size axis bought little because the book held
//   near 62 members. There is no equilibrium now — the target came out, and the
//   book is an outcome that runs roughly 76 -> 92 enrolled at defaults, reaches
//   97 on Accept All and settles near 64 at the strict appetite bar. One curve
//   was kept anyway, deliberately: a size axis makes the rate move as the book
//   moves, which is a second feedback between membership and pricing on top of
//   the ones already in the engine, and the measured cost of going without one is
//   small. THE RULE IS: each line is derived at the band that CONTAINS ITS OWN
//   MEDIAN BOOK, measured on the played game. WC and GL land in the 72-88 band,
//   Property — whose book runs about eleven members higher — lands in the 88+
//   one. See each table's own note.
//
//   ⚠ WHAT THE SINGLE CURVE COSTS, MEASURED RATHER THAN ASSERTED. Deriving at
//   the small, middle and large bands and backtesting each against all three
//   gives the worst label error across the range:
//
//       derived at      WC       GL      Property
//       small ~64     +4.5     +6.5        -9.7
//       mid ~80       -2.7     -4.4        +4.6
//       large ~97     -4.2     -6.3       +10.2
//
//   ⚠ READ THAT TABLE WITH ITS OWN LIMITATION IN VIEW, WHICH IS THAT THE THREE
//   COLUMNS ARE NOT WEIGHTED BY WHERE EACH LINE ACTUALLY SITS. It says the middle
//   is the only row inside 5pp on every line, and that was the first decision
//   taken here. It held for WC and GL and did NOT hold for Property, because
//   Property spends 63% of its line-years in the large band and only 26% in the
//   middle one: a mid-band Property table reads -5.2pp and -7.9pp on those two,
//   i.e. outside tolerance on 89% of the line's own exposure, while scoring +4.6
//   in the unweighted row above. The per-line median-book rule replaced it.
//
//   Deriving at the top was the stated instinct — a factor slightly light on a
//   small book being safer than one heavy on a large one. On WC and GL that
//   instinct costs 4-6pp against the middle's 2-4pp and was not taken. On
//   Property the same instinct IS the answer, for a reason the instinct did not
//   name: not safety, but that the top is where Property's book lives.
//
//   ⚠ AND BOOK SIZE ENTERS AS SHAPE, NOT LEVEL, WHICH BOUNDS HOW BIG THIS CAN
//   EVER BE. The CLF is loss over PREMIUM, and premium scales with the book, so
//   a bigger pool cannot move the curve by being bigger — only by having a
//   differently shaped ratio distribution. Measured, the 50% stop moves 1.6% on
//   WC and 1.9% on GL between a 65-member and a 92-member book. Anyone reasoning
//   that a 1.5x book needs a 1.5x-different factor is reasoning about a level
//   effect that the ratio has already divided out.
//
// ⚠ RE-DERIVE THIS TABLE if DEFAULT_LAYERS_PLACED changes, if the funding basis
// changes again, if the MEMBERSHIP TRAJECTORY moves materially — the band it is
// derived at, not an equilibrium, since there is no longer one — or if any loss
// model is re-fitted. It is a measurement of the engine, so any change to the
// engine's loss or pricing path invalidates it.
//
// ============================================================================
// ⚠ THAT TRIGGER FIRED, AND THE RE-DERIVATION WAS MEASURED AND DECLINED. READ
// THIS BEFORE RUNNING clf-table-derive ON THE STRENGTH OF THE RULE ABOVE.
//
// Three commits moved the membership trajectory hard: voluntary departures off,
// the pre-game roster frozen, and No New Business as the default appetite. The
// median book was ~140 at the worst of it and the rule said to re-derive.
//
// ⚠ BUT THE RULE NO LONGER SELECTS A UNIQUE BAND, WHICH IS THE ACTUAL FINDING.
// "The band containing its own median book" assumed ONE trajectory. There are
// now two, and they BRACKET the band these tables are derived at:
//
//     arm                        WC median   GL median   Property median   band
//     defaults (frozen book)        61.5        65.0          66.0        SMALL
//     Open appetite                110.0       112.0         113.0        LARGE
//
// A player who touches nothing sits in SMALL for the whole game; a player who
// opens the bar runs to LARGE. No single curve per line can be derived at "the"
// median because there is no longer one median.
//
// ⚠ AND THE SHIPPED TABLES ARE ALREADY AT OR NEAR THE BEST COMPROMISE, WHICH IS
// WHY NOTHING IS RE-DERIVED. Worst label error per band, each line on the basis
// it is actually gated against (clf-label-backtest-check, 40 games x 4 arms x
// 22 years):
//
//     line (basis)            small ~64    mid ~80    large ~97    derived at
//     WC (calendar)              -4.0        +7.6       +13.0         mid
//     GL (accident-year)        -12.4       -10.1        -8.0         mid
//     Property (calendar)       +20.7 *      -3.1        +3.8         large
//                                             * 223 observations, thin, not gated
//
// ⚠ WC READS BEST AT THE NEW DEFAULT BOOK, NOT WORST, AND THAT INVERTS THE
// OBVIOUS EXPECTATION. Its worst error at the small band is -4.0pp against
// +13.0pp at large. Re-deriving WC onto the default trajectory would improve a
// figure that is already the best of the three and WORSEN the arm that is
// currently failing. Deriving it onto the LARGE band — where the live residual
// is — would hurt the player who touches nothing, who is now the modal player.
//
// GL is monotone the other way (best at large) and its own standing residual is
// at the 30% stop, not at a band. Property is best at mid and large and worst at
// small, but its small band is 223 observations and explicitly not gated.
//
// SO EVERY AVAILABLE RE-DERIVATION TRADES ONE PLAYER'S ACCURACY FOR ANOTHER'S,
// and the file's own measured cost of a single curve — recorded above as
// "derived at small / mid / large" — is exactly this trade seen from the other
// side. The honest answer is that a single curve per line cannot serve a
// trajectory that now spans 62 to 113 members, and the fix is the BOOK-SIZE AXIS
// this file considered and rejected, not a different single curve.
//
// ⚠ WHAT WOULD CHANGE THIS RULING: a decision that one trajectory is the one to
// serve. If the frozen default is what the game is for, derive all three at
// SMALL and accept the active player's error. That is a design call, not a
// measurement, and it is not taken here.
// ============================================================================
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
// distribution. AT THE MID BAND, which is where they are now derived:
//
//     WC 48.8%      GL 65.7%      Property 52.8%
//
// ⚠ ALL THREE MOVED AT THE RE-DERIVATION — WC 54.7% -> 48.8%, GL 70.9% -> 65.7%,
// Property 54.0% -> 52.8% — and the two that fell most did so because the curve
// TIGHTENED rather than because the book got worse. A narrower distribution puts
// more of its mass near the mean, so the percentile at which the ratio reaches
// 1.000 moves toward the median from wherever the skew had pushed it. WC and GL
// were both right-skewed by the small-book line-years that are now gone.
//
// The figures below are the PREVIOUS measurements, kept because the reasoning
// that follows them is still the reasoning, and a reader who finds 54.7% quoted
// in another file needs to be able to place it.
//
// ⚠ GL AND PROPERTY WERE MEASURED ON THIS BRANCH TOO AND ARE NOT RE-DERIVED.
// IBNER changes every line's development, so "WC needs re-deriving" is not by
// itself a reason to leave the other two alone — they were measured rather than
// assumed:
//
//   line       table crosses at   measured with IBNER live   inside the table's CI?
//   WC              50.4%            54.7% [54.0, 55.3]        NO — re-derived here
//   GL_DERIVED      70.9%            70.6% [69.9, 71.3]        yes — left alone
//   Property        54.05%           55.0% [54.3, 55.7]        MARGINAL — see below
//
// GL is clear: 70.6% sits inside [70.2, 71.5] and the two intervals overlap
// almost entirely. GL's SHIPPED table is GL_SUPPLIED in any case, which no
// derivation touches.
//
// ⚠ PROPERTY IS THE MARGINAL CALL AND IT IS DELIBERATELY LEFT FOR ITS OWN
// COMMIT. Its point estimate 55.0% sits 0.2pp above the upper bound of its
// table's recorded CI (53.4-54.8), which is the stated trigger for
// re-deriving — but the two intervals OVERLAP across [54.3, 54.8], so the
// evidence that anything really moved is weak. Property has the smallest IBNER
// scale (0.15) and the shortest horizon (2-4), so it is the line IBNER should
// move least, and a 0.95pp shift is consistent with that. Re-deriving it here
// would put two calibrations in one commit and make a later movement
// unattributable to either. If it is re-derived, the literal measured on this
// branch is:
//
//   Property: [0.4590, 0.5384, 0.6053, 0.6686, 0.7276, 0.7826, 0.8372, 0.8901,
//              0.9460, 1.0003, 1.0631, 1.1252, 1.1934, 1.2690, 1.3557, 1.4648,
//              1.6068, 1.8285, 2.0322, 2.3091]
//
// ⚠ WC REACHED 50% WHEN IT STOPPED UNDERCHARGING, and that is the headline for
// every WC figure measured before it. The sequence, all re-derived rather than
// inferred:
//
//   44.1%   with region in severity and one blended pure premium
//   43.2%   region out of severity — NOT a move, the same number re-measured
//           (intervals [43.4, 45.0] and [42.4, 44.1] overlap across most of
//           their width; losses and premium both rose 0.30%, so the ratio this
//           is a percentile of barely shifted)
//   50.4%   four held class rates
//   54.7%   re-derived with IBNER live (this table)
//
// ⚠ THE LAST STEP IS NOT A PRICING CHANGE. WC's premium is identical either
// side of it. The table this branch carried had been derived on
// claims-distribution, where reserve development is the retired uniform wobble;
// IBNER is a different distribution, and a table measured against one engine was
// pricing for another. Re-deriving on the branch's own distribution is the table
// catching up, not the line being re-rated.
//
// ⚠ AND THE MEAN RATIO IS 1.0003. WC is funded at its own expectation to three
// decimal places, and the crossing sits above 50% because the ratio distribution
// is RIGHT-SKEWED — which a compound-Poisson line must be. A right-skewed
// variable with mean 1 has its median below 1 (0.9709 here), so more than half
// of line-years come in under the funded amount. That is the correct shape, and
// WC has not had it before: the sub-50% readings that prompted the whole
// investigation were a funding gap, not a distributional artefact.
//
// ⚠ IT ALSO LANDS ON THE REAL-POOL BENCHMARK recorded below — real public-entity
// pools put the mean year near the 55th percentile, and WC was "about 3pp under
// that". 54.7% incurred, 53.7% ultimate. Not aimed at, and worth not disturbing
// casually.
//
// The +7.2pp is one thing: WC was charging the market's average rate to books
// that were not the market. The median line-year's drawn/funded ratio is now
// 0.9979 — a hair under break-even, where it should sit — against 1.0402 before.
//
// ⚠ THIS IS AN ACROSS-THE-BOARD INCREASE, NOT A REDISTRIBUTION. The median
// enrolled book's blended rate lands 2.3% ABOVE the old single rate, not around
// it, because the books that actually enrol are worse than the full-market
// average. Every WC measurement taken before this — loss ratios, surplus paths,
// crossing percentiles, anything calibrated for playability — was taken against
// a line that undercharged, and none of them transfer.
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
// ⚠ GL's SHIPPED crossing is 57.7%, not its derived one, because the supplied
// curve is in force — and the supplied curve did NOT move, so GL's shipped
// pricing is unchanged by the trending ceiling. The derived figure was 70.9%
// when this was written and is 65.7% after the mid-band re-derivation; either
// way it is the truth about GL's distribution and 57.7% is what the supplied
// curve reports. See GL_SUPPLIED.
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
// WC — DERIVED from this engine, at the MID BAND of the membership trajectory.
//
// 7,345 line-years falling in the 72-88 member band, drawn from 16,000 across
// 1,600 solo games and FOUR new-business appetite arms, via
// scripts/diagnostics/clf-table-derive.ts (BAND_DERIVE=1 GAMES=400). Enrolled
// book within the band: p10 73, median 79, p90 86. CROSSING 48.8%.
//
// 95% CI half-widths (block bootstrap over whole games) run 0.0042 at the 35th
// stop to 0.0312 at the 99th — tighter through the working range than the
// 30,000-line-year table this replaces, because the sample is less dispersed
// rather than because it is bigger.
//
// ⚠ IT REPLACES A TABLE THAT WAS TOO WIDE, AND BOOK SIZE IS NOT THE WHOLE
// REASON. The previous curve ran 0.6698 to 1.9329; this one runs 0.7913 to
// 1.6030. Re-deriving at a book of 65 — essentially the 62 the old header
// claimed — still gives 0.7903 at the 10th stop, so the old curve's fat lower
// tail is not a size effect at all. It is the DELETED EQUILIBRIUM: the old
// sample was drawn while the book still drifted toward 20 members, and a
// twenty-member pool's loss ratio swings in both directions hard enough to widen
// every percentile. The membership rewrite removed those line-years from the
// population, which is exactly the trigger this file's own re-derivation note
// names.
// ============================================================================
// ⚠ THIS TABLE IS ON THE CALENDAR-YEAR BASIS AND STAYS THERE. RULED.
//
// clf-label-backtest-check measures ACCIDENT-YEAR ultimate as well — did this
// year's claims come in under this year's premium, which is what the funding
// slider's label promises. This curve is percentiles of netIncurredLoss /
// poolPremium, a CALENDAR year, which blends every open accident year at a
// different maturity. It reads -7.0 / -11.0 / -7.5 on the accident-year basis
// and -7.2 / -2.2 / -1.2 on the calendar basis it was built on, and THE GATE
// SCORES IT ON THE LATTER — each line is gated on its own basis, so this curve's
// red is a real residual rather than a definitional one.
//
// ⚠ ITS REMAINING RED IS A BOOK-SIZE LEVEL EFFECT, not a mis-shaped curve. The
// calendar mean ratio runs 1.042 / 1.035 / 1.025 across small / mid / large and
// the worst error tracks it at -7.2 / -2.2 / -1.2: a small book runs a 1.7%
// higher loss ratio, so fewer of its years fall under the low stops. A single
// curve with no book-size axis cannot carry that, which is the cost this file
// already records for shipping one curve per line.
//
// RE-DERIVING WAS COSTED AND DECLINED. It would raise every off-Expected stop by
// 3.2% to 6.0%, and only 16.4% of WC accident years written in a ten-year game
// reach their own runoff horizon before the game ends — WC's horizon is drawn on
// [5, 12]. So a WC curve on settled ultimate charges for cost the player never
// sees land in their own P&L in five games out of six. GL 45.3% and Property
// 71.0% do not have that problem to the same degree.
//
// ⚠ DO NOT READ THE GATE'S WC RED AS A REASON TO RE-DERIVE. Keeping this table
// is the ruling; the -7.2pp that remains is a size effect on its own basis, and
// the EXPECTED_RED entry in scripts/gates.ts separates the two.
// ============================================================================
// ⚠ RE-DERIVED AT THE SMALL BAND. THE DEFAULT GAME IS THE ONE THE LABEL IS NOW
// HONEST FOR, AND TWO OTHER BANDS PAY FOR IT. READ THE COST BEFORE MOVING IT.
//
// The shipped default writes no new business on a frozen pre-game roster, so a
// player who touches nothing plays a book frozen at its opening ~62 for the
// whole game. This table is derived on 6,371 line-years of that band (p10 53,
// median 63, p90 70), crossing 43.0%, across 2,000 games and FIVE appetite arms
// — the fifth being NO_NEW_BUSINESS, added to clf-table-derive and
// clf-label-backtest-check together at 2cf25b1.
//
// ⚠ THE COST, MEASURED RATHER THAN ESTIMATED. The derivation's own candidate
// matrix, worst label error in pp per band:
//
//     derived at      small ~64   mid ~80   large ~97   POOLED
//     small (SHIPPED)      +0.0      +7.7      +19.9      +9.9
//     mid  (previous)      -7.9      +0.0      +12.5      +2.2
//     large                -20.1    -12.6       +0.0     -10.2
//
// ⚠ THE MID BAND WAS EXACT AND IS NOW OUT OF TOLERANCE, WHICH THE RULING DID NOT
// ANTICIPATE AND WHICH IS RECORDED HERE BECAUSE IT IS THE PART A READER WOULD
// OTHERWISE INFER WRONGLY. This is not error moved from one end to the other: WC
// goes from ONE band outside the 5pp tolerance to TWO. Pooled worst goes +2.2 ->
// +9.9, four and a half times worse.
//
// ⚠ AND POOLED IS DELIBERATELY NOT THE SCORECARD, WHICH IS THE WHOLE RULING.
// The band weights (small 32%, mid 30%, large 38%) come from the five sampled
// arms, and four of those five are settings a player must deliberately opt into.
// They are a SAMPLING choice, not a statement about how the game is played. If
// most sessions run at defaults then the small band carries far more than 32% of
// real exposure and the pooled figure understates the gain. That is a judgement
// about play rather than about the engine, and it was taken explicitly.
//
// WHAT WOULD OVERTURN THIS: evidence that players routinely open the appetite
// bar, which would make mid and large the populations that matter and put this
// table back at mid. Or a BOOK-SIZE AXIS, which is the only thing that serves
// all three bands at once and which this file considered and rejected — see the
// single-curve cost recorded above.
// ============================================================================
export const WC_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.8061, 0.8454, 0.8829, 0.9122, 0.9399, 0.9643, 0.9858, 1.0101, 1.0327, 1.0576,
    1.0834, 1.1093, 1.1396, 1.1716, 1.2081, 1.2550, 1.3120, 1.4124, 1.4962, 1.6152,
  ],
};

// ============================================================================
// WC — SUPPLIED, NOT DERIVED. THIS IS THE ONE IN FORCE.
//
// A real public-entity pool's measured percentile curve, supplied over the 45-95
// range. It REPLACES WC's own derived table, which stays above as WC_DERIVED and
// out of force exactly as GL_DERIVED does — the honest description of this
// model's own book, kept so the residual stays measurable rather than invisible.
//
// ⚠ THE MEASURED PART IS VERBATIM AND IS WRITTEN AT THREE DECIMALS SO THE JOIN IS
// VISIBLE IN THE SOURCE. Stops 45 through 95 are the supplied numbers unchanged.
// Stops 10 through 40 are extrapolated and carry four decimals. Anything at four
// decimals below 45 is this file's arithmetic, not the pool's measurement.
//
// ============================================================================
// THE FORM, AND THE RULING'S PREMISE ABOUT IT WAS CHECKED AND IS WRONG
// ============================================================================
//
// The extension was ordered "from the curve's own implied CV, which runs 0.24 at
// the bottom to 0.40 at 95% — rising, so a flat extension would understate the
// tail." The rise is arithmetically real and the conclusion does not follow.
//
// ⚠ THE CURVE IS A LOGNORMAL WITH FLAT VOLATILITY, TO FOUR DECIMALS. Fitting
// ln CLF = a + sigma z by least squares over all eleven supplied stops:
//
//     sigma 0.34169    a -0.04963    R^2 0.999897
//     worst absolute error at any supplied stop: 0.0053 CLF points
//
// and a mean-one lognormal would carry a = -sigma^2/2 = -0.05837, so the curve's
// implied mean is 1.00878 — it is normalised to 1 within 0.9%. The local
// volatility d(ln CLF)/dz between adjacent stops reads
//
//     0.351  0.352  0.347  0.350  0.342  0.347  0.339  0.340  0.332  0.336
//
// which is flat, and whose OLS slope against z is -0.0128 +/- 0.0021 —
// SIGNIFICANT, and NEGATIVE. The curve is slightly THINNER-tailed than lognormal
// at the top, not fatter.
//
// ⚠ WHAT RISES IS THE READING, NOT THE CURVE. The 0.24-to-0.40 figure comes from
// (CLF(p) - 1) / z_p, which reads the curve as mean 1 plus z standard deviations.
// That quantity rises for ANY right-skewed mean-one distribution, because the
// mean sits above the median, and a PURE constant-sigma lognormal at the fitted
// sigma reproduces it nearly stop for stop:
//
//     stop      actual (CLF-1)/z      pure lognormal at sigma 0.34169
//       65            0.2258                     0.2218
//       75            0.2980                     0.2939
//       85            0.3454                     0.3434
//       95            0.4037                     0.4069
//
// So a flat-sigma extension does not understate the tail; it REGENERATES that
// rise on its own. The reading is also only defined away from the crossing: at
// the 45% stop it gives 0.72, at 50% it is undefined, and at 55% it is negative.
// The 0.24 in the ruling corresponds to roughly the 65-67% stop, not to the
// bottom of the supplied range.
//
// ============================================================================
// THE EXTENSION
// ============================================================================
//
// FORM: lognormal, because that is what the curve measurably is. ANCHORED at the
// measured 45% value rather than at the fitted line, so the join is continuous by
// construction and no measured stop is overwritten by a fit. CARRIED at the
// volatility measured over the LOWEST supplied span, 45-55, sigma 0.35168, rather
// than the global 0.34169 — because sigma declines with z, so the global value
// would understate the spread at the end being extended.
//
// Implied CV at every stop of the shipped table, both readings, so the extension
// is visibly continuous with the measured part:
//
//   stop     10     15     20     25     30     35     40     45     50     55
//   (CLF-1)/z  .308  .328   .349   .372   .400   .442   .517   .724    n/a  -.056
//   local sigma   -  .3517  .3517  .3510  .3524  .3516  .3515  .3515  .3511  .3523
//
//   stop     60     65     70     75     80     85     90     95
//   (CLF-1)/z  .150  .226   .267   .298   .322   .345   .369   .404
//   local sigma .3471 .3495  .3423  .3473  .3390  .3399  .3316  .3356
//
// The local-sigma row is the continuity that matters: 0.3510-0.3524 across every
// extrapolated interval against 0.3316-0.3523 across every measured one. There is
// no step at the join. The (CLF-1)/z row is discontinuous through the crossing
// and that is a property of the reading, not of the curve.
//
// ⚠ THE 97.5 AND 99 STOPS ARE KEPT, AND THE FIRST ANSWER HERE WAS WRONG. They
// were dropped on the ruling's invitation, on the argument that nothing can
// request them — SLIDER_RANGES.fundingConfidenceLevel is 0.30-0.95 and the only
// other request in the engine is reserveMarginCLF at 0.90, which is exactly GL's
// position. THAT ARGUMENT DOES NOT APPLY TO WC. WC does not read SLIDER_RANGES.
// It has its own WC_FUNDING_CONFIDENCE_RANGE, which is 0.10-0.99 with explicit
// stops at 0.975 and 0.99. Every stop in this table is reachable on WC, at both
// ends, and dropping the top two would have left two slider positions answered
// by a clamp that silently delivers the 95% value under a 99% label. That is a
// far larger error than any extrapolation here could make.
//
// The remaining objection stands and is answered rather than dismissed: the 99th
// stop is 38% of the measured span beyond the data, in the direction where sigma
// is provably declining, so a constant-sigma extension would be knowingly too
// heavy. So the top is carried at the volatility measured over the TOP supplied
// span, 85-95, sigma 0.33400 — the mirror of what the bottom does with the 45-55
// span. That uses what the trend says without extrapolating the trend itself.
// The choice barely matters: the global sigma would give 1.8532 and 2.1003
// against the 1.8487 and 2.0893 shipped, 0.2% and 0.5% apart.
//
// ⚠ AND THE BOTTOM EXTENSION WAS REQUIRED, NOT DESCRIPTIVE, FOR THE SAME REASON.
// The first version of this note called stops 10-25 unreachable and kept them
// only because the ruling asked for the full grid. WC's slider floor is 0.10, so
// all seven extrapolated stops are reachable and the supplied curve's 45 floor
// would have left SEVEN positions on a clamp. The extension is what the table
// needs to answer its own slider, which gl-supplied-clf-check now asserts against
// WC_FUNDING_CONFIDENCE_RANGE rather than against SLIDER_RANGES.
//
// ============================================================================
// WHAT THIS COSTS, MEASURED
// ============================================================================
//
// ⚠ THE COST IS MUCH LARGER THAN THE RULING EXPECTED AND THE NUMBER IS SAID
// PLAINLY HERE BECAUSE IT IS THE THING THAT WOULD OVERTURN THIS. The ruling put
// the curve at "15-20% heavier than the model's own losses justify at the top",
// from the 0.24-to-0.40 reading. On the definition this repo already uses for
// exactly this comparison — (clf75 - clf25) / 1.349 / clf50, the one that
// produces GL's recorded 0.3979 — the numbers are:
//
//     WC_SUPPLIED implied CV      0.3524
//     WC calendar-year CV         0.1975   <- the basis WC is gated on
//     WC_DERIVED implied CV       0.1862
//
// So the supplied curve is 78% heavier than this model's WC, not 15-20%, and the
// derived table it replaces described that distribution to within 6%. FOR SCALE,
// THIS IS NOT THE TRADE GL CARRIES: GL's supplied curve implies 0.3979 against
// GL's own 0.4168, a 5% gap, which is why GL's residual is as small as -9.4pp.
// WC's gap is an order of magnitude wider in relative terms and its residual is
// correspondingly worse. The measured per-band label error is recorded at
// clf-label-backtest-check's EXPECTED_RED entry.
//
// ⚠ AND THE CROSSING MOVES 12.9pp, NOT 7.9pp. The ruling put WC's model crossing
// at 48.6%; the shipped table crosses at 42.92%, because WC_DERIVED was
// re-derived at the SMALL band at 2cf25b1 and that moved it — gl-supplied-clf-check
// records that as the sixth move of a constant it holds as a literal. The supplied
// curve crosses at 55.78% on staticClf's own linear-in-stop interpolation. So the
// move is 42.9% -> 55.8%.
//
// ⚠ WHAT THAT CHANGES IS THE LABEL, NOT THE BEHAVIOUR, AND THE DIRECTION IS THE
// WRONG ONE. fundingAtExpected pins the multiplier at exactly 1.000, so how often
// a pool funding at Expected comes in under budget is a property of the MODEL and
// does not move at all. What moves is what the game TELLS the player Expected
// means. Today that label is right by construction: WC_DERIVED crosses where the
// model crosses because it was derived from that same sample. A supplied curve
// breaks that identity and leaves the label 12.9pp away from the distribution it
// describes. crossingOf already carries this warning for GL; it now applies to
// two lines out of three.
// ============================================================================
const WC_SUPPLIED: ClfTable = {
  source: 'supplied',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    // extrapolated below — lognormal at sigma 0.35168 (the 45-55 span),
    // anchored at the measured 45% stop
    0.6054, 0.6599, 0.7067, 0.7494, 0.7901, 0.8297, 0.8691,
    // supplied, verbatim
    0.909, 0.950, 0.993, 1.038, 1.087, 1.140, 1.201, 1.271, 1.358, 1.473, 1.664,
    // extrapolated above — lognormal at sigma 0.33400 (the 85-95 span),
    // anchored at the measured 95% stop
    1.8487, 2.0893,
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
// ⚠ IT DESCRIBES A BIGGER, SMOOTHER BOOK — and the CV comparison this block used
// to rest on was between two different statistics. Its implied annual CV is
// about 0.40; the 0.79 it was set against is GL's annual GROSS loss CV, not the
// loss-to-premium ratio this table is percentiles of. On the accident-year basis
// the labels promise, that ratio's CV is 0.4168 against the supplied 0.3979 —
// within 5%. The supplied curve describes this model's GL almost exactly, and
// the "bigger, smoother book" reading overstated a difference that is mostly a
// basis artefact. The measured error rows below are on the CALENDAR-year basis
// and are kept because the shape they show is what the artefact looks like.
//
// MEASURED CONSEQUENCE — this curve OVER-DELIVERS against GL's own distribution
// by up to 19pp through the middle of the working range and UNDER-delivers by
// up to 18pp at the bottom of it, because it is priced off a less volatile book
// than the one the engine draws. Measured, not predicted (see
// scripts/diagnostics/gl-supplied-clf-check.ts):
//
//     label      30%    40%    50%    60%    70%    80%    90%    95%
//     delivers  12.1%  30.8%  53.4%  74.6%  89.4%  97.1%  99.4%  99.9%
//     error    -17.9   -9.2   +3.4  +14.6  +19.4  +17.1   +9.4   +4.9
//
// ⚠ THOSE ARE NOT THE FIGURES THIS BLOCK CARRIED, AND THE MOVE IS THE MEMBERSHIP
// CHANGE RATHER THAN THE CURVE. The recorded row was 35.5 / 47.8 / 59.6 / 70.5 /
// 80.1 / 87.4 / 92.4 / 94.0, peaking at +10.5pp. GL_SUPPLIED itself has never
// been touched. What moved is the distribution it is being marked against: with
// the membership target gone, GL's own retained ratio distribution is far tighter
// (its 99th percentile went 6.53 -> 1.45), so a curve built for a bigger, smoother
// book now sits too WIDE at both ends rather than uniformly too high. The error
// changed shape, not just size — it is now strongly negative at the bottom of the
// range and strongly positive through the middle.
//
// Peak over-delivery is +19.4pp at the 70% stop, and the curve now UNDER-delivers
// badly at 30-40% where it used to over-deliver. Its top stop of 1.701 covers
// 99.9% of GL line-years against GL's own 99th percentile of 1.4523 — so the old
// note that NEAR-CERTAINTY IS NOT PURCHASABLE on this curve has RETIRED ITSELF.
// The opposite is now true: the top of the slider buys more than the distribution
// has to offer.
//
// THE CROSSING MOVES 65.7% -> 57.7% AS DISPLAYED, and the difference is BOOK
// SIZE. Note what does NOT move: "Expected" still covers 68.1% of GL line-years
// in measurement, because it bypasses the table entirely. (That 68.1% is a
// BACKTEST COVERAGE figure, not the crossing; re-measured at this commit it is
// 70.2%, so the displayed 57.7% understates GL's real coverage at Expected by
// 12.5pp. The crossing it is often confused with moved 68.6% -> 70.9% -> 65.7%;
// these are two different quantities and only one was re-derived.) So the
// displayed figure UNDERSTATES GL's real coverage at Expected. GL's derived curve crosses above the supplied one because a pool of
// this size has retained loss that is genuinely more volatile and more skewed
// than the pool the supplied curve came from; a skewed distribution has its
// median well below its mean, so funding at the mean covers more than half the
// years. The supplied curve, from a larger and smoother book, crosses much
// closer to the middle.
//
// ⚠ THE GAP NARROWED FROM 13.2pp TO 8.0pp AT THE RE-DERIVATION, AND NOT BECAUSE
// ANYTHING WAS AIMED AT IT. Deriving at a 72-88 member book instead of a sample
// that still contained the drift toward 20 removed most of the skew that put
// GL's derived crossing at 70.9%. The supplied curve is unchanged, so the whole
// move is on the derived side. The convergence is real and is evidence for the
// frequency argument below — a bigger, less lumpy book does move this model
// toward the supplied curve's shape — but 8.0pp is still a large gap and the
// supplied curve is still a placeholder.
//
// ⚠ RAISING GL'S FREQUENCY WAS NAMED HERE AS "THE REAL FIX" AND IT IS NOT ONE.
// The claim was that more claims per year at the same expected loss lowers the
// annual CV toward the supplied curve's 0.40. The arithmetic is right and the
// direction is wrong, for two reasons that were both measured:
//
//   THE GAP NEEDS CV TO RISE, NOT FALL. The statistic this table describes is
//   not the annual gross loss whose CV is 0.79. On the accident-year basis the
//   labels actually promise, GL's ratio CV is 0.4168 against the supplied
//   curve's implied 0.3979 — already a match. On the calendar-year basis the
//   derivation used, it is 0.1936, LESS THAN HALF the supplied curve. Frequency
//   only ever lowers CV, so it moves away from the target on either reading.
//
//   MEASURED ON THE ENGINE. Severity shrunk threefold with the rate re-derived
//   from the same external anchor — 11.6 claims per member-year against 5.5 —
//   moved GL's per-band error from -18.5 / -21.1 / -21.9 to -22.3 / -22.3 /
//   -24.2. Worse at every band. A Monte Carlo predicted an improvement and had
//   the sign wrong because it modelled the annual aggregate rather than the
//   statistic the gate reads.
//
// THERE WAS NEVER A GAP OF THE SIZE THIS BLOCK DESCRIBES. See the basis note at
// the head of clf-label-backtest-check.ts: the supplied curve describes accident
// years and the derivation measured calendar years, which blend up to eight open
// accident years at different ages and halve the spread. That is the whole 22pp.
// This table is not the fix because there is much less to fix than it says.
//
// RANGE: 25-95, narrower than the derived table's 10-99. No slider change was
// needed: SLIDER_RANGES.fundingConfidenceLevel is 0.30-0.95, and the only other
// request in the engine is reserveMarginCLF at 0.90, so every reachable request
// already falls inside 25-95. staticClf still clamps outside the range, but on
// GL that clamp is unreachable from any UI control.
// ============================================================================
// ⚠ AND IT STAYS. THE CASE AGAINST IT WAS THE GATE'S OWN BASIS, NOT THIS CURVE.
//
// Two routes away from this table were proposed on a 21.9pp label error that
// turned out to be an artefact — the gate scored this ACCIDENT-YEAR curve
// against a CALENDAR-YEAR statistic. On the corrected basis:
//
//   GL_SUPPLIED   -0.5 to +1.7pp from the 70% stop up, -8.8pp pooled worst
//   GL_DERIVED    -16.2pp pooled worst, and worst exactly in the margin-buying
//                 half where this curve is near-exact
//
// Its accident-year ratio CV is 0.4168 against this curve's implied 0.3979 —
// within 5%. The real-pool anchor describes this model's GL almost exactly, and
// installing the derived curve would have replaced the more accurate of the two
// with the less.
//
// ⚠ ONE RESIDUAL STANDS AND IT IS REAL. This curve carries a FATTER LOW TAIL
// than the model produces, so the bottom of the slider promises more
// under-funding than the book delivers: -11.6pp at the 30% stop on a large book,
// against -0.5 to +1.7pp from the 70% stop up. GL is gated on the accident-year
// basis, so that red is a genuine gap between this curve and the distribution it
// describes rather than a basis artefact. Entered in EXPECTED_RED; closing it
// needs a curve with a different low tail, not a re-derivation.
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
// GL's retained loss distribution actually does at the book the game produces,
// and anyone revisiting the supplied curve needs both to compare. Re-derived at
// the MID BAND alongside WC and Property: 7,680 line-years in the 72-88 member
// band of 16,000 across 1,600 games and four appetite arms, book p10 73 /
// median 80 / p90 86. CROSSING 65.7%, down from 70.9%.
//
// ⚠ ITS TAIL STOPS WERE THIS FILE'S STANDING EXAMPLE OF AN IMPRECISE ESTIMATE
// AND THEY ARE NO LONGER THAT. The previous curve put the 97.5th at 3.3484 and
// the 99th at 6.5251, with a 95% CI half-width of +/-0.28 at the 97.5th against
// WC's +/-0.012; the note here said that was the distribution rather than the
// sample, GL's retained tail carrying the unhedgeable above-tower band. On the
// re-derived curve they are 1.3293 and 1.4523 at half-widths of 0.0180 and
// 0.0220 — a factor of fifteen tighter, and the same order as WC's.
//
// THAT IS TOO LARGE A MOVE TO BOOK AS PRECISION AND IT IS NOT ONE. The old tail
// was measured on a sample that still contained the drifting-to-20 book, where a
// single above-tower GL occurrence lands on a tiny premium base and produces a
// ratio of six. Those line-years no longer exist, so the tail they generated is
// gone with them. The above-tower exposure itself is untouched — GL still
// retains everything over $25M and the excess market still stops there. What
// changed is the size of the denominator it lands on, not the hazard.
//
// ⚠ SO THE OLD 99th STOP IS NOT SIMPLY SUPERSEDED. It remains the right shape
// for a pool small enough that one uncapped occurrence can be six times its
// annual funding, and if the book is ever allowed to run small again this curve
// will understate that end badly. The re-derivation note at the head of this
// file is the mechanism for catching that; this paragraph is why it matters most
// on GL.
//
// EXPORTED, and it has a real consumer: gl-supplied-clf-check.ts measures the
// supplied curve against it. That keeps it type-checked and honest rather than
// rotting in a comment.
export const GL_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.7536, 0.7850, 0.8123, 0.8364, 0.8574, 0.8780, 0.8994, 0.9170, 0.9360, 0.9548,
    0.9761, 0.9972, 1.0218, 1.0463, 1.0778, 1.1161, 1.1672, 1.2550, 1.3293, 1.4523,
  ],
};

// ============================================================================
// PROPERTY — DERIVED from this engine, on the NET basis. RE-DERIVED at the
// frequency/severity fix (d2e1dbd) and the opening pin re-solve that had to
// come before it (f7047e0) -- REPLACES THE TABLE BELOW THIS HEADER, NOT
// PATCHES IT: the fix dropped Property's annual aggregate CV from 0.427 to
// ~0.18 (many small claims diversify where a few large ones do not), so the
// whole shape needed re-measuring, not just the level.
//
// 25,071 line-years in the small~64 band of 100,000 across 10,000 games and
// four new-business appetite arms, via scripts/diagnostics/clf-table-derive.ts
// (BAND_DERIVE=0 LINES=Property GAMES=2000). Same statistic, same block
// bootstrap over whole games, same script as every prior derivation on this
// line. Book within the band: p10 52, median 63, p90 70. CI half-widths run
// 0.0025 at the 25th stop to 0.0166 at the 99th -- tighter than the previous
// derivation's at every stop, because the lower-variance draw needs fewer
// line-years to pin down the same precision.
//
// ⚠ RE-DERIVED AT A DIFFERENT BAND FROM THE ONE ABOVE, AND THAT IS THE ACTUAL
// FIX, NOT A SIDE EFFECT OF THE FREQUENCY WORK. The previous derivation
// (kept, struck through in spirit, replaced in fact) sat at the large~97 band
// because Property's median book then was ~91-95. The frequency/severity fix
// did not by itself move the book -- membership dynamics did, separately, and
// the default book measured here is p10 52 / median 63 / p90 70, squarely in
// the small~64 band and nowhere near large~97. That is the two-band mismatch:
// flagged when it was one band's difference and left alone, now confirmed
// worth fixing before the frequency work could even be measured honestly
// against a sane opening (hence the pin first, this second).
//
// ⚠ WHAT THIS COSTS THE LARGER-BOOK PLAYER, STATED RATHER THAN AVERAGED AWAY
// -- the same measurement WC's mid-band cost got, at the same three bands:
//
//   delivered error by band (pp), this table:
//     evaluated on        25%     50%     60%     75%     90%     95%    worst
//     small ~64  (this)   +0.0    +0.0    +0.0    -0.0    +0.0    -0.0    +0.0
//     mid ~80             -0.3    +1.9    +2.8    +2.7    +2.0    +1.4    +2.8
//     large ~97           -3.0    +1.2    +3.1    +5.2    +4.0    +2.5   !+5.2
//
// A player who grows into the mid band (21% of all Property line-years played
// across the appetite range) reads +2.8pp worst-case -- inside the 5pp
// tolerance this project has used everywhere else. A player who grows into
// the large band (54% of all line-years -- most Property play, over a full
// game, actually happens there) reads +5.2pp at the 75% stop, JUST outside
// that tolerance. This is the WC pattern repeating: fixing the default's
// label costs the grown book something, and here the grown-book population is
// the majority of play, not a minority the way WC's mid-band cost was framed.
// Stated and not smoothed over, matching the ruling made for WC.
//
// ⚠ A GROSS-BASIS TABLE FOR PROPERTY WAS OFFERED AND REJECTED BEFORE THE
// FREQUENCY FIX, and the reason still applies: Property funds NET (the
// occurrence layer removes the top of every large claim), so a gross-basis
// curve re-creates the exact basis error a derived table exists to remove.
// Not re-measured against the new draw, because the basis argument does not
// depend on the draw's shape.
//
// CROSSING 55.4%, up from 52.8% at the large~97 band before this re-derivation
// (and from 54.0% at the original single-band derivation before that). So
// "Expected" on Property is now a ~55% stop at the book size the default
// decisions actually produce -- still not the 60% the generic
// FUNDING_CLF_TABLE would have labelled it, and now measured at the book size
// where a player actually starts rather than one they may never reach.
//
// ⚠ THE OLD "UNEXPLAINED NON-MONOTONE" NOTE IS CORRECTED, NOT JUST STALE. The
// PREVIOUS table's 50% stop ran 0.9705 (small) -> 0.9469 (mid) -> 1.0157
// (large) -- non-monotone, unexplained, attributed there to "Property's loss
// model concentrating a year's outcome in a few large events" as an
// unmeasured hypothesis. That hypothesis is now falsified by the mechanism
// that made it moot: the frequency fix made Property MORE frequency-driven
// (locations wired into the generator, many more and much smaller claims),
// and the new 50% stop runs 0.9737 (small) -> 0.9631 (mid) -> 0.9685 (large)
// -- a range of 0.0106 against the old 0.0688, a roughly 6.5x tighter spread
// across the exact same three bands. A small dip-then-rise remains at the
// median specifically (visible above; every other stop is closer to
// monotone), so the shape is not fully resolved -- reported as measured,
// smaller and still not perfectly monotone, rather than declared fixed.
//
// VALIDATED OUT OF SAMPLE, which the derivation alone cannot do: a derived
// table is by construction the percentiles of its own sample.
// property-clf-basis-report draws a different population (all-defaults,
// mixed book ages, not band-restricted) and was last run against the table
// this replaces (worst |error| 11.9pp at the 30% stop, systematic rather than
// noise -- the finding that triggered this re-derivation). ⚠ NOT RE-RUN
// against the table below in this commit; clf-label-backtest-check (below)
// is the out-of-sample check that was run.
// ============================================================================
// ⚠ ALSO CALENDAR-YEAR BASIS, AND ALSO STAYING — for a simpler reason than WC's.
//
// clf-label-backtest-check gates this line on CALENDAR-YEAR. Not re-measured
// on the accident-year basis for this re-derivation -- Property has zero
// report lag (reportLagYears: 0), so accident-year and calendar-year ultimate
// coincide for this line by construction, and the basis question that
// mattered for GL and WC does not arise here at all, not merely "barely."
//
// Property is also the line least exposed to the objection that sank a WC
// re-derivation: 71.0% of its accident years written in a ten-year game reach
// their own horizon before it ends, against WC's 16.4%. If the ruling on WC is
// ever revisited, Property is the cheap half of it.
const PROPERTY_DERIVED: ClfTable = {
  source: 'derived',
  stops: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99],
  clf: [
    0.7580, 0.7950, 0.8254, 0.8525, 0.8771, 0.9024, 0.9268, 0.9501, 0.9737, 0.9979,
    1.0248, 1.0533, 1.0834, 1.1177, 1.1559, 1.2041, 1.2666, 1.3683, 1.4645, 1.5938,
  ],
};

// WHAT THE ENGINE ACTUALLY READS.
export const STATIC_CLF_TABLE: Record<StaticClfLine, ClfTable> = {
  WC: WC_SUPPLIED,
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
// Property 52.8%; GL 57.7% on the supplied curve against 65.6% on its derived
// one; WC 55.8% on the supplied curve against 42.9% on its derived one.
//
// ⚠ ON GL AND NOW ON WC THIS IS A DISPLAY FIGURE FOR A CURVE THAT IS NOT THE
// MODEL'S OWN. It correctly reports where the SUPPLIED table crosses, which is
// what the pool is actually being charged against; it is NOT where that line's
// real retained distribution crosses. GL differs by 8.0pp and WC by 12.9pp, and
// both gaps are recorded at their tables above.
//
// ⚠ AND ONLY PROPERTY STILL HAS THE IDENTITY. On a derived table this figure is
// the model's own crossing, because the table came from that sample; on a
// supplied one it is a statement about someone else's book. Two lines out of
// three now print a number that means the second thing while the UI says the
// same words on all three.
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
