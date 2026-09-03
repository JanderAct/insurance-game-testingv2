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
// FAST — the tier that runs on every commit. 47 gates, about 10 minutes of CPU
// and a little over 2 minutes of wall clock at 3-way concurrency. Seconds are
// measured, not estimated, on a 4-core box.
//
// ⚠ FOUR OF THESE WERE SITTING IN PROBES WITH A BROKEN EXIT PATH, not with
// nothing to say. gl-claim-check, gl-cutover-check, reinsurance-tower-check and
// wc-cutover-check each collect a problems[] and print FAIL per row, and each
// used to end on a console.log and exit 0 — so this runner printed `ok` beside a
// script that had just printed FAIL. Promoted here rather than renamed: two of
// them had their assertions deliberately STRENGTHENED while in PROBES (962ef60,
// cb00971) and one printed "-12.75% FAIL" into a commit message, so they were
// built and used as gates throughout.
//
// ⚠ THE SPLIT IS BY MEASURED COST, NOT BY IMPORTANCE, and nothing in SLOW is
// less load-bearing than what is here. It is three scripts — see SLOW's note
// for why it was one, which was an unfinished measurement rather than a finding.
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
  'cession-path-independence',       //  77s   GAMES=300 — it cannot resolve its subject below that
  'cession-uplift-basis',            //  22s
  'claims-workbook-check',           //  17s
  'closure-draw-check',              //   3s
  'cohort-stock-check',              //   4s   (sixty years, four games)
  'composition-table-check',         //  17s   STAGE 1 — the magnitude law against 200/(age+1); GL only
  'development-cession-check',       //  14s
  'development-sign-symmetry',       //  11s
  'ending-position-check',           //   6s
  'enrolment-independence-check',    //   2s
  'export-number-format-check',      //  12s
  'funding-basis-check',             //  10s
  'funding-expected-check',          //   2s
  'gl-claim-check',                  //  12s   PROMOTED at this commit — it always asserted; it could not exit
  'gl-cutover-check',                //   6s   PROMOTED at this commit
  'gl-supplied-clf-check',           //  44s
  'ibner-null-check',                //  40s
  'marketplace-generation-check',    //   7s
  'member-loss-history-check',       //   2s
  'net-funding-fields-check',        //   6s
  'opening-centring-check',          //  30s
  'paid-headroom-check',             //   7s
  'paid-ledger-check',               //   4s
  'panel-engine-parity-check',       //   4s
  'pin-vs-band-check',               //  27s
  'pool-aggregation-check',          //   2s
  'pregame-acceptance-check',        //  55s   STAGE 1 BLOCKER — the search must still accept on the shipped path
  'property-claim-check',            //   3s
  'ratio-basis-check',               //   7s
  'cohort-ledger-check',             //  35s   ⚠ EXPECTED RED, exit 2 — see EXPECTED_RED below
  'reinsurance-tower-check',         //   2s   PROMOTED at this commit
  'revision-persistence-check',      //   8s   STAGE 1 — rho, read out of reviseDevelopingSet; ships its rho = 0 control
  'roster-catalog-check',            //   3s
  'save-round-trip-check',           //   3s
  'save-size-check',                 //   4s
  'seed-cohort-shape-check',         //   1s
  'shock-check',                     //   6s
  'solo-export-guard',               //   4s
  'terminal-severity-check',         //  30s   STAGE 1 — derives phi against the pool's settled log-SD
  'tower-runtime-check',             //  13s
  'trend-memoization-check',         //   2s
  'value-identity-check',            //   3s
  'wc-cap-check',                    //   4s
  'wc-cutover-check',                //   6s   PROMOTED at this commit
  'wc-severity-rebuild-check',       //   3s
];

