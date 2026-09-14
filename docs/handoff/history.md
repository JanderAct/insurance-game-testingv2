# History

**⚠ Scope of this document, stated first because it governs everything below.**

This is written **from the commit history and the repository's own documents**.
Where the record supports a statement, it is made. Where it would require
inferring intent or motive from a diff, it is **not** made — those gaps are
marked rather than filled.

**The conversational record is supplied separately by the project owner.** Most
of *why* decisions were taken lives in the working conversations between the
owner and the AI tool that wrote the code, not in the repository. This document
covers the shape of the work, not the reasoning behind it, except where the
reasoning is written down in the repository itself — which, unusually, it often
is (see §5).

---

## 1. The shape of the record

| | |
|---|---|
| First commit | `116b96d`, **2026-07-15** |
| Head of the documented branch | `62e0481`, **2026-09-12** |
| Total commits | **365** |
| Elapsed | **~2 months** |
| Branches | 20 local, 23 remote |
| Tags | 1 (`demo-snapshot-2026-09`, **local only** — see §6) |

Commits by month:

| Month | Commits |
|---|---:|
| 2026-07 | 76 |
| 2026-08 | **220** |
| 2026-09 | 69 (to the 12th) |

August is the bulk of the work. September is fewer commits but larger ones —
the ratemaking loop, forward booking, the experience modifier, the save rebuild
and the claims exhibit all land in those 69.

Authorship:

| Author | Commits |
|---|---:|
| `Claude <noreply@anthropic.com>` | **363** |
| `JanderAct <janderson@prismrisk.gov>` | 2 |

204 commits carry a `Co-Authored-By` trailer. See `source-provenance.md` §1 —
essentially all of this code was written by Claude Code under the owner's
direction, and that is the central fact about the project's history.

---

## 2. The beginning

**`116b96d` (2026-07-15) — "Add files via upload".** Authored by the human, via
GitHub's web interface. It is not an empty repository: it contains a complete
working application — `App.tsx`, nine pages, four components, nine engine
files, 390 lines of types, 305 lines of data, plus a committed 29,968-line
`dist/app.js` build and its source map. The project was then called
**`risk-pool-simulation`** and the page title was "Risk Pool Simulation".

**Where that code came from is not recorded anywhere.** See
`source-provenance.md` §1.2 — this is flagged for review.

**`386d042` (2026-07-16)** — the first AI commit, a `.gitignore`. **`d2e9644`**
follows the same day: *"Break out Underwriting Income and fix income statement
tie-out"* — the first substantive change, and a fair sample of the next two
months: a specific, named defect, fixed and described.

**`fbc4027` (2026-07-20)** — the second and last human commit, another upload,
adding `CLAUDE_CODE_PLAYBOOK.md`, `DECISIONS.md` and `PHASES.md` (1,311 lines).
These are the process and specification documents the project ran on.
`PHASES.md` survives at HEAD (922 lines) with headings that still describe the
build: *"Ripple — Development Spec (v2)"*, *"0. Baseline"*, *"Locked Design
Decisions (reference — from Tiers 1–8)"*, *"STAGE-BY-STAGE BUILD PLAN"*,
*"Suggested Dependency Order"*, *"Engine Inventory — Current vs. New"*,
*"Appendix — Future Multiplayer"*.

**The project was later renamed to "Ripple".** The commit history does not
isolate the rename to a single commit, but `src/utils/gameSave.ts:145` records
its consequence: *"⚠ IT STAYS `riskpool_gamestate_v10` ACROSS THE RIPPLE RENAME.
Renaming it orphans every existing saved game."* **Why** the rename happened is
not in the record. See `source-provenance.md` §6.

---

## 3. How the work was organised

### 3.1 Branch naming is a taxonomy, and it is informative

The branch names fall into clear prefixes, and the prefix says what kind of work
it was:

| Prefix | Branches | What it means |
|---|---|---|
| `feature/` | `development-cession`, `ibner`, `payout-patterns`, `pricing-estimate`, `save-compression` | Building a mechanism |
| `verify/` | `gl-bands`, `gl-rebuild`, `interline-loan` | Checking something already built |
| `test/` | `gl-behaviour-2`, `gl-trend-behaviour`, `two-line-pool`, `wc-wage-inflation` | Behavioural exploration |
| `measure/` | `net-clf`, `wc-class-rates` | Taking a measurement |
| `diagnose/` | `audit-drift`, `k-line` | Investigating a symptom |
| `analyse/` | `retention-level` | Analysis |
| (none) | `claims-distribution`, `multi-line-build`, `ui/decision-surface`, and the July batch | Earlier work, before the convention settled |

That five of the categories are *investigation* rather than *construction* is
the most informative thing the branch list says about how this project was run.
Measuring and diagnosing got their own branches, on the same footing as
features.

### 3.2 ⚠ `main` has never moved

**`main` and `origin/main` both point at `116b96d`** — the founding upload of
2026-07-15. All 364 subsequent commits live on feature branches. Nothing has
ever been merged to the default branch.

