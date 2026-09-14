# Known Issues

Everything below was verified against the repository at `62e0481` while writing
this document. Where a figure is quoted, it was measured, not recalled.

**This document does not soften anything.** The project's own working style is
to record defects with their measurements rather than summarise them away, and
this list follows that. A reader should come away knowing exactly what is red,
what is built and dark, what is claimed and not true, and what is untested.

Read it alongside `source-provenance.md`, which carries a different class of
problem — provenance and rights — and is the more urgent of the two.

---

## 1. The gate sweep is not green

### 1.1 What the sweep reports

The verification harness is 89 scripts: **FAST 52**, **SLOW 13**,
**PROBES 24** (probes measure, they do not pass or fail). `TIER_THRESHOLD_SECONDS
= 88`, derived from recorded runtimes rather than assigned.

**Every one of the 65 pass/fail gates was run at `62e0481` for this document.**
The result:

| Result | FAST | SLOW | Total |
|---|---:|---:|---:|
| `ok` | 47 | 10 | **57** |
| **`FAIL`** | **3** | **1** | **4** |
| `xfail` (expected red, fired as expected) | 2 | 1 | **3** |
| **`XPASS`** (expected red, **passed**) | 0 | 1 | **1** |
| **Total** | **52** | **13** | **65** |

So: **four gates are genuinely failing**, three are red by documented design,
and one is registered as red and is not — which is its own problem (§1.3).

**⚠ The sweep does not fit in a ten-minute window.** `gates:all` was killed by a
600s timeout after 52 of 65; the SLOW tier alone exceeded 1,500s. Individual
SLOW gates measured here: `property-tower-mc` 978s, `gl-clf-grid-derive` 844s,
`martingale-equivalence-check` 348s. Budget accordingly.

### 1.2 The four failures, with what each actually says

These are not flaky, not environmental and not stale. Each was re-run
individually and reproduces.

---

**`closure-draw-check` — FAIL 1 — Property's closure draw ignores the game
identity**

> *"Property: two games' closure decisions on their 22 shared claim ids
> correlate at r=0.162 — the draw is not reading the game's identity, so a claim
> SLOT closes at the same age in every game that has it."*

Measured, over 321,294 claim-ages:

| Line | Shared ids | Share of A | Agreement | Pearson r | Limit | |
|---|---:|---:|---:|---:|---:|---|
| WC | 456 | 15.8% | 53.7% | −0.081 | 0.1 | ok |
| GL | 296 | 13.6% | 51.0% | −0.050 | 0.1 | ok |
| **Property** | **22** | **11.9%** | **63.6%** | **0.162** | **0.1** | **FAIL** |

Independence should look like ~50% agreement and r ≈ 0, which is what WC and GL
show. Property does not. **This is a real determinism defect**: a Property claim
occupying a given slot closes at the same age in every game that produces that
slot. The sample is small (22 shared ids), which is the honest caveat — but the
gate's own limit is 0.1 and Property is at 0.162.

The gate also records what a *worse* version of this looked like: *"the shipped
hash scored 100% and r = 1.000 because the game identity was not an input."* So
this is a partially-fixed defect, not an undiscovered one.

---

**`opening-centring-check` — FAIL 1 — WC's capital constant `K` needs re-solving**

> *"WC: the unfiltered candidate median is 0.367 against a band midpoint of
> 0.329 — off by +0.038, which is 30% of the band's width against a 25%
> tolerance, and 2.7 standard errors. 45% of candidates now fall outside the
> band on the high side, so the search is running near the edge of its own
> proposal distribution."*

400 seeds per line, pre-game depth 10:

| Line | K | Band | Midpoint | Median | Offset | Tol | % of width | SE | Above / below |
|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| **WC** | 0.33 | [0.2667, 0.3921] | 0.329 | 0.367 | **+0.038** | 0.031 | **30%** | **2.7** | 45% / 34% |
| GL | 0.21 | [0.4056, 0.5984] | 0.502 | 0.520 | +0.018 | 0.048 | 9% | 1.0 | 39% / 36% |
| Property | 0.62 | [1.13, 1.7] | 1.415 | 1.506 | +0.091 | 0.143 | 16% | 2.1 | 42% / 30% |

