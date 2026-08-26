# Project State Summary — Ripple
**Purpose:** compact reference of everything decided, built, and pending as of this point. Serves as a
standalone catch-up document (or a seed file for a fresh working session). Detailed reasoning lives in
the conversation and in the companion docs listed at the end.

**Repo:** github.com/JanderAct/insurance-game-testingv2 · working branch `multi-line-build`
**Reference seed:** `MAMC6EA4` · **Current baseline:** v11 · **Model rule:** Opus/Fable for
engine/seeding/interlocking work, Sonnet for display/mechanical work. Real typecheck command is
`npm run typecheck` (root `tsc --noEmit` is a no-op — checks zero files).

---

## 1. WHERE THE BUILD STANDS

**Complete and merged (Phases 1–2 + the v8–v11 batch):**
- Three-line pool (WC / GL / Property), per-line engine, decisions, investments, prior histories.
- Config-independent openings: per-line capital (K × own premium), per-line adequacy redraw,
  per-line enrollment. Money-side cross-config coupling eliminated exactly (algebraic identity);
  remaining divergence is rare roster-fold flips only.
- Investment model: shared market draw (one set of asset-class returns per year, all lines), per-line
  portfolios, pool-wide allocation decision, gross-of-fee params (Cash 4.19%/0.40%, Bonds 5.20%/4.04%,
  Equity 8.26%/18.25%; fees 0.040/0.124/0.124), single regime, inert clamps.
- Opening bands: two-sided per-line redraw acceptance — WC/GL 1.35–2.0× required reserve margin,
  Property 2.0–3.0× (short-tail margin understates cat risk). K: WC 0.70 / GL 0.45 / PR 0.18.
- GASB income statement + ACFR Statement of Net Position (current/noncurrent from per-line paydown:
  WC/GL 35% current, PR 65%). Surplus Rollforward card retained for tie-out.
- Removed as vestigial: reinsurance recoverable (net reserves), otherAssets/otherLiabilities,
  self-funded discount. All used the keep-the-RNG-draw trick where draws were involved.
- Calculation Audit page: mirrors both statements line-for-line, numeric FormulaSpec formulas (display
  derived from operands; evaluate() harness + printed-sample hand-checks), 15 reconciliation checks,
  three-state status (Pass / Known Variance / Fail), line selector, pre-game attempt provenance stored
  (pre-game years now reproducible).

**Pool-wide decisions:** asset allocation and risk-control % are pool-level (projection pattern —
copied into line slices at processYear entry). Risk control = one %, each line applies to its own base.

---

## 2. CALIBRATION FINDINGS — THE SHORT VERSION
(Full detail: CALIBRATION_FINDINGS.md, findings 1–21.)

**The core problem (6):** actual loss ratio ≈ 46% vs 66.8% expected; 2 of 60 line-years reached
expected; surplus doubles in 5 years on defaults. Testable prediction: E[commonLossFactor] ≈ 0.69 —
if so, one-parameter fix.

**Its consequences (9):** SIX mechanics dormant because losses are too small — reinsurance recovery,
LR>100%, Property cat risk, liquidity floor, zero-investments floor, dividend block.

**Property's tail (7):** narrowest LR spread of the three lines — backwards for the cat line.

**The architecture correction (17):** factors applied to PURE PREMIUM cancel between losses and premium
(trend and risk control are provably no-ops — 0.000pp CAGR divergence). Factors applied to the DRAW
(commonLossFactor, catastropheFactor, Gamma variance) DO move the loss ratio. So findings 6/7 are NOT
blocked; only trend and risk control await the indication.

