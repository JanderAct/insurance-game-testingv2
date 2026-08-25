# Baseline Lineage — v4 through v17

A genealogy of the multi-line baselines: what each version represents, what change caused the jump
to it, which numbers moved and why. Covers the multi-line-meaningful baselines (v4–v11). Earlier
v1–v3 were single-line / pre-multi-line refactor and are not covered here.

**Important reading note:** these baselines are NOT a smooth numeric trend. Each version reflects
a *different set of mechanics*, so the same seed (`MAMC6EA4`) produces a different game at each
version. Number movements below are explained by the mechanic change, not by any drift in a fixed
model. Compare a baseline only against its *own* version, never treat v5→v6→v7 as a progression of
the "same" number.

---

## v4 — First correct multi-line baseline
**Trigger:** the Year-1 balance-sheet initialization fix.
**What was wrong before:** GL and Property started Year 1 with negative surplus and a Year-1
tie-out gap (≈$10.95M, equal to SHARED_NET), because non-WC lines stored a reserves-only starting
surplus inconsistent with their opening balance sheet.
**The fix:** redistribute the pool's opening surplus across active lines by net-reserve weight, so
each line's stored surplus matches its opening balance sheet.
**Numbers that moved:** GL/Property Year-1 opening surplus corrected (GL Y1 begin went from
−$1.68M to +$9.28M). WC unaffected.
**WC status:** byte-identical to v3.
**Role:** first baseline where all configs tie out; the foundation multi-line reference.

---

## v5 — Per-line segregated investments + xlsx export
**Trigger:** Stage 2.9 (per-line investments) and Stage 2.8 (multi-tab xlsx export).
**What changed:** investments went from one shared/commingled pool portfolio to per-line
portfolios — each line invests its own assets with its own cash/bonds/equities allocation and keeps
its own gains/losses. Inter-line loan rate became the pool's asset-weighted blended return.
**Numbers that moved:** investment income and anything downstream of it (surplus, capital ratios)
for the multi-line configs, because each line now earned on its own portfolio rather than a share
of a pooled one.
**WC status:** byte-identical to v4/v3 (with one line, segregated and shared portfolios are
mathematically the same).
**Role:** the defaults anchor after investments went per-line.

---

## v6 — Per-line decision editing (divergent-decisions anchor)
**Trigger:** Stage 2.7 (per-line decision editing, Model A strict per-line).
**What changed:** GL and Property decisions became independently editable (previously only WC's
inputs were editable). v6 was captured with DIVERGENT per-line decisions (e.g. GL rate +10%,
Property equity-heavy, WC default) to anchor per-line-decision behavior specifically.
**Numbers that moved:** whatever the divergent decisions drove — GL premium up from its rate
change, Property investment returns swinging from its equity-heavy allocation, etc. This was a
deliberately non-default run.
**WC status:** byte-identical to v5 (making GL/PR editable didn't disturb WC; leaving decisions at
default reproduced v5).
**Role:** the "did per-line decision handling break" anchor. Exercises divergent decisions, unlike
the defaults-only v5.

---

## v7 — Per-line independence complete
**Trigger:** the `seed-fix-per-line-opening` branch — several changes at once:
- Per-line opening capital (each line brings its own, sized K × its premium; K = WC 1.0 / GL 0.7 /
  Property 0.9), replacing the shared-pot net-reserve split.
- Per-line adequacy redraw (each line redraws on its own seed).
- Shared-market investment returns (one asset-class draw per year, shared; each line blends by its
  own allocation — fixes the bug where identical allocations gave different/opposite returns).
- GL resized ~5× (premium ~$8-9M, loss ratio unchanged).
- Property resized ~7× (premium ~$6-7M) — carried in from just before the branch.
- Per-line prior histories (Stage 2.10) feeding each line's Year-1 opening.
**What changed:** essentially every number, for every config — because opening capital, investment
draws, and two lines' sizes all changed.
**WC status:** **v7 is the FIRST version where even WC-only shifts.** From v3 through v6, WC-only
was byte-identical — a stable bedrock signalling the refactors were clean. At v7, per-line opening
capital changed WC's own opening position, so WC-only moves too. This deliberately ends the
"WC is the unchanging anchor" era.
**Config-independence:** now a proven property — WC byte-identical across WC-only / WC+GL / 3-line
(through Y2 strictly; a documented ≤1-member flip in WC+GL at Y3 from the retained shared-cash
coupling). GL identical between WC+GL and 3-line.
**Role:** the current reference. All three lines are now substantial and comparably sized
(WC ~$7-8M, GL ~$8-9M, Property ~$6-7M), genuinely independent, config-independent.

---

---

## v8 — New investment model + opening bands + pool-wide decisions
**Trigger:** the `investment-and-opening-tuning` branch (merged at `99c66b7`) — four changes:
- **New investment parameters + fees.** Cash 4.19%/0.40%, Bonds 5.20%/4.04%, Equity 8.26%/18.25%
  (gross), with per-class fees (0.040%/0.124%/0.124%) subtracted after each draw. Means and
  volatilities all rose — the 10/80/10 blend went from ~3.75% to 5.275% net, portfolio SD roughly
  doubled to 3.713%.
- **Single-regime draws.** The two-regime (normal + Bernoulli downside) mixture was removed; the
  new parameters are whole-period historical figures that already contain crash years. Market
  crashes move to the Phase 4 shock-event system. Clamps widened to inert sanity rails.
- **Opening capital retuned with per-line bands.** Opening surplus is now held to a band expressed
  as a multiple of each line's own Required Reserve Margin, via a two-sided per-line
  reject-and-redraw: WC and GL 1.35–2.0×, **Property 2.0–3.0×** (its short-tail reserve margin is
  structurally small, so the same multiple means something different for it). K retuned to
  WC 0.70 / GL 0.45 / Property 0.18.
- **Pool-wide allocation and risk control.** Both moved from per-line to pool-level decisions;
  lines still own their assets separately and apply the pool percentage to their own base. The
  Pool tab returned to the decision pages. Implemented by projection — verified byte-identical at
  defaults, so this piece alone moved nothing.

**What changed:** essentially every number, driven by the investment model and the opening retune.
The pool-wide restructure contributed zero drift by construction.

**WC status:** shifts again (as at v7) — opening capital and investment returns both changed.

**Notable side effect:** GL's premium rose from ~$8–9M to ~$12.9–14.5M. The band controls the
capital *ratio*, not line *size* — the multiple is roughly scale-invariant, so a redraw that fixes
the ratio can re-roll the rate draw and land on a much larger book. GL's rate range is wide
($7.50–15.00 per $100), making it the most visible case. Logged as a calibration item.

