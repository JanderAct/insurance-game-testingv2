// ============================================================================
// THE GATE SWEEP — the complete set, and the check that it stays complete.
//
// ⚠ THIS EXISTS BECAUSE "ALL GATES GREEN" WAS REPORTED REPEATEDLY ABOUT A LIST
// THAT DID NOT INCLUDE ALL THE GATES. There was no sweep. There was a habit: a
// dozen script names carried from one commit message to the next, re-typed by
// hand each time. Two gates went red inside it without anyone noticing:
//
//   allocation-grid            threw on every run from dd2af19 to 440fab0, a
//                              whole commit, and was found only because the
//                              next commit happened to touch the code it calls
//   cession-path-independence  has been failing since 858f9ba at WC -8.8% and
//                              was found only because someone ran it by hand
//
// Neither was caught by the thing that is supposed to catch them, because the
// thing that is supposed to catch them was a memory.
//
// ⚠ THE MANIFEST IS CHECKED AGAINST THE DIRECTORY, AND THAT IS THE LOAD-BEARING
// PART. Listing the gates fixes today's omission; asserting that every file in
// scripts/diagnostics/ appears in exactly one of the lists below is what stops
// tomorrow's. A new gate that nobody adds here fails this runner on its first
// run, by name. Adding a script to PROBES is a deliberate act with a reason
// next to it, not an oversight.
//
//   npx tsx scripts/gates.ts             the fast tier — run this every commit
//   npx tsx scripts/gates.ts --slow      the slow tier
//   npx tsx scripts/gates.ts --all       both
//   npx tsx scripts/gates.ts --list      print the manifest and exit
//   npx tsx scripts/gates.ts --jobs N    concurrency (default 3 of 4 cores)
//
// or `npm run gates`, `npm run gates:slow`, `npm run gates:all`.
// ============================================================================

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIAG = path.join(__dirname, 'diagnostics');

// ============================================================================
// FAST — the tier that runs on every commit. 34 gates, 5.6 minutes of CPU,
// about 2 minutes of wall clock at 3-way concurrency. Seconds are measured, not
// estimated, on a 4-core box.
//
// ⚠ THE SPLIT IS BY MEASURED COST, NOT BY IMPORTANCE, and nothing in SLOW is
// less load-bearing than what is here. It is one script.
//
// ⚠ AND THE COST WAS NOT WHERE IT WAS EXPECTED. cohort-stock-check runs SIXTY
// YEARS and was assumed to be one of the expensive ones; it takes 4 seconds,
// because it runs 4 games. The only genuinely slow gate is property-tower-mc at
// 571s, which is a Monte Carlo and is 63% of the whole set's CPU on its own.
// Every other gate finishes inside 44 seconds. Splitting by reputation would
// have moved the wrong four scripts and saved nothing.
// ============================================================================
const FAST: string[] = [
  'actuarial-memo-check',            //   5s
  'audit-formula-check',             //  18s
  'cession-path-independence',       //  20s   RED — see the branch note below
  'cession-uplift-basis',            //  22s
  'claims-workbook-check',           //  17s
  'closure-draw-check',              //   3s
  'cohort-stock-check',              //   4s   (sixty years, four games)
  'development-cession-check',       //  14s
  'development-sign-symmetry',       //  11s
  'enrolment-independence-check',    //   2s
  'export-number-format-check',      //  12s
  'funding-basis-check',             //  10s
  'funding-expected-check',          //   2s
  'gl-supplied-clf-check',           //  44s
  'ibner-null-check',                //  40s
  'marketplace-generation-check',    //   7s
  'member-loss-history-check',       //   2s
  'net-funding-fields-check',        //   6s
  'paid-ledger-check',               //   4s
  'panel-engine-parity-check',       //   4s   RED — see the branch note below
  'pin-vs-band-check',               //  27s
  'pool-aggregation-check',          //   2s
  'pool-market-share-check',         //   6s
  'property-claim-check',            //   3s
  'ratio-basis-check',               //   7s
  'roster-catalog-check',            //   3s
  'seed-cohort-shape-check',         //   1s
  'shock-check',                     //   6s
  'solo-export-guard',               //   4s
  'tower-runtime-check',             //  13s
  'trend-memoization-check',         //   2s
  'value-identity-check',            //   3s
  'wc-cap-check',                    //   4s
  'wc-severity-rebuild-check',       //   3s
];

