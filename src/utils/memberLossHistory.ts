// Rolling per-member, per-line loss history — stage 3 of the experience-modifier
// work. Carried on PoolState and maintained by processYear, exactly like the
// membership-history ledger next door (membershipHistory.ts), which is the
// pattern this follows deliberately.
//
// WHAT IT IS FOR. Stage 2 generates claims for all 200 canonical members every
// year; only the enrolled subset feeds pool losses. This keeps a rolling record
// of each member's actual and expected loss per line so the experience modifier
// (stage 4) has something to read — including for PROSPECTS, so a member the
// pool might recruit arrives with a readable record rather than a blank one.
//
// A RUNNING SUM, NOT A CLAIM ARCHIVE. Claims themselves are still not
// persisted — ~800 claims/yr across 200 members would blow the localStorage
// quota, which is why LineResultSet.claims is in-memory only. What is stored
// here is FOUR numbers per member per line per year: actual, expectedAtOwnRq,
// expectedAtManual, primaryActual. The ceiling is 200 members x 3 lines x 5
// retained years = 3,000 entries; measured at year 10 it is 2,408 entries,
// because Property is enrolled-only and so carries ~57 members rather than
// 200 (see member-loss-history-check's header for why that is expected).
//
// (The prose said "two numbers" while the arithmetic beside it already said
// three — the entry has carried actual + one expected leg since it was
// written. Corrected when the second expected leg landed, and noted rather
// than silently fixed because it is the repo's recurring lesson: a figure in a
// comment is a claim, and this one disagreed with the sum three lines below it
// for as long as it stood.)
//
// ⚠ "WELL INSIDE QUOTA" IS NOW THE WRONG WORD FOR THE SAVE AS A WHOLE, AND
// THE NEXT NUMBER ADDED HERE SHOULD BE COSTED BEFORE IT IS ADDED. Measured at
// save-size-check's worst case, 3 games x 10 years x 3 lines: the save went
// from 3,443,283 chars (86% of the 4,000,000 budget) to 3,754,683 (94%) when
// the manual leg landed. This ledger is 284,578 of that — 7.1% of budget over
// 2,408 entries, so about 118 chars an entry across three numbers and their
// keys.
//
// MEASURED BY MATERIALISING THE FIELDS ON REAL YEAR-10 LEDGERS AND
// RE-SERIALISING, worst of 3 games — not projected from a per-entry rate:
//
//   3 numbers                    3,751,379   93.8%
//   4 numbers, + primaryActual    3,828,928   95.7%   (+77,549, SHIPPED)
//   5 numbers, a hypothetical     3,928,646   98.2%  (+104,468)
//
// ⚠ AN EARLIER VERSION OF THIS NOTE SAID A FIFTH NUMBER WOULD NOT FIT. It
// does, with 71,354 chars to spare — and it costs HALF AGAIN what the fourth
// costs, because a longer key name is most of the cost at this precision.
// Both halves of that were wrong by projection and right by measurement.
//
// ⚠ AND THE FOURTH NUMBER NEARLY COST TWICE ITS PRICE, WHICH IS THE TRAP
// WORTH REMEMBERING. `primaryActual` was first added to BOTH MemberLossResult
// and MemberLossYear, and the result-row copy is saved too — the pair
// measured 213,555 chars, 5.3 points, taking the save to 99% rather than 96%.
// The result-row copy is a pure duplicate: processYear reads it once into the
// ledger and nothing reads it again. It is named `primaryLoss` there and
// stripped (gameSave.ts explains why one key name could not do both jobs).
// A new per-member field costs its ledger price AND its result-row price
// unless one of them is stripped, and only the second is avoidable.
//
// FIVE IS THE END OF IT THOUGH. At 98.2% the margin is under two points, and
// the sixth number is not a question worth asking — compression, or a
// narrower retained window, comes first. THE EXPECTED PRIMARY WOULD HAVE BEEN
// THAT FIFTH NUMBER and is not stored: E[min(X,D)]/E[X] cancels k, exposure
// and lambda, so it is recomputed per rating group per year in
// memberExperienceMod.ts instead.
//
// ---------------------------------------------------------------------------
// WHAT THIS LEDGER ACTUALLY READS AS A MODIFIER. Measured 8 games x 16 years
// on the WHOLE-LOSS basis (actual / expectedAtManual), accumulated uncapped
// and cross-checked against this ledger over 158,605 windows with 0
// mismatches. This is the basis the modifier NO LONGER USES — it is kept
// because it is what motivated the primary/excess split, and because the
// ranking-power table is still the reference for what the ledger can see.
//
//   RANKING POWER against true risk quality (Spearman, sign-flipped):
//                        1yr    3yr    5yr    8yr
//     WC, all members    0.171  0.224  0.256  0.290
//     WC, within group   0.173  0.225  0.258  0.291   <- class is priced now,
//     GL                 0.130  0.181  0.195  0.212      so this is selection
//     Property           0.054  0.119  0.144  0.145
//   WC's edge over its within-group figure is GONE, which is the confirmation
//   that member-level class pricing did its job: what is left is the member,
//   not their class.
//
//   ⚠ AND THE RATIO IS SAVAGELY SKEWED, WHICH IS THE CREDIBILITY PROBLEM
//   STATED AS A NUMBER. WC at three years, median-size members: MEAN 1.03,
//   MEDIAN 0.395, p10 0.064, p90 2.16, p99 11.0. GL: mean 0.995, median
//   0.215. The expectation is CALIBRATED — aggregate actual/expected is 0.986
//   on WC and the exposure-weighted mean ratio is 0.993 — so this is the loss
//   distribution, not a basis error. A raw ratio would hand the typical member
//   a large credit (-15% at Z=0.25 on WC, -20% on GL) and recover it from a
//   few members with enormous debits.
//
//   ⚠ THIS MOTIVATED AN AGGREGATE CAP, WHICH WAS MEASURED AND THEN NOT BUILT.
//   Capping the member-YEAR actual at 2x expected moves ranking power only
//   0.224 -> 0.247 on WC and 0.181 -> 0.195 on GL, drops the mean ratio from
//   1.03 to 0.50 (so it needs a capped expectation under it, a fifth number),
//   and grades hard by SIZE: capped/uncapped by WC exposure decile runs 0.222
//   to 0.771, a 3.5x spread, because a small member holds more of its loss
//   above any multiple of its own expectation.
//
//   ⚠ WHAT SHIPPED INSTEAD IS A PER-CLAIM SPLIT, AND THE SIZE GRADING ABOVE
//   IS THE REASON. min(claim, D) summed is size-NEUTRAL: E[min(X,D)]/E[X] is
//   a property of the severity distribution, not of how many claims a member
//   brings, so the decile gradient disappears. It also needs only ONE new
//   stored number rather than two, because the expected primary cancels k,
//   exposure and lambda and is recomputed rather than stored.
//
//   Do not read the aggregate-cap figures above as an argument against the
//   shipped split — they are an argument against the design that was NOT
//   taken, and the difference between capping a year's total and limiting
//   each claim is the whole of it. memberExperienceMod.ts carries the
//   split-point sweep and the credibility that came out of it.
// ---------------------------------------------------------------------------
//
// ACCUMULATED AS IT HAPPENS, NEVER REGENERATED ON DEMAND. Recomputing a past
// year's expected loss later would evaluate it at the member's CURRENT risk
// quality, so a member whose RQ improved would look retroactively favourable
// across a window when they were actually worse. The stored `expectedAtOwnRq`
// is the expectation as it stood in that year, against that year's RQ.
//
// This applies to `expectedAtManual` too, and it is NOT the same reason.
// That leg is RQ-independent by construction, so re-deriving it would not
// drift with the member's risk quality — but it WOULD be re-derived at the
// current year's k_line, class rate and exposure, none of which are frozen.
// Both legs are recorded, never reconstructed.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE CANNOT AFFECT THE SIMULATION.
//
// Every function here is pure and consumes NO RANDOMNESS. Recording happens in
// processYear AFTER processLineYear has returned, reading only the finished
// result object — it is downstream of every draw, not inside any of them. That
// is the property both export gates verify: a running sum cannot move a value
// and cannot shift a stream.
// ---------------------------------------------------------------------------

