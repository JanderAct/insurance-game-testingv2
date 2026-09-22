// ============================================================================
// HOW OFTEN TO ASK — the back-off policy, as a pure function of one fact.
//
// ⚠ ELEVEN CLIENTS AT THREE SECONDS FOR TWO HOURS IS 26,400 REQUESTS, each
// returning the WHOLE room. That is nothing on AWS and it is a real problem on
// conference wifi, which is where this is actually played: a room full of people
// on one access point, every browser asking for the same growing payload twenty
// times a minute whether or not anything happened.
//
// ⚠ AND THE FLOOR MATTERS MORE THAN THE CEILING. The moment that decides whether
// this layer feels alive is the minute after an advance: every browser is
// computing and posting, and the host is watching the table fill. A flat
// ten-second poll would make a team take up to ten seconds to appear, which is
// the difference between a screen that is live and one that is stale. So the
// rule is not "poll slowly" — it is POLL FAST WHILE THINGS ARE HAPPENING, and
// decay only once the room has genuinely been still.
//
// ⚠ WHAT COUNTS AS "SOMETHING HAPPENED" IS `rev`, AND IT ALREADY EXISTED. The
// room carries a revision that increments on every write and nothing else. It is
// exactly the signal this needs, it costs nothing to compare, and using anything
// else — a diff of the room, a timestamp, a guess from the status — would be a
// second opinion about the thing rev is already authoritative for.
//
// ⚠ GROWTH IS GENTLE ON PURPOSE. At 1.5x the cadence is 3s, 4.5s, 6.75s, 10s: a
// room has to be still for about fourteen seconds before it reaches the ceiling,
// and ONE change drops it straight back to the floor. A harsher factor would
// save a few more requests and would spend them in the only place that hurts.
// ============================================================================

export interface PollSchedule {
  /** The floor, and where every change resets to. */
  minMs: number;
  /** The ceiling, reached after a few unchanged reads. */
  maxMs: number;
  /** Multiplier applied per unchanged read. */
  growth: number;
}

export const POLL: PollSchedule = { minMs: 3000, maxMs: 10000, growth: 1.5 };

/**
 * The delay before the next read.
 *
 * ⚠ A FAILED READ BACKS OFF RATHER THAN RESETTING. An error is not a change, and
 * a client that sped up on failure would hammer whatever is already struggling —
 * the one case where the back-off is worth more than the freshness.
 */
export function nextPollDelay(currentMs: number, changed: boolean, s: PollSchedule = POLL): number {
  if (changed) return s.minMs;
  return Math.min(s.maxMs, Math.round(currentMs * s.growth));
}

/**
 * A schedule from the single interval a caller asks for.
 *
 * ⚠ AN INTERVAL SLOWER THAN THE CEILING IS NOT SPED UP. HostScreen polls once an
 * hour before a room exists; treating that as a floor to decay FROM would make
 * the back-off a speed-up, which is the opposite of the point.
 */
export function scheduleFor(intervalMs: number, s: PollSchedule = POLL): PollSchedule {
  return { minMs: intervalMs, maxMs: Math.max(intervalMs, s.maxMs), growth: s.growth };
}
