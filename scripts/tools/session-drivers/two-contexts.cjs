// ============================================================================
// THE TEST localStorage COULD NEVER RUN: a full session across two browser
// CONTEXTS, against the stub server.
//
// Four tabs in ONE context was the only option while the store was localStorage
// — contexts do not share it, so two contexts had no room in common and there
// was nothing to test. With a server that constraint is gone and contexts are
// the right unit: separate storage, separate identity, separate everything but
// the wire. Host in one, teams in the other, which is the actual topology.
// ============================================================================
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const { spawn } = require('node:child_process');
const net = require('node:net');
// ⚠ A PORT THE OS HANDS OUT, NOT ONE CHOSEN BY HAND. A fixed port survives a
// crashed run as a stub nobody killed, and the next run then fails to bind and
// looks like a product failure. Asking for 0 and reading it back cannot.
let API_PORT = 0;
let API = '';
let stubPid = 0;
const { REPO } = require('./_shared.cjs');
const TEAMS = ['Harbour Mutual', 'Cedar Valley'];
const YEARS = 3;   // plus one more advance at the end, for the fill-rate check

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startStub() {
  return new Promise((resolve, reject) => {
    // Its own process group, so killing it kills the tsx child too rather than
    // orphaning the thing holding the port.
    const child = spawn('npx', ['tsx', 'scripts/tools/session-stub-server.ts', '--port', String(API_PORT)], { cwd: REPO, detached: true });
    const bail = setTimeout(() => reject(new Error('stub did not start')), 60000);
    child.stdout.on('data', d => {
      process.stdout.write('  [stub] ' + d);
      if (String(d).includes('listening')) { clearTimeout(bail); resolve(child); }
    });
    child.stderr.on('data', d => process.stdout.write('  [stub:err] ' + d));
  });
}

const roomKeys = page => page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.startsWith('ripple.session.v1.room.')));
const anyKeys = page => page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.startsWith('ripple.session.')));

