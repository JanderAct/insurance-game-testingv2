# Baseline Lineage — v4 through v29

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

## v20 — one commit: every pool-scope aggregation audited, six defects fixed

**Trigger:** seven pool-scope aggregation defects had been found one at a time, each by tripping over it,
and three of them had been *added underneath a comment warning about that exact class*. Finding the eighth
the same way was the expected outcome of continuing, so the whole of `aggregateLineResults` was enumerated
and classified instead.

**⚠ BOTH GATES MOVED, AND THE BRIEF EXPECTED ONLY ONE TO.** The change is display-and-export only in the
sense that matters — the engine did not move — but `value-identity-check` captures the POOLED row
alongside each line, and the pooled row is exactly what was being corrected. The decomposition is the
proof, and it is exact:

| | changed | added |
|---|---|---|
| **total** | 37 | 150 (`enrolmentCount`) |
| by config | `tri` 37 — **WC-solo, GL-solo, PR-solo all 0** | |
| by scope | `pool` 37 — **every line scope 0** | |
| by field | `activeMembers` 15, `memberRetentionRate` 15, `withdrawnMembers` 4, `newMembers` 3 | |

Zero line-scope movement is the statement that no aggregation feeds the engine. Zero solo-config movement
is the second half of it: with one active line every aggregation is the identity, so a solo pool cannot
change unless the aggregation itself is broken. All 12 export hashes moved, on the new `Enrolments` column
and the `Active Members` → `Members` relabel, which reach every config including the solos.

### The classification

Every field summed or averaged across lines, and what each turned out to be:

- **LEGITIMATE (58 fields)** — extensive money, plus ratios recomputed from summed components. `marketShare`
  and `investmentReturnRate` were already recomputed rather than summed; every income-statement and
  balance-sheet figure genuinely adds.
- **WRONG MULTIPLICITY (4)** — `activeMembers`, `newMembers`, `withdrawnMembers`, `memberRetentionRate`.
- **MIXED UNITS (3)** — `activeExposure`, `totalMarketExposure`, `writtenExposure`.
- **NO POOL MEANING (3)** — `aggregateAttachment`, `cededByLayer`, `commonLossFactor`.
- **FIRST-LINE PLACEHOLDER (18)** — rate/CLF/decision echoes, already documented as such.

### What was wrong, and what it now reads

**`activeMembers`** summed per-line enrolments: 205 against a 139-member roster, ~47% over. Now the
deduplicated roster. The enrolment sum survives as its own field because it is the legitimate WEIGHT behind
`memberSatisfaction` and `averageRiskQuality` — those average a per-line figure weighted by that line's
enrolments, and a member with two lines genuinely has two experiences to average.

**`newMembers` / `withdrawnMembers`** summed per-line joining and leaving EVENTS. Now the union of the
per-line id sets, which required carrying `newMemberIds` / `withdrawnMemberIds` on `LineResultSet` — there
was no existing distinct quantity to read, unlike the roster.

**⚠ AND THE OBVIOUS-LOOKING VERSION OF THAT IS WRONG.** The first cut read joiners off the roster as
`memberList.filter(m => m.yearJoined === yearNumber)`. Every opening member carries `yearJoined` 1 — the
field's own comment says so and says not to answer per-year enrolment questions with it — so year 1
reported the entire book as joiners: **140 against a true 41.** `pool-aggregation-check`'s union-vs-sum
assertion caught it on its first run, which is the case for the check existing.

**`memberRetentionRate`** divided summed enrolment counts, making it an enrolment retention rate wearing a
member label: a member who dropped one of two lines counted as a whole withdrawal against a doubled base.
Both readings are defensible quantities; only one matches the name, the "Member Retention Rate" row that
displays it, and the per-line field it aggregates — which is itself a distinct-member rate. Now on a
distinct-member basis, so the pooled row measures what its own line rows measure.

**`writtenExposure`** adds WC/GL payroll to Property TIV and is ~96% TIV by magnitude. It sat three lines
below a comment warning about exactly this for its two neighbours and was not named by it. The sum is
retained (display reads it) but no longer labelled with a unit it does not have: pool scope now reads
"Written Exposure (payroll + TIV)" on both the audit page and the results table.

**`cededByLayer`** — NOT ON THE ORIGINAL LIST, and the clearest instance of the pattern. It sums
ELEMENTWISE, justified by a comment reading "only meaningful because WC and GL share identical attachments
and limits on their first three layers". True when written. Property then got a tower of its own — a single
`$70M xs $5M` layer — and it landed in index 0 beside two `$4M xs $1M` layers. Measured: 31.49 = 0.30 (WC)
+ 17.11 (GL) + 14.08 (Property), three different treaties in one cell. Property is now excluded rather than
the sum widened, because no index means anything across all three. **The comment was not wrong when
written; a LINE was added and nobody re-read it.**

**`aggregateAttachment`** summed two treaties' attachment points. `aggregateRecovery` and `aggregatePremium`
are realised dollars and do add; an attachment is a THRESHOLD and does not — no single retained-loss total
triggers it, because there are two treaties triggering on two different totals. Now 0 with the reason
recorded; nothing reads it at pool scope.

**`commonLossFactor`** — also not on the list. An unweighted mean of a factor only GL uses: WC and Property
are pinned at exactly 1, so GL's 1.1759 is reported as 1.0586 at pool scope, and the dilution changes with
the NUMBER of active lines rather than with anything economic. Left as the mean (legacy field, no engine
consumer) but recorded as not meaning what it appears to.

**One stale comment, no code change:** `netPaidLosses` carried "Non-WC lines contribute 0, so the pool total
IS WC's — correct, since only WC has a report lag." WC's report lag went at the IBNER cutover; measured
WC $8.04M + GL $11.67M + Property $8.87M, with WC the smallest. The sum was always right; the reasoning
under it had been inverted by a change elsewhere.

### The structural fix, which matters more than the six

`aggregateLineResults` no longer has a generic `sum`. Four named helpers replace it — `addDollars`,
`addEnrolments`, `addMixedUnitExposure`, `noPoolMeaning(placeholder, why)` — so every one of the 60-odd call
sites states its own class, and `noPoolMeaning` will not compile without a written reason. A new field
cannot be added without choosing.

`scripts/diagnostics/pool-aggregation-check.ts` closes it: it enumerates every numeric field on the pooled
row and fails if any is unclassified, so adding a field to `ResultSet` without deciding what it is turns the
check red. It also asserts the roster is distinct, that the enrolment sum still EXCEEDS it (a deduplicated
weight would silently break satisfaction and quality), that joiner and leaver counts are unions rather than
sums, that `cededByLayer` is the WC+GL elementwise sum, and that **a solo pool equals its one line exactly**.

**⚠ IT CHECKS BOOKKEEPING, NOT TRUTH.** It cannot say a field is in the wrong class — only that somebody
chose and wrote it down. That is the honest limit, and it is still the difference between a decision and an
omission: three of the seven defects were omissions committed inches from a warning.

### The export divergence, closed

The page read 141 where the export read 205, both labelled "Active Members" — the Pool Loss Ratio defect
recreated. The export now carries **both** columns: `Members` (distinct) and `Enrolments` (the sum). Both
are needed and neither is a duplicate — Members is what the pages show and what the word means; Enrolments
is the divisor anyone reconstructing Member Satisfaction or Average Risk Quality from the export requires.
Shipping only Members would make both unreconstructable; shipping only Enrolments is what caused the
divergence.

**Guards at the endpoint:** `pool-aggregation-check` green on all five sections. `ibner-null-check`,
`wc-cap-check`, `gl-claim-check`, `property-claim-check`, `tower-runtime-check`, `shock-check` all pass.
No broken identities. Typecheck and build clean; lint unchanged at 14 errors.

