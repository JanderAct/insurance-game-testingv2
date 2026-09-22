// ============================================================================
// THE HTTP IMPLEMENTATION of SessionTransport — the second one, and the whole
// point of there having been a contract.
//
// ⚠ WHAT THIS FILE IS EVIDENCE OF. contract.ts claimed that a hosted backend
// costs "a class implementing the five methods by POSTing its request object to
// `${BASE_URL}/<method>` and mapping status codes onto SessionErrorCode —
// because requests are already plain JSON and authority is already a token
// field, there is nothing to translate". This is that class, and the claim held:
// there is no marshalling below, because every request object already IS a body
// and every response object already IS a body.
//
// ⚠ NO navigator.locks HERE, AND THAT IS THE POINT OF A SERVER. The localStorage
// implementation takes a cross-tab lock because the CLIENT performs the
// read-modify-write and four tabs doing that in parallel lost an update — a
// team's posted result silently vanished. Over HTTP the client does not read,
// modify or write anything: it sends a request and is told what happened. The
// serialisation is the server's problem, which is where it belongs. See the
// stub server's header for what that costs in Node (nothing) and what it will
// cost on Lambda (a conditional write), because those are different answers.
//
// ⚠ THE TOKEN GOES IN A HEADER AND ALSO STAYS IN THE BODY. The contract says
// authority "travels as a token field on the request" so that an HTTP
// implementation can "lift that field into an Authorization header". It is
// lifted — a real API gateway authorizer reads headers, not bodies — and left in
// place as well, so a server that has not been taught about the header still
// works. Neither is a translation of the other: they carry the same string.
// ============================================================================

import type {
  AdvanceRequest, AdvanceResponse,
  CreateRoomRequest, CreateRoomResponse,
  JoinRequest, JoinResponse,
  ReadRequest, ReadResponse,
  SessionErrorCode,
  SessionTransport,
  SubmitRequest, SubmitResponse,
} from './contract';
import { SessionError } from './contract';
import { Faults } from './faults';

export interface HttpTransportOptions {
  /** Where the five endpoints live, e.g. https://api.example.com/session. */
  baseUrl: string;
  /** Injected in tests and in Node; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  /** Client-side latency on top of the real round trip. Zero by default: a real
   *  network supplies its own, and the fake one existed to imitate it. */
  latencyMs?: number;
}

/**
 * ⚠ THE BODY'S CODE WINS, AND THE STATUS IS THE FALLBACK. A server that speaks
 * this contract returns the exact SessionErrorCode, so nothing is inferred and
 * `rejects(..., 'TEAM_TAKEN')` means the same thing against either
 * implementation. The status mapping below is for the responses the SERVER did
 * not write: a gateway timeout, a 502 from a cold Lambda, an HTML error page
 * from a proxy. Those have a status and no body worth parsing, and guessing
 * wrongly there is better than reporting nothing.
 */
function codeForStatus(status: number): SessionErrorCode {
  if (status === 404) return 'ROOM_NOT_FOUND';
  if (status === 403 || status === 401) return 'BAD_TOKEN';
  if (status === 409) return 'WRONG_YEAR';
  if (status === 400) return 'INVALID_REQUEST';
  return 'TRANSPORT_FAILURE';
}

// A 5xx or a dropped connection is worth retrying; a 4xx is the caller being
// wrong and will be wrong again. This is the `retryable` split the contract
// describes, decided where the information actually exists.
function retryableFor(status: number): boolean {
  return status >= 500 || status === 429;
}

interface ErrorBody {
  error?: { code?: string; message?: string; retryable?: boolean };
}

const ERROR_CODES: readonly string[] = [
  'ROOM_NOT_FOUND', 'TEAM_NOT_FOUND', 'TEAM_TAKEN', 'BAD_TOKEN', 'NOT_HOST',
  'WRONG_YEAR', 'GAME_COMPLETE', 'INVALID_REQUEST', 'LINES_LOCKED', 'TRANSPORT_FAILURE',
];

export class HttpSessionTransport implements SessionTransport {
  readonly faults: Faults;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: HttpTransportOptions) {
    // Trailing slashes are the classic way to end up POSTing to //createRoom.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.doFetch = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.faults = new Faults(opts.latencyMs ?? 0);
  }

  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.call('createRoom', req);
  }

  join(req: JoinRequest): Promise<JoinResponse> {
    return this.call('join', req);
  }

  submit(req: SubmitRequest): Promise<SubmitResponse> {
    return this.call('submit', req);
  }

  advance(req: AdvanceRequest): Promise<AdvanceResponse> {
    return this.call('advance', req);
  }

  read(req: ReadRequest): Promise<ReadResponse> {
    return this.call('read', req);
  }

  // ---- the one place a request becomes a request ------------------------
  private async call<Req extends object, Res>(endpoint: string, req: Req): Promise<Res> {
    const fault = this.faults.take();
    if (this.faults.latencyMs > 0) await new Promise(r => setTimeout(r, this.faults.latencyMs));
    if (fault) throw new SessionError(fault.code, fault.message, true);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // createRoom is the one request with no token at all, which is why this
    // reads the field rather than requiring it.
    const token = (req as { token?: string }).token;
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
      });
    } catch (e) {
      // ⚠ A DROPPED CONNECTION IS RETRYABLE AND A REFUSED ONE LOOKS IDENTICAL
      // from here. Both are the pipe rather than the request, which is the
      // distinction every caller branches on.
      throw new SessionError(
        'TRANSPORT_FAILURE',
        `Could not reach the session service: ${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    }

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = null;   // an HTML error page from something in the middle
    }

    if (!res.ok) {
      const err = (body as ErrorBody | null)?.error;
      const code = err?.code && ERROR_CODES.includes(err.code)
        ? err.code as SessionErrorCode
        : codeForStatus(res.status);
      throw new SessionError(
        code,
        err?.message ?? `The session service returned ${res.status}.`,
        err?.retryable ?? retryableFor(res.status),
      );
    }

    if (body === null) {
      throw new SessionError('TRANSPORT_FAILURE', 'The session service returned an empty response.', true);
    }
    return body as Res;
  }
}