(async () => {
  await requireServer();
  API_PORT = await freePort();
  API = `http://localhost:${API_PORT}`;
  const stub = await startStub();
  stubPid = stub.pid;
  const browser = await launchBrowser();

  // ⚠ TWO CONTEXTS. Separate cookie jars, separate localStorage, separate
  // sessionStorage — as unrelated as two machines, which is the point.
  const hostCtx = await browser.newContext({ baseURL: BASE });
  const teamCtx = await browser.newContext({ baseURL: BASE });
  const errs = [];
  for (const c of [hostCtx, teamCtx]) c.on('page', p => p.on('pageerror', e => errs.push(e.message)));

  const host = await hostCtx.newPage();
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', 'MAMC6EA4');
  await host.fill('[data-testid="year-count"]', String(YEARS + 1));
  await host.fill('[data-testid="expected-teams"]', String(TEAMS.length));
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code} — created over HTTP from the host context\n`);

  const health = await (await fetch(`${API}/health`)).json();
  ok(health.rooms === 1, `the SERVER holds the room (${health.rooms})`);
  ok((await roomKeys(host)).length === 0,
     'and the host browser holds NO room record — the store is the server, not the tab');

  // The teams live in their own context and have never seen the host's storage.
  const players = [];
  for (const name of TEAMS) {
    const p = await teamCtx.newPage();
    await p.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
    await p.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
    await p.fill('[data-testid="team-name"]', name);
    await p.click('[data-testid="pick-line-WC"]');
    await p.click('[data-testid="join-team"]');
    await p.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
    players.push(p);
  }
  ok((await roomKeys(players[0])).length === 0, 'the team context holds no room record either');

  const hostStore = await anyKeys(host);
  const teamStore = await anyKeys(players[0]);
  const hostHeld = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.held.' + c) || '{}'), code);
  const teamHeld = await players[0].evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.held.' + c) || '{}'), code);
  // HeldCredentials is { hostToken?, teams: [{ teamToken, teamName, role }] }.
  ok(!!hostHeld.hostToken && (hostHeld.teams ?? []).length === 0,
     'the host context holds a host token and no team credential');
  ok(!teamHeld.hostToken && (teamHeld.teams ?? []).length === TEAMS.length,
     `the team context holds ${TEAMS.length} team credentials and NO host token — it cannot advance the room`);
  console.log(`  host context storage: ${JSON.stringify(hostStore)}`);
  console.log(`  team context storage: ${JSON.stringify(teamStore)}`);

  // ⚠ NOT [data-testid^="joined-"]: that prefix also matches `joined-count`,
  // the header line, so the count read one too many. The host polls, so this
  // waits for the other context's joins to arrive rather than sampling once.
  const joinedRows = () => host.$$eval('[data-testid^="joined-"]',
    els => els.filter(e => e.getAttribute('data-testid') !== 'joined-count').length);
  await host.waitForFunction(() => [...document.querySelectorAll('[data-testid^="joined-"]')]
    .filter(e => e.getAttribute('data-testid') !== 'joined-count').length === 2, null, { timeout: 30000 }).catch(() => {});
  const joined = await joinedRows();
  ok(joined === 2, `the host sees both teams from the other context (${joined})`);

  // ---- a full session ---------------------------------------------------
  for (let year = 1; year <= YEARS; year++) {
    // ⚠ BOTH TEAMS LOCK AT ONCE. Two pages, one server, no client-side lock
    // anywhere on this path: the serialisation is the server's.
    await Promise.all(players.map(async p => {
      await p.getByRole('button', { name: /Lock Year/ }).first().click();
      await p.waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
    }));
    // The host learns by polling, so this waits for the locks to arrive rather
    // than sampling the instant the clicks return — a session across contexts
    // has a real round trip in it, which is the point.
    await host.waitForFunction(() => document.querySelectorAll('[data-testid^="locked-"]').length === 2,
      null, { timeout: 30000 }).catch(() => {});
    const locked = await host.$$eval('[data-testid^="locked-"]', els => els.length).catch(() => 0);
    ok(locked === 2, `year ${year}: both simultaneous locks landed (${locked})`);

    await host.click('[data-testid="advance"]');
    const expect = year + 1;
    await host.waitForFunction(y => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(y),
      expect, { timeout: 30000 }).catch(() => {});
    // Wait on the SERVER's record, which is the only copy there is.
    await new Promise(async resolve => {
      const deadline = Date.now() + 300000;
      const tick = async () => {
        const r = await (await fetch(`${API}/read`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })).json();
        const done = r.room.teams.filter(t => (t.resultsByYear || {})[String(year)]).length === TEAMS.length;
        if (done || Date.now() > deadline) resolve();
        else setTimeout(tick, 1000);
      };
      void tick();
    });
    console.log(`  year ${year} played and reported by both teams`);
  }

  // ---- THE THING THE BACK-OFF MUST NOT COST ----------------------------
  //
  // ⚠ THE MINUTE AFTER AN ADVANCE IS THE ONE THAT DECIDES WHETHER THIS FEELS
  // LIVE. The host is on the Teams tab watching it fill; a team appearing is a
  // rev change, so the host's poller should be at the floor, not the ceiling.
  // Measured from the moment the SERVER has the figures to the moment the
  // host's table shows them.
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(1500);
  // Let the room go quiet first, so the host's cadence has actually decayed to
  // the ceiling — otherwise this measures a poller that was already fast.
  await host.waitForTimeout(20000);

  await Promise.all(players.map(async p => {
    await p.getByRole('button', { name: /Lock Year/ }).first().click();
    await p.waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
  }));
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  await host.click('[data-testid="advance"]');
  await host.click('[data-testid="host-tab-teams"]');

  // t0: the server has both teams' figures for the year just completed.
  const reportingYear = YEARS + 1;   // the year the extra advance completed
  let t0 = 0;
  for (;;) {
    const r = await (await fetch(`${API}/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })).json();
    if (r.room.teams.every(t => (t.resultsByYear || {})[String(reportingYear)])) { t0 = Date.now(); break; }
    await new Promise(r2 => setTimeout(r2, 200));
  }
  // t1: the host's table shows them.
  await host.waitForFunction(() => document.querySelectorAll('[data-testid^="surplus-"]').length === 2,
    null, { timeout: 30000 });
  const sawIn = Date.now() - t0;
  ok(sawIn < 6000,
     `after an advance the host saw both teams appear in ${sawIn}ms — the floor is 3s, so the poller had reset`);

  // ---- what the host reads back ----------------------------------------
  const wire = await (await fetch(`${API}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })).json();
  for (const t of wire.room.teams) {
    const years = Object.keys(t.resultsByYear || {}).map(Number).sort((a, b) => a - b);
    ok(JSON.stringify(years) === JSON.stringify([0, 1, 2, 3, 4]),
       `${t.name} reported every year across the wire ([${years.join(',')}])`);
  }
  ok(wire.room.teams.every(t => t.decisionsByYear === undefined),
     'and a read with no token still redacts every team\'s decisions');

  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(1200);
  const surplus = await host.$$eval('[data-testid^="surplus-"]', els => els.map(e => e.textContent.trim()));
  ok(surplus.length === 2 && surplus.every(v => /\$/.test(v)),
     `the host's Teams tab shows both teams' figures (${surplus.join(' | ')})`);

  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(1200);
  const marks = await host.$$eval('[data-testid="chart-surplus"] circle', els =>
    els.filter(e => e.getAttribute('r') === '4').length);
  ok(marks === 10, `and the charts draw every point for both teams (${marks} of 10)`);

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');

  await browser.close();
  try { process.kill(-stub.pid, 'SIGKILL'); } catch { stub.kill('SIGKILL'); }
  console.log(`\ntwo-contexts: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('TWO CONTEXTS PASS');
})().catch(e => { console.log('THREW:', e); process.exit(1); });

// A failed run must not leave the port held for the next one.
process.on('exit', () => { try { process.kill(-stubPid, 'SIGKILL'); } catch { /* already gone */ } });