**What a reader should carry forward:** the pooled row is not the sum of the line rows, and never was — it
is a mixture of sums, unions, weighted means and placeholders. The four helpers are how you tell which,
and `pool-aggregation-check` is what stops the next field from skipping the question.

---

## v21 — seven commits: the Calculation Audit page audited, guarded and repaired

**Trigger:** the audit page was found explaining a value with a formula that evaluated to something else
(Market Share, pool scope: stating 30.1% while deriving 21.0%). One instance meant the class was present, so
the page was audited row by row, the harness that guards it was extended three ways, and every disagreement
it then found was fixed. Nothing here is a calibration change.

**⚠ THE MOST BORING RECAPTURE IN THIS DOCUMENT, AND THAT IS THE RESULT.** Every one of the seven commits is
diagnostic or display. **Zero values moved at any commit.** The whole range produced ONE shape change — two
numeric fields deleted at `ebdb147` — and nothing else.

| commit | fields | added | removed | **values** | 12 export hashes |
|---|---|---|---|---|---|
| `ebdb147` five dead funding-adequacy fields deleted | 15150 | 0 | **300** | **0** | 12 MATCH |
| `118b1fb` squeezed arm + hand-multiplication check | 15150 | 0 | 300 | **0** | 12 MATCH |
| `9f63680` decisions + self-insured arms, prose claims | 15150 | 0 | 300 | **0** | 12 MATCH |
| `ac98bd5` reserve rows booked on the right base | 15150 | 0 | 300 | **0** | 12 MATCH |
| `d5ba156` pool-scope rows derived per line | 15150 | 0 | 300 | **0** | 12 MATCH |
| `ae7b5ac` the unit suffix | 15150 | 0 | 300 | **0** | 12 MATCH |
| `6f84b72` layer counts + the vacuous check | 15150 | 0 | 300 | **0** | 12 MATCH |

Measured per commit against the FIXED v20 reference — valid because nothing in `baselines/` and neither
guard script changed anywhere in the range. **84 export hashes checked (7 commits x 12) and all 84 match.**

**⚠ SIX EXPECTED-ZERO ROWS IS EXACTLY WHERE NOBODY CHECKS, which is why they were checked.** A range where
every row is predicted to be nothing is the one a reader skims and a recapture launders. The per-config hash
was run at every intermediate commit regardless, not only at the endpoint.

**The one shape change:** `fundingAdequacyRatio` and `premiumFundingRatio`, 150 instances each. Five fields
were deleted at `ebdb147`; the other three (`premiumFundingAdequacyStatus`, `fundingAdequacyStatus`,
`fundingAdequacyIndicator`) are STRINGS, and this gate captures numbers only — so a five-field deletion
reads as a two-field one here, and that asymmetry is a property of the instrument rather than of the change.

### The phantom, and why clearing it is part of the point

The v20 baseline carried those 300 removed fields for **seven commits**. The gate still declared HOLDS, so
every run printed a standing `removed 300` line that meant nothing. That is precisely the noise that trains
a reader to skim — and skimming is how Market Share survived a release with a guard on it, its failure sitting
in a list of legitimately-moving fields. The v21 capture reads `added 0, removed 0` and the verdict line is
back to the plain `VALUE IDENTITY HOLDS.` A standing informational line is not free; it costs attention.

### What the range actually did

**The page was audited (97 distinct rows) and the harness extended three ways:**

- `118b1fb` — a **SQUEEZED ARM**. The check ran only at defaults and reported ONE defect; the identical
  evaluation under squeezed funding reported ELEVEN. `defaultLineDecisionSet` sets `fundingAtExpected` on
  every line, pinning `selectedFundingCLF` to exactly 1.000 EVERYWHERE, so four pool-scope rows reading a
  one-line placeholder were right only because all three lines agreed, and two reserve rows omitting the
  `(1 - bias)` term were right only because the bias was zero. Same commit dropped a **$10,000 tolerance
  sitting on an identity that is now exact** ($0.0000 across 1,920 scope-years, because IBNER pays the
  closed-cohort residual out instead of dropping it) — the fourth such tolerance found in this project.
  Same commit added the **HAND-MULTIPLICATION CHECK**, which parses the printed operands back as a reader
  would.
- `9f63680` — **DECISIONS and SELF-INSURED arms**, plus **PROSE CLAIMS**. The two arms are mutually
  exclusive by construction (the aggregate stop-loss is conditional on a placed occurrence layer), so two is
  the minimum rather than a choice. The three rows the decisions arm uniquely reaches — Member dividends,
  Member assessments, Loss prevention expenses — were identically $0 in every prior run: passing while
  unable to fail.

**Then every disagreement was fixed:** `ac98bd5` (the reserve rows, which failed at LINE scope in every solo
config and by the largest margin on the page), `d5ba156` (four pool-scope rows derived per line, plus Market
Share), `ae7b5ac` (the 10^6 unit suffix — six rows, one line at the cause), `6f84b72` (two prose layer counts,
and a check that could not fail).

### ⚠ THREE FINDINGS FROM THIS RANGE WORTH CARRYING FORWARD

**A DEFAULT CAN MAKE A WRONG ROW LOOK RIGHT.** Six of the seven formula defects were invisible at default
decisions. Not by luck: the default pins every line to the same CLF and switches the booking bias off, so
placeholders and missing terms both cancel. **A row correct only because three lines happen to be identical
is not a correct row; it is an untested one.**

**A GREEN CHECK CAN BE A TAUTOLOGY, AND THE BIT PATTERN TELLS YOU.** `Expense Ratio Check Difference` read
the engine's own expression verbatim on the same inputs and subtracted it from the stored value. It measured
**exactly 0.0 on 480 of 480 scope-years — not 1e-17, exactly zero** — while the loss-ratio check beside it,
whose numerator is back-solved from the income statement, showed real float noise on 289 of the same 480.
Bit-exact zero across the board is the signature of a self-subtraction, and from outside it is
indistinguishable from a held identity. It now rebuilds its denominator from components, and was **forced red
once** (perturbing `poolPremium` by 1% turned it to `fail` at 0.2%) to prove it can fire.

**A NUMBER CAN BE RIGHT AND THE SENTENCE BESIDE IT WRONG.** Reinsurance Recovery's layer count passed the
formula check, the hand check, and all four arms — because the *number* was correct and only its prose was
not. That needed a third KIND of check, not a fourth arm. Two claims are registered now; the second
(Reinsurance Cost, counting tower WIDTH instead of layers PLACED, wrong at line scope as well as pool) was
found by hand while fixing the first, which is the argument for registering claims eagerly.

**Guards at the endpoint:** `audit-formula-check` **EXIT 0** — no formula defect in any of four arms, every
hand-checkable row reproducing from its printed operands, every registered prose claim true. Recorded here so
a future red is unambiguous. `pool-aggregation-check` green (introduced at `9ace082`; this is its first
recapture). `roster-catalog-check` and `marketplace-generation-check` green — no roster change in range.
`ibner-null-check` green on all seven sections. No broken identities: `expectedCombinedRatio` sits within
2.220e-16 of exactly 1 on all 150 instances, and with 0 values changed the identity guard could not have
fired anyway — so it was verified directly rather than inferred from silence.

**What a reader should carry forward:** the audit page now has three independent checks over it — arithmetic,
printing, and prose — run across four decision arms, and it is green on all three. Every figure it explains
is a figure it can be held to. The engine did not move in this range at all.

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
keeping. What remains in `baselines/` is the current gate pair (v21), its
immediate predecessor (v20, the one to reach for if a v21 capture ever needs
checking), and the v11 workbook set.


---

## v22 — eleven commits: reserve development lands on claims and cedes

**⚠ THE FIRST RANGE SINCE v11 IN WHICH THE ENGINE ITSELF MOVED.** v20 and v21 were
diagnostic and display ranges that moved zero values between them. This one moves
**6,577 of 14,400 values across 74 fields**, and **all 12 export hashes differ**.

