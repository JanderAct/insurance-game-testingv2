# Source and Provenance

**Purpose of this document.** It records where the material in this repository
came from — code, data, parameters, text and design — and identifies anything
whose origin, licence, usage rights or accessibility is unclear enough that
someone should look at it before this project is distributed, published or
handed to a commercial team.

**What this document does not do.** Nothing here has been removed, replaced,
rewritten or otherwise remediated. Several items below plainly *should* be
acted on. They have been identified and left in place deliberately, so that the
decisions are made by people with the authority to make them rather than
absorbed silently into a cleanup commit. Where something is a judgement call,
it is stated as a question, not resolved.

The flag **`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** marks items where
I could not establish, from the repository alone, that the material is clear to
use. It is not an accusation that anything is wrong. It means the repository
does not contain the evidence needed to conclude that it is right.

Every item flagged below is repeated, in one place, in **Items Recommended for
Review** at the end.

---

## 1. Authorship of the code

### 1.1 Essentially all of this code was written by Claude Code

This needs saying plainly rather than being left implied, because it is the
single most consequential fact about the codebase's provenance and it is not
obvious from reading the source.

**Essentially all of the code in this repository was written by Claude Code (an
AI coding tool) working under human direction.** The human — the repository
owner — set the direction, made the rulings, specified each piece of work,
challenged findings and accepted or rejected results. The typing was done by
the model.

The commit record supports this directly:

| Measure | Value |
|---|---|
| Total commits at `62e0481` | **365** |
| Authored `Claude <noreply@anthropic.com>` | **363** |
| Authored `JanderAct <janderson@prismrisk.gov>` | **2** |
| Commits carrying a `Co-Authored-By` trailer | **204** |

The two human-authored commits are both `"Add files via upload"` — GitHub
web-interface uploads, not hand-written code (see §1.2 and §1.3).

**What this means for a team inheriting the project**, stated neutrally:

- The code has no individual human author to consult about intent. The
  compensating mechanism is that the code is *unusually* heavily commented —
  many files carry long headers recording not just what the code does but what
  was tried, what was measured, what was rejected and why. Those comments are
  the design record and should be treated as primary documentation.
- The verification harness (89 gates, two pinned baselines) exists because the
  code was machine-written and needed to be machine-checked. It is not
  decorative. See `architecture.md` §4.
- Copyright in AI-generated code is unsettled in several jurisdictions, and
  the extent to which such output is protectable — or who owns it — is not a
  question this repository can answer. It is flagged below.

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** — *the ownership and
copyright status of AI-generated source code, and whether the organisation's
policy permits AI-generated code in a distributed product, should be confirmed
by whoever is responsible for that policy. This is a governance question, not a
defect.*

### 1.2 The founding commit is an upload of unknown origin

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`**

The first commit in the repository, `116b96d` (2026-07-15, authored
`JanderAct`, message `"Add files via upload"`), is not an empty scaffold. It
contains a complete, working application:

```
src/App.tsx                            309 lines
src/pages/        (9 pages)         ~3,540 lines
src/components/   (4 components)      ~279 lines
src/utils/        (9 engines)       ~1,927 lines
src/types/simulation.ts                390 lines
src/data/         (2 files)            305 lines
package.json, package-lock.json, eslint/postcss config, index.html
dist/app.js                         29,968 lines   (a committed build artifact)
dist/app.css, dist/app.js.map, dist/index.html
```

**The repository records nothing about where this came from.** There is no
README of origin, no attribution, no licence header, no import note. It arrived
through the GitHub web upload interface, which by construction discards whatever
history the files previously had.

Everything after it is incremental and traceable. The foundation is not. Several
things in it — `simulationEngine.ts`, `financialStatementEngine.ts`, the page
structure, the `riskpool_gamestate_v10` storage key that survives to this day —
are ancestors of code still shipping.

The most likely explanations are benign: an earlier prototype by the same
person, or output from a code-generation tool (the `dist/` bundle and the
`"risk-pool-simulation"` package name are consistent with a browser-based
scaffold). **But the repository does not say, and a documentation exercise
should not guess.** The person who performed that upload can resolve this in
one sentence; until they do, the provenance of the project's foundation is
unestablished.