**Dead scaffolding that helps (11, 18):** catastropheFactor hardcoded to 1 (restore, don't delete);
entire lossEnvironment dead except lossTrend — shockProbability, shockSeverityMultiplier, heavyTailRisk,
volatility, baseLossRatio all drawn per-instance and never read. The catastrophe system was built and
abandoned. Per-instance draws = per-seed loss personalities already scaffolded. Apply to the DRAW.

**Chaos hazard (8):** the opening-band reject-and-redraw is discontinuous — a 1% premium change flipped
9/72 seed-lines onto different attempts (MAMC6EA4 GL: attempt 8→4, now at 1.358×, band edge). Gameplay
harmless; verification/calibration painful. Loss recentering will re-roll nearly everything. Chosen
approach: DEFER the fix (predetermined openings) to alongside reserving; measure the loss work
statistically across 30–50 seeds instead of baseline-diffing. Build that harness early.

**Reinsurance (10):** cost band collapsed at every level (min ≡ max, literal copy) — always priced at
ceiling; $29.7M/3yr = 25.2% of member charge. competitivePressure half-alive. Fix AFTER recentering
(band width needs recovery-frequency data).

**Smaller:** 12 gross-vs-net expense ratio display risk (32.7% vs 10.0%); 13 audit page shows global
lossTrend not instance value (defect, unfixed); 15 hidden 60/40 current-year paid/unpaid literal;
16 riskControlEffectiveness not on result type (trivial 2-file fix, wanted before loss work).

---

## 3. CLAIM GENERATORS — all three lines complete

**WC (src/utils/wcClaimEngine.ts)**, **GL (src/utils/glClaimEngine.ts)** and **Property
(src/utils/propertyClaimEngine.ts)** are claim-level generators. The aggregate member-Gamma draw is
retired on every line; the `else` branch that held it remains in simulationEngine only because
nothing else has needed removing it yet.

**Property was cut over last**, against a fit to the pool's own nine years of claims (1,822
non-vehicle claims, 2015-16 to 2023-24): frequency 0.00221 per $1M of TIV, a four-component
lognormal severity mixture capped at $75M. It replaced a design that was never fitted and was wrong
in both directions at once — ~112 claims/yr at a $190,179 mean against a fitted 15.5 at $435,254 —
which is why its AAL had looked roughly right.

