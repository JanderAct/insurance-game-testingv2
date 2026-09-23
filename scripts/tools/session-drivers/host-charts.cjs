// The Charts tab: three metrics over time, three states, and the palette rule.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

const COLORS = { 'Harbour Mutual': '#2a78d6', 'Cedar Valley': '#eb6834', 'Tri-County': '#1baf7a', 'Lakeside': '#eda100' };

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

// Markers are r=4; the direct end-labels use r=3.5, so they are not counted.
const marks = (page, chart, color) =>
  page.$$eval(`[data-testid="chart-${chart}"] circle`, (els, c) =>
    els.filter(e => e.getAttribute('fill') === c && e.getAttribute('r') === '4')
       .map(e => ({ cx: +e.getAttribute('cx'), cy: +e.getAttribute('cy') })), color);

// The x-axis year labels: the text row under the plot (y = H - 22).
const axisYears = (page, chart) =>
  page.$$eval(`[data-testid="chart-${chart}"] text`, els =>
    els.filter(e => e.getAttribute('y') === '218').map(e => e.textContent.trim()));

// The y-axis tick labels: the text column left of the plot (x = 66).
const yTicks = (page, chart) =>
  page.$$eval(`[data-testid="chart-${chart}"] text`, els =>
    els.filter(e => e.getAttribute('x') === '66').map(e => e.textContent.trim()));

const runs = (page, chart, color) =>
  page.$$eval(`[data-testid="chart-${chart}"] polyline`, (els, c) =>
    els.filter(e => e.getAttribute('stroke') === c).map(e => e.getAttribute('points').trim()), color);

// Where a given year sits on the axis, read from its own label.
const axisXFor = (page, chart, year) =>
  page.$$eval(`[data-testid="chart-${chart}"] text`, (els, y) => {
    const t = els.find(e => e.getAttribute('y') === '218' && e.textContent.trim() === String(y));
    return t ? +t.getAttribute('x') : NaN;
  }, year);

async function pickView(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(400);
}

