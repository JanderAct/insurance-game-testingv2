// ============================================================================
// THE DEBOUNCE COALESCES A DRAG AND NEVER LOSES A DECISION.
//
// Run:  npx tsx scripts/diagnostics/save-debounce-check.ts
//
// ⚠ THIS GATE EXISTS BECAUSE A DEBOUNCE'S FAILURE MODE IS SILENCE. A value that
// never reaches storage is indistinguishable from one that did, right up until
// the player reloads and finds their last decision missing — the same shape as
// the defect gameSave.ts was written for, where two years of a game evaporated
// with no symptom. The write being correct says nothing about WHEN it happens,
// and "when" is now stateful and clocked.
//
// THE PROPERTY, IN ONE LINE: after the player stops moving, storage holds the
// LAST value they set. Not an earlier one, not none.
//
// ⚠ AND IT RUNS ON A FAKE CLOCK, WHICH IS WHY saveScheduler TAKES ONE. A gate
// that used the real setTimeout would either sleep 400 ms per assertion or race
// it. The clock here is a counter and a queue, so "advance past the debounce"
// is exact and the whole file runs in milliseconds.
//
// WHAT THIS DOES NOT CHECK, STATED SO IT IS NOT ASSUMED AWAY:
//   - THE BROWSER EVENTS. This gate proves flush() does the right thing when
//     called. That visibilitychange and pagehide CALL it lives in App.tsx's
//     effect and is not callable from node.
//     ⚠ save-flush-wiring-check NOW COVERS THE WIRING STATICALLY — both
//     listeners registered, both handlers reaching flush(), both removed in
//     cleanup, and the visibilitychange handler guarded on 'hidden'. So the gap
//     is no longer "the wiring might not exist"; it is "the wiring exists and
//     the browser's behaviour is assumed". Smaller, and still a gap: whether
//     those events fire when expected, and whether a 214 ms synchronous write
//     completes inside one on a backgrounding mobile tab, is not testable here.
//   - WHAT A WRITE COSTS. save-size-check owns the wall-clock figure and the
//     before/after drag arithmetic.
// ============================================================================

import { createSaveScheduler, SAVE_DEBOUNCE_MS, type SchedulerClock } from '../../src/utils/saveScheduler';

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const RULE = '='.repeat(72);

/** A counter and a queue. `at` is absolute; nothing runs until advance() passes it. */
function fakeClock() {
  let nowMs = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SchedulerClock = {
    setTimer(fn, ms) { const id = nextId++; timers.set(id, { at: nowMs + ms, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
  };
  return {
    clock,
    advance(ms: number) {
      const target = nowMs + ms;
      // Fire in time order, and allow a timer to schedule another.
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].at <= target && (due === null || e[1].at < due[1].at)) due = e;
        if (due === null) break;
        timers.delete(due[0]);
        nowMs = due[1].at;
        due[1].fn();
      }
      nowMs = target;
    },
    live: () => timers.size,
  };
}

/** A scheduler wired to a recorder, so every write is a row. */
function rig(delay = SAVE_DEBOUNCE_MS) {
  const writes: string[] = [];
  const fc = fakeClock();
  const s = createSaveScheduler<string>(v => { writes.push(v); }, fc.clock, delay);
  return { s, writes, advance: fc.advance, live: fc.live };
}

