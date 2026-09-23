// ============================================================================
// THE BROWSER DRIVERS FOR THE SESSION LAYER — shared setup.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/solo-oracle.cjs
//   node scripts/tools/session-drivers/host-charts.cjs        # ... and the rest
//
// ⚠ THEY NEED A BUILT APP AND A SERVER, WHICH IS WHY THERE IS NO npm SCRIPT.
// This is render-identity-check.ts's call, made for the same reason: a bare
// `npm run drivers` that assumed a server would fail confusingly for anyone who
// had not started one. SESSION_URL points them elsewhere (default :4173).
//
// ⚠ AND THEY EXIST IN THE REPOSITORY BECAUSE THE SOLO ORACLE DID NOT. Eight
// instruments produced every count quoted in 22 commit messages on this branch
// while living in a session scratchpad, which made all 22 unreproducible by
// anyone reading the repo. That is SESSION_PRACTICES.md §1 — recorded, then
// left open on eight instruments rather than one. This directory closes it.
//
// THE EIGHT, AND WHAT EACH IS FOR:
//
//   solo-oracle       46  the SOLO game's UI, 11 tabs x 2 line views x 2 year
//                         points, fingerprinted. ⚠ WC-ONLY — see the caveat below.
//   host-charts       46  the Charts tab: four charts, three states, the fixed
//                         axis, the developed column, a tab three years behind.
//   full-session      33  a whole game end to end, four tabs, one browser.
//   viewer            19  /view as a read-only flag: same numbers, no writes.
//   two-contexts      16  a full session across two browser CONTEXTS against the
//                         stub server. Starts and stops the stub itself.
//   four-tabs         15  four tabs sharing one localStorage — the arrangement
//                         that found the identity leak and the lost update.
//   host-teams        13  the Teams tab's three states on three line views.
//   replay-fidelity    8  vary decisions across three years, reload, and require
//                         the rebuilt results to match what was posted AT THE TIME.
//
// ⚠ THE SOLO ORACLE'S 46/46 PROVES CONFINEMENT, NOT CORRECTNESS, and shipping it
// does not change that. It plays WC-only. Every Membership defect found this
// month lived in a configuration it never plays — GL-only and Property-only open
// with an empty roster, WC+GL opened showing 65 of 112 members. The instrument
// that covers those is render-identity-check.ts on feature/member-satisfaction,
// which plays five configurations; this one is kept because it is what the 46/46
// in the commit messages refers to, and a cited number with no instrument behind
// it is the failure being fixed here.
//
// ⚠ .cjs AND NOT .js, AND THE RENAME IS ITSELF ONE OF THE FINDINGS. These ran
// in a scratchpad whose package.json had no "type": "module", so `.js` meant
// CommonJS there. This repo's package.json DOES set it, so the first run from
// the repository failed on every one of the eight at `require is not defined in
// ES module scope`. They were never portable; nothing had ever asked them to be.
// The extension states what they are rather than leaving it to a directory.
//
// ============================================================================
// ⚠ WHAT SURVIVES THE MERGE INTO feature/member-satisfaction, AND WHAT DOES NOT.
//
// That branch carries four engine changes these drivers have never run against:
// WC's supplied CLF curve, WC's shared year factor, GL's triangle contraction
// re-solve, and the satisfaction scale. Every number this layer displays will
// move. Almost none of these assertions care, and the reason is worth stating
// because it is what makes the merge checkable rather than a guess:
//
// VALUE-DEPENDENT — expect these to go red, and re-take rather than debug:
//
//   · solo-oracle, ALL 46 FINGERPRINTS. Each is a SHA-256 of a page's visible
//     text, and every tab that shows a number will hash differently. 46/46 will
//     become 0/46. That is a RE-CAPTURE, and it is only legitimate once you can
//     say which engine change moved which screen — the same rule the value
//     baselines carry. A re-capture to make a run green measures nothing after.
//   · host-charts.cjs, ONE assertion: `dev1At3 > booked1 * 1.05`, that an
//     accident year grows at least 5% over two valuations. It is the only
//     threshold in the eight that reads an engine magnitude, and GL's
//     contraction re-solve is precisely the change that could move it. If it
//     goes red, check the ratio before touching the driver: a smaller number is
//     a re-solved contraction, a number below 1.0 would be a real defect.
//
// STRUCTURAL — these should pass unchanged, and a red one is a REAL defect:
//
//   Everything else, and not by luck. They assert RELATIONSHIPS rather than
//   magnitudes: that two independent computations of the same engine agree
//   (replay-fidelity's field-for-field match, viewer's output equalling the
//   driver's, the host's cell equalling the player's header), that a state is
//   distinct from another state (absent vs pending vs reported), that a count of
//   points or teams or locks is right, that a control is present and disabled.
//   None of those has an engine value in it. Change what the engine computes and
//   they are all still true — which is the property that lets a session layer be
//   tested at all while the engine underneath is moving.
//
// So the merge check is: run all eight, expect solo-oracle to go fully red and
// one host-charts line to be at risk, and treat ANY other red as the session
// layer having broken.
// ============================================================================
//
// ⚠ CHROMIUM IS PREINSTALLED AND MUST NOT BE DOWNLOADED. The container keeps it
// at PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, where `chromium` is a symlink to
// the build Playwright would otherwise fetch. `npx playwright install` is never
// the answer here; PLAYWRIGHT_CHROMIUM overrides the path if this ever runs
// somewhere that keeps it elsewhere.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

/** The repo root, from this file rather than from a hardcoded absolute path. */
const REPO = path.resolve(__dirname, '..', '..', '..');

/** Where the built app is being served. The preview port, not vite's dev port. */
const BASE = process.env.SESSION_URL || 'http://localhost:4173';

/**
 * ⚠ RESOLVED, NOT ASSUMED. The pinned Playwright expects one Chromium build and
 * the container ships another; launching without a path downloads a browser, and
 * on a machine with no network that is a confusing failure a long way from its
 * cause. Undefined at the end is deliberate: somewhere with its own browsers,
 * Playwright's own lookup is the right answer.
 */
function chromiumPath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM,
    '/opt/pw-browsers/chromium',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const build = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
    if (build) {
      const exe = path.join(root, build, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* fall through */ }
  return undefined;
}

async function launchBrowser() {
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath } : {});
}

/** Fail loudly and early if nothing is serving, rather than 30s into a timeout. */
async function requireServer() {
  try {
    const res = await fetch(BASE, { method: 'GET' });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(`\nNothing is serving ${BASE} (${e instanceof Error ? e.message : e}).\n`
      + `  npm run build && npx vite preview --port 4173 --strictPort &\n`
      + `  SESSION_URL=<url> to point elsewhere.\n`);
    process.exit(2);
  }
}

module.exports = { BASE, REPO, launchBrowser, requireServer };
