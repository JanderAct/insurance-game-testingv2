# Session-layer practices

For work on the host, player and viewer screens and the transport beneath them. Engine practice lives in
[`docs/WORKING_PRACTICES.md`](docs/WORKING_PRACTICES.md) — which is **on this branch too**, not only on
`feature/member-satisfaction` — and this file does not repeat it. Branch hygiene for value-neutral work
(baselines, merge direction, one session per branch) is in [`UI_BRANCH_RULES.md`](UI_BRANCH_RULES.md);
written for `ui/decision-surface`, its rule 1 applies here for the same reason.

Everything here was learned expensively on this branch. Read it before building.

---

## 1. Recording — the rule that keeps failing

**If a report says something a future reader would need, it goes in the repo, at the place they would be
standing when they need it.**

Not in the commit message. Not in the chat. Not in whichever file happened to be open.

The test is *where would someone be standing when they need this*, not *where am I standing now*.

Three failures, all the same shape:

- **The solo oracle** is cited in **fifteen commit messages on this branch alone** — 46/46 eighteen times,
  and 42/46, 43/46 and 44/46 once each — and a file by that name was never added on any branch
  (`git log --all --diff-filter=A` finds nothing). It is a tool run from outside the repository, so every
  measurement it produced is unreproducible by anyone reading this.
- **Five of eight AWS constraints** existed only in a commit message. Two of the three that were recorded
  sat in `scripts/tools/session-stub-server.ts`, whose own header says nothing in it survives the real
  implementation; the third was one clause on a field in `contract.ts`. All eight are now at
  `src/session/httpTransport.ts`, numbered, where someone writing the real server will be standing.
- **The CORS finding** was recorded in halves. The deployment half went in the deployment file; the half
  about error responses — the one that costs a day of debugging — was nowhere.

`docs/WORKING_PRACTICES.md` has the neighbouring rules: a figure in a comment is a measurement claim, and a
comment describing behaviour nobody implemented reads as a guarantee. Neither caught any of these, because
findings, constraints and design decisions are not measurements.

**Every prompt should be answerable: what did you record, and where.**

---

## 2. Testing a session layer

**The store is the server.** Four browser *tabs* in one context share `localStorage`; four *contexts* do
not. The four-tab test is what caught two real bugs that would otherwise have shipped — identity shared
across tabs, and the lost update below. Four contexts against `localStorage` would have given four private
universes in which both bugs pass unseen.

Against the HTTP transport the reverse holds: contexts are the right unit, because separate storage,
separate identity and real latency are the point. `two-contexts` is that driver.

**A harness that waits for the thing it is testing tests nothing.** `host-charts` passed 43/43 while three
of four charts were missing most of their points, because every block waited for each year's post to land
before letting the host advance. That wait is the product's job, performed by the harness — the record was
forced complete before anything was asserted about it.

The same shape appeared twice more: a driver that slept 900 ms and then read the table was betting on a
poll landing, and a screenshot of a sticky bar lagged the DOM and looked like a product defect until the
DOM was read directly.

**Wait for the figures, never for a clock, and read the DOM rather than the picture.**

**Validate a new check against the broken code.** The replay-fidelity test was trusted because stashing the
fix made it fail 5/8; the chart-gap test because the old code read `[0,1,2,3,5], missing 4`. A test that has
never failed proves nothing.

---

## 3. Three states, and they must be structurally different

Absent, pending and reported are not shades of the same thing:

- **Absent** — the team does not write this line. There is no question to answer and never will be.
- **Pending** — the team writes it and has not reported this year yet.
- **Reported** — figures.

They must differ in *shape*, not in colour or in a dash. Five dashes across five numeric columns is exactly
what a scanning host reads as a result. On a chart, a line at zero reads as a result and a line to zero
reads as a collapse.

**And absence is decided before lateness.** A team that does not write GL is not late on GL and never will
be — asking whether it reported would be asking the wrong question of it forever.

The three renderings and the ordering rule are at `src/session/screens/HostTeamsTab.tsx` (`rowState`) and
`src/session/screens/HostChartsTab.tsx` (`seriesFor`).

---

## 4. One bug in three forms

A read-modify-write that is safe within one thread is not safe across two. Four tabs on one `localStorage`
lost a team's posted result; the HTTP client performs no read-modify-write at all; Lambda runs genuinely
parallel invocations and needs a conditional write.

