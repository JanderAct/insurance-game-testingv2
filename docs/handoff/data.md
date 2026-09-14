# Data

Ripple is a browser-only single-page application. It has **no backend, no
database, no API and makes no network calls at runtime**. Every number it uses
either ships inside the JavaScript bundle as a TypeScript constant or is
generated at play time by a seeded pseudo-random number generator. The only
persistence is one `localStorage` key in the player's own browser.

That single fact determines most of what follows, so it is worth stating what
it rules out before describing what is there:

| Thing a reader may expect | Present? |
|---|---|
| Database (any kind) | **N/A** — none. No ORM, no migrations, no schema file, no connection string. |
| REST/GraphQL API consumed at runtime | **N/A** — none. Verified: no `fetch`, `XMLHttpRequest`, `axios` or `WebSocket` call anywhere in `src/`. |
| API that this app exposes | **N/A** — none. It is a static bundle. |
| Server-side session or user accounts | **N/A** — none. No login, no user record, no identity of any kind. |
| File uploads / user-supplied data import | **N/A** — none. Data flows out (exports) but never in. |
| Manual data entry that persists | Only the player's own in-game decisions, held in the same save (see §3). |
| Scheduled jobs / ETL / pipelines | **N/A** — none. |
| Analytics, telemetry, error reporting | **N/A** — none. Nothing is transmitted off the machine. |
| Environment variables holding data config | **N/A** — none. No `.env` file exists and `src/` contains no `process.env` or `import.meta.env` reference. |

---

## 1. Where the data comes from

There are exactly four sources.

### 1.1 Hardcoded constants in `src/data/` (the bulk of it)

| File | Size | What it holds |
|---|---:|---|
| `defaultAssumptions.ts` | 283 KB | 90 exported constants. Loss distributions (per-rating-group lognormal mixtures for WC, a three-component mixture for GL), development/IBNER parameters, closure curves, payout patterns, expense and investment assumptions, rating-group definitions. This is the single largest file in the repo and is the model's parameter record. |
| `clfTables.ts` | 31 KB | Confidence-level factor tables — the percentile curve mapping a funding level to an outcome distribution. |
| `memberCatalog.ts` | 31 KB | The 200-member marketplace, generated from CSV (see §1.2). |
| `reinsuranceTower.ts` | 25 KB | Per-occurrence reinsurance tower structure, measured expected-loss constants, aggregate stop-loss parameters. |
| `shockCatalog.ts` | 23 KB | The shock/event table. Events are data rows, not code — adding an event is adding a row here. See `known-issues.md` for which effect kinds are not implemented. |
| `glClfGrid.ts` | 17 KB | GL confidence-level grid. |
| `wcClfGrid.ts` | 13 KB | WC confidence-level grid, including `FUNDING_CLF_TABLE`. |
| `exposureTrend.ts` | 7.8 KB | Wage-inflation trend on the exposure base. Carries explicit citations (see §6). |
| `welcomeGuide.ts` | 6.2 KB | Player-facing copy for the welcome modal, kept as structured data so copy edits do not touch component code. Header names its source as `01A_WELCOME_TO_RIPPLE.md` — **that file is not in the repo**; see `source-provenance.md`. |

**⚠ Several of these constants were fitted against a real insurance pool's own
claim experience.** They are numbers, not raw records, but their origin is real
book data. This is flagged in full in `source-provenance.md` and is the single
most important thing in this handoff for a reviewer to look at. It is named
here so a reader of `data.md` alone does not miss it.

### 1.2 `roster_canonical_v*.csv` — the member roster

Six CSV files sit in `src/data/`: `roster_canonical.csv` and `_v2` through
`_v6`. They are **build-time inputs, not runtime data** — nothing in `src/`
imports a `.csv`. `scripts/tools/generate-member-catalog.ts` reads one of them
and emits `src/data/memberCatalog.ts`, which is committed. The app imports only
the generated `.ts`.

- **Current source: `roster_canonical_v6.csv`** (`generate-member-catalog.ts:102`).
- **⚠ `memberCatalog.ts:2` says the source of truth is `roster_canonical_v5.csv`.
  That header is stale.** The generator reads v6. This is a documentation
  defect, recorded here and in `known-issues.md`; per the brief it has not been
  corrected.
