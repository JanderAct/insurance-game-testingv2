# Calibration & Playtest Findings

Balance/tuning issues found by *playing* the game — distinct from UI polish (see
UI_REFINEMENTS.md) and from mechanical bugs. These are cases where the numbers tie out and the
code works, but the game *balance* or *realism* feels off and the underlying assumptions may need
tuning. None of these are code-structure bugs; they're 🎚️ assumption/calibration adjustments.

---

## 1. GL goes into deficit in COMBINED runs but not solo — possible multi-line engine issue
**Status:** ✅ RESOLVED & VERIFIED (fixed in instanceGenerator.ts surplus allocation; confirmed
by v4 baselines — tie-out 0 all configs, GL starts at +$9,275,461 matching the predicted value,
WC-only byte-identical to v3). See BASELINE_v4_ALL_CONFIGS.md.
**Found:** during Stage 1.6 playtesting.

**Key discovery (same seed MAMC6EA4, baseline decisions both times):**
- **GL-only run → NO deficit.** GL is healthy on its own.
- **WC + GL combined run → GL ends ~$1,771,864 in deficit**, triggering the loan prompt.

Same seed, same GL assumptions, same default decisions — the ONLY difference is whether GL runs
alongside WC. So this is **not** GL being inherently fragile or mis-calibrated in isolation.
Something about the multi-line engine changes GL's result when lines run together.

**This may be a mechanics issue, not just calibration.** Likely causes, to check:
1. **Shared-cost allocation** — pool-level costs (admin, reinsurance, investment contributions)
   may be allocated across lines so that GL is charged more in a combined game than it earns.
2. **Starting surplus split** — GL may launch with a thinner surplus in a combined game (surplus
   divided across lines) vs. holding all the surplus when solo, so the same loss year now goes
   negative.
3. **Investment income allocation** — if GL gets a smaller share of the shared portfolio's income
   than it would standalone, its surplus grows slower and can't absorb the loss.

Any of these could be **correct by design** (a line sharing a pool genuinely has less standalone
cushion) OR a **bug** (GL double-charged / under-credited). A $1.77M swing is large to be pure
surplus-splitting, which is why it's worth inspecting rather than assuming.

**Plan (chosen):** build Stage 2.1 (pool/line view toggle) first, then select GL *within* the
WC+GL combined game and read its individual premium, losses, costs, surplus, and investment
allocation directly. The cause should be visible at a glance (e.g. GL's admin expense doubled, or
GL received a disproportionately small investment-income share). Diagnose, then decide bug-fix vs.
intended-behavior.

**Reproduction:** seed MAMC6EA4, baseline decisions. Run GL-only (healthy) vs. WC+GL (GL deficits)
to see the difference.

---

### UPDATE — root cause found in the GL-only CSV: Year 1 initialization bug (NOT calibration)

Analysis of the GL-only baseline CSV (seed MAMC6EA4) found the real problem. It is a
**correctness bug in Year 1 setup**, not GL fragility:

- **GL begins Year 1 with NEGATIVE surplus: −$1,677,774.** A brand-new line should never start
  underwater. (This ~$1.68M matches the ~$1.77M combined-run deficit — same root cause.)
- **Year 1 surplus roll-forward does not tie out.** Surplus-from-Income = −$1,495,230 but Ending
  Surplus = $9,458,006, a **Surplus Tie-Out Difference of $10,953,236**. It should be ~0 (and
  correctly IS 0 in Years 2 and 3).
- By Year 2 everything reconciles (tie-out 0, surplus healthy ~$9.46M), so the bug is invisible
  unless you look specifically at Year 1's beginning surplus and tie-out line.

**Why solo looked fine but combined didn't:** the deficit check runs at year-END. In the solo
run GL climbs out of the broken negative start by year-end (ends Y1 +$9.46M), so no prompt fires.
In the combined run GL doesn't recover by year-end, so the broken start surfaces as a deficit
prompt.

**Scope:** the WC-only v3 baseline ties out perfectly (tie-out = 0 all years). So this Year 1
initialization problem affects the **additional lines (GL, and probably Property) but not WC** —
consistent with WC (the original line) getting starting surplus correctly while the newly-wired
lines have a broken opening-balance allocation.

**Reclassified:** this is a **balance-sheet correctness bug**, not a 🎚️ calibration item. Worth
fixing NOW (before Stage 2.1 and before more playtesting), because a Year 1 that doesn't tie out
corrupts every downstream number. GL's other figures look correctly calibrated (e.g. GL pure
premium rate ~1.12 per $100 payroll vs WC's ~8 — appropriately lower for a liability line).

**Likely fix area:** how starting surplus / the opening Year 1 balance sheet is allocated to
non-WC lines when the per-line structure was introduced (Stage 1.2) and lines were wired
(Stages 1.3/1.4). The beginning surplus and beginning balance sheet for GL/Property are not
consistent with each other in Year 1.

---

*(Add further calibration/playtest findings below as they come up.)*

---

## 2. Shared operating-cash creates a negligible cross-line surplus leak (~$39 by Y3)
**Status:** ✅ KNOWN & ACCEPTED — not a bug, not blocking. Documented so it isn't rediscovered
later and mistaken for an error.

**Observation:** After Stage 2.7 made GL/Property decisions editable, changing one line's
decisions produces a tiny drift in ANOTHER line's later-year surplus. Verified magnitude: $0 in
Y1, ~$0 in Y2, **~$39 by Y3 on a ~$9.1M surplus (0.0004%)**. Confirmed in the WC+GL+PR export
(WC Y3 ending surplus 9,139,481 with divergent decisions vs 9,139,442 at defaults).

**Cause:** investments are fully segregated per line (Stage 2.9), BUT the operating cash /
other-assets pot is still SHARED across lines and split by contribution weight (the Stage
1.5/2.9 mechanic). So changing GL/PR decisions shifts their surplus → shifts their slice of the
shared cash pot → nudges WC's slice → sweeps into WC's investments → slightly different income in
later years.

**Why it's accepted:**
- Economically invisible (0.0004%); no player perceives it, no decision or lesson is distorted.
- Not introduced by Stage 2.7 — the engine is byte-identical; 2.7 only made it *reachable* by
  enabling GL/PR editing. It's inherent to the pooled operating-cash design.
- Arguably realistic: even real pools with segregated investments share an operating account, so
  lines aren't perfectly financially independent.

**If ever fixed:** would require segregating operating cash per line the way investments already
are — a deliberate engine change with its own ripples (how a line pays claims if its own cash runs
dry, interaction with inter-line loans). That's its own scoped decision, NOT a patch to fold into
another stage. Only pursue if perfect dollar-level line independence is ever explicitly wanted.

---

## 3. PLANNED WORK — redo the loss distributions for all three lines (separate future change)
**Status:** planned, NOT yet started. To be done AFTER the seed-fix-per-line-opening branch is
merged and v7 is captured. Its own effort against the clean v7 baseline.

**The problem:** all three lines' loss distributions aren't working well right now. They need to be
reworked so each line has a **characteristically different loss frequency / severity / tail
pattern** — each line distinct from the other two, matching the real nature of each coverage:
- **WC (Workers' Comp):** long-tail; high-frequency / lower-severity; losses develop over many
  years.
- **GL (General Liability):** medium-tail; moderate-frequency / higher-severity.
- **Property:** short-tail but **catastrophe-exposed** — low-frequency / high-severity fat tail
  (most years modest, rare large spikes).

**Why it matters:** distinct per-line loss behavior is core to the teaching value — the lines
should *feel* like different businesses with different risk profiles, not three variants of the
same distribution. This is the "each line has a different loss and tail pattern than each other"
requirement.

**Scope note (for when it's built):** likely touches the loss-generation mechanics (currently a
Gamma draw with mean = exposure × pure premium). May involve different distribution types/shapes
per line (e.g. a fat-tail/catastrophe model for Property) and different volatility per line. This
is baseline-shifting — capture a fresh baseline after. Design the per-line loss profiles
deliberately before building (frequency, severity, tail, correlation to shock events).

---

## 4. Loss ratio appears CAPPED at 92.9% — INVESTIGATING (possible bug)
**Status:** under investigation. Found in play-testing. Likely a real bug, not coincidence.

**Observation:** the pool loss ratio repeatedly pins to exactly 92.9% across different line-years
and different games:
- Game 1 (Annual Summary): Year −1 = 92.9%
- Game 2 (Annual Summary): Year −1 = 92.9% AND Year 0 = 92.9%
Three line-years across two games hitting the identical value to the decimal — stochastic loss
ratios don't do that by chance. Strongly implies an explicit cap/clamp (e.g. Math.min(ratio,
0.929) or similar) somewhere in the loss-ratio calculation or display.

**Why it matters:**
- A pool can and SHOULD sometimes run a loss ratio over 100% (losses exceed premium) — that's the
  adverse-year risk the game is meant to teach. Capping at 92.9% hides exactly those bad outcomes.
- The cap may be masking a deeper issue — a band-aid to stop the displayed ratio looking alarming,
  or to prevent a downstream calc from breaking on high ratios. If so, removing it could surface
  whatever it was hiding, which we'd want to know about.

**Approach:** INVESTIGATE FIRST — find why 92.9% recurs, confirm whether it's an explicit cap, and
explain WHY it exists (display clamp? calculation guard? load-bearing?) before changing anything.
Don't just remove it blindly — understand what it's protecting first.

**Open question:** why 92.9% specifically? That oddly-precise number is itself a clue to where the
cap lives and what it's derived from.

