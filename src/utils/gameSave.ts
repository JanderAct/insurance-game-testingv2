// ============================================================================
// THE SAVE — WHAT GOES IN IT, HOW BIG IT IS ALLOWED TO BE, AND WHAT HAPPENS
// WHEN IT DOES NOT FIT.
//
// ⚠ THIS EXISTS BECAUSE THE GAME SILENTLY STOPPED SAVING AT YEAR 4. `persistState`
// was a closure inside App.tsx: a bare `JSON.stringify(gameState)` wrapped in a
// bare `catch {}`. Measured, three lines, the reachable worst case:
//
//     year  3   4.95 MiB      year  4   5.76 MiB      year 10  10.24 MiB
//
// and localStorage refuses anything past about 5 MiB. So from YEAR 4 every
// write threw QuotaExceededError, the catch swallowed it, and the player's game
// stopped being recorded with no symptom at all. A reload returned the year-3
// state, which reads as the game having quietly rewound rather than as a
// storage failure.
//
// 65-70% of that payload was per-claim detail that `LineResultSet.claims` says
// of itself is "IN-MEMORY FOR THE CURRENT SESSION ONLY — deliberately NOT
// persisted to localStorage (~800 claims/yr x years would blow the quota)".
// Both halves of that sentence were false. It was persisted, and it did blow the
// quota. Nothing stripped it, because nothing was doing the stripping the
// comment described.
//
// ============================================================================
// THE QUOTA IS MEASURED, NOT ASSUMED, AND THE ACCOUNTING MATTERS.
//
// The WHATWG spec sets no localStorage quota, and the two plausible accountings
// differ by 2x: bytes of content, or UTF-16 code units (which would halve the
// character count an ASCII payload can use). Guessing would have picked the
// budget below out of folklore, so it was measured instead — a real Chromium,
// a real http:// origin, binary search on a single ASCII value:
//
//     largest value accepted   5,242,613 characters   (5 MiB, less key overhead)
//     error at the boundary    QuotaExceededError
//
// So Chromium charges per CHARACTER for ASCII content, and the game's save has
// the whole origin budget to itself — `riskpool_gamestate_v10` is the only key
// the app writes. Other engines may differ and were not reachable to measure;
// that is exactly why the failure below is loud rather than assumed impossible.
//
// ⚠ THE BUDGET IS A GATE THRESHOLD, NOT THE BROWSER'S LIMIT. It exists to fail
// in CI before it fails in a facilitated session. 4,000,000 characters is 76% of
// the measured limit; the reachable worst case (10 years x 3 lines, the longest
// the setup slider offers) serialises to about 3.28M, which is 82% of the budget
// and 63% of the browser's. The remaining 18% is roughly one more game-year at
// ~208k characters per year — so the gate goes red about a year before a player
// would, which is the point.
// ============================================================================

/**
 * The storage key. A persisted identifier, not a display string.
 *
 * ⚠ IT STAYS `riskpool_gamestate_v10` ACROSS THE RIPPLE RENAME. Renaming it
 * orphans every existing saved game — a fresh key means `getItem` finds nothing,
 * which is indistinguishable from never having played. A version bump belongs to
 * a real save schema change, not to the app's name.
 *
 * ⚠ AND IT IS A CONSTANT NOW BECAUSE IT WAS FOUR STRING LITERALS. The load, its
 * two removeItem cleanup paths and the write each carried their own copy, with a
 * comment asking the next reader to keep them in step by hand. That is the
 * keyed-lookup defect in its plainest form.
 */
export const SAVE_KEY = 'riskpool_gamestate_v10';

/**
 * Fields dropped on the way out.
 *
 * ⚠ THESE ARE ALL PER-CLAIM FLOW, AND RULING 8 ALREADY SAYS THEY DO NOT BELONG
 * IN STORAGE. `claims` and `occurrences` exist only on LineResultSet;
 * `marketMemberLossResults` is the 200-member marketplace view whose enrolled
 * entries are the same objects as the retained `memberLossResults`, so dropping
 * it loses no enrolled figure. Measured at year 10: 3.51 + 2.53 + 1.08 MiB of a
 * 10.24 MiB save.
 *
 * ⚠ `memberLossResults` IS DELIBERATELY NOT HERE, though it is the next largest
 * item at 1.08 MiB. ResultSpreadsheetPage reads it for whichever result year the
 * player selects, so dropping it would blank a visible page on reloaded games —
 * silent degradation, which is the same defect one layer out. It stays.
 */