The gate states its own expected consequence and its own remedy: *"Expect the
SHIPPED OPENING to be almost unaffected — the band is narrow enough that
acceptance barely filters position within it — and expect the cost to appear in
ATTEMPTS, nonlinearly, once the band leaves the bulk. **RE-SOLVE K, do not widen
this tolerance.**"*

So: low player-visible impact today, a real and growing cost in pre-game search
attempts, and an explicitly forbidden shortcut.

---

**`triangle-check` — FAIL 1 — the flag, the comment and the gate contradict each
other**

> *"PRICING_TRIANGLE.enabled is TRUE — S1 ships the triangle OFF and nothing
> reads it. Flipping it is S3, and S3 also needs PER_CLAIM_REVISION on first."*

Everything else in this gate passes, including the identity that matters most:

| Line | Value-weighted cumulative | Target | Basis | |
|---|---:|---:|---|---|
| WC | 2.607 ± 0.079 | 2.50 | judgement | OK |
| **GL** | **3.564 ± 0.077** | **3.60** | **MEASURED** | OK |
| Property | 1.254 ± 0.013 | 1.25 | judgement | OK |

**The failure is a contract disagreement, not a numerical one**, and it is a
three-way one:

- `defaultAssumptions.ts:4109` — `PRICING_TRIANGLE = { enabled: true }`
- `defaultAssumptions.ts:3691` — *"THE PRICING TRIANGLE — S1, FLAG-GATED AND OFF.
  Nothing in src/ reads it."*
- `triangle-check` — asserts S1's contract, which is that the flag is off

One of those three is wrong and the repository does not say which. Meanwhile
`defaultAssumptions.ts:4111` records that the flag's day-one retirement condition
*"IS NOW MET"*. **This needs a decision, not a threshold change.**

---

**`property-tower-mc` — FAIL 1 — the aggregate's Panjer pricing has a
sign-changing error, which is the one property it was chosen for**

Run at its defaults: **200 seeds × 25,000 Monte Carlo trials, ~16 minutes.**

> *"1 CHECK(S) FAILED: Panjer's mean error does not change sign across
> attachment levels."*

Measured mean error against Monte Carlo, across the two Property aggregate
attachment levels:

| Method | Mean error range | Worst | Keeps one sign? |
|---|---|---:|---|
| **Panjer** (shipped) | **[+0.41%, −0.73%]** | 0.73% | **No** |
| lognormal (the alternative) | [−7.03%, +9.24%] | 9.24% | No |

Sign counts: at level 0, Panjer is positive on 146/200 seeds and lognormal on
0/200; at level 1, Panjer on 87/200 and lognormal on 190/200.

**Why this matters more than 0.73% suggests, in the file's own words:** *"A
SIGN-CHANGING error cannot be corrected by a loading factor; a one-directional
one can. That, not raw magnitude, is why the aggregate is Panjer-priced."*

So the gate is not failing on accuracy — Panjer's worst error is 0.73% against
lognormal's 9.24%, and the magnitude check passes comfortably inside its 8%
bound. **It is failing on the specific property that justified choosing Panjer
in the first place.** Panjer is still clearly the better of the two; the
argument recorded for preferring it no longer holds in the form it was stated.

The file also records what the gate can and cannot catch: an 8× lattice
coarsening ($25k → $200k bin) still **passes** this gate, and *"sign-stability
is uncharacterised"* — so the gate resolves a gross discretisation defect, not a
subtle one, and its 21-minute runtime is what makes coarsening the likely
regression it would miss.

### 1.3 The expected-red register, and why it is itself a problem

`EXPECTED_RED` in `scripts/gates.ts:649` holds gates known to fail, each with a
measured justification, a paired control and a named fix. Two fired as `xfail`
in the FAST run (`actuarial-memo-check`, `cession-uplift-basis`).

**The register's own comment is the sharpest criticism in this document, and it
was written by the project:**

> *"⚠ THESE ENTRIES ARE PLACEHOLDERS FOR A THRESHOLD RE-DERIVATION AND SHOULD BE
> SHORT-LIVED. Nothing here is an engine defect and nothing here is excused
> vaguely: each carries its measured figure, its paired control, and what would
> make it green. Re-deriving five thresholds against a newly shipped mechanism is
> its own commit with its own measurements, which is why it is not this one.
> **Anyone reading this in a month should be asking why it is still here.**"*