- The five superseded CSVs are still committed. Nothing reads them.

Format: 201 lines (header + 200 members), 17 columns:

```
ID,Name,Type,Payroll ($M),Risk Quality,Region,TIV ($M),Locations,
Primary Asset Share,WC_clerical,WC_pubworks,WC_police,WC_fire,
GL_gen,GL_epl,GL_lawenf,GL_abuse
```

Example row:

```
member-001,Brookhaven School District 001,School District,5.462,3.9,North,
206.717,8,0.222,...
```

**⚠ THE 200 MEMBERS ARE SYNTHETIC. They are not real entities and the names are
not real organisations.** The structure makes this evident on inspection —
generic place name + entity type + sequential ID, matching a sequential
`member-NNN` identifier — but **no file in the repository states it**, and a
reader arriving at a roster of school districts, cities and counties with
payroll and TIV figures will reasonably assume the opposite. That gap is closed
explicitly here and in `source-provenance.md`.

The *scale* of the roster is likewise a design choice and says so in the code:
payroll totals $1,300M (County 30% / City 20% by design), TIV totals
$59,233.0M — a blended 45.6× payroll, which `memberCatalog.ts` records as
"A DESIGN CHOICE, NOT A CALIBRATION, and at ten times the real pool's 4.6x it
must not be read as one". v6 scaled TIV ×3.484302 from v5's $17,000.0M; v5
scaled ×1.188512 from v4's $14,303.6M.

**⚠ But the loss behaviour attached to those synthetic members is not
synthetic.** `memberCatalog.ts` states: "FREQUENCY AND SEVERITY COME FROM REAL
DATA; THE TIV BASE IS CHOSEN". The roster is a synthetic container for real
calibration. See `source-provenance.md`.

### 1.3 Markdown documents rendered in-app

Three files in `src/data/documents/`, imported with Vite's `?raw` suffix and
rendered through `marked`:

| File | Size | Rendered by |
|---|---:|---|
| `howToPlay.md` | 12 KB | `IntroductionPage` |
| `investmentMemo.md` | 8.4 KB | `DepartmentsPage` |
| `welcomeMemo.md` | 7.1 KB | `IntroductionPage` |

These are authored player-facing prose, not data the engine reads.

### 1.4 Generated at run time from a seed

Everything else — claims, occurrences, development movements, closure, shock
draws — is produced during play by a seeded PRNG. Given the same game instance
ID and the same decisions, the same numbers come out. This is what makes the
verification harness possible (see `architecture.md` §4) and it means the
interesting data in a played game exists *only* in that game, not in the repo.

---

## 2. What is in memory versus what is stored

This distinction is load-bearing and has already caused one production defect
(see `history.md` and §3.2).

**In memory for the session only** — recomputed on demand, deliberately never
written to storage:

- `LineResultSet.claims` — the per-claim register, ~800 claims per year per line.
- `occurrences` — the event register.
- `marketMemberLossResults`
- `pricingTriangle` — derived, rebuilt by `processYear` each cycle.
- `memberPremiumShares` — the per-member premium bill rows.
- `primaryLoss` on result rows — a pure duplicate of the copy in
  `memberLossHistory`, which *is* saved.

These six key names are `SAVE_STRIPPED_KEYS` (`src/utils/gameSave.ts:234`). The
stripper matches **by key name at any depth**, which is why the durable ledger
copy and the disposable result-row copy have deliberately different names.

**Consequence a new developer must know:** a page that renders any of these
directly shows *nothing* on a reloaded game, because the reload restores state
without them. `src/utils/claimRegeneration.ts` exists to rebuild the claim
register from stored cohort state for the pages that need it.
`memberPremiumShares` is only *partially* recoverable — the experience modifier
depends on `memberLossHistory` as it stood before the year in question, and the
save keeps only that ledger's current state and only `LOSS_HISTORY_CAP_YEARS`
of it, so reconstruction is exact near the present and degrades with age. The
code is explicit that this is a reason not to promise an exact rebuild of an
old year's bills, not a reason to store the rows.