Property now runs the SAME PER-OCCURRENCE TOWER as WC/GL: one layer, $70M xs $5M, to the model's
own severity cap, plus an aggregate stop-loss (two attachment levels, Panjer-priced rather than
WC's lognormal fit — see propertyAggregate.ts). REINSURANCE_PROGRAMS is dead for every line now,
kept only pending its own retirement commit. Net funding follows automatically from
`hasTractableCeded` (renamed from `usesTower`, which named the mechanism and hid that netting rides
on it), the same mechanism WC/GL already used.

Property also has its OWN DERIVED CLF TABLE now, on the net basis, crossing at 54.0% — so all three
lines read `STATIC_CLF_TABLE` and `FUNDING_CLF_TABLE` has no line left reading it for pricing (it
still serves the catastrophe threshold, a different use). The generic table had been a gross-basis
real-pool chart applied to a net-funded line: its 60% stop delivered 54.3%, with error running
-18.7pp to +6.9pp across the range. The derived table reads within 0.9pp at every stop, validated
out of sample.

Conventions established by this work and binding on all future lines:
- **Accident-year dollars, and NO settlement trend.** ⚠ CORRECTED — this bullet used to name
  trendToSettlement (src/utils/claimMath.ts) as the ONLY vintage-conversion point. That function and its
  sole caller patternTrendFactor were dead from 3181b18 and are now deleted. Severities are drawn and
  stored in accident-year dollars and are never re-vintaged; every live trend in the generators is a
  LEVEL trend that establishes a vintage rather than converting between two. Retroactive repricing runs
  through the IBNER development step, which moves the estimate, not the claim. See WORKING_PRACTICES.md.
- **Every trend-compounded lag MUST be truncated and renormalized.** E[(1+r)^lag] over an unbounded
  lognormal lag is mathematically DIVERGENT, not merely large. Bounds that applied while lags existed:
  WC presumption 40y; GL general 10y, EPL/LE 12y, abuse 50y. The analytic expectation must integrate the
  identical truncated density or the draw/expectation invariant breaks. ⚠ THE TRIGGER IS A RANDOM
  EXPONENT, NOT A TREND: (1+r)^L with L a drawn lag diverges; (1+r)^(year-1) with year a bounded integer
  is deterministic and finite. All three lines trend severity through the second form — by ACCIDENT YEAR,
  frozen onto the claim (Property's rate is a named constant at zero, so its factor is exactly 1). None
  raises a trend to a random power: the mixtures are fitted to settled amounts and the lags they replaced
  are gone. The rule constrains nothing today and binds the next line that draws a lag and trends across
  it. See WORKING_PRACTICES.md — "no random exponent" is not "no severity trend".
- **Risk control applies to the DRAW only, never the pricing expectation** (per finding 17 — applying
  it to both cancels and recreates the no-op).
- **Pure premium is derived ONCE from the neutral (RQ 5) full-roster analytic expectation and held**,
  not recomputed annually. k_line/k_GL does the per-year roster-mix correction. Both recomputing
  would double-correct.
- **g_pool** (Gamma(25, 1/25)) is drawn once per year in processYear and shared across all lines.
  ⚠ GL IS NOW ITS ONLY READER. WC left at the severity rebuild and Property left at its cutover, so
  g_pool — the model's only cross-line correlation — currently links nothing.
- Per-line trend rates are separate and line-specific: WC medical 6% / WC indemnity 3.5% / GL social
  inflation 7%. A future shock-event system may add a cross-line inflation regime; nothing is built
  for it yet.

Verified results **at roster v2** (both pure premiums are derived at module load, never hardcoded):
WC held pure premium **$4.2300/$100** (was $3.7269 at v1), analytic gross-basis **67.40%**, realized
66.31% ±5.92pp. GL held pure premium **$7.0572/$100** (was $6.8305), analytic gross-basis **66.29%**,
realized 69.07% ±10.57pp. Both rose on the v2 payroll rebalance toward County/City, which carry the
costlier police and fire class weights; GL's law enforcement sub-coverage more than doubled (13.4 →
28.2 claims/yr) because police payroll went $66.2M → $137.2M.

**The 6b loss-ratio check is two-part, for both lines.** HARD ASSERT the ANALYTIC gross-basis ratio
(each enrolled book's own expected loss over its premium + admin, zero draw noise) at 66.8% ± 2pp;
REPORT the realized draw with its CI and flag only if it falls outside its own CI of the analytic.
This is stricter, not weaker: correctness decomposes into draw == analytic expectation (invariant 1,
asserted at full-market scale) AND analytic == 66.8% (asserted here), which together imply realized
~ 66.8% in expectation. Gating a ±2pp band on a realized mean whose own CI is ±6–11pp is a coin flip
that fails on correct pricing — GL's CI widened from ±6.64pp to ±10.57pp at v2 purely from doubling
its α=1.3 Pareto frequency.

Cross-line premium at v2 (enrolled books, mean per line-year): WC $19.04M / GL $33.56M / Property
$2.51M. Property is NOT comparable — it is still on the legacy aggregate path, and its figure
collapsed with the TIV rescale; it is deliberately not retuned ahead of its own generator.

---

## 4. DESIGN DECISIONS MADE (not yet built)

**Dividend/assessment combined bar:** one bar, zero default; dividends drag left, assessments right;
both-in-one-year impossible by construction. Dots stop at each other. Dividend-blocked greys the left
half in place. ACCOUNTING STAYS SPLIT — assessments outside totalMemberCharge (folding them in would
improve the loss ratio for billing members). Check whether the two %s share a base before building.

**Remove the rate-change lever → CLF-only pricing:** rate = actuarial indication; player picks funding
confidence per line. Default at EXPECTED (zero margin — margin becomes a conscious choice); range
30–95% (below-expected allowed: "maybe you don't think the indication is correct"). Per-line CLF matches
the real pool (GL 85%, WC 80%; GL curve steeper than WC). CLF curves DERIVED from the loss
distributions, differing by line. Notes: "expected" ≠ 50th percentile (right-skew; differs per line —
show percentile AND margin-over-expected); rateLevel accumulator loses memory (surplus becomes the scar
tissue — accepted); reserve margin uses a hardcoded 90% CLF (a second, invisible standard — surface it,
don't make it a decision); satisfaction convexity should make shock CLF corrections costly (emergent
cap, no explicit limit).
**HARD PREREQUISITE — effective-bill satisfaction (Stage 2.5):** satisfaction currently keys off
decisions.rateChange; removing it blinds satisfaction. Must REPLACE the rateChange link (not layer on),
routes assessments through the bill, and fixes the CLF sign bug (higher CLF currently RAISES
satisfaction).

**CLF display panel (below the slider):** indicated loss, multiplier, premium, derived rate-change vs
last year, expected margin framed honestly ("adequate in ~85% of years" — it's underwriting margin
before expenses, NOT "surplus gained"), marginal cost of the next increment (+5% costs $X — reveals
curve steepness per line), predicted satisfaction impact. Needs the indication to exist.

**Actuarial indication:** experience-based — develop with LDFs → trend → ÷ exposure → project. It
REPLACES internal expectedLoss as the pricing basis (not read-only), which is what makes trend and risk
control meaningful (finding 17). User can supply real per-line trend and LDF factors.
**Credibility lesson DROPPED (user decision):** new roster ≈ full credibility, blend collapses to own
experience. Consequence: soft-market trap gets SHARPER (no manual-rate anchor); uncertainty comes from
finite noisy sample + development. Decision surface narrows to CLF + dividend/assessment bar — user
aware and accepted.

**Roster — CANONICAL v4 (200 members, $1,300M payroll, $14,303.6M TIV at 11.00x payroll) is the
game's default**, ingested as a static checked-in generated TypeScript module
(src/data/memberCatalog.ts, generated by scripts/tools/generate-member-catalog.ts from source CSV
**src/data/roster_canonical_v4.csv**; v1-v3 are kept in place for provenance only).

⚠ **CHECK WHICH CSV memberCatalog.ts ACTUALLY LOADS BEFORE QUOTING A ROSTER FIGURE.** This section
said v2 and $5,250.8M long after v4 was live, and a ruling was once made on the strength of it —
proposing a TIV rescale that had already happened. The generator script's own header is the
authority; the CSVs below it are history. Replaces the old procedural
memberCatalog generator. Lumpy (150) and granular (450) are scenario VARIANTS of the same generator
at different member counts, retained for instructor-mode concentration-vs-portfolio contrast — not
drafts, not superseded.

**v3 -> v4:** TIV ONLY, rescaled per member TYPE (School x3.6, Water x2.7778, Fire x2.1429,
County/Recreation x2, Transit x1.8333, City x1.8, Special x1.6364, Park x1.5556) off v3's
$6,993.3M to **$14,303.6M**. Within-type spread and rank are preserved exactly; payroll, RQ, Region,
Locations and Primary Asset Share are byte-identical to v3.

**v2 changes vs v1:** payroll rebalanced to **County 30% / City 20%**, others scaled to fill the
remaining 50% (total still $1,300M); **TIV is now a STORED column** totalling **$5,250.8M** (blended
4.04× payroll); **Region is now a STORED column** valued **North / Central / South** (72 / 61 / 67
members, TIV 31.6% / 35.7% / 32.7%). IDs, Names and Types are unchanged, all 800 GL relativity cells
are byte-identical, and Risk Quality is unchanged except four members clamped to 1.0 at source. WC
class columns moved only because payroll moved.

Because TIV and Region are authored data now, the machinery that invented them is **DELETED**:
`PROPERTY_TIV_SCALE`, `TIV_RANGES`, `TIV_TYPE_MULTIPLIER`, the generator's `tivFor()`, and the
synthetic `SeededRandom(42)` region draw. There is no TIV scale knob any more — to change Property's
exposure, change the CSV. Property's exposure consequently fell ~12× ($63.94B derived → $5.25B
stored).

**The WC region severity multiplier is now mean-neutral**: a keyed lookup (North 0.95, Central 1.00,
South 1.05) averaging exactly 1.00 at equal assignment probability. The superseded 5-region array
[0.92, 0.97, 1.03, 1.08, 1.12] under weights 10/20/40/20/10 had a weighted mean of **1.026** — region
was silently adding 2.6% to every WC severity, which the pure premium absorbed as if it were risk.

WC class splits and GL relativities remain type-constant lookup tables (WC_CLASS_MIX,
GL_RELATIVITIES in defaultAssumptions.ts), not per-member data — verified to reconcile to the
roster's WC/GL columns (worst residual $50, within the $100 tolerance). sizeCategory is KEPT as a
display attribute (MembershipPage's SizeBadge, spreadsheet export), still derived from payroll
percentile rank at the 110/60/24/6 split, but is no longer a TIV input. Marketplace membership is
FIXED at 200 — the player's pool grows/shrinks within it via status transitions, with a 2-year
per-line re-enrollment cooldown tracked in PoolState.membershipHistory.

**Liquidity mechanic (brainstormed, post-loss-work):** player chooses how to cover a cash shortfall
(sell bonds / sell equities into a possibly-down market / assess / borrow inter-line); forecast warning
at decision time the player can ignore; audit check #15 (0 events in 2,322 today) is the indicator for
when it has bite. Introduces illiquidity-vs-insolvency distinction; candidate lose condition.

**Reserving:** NOT a slider. Funding adequacy IS the reserving decision, expressed through rates/CLF.
Phase 3 = aggregate accident-year development (management-consequence model), NOT claim-level estimation.
Per-claim lifecycle deferred (mainly needed for occurrence reinsurance, Phase 6).

**Trend (designed, awaiting indication):** separate ASSUMED trend (in pricing) from ACTUAL trend (in
the loss draw) — currently one variable, hence no-op. Severity not frequency; per-line rates (GL
highest ~8–12% social inflation, WC 5–7%, PR 4–6%); "known vs uncertain trend" — uncertain preferred
(pricing assumption ≠ actual). Exposure trend question open (static = harsher, trending = realistic
partial hedge).

**Scenario seeds (#6/#12 in UI_REFINEMENTS):** tighten-parameters-then-curate plan superseded in spirit
by predetermined opening states — 50–100 precomputed openings as data, generated by a build-time tool
once mechanics settle (retires finding 8; enables same-opening-different-luck cohort play). User chose
to do this ALONGSIDE RESERVING, not before the loss work.

---

## 5. SEQUENCING (settled order)
1. **Loss-distribution work** (other chat; in progress): verify E[commonLossFactor]≈0.69, re-enable
   catastropheFactor + dead lossEnvironment params APPLIED TO THE DRAW, per-line frequency/severity/
   tails. Activates finding-9's six dormant mechanics. Measure statistically across seeds (finding 8).
2. **Effective-bill satisfaction** (prerequisite for CLF-only).
3. **Indication + CLF-only pricing + display panel** (makes trend + risk control meaningful).
4. **Trend separation.**
5. **Phase 3 reserves** (aggregate) + **predetermined openings** (retires finding 8) around the same
   time.
6. Liquidity mechanic once losses can strain cash. Then reinsurance band fix (finding 10), ULAE
   (decided as real modeled expense, not designed), class-based rating if roster adopted.

**Sequencing from here:** (1) J10 / the retention waterfall — the $1M per-occurrence structure from
the design doc's Part C, which also determines WC's migration off the aggregate path; (2) Property
claim generator (closes finding 7); (3) cross-line scale conversation once all three lines are real.
J10 precedes Property deliberately: GL currently produces abuse batches up to $317.92M gross (P99
$99.93M, ~1.24x total pool annual premium) while still running on the aggregate quota-share path,
so the pool's loss-absorption structure is known-wrong for the tails two lines already generate.

---

## 6. HOUSEKEEPING / OPEN ITEMS
- **DOC SYNC (partial):** CALIBRATION_FINDINGS.md is current through finding 21 (WC/GL generator
  work synced). UI_REFINEMENTS.md, baseline docs and the two SPEC files remain behind the
  /mnt/user-data/outputs versions. (This item previously cited BASELINE_v8_ALL_CONFIGS.md and
  BASELINE_LINEAGE_v4_to_v10.md — neither has ever existed at those paths in this repo; the
  lineage doc is baselines/BASELINE_LINEAGE_v4_to_v21.md, and it now carries a closing note on
  the v4–v9 artifacts removed from the tree on 2026-08-19.)
- **Pass to distribution chat:** E[commonLossFactor] prediction; the draw-vs-pure-premium constraint;
  existing dead scaffolding (shockProbability etc.); catastropheFactor hook (restore, don't delete).
- **KNOWN, before baseline recapture (REWRITTEN at roster v2):** the old form of this note said
  Property sat at ~130% of WC and blamed WC under-scaling, and told the reader not to touch
  PROPERTY_TIV_SCALE. Both halves are now obsolete — that constant is deleted, and the ratio has
  inverted. Property now runs ~$2.51M premium against WC's $19.04M (~13%), because deleting the
  scale factor took TIV from $63.94B to the CSV's authored $5.25B. Property is deliberately NOT
  being retuned: it is the last line on the legacy aggregate path and gets its own claim generator
  next, which is the point at which its exposure base and rate should be set together. The
  STARTING_RATE_PER_100 / STARTING_FINANCIALS absolute-dollar constants still want a look before
  any baseline recapture.
- Finding 13 fix (thread instance.lossEnvironment to the audit page); finding 16 (expose
  riskControlEffectiveness — wanted before loss work); finding 12 (optional net-ratio display).
- Bad commits on record: `e94387e` (corrupt v9 capture, superseded by `8693655`).
- Claude Code paste-chips arrive EMPTY in this chat — use screenshots or .docx uploads instead.