**Config-independence:** openings are identical across configs. The live-year shared-cash residual
grew with the larger numbers — non-flip drift ≤0.184% (was ~0.03%), and the first divergence year
moved from Y3-only to occasionally Y2 (1 of 24 config-pairs). On seed MAMC6EA4 specifically, the
3-line config shows a Y2 one-member flip that is baked into the v8 reference — expected, not a
regression.

---

## Two display-only changes landed between v8 and v9 (no baseline needed)
Both were verified byte-identical against the then-current baselines, so neither generated a version:
- **GASB-style income statement** (`a91fb27`) — the Income Statement became a "Statement of Revenues,
  Expenses & Changes in Net Position." Pass-throughs shown gross, claims split into current-year /
  reinsurance recoveries / prior-year with no plug line. 54 statements verified to float epsilon.
- **ACFR-style balance sheet** (`d67fab5`) — the Ending Balance Sheet became a "Statement of Net
  Position" with current/noncurrent sections. Current/noncurrent liability split derived from each
  line's existing paydown rate (WC/GL 35% current, Property 65%), so long-tail vs short-tail is
  visible on the balance sheet. 162 statements verified.

---

## v9 — Reinsurance recoverable removed (net-basis reserves)
**Trigger:** the recoverable concept was removed entirely — Variant A, net presentation. Reserve
cohorts now carry NET unpaid loss; losses enter net; development and paydown run on net. The
receivable was a "constant-ratio shadow" of the gross reserve — recovery cash already arrived in
lockstep with the claim payments it offset — so removing it was economically neutral.

**Bootstrap subtlety worth remembering:** the recoverable draws were *retained* (values discarded)
specifically to preserve RNG stream position. Deleting them would have shifted every subsequent
draw and re-rolled every seed's opening position, which would have made the change unverifiable.
The retained draws carry explanatory comments.

**What changed:** almost nothing in value. 160 of 162 scopes bit-identical. One divergence —
ZZTEST99, 3-line, Y3 Property — from the accepted cohort-closure effect (the sub-$1,000 test now
runs on net rather than gross unpaid, so a cohort closed a year earlier). Max |Δsurplus| $51,836
(0.289%). **On MAMC6EA4 every figure matched v8 to the dollar.**

**Why a new version was needed anyway:** export *shape* changed — the Beginning/Ending RI
Recoverable rows disappeared and reserve rows were relabelled net.

**Incidental fix of lasting value:** the first v9 capture came out corrupt (all reserve rows NAN)
because the baseline generator held its own hardcoded copy of the ~590-line result metric list. That
copy had already drifted once before (the 2025/2026 calendar-year mismatch). It was extracted to
`src/utils/resultMetrics.ts` as `RESULT_METRICS`, imported by both the app and the generator —
eliminating a recurring bug class and making generated baselines provably the same shape as app
exports. **Note `e94387e` is a bad commit in history; `8693655` is the good v9.**

---

## v10 — otherAssets / otherLiabilities removed
**Trigger:** both were vestigial bootstrap constants — drawn once, frozen forever ($693,194 and
$733,460 pool-wide, identical in every year of every game), re-split among lines by contribution
share but never actually changing. They represented nothing. Same RNG-preservation trick as v9:
draws retained, values discarded, comments explaining why.

**How the arithmetic actually worked (counterintuitive):** invested assets are the balance-sheet
*plug* against a surplus pinned at K × premium, so removing the two terms did NOT raise net position
by their difference. Instead invested assets shifted by (otherAssets − otherLiabilities), and **both
balance-sheet sides dropped by the former otherLiabilities** while bootstrap surplus stayed exactly
where the capital spec puts it.

**What changed:** zero roster, loss, or premium divergences — underwriting untouched everywhere. The
only moving figure is surplus, via investment income on the shifted invested base, compounding
through pre-game and live years. Max |Δsurplus| $160,323 (0.50%) on a Y3 pool figure. **Zero seeds
re-rolled** — all 69 solo pre-games kept their exact accepted attempt number, largest opening-multiple
shift 0.03×, everything still in band. So v9→v10 is uniformly small-drift with no "different game"
seeds. Opening multiples: WC 1.73× / GL 1.65× / Property 2.56×.

**The significant outcome — money-side config coupling eliminated.** Max no-flip cross-config
surplus drift went **0.184% → 0.0000%**, and by algebraic identity rather than tuning. Each line's
balance sheet gives `cash_L = surplus_L + netReserve_L − invested_L`, which *is* the
contribution-share weight formula — so with cash as the only shared pot the weight equals each
line's cash slice exactly, and the weights sum to pool cash automatically. Previously one share
vector had to split three pots and could only reproduce the *net*, distorting each line's cash
slice specifically; cash earns returns, so the error leaked into investment income as cross-config
drift. Remaining divergence is roster-fold only (Y2 flip on 1 of 24 config-pairs, Y3 on 3 of 24) —
a member withdrawing from one line altering another's recruitment pool, not a financial mechanism.

**Consequence for the backlog:** full per-line cash segregation is no longer needed. It was the
eventual lever for a financial-integrity concern that no longer exists.

---

## v11 — Self-funded discount removed
**Trigger:** the self-funded discount was removed. It was economically backwards (retaining more risk gave
members a *rebate*, when retained risk should demand more margin), invisible to members (satisfaction reads
pre-discount premium, so no behavioural response), and misleadingly named — it was a retained-risk rebate at
every level except Full Transfer, computed as `(1 − recoveryPct) × 4% × poolPremium`.

**What changed:** `totalMemberCharge` rose by exactly the former discount — 1.0% of pool premium at the
default level 2 (~$272K/yr pool-wide, growing to ~$301K by Y3), flowing to underwriting income, net income,
and surplus, plus a slightly higher operating-cash target. Loss and expense ratios ticked *down* slightly
(denominator grew ~1%). Satisfaction unaffected (confirmed — membershipEngine never sees
`totalMemberCharge`). CLF/indication chain unaffected (all pre-discount). No RNG draws involved.