import type { CoverageLine, MemberLossHistory, MemberLossYear } from '../types/simulation';

// How many years are STORED. The read window is shorter (see EXPERIENCE_WINDOW_YEARS).
//
// STORE 5, WINDOW 3 AT READ TIME — deliberately not "store exactly 3".
// Pruning to the window length at WRITE time would commit the window to the
// save format, so changing the experience window later (3 -> 4, or a two-year
// variant for a new line) would become a data migration over every saved game
// rather than a one-line constant change. Storing a little more than is read
// costs ~200 x 3 x 2 extra numbers and buys that flexibility. The cap still
// bounds growth, so a 30-year game does not accumulate 30 entries.
export const LOSS_HISTORY_CAP_YEARS = 5;

// How many years the experience modifier actually reads. Stage 4 consumes this;
// nothing here enforces it beyond providing the windowed read below.
export const EXPERIENCE_WINDOW_YEARS = 3;

// ---------------------------------------------------------------------------
// THE PRIMARY/EXCESS SPLIT POINT, PER CLAIM. Lives here beside the window
// because it is the other half of the same rating basis, and because the
// claim engines record `primaryActual` against it — a change to this number
// changes what every future ledger row MEANS, exactly like a change to the
// window would.
//
// ⚠ IT IS NOT COMPARABLE TO A CLAIM CAP AND DOES NOT DISCARD ANYTHING. The
// excess layer is still recorded (actual - primaryActual) and is still the
// member's loss; it is simply not rated, because it measured as carrying no
// repeatable signal. See memberExperienceMod.ts.
//
// MEASURED, not chosen. Split-half reliability of the three-year primary
// ratio on WC against the split point, with the class bias removed:
//
//   split      $10k    $25k    $50k   $100k   $1M    none
//   WC  Zp    0.193   0.155   0.131   0.091  0.036  0.052
//   WC  rank  0.339   0.332   0.311     --     --   0.176
//   GL  Zp    0.045   0.076   0.102     --     --  -0.028
//
// There is NO KNEE — WC's credibility rises monotonically as the split falls,
// all the way to $5k, because a lower split is closer to rating on claim
// COUNTS. $25k is picked for three reasons and none of them is optimality:
// it is within 2% of WC's best ranking power, it is better than $10k for GL
// (whose Zp moves the other way), and at 15.6% of WC dollars it still rates a
// layer a member can recognise as losses rather than as a claim count.
// ---------------------------------------------------------------------------
export const EXPERIENCE_SPLIT_POINT = 25_000;