**Trigger:** seed 6TJ3HNBJ, WC year 1 — $25.65M of prior-year development, **$0 of
recovery**, net income -$23.0M against a $11.5M opening surplus. Insolvent, in a
year the line ceded 40% of its current-year gross. Reserve development moved a net
reserve BALANCE, so a pool that had bought per-occurrence cover was not protected
against it: an accident year could double in size and the tower paid nothing,
because nothing had happened to any claim.

### Per commit, against the fixed v21 reference

| commit | | added | removed | **values** | 12 hashes |
|---|---|---|---|---|---|
| `8dc3ae2` | absolute identity check | 0 | 0 | **0** | 12 MATCH |
| `101d84e` | dead field deletion | 0 | **1050** | **0** | 12 MATCH |
| `3da9ebb` | doc correction | 0 | 1050 | **0** | 12 MATCH |
| `9fc6532` | doc correction | 0 | 1050 | **0** | 12 MATCH |
| `8a3701a` | doc correction | 0 | 1050 | **0** | 12 MATCH |
| `1e05a55` | Actuarial memorandum + ledger | 0 | 1050 | **0** | 12 MATCH |
| `a1055ad` | sizing measurement | 0 | 1050 | **0** | 12 MATCH |
| `cc9d8ac` | **the mechanism** | **150** | 1050 | **6574** | **12 DIFF** |
| `b4a57a7` | perverse-incentive measurement | 150 | 1050 | 6574 | 12 DIFF |
| `6c535d1` | **the fix** | **300** | 1050 | **6577** | 12 DIFF |
| `9543cf6` | the merge | 300 | 1050 | 6577 | 12 DIFF |

Every prediction held. The two measurement commits (`a1055ad`, `b4a57a7`) moved
nothing, as scripts-only commits must. The three documentation commits moved
nothing. `101d84e` was shape-only.

**⚠ ONE SHAPE CHANGE THIS GATE CANNOT SEE.** `1e05a55` added the
`reserveDevelopment` ledger, and it reads as 0 added / 0 changed here because the
ledger lives on `LinePoolState` rather than `ResultSet`. That is the **sixth**
time this instrument's scope has mattered. It is a recording rather than a value,
so 0 changed is correct — but "the gate saw nothing" and "nothing happened" are
different statements and this row is the first.

### There is NO LINE CONTROL, so the null test is the mechanism switch

The mechanism reaches WC, GL and Property identically — no line is unaffected and
none can serve as a control. `DEVELOPMENT_CESSION_ENABLED = false` reproduces v21
**bit-for-bit**: 0 values changed, 12/12 hashes matching, `ibner-null-check` green.

**⚠ THAT NULL TEST FAILED THE FIRST TIME AND CAUGHT SOMETHING REAL.** Both paths
routed through `newUnpaid + newUnpaid * (factor - 1)`, which equals
`newUnpaid * factor` in exact arithmetic and NOT in floating point: 325 values at
~1e-12, e.g. `-260838.21407143585 -> -260838.21407143213`. Nothing had changed
behaviourally. The disabled branch now keeps the original two lines character for
character, because **a null test that tolerates reassociation cannot tell a
reassociation from a mechanism.**

### ⚠ THE FINDING WORTH CARRYING: UNDERFUNDING BOUGHT REINSURANCE

The first build shipped a perverse incentive, and it was measured rather than
guessed. Squeezed funding recovered **$27.47M more on WC** than defaults on the
SAME seeds, 95% CI [$21.20M, $33.74M], with GL (+$23.80M) and Property (+$11.92M)
diverging the same way. Total cession should be path-independent — cession on an
occurrence is `f(value)` and the yearly increments telescope to `f(final)` — so a
squeeze should MOVE cession between inception and development without changing the
sum.

The premise failed because `developingClaims` was seeded from the FULL DRAWN
values while `bookedUltimate` was `netUltimateLoss x (1 - bias)`. The unwind then
added `registerSum x bias` to claims that had never been marked down, pushing them
PAST their drawn value instead of restoring them TO it, and the extra height ceded.

Fixed at `6c535d1` by marking the register down at inception. **The markdown ALONE
would have left about $30M of it** — same order, same sign — because inception
cession is taken on the drawn register while the ledger starts from the marked one,
so a band is recognised twice. The **give-back** closes it, and the reserve
identity then forces `bookedUltimate` to carry the forfeited recovery too.

After: WC **+$0.10M** [-6.19, 6.39], GL -$2.90M, Property +$1.57M. All contain
zero. This is now a GATE (`cession-path-independence.ts`), not a measurement.

### ⚠ TWO THINGS A FUTURE READER MUST NOT MISREAD

**THE CLF TABLES ARE NOT RE-DERIVED.** Cession on development adds about **+1.4%
to E[ceded]** against a 35% baseline — roughly **0.5% on net premium**. Deferred
DELIBERATELY until the allocation rule is settled, because re-deriving before that
means doing it twice. **Read the CLF tables as pre-cession.** `wcClfGrid` already
carries an open item from an earlier deferral; this is a second one on the same
tables.

**THE ALLOCATION RULE IS `largest-3 sized`, THE MOST GENEROUS OF THE MEASURED
OPTIONS.** The dollar-weighted share of adverse development that cedes spans
**0.5% to 86%** across plausible rules on the same events, and nothing in the model
anchors it — it is the single most consequential free parameter in this mechanism.
`largest` always selects claims ALREADY over the retention, which is precisely why
WC cedes 83.6%: the subset is chosen for the property that makes it cede.
**`sizeWeighted` is implemented, is more defensible, and is one field away.** It
is not the default only because it consumes RNG draws, which would have made this
null test unreadable. Settle it at the playtest.

### Other findings from the range

**A NEW FIELD CAN BE INACTIVE IN EXACTLY THE CONFIGURATION EVERYONE CHECKS.**
`bookingGiveBack` reads **bit-exactly 0 on all 150 instances** in the absolute
identity check, because that check runs at default decisions where the bias is
zero. It is live only under a squeeze. `audit-formula-check` found bookedUltimate
stating values its own formula no longer produced by $5.9M and $1.25M, and **both
were invisible at defaults** — the sixth time that default has hidden a missing
term on that page.

**ASYMMETRIC ALLOCATION IS THE MODEL, NOT A GUARD.** Adverse development goes to
the carriers (deterioration is concentrated); favourable development spreads across
the whole register (redundancy is diffuse). A symmetric rule modelled both as
concentrated when only one of them is, and drove the subset to exactly zero 15
times in 4,320 line-years. **Now 0, with $0.00 unallocated.**

**PROPORTIONAL ALLOCATION DID NOT COST THE WHOLE REGISTER.** An occurrence below
the retention cedes nothing and a favourable movement only shrinks it, so only its
SHARE matters and one scalar carries that. Measured: 2.6 occurrences per WC
accident year reach the $1M retention, 4.8 on GL, 0.4 on Property, worst case 13.
The cession arithmetic stays EXACT rather than approximated.

**Guards at the endpoint:** `development-cession-check`, `cession-path-independence`,
`audit-formula-check`, `actuarial-memo-check`, `ibner-null-check`,
`pool-aggregation-check`, `roster-catalog-check`, `marketplace-generation-check` —
all EXIT 0. The fresh v22 capture reads `added 0, removed 0, 0 changed` with no
standing phantom line.


---

## v23 — the gates gain a squeezed arm. NO VALUE MOVED.

**Not a range. An INSTRUMENT change.** `value-identity-check` and `solo-export-guard`
both ran at `defaultDecisionSet` only. They now run **two arms**: defaults, and every
line squeezed to its own reachable minimum stop (WC 0.10, GL and Property 0.30 —
the same constants `audit-formula-check` uses, for the same reason).

