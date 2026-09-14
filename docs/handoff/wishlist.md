# Wishlist

What is next. Sourced from the repository's own forward-looking notes — the
`docs/PHASES.md` build plan, flags with written retirement conditions, fields
that exist ahead of their writers, and the `EXPECTED_RED` register's named
fixes — plus the gaps this documentation exercise turned up.

**⚠ Priorities below are mine, not the project owner's.** The repository records
*what* was planned; it does not rank it, and the owner's own ordering lives in
the conversational record supplied separately. Where the code itself states a
precondition or a retirement condition, that is quoted rather than judged.

---

## 1. Do these before anything else

These are not features. They are the things that make the project safe to hand
to a team.

### 1.1 Resolve the provenance items

**`source-provenance.md` → Items Recommended for Review** is the first piece of
work, and most of it is decisions rather than code. The ones that gate
everything else:

- **Decide what happens to the real book data in code comments** — claim
  counts, policy years, and a dated catastrophe with a loss total, all beyond
  the project's own stated rule. The edit is trivial (they are comments;
  nothing moves, no baseline shifts). The decision is not mine.
- **Confirm the pool's owners permit distribution of parameters fitted against
  their experience.**
- **Add a `LICENSE`.** The repository currently has none, so ownership and
  permitted use are recorded nowhere.
- **Establish where the founding upload came from** (`116b96d`). One sentence
  from the person who uploaded it closes it.

### 1.2 Point `main` at the work

`main` still sits at the 2026-07-15 founding commit. A fresh clone gets a
prototype, not the project. Merge `feature/pricing-estimate` to `main`, or
change the default branch. Either is fine; the current state is not.

### 1.3 Declare `tsx`

The entire 89-gate verification harness runs on `npx tsx`, and `tsx` is not a
declared dependency. Add it to `devDependencies` at a pinned version. This makes
the gates reproducible and lets them run offline. One line of `package.json`.

### 1.4 Remove `@supabase/supabase-js`

Declared, entirely unused, drags an unused transitive subtree into the licence
surface, and implies a backend that does not exist. Deleting it is the cheapest
improvement available anywhere in the repository.

### 1.5 Say that the roster is synthetic

One header line on `roster_canonical_v6.csv` and one in `memberCatalog.ts`. In a
project that openly says its loss parameters come from a real pool, a reader
will otherwise assume 200 named school districts and cities are real. While
there: fix `memberCatalog.ts:2`, which names `v5` as the source when the
generator reads `v6`, and delete the five superseded roster CSVs nothing reads.

---

## 2. Finish what is built and dark

Each of these exists in the codebase, was shipped deliberately unwired, and
says so in its own words. They are the shortest path to visible new behaviour,
because the mechanism is already there.

### 2.1 `LATE_REPORTING` — off, with a stated precondition

`defaultAssumptions.ts:2289`: *"LATE REPORTING — off, and read by nothing at
this commit. Step 3 puts `reportedYear` on the claim behind this. Step 4 makes
the cohort book on the reported subset."*

**The code states its own gate:** *"Do not flip it before maturity-anchor-check's
target is re-derived (it asserts a climb of 1/c that emergence changes to
1/c × 1/reportedShareAtAge(line, 1)) and the closure correction above is
undone."*

So the work is: re-derive that gate's target, undo the closure correction, then
flip. Not a flag flip on its own.

### 2.2 The pricing triangle — shipped, and `triangle-check` says nothing reads it

`PRICING_TRIANGLE = { enabled: true }` at `defaultAssumptions.ts:4109`, with the
note at `:4111` that *"THIS FLAG HAD A RETIREMENT CONDITION, WRITTEN ON DAY ONE,
AND IT IS NOW MET."* — the flag exists so the held rate and the experience rate
can be measured on identical seeds, and that measurement is done.

But `defaultAssumptions.ts:3691` still reads *"THE PRICING TRIANGLE — S1,
FLAG-GATED AND OFF. Nothing in src/ reads it"*, and `triangle-check` is standing
red saying S1 ships it off and nothing consumes it. **The flag, the comment and
the gate disagree with each other.** Reconcile the three, then either wire the
consumer or retire the mechanism.

### 2.3 Shock events — only four of nine effect kinds run

`src/types/shocks.ts` marks `forceEvent`, `investmentShock`, `exposureChange`,
`poolExpense` and `paramOverride` as not implemented, with the Property cat path
blocked behind a generator that does not exist. Meanwhile **`ResultsPage.tsx:235`
prints "Shock Events: not yet implemented — Phase 4 will show which specific
event(s) fired this year" to the player.**

Two separable pieces of work:

- **Cheap and player-visible:** implement `poolExpense` and `investmentShock`.
  Neither needs a new generator — one is an expense line, the other an override
  on an asset-class return. `exposureChange` is similar.
- **Expensive:** `forceEvent` needs the Property catastrophe band, which needs a
  cat generator. `propertyClaimEngine` carries an attritional band and a weather
  band, both unwired, and `PROPERTY_CAT_MODEL` is inert constants.
  `docs/PROPERTY_CAT_ENGINE_DESIGN.md` (225 lines) is the design.

