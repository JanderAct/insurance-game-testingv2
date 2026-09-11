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
// in CI before it fails in a facilitated session. See THE BUDGET, RE-DERIVED
// below for what it is now and why — the old figure was a share of the quota
// chosen when the payload went to storage as raw JSON, and it does not survive
// the change.
//
// ============================================================================
// THE SAVE IS COMPRESSED, AND THE REASON IS THAT EVERY OTHER OPTION COST
// SOMETHING VISIBLE.
//
// The experience modifier's ledger took the raw payload to 4,052,741 characters
// at the reachable worst case — 101% of the old 4,000,000 budget, 77% of the
// measured quota. Every alternative removes something a page renders or a
// mechanic reads. Compression removes nothing.
//
// ⚠ MEASURE THE STORED SIZE, NOT THE STRING LENGTH, BECAUSE THEY ARE NOT THE
// SAME NUMBER AND THE DIFFERENCE IS A FACTOR OF TWO. Chromium encodes a
// localStorage value as one byte per character IF the whole string is ASCII,
// and as UTF-16 — two bytes per character — the moment it is not. A codec whose
// output is dense but non-ASCII therefore charges double for every character it
// saved, and `payload.length` reports a ratio that storage does not honour.
//
// Measured on the worst reachable save (4,052,741 raw characters, all ASCII),
// every row on that same save. ⚠ lz-string IS NOT A DEPENDENCY — it was
// installed to produce these rows and removed again, so this table is the
// record rather than something a reader can re-run without reinstalling it.
//
//   codec                         chars      STORED     ratio   enc ms  dec ms
//   lz-string compress()        385,405     770,810      5.26     1668     265
//   lz-string compressToUTF16   411,099     822,198      4.93     1715     349
//   lz-string compressToBase64  1,027,748  1,027,748     3.94     1696     273
//   deflate(6) + base64         1,097,556  1,097,556     3.69      168      45
//
// The first row is the trap in one line. It looks like a 10.5x win on string
// length (4,052,741 -> 385,405) and is a 5.3x win on bytes, because every one
// of those characters is charged twice. Reporting the apparent figure would
// have overstated the result by exactly 2x — and it would have been a
// measurement, run and recorded, not a guess.
//
// ⚠ AND THE ONE THAT WINS ON SIZE IS NOT THE ONE THAT SHIPS. Every lz-string
// variant beats deflate on stored bytes, including the ASCII one — this is not
// a case of base64 forcing the choice. deflate+base64 is 42% larger than
// lz-string's densest output and TEN TIMES faster to produce, and speed is the
// binding constraint here while size is not:
//
//   - The compressed worst case is 21% of the measured quota either way. There
//     is 4.8x of headroom at 3.69x, so 5.26x buys nothing that is needed.
//   - The write is on a path that fires far more often than once a year (see
//     save-size-check's frequency note). Spending 1.5 extra seconds of blocked
//     main thread per write to reclaim 327KB of a quota that is already 79%
//     empty is a bad trade, and it is a worse one 80 times during a drag.
//   - lz-string's densest variant emits code units across the whole 16-bit
//     range, lone surrogates included — measured, not assumed. localStorage
//     tolerates that in practice; it is still an invalid-UTF-16 string sitting
//     in a player's browser for no benefit this project needs.
//
// ⚠ AND THE OUTPUT IS ASCII BY CONSTRUCTION, WHICH IS WORTH MORE THAN THE
// RATIO IT COSTS. Because base64's alphabet is ASCII, the stored byte count
// EQUALS the string length for every possible save, so the size gate cannot be
// wrong about storage the way it would be if it measured a UTF-16 payload.
// That holds even if a member's name is non-ASCII: the raw JSON would be, the
// stored payload still is not.
//
// ============================================================================
// THE BUDGET, RE-DERIVED — 1,500,000 CHARACTERS.
//
// The old 4,000,000 was 76% of the measured quota, and carrying it forward
// would leave a gate that reads 27% and never fires again. A threshold that
// cannot go red is worse than the red it replaced. So:
//
//   reachable worst case    1,097,556 chars   (10 years x 3 lines, defaults)
//   budget                  1,500,000 chars   1.37x the worst case
//   measured quota          5,242,613 chars   the budget is 29% of it
//
// Two margins, and they answer different questions.
//
//   AGAINST GROWTH: 1.37x, which is a FEATURE that adds a third to the save.
//   That is now the right frame and "one more game-year" is not. The old budget
//   was set a game-year ahead of the player because the save grew with play and
//   the player could out-run it; at 68k compressed characters per game-year the
//   budget is 5.9 further years past 10, and 10 is the most the setup slider
//   offers, so a player can no longer reach it by playing. What can reach it is
//   another ledger — the experience modifier's added 5.9% to the raw payload
//   and is what took this gate red in the first place, so the margin is roughly
//   six more features of that shape.
//
//   ⚠ WHICH MEANS THE GATE'S JOB CHANGED, AND PRETENDING OTHERWISE WOULD BE
//   THE MISTAKE. It used to be a quota alarm. It is now a growth tripwire, and
//   it is set tight enough to be one — 73% of budget at the worst reachable
//   save, against 96% before this commit and 101% after the modifier landed.
//
//   AGAINST THE ACCOUNTING THIS PROJECT COULD NOT MEASURE: the header above
//   says other engines were not reachable and may charge differently. The worst
//   plausible difference is two bytes per character for ASCII as well. At that
//   accounting 1,500,000 characters is 3,000,000 bytes, which is 57% of the
//   measured 5 MiB — still safe, where the old budget under the same pessimism
//   would have been 8,000,000 bytes and over the line.
// ============================================================================

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

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
 *
 * ⚠ THE REPLACER MATCHES ON KEY NAME AT ANY DEPTH, SO THIS COVERS priorHistory
 * TOO, and that is worth stating because it is invisible from the key list.
 * `priorHistory` is a `ResultSet[]` like `lockedResults`, so the pre-game
 * accident years -2..0 carry their own claim registers — measured at 1.29 MiB of
 * a 1.86 MiB priorHistory, roughly 1,300 claims across three years and three
 * lines. They are stripped on the same terms as the game years. Had they not
 * been, the save would have been keeping the pre-game detail while discarding
 * the game's own, which is backwards, and it would have been inside the figure
 * save-size-check asserts against.
 *
 * ⚠ `pricingTriangle` IS HERE FOR A DIFFERENT REASON FROM THE OTHERS — not size,
 * but DERIVABILITY. It is a pure projection of LinePoolState.reserveDevelopment
 * plus the roster and membership history, every one of which the save already
 * carries, and processYear rebuilds it on the far side of a reload. Persisting
 * it would put a second copy of the ledger in the save, and a second copy is a
 * thing that can disagree with the first. Store the inputs, not the output —
 * Ruling 8, and the same argument claimRegeneration.ts makes for the register.
 *
 * ⚠ `memberPremiumShares` IS HERE ON pricingTriangle's GROUNDS, NOT ON SIZE.
 * It is one row per enrolled member per line-year and would cost roughly a
 * tenth of what memberLossResults does, so size alone would not exclude it.
 * It is excluded because it is a pure function of inputs the save already
 * carries — the roster, the enrolled list, the year and poolPremium — and
 * `allocateMemberPremium` rebuilds it from them exactly. A stored copy is a
 * second copy that can disagree with the first, and the disagreement it would
 * produce is the worst kind: a member's BILL, restored from a stale row after
 * the class rates moved.
 *
 * ⚠ `primaryLoss` IS HERE ON SIZE, WHICH MAKES IT THE ODD ONE OUT. It is the
 * per-claim primary layer on each MemberLossResult, and it is a pure
 * duplicate: processYear copies it straight into memberLossHistory, which IS
 * saved, and nothing reads the result-row copy afterwards. Keeping both cost
 * a measured 213,555 chars across the two — 5.3 points of budget, taking the
 * save from 94% to 99% — against 72,799 for the ledger copy alone. At 99%
 * there is no headroom left for anything, so the duplicate goes and the
 * durable copy stays. THIS IS WHY THE TWO FIELDS HAVE DIFFERENT NAMES: the
 * stripper matches by key name at any depth, so one name could not have kept
 * the ledger entry and dropped the result row.
 *
 * ⚠ THE EXPERIENCE MODIFIER ADDED A FOURTH INPUT AND IT IS NOT FULLY
 * RECOVERABLE, SO THE PARAGRAPH ABOVE IS NARROWER THAN IT READS. A share row
 * now carries `experienceMod`, which is a function of memberLossHistory AS IT
 * STOOD BEFORE THAT YEAR. The save keeps the ledger, but only its CURRENT
 * state and only LOSS_HISTORY_CAP_YEARS of it — so the window ending at N-1
 * can be rebuilt for recent years and has been pruned away for old ones.
 * Reconstruction therefore works near the present and degrades with age
 * rather than being exact for every year.
 *
 * That is not a reason to store the rows. A stale bill is still worse than an
 * absent one, and a stored row would need the mod's inputs frozen alongside
 * it to mean anything. It is a reason not to promise an exact rebuild of
 * year 2's bills in year 12.
 *
 * ⚠ SO A CONSUMER THAT WANTS IT FOR A LOCKED YEAR MUST CALL THE ALLOCATOR,
 * and must pass the mods itself if it wants the real bill rather than the
 * class-only split. Reading `result.memberPremiumShares` on a reloaded game
 * returns undefined for every year processed before the reload, and a page
 * that renders it directly would silently blank — the same degradation the
 * note above keeps memberLossResults out of this list to avoid. Nothing
 * renders it today; the day something does, that page calls the allocator, or
 * this entry comes out and the staleness problem comes back with it.
 */