Capture doubles: **14,400 → 28,800 numeric fields, 12 → 24 export hashes.**

### ⚠ WHY: THE PAIR EVERY COMMIT IS MEASURED AGAINST READ CLEAN ON A REAL CHANGE

At `932246f` a field was split in two, moving **171 instances under squeezed
funding**. Both gates reported **0 changed and 12/12 matching** — because
`bookingGiveBack` is bit-exactly 0 at default decisions, so at the only
configuration either exercised, the change did not exist.

"Both gates identical" was a statement about one configuration.

**THIRD INSTRUMENT WITH THIS BLINDNESS.** `audit-formula-check` had it and was given
a squeezed arm at `118b1fb` — which turned ONE reported defect into ELEVEN. The
absolute identity check has it and says so. This was the one that mattered most,
because it is the pair every other commit is judged by.

### The arm was proved to fire, on the exact change that slipped through

Reverting `932246f`'s split with the new arm in place:

```
VALUES — THE GATE:
  126 changed across 1 field(s):
    priorYearDevelopmentCeded   126 instances   461017.54 -> -1171954.75
```

All 126 in the `sqz|` arm. The old gate reported 0 on the same edit.

### ⚠ AND A SECOND, DIFFERENT BLINDNESS THAT AN ARM CANNOT FIX

**`solo-export-guard` still reports 24/24 MATCH on that same reverted edit**, and
the squeezed arm does not help. `priorYearDevelopmentCeded` and `bookingGiveBack`
are **not in `RESULT_METRICS`**, so they never reach the workbook this guard hashes.

That is the SCOPE blindness, not the CONFIGURATION blindness, and the two are
independent:

| gate | blind because | fixed by the arm? |
|---|---|---|
| `value-identity-check` | ran one configuration | **yes** |
| `solo-export-guard` | hashes only `RESULT_METRICS` | **no — cannot be** |

So the brief's premise at `932246f` — "priorYearDevelopmentCeded is exported, so 12
hashes move" — was wrong on the export point as well as the configuration point.
The field is displayed on three pages and is **not** in the exported workbook.
Whether it should be is a product decision and is left open; adding it would move
all 24 hashes.

The arm still earns its place on the export guard: the 12 `sqz|` hashes differ from
all 12 `def|` hashes, so it covers a genuinely different configuration for
everything that IS exported.

### The recapture launders nothing, and that was checked rather than asserted

An arm with no baseline is a gate that cannot run, so the instrument change and its
capture had to land in one commit — which is normally the thing the recapture
discipline exists to prevent. The risk was closed a different way: **the defaults
half was diffed against v22 key-for-key BEFORE the new file was written.**

```
v22 keys                14400
v23 def| keys           14400     missing 0   extra 0
CHANGED among shared        0
v23 sqz| keys (new arm) 14400
export: v22 12 hashes, v23 def| 12 hashes, CHANGED 0, new sqz| 12
```

Every v22 value reappears bit-identical under a `def|` prefix. The only new content
is a new arm on an unchanged tree.

v21 retired from the working tree; v22 kept as the immediate predecessor.

---

## v24 — the workbook gains gross/recovery/net. ALL 24 HASHES MOVE, ZERO VALUES DO.

**An export-only range, and the pair of readings is the proof.**

```
value-identity-check   0 changed of 28,800, both arms, 0 added, 0 removed
solo-export-guard      24 of 24 hashes moved
```

Every hash moving while every value holds is the signature of a change to what is
REPORTED rather than to what is computed. It is also the only reading under which
a 24-hash move is not alarming.

### What changed, checked key-for-key rather than asserted

```
RESULT_METRICS  81 -> 84 metrics
  ADDED    bookingGiveBack             Losses     "Recovery deferred by optimistic booking"
  ADDED    priorYearDevelopmentGross   Reserves   "Prior-Year Development (gross)"
  ADDED    priorYearDevelopmentCeded   Reserves   "Reinsurance Recovery (prior-year development)"
  RENAMED  reinsuranceRecovery         "Reinsurance Recovery" -> "... (current year)"
  RENAMED  priorYearDevelopment        "Prior-Year Development" -> "... (net)"
  UNCHANGED  79 of 81 pre-existing metrics, 0 removed
```

**The defect:** the workbook carried one column called "Prior-Year Development"
whose value was NET, and neither the recovery on it nor the give-back was exported
at all. A reader saw -$215,030 of development with no way to learn that $3,205,174
had been ceded on it.

**Gross is DERIVED and still carried as its own column.** Strictly redundant — it
is net minus ceded — but the defect being fixed is a figure whose meaning lived
somewhere else, and making a spreadsheet reader subtract two columns to recover
the headline number reproduces that in miniature. It cannot drift: it is computed
from its components at emit time.

### ⚠ AND A COVERAGE LOSS FROM v23 THAT NOTHING REPORTED

The squeezed arm added at `af5788a` **silently removed four assertions**, including
the only genuinely held identity the absolute identity check makes.

Detection keys on UNIFORMITY across every captured instance. Doubling the instance
set with a configuration where quantities legitimately stop being uniform dropped
`expectedCombinedRatio` (= 1), `fundingCLF`, `selectedFundingCLF` and
`bookingGiveBack` out of DETECTION entirely — so they stopped being asserted, and
nothing failed to say so. **A commit whose purpose was more coverage delivered
less.**

Fixed here by detecting PER ARM. All four return, and the split says something the
pooled form could not: `def|bookingGiveBack` is bit-exactly 0 while
`sqz|bookingGiveBack` is absent from the list — *inactive at defaults, live under
squeeze*, on the face of the report, where pooled it read as a probable tautology.

**The transferable rule, now in WORKING_PRACTICES: after widening a gate, check
what it stopped saying.** Anything inferred FROM the captured set — a
uniformity detector, a bound derived from observed magnitudes, a coverage counter —
changes meaning when the set changes, and the loss is silent because nothing fails.

v22 retired from the working tree; v23 kept as the immediate predecessor.

---

## v25 — a dead field removed. Shape only; 24 hashes move on a removed column.

```
value-identity   28,800 -> 28,500 keys, 300 removed, 0 added, CHANGED 0
                 every removed key is shockLossAmount
solo-export      24 of 24 hashes moved
RESULT_METRICS   84 -> 83, one REMOVED, 0 renamed, 83 of 84 unchanged
```

`shockLossAmount` was `shockOccurred && !isClaimLine`, and `isClaimLine` became
true for all three lines when Property got its claim generator — so the condition
had been `shockOccurred && false` ever since. Measured at exactly 0 on every
line-year in both arms.

**⚠ THE PER-ARM SPLIT ADDED AT v23 IS WHAT MADE THIS READABLE.** It sat on the
bit-exact list under BOTH `def|` and `sqz|`, which is the report shape for
*structurally dead*. `bookingGiveBack` — zero in `def`, absent from `sqz` — is the
contrast: *inactive in one configuration, live in the other*. Pooled, the two
looked identical and both read as "probable tautology".

**Recaptured in the same commit rather than deferred**, on the same argument as
v23: a guard left red for everyone is a guard people learn to skip, and this
lineage already carries the phantom `removed 300` line as the case study for
exactly that.

### ⚠ THE CARD THAT WENT WITH IT DID NOT HAVE THE DEFECT IT WAS REPORTED FOR

The "Shock Loss Event" banner was removed too, and the reason is the opposite of
the one it was flagged for. It rendered on `shockLossIncurred`, **not** on the
dead field — and `shockLossIncurred` is live: true whenever ANY claim reaches
$1M. Measured over 10 games x 10 years:

| scope | fired |
|---|---|
| pool | **100%** of years |
| WC | 93% |
| GL | 98% |
| Property | 0% (hardcoded `false`) |