// ============================================================================
// SLOW — one script, and it is a named runnable set rather than a directory
// nobody walks. Run before a merge, and after any change to the tower, the
// severity distributions or the layer structure.
//
// ⚠ ONE ENTRY IS NOT A MISTAKE. The measurement said what it said: everything
// else is under 45 seconds, and property-tower-mc is 571. Padding this list to
// look like a tier would mean moving fast gates out of the per-commit sweep for
// the sake of symmetry.
// ============================================================================
const SLOW: string[] = [
  'property-tower-mc',               // 571s — Monte Carlo over the tower
];

// ============================================================================
// PROBES — measurement, not pass/fail. Every one of these has a reason to be
// here, and the reason is written down. A probe still has to RUN: allocation-grid
// was a probe and it was throwing, which is why the runner offers --probes.
// ============================================================================
const PROBES: Record<string, string> = {
  'allocation-grid': 'compares allocation rules cell by cell; the table it prints is quoted in developmentAllocation.ts [9s]',
  'clf-downside-check': 'reports the downside of the CLF tables; no threshold [6s]',
  'clf-table-derive': 'derives the static CLF tables — a generator, not a check [240s]',
  'development-cession-size': 'the cession rate by allocation rule; the calibration table [20s]',
  'gl-claim-check': 'GL generator shape report [10s]',
  'gl-clf-grid-derive': 'derives GL\'s CLF grid by Monte Carlo — a generator. Asserts monotonicity on what it produces, not on what ships. STILL RUNNING at 55 minutes when the timing pass was cut — do not put it in a tier',
  'gl-cutover-check': 'before/after report for the GL cutover; historical [6s]',
  'ibner-clf-basis-check': 'reports the IBNER/CLF basis pairing; no threshold [17s]',
  'ibner-pregame-report': 'pre-game IBNER state report [64s]',
  'ibner-report': 'IBNER behaviour report [15s]',
  'ibnr-removal-impact': 'one-off impact report for the IBNR removal; historical [14s]',
  'loss-level-diagnostic': 'loss level by line and year; a reading [20s]',
  'loss-ratio-check': 'loss ratio report despite the name — prints, asserts nothing [5s]',
  'membership-equilibrium-check': 'membership equilibrium report despite the name — prints, asserts nothing [7s]',
  'membership-equilibrium-facts': 'membership facts table [5s]',
  'membership-recalibrate': 'recalibration helper — a generator [7s]',
  'opening-basis-check': 'opening-surplus basis report despite the name — prints, asserts nothing [10s]',
  'price-channel-facts': 'price channel facts table [10s]',
  'property-clf-basis-report': 'Property CLF basis report [21s]',
  'property-fit-check': 'Property fit report despite the name — prints, asserts nothing [4s]',
  'reinsurance-layer-check': 'layer report despite the name — prints, asserts nothing [41s]',
  'reinsurance-tower-check': 'tower report despite the name — prints, asserts nothing [2s]',
  'tower-downside-check': 'tower downside report despite the name — prints, asserts nothing [8s]',
  'wc-above-tower-report': 'WC above-tower report [109s]',
  'wc-behaviour-check': 'WC behaviour report despite the name — prints, asserts nothing [5s]',
  'wc-cap-stability-check': 'WC cap stability report despite the name — prints, asserts nothing [21s]',
  'wc-clf-grid-derive': 'derives WC\'s CLF grid by Monte Carlo — a generator, same as GL\'s [166s]',
  'wc-cutover-check': 'before/after report for the WC cutover; historical [6s]',
};