// Deep-clone so a processing pass can mutate its working copy without aliasing
// the prior year's persisted state — same contract as cloneMembershipHistory.
export function cloneMemberLossHistory(history: MemberLossHistory): MemberLossHistory {
  const out: MemberLossHistory = {};
  for (const [memberId, byLine] of Object.entries(history)) {
    const lineCopy: Partial<Record<CoverageLine, MemberLossYear[]>> = {};
    for (const [line, years] of Object.entries(byLine) as [CoverageLine, MemberLossYear[]][]) {
      lineCopy[line] = years.map(y => ({ ...y }));
    }
    out[memberId] = lineCopy;
  }
  return out;
}

// Record one member-line-year. Mutates `history` (call on a working clone).
//
// ---------------------------------------------------------------------------
// THE TWO LAMBDA MULTIPLIERS ARE TREATED ASYMMETRICALLY, ON PURPOSE. DO NOT
// "FIX" THIS TO BE CONSISTENT.
//
//   k_line / k_GL is INCLUDED in BOTH expected legs, so it CANCELS in the
//     modifier. It is a pool-level PRICING artifact — the enrolled book's
//     risk-quality-mix correction — not a statement about this member's risk.
//     It scales the enrolled member's actual draw, so if it were absent from
//     the expected leg every enrolled member's mod would be biased by (1 - k),
//     about 2.2% at a typical 0.978. Small, but systematic, and it FLIPS SIGN
//     as the roster mix drifts, which is worse than a constant bias.
//
//     THIS IS WHY `expectedAtManual` IS NOT "THE EXPECTATION WITH ALL POOL
//     ADJUSTMENTS STRIPPED". It is the expectation with RISK QUALITY alone
//     overridden to neutral, k and everything else held identical. Stripping k
//     as well would be the tidier-sounding field and the biased one.
//
//   riskControlEffectiveness is EXCLUDED from both, so risk control SHOWS
//     UP as a favourable mod. That is the correct incentive and it is what NCCI
//     experience rating does — safety investment earns a lower mod. If RC
//     cancelled, a member who genuinely improved would look unchanged.
//
// THE RULE IS HELD BY INVARIANT 2, NOT BY THIS COMMENT. All three numbers are
// read straight off MemberLossResult, whose `expectedLoss` and
// `expectedLossAtManual` are computed as expected<Line>GrossLoss([member],
// { k, ... }) — k passed in, and risk control absent because invariant 2 keeps
// it out of EVERY analytic expectation in this codebase (see the header of
// wcClaimEngine.ts). So the asymmetry is structural: symmetrising it would
// require breaking invariant 2 itself, which would break pricing long before it
// broke this. Nothing here recomputes an expectation, and nothing here should
// start.
//
// PROSPECTS TAKE THE SAME PATH, NOT A SPECIAL CASE. Stage 2 generates them at
// k = 1 and rc = 0, so both legs are simply unadjusted and the asymmetry is
// moot for them — but it is moot because of their INPUTS, not because of a
// branch here.
// ---------------------------------------------------------------------------
export function recordMemberLossYear(
  history: MemberLossHistory,
  memberId: string,
  line: CoverageLine,
  entry: MemberLossYear,
): void {
  const byLine = (history[memberId] ??= {});
  const years = (byLine[line] ??= []);

  // Idempotent per year: re-processing the same year replaces its entry rather
  // than appending a duplicate. The pre-game bootstrap re-simulates candidate
  // attempts, and a rejected attempt must not leave a phantom year behind.
  const existing = years.findIndex(y => y.yearNumber === entry.yearNumber);
  if (existing >= 0) {
    years[existing] = { ...entry };
  } else {
    years.push({ ...entry });
    // Ascending by year. Entries normally arrive in order, so this is a no-op
    // in the common case, but the pre-game years are negative and a later
    // read windows from the END of the array — so order cannot be assumed.
    years.sort((a, b) => a.yearNumber - b.yearNumber);
  }

  // Prune from the FRONT: the oldest years go first.
  if (years.length > LOSS_HISTORY_CAP_YEARS) {
    years.splice(0, years.length - LOSS_HISTORY_CAP_YEARS);
  }
}

// The stored years for one member-line, oldest first. Empty when unknown.
export function storedLossYears(
  history: MemberLossHistory,
  memberId: string,
  line: CoverageLine,
): MemberLossYear[] {
  return history[memberId]?.[line] ?? [];
}

// The experience window: the most recent `windowYears` stored entries, oldest
// first. THIS is what stage 4 reads — the window is applied here at read time,
// not baked into what was stored.
//
// Deliberately does NOT require the window to be full: a member with one year
// of history returns that one year. Whether a short record is enough to rate on
// is a stage-4 credibility question, not a storage question, and answering it
// here would hide the distinction.
export function experienceWindow(
  history: MemberLossHistory,
  memberId: string,
  line: CoverageLine,
  windowYears: number = EXPERIENCE_WINDOW_YEARS,
): MemberLossYear[] {
  const years = storedLossYears(history, memberId, line);
  return years.slice(Math.max(0, years.length - windowYears));
}