// Which line-view button the bar is actually showing as selected. A fullPage
// screenshot of the sticky bar can lag the DOM, so the bar is read, not eyed.
const activeView = page => page.$$eval('nav button', bs =>
  (bs.find(b => b.className.includes('border-blue-600') && !/Game Setup|Teams|Charts/.test(b.textContent)) || {}).textContent?.trim());

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
  await host.fill('[data-testid="year-count"]', '6');
  await host.fill('[data-testid="expected-teams"]', '3');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  ok(await host.$('[data-testid="host-tab-charts"]') !== null, 'the Charts tab exists on the host screen');
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(400);
  ok(await host.$('[data-testid="charts-empty"]') !== null, 'with no teams it says so rather than drawing axes');

  const harbour = await join(ctx, code, 'Harbour Mutual', 'WC');
  const cedar   = await join(ctx, code, 'Cedar Valley', 'GL');
  const tri     = await join(ctx, code, 'Tri-County', 'WC');

  // ⚠ BEFORE ANY ADVANCE THERE IS ALREADY A CHART. Every team posts its opening
  // position when it builds, so year 0 is on the axis before a single decision.
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && r.teams.length === 3 && r.teams.every(t => (t.resultsByYear || {})['0']);
  }, code, { timeout: 240000 });
  await host.waitForTimeout(900);
  await pickView(host, 'Pool');

  const axis0 = await axisYears(host, 'surplus');
  ok(axis0.join(',') === '0,1,2,3,4,5,6',
     `the axis is the whole game from setup, not the part played so far (${axis0.join(',')})`);
  const opening = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  ok(opening.length === 1, `a team that has played nothing still has its opening point (${opening.length})`);
  const rec0 = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const h0 = rec0.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['0'];
  ok(h0.pool.endingSurplus > 0 && h0.pool.activeMembers > 0 && h0.pool.netUltimateLoss > 0,
     `and all THREE metrics have a real year-0 value (surplus ${Math.round(h0.pool.endingSurplus)}, members ${h0.pool.activeMembers}, losses ${Math.round(h0.pool.netUltimateLoss)})`);
  // ⚠ AND IT IS NOT MARKED LATE, BECAUSE NOTHING IS LATE YET. Pending means
  // "behind what could have been posted"; before the first advance the opening
  // position IS everything that could have been posted.
  ok(await host.$('[data-testid="chart-pending-Harbour Mutual"]') === null,
     'and nobody is marked behind before the first advance — there is no year to be behind on');

  // ⚠ THE OPENING IS NOT A REPORTED YEAR. The host's Reported column must not
  // tick for a team that has only turned up.
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(400);
  ok(await host.$('[data-testid="reported-Harbour Mutual"]') === null,
     'the Game Setup tab does not report year 0 — turning up is not playing a year');
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(500);

  // A team that turns up and is never seen again: it posts its opening position
  // and nothing else, for the whole game.
  const lake = await join(ctx, code, 'Lakeside', 'WC');
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && !!(r.teams.find(t => t.name === 'Lakeside')?.resultsByYear || {})['0'];
  }, code, { timeout: 240000 });
  await lake.close();

  // ---- play three years; Tri-County drops out after year 1 -------------
  const players = [harbour, cedar, tri];
  for (let year = 1; year <= 3; year++) {
    const live = year === 1 ? players : [harbour, cedar];
    for (const p of live) {
      await p.getByRole('button', { name: /Lock Year/ }).first().click();
      await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    }
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForTimeout(250);
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(y => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(y),
      year + 1, { timeout: 30000 });
    await host.waitForFunction(([c, y, n]) => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
      return !!r && r.teams.filter(t => (t.resultsByYear || {})[String(y)]).length >= n;
    }, [code, year, year === 1 ? 3 : 2], { timeout: 240000 });
    if (year === 1) await tri.close();
  }

  // The posted summary carries the new field the losses chart plots.
  const rec = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const h3 = rec.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['3'];
  ok(typeof h3.pool.netUltimateLoss === 'number' && h3.pool.netUltimateLoss > 0,
     `the posted summary carries netUltimateLoss (${Math.round(h3.pool.netUltimateLoss)})`);
  ok(typeof h3.byLine.WC.netUltimateLoss === 'number', 'and carries it per line as well');

  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(700);
  await pickView(host, 'Pool');

  for (const id of ['surplus', 'members', 'losses', 'developed']) {
    ok(await host.$(`[data-testid="chart-${id}"]`) !== null, `the ${id} chart is drawn`);
  }

  // ---- AS BOOKED vs AS DEVELOPED ---------------------------------------
  //
  // ⚠ THE WHOLE CLAIM IN ONE ASSERTION: the same accident year, restated
  // upwards by a later valuation. If these were equal the second chart would be
  // a copy of the first.
  const recD = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const hRec = recD.teams.find(t => t.name === 'Harbour Mutual');
  const booked1 = hRec.resultsByYear['1'].pool.netUltimateLoss;
  const dev1At1 = hRec.resultsByYear['1'].developed.pool['1'];
  const dev1At3 = hRec.resultsByYear['3'].developed.pool['1'];
  ok(Math.abs(dev1At1 - booked1) < 1,
     `at its own valuation, accident year 1 as developed IS its booked figure ($${Math.round(booked1)})`);
  ok(dev1At3 > booked1 * 1.05,
     `two valuations later the same year has grown: $${Math.round(booked1)} -> $${Math.round(dev1At3)} (${(dev1At3 / booked1).toFixed(2)}x)`);
  const bookedLatest = hRec.resultsByYear['3'].pool.netUltimateLoss;
  ok(Math.abs(hRec.resultsByYear['3'].developed.pool['3'] - bookedLatest) < 1,
     'and the NEWEST accident year is identical on both charts — it has had no valuation yet');

  // One domain across the pair, or the growth is invisible.
  const tB = await yTicks(host, 'losses');
  const tD = await yTicks(host, 'developed');
  ok(tB.length > 0 && tB.join(',') === tD.join(','),
     `both loss charts are on ONE y-scale (${tB.join(' ')})`);

  const devMarks = await marks(host, 'developed', COLORS['Harbour Mutual']);
  const bookMarks = await marks(host, 'losses', COLORS['Harbour Mutual']);
  ok(devMarks.length === bookMarks.length && devMarks.length === 4,
     `the developed chart covers the same accident years (${devMarks.length})`);
  // Lower y is a HIGHER value: the developed points sit above the booked ones.
  const above = devMarks.slice(0, 3).every((d, i) => d.cy < bookMarks[i].cy - 1);
  ok(above, 'and every developed point that has aged sits ABOVE its booked point');

  // ---- REPORTED, PENDING, and the line that must not fall to zero ------
  const hs = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  const ts = await marks(host, 'surplus', COLORS['Tri-County']);
  ok(hs.length === 4, `a team that reported every year has a point per year, plus the opening (${hs.length})`);
  ok(ts.length === 2, `a team that stopped after year 1 has the opening and year 1, and nothing after (${ts.length})`);
  const axis3 = await axisYears(host, 'surplus');
  ok(axis3.join(',') === '0,1,2,3,4,5,6',
     `the axis has not moved as the game progressed (${axis3.join(',')})`);
  const tRuns = await runs(host, 'surplus', COLORS['Tri-County']);
  ok(tRuns.length === 1 && tRuns[0].split(' ').length === 2,
     'its line runs from the opening to year 1 and stops — no segment travels further');
  ok(ts[ts.length - 1].cx < (await axisXFor(host, 'surplus', 4)),
     'leaving VISIBLE empty space on an axis that already reaches the last year');
  const lakeMarks = await marks(host, 'surplus', COLORS['Lakeside']);
  const lakeRuns = await runs(host, 'surplus', COLORS['Lakeside']);
  ok(lakeMarks.length === 1 && lakeRuns.length === 1 && lakeRuns[0].split(' ').length === 1,
     'a team that only ever turned up is ONE point at year 0, with no line from it');
  const lakeDev = await marks(host, 'developed', COLORS['Lakeside']);
  ok(lakeDev.length === 1, `a team that only turned up has ONE developed point too (${lakeDev.length})`);
  const triDev = await marks(host, 'developed', COLORS['Tri-County']);
  ok(triDev.length === 2,
     `a team that stopped reporting has a developed column frozen at its last post (${triDev.length})`);
  const lakeNote = (await host.textContent('[data-testid="chart-pending-Lakeside"]')).trim();
  ok(lakeNote === 'opening position only',
     `and the legend says that rather than "through year 0" (${lakeNote})`);

  const pending = await host.textContent('[data-testid="chart-pending-Tri-County"]');
  ok(/through year 1/.test(pending), `the legend says why: "${pending.trim()}"`);
  ok(ts[0].cx < hs[hs.length - 1].cx, 'the stopped line ends BEFORE the reporting one, rather than dropping');

  // ---- ABSENT draws nothing at all ------------------------------------
  await pickView(host, 'General Liability');
  ok(await host.$('[data-testid="chart-absent-Harbour Mutual"]') !== null,
     'GL view: the WC-only team is named ABSENT in the legend');
  ok(/General Liability/.test(await activeView(host) || ''),
     'and the line-view bar marks the view the charts are actually drawing');
  const hGL = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  const hGLruns = await runs(host, 'surplus', COLORS['Harbour Mutual']);
  ok(hGL.length === 0 && hGLruns.length === 0, 'and has NO line and NO points — not a line at zero');
  const hGLdev = await marks(host, 'developed', COLORS['Harbour Mutual']);
  ok(hGLdev.length === 0, 'the developed chart carries absence identically — no line there either');
  const cGLdev = await marks(host, 'developed', COLORS['Cedar Valley']);
  ok(cGLdev.length === 4, `and the GL team has its own line's developed column (${cGLdev.length})`);
  const cGL = await marks(host, 'surplus', COLORS['Cedar Valley']);
  ok(cGL.length === 4, `the GL team keeps opening plus three years on its own line view (${cGL.length})`);

  // ---- colour follows the entity, not its rank ------------------------
  await pickView(host, 'Pool');
  const cPool = await marks(host, 'surplus', COLORS['Cedar Valley']);
  ok(cPool.length === 4, 'switching the view back does not repaint the survivors — same hue, same team');

  // ---- the numbers on the chart are the numbers in the record ---------
  const box = await host.$eval('[data-testid="chart-surplus"]', e => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const x3 = await axisXFor(host, 'surplus', 3);
  await host.mouse.move(box.x + box.w * (x3 / 760), box.y + box.h * 0.5);
  await host.waitForTimeout(300);
  const tip = (await host.textContent('.pointer-events-none')) || '';
  const fmt = v => Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(1)}K`;
  ok(/Year 3/.test(tip), `the hover reads the year off the axis: "${tip.slice(0, 40)}"`);
  ok(tip.includes(fmt(h3.pool.endingSurplus)),
     `and the surplus it shows is the posted one (${fmt(h3.pool.endingSurplus)})`);

  // ---- a year missing in the MIDDLE breaks the line ---------------------
  // Injected, because the product cannot produce one: a reopened tab replays and
  // re-posts every year. The chart still has to render it honestly.
  for (const p of [harbour, cedar]) await p.close();
  await host.evaluate(c => {
    const k = 'ripple.session.v1.room.' + c;
    const r = JSON.parse(localStorage.getItem(k));
    delete r.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['2'];
    localStorage.setItem(k, JSON.stringify(r));
  }, code);
  await host.reload();
  await host.waitForSelector('[data-testid="host-tab-charts"]');
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(700);
  await pickView(host, 'Pool');
  const gapRuns = await runs(host, 'surplus', COLORS['Harbour Mutual']);
  const gapMarks = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  ok(gapRuns.length === 2, `the missing middle year splits the line in two (${gapRuns.length} segments)`);
  ok(gapMarks.length === 3, 'and leaves three points, not four — nothing is invented for the gap');
  const gapDev = await marks(host, 'developed', COLORS['Harbour Mutual']);
  ok(gapDev.length === 4,
     'while the developed chart is UNBROKEN — the gap is in what was posted, not in the valuation');

  // ---- A TAB THAT FALLS BEHIND ----------------------------------------
  //
  // ⚠ THE ASSERTION THE DRIVER DID NOT HAVE, AND THE REASON IT PASSED AT 43/43
  // WITH THREE CHARTS VISIBLY SPARSE. Every other block here waits for each
  // year's post to LAND before letting the host advance — so the record was
  // forced complete before anything was asserted about it, and the checks could
  // only ever have caught a rendering fault. A host does not wait, and a
  // backgrounded tab is throttled, so a tab two or more years behind is ordinary.
  // Here it is made to happen and the RECORD is checked, not just the drawing.
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  for (let i = 0; i < 2; i++) {
    await host.click('[data-testid="advance"]');
    await host.waitForTimeout(400);
  }
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '6', null, { timeout: 30000 });

  const back = await join(ctx, code, 'Cedar Valley', 'GL');   // three years behind
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    const t = r?.teams.find(x => x.name === 'Cedar Valley');
    return !!t && !!(t.resultsByYear || {})['5'];
  }, code, { timeout: 300000 });
  await host.waitForTimeout(2000);

  const caught = await host.evaluate(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c));
    const t = r.teams.find(x => x.name === 'Cedar Valley');
    return Object.keys(t.resultsByYear || {}).map(Number).sort((a, b) => a - b);
  }, code);
  const holes = [0, 1, 2, 3, 4, 5].filter(y => !caught.includes(y));
  ok(holes.length === 0,
     `a tab that caught up THREE years posted every one of them, not just the newest (has [${caught.join(',')}]${holes.length ? `, missing ${holes.join(',')}` : ''})`);

  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(700);
  await pickView(host, 'General Liability');
  const caughtMarks = await marks(host, 'losses', COLORS['Cedar Valley']);
  ok(caughtMarks.length === 6,
     `and the as-booked chart draws a point for every one of them (${caughtMarks.length} of 6)`);
  const caughtRuns = await runs(host, 'losses', COLORS['Cedar Valley']);
  ok(caughtRuns.length === 1, `with no gap in the line (${caughtRuns.length} segment)`);
  await back.close();

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');
  await browser.close();
  console.log(`\nhost-charts: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
})().catch(e => { console.log('THREW:', e); process.exit(1); });