It is now more than a month.

The register groups its entries:

- **`ibner-null-check`** — *"THE NULL IS BUILT FROM THE COHORT LAW'S CONSTANTS…
  the per-claim law does not read those constants… so zeroing them is no longer
  a null and the gate reports 10 problems (development $6.16M at the 'null', a
  matured cohort missing registerSum by 33%)."* Verified green with the flag off
  at the same commit, so it is the null's construction, not a regression.
- **Five entries from the forward-booking flip** — *"THE FIVE BELOW ARE ONE
  DEFECT, NOT FIVE, AND IT IS A RETIRED PREMISE."* Each asserts that a cohort is
  booked at its register and development is mean-one noise around it, which
  forward booking makes false. Causation was measured, not argued: every one was
  run twice at the same commit, flag on and flag off, red on the first and green
  on the second. `cession-uplift-basis` reads 374.1% / 408.3% / 57.2% and 241.9%
  pooled against a 6% bound, with a flag-off control at 0.0% / 1.1%.

**⚠ And the register contains a stale expectation — confirmed by measurement.**
`pin-vs-band-check` is listed as expected-red at exit 3, and **it reported
`XPASS` in this run**. `gates.ts:199` already records it as *"currently an
UNEXPECTED PASS; the open item it was built for appears fixed."* The register
has an XPASS guard precisely because *"an expectation cannot outlive the defect
it describes"* — and this entry has outlived it.

**But the XPASS should not be read as proof the defect is gone, and this is
worth stating carefully.** The registered expectation is *not* about the pin —
it says every assertion about the pin passes at shipped values (WC 42×, GL 12×,
Property 41× elasticity against a 10× floor). What was expected to fail is the
gate's ×2 *perturbed* arm exhausting `MAX_HISTORY_ATTEMPTS`, measured at
**4 of 120 seeds (~3.3%)**. The gate's default is **`SEEDS = 40`**
(`pin-vs-band-check.ts:71`). At 40 seeds and a ~3.3% rate, observing zero
fallbacks is an ordinary outcome, not evidence of a fix.

**So the entry should come out of the register — but because the expectation is
sample-size-dependent and therefore not a usable expectation, not because the
underlying condition has been demonstrated resolved.** The register names the
right successor: *"a probe that measures redraw elasticity without a
fallback-prone arm — perturb the BAND rather than the pin, or read the
elasticity off the in-band share, which is continuous and never falls back."*
And it explicitly refuses the two shortcuts: lowering `PERTURB` is *"the exact
'tune the perturbation until the headline numbers come true' this file warns
against in its own header"*, and raising `MAX_HISTORY_ATTEMPTS` *"would change
the shipped engine to suit a diagnostic."*

### 1.4 The deferral cost is real and is named

FAST defers 13 gates to merge. The runner prints the deferral on every run with
its cost, which is the right behaviour, but the trade is genuine. The sharpest
one is flagged in the code itself:

> *"`pregame-acceptance-check` — 112s — **STAGE 1 BLOCKER**: the pre-game search
> must still accept on the shipped path. ⚠ **THE DEFERRAL WITH THE SHARPEST
> EDGE**: a change that makes the search reject would now ship and be found at
> merge, and a pool that cannot open its book is not a subtle failure."*

### 1.5 The SLOW tier in full

All 13, measured at `62e0481`:

| Gate | Result | Runtime |
|---|---|---:|
| `martingale-equivalence-check` | ok | 348s |
| `wc-clf-grid-derive` | ok | 228s |
| `gl-clf-grid-derive` | ok | 844s |
| **`property-tower-mc`** | **FAIL 1** | **978s** |
| `gl-supplied-clf-check` | ok | 262s |
| `ibner-null-check` | xfail (expected) | 240s |
| `experience-pricing-check` | ok | 172s |
| `marketplace-generation-check` | ok | 164s |
| **`pin-vs-band-check`** | **XPASS** | **146s** |
| `pregame-acceptance-check` | ok | — |
| `maturity-anchor-check` | ok | — |
| `clf-label-backtest-check` | ok | — |
| `cession-path-independence` | ok | — |

The last four were run individually after the tier run exceeded its window;
each exited 0.

