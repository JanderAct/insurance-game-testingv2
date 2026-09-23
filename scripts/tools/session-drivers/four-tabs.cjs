// FOUR TABS, ONE BROWSER.
//
// ⚠ ONE CONTEXT, FOUR PAGES — NOT FOUR CONTEXTS. localStorage IS the server in
// this implementation, and Playwright contexts have isolated storage. Four
// contexts would give four private universes in which every assertion below
// passes while nothing is actually shared. The bug this arrangement is built to
// catch is precisely the one that isolation would hide.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];

const fails = [];
let checks = 0;
function ok(cond, what) { checks++; if (!cond) { fails.push(what); console.log('  FAIL  ' + what); } else console.log('  ok    ' + what); }

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });

  const host = await ctx.newPage();
  const players = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
  const all = [host, ...players];
  for (const p of all) {
    p.on('pageerror', e => { fails.push('page error: ' + e.message); console.log('  PAGE ERROR:', e.message); });
  }

  // ---- host creates -------------------------------------------------------
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', 'MAMC6EA4');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '3');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  // ---- three teams join, each in its own tab ------------------------------
  for (let i = 0; i < 3; i++) {
    await players[i].goto(`/join/${code}`);
    await players[i].waitForSelector('[data-testid="team-picker"]');
    // Teams name themselves and pick their own lines now.
    await players[i].fill('[data-testid="team-name"]', TEAMS[i]);
    await players[i].click('[data-testid="pick-line-WC"]');
    await players[i].click('[data-testid="join-team"]');
    await players[i].waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
    const mine = (await players[i].textContent('[data-testid="my-team"]')).trim();
    ok(mine === TEAMS[i], `tab ${i + 1} claimed ${TEAMS[i]}`);
  }

  // The host's table must show all three, from a poll — not from its own action.
  await host.waitForSelector(`[data-testid="joined-${TEAMS[2]}"]`, { timeout: 10000 });
  ok(true, 'host table shows all three joins, via the poller');

  // ---- a team already taken cannot be claimed by another tab --------------
  {
    // ⚠ WITHIN ONE BROWSER, A NAME THIS BROWSER ALREADY HOLDS IS A REJOIN, NOT A
    // COLLISION — the held-credential store is per browser, so a fourth tab
    // typing Harbour Mutual is the same participant returning, and it lands back
    // in that team rather than being refused. A TRUE collision is a DIFFERENT
    // browser, which cannot be staged here at all: localStorage is the server in
    // this implementation, so a second browser context sees no room. That case
    // is asserted at the transport instead — see session-contract-check's
    // 'a second player cannot reuse a name already in the room'.
    const fourth = await ctx.newPage();
    await fourth.goto(`/join/${code}`);
    await fourth.waitForSelector('[data-testid="team-picker"]');
    await fourth.fill('[data-testid="team-name"]', TEAMS[0]);
    await fourth.click('[data-testid="pick-line-WC"]');
    await fourth.click('[data-testid="join-team"]');
    await fourth.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
    const back = (await fourth.textContent('[data-testid="my-team"]')).trim();
    ok(back === TEAMS[0], `a name this browser already holds rejoins that team (${back})`);
    const rec = await fourth.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
    ok(rec.teams.length === 3, `the rejoin created no fourth team (${rec.teams.length} teams)`);
    await fourth.close();
  }

  // ---- viewer claims nothing ---------------------------------------------
  {
    const viewer = await ctx.newPage();
    await viewer.goto(`/view/${code}`);
    await viewer.waitForSelector(`[data-testid="watch-${TEAMS[0]}"]`, { timeout: 30000 });
    await viewer.click(`[data-testid="watch-${TEAMS[0]}"]`);
    await viewer.waitForSelector('[data-testid="watched-team"]', { timeout: 30000 });
    const watched = (await viewer.textContent('[data-testid="watched-team"]')).trim();
    ok(watched === TEAMS[0], 'a viewer watches a team that is already claimed');
    // And the player who owns it is unaffected.
    const stillMine = (await players[0].textContent('[data-testid="my-team"]')).trim();
    ok(stillMine === TEAMS[0], 'the viewer did not displace the player driving that team');
    await viewer.close();
  }

  // ---- all three lock in --------------------------------------------------
  for (let i = 0; i < 3; i++) {
    await players[i].getByRole('button', { name: /Lock Year/ }).first().click();
    await players[i].waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  }
  ok(true, 'all three tabs submitted and show submit-and-wait');

  await host.waitForSelector(`[data-testid="locked-${TEAMS[2]}"]`, { timeout: 10000 });
  ok(true, 'host table shows all three locked');

  // ---- rejoin by token ----------------------------------------------------
  await players[1].reload();
  await players[1].waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  const afterReload = (await players[1].textContent('[data-testid="my-team"]')).trim();
  ok(afterReload === TEAMS[1], 'a reload returns the same player to the same team, not the picker');
  const stillLocked = await players[1].$('[data-testid="waiting"]') !== null;
  ok(stillLocked, 'the reloaded tab is still locked in, not asked to submit again');

  // ---- host advances ------------------------------------------------------
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 10000 });
  ok(true, 'host advanced the room to year 2');

  // Every player tab must notice on its own, from the poller.
  for (let i = 0; i < 3; i++) {
    await players[i].waitForFunction(
      () => document.querySelector('[data-testid="player-year"]')?.textContent.trim() === '2',
      null, { timeout: 15000 },
    );
  }
  ok(true, 'all three player tabs moved to year 2 on their own');

  for (let i = 0; i < 3; i++) {
    const unlocked = await players[i].getByRole('button', { name: /Lock Year/ }).count() > 0;
    if (!unlocked) { ok(false, `tab ${i + 1} is able to submit year 2`); }
  }
  ok(true, 'every tab can submit again for the new year');

  await browser.close();
  console.log(`\nfour-tabs: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('FOUR-TAB PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