export const SAVE_STRIPPED_KEYS: readonly string[] = ['claims', 'occurrences', 'marketMemberLossResults'];

/** Measured against a real Chromium — see the header. Not a spec figure. */
export const MEASURED_QUOTA_CHARS = 5_242_613;

/** The CI threshold. Deliberately below the measured quota — see the header. */
export const SAVE_BUDGET_CHARS = 4_000_000;

export interface SaveEnvelope {
  gameState: unknown;
  startingFinancials: unknown;
  initialMembers: unknown;
  currentDecisions: unknown;
}

/**
 * The envelope as it goes to storage, per-claim flow removed.
 *
 * ⚠ PURE, AND SEPARATE FROM THE WRITE, so a gate can measure the payload without
 * a browser. The size gate calls this; the round-trip gate calls this and parses
 * it back. Neither could reach the old closure inside App.tsx, which is why a
 * 2x-over-quota save shipped.
 */
export function serialiseSave(env: SaveEnvelope): string {
  return JSON.stringify(env, (key, value) =>
    (SAVE_STRIPPED_KEYS.includes(key) ? undefined : value));
}

/**
 * The minimum of the Storage interface this needs.
 *
 * ⚠ REQUIRED, NOT DEFAULTED TO `localStorage`. A defaulted store is the second
 * form of the keyed-lookup defect WORKING_PRACTICES records: the default would be
 * a legitimate value, so a caller that forgot to pass one would compile, run, and
 * write to the real browser store from inside a test. Callers name their target.
 */
export interface SaveStore {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export type SaveOutcome =
  | { ok: true; chars: number }
  | { ok: false; chars: number; reason: 'quota' | 'unavailable'; detail: string };

/**
 * Write the save, and SAY SO WHEN IT FAILS.
 *
 * ⚠ THE RETURN VALUE IS THE POINT. The old code swallowed every error in a bare
 * `catch {}`, which is why two years of a player's game could evaporate without a
 * symptom. This reports the outcome and leaves the caller to surface it; App.tsx
 * turns a failure into a banner that does not go away.
 *
 * ⚠ IT DOES NOT THROW, AND THAT IS DELIBERATE RATHER THAN TIMID. Throwing here
 * would unmount the React tree mid-turn and destroy the in-memory game as well
 * as the stored one — strictly worse than the defect, and worst of all in the
 * setting this is built for, where a facilitator is running a room of ten people
 * and cannot debug a white screen. The game must keep playing; the player must
 * know it is no longer being written down. So: keep the session alive, return
 * the failure, and let the UI make it impossible to miss.
 */
export function writeSave(env: SaveEnvelope, store: SaveStore): SaveOutcome {
  const payload = serialiseSave(env);
  try {
    store.setItem(SAVE_KEY, payload);
    return { ok: true, chars: payload.length };
  } catch (e) {
    const name = e instanceof Error ? e.name : String(e);
    // QuotaExceededError is the named one; Safari's private mode throws
    // differently, and either way the player's position is the thing at risk.
    const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || /quota/i.test(name);
    console.error(
      `[save] FAILED to write ${payload.length.toLocaleString()} characters to `
      + `localStorage['${SAVE_KEY}'] (${name}). The game is still running but is `
      + `NO LONGER BEING SAVED. Budget is ${SAVE_BUDGET_CHARS.toLocaleString()} `
      + `characters; the browser accepted ${MEASURED_QUOTA_CHARS.toLocaleString()} when measured.`,
      e,
    );
    return {
      ok: false,
      chars: payload.length,
      reason: quota ? 'quota' : 'unavailable',
      detail: name,
    };
  }
}
