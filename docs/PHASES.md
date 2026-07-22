# Pool Risk Management Game — Development Spec (v2)

This replaces the original single-pass phase plan. Same destination, but broken into small
stages that can each be built, tested, and confirmed working before moving to the next —
so a regression is caught in a 30-minute stage, not buried in a 3-week phase.

**How to use this with Claude Code:** hand it one stage at a time. Each stage lists exactly
what changes, what to test, and a ready-to-paste prompt. Don't start a stage until the
previous one's acceptance test passes.

**Numbers vs. structure:** Anything marked 🔒 is a locked structural/mechanical decision.
Anything marked 🎚️ is a starting parameter — a reasonable default we chose to unblock
building, not a final balance number. Adjust 🎚️ items freely during playtesting without
touching the underlying mechanic.

---

## 0. Baseline (current code, before any of this)

- One implicit coverage line. `PoolState`, `DecisionSet`, `ResultSet` are all flat/pool-wide.
- Exposure = payroll ($M). Premium = `exposure × ratePer100 × 10,000`.
- Losses are member-level Gamma draws × one pool-wide lognormal `commonLossFactor`.
- Reinsurance is aggregate quota-share only (`reinsuranceEngine.ts`), priced off
  `competitivePressure` alone.
- Reserves are flat annual cohorts with one `RESERVE_PAYDOWN_PCT` — no accident-year triangle.
- One flat `DecisionSet` per year, no per-line anything.
- No shock event library, no IRIS ratios, no per-claim data, no decision history view.
- Market catalog = 100 total members (`memberCatalog.ts`) — small enough that performance is
  a non-issue for everything in this doc; no capping mechanisms needed anywhere.

---

## Locked Design Decisions (reference — from Tiers 1–8)

### Capital structure 🔒
- Coverage lines are selected once at game setup and **locked** for the whole game (no
  add/remove mid-game).
- **Each line has its own surplus, cash, and reserves.** The "Pool" view is a derived sum
  across lines, not a separate ledger.
- **Investments are shared/commingled** across lines — one portfolio, income allocated back
  to each line by its share of contributed assets.
- New pool-level decision: **asset allocation** — cash % / bonds % / equities %, replacing
  the old single `investmentRisk` 0–10 slider.
- Dividend %, assessment %: **per line**.
- Rate change, underwriting strictness, risk control %, reinsurance level, funding confidence
  level (CLF): **per line** (unchanged from original design, just now explicitly per-line).
- **Inter-line borrowing**: if a line's surplus goes negative, the player is prompted to
  authorize a loan from the shared pool. Rate = that year's actual pool investment return,
  locked at origination. Repayment = automatic skim of that line's net income, at a
  **player-adjustable repayment aggressiveness %** (new per-line decision, only relevant
  while a loan is outstanding). Declining to borrow leaves the line's surplus negative,
  which should block that line's dividend next year and flag on capital adequacy / IRIS.

