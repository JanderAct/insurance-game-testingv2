// THE SOLO ORACLE. Walks every tab of the solo game and fingerprints what each
// one renders. Run before and after the extraction: the derivation moving files
// is not the derivation changing, so every fingerprint must match exactly.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const crypto = require('crypto');
const OUT = process.argv[2] || 'before';

const TABS = ['Introduction', 'Departments', 'Pool History', 'Dashboard', 'Decisions',
               'Decision History', 'Financial Statements', 'Results', 'Result Spreadsheet',
               'Calculation Audit', 'Membership'];
const LINE_VIEWS = ['Pool', "Workers' Compensation"];

const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
// Text that legitimately differs run to run (none expected, but be explicit).
const normalise = s => s.replace(/\s+/g, ' ').trim();

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/');
  await page.waitForSelector('text=Instance ID / Seed', { timeout: 20000 });
  // Fixed seed so the whole walk is deterministic.
  const seedInput = page.locator('input[placeholder="e.g. ABC12345"]');
  await seedInput.fill('MAMC6EA4');
  await page.getByRole('button', { name: /Start/i }).last().click();
  await page.waitForSelector('text=Lock Year', { timeout: 30000 });

  const fingerprints = {};

  async function walk(phase) {
    for (const tab of TABS) {
      const btn = page.getByRole('button', { name: tab, exact: true }).first();
      if (await btn.count() === 0) { fingerprints[`${phase}|${tab}`] = 'TAB-ABSENT'; continue; }
      await btn.click();
      await page.waitForTimeout(220);
      for (const lv of LINE_VIEWS) {
        const lvBtn = page.getByRole('button', { name: lv, exact: true }).first();
        if (await lvBtn.count() > 0) {
          await lvBtn.click();
          await page.waitForTimeout(160);
        }
        const main = await page.locator('main').innerText().catch(() => '');
        fingerprints[`${phase}|${tab}|${lv}`] = h(normalise(main)) + ':' + normalise(main).length;
      }
    }
    // The header chips carry the headline figures.
    const header = await page.locator('header').innerText().catch(() => '');
    fingerprints[`${phase}|__header__`] = h(normalise(header)) + ':' + normalise(header).length;
  }

  await walk('year1');

  // Advance two years through the real solo path and walk again — this exercises
  // lockedResults, the results pages and the audit cards with real data.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /Lock Year/ }).first().click();
    await page.waitForTimeout(2500);
    // A loan prompt would block; resolve it by declining if it appears.
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  }
  await walk('year3');

  await browser.close();
  console.log(JSON.stringify({ errors, fingerprints }, null, 2));
})().catch(e => { console.error('THREW:', e); process.exit(1); });