So it was not a card that could never fire. It was a red warning that fired
**every single year**, which is furniture rather than a signal, and its text —
"a significant shock loss occurred, materially increasing gross losses above
expected levels" — described a shock EVENT when a $1M claim on this book is an
ordinary large loss with no connection to the shock system.

The real surfacing already existed directly above it: a per-event card carrying
each shock's band, horizon, affected lines, injected claim count and attributable
loss. Nothing needed building.

### Siblings found, not fixed

- **`catastropheFactor`** is `const catastropheFactor = 1` — a literal, exported
  to four decimals, aggregated as `first.catastropheFactor`, classified
  NO_POOL_MEANING, and multiplying nothing reachable (its only arithmetic use is
  inside the dead aggregate path). Bit-exact 1 in both arms. A stronger case for
  removal than the field actually removed here.
- **`catastropheThreshold`** is now referenced ONLY from dead code. Local, not
  exported, so no gate sees it either way.
- **The whole `!isClaimLine` aggregate path** is unreachable — the Gamma
  member-loss draw, the `lossRng.lognormal` branch of `commonLossFactor`, and
  `shockOccurred = commonLossFactor > catastropheThreshold`. It contains RNG
  draws, so removing it is a keep-the-draw question rather than a tidy-up.
- **`shockLossIncurred`** is live but mislabelled, per the table above, and
  reaches the workbook as "Shock Loss Incurred" Yes/No.

v23 retired from the working tree; v24 kept as the immediate predecessor.

---

## v26 — development allocation becomes symmetric

`DEVELOPMENT_ALLOCATION` goes from `{ claimCount: 3, weighting: 'sized',
selection: 'largest' }` to `{ claimCount: 10, weighting: 'sized', selection:
'sizeWeighted' }`, and the stochastic step routes BOTH directions through the
carriers instead of sending adverse to the carriers and favourable across the
whole register.

### Why everything moves, and why the usual null test cannot read it

| gate | reading |
|---|---|
| value identity | **13,780 of 28,500 changed** across 75 fields, **0 added, 0 removed** |
| solo export guard | **24 of 24** hashes moved |

Two independent reasons, and they cannot be separated:

1. **The mechanism itself.** Where development lands changes what cedes, which
   changes the net reserve, which changes every downstream financial.
2. **`sizeWeighted` spends RNG draws.** `buildTrackedSet` now draws once per
   carrier, before the horizon and stepMultiplier draws, so the whole `ibner`
   stream reseeds. The stream is derived fresh per (seed, year, line), so the
   shift re-aligns every January and cannot accumulate — but within a year every
   later draw is different.

So a line-by-line comparison against v25 says only "the mechanism changed", which
was already known. **A stored baseline cannot verify this commit at all.**

### What verified it instead: the mechanism-OFF fingerprint

`DEVELOPMENT_CESSION_ENABLED = false` does not call `buildTrackedSet`, so the OFF
path spends no draw and is untouched by the selection rule. Capturing it on both
sides of the change and diffing field by field:

**28,500 fields, 0 added, 0 removed, 0 differing bit-for-bit.**

Nothing outside the mechanism moved. That is the only null test this change has,
and it is recorded in `development-cession-check.ts`'s header as the procedure to
repeat next time the selection rule moves.

### What the change was for

| | before | after |
|---|---|---|
| probe ratio, WC | 2.28x | **1.06x** |
| probe ratio, GL | 1.66x | **1.02x** |
| probe ratio, Property | 1.36x | **1.03x** |
| lifetime uplift at defaults, WC | +9.9% | **+4.1%** |
| lifetime uplift at defaults, pool | +2.8% | **+0.3%** |
| site-D truncations | 4,258 of 4,258 states | **0** |
| time-mismatch residual, WC | +2.4% CI [0.6, 4.1] | **−0.6% CI [−2.2, 1.0]** |

### Two new gates, because neither standing gate could see the defect

- `development-sign-symmetry.ts` — the ±$500k paired probe on identical cohort
  state, through `STOCHASTIC_ALLOCATION_MODE` imported from the engine rather
  than restated, asserted under 1.20x.
- `cession-uplift-basis.ts` — the single-arm dollar assertion, over COMPLETE
  cohort lives against inception cession, at defaults. Limits 6% per line and
  1.5% pool-wide.

`cession-path-independence` passed throughout the defect because it takes a
paired difference and both arms were equally asymmetric. `development-cession-check`
passed because it asserts GROSS is a martingale and never asked whether NET is.

### One coverage bar was moved rather than met

`development-cession-check` asserted that no occurrence is ever driven to exactly
zero. Under the retired rule that was right: favourable development went across
the whole register, so zero required the whole register to vanish. Symmetric
routing makes zeroing *what symmetry means at the boundary* — a give-back larger
than the ten carriers hold takes them to zero, and adverse has no matching bound.
Measured: 400 occurrence-years, **87 distinct occurrences**, and **0** that later
re-inflate above the retention, which is the only case that costs anything. The
bar is now the harm rather than the event, limit 25.

v24 retired from the working tree; v25 kept as the immediate predecessor.

---

## v27 — inter-line loan proceeds reach the balance-sheet reconstructions

### The defect

The audit page's `reconstructSweep` reproduces the engine's year-end cash/investment
sweep exactly — and the sweep is where `processLineYear` stops. Inter-line lending
settles **after** it. Seed B4YHSTVN year 3: Ending Investments / Sweep read
$42,709,940 against a formula giving $16,311,943, a **$26,397,997** gap that was
exactly the loan GL had originated.

Four rows broke, all at line scope, all only when a loan fired:

| row | what was wrong |
|---|---|
| Ending Investments / Sweep | formula omitted the transfer |
| Net position, end of year | formula omitted the transfer |
| Excess Available Surplus | **stored value stale** — `capitalFundingGap` computed pre-loan |
| Tie-Out Difference | **stored value stale** — held at −0 when it should equal the transfer |

The pool row never broke: transfers net to zero across lines.

### It was not display-only

Two of the four were stale ENGINE fields, and the family is larger than the two
rows that surfaced it. `processLineYear` derives `capitalFundingGap`,
`excessAvailableSurplus`, `fundingGap`, `excessCapitalRatio`,
`capitalAdequacyRatio`, `capitalAdequacyStatus` and `surplusTieOutDifference` from
`endingSurplus`; the loan passes then move `endingSurplus` and refreshed only
`availableSurplus` and `availableFunding`. **A line that lent $43M went on
reporting the capital adequacy STATUS it had before lending.** `resyncSurplusDerived`
now re-derives all seven at every site that moves surplus after the fact — the
repayment pass, the lender credit pass, and both halves of `applyLoanAuthorizations`.

`surplusTieOutDifference` is no longer expected to be zero. A loan moves surplus
without passing through either line's income statement, so the tie-out should
equal the transfer exactly, and the row now says so.

### Two new fields, because the lender side had none

Every existing loan field is BORROWER-side. A line that lends $26M sees surplus
and investments fall with all four reading zero, so nothing downstream could tell
a lender's balance sheet from an unexplained hole in it.

- `interLineTransfer` — net movement in this line's surplus from inter-line
  lending this year. Sums to **zero** across lines by construction.
- `interLineCashTransfer` — the part that moved through cash rather than
  investments. Non-zero only when a repayment exhausted the portfolio.

Taken from the engine rather than backed out of the answer. `endingInvestments −
investmentsAfterSweep` would have reconciled every row in one line and proved
only that the row equals itself.

### Gate readings

| gate | reading |
|---|---|
| value identity | **0 changed, 0 removed, 600 added** (2 fields × 300 instances, zero in every arm) |
| solo export guard | **24 of 24 byte-identical** |

**`SOLO_EXPORT_GUARD_v27.json` is byte-identical to `v26`.** Recaptured only to
keep the two gates in lockstep; that it did not move is the finding, not an
omission — the new fields are deliberately not in `RESULT_METRICS`.

