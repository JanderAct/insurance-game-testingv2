# Baseline Lineage — v4 through v13

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
keeping. What remains in `baselines/` is the current gate pair (v12), its
immediate predecessor (v11, the one to reach for if a v12 capture ever needs
checking), and the v10/v11 workbook sets.