### Finding 4 — RESOLVED (diagnosis + fix decided)
**Root cause (confirmed by Claude Code, arithmetically + empirically):** the Dashboard "Pool Loss
Ratio" column used the wrong numerator — `poolLosses = Math.min(grossUltimateLoss, attachment)`,
i.e. losses CAPPED at the reinsurance attachment (1.25 × expected loss). Divided by poolPremium
(CLF-loaded, ~1.346× expected), any year exceeding the attachment pins to the constant
1.25/1.346 = 0.9287 = **92.9%**. It's an arithmetic artifact, not a loss outcome, and not an
explicit clamp.
- **Affects live play too, not just pre-game** (pins whenever losses > 125% of expected). User
  first noticed it in pre-game rows only by chance.
- **Display-only bug — the math is fine.** grossUltimateLoss is uncapped; netIncurredLoss (→
  surplus/reserves/income) uses full uncapped losses; the `actualLossRatio` field is already
  correct/uncapped. NOT connected to the "openings too strong" volatility (surplus uses full
  losses).
- **Why it's wrong:** for a Self-Fund pool (default) the pool retains ALL losses including the
  excess above attachment, but the capped numerator throws the excess away — so the column can
  NEVER show an over-100% year, defeating the adverse-year teaching signal.

**Fix decided (display-only, no engine change):** change the Dashboard "Pool Loss Ratio" column to
reuse the existing **`actualLossRatio`** field (= netIncurredLoss / totalMemberCharge = net loss
over loaded premium). This is the actuarially correct loss-ratio definition, removes the cap
(can now exceed 100%), and gives ONE consistent loss-ratio definition app-wide. Touches only
display sites (DashboardPage.tsx summary card + Annual Summary columns); no engine logic.

**Deferred:** whether bad years visibly cross 100% *often/dramatically enough* is a LOSS-VOLATILITY
question, not a denominator question — revisit after the per-line loss-distribution rework (finding
3), which is the right lever. Don't fiddle the denominator to force >100% now.

---

## 5. Config-independence residual is GROWING with pool size — future issue
**Status:** accepted for now, logged for the future. Not a bug; a known consequence of retained
shared operating cash.

**Current state (after the investment + opening-tuning branch):**
- Pre-game and live Y1: strictly config-independent (byte-identical across configs).
- Y2: rare ≤1-member flip — observed on 1 of 24 config-pairs (seed MAMC6EA4, 3-line: 28 vs 27
  members), pushing that seed's WC Y2/Y3 surplus ~2% apart across configs.
- Y3: occasional flip (3 of 24 pairs) — the previously documented residual.
- Where no flip occurs, surplus drift ≤0.184% across configs.

**Mechanism (unchanged):** the live-year shared operating-cash pot, split by contribution weight.
Deliberately retained — investments are segregated per line but operating cash is not.

**⚠️ The important part — it SCALES with the pool's numbers.** Non-flip drift went from ~0.03% to
≤0.184% (roughly 6×) when investment returns rose ~40%. The coupling grows with the size of the
shared cash slice and the returns applied to it. Expect further amplification from:
- the per-line loss-distribution rework (bigger loss swings → bigger surplus swings → more
  member-retention threshold crossings)
- Phase 3 reserves (more balance-sheet movement flowing through the shared slice)

**Trajectory, not a fixed residual.** Accepting it now is right — gameplay is unaffected, every
config ties out and is internally deterministic, and no one plays two configs side by side. But if
it ever becomes visible in play, the lever is **full operating-cash segregation per line** (the
rework deliberately deferred earlier). Logged so the growth is on record rather than a surprise.

---

## 6. ✅ RESOLVED — "actual LR ~46% vs expected 66.8%" was a denominator/numerator basis error, not underpricing
**Status:** RESOLVED by the WC claim-generator work (steps 6a/6b). The loss distribution's center
was never wrong. The apparent gap was two independent basis mismatches — first a denominator
mismatch, then a numerator (net-vs-gross) mismatch — stacked on top of each other. On a consistent
basis, expected and actual loss ratios reconcile to **66.88% vs 66.84%** (a 0.04pp match). The
original finding text is preserved below the corrections for provenance, but its conclusion is wrong.

### ⚠️ CORRECTION 1 — the original ~46% was measured on a different denominator than the 66.8% target

`expectedLossRatio` and `actualLossRatio` were computed against different premium bases:

```
expectedLossRatio = expectedLoss / poolPremiumAndAdminExpense    (narrow: EL × 1.496)
actualLossRatio   = netIncurredLoss / totalMemberCharge          (wide:  EL × 2.001, incl. reinsuranceCost)
```

`reinsuranceCost` (37.5% of pool premium at the default Moderate level) sits in `actualLossRatio`'s
denominator with no counterpart in `expectedLossRatio`'s. Putting the SAME numerator over both
denominators, the ratio changes by exactly the `totalMemberCharge / poolPremiumAndAdminExpense`
factor (~1.34×) — which fully accounts for the apparent gap. This is a display/definition artifact,
not a loss outcome.

`E[commonLossFactor]` was measured directly (30 seeds × 5 years × 3 lines, 450 line-years,
`scripts/diagnostics/loss-ratio-check.ts`): **mean 1.0171** (WC 1.0079, GL 1.0268, Property 1.0165),
consistent with the `AGGREGATE_LOSS_DISTRIBUTION` design comment (theoretical ≈0.998). The earlier
prediction in finding 17 that `E[commonLossFactor] ≈ 0.69` was **wrong** — it assumed the 46%/66.8%
gap was real. It was not. There is no mis-centering to fix.

### ⚠️ CORRECTION 2 — after the claim generator, net ≠ gross, so the check numerator must be gross

The original finding ruled reinsurance out on the premise that "recoveries are zero in 13 of 15
line-years, net ≈ gross almost everywhere." **That premise is now dead.** The WC claim generator
produces real catastrophic claims (~$10M PV each) that reach the attachment: recoveries are now
non-zero in **62 of 200 line-years (31%)**, mean recovery **15.1% of gross**. Finding 9's dormant
mechanic #1 (reinsurance recovery) is live.

Consequently the only apples-to-apples reconciliation is **gross ultimate loss** over the narrow
(pricing) basis, because pricing's `expectedLoss` is itself gross:

```
gross ultimate / (poolPremium + admin) = 66.88%   vs   target 1/(CLF 1.346 + admin 0.15) = 66.84%
```

Net-incurred over the same basis reads ~57.3% — **9.5pp lower, and that is correct**: it is the
pool's reinsurance recovering real losses, not a pricing miss. Net loss ratio should be displayed as
its own (smaller) number and NEVER compared to the gross pricing target. Comparing net-incurred to a
gross-derived 66.8% is the numerator-side twin of Correction 1's denominator mismatch.

### How this was actually fixed (step 6b)