**⚠️ Nine seed-lines re-rolled — including the reference seed's GL.** Premium rising ~1% raised the
K × premium capital target, shifting opening multiples enough to flip which pre-game attempt passed the band
test on **9 of 72 seed-lines**. MAMC6EA4 GL went from **attempt 8 to attempt 4**, landing at 1.358× (barely
inside the 1.35 floor). So **v10→v11 is NOT uniformly small-drift: GL on the reference seed is a materially
different game.** WC and Property are small-drift. This is finding 8 (the redraw's chaotic sensitivity) in
action, not a fault in the removal.

---

## v12 — not separately narrated here
Recaptured by six engine commits (23da65c through a21d01b: GL's fitted-mixture severity rebuild, k_GL
neutralised, GL severity trend + payroll growth, the $100M severity cap, GL's own CLF grid, and the
"Expected" funding option on both WC and GL) plus a gate-inert UI squash-merge (8c0ae6f). Full detail
lives in the v12 notes inside `scripts/diagnostics/solo-export-guard.ts` and `value-identity-check.ts`
rather than here — this file's per-version narrative resumed at v13; the gap is a documentation omission
at recapture time, not a missing baseline. PR-solo 0/3,210 moved throughout.

## v13 — reinsurance tower priced at runtime, both lines
**Trigger:** the tower's `expectedCededPer100`/`sdOverExpected` were frozen per-layer constants measured
from the generators. `sdOverExpected` was never a legitimate rate-card quantity — SD/E scales as
~1/sqrt(exposure), so a single stored value was wrong at every book size but the one it was measured on
(an $82M GL pool undercharged ~20%, the full market overcharged ~25%, on different bases per line: GL's
figure came from a ~$380M enrolled book, WC's from full market). `expectedCededPer100` froze legitimately
(a per-occurrence layer is genuinely linear in exposure) but was multiplied by NOMINAL exposure, so
premium grew at the wage rate while actual ceded loss grew with the severity trend through a convex layer
(GL +22–41% by layer, WC +17% on its top layer, over a decade). The WC aggregate had a second, independent
defect: its occurrence frequency read nominal exposure where the true count tracks real payroll x
wcFrequencyTrend — a basis error, not a staleness one, that no re-measurement of the frozen table would
have caught.

**What changed:** one commit, f5ece4d. Six frozen constants retired (`expectedCededPer100`,
`sdOverExpected`, `AGG_OCC_FREQ_PER_1M`, `AGG_OVERDISPERSION`, `WC_RETAINED_SECOND_MOMENT` and its bitmask
index); `src/utils/towerMoments.ts` added, computing E[ceded]/SD[ceded] for both lines from the enrolled
book and the current year, at neutral risk quality (the same basis the retired constants used — this is a
pricing-basis change, not a risk-quality-mix change). A PRICING-BASIS change, not a loss-model change: no
claim generator, severity, frequency or roster parameter moved, so every field that changed did so through
the `reinsuranceCost` -> `totalMemberCharge` -> premium/reserve/membership cascade. 16,140 -> 16,140
fields, 0 added, 0 removed (the six retired constants were internal, never themselves exported fields).
3,820 of 16,140 changed across 71 names — WC-solo 953/3,225, GL-solo 1,146/3,240, tri 1,721/6,465, **PR-solo
0/3,210** (Property runs the legacy `REINSURANCE_PROGRAMS` path and was not reached — the leak check for
this recapture, and it held).

---

## v14 — eight commits: membership/pricing rework, net funding, static CLF tables, IBNR removed, opening decoupled
**Trigger:** no single mechanism. Eight commits landed between v13 and this recapture, spanning three
mostly-independent threads: membership/pricing (shared across all three lines), the funding basis and CLF
grids (WC/GL only), and the pre-game opening band (all three lines again, on a different axis).

**The eight, in order, and who they touch:**
- `875cb75` memoize five pure-function-of-year trends — caching only, confirmed inert (PR-solo
  byte-identical; WC/GL-solo unaffected in effect, only in call count).
- `fdc747c` scale member joins with the remaining marketplace (`expectedNewMembers = k x (roster -
  enrolled)`, replacing a flat constant with exactly one equilibrium for every line regardless of book
  size) — shared machinery, **all three lines move**.
- `bdc98ec` reconnect the price channel to membership (rate CHANGE -> retention/satisfaction, rate LEVEL
  -> new business) — shared machinery, **all three lines move**.
- `fab85e4` fund the pool premium net of expected ceded, fixing a double-collection of the ceded portion —
  WC/GL only (Property's legacy aggregate has no closed-form expected ceded and is explicitly not netted).
- `f328d65` replace the CLF grids with one static table per line, backtested on the engine itself rather
  than a separate model of it — WC/GL only.
- `3d3fbcc` install a supplied real-pool CLF table for GL in place of its own derived one — GL only.
- `962ef60` remove WC's report lag and IBNR, replacing calendar-year reported loss with accident-year —
  WC only.
- `a3d7760` decouple the pre-game opening band from the Required Reserve Margin, testing the accepted
  opening against premium instead — **all three lines move**, on a different axis than fdc747c/bdc98ec
  (the acceptance test, not the join/retention ladders).

**PR-solo checked per commit, not just at the endpoints** — the v13 pattern (Property untouched until
one clearly-marked commit) does NOT hold here, and assuming it would have been wrong. Re-running
`solo-export-guard.ts` at every intermediate commit: `fdc747c` and `bdc98ec` each move PR-solo on all
three seeds (both commits' own messages call this out — "no line is an untouched control... PR-solo will
NOT hold"); `875cb75`, `fab85e4`, `f328d65`, `3d3fbcc` and `962ef60` leave PR-solo byte-identical; `a3d7760`
moves PR-solo on 2 of 3 seeds — the third (`6KA6WGLJ`) happened to accept the same pre-game attempt under
both the old margin-basis and the new premium-basis band, so its history is genuinely unchanged rather
than a leak that got lucky. **Property moves at two points in this chain** (the membership/pricing pair,
and the opening-band commit), each for a documented shared-machinery reason — confirmed by measurement,
not assumed from any single commit's message.

**Shape moved for the first time since v8/v9:** `962ef60` deletes `ibnrReserve`, `ibnrAccrual`,
`emergedPriorYearLoss` and `unreportedClaimCount` — 16,140 -> 15,540 fields, 0 added, 600 removed (150
instances per field, matching any other fully-populated field, because these were `LineResultSet` fields
present at 0 on GL/Property rather than WC-only). None of the four was ever in `RESULT_METRICS`, so
`solo-export-guard`'s hash of the actual exported workbook never saw them — the export-shape guard reads
WC-only-affected here even though the underlying object's shape changed on every line, and the
value-identity scan is what actually caught the removal.

**Value movement:** 10,590 of the 16,140 baseline fields changed across 78 field names. By config:
WC-solo 2,113/3,225, GL-solo 2,133/3,240, PR-solo 2,068/3,210, tri 4,276/6,465. Both gates read fully
green against the new v14 baselines immediately after capture.

**Isolation used throughout:** every commit in this range used a mechanism null test rather than a line
control, since the shared-machinery commits leave no untouched line — force the new code path to
reproduce the old numeric behaviour and confirm byte-identity against the parent. All eight commits
document a passing null test at their own site.

---

## v15 — eight commits: the expected-combined-ratio basis fix, then seven display/diagnostic commits
**Trigger:** one engine defect and its aftermath. `fab85e4` (in the v14 range) moved the pool premium onto
net funding and left every loss numerator gross; the resulting basis mismatch was found, fixed, and then
the display layer that had drifted alongside it was brought back into line and put under a check.

**The eight, in order, and what each moved:**
- `6f47db7` fix the Pool Loss Ratio display (five sites showed `poolLosses / poolPremium`, a capped
  numerator over a narrow denominator) — **nothing moved, on either gate.**
- `d80aa9e` put the expected loss ratios back on the net basis — **the only value movement in the entire
  range.** 315 fields across exactly 3 names: `expectedLossRatio`, `expectedLossRatioMemberBasis`,
  `expectedCombinedRatio`. WC, GL and tri move; **PR-solo byte-identical**, because Property is
  deliberately not netted and was already correct. That asymmetry was the diagnosis, not a coincidence.
- `4a8c601` store `expectedCededPer100` and `netPurePremiumPer100` on `LineResultSet` — **shape only:
  +300 fields, 0 values moved.** All four hashes move because the two new columns enter the export.
- `684ae9f` fix five audit-page and export display defects (pool row taking GL's tower, ungated
  `computeReinsRate`, `FUNDING_CLF_TABLE[0.90]` at three sites, `poolLosses` in the pool-sum card, the
  duplicate premium label) — **all four hashes move, 0 values and 0 fields.** The hash moved on LABELS
  and column set alone, which is exactly the display-vs-value split the two gates exist to separate.
- `a668d11` put the Decisions panel on the engine's own pricing path — nothing moved.
- `acf0f29` wire `evaluateFormula` into a standing diagnostic — nothing moved.
- `6d3b359` fix the three formula defects it found — nothing moved.
- `ac4bf9e` give Cash & Investments its formula specs — nothing moved.

**Shape movement:** 15,540 → 15,840 fields (+300, 0 removed), all at `4a8c601`, all two field names.

**Value movement:** 315 fields at `d80aa9e` and nowhere else. Measured per commit in a worktree rather
than inferred from the endpoint — the endpoint alone cannot distinguish "one commit moved values" from
"three moved values and two cancelled".

**⚠ THE BROKEN-IDENTITIES RULE NEARLY DISARMED ITSELF HERE, and the measurement is what caught it.**
`d80aa9e` both fixed a closed identity (`expectedCombinedRatio` must be exactly 1.0000 at CLF 1.000,
because `poolPremium + admin + reinsurance` is identically `totalMemberCharge`) and added the reporting
rule that flags a field leaving such an identity. The rule required the baseline value to be **bit-exactly**
1 at every instance. At this capture 6 of 150 instances sit at 1 ± 2e-16 — ordering noise from summing
per-line terms at pool scope — so a bit-exact test would have refused to arm on the very field it was
written for, silently, from this baseline onward. The rule now uses a 1e-12 bound for the "exactly 1"
case and keeps exact for "exactly 0": a value that should be 1 is a dimensionless ratio, so a scale-free
epsilon is meaningful; a value that should be 0 carries units, so no scale-free epsilon exists and exact
is the only defensible test. Verified: the loosened rule fires nothing spurious on this recapture, and it
DOES arm on the new baseline (worst departure 2.22e-16).

**Correctness of the fix, confirmed at the capture:** all 150 `expectedCombinedRatio` instances are within
2.22e-16 of exactly 1.

**Isolation:** the line control worked for once — `d80aa9e` is a genuine WC/GL-move-Property-holds commit,
and Property holding is the strongest evidence the diagnosis was right rather than a plausible guess. The
seven other commits are display-only and were each verified gate-identical to their own parent at commit
time, then re-verified here per commit.

**Retired at this recapture:** `SOLO_EXPORT_GUARD_v13.json` and `VALUE_IDENTITY_v13.json`, now that v14 is
the immediate predecessor. The v11 workbook set is untouched — separate lineage, no v13/v14/v15 equivalent.

---

## v16 — eight commits: Property's loss model rebuilt from scratch, two TIV rescales, then the pool market-share fix

**Trigger:** Property's loss model was never fitted — it ran a per-member Gamma aggregate with no
anchor to real claims data. Nine years of the pool's own history said the frequency and severity were
each wrong by an order of magnitude in opposite directions (~112 claims/yr at a $190K mean, against a
fitted 15.5 at $435K), so the product landed within 3x by accident. The rebuild, replacing that model
with a fitted four-component lognormal severity mixture, then required two follow-on TIV rescales
(pull an unincurred cat load out of the price; rescale the roster twice, to $17B marketplace TIV and
then again so the *enrolled* book reaches ~$17B) before the book was back at a defensible scale. The
eighth commit is unrelated — a pool-scope display defect (market share summed mismatched units across
lines) found and fixed while the roster work was fresh.

**The gates could not be used directly on this range.** By the time the eighth commit landed, ~80
fields were already showing red against the v15 baseline for reasons the seventh commit's own report
had already explained (TIV/roster rescales, correctly, moving nearly everything downstream of exposure
and premium). Comparing straight to v15 would have meant re-deriving that explanation from a diff too
coarse to attribute it. Every commit below was instead measured against its own immediate parent, via
a worktree at each of the nine checkpoints (v15 itself plus the eight commits) — the same technique
v14's PR-solo attribution used, applied here for the same reason: the endpoint alone cannot distinguish
"one commit moved these fields" from "three moved them and something else reversed part of it."

**The eight, in order, and what each moved (value-dump diff against its own parent; export-hash diff
in parentheses):**
- `645c15e` rebuild Property's loss model and cut over — **PR-solo and tri move (4,313 instances / 78
  field names); WC-solo and GL-solo byte-identical, both in the raw value dump and the export hash.**
  A real line control: nothing about a Property-only model swap should touch WC or GL, and nothing did.
  Also the only shape change at the `LineResultSet`/`ResultSet` level in the whole range: +60 instances
  across 2 field names (`claimCount`, `kLineApplied`), 0 removed.
- `22672a4` pull Property's asserted cat load from the price — **PR-solo and tri move (4,039 / 79); WC
  and GL identical.**
- `b3c6635` rescale Property TIV to $17B (roster v5) — **PR-solo and tri move (3,865 / 73); WC and GL
  identical.**
- `55e43ce` apply the identity tolerance on both sides of the broken-identities rule — **0 instances,
  0 field names, all 12 export hashes unchanged.** Diagnostic-only, exactly as advertised.
- `59a3411` repair the member-catalog generator and add the CSV-vs-catalog check — **0 / 0 / 0
  unchanged.** Tooling-only.
- `da08663` check the catalog against the generator's own output, not just the CSV — **0 / 0 / 0
  unchanged.** Diagnostic-only.
- `997a4fd` rescale the roster so the enrolled Property book is ~$17B (roster v6) — **PR-solo and tri
  move (4,078 / 73); WC and GL identical.**
- `f0a43c7` fix pool-scope market share — **60 instances, exactly 1 field name (`marketShare`), on
  ALL FOUR configs** (WC-solo and GL-solo move too, 30 of the 60 instances between them — every config
  has a pool scope, even a solo one, and the weighting formula runs there regardless of how many lines
  are active). **All 12 export hashes unchanged** — `resultsExport.ts` already split `marketShare` (and
  `activeExposure`/`totalMarketExposure`/`writtenExposure`) into per-line rows on the Pool tab before
  this commit, so the exported workbook never read the field this commit changed.

**Shape movement (`LineResultSet`/`ResultSet` numeric fields, visible to `value-identity-check`):**
15,840 → 15,900 fields, +60 instances across 2 field names (`claimCount`, `kLineApplied`), 0 removed,
all at `645c15e`.

**Shape movement invisible to BOTH gates, found only by diffing `src/types/simulation.ts` directly —
the second time this has mattered (see v14's IBNR-fields note above):** `645c15e` also deleted
`Claim.locationTiv` and `Claim.damageRatio` (the legacy Property severity model's two claim-level
fields — severity was `damageRatio x locationTiv`, now a free-standing fitted mixture with neither
input) and retired `MARKET_TOTAL_LOCATIONS` (no remaining consumer). None of the three was ever a
`LineResultSet`/`ResultSet` field, so `value-identity-check`'s added/removed count is blind to them;
none was ever in `RESULT_METRICS`, so `solo-export-guard`'s hash never saw them either. Confirmed via
`git show 645c15e -- src/types/simulation.ts` (the only type-shape change in the entire v15→v16 range)
and a repo-wide grep for all three names post-recapture: every remaining hit is a comment recording the
retirement, no live reference.

**Value movement, cumulative (v15 baseline vs. this recapture directly, not summed across the
per-commit steps above — the per-commit steps are the attribution, this is the total):** 4,394 of
15,840 baseline fields changed, across 79 field names.

**Isolation:** WC-solo and GL-solo are byte-identical, on both gates, at every one of the six commits
that touch Property (`645c15e`, `22672a4`, `b3c6635`, `997a4fd`) or nothing (`55e43ce`, `59a3411`,
`da08663`) — a real line control held at every intermediate point, not just the endpoints. `f0a43c7` is
the one commit that legitimately touches all four configs, because pool-scope market share exists even
for a single-line pool.

**BROKEN IDENTITIES check:** confirmed firing correctly across the full range. `expectedCombinedRatio`
moved in 15 of 150 instances between v15 and this recapture; every one is within 2 ULPs (2.22e-16 at
worst) of exactly 1 — ordering noise from summing per-line terms at pool scope, the same phenomenon the
rule was built to tolerate at v15. The rule printed nothing (it only prints when `realMoved.length > 0`
for some field), confirming zero spurious fires across all 79 changed field names in this range,
`expectedCombinedRatio` included. `expectedCombinedRatio` reads exactly 1.000 at display precision
everywhere the underlying identity requires it.

**Catalog-vs-generator check:** `997a4fd` (roster v6) is the first roster change since this check
landed at `da08663`. Ran clean: section 0 (regenerate to scratch, byte-diff against the live catalog)
confirms `memberCatalog.ts` was regenerated, not hand-edited, reproducing the live file exactly at
31,398 bytes; sections 1–4 (CSV field-by-field, exposure mapping, derived-attribute presence, totals)
all pass.

**Retired at this recapture:** `SOLO_EXPORT_GUARD_v14.json` and `VALUE_IDENTITY_v14.json`, now that v15
is the immediate predecessor.

---

## v17 — four commits: Property's reinsurance programme, and the recalibration it should have carried

**Trigger:** Property got the per-occurrence tower and aggregate stop-loss WC and GL had had since
`aa0838a`. Netting followed structurally rather than by decision — `usesTower` (now `hasTractableCeded`) is
what gates it — which meant the calibration cascade `fab85e4` ran when WC and GL were netted did not
happen. Two of these four commits are that omission being paid off.

**The four, in order:**
- `dbd9138` Property's occurrence layer ($70M xs $5M, to the fitted severity cap) plus a two-level
  aggregate stop-loss, Panjer-priced rather than lognormal. **PR-solo and tri move (4,367 instances / 78
  field names); WC-solo and GL-solo have ZERO value instances.** All 12 export hashes move anyway, on one
  shared RESULT_METRICS label — `Reinsurance Level` → `Reinsurance Program`, now accurate for every line.
  Verified by dumping the actual CSV rather than trusting the hash: WC-solo's diff is exactly two lines,
  both that label, every value identical. This is the display-vs-value split the two gates exist to
  separate, in its cleanest form yet.
- `7752826` the Panjer discretisation fix. **NOTHING MOVES — 0 values, 0 hashes, 0 shape.** The aggregate
  defaults to declined, so the corrected code is on a path no default run takes. The commit claimed a
  bit-identical 15,900-field capture and that is confirmed here independently.
- `265b1ce` the recalibration cascade (`RATE_NEUTRAL_CHANGE_PCT`, `RATE_NEUTRAL_LOAD`, the two membership
  constants, and `k` through them). **5,699 instances / 78 field names, on GL-solo, PR-solo and tri.**
  See the correction below — WC-solo reads byte-identical and that is a false negative, not isolation.
- `0bfd899` Property's own derived CLF table, on the net basis. **420 instances / 7 field names, PR-solo
  and tri only, every one reserve-margin or capital-adequacy** (`reserveRiskMarginNeeded` $6.76M → $4.21M,
  ratio 0.6228 = exactly `0.5923/0.951`). WC-solo and GL-solo byte-identical on both gates. Pricing at
  defaults does not move at all, because `fundingAtExpected` pins the CLF to 1.000 on either curve.

**Shape:** 0 added and 0 removed at every one of the four steps. The only export-shape change in the whole
range is the single label rename at `dbd9138` — caught by the hash guard, correctly invisible to
value-identity, and *invisible to both* as a "shape" change since the field KEY (`reinsuranceLevel`) never
moved. `usesTower` → `hasTractableCeded` and the deleted `FUNDING_LEVEL_LABELS` are internal symbols in
neither saved state nor the export. Confirmed by diffing `src/types/simulation.ts` across the range: no
field added or removed on any exported type.

**⚠ THE LINE CONTROL RETURNED A FALSE NEGATIVE HERE, AND THE RULE IT BROKE IS NOW IN
docs/WORKING_PRACTICES.md.** Read that, not this, for the practice — this entry records only the
measurement.

At `265b1ce` WC-solo is byte-identical on both gates. That reads as "the recalibration did not reach WC",
and it is wrong. `k` is pool-wide and WC is genuinely affected; the gate simply could not see it. Membership
joins are `Math.round(expectedNew * rng.range(0.3, 1.7))`, so a small parameter change only surfaces where
it crosses a rounding boundary. Measured: `k` +2.65%, WC's `expectedNew` +0.057 members/yr, boundary crossed
on ~5.7% of line-years — giving the 3-seed × 5-year gate a **42% chance of reading byte-identical on a line
that moved.** Widening to 40 seeds × 8 years, WC changed on **171 of 1,280 fields across 18 of 40 games.**

So byte-identity on a solo config proves scope only under STRUCTURAL CONFINEMENT. It held legitimately at
`dbd9138` and `0bfd899` (Property-only constants and tables, which WC and GL do not read) and did not at
`265b1ce` (shared membership machinery). The null test is what carried attribution at `265b1ce` — reverting
the four constants reproduced `7752826` on 15,900 of 15,900 fields — and the two checks are not
interchangeable: the null test proves the moved values are the constants rather than the refactor, the line
control proves which lines moved.

**⚠ A COMMIT-MESSAGE CORRECTION, recorded because the error class matters more than the instance.**
`265b1ce`'s message asserted "All three lines move, as expected with k pool-wide" while the measurement
printed in that same turn read `configs: GL-solo, PR-solo, tri`. The mechanism was right and the conclusion
was true, but the evidence cited did not establish it. That is reasoning forward from the design to what the
numbers ought to say and then writing it down as the reading — harder to catch than being wrong, because a
true claim attracts no scrutiny. The practice entry is in WORKING_PRACTICES under the commit-message rule.

**Guards:** BROKEN IDENTITIES fires nothing across the range — its second range since the tolerance fix at
`55e43ce`. `expectedCombinedRatio` holds at 150 instances with a worst departure of 2.22e-16, exactly 1.0
ULP. The catalog-vs-generator check is green and trivially so: no roster change in this range, and
regeneration reproduces the live catalog byte-for-byte at 31,398 bytes.

**Gate re-run before baselining:** `property-tower-mc` had been killed partway at `0bfd899`. Re-run at the
full 200 seeds × 25,000 trials: Panjer +0.22% / +4.70% mean error against the lognormal comparator's
−8.10% / +7.13%, sign-stable where the lognormal changes sign, all three assertions green.

**Retired at this recapture:** `SOLO_EXPORT_GUARD_v15.json` and `VALUE_IDENTITY_v15.json`, now that v16 is
the immediate predecessor.

---

## Quick "why did the numbers change" reference
| Jump | Cause | WC-only affected? |
|---|---|---|
| v3 → v4 | Year-1 init fix (GL/PR opening surplus) | No |
| v4 → v5 | Per-line segregated investments | No |
| v5 → v6 | Per-line decision editing (divergent run) | No (defaults reproduce v5) |
| v6 → v7 | Per-line capital + shared-market investments + GL/PR resize + prior histories | **Yes — first WC shift** |
| v7 → v8 | New investment params + fees + single regime; opening bands + K retune; pool-wide allocation/risk control | **Yes** |
| v8 → v9 | Reinsurance recoverable removed (net-basis reserves) | Barely — 160/162 scopes identical; MAMC6EA4 exact |
| v9 → v10 | otherAssets/otherLiabilities removed | Slightly — investment income on shifted invested base (≤0.50%) |
| v10 → v11 | Self-funded discount removed | Premium +1%; **9/72 seed-lines re-rolled, incl. MAMC6EA4 GL** |
| v11 → v12 | Six GL engine commits (fitted-mixture rebuild, $100M cap, own CLF grid) + Expected funding option | Yes — both lines' default moved |
| v12 → v13 | Reinsurance tower priced at runtime (both lines); WC aggregate lambda basis fixed | Yes — pricing-basis only, no loss-model change |
| v13 → v14 | Eight commits: membership/pricing rework (all lines), net funding + static CLF tables (WC/GL), GL supplied table, WC IBNR removed, opening band decoupled to premium (all lines) | No — Property moves twice, at the membership/pricing pair and at the opening-band commit |
| v14 → v15 | Expected-combined-ratio basis fix (`d80aa9e`) plus seven display/diagnostic commits | **Yes — WC and GL only.** Property was already correct, being deliberately un-netted, and is byte-identical |
| v15 → v16 | Property loss-model rebuild + cat-load pull + two TIV rescales (roster v5, v6), then the pool market-share fix | No — Property moves on four of the eight commits; WC and GL are byte-identical throughout except the last commit, which moves all four configs |
| v16 → v17 | Property's occurrence tower + aggregate, the Panjer fix, the recalibration cascade it should have carried, and Property's derived CLF table | No — all three lines are reached by the cascade (k is pool-wide), though WC-solo reads byte-identical there: a false negative, see the v17 entry |

## Still pending (would drive a future v11)
- **⚠️ Systematic underpricing (finding 6)** — actual loss ratio ~46% against a 66.8% expected
  assumption; 2 of 60 line-years reached expected; pool surplus doubles in 5 years on defaults.
  v10 therefore baselines a pool with ~20 points of structural combined-ratio margin. When this is
  recalibrated, v11 will differ substantially — that is the INTENDED outcome, not a regression.
- **Per-line loss-distribution rework** (each line distinct frequency/severity/tail; Property's tail
  is currently the *thinnest* of the three despite being cat-exposed — finding 7). Same pass as the
  underpricing fix. Baseline-shifting → v11.
- **ULAE as a real modeled expense** — decided but not designed; adds an expense line, so
  baseline-shifting.
- **Line-size variability** — the opening bands control the capital *ratio*, not line *size*, so
  premiums swing widely by seed (Property ranged $6.28M–$10.78M, WC $4.94M–$8.00M across sampled
  seeds; which line is largest changes seed to seed). Optional calibration via narrowing rate ranges.
- Phase 3 reserves; Phase 4 shock events (which will carry market crashes now that the downside
  regime is gone).

---

## v18 — nine commits: two aggregate gates, the reinsurance retirement, then WC's severity and pricing rebuilt

**Trigger:** WC's CLF crossing sat at 43-48%, below 50%, which a compound-Poisson loss cannot produce.
Chasing it produced this range. The first five commits are structural cleanup that moved nothing; the
last four are the actual answer, in dependency order — cap WC's unbounded severity, make all three
ceilings trend, take region out of chronic severity, then price WC on four held class rates.

**The nine, in order, measured per commit against the v17 baseline rather than only at the endpoint:**

| commit | WC-solo | GL-solo | PR-solo | tri | fields | values |
|---|---|---|---|---|---|---|
| `2587f32` Property aggregate gate | . | . | . | . | 15900 | 0 |
| `38a0fb9` WC aggregate gate | . | . | . | . | 15900 | 0 |
| `d8c76a4` REINSURANCE_PROGRAMS retired | . | . | . | . | 15900 | 0 |
| `6614e4a` four loss-split fields removed | . | . | . | . | **15300** | 0 |
| `0b2e537` WORKING_PRACTICES entry | . | . | . | . | 15300 | 0 |
| `1eab18f` WC capped at $85M | **MOVE** | . | . | **MOVE** | 15300 | 3162 |
| `cb00971` ceilings trend with their line | . | **MOVE** | . | **MOVE** | 15300 | 4766 |
| `a9faf09` region out of WC severity | **MOVE** | . | . | **MOVE** | 15300 | 5641 |
| `0a465df` WC on four held class rates | **MOVE** | . | . | **MOVE** | 15300 | 6062 |

(`.` = byte-identical to the previous commit on all three seeds. Value counts are cumulative against
v17, which is why they grow. Property-solo is `.` at every one of the nine.)

**BOTH AGGREGATE GATES AND THE REINSURANCE RETIREMENT MOVED NOTHING, as their own reports claimed.**
The two gates are unreachable on a default run — defaults place the occurrence layer, so no default game
reaches the gated state. `d8c76a4` deleted an entire engine (`reinsuranceEngine.ts`, REINSURANCE_PROGRAMS,
the `reinsuranceLevel` decision and its UI) and moved not one value, because nothing read the legacy path.
It is the only commit in the range that touched `resultMetrics.ts` — the file the hash guard reads — and
even that did not move a hash: the edit was comments, a type narrowing and an unreachable branch.

**`6614e4a` IS SHAPE-ONLY AND THE HASH GUARD DID NOT SEE IT.** 600 fields removed (`attachment`,
`excessLosses`, `poolLosses`, `quotaShareLosses`), 0 added, 0 values changed — and all twelve export
hashes byte-identical. Those four were never in RESULT_METRICS, so they never reached the CSV. This is the
fourth time the hash guard's blindness to anything outside RESULT_METRICS has mattered, and it is exactly
why the two gates are not redundant: value-identity is keyed on FIELD NAME and saw the removal; the hash
guard is keyed on the exported CSV and could not.

**⚠ THE EXPECTATION THAT `cb00971` WOULD MOVE WC WAS WRONG, AND THE CAVEAT BELONGS TO THIS COMMIT RATHER
THAN THE ONE BEFORE IT.** WC-solo is byte-identical across `1eab18f` → `cb00971` on all three seeds
(`ce7c19843acc`, `0cddf9ee50c9`, `217fdf6d8333` unchanged). It is **`cb00971`**, not `1eab18f`, whose WC
half the gate cannot exercise — the record lives in `cb00971`'s own commit message and it is not a finding
to re-open:

- `1eab18f` (the cap) DID move WC, because imposing a ceiling changes the ANALYTIC — held pure premium
  -0.32%, the CLF table, the tower moments — and that reaches every WC value whether or not any claim in
  the sample is clipped.
- `cb00971` (trending the ceiling) did NOT, because WC prices off the held pure premium times its RAW
  trend; the held figure is derived at year 1, where the trending ceiling equals the fixed one, and
  `computeKLine` takes no year. The only channel left is the draw, and WC's ceiling binds about 1 claim in
  176,530 against a gate that draws ~27,000. GL moved at `cb00971` because its PRICE moved
  (`glCappedSeverityTrend` collapsed to the raw trend), which needs no claim to bind at all.
- Verified separately at the time over 20 years x 12 seeds (112,062 claims): largest claim $85.000M before
  against $94.516M after, with WC's loss series differing. The wiring is live; the gate simply cannot see
  it at its sample size. This is the WORKING_PRACTICES "passes while unable to fail" pattern, in the
  benign direction.

**Shape movement:** 15,900 → 15,300 fields (0 added, 600 removed), all at `6614e4a`, four field names.

**Guards at the endpoint:** no broken identities — `expectedCombinedRatio` appears in the changed list
moving `0.9999999999999999 -> 1`, which is the identity becoming MORE exact and is correctly not flagged
(the guard's 1e-12 epsilon treats arrival at exactly 1 as no departure). roster-catalog-check and
marketplace-generation-check both green; no roster change in this range. `0a465df`'s class-rate exactness
assertion still holds at the endpoint: 2.00e-15 worst over 2,000 random roster subsets, and the four rates
blend back to the held single rate at 3.73913905 both ways.

**What a reader should carry forward:** WC's economics changed twice in this range and the second change
was an across-the-board increase, not a redistribution. The median enrolled book's blended rate lands
~2.3% above the old single rate, because the books that actually enrol are worse than the full-market
average. WC's crossing moved 44.1% -> 43.2% (a re-measurement, not a move) -> 50.4%. Every WC figure
measured before `0a465df` was taken against a line that undercharged.

---

## v19 — one merge: Friedland IBNER replaces reserve development on all three lines

**Trigger:** `feature/ibner` merged into `claims-distribution` at `bd76f42`, with `--no-ff` against the
project's squash convention so its four investigations survive as separate commits. The merge itself was
conflict-free — the two sides touch disjoint files, `claims-distribution` having contributed only the v18
recapture.

**⚠ NO LINE IS A CONTROL IN THIS RANGE.** Every previous recapture had at least one line that could not
move and served as the leak test. IBNER replaces reserve development entirely, so `priorYearDevelopment`
goes from a random wobble to a real quantity on WC, GL and Property alike. The isolation tool here is the
MECHANISM NULL TEST, not a line control — see below.

**The seven engine commits, measured per commit against the immediately preceding tree.** History is
preserved, so each was checked out and captured with one fixed instrument (the v19 capture code, copied
into each worktree) — only the engine differs between rows. Two merge rows are included for completeness;
they re-import `claims-distribution` work already measured in v17→v18 and are not new movement.

| commit | WC-solo | GL-solo | PR-solo | tri | fields | values |
|---|---|---|---|---|---|---|
| `aef0bbe` IBNER replaces reserve development | **MOVE** | **MOVE** | **MOVE** | **MOVE** | 15300 | 9343 |
| `4fbbb5a` booking-bias coefficient → 0.80 | . | . | . | . | 15300 | **0** |
| `a84d854` unwind front-loaded, exactness fixed | . | . | . | . | 15300 | **0** |
| `a45a818` Property total SD 8% → 15% | . | . | **MOVE** | **MOVE** | 15300 | 1979 |
| `8cf3129` *(merge: the severity-cap work)* | MOVE | MOVE | . | MOVE | 15300 | 4978 |
| `3b2db4f` dead code retired | . | . | . | . | 15300 | 0 |
| `8351395` develop the RESERVE, not the ultimate | **MOVE** | **MOVE** | **MOVE** | **MOVE** | 15300 | 6421 |
| `a88454d` *(merge: region removal + class rates)* | MOVE | . | . | MOVE | 15300 | 4348 |
| `e2a7b23` WC CLF re-derived with IBNER live | **MOVE** | . | . | **MOVE** | 15300 | 420 |
| **`bd76f42` endpoint vs v18** | **MOVE** | **MOVE** | **MOVE** | **MOVE** | 15300 | **9120** |

The merge commit is bit-identical to `e2a7b23` on all 15,300 fields, which is the check that a zero-conflict
merge actually resolved to the branch tip rather than to something in between.

**⚠ TWO COMMITS MOVED NOTHING AND THAT IS THE FINDING, NOT AN OMISSION.** `4fbbb5a` raised the booking-bias
coefficient by a factor of 1.6 and `a84d854` rewrote the unwind schedule, and both read 0 of 15,300. The
reason is `aef0bbe`'s own finding: `premiumFundingRatio` is a hardcoded 1, so the funding channel the bias
rides never engages in a default game and `bookingBias` is 0 on every cohort the gate ever sees. Their
correctness is proved by `ibner-null-check` sections 3 and 4, which squeeze funding to each line's own
reachable minimum stop and then read a worst residual of 0.0000% on all three lines. A gate that cannot
reach a mechanism is not evidence the mechanism is inert — this is the "passes while unable to fail"
pattern in its benign direction, and it is why the null check exists alongside the gates.

### The mechanism null test — the isolation used in place of a line control

With no line able to serve as a control, attribution was established by making BOTH mechanisms inert and
asking whether the trees agree. The pre-merge arm forces the old `devFactor` to 1 while still spending its
draw; the post-merge arm zeroes `IBNER_TOTAL_SD` at runtime, exactly as `ibner-null-check` does. Residuals
below $1e-6 absolute or 1e-9 relative are float noise and excluded.

| arm | residual fields | WC-solo | GL-solo | PR-solo |
|---|---|---|---|---|
| scales and bias at zero | 6,680 | 210 | 2,012 | 1,604 |
| + the shared-stream draw restored | 1,590 | 210 | **0** | 628 |
| + WC's pre-IBNER CLF table restored | 1,256 | **0** | **0** | 628 |

Read down the table: each row removes one channel that is not the mechanism, and what is left is what
IBNER genuinely changed.

**⚠ IBNER SILENTLY RE-ROLLED INSTANCE GENERATION, AND THE COMMIT COMMENT SAYS THE OPPOSITE.** The largest
term is not the mechanism at all. The old pre-game cohort computed
`devFactor = 1 + rng.range(-0.03, 0.05) / age` from the SHARED instance stream and then stored the result
in a field that `processReserveDevelopment` never read — dead data that still cost a draw. IBNER deleted
it. `aef0bbe`'s comment states that the IBNER draws use their own sub-stream specifically so that later
instance-generation draws are not re-rolled, and that is true of the draws it ADDED; it does not hold for
the draw it REMOVED. Deleting one draw shifts everything downstream of it, which is why GL-solo — a line
IBNER's mechanism reaches only through development — showed 2,012 moved fields at the null and exactly 0
once the draw is put back. **This is a keep-the-draw violation that the gates cannot distinguish from
intended movement, because at this endpoint everything moves anyway.** It is recorded, not reverted: the
values are captured at v19 and reverting now would move every line again for no gain.

**What survives as the mechanism's own footprint:** Property alone, and it is one quantity. The old form
marked a cohort `closed` at `newUnpaid < 1000` and dropped it from the array the next year, so up to $1,000
of booked liability vanished from the balance sheet. IBNER pays the residual out instead. The whole
Property residual is that transfer — worst $1,583, median $1,026, moving dollar-for-dollar from
`endingNetReserve` to `netPaidLosses` with `netIncurredLoss` following. Property is the only line that
shows it because its horizon is 2–4 and its paydown 65%, so it is the only line whose cohorts mature and
close inside a five-year gate. WC and GL are exactly 0.

**Shape movement:** 15,300 → 15,300 fields, **0 added, 0 removed**, and `RESULT_METRICS` is untouched
across the whole range, so all 12 export hashes are pure value movement with no reordering.

**⚠ BOTH GATES ARE BLIND TO THIS RANGE'S REAL SHAPE CHANGE, and that is the fifth time.** `ReserveCohort`
gained five fields (`registerSum`, `horizon`, `age`, `stepMultiplier`, `bookingBias`), lost
`developmentFactor`, and `ReserveDevelopmentState` was deleted outright. None of it appears above, because
cohorts live on `poolState` and neither gate looks there: value-identity walks `ResultSet` and
`LineResultSet` only, and the hash guard is scoped to `RESULT_METRICS`. A reader who takes "0 added, 0
removed" as "the data model did not change" will be wrong. The added/removed columns answer a narrower
question than they appear to.

**Guards at the endpoint:** no broken identities. `ibner-null-check` green on all seven sections — the
below-paid-to-date count that read 9.04% of WC cohorts before `8351395` is now exactly 0 on all three
lines, matured cohorts land on `registerSum` to 0.0000%, and the martingale means sit inside 3 SE
(WC 1.01277 ± 0.01910, GL 1.00553 ± 0.01219, Property 1.01147 ± 0.01662). `wc-cap-check`,
`wc-cap-stability-check`, `wc-severity-rebuild-check`, `gl-claim-check`, `property-claim-check`,
`tower-runtime-check` and `shock-check` all pass. Typecheck and build clean; lint unchanged at 14 errors,
every one of them present at the merge base `0a465df`.

**What a reader should carry forward:** reserve development is now a real quantity on every line rather
than a random walk with nothing behind it, and WC's CLF crossing has moved 44.1% → 50.4% → **54.7%**
(mean ratio 1.0003), landing on the real-pool 55th-percentile benchmark. Any development figure measured
before `aef0bbe` was taken against a mechanism that no longer exists — including, specifically, Property's
15% total SD, which was set at `a45a818` against the old walk and whose exhibit has not been re-tuned since
`8351395` rewrote it.

---

## ⚠️ The v4–v9 artifacts described above are HISTORY-ONLY as of 2026-08-19

The workbooks, CSVs and per-version `.md` summaries this document narrates —
`BASELINE_v4_ALL_CONFIGS.md` through the `BASELINE_v9_*.xlsx` set, the v2/v3/v4
seed CSVs, `BASELINE_v6_DIVERGENT.md` and its workbook, and the retired
`VALUE_IDENTITY_v5/v9/v10.json` and `SOLO_EXPORT_GUARD_v5/v9/v10.json` gate
baselines — **were removed from the working tree** (28 files, ~3.24 MiB) in the
same commit that added this note. Nothing read them: the only live baseline
references in `scripts/` and `src/` are the two v12 constants in
`solo-export-guard.ts` and `value-identity-check.ts`.

**They are not gone.** Git retains every one permanently. To recover any of
them:

```
git show f93a87c:baselines/BASELINE_v7_WC_GL_PR.xlsx > /tmp/recovered.xlsx
git log --all --diff-filter=D -- 'baselines/*'     # find the removing commit
```

`f93a87c` is the last commit at which all of them were present.

**This document is why the removal was safe** — it records what each retired
version represented and what moved between them, which is the part worth
keeping. What remains in `baselines/` is the current gate pair (v19), its
immediate predecessor (v18, the one to reach for if a v19 capture ever needs
checking), and the v11 workbook set.