⚠ **Neither gate can see this defect, and both being green proves nothing about
it.** The loan does not fire in either gate's arms. That is why the fix landed
with the arm.

### The fifth instrument with configuration blindness

`audit-formula-check` gains a `loans` arm: every layer declined to force
deficits, and **every offer authorized** — the only arm in which
`applyLoanAuthorizations` runs at all. It reaches 3 authorizations totalling
$54.84M, 5 scope-years with an origination and 7 with a repayment, and it found
all four rows on the first run.

This is the first blind spot that was **identified, reasoned about, and closed
for a reason that turned out to be wrong.** The sweep at 9f63680 found that
offers are made freely and never accepted, and declined to add an arm because the
audit page carried zero loan references. True when checked; false as a reason.
**A row does not have to mention a mechanic to be broken by it** — the question is
whether the RECONSTRUCTION is complete, and one written before a term existed
cannot be.

The arm now fails if it reaches no origination or no repayment: an arm that stops
reaching its state reads green while proving nothing, which is how this went
unwatched in the first place.

v25 retired from the working tree; v26 kept as the immediate predecessor.

---

## v28 — number formats on both workbooks, and the rounding that made them possible

Every numeric cell in both exports was General, so `0.6853085517806616` sat beside
`42709940` in the same sheet. Four formats now apply:

| format | bucket | count on the Pool sheet |
|---|---|---|
| `#,##0` | dollars | 46 metrics |
| `#,##0.00` | ratios, multipliers, counts, factors, per-$100 rates | 26 metrics |
| `0.00%` | fractions read as percentages | 16 metrics |
| `0` | years — no thousands separator | 2 metrics |

### The two workbooks needed opposite rules

The Pool and line sheets put **one quantity per row** and a year per column, so
the format belongs to the row; a per-column rule there would format the Gross
Premium row and the Loss Ratio row identically. The claims sheets are transposed
— one quantity per column — and take the per-column rule.

Results formats are **derived from each metric's own `value()` renderer**, which
is exactly how that number is shown on screen, so the workbook agrees with the
screen by construction and a metric added later gets its format from its own
renderer instead of landing in a default bucket because nobody remembered a
second list. Claims formats are declared per column beside each header, travelling
with the builder so a column added to one without the other is a type error.

### The rounding had to go, and that is the value change

`roundDollars = Math.round` was applied to 46 `csvValue`s and `roundOrBlank` to
every claims amount, so **the exports never held cents in the first place** —
a cell displaying $42,709,940 stored `42709940`. Rounding at write time is only
ever a stand-in for a display format; with a format in place it is worse than
useless. Both are gone. A column re-summed in Excel now agrees with the engine
rather than with the accumulated rounding of its own cells.

That let `claims-workbook-check` tighten its row identity from a
`yrCols/2 + 2` dollar allowance to **1e-6** — the allowance existed only to
absorb per-cell rounding.

### Per-$100 rates are NOT in the dollars bucket

`purePremiumRatePer100`, `expectedCededPer100`, `netPurePremiumRatePer100`,
`poolPremiumRateAtSelectedClf` and `totalMemberRatePer100` render as `$1.23` via
the `dollars` helper (2dp) rather than `formatCurrency` (0dp), and are **stored at
4dp** because their precision is load-bearing. `#,##0` would print `$1` for a rate
whose whole meaning is after the point. The classifier separates them by the
renderer: a `$` with decimals is a rate, a `$` without is an amount.

### Development % is NOT in the percent bucket

Excel's `0.00%` multiplies by 100 on display, which is right for everything the
engine stores as a fraction. `Development %` is already multiplied —
`(dev/original)*100`, stored as 73 for 73% — so a percent format would render
7300%. It takes `#,##0.00`.

### Does the export guard's hash cover number formats? YES.

`sheet_to_csv` emits the **displayed** string, not the stored value, so a cell
under `#,##0` comes out as `"42,709,940"`. All 24 hashes moved and a recapture was
required.

⚠ **And that would have made the guard blind to sub-dollar drift at the exact
moment the export first carried cents.** The guard now hashes **two** renderings
concatenated — `sheet_to_csv` for the displayed shape and
`sheet_to_csv(..., { rawNumbers: true })` for full stored precision. Verified:
under the old single-hash scheme `42709939.61` and `42709939.99` collided under
`#,##0`; under the new one they differ, and a format change with no value change
also differs.

| gate | reading |
|---|---|
| solo export guard | **24 of 24 moved** — formats reach the CSV, and the rounding removal changes the values |
| value identity | **0 changed, 0 added, 0 removed** — it reads result objects, which the export layer does not touch |

**`VALUE_IDENTITY_v28.json` is byte-identical to `v27`.** Recaptured only for
lockstep; that it did not move is the statement that this change is confined to
the export layer.

### New gate

`export-number-format-check.ts` builds both workbooks, round-trips them through
xlsx **with `cellNF`** (without it SheetJS drops `z` on read and every cell looks
General — a check written without it would report the defect it was added to
catch), and asserts: every numeric cell carries one of the four formats (**0
General** across 121,993 numeric cells), years render without a separator,
identifiers stay text, percent cells still **hold fractions** with Excel
multiplying only on display, and the stored values match the engine's own
unrounded figures.

v26 retired from the working tree; v27 kept as the immediate predecessor.

---

## v29 — the payout patterns, the close rule, the seed book, and the opening

**Trigger:** four commits on `feature/payout-patterns`, recaptured together because none of the
first three recaptured on its own and all four re-roll every seed.

| commit | what it did |
|---|---|
| `3376c5f` | replaced the geometric paydown with per-line fitted Weibull payout patterns |
| `0efd0ac` | closed cohorts on a share of their own ultimate rather than a flat $1,000 |
| `accdadb` | weighted the seed book by the pattern's own unpaid share |
| this one | re-translated GL's opening band and re-centred all three pre-game pins |

**⚠ v28 predates all four, so a diff against it is not this commit's delta.** At `accdadb`, before
this commit touched anything, value-identity already read **12,072 fields changed across 73** and
all 24 export hashes moved. After this commit it reads **20,734 across 76**. The extra movement is
every seed re-rolling, which is what changing an acceptance band does.

### There is no null test, and the substitute is stated rather than implied

A mechanism-off arm is unavailable by construction: the thing that changed is *which candidate
pre-game gets accepted*, so any change to it re-rolls every seed and there is no configuration in
which the new constants produce the old games. Reporting a green gate here would be reporting a
gate that cannot see the change.

What was verified instead is the same substitute used for `sizeWeighted` — **restore only the four
numbers and prove nothing else moved.** With `STARTING_CAPITAL_TO_PREMIUM` back at 0.70 / 0.45 /
0.18 and GL's band back at [1.00, 1.49], value-identity against **v28** produces output that is
**byte-for-byte identical to the parent's** — the same 12,072 changed across the same 73 fields,
the same 300 added `nextYearPaydownRate`, the same partial-identity warnings. So the comment
rewrites, the new gate, the diagnostic edits and the baseline rename contribute exactly zero, and
the whole of this commit's value delta flows through four literals.

### What actually changed

| line | pin | band | mean redraw attempts | opening surplus/premium | opening surplus/margin p10 | opens below its margin |
|---|---|---|---|---|---|---|
| WC | 0.70 → **0.47** | unchanged | 7.25 → **1.63** | 1.081 → 1.014 | 1.37 → 1.46 | 0% → 0% |
| GL | 0.45 → **0.24** | [1.00, 1.49] → **[1.22, 1.80]** | 10.57 → **1.87** | 1.299 → 1.514 | 0.80 → **1.29** | **28.7% → 0.0%** |
| Property | 0.18 → **0.48** | unchanged | 4.81 → **2.99** | 1.346 → 1.448 | 2.56 → 1.91 | 0% → 0% |

