// ============================================================================
// THE DYNAMODB KEY DESIGN FOR THE SESSION LAYER — AND THE ONLY PLACE A KEY IS
// BUILT.
//
// ⚠ THIS FILE IS AUTHORITATIVE. docs/SESSION_DYNAMODB.md is a summary of it for
// whoever provisions the table; where the two disagree, this file is right and
// the note is stale. The design lives here rather than in httpTransport.ts
// (whose list is what the CLIENT cannot fix) or the stub server (whose header
// says nothing in it survives) because anyone writing the Lambda has to import
// this module to build any key — so this header is where they will be standing.
//
// ⚠ NOTHING IMPORTS IT YET. It records a design; no handler exists. Every value
// below that is a size or a count says whether it was MEASURED, DERIVED or
// ESTIMATED, because on this project those have been confused before and it
// cost a re-solve each time.
//
// ============================================================================
// ONE TABLE. ONE PARTITION PER ROOM.
//
//   PK = ROOM#<code>            every item of a room shares it
//
//   SK                          holds
//   ------------------------    ------------------------------------------------
//   ROOM                        THE HEADER. seed, eventName, yearCount,
//                               startingYear, expectedTeams, shocks,
//                               currentYear, rev, createdAt, updatedAt,
//                               hostTokenHash, and the ROSTER:
//                                 { [teamId]: { name, lines, joined, lockedYear,
//                                               tokenHash, posted: { [year]: true } } }
//   NAME#<trimmed team name>    { teamId }. Exists only so a name is claimed once.
//   D#<teamId>#<yyy>            one team's DECISIONS for one year (opaque JSON).
//   R#<teamId>#<yyy>            one team's RESULT for one year (TeamYearSummary).
//                               Year 000 is the opening position.
//   VIEW#<tokenHash>            { teamId, expiresAt } for one viewer.
//
// WHY THIS SHAPE, point by point:
//
//   * THE ROSTER IS IN THE HEADER because every `read` fetches the header
//     anyway (it carries `rev`, the ETag), so resolving a host or player token
//     costs no extra call. Tokens are stored HASHED; the header is never
//     returned raw.
//   * TEAMS ARE KEYED BY A RANDOM teamId, NOT BY NAME. Names are user text and
//     may contain '#'. Uniqueness comes from the NAME# item instead, keyed on
//     the name exactly as localTransport compares it today: trimmed, CASE-
//     SENSITIVE. Case-folding would be a behaviour change and a separate
//     decision.
//   * DECISIONS AND RESULTS ARE SEPARATE PREFIXES, NOT NESTED UNDER THE TEAM.
//     That makes the host's whole read ONE contiguous range (begins_with R#)
//     and keeps decisions physically out of the host's query, so "the host
//     never sees a team's decisions" does not depend on a filter someone could
//     forget. It is still enforced in code, not by the key — see HARD, 6.
//   * VIEWERS ARE THEIR OWN ITEMS because the viewer list grows with the number
//     of watchers, not with teams or years, and has no business in the header.
//   * `status` IS NOT STORED. It is derived from currentYear and the roster, as
//     localTransport derives it today; storing it would be one more field to
//     keep in step.
//   * YEARS ARE PADDED TO THREE DIGITS so the sort order holds past 99. padYear
//     below refuses anything else rather than truncating.
//
// ============================================================================
// SIZES AT TEN TEAMS BY TEN YEARS.
//
//   item            size                       basis
//   --------------  -------------------------  -----------------------------
//   ROOM header     ~3 KB                      ESTIMATED from field counts:
//                                              ~0.5 KB fixed + shocks + ~250 B
//                                              per roster entry.
//   D# per year     ~1.05 KB                   DERIVED BY SUBTRACTION: the
//                                              31 KB 2-team x 8-year record,
//                                              less 13.4 KB of results and the
//                                              headers, over 16 team-years.
//                                              Not measured directly.
//   R# per year     0.5 KB (year 0) rising     MEASURED: poll-cost-report.ts's
//                   to ~1.0 KB (year 10)       per-team series from the 2x8
//                                              browser run — 514 B at year 0,
//                                              659 B for year 1, growing ~45 B
//                                              a year because each post carries
//                                              one more accident year in its
//                                              developed column. Years 9 and 10
//                                              are that tool's EXTRAPOLATION.
//                                              10 teams x 8,677 B = ~87 KB.
//   NAME#, VIEW#    ~0.1 KB each               ESTIMATED.
//   partition       ~200 KB                    DERIVED: the sum of the above.
//
// ⚠ THE MEASURED FIGURES ARE JSON CHARACTERS, NOT DYNAMODB ITEM BYTES. DynamoDB
// counts attribute names plus values in UTF-8, which is the same order of
// magnitude but not the same number. No item is anywhere near the 400 KB cap;
// the largest is the header at ~3 KB, and it only outgrows the cap at roughly
// 1,500 teams.
//
// ============================================================================
// CONDITIONAL WRITES — EACH GUARDED ON WHAT IT ACTUALLY DEPENDS ON.
//
//   endpoint            write                                   condition
//   ------------------  --------------------------------------  -------------------------
//   createRoom          Put ROOM                                attribute_not_exists(PK)
//                                                               — a code collision fails
//                                                               and the server redraws
//   join, new team      Transact: Put NAME#, Update ROOM        NAME# not exists
//                       (roster entry, ADD rev)                 (else TEAM_TAKEN); ROOM
//                                                               exists
//   join, rejoin        none                                    token hash matches the
//                                                               roster; lines match
//                                                               (else LINES_LOCKED)
//   join, viewer        Put VIEW# only                          none — viewers are not in
//                                                               RoomView, so rev does not
//                                                               move
//   submit, decisions   Transact: Update ROOM (lockedYear,      currentYear = :y
//                       ADD rev), Put D#
//   submit, result      Transact: Update ROOM (posted.<y>,      currentYear >= :y AND
//                       ADD rev), Put R#                        :y >= 0
//   advance             Update ROOM only: currentYear = :e+1,   currentYear = :e AND
//                       ADD rev                                 currentYear <= yearCount
//                                                               AND hostTokenHash = :h
//
// ⚠ THE DECISIONS CONDITION MATTERS AS MUCH AS ADVANCE'S. Today the lock makes
// "check the year, then write" atomic. Split across items without that
// condition, a year-3 decision could land AFTER year 3 was processed, and a
// reloaded client would replay numbers nobody played — the slot-history bug
// that made decisions a history in the first place, back by another door.
//
// ⚠ ADVANCE'S COMPARE-AND-SWAP IS ON THE HEADER AND NOWHERE ELSE. It touches
// no team item: "locked" is derived as lockedYear === currentYear, so a new
// year needs no reset. On ConditionalCheckFailed, read the old header
// (ReturnValuesOnConditionCheckFailure = ALL_OLD) and decide:
//   already at :e + 1   -> the request was a retry; return success and the room
//   past yearCount      -> GAME_COMPLETE
//   host hash mismatch  -> NOT_HOST
//   anything else       -> WRONG_YEAR
// It needs AdvanceRequest to carry :e, which it does not yet — see contract.ts.
//
// ============================================================================
// ⚠ rev IS NOT THE WRITE GUARD. httpTransport.ts item 8 and the stub server's
// header used to say it should be, and that is superseded here.
//
// rev stays monotonic per write and stays the ETag. It is bumped with an
// unconditional ADD inside each write's transaction. It is NOT a
// ConditionExpression on any write, because guarding writes on rev makes every
// write in a room conditional on one value: any two teams writing at once
// conflict and retry, which is exactly the contention the header-plus-items
// split exists to remove. Once writes are per item there is no whole-room
// read-modify-write left to guard; each write is guarded on the field it
// depends on — currentYear, or whether a key exists.
//
// Nor is rev the right guard for advance even there: a host who read at rev r
// and clicked would be refused whenever any team posted in between, and in the
// minute after an advance teams are posting constantly. The expected YEAR is
// the guard; rev is only how a poller knows something moved.
//
// ============================================================================
// READ — ONE ENDPOINT, ONE CLIENT CALL, THE QUERY CHOSEN BY ROLE.
//
//   1. BatchGetItem [ROOM, VIEW#<hash(token)>] — resolves every role in one
//      round trip. If rev equals the client's If-None-Match, answer 304 here.
//   2. By role:
//        host       Query begins_with R#              ~87 KB at 10x10
//        player     Query begins_with D#<teamId>#     ~11 KB; postedYears come
//                                                     from the roster
//        viewer     as the player it watches
//        anonymous  the header alone, token hashes stripped
//
// The response SHAPE does not change. What changes: players and anonymous
// callers stop receiving other teams' resultsByYear, which no screen of theirs
// reads — see the note at localTransport's teamView, where that over-send lives
// on the current build.
//
// ⚠ EVERY READ IS STRONGLY CONSISTENT (ConsistentRead = true), AND THIS IS WHY.
// A poller that sees a new rev on the header and then gets a STALE query would
// store that new rev as its ETag — and every later poll would 304 against it,
// so the missed item is never fetched. That is the lost-update bug in its fourth
// form: the first was four tabs sharing localStorage, the second the transport
// with nothing to serialise, the third Lambda's parallel invocations. For the
// same reason the read path uses NO secondary index: a GSI cannot be read
// strongly consistently.
//
// ============================================================================
// WHAT THIS DESIGN MAKES HARD — six things, most important first.
//
//   1. TEAM COUNT x BURSTINESS BREAKS FIRST, NOT YEARS. Every write goes
//      through the header. Results arrive in a burst: every client sees the
//      advance on its next poll and posts within seconds. Two transactions on
//      one item at once conflict and one retries. At 10-12 teams that is
//      occasional; at 50+ posting inside a second or two it is sustained
//      retries and visible latency. Each write also pays for the WHOLE header's
//      size, which grows with the roster (~3 KB at 10 teams, ~25 KB at 100).
//      Escape hatch if it ever matters: results stop touching the header —
//      postedYears comes from a Query of R#<teamId>#, rev becomes an
//      unconditional ADD outside the transaction.
//   2. ANY QUESTION ACROSS ROOMS. Rooms by host, rooms active this week, an
//      admin list: each is a table Scan. A GSI added later fixes it, but only
//      for questions chosen in advance, and a GSI is eventually consistent.
//   3. DELTAS. The ETag is all-or-nothing: any change and the host refetches
//      every result. A `sinceRev` read needs each item stamped with the rev
//      that wrote it, which a write cannot know without guarding on rev —
//      which is point 1's problem. Affordable (~10 MB a session to the host);
//      not cheap to change later.
//   4. A SCOREBOARD FOR PLAYERS. The growth direction to watch hardest. If
//      players are ever shown other teams, every player's poll becomes
//      host-sized — ~87 KB x every client x every change. That wants a small
//      per-team "latest figures" entry in the header, not the full history.
//   5. REMOVING A ROOM. It is ~220 items, not one. Every item needs its own
//      TTL attribute stamped from the header's expiry, and an explicit delete
//      is a Query followed by batched deletes.
//   6. PRIVACY IS ENFORCED BY CODE, NOT BY KEYS. The layout keeps decisions out
//      of the host's query, but nothing in DynamoDB stops a handler reading D#
//      for the host. It is a handler rule and needs the harness to hold it.
//
// ============================================================================
// CONTRACT GAPS THIS DESIGN ASSUMES CLOSED — recorded at contract.ts, not
// fixed there: advance needs the expected year; join and createRoom need a
// client-generated token so a retried create is recognisable as the same one.
// ============================================================================