### Exposure bases 🔒
- WC: payroll ($M) — unchanged.
- GL: **payroll** (same base as WC — public-entity pools don't have commercial-style revenue).
- Property: **Total Insured Value (TIV)**.
- Each `Member` gets a **per-line exposure map**, not one universal exposure number, since a
  member can have WC/GL payroll and Property TIV simultaneously.
- Build all 3 lines simultaneously (not incrementally line-by-line) once Phase 1 starts.

### Reserves 🔒 / 🎚️
- Accident year = calendar year (both 1/1–12/31, no separate policy-year offset). 🔒
- Full per-line accident-year development triangles (paid, case, IBNR, carried, ultimate). 🔒
- Reserve strategy: 4 presets (aggressive/moderate/conservative/very conservative), 🔒
  structured as a **confidence-level keyed lookup** (not a hardcoded switch) so it can later
  become a continuous CLF-style slider without an engine rewrite. 🔒
- Preset multipliers on indicated reserve: e.g. `{aggressive: 0.90, moderate: 1.00,
  conservative: 1.10, veryConservative: 1.20}`. 🎚️

### Shock events 🔒
- Max **one** event per year. 🔒
- Decisions do **not** affect whether an event occurs — only how well the pool absorbs it. 🔒
- Base probability per event, fully random, seeded — **odds hidden from the player**. 🔒
- Legislative/medical events can bias existing open cohorts' development toward adverse for
  N years (not new claims, not reopened claims). 🔒
- Some categories can permanently shift that line's future `lossTrend`. 🔒
- Each event has a **claim manifestation type** (see Per-Claim section) determining how it
  shows up in the claims data. 🔒
- Each event carries **narrative fields** (headline, narrative summary, real-world context,
  typical consequences) woven into the existing yearly `generateNarrative()` output. 🔒
- A browsable **Event Library / encyclopedia page** is a deliberate later add-on, not part of
  the initial shock event build.

### Per-claim simulation & reporting 🔒
- Claims reported per line per year as: a **size-bucket summary table** (count, total
  incurred, total paid, no line-drawing detail) for ordinary claims, plus an **individual
  large-claims table** (member, incurred, retained, ceded, uncovered) for anything above a
  "large" threshold. 🔒
- Shock event manifestation types: 🔒
  - `poolWideEvent` — one claim, attributed to the event itself, not a real member (e.g. a
    COVID-style systemic event).
  - `multipleLargeClaims` — spread across several real members (e.g. wildfire/earthquake
    hitting multiple properties).
  - `developmentBiasOnly` — no new claim, just pushes existing reserves adverse.
  - `trendShiftOnly` — no claim, permanently shifts future trend.
- No claim-count performance cap needed at current member-catalog scale (100 members). 🔒
- Earthquake-specific reinsurance sub-limit is **deferred** — earthquake tests against the
  same general Property reinsurance program for now. 🔒

### Reinsurance 🔒 / 🎚️
- Combined structures stack **occurrence first, then aggregate quota-share** on the
  remainder. 🔒
- Reinsurance cost is **experience-rated**: a trailing-window actual-to-expected loss ratio
  produces a multiplier on the market-driven base cost. 🔒
- Trailing window: **2 years**. 🎚️
- Experience modifier bounds: **0.85× (best case) to 1.50× (worst case)**. 🎚️
- `sensitivityFactor` (how strongly the ratio moves the modifier) is a named constant in
  `defaultAssumptions.ts`, tunable without touching engine logic. 🎚️

### IRIS ratios 🔒 / 🎚️
- IRIS 11, 12, **and 13** all in scope. 🔒
- "Unusual value" threshold: approximate **~20% of surplus**, not pinned to an exact current
  NAIC figure. 🎚️

### Deferred (explicitly out of scope for now)
- Multiplayer (see Appendix — captured for months-down-the-line reference, not part of active
  work).
- Mid-game line add/remove.
- Earthquake-specific reinsurance sub-limits.
- Explicit "bad decision vs. bad luck" attribution scoring — stays implicit via side-by-side
  Decision History / Shock Event Log / Large Claims / IRIS views.

---

## STAGE-BY-STAGE BUILD PLAN

### Phase 1 — Multi-Line Foundation

#### Stage 1.1 — Types + line selection UI only (no engine math changes)
**Goal:** Get the `CoverageLine` concept into the codebase and let the player pick lines at
setup, without touching simulation logic yet.

- Add `export type CoverageLine = 'WC' | 'GL' | 'Property';` to `types/simulation.ts`.
- Add `activeLines: CoverageLine[]` to `GameSetupSettings`.
- `SetupPage`: add a checkbox group (at least one line required) that sets `activeLines`.
- No changes to `PoolState`, `DecisionSet`, or `simulationEngine.ts` yet — the rest of the
  game keeps working exactly as it does today, just with an unused `activeLines` field
  sitting in setup.

**Test before moving on:** Start a game, pick any combination of lines, confirm setup saves
and the rest of the game runs completely unaffected (still single flat pool behavior).

```
Stage 1.1: Add a CoverageLine type ('WC' | 'GL' | 'Property') and an activeLines field to
GameSetupSettings. Add a checkbox group to SetupPage letting the player pick 1-3 lines
(at least one required). Do not change PoolState, DecisionSet, or simulationEngine.ts —
this stage only adds the selection UI and stores the choice; the rest of the game should
behave exactly as it does today.
```

#### Stage 1.2 — Restructure state types (WC-only regression test)
**Goal:** Split `PoolState`/`DecisionSet`/`Member` into shared + per-line shape, but only
wire WC, and prove the refactor didn't change any numbers.

- `Member.exposure: number` → `Member.exposureByLine: Partial<Record<CoverageLine, number>>`.
- `PoolState` splits into shared fields (cash, investments, otherAssets, unearnedPremium,
  otherLiabilities, allMarketMembers) + `lines: Record<CoverageLine, LinePoolState>`.
  `LinePoolState` holds: rateLevel, ratePer100, purePremiumPer100, memberSatisfaction,
  averageRiskQuality, riskControlEffectiveness, reserveCohorts, members, **and now
  surplus** (per Tier 1 — surplus is per-line, not shared).
- `DecisionSet` splits into pool-level (dividendPct — wait, moved per-line, see below;
  investmentRisk retired, will become assetAllocation in Stage 1.5) + `byLine:
  Record<CoverageLine, LineDecisionSet>` holding rateChange, underwritingStrictness,
  riskControlPct, reinsuranceLevel, fundingConfidenceLevel, dividendPct, assessmentPct.
- Rename current `processYear` body → `processLineYear(lineState, lineDecisions, sharedCtx)`.
- New thin `processYear` calls `processLineYear` once (WC only, since other lines aren't
  wired yet) and passes through.

**Test before moving on:** Play a WC-only game. Every number (premium, losses, reserves,
surplus, results) should match what today's single-line game produces bit-for-bit, given the
same seed. This is the regression check — if anything drifts, the refactor has a bug.

```
Stage 1.2: Refactor PoolState, DecisionSet, and Member into the shared + per-line shape
described in PHASES.md (Member.exposureByLine, PoolState.lines: Record<CoverageLine,
LinePoolState> with per-line surplus, DecisionSet.byLine: Record<CoverageLine,
LineDecisionSet>). Rename the current processYear body to processLineYear and add a thin
processYear wrapper that calls it for WC only (other lines not wired yet). This stage is a
pure refactor — given the same seed, a WC-only game must produce numerically identical
results to before the refactor. Verify this explicitly before considering the stage done.
```

#### Stage 1.3 — Wire GL as a second line
**Goal:** Get a second line fully working end to end, proving the per-line architecture
generalizes correctly.

- Add GL default assumptions to `defaultAssumptions.ts` (own rate table, pure premium,
  development pattern placeholder — reuse WC's payroll exposure).
- `processYear` loops `activeLines`, calling `processLineYear` once per active line.
- Aggregate pool-level `ResultSet` fields become sums across active lines' results;
  `ResultSet` gets a `byLine: Record<CoverageLine, LineResultSet>` field.

**Test before moving on:** Start a game with WC + GL. Confirm both lines produce independent,
sensible premium/loss/surplus numbers, and that a WC-only game (Stage 1.2's regression) still
matches exactly.

```
Stage 1.3: Add GL default assumptions to defaultAssumptions.ts (payroll-based exposure, its
own rate table and pure premium). Update processYear to loop over activeLines and call
processLineYear per line, aggregating pool-level ResultSet fields as sums across lines.
Add ResultSet.byLine: Record<CoverageLine, LineResultSet>. Test with a WC+GL game for
sensible independent per-line numbers, and re-confirm the WC-only regression from Stage 1.2
still holds.
```

#### Stage 1.4 — Wire Property as the third line
**Goal:** Add the line with a genuinely different exposure base, proving the architecture
handles that too.

- Add Property default assumptions (TIV-based exposure, own rate table, pure premium, fast
  development pattern placeholder).
- `Member.exposureByLine.Property` populated with TIV values in member generation
  (`instanceGenerator.ts` / `memberCatalog.ts`).

**Test before moving on:** Start a game with all 3 lines active. Confirm Property's premium
calc correctly uses TIV rather than payroll, and WC/GL regressions still hold.

```
Stage 1.4: Add Property default assumptions to defaultAssumptions.ts using Total Insured
Value (TIV) as its exposure base instead of payroll. Update member generation so each
Member's exposureByLine.Property is populated with a plausible TIV value. Test a
3-line game and confirm Property's premium/loss calculations correctly use TIV, and that
WC/GL numbers from prior stages are unaffected.
```

#### Stage 1.5 — Shared investment pool + asset allocation decision
**Goal:** Replace the single `investmentRisk` slider with real cash/bonds/equities
allocation, and route investment income back to lines by contribution share.

- Retire `investmentRisk` from `DecisionSet`.
- Add pool-level decision: `assetAllocation: { cashPct: number; bondsPct: number;
  equitiesPct: number }` (must sum to 100).
- Rewrite `investmentEngine.ts` to model 3 asset classes with distinct return/volatility
  assumptions (cash: low return, low vol; bonds: moderate; equities: higher return, higher
  vol, occasional downside) blended by the player's allocation percentages.
- Investment income allocated back to each line's surplus proportional to that line's share
  of total contributed cash/reserves into the shared pool.

**Test before moving on:** Confirm total investment income responds sensibly to allocation
changes (more equities = more volatile but higher expected return), and that each line
receives a plausible share of that income.

```
Stage 1.5: Retire the investmentRisk 0-10 slider. Add a pool-level assetAllocation decision
(cashPct/bondsPct/equitiesPct, summing to 100). Rewrite investmentEngine.ts to model three
asset classes with distinct return/volatility assumptions, blended by the player's
allocation. Allocate investment income back to each line's surplus proportional to that
line's share of total contributed cash/reserves in the shared pool. Test that income
responds sensibly to allocation changes and splits plausibly across lines.
```

#### Stage 1.6 — Inter-line borrowing
**Goal:** Implement the surplus-call mechanic for a line that goes negative.

- New `InterLineLoan` ledger: `{ borrowingLine, principal, remainingBalance,
  rateAtOrigination, yearOriginated }`, tracked pool-level.
- At year-end, if any line's ending surplus is negative: prompt the player to authorize a
  loan (funded by the shared pool) to bring it to zero, or decline (line carries negative
  surplus forward).
- Loan rate = that year's actual realized pool investment return, fixed at origination.
- New per-line decision: `loanRepaymentAggressiveness` (0–100%), only shown/relevant while
  that line has an outstanding loan balance. Each year, that % of the line's positive net
  income pays down principal + accrued interest first, before flowing to that line's own
  surplus.
- Declining to borrow: block that line's dividend decision next year (surplus < 0), and flag
  it for the capital-adequacy status / IRIS views (Phase 7).

**Test before moving on:** Force a line into negative surplus (e.g. via a bad shock or
aggressive assessment cut — can hand-edit test state), confirm the loan prompt appears,
confirm repayment skim behaves per the aggressiveness %, and confirm declining leaves the
line negative with dividend blocked.

```
Stage 1.6: Add an InterLineLoan ledger (borrowingLine, principal, remainingBalance,
rateAtOrigination, yearOriginated) tracked at the pool level. At year-end, if any line's
ending surplus is negative, prompt the player to authorize a loan from the shared pool to
zero it out, at that year's realized pool investment return rate. Add a per-line
loanRepaymentAggressiveness decision (0-100%, only relevant while a loan is outstanding)
that determines what % of that line's positive net income repays the loan before flowing to
its own surplus. If the player declines to borrow, the line's surplus stays negative and
its dividend decision should be blocked next year. Test by forcing a line negative and
confirming the full loan/repayment/decline flows work.
```

---

### Phase 2 — Results and Decision Interface

#### Stage 2.1 — Pool/line view toggle across existing pages
- Add a Pool / WC / GL / Property filter (reuse `TabNav` pattern) to Dashboard, Decisions,
  Financials, Results pages, filtering which slice of `byLine` data is shown.

**Test:** Toggle between views on each page, confirm numbers match the correct slice.

#### Stage 2.2 — Decision History page
- New page: table of every year's pool-level and per-line decisions (source:
  `lockedResults[].decisions`), filterable by line, sortable by year.

**Test:** Play a few years with varied decisions, confirm history reflects them accurately.

#### Stage 2.3 — Individual-year comparison view
- Results page gets a year selector showing current vs. prior year $ and % change per key
  metric, plus (once Phase 4 exists) which shock event fired.

**Test:** Confirm deltas compute correctly against the prior locked year.

#### Stage 2.4 — Accident-year development view
- Given Tier 3's decision (accident year = calendar year, full triangles): add a view where
  the player selects an accident year and sees its original estimate vs. current estimate
  over time — the actual "favorable/adverse development" visualization. This depends on
  Phase 3's data existing, so functionally this stage should be built alongside/after Phase 3
  Stage 3.1, even though it's listed here for the UI grouping.

**Test:** Pick an accident year with known development (test fixture), confirm the view
correctly shows its estimate history.

```
Phase 2 prompt (run stages 2.1-2.3 together, 2.4 after Phase 3 lands):
Add a Pool/WC/GL/Property view filter to DashboardPage, DecisionsPage, FinancialsPage, and
ResultsPage (reuse the TabNav pattern). Add a Decision History page showing every year's
pool-level and per-line decisions, filterable by line. Add a year-selector to ResultsPage
showing prior-year $ and % change per key metric. Build these as independently testable
changes — confirm each one before moving to the next.
```

---

### Stage 2.5 — "Effective rate" drives satisfaction (fix to a live mechanic)
**Goal:** Before reserve strategy exists, fix the satisfaction/retention model so it responds to
the members' actual bill, not just the `rateChange` decision. This unlocks realistic linkages
for reserve strategy (Phase 3), reinsurance cost, CLF, and future experience-rating — all
through one channel — instead of wiring each separately later.

- Derive an **effective rate change** = this year's total member charge per exposure unit vs.
  last year's.
- Reroute `updateSatisfaction()` / retention in `membershipEngine.ts` to respond to that,
  tested against the bill-moving inputs that already exist today (rate change, CLF, reinsurance
  cost).

**Tabled sub-decisions (resolve when building Phase 3's reserve funding load, not now):** how a
reserve funding load translates into the bill (multiplier vs. additive); whether effective-rate
satisfaction replaces or layers on top of the current `rateChange` link; exactly which
components the effective bill includes. Direction is decided; the translation math is open.

**Test before moving on:** Confirm satisfaction now moves when CLF or reinsurance cost changes
the bill (not just when a rate-change decision is made), and that a pure rate-change still
behaves sensibly.

```
Stage 2.5: Fix the satisfaction/retention model so it responds to a derived "effective rate
change" (this year's total member charge per exposure unit vs. last year's), not just the
rateChange decision input. Reroute updateSatisfaction()/retention in membershipEngine.ts
accordingly, and test that CLF and reinsurance cost changes now move satisfaction through the
members' bill. Do NOT yet wire in reserve strategy (Phase 3) — just fix the mechanism on the
bill-moving inputs that exist today.
```

---

### Stage 2.7 — Per-Line Decision Editing (GL & Property inputs)

**Status:** ✅ BUILT. UX model chosen: **Model A (strict per-line)** — each line's decisions are
edited only on that line's own tab (WC/GL/Property); no pool-wide "apply to all" shortcut. Every
per-line decision is now editable per line, including asset allocation (moved per-line in Stage
2.9). "Reset to Defaults" resets only the current line. UI-only change — no engine edits (the
engine already processed each line with its own `decisions.byLine[line]`; only the Decisions page
was previously WC-hardcoded). Note: because the operating cash / other-assets pot is shared and
split by contribution weight (Stage 1.5/2.9), a change in one line's surplus produces a
sub-basis-point ripple in the others' cash slice in later years — inherent to the pool model, not
a Stage 2.7 artifact; segregated investment portfolios and same-year pricing/losses stay isolated.

**⚠️ Depends on:** the per-line decision *editing UX* question being resolved first
(see decisions-chat brainstorm: Pool-tab-edits-all vs. line-tab-only vs.
read-only-pool-summary vs. labeled-hybrid). Do NOT build this until that model is
chosen — it determines how the controls behave.

**Goal:** Let the player set per-line decisions independently for every active line,
not just WC. Today GL and Property calculate and display correctly, but only WC's
decision inputs are wired for editing, so all lines effectively move on WC's inputs.

**The work:**
- Wire decision input controls for GL and Property (rate change, underwriting
  strictness, risk control %, reinsurance level, CLF, dividend %, assessment %, and
  loan repayment aggressiveness when a loan is active), consistent with the per-line
  view pattern from Stage 2.1.
- Implement editing per the chosen UX model (A/B/C/hybrid).
- Pool-level decisions (asset allocation) remain pool-level.

**Regression expectation:** a WC-only game on seed MAMC6EA4, baseline, must still match
the v4 WC baseline exactly — adding GL/PR editing must not change WC behavior.

**Test:** in a 3-line game, set different decisions per line (e.g. +5% rate on GL, 0% on
WC, a dividend on Property) and confirm each line's results respond only to its own
inputs; confirm Decision History (Stage 2.2) reflects the per-line choices correctly.

**Note:** numbered 2.7 (not 2.6) intentionally, to avoid renumbering existing stages.
Sequenced after the read-only Phase 2 stages (2.2, 2.3) because those are unblocked
while this one waits on the editing-UX decision.

---

### Stage 2.8 — Multi-Line Results Export (.xlsx, tab per line)

**Status:** ✅ BUILT. Pool tab drops the Asset Allocation row (no pool-level allocation since
Stage 2.9) and splits the unit-mixing exposure rows (Active/Total Market/Written Exposure,
Market Share) into one row per active line instead of a single summed figure — Property's TIV
and WC/GL's payroll can't be added together meaningfully. Every other Pool-tab row (including
investment income/return/assets, which ARE meaningful blended pool-wide) is unchanged.

**Goal:** Replace the current single-sheet CSV results export with a multi-tab Excel (.xlsx)
workbook that breaks out every active coverage line separately, plus a combined Pool tab. Today's
export only shows one set of results (pool-level combined, or a single line when only one is
active); it can't show each line's individual results in a multi-line game.

**The work:**
- Change the results export from `.csv` to `.xlsx` (a real workbook with multiple tabs — CSV
  cannot hold multiple sheets).
- One tab per **active** line, plus a **Pool** (combined) tab. Only active lines get tabs — a
  WC+GL game produces Pool / WC / GL (no empty Property tab).
- **Tab order:** Pool first, then WC, GL, Property (in that fixed order, active lines only).
- **Each line tab:** the same rows/metrics as today's CSV export, scoped to that line, **plus a
  few line-specific fields where relevant** (e.g. that line's exposure base and units — payroll
  for WC/GL, TIV for Property — and any line-specific reinsurance/reserve fields that only make
  sense per line). Keep the familiar row structure so it reads like today's export.
- **Pool tab:** the combined/summed totals across active lines (equivalent to today's pool-level
  export), so Pool = sum of the line tabs on the summable metrics.

**Filename (supersedes UI_REFINEMENTS item 3):** `SEED_{seed}_{lines}_YR{currentYear}.xlsx`
- `{lines}` = active lines joined with underscores in fixed order WC_GL_PR (Property = PR), e.g.
  `SEED_MAMC6EA4_WC_GL_PR_YR3.xlsx`. This replaces the single-line filename convention that item
  was originally written for — handle them together.
- Contents still include every played year (columns Y1..current), same as today — only the
  format and the per-line breakout are changing.

**Regression / correctness checks:**
- Pool tab must equal the sum of the per-line tabs on summable metrics (premium, losses,
  reserves, etc.) — same reconciliation that holds in the app's Pool view.
- Every line tab must still tie out (Surplus Tie-Out Difference ~0), matching the v4 baselines.
- A WC-only game produces Pool + WC tabs whose numbers match the v4 WC baseline exactly.
- No engine/calculation changes — this is an export/format change only.

**Note:** this makes verification EASIER going forward — a single .xlsx will contain every line's
results in one file, so baseline captures and cross-checks won't need multiple separate CSV
exports per config.

**Test:** export from a 3-line game; confirm four tabs in order (Pool, WC, GL, Property), each
line tab scoped correctly, Pool = sum of lines, filename matches the convention, and all tabs
tie out.

---

### Stage 2.9 — Per-Line Investments Rework (segregated portfolios)

**Status:** ✅ BUILT (unblocked and implemented in the build thread). Reverses the Tier 1
"shared investments" decision. Design sub-questions resolved in
DECISIONS_CHANGE_per_line_investments.md, plus two settled during the build: loan money is a
real transfer funded by the other lines in proportion to lending capacity, with repayments
(principal + interest) returning to the same lenders in the same fixed shares; and a lender is
never pushed to negative surplus — if the other lines can't cover the full deficit, no loan is
offered (the player's remedy is an assessment).

**Goal:** Change investments from one shared/commingled pool portfolio (single pool-level
allocation) to per-line segregated portfolios — each line invests its own assets with its
own cash/bonds/equities allocation, keeping its own gains/losses. Rationale: asset-liability
duration matching (WC's long tail vs. Property's short tail).

**The work:**
- Rework the investment engine (was Stage 1.5): each line gets its own sub-portfolio and its
  own allocation. Remove the "allocate shared income by contribution share" mechanic — each
  line simply earns/loses on its own portfolio.
- Move the asset-allocation decision from pool-level to per-line.
- Update the inter-line loan rate source (Stage 1.6): the rate becomes the pool's
  ASSET-WEIGHTED BLENDED investment return for that year (each line's return weighted by its
  invested assets), still fixed at origination. Keep inter-line borrowing otherwise intact —
  lines invest separately but can still lend surplus to each other.
- Correlated risk is now ISOLATED per line by design (a bond-heavy line is insulated from a
  market drop that hits an equity-heavy line). Do not re-engineer pool-wide investment
  correlation.
- Remove the "Pool" tab from the DECISION-oriented pages (Decisions, Decision History) — no
  pool-level decisions remain. KEEP the Pool tab on results pages (Dashboard, Financials,
  Results, year-comparison) where it means combined results.
- Update DECISIONS docs: asset allocation moves to the per-line section.

**Regression / baselines:** unlike prior changes, this shifts WC-only numbers too (WC now has
its own portfolio, not a shared one). Capture a fresh v5 baseline set (all configs) after
implementing. Confirm every line still ties out (Surplus Tie-Out Difference ~0).

**Test:** in a 3-line game, set different allocations per line (e.g. WC bond-heavy, GL
equity-heavy); confirm each line's investment income tracks its OWN allocation, a market
swing hits only the equity-heavy line's surplus, the loan rate reflects the asset-weighted
blend, and the Pool tab is gone from Decisions/Decision History but present on results pages.

---

### Phase 3 — Reserve Development System

#### Stage 3.1 — Accident-year triangle data model + per-line development patterns
- Add `DevelopmentPattern` and `AccidentYearCohort` types (see below).
- Add per-line `DevelopmentPattern`s to `defaultAssumptions.ts`: Property fast (3-4 year
  tail), WC slow (7-10 year tail), GL slow with a reporting-lag-heavy first period.
- Replace `processReserveDevelopment`'s flat paydown with a per-line, per-accident-year
  version driven by these patterns.

```ts
export interface DevelopmentPattern {
  coverageLine: CoverageLine;
  paidPctByMaturity: number[]; // e.g. Property: [0.60,0.90,0.98,1.0]
}

export interface AccidentYearCohort {
  accidentYear: number;
  coverageLine: CoverageLine;
  initialExpectedUltimate: number;
  paidToDate: number;
  caseReserve: number;
  ibnr: number;
  currentUltimate: number;
  carriedReserve: number;
  maturityYears: number;
  closed: boolean;
}
```

**Test:** Confirm a single accident year's cohort pays down at roughly the expected pace for
its line (Property fast, WC slow) over several simulated years.

#### Stage 3.2 — Reserve strategy decision
- Add per-line reserve strategy decision (aggressive/moderate/conservative/veryConservative),
  structured as a confidence-level-keyed lookup (see Locked Decisions above) setting
  `carriedReserve` as a multiplier on the actuarially indicated reserve.

**Test:** Confirm changing strategy visibly changes carried reserve and reported surplus in
the expected direction, without changing the underlying indicated reserve itself.

```
Phase 3 prompt:
Per PHASES.md, replace the flat-paydown ReserveCohort model with AccidentYearCohort
triangles per coverage line, using per-line DevelopmentPattern assumptions (Property:
3-4yr fast tail; WC: 7-10yr slow tail; GL: slow tail with a reporting-lag-heavy first
period). Then add a per-line reserve strategy decision (aggressive/moderate/conservative/
veryConservative) structured as a confidence-level-keyed lookup table (not a hardcoded
switch) setting carriedReserve as a multiplier on the indicated reserve. Test each stage
independently: first confirm development patterns pay down at the right pace per line,
then confirm reserve strategy changes carried reserve/surplus correctly.
```

---

### Phase 4 — Shock Event System

#### Stage 4.1 — Event data structure + a small starter library (2-3 events)
```ts
export type ShockCategory = 'catastrophe' | 'legislative' | 'medicalCost' | 'economic';
export type ClaimManifestation =
  | { type: 'poolWideEvent' }
  | { type: 'multipleLargeClaims'; claimCount: number }
  | { type: 'developmentBiasOnly' }
  | { type: 'trendShiftOnly' };

export interface ShockEvent {
  id: string;
  category: ShockCategory;
  headline: string;
  narrativeSummary: string;
  realWorldContext: string;
  typicalConsequences: string;
  probability: number; // annual, per event
  manifestation: ClaimManifestation;
  impactByLine: Partial<Record<CoverageLine, {
    currentYearLossMultiplier?: number;
    developmentBias?: { durationYears: number; adverseShift: number };
    futureRateTrendAdjustment?: number;
  }>>;
}
```
- Build 2-3 real events to prove the pattern end to end before writing the whole library —
  e.g. one catastrophe (`multipleLargeClaims`), one legislative (`developmentBiasOnly` +
  `futureRateTrendAdjustment`), one pool-wide systemic event (`poolWideEvent`).

**Test:** Manually trigger each event type (bypass the probability roll for testing) and
confirm its mechanical effects land correctly (loss multiplier, development bias, trend
shift) on the right line(s).

#### Stage 4.2 — Probability roll + selection
- Each year, roll each event's `probability` using the existing seeded `deriveSubRng`
  pattern. Max one event fires per year. Odds not shown to the player.

**Test:** Run many simulated years (script or rapid play-through), confirm roughly the
expected long-run frequency per event given its probability, and never more than one firing
in the same year.

#### Stage 4.3 — Narrative integration
- Wire `headline` + `narrativeSummary` into `generateNarrative()`, replacing the current
  generic shock-loss sentence when an event fires.

**Test:** Trigger an event, confirm the yearly narrative reads naturally with the event's
specific text woven in alongside the existing mechanical sentences.

#### Stage 4.4 — Expand the library to full size
- Flesh out to 8-12 events across all 4 categories once the pattern is proven.

```
Phase 4 prompt (run stage by stage):
Stage 4.1: Add the ShockEvent type and ClaimManifestation type from PHASES.md. Build 2-3
starter events (one catastrophe with multipleLargeClaims, one legislative with
developmentBiasOnly + futureRateTrendAdjustment, one poolWideEvent). Add a way to manually
trigger an event for testing before wiring the probability roll.
Stage 4.2: Add the annual probability roll using the existing deriveSubRng pattern, capped
at one event per year, odds hidden from the player.
Stage 4.3: Wire event headline/narrativeSummary into generateNarrative(), replacing the
current generic shock-loss sentence.
Test each stage before moving to the next.
```

---

### Phase 5 — Per-Claim Simulation

#### Stage 5.1 — Per-line frequency/severity + claim generation
- Add per-line `ClaimDistribution` (frequency + severity) to `defaultAssumptions.ts`.
- Replace each member's Gamma loss draw with: simulate claim count (Poisson, mean scaled by
  member exposure), then simulate severity per claim.
- **Recalibrate** so total expected losses match current baseline — this must not silently
  change game balance.

**Test:** Confirm aggregate loss statistics stay close to pre-refactor baseline levels across
many simulated years (same seed comparison where possible).

#### Stage 5.2 — Claim reporting structure
```ts
export interface ClaimSizeBucket {
  label: string;
  claimCount: number;
  totalIncurred: number;
  totalPaid: number;
}

export interface LargeClaim {
  id: string;
  memberId: string; // or a placeholder id/name for poolWideEvent claims
  memberName: string;
  incurred: number;
  paid: number;
  retainedAmount: number;
  cededAmount: number;
  uninsuredAmount: number;
}

export interface ClaimReport {
  coverageLine: CoverageLine;
  buckets: ClaimSizeBucket[];
  largeClaims: LargeClaim[];
}
```
- Build the two-table view (bucket summary + large claims list) per line per year.

**Test:** Confirm claims sort into the right buckets, and large claims show correct
retained/ceded math against whatever reinsurance exists at that point (aggregate-only until
Phase 6).

#### Stage 5.3 — Wire shock event manifestation types into claim generation
- `poolWideEvent` → one `LargeClaim` attributed to a placeholder ("Pool-Wide Event: [event
  headline]"), not a real member.
- `multipleLargeClaims` → several real members each get their own `LargeClaim`.
- `developmentBiasOnly` / `trendShiftOnly` → no claim generated, existing Phase 4 mechanics
  handle these.

**Test:** Trigger each manifestation type, confirm claims appear correctly attributed in the
large-claims table.

```
Phase 5 prompt (stage by stage):
Stage 5.1: Add per-line ClaimDistribution (frequency + severity) assumptions to
defaultAssumptions.ts. Replace the per-member Gamma loss draw with a Poisson claim count
(mean scaled by member exposure) + per-claim severity draw. Recalibrate parameters so
aggregate expected losses match current baseline levels — verify this explicitly.
Stage 5.2: Add ClaimSizeBucket, LargeClaim, and ClaimReport types from PHASES.md. Build the
two-table report (bucket summary + large claims list) per line per year.
Stage 5.3: Wire shock event ClaimManifestation types into claim generation: poolWideEvent
creates one placeholder-attributed LargeClaim, multipleLargeClaims spreads across several
real members. Test each stage independently.
```

---

### Phase 6 — Reinsurance Expansion

#### Stage 6.1 — Occurrence-based reinsurance structure
```ts
export type ReinsuranceBasis = 'aggregate' | 'occurrenceXoL' | 'combined';

export interface OccurrenceReinsuranceStructure {
  coverageLine: CoverageLine;
  basis: ReinsuranceBasis;
  retention: number;
  limit: number;
  premium: number;
}
```
- Per claim (from Phase 5): ceded = `min(max(0, severity - retention), limit)`.
- `combined` basis: apply occurrence first, then existing aggregate quota-share on the
  remainder.
- Add basis selector to per-line reinsurance decision.

**Test:** Confirm a large claim from Phase 5's large-claims table shows correct
retained/ceded/uncovered amounts under occurrence and combined bases.

#### Stage 6.2 — Experience-rated pricing
- Track trailing 2-year actual-to-expected loss ratio per line.
- `experienceModifier = clamp(1 + (trailing2YrRatio - 1) * sensitivityFactor, 0.85, 1.50)`
- `reinsuranceCost = baseCompetitivePressureCost * experienceModifier`

**Test:** Force a bad loss year (test fixture or a triggered shock), confirm next year's
reinsurance cost rises accordingly; confirm a good year lowers it, within the 0.85-1.50
bounds.

```
Phase 6 prompt (stage by stage):
Stage 6.1: Add OccurrenceReinsuranceStructure and ReinsuranceBasis types from PHASES.md.
For each claim, apply ceded = min(max(0, severity - retention), limit). Add a basis selector
per line (aggregate/occurrenceXoL/combined) where combined applies occurrence first, then
the existing aggregate quota-share on the remainder.
Stage 6.2: Add a 2-year trailing actual-to-expected loss ratio per line, converted into an
experience modifier (clamp 0.85-1.50) that multiplies the existing competitive-pressure-based
reinsurance cost. Test each stage independently before combining.
```

---

### Phase 7 — IRIS Reserve Indicators

#### Stage 7.1 — IRIS 11 and 12
- IRIS 11: one-year reserve development ÷ prior year-end surplus.
- IRIS 12: two-year reserve development ÷ surplus two years prior.
- Display pool-wide and per-line, with plain-language explanation, flagged "unusual" at
  roughly ±20% of surplus.

**Test:** Confirm ratios compute correctly against known development/surplus test fixtures.

#### Stage 7.2 — IRIS 13
- Indicated vs. carried reserve deficiency ÷ surplus, using Phase 3's carried-reserve data.

**Test:** Confirm ratio responds correctly to reserve strategy changes (e.g. switching to
Aggressive should move this ratio in the expected direction).

```
Phase 7 prompt:
Stage 7.1: Implement IRIS Ratio 11 (one-year reserve development / prior year-end surplus)
and IRIS Ratio 12 (two-year reserve development / surplus two years prior) using the
AccidentYearCohort data from Phase 3. Display pool-wide and per-line on Dashboard/Financials,
flagging values outside roughly +/-20% of surplus as unusual, with a plain-language
explanation.
Stage 7.2: Implement IRIS Ratio 13 (indicated vs. carried reserve deficiency / surplus)
using the carriedReserve vs indicated reserve data from Phase 3's reserve strategy decision.
Test each ratio against known fixtures before considering the stage done.
```

---

### Phase 4b — Event Library Page (later add-on, not blocking)
Once Phase 4 ships with narrative fields on every event, build a browsable page listing every
possible `ShockEvent` with its full write-up (`realWorldContext`, `typicalConsequences`),
optionally flagging which have fired in the current playthrough and when. Purely additive —
no other phase depends on this existing.

---

## Suggested Dependency Order

```
Phase 1 (all 6 stages, in order — this is the hard gate)
    │
    ├──> Phase 2 (cosmetic, can run anytime after 1.4)
    │
    └──> Phase 3 (reserve triangles)
              │
              ├──> Phase 7 (needs Phase 3's carried-vs-indicated data)
              │
              └──> Phase 4 (shock events — benefits from Phase 3's cohorts existing,
                   │         for developmentBias to have something to act on)
                   └──> Phase 5 (per-claim simulation)
                             └──> Phase 6 (occurrence reinsurance — needs claim-level data)
                                       └──> Phase 4b (event library, whenever convenient)
```

---

## Engine Inventory — Current vs. New

"Engine" here means a `src/utils/*.ts` module with real business logic in it (not UI
components, not pure data/config files like `defaultAssumptions.ts` or `memberCatalog.ts`,
though those grow substantially too — noted where relevant).

### Existing Engines (current build, pre-this-plan)

| Engine | Lines | Responsibility today |
|---|---|---|
| `simulationEngine.ts` | 730 | Core `processYear` — pricing, member loss simulation, reinsurance application, reserve development, orchestrates the whole year |
| `financialStatementEngine.ts` | 363 | Builds the balance sheet / income statement from a year's results |
| `instanceGenerator.ts` | 262 | Generates the deterministic game environment (loss environment, market) from a seed |
| `historyGenerator.ts` | 232 | Generates pre-game historical years for the Pool History page |
| `membershipEngine.ts` | 189 | Member join/withdraw movement each year |
| `investmentEngine.ts` | 160 | Investment income from the single `investmentRisk` slider |
| `narrativeEngine.ts` | 115 | Rule-based plain-language yearly summary |
| `random.ts` | 106 | Seeded RNG utilities (`deriveSubRng`, etc.) — foundational for every other engine's determinism |
| `reinsuranceEngine.ts` | 54 | Aggregate quota-share cost/recovery calculation |

**9 existing engines, ~2,272 lines of simulation logic today.**

### New / Substantially Rewritten Engines, by Phase

| Phase | Engine | Status | What it does |
|---|---|---|---|
| 1.2 | `simulationEngine.ts` | **Rewritten** | `processYear` becomes a thin per-line orchestrator; current body becomes `processLineYear` |
| 1.5 | `investmentEngine.ts` | **Rewritten** | Single risk slider → 3 asset classes (cash/bonds/equities) blended by allocation % |
| 1.6 | `interLineLoanEngine.ts` | **New** | Inter-line loan issuance, rate-at-origination, and skim-based repayment |
| 3.1 | `reserveDevelopmentEngine.ts` | **New** (split out of `simulationEngine.ts`) | Per-line accident-year triangles, replacing the flat-paydown logic currently embedded in `processReserveDevelopment` |
| 4.1–4.4 | `shockEventEngine.ts` | **New** | Event library, annual probability roll/selection, mechanical effect application (loss multiplier, development bias, trend shift) |
| 5.1–5.2 | `claimSimulationEngine.ts` | **New** | Per-line frequency/severity claim generation, size-bucket + large-claims report building |
| 6.1–6.2 | `reinsuranceEngine.ts` | **Rewritten** (expanded in place, same file) | Adds occurrence-basis math and the experience-rating pricing modifier alongside existing aggregate logic |
| 7.1–7.2 | `irisRatioEngine.ts` | **New** | IRIS 11/12/13 calculation from reserve development + surplus history |

**Net result of this plan: 4 new engine files, 3 substantially rewritten, 2 unchanged**
(`membershipEngine.ts`, `historyGenerator.ts`, `random.ts`, `formatters.ts` stay close to
as-is; `narrativeEngine.ts` gets extended in Stage 4.3 but keeps its current structure;
`financialStatementEngine.ts` and `instanceGenerator.ts` get touched to be per-line-aware
but aren't rebuilt).

**Data/config files that grow alongside these** (not engines, but worth tracking since
several new engines are only as good as the assumptions feeding them): `defaultAssumptions.ts`
gains per-line rate tables, `DevelopmentPattern`s, `ClaimDistribution`s, and the shock event
library's base data; `memberCatalog.ts`/`instanceGenerator.ts` gain per-line exposure
generation (GL payroll, Property TIV).

---

## Appendix — Future Multiplayer (not active work, captured for later)

Not part of this build. Noted so the design isn't lost:

- Single-player first, fully tested; multiplayer built as a derivative afterward, likely
  months out.
- **Host-configured**: host picks the shared seed, game length, and starting year — every
  player's game environment (loss environment, member catalog, market) derives
  deterministically from that seed, exactly like today's `generateGameInstance` already
  supports.
- **Player-configured**: each player picks their own pool name and which lines to write.
- **Comparison**: players' pools run in parallel and are ranked/compared side by side at the
  end (or per year) — not a shared single pool, not head-to-head market competition.
- **Shock events differ by mode**: single-player rolls events randomly (as speced above);
  multiplayer instead has the **host pre-select which events fire in which years**, applied
  identically across all players' games. This means the event *trigger* mechanism
  (random roll vs. host schedule) should stay cleanly separable from event *application*
  logic (impactByLine effects) — don't let the shock event engine assume randomness is the
  only way an event gets selected.
- Requires real infrastructure this codebase doesn't have yet: a backend, shared/synced game
  state, and likely a database instead of `localStorage`. Not a small addition — flag as its
  own project when the time comes, not a "Phase 8."