**Good news worth stating alongside the bad:** `pregame-acceptance-check` —
named in the code as *"THE DEFERRAL WITH THE SHARPEST EDGE… a pool that cannot
open its book is not a subtle failure"* — **passes**. So does
`cession-path-independence`, the most expensive gate in the suite at a recorded
1,015s.

---

## 2. Mechanisms that are built and dark

Each of these is in the codebase, shipped deliberately unwired, and says so.
None is an accident. All of them are things a reader will otherwise assume work.

| Mechanism | State | Evidence |
|---|---|---|
| **`LATE_REPORTING`** | **Off, and read by nothing.** | `defaultAssumptions.ts:2289`. Its own precondition is written down: *"Do not flip it before maturity-anchor-check's target is re-derived… and the closure correction above is undone."* |
| **The pricing triangle** | **Flag true, comment says off, gate says nothing reads it.** | See §1.2. |
| **`Claim.paymentPattern`** | **Written by GL and Property, read by nothing.** WC stopped populating it at the severity rebuild. | `simulation.ts:268` — *"Data for Phase 3 reserving — nothing consumes it yet."* `defaultAssumptions.ts:1933` — *"NOT FIXED YET, deliberately — the pattern is read by nothing."* |
| **`Claim.description`** | **Always absent. Nothing populates it.** The type, the export column and the memo's conditional rendering all exist ahead of any writer. | `simulation.ts:270-289`. This one is deliberate and defensible — it means no schema change when a writer arrives — but a reader should know the column is always empty today. |
| **`LINE_REPORTING_PATTERN`** | *"step 2 of the five-step repair: a curve, a judgement and a deriver, **wired to nothing**."* And: *"The absence this paragraph describes is still the shipped behaviour."* | `defaultAssumptions.ts:424` |
| **Property attritional and weather bands** | **Both unwired.** | `shocks.ts:51` |
| **`PROPERTY_CAT_MODEL`** | Referenced in two comments as *"inert constants"* — **but the constant does not exist in `src/` at all.** The comments are stale in addition to the mechanism being absent. | `shocks.ts:51`, `shockCatalog.ts:32` |
| **`underwritingStrictness`** | **Deleted, not deprecated.** An old save may still carry the key; nothing reads it. **But `howToPlay.md` still describes it to the player as live**, with three live channels and specific numbers. See §4. | `simulation.ts:436-439` |
| **Investment liquidity requirement** | **Planned, not built.** No liquidity constraint or early-sale cost is applied. | `investmentMemo.md:12`, `howToPlay.md:128` — both say so honestly. |
| **`LossDistributionConfig`** | An acknowledged orphan placeholder, deliberately left. Part of a *"wider orphan cluster"* the code names but never enumerates. | `simulation.ts:1570-1587` |

---

## 3. Shock events: only four of nine effect kinds actually run, and the player is told so

`src/types/shocks.ts` declares its union as *"The eight effects"*. **There are
nine.** `IMPLEMENTED_EFFECTS` — the runtime allow-list the resolver actually
checks — contains **four**:

```
'injectClaim', 'freqMultiplier', 'componentFreqMultiplier', 'sevMultiplier'
```

…and `injectClaim` is *"IMPLEMENTED for WC"* only. So one of the four working
kinds is also line-limited.

The remaining five are marked **NOT IMPLEMENTED** in the type itself:

| Kind | Note |
|---|---|
| `forceEvent` | *"NOT IMPLEMENTED — and cannot be until the Property cat band exists. There is no cat generator… There is no quake peril to force. Kept in the vocabulary because event #2 is in the catalog as data."* |
| `investmentShock` | *"NOT IMPLEMENTED."* |
| `exposureChange` | *"NOT IMPLEMENTED."* |
| `poolExpense` | *"NOT IMPLEMENTED."* |
| `paramOverride` | *"NOT IMPLEMENTED. It was implemented for WC alone, against an allow-list (`WC_OVERRIDABLE_PATHS`) that held exactly one path… The WC severity rebuild retired the presumption process, which left the allow-list empty and every WC parameter unreachable — so the mechanism was deleted rather than parked."* GL and Property never supported it: both compute constants at module load, which *"would silently ignore any override."* |