// ============================================================================
// SLOW — a named runnable set rather than a directory nobody walks. Run before
// a merge, and after any change to the tower, the severity distributions, the
// layer structure, or GL's frequency, severity or cap.
//
// ⚠ THE TIER WAS ONE SCRIPT AND THAT WAS AN ARTEFACT OF AN UNFINISHED
// MEASUREMENT, NOT A FINDING. It said "everything else is under 45 seconds and
// property-tower-mc is 571", which was true of everything that had been TIMED.
// The two CLF grid derivers had not been: gl-clf-grid-derive was killed at 55
// minutes during that same concurrent timing pass and left in PROBES with a
// note saying "do not put it in a tier", so its cost was never established and
// nothing ever ran it. An unmeasured script is worse than a retirable one —
// nobody knew what it said.
//
// MEASURED, STANDALONE ON AN IDLE BOX: gl-clf-grid-derive 702s (11m42s), exit
// 0, "All monotonicity checks pass". That is a seventh of the 55-minute figure,
// which is not a contradiction — 55 minutes was three-way concurrent against
// property-tower-mc's Monte Carlo — but the standalone number is the one a tier
// should be sized on, and at 12 minutes it tiers cleanly.
//
// ⚠ BOTH DERIVERS BELONG HERE, AND "IT IS A GENERATOR" WAS NEVER THE REASON TO
// EXCLUDE THEM. Each ends in `process.exitCode = anyNonMonotonic ? 1 : 0` and
// prints "*** NON-MONOTONICITY DETECTED — DO NOT SHIP ***", so both have
// pass/fail semantics — the only test in this repo of whether a derived CLF
// grid is monotonic in percentile. The caveat that survives is one of SCOPE,
// not of kind: they assert monotonicity on the grid they PRODUCE, not on
// STATIC_CLF_TABLE, which is what the engine actually prices off. Keep that
// distinction; it is the reason these are not in FAST beyond their cost.
// (Checked while moving them: the early `exitCode = 1` stratification stop sits
// in an if/else-if/else chain, so the monotonicity branch cannot reach it and
// reset a real failure to 0.)
// ============================================================================
const SLOW: string[] = [
  'martingale-equivalence-check',    // 348s — STAGE 1; sized so its own SE is a fifth of the tolerance
  'property-tower-mc',               // 571s — Monte Carlo over the tower
  'gl-clf-grid-derive',              // 702s — derives GL's CLF grid; asserts monotonicity on it
  'wc-clf-grid-derive',              // 166s — the same, for WC, with the same exit semantics
];