---

## 3. Local storage — the only persistence

### 3.1 The key

| | |
|---|---|
| Storage | `window.localStorage`, browser-local, per-origin |
| Key | `riskpool_gamestate_v10` — the **only** key the app writes |
| Format | DEFLATE (level 6) → base64 ASCII |
| Written by | `src/utils/gameSave.ts` (`writeSave`), called from `src/App.tsx:263` |
| Read by | `src/App.tsx:126` |
| Cleared by | `src/App.tsx:236`, `:241` (unparseable save), `:404` (new game) |

Envelope shape (`SaveEnvelope`): `{ gameState, startingFinancials, initialMembers, currentDecisions }`.

Pipeline: strip `SAVE_STRIPPED_KEYS` → `JSON.stringify` → `deflateSync(level 6)`
→ base64 via `btoa`. Reading is the exact inverse and **throws on anything that
is not a payload this codec produced**. There is no format detection, no
dual-path loader and no migration — this is a ruled design decision, not an
omission. An old uncompressed save fails to parse, is discarded, and the player
gets a clean path to a new game.

### 3.2 Size budget

| Figure | Value | What it is |
|---|---:|---|
| `MEASURED_QUOTA_CHARS` | 5,242,613 | Measured against a real Chromium at a real `http://` origin by binary search. Not a spec figure — the WHATWG spec sets no quota. |
| `SAVE_BUDGET_CHARS` | 1,500,000 | The CI gate threshold on the *compressed* payload. 1.37× the reachable worst case, 29% of quota. |
| Reachable worst case | 1,097,556 | 10 years × 3 lines at default decisions. |

**⚠ Byte accounting matters and differs by a factor of two.** Chromium charges
one byte per character when the whole value is ASCII and two bytes per
character the moment it is not. base64's alphabet is ASCII, so for this codec
**stored bytes equal string length by construction** — which is why the size
gate cannot be wrong about storage. A denser but non-ASCII codec would have
looked like a 10.5× win on string length and delivered 5.3× on bytes. The
measured codec bake-off table is preserved in the `gameSave.ts` header; see
`dependencies-and-integrations.md` for the `lz-string` note.

**Historical defect worth carrying forward:** the game silently stopped saving
at year 4. `persistState` was a closure inside `App.tsx` doing a bare
`JSON.stringify` in a bare `catch {}`; from year 4 every write threw
`QuotaExceededError`, the catch swallowed it, and a reload returned the year-3
state — reading as the game having rewound rather than as a storage failure.
65–70% of that payload was the per-claim detail whose own comment claimed it
was "deliberately NOT persisted". Both halves of that claim were false.

### 3.3 Write frequency

`SAVE_DEBOUNCE_MS = 400`. Writes are debounced through
`createSaveScheduler(write, clock, delayMs)` with an injected clock, and
flushed on `visibilitychange` (hidden) and `pagehide` so no completed decision
can be lost. Before the debounce, a single slider drag produced up to ~80
writes; after it, one.

### 3.4 Other browser storage

**N/A.** No `sessionStorage`, no IndexedDB, no cookies, no Cache API, no
service worker.

---

## 4. Schema

There is no database schema. The equivalent artefact is
`src/types/simulation.ts` (1,587 lines) plus `src/types/shocks.ts` (255 lines).
The principal shapes:

```
GameState
├── setup: GameSetupSettings
├── instance: GameInstance          ← game id, seed identity
├── currentYearNumber, isStarted, isComplete
├── currentDecisions: DecisionSet
├── lockedResults: ResultSet[]      ← one per played year
├── priorHistory: ResultSet[]       ← the 3 declared pre-game years (-2, -1, 0)
└── poolState: PoolState
    ├── cash, unearnedPremium
    ├── allMarketMembers: Member[]  ← the full 200-member marketplace
    ├── interLineLoans: InterLineLoan[]
    ├── membershipHistory: MembershipHistory
    │     Record<memberId, Partial<Record<CoverageLine, EnrollmentInterval[]>>>
    │     ← AUTHORITATIVE per-line enrolment record
    ├── memberLossHistory?: MemberLossHistory
    │     Record<memberId, Partial<Record<CoverageLine, MemberLossYear[]>>>
    │     ← rolling actual/expected record the experience modifier reads
    └── lines: Record<'WC'|'GL'|'Property', LinePoolState>
        ├── rateLevel, ratePer100, purePremiumPer100
        ├── memberSatisfaction, averageRiskQuality, riskControlEffectiveness
        ├── members: Member[]
        ├── surplus, investedAssets, netUnpaidReserve, totalMarketExposure
        ├── reserveCohorts: ReserveCohort[]
        ├── reserveDevelopment?: ReserveDevelopmentRow[]   ← append-only, never pruned
        └── pricingTriangle?: PricingTriangleState         ← DERIVED, stripped from save
```

Key record types:

| Type | Purpose | Notes for a new developer |
|---|---|---|
| `Member` | A marketplace entity | `id`, `name`, `type`, `sizeCategory`, `region`, `locations`, `primaryAssetShare`, `exposureByLine`, `riskQuality` (1–10), `satisfaction` (1–10), `status`, `wcRatingGroup?`. **`yearJoined` is a lossy display convenience, not an enrolment record** — opening members are stamped `1` even though the ledger has them at `-2`, so a Y1 recruit and an opening member are indistinguishable by it. Use `membershipHistory` for any enrolment question. |
| `Occurrence` | An event | `memberIds` is authoritative and always length ≥ 1; `memberId` is a single-member convenience and is **deliberately optional** so `strict: true` forces every consumer to handle the multi-member case. `peril?` / `intensity?` present only on Property's weather and cat bands. |
| `Claim` | One claim within an occurrence | `accidentYear` and `reportedYear` are `yearNumber`s and are **negative for pre-game years**. `grossUltimate`, `paidToDate`, `caseReserve`. `tier` is a mixture-component or peril label, deliberately a plain `string`. `paymentPattern?` is populated by GL and Property only — WC stopped populating it at the severity rebuild — and **nothing consumes it**. `description?` is always absent; nothing writes one. |
| `ReserveCohort` | One accident year's reserve, per line | `netUltimate` / `netPaid` / `netUnpaid` are the live engine path. `grossPaid?` / `grossUnpaid?` are a **parallel ledger that never feeds the net engine** — deliberate, so the value-identity null test stays available. `registerSum` is frozen at inception; `netUltimate - registerSum` *is* the IBNER provision. `horizon` / `age` control when development stops. `seeded?` marks apportioned opening cohorts. |
| `DevelopingClaim` | Per-occurrence development state | `drawn` (as generated, never moves) → `original` (as booked, after markdown) → `current`. `movementByStep?` is the per-valuation movement series; it is **bounded by cohort horizon, not by game length** — at most 12 entries on WC, 8 on GL, 4 on Property — measured at 12.7–13.5 KB of a 389 KB serialised `poolState`. |
| `BenchClaim` | A replacement occurrence held in reserve | Not tracked, cedes nothing while benched; its dollars sit inside `untrackedTotal`. |
| `ResultSet` | One year's output row | Carries `line?` — absent on the pooled row. **Members and enrolments are different numbers at pool scope**: a member carrying WC and GL is one member and two enrolments. |

**Year numbering conventions** (these trip people up):

| Range | Meaning |
|---|---|
| `-13 … -11` | Seed cohorts. No `developingClaims`. |
| `-9 … -3` | Maturation years. **No `ResultSet`, never in `priorHistory`.** `MATURATION_YEARS = 7`. |
| `-2 … 0` | Declared pre-game years, run through the real engine at default decisions. `PRE_GAME_YEARS = 3`, `PRIOR_BOUNDARY = -2`. Year 0's ending state *is* the Year 1 opening position. |
| `1 …` | Played years. |

---

## 5. Data that leaves the application

Exports are generated in-browser and handed to the user's own download; nothing
is transmitted anywhere.

