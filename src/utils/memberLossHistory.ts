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
// here is two numbers per member per line per year. At 200 members x 3 lines x
// 5 retained years x 3 numbers that is well under quota.
//
// ACCUMULATED AS IT HAPPENS, NEVER REGENERATED ON DEMAND. Recomputing a past
// year's expected loss later would evaluate it at the member's CURRENT risk
// quality, so a member whose RQ improved would look retroactively favourable
// across a window when they were actually worse. The stored `expected` is the
// expectation as it stood in that year, against that year's RQ.
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
//   k_line / k_GL is INCLUDED in `expected`, so it CANCELS in the modifier.
//     It is a pool-level PRICING artifact — the enrolled book's risk-quality-mix
//     correction — not a statement about this member's risk. It scales the
//     enrolled member's actual draw, so if it were absent from the expected leg
//     every enrolled member's mod would be biased by (1 - k), about 2.2% at a
//     typical 0.978. Small, but systematic, and it FLIPS SIGN as the roster mix
//     drifts, which is worse than a constant bias.
//
//   riskControlEffectiveness is EXCLUDED from `expected`, so risk control SHOWS
//     UP as a favourable mod. That is the correct incentive and it is what NCCI
//     experience rating does — safety investment earns a lower mod. If RC
//     cancelled, a member who genuinely improved would look unchanged.
//
// THE RULE IS HELD BY INVARIANT 2, NOT BY THIS COMMENT. Both legs are read
// straight off MemberLossResult, whose `expectedLoss` is computed as
// expected<Line>GrossLoss([member], { k }) — k passed in, and risk control
// absent because invariant 2 keeps it out of EVERY analytic expectation in this
// codebase (see the header of wcClaimEngine.ts). So the asymmetry is structural:
// symmetrising it would require breaking invariant 2 itself, which would break
// pricing long before it broke this. Nothing here recomputes an expectation, and
// nothing here should start.
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