// ============================================================================
// PROBES — measurement, not pass/fail. Every one of these has a reason to be
// here, and the reason is written down. A probe still has to RUN: allocation-grid
// was a probe and it was throwing, which is why the runner offers --probes.
//
// ============================================================================
// ⚠ NINE OF THESE WERE NAMED `*-check` AND ASSERTED NOTHING. THEY ARE NOW
// NAMED `*-report`, AND THE RENAME IS THE POINT RATHER THAN THE TIDYING.
//
// The habitual sweep list this runner replaced was built by reading names. A
// file called `reinsurance-tower-check` gets carried into a "gates run" line in
// a commit message and nobody re-opens it to find out that it prints a table
// and exits 0 either way. Renamed here: ibner-clf-basis, loss-ratio,
// membership-equilibrium, opening-basis, property-fit, reinsurance-layer,
// tower-downside, wc-behaviour, wc-cap-stability — all `-check` -> `-report`.
// Old names appear in commit messages and in one lineage entry; they are the
// same scripts.
//
// ⚠ AND THE NAMING WAS THE SMALLER HALF. FIVE MORE ASSERTED AND COULD NOT SAY SO.
// clf-downside-check, gl-claim-check, gl-cutover-check, reinsurance-tower-check
// and wc-cutover-check each collected a `problems[]` and printed `FAIL` per row
// — and then exited 0. So the sweep printed `ok` beside a script that had just
// printed FAIL, which is strictly worse than a probe that asserts nothing: the
// reader is told green by the runner and would have to read the body to learn
// otherwise. RESOLVED: four were PROMOTED at b0a9bad (they are in FAST above,
// each proven to fire), because their assertions were real and two had been
// deliberately strengthened while sitting in PROBES (962ef60, cb00971). The
// fifth, clf-downside-check, had nothing to promote — its only assertion was a
// tautology over hardcoded literals — and was DELETED here; see the retirement
// record below for where that property is actually asserted.
//
// WORKING_PRACTICES said "eleven of them print and assert nothing". Measured,
// it is nine that assert nothing and five that assert without exiting; the
// eleven straddled the two and hid the five. Corrected there too.
// ============================================================================
const PROBES: Record<string, string> = {
  'allocation-grid': 'compares allocation rules cell by cell; the table it prints is quoted in developmentAllocation.ts [9s]',
  'clf-table-derive': 'derives the static CLF tables — a generator, not a check [240s]',
  'development-cession-size': 'the cession rate by allocation rule; the calibration table [20s]',
  'investment-dominance-report': 'underwriting against investment income, per line, with the implied return. A design reading with no threshold — see its header [12s]',
  'ibner-clf-basis-report': 'reports the IBNER/CLF basis pairing; no threshold. Renamed from -check [17s]',
  'ibner-pregame-report': 'pre-game IBNER state report [64s]',
  'ibner-report': 'IBNER behaviour report [15s]',
  'ibnr-removal-impact': 'one-off impact report for the IBNR removal; historical [14s]',
  'loss-level-diagnostic': 'loss level by line and year; a reading [20s]',
  'loss-ratio-report': 'loss ratio reading; asserts nothing. Renamed from -check [5s]',
  'membership-equilibrium-report': 'membership equilibrium reading; asserts nothing. Renamed from -check [7s]',
  'membership-equilibrium-facts': 'membership facts table [5s]',
  'membership-recalibrate': 'recalibration helper — a generator [7s]',
  'opening-basis-report': 'opening-surplus basis reading; asserts nothing. Renamed from -check [10s]',
  'price-channel-facts': 'price channel facts table [10s]',
  'property-clf-basis-report': 'Property CLF basis report [21s]',
  'revision-total-sd-report': "the per-claim law's TOTAL development against IBNER_TOTAL_SD's own basis, flag ON against OFF. No threshold, deliberately: nothing ships on the ON arm, so a bar would be invented rather than measured — pregame-acceptance-check's reasoning [32s]",
  'property-fit-report': 'Property fit reading; asserts nothing. Renamed from -check — and three engine comments claimed it ASSERTED the fit, now corrected [4s]',
  'reinsurance-layer-report': 'layer reading; asserts nothing. Renamed from -check [41s]',
  'tower-downside-report': 'tower downside reading; asserts nothing. Renamed from -check [8s]',
  'wc-above-tower-report': 'WC above-tower report [109s]',
  'wc-behaviour-report': 'WC behaviour reading; asserts nothing. Renamed from -check [5s]',
  'wc-cap-stability-report': 'WC cap stability reading; asserts nothing. Renamed from -check [21s]',
};

