// ============================================================================
// WHEN THE SAVE IS WRITTEN — coalescing a drag into one write.
//
// ⚠ THIS EXISTS BECAUSE THE SAVE FIRED ON EVERY INTERMEDIATE VALUE OF A SLIDER
// DRAG. App.tsx's persistState hung off handleDecisionsChange, which is wired
// to SliderInput's onChange, which is a bare <input type="range"> — it emits
// one event per step, not one per interaction. The Dividend / Assessment
// slider takes 80 steps end to end, so one drag wrote the whole save 80 times:
// a measured 3.4 s of blocked main thread before the save was compressed and
// 16.8 s after it. Compression did not cause this and did make it five times
// worse.
//
// ============================================================================
// ⚠ AND IT IS A MODULE RATHER THAN A useRef INSIDE App.tsx, WHICH IS THE SAME
// ARGUMENT gameSave.ts MAKES ABOUT ITSELF.
//
// The defect gameSave.ts was written for survived for the life of the project
// because the write was a closure inside App.tsx that nothing outside React
// could call, so no gate could reach it. A debounce is strictly worse in that
// respect than the write it wraps: it has STATE and a CLOCK, its failure mode
// is silent (a value that never reaches storage looks exactly like a value
// that did until the next reload), and the obvious implementation gets it
// wrong in a specific way — see LAST VALUE WINS below.
//
// So the scheduling lives here, pure, with the clock injected, and
// save-debounce-check drives it on a fake clock with the controls that prove
// the checks have teeth.
//
// ============================================================================
// ⚠ LAST VALUE WINS, AND THE OBVIOUS IMPLEMENTATION LOSES IT.
//
// The natural way to write a debounce is to capture the value in the timer's
// closure: `setTimeout(() => write(value), ms)`. Restarting the timer then
// re-captures, so it usually looks right. But every restart path has to
// remember to re-capture, and a single path that only resets the timer without
// updating the captured value writes a STALE decision — the player's last
// movement is silently discarded and the save looks fine.
//
// The pending value is therefore held in one place, written by every entry
// point, and read only at the moment of the write. There is no captured value
// to go stale. save-debounce-check's positive control is a scheduler that
// captures instead, and it fails.
//
// ============================================================================
// WHAT COVERS THE GAP A TRAILING DEBOUNCE OPENS.
//
// Between the last movement and the timer firing, the value is in memory and
// not in storage. A tab closed in that window loses it. Three things close it,
// and the first two are events rather than guesses:
//
//   visibilitychange -> hidden   tab switch, window hidden, mobile app
//                                backgrounded. THE ONE THAT MATTERS ON MOBILE,
//                                where a backgrounded tab can be killed with
//                                no further event of any kind.
//   pagehide                     navigation away and tab close. Fires where
//                                visibilitychange does not always, and unlike
//                                beforeunload it is reliable under the
//                                back/forward cache.
//   unmount                      the React teardown path, for completeness.
//
// ⚠ NOT beforeunload. It is unreliable on mobile, it is the event browsers are
// progressively restricting, and it is the one that can put a dialog in front
// of a facilitator running a room. The pair above is the Page Lifecycle
// recommendation and neither one alone is sufficient.
//
// Both handlers call flush(), which is synchronous. A ~214 ms write inside a
// visibilitychange handler is exactly what that event is for.
//
// ⚠ AND THE WIRING IS GATED, BECAUSE IT LIVES SOMEWHERE NO GATE CAN RUN.
// save-flush-wiring-check asserts it statically against App.tsx's source: both
// events registered, both handlers reaching flush(), both removed in cleanup,
// and the visibilitychange handler guarded on 'hidden' rather than firing on
// every transition. Static because a React effect is not callable from node,
// and the realistic failure is a refactor dropping or renaming a listener —
// which a text assertion does catch. What it cannot cover is whether the
// events fire as expected in a real browser; that is assumed, and the gate's
// header says so and records jsdom/happy-dom as the route if it ever needs
// more.
// ============================================================================

