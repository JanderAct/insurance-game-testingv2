// ============================================================================
// THE LIFECYCLE FLUSH IS WIRED — A STATIC GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/save-flush-wiring-check.ts
//
// save-debounce-check proves flush() is CORRECT when called. It says nothing
// about whether anything calls it, because the call sites are addEventListener
// pairs inside a React effect and node cannot run a React effect. Its own
// header names that blind spot. This closes it as far as text can.
//
// THE FAILURE THIS IS BUILT FOR IS A REFACTOR, NOT A BUG. Nobody will write
// this wiring wrong today — it was written today. What happens is that someone
// eighteen months from now moves the effect, renames the handler, tidies the
// cleanup, or "simplifies" the visibilityState guard away, and everything still
// compiles, every other gate stays green, and the only symptom is a player who
// loses their last decision when they switch tabs. A text assertion catches
// exactly that class and is worth having for exactly that reason.
//
// ============================================================================
// ⚠ WHAT THIS DOES NOT PROVE, AND IT IS THE LARGER HALF.
//
// This proves the wiring EXISTS. It does not prove the wiring WORKS, and two
// specific things are assumed rather than tested:
//
//   1. THAT THE EVENTS FIRE AS EXPECTED. visibilitychange on a backgrounded
//      mobile tab, pagehide on close and on a back/forward-cache entry — these
//      are browser behaviours, they differ between engines, and nothing in this
//      directory can observe them. The choice of these two events over
//      beforeunload is an argument recorded in saveScheduler.ts, not a
//      measurement.
//
//   2. THAT A 214 ms SYNCHRONOUS WRITE COMPLETES INSIDE THE HANDLER. A mobile
//      tab being backgrounded is on a deadline it does not publish. The write
//      is localStorage.setItem, which is synchronous and either happens or
//      throws — so the risk is the handler not being reached at all, or being
//      cut short by the browser terminating the page, neither of which is
//      reachable from node.
//
// So the honest claim this gate upgrades is narrow: from "the wiring might not
// exist" to "the wiring exists and the browser's behaviour is assumed". That is
// smaller than it sounds and worth stating plainly, because a green gate here
// will otherwise read as coverage of the flush path.
//
// ============================================================================
// THE ALTERNATIVE, RECORDED RATHER THAN BUILT.
//
// jsdom or happy-dom would give real behavioural coverage of point 1 above:
// render the component, dispatch a visibilitychange, assert the write landed —
// the thing this file can only approximate. It was not built because it is a
// dependency plus a rendering harness, and nothing in scripts/diagnostics has
// either; every gate here is a plain node process over the pure engine. Adding
// one for a single effect is a larger commitment than the risk warrants today.
//
// ⚠ IF THIS EVER NEEDS MORE THAN A STATIC CHECK, THAT IS THE ROUTE, and the
// trigger would be a second lifecycle-sensitive behaviour rather than this one
// growing. Recorded so the next person weighs the same choice rather than
// rediscovering it.
//
// ============================================================================
// HOW IT READS THE CODE.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE ANYTHING IS MATCHED, and here that is load-
// bearing rather than hygiene. The paragraph above the effect in App.tsx names
// both events in PROSE — "visibilitychange covers mobile backgrounding",
// "pagehide covers navigation and close". A gate that matched raw text would
// stay green with the listener deleted and the explanation left behind, which
// is the most likely refactor of all. The positive controls below delete each
// listener in turn and would not fire without the strip.
//
// It parses rather than greps: every addEventListener/removeEventListener call
// is found, its argument list split on balanced parentheses, and the handler
// resolved — an identifier is looked up to its declaration, an inline arrow is
// used as-is. So renaming the handler or inlining it is fine; removing it is
// not.
//
// ⚠ ONE KNOWN STRICTNESS: the handler must call flush() DIRECTLY. A handler
// that delegates through a wrapper would fail this gate despite being correct.
// That is the deliberate direction to err in — a gate that is too strict fails
// loudly and gets read, a gate that is too loose passes silently and does not.
// The remedy if it ever bites is to inline the call.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '../../src');
const RULE = '='.repeat(76);

/** The two events, and why each is required. Both, or the cover has a hole. */
const REQUIRED = [
  {
    event: 'visibilitychange',
    why: 'mobile backgrounding — a hidden tab can be killed with no further event',
    // ⚠ AND IT MUST BE GUARDED. visibilitychange fires on BOTH transitions;
    // an unguarded handler writes the whole save every time the player comes
    // BACK to the tab, which is the frequency defect this branch just removed
    // reappearing through a different door.
    guard: ['visibilityState', 'hidden'],
  },
  { event: 'pagehide', why: 'navigation away and tab close; reliable under bfcache', guard: [] },
];

// ---------------------------------------------------------------------------
// Reading the source.
// ---------------------------------------------------------------------------

