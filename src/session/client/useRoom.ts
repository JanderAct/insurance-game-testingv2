// ============================================================================
// THE POLLER — one room, read on an interval, shared by every session screen.
//
// ⚠ A TRANSIENT FAILURE MUST NOT BLANK THE SCREEN. The room is kept from the
// last successful read and the error is reported ALONGSIDE it, not instead of
// it. A poll that failed once and cleared the host's table would turn a dropped
// request into "everyone left the room" on a projector, and the recovery would
// be indistinguishable from a real re-join. Loading is true only for the FIRST
// read, for the same reason: after that there is something true to show.
//
// ⚠ ONE READ IN FLIGHT AT A TIME. With a fake 120ms latency an interval can
// safely be shorter than a round trip; with a real network it cannot, and
// overlapping reads land out of order and flicker the room backwards. Guarding
// it here means the screens never learn the difference.
//
// ⚠ THE CADENCE IS NOT FIXED ANY MORE, AND THE RESET RULE IS THE WHOLE DESIGN.
// A self-scheduling timeout replaced setInterval so each read can choose when
// the next one happens. It goes back to the floor on either of two things, and
// they cover between them everything that can make the room interesting:
//
//   THE ROOM's rev MOVED     somebody else did something — a team locked, a
//                            result landed, the host advanced.
//   refresh() WAS CALLED     THIS client did something. Every screen already
//                            calls it after a mutation, so a host who has just
//                            advanced is back at three seconds before the first
//                            team has finished computing.
//
// Anything else — an unchanged read, or a failed one — decays. See pollSchedule.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionTransport } from '../index';
import { SessionError, isSessionError, type CallerView, type RoomView } from '../contract';
import { nextPollDelay, scheduleFor } from './pollSchedule';

export interface UseRoomResult {
  room: RoomView | null;
  you: CallerView | null;
  error: SessionError | null;
  loading: boolean;
  refresh: () => void;
}

export function useRoom(code: string, token: string | undefined, intervalMs = 3000): UseRoomResult {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState<CallerView | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [loading, setLoading] = useState(true);

  const alive = useRef(true);
  const inFlight = useRef(false);
  // The revision of the last room this poller saw. Undefined until the first
  // read, which is why the first read never counts as a change.
  const lastRev = useRef<number | null>(null);
  const delay = useRef(intervalMs);
  const timer = useRef(0);
  // Set by the effect, called by refresh(); a ref so refresh keeps one identity
  // across re-renders and screens can pass it to a child without re-subscribing.
  const wake = useRef<() => void>(() => {});

  /** Reads once and reports whether the room MOVED. */
  const read = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      const res = await sessionTransport().read({ code, token });
      if (!alive.current) return false;
      const moved = lastRev.current !== null && res.room.rev !== lastRev.current;
      lastRev.current = res.room.rev;
      setRoom(res.room);
      setYou(res.you);
      setError(null);
      return moved;
    } catch (e) {
      if (!alive.current) return false;
      setError(isSessionError(e) ? e : new SessionError('TRANSPORT_FAILURE', String(e), true));
      return false;
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [code, token]);

  // ⚠ ONE TIMER, EVER, AND THAT IS WHY EVERY ARM CLEARS FIRST. A refresh landing
  // while a scheduled read is in flight would otherwise leave two chains running
  // and the poller would quietly double its own rate — the exact opposite of
  // this commit. Both paths write the same `timer` ref and clear it before
  // setting it, so the last one to arm is the only one alive.
  const generation = useRef(0);
  const resetPending = useRef(false);

  useEffect(() => {
    const schedule = scheduleFor(intervalMs);
    const mine = ++generation.current;
    alive.current = true;
    delay.current = schedule.minMs;

    const tick = async (): Promise<void> => {
      if (!alive.current || mine !== generation.current) return;
      const moved = await read();
      if (!alive.current || mine !== generation.current) return;
      // A refresh that arrived while this read was in flight still counts as a
      // reset: the caller did something, whatever the read happened to see.
      const changed = moved || resetPending.current;
      resetPending.current = false;
      delay.current = nextPollDelay(delay.current, changed, schedule);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { void tick(); }, delay.current);
    };

    wake.current = () => {
      resetPending.current = true;
      delay.current = schedule.minMs;
      window.clearTimeout(timer.current);
      void tick();
    };

    void tick();

    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, [read, intervalMs]);

  // ⚠ refresh() IS A RESET, NOT JUST AN EXTRA READ. A screen only reaches for it
  // after doing something — locking a year, advancing, joining — so it is the
  // clearest possible statement that the room is about to be interesting, and a
  // host who has just advanced is back at the floor before the first team has
  // finished computing.
  const refresh = useCallback(() => { wake.current(); }, []);

  return { room, you, error, loading, refresh };
}