// ============================================================================
// WHAT THE FIRST COMPLETE RUN FOUND, at 440fab0 on feature/payout-patterns.
// Recorded here rather than only in a commit message, because a commit message
// is what the previous arrangement relied on.
//
// 33 of 35 gates green. Two red, NEITHER of them opened by the commit that
// built this runner, and both left standing deliberately at the time.
//
// ⚠ BOTH ARE GREEN NOW, AND NEITHER WAS FIXED BY MAKING THE ENGINE AGREE WITH
// THEM. Kept here in full because the diagnosis is the useful part and because
// the shape recurred: in both cases the GATE was wrong, not the engine.
//   the parity gate was passing two arguments to a three-argument function
//     (bcc0dcb), and its section 1b was asserting something that cannot be true
//     (5b27451)
//   cession-path-independence was asserting a TOTAL that is the sum of an
//     exactly-path-independent component and an inherent one, at a sample size
//     that could not resolve either (this commit)
//
//   cession-path-independence   WC -8.9%, 95% CI [-6.44M, -2.42M], excludes
//                               zero. Failing since 858f9ba. This is the
//                               PERVERSE-INCENTIVE gate — squeezed funding
//                               recovering a different amount from default
//                               funding means the funding decision moves total
//                               cession. It needs bisecting across the branch
//                               and that is its own commit.
//
//                               RESOLVED at 04e71ad / this commit: the bisect
//                               landed on a POWER boundary, not a break. The
//                               gate now asserts the inception component as an
//                               equivalence test at GAMES=300 and reports the
//                               development component, which is inherent.
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
// ⚠ AND "RUN" IS NOT "EXERCISED" — RESOLVED FOR THOSE THREE AT 2a051bb. Whether
// a gate has been TESTED is a question about whether the code it watches ever
// MOVED under it, and that is answerable from history rather than from commit
// prose. Measured, against each one's actual subject rather than its whole
// import graph:
//
//   export-number-format-check   EXERCISED. Six commits since 8723bd8 touched
//                                claimsExport/resultsExport, including a new
//                                sheet section (5c3d9cc) and the paid split
//                                (3ee8ba8). Green across real column changes.
//   trend-memoization-check      BARELY. One commit (cb00971) touched
//                                memoizeByYear; none of the five trend
//                                functions it guards has been edited since.
//   pool-market-share-check      NOT EXERCISED. The pool marketShare formula
//                                has not been touched since f0a43c7 added the
//                                gate for it. 35 commits of green on a subject
//                                that never moved is not evidence.
//
// ============================================================================
// gl-clf-grid-derive IS NO LONGER UNMEASURED. It ran to completion at 2a051bb:
// 702s standalone, exit 0, "All monotonicity checks pass", with the analytic CV
// inside the bootstrap CI and the denominator identity at 8.88e-16. It has moved
// to SLOW with that runtime stated — see SLOW's note. The old text here said it
// was "in no tier because a tier containing it would never be run"; a script in
// no tier is one that never runs at all, which is strictly worse, and the
// 55-minute figure it was excluded on turned out to be concurrency.
// ============================================================================

