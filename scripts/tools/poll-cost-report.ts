// ============================================================================
// WHAT THE POLL COSTS, OVER A REAL TWO HOURS — before and after the back-off.
//
// ⚠ IT SIMULATES THE SCHEDULE, NOT THE POLICY. nextPollDelay is imported from
// the app rather than restated here, so this measures the code that ships. What
// is modelled is the SESSION: when teams lock, when the host advances, when
// results land — because the saving depends entirely on how often the room is
// actually still, and a model that assumed a quiet room would report the
// ceiling rather than the truth.
//
// ⚠ THE BYTES ARE MEASURED, NOT GUESSED. The per-team-per-year payload comes
// from the two-team eight-year browser run (storage-2x8): the room record's
// results portion grew 2,346 -> 13,404 chars over eight years for two teams, so
// a team's own share is the halves of that series. Years 9 and 10 extrapolate
// its increments, which are smooth and slightly growing because each post
// carries one more accident year in its developed column. DECISIONS ARE NOT IN
// THE READ PAYLOAD — `read` redacts them — so they are excluded here, which is
// why these numbers are smaller than the record on disk.
//
//   npx tsx scripts/tools/poll-cost-report.ts
// ============================================================================

import { nextPollDelay, POLL, scheduleFor } from '../../src/session/client/pollSchedule';

const MIN = 60_000;
const SESSION_MS = 120 * MIN;
const TEAMS = 10;
const YEARS = 10;

// ---- the session's shape -------------------------------------------------
//
// Ten years in two hours: about twelve minutes a year. Teams lock over the first
// eight minutes of each year, the host advances, and the results land in the
// minute after. Every one of those is a write, and a write is a rev bump.
function revBumps(): number[] {
  const bumps: number[] = [];
  // Joins, and each team's opening position, over the first two minutes.
  for (let i = 0; i < TEAMS; i++) {
    bumps.push(5_000 + i * 6_000);        // join
    bumps.push(20_000 + i * 6_500);       // the year-0 post
  }
  const yearWindow = (SESSION_MS - 2 * MIN) / YEARS;
  for (let y = 1; y <= YEARS; y++) {
    const start = 2 * MIN + (y - 1) * yearWindow;
    for (let i = 0; i < TEAMS; i++) bumps.push(start + (i + 1) * (8 * MIN / (TEAMS + 1)));  // locks
    bumps.push(start + 8 * MIN);                                                            // the advance
    for (let i = 0; i < TEAMS; i++) bumps.push(start + 8 * MIN + 4_000 + i * 3_000);        // results
  }
  return bumps.filter(t => t < SESSION_MS).sort((a, b) => a - b);
}

// ---- the payload ---------------------------------------------------------

// MEASURED per team, cumulative results bytes after k played years (k = 0 is the
// opening position alone). Years 9-10 extrapolate the increment series.
const PER_TEAM_RESULTS = [514, 1173, 1832, 2537, 3284, 4071, 4902, 5781, 6702, 7667, 8677];
const ROOM_HEADER = 400;      // code, status, seed, event name, counts, rev, timestamps
const PER_TEAM_HEADER = 150;  // name, lines, joined, lockedYear, locked, resultYear

function playedYearsAt(t: number): number {
  const yearWindow = (SESSION_MS - 2 * MIN) / YEARS;
  if (t < 2 * MIN) return 0;
  return Math.min(YEARS, Math.floor((t - 2 * MIN) / yearWindow));
}

function teamsAt(t: number): number {
  return Math.min(TEAMS, Math.max(0, Math.floor((t - 5_000) / 6_000) + 1));
}

/** The bytes one `read` returns at time t. */
function payloadAt(t: number): number {
  const k = playedYearsAt(t);
  return ROOM_HEADER + teamsAt(t) * (PER_TEAM_HEADER + PER_TEAM_RESULTS[Math.min(k, PER_TEAM_RESULTS.length - 1)]);
}

// ---- the pollers ---------------------------------------------------------

interface Result { requests: number; bytes: number; unchanged: number }

function simulate(kind: 'fixed' | 'backoff', intervalMs: number, bumps: number[], startAt: number): Result {
  const schedule = scheduleFor(intervalMs);
  let t = startAt;
  let last = startAt;
  let delay = schedule.minMs;
  let requests = 0, bytes = 0, unchanged = 0;
  while (t < SESSION_MS) {
    requests++;
    bytes += payloadAt(t);
    const moved = bumps.some(b => b > last && b <= t);
    if (!moved) unchanged++;
    last = t;
    delay = kind === 'fixed' ? intervalMs : nextPollDelay(delay, moved, schedule);
    t += delay;
  }
  return { requests, bytes, unchanged };
}