**The guard itself is sound and is the right design.** `IMPLEMENTED_EFFECTS`
(`shocks.ts:166`) says of itself: *"The resolver checks against this rather than
against a comment, so the two cannot drift"* — and `shockResolver.ts:115` skips
anything not in it. So the unimplemented kinds are inert, not broken. The
failure is in the *count* comment above the union, which is exactly the drift the
allow-list was built to prevent one level down.

The shock *catalogue* is 23 KB of data describing events that, for these kinds,
cannot fire.

**⚠ And this reaches the player.** `src/pages/ResultsPage.tsx:235` renders:

> *"Shock Events: not yet implemented — Phase 4 will show which specific
> event(s) fired this year."*

A demo-facing application that prints "not yet implemented" in its own results
panel is a product defect, whatever its engineering justification.

---

## 4. Documentation that is wrong or stale

These matter more than usual here, because this codebase's comments *are* its
design documentation. A wrong comment is a wrong spec.

| Site | Problem |
|---|---|
| **`memberCatalog.ts:2`** | Names `roster_canonical_v5.csv` as *"Source of truth"*. The generator (`generate-member-catalog.ts:102`) reads **v6**. |
| **`howToPlay.md`, "Underwriting strictness, by line"** | Describes the decision to the player as live, with three specific channels and numbers (*"Above a strictness of 6 the Pool stops taking applicants as they come and screens them, considering only the better half"*). **`simulation.ts:436` says the field is DELETED, not deprecated**, and that nothing reads it. The document's own header even boasts that an earlier revision was *wrong* to mark it inactive — and it is now wrong in the other direction. |
| **`defaultAssumptions.ts:3691`** vs **`:4109`** | The comment says the pricing triangle is off; the flag says true. See §1.2. |
| **`shocks.ts:51`, `shockCatalog.ts:32`** | Both reference `PROPERTY_CAT_MODEL` as existing-but-inert. It does not exist in `src/`. |
| **`shocks.ts:128`** | *"The eight effects."* There are **nine** in the union. |
| **`welcomeGuide.ts:3`** | *"Source: 01A_WELCOME_TO_RIPPLE.md"* — that file is not in the repository and not in git history. |
| **`docs/PROJECT_STATE_SUMMARY.md`** | Names `multi-line-build` as the working branch and **baseline v11**; HEAD is `feature/pricing-estimate` at **baseline v37**. It is a genuinely useful catch-up document, which is exactly why a reader will trust it and be misled. |
| **Nothing states the member roster is synthetic** | 200 named school districts, cities and counties, in a project that openly says its loss parameters come from a real pool. See `source-provenance.md` §3. |

---

## 5. Test coverage: 27 of 86 `src` files are reachable from no gate

Measured by computing the transitive import closure over `src/` from all 91
files in `scripts/`:

| | |
|---|---:|
| `src` `.ts`/`.tsx` files | 86 |
| Reachable from some gate | 59 |
| **Unreachable** | **27** |

The full list:

| Category | Files |
|---|---|
| **Pages (11)** | `DashboardPage`, `DecisionHistoryPage`, `DecisionsPage`, `DepartmentsPage`, `FinancialsPage`, `HistoryPage`, `IntroductionPage`, `MembershipPage`, `ResultSpreadsheetPage`, `ResultsPage`, `SetupPage` |
| **Components (9)** | `AllocationBar`, `DocumentReader`, `EndingPositionPanel`, `Header`, `LoanPromptModal`, `SliderInput`, `StatCard`, `TabNav`, `WelcomeModal` |
| **Entry / assets (4)** | `App.tsx`, `main.tsx`, `vite-env.d.ts`, `assets/RippleLogo.tsx` |
| **Utils (2)** | **`financialStatementEngine.ts`**, `renderMarkdown.ts` |
| **Data (1)** | `welcomeGuide.ts` |

**The one that matters is `financialStatementEngine.ts`.** The other 26 are UI,
entry points and markdown rendering, and the project made a deliberate choice not
to build a DOM test harness. `financialStatementEngine.ts` is an **engine** — it
produces the income statement and balance sheet the player reads — and no gate
reaches it.

The mitigation, stated fairly: `CalculationAuditPage` mirrors both statements
line-for-line with numeric formula specs and 15 reconciliation checks, and that
page *is* reachable from a gate. So the statements are checked; the engine
module itself is not directly.

**Two caveats on the measure itself, both of which understate coverage:**

