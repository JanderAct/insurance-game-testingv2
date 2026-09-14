# Overview

## 1. What it is

**Ripple** is a multi-year public entity risk pool management simulation — a
serious game. The player runs an insurance pool that covers public entities
(school districts, cities, counties, special districts) and makes the decisions
a pool's board and management actually make: how much to charge, how much risk
to transfer to reinsurers, whether to return surplus to members or assess them
for more, how selective to be about who joins, how to invest the assets, and
how much to spend on loss prevention.

Each year the simulation generates claims, develops reserves, returns
investment income, and reports back a full set of financial statements. The
player then decides again. This repeats for the number of years chosen at
setup.

**There is no score.** The stated challenge is *"balancing affordable coverage
for your members against the Pool's long-term solvency."* A short game rewards
decisions that pay off quickly; a long game gives slow-moving consequences —
reserve development, member attrition, a thin reinsurance program — time to
surface.

It runs entirely in a web browser. No installation, no account, no server, no
network connection. See `architecture.md`.

## 2. Why it exists

**The repository does not say.** There is no stated commissioning purpose,
audience, or occasion anywhere in the code or documents. What the record
supports:

- It models a **real public-entity pool's own loss behaviour** — the severity
  distributions, closure curves and development factors were fitted against a
  real book (see `source-provenance.md`, which flags this for review).
- It was built by an actuarially literate person: the code cites WCIRB, NCCI,
  Mahler (1996) and CAS *Basic Ratemaking*, distinguishes IBNR from IBNER,
  models per-occurrence reinsurance towers with aggregate stop-losses, and
  carries a full experience-modification mechanism.
- A branch is named `demo-2026-09` and is **frozen for a presentation**, and a
  `demo-snapshot-2026-09` tag exists. So it has been shown to someone.

The obvious reading — a training or demonstration tool for people who govern or
manage risk pools — is consistent with all of that, but it is a reading, not a
documented fact. The reasoning lives in the conversational record, which the
project owner supplies separately. See `history.md` §7.

## 3. The main user flows, step by step

### 3.1 Starting a game

1. The app opens on the **Game Setup** tab. Every other tab is disabled until a
   game starts.
2. A **Welcome to Ripple** modal offers an optional guide to how the game works
   (`src/data/welcomeGuide.ts`).
3. The player sets:
   - **Pool name** — a label
   - **Game length** — how many years to play
   - **Starting year** — a calendar-year label only; the engine works in
     `yearNumber`
   - **Active coverage lines** — any combination of **Workers' Compensation**,
     **General Liability** and **Property**, at least one
4. On start, the engine builds the opening position. This is not a blank slate:
   it simulates a **deep pre-game** so the pool opens with a mature book —
   seed cohorts, seven maturation years, and three declared pre-game years
   (`yearNumbers` −2, −1, 0) run through the real engine at default decisions.
   Year 0's ending state *is* the Year 1 opening position. See `data.md` §4.
5. A save is written to `localStorage`. Reopening the browser resumes the game.

### 3.2 The yearly cycle

The game's own reference document states it as four steps:

> 1. **Review the reports.** Standing financials, claims activity, reserve
>    development, investment results, and any notable events from the year just
>    closed.
> 2. **Make your decisions** for the coming year.
> 3. **Advance the year.** The simulation generates the year's outcomes — new
>    business written, claims incurred, reserves developed, investments
>    returned — and reports back.
> 4. **Repeat**, for as many years as you selected at setup.

### 3.3 The decisions

**Per coverage line:**