/** Line comments, trailing comments and block-comment bodies removed. Same
 *  strip as surface-privacy-check, and load-bearing for the same reason. */
function stripComments(src: string): string {
  return src.split('\n').map(line => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
    return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  }).join('\n');
}

/** From `open` (index of a '('), the index just past its matching ')'. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** Split an argument list on TOP-LEVEL commas only. */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  out.push(inner.slice(start).trim());
  return out;
}

interface Listener { kind: 'add' | 'remove'; event: string; handler: string }

/** Every add/removeEventListener call, with its event name and handler expression. */
function listeners(src: string): Listener[] {
  const out: Listener[] = [];
  const re = /\b(add|remove)EventListener\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf('(', m.index);
    const close = matchParen(src, open);
    if (close < 0) continue;
    const args = splitArgs(src.slice(open + 1, close - 1));
    if (args.length < 2) continue;
    const ev = /^['"`]([^'"`]+)['"`]$/.exec(args[0]);
    if (!ev) continue;
    out.push({ kind: m[1] as 'add' | 'remove', event: ev[1], handler: args[1] });
  }
  return out;
}

/**
 * The text of `const|let|var|function <name>`'s declaration, to the end of the
 * statement. Balanced over (), {} and [] so a multi-line arrow body is kept
 * whole; ends at the first top-level `;` or, for a function declaration, at the
 * close of its body.
 */
function declarationOf(src: string, name: string): string | null {
  const re = new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`);
  const m = re.exec(src);
  if (!m) return null;
  // ⚠ A `function` DECLARATION ENDS AT ITS BODY'S CLOSING BRACE, A `const` AT
  // THE STATEMENT'S SEMICOLON, and conflating the two truncates the function at
  // its EMPTY PARAMETER LIST — returning `function onX()` with the body cut off,
  // which then reads as a handler that does not call flush(). A false failure,
  // and a baffling one. Found by inspection while writing the shape-tolerance
  // section below, then CONFIRMED to be caught by it: reverting this fix turns
  // that section's first rewrite red with exactly that diagnosis.
  const isFn = /^function\b/.test(src.slice(m.index));
  let depth = 0, seenBrace = false;
  for (let i = m.index; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '{') { depth++; seenBrace = true; }
    else if (c === '}') { depth--; if (isFn && seenBrace && depth === 0) return src.slice(m.index, i + 1); }
    else if (c === ';' && depth === 0 && !isFn) return src.slice(m.index, i + 1);
  }
  return src.slice(m.index);
}

/** The handler's BODY: an inline arrow/function is itself; an identifier is resolved. */
function bodyOf(src: string, handler: string): string | null {
  if (/^[A-Za-z_$][\w$]*$/.test(handler)) return declarationOf(src, handler);
  return handler;  // inline arrow or function expression
}

// ---------------------------------------------------------------------------
// The assertions. A pure function over source text, so the controls below can
// feed it mutated copies — which is the whole reason it is shaped this way.
// ---------------------------------------------------------------------------