export const SAVE_STRIPPED_KEYS: readonly string[] = [
  'claims', 'occurrences', 'marketMemberLossResults', 'pricingTriangle',
  'memberPremiumShares', 'primaryLoss',
];

/** Measured against a real Chromium — see the header. Not a spec figure. */
export const MEASURED_QUOTA_CHARS = 5_242_613;

/**
 * The CI threshold, ON THE COMPRESSED PAYLOAD — see THE BUDGET, RE-DERIVED.
 *
 * ⚠ THIS IS NOT THE OLD 4,000,000 SCALED DOWN. It is 1.37x the reachable worst
 * case, chosen so the gate keeps firing on growth rather than reading 27% and
 * going quiet, and it survives the two-bytes-per-character accounting the quota
 * measurement could not rule out.
 */
export const SAVE_BUDGET_CHARS = 1_500_000;

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
 * String.fromCharCode.apply's argument count. 8,192 rather than the ~65,000 V8
 * tolerates: the spread is the only part of this codec that can blow a stack,
 * and the chunk loop costs nothing measurable at either size.
 */
const B64_CHUNK = 8192;

/**
 * JSON in, storable ASCII out. DEFLATE, then base64.
 *
 * ⚠ btoa AND atob RATHER THAN A HAND-ROLLED BASE64, AND IT IS NOT A STYLE
 * PREFERENCE. Both are globals in every browser and in Node 16+, so the gates
 * and the app run the same code — and the engine's implementation measured 8x
 * faster than the obvious loop (10.4 ms against 79.2 ms on the worst save),
 * which on a write path this hot is the difference between noticeable and not.
 */
