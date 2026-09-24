// ============================================================================
// RENDER IDENTITY — THE THIRD BASELINE, AND IT IS A BASELINE RATHER THAN A TEST.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   npx tsx scripts/tools/render-identity-check.ts            # compare
//   npx tsx scripts/tools/render-identity-check.ts --write    # re-capture
//
// IT NEEDS A BUILT APP AND A SERVER, which is why there is no npm script: a
// bare `npm run render` that assumed a server would fail confusingly for anyone
// who had not started one. RENDER_URL points it elsewhere (default :4173) and
// RENDER_BASELINE points the comparison file elsewhere — together those are what
// let one commit be measured against another in a worktree, which is how the
// defect reproduction below was done.
//
// VALUE_IDENTITY answers "did any computed value move?" and SOLO_EXPORT_GUARD
// answers "did the export's shape move?". Neither can answer "did the SCREEN
// move?", because neither renders one. 27 of this repo's 86 src files — every
// page, every component, App.tsx — are reachable from no gate at all, and every
// display defect found in them this month was found by a person looking at a
// browser. This file is the instrument that looks.
//
// ⚠ IT IS NOT THE "SOLO ORACLE". That instrument is cited by name in five commit
// messages on claude/bold-bardeen-38lhp5 and exists in NO branch and NO commit of
// this repository — searched by content across all 25 remote branches and across
// the whole history for added-or-deleted files. It was run ad hoc, out of tree,
// and vanished with the sitting that produced it. This is a new instrument built
// to fill the same gap, and it deliberately differs in one way that matters: THE
// OLD ONE PLAYED WC-ONLY. Every Membership defect found this month lived in a
// configuration it never played — GL-only and Property-only opened with an empty
// roster, WC+GL opened showing 65 of 112 members — so its 46/46 proved
// CONFINEMENT and not correctness. This one plays five configurations.
//
// ============================================================================
// ⚠ THE RECAPTURE RULE IS THE OTHER TWO BASELINES', VERBATIM. A MOVED
// FINGERPRINT IS A CHANGE TO INVESTIGATE, NOT A REASON TO RE-BASELINE.
//
// `--write` exists because legitimate display changes happen, exactly as they do
// for the other two. It is not the response to a red run. The response to a red
// run is to open the named screen and find out why it moved — the key is
// Config|Tab|LineView|Year precisely so the diff tells you which screen to open.
// Re-capture only once you can say what moved and why, and say it in the commit.
// A baseline re-captured to make a run green measures nothing afterwards.
// ============================================================================
//
// WHAT A FINGERPRINT IS. Key Config|Tab|LineView|Year; value a SHA-256 of the
// page's normalised visible text. Normalisation collapses whitespace so a reflow
// is not a diff while a number is — see NORMALISE below for everything that had
// to be neutralised and why.
//
// TWO YEAR-POINTS: `y0` before any year is locked, and `y2` after two processed
// years. y0 is not decoration — two of this month's three Membership defects
// lived ONLY there, because the page falls back to `initialMembers` until a
// result exists and that fallback was reading WC unconditionally.
//
// WHY scripts/tools/ AND NOT scripts/diagnostics/: everything in diagnostics is
// under gates.ts's manifest check, which fails on a file it does not know by
// name. This is a harness, not a gate — it needs a browser and a built app.
//
// ============================================================================
// ⚠ IT REPRODUCES ALL THREE MEMBERSHIP DEFECTS, AND ONE OF THE THREE IS THE
// REASON TO TRUST IT. Measured by building each commit in a worktree, serving
// it, and comparing with RENDER_BASELINE:
//
//   DEFECT 1, the year-0 roster (76473f1^ -> 76473f1): 4 of 232 moved, and they
//   are EXACTLY GL|y0, PR|y0, WC+GL|y0 and WC+GL+PR|y0 on Membership. Exactly
//   the four configurations that commit names as broken, at exactly the
//   year-point that was wrong, with WC-ONLY UNCHANGED — which is the negative
//   that commit also asserts. Nothing at y2 moved, which is right: the fallback
//   only renders before a year is locked. This is the one that says the
//   instrument measures what it claims to.
//
//   DEFECT 2, the line view and the WC-hardcoded columns (76473f1 -> e7a3db6):
//   a KEY-SET change on all five configurations — Membership|- disappears and
//   Membership|Pool plus one key per active line appear — because the tab gained
//   the Pool/per-line bar.
//
//   DEFECT 3, roster and tiles following the view (e7a3db6 -> 741c240): 20 of
//   248 moved, every one on Membership, on the per-line views at both
//   year-points.
//
// ⚠ AND THE THREE CANNOT BE SEPARATED IF COMPARED TOGETHER. Run against the
// commit before all three (6115f33 -> 750ce12) it reports 36 moved, all on
// Membership, in all five configurations at both year-points — but every one is
// `absent -> hash` or `hash -> absent`, because defect 2's key-set change
// removes the unit defects 1 and 3 would have been measured in. The instrument
// says "Membership changed everywhere" and cannot say more. THAT IS A REAL LIMIT
// AND IT IS NOT FIXABLE BY NORMALISATION: when the set of screens changes, there
// is no before-value for the after-key to differ from. Attribution needs the
// commits taken one at a time, which is what the three runs above do.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type Page } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ============================================================================
// VERSION HISTORY — AND THE OTHER TWO BASELINES' RULE APPLIES HERE TOO: THE LIVE
// PATH IS THE `BASELINE` CONSTANT BELOW, NEVER THIS COMMENT. solo-export-guard
// carries a note about a header line left behind by six recaptures while the
// code had moved on; this block starts in the shape that cannot do that.
//
// v2: THE FIRST RECAPTURE. v1 was taken at c28ec2c and carried 236 of 298 rows
// red across fourteen commits, because every commit in between reported its own
// movement and correctly declined to re-baseline. That is the rule working, but
// a baseline is only an instrument while somebody reads it: by the end each
// commit was running a CONTROL BUILD to separate its own movement from the
// inherited, three times in four commits, and that is the step that gets skipped
// first. 248 -> 298 keys.
//
// WHAT v2 ACCEPTS, attributed commit by commit by building each one and
// capturing the RENDERED TEXT rather than the hash — 50 keys added, 54 moved:
//
//   f88fc71  18 moved  the 3x satisfaction scale         Membership, Result Spreadsheet
//   3084262   9 moved  the GL underwriting cycle         GL and Pool views only
//   33fb5bc  10 moved  risk-control category boxes       Decisions|Pool
//   0fd6f03  10 moved  the slider retired                Decisions|Pool
//   1a06723  10 moved  the tiles compacted               Decisions|Pool
//   f338076  26 moved  five decision notes removed       Decisions, all views
//   b6d6767  20 moved  the Risk Control department page  Departments, Decisions|Pool
//   5cbdc2b  10 moved  descriptions and placeholder cost Decisions|Pool
//   2adc80d  +50 keys  per-document Departments coverage 0 moved, keys gained
//   56efd06  10 moved  the Underwriting document         Departments|doc:Underwriting
//   1d640c6 168 moved  WC's opening band re-translated   WC-bearing configs only
//
// The per-commit counts exceed 54 because Decisions|Pool moved six times and
// counts once. 120a94a, 3c3731e, 59e5c4b and 41aeb29 moved NOTHING.
//
// ⚠ EVERY CUMULATIVE FIGURE THOSE COMMITS CLAIMED WAS REPRODUCED, NOT TAKEN ON
// TRUST — 28 at 0fd6f03, 44 at f338076, 54 at b6d6767 and 5cbdc2b, 104 at
// 2adc80d and 56efd06, 236 at 1d640c6. The record is verified.
//
// ⚠ AND THE 18 FROM THE SCALE WERE RULED ON BEFORE THIS FILE WAS WRITTEN,
// because a recapture accepts them silently otherwise. All 18 are at y2 and none
// at y0 — satisfaction is flat at its opening value until a year is played.
// Masking every two-decimal number makes all 18 rows BYTE-IDENTICAL, so nothing
// reordered, no label moved and no screen restructured. Of 2,354 two-decimal
// numbers on those rows 1,404 changed and 950 did not, every changed one inside
// the 1-10 satisfaction scale. Solving each for the anchor it implies under an
// exact 3x, A = (3*old - new)/2, puts all 1,404 inside [7.19, 7.23] — which is
// OPENING_SATISFACTION's [7.20, 7.22] widened only by 2dp rounding, mean 7.2056.
// It is the scale, and it is nothing else.
//
// ⚠ ONE THING FOUND WHILE RULING, PRE-EXISTING AND NOT ACCEPTED BY THIS FILE:
// there are TWO satisfaction numbers on screen. MembershipPage renders the
// four-limb member model at 2dp and moved; ResultsPage and DashboardPage render
// `result.memberSatisfaction`, a separate pool-level scalar, at 1dp and did not.
// 26 y2 rows mention satisfaction and did not move — Calculation Audit's are all
// static labels and weights, but Results shows a real value that the scale never
// reached. That predates v1 and is recorded here rather than fixed.
// ============================================================================
// RENDER_BASELINE overrides the file, which is what lets one build be compared
// against another (an A/B across two commits) rather than only against the
// committed baseline. The committed path is the default and is what a bare run
// uses.
const BASELINE = process.env.RENDER_BASELINE
  ?? path.join(__dirname, '../../baselines/RENDER_IDENTITY_v2.json');