function checkWiring(src: string): string[] {
  const problems: string[] = [];
  const code = stripComments(src);
  const found = listeners(code);

  for (const req of REQUIRED) {
    const adds = found.filter(l => l.kind === 'add' && l.event === req.event);
    const removes = found.filter(l => l.kind === 'remove' && l.event === req.event);

    if (adds.length === 0) {
      problems.push(`'${req.event}' is never registered — ${req.why}. A pending save is lost `
        + `whenever that event was the only notice the page got.`);
      continue;
    }
    if (adds.length > 1) {
      problems.push(`'${req.event}' is registered ${adds.length} times; expected once. Two `
        + `registrations means two flushes per event, or one of them is dead.`);
    }

    const body = bodyOf(code, adds[0].handler);
    if (body === null) {
      problems.push(`'${req.event}' is registered with handler \`${adds[0].handler}\`, whose `
        + `declaration could not be found — so what it does cannot be checked.`);
    } else if (!/\.flush\s*\(/.test(body)) {
      problems.push(`the '${req.event}' handler does not call flush(). It is registered, so this `
        + `reads as covered, but the pending save is never written. (This gate requires a DIRECT `
        + `flush() call — see the strictness note in the header.)`);
    } else {
      for (const token of req.guard) {
        if (!body.includes(token)) {
          problems.push(`the '${req.event}' handler does not mention \`${token}\`, so it is not `
            + `checking WHICH transition fired. visibilitychange fires on becoming visible as well `
            + `as hidden; an unguarded handler writes the whole save every time the player returns `
            + `to the tab, which is the per-event write frequency this branch removed.`);
        }
      }
    }

    if (removes.length === 0) {
      problems.push(`'${req.event}' is registered but never removed. The effect's cleanup leaks a `
        + `listener holding the old scheduler, and a remount stacks another.`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Find the wiring, wherever it lives.
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const failures: string[] = [];
const all = walk(SRC);
// ⚠ SEARCHED FOR, NOT HARDCODED TO App.tsx. Moving the effect into a hook is a
// reasonable refactor and should not fail this; deleting it should.
const hosts = all.filter(f => {
  const code = stripComments(fs.readFileSync(f, 'utf8'));
  return listeners(code).some(l => REQUIRED.some(r => r.event === l.event));
});

console.log(RULE);
console.log('THE LIFECYCLE FLUSH IS WIRED: visibilitychange and pagehide reach flush()');
console.log(RULE);
console.log(`scanned ${all.length} files under src/; ${hosts.length} register a lifecycle listener\n`);

if (hosts.length === 0) {
  failures.push('NO file under src/ registers visibilitychange or pagehide. The debounce leaves the '
    + 'last decision in memory for up to SAVE_DEBOUNCE_MS and nothing writes it when the tab goes '
    + 'away — see saveScheduler.ts. save-debounce-check will stay green throughout, because it '
    + 'tests flush() rather than its callers.');
} else if (hosts.length > 1) {
  failures.push(`${hosts.length} files register these events (${hosts.map(h => path.basename(h)).join(', ')}). `
    + 'Expected one. Two registration sites means two flushes per event or one dead listener; if the '
    + 'split is deliberate, this gate needs re-pointing rather than the code changing.');
}

let hostSrc = '';
for (const h of hosts) {
  const rel = path.relative(path.join(__dirname, '../..'), h);
  hostSrc = fs.readFileSync(h, 'utf8');
  const problems = checkWiring(hostSrc);
  const code = stripComments(hostSrc);
  console.log(`  ${rel}`);
  for (const req of REQUIRED) {
    const adds = listeners(code).filter(l => l.kind === 'add' && l.event === req.event);
    const removes = listeners(code).filter(l => l.kind === 'remove' && l.event === req.event);
    const body = adds.length > 0 ? bodyOf(code, adds[0].handler) : null;
    const reaches = body !== null && /\.flush\s*\(/.test(body);
    const guarded = req.guard.length === 0
      ? 'n/a' : (body !== null && req.guard.every(g => body.includes(g)) ? 'yes' : 'NO');
    console.log(`    ${req.event.padEnd(18)} registered ${adds.length > 0 ? 'yes' : 'NO '}`
      + `   reaches flush() ${reaches ? 'yes' : 'NO '}`
      + `   removed ${removes.length > 0 ? 'yes' : 'NO '}`
      + `   guarded ${guarded}`);
  }
  for (const p of problems) failures.push(`${rel}: ${p}`);
}

// ---------------------------------------------------------------------------
// ⚠ THE POSITIVE CONTROLS. Each mutation is a refactor someone could plausibly
// make, applied to the REAL source, and each must turn the gate red. "0
// problems" above means nothing unless the checker can say no — and this
// checker's specific way of being wrong is matching the prose in the comment
// block above the effect, which names both events.
// ---------------------------------------------------------------------------
console.log('');
console.log('  POSITIVE CONTROLS (each mutation of the real source MUST be caught):');
{
  const code = stripComments(hostSrc);
  const nameFor = (event: string) => {
    const a = listeners(code).find(l => l.kind === 'add' && l.event === event);
    return a ? a.handler : '';
  };
  /** Rewrite a named declaration in place, so the controls survive reformatting. */
  const mutateDecl = (src: string, name: string, f: (d: string) => string) => {
    const d = declarationOf(stripComments(src), name);
    if (!d) return src;
    return src.replace(d, f(d));
  };
  /** Delete the whole add/removeEventListener call for one event. */
  const dropCall = (src: string, kind: 'add' | 'remove', event: string) =>
    src.replace(new RegExp(`\\w+\\.${kind}EventListener\\s*\\(\\s*['"]${event}['"][^)]*\\)\\s*;?`), '');

  const vis = nameFor('visibilitychange');

  const CONTROLS: { label: string; mutate: (s: string) => string }[] = [
    { label: 'addEventListener(visibilitychange) deleted', mutate: s => dropCall(s, 'add', 'visibilitychange') },
    { label: 'addEventListener(pagehide) deleted', mutate: s => dropCall(s, 'add', 'pagehide') },
    { label: 'removeEventListener(visibilitychange) deleted', mutate: s => dropCall(s, 'remove', 'visibilitychange') },
    { label: 'removeEventListener(pagehide) deleted', mutate: s => dropCall(s, 'remove', 'pagehide') },
    { label: 'the visibilitychange handler stops calling flush()', mutate: s => mutateDecl(s, vis, d => d.replace(/\.flush\s*\(\s*\)/g, '.isPending()')) },
    { label: "the 'hidden' guard removed — fires on every transition", mutate: s => mutateDecl(s, vis, d => d.replace(/document\.visibilityState\s*===\s*'hidden'/, 'true')) },
  ];

  let caught = 0;
  for (const c of CONTROLS) {
    const mutated = c.mutate(hostSrc);
    const changed = mutated !== hostSrc;
    const red = changed && checkWiring(mutated).length > 0;
    console.log(`    ${red ? 'caught ' : 'MISSED '} ${c.label}${changed ? '' : '   (MUTATION DID NOT APPLY)'}`);
    if (red) caught++;
    else {
      failures.push(`POSITIVE CONTROL MISSED: with "${c.label}", the checker still reported no problems`
        + `${changed ? '' : ' — and the mutation did not even apply, so the control tested nothing'}. `
        + 'Every assertion above is then decoration.');
    }
  }
  console.log(`    ${caught}/${CONTROLS.length} controls caught`);
}

// ---------------------------------------------------------------------------
// ⚠ SHAPE TOLERANCE — THE CONTROLS IN THE OTHER DIRECTION.
//
// The positive controls above prove the gate can say no. These prove it does
// not say no to code that is still CORRECT, which matters just as much for a
// static check: a gate that false-fires on a legitimate refactor gets deleted
// by whoever hits it, and then the coverage is gone entirely. Each rewrite
// below is behaviourally identical to what ships and must stay green.
//
// This section earned its place while being written: it prompted the reading of
// declarationOf that found it truncating a `function` declaration at its empty
// parameter list, which would have reported a correct handler as not calling
// flush(). Reverting that fix turns the first rewrite below red with that exact
// diagnosis, so the coverage is measured rather than claimed.
// ---------------------------------------------------------------------------
console.log('');
console.log('  SHAPE TOLERANCE (equivalent rewrites MUST stay green):');
{
  const code = stripComments(hostSrc);
  const visName = listeners(code).find(l => l.kind === 'add' && l.event === 'visibilitychange')?.handler ?? '';
  const decl = declarationOf(code, visName) ?? '';

  const SHAPES: { label: string; rewrite: (s: string) => string }[] = [
    {
      label: 'handler as a function declaration rather than a const arrow',
      rewrite: s => s.replace(decl,
        `function ${visName}() { if (document.visibilityState === 'hidden') s.flush(); }`),
    },
    {
      label: 'handler inlined into addEventListener',
      rewrite: s => s
        .replace(decl, '')
        .replace(`addEventListener('visibilitychange', ${visName})`,
          "addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') s.flush(); })")
        .replace(`removeEventListener('visibilitychange', ${visName})`,
          "removeEventListener('visibilitychange', handlerRef)"),
    },
    {
      label: 'double-quoted event names',
      rewrite: s => s.replace(/'visibilitychange'/g, '"visibilitychange"').replace(/'pagehide'/g, '"pagehide"'),
    },
  ];

  for (const sh of SHAPES) {
    const rewritten = sh.rewrite(hostSrc);
    const changed = rewritten !== hostSrc;
    const problems = checkWiring(rewritten);
    const green = changed && problems.length === 0;
    console.log(`    ${green ? 'green ' : 'RED   '} ${sh.label}${changed ? '' : '   (REWRITE DID NOT APPLY)'}`);
    if (!green) {
      failures.push(`SHAPE TOLERANCE: the rewrite "${sh.label}" is behaviourally identical to what ships, `
        + `but the gate reported ${problems.length} problem(s)`
        + `${changed ? `: ${problems[0] ?? ''}` : ' — and the rewrite did not apply, so it tested nothing'}. `
        + 'A gate that fails correct code gets deleted rather than fixed; loosen the parser, not the rule.');
    }
  }
}

// ⚠ AND THE SCAN ITSELF IS CONTROLLED — the inert-probe rule. If the tree moved
// or the parser broke, every assertion above passes on zero listeners.
{
  const total = hosts.reduce((n, h) => n + listeners(stripComments(fs.readFileSync(h, 'utf8'))).length, 0);
  const sane = all.length >= 30 && total >= 4;
  console.log(`  probe control: ${all.length} files scanned (>= 30), ${total} listener calls parsed (>= 4)`
    + `   ${sane ? 'PASS' : 'FAIL'}`);
  if (!sane) {
    failures.push(`the scan found ${all.length} files and parsed ${total} listener calls — it is not `
      + 'reading the code. Every assertion above passes trivially on an empty scan.');
  }
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('BOTH LIFECYCLE EVENTS ARE REGISTERED, BOTH HANDLERS REACH flush(), BOTH ARE');
  console.log("REMOVED IN CLEANUP, AND visibilitychange CHECKS FOR 'hidden'. THAT THE EVENTS");
  console.log('FIRE, AND THAT THE WRITE COMPLETES INSIDE THEM, REMAINS ASSUMED — SEE THE HEADER.');
  console.log(RULE);
}