// ============================================================================
// CAN-FAIL EVIDENCE — WHAT EACH NEVER-FIRED GATE DOES WHEN ITS SUBJECT BREAKS.
//
// 24 of 40 gates had never gone red. That is the absence of evidence, not
// evidence of soundness, so each was put through the method this project uses on
// every new gate: perturb the thing it claims to watch with a PLAUSIBLE defect,
// confirm it goes red, revert. Full table in the commit message; the outcomes
// that change how a reader should treat a gate are recorded here.
//
// 22 of 24 FIRE ON A PLAUSIBLE DEFECT. One is a smoke alarm. One cannot fire.
//
// ============================================================================
// ⚠ TWO GATES WERE DELETED HERE, AND THIS IS WHERE THEIR COVERAGE WENT.
// Written down so nobody re-adds them on the strength of the name.
//
// pool-market-share-check  DELETED at this commit. It reimplemented BOTH the
//   old exposure-sum formula and the new premium-weighted one locally and
//   asserted the year-1 gap between its own two functions. The engine's
//   pool-scope marketShare — simulationEngine's totalMemberCharge-weighted mean
//   of each line's own share — was never read, so it could not fire. Measured:
//   re-weighting the engine by poolPremium left it green, and FORCING THE FIELD
//   TO ZERO left it green.
//
//   WHERE THE COVERAGE IS NOW, all three verified against that same zeroing:
//     pool-aggregation-check   FAILS and names marketShare by field
//                              ("Property-solo pooled row differs from its only
//                              line at marketShare"). This is the real guard —
//                              it asserts the pooled row against the line rows,
//                              which is the property the deleted gate was
//                              gesturing at.
//     audit-formula-check      FAILS with 640 findings; the audit page's Market
//                              Share row is one of them, and this gate has
//                              caught that row wrong TWICE before (118b1fb,
//                              ebdb147).
//     value-identity-check     reports VALUES MOVED.
//
// clf-downside-check       DELETED at this commit. Its only assertion was
//   combinedAt1 = (1 + adminRatio + reinsPct) / (1 + adminRatio + reinsPct)
//   over three hardcoded admin ratios and four hardcoded reinsurance
//   percentages. That is X/X: `worst` is exactly 0 for every input and the
//   "FAIL — formula has drifted" branch is unreachable. It read no engine
//   value, so there was nothing to perturb.
//
//   WHERE THE COVERAGE IS NOW: ratio-basis-check asserts the same property
//   against the REAL engine — expectedCombinedRatio === 1.0000 exactly at
//   CLF 1.000, held at 1e-12 on all three lines AND on the pool aggregate,
//   worst observed departure 2.22e-16 over 360 line-years. It fires: putting
//   the loss numerator back on the gross basis reports 12 mismatches.
//   The MEASUREMENT half of the deleted file — the downside distribution over
//   50 games — was never gated and is not replaced; investment-dominance-report
//   and loss-level-diagnostic cover that ground as readings.
//
// ⚠ NEITHER DELETION REMOVED AN ASSERTION FROM THE REPO, because neither file
// contained one that could fail. That is the bar for deleting a gate here: not
// "something else also looks at this", but "this file asserted nothing, and
// here is the file that asserts it, and here is the perturbation that proves it".
// ============================================================================
//
// ⚠ funding-expected-check's HEADLINE ASSERTION IS A TAUTOLOGY, THOUGH THE
// SCRIPT IS NOT. Section 1 claims "Expected produces CLF = exactly 1.000" and
// implements it as `const wcExpectedClf = 1.0; assert(wcExpectedClf === 1)` —
// its own comment says "the literal engine short-circuit, nothing to compute".
// Measured: changing the engine's Expected dispatch to 1.001 leaves it green.
// Section 4 is real and load-bearing — collapsing WC's four held class rates to
// one pooled rate fails it at 1.73e-1 — so the script stays, but nothing in the
// repo asserts that the Expected path returns exactly 1.
//
// ⚠ enrolment-independence-check CARRIES TWO DEAD ASSERTIONS, and this is the
// OTHER cause of cannot-fire: the subject is gone, not the assertion broken.
// Its printed WX and WXevent columns are `note(true, ...)` — hardcoded passes
// left behind when the weather band moved inside the fitted severity mixture at
// 645c15e. Confirmed: no weather draw remains anywhere in src/. The file's own
// header says the test must come back if a cat band ever reintroduces shared
// within-event draws; until then these two columns print OK about nothing.
// The rest of the gate is sound and fires — see below.
//
// ⚠ property-tower-mc IS A SMOKE ALARM ON ITS DISCRETISATION AXIS, and its
// resolution is now measured rather than assumed. Coarsening the Panjer lattice
// 8x (BIN $25k -> $200k, the exact regression a person writes chasing its 21
// minutes) moves Panjer's worst mean error 4.70% -> 5.67% against an 8% bound
// and PASSES. At 80x ($2M) it fails at 42.67%. So it catches a gross lattice
// defect and would miss a 2x-to-8x one. Its OTHER assertions — the sign-
// stability of the error, and Panjer beating the lognormal comparator — are not
// on that axis and are not characterised here.
//
// ⚠ AND THREE PERTURBATIONS THAT DID NOT FIRE WERE MY MISTAKE, NOT THE GATE'S.
// Recorded because the distinction is the whole method:
//   enrolment-independence-check  dropping the member id from GL's key but still
//     building the rng per member gives every member an IDENTICAL stream, which
//     is position-INdependent — so the gate correctly reported independence. The
//     real coupling shape is ONE stream hoisted out of the member loop, and on
//     that it fires.
//   funding-basis-check  moving the admin RATIO 0.15 -> 0.14 is a level change;
//     assertion 5 is about the BASIS. Moving admin onto the net pure premium
//     fails 3 checks.
//   trend-memoization-check  making memoizeByYear call fn(key) rather than
//     fn(year) is a no-op while all five functions floor internally. Making one
//     of them stop flooring — the hazard its header names — fires it.
// A gate that does not fire on the wrong perturbation has not been tested yet.
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
  for (const name of Object.keys(EXPECTED_RED)) {
    if (!FAST.includes(name) && !SLOW.includes(name)) {
      errs.push(`EXPECTED_RED names '${name}', which is in no tier. An expectation is not an exclusion — `
        + 'the gate has to keep running for the expectation to mean anything.');
    }
  }
  return errs;
}