WC's `newPurePremiumPer100` is now **derived once from the analytic expectation of the claim
generator** (at RQ 5, over the full canonical roster) and held — so premium and losses share one
basis by construction (see finding 17's "apply to the draw, not pure premium" constraint). Derived
held WC pure premium: **$4.2287 per $100** (re-derived 2026-08-11 against the roster-v4 canonical
roster on `claims-distribution`). The $3.7269 previously recorded here was the roster-**v1** figure —
`PROJECT_STATE_SUMMARY.md` already documents the v1-to-v2 correction to $4.2300, essentially matching
this re-derivation; this note simply never picked up that update. This is what makes the gross
reconciliation land on target rather than by luck.

**Scope note:** this is fixed for **WC only**. GL and Property still price off the old
`commonLossFactor` / constant-based path and still exhibit the original definitional artifacts. They
will be reconciled the same way when their claim generators are built. Until then, cross-line loss
ratios are not comparable, and the cross-line premium split (WC ~19% / GL ~48% / Property ~33%) is
**not** a considered balance — it is one reconciled line beside two legacy approximations still
scaled for the old $272M-payroll book.

### ⬇️ Original finding preserved below (conclusion superseded by the corrections above)

**Observation.** The pricing assumes a 66.8% expected loss ratio (expected combined ratio exactly
100%). Actual results, across 4 random seeds × 3 lines × 5 years:
- 2 of 60 line-years reached or exceeded the expected 66.8%.
- Mean actual loss ratio ≈ 46%.
- Actual combined ratios run 57–102% (mean ~80%) against a designed 100%.
- Pool surplus growth at pure default decisions: +112%, +137%, +108%, +139% over 5 years.

These observations were real; the *inference* that they showed underpricing was the error. The
"2 of 60 above expected" symptom was itself a product of comparing against a target computed on the
wrong (narrow) basis — on the correct basis the per-line-year distribution is centered, roughly half
above and half below. The candidate causes listed originally (pure-premium above the draw mean, CLF
stacking, trend inflation, mean/median confusion) were all investigated and none was the cause; the
cause was the basis mismatch in the two displayed ratios.

### ⚠️ CORRECTION 3 — the Expected Combined Ratio was *constructed* to read 100%

Same root cause, third surface. The mixed-basis error has now surfaced three times:

| | what was mixed | how it presented |
|---|---|---|
| Correction 1 | expected loss ratio on the narrow basis vs actual on the wide basis | "actual LR ~46% vs 66.8% expected" — an apparent 20-point underpricing that did not exist |
| Correction 2 | net-incurred numerator against a gross-derived target, once reinsurance recovery went live | WC 6b appearing to fail at ~57% when the gross basis read 66.88% |
| **Correction 3** | **a narrow-basis loss ratio added to a wide-basis expense ratio** | **Expected Combined Ratio reading exactly 100% every year** |

The combined ratio was computed as `expectedLossRatio + expectedExpenseRatio`, where

```
expectedLossRatio    = expectedLoss / poolPremiumAndAdminExpense   (NARROW — excludes reinsurance)
expectedExpenseRatio = 1 - expectedLossRatio                       (a RESIDUAL, not an expense measure)
expectedCombinedRatio = 1                                          (hardcoded)
```

**The expense ratio was not an expense ratio.** It was `1 − lossRatio`, a residual reverse-engineered
so the two terms would always sum to 1.0 — and the combined ratio was then hardcoded to 1 anyway.
The display was therefore not merely *inconsistent*: it was **constructed to report 100% whatever the
pricing did**. No pricing change, funding-confidence change, or reinsurance change could ever have
moved it.

**That is why nothing looked wrong for the life of the project.** Five playthroughs showed surplus
tripling over five years while the display insisted the pool was priced to break even, and the two
facts never confronted each other because the "break even" figure was an identity, not a
measurement.

**The true figure.** On a consistent member-charge basis at the default CLF 1.346:

```
totalMemberCharge = EL x (CLF 1.346 + admin 0.15 + reins 0.375 x 1.346) = 2.001 x EL
expected loss ratio  = 1 / 2.001                = 50.0%
expense ratio        = (0.15 + 0.5048) / 2.001  = 32.7%
EXPECTED COMBINED    = 82.7%
```

The pool is designed to earn **17.3 points of underwriting margin** at the default funding
confidence. That is correct behaviour for a 75%-confidence risk margin — the margin was never the
bug, the display was. Verified at both ends: 82.7% at the default CLF, and exactly 100.00% at CLF 1.0
where numerator and denominator become algebraically identical (the confidence slider has no 1.0
entry; 0.60 gives CLF 1.003 and reads 99.80%).

**What was kept.** The narrow-basis ratio survives as its own labelled metric, *Expected Loss Ratio
(pricing basis)*, because it is the correct basis for the finding-6 reconciliation and the WC/GL 6b
harness checks depend on that exact definition. Both bases are now labelled at every surface — export,
results display and audit page — and the audit page carries a reconciliation check asserting that
loss + expense = combined exactly on the member-charge basis. That check cannot fail while the bases
agree, which is precisely what makes it a regression guard: it goes red the moment a
mixed-denominator term is reintroduced.

**The generalisable lesson.** A ratio whose denominator is not stated in its name is a latent version
of this bug. Three times now, two quantities that looked comparable were not, and in the worst case
the inconsistency was *stabilised* into an identity that could never look wrong. Where a derived
metric is defined as `1 − something`, ask what would happen if the underlying values moved — if the
answer is "nothing", it is not measuring anything.

## 7. Property's loss volatility is too SMOOTH for a catastrophe-exposed line
**Status:** confirmed on the reference seed. Belongs with the loss-distribution rework (finding 3).

**STATUS UPDATE:** still open, and now the ONLY remaining line-level loss-distribution problem. WC
and GL have claim-level generators; Property is the last line on the legacy aggregate path.

Actual loss-ratio spread over 5 years, reference seed:

| Line | Range | Spread |
|---|---|---|
| WC | 38–57% | 19 pts |
| GL | 29–68% | 39 pts |
| Property | 32–43% | **11 pts** |

**Property is the steadiest book in the pool** — the narrowest spread of the three — which is
backwards. It's the catastrophe-exposed line and should carry the fattest tail, occasionally
producing a genuinely bad year. Its gross losses only move between $3.01M and $4.45M across five
years; that is not how property cat risk behaves.

This is a distinct problem from finding 6: that one is about the **mean** being centered too low,
this one is about Property's **tail** being too thin. Both are loss-distribution work — calibrate
the centering, then shape the per-line tails (WC high-frequency/low-severity, GL
moderate-frequency/higher-severity, Property low-frequency/catastrophic).

---

## UPDATE to findings 2 and 5 — money-side config coupling ELIMINATED (v10)
**Date:** after the otherAssets/otherLiabilities removal (branch remove-other-assets-liabilities).

**Result:** max no-flip cross-config surplus drift went from **0.184% → 0.0000%**. The money-side
coupling is gone entirely. WC's ending surplus is now identical to the dollar across WC-only and
WC+GL for all years.

**Why (structural, not luck).** Previously a single contribution-share vector had to split THREE
shared pots — cash, otherAssets, otherLiabilities. Reproducing each line's stored surplus only
constrains the *net* of those three, so each line's individual **cash** slice was slightly wrong.
Cash is what earns investment returns, so the error leaked into investment income and surfaced as
cross-config drift. With cash as the only shared pot, the contribution-share weight
(surplus + netReserve − invested) now equals each line's implied cash slice **exactly** — no
remaining degrees of freedom to be wrong in.

**What survives:** the rare roster-fold flips only — a member withdrawing from one line changing
another line's recruitment pool. Counts unchanged: Y2 flip on 1 of 24 config-pairs, Y3 on 3 of 24,
clean on 20 of 24. Same seeds, same years as before.

**Revised residual description (supersedes the wording in findings 2 and 5):**
> Pre-game and live Y1 strictly config-independent. Y2 rare ≤1-member roster flip (1 of 24
> config-pairs); Y3 occasional (3 of 24). **Zero money-side drift** — non-flip cross-config surplus
> drift is exactly 0.0000%. Remaining divergence is roster-fold only, not financial.

**Finding 5's trajectory concern is now largely obsolete.** It warned the residual grew ~6× when
investment returns rose 40%, and predicted the loss-distribution rework and Phase 3 would amplify it
further. That amplification mechanism was the money-side coupling, which no longer exists. The
roster-fold effect could still grow with more loss volatility (more withdrawals → more
recruitment-pool interaction), but it is not sensitive to the size of the pool's numbers. **Full
per-line cash segregation is no longer needed to address the financial coupling** — it would only
address roster-fold, which is a different and much smaller concern.

---

## 8. ⚠️ The opening-band reject-and-redraw is CHAOTICALLY sensitive
**Status:** discovered during the self-funded-discount removal. Not a gameplay problem — a
verification and calibration problem. Worth addressing before the loss-recentering work.

**Observation.** Removing the self-funded discount raised premium ~1%. That shifted the K × premium
capital target, which shifted opening multiples, which flipped which pre-game attempt passed the
band test on **9 of 72 seed-lines (12.5%)** — including the reference seed: **MAMC6EA4 GL went from
attempt 8 to attempt 4**, landing at 1.358× (barely inside the 1.35 floor). By contrast the
otherAssets removal produced zero re-rolls.

**Mechanism.** Each redraw attempt is an entirely different history (`seed + attempt × 997`). So a
flipped attempt is not a perturbation — it is a different game. The reject-and-redraw is a
**discontinuous function of its inputs**: an infinitesimal input change produces wholesale output
change. Lines needing many attempts are most fragile (more boundary crossings available to flip),
and a line sitting near a band edge (GL now at 1.358×) will likely flip again on the next change.

**Why it matters — and why it doesn't.**
- **Gameplay: harmless.** Any accepted history is valid. A player neither knows nor cares which
  attempt produced their game.
- **Verification: significant.** Baseline comparison stops being able to distinguish "my change
  broke something" from "the redraw flipped, this is a different game."
- **Calibration: significant.** Any iterative tuning loop is fighting a moving target — each tweak
  re-rolls the seeds being measured.

**⚠️ This will get much worse at the loss-recentering fix (finding 6).** That change moves losses
~45%, so reserves, required margin, and premium all shift substantially — nearly every seed will
re-roll. And the fix is inherently iterative (tune, measure, tune), so each pass scrambles the
measurement basis.

**Two ways out (both previously discussed in other contexts):**
1. **Iterative solve instead of reject-and-redraw.** Run the pre-game, observe required margin, then
   SCALE opening capital to hit a target multiple drawn in-band, and converge. Small input changes
   then produce small output changes — stable, no attempt-flipping possible.
2. **Precomputed opening states.** Openings become fixed data generated by a build-time tool, so no
   runtime redraw exists to flip. This finding is the strongest argument yet for that architecture —
   it is not merely that the bootstrap has been bug-prone, but that it is chaotically sensitive and
   will fight every future calibration pass.

**Recommendation:** address this BEFORE the loss-recentering work, so that work has a stable
measurement basis.

---

## 9. Four risk mechanics are currently UNREACHABLE — all from the same root cause
**Status:** measured, not a bug in any individual mechanic. All four become reachable once finding 6
(loss centering) and finding 7 (Property's tail) are fixed. Recorded as a baseline to compare against
after that work.

**STATUS UPDATE:** mechanic #1 (reinsurance recovery) is LIVE. WC recoveries fire in 31% of
line-years (mean 15.1% of gross); GL produces an occurrence over $1M in 80% of enrolled line-years.
The remaining mechanics await Property's generator and the retention waterfall.

Losses currently run at ~46% loss ratio against a 66.8% pricing assumption (finding 6). The
consequence is broader than "the game has no stakes" — roughly a third of the built risk machinery
cannot activate:

| Mechanic | Current activation | Why dormant |
|---|---|---|
| Reinsurance recovery | 2 of 15 line-years | losses rarely reach the 1.25× expected attachment |
| Loss ratio above 100% | 2 of 60 line-years | losses ~46% vs 66.8% expected |
| Property catastrophe risk | 11pt LR spread — *narrowest* of the three lines | tail too thin (finding 7) |
| Operating-cash liquidity floor | **0 of 2,322 scope-instances** (43 seeds × 3 configs × 6 years) | losses never strain cash |
| Zero-investments floor | **0 of 2,322 scope-instances** | no line ever takes an investment loss exceeding its opening portfolio |
| Dividend-blocked-by-surplus condition | never observed in testing | surplus never thin enough to block a dividend |

Six different systems on six different code paths, all inert for one reason. These are not six
calibration problems; they are six symptoms of one.

**The two floors were measured at identical scale (0 of 2,322 each)** during the audit-page work. Both
are consistent with the same root cause plus a bonds-heavy default allocation — neither cash nor the
portfolio is ever stressed, because losses never get large enough to stress them.

**Implication for sequencing:** mechanics have been built that cannot fire. Finding 6 is therefore
higher-leverage than it appears in isolation — fixing it activates existing machinery rather than only
changing numbers.

**The liquidity floor is now a useful indicator.** Audit check #15 ("Ending cash / operating cash
sweep") reconstructs the sweep exactly and flags when the floor binds — i.e. a line cannot liquidate
enough investments to reach its operating-cash target. Zero events today. After the loss work, a floor
event rate somewhere between "never" and "constantly" is roughly the calibration target for the
player-facing liquidity mechanic (choose how to cover a shortfall: sell bonds, sell equities into a
possibly-down market, levy an assessment, borrow from another line). Watching this check is how you
know that mechanic has something to bite on.

---

## 10. Competitive pressure has no effect — reinsurance cost min and max are identical
**Status:** found while adding numeric formulas to the audit page. Distinct from finding 9's dormant
mechanics, and much cheaper to fix.

**STATUS UPDATE:** now unblocked. This finding was deferred pending recovery-frequency data, which
the claim generators now supply. Reinsurance can be priced actuarially from E[ceded] computed
directly off the claim distributions rather than as a flat % of premium. Resolve as part of the J10
waterfall work.

**Observation.** Reinsurance cost is computed as
`costPct = max − competitivePressure × (max − min)`. But every program in REINSURANCE_PROGRAMS has its
min and max cost both set to `quotaShare × 50%`, so **max − min = 0.0%** and the pressure term multiplies
against nothing. On the reference seed `competitivePressure = 0.35068` — a live, per-seed value that
changes no outcome whatsoever.

**⚠️ UPGRADED — full scope and dollar impact (from a later dedicated investigation):**
- **Every level is collapsed**, not just Moderate: Self Fund 0/0, Low 25/25, Moderate 37.5/37.5,
  High 45/45, Full Transfer 50/50.
- **Root cause is a literal copy** — `costPctOfPremiumMin` and `costPctOfPremiumMax` are written as the
  *same expression* for all four paid levels (`defaultAssumptions.ts:148-179`). Not an unset field
  null-defaulting; the same line pasted into both keys.
- **Reinsurance has therefore ALWAYS been priced at the program ceiling** — in every game ever generated
  at any paid level, on every line, for every seed (confirmed across 20 additional seeds; cost was
  exactly 37.50% in all 20 despite `competitivePressure` ranging 0.30–0.80).
- **Dollar impact: $29.7M over 3 years on the default 3-line seed = 25.2% of total member charge.**
- `competitivePressure` is **half-alive, not dead** — its second consumer (`membershipEngine.ts:96`,
  new-member attraction) works as designed. Only the cost consumer is neutralised.

**This reframes the deferred reinsurance-value question.** Reinsurance looked like poor value because
recoveries fire in only 2 of 15 line-years at 37.5% of premium — but 37.5% is the *ceiling*. With a real
band, typical competitive pressure would price it materially lower. There are two separate causes
(structural overpricing AND losses too small to trigger recovery), previously conflated as one.

**Why it differs from finding 9.** Those six mechanics are dormant because losses are too small to reach
their triggers — they need the loss recentering. This one is dormant because a parameter *range collapsed
to a point*. Separating the min and max would activate it immediately; it is a tunables change, not
structural work.

**What it would add if activated.** Reinsurance pricing would vary with market conditions — a soft market
(low pressure) charging near the program maximum, a hard market charging less, or the reverse depending on
which direction is intended. That is a real dynamic in reinsurance purchasing and currently absent, which
also means the reinsurance decision is more static than intended: cost is a fixed percentage of premium
per level, with no market cycle.

**Worth pairing with the reinsurance economics review** deferred earlier. Recoveries currently fire in
only 2 of 15 line-years (losses rarely reach the 1.25× attachment), so reinsurance is poor value at any
price. Both the value question and the pricing dynamic want revisiting after the loss recentering — at
which point separating min and max is the natural moment to give competitive pressure something to act on.


---

## 11. The catastrophe mechanism EXISTS in the code but is switched off
**Status:** discovered during a dedicated audit-page investigation. Directly connected to finding 7 —
likely the same problem.

**SCOPE UPDATE:** now line-specific. WC and GL no longer use commonLossFactor or the hardcoded
catastropheFactor path, and risk control applies to their draws (genuinely effective, not a no-op).
Both findings remain true for Property, which is still on the legacy aggregate path.

**`catastropheFactor` is hardcoded to 1** (`simulationEngine.ts:210`), then multiplied into every
member's simulated loss (`:232`):

```
const catastropheFactor = 1;
simulatedLoss: independentLoss * commonLossFactor * catastropheFactor
```

A multiplier positioned exactly where it would create fat tails, neutralised to a no-op rather than
removed. It is stored and aggregated to pool level but never displayed anywhere.

**Two related pieces are also present:**
- `shockLossAmount` — computed and stored every year, decomposing how much of the year's loss sat above
  a catastrophe threshold. **Never displayed anywhere**, never added into any total (so not a
  double-count — it is a legitimate decomposition metric nobody can see).
- `shockLossIncurred` — a boolean that IS consumed, by ResultsPage.

**Why this matters, and why it is good news.** Finding 7 records that Property's loss volatility is the
*narrowest* of the three lines despite being the catastrophe-exposed one. Here is a catastrophe amplifier,
in the right place, disabled. Together with a threshold concept and a loss decomposition already
computed, the skeleton of a catastrophe mechanic is in the code — someone built it and switched it off.

**Implication for planning:** the per-line loss-tail work (finding 7) and Phase 4 shock events may be
substantially **re-enablement and calibration rather than greenfield construction**. Worth auditing what
already exists before designing catastrophe modelling from scratch.

---

## 12. Gross presentation distorts the displayed ratios (~23 points)
**Status:** confirmed not a defect. Display/interpretation risk only. Low priority.

The GASB statements show reinsurance cost and the admin fee **gross** — each appears as both a revenue
line and a matching expense line. This is deliberate and correct pool presentation, and it is
**net-income-neutral**: the terms cancel algebraically (verified at $0.0000 difference; a genuine
double-count would have been ~$9.5M off on the test year).

But a ratio cannot cancel the way a subtraction does:

| Presentation | Expense ratio |
|---|---|
| Stored (gross — both sides include ceded) | 32.73% |
| Fully net (ceded excluded from both sides — standard P&C) | 10.03% |

**A 22.7-point swing on identical underlying economics.** No gameplay mechanic consumes the ratio fields
(retention, attraction, financial-strength scoring and rate-setting all key off premium/surplus directly),
so nothing in the simulation is misled.

**The risk is credibility with an actuarial audience.** Anyone benchmarking a 32.73% expense ratio against
a real pool's *net* ratio would be comparing gross to net and drawing a wrong conclusion. Worth
considering showing a net-of-reinsurance ratio alongside the gross figures — a display decision, not a
defect fix.

---

## 13. The audit page displays a WRONG loss-trend assumption
**Status:** confirmed defect, quantified. Not yet fixed (found during a display-only pass; the audit page
doesn't currently receive `instance.lossEnvironment` at all).

The "Pure Premium Rate per $100 Payroll" row displays the **global default lossTrend of 4.00%**, but the
engine uses the **per-instance `instance.lossEnvironment.lossTrend`**. Verified on real seeds: they differ
on **7 of 7 tested seeds, by up to 1.88 percentage points — a 47% relative error on a 4% base.**

Worse than an unconvertible formula: an audit page showing an assumption that isn't the one in use is
actively misleading. A reader would reconcile against the wrong number and conclude the engine was wrong.

**Fix:** pass `instance.lossEnvironment` to the page and display the actual value. Small, but it needs the
prop threading.

## 14. ⚠️ ANSWERED — loss trend IS a no-op, and the reason is architectural
**Status:** CONFIRMED. See finding 17 for the root cause, which is bigger than trend.

**Answer: trend is loss-ratio-neutral by construction — not two synchronised assumptions, but ONE
variable feeding both sides.**
```
newPurePremiumPer100 = purePremiumPer100 × (1 + lossTrend) × (1 − RCEffectiveness)
losses:  memberExposure × newPurePremiumPer100 × 10,000   (Gamma mean)
premium: exposure × newPurePremiumPer100 × CLF × rateLevel
```
Divergence is structurally impossible. Confirmed empirically over 12-year games × 5 seeds × 3 lines:
premium CAGR vs expected-loss CAGR differ by **exactly 0.000pp on every seed**; loss-ratio slopes scatter
8 positive / 7 negative (pure `commonLossFactor` noise, LR std dev ~11pp).

Only one consumption site: `simulationEngine.ts:91`, used at `:111`. One draw per instance
(`rng.range(0.02, 0.07)`), shared by all lines — **there is no per-line trend.** Observed values 4.41%–5.71%
across seeds.

**Verdict: the planned work is "separate two trends that are currently one number," not "add trend."** The
loss side needs its own inflation path (actual ≠ assumed) while pricing uses the assumed trend. The gap
between them is what would show in the loss ratio.

**(Original concern, now confirmed, retained for context below.)**

## 14b. Original statement of the concern
**Status:** superseded by the answer above. This question was never put to Claude Code (drafted after the prompt was sent).
Answer it before any trend work.

**The concern.** Each member's simulated loss is a Gamma draw whose mean is
`memberTIV × purePremiumPer100 × 10,000` — so the loss draw's centre derives from `purePremiumPer100`. And
`purePremiumPer100` appears to be trended year over year by `lossTrend`.

**If both are true, trend moves premium AND losses at the same rate** — making it loss-ratio-neutral and
therefore invisible. It would change the absolute size of everything and the relationship between nothing.

**Supporting evidence.** Across the 5-year games, loss ratios show no systematic drift (WC 48.5/46.0/53.5/
57.2/43.2; GL 63.8/44.0/57.1/65.3/48.4). If pricing and losses trended at *different* rates, the ratio
would drift in one direction over five years. It doesn't. So finding 6 is a **level** miscalibration, not a
growth-rate divergence — consistent with trend applying equally to both sides, or not at all.

**Consequence if confirmed.** The treadmill dynamic doesn't exist: holding rates flat cannot erode margin,
because the rate trends automatically with the losses. This is the same "inaction is safe" problem noted
for CLF-only pricing — except it is already the case today.

**Questions to answer:** every consumption site of `instance.lossEnvironment.lossTrend`; whether it trends
`purePremiumPer100`, the loss draw, or both; whether any path lets the pricing assumption diverge from
actual loss growth, or whether they move in lockstep by construction; actual trend values per seed and
whether they differ per line.

**This determines whether the planned trend work is "add trend" or "separate the two trends that are
currently the same number."** Very different jobs.

## 15. Two payment-timing assumptions, one visible and one hardcoded
**Status:** logged. Not a defect; a transparency and configurability gap.

`simulationEngine.ts:293` contains inline literals:
```
currentYearNetReserve = netUltimateLoss * 0.60
netPaidCurrentYear    = netUltimateLoss * 0.40
```
This 60/40 current-accident-year paid/unpaid split is **hardcoded and invisible** — not sourced from
`RESERVE_PAYDOWN_PCT` (35%, in defaultAssumptions.ts, visible and configurable) or any other named
constant. The two govern different things: 60/40 the current accident year, 35% ongoing older-cohort
runoff.

**Why it matters:** the ACFR current/noncurrent liability split derives from the *visible* paydown rate, so
the statements present one payment-timing assumption while the current year uses another that nobody can
see or tune. Worth promoting to a named assumption when the reserve work happens.

## 16. `riskControlEffectiveness` is invisible by construction
**Status:** logged. Trivial to fix.

`riskControlEffectiveness` multiplies pure premium and accumulates/decays per line, but is **never copied
into the returned result object** — so it exists nowhere in any output and cannot be displayed or audited.
A pricing input invisible by construction.

**Fix is trivial:** already computed each year in `processLineYear`; a two-file change
(`types/simulation.ts` + `simulationEngine.ts`) to include it in the result. Zero new computation.

**Worth doing before the loss work** — it multiplies pure premium, so any calibration pass wants it
visible.


---

## 17. Pure-premium multipliers are neutralised (NARROWER than first written — see correction)
**Status:** real, but SCOPED. An earlier version of this finding overstated it as "no loss-side mechanic can
affect the loss ratio." That is wrong and the correction matters for sequencing.

**SCOPE UPDATE:** now line-specific. WC and GL no longer use commonLossFactor or the hardcoded
catastropheFactor path, and risk control applies to their draws (genuinely effective, not a no-op).
Both findings remain true for Property, which is still on the legacy aggregate path.

### ⚠️ CORRECTION — what is and isn't neutralised
```
Gamma mean:      memberExposure × newPurePremiumPer100 × 10,000
simulated loss:  independentLoss × commonLossFactor × catastropheFactor
premium:         exposure × newPurePremiumPer100 × CLF × rateLevel
```
`purePremiumPer100` cancels between the two sides. Therefore:

| Factor | Applied to | Neutralised? |
|---|---|---|
| Loss trend | pure premium | **YES** — cancels |
| RC effectiveness | pure premium | **YES** — cancels |
| `commonLossFactor` | the draw, after the mean | **NO** — moves the loss ratio |
| `catastropheFactor` | the draw, after the mean | **NO** — moves the loss ratio |
| Gamma variance / tail shape | the draw's dispersion | **NO** — moves loss-ratio volatility |

**Consequence: findings 6 and 7 are NOT blocked by this.** Centering and tail shape are both draw-side and
will show up in the loss ratio. Only trend and risk control require the pricing coupling to be broken.

**A testable prediction for finding 6.** Since `E[loss ratio] ≈ E[commonLossFactor] / (CLF × rateLevel)`,
and actual runs at ~69% of expected, `E[commonLossFactor]` is probably **≈0.69 rather than 1.0**. If so,
finding 6 is a one-parameter fix. If it measures 1.0, the gap lives elsewhere. Cheap to check and it would
resolve the largest open finding.

**UPDATE:** measured at 1.017, not 0.69 — see finding 6, Correction 1. The 0.69 guess assumed the
46%/66.8% gap was real; it was a denominator artifact, so there is no mis-centering to fix.

### The original (correctly scoped) finding follows

**The mechanism.** `newPurePremiumPer100` drives BOTH the loss draw's mean and the premium calculation:
```
losses:  memberExposure × newPurePremiumPer100 × 10,000
premium: exposure × newPurePremiumPer100 × CLF × rateLevel
```
Therefore **no loss-side mechanic can affect the loss ratio.** Any factor applied to pure premium moves
premium and losses in lockstep and cancels.

**Two mechanics already confirmed neutral by this:**
- **Loss trend** (finding 14) — 0.000pp CAGR difference across all seeds.
- **Risk control** — RC effectiveness multiplies `newPurePremiumPer100` itself
  (`simulationEngine.ts:112`), so spending reduces expected losses AND collected premium proportionally.
  Loss ratio unchanged, and the spend is a real expense. Real risk control spends money so losses fall
  *relative to* premium; here both fall together and the cost is pure drag, offset only by a capital-ratio
  effect and the satisfaction bump. **Backwards from how loss prevention actually works.**

**And it would neutralise future work too.** Wiring up `shockSeverityMultiplier`, `volatility`,
`heavyTailRisk`, or re-enabling `catastropheFactor` would hit the same wall if applied via pure premium.

**⇒ The actuarial indication is what makes TREND and RISK CONTROL meaningful** (not the loss work in
general — see the correction above).

Once pricing is based on an **estimate** of pure premium (experience, developed, trended,
credibility-weighted) rather than the true parameter, every loss-side change creates a gap between what was
charged and what happened. Trend becomes a treadmill. Risk control genuinely pays. Catastrophes hurt. The
soft-market trap becomes reachable.

**Sequencing consequence (revised):** distribution work goes FIRST — it is unblocked, and it activates the
six dormant mechanics in finding 9. The indication follows, and is required for trend, risk control, and
the estimation-error lessons.

## 18. The entire lossEnvironment is dead except lossTrend
**Status:** five dead per-instance parameters. Directly relevant to findings 7 and 11.

`lossTrend` is the **only** `lossEnvironment` field consumed anywhere. Drawn per instance, typed, and never
read:

| Parameter | Evident intent |
|---|---|
| `baseLossRatio` | per-instance loss level |
| `volatility` | per-instance loss variability |
| `shockProbability` | frequency of catastrophe years |
| `shockSeverityMultiplier` | severity amplification in a shock year |
| `heavyTailRisk` | fat-tail exposure |

All superseded by flat constants (`AGGREGATE_LOSS_DISTRIBUTION`, `MEMBER_LOSS_VOLATILITY`).

**Two implications.**

**These are exactly the parameters findings 7 and 11 need.** Property's tail is too thin;
`catastropheFactor` is hardcoded to 1; and here sit `shockProbability`, `shockSeverityMultiplier`, and
`heavyTailRisk` — designed, drawn, never connected. **The catastrophe and volatility system was built and
abandoned**, not merely absent.

**Per-instance draws mean the original design gave each seed its own loss environment** — some volatile,
some calm, some shock-prone. That is the scenario variety wanted for instructor-assigned play, already
scaffolded and inert.

**Caution:** apply them to the DRAW (like `commonLossFactor` and `catastropheFactor` already are), not to
pure premium. Applied to pure premium they would cancel against pricing; applied to the draw they move the
loss ratio as intended. See the correction in finding 17.

---

## 19. Design-doc reference figures are systematically stale post-canonical
**Status:** documented pattern, no action needed beyond awareness.

Three separate design-doc aggregate figures came in materially off once built against the canonical
roster with fully-specified mechanics: WC's "~$19-20M gross" (actual scale far higher once the
catastrophic annuity was modeled), GL general frequency "~832/yr" (roster-derived 897 — the figure
assumed a mean GL relativity of 1.0 where the roster runs ~1.08), and GL ALAE "~35% of cost"
(measured 42.6%). None is an implementation error; each is a reference figure computed against
assumptions the real roster and the full mechanics don't satisfy.

**Rule going forward:** design-doc aggregate dollar/percentage targets are REFERENCE ONLY. Assert
structural ratios (frequencies vs roster-derived analytic, pay rates, draw-vs-expectation
invariants) and REPORT dollar totals. Never tune parameters to hit a stale aggregate.

## 20. GL ALAE runs 42.6% of gross, not the design's ~35%
**Status:** structural and correct; documented so it isn't "fixed" later.

The stage-keyed ALAE model (B4) puts real weight on the 2.5x and 6.0x multiples. Claims tried to
verdict and LOST carry maximum defense cost with zero indemnity — 3.47% of the book, mean ALAE
$0.20M against $0.04M for all claims. The 42.6% is what the specified stage mix produces; the ~35%
reference predates it. This is the design's intended non-monotone behavior working, not a defect.

## 21. GL's combined RQ cost ratio undershoots its stated beta budget
**Status:** open, low priority, individually-verified channels.

Measured combined total-cost ratio across the full RQ range is 1.953 against the design's
exp(10 x 0.084) = 2.316 — a ~16% shortfall on the headline budget. Both individual channels verify:
frequency beta brackets 0.055 (1.3199 low-side vs 1.3165 design; 0.7746 high-side vs 0.7596), and
the gate gamma tracks pay rates within 0.4pp at every RQ level. So the channels are right but do not
compound to the stated total. Some of the gap is tail noise (alpha=1.3), but likely not all. The
design labeled 0.084 as "realized beta ~", so the target itself may be approximate. Worth revisiting
when GL's tail has more sample, but not blocking.

## 22. The cat/weather AAL identity omitted the intensity-squared term
**Status:** RESOLVED before implementation. Recorded because the general rule generalises.

**The error.** The original cat and weather AAL identity was written as

```
AAL ~ lambda x footprint x zone_TIV x mu
```

treating intensity as if it entered once with mean 1. It enters **twice** — once through the
footprint (`hit_rate = min(base_footprint x intensity, cap)`) and again through the damage ratio
(`event_mean_dr = mu x intensity`). Expected loss per event therefore scales with **E[I²] = 1 + CV²**,
not E[I]² = 1. Using the single-entry identity overshot **cat by 1.37x and weather by 1.58x** — the
weather miss is larger because 1 + CV² compounds against a larger relative mu.

**Why the naive closed-form fix does not land.** The obvious correction, dividing mu by (1 + CV²), does
not work: the footprint **cap** interacts with the intensity draw, so the two entries are not
independent. Earthquake is the clearest case — at CV 1.1 with cap 0.95, the cap binds on a large
share of draws, truncating the footprint's response to intensity while the damage ratio's response
continues unchecked. Every mu was therefore a **numeric solve by simulation** against its peril's
target AAL, holding lambda, base_footprint, cap and CV fixed. The superseded pre-correction values
(1.18 / 0.73 / 3.83%) are recorded in the design doc so they are not mistaken for current.

**REFINEMENT (weather build, roster v4) — an exact closed form does exist.** This finding originally
concluded that *no* closed form lands. That is too strong, and the correction is a refinement rather
than a reversal: **everything above about intensity entering twice, about E[I²] = 1 + CV², and about
the naive mu/(1+CV²) correction failing, still stands.** What was wrong was only the inference from
"the naive correction fails" to "nothing analytic is available."

The cap does not defeat a closed form; it just means the expectation has to be **split at the cap**
rather than taken whole. With intensity LogNormal (which it is, in both the cat and weather specs):

```
E[min(b x I, c) x I] = b x E[I² 1{I <= c/b}] + c x (E[I] - E[I 1{I <= c/b}])
E[I^k 1{I <= t}]     = exp(k mu_ln + k² sigma²/2) x Phi((ln t - mu_ln - k sigma²)/sigma)
```

Both terms are exact, E[I] = 1 by construction, and **there is no quadrature anywhere** — which
matters here more than usual, since finding 23 is the record of what fixed-grid quadrature did to a
singular density in this same model. Implemented as `lognormalPartialMoment`
(`src/utils/claimMath.ts`); `expectedWeatherGrossLoss` is built on it, so the weather band has a real
analytic partner to its draw rather than a simulated one. Verified to five decimals:
`E[I x min(I, 5)] = 1.355546` against the naive `1 + CV² = 1.360000`, the cap accounting for the
0.328% difference.

**mu was NOT re-solved, and should not be.** The existing values verify well inside tolerance —
weather sits +0.33% from its target, which is mu's own rounding to three significant figures — so
re-solving would move a pinned constant for no behavioural gain. The closed form is recorded so the
option is *available*, not so it gets exercised. Two caveats if it ever is: it is exact for a cap on
the FOOTPRINT only (a clamp on the damage-ratio mean would need its own split), and it gives the
per-event expectation, with zone hazard weights and the quake adjacency span still multiplying in
separately.

**A second thing the closed form settled.** Because it carries no zone structure — per-location
Bernoulli hits make expected loss per event `hit_rate(I) x mu x I x zoneTIV` whatever the size mix,
and a COMMON lambda per zone collapses the sum to the whole book — **weather AAL is exactly linear in
TIV.** That is what licensed rescaling weather's target from $4.50M to $9.204M at roster v4 without
touching mu. Cat is NOT in this position: it draws its zone by hazard weight, so its AAL depends on a
hazard-weighted TIV mix, and v4 rescaled the three zones by different factors (2.0045 / 2.0168 /
2.1277). **Cat's targets are still v3 figures and its mu genuinely does need re-solving.**

**Caught before implementation**, so nothing was ever built on the wrong numbers — the mu values in
`PROPERTY_CAT_MODEL` and `PROPERTY_WEATHER_MODEL` are the post-correction solves.

**The general rule, which outlives this instance:** *when one random factor drives BOTH the extent of
an event and its per-unit severity, expected loss scales with E[factor²] = 1 + CV², and mu must be
solved numerically rather than derived.* Any future peril, shock layer, or contagion mechanism where
a single intensity variable feeds two multiplicative channels inherits this. Re-solve whenever
lambda, footprint, cap, CV **or the roster** moves — unlike the WC and GL pure premiums, these
constants do not recompute themselves.

## 23. A tail level-error that every internal check passed — caught only by an external target
**Status:** RESOLVED at plan time, before any code was written. Recorded for the verification lesson.

**The bug.** The per-risk breach rate was first computed by integrating the Beta(0.08, 1.92) damage-ratio
density with fixed-grid Simpson quadrature. That density goes as `t^(-0.92)` and is **unbounded at
t = 0**. A fixed grid cannot resolve the spike, so it under-counts the mass near zero, which deflates
the CDF and inflates the survival function at every threshold. The result: **21.8 breaches/yr against
a true ~1.78/yr**, a 12x error.

**Why it was dangerous rather than obvious.** 21.8/yr is absurd on its face *only if you already know
the answer*. It is a plausible-looking number produced by a standard technique, and it survived every
internal consistency check available at the time:

- The **mean was correct**. E[damage ratio] = 0.04 came out right, because the quadrature error lives
  in the tail and the mean is dominated by the bulk.
- **No other check examined that region.** Frequency, pay rate, the expected-loss identity and the
  draw-vs-analytic invariant all pass through a tail level-error untouched — none of them integrates
  the survival function.

A **level error confined to a tail is invisible to checks that measure levels elsewhere.** Nothing
internal would have flagged it.

**What actually caught it.** Two internal methods disagreed — the quadrature said 21.8/yr, a Monte
Carlo of the same quantity said 1.77/yr — and a disagreement alone does not say which side is wrong.
What resolved it immediately was the **independently pre-computed external target of ~1.78/yr**,
calculated outside the engine before the engine existed. That number identified the quadrature as the
faulty side in one step, with no need to settle the question from first principles.

**The lesson, which is the point of this finding:**

> When two internal methods disagree, a pre-computed external target resolves it immediately instead
> of requiring the disagreement be settled from first principles. This is the strongest argument for
> computing harness targets independently, before the engine is built, rather than deriving them from
> the engine afterwards — a target derived from the code under test cannot arbitrate against it.

**Consequences carried into the code.** `expectedOverLognormal` in `claimMath.ts` is marked LOGNORMAL
ONLY, with the failure mode and this incident named at the call site, because it is the fixed-grid
routine someone will reach for when a new distribution appears. `SeededRandom.beta` carries the same
warning. Beta quantities are verified by closed form (E[X] = mu exactly under the mean-concentration
parameterization) or by Monte Carlo, and never by quadrature over the density. Where a survival
probability genuinely must be integrated, integrate from `x` to 1 — away from the singularity at zero
— which is safe here because `b > 1` leaves the upper endpoint well behaved.

**One related check, recorded for completeness.** A second instance of tail mis-estimation was
subsequently suspected in the gamma-ratio Beta sampler itself. It was tested directly: 5,000,000 draws
through the engine's real RNG path, compared against exact incomplete-beta survival probabilities at
five thresholds plus the left tail. Every comparison fell within |z| < 1.5, and the mean within
z = 0.54. The suspicion was unfounded. The validation is retained as a regression check on
`SeededRandom.beta`, which matters because the same primitive will price the cat and weather bands,
where the numerically-solved mu values are calibrated entirely against tail behaviour.

## 24. The pool cannot lose money over five years at default settings
**Status:** measured, not yet fixed. See findings 25 (root cause) and 9 (dormant mechanics this
compounds with).

Measured over 50 five-year games at default decisions (WC + GL, seeds recorded in
`scripts/diagnostics/clf-downside-check.ts`'s commit history), with realized gross-to-expected at
**0.9967** — i.e. this sample was NOT lucky, unlike the five earlier live playthroughs that drew ~0.79:

- **0/50 games ended below starting surplus.** Worst ending ratio 1.356x; median 2.698x.
- **20/250 pool-years (8.0%) had a combined ratio above 100%.**
- **11/250 pool-years (4.4%) saw surplus decrease** year over year.
- Growth decomposition: underwriting income 65.8% of the five-year total, investment income 34.2%.

**The gap between 8% of YEARS losing money and 0% of GAMES losing money is pure compounding.** Bad
years occur — the loss distribution genuinely reaches past the pricing margin about one year in
twelve — but they never cluster enough within a five-year window to overcome the surrounding good
years plus investment income earned on a surplus that only ever grows. This is a materially different
(and better) finding than "the loss distribution never reaches the margin": the annual mechanics work,
the compounding does not create two-sided risk at game length.

### The experiment: funding confidence 0.75 -> 0.60 (CLF 1.346 -> 1.003), REVERTED

Same 50 seeds, one changed default, no re-baseline of the change (both export gates were left
knowingly red for the duration and are green again after reverting):

| | 0.75 (CLF 1.346) | 0.60 (CLF 1.003) |
|---|---|---|
| games ending below start | 0/50 | 1/50 |
| pool-years CR > 100% | 8.0% | 31.6% |
| pool-years surplus decreasing | 4.4% | 19.2% |
| median ending/starting | 2.698x | 1.897x |
| min ending/starting | 1.356x | **0.080x** (one near-wipeout) |
| underwriting / investment split | 65.8% / 34.2% | 39.1% / 60.9% |

**Conclusion: the CLF default transforms the ANNUAL risk profile but barely moves five-year
downside.** A losing year goes from one in twelve to nearly one in three, and a near-wipeout becomes
possible — but games ending below starting surplus only moves 0% -> 2%. Once pricing margin is
removed, investment income on surplus that is never returned to members becomes the MAJORITY of
growth (60.9%), so the pool keeps compounding upward on the interest of its own reserves regardless of
how tightly losses are priced. **CLF is necessary, not sufficient.** A genuine two-sided-risk design
needs a surplus-return mechanism (dividends, or something structural) alongside a corrected price.

**Contamination note — do not read the experiment column as an isolated CLF effect.** Realized
gross-to-expected moved 0.9967 -> 1.0651 on the *identical* seeds, because enrolment responds to
price and there is a live sign bug in `membershipEngine.ts`'s satisfaction update:
`delta += (fundingConfidenceLevel - 0.75) * 0.5`. Lowering the confidence level LOWERS satisfaction
(the delta goes negative), which is backwards — a cheaper, less-margin-loaded price should not make
members less happy. That drove differential retention toward worse members, and the book got 6.5%
more expensive than the CLF change alone would have produced. **The isolated CLF effect is somewhat
better than measured** (i.e. the true downside-frequency increase from 1.003 alone, without the
satisfaction contamination, is smaller than 19.2%/31.6%). Fix the sign bug before re-measuring, or the
next CLF experiment inherits the same contamination.

The 0.60 default has been REVERTED to 0.75; this finding documents the measurement, not a decision.

## 25. Members are charged for ceded losses TWICE — the ~8-point structural profit
**Status:** identified, not yet fixed. The important finding from the CLF experiment — more so than
finding 24 itself. Interacts with the deferred J10 waterfall work; design together, not separately.

**The observation.** Expected combined ratio exceeded actual by 7.6 points at CLF 1.346 and 7.8
points at CLF 1.003 — the SAME gap at both settings, measured on the 50-seed sets in finding 24.
Identical size across a materially different price is the signature of a structural offset, not
noise or a calibration miss.

**The cause.** The pool prices to GROSS expected loss but only ever pays NET:

```
members pay:  poolPremium + adminExpense + reinsuranceCost
pool pays:    netUltimateLoss + adminExpense + reinsuranceCost
pool profit = poolPremium - netUltimateLoss
```

`reinsuranceCost` cancels in the profit identity — it is a pure pass-through, charged to members and
paid out to a reinsurer, net effect zero on pool surplus. But `poolPremium = CLF x GROSS expectedLoss`,
which funds ALL expected losses, including the ~18% that reinsurance is expected to cede. Members are
then ALSO charged `reinsuranceCost` to buy the recovery on that same ceded portion. **The ceded slice
is funded twice: once through gross-priced premium, once through the reinsurance cost line — and the
pool keeps the recovery instead of the member.** This is worth roughly 8 points of combined ratio,
permanently, at whatever CLF is selected — which is exactly why raising or lowering CLF changes the
ANNUAL risk profile (finding 24) without ever closing this gap.

**The fix, not yet built.** Pricing the retention to NET expected loss —
`poolPremium = CLF x E[netUltimateLoss]` instead of gross — would give exactly zero expected profit at
CLF 1.0, matching the CLF-1.0 invariant's intent for the first time on a genuinely fair basis. It would
also make the reinsurance decision a real tradeoff for the first time: more cover would LOWER premium
(smaller retained expected loss) while RAISING reinsurance cost, a genuine two-sided choice. Today more
cover only raises cost, because premium is blind to how much is ceded.

**This is a pricing-basis fix and belongs with the J10 waterfall work, not before it.** Net-basis
pricing requires knowing, at pricing time, what the retention structure actually cedes — which is
exactly the reinsuranceLevel-to-retention mapping J10 already blocks on. Design them together.

### UPDATE — the per-occurrence tower makes this ~2.2x worse, and ships anyway

**The base was re-measured and it had already moved.** The 7.6-7.8 points recorded above predate the
WC class-cost rebuild, which changed the loss distribution underneath them. Re-measured at today's
parameters over 40 games x 5 years at default decisions, WC+GL:

| scope | mean gap | median gap |
|---|---|---|
| pool | **11.3 pts** | 15.4 pts |
| WC | 7.2 pts | 9.9 pts |
| GL | 13.9 pts | 23.6 pts |

Do not quote 7.6-7.8 again. The mean/median divergence is itself informative: the gap is *smaller*
in bad years, so the distribution is skewed and the median is the better central measure.

**The tower roughly doubles the double-funded slice.** The structural profit term IS `E[ceded]`, and
replacing the aggregate quota share with a per-occurrence tower raises it, measured on the same
enrolled book:

| | WC | GL | pool |
|---|---|---|---|
| aggregate quota share (old) | $0.84M (6.6% of gross) | $4.05M (15.7%) | **$4.89M — 12.7%** |
| per-occurrence tower (new) | $2.41M (18.8%) | $8.14M (31.5%) | **$10.55M — 27.3%** |
| ratio | x2.85 | x2.01 | **x2.16** |

**THE x2.16 RATIO IS THE ROBUST STATEMENT.** The conversion to combined-ratio points is approximate
(it depends on the denominator convention and on a skewed distribution), so treat "roughly 24 points
on the mean" as an order-of-magnitude consequence rather than a measured figure.

**The tower commit ships this knowingly.** It was shipped separately, and separately was the right
call for one reason: net-basis pricing changes premium, which changes membership, which changes
everything, while the tower changes only the ceded/net split. Shipping both at once means a moved
value cannot be attributed to either, and this project's entire gate discipline rests on that
isolation. "Design them together" — which this finding asked for — was honoured at DESIGN time; the
tower's plan derived the net-basis consequence before a line was written.

**NET-BASIS PRICING IS THE IMMEDIATELY FOLLOWING COMMIT. Not a deferral, not a queue item.** The
game is measurably easier until it lands: the pool collects premium funding losses it does not pay
and keeps the recovery. Nothing else should be started first.

**A separate, smaller issue — do NOT conflate with this finding.** The reinsurance COST ITSELF may
also be mispriced relative to what it actually recovers (members pay ~0.376 x expected loss for ~0.18
x expected loss of recovery, roughly $5.4M/yr of overpayment at current scale). Fixing the cost to an
actuarially fair `E[ceded] x loading` price would NOT change pool surplus at all — the cost is a
pass-through, so any fairness correction there is a MEMBER-VALUE issue, not a pool-profit issue. That
belongs with finding 10 (reinsurance cost band), not here. This finding is about the double-funding of
the ceded loss itself, which is what moves pool surplus.

---

## 26. Per-key RNG seed dispersion — a defect no within-stream validation could catch

**Found while implementing per-member RNG streams** (the marketplace-generation work). Keying
member-level streams per member is what makes a member's claim history independent of who else is
enrolled. Doing it broke both live generators: Property's weather band drew **+62%** against its own
analytic and four distributional checks failed, and WC's invariant 1 — draw vs analytic — broke by
**5.02%** ($52.22M drawn vs $54.97M analytic). Nothing about the loss model had changed. Only the
stream keys had.

### The mechanism, end to end

1. `deriveSubRng`'s string hash was `hash = hash * 31 + charCode`. The keys the generators use differ
   in their trailing characters only — `'wc_freq:member-001'` vs `'...002'` — so the two final hashes
   differed by **exactly 1**.
2. An LCG's first output is affine in its seed. At `a = 1664525`, `m = 2^32`, seeds one apart give
   first uniforms `a / m = 0.000388` apart. Measured spacing across 200 consecutive member keys:
   `0.1957, 0.1961, 0.1965, 0.1969, ...` — **lag-1 correlation 0.9908**.
3. `gamma()` uses the Marsaglia-Tsang small-shape boost `G(a) = G(a+1) x U^(1/a)`. At Property's
   damage-ratio shape `a = 0.08` that is `U^12.5`. With `U` trapped near 0.196 the boosted leg
   collapses to `~1.4e-9` on every draw, so `Beta = x/(x+y)` returned ~0 universally:
   **mean 0.005639 against 0.040000 exact** — a 7x understatement.

### Why it stayed latent, and the lesson that generalises

Each label previously opened **one stream per year** and consumed a long orbit from it, so the LCG
recovered within a few steps. Taking a handful of draws from each of 200 streams is what exposes seed
**dispersion** — and the 5,000,000-draw `Beta(0.08, 1.92)` validation already recorded on
`SeededRandom.beta` could not have caught it, because it ran on a single long stream.

> **A validation that exercises one stream cannot detect a defect in how streams are seeded relative
> to each other.**

Those are two independent properties. The project had a strong test for the first and none for the
second.

### The fix, and the test that was missing

Murmur3's 32-bit finalizer (`fmix32`) applied to the hash before seeding. It exists precisely to
avalanche a one-bit input change across the whole output, which is the property that was absent.

| | before | after |
|---|---|---|
| lag-1 correlation across 200 consecutive-id keys | **0.9908** | **-0.031** |
| first-uniform mean over those keys | 0.4411 | 0.5120 |
| `Beta(0.08,1.92)` mean, one draw per key | 0.005639 | 0.036290 (n=200, <0.5 SE of 0.04) |
| WC invariant 1 | **5.02% error** | passes |
| Property harness | **4 failures** | passes |

A permanent regression test now asserts low lag-1 correlation and a sane first-uniform mean across
~200 consecutive-id keys, in `scripts/diagnostics/enrolment-independence-check.ts`. It is cheap and it
is the test whose absence allowed this. Note that the **correlation** check is the primary instrument:
the `Beta` symptom is seed-dependent (one seed traps `U` near 0.196 and collapses, another traps near
0.71 and barely moves), so pooled across seeds the unfinalized `Beta` mean reads only z = 2.66 and
would not trip a 4-SE gate, while the correlation check caught all four seeds at once. **Gate the
invariant, not the downstream symptom.**

### Two harness checks were also found invalid, and corrected

Both are instances of the same error — a **fixed or CLT-based band on a heavy-tailed sample mean**.

- **Property's damage-ratio mean** used a fixed `+/-6%` band. `Beta(0.08, 1.92)` has CV 2.83, so the
  SE at n = 4,424 is 4.25% of the mean: that band is `+/-1.4 SE` and **fails ~16% of the time on
  correct code**. It duly fired on a correct generator. What identified the band rather than the model
  as the defect: the harness read **+6.75% high** while an independent 400,000-draw test of the same
  quantity read **~1% low** — both cannot be bias. Replaced with a 99% CI gate against its own
  realized variance, and the harness now states what n buys what precision (n ~ 20,000 to detect a
  genuine 5% bias; the 40-year run can only catch gross breakage).
  **A warmup tuned to make the failing test pass was explicitly rejected** — that would have been
  fitting the RNG to the harness.
- **GL's `lawEnforcement` mean** was gated by a 99% CI. That check is invalid *by construction*, not
  merely under-powered: severity is 95% lognormal + 5% Pareto with **alpha = 1.3**, so variance is
  **infinite**, the CLT does not apply, the sample mean does not converge at `1/sqrt(n)`, and a CI
  from realized variance is invalid at any n because the realized variance is itself unstable.
  Demonstrated: across two runs of the same model that "99% CI" moved from `+/-7.01%` to `+/-4.70%` —
  a 33% swing in the instrument. The narrow run read -5.89% and "failed"; the wide one read -1.17% and
  "passed". Neither says anything about the model. The tail also dominates what it was gating:
  `0.05 x $4.33M = $217k` of the `$297k` mean, so **73% of the mean comes from 5% of claims.**
  Replaced with bounded-variance instruments — frequency, pay rate, and the Pareto-scale tail COUNT
  against an exact binomial CI (a Bernoulli indicator has variance `p(1-p) <= 1/4` however heavy the
  severity tail is) — with the mean and median REPORTED, not asserted. `abuse` is deliberately left on
  its CI gate: it is tail-dominated but lognormal CV 2.0, so its variance is finite and the gate valid.

**Standing practice this reinforces:** never gate a heavy-tailed sample mean, by fixed band or by CI.
Gate counts, rates, quantiles and capped/truncated means — statistics with bounded per-observation
variance — and report the rest.

---

## 27. Medical severity is one shared value, so tier mix is forced to carry the whole class differential

**Status:** ⚠️ STRUCTURAL LIMITATION, documented not fixed. The WCIRB class-cost rebuild was
implemented *around* it, and the working fix is described below so the next attempt does not
rediscover it by exhausting the tier mix again.

WC severity is built from parameters that are **shared across all four rating classes**:
`severity.medOnly.mean`, `severity.temp.medicalMean`, `severity.perm.medicalMean`, and the
catastrophic annuity's `medicalFirstYear`. Only three things differ by class:

1. **frequency** (`rateClassPer1M`),
2. **tier mix** (`tierProbabilities`),
3. **wage** (`classAnnualWage`, which drives the indemnity legs and nothing else).

Medical severity per claim of a given tier is therefore **identical for a clerk and a firefighter**.
So when an external target says class A must cost 10.9x class B per payroll dollar, the model can
only deliver that through frequency, tier mix, or wage — and wage is anchored to real salaries and
only touches indemnity. **Tier mix ends up absorbing the entire class differential**, whether or not
tier mix is where the real difference lives.

That is why `publicWorks.perm` had to go to **0.278** — 4.9x its previous 0.057, against a real-world
PPD rate of roughly 8% of claims. Nothing is wrong with public works being the highest-PPD class
(it is, and WCIRB prices 9420 as the most expensive public-entity classification). What is wrong is
that 27.8% is doing work that a **severity** difference should be doing.

**The structurally correct fix, NOT built:** a per-class medical severity multiplier. Holding tier
mix at its pre-rebuild values, the multipliers that would hit the same WCIRB targets are roughly:

| class | multiplier on medical severity |
|---|---|
| clerical | ~3.3x |
| publicWorks | ~2.1x |
| police | ~0.36x |
| fire | ~0.5x (depends entirely on the unsourced 7710 estimate) |

Note these run in the *opposite* direction to intuition for police: the model's police severity is
already too high, driven by the wage-linked indemnity legs, not by medical. A per-class multiplier
would let frequency and tier mix return to observed values and let severity carry the differential
where it actually belongs.

**Why it was not built here:** it changes the shape of the severity model rather than its values,
touches the analytic/draw matched pair (invariant 1) at every tier, and would have made an already
large recalibration unreviewable. It is the right next move if the class costs are revisited.

---

## 28. The $115k perm medical figure was FORCED by the level constraint, not chosen

A prior plan proposed raising `severity.perm.medicalMean` from $65,000 to $115,000, and a later
variant of that plan observed that doing so "silently cancelled the catastrophic reduction on the
medical/indemnity mix." The arithmetic shows the cancellation was not an accident and the $115k was
never a free parameter.

Holding the class-only loss cost at its then-anchor of $3.5478 while cutting catastrophic
probability removes ~$25M of ~$46M from the book. If that level is restored **through the medical
severities alone** — the only severities that are free, since the indemnity legs are wage-anchored —
they must rise by **x2.82 to x3.21**. At x2.82 that lands `permMed` at **$112,800**, essentially the
proposed $115k, and drives the three-way mix to **75.7 / 14.0 / 10.3** against a 60-65 / 22-25 /
13-16 target.

So $115k *is* what the level constraint forces when restoration is routed through medical, and the
mix damage is the mechanical consequence of that routing, not a separate error. The lesson is about
**stating every target**: with only "catastrophic share" and "level" named, medical severity was the
free variable and it absorbed the whole adjustment invisibly.

**Related failure in the same family:** an earlier attempt to hit the catastrophic share by cutting
**severity** instead of probability produced a lifetime medical figure of **$12,663/yr** for a
permanently and totally disabled worker. That is the recognisable signature of binding a share target
on the wrong lever, and the reason `catastrophic.medicalFirstYear` now carries a comment saying so.

---

## 29. Provenance of every input to the WC class-cost rebuild — one sourced, five not

Recorded because WC's parameters were authored as domain-judgment estimates and have repeatedly been
mistaken for data. **Exactly one input to this rebuild is sourced.**

| input | provenance | note |
|---|---|---|
| WCIRB advisory pure premium rates — 9410 $0.82, 9420 $8.95, 7720 $2.75, 9101 $3.80, 8868 $0.53 | **SOURCED** | 2023 filing, public-entity classifications, via PRISM. The only external anchor in the rebuild. |
| LAE divisor 1.29 | **UNSOURCED** — derived | WCIRB rates include loss adjustment expense; ours are loss-only. Derived from aggregate CY2025 ratios (LAE ~18% of premium, losses ~62%). Moves the level ~25% across plausible values, so the level is reported as a **band (3.56-3.85)**, not a point. Independent check: holding the level with a *positive* fire rate requires LAE >= ~1.25, which brackets 1.29 from below. |
| CA Labor Code 4850 safety gross-up | **UNSOURCED** — inferred | 4850 gives police/fire full salary continuation up to a year, paid by the employer and not booked as WC indemnity; industrial disability retirement moves PTD to pension. If true, the WCIRB safety rate corresponds to our *medical + impairment*, not full severity. Without it, police can only hit its target with PPD ~0.2%, which is indefensible. This assumption is load-bearing. |
| 7710 Firefighters rate | **UNSOURCED** — estimated | Not found in the repo, uploads, or any rate memo. Estimated at 1.5x police. Fire is 8.6% of payroll; across 1.0x-2.0x police the blended level moves only ±2.6%, so no conclusion depends on it — but fire's own perm rate does. |
| PTD incidence 0.05-0.15% of all claims | **UNSOURCED** — recollection | Used to bind the catastrophic probability. The book sits at its **floor** (0.049%). |
| per-100-FTE frequency envelopes (clerical 1-2, publicWorks 6-9, police 8-12, fire 10-15) | **UNSOURCED** — recollection | **Treat the envelope as the wrong thing, not the value.** Clerical is set at 4.0/100 FTE, above the quoted band, because it cannot reach its WCIRB rate of $0.690 at 2.0/100 FTE under any severity this model can defend. A sourced public-entity frequency table would displace both. |
| WCIRB reserve basis — discounted or not? | **UNSOURCED** — undetermined | WCIRB pure premium rates derive from developed incurred losses, and WC reserves are typically **not** discounted for statutory reporting. We book catastrophic at **present value** (~$9.8M against ~$21.8M nominal). If WCIRB carries PTD nominal and we carry PV, they are different quantities and the correction would **widen** the police gap, not narrow it. Potentially worth a factor of two on the police target. Sits alongside 4850 and 7710 as the third load-bearing assumption. |

**Withdrawn by this work:** the reading that County's rate-table relativity of 1.221 reflected a
large-account or experience credit. That conclusion depended on public works being cheap; once the
class costs are corrected, County moves from +33% to -48% against its target, and the credit reading
is an artifact of the old class costs rather than a finding. The binding artifact is
`WC_CLASS_MIX` — see finding 27 and the Low Safety / School ratio below.

**Also measured, not targeted:** the Low Safety / School loss-cost ratio caps at ~1.75 against a
real pool's 4.23. Recomputing it with real WCIRB class rates gives 1.74 — two independent routes to
the same number. The cause is the mix table, not the class costs: School District is 70% clerical by
payroll but ~75% public works **by cost**, because clerical is ~17x cheaper per payroll dollar, so
School and Low Safety share the same dominant cost driver and the public-works channel caps the
achievable ratio at 1.90.