/** DynamoDB's hard limit on a sort key, in UTF-8 bytes. */
const MAX_SORT_KEY_BYTES = 1024;

/** Years are padded to this many digits so lexicographic order is numeric order. */
const YEAR_DIGITS = 3;

/** The header's sort key. */
export const ROOM_HEADER_SK = 'ROOM';

/** The prefix under which every team's results sort together — the host's range. */
export const RESULT_PREFIX = 'R#';

/**
 * A year as three digits. Year 0 is legal — it is the opening position — and
 * a negative year is refused, as the contract refuses it. Anything past 999 is
 * refused rather than widened, because a fourth digit would sort "1000" before
 * "999" and silently reorder the history.
 */
export function padYear(year: number): string {
  if (!Number.isInteger(year) || year < 0 || year >= 10 ** YEAR_DIGITS) {
    throw new RangeError(`Year must be an integer from 0 to ${10 ** YEAR_DIGITS - 1}; got ${year}.`);
  }
  return String(year).padStart(YEAR_DIGITS, '0');
}

// A teamId is minted by the server, so it can be held to a shape that cannot
// break the key: no '#', which is the separator.
function checkTeamId(teamId: string): string {
  if (teamId.length === 0 || teamId.includes('#')) {
    throw new RangeError(`A teamId must be non-empty and contain no '#'; got ${JSON.stringify(teamId)}.`);
  }
  return teamId;
}