const WRITE = process.argv.includes('--write');
const BASE_URL = process.env.RENDER_URL ?? 'http://127.0.0.1:4173';
// The image ships chromium 1194; a newer `playwright` expects its own build and
// refuses to launch. Pointing at the preinstalled binary is the documented
// answer here and avoids a download the sandbox would not allow anyway.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

// ⚠ THE INSTANCE ID IS FIXED, WHICH IS THE WHOLE DETERMINISM STORY. SetupPage
// falls back to randomInstanceId() on an empty field, so an unset seed makes
// every run a different game and every fingerprint noise. Typed in explicitly.
const INSTANCE_ID = 'RENDERBASE1';
const POOL_NAME = 'Render Identity Pool';

type Cfg = { key: string; lines: string[] };
const CONFIGS: Cfg[] = [
  { key: 'WC', lines: ["Workers' Compensation"] },
  { key: 'GL', lines: ['General Liability'] },
  { key: 'PR', lines: ['Property'] },
  { key: 'WC+GL', lines: ["Workers' Compensation", 'General Liability'] },
  { key: 'WC+GL+PR', lines: ["Workers' Compensation", 'General Liability', 'Property'] },
];
const LINE_LABEL: Record<string, string> = {
  WC: "Workers' Compensation", GL: 'General Liability', PR: 'Property',
};
// The 11 game tabs. 'Game Setup' is excluded: it is the page you leave to start.
const TABS = ['Introduction', 'Departments', 'Pool History', 'Dashboard', 'Decisions',
  'Decision History', 'Financial Statements', 'Results', 'Result Spreadsheet',
  'Calculation Audit', 'Membership'];