`paramOverride` has a written restoration recipe at `shocks.ts:157`:
*"reinstate a path allow-list next to the parameters it reaches, grep every read
of each path first (a read inside a module-level helper must be refactored to
take params), and add the kind back to `IMPLEMENTED_EFFECTS`."*

Regardless of which lands, **the "not yet implemented" line should stop being
shown to players** — either because it is implemented or because the panel is
hidden.

### 2.4 `Claim.paymentPattern` — written and read by nothing

Populated by GL and Property, not by WC (which stopped at the severity rebuild),
consumed by nothing. `simulation.ts:268` marks it *"Data for Phase 3 reserving
— nothing consumes it yet"*, and `defaultAssumptions.ts:1933` says the defect in
it is *"NOT FIXED YET, deliberately — the pattern is read by nothing."*

Either Phase 3 arrives and reads it, or it comes out. The project's own standing
rule — *a stored field nothing reads is removed* — points at the second.

### 2.5 `Claim.description` — the field exists ahead of its writer

Always absent; nothing populates it. This is deliberate and documented: the
type, the export column and the claims memo's conditional rendering are all in
place so *"the day something writes one there is no schema change, no save
migration and no export rework — only a writer."* The writer is the open work.

---

## 3. Clear the red

### 3.1 The four failing gates

`closure-draw-check` (Property's closure draw ignores game identity),
`opening-centring-check` (WC's `K` needs re-solving — and the code forbids
widening the tolerance instead), `triangle-check` (a flag, a comment and a gate
that contradict each other) and `property-tower-mc` (Panjer's mean error changes
sign across attachment levels, which is the property Panjer was chosen for). See
`known-issues.md` §1.2 for the measured detail on each.

### 3.2 Re-derive the five expected-red thresholds

The `EXPECTED_RED` register's own comment is unambiguous about the intent:

> *"⚠ THESE ENTRIES ARE PLACEHOLDERS FOR A THRESHOLD RE-DERIVATION AND SHOULD BE
> SHORT-LIVED. Nothing here is an engine defect and nothing here is excused
> vaguely: each carries its measured figure, its paired control, and what would
> make it green. Re-deriving five thresholds against a newly shipped mechanism
> is its own commit with its own measurements. **Anyone reading this in a month
> should be asking why it is still here.**"*

It is now more than a month. Each entry names its own successor — e.g.
`cession-uplift-basis` should *"normalise by cede(matured register) −
cede(contracted register)"*, which needs the tower re-run over each cohort's
matured register: *"a measurement commit, not a re-pointing."*

### 3.3 Rebuild `ibner-null-check`'s null

Named fix, quoted from the register: *"rebuild the null for the per-claim law —
phi to zero, the drift to zero, and the settlement factor neutralised to 1.0 —
which needs a settlement override the law does not currently expose. Not S3; its
own small commit."*

### 3.4 Replace the stale `pin-vs-band-check` expectation

It is registered as expected-red and reported **XPASS**. But the expectation
describes a ~3.3% fallback rate measured at 120 seeds, while the gate's default
is 40 — so the pass is plausibly sampling, not a fix. Removing the entry is
right; treating the defect as demonstrated resolved is not. The register names
the successor: *"a probe that measures redraw elasticity without a
fallback-prone arm — perturb the BAND rather than the pin, or read the
elasticity off the in-band share, which is continuous and never falls back."*
Both shortcuts (lowering `PERTURB`, raising `MAX_HISTORY_ATTEMPTS`) are
explicitly refused in the register itself.

### 3.5 The 21 lint problems

14 errors, 7 warnings. 6 auto-fixable with `--fix`. Most of the rest are
`prefer-const` in diagnostic scripts and `react-refresh/only-export-components`
warnings on `CalculationAuditPage`. Low value individually, but a lint run that
is never clean is a lint run nobody reads.

---

## 4. Coverage

### 4.1 The 27 unreachable `src` files

No gate reaches 11 pages, 9 components, `App.tsx`, `main.tsx`, `RippleLogo.tsx`,
`welcomeGuide.ts`, `renderMarkdown.ts` and — the one that matters —
**`financialStatementEngine.ts`**, which is an engine, not UI.

The pages are UI and the project made a deliberate choice not to test them; the
financial statement engine is a different case and is the obvious first target.
The Calculation Audit page mirrors both statements line-for-line and *is*
reachable, which softens this but does not close it.

**The alternative recorded rather than built:** a jsdom or happy-dom harness
would let the UI be tested at all. It was considered during the save-flush
wiring work and deliberately not adopted — the note exists *"so the next person
does not rediscover the choice."*

### 4.2 The five `readFileSync` gates

Five gates read files from disk rather than importing them — two read the
baselines (`value-identity-check`, `solo-export-guard`), two read application
source as text (`save-flush-wiring-check`, `surface-privacy-check`), one reads
the roster CSV (`roster-catalog-check`). What they exercise is invisible to the
import-graph reachability analysis the tiering depends on, so the reachability
measure quietly understates coverage. Worth making visible.

---

## 5. Product direction

### 5.1 Phase 3 — aggregate accident-year development

Referenced from several places as the next modelling phase.
`PROJECT_STATE_SUMMARY.md:239` defines the scope precisely: *"Phase 3 =
aggregate accident-year development (management-consequence model), NOT
claim-level estimation."* Several fields (`paymentPattern`, parts of the shock
vocabulary) are waiting on it.