function checkSortKey(sk: string): string {
  if (new TextEncoder().encode(sk).length > MAX_SORT_KEY_BYTES) {
    throw new RangeError(`Sort key exceeds DynamoDB's ${MAX_SORT_KEY_BYTES}-byte limit.`);
  }
  return sk;
}

/** The partition key every item of one room shares. */
export function roomPk(code: string): string {
  if (code.length === 0) throw new RangeError('A room code must be non-empty.');
  return `ROOM#${code}`;
}

/**
 * The name-claim item. Trimmed and case-sensitive, matching how
 * localTransport compares names today; '#' inside a name is harmless here
 * because this key is only ever read or written whole, never by prefix.
 */
export function nameSk(teamName: string): string {
  const trimmed = teamName.trim();
  if (trimmed.length === 0) throw new RangeError('A team name must be non-empty.');
  return checkSortKey(`NAME#${trimmed}`);
}

/** One team's decisions for one year. */
export function decisionSk(teamId: string, year: number): string {
  return `D#${checkTeamId(teamId)}#${padYear(year)}`;
}

/** Every decision of one team — a player's (and its viewers') read range. */
export function decisionPrefix(teamId: string): string {
  return `D#${checkTeamId(teamId)}#`;
}

/** One team's result for one year; year 0 is the opening position. */
export function resultSk(teamId: string, year: number): string {
  return `${RESULT_PREFIX}${checkTeamId(teamId)}#${padYear(year)}`;
}

/** One viewer, keyed by the hash of its token. */
export function viewerSk(tokenHash: string): string {
  if (tokenHash.length === 0) throw new RangeError('A token hash must be non-empty.');
  return checkSortKey(`VIEW#${tokenHash}`);
}
