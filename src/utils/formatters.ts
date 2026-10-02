// Display formatting utilities

export function formatCurrency(value: number, compact = false): string {
  if (compact) {
    if (Math.abs(value) >= 1_000_000) {
      const millions = value / 1_000_000;
      // Round before comparing so a value just under $1B (e.g. 999,999,999)
      // doesn't display as "$1000.00M" instead of correctly bumping to B.
      if (Math.abs(Number(millions.toFixed(2))) >= 1000) {
        return `$${(value / 1_000_000_000).toFixed(2)}B`;
      }
      return `$${millions.toFixed(2)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// For figures already expressed in millions (payroll/TIV exposure). Rolls up
// to billions at 1000M ($1B) so a large exposure figure doesn't display as an
// unreadable 4+ digit millions number — e.g. "$4177.95M" becomes "$4.18B".
// Below $1B, formatting is unchanged from the plain "$X.XXM" convention.
export function formatMillions(valueInMillions: number, decimals = 2): string {
  // Round before comparing so a value just under 1000M doesn't display as
  // "$1000.00M" instead of correctly bumping to B.
  if (Math.abs(Number(valueInMillions.toFixed(decimals))) >= 1000) {
    return `$${(valueInMillions / 1000).toFixed(decimals)}B`;
  }
  return `$${valueInMillions.toFixed(decimals)}M`;
}

export function formatPct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

// ONE set of loss-ratio bands, two palettes. The header sits on a dark slate
// bar and needs -400 shades for contrast while the pages use -600 on white, so
// the two cannot share a class string — but they MUST share the cutoffs. The
// header previously inlined its own three-band scale (<0.90 / <1.10) against
// this four-band one, so a 0.95 loss ratio rendered amber in the header and
// sky on the dashboard, on the same screen, for the same number.
//
// ⚠ AND IT DRIFTED A SECOND TIME, IN PROSE, WHICH IS WHY THE FUNCTION IS NOW
// EXPORTED. narrativeEngine carried its own pair — 0.65 and 0.95 — fitted
// "roughly symmetrically either side of what the year was PRICED to produce".
// So the colour and the sentence disagreed about the same number: a 0.97 ratio
// rendered sky (band 1, below 1.00) while the prose called it unfavourable, and
// a 0.93 rendered sky while the prose said nothing. The comment above already
// said these must share; copying the numbers is what let them drift, so there
// are no numbers left to copy.
//
// ⚠ THE CUTOFFS ARE ABSOLUTE, NOT RELATIVE TO THE PRICE, AND THAT IS A RULING
// RATHER THAN A CONVENIENCE. 1.00 is the line between making and losing money
// on underwriting. A pool funding at 40% and running 0.95 is burning surplus;
// grading it against its own price would call that favourable and reward the
// underpricing. 0.65 and 0.95 marked nothing — they were fitted to the priced
// expectation, which moves with the player's own aggression.
//
// ⚠ FIVE BANDS, AND THE TWO LOWER EDGES ARE MEASURED RATHER THAN CHOSEN. With
// three cutoffs, 83.6% of line-years fell in one band: the cutoffs meant
// something but did not DIVIDE anything, and at the funding members choose a
// well-run pool should mostly sit below break-even, so that mass is correct and
// needed splitting rather than moving.
//
//   0.70 IS WHERE THE PRICE SITS. Measured over the same 720 line-years, the
//   priced ratio runs a median of 0.686 and a mean of 0.685. Putting an edge
//   there is what lets a year BETTER than priced read better than one that
//   merely cleared break-even — the relative meaning, without a relative
//   threshold, because the bar itself does not move with the player's pricing.
//   ⚠ IT WAS PROPOSED AT 0.80, which is ~11 points ABOVE the price: a year at
//   0.85 would have read "about as expected" while running 16% worse than it
//   was priced to run.
//
//   0.50 MAKES THE TOP BAND RARE WITHOUT MAKING IT DEAD. Measured splits:
//     edges        line-years (top/max)   pool-years (top/max)
//     0.60/0.80       30.7% / 42.6%          20.4% / 61.3%   top not rare, pool over half
//     0.50/0.70       11.9% / 43.5%           2.1% / 54.2%   <- chosen
//     0.45/0.70        6.4% / 49.0%           0.0% / 56.3%   top DEAD at pool scope
//     0.50/0.75       11.9% / 53.5%           2.1% / 69.2%   pool well over half
//   The narrative renders at POOL scope only, so the pool column is the one that
//   decides: at 0.45 "exceptional" never fires in 240 pool-years.
//
//   ⚠ POOL'S LARGEST BAND IS 54.2%, WHICH IS OVER HALF AND IS REPORTED RATHER
//   THAN ROUNDED AWAY. Nothing in the candidate set does better while keeping
//   1.00 fixed and the top band alive: pooling three lines averages out the
//   line-level spread, so pool-years concentrate harder than line-years by
//   construction. 0.50/0.70 is the flattest of the four at both scopes.
export const LOSS_RATIO_CUTOFFS = {
  exceptional: 0.50,
  betterThanPriced: 0.70,
  breakEven: 1.00,
  severe: 1.10,
} as const;

export function ratioBand(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (ratio < LOSS_RATIO_CUTOFFS.exceptional) return 0;
  if (ratio < LOSS_RATIO_CUTOFFS.betterThanPriced) return 1;
  if (ratio < LOSS_RATIO_CUTOFFS.breakEven) return 2;
  if (ratio < LOSS_RATIO_CUTOFFS.severe) return 3;
  return 4;
}

// ⚠ FIVE BANDS, FOUR COLOURS, AND THE MERGE IS STRICTLY NESTED. A chip has less
// room than a sentence, and there is no fifth colour that would mean anything
// next to these four — so bands 0 and 1 share emerald. What makes that safe
// rather than a second scale is that EVERY COLOUR BOUNDARY IS ALSO A SENTENCE
// BOUNDARY: the chip says less than the prose, never something different. A
// reader is never told two things about one number, which is the defect the
// shared cutoffs were introduced to fix and which a separate three-band chip
// scale would have reintroduced.
//
//   band 0  below 0.50   exceptional              emerald
//   band 1  0.50-0.70    strong                   emerald
//   band 2  0.70-1.00    about as expected        sky
//   band 3  1.00-1.10    lost money underwriting  amber
//   band 4  above 1.10   well past break-even     red
//
// ⚠ THE EMERALD/SKY BOUNDARY MOVES FROM 0.90 TO 0.70, and the render baseline
// cannot see it: render-identity-check fingerprints innerText, so a CSS class is
// invisible to it. A ratio of 0.85 was emerald and is now sky — which is the
// honest reading, since 0.85 is worse than the 0.686 it was priced at.
const BAND_COLORS = ['emerald', 'emerald', 'sky', 'amber', 'red'] as const;

export function colorForRatio(ratio: number): string {
  return `text-${BAND_COLORS[ratioBand(ratio)]}-600`;
}

// Same bands as colorForRatio, lightened for the dark header bar.
export function colorForRatioOnDark(ratio: number): string {
  return `text-${BAND_COLORS[ratioBand(ratio)]}-400`;
}

// ⚠ THE COMBINED RATIO GETS BREAK-EVEN ONLY, AND REFUSING TO SHARE THE FULL
// SCALE HERE IS THE POINT RATHER THAN AN OVERSIGHT. The two lower edges above
// are calibrated to the priced LOSS ratio: 0.70 is where the price sits, 0.50
// is a measured tail. A combined ratio is a different quantity — it carries
// admin and acquisition expense on top of losses — and measured over the same
// 240 pool-years it runs p05 0.795, median 0.904, p95 1.026. ⚠ IT NEVER GOES
// BELOW 0.70 AT ALL, so both lower edges are DEAD on it: painting it with the
// loss-ratio scale makes emerald unreachable on HistoryPage, where roughly half
// the rows were emerald under the old 0.90 edge.
//
// 1.00 and 1.10 mean the same thing for both quantities — paid for itself, and
// did not by a margin — so those are shared and the sub-break-even split is not.
//
// ⚠ THIS IS NOT THE DRIFT THE SHARED CUTOFFS EXIST TO PREVENT. That defect was
// ONE number wearing two colours in two places. This is two different numbers
// on two scales, each calibrated to itself, and no reader is told two things
// about one figure. The distinction is the quantity, not the page.
//
// That 0.90 was a decent divider for the combined ratio and a poor one for the
// loss ratio is how the shared scale came to be miscalibrated in the first
// place: it was fitted, once, to whichever quantity was in front of somebody.
export function colorForCombinedRatio(ratio: number): string {
  if (ratio < LOSS_RATIO_CUTOFFS.breakEven) return 'text-emerald-600';
  if (ratio < LOSS_RATIO_CUTOFFS.severe) return 'text-amber-600';
  return 'text-red-600';
}

export function colorForSurplus(surplus: number): string {
  if (surplus > 0) return 'text-emerald-600';
  return 'text-red-600';
}

export function colorForNetIncome(income: number): string {
  if (income >= 0) return 'text-emerald-600';
  return 'text-red-600';
}