export function encodeSave(json: string): string {
  const deflated = deflateSync(strToU8(json), { level: 6 });
  let binary = '';
  for (let i = 0; i < deflated.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(
      null, deflated.subarray(i, i + B64_CHUNK) as unknown as number[],
    );
  }
  return btoa(binary);
}

/**
 * The inverse. THROWS on anything that is not a payload this codec produced.
 *
 * ⚠ THERE IS NO FORMAT DETECTION, NO DUAL PATH AND NO MIGRATION, AND THE
 * THROW IS THE DESIGNED BEHAVIOUR RATHER THAN AN UNHANDLED CASE. A save
 * written before this commit is raw JSON: it opens with `{`, which is not in
 * base64's alphabet, so atob rejects it here and App.tsx's loader clears the
 * key and starts a new game. That is the intended outcome — nobody is mid-game
 * on an uncompressed save that matters, and a dual-path loader would be a
 * permanent second format to keep working for a one-off that has already
 * passed. A save that reaches inflateSync but is not a DEFLATE stream throws
 * there, for the same reason and to the same effect.
 */
export function decodeSave(payload: string): string {
  let bytes: Uint8Array;
  try {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    throw new Error(
      '[save] the stored value is not base64, so it is not a compressed save. '
      + 'Saves written before the save was compressed are discarded by design.',
    );
  }
  return strFromU8(inflateSync(bytes));
}

/**
 * The envelope as it goes to storage: stripped, serialised, compressed.
 *
 * ⚠ THIS IS THE FIGURE THE BUDGET IS ABOUT, and serialiseSave's is not. The
 * size gate measures this one; the round-trip gate goes out and back through
 * this one. Measuring the pre-compression string would be the reportedYear
 * mistake — a value produced and never compared proves nothing about itself.
 */
export function packSave(env: SaveEnvelope): string {
  return encodeSave(serialiseSave(env));
}

/** Storage payload back to the parsed envelope. Throws — see decodeSave. */
export function unpackSave(payload: string): unknown {
  return JSON.parse(decodeSave(payload));
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
  const payload = packSave(env);
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
