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

### UPDATE (investment-and-opening-tuning) — residual re-measured and re-accepted, larger
**Ruling:** accepted (option a) after the new investment model (~40% higher returns) amplified
the coupling. The current documented residual, measured across 12 seeds × 2 config-pairs
(solo-vs-duo and solo-vs-tri):

> **Pre-game and live Y1 strictly config-independent; Y2 rare ≤1-member flip (~1 in 24
> config-pairs); Y3 occasional (3 in 24). Non-flip surplus drift ≤0.184%.**

Where a flip occurs, that seed's affected line diverges across configs from the flip year on
(~2% surplus by Y3 on the observed case). Each config individually still ties out to zero and is
fully deterministic — this is cross-CONFIG drift only, invisible inside any single game.

**Trajectory (on record, not a fix request):** this residual SCALES with the pool's numbers.
It grew ~6× (from ≤0.03% to ≤0.184% non-flip drift, and the first-flip year moved from Y3-only
to occasionally Y2) when investment returns rose ~40%, because the shared-cash slice differences
compound through investment income. The loss-distribution rework and Phase 3 reserves will likely
amplify it further. Per-line cash segregation (above) is the eventual lever if it ever becomes
visible in play.

### UPDATE (remove-other-assets-liabilities) — money-side coupling ELIMINATED
Removing the vestigial otherAssets/otherLiabilities balances didn't just shrink this residual —
it structurally eliminated the financial half of it. Current residual, re-measured on the same
12-seed × 2-config-pair harness:

> **Pre-game and live Y1 strictly config-independent. Y2 rare ≤1-member roster flip (1 of 24
> config-pairs); Y3 occasional (3 of 24). Zero money-side drift — non-flip cross-config surplus
> drift is exactly 0.0000%. Remaining divergence is roster-fold only, not financial.**

**Why it improved (structural, not luck):** the contribution-share weight
(surplus + netReserve − investedAssets) is constructed so the weights sum to the shared pot.
When the pot was three things at once (cash + otherAssets − otherLiabilities), one share vector
could only reproduce each line's NET slice — the cash portion specifically was distorted by the
other two components, and that distortion leaked cross-config through the operating-cash sweep
into investments. With cash as the ONLY shared pot, the weight now equals each line's own implied
cash slice EXACTLY (weight_L = surplus_L + netReserve_L − invested_L = cash slice_L, and
Σweights = pool cash by balance-sheet identity), so the allocation is exact per line and the
money-side coupling is zero by construction. Verified: WC's ending surplus is identical to the
dollar across WC-only and WC+GL for all three live years on the reference seed.

**Trajectory, revised:** the "residual grows with the pool's numbers" warning above applied to
the money-side coupling, which no longer exists. The surviving roster-fold effect (the sequential
shared-roster fold: a member withdrawing from one line becomes ineligible for recruitment into
another that year) could still grow with more loss volatility, but it is NOT sensitive to the
magnitude of the pool's numbers. Flip counts were unchanged by this change (Y2: 1, Y3: 3 of 24
pairs — same seeds, same years).

**Fix lever, revised:** full per-line cash segregation is no longer needed to address financial
coupling — there is none. It would only address the roster-fold flips, a much smaller concern
that lives in membership mechanics, not money.
