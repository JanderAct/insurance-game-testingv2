# Later UI / Polish Refinements

A running list of interface and polish improvements to revisit **after** the core mechanics are
built and playable. None of these are blocking — they're deliberate "come back to it" items so
they don't get lost or pull focus from the engine work. Nothing here changes game math.

---

## 1. Investment allocation — single-bar, two-dot widget (FINALIZED SPEC, ready to build)
**Status:** ready to build. Per line.

**What it replaces:** the current separate controls for entering the three allocation
percentages (cash / bonds / equities) on each line's decision tab.

**The design:** one horizontal bar representing 100% of the portfolio, with **two draggable blue
dots** on it. The two dots split the bar into three segments:
- Left segment (start → dot 1) = **cash**
- Middle segment (dot 1 → dot 2) = **bonds**
- Right segment (dot 2 → end) = **equities**

Dragging a dot moves that boundary and changes the percentages. Because it's one bar split into
three, the segments always sum to 100% by construction — an invalid allocation is impossible.

**Behaviors (finalized):**
- **Dots stop at each other** — a segment can shrink to 0% but the dots cannot cross/invert
  (bonds can hit 0% if the two dots meet, but can't go negative).
- **Labels above the bar, one row:** "Cash / Bonds / Equities" with their percentages, all in a
  single row above the bar. The **percentages update live** as you drag a dot.
- **Per line** — appears on each line's decision tab (WC / GL / Property), controls that line's
  own allocation. Not a pool-level control.
- **Snapping:** default to whole percentages (clean; no 17.3% values) unless user prefers 5%
  increments — CONFIRM before building if it matters.

**Default position:** each line defaults to 10% cash / 80% bonds / 10% equities (dot 1 at the 10%
mark, dot 2 at the 90% mark).

**Note:** the underlying engine model is unchanged — it still reads cashPct / bondsPct /
equitiesPct per line. This is purely how the player *inputs* those three numbers. No engine/
calculation impact; pure display/input change.

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
**Status:** deferred (identified by Claude Code during the Year 1 initialization fix). Display
only — confirmed harmless to the surplus tie-out and all live calculations.

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

---

## 6. Curated / predefined scenario seeds (planned feature — later, near multiplayer)
**Status:** planned, no action yet. Best built AFTER the major mechanics (Phases 3-5:
reserves, shock events, per-claim) and alongside the multiplayer/host-authored work — because
a seed's produced "scenario" changes as new mechanics consume RNG, so curating earlier means
re-curating later.

**Primary usage model driving this (important context for future design):** the game is mainly
intended for **instructor/host-assigned play to a group** — an instructor assigns a scenario,
the whole group plays the identical starting conditions, then outcomes are compared. Solo play
is also supported as a secondary mode.

**What the feature is:** a curated menu of labeled starting scenarios (e.g. "Steady State,"
"Hard Market," "Early Catastrophe") instead of raw random seed strings. Each is a vetted seed
whose produced situation is known and described. Turns the seed from a random technical artifact
into a pedagogical/host choice.

**Why it matters here:** instructor-assigned group play REQUIRES curated, labeled, reproducible
scenarios — an instructor can't assign "play this instructive situation" if seeds are random and
unlabeled. This is close to a core requirement for the primary usage model, not just polish.

**Connection:** this is essentially the same feature as the host-picks-the-scenario piece of the
planned multiplayer/host-authored-events work — build them together.

**Cost note:** the code to *use* a predefined seed is trivial; the real work is *curation*
(playing candidate seeds, observing, labeling the instructive ones). That curation should happen
once the mechanics are stable, so the labeled scenarios don't drift.

---

## 7. Spell out coverage-line names (don't abbreviate)
**Status:** ready to build. Display-only, no engine impact.

**The change:** show the full line names — **Workers' Compensation**, **General Liability**,
**Property** — instead of the abbreviations WC / GL / PR, so users (esp. students) don't have to
know what the abbreviations mean.

**Where:**
- **Page headers and labels** (e.g. "Year 4 Decisions — WC" → "Year 4 Decisions — Workers'
  Compensation") — full names.
- **Line-selector tabs** (Pool / WC / GL / Property on Dashboard, Decisions, Financials, Results,
  Decision History) — use full names where they fit; keep compact (WC/GL) ONLY if the tab row
  would get too cramped. Builder's judgment on layout/width; full names preferred where they fit.
- **Export .xlsx tab names** — keep the SHORT codes (Pool / WC / GL / PR). On worksheet tabs the
  codes are just compact navigation labels and brevity is easier to scan; full names aren't needed
  here. (Full names live in the app UI where clarity matters; the export tabs stay short.)

**Consistency:** apply everywhere the line is named in user-facing text — headers, labels,
tooltips, Decision History, comparison views. Abbreviations should not appear in user-facing text.

**Internal keys — DO NOT touch (this item is display text only):** the internal code keys / enum
values / RNG labels currently mix styles (WC, GL, Property). Leave them exactly as-is for this
change. Renaming them — especially "Property" inside RNG labels like invest_Property /
enroll_Property — would change deriveSubRng inputs and SHIFT ALL BASELINES, so it's out of scope
for a cosmetic UI change. If internal keys are ever made consistent (a separate deliberate
change), the chosen direction is all-abbreviated (WC/GL/PR), done carefully to preserve or
knowingly re-baseline the seed labels.

---

## 8. Remove orange developer explainer notes (and any internal "Stage X.X" references)
**Status:** ready to build. Display-only, no engine impact.

**The issue:** several screens show an orange explainer note describing internal mechanics — e.g.
on the Dashboard: "Showing the Workers' Compensation line's own figures — including its own
simulated pre-game history (Stage 2.10)." These were build-time scaffolding; they're clutter to a
player and reference internal build-stage numbers a player has no context for.

**The change:**
- Remove these orange explainer notes wherever they appear (Dashboard, Financial Statements, Pool
  History, and any other screen carrying them).
- More broadly: **no user-facing text should reference internal "Stage X.X" numbers** (e.g.
  "(Stage 2.10)", "(Stage 2.9)"). Remove/rewrite any such references anywhere in the UI. Internal
  stage numbers are a build concept, not player-facing.
- If a screen genuinely needs a short player-facing explanation of what it's showing, it can keep
  a clean plain-English line — but without the stage reference and without the debug-note styling.
  Default is to just remove them unless the note is genuinely helpful to a player.

**Scope:** sweep the whole UI for these notes and stage-number references, not just the Dashboard
instance. Display text only; no logic changes.

---

## 9. Roll large dollar figures up to billions (B) at $1B+
**Status:** ready to build. Display-only, no engine impact.

**The issue:** large figures display in millions even past $1,000M, giving hard-to-read values
like "$4177.95M" for TIV Exposure — the eye has to count digits to see it's ~$4 billion.

**The change:**
- When a dollar figure is **$1B or greater, display it in billions with a "B" suffix, 2 decimals**
  — e.g. "$4177.95M" → "$4.18B".
- Below $1B, leave formatting as-is (existing millions "M" formatting, unchanged — no K rollup, no
  other threshold changes). This is specifically adding the B rollup at the top end, not a full
  reformat.
- 2 decimals for the billions display ($4.18B, not $4.178B).

**Scope:** fix TIV Exposure (the observed case) PLUS any other figures that can cross $1B — e.g.
total invested assets, pool-wide exposure, cumulative multi-year figures. Not a full app-wide
formatter rewrite; just ensure the billion-crossing figures roll up correctly. Check the larger
figures now that Property is resized (bigger TIV) and all three lines are substantial.

**Note:** display formatting only — underlying values and calculations unchanged.

---

## 10. Remove the "Change:" line under Surplus Tie-Out Difference
**Status:** ready to build. Display-only, no engine impact.

**The issue:** the Surplus Tie-Out Difference figure shows a year-over-year "Change:" line beneath
it. The tie-out difference is a pass/fail reconciliation check that should always be ~0 — a
year-over-year change on it is meaningless (change between zero and zero is noise) and could look
alarming if it ever displayed a tiny non-zero delta.

**The change:** remove the "Change:" line specifically under the Surplus Tie-Out Difference,
wherever it appears (Financial Statements and any other screen showing the tie-out with a Change
line). Keep the tie-out difference figure itself; just drop its Change line.

**Scope:** all screens where the tie-out difference shows a Change line, not just Financial
Statements. Display only.

---

## 11. Property exposure row: label "Written TIV" with magnitude-aware units
**Status:** ready to build. Display-only, no engine impact.

**The issue:** on the Property line's results, the exposure row is labeled "Written Payroll ($M)"
— a leftover from Property reusing the WC/GL exposure label. Property's exposure base is TIV
(Total Insured Value), not payroll, and its values are large (often billions).

**The change:**
- Relabel the Property exposure row to **"Written TIV"** (drop the hardcoded "($M)" unit).
- Format its value with the **same magnitude-aware rollup as item 9** — show billions with "B"
  at $1B+ (2 decimals, e.g. "$4.18B"), millions with "M" below that (e.g. "$847M"). The unit is
  inline with the value, not hardcoded in the label.
- **Property line only.** WC and GL correctly use payroll — leave their "Written Payroll" label
  as-is. This fix is specifically the Property exposure row that was mislabeled.

**Scope:** wherever Property's exposure row appears (results, financial statements, comparison
views, etc.), it should read "Written TIV" with magnitude-aware units. Display only; underlying
values unchanged.

---

## 12. Tighten opening-condition parameters (reduce starting volatility) — SOON
**Status:** planned, do soon (helps every game). Part 1 of a two-part plan with the curated seeds
(#6). NOT yet built.

**The problem observed in play-testing:** the pool's Year-0 opening condition is too volatile
across seeds. Early on, some seeds started in the red (negative/deficient); now (post per-line
capital + compounding pre-game histories) openings drift too strong — three sample games opened at
~$34M / ~$37M / ~$46M ending surplus, all "Strong." The opening is an emergent byproduct of
(per-line K×premium capital) × (3 compounding pre-game years) with only a one-sided floor
(reject-and-redraw to Adequate) — no target, no ceiling — so it swings from red to over-strong
depending on the seed.

**The fix (tighten the transformation, not the seed space):** the seed space itself is huge
(~2.8 trillion if 8 alphanumeric chars) — that's not the issue. The issue is how a seed becomes a
starting condition. Options to combine:
- **Lower / steady the per-line bootstrap capital** (the K values) and/or reduce pre-game
  compounding so openings land in a sensible DESIGNED range rather than drifting rich.
- **Two-sided target-band acceptance** in the reject-and-redraw: accept only if the opening lands
  within a target band (not just "≥ Adequate" but "Adequate-to-reasonable, not over-strong"),
  redraw otherwise. Gives a controlled, consistent starting range.
- Keep it deterministic (same seed → same result) and keep the existing floor as a safety net.

**Goal:** procedural generation reliably lands in a sensible opening range — no red starts, no
absurdly-strong starts — so EVERY game (including secondary solo/free-play with random seeds)
starts sensibly. This also makes curating the 100 seeds (#6) easy, since most seeds will land well.

**Design question still open:** what exactly IS the target opening range / condition? (Always
Adequate-but-not-cushy? A defined surplus band? Deliberately varied?) Decide the target before
building. Baseline-shifting when done.

## Update to #6 (curated scenario seeds) — layered plan
The 100 curated seeds (#6) now sit ON TOP of #12: first tighten parameters so the engine is
well-behaved, THEN curate 100 known-good seeds from that stable pool (after the major mechanics —
loss-distribution rework, Phase 3 reserves — are done, so the curated scenarios don't go stale).
The 100 seeds are a vetted selection from a well-behaved engine, not a mask over a volatile one.
