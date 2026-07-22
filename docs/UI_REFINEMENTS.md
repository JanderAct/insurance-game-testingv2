# Later UI / Polish Refinements

A running list of interface and polish improvements to revisit **after** the core mechanics are
built and playable. None of these are blocking — they're deliberate "come back to it" items so
they don't get lost or pull focus from the engine work. Nothing here changes game math.

---

## 1. Investment allocation — single-bar, two-divider widget
**Status:** deferred (raised during Stage 1.5). Do NOT build now.

**What it replaces:** whatever basic controls Stage 1.5 puts in for entering the three
allocation percentages (cash / bonds / equities).

**The design:** one horizontal bar (rendered as a rectangle — dimensions TBD, user will provide)
with **two draggable dividers**. The dividers split the bar into three segments:
- Everything left of divider 1 = **cash**
- The middle band between the two dividers = **bonds** (automatically the leftover)
- Everything right of divider 2 = **equities**

Because bonds is always "the middle leftover," the three segments always sum to 100% by
construction — an invalid allocation is physically impossible to enter. This is the main reason
to prefer it over three independent sliders (which can sum to something other than 100 and need
validation/normalization).

**Default position:** 15% cash / 65% bonds / 20% equities. In divider terms: divider 1 sits at
the 15% mark, divider 2 sits at the 80% mark (since cash + bonds = 15 + 65 = 80), leaving the
20% equities band on the right.

**Note:** the underlying engine model is unchanged — it still just reads cashPct / bondsPct /
equitiesPct. This is purely how the player *inputs* those three numbers. Rectangle dimensions to
be provided by user before building.

---

*(Add further deferred UI/polish items below as they come up.)*

---

## 2. Change default asset allocation to 10 / 80 / 10
**Status:** deferred (raised after Stage 1.5). Tunable value change, not a mechanic change.

**Change:** the game's default asset allocation should be **Cash 10% / Bonds 80% / Equities 10%**,
replacing the current Stage 1.5 default of 20 / 50 / 30.

**Why:** real public-entity risk pools invest conservatively and bond-heavy — they steward
public money against medium-duration, fairly predictable liabilities (especially WC's long tail)
with low risk tolerance. Reference point: the user's actual captive runs 5% liquid / 85% bonds /
10% equity. 10/80/10 rounds that to a clean "typical pool" default. The old 20/50/30 was closer
to a commercial insurer / endowment posture — more equity risk than a real pool would take.

**Effect on gameplay:** starting a new game in a realistic conservative posture means taking on
more equity becomes a deliberate player *choice*, not the default starting point. Note this will
change the baseline investment numbers again when implemented (lower expected return, much lower
volatility than the current 20/50/30 default) — re-baseline after changing.

**Still open — asset-class return/volatility calibration:** the return and volatility assumptions
assigned to each asset class (cash/bonds/equities) should eventually be calibrated to realistic
figures so the allocation decision teaches correctly. Options not yet chosen: (a) pull real
return/volatility experience from the captive, or (b) use industry-standard institutional
assumptions. Revisit when doing this refinement.

---

## 3. Descriptive filename for the Results spreadsheet export
**Status:** SUPERSEDED by build-plan Stage 2.8 (multi-line .xlsx export), which now owns the
filename convention (the pattern is unchanged but the extension becomes .xlsx). Handle there.
Kept below for reference.

**Current behavior:** the results spreadsheet exports with a generic name (e.g.
`source-game-year-results-vertical.csv`).

**Desired filename pattern:** `SEED_{seed}_{lines}_YR{currentYear}`
- `{seed}` — the game's seed/instance ID (e.g. MAMC6EA4)
- `{lines}` — the active coverage lines, joined with underscores, in fixed order **WC, GL, PR**
  (Property abbreviated as **PR**)
- `{currentYear}` — the current/latest year number only (e.g. YR3), NOT a range

**Examples:**
- WC only, after year 3 → `SEED_MAMC6EA4_WC_YR3`
- WC + GL, after year 2 → `SEED_MAMC6EA4_WC_GL_YR2`
- All three lines, after year 5 → `SEED_MAMC6EA4_WC_GL_PR_YR5`

**Important:** the filename tags only the latest year, but the file CONTENTS still include every
played year (Y1 through current), exactly as they do today. This is a naming change only — do not
change what data the export contains.

---

## 4. Pool History opening figures are WC-scaled regardless of active lines
**Status:** RESOLVED by build-plan Stage 2.10 (per-line prior histories). The synthetic
WC-scaled history generator was deleted entirely; each line now simulates its own real 3-year
pre-game past through the engine, and the Pool History page gained the Pool/per-line view tabs
showing each line's own history (Dashboard's pre-game rows and Financial Statements' History/
Opening entries are real per-line results too). Kept below for reference.

**The issue:** `startingFinancials` — the opening position shown on the Pool History page (the
pre-game historical years + Year 0 opening figures) — is still computed as if the pool is
WC-sized, no matter which coverage lines are actually active. So a GL-only game's Pool History
displays WC-sized opening figures rather than GL-appropriate ones.

**Why it's deferred, not fixed now:** it's a pre-existing display-layer issue on the history view,
outside the tie-out path, and touches none of the live surplus/reserve math. Folding it into the
initialization bug fix would have scope-crept a surgical correctness fix into the history display
logic. Handle it as part of a dedicated multi-line display polish pass.

**Related:** this is the same WC-centric Pool History concern flagged early in planning — the page
was originally built for a single (WC) line and needs a general pass for multi-line presentation.
When polishing, review the whole Pool History page for multi-line correctness, not just
`startingFinancials`.

---

## 5. Suppress misleading % change on small/volatile metrics (Results year comparison)
**Status:** deferred to the batched UI pass. Display only — the underlying numbers are correct;
this only changes whether a % change is shown for certain rows.

**The issue:** the Stage 2.3 individual-year comparison shows a "% Change" column for every
metric. For metrics with a small or volatile base, the percentage exaggerates trivial moves — e.g.
a $10K rise in investment income shows as +54.8% (the largest % on the board), while a far more
material $97K rise in ultimate losses shows as only +15.3%. The eye gets pulled to the least
material change. The % is mathematically correct but rhetorically misleading when base sizes differ
a lot.

**The fix (fixed per-metric rule — Option 1):** keep the % change only for large, stable-base
metrics where it's meaningful; show an em-dash (—) instead for small/volatile ones.
- **Show % change:** premium, ultimate losses, net losses, reserves, ending surplus.
- **Show — (no %):** net income, investment income, and reinsurance recovery (always, not just
  when zero).
- **Leave unchanged:** loss ratio and combined ratio already show percentage-*point* deltas
  (e.g. "+7.1 pts"), which is correct — do not convert those to % change.
- The **$ change** column stays for ALL metrics — only the % column is suppressed for the
  small/volatile set.

**Why fixed-per-metric and not a dynamic threshold:** predictability. A metric should always
behave the same way so players learn to read it; a dynamic base-size threshold would make the same
metric show % one year and — the next, which confuses more than it helps.

**Note:** the $ change coloring/polarity from Stage 2.3 stays as-is (good-when-up: investment
income, net income, ending surplus; good-when-down: losses/ratios; neutral: premium, reserves,
reinsurance recovery). This item only touches the % column's presence, not the $ column or its
colors.