**Not repeated here.** The derivation is at `scripts/tools/session-stub-server.ts` (why the stub is safe
without a lock) and `src/session/httpTransport.ts` item 8 (all three forms, and what the third costs).
`rev` already exists, is already monotonic per write, and is the token all three want.

---

## 5. One record per year, never one slot

Two separate defects, the same cause, found a commit apart:

- **Decisions** were one slot per team, so a reload replayed every prior year on the team's *latest*
  decisions. A team that varied its choices saw numbers it never played — and the reloaded tab re-posted
  them, overwriting the host's correct record. The corruption was permanent; the disagreement was not.
- **Results** were one slot per team, which serves a table of the last completed year and cannot serve a
  chart over time.

Both are now keyed by year. **A slot is a history that has not noticed it needs to be one yet.**

And carry-forward has a direction: "last submitted" means the most recent lock *before* the target year.
Looking forward is the original defect with the sign flipped. See `src/session/client/decisions.ts`
(`governingYear`).

A third form of the same family: a client that computes several years and posts only the newest. The
catch-up loop in `useSessionGame.ts` now posts every year it produced, each with its own valuation.

---

## 6. The contract is the deliverable

Five endpoints, defined once, with the transport behind them. The swap from `localStorage` to HTTP was one
new file and one line.

⚠ **The structural check has moved.** It was "the concrete class appears in exactly three places: its own
file, the factory, and the harness". It is now **four**: `session-stub-server.ts` imports
`LocalSessionTransport` deliberately, so the stub cannot fork the rules it is meant to be testing. The
claim that matters is unchanged and is the one to check: **no screen, no hook, no page references a
concrete transport.**

That held because of three decisions made on day one:

- **Async and fallible from the start.** Every call returns a promise and every call can fail, so the
  loading and error states were written and exercised before any network existed.
- **Plain JSON in and out**, so marshalling is `JSON.stringify`.
- **Authority as a token field**, which lifts into an `Authorization` header unchanged.

**One deliberate exception, and it is stated rather than eroded:** `decisions` stay opaque, because exactly
one client reads them. `result` could not, once a *second* party renders it — a payload the host draws a
table from needs an agreed shape, or the agreement lives in two places and drifts.

---

## 7. `RESULT_METRICS` is single-source, and it has forked twice

That list was pulled into one file because two copies drifted twice. Since then: `grossPremium`, and
`netIncurredLoss` — both real `ResultSet` fields, neither a published metric, and the second is the obvious
name to reach for when adding a losses chart.

**Check the list before publishing a field.** If what you need is not in it, say so rather than adding a
parallel one. Both instances and the field-by-field mapping are recorded at `TeamYearFigures` in
`src/session/contract.ts`; the case for a quantity that genuinely does not belong — a value per accident
year per valuation cannot be a `RESULT_METRICS` entry, which maps one `ResultSet` to one value — is at
`DevelopedUltimates` in the same file.

---

## 8. The engine is not touched

`processYear` is a pure function of state and decisions. The session layer changes what triggers it and
what happens to the result, and nothing else.

Both value baselines must stay bit-identical through every commit here, for the reason `UI_BRANCH_RULES.md`
rule 1 gives: value-neutral work gates against them unchanged, and a moved value is a leak to investigate.

⚠ **But the value baselines cannot see the screens.** `baselines/VALUE_IDENTITY_v44.json` carries the
pool-level quantised `memberSatisfaction` and has no per-member dimension at all (checked: no member list,
no per-member key). For anything that renders, the render baseline added on `feature/member-satisfaction`
is the only instrument — and this branch does not have it.

Display defects on this branch have been found by a person looking, not by a check. The sparse-chart defect
is the documented case: three of four charts were missing most of their points while every driver was green.

---

## 9. No polling loops

Four `until grep -q <string> <file>; do sleep` watchers deadlocked in one session — 3h38m, 1h44m, 1h23m and
one more — each waiting for a string that never arrived because the inner command wrote its output
elsewhere.

Backgrounded commands already report completion. Run it in the foreground and read the output, or wait for
the notification and read the file once.

**And never run anything concurrently with a long verification run.** It has produced two false reds.