### 5.2 Phase 4 — the shock event system

See §2.3. The catalogue is data and already exists (`shockCatalog.ts`, 23 KB);
the machinery is `shockResolver.ts`; the gap is the effect implementations.

### 5.3 The investment liquidity requirement

`investmentMemo.md:12` — the memorandum describes a liquidity requirement and
marks it *"planned rather than deleted"*; `howToPlay.md:128` confirms *"no
liquidity constraint or early-sale cost is currently applied to your
allocation."* The player-facing documents are honest about it, which is good,
but it means an investment decision currently has one fewer consequence than the
fiction says.

### 5.4 Multiplayer

`docs/PHASES.md:901` — *"Appendix — Future Multiplayer (not active work,
captured for later)"*. The design is recorded and is worth reading before anyone
proposes something different:

- **Host-configured**: the host picks the shared seed, game length and starting
  year; every player's environment derives deterministically from it — which
  `generateGameInstance` already supports today.
- **Player-configured**: each player picks their own pool name and lines.
- **Comparison, not competition**: pools run in parallel and are ranked side by
  side. *Not* a shared single pool, *not* head-to-head market competition.
- **Shock events differ by mode**: single-player rolls randomly; multiplayer has
  the host pre-select which events fire in which years, applied identically
  across players. The design note draws the consequence for today's code:
  *"the event trigger mechanism (random roll vs. host schedule) should stay
  cleanly separable from event application logic — don't let the shock event
  engine assume randomness is the only way an event gets selected."*

**The appendix is explicit about cost:** *"Requires real infrastructure this
codebase doesn't have yet: a backend, shared/synced game state, and likely a
database instead of localStorage. Not a small addition — flag as its own
project when the time comes, not a 'Phase 8.'"*

Worth noting alongside `source-provenance.md` §5: the unused
`@supabase/supabase-js` in `package.json` would be one plausible answer to that
backend question. It is *not* evidence that any such work was started — nothing
in the repository uses it — but a team reaching for multiplayer may find the
choice already half-suggested.

---

## 6. Engineering hygiene

Small items, listed so they are not lost.

| Item | Note |
|---|---|
| **Bundle size** | 911 kB JS (287 kB gzipped), over Vite's 500 kB warning. No code splitting. Works; not optimised. |
| **The `/vite.svg` favicon 404** | `index.html` links a file that does not exist; there is no `public/` directory. |
| **`npm audit`** | 7 of 9 clear with a plain `npm audit fix`. `esbuild` needs a Vite 5→8 major. `xlsx` has no fix on npm — decide between the vendor CDN build, a maintained alternative, or a documented acceptance (the app only *writes* workbooks and has no parsing path). |
| **`eslint-plugin-react-hooks`** | declared at `^5.1.0-rc.0` — a release candidate as the floor of the range. Tidy to `^5.2.0`. |
| **Pin the Node version** | No `engines`, no `.nvmrc`. Node 22 is what works. |
| **CI** | There is none. Even a workflow that runs `typecheck`, `lint` and the FAST tier on push would be a large improvement over a harness that runs only when someone remembers. |
| **Gate timings are recorded, not live** | `scripts/gate-timings.json` is committed but an ordinary sweep does not rewrite it, so the tier-threshold check is only as current as its last recording. Either re-record on a schedule or measure in place. |
| **`PROJECT_STATE_SUMMARY.md` is stale** | It names `multi-line-build` as the working branch and baseline v11; HEAD is `feature/pricing-estimate` at baseline v37. It is otherwise a genuinely useful catch-up document, which is why the staleness matters. |
| **Licence-scan the dependency tree** | 23 direct packages verified permissive; ~284 transitive ones not checked. |
| **`LossDistributionConfig`** | An acknowledged orphan placeholder, deliberately left rather than folded into an unrelated commit. Part of a *"wider orphan cluster"* the code mentions but does not enumerate — enumerating it is its own small job. |

---

## 7. What is explicitly **not** wanted

Recorded so nobody spends effort re-proposing it.

| | |
|---|---|
| **A stripped demo branch** | Considered and declined: *"I would rather not maintain a second branch that cannot be verified."* |
| **Save backwards compatibility** | Ruled out by design. No format detection, no dual-path loader, no migration. An old save failing to parse and being discarded **is** the intended behaviour. |
| **Rewriting git history** | A standing instruction throughout the project. The 44 MiB of baseline churn across 36 versions is real, known, and deliberately not rewritten. |
| **Lowering gate sample sizes to speed the sweep** | Explicitly ruled out when the sweep was re-tiered — the tiering *"must not claw it back by lowering samples."* |
| **A hand-maintained tier list** | Rejected: *"that goes stale, and the first time it does, something ships unverified."* The threshold is derived from measured runtime for this reason. |