1. **Five gates read files from disk via `readFileSync`** rather than importing
   them, so what they exercise is invisible to an import-graph analysis:
   `value-identity-check` and `solo-export-guard` read the baselines;
   `save-flush-wiring-check` and `surface-privacy-check` read application
   *source* as text; `roster-catalog-check` reads the roster CSV. The last three
   are the relevant ones here — `save-flush-wiring-check` asserts against
   `App.tsx`, which the table above counts as unreachable.
2. Reachability is not exercise. A file being imported by a gate does not mean
   the gate asserts anything about it.

**The alternative was considered and deliberately not taken.** A jsdom or
happy-dom harness would allow UI testing; it was recorded as the option *"so the
next person does not rediscover the choice"* rather than adopted. The static
`save-flush-wiring-check` is the compromise: it asserts both lifecycle listeners
are registered, that each handler reaches `flush()`, and that cleanup removes
both — and it states in its own header that **it cannot assert the browser
actually fires them.**

---

## 6. Repository and tooling problems

### 6.1 `main` has never moved

`main` and `origin/main` both point at **`116b96d`** — the founding upload of
2026-07-15. All 364 subsequent commits live on feature branches. **A fresh clone
checks out a two-month-old prototype.**

### 6.2 `tsx` is undeclared, and the entire verification harness depends on it

All five gate scripts run `npx tsx`. `tsx` is in `package.json` **not at all**,
is in `package-lock.json` only as an *optional peer* of another package, and is
**not in `node_modules`**. Consequences:

- `npm run gates` fetches `tsx` from the registry on first use. **The
  verification suite requires network access**, though the application does not.
- The version is unpinned. Two developers can run the same 89 gates on different
  TypeScript loaders.
- In an air-gapped environment the gates do not run at all.

### 6.3 `@supabase/supabase-js` is declared and entirely unused

Only occurrences in the whole repository are `package.json` and
`package-lock.json`. No import, no client, no key, no configuration. It implies
a backend, a database and an auth provider that **do not exist**, and drags an
unused transitive subtree (`auth-js`, `functions-js`, `postgrest-js`,
`realtime-js`, `storage-js`, `phoenix`) into the licence surface.

### 6.4 `npm audit`: 9 vulnerabilities (2 moderate, 7 high)

| Package | Severity | Direct? | Fix |
|---|---|---|---|
| **`xlsx`** | high ×2 (prototype pollution, ReDoS) | **direct** | **None available.** SheetJS stopped publishing to npm after 0.18; current releases come from the vendor CDN. `npm update` cannot resolve this by construction. |
| `postcss` | high | direct | `npm audit fix` |
| `brace-expansion`, `browserslist`, `js-yaml`, `nanoid` | high | transitive | `npm audit fix` |
| `esbuild` (via `vite`) | moderate | transitive | `npm audit fix --force` — **breaking**, moves Vite 5 → 8 |
| `baseline-browser-mapping` | moderate | transitive | `npm audit fix` |

Fair exposure note on `xlsx`: both advisories concern *parsing* untrusted
spreadsheets, and this application only ever **writes** workbooks — there is no
import path and no user-supplied file is ever accepted. Practical exposure is
low. That is an assessment, not a clearance; the package is unmaintained on the
channel it is consumed from.

The `esbuild` advisory concerns the **dev server** allowing any website to send
requests to it and read the response. It does not affect the built bundle.

### 6.5 Lint: 21 problems (14 errors, 7 warnings)

Standing state, reproduced at `62e0481`. Six are auto-fixable. The bulk are
`prefer-const` in diagnostic scripts, plus seven
`react-refresh/only-export-components` warnings on `CalculationAuditPage` and one
`no-unused-vars` (`_priorResult` in `narrativeEngine.ts`). Individually trivial;
collectively they mean the lint output is never clean and therefore never read.

*(`npm run typecheck` passes clean — both the app and the scripts projects.)*

### 6.6 Other

