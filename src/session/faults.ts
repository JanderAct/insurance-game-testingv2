// ============================================================================
// THE INJECTABLE FAULT, SHARED BY EVERY IMPLEMENTATION.
//
// ⚠ IT LIVES HERE RATHER THAN IN ONE TRANSPORT BECAUSE THE CONTRACT HARNESS
// RUNS AGAINST BOTH. The failure block asserts that a rejected call leaves the
// room untouched and that the next call succeeds — a claim about the CONTRACT,
// not about localStorage — so both implementations need the same handle or the
// suite would have to be weakened for one of them, and a suite that tests less
// of the second implementation is exactly how the second implementation drifts.
//
// ⚠ IT FAILS ON THE CLIENT SIDE, WHICH IS HONEST ABOUT WHAT IT IS. This makes a
// call fail the way a dropped connection does — before the server sees it.
// Server-side faults (a 500 from the room store, a throttled write) are a
// different class and belong to whatever runs the server; the stub could grow
// an endpoint for them. What this proves is that every CALLER handles a
// rejection, which is the part that lives in this repository.
// ============================================================================

import type { FaultController, SessionErrorCode } from './contract';

interface PendingFault {
  code: SessionErrorCode;
  message: string;
}

export class Faults implements FaultController {
  next: PendingFault | null = null;
  all: PendingFault | null = null;
  latencyMs: number;

  constructor(latencyMs: number) {
    this.latencyMs = latencyMs;
  }

  failNext(code: SessionErrorCode = 'TRANSPORT_FAILURE', message = 'Injected failure.'): void {
    this.next = { code, message };
  }

  failAll(code: SessionErrorCode = 'TRANSPORT_FAILURE', message = 'Injected failure.'): void {
    this.all = { code, message };
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  clear(): void {
    this.next = null;
    this.all = null;
  }

  // Consumed once per call, before the call does anything.
  take(): PendingFault | null {
    if (this.next) {
      const f = this.next;
      this.next = null;
      return f;
    }
    return this.all;
  }
}