// ⚠ A HOST TAB POLLS TWICE, AND THAT IS NOT A MODELLING CHOICE. HostScreen reads
// the room to title its bar and HostRoomScreen reads it to render the table;
// they are two useRoom instances on one code, each with its own timer. The
// back-off applies to both, so the saving is proportional — but the duplication
// is real and is worth a separate fix.
const POLLERS = [
  { label: 'host tab (chrome)', startAt: 0 },
  { label: 'host tab (table)', startAt: 1_500 },
  ...Array.from({ length: TEAMS }, (_, i) => ({ label: `team ${i + 1}`, startAt: 5_000 + i * 6_000 })),
];

// ---- the cadence itself, stated rather than implied -----------------------
{
  const s = scheduleFor(POLL.minMs);
  const walk: number[] = [];
  let d = s.minMs;
  for (let i = 0; i < 5; i++) { walk.push(d); d = nextPollDelay(d, false, s); }
  console.log(`\nTHE CADENCE: still room ${walk.map(v => v / 1000).join('s -> ')}s  (ceiling ${s.maxMs / 1000}s)`);
  console.log(`             one change  ${nextPollDelay(s.maxMs, true, s) / 1000}s — straight back to the floor`);
  // The gaps BEFORE the first read at the ceiling: how long the room must have
  // been quiet before anybody is waiting the full ten seconds.
  const toCeiling = walk.filter(v => v < s.maxMs).reduce((a, b) => a + b, 0) / 1000;
  console.log(`             ${toCeiling}s of stillness before any read waits the full ${s.maxMs / 1000}s`);
}

const bumps = revBumps();
const kb = (n: number) => (n / 1024).toFixed(0);
const mb = (n: number) => (n / 1_048_576).toFixed(1);

function total(kind: 'fixed' | 'backoff', intervalMs: number): Result {
  return POLLERS.reduce<Result>((acc, p) => {
    const r = simulate(kind, intervalMs, bumps, p.startAt);
    return { requests: acc.requests + r.requests, bytes: acc.bytes + r.bytes, unchanged: acc.unchanged + r.unchanged };
  }, { requests: 0, bytes: 0, unchanged: 0 });
}

const before = total('fixed', POLL.minMs);
const after = total('backoff', POLL.minMs);
const ceiling = total('fixed', POLL.maxMs);

console.log(`\nA TWO-HOUR SESSION: ${TEAMS} teams + a host tab (which polls twice), ${YEARS} years`);
console.log(`${bumps.length} writes to the room over the session — the moments a poll can learn anything\n`);

const row = (label: string, r: Result) =>
  console.log(`  ${label.padEnd(26)} ${String(r.requests).padStart(6)} requests   ${mb(r.bytes).padStart(6)} MB   ${String(r.unchanged).padStart(6)} of them unchanged`);

row(`every ${POLL.minMs / 1000}s (before)`, before);
row(`back-off ${POLL.minMs / 1000}-${POLL.maxMs / 1000}s (after)`, after);
row(`every ${POLL.maxMs / 1000}s (the ceiling)`, ceiling);

const pct = (a: number, b: number) => `${(100 * (1 - a / b)).toFixed(1)}%`;
console.log(`\n  saved by the back-off:      ${before.requests - after.requests} requests (${pct(after.requests, before.requests)}), ${mb(before.bytes - after.bytes)} MB (${pct(after.bytes, before.bytes)})`);
console.log(`  what a FLAT ${POLL.maxMs / 1000}s would imply:  ${pct(ceiling.requests, before.requests)} — and it is not reached, because`);
console.log(`  the room is busy: ${after.unchanged} of ${after.requests} reads after the change found nothing,`);
console.log(`  so most polls are at or near the floor exactly when they should be.`);

// ---- what the version check would add on top -----------------------------
//
// NOT IN THIS COMMIT, and the two compound: the back-off removes requests, the
// version check empties the ones that remain. A 304 is headers only.
const NOT_MODIFIED = 200;
const withRev = (r: Result, full: Result) => {
  const changedReads = r.requests - r.unchanged;
  const avg = full.bytes / full.requests;
  return changedReads * avg + r.unchanged * NOT_MODIFIED;
};
console.log(`\nWITH THE rev VERSION CHECK ON TOP (not in this commit):`);
console.log(`  back-off + 304s:            ${after.requests} requests   ${mb(withRev(after, after))} MB`);
console.log(`  version check alone:        ${before.requests} requests   ${mb(withRev(before, before))} MB`);
console.log(`  together against the base:  ${pct(withRev(after, after), before.bytes)} of the bytes gone\n`);
console.log(`  (payload at the end of the session: ${kb(payloadAt(SESSION_MS - 1))} KB per read)`);