const ok = (cond: boolean, label: string, detail: string) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${cond ? '' : ` — ${detail}`}`);
  if (!cond) fail(`${label}: ${detail}`);
  return cond;
};

console.log('=== SAVE DEBOUNCE ===');
console.log(`debounce window ${SAVE_DEBOUNCE_MS} ms, driven on a fake clock.\n`);

// ============================================================================
// 1. A DRAG IS ONE WRITE, AND IT IS THE LAST VALUE.
// The measured case: 80 steps of the Dividend / Assessment slider, 12 ms apart.
// ============================================================================
console.log('A DRAG:');
{
  const { s, writes, advance } = rig();
  const STEPS = 80;
  for (let i = 1; i <= STEPS; i++) { s.soon(`step${i}`); advance(12); }
  const during = writes.length;
  advance(SAVE_DEBOUNCE_MS);
  ok(during === 0, `${STEPS} steps 12 ms apart produce no write while the drag is moving`,
    `${during} write(s) during the drag`);
  ok(writes.length === 1, 'the drag settles to exactly one write',
    `${writes.length} write(s): ${writes.join(', ')}`);
  ok(writes[0] === `step${STEPS}`, 'and that write carries the LAST value',
    `wrote ${writes[0]}, expected step${STEPS}`);
}

// ============================================================================
// 2. A COMPLETED DECISION ALWAYS REACHES STORAGE.
//
// ⚠ THE HEADLINE PROPERTY, AND IT IS ASSERTED OVER A RANDOMISED SEQUENCE
// RATHER THAN THREE HAND-PICKED ORDERINGS. Hand-picked cases prove the cases
// they pick; the failure this guards against is an interleaving nobody thought
// of. Every trial ends by settling, and storage must then hold the last value.
// ============================================================================
console.log('\nA VALUE THE PLAYER SET AND LEFT (2,000 randomised interleavings):');

/**
 * The sweep, over any scheduler. Parameterised so the SAME sequence of
 * operations can be run against a deliberately broken scheduler — see the
 * control below. A sweep that is only ever run against the correct
 * implementation cannot show that it would notice an incorrect one.
 */
function sweep(make: (write: (v: string) => void, clock: SchedulerClock, delay: number) => {
  now(v: string): void; soon(v: string): void; flush(): void;
}): { mismatches: number; example: string } {
  let mismatches = 0;
  let example = '';
  // Deterministic LCG — a gate that is only sometimes right is not a gate.
  let seed = 20_260_911;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let trial = 0; trial < 2000; trial++) {
    const writes: string[] = [];
    const fc = fakeClock();
    const s = make(v => { writes.push(v); }, fc.clock, SAVE_DEBOUNCE_MS);
    const advance = fc.advance;
    // ⚠ THE FIRST OPERATION IS ALWAYS A SET, AND THAT IS NOT A CONVENIENCE.
    // A trial whose operations are all flushes and waits sets no value, so
    // "storage holds the last value set" is vacuously true of it and the trial
    // proves nothing. The first run of this gate had 16 such trials out of
    // 2,000 and reported them as failures, which was the harness being wrong
    // rather than the scheduler — but a harness that can generate a vacuous
    // trial can generate one that passes for the same reason. Every trial now
    // has a value to lose.
    let last = `t${trial}v0`;
    s.soon(last);
    advance(Math.floor(rnd() * SAVE_DEBOUNCE_MS * 1.5));
    const n = 1 + Math.floor(rnd() * 12);
    for (let i = 1; i <= n; i++) {
      const v = `t${trial}v${i}`;
      const r = rnd();
      if (r < 0.70) { s.soon(v); last = v; }
      else if (r < 0.85) { s.now(v); last = v; }
      else if (r < 0.95) { s.flush(); }
      else { advance(Math.floor(rnd() * SAVE_DEBOUNCE_MS * 2)); }
      // A pause between interactions, sometimes past the window and sometimes not.
      advance(Math.floor(rnd() * SAVE_DEBOUNCE_MS * 1.5));
    }
    // Settle: the player has stopped. Either the timer runs out or the tab hides.
    if (rnd() < 0.5) advance(SAVE_DEBOUNCE_MS * 2); else s.flush();
    const stored = writes.length > 0 ? writes[writes.length - 1] : '(nothing ever written)';
    if (stored !== last) {
      mismatches++;
      if (!example) example = `trial ${trial}: stored ${stored}, last set ${last}`;
    }
  }
  return { mismatches, example };
}

{
  const real = sweep(createSaveScheduler<string>);
  ok(real.mismatches === 0, '2,000 trials end with storage holding the last value set',
    `${real.mismatches} trial(s) did not — e.g. ${real.example}`);

  // ⚠ THE CONTROL FOR THE SWEEP ITSELF. A now() that writes without cancelling
  // the pending timer — the year-commit bug, and the one a reader is most
  // likely to reintroduce, because the immediate write plainly happens and the
  // stale one that follows it is invisible. The sweep must catch it.
  const broken = sweep((write, clock, delay) => {
    let timer: number | null = null;
    let pending: string | null = null;
    const fire = () => { timer = null; if (pending !== null) { write(pending); pending = null; } };
    return {
      now(v) { write(v); },                                    // does not cancel
      soon(v) { pending = v; if (timer !== null) clock.clearTimer(timer); timer = clock.setTimer(fire, delay); },
      flush() { if (timer !== null) { clock.clearTimer(timer); timer = null; } fire(); },
    };
  });
  ok(broken.mismatches > 0,
    'control — a now() that does not cancel the pending write IS caught by the sweep',
    'the broken scheduler passed 2,000 trials, so the sweep cannot detect a stale overwrite');
  console.log(`        (the control fails ${broken.mismatches} of 2,000 trials; the real one fails ${real.mismatches})`);
}

// ============================================================================
// 3. flush() CLOSES THE TAB-CLOSE GAP, AND DOES NOT DOUBLE-WRITE.
// ============================================================================
console.log('\nTHE LIFECYCLE FLUSH:');
{
  const { s, writes, advance, live } = rig();
  s.soon('typed');
  ok(s.isPending(), 'a value is pending before the window elapses', 'nothing pending');
  s.flush();
  ok(writes.length === 1 && writes[0] === 'typed',
    'flush() with the clock never advancing writes the pending value',
    `writes: ${JSON.stringify(writes)}`);
  advance(SAVE_DEBOUNCE_MS * 3);
  ok(writes.length === 1, 'and the timer that was still armed does not write it a second time',
    `${writes.length} writes after the window elapsed`);
  ok(live() === 0, 'no timer is left armed', `${live()} timer(s) still queued`);
  s.flush();
  ok(writes.length === 1, 'flush() with nothing pending writes nothing',
    `${writes.length} writes`);
}

// ============================================================================
// 4. AN IMMEDIATE WRITE CANCELS A PENDING ONE.
//
// ⚠ THE YEAR-COMMIT CASE, AND IT WOULD LOSE A YEAR RATHER THAN A SLIDER STEP.
// A pending decision write firing after the commit would put the PRE-COMMIT
// envelope over the post-commit one: reload, and the player is back at the
// start of the turn they just finished.
// ============================================================================
console.log('\nnow() AGAINST A PENDING soon():');
{
  const { s, writes, advance } = rig();
  s.soon('decisions-for-year-4');
  s.now('year-4-committed');
  advance(SAVE_DEBOUNCE_MS * 3);
  ok(writes.length === 1, 'the pending write is cancelled, not queued behind the commit',
    `${writes.length} writes: ${writes.join(', ')}`);
  ok(writes[writes.length - 1] === 'year-4-committed',
    'and the committed year is what is left in storage',
    `storage holds ${writes[writes.length - 1]}`);
}

// ============================================================================
// 5. discard() THROWS THE PENDING WRITE AWAY.
// The New Game case: the key is removed, and nothing may write it back.
// ============================================================================
console.log('\ndiscard() FOR NEW GAME:');
{
  const { s, writes, advance, live } = rig();
  s.soon('abandoned-game');
  s.discard();
  advance(SAVE_DEBOUNCE_MS * 3);
  ok(writes.length === 0, 'a discarded write never reaches storage',
    `${writes.length} writes: ${writes.join(', ')}`);
  ok(live() === 0 && !s.isPending(), 'and nothing is left armed or pending',
    `${live()} timer(s), pending=${s.isPending()}`);
}

// ============================================================================
// ⚠ THE POSITIVE CONTROLS. Two schedulers that are WRONG in the two ways this
// file is built to catch. If either passes the checks above, those checks
// cannot detect the fault and everything they "proved" is decoration.
//
// Both are written the way the bug would actually be written, not as obvious
// sabotage: control A is the textbook debounce that captures the value in the
// timer's closure and forgets to re-capture on restart; control B is a flush
// that cancels the timer and returns, which is what "cancel pending work on
// unload" looks like if you forget that the work is owed.
// ============================================================================
console.log('\nPOSITIVE CONTROLS (each MUST fail the check it targets):');
{
  // --- A: captures the value at schedule time, does not re-capture ----------
  function staleScheduler(write: (v: string) => void, clock: SchedulerClock, delay: number) {
    let timer: number | null = null;
    let captured: string | null = null;
    return {
      soon(v: string) {
        if (captured === null) captured = v;      // the forgotten re-capture
        if (timer !== null) clock.clearTimer(timer);
        timer = clock.setTimer(() => { timer = null; if (captured !== null) write(captured); captured = null; }, delay);
      },
    };
  }
  const writesA: string[] = [];
  const fcA = fakeClock();
  const a = staleScheduler(v => writesA.push(v), fcA.clock, SAVE_DEBOUNCE_MS);
  for (let i = 1; i <= 80; i++) { a.soon(`step${i}`); fcA.advance(12); }
  fcA.advance(SAVE_DEBOUNCE_MS);
  const aCaught = !(writesA.length === 1 && writesA[0] === 'step80');
  ok(aCaught, 'control A — a debounce that captures the first value fails "LAST value wins"',
    `it wrote ${JSON.stringify(writesA)}, which the check above would have ACCEPTED`);

  // --- B: flush cancels instead of writing ---------------------------------
  const writesB: string[] = [];
  const fcB = fakeClock();
  let timerB: number | null = null;
  let pendingB: string | null = null;
  const b = {
    soon(v: string) {
      pendingB = v;
      if (timerB !== null) fcB.clock.clearTimer(timerB);
      timerB = fcB.clock.setTimer(() => { timerB = null; if (pendingB !== null) writesB.push(pendingB); pendingB = null; }, SAVE_DEBOUNCE_MS);
    },
    flush() { if (timerB !== null) { fcB.clock.clearTimer(timerB); timerB = null; } },  // owed, and dropped
  };
  b.soon('typed');
  b.flush();
  fcB.advance(SAVE_DEBOUNCE_MS * 3);
  const bCaught = writesB.length === 0;
  ok(bCaught, 'control B — a flush that cancels instead of writing loses the value',
    `it wrote ${JSON.stringify(writesB)}, so the flush check has no teeth`);
}

// ============================================================================
// THE NULL ARM: delay 0 is the pre-debounce behaviour, and it must write per step.
// ============================================================================
console.log('\nTHE NULL ARM (delay 0 — what shipped before this commit):');
{
  const { s, writes, advance } = rig(0);
  for (let i = 1; i <= 80; i++) { s.soon(`step${i}`); advance(12); }
  ok(writes.length === 80, 'at delay 0 an 80-step drag writes 80 times, as it did before',
    `${writes.length} writes — the null arm does not reproduce the old behaviour, so the `
    + `80 -> 1 comparison is not measuring what it claims`);
}

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log(`PASS — an 80-step drag is 80 writes at delay 0 and 1 write at ${SAVE_DEBOUNCE_MS} ms,`);
  console.log('       carrying the last value; 2,000 randomised interleavings all end with the');
  console.log('       last value in storage; both positive controls fail as they must.');
  console.log(RULE);
}
