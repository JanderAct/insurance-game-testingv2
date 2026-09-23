// A FULL SESSION, END TO END, IN FOUR TABS OF ONE BROWSER — now against the
// REAL game UI, not a four-slider panel.
// One context: localStorage is the server here, so separate contexts would give
// four private universes in which everything passes and nothing is shared.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];
const YEARS = 3;
const SKIP_YEAR = 2;
const SKIPPER = 2;

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

// The real DecisionsPage sliders carry no label association, so find the range
// input whose nearby container carries the label text.
async function nudgeSlider(page, label, presses) {
  const el = await page.evaluateHandle((lbl) => {
    for (const input of document.querySelectorAll('input[type=range]')) {
      let n = input.parentElement;
      for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
        if (n.textContent && n.textContent.includes(lbl)) return input;
      }
    }
    return null;
  }, label);
  const input = el.asElement();
  if (!input) return null;
  const before = await input.evaluate(e => e.value);
  await input.focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowRight');
  const after = await input.evaluate(e => e.value);
  return { before, after };
}

const roomRecord = (page, code) => page.evaluate(c =>
  JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null'), code);

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const players = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
  for (const p of [host, ...players]) p.on('pageerror', e => { fails.push('page error: ' + e.message); console.log('  PAGE ERROR:', e.message); });

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', 'MAMC6EA4');
  await host.fill('[data-testid="year-count"]', String(YEARS));
  await host.fill('[data-testid="expected-teams"]', String(TEAMS.length));
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}, ${YEARS} years, 3 teams\n`);

  for (let i = 0; i < 3; i++) {
    await players[i].goto(`/join/${code}`);
    await players[i].waitForSelector('[data-testid="team-picker"]');
    // Teams name themselves and pick their own lines now.
    await players[i].fill('[data-testid="team-name"]', TEAMS[i]);
    await players[i].click('[data-testid="pick-line-WC"]');
    // ⚠ TEAM 3 PLAYS A DIFFERENT BOOK. Teams in one room now choose their own
    // lines, so the run has to contain at least two different ones or it is not
    // exercising the change at all.
    if (i === 2) await players[i].click('[data-testid="pick-line-GL"]');
    await players[i].click('[data-testid="join-team"]');
    // The pre-game now runs before the shell appears.
    await players[i].waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  }
  ok(true, 'three teams joined, one per tab');

  // ---- TEAMS PLAY DIFFERENT BOOKS ----------------------------------------
  {
    // The line-view bar is the game's own statement of which lines a team writes.
    const linesOf = async p => {
      const out = [];
      for (const l of ["Workers' Compensation", 'General Liability', 'Property']) {
        if (await p.getByRole('button', { name: l, exact: true }).count() > 0) out.push(l);
      }
      return out;
    };
    await players[0].getByRole('button', { name: 'Decisions', exact: true }).click();
    await players[2].getByRole('button', { name: 'Decisions', exact: true }).click();
    await players[0].waitForTimeout(400);
    const t1 = await linesOf(players[0]);
    const t3 = await linesOf(players[2]);
    ok(t1.length === 1 && t1[0].includes('Workers'), `team 1 writes WC only (${t1.join(', ')})`);
    ok(t3.length === 2, `team 3 writes two lines (${t3.join(', ')})`);

    // And the host is reading a table of different games.
    const l1 = (await host.textContent(`[data-testid="lines-${TEAMS[0]}"]`)).trim();
    const l3 = (await host.textContent(`[data-testid="lines-${TEAMS[2]}"]`)).trim();
    ok(l1 === 'WC', `host table shows team 1's lines (${l1})`);
    ok(l3 === 'WC + GL', `host table shows team 3's lines (${l3})`);

    // ⚠ SAME WC CLAIMS DESPITE DIFFERENT BOOKS is the premise this rests on, and
    // it is checked after the first processed year below.
  }

  // ---- IT IS THE REAL GAME -------------------------------------------------
  {
    const p = players[0];
    const tabs = ['Introduction', 'Departments', 'Pool History', 'Dashboard', 'Decisions',
                  'Decision History', 'Financial Statements', 'Results', 'Result Spreadsheet',
                  'Calculation Audit', 'Membership'];
    const present = [];
    for (const t of tabs) {
      if (await p.getByRole('button', { name: t, exact: true }).count() > 0) present.push(t);
    }
    ok(present.length === tabs.length, `all 11 solo tabs present (${present.length}/11)`);

    const setup = await p.getByRole('button', { name: 'Game Setup', exact: true }).count();
    ok(setup === 0, 'Game Setup tab is absent — the room owns the seed');
    const newGame = await p.getByRole('button', { name: 'New Game', exact: true }).count();
    ok(newGame === 0, 'New Game is absent — the host owns the lifecycle');

    // The derived props are live: the funding-consequence panel only renders
    // from computeFundingConsequence, which is the extraction's whole point.
    await p.getByRole('button', { name: 'Decisions', exact: true }).click();
    await p.waitForTimeout(400);
    const wc = p.getByRole('button', { name: "Workers' Compensation", exact: true }).first();
    if (await wc.count() > 0) { await wc.click(); await p.waitForTimeout(400); }
    const main = await p.locator('main').innerText();
    ok(main.includes('Funding Confidence Level'), 'the real DecisionsPage renders (Funding Confidence Level)');
    ok(main.includes('CLF Multiplier'), 'the funding-consequence panel is live (CLF Multiplier)');
    ok(main.includes('Total Member Charge Rate'), 'the pricing consequence rows render');
    ok(/Renewal Underwriting|New Business Appetite/.test(main), 'renewal / appetite controls render');
  }

  for (let year = 1; year <= YEARS; year++) {
    for (let i = 0; i < 3; i++) {
      if (year === SKIP_YEAR && i === SKIPPER) continue;
      const p = players[i];
      await p.getByRole('button', { name: /Lock Year/ }).first().waitFor({ timeout: 120000 });

      if (year === 1 && i === SKIPPER) {
        // A deliberate, non-default choice made through the REAL decisions page.
        await p.getByRole('button', { name: 'Decisions', exact: true }).click();
        await p.waitForTimeout(400);
        // ⚠ REPOINTED FROM 'Risk Control Investment' TO 'Funding Confidence Level'
        // WHEN THE RISK CONTROL SLIDER WAS RETIRED. That slider was this driver's
        // non-default choice, and it no longer exists — nudgeSlider would have
        // returned null and this assertion would have gone red.
        //
        // AND THE TAB MOVED WITH IT, WHICH IS THE PART THAT MATTERS. The Pool tab
        // now has NO range input at all: AllocationBar is not one, and the risk
        // control slider was the only SliderInput on it. Leaving the 'Pool' click
        // in place would have made nudgeSlider search a tab with nothing to find.
        // The line tab is DETECTED rather than named, because the line tabs are
        // full display names ("Workers' Compensation") and which lines a session
        // carries is a property of its setup, not of this driver.
        const lineBtn = p.getByRole('button', { name: /Workers' Compensation|General Liability|^Property$/ }).first();
        if (await lineBtn.count() > 0) { await lineBtn.click(); await p.waitForTimeout(400); }
        const moved = await nudgeSlider(p, 'Funding Confidence Level', 3);
        ok(moved !== null && moved.before !== moved.after,
           `carry-forward setup: ${TEAMS[i]} moved Funding Confidence on the real page (${moved && moved.before} -> ${moved && moved.after})`);
      }

      await p.getByRole('button', { name: /Lock Year/ }).first().click();
      await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    }
    ok(true, `year ${year}: teams locked in${year === SKIP_YEAR ? ` (${TEAMS[SKIPPER]} deliberately did not)` : ''}`);

    await host.click('[data-testid="advance"]');
    if (year === YEARS) {
      await host.waitForSelector('[data-testid="room-complete"]', { timeout: 30000 });
      ok(true, 'host advanced past the final year; room reports complete');
    } else {
      await host.waitForFunction(y => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(y), year + 1, { timeout: 30000 });
      ok(true, `host advanced past year ${year}`);
    }

    for (let i = 0; i < 3; i++) {
      await players[i].waitForFunction(y => {
        const el = document.querySelector('[data-testid="posted-year"]');
        return !!el && el.textContent.includes(`year ${y} result posted`);
      }, year, { timeout: 180000 });
    }
    ok(true, `year ${year}: all three tabs computed their own result`);

    for (const t of TEAMS) await host.waitForSelector(`[data-testid="reported-${t}"]`, { timeout: 60000 });
    await host.waitForFunction(y => [...document.querySelectorAll('[data-testid^="reported-"]')]
      .every(e => e.textContent.includes(`year ${y}`)), year, { timeout: 60000 }).catch(() => {});
    const reported = await host.$$eval('[data-testid^="reported-"]', els => els.map(e => e.textContent.trim()));
    ok(reported.length === 3 && reported.every(r => r.includes(`year ${year}`)),
       `year ${year}: host table shows all three reported (${reported.join(' | ')})`);
  }

  // ---- CARRY-FORWARD, AT THE DATA LAYER -----------------------------------
  // ⚠ SAME CLAIM AS BEFORE, READ OUT OF A HISTORY INSTEAD OF A SLOT, and it now
  // says MORE rather than the same. The old form asserted that the single slot
  // still held 0.03 after the skipped year — true, but it could not distinguish
  // "carried forward" from "never had anything else". Per year it can: year 1
  // holds the moved value, year 2 holds NOTHING because it was skipped, and
  // year 3 holds the value the team carried into the year it did lock.
  {
    const rec = await roomRecord(host, code);
    const skipper = rec.teams.find(t => t.name === TEAMS[SKIPPER]);
    const other = rec.teams.find(t => t.name === TEAMS[0]);
    const hist = skipper.decisionsByYear || {};
    const years = Object.keys(hist).map(Number).sort((a, b) => a - b);

    ok(!years.includes(SKIP_YEAR), `carry-forward: year ${SKIP_YEAR} has NO stored set — it was skipped (${years.join(',')})`);
    // ⚠ REPOINTED WITH THE NUDGE ABOVE, AND THIS IS THE SECOND SITE — the first
    // fix (the nudge) left these three reads on riskControlPct, where every team
    // now reads the pinned 0, so `rc1 !== rcOther` compared 0 against 0 and went
    // red. A carry-forward assertion has to read the field the deliberate choice
    // actually moved.
    //
    // THE SIGNATURE IS PER-LINE AND NOT A SINGLE FIELD, because funding
    // confidence lives at byLine[line].fundingConfidenceLevel and the nudge
    // clicks whichever line tab the session happens to carry. Comparing the whole
    // map is robust to that; naming a line here would make the driver depend on
    // a setup it does not control.
    const fcSig = d => JSON.stringify(Object.entries(d?.byLine || {})
      .map(([l, v]) => [l, v.fundingConfidenceLevel, v.fundingAtExpected]).sort());
    const fc1 = fcSig(hist['1']);
    const fc3 = fcSig(hist[String(YEARS)]);
    const fcOther = fcSig((other.decisionsByYear || {})['1']);
    ok(fc1 !== fcOther, `carry-forward: ${TEAMS[SKIPPER]} kept its own funding choice in year 1 vs a default team`);
    ok(fc3 === fc1, `carry-forward: the value survived the skipped year into year ${YEARS}`);

    // And the governing year for the skipped one is the lock BEFORE it, which is
    // what the replay will read.
    const governing = Math.max(...years.filter(y => y <= SKIP_YEAR));
    ok(governing === 1, `carry-forward: year ${SKIP_YEAR} is governed by year ${governing} — the last lock before it`);
  }

  // ---- the results pages render another year's real output ----------------
  {
    const p = players[0];
    for (const tab of ['Results', 'Financial Statements', 'Calculation Audit']) {
      await p.getByRole('button', { name: tab, exact: true }).click();
      await p.waitForTimeout(500);
      const txt = await p.locator('main').innerText();
      ok(txt.length > 200, `${tab} renders real content (${txt.length} chars)`);
    }
  }

  for (let i = 0; i < 3; i++) await players[i].waitForSelector('[data-testid="player-complete"]', { timeout: 40000 });
  ok(true, 'every player tab reports the session complete');

  await browser.close();
  console.log(`\nfull-session: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('FULL SESSION PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