// ⚠ WHICH TABS CARRY THE LINE BAR IS DETECTED, NOT LISTED, AND THE FIRST VERSION
// OF THIS FILE LISTED IT. That was a real mistake and it is recorded because it
// is instructive: the list was App.tsx's LINE_VIEW_PAGES as of 750ce12, which
// includes 'Membership' — and whether Membership HAS a line bar is exactly what
// one of the three fixes changed. So the harness could not run at all against
// the commit before the fix: it waited 30s for a 'Pool' button that did not
// exist there and threw. An instrument that assumes the thing it is meant to
// detect cannot detect it.
//
// Detecting instead makes the bar's PRESENCE part of what is measured. A tab
// that gains or loses its line view changes the KEY SET, and the diff reports
// that as `absent -> <hash>` rather than failing to run.

// ============================================================================
// NORMALISATION — AND AN HONEST ACCOUNT OF WHAT IT COST, WHICH WAS LESS THAN
// EXPECTED. A comment here saying each rule was "added because a run disagreed
// with itself" would be a measurement claim, and it would be false: the two
// validation runs were identical on the FIRST attempt, so nothing below was
// forced by an observed disagreement. Every rule is PREVENTIVE, and the honest
// statement is that the app turned out not to render anything non-deterministic
// into its visible text — no clocks, no elapsed times, no animation state that
// survives into innerText, no random ids in text.
//
// The four things that ARE load-bearing, none of them discovered the hard way:
//   1. whitespace collapse   — the ruling's rule: a reflow is not a diff, a
//                              number is.
//   2. innerText not textContent — fingerprints what is VISIBLE, so a hidden
//                              tooltip or aria-only string stays out.
//   3. the double rAF in settle() — networkidle alone is not enough for a built
//                              SPA served from disk: the network goes idle long
//                              before React commits. Preventive, and the one
//                              most likely to have bitten.
//   4. a FIXED instance id and viewport — SetupPage falls back to
//                              randomInstanceId() on an empty field, which would
//                              make every run a different game; a different
//                              window size can cross a responsive breakpoint and
//                              change which elements render at all.
// ============================================================================
const NORMALISE = (raw: string): string => raw
  // Whitespace: a reflow must not be a diff. Every run of space/tab/newline
  // becomes one space. This is the rule the ruling asked for.
  .replace(/\s+/g, ' ')
  .trim();

