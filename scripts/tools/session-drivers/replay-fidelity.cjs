// THE TEST THE DEFECT WOULD HAVE FAILED.
// A team varies its decisions across three years, reloads, and the rebuilt
// results must match WHAT WAS POSTED AT THE TIME — not merely be self-consistent.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const TEAM = 'Harbour Mutual';
const YEARS = 4;

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

async function nudge(page, label, presses) {
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
  await input.focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowRight');
  return input.evaluate(e => e.value);
}

const room = (page, code) => page.evaluate(c =>
  JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  let player = await ctx.newPage();
  const errs = [];
  for (const p of [host, player]) p.on('pageerror', e => errs.push(e.message));

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', 'MAMC6EA4');
  await host.fill('[data-testid="year-count"]', String(YEARS));
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  await player.goto(`/join/${code}`);
  await player.waitForSelector('[data-testid="team-picker"]');
  await player.fill('[data-testid="team-name"]', TEAM);
  await player.click('[data-testid="pick-line-WC"]');
  await player.click('[data-testid="join-team"]');
  await player.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });

  const postedAt = {};
  const fcValues = [];

  for (let year = 1; year <= 3; year++) {
    await player.getByRole('button', { name: /Lock Year/ }).first().waitFor({ timeout: 120000 });
    // ⚠ A DIFFERENT SET EVERY YEAR. Without variation the two replay rules give
    // the same answer and the test proves nothing.
    {
      await player.getByRole('button', { name: 'Decisions', exact: true }).click();
      await player.waitForTimeout(400);
      // ⚠ REPOINTED FROM 'Risk Control Investment' TO 'Funding Confidence Level'
      // WHEN THE RISK CONTROL SLIDER WAS RETIRED, AND FOR THIS DRIVER THAT WAS
      // NOT OPTIONAL. The risk control slider was this driver's ONLY source of
      // year-to-year variation, and the note above says why that matters:
      // without variation the two replay rules give the same answer and the test
      // proves nothing. Deleting the nudge would have left the driver green and
      // empty — the exact failure mode the label collision was avoided to
      // prevent — so it is repointed at another real decision rather than
      // dropped.
      //
      // Funding confidence is the stronger choice anyway: it is the pool's only
      // pricing lever, so it moves premium, surplus and loss ratio together,
      // which is what the endingSurplus assertion below actually needs.
      //
      // THE TAB MOVED TOO. The Pool tab now carries NO range input — AllocationBar
      // is not one, and the retired slider was its only SliderInput — so the old
      // 'Pool' click would have searched a tab with nothing to find. The line tab
      // is DETECTED by display name rather than assumed.
      //
      // ⚠ YEAR 1 NOW READS THE SLIDER INSTEAD OF ASSUMING IT. It used to push a
      // literal '0', which was the RETIRED risk-control slider's default and is
      // NOT funding confidence's (0.60). Left alone, the set-size assertion below
      // would have compared a fabricated year-1 value against two real ones and
      // passed on it. Reading with zero presses finds the same input and returns
      // its value without moving it.
      const lineBtn = player.getByRole('button', { name: /Workers' Compensation|General Liability|^Property$/ }).first();
      if (await lineBtn.count() > 0) { await lineBtn.click(); await player.waitForTimeout(350); }
      const v = await nudge(player, 'Funding Confidence Level', year > 1 ? 3 : 0);
      fcValues.push(v);
    }
    await player.getByRole('button', { name: /Lock Year/ }).first().click();
    await player.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });

    await host.click('[data-testid="advance"]');
    await host.waitForFunction(y => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(y), year + 1, { timeout: 30000 });
    // ⚠ WAIT ON THE RECORD, NOT ON THE STRIP. The strip reads processedYear,
    // which is set when the result is PRODUCED — before the submit that carries
    // it has landed. Reading the room then captures the PREVIOUS year's summary
    // and silently compares the wrong two things.
    await host.waitForFunction(([c, y]) => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
      return !!r && !!(r.teams[0]?.resultsByYear || {})[String(y)];
    }, [code, year], { timeout: 240000 });

    const rec = await room(host, code);
    postedAt[year] = JSON.parse(JSON.stringify(rec.teams[0].resultsByYear[String(year)]));
    console.log(`  year ${year}: fundingConfidence=${fcValues[year - 1]}  postedYear=${postedAt[year].yearNumber}  surplus=${postedAt[year].pool.endingSurplus.toFixed(2)}  lossRatio=${postedAt[year].pool.actualLossRatioPricingBasis.toFixed(4)}`);
  }

  ok(new Set(fcValues).size === 3, `the three years used three DIFFERENT decision sets (${fcValues.join(', ')})`);
  ok(postedAt[1].pool.endingSurplus !== postedAt[3].pool.endingSurplus, 'and those choices moved the numbers');

  const histBefore = (await room(host, code)).teams[0].decisionsByYear;
  ok(Object.keys(histBefore || {}).sort().join(',') === '1,2,3', `the room holds a decision history (${Object.keys(histBefore || {}).join(',')})`);

  const playerSurplusBefore = (await player.locator('header').innerText()).match(/Surplus\s*\n?\s*(\S+)/)?.[1];

  // ---- RELOAD: rebuild from the seed and replay ---------------------------
  await player.reload();
  await player.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  // Same discipline after the reload: wait for the re-post to be IN the record.
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && !!(r.teams[0]?.resultsByYear || {})['3'];
  }, code, { timeout: 300000 });
  await player.waitForTimeout(1200);

  const rebuilt = (await room(host, code)).teams[0].resultsByYear['3'];
  console.log(`\n  posted at the time : surplus=${postedAt[3].pool.endingSurplus.toFixed(2)} lossRatio=${postedAt[3].pool.actualLossRatioPricingBasis.toFixed(4)}`);
  console.log(`  after the reload   : surplus=${rebuilt.pool.endingSurplus.toFixed(2)} lossRatio=${rebuilt.pool.actualLossRatioPricingBasis.toFixed(4)}`);

  ok(rebuilt.pool.endingSurplus === postedAt[3].pool.endingSurplus, 'REBUILT SURPLUS === WHAT WAS POSTED AT THE TIME');
  ok(rebuilt.pool.actualLossRatioPricingBasis === postedAt[3].pool.actualLossRatioPricingBasis, 'rebuilt loss ratio matches too');
  ok(JSON.stringify(rebuilt) === JSON.stringify(postedAt[3]), 'the whole year-3 summary is identical, field for field');

  // ---- two paths to one number -------------------------------------------
  const playerSurplusAfter = (await player.locator('header').innerText()).match(/Surplus\s*\n?\s*(\S+)/)?.[1];
  ok(playerSurplusAfter === playerSurplusBefore, `the player's own screen is unchanged by the reload (${playerSurplusBefore} -> ${playerSurplusAfter})`);

  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(900);
  const hostCell = (await host.textContent(`[data-testid="surplus-${TEAM}"]`)).trim();
  console.log(`\n  player header cell : ${playerSurplusAfter}`);
  console.log(`  host Teams cell    : ${hostCell}`);
  ok(hostCell === playerSurplusAfter, 'HOST AND PLAYER AGREE EXACTLY — two paths, one number');

  console.log('\n  page errors        :', errs.length ? errs : 'none');
  await browser.close();
  console.log(`\nreplay-fidelity: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('REPLAY FIDELITY PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
