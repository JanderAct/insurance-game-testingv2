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
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionTransport } from '../index';
import { SessionError, isSessionError, type CallerView, type RoomView } from '../contract';

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

  const read = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await sessionTransport().read({ code, token });
      if (!alive.current) return;
      setRoom(res.room);
      setYou(res.you);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(isSessionError(e) ? e : new SessionError('TRANSPORT_FAILURE', String(e), true));
    } finally {
      inFlight.current = false;
      if (alive.current) setLoading(false);
    }
  }, [code, token]);

  useEffect(() => {
    alive.current = true;
    void read();
    const id = window.setInterval(() => { void read(); }, intervalMs);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, [read, intervalMs]);

  const refresh = useCallback(() => { void read(); }, [read]);

  return { room, you, error, loading, refresh };
}