| Decision | Range | What it does |
|---|---|---|
| **Funding confidence level** | 0.30 – 0.95 | The pricing lever, and the only one. Rather than setting a rate change, the player sets the share of years in which contributions should prove sufficient. Each line has its own curve, so **Expected** sits at a different slider position per line. Funding above Expected builds margin; below it improves affordability and leaves the pool exposed. The funding slider is *also* the reserving posture: `ibnerBookingBias = 0.80 × max(0, 1 − selectedFundingCLF)`. |
| **Reinsurance layers** | per band | A per-occurrence **layer tower** above a retention the pool keeps on every claim — **$1M on WC and GL, $5M on Property**. WC offers three bands to $50M; GL three bands to $25M; Property a single band to $75M. Declining a band means keeping that slice of every large claim. **Above the top band, losses return to the pool** — an exposure no decision can remove, and it bites hardest on GL, where the excess market stops at $25M and GL severity does not. |
| **Aggregate stop-loss** | WC and Property only | Responds to total annual retained losses rather than any single claim. **Conditional on having bought bands beneath it** — with no per-claim layer capping each loss, one claim could consume the whole aggregate. GL has none offered. |
| **Underwriting strictness** | 0 – 10, default 5 | Trades volume against quality on both sides at once. Fewer applicants join when strict (asymmetric: loosening buys more volume than tightening costs); above 6 the pool screens the field and considers only the better 60%; strictness also nudges average risk quality directly by `(strictness − 5) × 0.04`. |
| **Loan repayment aggressiveness** | 0.00 – 1.00 | Share of the line's positive net income diverted to debt service — see §3.4. |

**Pool-wide:**

| Decision | Range | What it does |
|---|---|---|
| **Dividend** | 0 – 15% of premium | Returns surplus to members, at the cost of the cushion. |
| **Assessment** | 0 – 25% of premium | Collects extra from members. Raises funds; rarely welcome. |
| **Risk control spend** | 0 – 8% of premium | Safety programs, training, loss prevention. Reduces the losses members actually suffer, but **the benefit builds over time**, and the money is spent whether or not it works. |
| **Investment allocation** | cash / bonds / equities | One policy across every line. |

### 3.4 The inter-line loan

If a line ends a year with negative surplus, the other lines may offer to cover
the shortfall. This is a **real transfer of invested assets**, not an accounting
entry, and the offer exists only if the other lines can fund the whole deficit
without going negative themselves. If they cannot, no offer is made and the line
carries its deficit; an assessment is the other way out.

The balance accrues interest at the pool's own blended investment return,
floored at zero — lending lines are made whole for the return they gave up and
never less than whole. Repaying fast clears the interest but starves the
borrowing line's surplus; repaying slowly leaves the debt compounding.

The offer arrives as a modal (`LoanPromptModal`) rather than a silent transfer.

### 3.5 Reading the results

Twelve tabs, in the order the app presents them:

| Tab | What it shows |
|---|---|
| **Game Setup** | Start a new game. The only tab enabled before one starts. |
| **Introduction** | The Welcome Memorandum and How to Play, rendered from markdown. |
| **Departments** | Actuarial, Claims, Underwriting and Investment — the pool's functions, including the Investment Memorandum and the claims exhibits. |
| **Pool History** | The seeded operating history shown before Year 1 begins. |
| **Dashboard** | Headline position for the selected line or the pool. |
| **Decisions** | Where the year's decisions are set. |
| **Decision History** | What was decided in each prior year. |
| **Financial Statements** | Income statement, balance sheet, net position. |
| **Results** | The year's outcome narrative and charts. |
| **Result Spreadsheet** | The full metric table, with `.xlsx` and `.csv` export. |
| **Calculation Audit** | The workings — how each figure was derived. The largest page in the app (2,900+ lines). |
| **Membership** | Who is in the pool, who joined, who left. |

Most pages additionally carry a **line view** selector (Pool / WC / GL /
Property), so figures can be read pooled or per line.

### 3.6 Exports

Three, all generated in-browser and downloaded locally (nothing is transmitted):
a multi-tab results workbook (`.xlsx`), a claims workbook (`.xlsx`), and a
member table (`.csv`). See `data.md` §5.

## 4. What was optimised for

The repository makes its priorities unusually legible. In rough order:

**1. Actuarial correctness over everything else.** The loss model is fitted, not
invented. Distinctions that a game could reasonably blur — IBNR versus IBNER,
paid versus incurred, gross versus net, occurrence versus claim, members versus
enrolments — are all maintained, and the code repeatedly refuses simplifications
that would break them. `defaultAssumptions.ts:4358` is characteristic: *"GL IS
MEASURED. WC AND PROPERTY ARE JUDGEMENT. Do not read the three as equally
grounded."* The model states where it is weaker rather than presenting one
confidence level throughout.

**2. Verifiability.** 89 diagnostic gates, two pinned baselines (a value-identity
snapshot of 30,480 fields and a set of export captures), and a rule that a gate
must carry a positive control proving it can fail. Because the code was
machine-written, it is machine-checked. See `architecture.md` §4.

**3. Honesty in the record over a tidy history.** Retractions are committed
(*"Commit 1a attempted and reverted: neither half lands"*). Mechanisms shipped
dark say so in their own commit subject (*"read by nothing"*, *"flagged off"*).
Known-red gates carry a measured justification and a named fix rather than being
disabled. Where the model simplifies, the simplification is labelled (*"⚠ KNOWN
SIMPLIFICATION, NOT AN OVERSIGHT"*).

**4. Reproducibility.** Everything derives from a seeded PRNG, so the same game
ID and the same decisions produce the same numbers. That is what makes the
verification harness possible at all.

**5. The design record written into the source.** Files carry long headers
recording what was tried, what was measured and what was rejected. This is the
compensating mechanism for code with no individual human author, and it is the
thing to read first.

**What was *not* optimised for**, stated plainly because a new team should know:

- **Deployment.** The application has never been deployed. No CI, no host, no
  build pipeline beyond `npm run build`.
- **Multiplayer or persistence beyond one browser.** One save, one key, one
  machine.
- **UI test coverage.** 27 of 86 `src` files — every page, every component —
  are reachable from no gate. The verification effort went to the engine.
- **Onboarding for a new developer.** The code is extensively documented *in
  place*; it has no README, no architecture diagram until this handoff, and no
  getting-started guide.

## 5. Known gaps

Summarised here; the full, unsoftened list is in `known-issues.md`.

- **Four gates are genuinely failing** — `closure-draw-check`,
  `opening-centring-check`, `triangle-check` and `property-tower-mc`. Three more
  are red by documented design. All 65 pass/fail gates were run for this handoff:
  57 ok, 4 FAIL, 3 expected-red, 1 XPASS.
- **The expected-red register is itself stale.** `pin-vs-band-check` is recorded
  as expected-red and reported XPASS; the register's own comment says *"Anyone
  reading this in a month should be asking why it is still here."*
- **Mechanisms are built and dark.** `LATE_REPORTING` is flagged off. The
  pricing triangle ships and, per `triangle-check`, nothing reads it.
  `Claim.paymentPattern` is written and read by nothing.
- **Only four of nine shock effect kinds actually run.** The five that do not
  include the Property catastrophe path, and the type's own comment miscounts
  the union as eight. Meanwhile the Results page prints *"Shock Events: not yet
  implemented"* **to the player**.
- **`main` has never moved.** It still points at the founding commit of
  2026-07-15; 364 commits of work live only on feature branches.
- **`@supabase/supabase-js` is declared and entirely unused**, implying a
  backend that does not exist.
- **The verification harness depends on `tsx`, which is not a declared
  dependency** and is fetched by `npx` at run time.
- **21 lint problems** stand (14 errors, 7 warnings).
- **The member roster is synthetic and nothing in the repository says so** — in
  a project that openly states its loss parameters come from a real pool. See
  `source-provenance.md` §3.
- **Real book data appears in code comments** beyond the project's own stated
  rule — claim counts, policy years, a dated catastrophe with a loss total. See
  `source-provenance.md` §2.5. **This is the item to read first.**

## 6. Where to start reading

| If you want | Read |
|---|---|
| How it is put together | `architecture.md` |
| What the numbers are and where they came from | `data.md` |
| What you must review before using this | **`source-provenance.md`** |
| What is broken or unfinished | `known-issues.md` |
| How to run it | `setup.md` |
| How it got here | `history.md` |
| What was next | `wishlist.md` |