150 solo seeds per line. Pool total 22.63 → 6.49 candidate pre-games per opening, a **71% cut** —
which is setup time paid on every session, and fifty times over for the precomputed openings.

### The defect was GL opening below its own required margin

The payout patterns lengthened GL's tail; its reserve rose 61.6% and the required margin with it,
while surplus stayed pinned to premium. The band's floor of 1.00 ended up below the margin the line
had to hold, so the pre-game was accepting openings GL could not capitalise.

### Most of that tail was the PIN, not the band

Re-centring GL's pin alone, band untouched, takes the below-margin rate from **28.7% to 4.0%**. The
old pin sat far above GL's band, so the band only ever accepted the low-surplus tail of the
candidate distribution — and a low-surplus candidate is a heavy-loss, large-reserve, large-margin
one. The residual 4.0% is the real defect and is structural.

### And that is why the first re-translation attempted here was wrong

Measured on the band-**selected** sample GL's margin/premium reads 1.119, which translates
[1.35, 2.0] to [1.51, 2.24] — 48% above the old band, a re-tune wearing a translation's clothes.
Measured **unfiltered** (band disabled, attempt 0 only) it is 0.900, giving [1.22, 1.80].

The unfiltered figure is the correct basis for two reasons: it does not depend on the band being
calibrated, and it is stable — across a 4x range of pin values it moves less than 1% (WC 0.5591 /
0.5575 / 0.5532, GL 0.8944 / 0.8942 / 0.8922, Property 0.5502 / 0.5446 / 0.5446). The selected
ratio has neither property, so translating at it is a fixed-point iteration against your own
selection effect — the same self-reference `clfTables.ts` records three passes of.

**Property's apparent case for re-translation evaporated on the same basis.** Its selected ratio
read 0.401 against a parent 0.567, a 29% move that looked exactly like GL's. Unfiltered it is
0.5446 against 0.567. The 29% was the old pin of 0.18 sitting far *below* Property's band, so the
band accepted only the high-surplus — hence low-reserve, low-margin — tail.

### Gate readings

| gate | reading |
|---|---|
| value identity | **20,734 changed / 76 fields** against v28 — expected; every seed re-rolls |
| solo export guard | **24 of 24 moved** against v28 — same cause |
| both, against v29 | green after recapture |
| both, mechanism-off against v28 | **byte-for-byte the parent's output** |
| `cohort-stock-check` | pass — WC 36.3 → 37.5 cohorts yr40→yr60, poolState growth ratio 0.65 |
| `seed-cohort-shape-check` | pass — implied ultimate spread 1.0000x on all three lines |
| `development-sign-symmetry` | pass — GL 1.02x, Property 1.05x |
| `cession-uplift-basis` | pass — pool uplift −0.2% |
| typecheck | clean |
| lint | unchanged at the pre-existing 14 errors / 7 warnings |

### New gate

`pin-vs-band-check.ts` asserts that the pre-game pin is a **proposal distribution and not a
target**: doubling it moves the accepted opening 6.3–11.8% while multiplying mean redraws 4.5–30.9x,
with no line falling back. This is the misreading that produced a whole planning round proposing to
pin opening surplus to the reserve — a change that would have moved nothing it was meant to move —
and the retired comment on `STARTING_CAPITAL_TO_PREMIUM` made the same mistake from the other end,
hunting a per-line capital rationale for an ordering that was only ever the offset between each
line's natural opening and its band.

⚠ **Neither of its thresholds is the round number it was specified with, and both reasons are
recorded in the file.** Redraws were asked for at >5x and the floor is 3x: x2.5 does put every line
over 5x, but WC falls back in 4 of 10 seeds there, and a fallback opening is outside the band, so at
that perturbation the opening assertion measures nothing. The opening was asked for at <10% and the
limit is 15%: GL moves 11.8%, because doubling its pin lifts its candidate distribution above its
band and the accepted median piles at the ceiling — a quarter of what the band alone permits and an
eleventh of the pin's own move. Shrinking the perturbation until both round numbers held was the
available alternative and would have been fitting the test to the headline.

### Recorded, not adopted: the closed form behind any future capital rule

Because the 90% CLF is a static per-line table, `margin/reserve` is an exact constant — WC 0.3294,
GL 0.5020, Property 0.5923, zero dispersion across seeds and across both pattern arms. So `J x
reserve` and `T x margin` are the same rule, and any per-line reserve pin carrying a capital
rationale puts the CLF back on the opening path — the one coupling `a3d7760` removed.

A reserve pin was proposed, measured and rejected: the only reserve in existence at year −2 is the
bootstrap draw, a static dollar band (WC $4–8M, GL $1–2.5M, Property $0.3–0.9M) with Pearson r
against seed premium of −0.014 / +0.068 / −0.008 over 200 instances, and a reserve/premium ratio
spanning 1.94x / 2.71x / 4.17x p90-over-p10. `J x seed reserve` would make opening capital
independent of pool size and 2–4x noisier than `K x premium`. It is also 3.6x / 16.9x / 14.8x
smaller than the reserve at the opening.

### Open, and deliberately not in this commit

- **Property opens at 2.76x its required margin**, so its capital constraint may never bind and the
  line may carry no capital *decision* for the player. A playtest question, not an arithmetic one.
- **A basis inconsistency being lived with**: GL's band is derived on the unfiltered ratio, WC's and
  Property's still carry `a3d7760`'s parent-selected figures. Unfiltered they would read
  [0.75, 1.11] and [1.09, 1.63] — 9% and 4% away. Neither line misbehaves, so neither is re-rolled
  for consistency of derivation alone.
- GL's 97.5 and 99 CLF stops; the fixed nominal retention. Both after the playtest.

v27 retired from the working tree; v28 kept as the immediate predecessor.

---

## v30 — the developing subset follows closure

**Trigger:** one commit on `feature/payout-patterns`. The developing subset was drawn at inception
and frozen for the cohort's life. Claims close now, so a frozen set ends its life pointing entirely
at settled files. It is reselected once per valuation instead: a closed occurrence stands down and
an open one is drawn size-weighted to replace it.

### The null test IS available here, and that is not what was expected

Every recapture since `sizeWeighted` has carried the same caveat — a selection change spends RNG,
which reseeds the `ibner` stream, so no line-by-line comparison against a stored baseline can
separate the mechanism from the reseed. **That caveat does not apply to this commit**, because the
reselection draws were deliberately routed onto their own streams, keyed on
`(seed, valuation year, line, accident year, purpose)`. `ibner` still takes exactly ten carrier
picks at inception, in the same order, at the same place.

So there is a control, and it is stronger than the mechanism-off substitute:

| control | reading against v29 |
|---|---|
| **closure forced off** (`isClosed` → `() => false`), mechanism ON | **29,400 fields, 0 added, 0 removed, 0 differing** |
| mechanism OFF (`DEVELOPMENT_CESSION_ENABLED = false`), parent vs child | **29,400 fields, 0 differing** |

The first is the one that matters. With no claim ever closing, reselection is a no-op that spends
no draw, and the tree is **bit-identical to the parent's**. Every value this commit moves is
therefore attributable to closure driving reselection, and to nothing else — not to a reseed, not
to the bench draw, not to the new fields.

### What actually changed

| gate | reading |
|---|---|
| value identity | **11,748 of 29,400 changed / 72 fields**, 0 added, 0 removed — all attributable, see above |
| solo export guard | 24 of 24 moved — same cause |
| both, against v30 | green after recapture |
| `development-cession-check` | pass — three new invariants replace the frozen-subset one |
| `development-sign-symmetry` | pass — WC 1.07x (was 1.07x), GL 1.03x (1.03x), **Property 0.88x (1.05x)** |
| `ibner-null-check` | pass |
| `paid-ledger-check` | pass |
| `closure-draw-check` | pass |
| `claims-workbook-check` | pass — after the promoted-occurrence fix below; it caught the defect |
| `cohort-stock-check` | pass — growth ratio 0.67 (limit 0.75), yr20 604.6 KB / yr40 762.3 KB / yr60 868.2 KB |
| `actuarial-memo-check` | pass |
| `cession-path-independence` | **fails, and failed at the parent too** — WC −7.3% → −8.8% |
| typecheck | clean |