| Export | Produced by | Format |
|---|---|---|
| Results workbook | `src/utils/resultsExport.ts` → `ResultSpreadsheetPage` | Multi-tab `.xlsx` via `xlsx`. Filename `SEED_{instanceId}_{line}_YR{n}.xlsx` |
| Claims workbook | `src/utils/claimsExport.ts` → `ResultSpreadsheetPage` | `.xlsx`. Filename `SEED_{instanceId}_{line}_CLAIMS_YR{n}.xlsx` |
| Member table | `ResultSpreadsheetPage:133` (`downloadCsv`) | `.csv`, `source-game-members-year-{n}.csv` |

---

## 6. Externally obtained data

Three published actuarial sources are cited inside the code. Each is reported
here as *what was taken*, and in full — including availability and usage-rights
questions — in `source-provenance.md`.

| Source | Where cited | What was taken |
|---|---|---|
| **WCIRB** (Workers' Compensation Insurance Rating Bureau of California) | `src/data/exposureTrend.ts:19-27`, `src/utils/wcClaimEngine.ts:181` | A blended severity trend figure of 3.67%, decomposed as medical 52% @ 3.70%/yr and indemnity 48% @ 3.63%/yr over 2017–2023, against wage inflation of 3.63% — a +0.04% difference. A published **figure**, used as a parameter. |
| **NCCI** (National Council on Compensation Insurance) | `src/data/exposureTrend.ts:19-27`, `src/utils/memberLossHistory.ts:216` | An *a priori* assumption, and a statement of incentive direction. A published **assumption/qualitative direction**, not a table. |
| **Mahler (1996), CAS Ratemaking Seminar** | `src/utils/memberExperienceMod.ts:18, 110, 118, 163`; `src/types/simulation.ts:141` | The experience-modification **method**, its "rule 3" (cap year-on-year changes), and a credibility figure used as a comparison point (0.155 on the primary layer at a $25k split). Hosted on casact.org. |

`src/data/exposureTrend.ts:41,44` additionally cites the CAS textbook *Basic
Ratemaking* for two methodological points: that trend should be exponential
rather than linear, and that keeping medical and indemnity trends separate
would be more correct than the blended figure used — recorded there as a known
simplification.

**⚠ No external dataset is bundled.** No downloaded table, no third-party CSV,
no licensed data file. What is present are figures and methods read from
published sources and written into constants and comments. Whether that
constitutes a usage-rights question is a judgement for a reviewer, not one this
document makes — it is raised in `source-provenance.md`.

---

## 7. Sensitive data

### 7.1 Secrets, credentials, keys

**None in the repository.** Verified:

- No `.env`, `.env.local` or equivalent file exists.
- No `process.env` or `import.meta.env` reference in `src/`.
- No API keys, tokens, passwords, connection strings or certificates found.
- No authentication of any kind exists in the application, so none is required
  to run it. See `setup.md`.

`@supabase/supabase-js` is declared in `package.json` and is **entirely
unused** — no import, no client construction, no configuration anywhere in the
repo. Were it wired up it would require a project URL and anon key; it is not,
and no such values exist here. See `dependencies-and-integrations.md`.

### 7.2 Personal data

**No natural-person PII.** `Member.name` (`src/types/simulation.ts:31`) holds
synthetic organisation names ("Brookhaven School District 001"), not people.
There are no player accounts, no email addresses, no names, no IP logging, no
analytics identifiers. The application collects nothing about its user and
transmits nothing anywhere.

The one piece of personal data touching the project is the maintainer's own
email in git commit metadata, which is ordinary git authorship.

### 7.3 Commercially sensitive data — **this is the one that matters**

**⚠ The repository contains parameters fitted against a real insurance pool's
own claim experience.** The project's standing rule has been that no source
data goes in — no claim counts, no dollar totals, no policy years, no valuation
dates, no tables — and that *the parameters are the record*. On inspection that
rule appears to have been held: what is present are fitted constants and
comments describing what they were fitted against, not extracts.

The sites that say so in their own words include:

- `src/data/wcClfGrid.ts:8` — `FUNDING_CLF_TABLE` is "the REAL pool's measured percentile curve, at $20-30 [billion of payroll]"
- `src/data/clfTables.ts:12` — "GL SUPPLIED — a real pool's measured curve at a scale this model does not [reach]"
- `src/data/glClfGrid.ts:10` — "the real pool's parameter/trend uncertainty at $20-30B of payroll"
- `src/data/defaultAssumptions.ts:46` — "PER-RATING-GROUP LOGNORMAL MIXTURES, fitted to the pool's own claim [experience]"
- `src/data/defaultAssumptions.ts:482` — the "mixture includes ALAE and comes from a real pool's real claim [data]"
- `src/data/defaultAssumptions.ts:527` — "FITTED TO THE POOL'S OWN INDIVIDUAL CLAIMS"
- `src/data/defaultAssumptions.ts:1899` — "Fitted against the pool's own closure experience, each line separately"
- `src/utils/claimClosure.ts:21` — "FITTED AGAINST REAL POOL EXPERIENCE, EACH LINE SEPARATELY"
- `src/utils/propertyClaimEngine.ts:1` — "FITTED to the pool's own nine years of claims"
- `src/data/memberCatalog.ts` — "FREQUENCY AND SEVERITY COME FROM REAL DATA; THE TIV BASE IS CHOSEN"

Named GL development factors `1.872 / 1.439 / 1.265 / 1.031 / 1.024` appear at
`defaultAssumptions.ts:423, 1513, 2103, 2213, 3240, 3972, 4362`.

**This is flagged for review, not remediated.** Whether fitted parameters
derived from a real book are themselves disclosable — and under what permission
— is a question for the pool's owners and for whoever holds that data, not a
question this document answers. It is set out in full, with every site, in
**`source-provenance.md` → Items Recommended for Review**.

### 7.4 Regulated data

**N/A.** No health records, no financial account data, no payment card data,
no government identifiers. The claim severities are simulated dollar amounts
attached to synthetic entities.

---

## 8. Data the app would need if it grew a backend

Recorded because it is the first question a team inheriting this will ask. Today
everything below is either in the bundle or in one `localStorage` key, and none
of it is shared, multi-user or durable beyond one browser profile:

- **Game state** — would need a per-game row; currently one `localStorage` key,
  overwritten, single game at a time.
- **The member catalogue** — would become a table; currently a generated,
  seed-independent, committed constant shared by every game. It is deliberately
  *stateless*: per-game simulation state hangs off `PoolState`, not off
  `Member`, so two concurrent games cannot mutate each other's members. That
  design decision survives a move to a database and is worth preserving.
- **Assumptions/parameters** — would become configuration; currently constants.
  Changing one today is a code change and a rebuild, which is intentional: the
  verification harness pins behaviour against two committed baselines, and a
  parameter that could move at runtime would make those baselines meaningless.
- **Multiplayer** — `docs/PHASES.md` carries an "Appendix — Future Multiplayer"
  section. Nothing is built. See `wishlist.md`.

---

## 9. Data-related gaps a new developer will hit

Listed here in data terms; the full list is in `known-issues.md`.

1. **`memberCatalog.ts:2` names the wrong source CSV** (v5; the generator reads v6).
2. **Five superseded roster CSVs are still committed** and nothing reads them.
3. **Nothing in the repo states the roster is synthetic.** Closed in this document.
4. **`Claim.paymentPattern` is written by GL and Property and read by nothing.**
5. **`Claim.description` is never populated.** The field, the export column and
   the memo's conditional rendering all exist ahead of any writer.
6. **Maturation years (−9 … −3) produce no `ResultSet`**, so any exhibit that
   walks `priorHistory` sees a gap there by design, not by defect.
7. **Reloaded games lose the claim and occurrence registers** until
   `claimRegeneration` rebuilds them, and `memberPremiumShares` is only
   approximately recoverable for older years.
8. **`baselines/` is clean at HEAD** — the superseded `VALUE_IDENTITY_v34.json`
   was retired at `c3af16f` and only the live v37 pair plus the three v11
   workbooks remain (2.2 MB total). Noted because earlier working notes describe
   v34 as still present; it is not.