/**
 * How long after the last movement the write happens.
 *
 * ⚠ DERIVED FROM THE EVENT RATES IT HAS TO COALESCE, NOT PICKED FOR FEEL. It
 * must exceed the gap between successive onChange events WITHIN one
 * interaction, or a drag still writes more than once:
 *
 *   mouse drag          one event per step, at most one per animation frame,
 *                       so 8-16 ms apart
 *   keyboard held key   ~30-50 ms apart once auto-repeat starts
 *
 * Anything above ~100 ms coalesces both completely, so the floor is not the
 * binding consideration — the ceiling is, because the value sits unwritten for
 * this long and only the lifecycle handlers above cover that window. 400 ms
 * sits in the middle of the 300-500 ms band and above the ~250 ms a deliberate
 * stop-start-stop wiggle on a slider can produce.
 *
 * ⚠ ONE HONEST EXCEPTION: a HELD arrow key writes twice, not once. The OS
 * auto-repeat delay before the second keypress is typically 500 ms, which is
 * longer than this window, so the first step lands its own write and the
 * repeat coalesces into a second. That is two writes for an interaction rather
 * than one, and it is correct behaviour rather than a defect — the pause
 * genuinely was a completed decision.
 */
export const SAVE_DEBOUNCE_MS = 400;

/**
 * The timer functions, INJECTED RATHER THAN DEFAULTED TO setTimeout.
 *
 * ⚠ SAME REASONING AS gameSave.ts's SaveStore, and the same failure it avoids.
 * A defaulted clock would be a legitimate value, so a gate that forgot to pass
 * one would compile, run, and quietly measure the real wall clock — which for
 * a 400 ms debounce means either a gate that sleeps or a gate that races.
 * Callers name their clock.
 */
export interface SchedulerClock {
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

export interface SaveScheduler<T> {
  /** Write now, cancelling anything pending. For once-a-year events. */
  now(value: T): void;
  /** Write once, SAVE_DEBOUNCE_MS after the last call. For per-step events. */
  soon(value: T): void;
  /** Write whatever is pending, immediately. A no-op if nothing is. */
  flush(): void;
  /**
   * Throw away what is pending WITHOUT writing it.
   *
   * ⚠ FOR ONE CALLER, AND IT IS A BUG THE DEBOUNCE ITSELF CREATES. Starting a
   * new game removes the storage key. If a decision write is still pending when
   * the player does that — a slider moved, then New Game clicked inside the
   * debounce window — the timer fires after the removal and writes the
   * abandoned game straight back. The player would start a new game, reload,
   * and find the old one. Nothing else should call this: discarding a write the
   * player is owed is exactly what the rest of this file exists to prevent.
   */
  discard(): void;
  /** Whether a write is outstanding. For gates and for assertions, not for control flow. */
  isPending(): boolean;
}

/**
 * A scheduler over one write function.
 *
 * ⚠ `now` CANCELS A PENDING `soon`, AND WITHOUT THAT THE DEBOUNCE WOULD LOSE A
 * YEAR. The year-commit path writes immediately while a decision write may
 * still be pending from the turn the player just ended. A pending timer firing
 * afterwards would write the PRE-COMMIT envelope over the post-commit one, and
 * the player would reload into the previous year having seen the results of
 * this one. Overwriting the pending value and clearing it — rather than only
 * cancelling the timer — makes that unreachable from either direction.
 */
export function createSaveScheduler<T>(
  write: (value: T) => void,
  clock: SchedulerClock,
  delayMs: number = SAVE_DEBOUNCE_MS,
): SaveScheduler<T> {
  // The single copy of what is owed to storage. Every entry point writes it;
  // only writeNow reads it. Nothing is captured in the timer's closure — see
  // LAST VALUE WINS.
  let pending: { value: T } | null = null;
  let timer: number | null = null;

  const cancel = () => {
    if (timer !== null) { clock.clearTimer(timer); timer = null; }
  };

  const writeNow = () => {
    cancel();
    if (pending === null) return;
    // ⚠ WRITE FIRST, CLEAR SECOND. If write throws, the value stays pending and
    // the next flush retries it. Clearing first would discard a decision to
    // tidy up after a failure.
    write(pending.value);
    pending = null;
  };

  return {
    now(value: T) {
      pending = { value };
      writeNow();
    },
    soon(value: T) {
      pending = { value };
      cancel();
      timer = clock.setTimer(() => { timer = null; writeNow(); }, delayMs);
    },
    flush: writeNow,
    discard() {
      cancel();
      pending = null;
    },
    isPending: () => pending !== null,
  };
}