// ============================================================================
// WHAT THE FIRST COMPLETE RUN FOUND, at 440fab0 on feature/payout-patterns.
// Recorded here rather than only in a commit message, because a commit message
// is what the previous arrangement relied on.
//
// 33 of 35 gates green. Two red, NEITHER of them opened by the commit that
// built this runner, and both left standing deliberately:
//
//   cession-path-independence   WC -8.9%, 95% CI [-6.44M, -2.42M], excludes
//                               zero. Failing since 858f9ba. This is the
//                               PERVERSE-INCENTIVE gate — squeezed funding
//                               recovering a different amount from default
//                               funding means the funding decision moves total
//                               cession. It needs bisecting across the branch
//                               and that is its own commit.
//
//   panel-engine-parity-check   2 checks failed, WC ONLY — GL and Property are
//                               exact to 0.00e+0. The panel's quoted components
//                               disagree with the engine's on WC (pure premium,
//                               net pure premium, pool premium rate, admin rate,
//                               member charge), and against the engine's STORED
//                               fields it is 6,356x the exposure-rounding bound.
//                               That is not rounding.
//
//                               ⚠ IT IS NOT THE MEMBER-MOVEMENT GAP. Section 2
//                               of that script measures the panel-quotes-before-
//                               movement residual and says in its own prose that
//                               it "is NOT a defect"; the failures are in
//                               sections 1 and 1b, which are pre-movement and
//                               should match exactly. Reading the 2-CHECKS-FAILED
//                               line together with the nearest prose gets this
//                               wrong, and did on the first pass here.
//
//                               WC-only points at the WC severity and CLF work,
//                               but which commit is a bisect and its own job.
//
// ⚠ AND A THIRD WAS FOUND BY BUILDING THE LIST, WHICH IS THE POINT.
// panel-engine-parity-check was not in the habitual sweep and nobody knew it
// was red. It had been mentioned in six commit messages, so it is not obscure —
// it simply was not on the list anyone re-typed.
//
// ⚠ THREE GATES HAD NO EVIDENCE OF EVER HAVING BEEN RUN since the commit that
// introduced them: export-number-format-check (8723bd8), pool-market-share-check
// (f0a43c7) and trend-memoization-check (875cb75). No commit message other than
// the one that added them names them. All three pass today. The proxy is weak —
// a script can be run without being written about — but "no gate in this
// directory has NEVER run" is now true by construction rather than by hope.
//
// 27 of the 28 probes run clean. The 28th, gl-clf-grid-derive, was still
// running after 55 minutes and the timing pass was cut rather than waited out —
// so it is neither green nor red here, it is UNMEASURED, and that is the honest
// word for it. It is a Monte Carlo generator that produces the GL CLF grid; it
// is in no tier because a tier containing it would never be run, which is the
// failure this whole file exists to prevent.
// ============================================================================

// ---------------------------------------------------------------- manifest
// ⚠ EVERY FILE IN THE DIRECTORY IS IN EXACTLY ONE LIST, AND THIS IS WHAT KEEPS
// THE SWEEP COMPLETE. A gate added without a line here does not quietly sit
// outside the sweep — it fails this check, by name, on the next run.
function checkManifest(): string[] {
  const onDisk = fs.readdirSync(DIAG).filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, '')).sort();
  const listed = [...FAST, ...SLOW, ...Object.keys(PROBES)];
  const errs: string[] = [];

  const seen = new Set<string>();
  for (const n of listed) {
    if (seen.has(n)) errs.push(`listed twice in the manifest: ${n}`);
    seen.add(n);
  }
  for (const n of onDisk) {
    if (!seen.has(n)) {
      errs.push(`scripts/diagnostics/${n}.ts is in NO list — add it to FAST, SLOW or PROBES in scripts/gates.ts`);
    }
  }
  for (const n of listed) {
    if (!onDisk.includes(n)) errs.push(`manifest names ${n}, which is not on disk`);
  }
  return errs;
}

// ---------------------------------------------------------------- runner
interface Result { name: string; code: number | null; ms: number; timedOut: boolean; tail: string }

const TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS ?? 30 * 60 * 1000);

function run(name: string): Promise<Result> {
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn('npx', ['tsx', path.join(DIAG, `${name}.ts`)], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let out = '';
    let timedOut = false;
    const kill = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    child.on('close', code => {
      clearTimeout(kill);
      const lines = out.trimEnd().split('\n');
      resolve({ name, code, ms: Date.now() - started, timedOut, tail: lines.slice(-14).join('\n') });
    });
  });
}

async function pool(names: string[], jobs: number): Promise<Result[]> {
  const queue = [...names];
  const results: Result[] = [];
  const workers = Array.from({ length: Math.max(1, jobs) }, async () => {
    for (;;) {
      const n = queue.shift();
      if (!n) return;
      const r = await run(n);
      results.push(r);
      const secs = (r.ms / 1000).toFixed(0).padStart(4);
      const verdict = r.timedOut ? 'TIMEOUT' : r.code === 0 ? 'ok     ' : `FAIL ${r.code}`;
      console.log(`  ${verdict}  ${secs}s  ${r.name}`);
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- main
const argv = process.argv.slice(2);
const jobsArg = argv.indexOf('--jobs');
const JOBS = jobsArg >= 0 ? Number(argv[jobsArg + 1]) : 3;

const manifestErrors = checkManifest();

if (argv.includes('--list')) {
  console.log(`FAST (${FAST.length})`);
  for (const n of FAST) console.log(`  ${n}`);
  console.log(`\nSLOW (${SLOW.length})`);
  for (const n of SLOW) console.log(`  ${n}`);
  console.log(`\nPROBES — not gates, run with --probes (${Object.keys(PROBES).length})`);
  for (const [n, why] of Object.entries(PROBES)) console.log(`  ${n.padEnd(32)} ${why}`);
  for (const e of manifestErrors) console.log(`\nMANIFEST: ${e}`);
  process.exit(manifestErrors.length === 0 ? 0 : 1);
}

let set: string[];
let label: string;
if (argv.includes('--probes')) { set = Object.keys(PROBES); label = 'PROBES'; }
else if (argv.includes('--all')) { set = [...FAST, ...SLOW]; label = 'FAST + SLOW'; }
else if (argv.includes('--slow')) { set = SLOW; label = 'SLOW'; }
else { set = FAST; label = 'FAST'; }

console.log(`=== GATE SWEEP: ${label} — ${set.length} scripts, ${JOBS} at a time ===\n`);

const results = await pool(set, JOBS);

// ⚠ A PROBE THAT CRASHES IS STILL A FAILURE. allocation-grid asserts nothing and
// exited 1 for a whole commit because it threw. Under --probes a non-zero exit
// means the script did not complete, which is worth the same red as a failed
// assertion.
const failed = results.filter(r => r.code !== 0);

console.log('');
if (manifestErrors.length > 0) {
  console.log('--- MANIFEST ---');
  for (const e of manifestErrors) console.log(`  ${e}`);
  console.log('');
}

if (failed.length > 0) {
  console.log('--- FAILURES ---');
  for (const f of failed) {
    console.log(`\n### ${f.name}  (exit ${f.timedOut ? 'TIMEOUT' : f.code})`);
    console.log(f.tail.split('\n').map(l => `    ${l}`).join('\n'));
  }
  console.log('');
}

const total = results.reduce((a, r) => a + r.ms, 0);
const wall = Math.max(...results.map(r => r.ms));
console.log(`${results.length - failed.length}/${results.length} green`
  + `   cpu ${(total / 60000).toFixed(1)} min   slowest ${(wall / 1000).toFixed(0)}s`);
if (failed.length > 0) console.log(`RED: ${failed.map(f => f.name).join(', ')}`);
if (manifestErrors.length > 0) console.log(`MANIFEST INCOMPLETE: ${manifestErrors.length} problem(s)`);

process.exit(failed.length === 0 && manifestErrors.length === 0 ? 0 : 1);