### The three invariants that replace "the developing subset is frozen"

Deleting an invariant and replacing it with nothing is how the free lunch got in the first time, so
the successors landed in the same commit that retired the original. What "frozen" was protecting was
never that the set is *fixed* — it was that the set cannot be **rearranged** between the two
directions of a valuation, or between valuations for any reason other than closure.

1. **One set per valuation, both directions.** `reselectCarriers` is called once, above the step
   loop, and `live` starts from what it returns. Asserted directly against the allocator (both
   modes, both signs, one array) and by signature in-game (one movement entry per valuation, no
   occurrence recorded twice).
2. **Membership changes only by closure.** A claim leaves the carrier set only if closed and joins
   only if open and previously untracked; no open occurrence ever stands down; closure is monotone;
   a valuation with no closures spends no draw and returns the same objects.
3. **Everything at or above the retention is still tracked while open.** A closed occurrence stands
   down but stays in the register — evicting it would push its dollars into the anonymous untracked
   mass and lose its cession position.

Plus the survivors: originals frozen for the occurrences that remain, and the set never over its cap.

### `claims-workbook-check` caught a real defect on the first run

A promoted occurrence has **already moved** — it sat inside `untrackedTotal` while the proportional
unwind pushed that mass up — and none of that drift is in a `movementByStep`, because nothing was
tracking it individually. Differencing the valuation against its promotion value left
`Booked + Σ movements` short of `Current` on **151 rows, every one in the squeezed arm** where the
unwind is live. Fixed by differencing a promoted occurrence against its **booked** value, so its
whole history arrives as one entry at the valuation it becomes visible in — which is the honest
statement of what the pool knows: it was carrying the file inside an aggregate and started tracking
it here.

### The bench, and what it costs

"Draw size-weighted from the open pool" needs the pool, and by valuation time there isn't one —
everything untracked has collapsed into one scalar, which is what keeps this mechanism inside
Ruling 8. So the draw happens at inception and waits on the cohort. Depth 40, chosen by measurement:

| bench depth | no open carrier, WC | GL | Property | poolState at yr 20 |
|---|---|---|---|---|
| 0 (pure shrink) | 0.40% | 11.24% | 27.53% | 505.8 KB |
| 20 | 0.00% | 6.87% | 7.67% | 581.2 KB |
| **40** | **0.00%** | **5.62%** | **5.21%** | **610.8 KB** |
| 80 | 0.00% | 5.15% | 5.21% | 642.2 KB |

Property is flat from 40 to 80 because its **register** is exhausted, not its bench: 39 occurrences
per accident year, of which 2.7 are still open at curve age 4. **For Property a bench of 40 is the
whole register** — worth saying plainly, because it weakens this file's storage argument for exactly
one line. That argument is about WC (475 occurrences/yr) and GL (316); Property was never the case
the scalar was protecting against.

### Clamp and spill moved an order of magnitude, and almost none of it costs anything

| | parent | this commit |
|---|---|---|
| occurrence-years at exactly zero | 396 | 3,258 |
| distinct occurrences ever zeroed | 67 | 716 |
| … ever at or above the retention | — | **4** |
| … that later re-inflate above the retention | 0 | **2** (limit 25) |

A thinner, smaller carrier set is wiped by a smaller favourable movement, so zeroings rose ~11x. But
an occurrence that was never near the retention ceded nothing to lose: of 716, four were ever at or
above it and two re-inflated. The gate is on the harm, not the event, and the harm barely moved.

### ⚠ Property's sign-symmetry ratio moved from 1.05x to 0.88x, and it is closure, not the bench

The falsifier's gate is one-sided at 1.20x because it exists to catch **manufactured recovery**;
0.88x means favourable now cedes *more* than adverse, which costs the pool rather than paying it.
It still reads `ok` and it is still a real 12-point asymmetry where there was a 5-point one.

The cause is not replenishment. Sweeping the bench isolates it:

| bench depth | WC | GL | Property |
|---|---|---|---|
| parent (closure ignored) | 1.07x | 1.03x | **1.05x** |
| 0 (pure shrink) | 1.09x | 1.04x | **0.92x** |
| 40 | 1.07x | 1.03x | **0.88x** |
| 120 | 1.07x | 1.03x | **0.88x** |

Property is already at 0.92x with no bench at all, so **standing closed occurrences down is what
moves it**; the bench adds 0.04 and saturates. The mechanism: Property's retention is $5M and its
bench is drawn from occurrences below it, so as the original large carriers settle the set fills
with sub-retention files. Adverse development onto them cedes almost nothing (25.2% → 14.0%), while
a favourable movement larger than what they hold **spills** proportionally over the rest of the
register — including the large above-retention occurrences, which do give back. Favourable 15.9%
against adverse 14.0%.

**The spill was specified as a boundary condition** — "it engages only past the carriers' whole
value, so the marginal rate at any ordinary movement is untouched". On Property that assumption no
longer holds, because the carriers' whole value is no longer large. The `BOTH PROPORTIONAL` control
row in the same report reads 1.05x for Property, so the asymmetry is in the routing and not in the
tower. Recorded, not fixed: fixing it is a change to the spill rule, and putting it in the same
commit as reselection would confound the two.

The pooled dollar-weighted ratio moved the other way, from 0.86x to **0.93x** — closer to 1.

### A closed occurrence takes the unwind and takes no development draw

The stochastic step is real deterioration on a file that is still moving, so reselection takes
closed occurrences out of that set. The unwind is not development — it is the reversal of a booking
markdown taken proportionally across the whole register at inception, closed occurrences included,
since nothing had closed yet. Excluding them would leave them permanently marked down and would make
every open occurrence's share depend on how many have closed, which is a composition dependency of
exactly the kind the replacement rule is chosen to avoid. The decisive argument is the untracked
mass: closure is invisible inside a scalar, so the ~490 occurrences it stands for take their share
whatever their status, and a closed *tracked* occurrence that did not would be behaving differently
from a closed *untracked* one of the same size — an asymmetry created by a storage decision.

### Recorded, not fixed

- **The fully-closed register that is still unpaid.** A cohort can reach a valuation with every
  claim closed while it still carries an unpaid balance and still develops — 0.59% of GL
  cohort-valuations, 0.61% of Property's, worst case 19.2% of ultimate unpaid on a settled register.
  Closure is monotone and there is no late reporting, so it is neither reopening nor emergence: it
  is two clocks that never talk. Payment runs on the payout pattern in **dollars** per cohort;
  closure runs on the closure curve in **counts** per claim. `claimClosure.ts` sets out why neither
  may be derived from the other. What nothing enforces is that the count clock cannot reach 100%
  while the dollar clock is short — and at the tail it occasionally laps it. Noted at the
  reselection site, since that is where the next reader meets it.
- **`cession-path-independence` was already failing at the parent** (WC −7.3%, CI excluding zero)
  and reads −8.8% here. Same finding, slightly larger; not opened by this commit.
- **Two stale unit assertions in `development-cession-check`** print `FAIL` on the two spill cases
  and did so identically at the parent. The assertion "carriers-mode development never reaches a
  non-carrier" predates the spill path, which reaches non-carriers by design. They do not gate.
- **`end/DRAWN` in `cession-path-independence` is no longer apples-to-apples.** It compares the
  tracked set's value at the end against its inception sum, and the set can now grow by promotion,
  so the ratio moved 1.230 → 1.451 on WC largely by composition rather than by development.

v28 retired from the working tree; v29 kept as the immediate predecessor.