The second human commit, `fbc4027` (2026-07-20), is the same kind of upload and
contains three documents — `CLAUDE_CODE_PLAYBOOK.md`, `DECISIONS.md`,
`PHASES.md` (1,311 lines). Same question, lower stakes: these are process and
spec documents, and they read as originally authored, but their origin is
likewise unrecorded.

### 1.3 The committed `dist/` build

The founding commit included a 29,968-line `dist/app.js` plus its source map.
These were later untracked (`e54410c`, "Untrack the stale pre-Vite dist/ build
artifacts"). Noted because they are still in git history, and a source map in
history can reveal the pre-upload source tree — which may be the fastest way
for the owner to answer §1.2, and is also worth knowing before the repository
is made public.

---

## 2. The pool's own book data — **the most important item in this document**

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`**

### 2.1 What is here

The simulation's loss model is not invented. **Substantial parts of it were
fitted against a real public-entity insurance pool's own claim experience** —
the repository owner's actual pools. The code says so repeatedly and in its own
words. It is not hidden, and no reasonable reader of the source could miss it.

The project has operated under a standing rule that *no source data goes into
the repository* — no claim counts, no dollar totals, no policy years, no
valuation dates, no tables — and that *the fitted parameters are the record*.

**That rule has been substantially, but not completely, held.** What follows is
the audit.

### 2.2 Fitted parameters derived from real experience

These are the parameters themselves. They are derived statistics, not extracts,
and they are the material the standing rule intended to permit.

| Site | What it says of itself |
|---|---|
| `src/data/defaultAssumptions.ts:46-47` | "PER-RATING-GROUP LOGNORMAL MIXTURES, fitted to the pool's own claim severities by EM, with per-group weights solved against the pool's own …" |
| `src/data/defaultAssumptions.ts:482` | the "mixture includes ALAE and comes from a real pool's real claim …" |
| `src/data/defaultAssumptions.ts:527` | "FITTED TO THE POOL'S OWN INDIVIDUAL CLAIMS (not occurrence totals …)" |
| `src/data/defaultAssumptions.ts:1833` | "The shape was fitted against the pool's own real settlement experience, each …" |
| `src/data/defaultAssumptions.ts:1899` | "Fitted against the pool's own closure experience, each line separately …" |
| `src/data/defaultAssumptions.ts:2760` | "pool's own GL experience, banded by headroom, value-weighted within band …" |
| `src/data/defaultAssumptions.ts:3065`, `:3117`, `:3329` | GL revision direction, rate and movement-by-age, each "the pool's own GL …" |
| `src/utils/claimClosure.ts:21-24` | "⚠ FITTED AGAINST REAL POOL EXPERIENCE, EACH LINE SEPARATELY, AND THE SOURCE …" / "pool's own closure experience and the fit is what survives" |
| `src/utils/propertyClaimEngine.ts:1` | "PROPERTY claim generator — FITTED to the pool's own nine years of claims." |
| `src/utils/claimTriangle.ts:206` | age curve "fitted against the pool's own …" |
| `src/utils/claimRevision.ts:254` | "the pool's own GL experience says movement scales …" |
| `src/utils/experienceRating.ts:191` | "A log-linear trend fitted across the pool's own …" |
| `src/data/memberCatalog.ts:31` | "FREQUENCY AND SEVERITY COME FROM REAL DATA; THE TIV BASE IS CHOSEN." |

### 2.3 Measured curves supplied from the real book

These are *curves*, not single parameters — closer to a table than to a fitted
constant.

| Site | What it says |
|---|---|
| `src/data/wcClfGrid.ts:8` | "FUNDING_CLF_TABLE is the **REAL pool's measured percentile curve**, at $20-30 [billion of payroll]" |
| `src/data/clfTables.ts:12` | "GL **SUPPLIED** — a real pool's measured curve at a scale this model does not [reach]" |
| `src/data/clfTables.ts:358` | "A real public-entity pool's measured curve, at a scale this model does not …" |
| `src/data/glClfGrid.ts:10` | "the real pool's parameter/trend uncertainty at $20-30B of payroll (process CV …)" |
| `src/utils/glLossDistribution.ts:3`, `src/utils/simulationEngine.ts:522` | both re-state that `FUNDING_CLF_TABLE` is the real pool's curve |

The word **SUPPLIED** in `clfTables.ts` is worth a reviewer's attention: it
indicates a curve handed over rather than derived here, which raises the
question of who supplied it and on what terms.

### 2.4 Development factors

The GL age-to-age development series **`1.872 / 1.439 / 1.265 / 1.031 / 1.024`**
is the real pool's own measured factor series. It appears at:

`src/data/defaultAssumptions.ts:423`, `:1513`, `:2103`, `:2213`, `:3972`,
`:4362`; `src/utils/claimTriangle.ts:67`, `:203`.

`defaultAssumptions.ts:4361-4362` states it explicitly: *"GL's target cumulative
of 3.60 is the pool's own age-to-age factors multiplied out: 1.872 x 1.439 x
1.265 x 1.031 x 1.024."* `:4358` adds the honest caveat that *"GL IS MEASURED.
WC AND PROPERTY ARE JUDGEMENT. Do not read the three as equally grounded."*
`:2102` records that *"the pool's own book develops 3.91x cumulative against the
model's 2.63x."*

An actuarial development pattern is, in itself, a disclosable-looking statistic.
Whether *this* pool's pattern is disclosable is a question for the pool.

### 2.5 ⚠ Where the "no source data" rule did not hold

**This is the part a reviewer most needs to see.** Despite the standing rule,
the repository does contain, in code comments, a number of items that are source
data by any ordinary reading:

| Site | What is disclosed | Rule category it falls under |
|---|---|---|
| `defaultAssumptions.ts:4585-4586` | **"FIT PROVENANCE — 1,822 claims over nine MATURE policy years, 2015-16 to 2023-24."** | claim count **and** policy years |
| `defaultAssumptions.ts:4590` | **"THE 2025-01-07 WILDFIRE IS EXCLUDED — six claims, $557.5M."** | a **dated, specific real catastrophe** with a loss total |
| `defaultAssumptions.ts:421`, `:2099` | "GL's AY3 running **$10.2M to $27.0M** on the same **397 claims**" | claim count and dollar totals |
| `defaultAssumptions.ts:176`, `:214` | "**THE POOL HAS OBSERVED CLAIMS IN THE $45-50M RANGE**" | a real large-loss observation |
| `defaultAssumptions.ts:605-608` | "The pool's observed 0-$1M loss cost is **$2.8300 per $100 of payroll**" | an observed loss cost |
| `defaultAssumptions.ts:292-295` | real class rates **{clerical 0.6452, publicWorks 2.0690, police 1.4118, fire 1.7073}**, which "reconcile with **the pool's own rate table** to within 3.4%" | a rate table |
| `defaultAssumptions.ts:3079` | "against the pool's **59%**" | an observed ratio |
| `defaultAssumptions.ts:4587-4589` | the VCL/non-vehicle split: "51% of claims but 5.5% of dollars", severity CV 1.57 vs 15.2 | a portfolio decomposition |
| `defaultAssumptions.ts:556`, `:230`, `:3249` | "The pool has seen nothing near $100M"; "5x anything the pool has seen" | loss-experience bounds |
| `memberCatalog.ts:18` | "the real pool's **4.6x**" TIV-to-payroll ratio | a book characteristic |

**The `2025-01-07` wildfire entry is the sharpest of these.** A dated January
2025 wildfire, with a claim count and a $557.5M loss total, attached to a
Californian public-entity pool (the WCIRB references elsewhere place the book in
California), is potentially identifiable — both the event and, through it, the
pool. That is a materially different disclosure from a fitted lognormal
parameter, and it is the one item here I would put in front of a reviewer
first.

None of this has been removed. **Per the brief, nothing has been remediated.**
The remediation, if a reviewer wants it, is small and surgical — these are
comments, not code, and redacting them changes no behaviour and moves no
baseline. But it is a decision about the pool's own data and it is not mine to
take.

### 2.6 A claim I could not verify

The handoff brief cited, as part of the real-book material, **"a stated
observation that six or seven years in ten come in over the funding number."**

**That statement does not appear anywhere in the repository.** I searched `src/`,
`scripts/`, `docs/` and `baselines/` for it and for every phrasing I could
construct of it, and found nothing.

I am recording it here rather than omitting it, and recording it accurately:
**it appears to be part of the conversational record, not the repository.** If
the observation is real and originates from the pool's own results, it is a
piece of the pool's experience that exists only in the project's spoken history
— which is its own kind of provenance question, since it cannot be reviewed by
reading the code. It should be confirmed or corrected by the person who stated
it.

### 2.7 What is *not* here

Stated for completeness, because a reviewer needs the negative findings as much
as the positive ones. I found **no**:

- claims listings, claim-level extracts or loss runs
- member-level real data of any kind (see §3)
- valuation-date schedules or reserve triangles as data files
- named real members, insureds, claimants, adjusters or employees
- spreadsheets, CSVs or databases of pool experience
- reinsurance treaty documents or slips

The real-book material is confined to fitted parameters and to the comment
disclosures listed in §2.5.

---

## 3. The member roster — synthetic, and nothing in the repo says so

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** *(for the gap, not for the
data)*

### 3.1 The finding

`src/data/roster_canonical_v3.csv` — and every other roster version, and the
`memberCatalog.ts` generated from them — **contains 200 synthetic members. They
are not real entities.** Names like "Brookhaven School District 001" are
generated: a generic place name, an entity type, and a sequential index matching
a sequential `member-001` identifier.

**No file in the repository states this.** Not the CSVs, not the generator, not
`memberCatalog.ts`, not any document in `docs/`. A reader opening a 200-row
roster of named school districts, cities and counties with payroll, TIV,
location counts and risk-quality scores — in a project that openly says its loss
parameters come from a real pool — **will reasonably assume the roster is real
too.** The user's instruction on this point was exactly right: a reader will
assume the opposite.

The structural evidence that it is synthetic is strong and I am confident in the
finding:

- names follow a rigid generated template; nothing is irregular the way a real
  roster is
- identifiers are sequential `member-001` … `member-200`
- the roster has been rescaled wholesale, twice, by a single multiplier: v6
  scaled TIV ×3.484302 from v5's $17,000.0M; v5 scaled ×1.188512 from v4's
  $14,303.6M. Real books do not multiply
- payroll totals a round $1,300M with County at exactly 30% and City at exactly
  20% "by design"
- `memberCatalog.ts` states the TIV base "IS A DESIGN CHOICE, NOT A
  CALIBRATION, and at ten times the real pool's 4.6x it must not be read as one"

### 3.2 But the loss behaviour attached to them is not synthetic

`memberCatalog.ts:31` is explicit: **"FREQUENCY AND SEVERITY COME FROM REAL
DATA; THE TIV BASE IS CHOSEN."** So the roster is a synthetic container carrying
real calibration. Both halves matter and neither should be reported without the
other.

### 3.3 What should happen

Not a data problem — a documentation problem, and a cheap one. A one-line header
on the canonical CSV and in `memberCatalog.ts` stating that the roster is
synthetic and the entities fictional would close it permanently. It is recorded
in `wishlist.md`. **Not done here**, because the brief is documentation-only and
the CSV/`.ts` are repository content.

### 3.4 Related defect

`memberCatalog.ts:2` names **`roster_canonical_v5.csv`** as the source of truth.
The generator (`scripts/tools/generate-member-catalog.ts:102`) reads
**`roster_canonical_v6.csv`**. The header is stale. Five superseded roster CSVs
remain committed and are read by nothing. See `known-issues.md`.

---

## 4. Published actuarial sources

Three published sources are cited in the code. In each case what was taken is a
**figure, a method or an assumption read from a publication** — not a bundled
dataset, not a copied table, not reproduced text.

### 4.1 WCIRB — Workers' Compensation Insurance Rating Bureau of California

**Cited at:** `src/data/exposureTrend.ts:19-27`; `src/utils/wcClaimEngine.ts:181`
("SOURCED: WCIRB blended severity 3.67%").

**What was used — a figure.** A blended severity trend of **3.67%**, decomposed
as medical 52% at 3.70%/yr and indemnity 48% at 3.63%/yr over **2017–2023**,
compared against wage inflation of 3.63% to give a +0.04% difference. The code
notes the indemnity trend was "read off the indemnity severity trend itself,
since WCIRB attributes …".

**Accessibility.** The WCIRB publishes research and rate filings; much of its
material is publicly available on wcirb.com, and some is restricted to members
or subscribers. **I could not determine from the repository which publication
this figure came from** — no report title, number or date is cited, only the
organisation.

**Usage-rights position.** Using an individual published trend figure as a model
parameter, with attribution, is ordinary actuarial practice. WCIRB material
carries its own copyright and terms of use, which generally restrict
redistribution of publications rather than the citation of figures. The
distinction matters and this use appears to be on the safe side of it.

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** — *the specific WCIRB
publication is not identified in the code, so neither the citation nor its terms
of use can be verified from the repository. A reviewer should establish which
document these figures come from and whether it was publicly available or
member-restricted.*

### 4.2 NCCI — National Council on Compensation Insurance

**Cited at:** `src/data/exposureTrend.ts:27` ("the NCCI a priori assumption");
`src/utils/memberLossHistory.ts:216` ("That is the correct incentive and it is
what NCCI …").

**What was used — an assumption and a qualitative direction.** Not a table, not
a rate, not a loss cost. The first is the *a priori* position that severity
trend nets against wage trend; the second is a statement about which direction
an experience-rating incentive should point.

**Accessibility.** NCCI is substantially **subscription-based**. Its manuals,
loss costs and circulars are licensed products; some explanatory and educational
material is public. General methodological positions of the kind used here are
widely restated in public actuarial literature.

**Usage-rights position.** What is used is general knowledge of NCCI's approach,
expressed in the project's own words. No NCCI table, rate or text is reproduced.

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** — *NCCI material is
predominantly licensed. Nothing licensed appears to have been copied, but the
references are unsourced (no document named), so a reviewer should confirm that
these are restatements of general position rather than anything drawn from a
subscription product.*

### 4.3 Mahler (1996), Casualty Actuarial Society Ratemaking Seminar

**Cited at:** `src/utils/memberExperienceMod.ts:18`, `:110`, `:118`, `:163`;
`src/types/simulation.ts:141`.

**What was used — a method.** The experience-modification approach itself; its
**"rule 3"** (cap year-on-year changes in the mod); and a **credibility figure
used as a comparison point** — `simulation.ts:141` reads "loss against 0.155 on
the primary layer at a $25k split. That is Mahler …".

This is the most substantive external intellectual borrowing in the project: the
structure of the experience modifier follows a published method rather than
merely taking a number from one.

**Accessibility.** CAS Ratemaking Seminar proceedings are **freely available to
the public on casact.org**, which the project has recorded. CAS makes its
research library openly accessible without membership.

**Usage-rights position.** Implementing a published actuarial method, with
attribution to its author and venue, is standard and expected practice; methods
are not protected by copyright, expression is, and no text is reproduced. This
is the best-placed of the three sources — freely accessible, properly
attributed, method rather than data.

**No review flag raised on accessibility.** One narrower point is flagged:

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** — *the citation gives
author, year and venue but no paper title or URL. For a method this central, a
full citation should be added so the source is verifiable by a reader. This is a
completeness gap, not a rights problem.*

### 4.4 CAS *Basic Ratemaking*

**Cited at:** `src/data/exposureTrend.ts:41`, `:44`.

**What was used — two methodological points**, both as justification for a
modelling choice and one as an acknowledged limitation: that trend should be
modelled **exponentially, not linearly** ("per CAS Basic Ratemaking: a linear
trend model …"), and that CAS **prescribes separate medical and indemnity
trends** where this model blends them — recorded at `:44` as "⚠ KNOWN
SIMPLIFICATION, NOT AN OVERSIGHT."

*Basic Ratemaking* is a CAS study-note textbook, freely downloadable from
casact.org. No text is reproduced; two methodological positions are cited. **No
flag.** Noted here because the spec asks for every externally sourced item to be
listed, including the ones that are fine.

### 4.5 A source cited that does not exist in the repository

`src/data/welcomeGuide.ts:3` states: *"Source: 01A_WELCOME_TO_RIPPLE.md."*

**That file is not in the repository** and is not in git history. The welcome
copy it produced is present, as structured data; its source document is not.
Low stakes — this is player-facing prose, most likely written by the project
owner — but a cited source that cannot be found is a provenance gap and is
recorded as one.

---

## 5. Dependencies

Full detail is in `dependencies-and-integrations.md`. The provenance position:

| | |
|---|---|
| Direct dependencies | 23 (7 runtime, 16 dev) |
| Licences | **20 MIT, 2 Apache-2.0 (`typescript`, `xlsx`), 1 ISC (`lucide-react`)** |
| Copyleft / restricted / commercial | **None** among the direct set |
| Packages in the lockfile | **307** |

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** — *the ~284 transitive
dependencies have **not** been licence-audited. The 23 direct packages were
checked individually; the rest of the tree was not. A licence scan over the full
lockfile should be run before any commercial distribution. Flagged because
"all permissive" is a claim I can support for the declared set and cannot
support for the tree.*

Three dependency-provenance notes:

1. **`fflate` (MIT, 0.8.3)** is the only recent runtime addition, introduced for
   the save codec. One import site, `src/utils/gameSave.ts:140`. Clean.

2. **`lz-string` is not a dependency and never was, in a committed state.** It
   was installed to run a codec bake-off and removed again. At HEAD it survives
   only inside comments (`src/utils/gameSave.ts`, `docs/WORKING_PRACTICES.md`)
   as the record of a measurement, and transiently in `package-lock.json` at
   commit `44a61fe`. **Nothing of `lz-string` ships**; only four rows of
   measured output sizes are recorded. No licence obligation arises. Recorded
   explicitly because a reader encountering `lz-string` in the source comments
   could reasonably think otherwise.

3. **`@supabase/supabase-js` is declared and entirely unused** — it appears only
   in `package.json` and `package-lock.json`, with no import, client, key or
   configuration anywhere. It is almost certainly scaffold residue. It matters
   for provenance because its presence implies a backend, a database and an
   authentication provider that **do not exist**, and it drags an unused
   transitive subtree into the licence surface above. Flagged, not removed.

---

## 6. Branding and visual identity

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`**

`src/assets/RippleLogo.tsx` describes itself as a *"**Vector recreation of the
Ripple brand mark** (concentric rings + colored dots). Built as SVG/JSX rather
than a raster asset …"*.

"Recreation" implies **a pre-existing brand mark that was reproduced**. The
repository does not say whose mark it is, where the original came from, or on
what basis it was recreated. The project was renamed to "Ripple" at some point —
the founding commit's `package.json` names it `risk-pool-simulation` and
`index.html` titled it "Risk Pool Simulation", and `src/utils/gameSave.ts:145`
refers to "THE RIPPLE RENAME" — so the name and the mark arrived together, from
somewhere.

Two distinct questions for a reviewer:

1. **The mark.** If it recreates an existing logo, whose is it and was
   permission given? If the owner's own organisation owns it, this resolves
   instantly. If it was recreated from a third party's mark, it should not ship.
2. **The name.** "Ripple" is a well-established trademark in other sectors. A
   trademark check appropriate to the intended market and use is a sensible
   precaution before any public release. This is raised as a question, not as a
   finding of conflict — I have no evidence either way.

The mark is hand-built SVG/JSX (49 lines, gradient stops `#2DBFA7` / `#79C242`
/ `#2E7FD6`), so no third-party image file is bundled. The question is about the
design, not about a copied asset.

**No other visual assets exist.** There is no `public/` directory, no image,
icon or font file anywhere in the repository. Icons come from `lucide-react`
(ISC). One dead reference: `index.html` links `/vite.svg` as the favicon and
that file does not exist — a harmless 404, noted in `known-issues.md`.

---

## 7. Licence status of this repository

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`**

**There is no `LICENSE` file, no `NOTICE` file, no copyright header in any
source file, and no `license` field in `package.json`** (which is marked
`"private": true`).

The repository is therefore **unlicensed** in the legal sense: with no licence
grant, default copyright applies and no one other than the rights-holder has
permission to use, copy, modify or distribute it. That is a perfectly coherent
position for private work, and it may well be the intended one. But it is
currently implicit, and the combination of unlicensed status, unestablished
foundation provenance (§1.2) and AI authorship (§1.1) means the question "who
owns this and what may be done with it" has **no answer recorded anywhere in
the project**.

This should be settled before the code is shared with a development team,
published, or used in a commercial product. Note also the Apache-2.0
dependencies (`typescript`, `xlsx`) carry an attribution/NOTICE requirement that
a distributed build would need to satisfy.

---

## 8. Secrets, credentials and personal data

Checked specifically, since the spec requires it. **Findings are clean.**

| Check | Result |
|---|---|
| `.env` or equivalent file | **None exists** |
| `process.env` / `import.meta.env` in `src/` | **None** |
| API keys, tokens, passwords, connection strings | **None found** |
| Certificates or private keys | **None** |
| Hardcoded credentials in `scripts/` | **None** |
| Network calls from `src/` | **None** — no `fetch`, `XMLHttpRequest`, `WebSocket` or `axios`; the only `http://` string in `src/` is inside a comment |
| Authentication of any kind | **N/A** — the application has none, so none is required to run it |
| Natural-person PII | **None.** `Member.name` holds synthetic organisation names |
| Analytics / telemetry | **N/A** — none; nothing is transmitted anywhere |

**Nothing in this document discloses a secret, because there are none to
disclose.** If the unused `@supabase/supabase-js` were ever wired up it would
require a project URL and anon key; it is not, and no such values exist in the
repository or its history.

The only personal data touching the project is the maintainer's email in git
commit metadata, which is ordinary git authorship.

---

## 9. Retrieved or externally incorporated material — negative findings

Recorded because the spec asks specifically about material an AI tool may have
retrieved or incorporated, and because negative findings are part of the audit.

| Checked for | Found |
|---|---|
| Copied code blocks from Stack Overflow, blogs or other repositories | **None identified.** The code is idiosyncratic throughout, carries project-specific comment conventions, and does not read as assembled from snippets. I cannot prove a negative — see the flag below. |
| Vendored third-party source (a bundled library copied into `src/`) | **None.** Every dependency is an npm package. |
| Copied documentation or prose | **None identified.** The `docs/` corpus (7,867 lines) is project-specific throughout. |
| Bundled external datasets | **None.** No downloaded table, no third-party CSV, no licensed data file. |
| Fonts, images, icon files | **None bundled.** Icons via `lucide-react` (ISC). |
| Generated content of unclear origin | The code itself — see §1.1. |

**`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`** — *I reviewed the code for
signs of copied third-party material and found none, but a manual review of
37,847 lines of `src/` and 30,328 lines of `scripts/` cannot establish the
absence of borrowed code with certainty. Given that the code was AI-written,
whoever is responsible for the organisation's IP position may wish to run an
automated code-provenance or similarity scan. I am flagging the limit of what I
could verify, not reporting a finding.*

---

## Items Recommended for Review

Everything flagged above, in one place, ordered by how much I think it matters.
None has been remediated.

### Priority 1 — the pool's own data

**1. Real book data disclosed in code comments beyond the project's own rule.**
`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
The standing rule was that no claim counts, dollar totals, policy years,
valuation dates or tables go in the repository. Most of it held; some of it did
not. Present in comments: **"1,822 claims over nine MATURE policy years, 2015-16
to 2023-24"** (`defaultAssumptions.ts:4585`); **"THE 2025-01-07 WILDFIRE …  six
claims, $557.5M"** (`:4590`); **"$10.2M to $27.0M on the same 397 claims"**
(`:421`, `:2099`); **"THE POOL HAS OBSERVED CLAIMS IN THE $45-50M RANGE"**
(`:176`, `:214`); the observed loss cost **$2.83 per $100 of payroll** (`:605`);
real class rates reconciling to **the pool's own rate table within 3.4%**
(`:292`); the **59%** ratio (`:3079`). *The dated wildfire entry is the sharpest
item: a specific, dated, large catastrophe with a claim count and loss total,
against a book the WCIRB references place in California. Potentially
identifiable.* → **Decision needed: does this material stay?** Redacting the
comments changes no behaviour and moves no baseline.

**2. Fitted parameters and supplied curves derived from the real pool's
experience.** `REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
Severity mixtures, closure curves, development factors (`1.872 / 1.439 / 1.265 /
1.031 / 1.024`), revision behaviour and the CLF percentile curves are all
derived from a real public-entity pool's own claims — the repository owner's
actual pools. `clfTables.ts` describes GL's curve as **"SUPPLIED"**, which
raises the question of who supplied it and on what terms. → **Confirm the pool's
owners permit fitted parameters derived from their experience to be
distributed, and clarify the terms attached to any supplied curve.**

**3. An observation attributed to the real book that is not in the repository.**
The statement that **"six or seven years in ten come in over the funding
number"** does not appear anywhere in `src/`, `scripts/`, `docs/` or
`baselines/`. It appears to belong to the conversational record rather than the
code. → **Confirm or correct; if it is real pool experience, note that it is
currently unreviewable because it exists only in spoken history.**

### Priority 2 — ownership and rights

**4. The repository has no licence.** `REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
No `LICENSE`, no `NOTICE`, no copyright header, no `license` field. Ownership
and permitted use are recorded nowhere. → **Settle before sharing, publishing or
commercialising.** Note the Apache-2.0 dependencies carry a NOTICE obligation on
distribution.

**5. The founding commit is an upload of unknown origin.**
`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
`116b96d` ("Add files via upload", 2026-07-15) delivered a complete working
application — ~7,000 lines of `src/` plus a 29,968-line `dist/` bundle — with no
recorded provenance. Ancestors of that code still ship. The second upload
`fbc4027` added three documents, same question. → **One sentence from the person
who uploaded it resolves this.** The `dist/app.js.map` still in git history may
reveal the pre-upload source tree, which is both the fastest way to answer and a
thing to know before making the repo public.

**6. Essentially all code is AI-generated.** `REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
363 of 365 commits authored by Claude Code under human direction. → **Confirm
organisational policy permits AI-generated code in a distributed product, and
take a position on the copyright status of that output.**

**7. Transitive dependencies are not licence-audited.**
`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
23 direct packages verified permissive (20 MIT / 2 Apache-2.0 / 1 ISC); the
remaining ~284 of 307 lockfile entries were not checked. → **Run a licence scan
over the full tree before commercial distribution.**

**8. No automated provenance scan of the source was performed.**
`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
I found no copied third-party code, but manual review of 68,000+ lines cannot
prove absence. → **Consider a code-similarity scan.** This flags the limit of my
verification, not a finding.

**9. The "Ripple" brand mark is described as a recreation.**
`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
`src/assets/RippleLogo.tsx` — "Vector recreation of the Ripple brand mark". The
original's owner is not stated. The project was renamed from "Risk Pool
Simulation" to "Ripple" at some point. → **Establish whose mark it recreates and
whether permission exists; consider a trademark check on the name for the
intended market.**

### Priority 3 — citation and documentation gaps

**10. The roster is synthetic and the repository never says so.**
`REVIEW NEEDED` *(documentation gap, not a rights problem)*
200 members across six `roster_canonical*.csv` files and the generated
`memberCatalog.ts`. Names like "Brookhaven School District 001" are generated;
identifiers are sequential; the book has been rescaled wholesale by a single
multiplier twice. **Nothing states any of this**, in a project that openly says
its loss parameters come from a real pool — so a reader will assume the roster
is real. Note the genuine nuance: `memberCatalog.ts:31` says "FREQUENCY AND
SEVERITY COME FROM REAL DATA; THE TIV BASE IS CHOSEN", so the synthetic roster
carries real calibration. → **Add one header line to the canonical CSV and to
`memberCatalog.ts`.** Cheapest item on this list.

**11. WCIRB figures are cited without a source document.**
`REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
The 3.67% blended severity trend and its medical/indemnity decomposition cite
the organisation but no report, number or date. Some WCIRB material is public,
some is member-restricted. → **Identify the publication and confirm its terms.**

**12. NCCI references are unsourced.** `REVIEW NEEDED — SOURCE OR USAGE RIGHTS UNCLEAR`
An *a priori* assumption and a statement of incentive direction, neither tied to
a document. NCCI material is predominantly subscription-licensed; nothing
licensed appears to have been copied. → **Confirm these are restatements of
general position, not content from a subscription product.**

**13. Mahler (1996) lacks a full citation.** `REVIEW NEEDED` *(completeness, not rights)*
Author, year and venue are given; no title or URL. CAS Ratemaking Seminar
proceedings are freely available on casact.org, and implementing a published,
attributed method is standard practice — **this is the best-placed of the three
external sources.** → **Add the full citation**, since the method is central to
the experience modifier.

**14. `welcomeGuide.ts` cites a source file that does not exist.**
`REVIEW NEEDED` *(minor)*
"Source: 01A_WELCOME_TO_RIPPLE.md" — not in the repository, not in git history.
→ **Locate it or drop the reference.**

**15. `@supabase/supabase-js` is declared and completely unused.**
*(not a rights flag; recorded here because it misrepresents the system)*
Its presence implies a backend, database and auth provider that do not exist,
and it drags an unused transitive subtree into the licence surface. → **Remove
it.** First item on `wishlist.md`.

---

*Nothing listed above has been changed. All of it is identified so it can be
reviewed separately, as the brief requires.*