function hash(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

async function visibleText(page: Page): Promise<string> {
  // innerText rather than textContent: innerText is what is VISIBLE, so a
  // hidden tooltip or an aria-only string does not enter the fingerprint.
  return NORMALISE(await page.locator('body').innerText());
}

async function settle(page: Page): Promise<void> {
  // ⚠ NETWORK-IDLE ALONE IS NOT ENOUGH FOR A BUILT SPA SERVED FROM DISK: the
  // network goes idle long before React has committed. Waiting on the frame's
  // own rendering is what makes a capture reproducible. PREVENTIVE — it was in
  // from the start, so it is not credited with having caught anything.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function startGame(page: Page, cfg: Cfg): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  // A previous config's save would restore instead of showing setup.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByPlaceholder('Enter a name for your pool...').fill(POOL_NAME);
  await page.getByPlaceholder('e.g. ABC12345').fill(INSTANCE_ID);
  // WC is preselected; toggle to exactly the configuration asked for.
  for (const label of Object.values(LINE_LABEL)) {
    const on = cfg.lines.includes(label);
    const btn = page.locator('button', { hasText: label }).first();
    const checked = await btn.evaluate(el => el.className.includes('ring-1'));
    if (on !== checked) await btn.click();
  }
  await page.getByRole('button', { name: 'Start Simulation' }).click();
  await settle(page);
}

async function capture(page: Page, cfg: Cfg, year: string, out: Record<string, string>): Promise<void> {
  // The header chips travel with every screen, so they are their own row rather
  // than being folded into all eleven.
  out[`${cfg.key}|_header|-|${year}`] = hash(NORMALISE(await page.locator('header').first().innerText()));
  const views = ['Pool', ...cfg.lines];
  for (const tab of TABS) {
    await page.getByRole('button', { name: tab, exact: true }).first().click();
    await settle(page);
    // Present only on tabs App.tsx lists in LINE_VIEW_PAGES; asking the page is
    // what lets this run against a commit with a different list.
    const hasBar = await page.getByRole('button', { name: 'Pool', exact: true }).count() > 0;
    const theseViews = hasBar ? views : ['-'];
    for (const view of theseViews) {
      if (view !== '-') {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await settle(page);
      }
      const short = view === '-' ? '-' : (view === 'Pool' ? 'Pool'
        : Object.entries(LINE_LABEL).find(([, v]) => v === view)![0]);
      out[`${cfg.key}|${tab}|${short}|${year}`] = hash(await visibleText(page));
      if (tab === 'Departments') await captureDocuments(page, cfg, year, out);
    }
  }
}

// ============================================================================
// ⚠ THE DOCUMENT TABS WERE A HOLE THE SIZE OF FOUR DOCUMENTS, AND THE ROW ABOVE
// COULD NOT SEE IT. DocumentReader opens on ONE document and renders only that
// one's body, so a single capture of the Departments tab fingerprints the
// document LIST plus whichever document happens to be the default. Everything
// else on that page — four of the five documents — was uncovered. It was found
// when ~900 words of player-facing risk-control copy landed and this harness
// reported the Departments rows as unchanged.
//
// ⚠ ALL FIVE ARE CAPTURED, NOT JUST THE ONE THAT PROMPTED THIS. The gap is
// structural — a default selection hides every non-default document — so fixing
// it for the document that exposed it would leave the identical hole for the
// other three and guarantee this is rediscovered. The two generated memos
// (Actuarial, Claims) are the higher-value coverage anyway: they are built from
// engine numbers by buildActuarialMemo/buildClaimsMemo, where the risk-control
// copy is mostly static prose.
//
// ⚠ THE LIST IS DETECTED, NOT LISTED, which is the lesson the line bar already
// taught this file. Hardcoding five titles would make the harness disagree with
// the page the moment a sixth document is added — and it would disagree
// SILENTLY, by capturing five of six. The buttons are DocumentReader's own
// <nav>, and an unbuilt document renders DISABLED, so "locked" is read off the
// control rather than guessed from a title.
//
// ⚠ AND THE EXISTING `-` ROW IS LEFT EXACTLY AS IT WAS. It is captured BEFORE
// any document is selected, so it still fingerprints the page as it OPENS,
// which is itself worth pinning — if the default document ever changes, that
// row moves and says so. The per-document rows are additions. Investment is
// therefore captured twice, once as the default and once by name; that is
// deliberate, not redundancy to tidy away.
// ============================================================================
async function captureDocuments(page: Page, cfg: Cfg, year: string, out: Record<string, string>): Promise<void> {
  // ⚠ THERE ARE TWO <nav>s AND THE OBVIOUS SELECTOR PICKS THE WRONG ONE. The
  // tab bar is a nav of twelve buttons; the document list is a nav of five.
  // `nav button` matches all seventeen, which fails LOUDLY here only by luck —
  // it timed out on an index that existed at count time and not at click time.
  //
  // ⚠ THE DISCRIMINATOR IS THE DOCUMENT LIST'S OWN STRUCTURE, NOT A TAB LABEL.
  // It used to be "the nav that does not carry 'Game Setup'", which assumed the
  // tab bar always carries Game Setup. demo-video (03de3eb) hid it, the selector
  // matched the TAB BAR, clicked tab buttons and timed out on document-body.
  // DocumentReader renders its list and its `document-body` pane as siblings in
  // one grid, and the tab bar sits outside DepartmentsPage entirely — so walking
  // up from the pane, the first ancestor holding a nav holds the list and only
  // the list. Exactly one is required; anything else throws rather than guesses.
  const navs = page.locator('nav');
  const list = await page.getByTestId('document-body').evaluate(pane => {
    const all = [...document.querySelectorAll('nav')];
    for (let a = pane.parentElement; a; a = a.parentElement) {
      const inside = all.filter(n => a.contains(n));
      if (inside.length) return inside.length === 1 ? all.indexOf(inside[0]) : -1;
    }
    return -1;
  });
  if (list < 0) {
    throw new Error('render-identity-check: no single document list <nav> beside document-body on Departments. '
      + 'DocumentReader\'s markup changed — fix the discriminator rather than letting this capture the tab bar.');
  }
  const buttons = navs.nth(list).locator('button');
  const n = await buttons.count();
  // ⚠ WHICH ONE WAS OPEN ON ARRIVAL, READ OFF THE CONTROL. Restoring by
  // clicking the FIRST button was the obvious move and it is wrong: the first
  // document is not the default one, so it would leave a DIFFERENT document
  // selected than the page opens with, and the next visit's `-` row would
  // fingerprint that instead. The selected entry carries bg-blue-50.
  let openAt = -1;
  for (let i = 0; i < n; i++) {
    if ((await buttons.nth(i).getAttribute('class') ?? '').includes('bg-blue-50')) { openAt = i; break; }
  }
  for (let i = 0; i < n; i++) {
    const btn = buttons.nth(i);
    // Read synchronously off the DOM rather than with a locator: a locator
    // WAITS, so a button that does not carry the expected span hangs for the
    // full timeout instead of saying so.
    const title = NORMALISE(await btn.evaluate(el => {
      const t = el.querySelector('span.font-semibold');
      return (t?.textContent ?? el.textContent ?? '').trim();
    }));
    const key = `${cfg.key}|Departments|doc:${title}|${year}`;
    // A document with no content is disabled in the list. Recorded as LOCKED
    // rather than skipped: if one is ever BUILT, this row moves.
    if (!(await btn.isEnabled())) { out[key] = 'LOCKED'; continue; }
    await btn.click();
    await settle(page);
    // ⚠ THE PANE, NOT THE PAGE, AND THE DIFFERENCE IS LOAD-BEARING. A whole-page
    // capture folds the header chips, the tab bar and the document list into
    // every document's row. Measured, that made the INVESTMENT document — whose
    // content is a static .md identical for every pool — produce five different
    // fingerprints across five configurations. Any config-sensitivity in these
    // rows would then be chrome, and the question these rows exist to answer
    // (does the GATED program list differ by configuration?) would be
    // unanswerable from them. Scoped to the pane, Investment is identical across
    // configurations and Risk Control is not, which is the result that means
    // something.
    out[key] = hash(NORMALISE(await page.getByTestId('document-body').innerText()));
  }
  // Leave the tab as it was found, so the next visit's `-` row is the page as
  // it opens rather than whatever this loop last clicked.
  if (openAt >= 0) { await buttons.nth(openAt).click(); await settle(page); }
}

async function run(): Promise<Record<string, string>> {
  const browser: Browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE });
  // A fixed viewport: a different window size reflows the layout, and while
  // whitespace normalisation absorbs that, a responsive breakpoint can change
  // which ELEMENTS render at all.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const out: Record<string, string> = {};
  for (const cfg of CONFIGS) {
    await startGame(page, cfg);
    await capture(page, cfg, 'y0', out);
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: /^Lock Year \d+$/ }).click();
      await settle(page);
    }
    await capture(page, cfg, 'y2', out);
  }
  await browser.close();
  return out;
}

const now = await run();
const keys = Object.keys(now).sort();
if (WRITE) {
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(keys.map(k => [k, now[k]])), null, 2) + '\n');
  console.log(`Captured ${keys.length} fingerprints -> ${BASELINE}`);
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) {
  console.log(`No baseline at ${BASELINE}. Run with --write to capture ${keys.length} fingerprints.`);
  process.exit(1);
}
const base: Record<string, string> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const all = [...new Set([...Object.keys(base), ...keys])].sort();
const moved = all.filter(k => base[k] !== now[k]);
console.log(`RENDER IDENTITY — ${keys.length} fingerprints, ${CONFIGS.length} configurations\n`);
for (const k of moved) {
  console.log(`  MOVED  ${k.padEnd(46)} ${(base[k] ?? 'absent')} -> ${(now[k] ?? 'absent')}`);
}
console.log('');
if (moved.length === 0) {
  console.log(`ALL ${all.length} FINGERPRINTS IDENTICAL TO BASELINE.`);
} else {
  console.log(`${moved.length} OF ${all.length} FINGERPRINTS MOVED — open the named screens. `
    + `Do NOT re-capture to make this green; see the note at the head of this file.`);
}
process.exitCode = moved.length === 0 ? 0 : 1;