| Item | Detail |
|---|---|
| **Bundle size** | 911.61 kB JS (286.92 kB gzipped), over Vite's 500 kB warning. No code splitting has been attempted. It builds in 9.56s and works. |
| **No CI** | No `.github/workflows/`, no pipeline of any kind. Nothing runs on push or PR. Verification happens only when a developer remembers. |
| **Dead favicon** | `index.html` links `/vite.svg`; there is no `public/` directory. A console 404 on every load. |
| **Gate timings are recorded, not measured in place** | `scripts/gate-timings.json` is committed and backs the manifest check's tier-threshold enforcement — but an ordinary sweep does **not** rewrite it (verified: `gates:all` left it unmodified). A gate that has quietly got slower stays in FAST until someone re-records deliberately. The anti-drift check is therefore only as current as its last recording. |
| **`demo-snapshot-2026-09` tag is local only** | Not on the remote. `git ls-remote --tags origin` returns nothing. A fresh clone will not have it. |
| **Five superseded roster CSVs committed** | `roster_canonical.csv` and `_v2` through `_v5`. Nothing reads them. |
| **`eslint-plugin-react-hooks`** | Declared at `^5.1.0-rc.0` — a release candidate as the floor of the range. |
| **Node version unpinned** | No `engines`, no `.nvmrc`. Node 22 is what works. |

---

## 7. Model limitations the code states about itself

Not defects — the model saying where it is weaker. Recorded because a reader who
does not know these will over-read the outputs.

| Statement | Site |
|---|---|
| *"⚠ GL IS MEASURED. WC AND PROPERTY ARE JUDGEMENT. Do not read the three as equally grounded."* Only GL's cumulative development (3.60) has a real anchor. *"WC 2.50 and Property 1.25 have NO source behind them."* | `defaultAssumptions.ts:4358` |
| *"⚠ KNOWN SIMPLIFICATION, NOT AN OVERSIGHT. CAS prescribes SEPARATE medical and indemnity trends"* — the model blends them. | `exposureTrend.ts:44` |
| The WC large-severity component is **asserted, not fitted**: the EM fit *"topped out near $9.8M once per 431 years and could not produce what the pool had actually seen"*, so it was overridden. Recorded as an open item — *"it decides whether this is a correction or an override."* | `defaultAssumptions.ts:172-180`, `:212` |
| The localStorage quota (5,242,613 chars) was measured on **Chromium only**. *"Other engines may differ and were not reachable to measure; that is exactly why the failure below is loud rather than assumed impossible."* | `gameSave.ts:39` |
| `memberPremiumShares` is **not exactly reconstructible** on a reloaded game — it depends on `memberLossHistory` as it stood before the year, and only a capped window is kept. *"Reconstruction therefore works near the present and degrades with age."* | `gameSave.ts:213` |
| `Member.yearJoined` is *"LOSSY display convenience, NOT an enrollment record"* — a Y1 recruit and an opening member are indistinguishable by it. | `simulation.ts:51` |
| The reserve cohort's `grossPaid`/`grossUnpaid` are *"A PARALLEL LEDGER THAT NEVER FEEDS THE NET ENGINE"*, kept so the value-identity null test stays available. | `simulation.ts:649` |

---

## 8. Ranked: what to deal with first

1. **The `source-provenance.md` items** — real book data in comments, no
   licence, unestablished founding provenance. These are not engineering
   problems and they gate everything else.
2. **`triangle-check`** — a flag, a comment and a gate that contradict each
   other. Whichever is wrong, something in the pricing path is not what it
   says.
3. **The player-facing "not yet implemented" line** on the Results page, in an
   application that has been demoed.
4. **`closure-draw-check`** — a genuine determinism defect in Property's closure
   draw, partially fixed and still failing.
5. **`main` pointing at the prototype**, and **`tsx` undeclared** — both one-line
   fixes that materially change what a new team experiences on day one.
6. **`property-tower-mc`** — the aggregate's pricing method no longer satisfies
   the property it was chosen for. Lower urgency than it sounds: Panjer's worst
   error is 0.73% against the alternative's 9.24%, so this is a stale
   *justification* rather than a mispriced tower. But the recorded reasoning
   should be brought back into line with the measurement.
7. **The stale `pin-vs-band-check` expectation** — remove it, but see §1.3: the
   XPASS is plausibly sampling, not a fix. Then the five forward-booking
   threshold re-derivations the register asks for.
8. **`opening-centring-check`** — re-solve K. Low visible impact now, growing
   cost, and the shortcut is explicitly forbidden.
9. **Everything in §4** — wrong documentation in a codebase whose comments are
   the spec.
