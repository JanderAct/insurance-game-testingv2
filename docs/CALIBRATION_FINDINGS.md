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
held WC pure premium: **$3.7269 per $100**. This is what makes the gross reconciliation land on
target rather than by luck.

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

## 7. Property's loss volatility is too SMOOTH for a catastrophe-exposed line
**Status:** confirmed on the reference seed. Belongs with the loss-distribution rework (finding 3).

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