`feature/pricing-estimate` (`62e0481`) is the effective trunk and carries the
current state. `demo-2026-09` (`c3af16f`) is a frozen presentation branch.

This is a significant operational fact for anyone inheriting the repository: a
fresh clone checks out `main` and gets a two-month-old prototype, not the
project. It is recorded in `known-issues.md`.

### 3.3 The merge pattern

Merges into `feature/pricing-estimate` are visible in the log (e.g. `d18e9df`,
*"Merge remote-tracking branch 'origin/feature/payout-patterns'"*). The pattern
is that a branch is taken for one mechanism, verified on its own, and merged
back — with the merge itself verified against the two pinned baselines, on the
principle that a branch measuring neutral must stay neutral after the merge.

---

## 4. What the commit subjects show

Commit messages in this repository are declarative sentences about behaviour,
not change summaries. A sample from September, verbatim:

```
62e0481  Re-tier FAST and SLOW by measured runtime, with a derived boundary
d063fa9  Restructure the claims listing as an open inventory, split by program
70c63d8  Develop the Incurred column so both money columns share one vintage
3e5d439  Coalesce the decision-path save into one write per interaction
44a61fe  Compress the save; re-derive the budget from the stored figure
68cbeb9  Rebuild departure on price and marketability; activate Renewal Underwriting
0a69a82  Split primary from excess, rate the primary layer only
493ec3d  Charge WC members their own class rate, not the pool's blend
556cef5  A mature opening book: maturation years, a re-pin, and FORWARD_BOOKING ships
e645c04  Late reporting, step 2: the reporting pattern, read by nothing
14fc0a9  Pay to a schedule, not a fraction of the balance
```

Three patterns are visible in the subjects themselves and are worth naming,
because they are unusual and they are the project's working method:

**Retractions are committed.** The record contains commits that undo or
withdraw earlier work, named as such:

```
eb22e88  Commit 1a attempted and reverted: neither half lands
102d009  Commit 4 stopped: K cannot carry it, and a prior defect is why
d51c87a  Fix the climb measurement, and retract what it was measuring
05ea559  Retract the closure-curve finding: openEnd was start-of-age, and the label was wrong
89d829e  Commit 1a: the horizon re-solve stands, the allocation base does not
```

A project that commits its own retractions leaves a more honest history than one
that rewrites them away, and it means a reader can trust the record. **The
instruction "do not rewrite history" has been standing throughout.**