// ============================================================================
// EXPECTED_RED — GATES THAT ARE LEGITIMATELY RED PENDING A NAMED OPEN ITEM.
//
// ⚠ THIS IS NEW AND IT IS DELIBERATELY NARROW. Every other red in this repo's
// history has been a defect to chase or a check to correct. This category is for
// the third case: a gate built BEFORE the fix it demands, so that the fix turns
// it green and that is the proof, rather than a before-and-after in a report.
//
// ⚠ IT IS NOT AN EXCLUSION, AND THE DISTINCTION IS THE WHOLE REASON IT EXISTS.
// cession-path-independence stayed red for five commits and panel-engine-parity
// for sixty-two, both because nobody was looking. An entry here KEEPS the gate in
// its tier, prints it on every routine run with the open item named beside it,
// and — the load-bearing part — FAILS THE SWEEP IF THE GATE UNEXPECTEDLY PASSES.
// An expectation cannot outlive the defect it describes.
//
// `code` is the EXACT exit code excused, and nothing else is. cohort-ledger-check
// exits 2 for the known flag-on aggregation defect and 1 for a flag-off
// regression, so excusing 2 leaves 1 a hard failure — a real regression on the
// shipped path can never hide behind the expected redness.
// ============================================================================
const EXPECTED_RED: Record<string, { code: number; why: string }> = {
  'cohort-ledger-check': {
    code: 2,
    why: 'flag-on cohort ledger crossing — the per-claim law scales movements by the payout '
      + "pattern's headroom, not the cohort's realised one. Diagnosed at PER_CLAIM_REVISION; "
      + 'the fix is the claim headroom becoming netUnpaid / netUltimate. Flag-off is clean and '
      + 'exit 1 (a flag-off regression) is NOT excused.',
  },
};

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
      const xr = EXPECTED_RED[r.name];
      const verdict = r.timedOut ? 'TIMEOUT'
        : xr && r.code === xr.code ? 'xfail  '
          : xr && r.code === 0 ? 'XPASS  '
            : r.code === 0 ? 'ok     ' : `FAIL ${r.code}`;
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
// ⚠ AN EXPECTED RED IS NOT A FAILURE AND AN UNEXPECTED PASS IS. `xfail` is the
// gate doing exactly what its EXPECTED_RED entry says; `XPASS` means the open
// item is gone and the entry is now a lie, which has to be as loud as a break.
const failed = results.filter(r => {
  const xr = EXPECTED_RED[r.name];
  if (!xr) return r.code !== 0;
  return r.code !== xr.code;
});
const xfailed = results.filter(r => EXPECTED_RED[r.name] && r.code === EXPECTED_RED[r.name].code);
const xpassed = results.filter(r => EXPECTED_RED[r.name] && r.code === 0);

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

if (xpassed.length > 0) {
  console.log('--- UNEXPECTED PASS ---');
  for (const r of xpassed) {
    console.log(`  ${r.name} passed, but EXPECTED_RED says it should exit ${EXPECTED_RED[r.name].code}.`);
    console.log('  The open item it was built for appears to be FIXED. Remove its EXPECTED_RED entry.');
  }
  console.log('');
}

const total = results.reduce((a, r) => a + r.ms, 0);
const wall = Math.max(...results.map(r => r.ms));
console.log(`${results.length - failed.length - xfailed.length}/${results.length} green`
  + (xfailed.length > 0 ? `, ${xfailed.length} expected red` : '')
  + `   cpu ${(total / 60000).toFixed(1)} min   slowest ${(wall / 1000).toFixed(0)}s`);
// ⚠ PRINTED ON EVERY RUN, GREEN OR NOT. The point of the category is that the
// redness stays in front of whoever runs the sweep.
for (const r of xfailed) {
  console.log(`EXPECTED RED: ${r.name} (exit ${r.code}) — ${EXPECTED_RED[r.name].why}`);
}
if (failed.length > 0) console.log(`RED: ${failed.map(f => f.name).join(', ')}`);
if (manifestErrors.length > 0) console.log(`MANIFEST INCOMPLETE: ${manifestErrors.length} problem(s)`);

process.exit(failed.length === 0 && manifestErrors.length === 0 ? 0 : 1);
