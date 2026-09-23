// ============================================================================
// A THROWAWAY STUB SERVER FOR THE FIVE ENDPOINTS. NOT A DEPLOYMENT.
//
// ⚠ THIS IS NOT THE SERVER. The real one is Lambda behind API Gateway with
// DynamoDB underneath, and nothing in this file survives that: no handler
// signature, no router, no storage, no lifecycle. What this file is for is
// running the HTTP transport against something real enough to be wrong —
// separate origins, real latency, real concurrency, real CORS — inside this
// container, today. It holds rooms in a Map and forgets them when it exits.
//
// ⚠ IT BORROWS THE RULES RATHER THAN RESTATING THEM, AND THAT IS DELIBERATE.
// The five endpoints' behaviour — who may advance, what a rejoin means, when a
// result is WRONG_YEAR, what `read` redacts — is written once, in
// LocalSessionTransport. A stub that re-implemented those rules would be a
// SECOND OPINION about the contract, and the first time the two disagreed the
// contract harness would be testing two different things while reporting one.
// So the stub runs that same class over an in-memory Storage shim and does
// nothing but move JSON.
//
// ⚠ AND THE REAL SERVER WILL NOT BE ABLE TO DO THAT. It re-implements these
// rules in whatever runs on Lambda, against DynamoDB rather than a key-value
// blob — which is the moment the contract harness stops being a nicety and
// becomes the acceptance test for that implementation. It is written against
// the interface, so it can be pointed at the deployed URL unchanged.
//
// ⚠ LOCKING: FREE HERE, NOT FREE ON LAMBDA. Node runs one thread and this
// handler's whole read-modify-write is synchronous inside LocalSessionTransport
// (its latency await happens BEFORE the critical section), so two overlapping
// requests cannot interleave and no lock is needed. navigator.locks does not
// even exist here, and the transport's lock helper degrades to running the work
// directly — correct in this process, for the same reason it was correct in the
// Node harness. On Lambda that reasoning evaporates: concurrent invocations are
// genuinely parallel processes, so the read-modify-write MUST become a
// conditional write — DynamoDB `ConditionExpression` on the room's `rev`, retry
// on failure — or per-field atomic updates. `rev` is already in the record and
// already monotonic per write, which is exactly the token that condition needs.
//
// Run: npx tsx scripts/tools/session-stub-server.ts --port 4100
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { isSessionError, type SessionErrorCode } from '../../src/session/contract';

// ---------------------------------------------------------------- storage

// The in-memory stand-in for localStorage. The room store IS this Map; the
// process exiting is the database being dropped, which is the correct amount of
// durability for a stub.
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

const store = new MemoryStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = store;

// No fake latency: the wire supplies the real thing now.
const transport = new LocalSessionTransport({ latencyMs: 0 });

// ---------------------------------------------------------------- errors

// ⚠ THE BODY CARRIES THE EXACT CODE; THE STATUS IS FOR EVERYTHING ELSE IN THE
// PATH. Proxies, gateways and browsers act on the status, so it has to be
// sensible — but a client that can read the body should never have to infer.
const STATUS: Record<SessionErrorCode, number> = {
  ROOM_NOT_FOUND: 404,
  TEAM_NOT_FOUND: 404,
  TEAM_TAKEN: 409,
  BAD_TOKEN: 403,
  NOT_HOST: 403,
  WRONG_YEAR: 409,
  GAME_COMPLETE: 409,
  INVALID_REQUEST: 400,
  LINES_LOCKED: 409,
  TRANSPORT_FAILURE: 500,
};

// ---------------------------------------------------------------- routing

type Endpoint = 'createRoom' | 'join' | 'submit' | 'advance' | 'read';
const ENDPOINTS: Endpoint[] = ['createRoom', 'join', 'submit', 'advance', 'read'];

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    // ⚠ WIDE OPEN, AND A DEPLOYMENT MUST NOT BE. The browser calls this from
    // http://localhost:5173 while the stub answers on another port, so without
    // CORS nothing works at all — which is itself worth knowing before AWS. A
    // real deployment names its origins instead of `*`, and the moment a cookie
    // or a credentialed request is involved `*` stops being legal anyway.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createStubServer() {
  return createServer((req, res) => {
    void (async () => {
      // The preflight the browser sends because the request carries an
      // Authorization header and a JSON content type.
      if (req.method === 'OPTIONS') {
        send(res, 204, {});
        return;
      }

      const path = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
      if (path === 'health') {
        send(res, 200, { ok: true, rooms: store.length });
        return;
      }

      const endpoint = ENDPOINTS.find(e => e === path);
      if (!endpoint || req.method !== 'POST') {
        send(res, 404, { error: { code: 'INVALID_REQUEST', message: `No endpoint ${req.method} /${path}.` } });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
      } catch {
        send(res, 400, { error: { code: 'INVALID_REQUEST', message: 'Body was not JSON.' } });
        return;
      }

      // ⚠ THE HEADER WINS OVER THE BODY, because the header is what an
      // authorizer in front of this would have validated. They carry the same
      // string today; if they ever disagree, the one that got past the gateway
      // is the one that counts.
      const auth = req.headers.authorization;
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        payload.token = auth.slice('Bearer '.length);
      }

      try {
        // ⚠ ONE await, AND IT IS THIS ONE. Everything inside the transport's
        // call is synchronous, so the room's read-modify-write completes before
        // this handler yields again. That is the whole of the stub's
        // concurrency control — see the header for why Lambda cannot have it.
        const result = await (transport[endpoint] as (r: unknown) => Promise<unknown>)(payload);
        send(res, 200, result);
      } catch (e) {
        if (isSessionError(e)) {
          send(res, STATUS[e.code], { error: { code: e.code, message: e.message, retryable: e.retryable } });
        } else {
          send(res, 500, {
            error: { code: 'TRANSPORT_FAILURE', message: e instanceof Error ? e.message : String(e), retryable: true },
          });
        }
      }
    })();
  });
}

// ---------------------------------------------------------------- main

const isMain = process.argv[1]?.includes('session-stub-server');
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 4100;
  createStubServer().listen(port, () => {
    console.log(`session stub listening on http://localhost:${port} — throwaway, in memory, not a deployment`);
  });
}
