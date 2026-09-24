// LANDING TAB PROBE — starts a game and CLICKS NOTHING.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/landing-tab-probe.cjs
//
// ⚠ IT EXISTS BECAUSE THE LANDING TAB IS INVISIBLE TO EVERY OTHER INSTRUMENT.
// The render harness and all eight session drivers resolve a tab by NAME and
// click it before reading anything, so whichever tab the app happens to open on
// is overwritten before a single fingerprint is taken. A change to
// handleStartGame's last line therefore moves NO baseline and NO driver — it is
// green by construction, not by evidence. This is the only thing that looks.
//
// It also prints the tab bar in order, because tab ORDER has the same problem
// for the same reason: everything resolves by name, so a reorder is invisible
// to every assertion in the tree.
//
// Prints and asserts nothing about correctness — it reports what the app does.
const { chromium } = require('playwright');

const URL = process.env.RENDER_URL || 'http://127.0.0.1:4173';
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const POOL = 'Landing Probe Pool';
const INSTANCE = process.env.PROBE_SEED || 'DEMO094';

const settle = async page => {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // A leftover save would RESTORE instead of starting, and restore is a
  // different path that lands somewhere else on purpose.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);

  await page.getByPlaceholder('Enter a name for your pool...').fill(POOL);
  await page.getByPlaceholder('e.g. ABC12345').fill(INSTANCE);
  await page.getByRole('button', { name: 'Start Simulation' }).click();
  await settle(page);

  // FROM HERE ON NOTHING IS CLICKED.
  const bar = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return null;
    return [...nav.querySelectorAll('button')].map(b => ({
      label: (b.textContent || '').trim(),
      // TabNav marks the selected tab by colouring its icon span.
      active: !!b.querySelector('span.text-blue-600'),
    }));
  });

  if (!bar) { console.log('FAIL: no tab bar found after starting'); await browser.close(); process.exit(1); }

  const active = bar.filter(t => t.active).map(t => t.label);
  // ⚠ READ <main>, NOT <body>. The tab bar is in <body> and CONTAINS the string
  // "Pool History", so a body-level content test reports it present whichever tab
  // is open and discriminates nothing. Caught by the first run of this probe
  // printing "present" on both arms.
  const main = await page.locator('main').innerText();

  console.log('=== LANDING TAB PROBE — game started, nothing clicked ===');
  console.log(`seed ${INSTANCE}\n`);
  console.log('TAB BAR, in order:');
  bar.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.active ? '>>' : '  '} ${t.label}`));
  console.log(`\nACTIVE TAB:              ${active.length === 1 ? active[0] : JSON.stringify(active)}`);
  console.log(`<main> "Welcome Memorandum"  ${main.includes('Welcome Memorandum') ? 'VISIBLE' : 'not visible'}`);
  console.log(`<main> first line:       ${main.split('\n')[0].slice(0, 70)}`);

  await browser.close();
})();