**Acceptance tests were written before the mechanism.** `2fc362b` — *"The
ratemaking loop's acceptance test, written first and failing 0/4"* — precedes
`132509b`, `9f0756a` (*"the acceptance test goes 4/4"*) and `7881b90` (*"the
acceptance test is 4/4"*). The test-first sequence is legible in the log.

**Mechanisms were shipped dark, deliberately and labelled.** `e551e9a` — *"S1:
the ten-year claim triangle, forward-developed and **read by nothing**"*.
`e645c04` — *"Late reporting, step 2: the reporting pattern, **read by
nothing**"*. `e9b127a` — *"S3: the pool prices off its own played paid triangle,
**flagged off**"*. These are not accidents; the subject line announces the
state. Several of them are still dark at HEAD — see `known-issues.md`.

---

## 5. The design record lives in the code

This is the most important practical thing to know about the project's history,
and it is a consequence of how it was built.

**The reasoning behind decisions is largely written into the source files, not
into the commit messages.** Many files carry headers running to hundreds of
lines that record what was tried, what was measured, what was rejected, and
what the alternative was. Examples a new developer should read early:

- `src/utils/gameSave.ts` — the save-quota defect, the measured codec bake-off
  table, the budget re-derivation, and why `lz-string` lost despite winning on
  size
- `src/data/defaultAssumptions.ts` (283 KB) — the calibration record, including
  which figures are measured and which are judgement (`:4358`: *"GL IS MEASURED.
  WC AND PROPERTY ARE JUDGEMENT. Do not read the three as equally grounded."*)
- `scripts/gates.ts` — the tiering rationale, the `EXPECTED_RED` register with a
  measured justification and a named fix for each entry, and the deferral costs
- `src/types/simulation.ts` — per-field notes on why fields exist, why some are
  optional, and which are deliberately not persisted

Supporting documents, 7,867 lines across 12 files (11 in `docs/`, one in `baselines/`):

| Document | Lines |
|---|---:|
| `baselines/BASELINE_LINEAGE_v4_to_v35.md` | 2,349 |
| `docs/CALIBRATION_FINDINGS.md` | 2,129 |
| `docs/WORKING_PRACTICES.md` | 1,030 |
| `docs/PHASES.md` | 922 |
| `docs/UI_REFINEMENTS.md` | 327 |
| `docs/PROJECT_STATE_SUMMARY.md` | 297 |
| `docs/PROPERTY_NONCAT_DESIGN.md` | 247 |
| `docs/PROPERTY_CAT_ENGINE_DESIGN.md` | 225 |
| `docs/CLAUDE_CODE_PLAYBOOK.md` | 171 |
| `docs/BRIEF_loss_distribution_work.md` | 78 |
| `docs/STAGE_2.10_spec.md` | 51 |

`BASELINE_LINEAGE_v4_to_v35.md` is itself a history — 32 baseline versions,
each recording what moved and why, which is the closest thing the project has to
a change log of engine behaviour.

---

## 6. The tag

`demo-snapshot-2026-09` exists **locally only**. It is not on the remote:
`git ls-remote --tags origin` returns nothing. The record of why is not in the
repository — from the working record, an attempt to push it returned HTTP 403,
because the session credentials in use could push `refs/heads/*` but not
`refs/tags/*`.

A reader should not assume the tag is available to a fresh clone. It is not.
Recorded in `known-issues.md`.

---

## 7. What the commit history does **not** support

Listed explicitly, because the brief asks that inference be marked rather than
presented as fact.

| Question | Status |
|---|---|
| Why the project exists; who it is for; what occasion it was built for | **Not in the record.** The documents describe *what* is built, not *why it was commissioned*. Supplied separately. |
| Why "Ripple"; where the brand mark was recreated from | **Not in the record.** See `source-provenance.md` §6. |
| Where the founding upload came from | **Not in the record.** See `source-provenance.md` §1.2. |
| Which real pool the calibration data came from, and on what permission | **Not in the record.** The code says "the pool's own" throughout and never names it — which is appropriate, but it means consent and terms are unrecorded. See `source-provenance.md` §2. |
| Why individual design decisions were taken | **Partially recorded** — often in the code comments (§5), rarely in commit messages, and the fuller reasoning is in the conversational record. |
| Whether the game has been played by its intended audience, and what they said | **Not in the record.** There is evidence of playtesting (a playtest save was explicitly treated as expendable during the save-format change), but no findings are recorded. |
| Effort or cost | **N/A** — not recorded and not derivable. Commit counts are not effort. |
| Team composition | **N/A** — one human, one AI tool. There is no second contributor in the record. |

---

## 8. Milestones, as the record supports them

Dated from commits. Descriptions are drawn from commit subjects and file
headers, not inferred.

| Date | Milestone | Evidence |
|---|---|---|
| 2026-07-15 | Founding upload — a working single-line prototype | `116b96d` |
| 2026-07-16 | AI development begins | `386d042`, `d2e9644` |
| 2026-07-20 | Spec and process documents added | `fbc4027` |
| 2026-07 (late) | Financial statement work — balance sheet, net position, audit reconciliation | branches `net-position-balance-sheet`, `audit-tab-reconciliation`, `remove-other-assets-liabilities` |
| 2026-08-06 | Multi-line build (WC + GL + Property) | branch `multi-line-build` |
| 2026-08-17/18 | GL rebuild and its verification | `verify/gl-rebuild`, `verify/gl-bands`, `test/gl-trend-behaviour` |
| 2026-08-19 | Retention and net-CLF analysis | `analyse/retention-level`, `measure/net-clf` |
| 2026-08-25/26 | IBNER and development cession | `feature/ibner`, `feature/development-cession` |
| 2026-08-27 | Claims distribution work | `claims-distribution` |
| 2026-09-04 | Payout patterns merged; the ratemaking loop begins | `d18e9df`, `2fc362b` |
| 2026-09-04 → 09-08 | The ratemaking loop, S1–S3, acceptance test to 4/4 | `e551e9a`, `132509b`, `9f0756a`, `7881b90`, `f4406bf` |
| 2026-09-09 | Maturation years; `FORWARD_BOOKING` ships | `556cef5` |
| 2026-09-10 | The member experience modifier | `ed32039`, `5710b85`, `c1e6822` |
| 2026-09-11 | Save compression, debounce and static flush wiring | `44a61fe`, `3e5d439`, `3aa3a50` |
| 2026-09-11 | Demo branch frozen; `demo-2026-09` | `c3af16f` |
| 2026-09-11 | The claims exhibit, rebuilt three times in one day | `05e75be`, `47bb3ea`, `70c63d8`, `d063fa9` |
| 2026-09-12 | Gate sweep re-tiered by measured runtime | `62e0481` (HEAD) |

---

## 9. Note for whoever continues this

The commit history is unusually honest — retractions are committed, dark
mechanisms are announced in their own subject lines, and measurements are
recorded rather than summarised. **Treat it as reliable.** The gap is not
accuracy; it is that *motive* was carried in conversation and only sometimes
written down.

Two practical consequences:

1. **Read the file headers before changing anything.** They frequently contain
   an explicit warning against the change you are about to make, with the
   measurement that ruled it out. `gameSave.ts`, `defaultAssumptions.ts`,
   `claimClosure.ts` and `gates.ts` are the densest.
2. **`main` is not the project.** See §3.2.
