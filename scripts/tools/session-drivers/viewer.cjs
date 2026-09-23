// THE VIEWER IS THE PLAYER'S SCREEN, READ-ONLY — and its numbers are the
// driver's numbers because they are the same computation, not a copy.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const crypto = require('crypto');
const TEAMS = ['Harbour Mutual', 'Cedar Valley'];
const YEARS = 2;

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }
const h = s => crypto.createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

async function tabText(page, tab) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(500);
  return page.locator('main').innerText();
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const driver = await ctx.newPage();
  const viewer = await ctx.newPage();
  for (const p of [host, driver, viewer]) p.on('pageerror', e => { fails.push('page error: ' + e.message); console.log('  PAGE ERROR:', e.message); });

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', 'MAMC6EA4');
  await host.fill('[data-testid="year-count"]', String(YEARS));
  await host.fill('[data-testid="expected-teams"]', String(TEAMS.length));
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  // driver claims Harbour Mutual
  await driver.goto(`/join/${code}`);
  await driver.waitForSelector('[data-testid="team-picker"]');
  await driver.fill('[data-testid="team-name"]', TEAMS[0]);
  await driver.click('[data-testid="pick-line-WC"]');
  await driver.click('[data-testid="join-team"]');
  await driver.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });

  // viewer watches the SAME team — already claimed, which must be allowed
  await viewer.goto(`/view/${code}`);
  await viewer.waitForSelector(`[data-testid="watch-${TEAMS[0]}"]`, { timeout: 30000 });
  const watchBtn = viewer.locator(`[data-testid="watch-${TEAMS[0]}"]`);
  ok(await watchBtn.isEnabled(), 'a claimed team is still watchable — a viewer claims nothing');
  await watchBtn.click();
  await viewer.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  ok((await viewer.textContent('[data-testid="watched-team"]')).trim() === TEAMS[0], 'viewer is bound to the team it watches');

  // ---- IT IS THE SAME SCREEN ----------------------------------------------
  const TABS = ['Introduction', 'Departments', 'Pool History', 'Dashboard', 'Decisions',
                'Decision History', 'Financial Statements', 'Results', 'Result Spreadsheet',
                'Calculation Audit', 'Membership'];
  let present = 0;
  for (const t of TABS) if (await viewer.getByRole('button', { name: t, exact: true }).count() > 0) present++;
  ok(present === TABS.length, `viewer has all 11 tabs (${present}/11)`);

  // ---- IT CANNOT WRITE -----------------------------------------------------
  ok(await viewer.getByRole('button', { name: /Lock Year/ }).count() === 0, 'viewer has NO Lock Year button at all');
  ok(await viewer.getByRole('button', { name: 'New Game', exact: true }).count() === 0, 'viewer has no New Game');
  ok(await viewer.getByRole('button', { name: 'Game Setup', exact: true }).count() === 0, 'viewer has no Game Setup tab');

  // decision controls render, and are disabled
  await viewer.getByRole('button', { name: 'Decisions', exact: true }).click();
  await viewer.waitForTimeout(500);
  // Funding confidence and the CLF panel are PER-LINE controls; the Pool view
  // hosts the pool-wide pair. Select the line, as a reader discussing the
  // team's pricing would.
  const wcTab = viewer.getByRole('button', { name: "Workers' Compensation", exact: true }).first();
  if (await wcTab.count() > 0) { await wcTab.click(); await viewer.waitForTimeout(500); }
  const vMain = await viewer.locator('main').innerText();
  ok(vMain.includes('Funding Confidence Level'), 'viewer sees the real decisions page');
  ok(vMain.includes('CLF Multiplier'), 'viewer sees the live funding-consequence panel');
  const ranges = await viewer.$$eval('input[type=range]', els => els.map(e => e.disabled));
  ok(ranges.length > 0 && ranges.every(Boolean), `every decision slider is disabled but present (${ranges.length} sliders)`);
  const enabledInputs = await viewer.$$eval('main input:not([type=range]), main select',
    els => els.filter(e => !e.disabled).length);
  ok(enabledInputs === 0, `no enabled decision inputs on the viewer's page (${enabledInputs})`);

  // ---- MID-TURN: RESULTS, NOT A SPINNER -----------------------------------
  // Play year 1 so there is something to read, then check the viewer mid-turn.
  await driver.getByRole('button', { name: /Lock Year/ }).first().click();
  await driver.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 30000 });

  await driver.waitForFunction(() => {
    const e = document.querySelector('[data-testid="posted-year"]');
    return !!e && e.textContent.includes('year 1 result posted');
  }, null, { timeout: 180000 });
  await viewer.waitForFunction(() => {
    const e = document.querySelector('[data-testid="posted-year"]');
    return !!e && e.textContent.includes('year 1 result computed');
  }, null, { timeout: 180000 });
  ok(true, 'viewer computed year 1 on its own, from the watched team\'s decisions');

  // Mid-turn (year 2 open, nobody locked): the viewer reads real results.
  const vResults = await tabText(viewer, 'Results');
  ok(!/^\s*$/.test(vResults) && vResults.length > 200, `mid-turn the viewer reads real results, not a spinner (${vResults.length} chars)`);

  // ---- ITS NUMBERS ARE THE DRIVER'S NUMBERS -------------------------------
  // Both panes must be on the SAME line view, or the comparison is between two
  // different pages rather than two computations.
  for (const p of [driver, viewer]) {
    const pool = p.getByRole('button', { name: 'Pool', exact: true }).first();
    if (await pool.count() > 0) { await pool.click(); await p.waitForTimeout(400); }
  }
  for (const tab of ['Results', 'Financial Statements', 'Dashboard']) {
    const d = await tabText(driver, tab);
    const v = await tabText(viewer, tab);
    ok(h(d) === h(v), `${tab}: viewer output is identical to the driver's (driver ${h(d)} / viewer ${h(v)})`);
  }

  // ---- THE VIEWER NEVER WROTE ---------------------------------------------
  const rec = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const team = rec.teams.find(t => t.name === TEAMS[0]);
  ok(rec.viewers.length === 1, `the room records one viewer (${rec.viewers.length})`);
  // The record keeps a result PER YEAR now, so "the viewer wrote nothing" is
  // said more strongly than it was: exactly one year, and it is the driver's.
  // The opening position (year 0) is posted at build by the DRIVER too; a viewer
  // posts neither it nor anything else, so the record is exactly those two.
  const posted = Object.keys(team.resultsByYear || {}).sort();
  ok(posted.join(',') === '0,1',
     `the team's posted results are the DRIVER's opening and its one played year (years ${posted.join(',') || 'none'})`);
  ok(await viewer.$('[data-testid="submit-error"]') === null, 'no transport error on the viewer screen');
  ok(await viewer.$('[data-testid="game-error"]') === null, 'no game error on the viewer screen');

  await browser.close();
  console.log(`\nviewer: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('VIEWER PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
