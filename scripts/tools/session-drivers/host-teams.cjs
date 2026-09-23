// The Teams tab: three states at once, on three line views.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

async function join(ctx, code, name, line) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click(`[data-testid="pick-line-${line}"]`);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
}

// Read the Teams table as {team: cells}
const readTable = page => page.$$eval('[data-testid="teams-table"] tr', rows =>
  Object.fromEntries(rows.map(r => {
    const cells = [...r.children].map(c => c.textContent.trim());
    return [cells[0].split(/\s{2,}|(?=[A-Z]{2,}\+?)/)[0].trim(), cells.slice(1)];
  })));

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const errs = [];
  host.on('pageerror', e => errs.push(e.message));

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', 'MAMC6EA4');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '3');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  // Tab exists and is gated before a room... (we already have one, so just check it is there)
  ok(await host.$('[data-testid="host-tab-teams"]') !== null, 'the Teams tab exists on the host screen');

  // Before any year: the table should say so rather than blank.
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(500);
  ok((await host.textContent('[data-testid="teams-empty"]')).includes('No teams'), 'with no teams it says so');

  const wcTeam = await join(ctx, code, 'Harbour Mutual', 'WC');
  const glTeam = await join(ctx, code, 'Cedar Valley', 'GL');
  const slow   = await join(ctx, code, 'Tri-County', 'WC');

  await host.waitForFunction(() => document.querySelectorAll('[data-testid="teams-table"] tr').length === 3, null, { timeout: 30000 });
  const y0 = await host.textContent('[data-testid="teams-year"]');
  ok(/No year completed yet/.test(y0), `before any advance: "${y0.trim()}"`);
  ok(await host.$('[data-testid="pending-Harbour Mutual"]') !== null, 'and every team reads pending, not zero');

  // Two teams lock and play; the third is closed so it never computes or posts.
  for (const p of [wcTeam, glTeam]) {
    await p.getByRole('button', { name: /Lock Year/ }).first().click();
    await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  }
  await slow.close();

  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 30000 });
  for (const p of [wcTeam, glTeam]) {
    await p.waitForFunction(() => /year 1 result posted/.test(document.querySelector('[data-testid="posted-year"]')?.textContent || ''), null, { timeout: 180000 });
  }

  await host.click('[data-testid="host-tab-teams"]');
  // ⚠ WAIT FOR THE FIGURES, NOT FOR A CLOCK. A fixed 900ms sleep here was a bet
  // that the host's next poll would have landed by then — true at a flat three
  // seconds, and a coin toss once the poll backs off while the room is quiet.
  // The condition is what the assertion is about, so the condition is what this
  // waits on; the sleep was measuring the poller rather than the table.
  await host.waitForFunction(() => document.querySelectorAll('[data-testid^="surplus-"]').length >= 1,
    null, { timeout: 30000 });
  const yr = await host.textContent('[data-testid="teams-year"]');
  ok(/Year 1/.test(yr), `after the advance it shows the last COMPLETED year: "${yr.trim()}"`);

  const views = await host.$$eval('nav button, [role="tablist"] button', b => b.map(x => x.textContent.trim()));
  console.log('  line-view bar :', views.filter(v => /Pool|Compensation|Liability|Property/.test(v)));

  for (const [label, sel] of [['Pool', 'Pool'], ['WC', "Workers' Compensation"], ['GL', 'General Liability']]) {
    await host.getByRole('button', { name: sel, exact: true }).first().click();
    // The view switch is local state, so this only waits for React to paint.
    await host.waitForTimeout(250);
    const t = await readTable(host);
    console.log(`\n  --- ${label} view ---`);
    for (const [name, cells] of Object.entries(t)) console.log(`    ${name.padEnd(18)} ${cells.join(' | ')}`);
    if (label === 'WC') {
      ok(await host.$('[data-testid="absent-Cedar Valley"]') !== null, 'WC view: the GL-only team reads ABSENT');
      ok(await host.$('[data-testid="pending-Tri-County"]') !== null, 'WC view: the team that never reported reads PENDING');
      ok(await host.$('[data-testid="surplus-Harbour Mutual"]') !== null, 'WC view: the reporting team shows figures');
      const a = (await host.textContent('[data-testid="absent-Cedar Valley"]')).trim();
      const pnd = (await host.textContent('[data-testid="pending-Tri-County"]')).trim();
      ok(a !== pnd && !/^0|—$/.test(a) && !/^0|—$/.test(pnd), `absent "${a}" and pending "${pnd}" are distinct and neither is a number`);
    }
    if (label === 'GL') {
      ok(await host.$('[data-testid="absent-Harbour Mutual"]') !== null, 'GL view: the WC-only team reads ABSENT');
      ok(await host.$('[data-testid="surplus-Cedar Valley"]') !== null, 'GL view: the GL team shows figures');
    }
    if (label === 'Pool') {
      ok(await host.$('[data-testid="surplus-Harbour Mutual"]') !== null, 'Pool view: reporting teams show the aggregate');
      ok(await host.$('[data-testid="pending-Tri-County"]') !== null, 'Pool view: the non-reporter is still pending');
    }
  }

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  await browser.close();
  console.log(`\nhost-teams: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('HOST TEAMS PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
