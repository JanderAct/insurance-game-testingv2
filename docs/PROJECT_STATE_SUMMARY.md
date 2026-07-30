# Project State Summary — Pool Risk Management Game
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
(Full detail: CALIBRATION_FINDINGS.md, findings 1–18. Repo copy is BEHIND — sync needed.)

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

## 3. DESIGN DECISIONS MADE (not yet built)

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

**New roster — LUMPY (150 members) chosen over granular (450):** both $1,300M payroll (5× current).
Lumpy: largest member 10.7% of pool, top-10 32.1%; enrolled stays ~35–50 at 25–35% share — money scale
up, roster scale flat; concentration teachable (cat + concentration compounds — accepted). Structure
verified: WC class splits (clerical/pubworks/police/fire) reconcile to payroll exactly; GL columns are
RELATIVITIES (gen/epl/lawenf/abuse — e.g. Rec District abuse 1.90, Fire District 88% fire payroll).
**NO Property/TIV column — data gap.** **Adopting requires class-based rating** (per-class WC loss
costs, GL relativity rating) or the structure is decoration. Files: roster_lumpy.csv /
roster_granular.csv in uploads.

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

## 4. SEQUENCING (settled order)
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

---

## 5. HOUSEKEEPING / OPEN ITEMS
- **DOC SYNC (overdue):** repo copies of CALIBRATION_FINDINGS.md, UI_REFINEMENTS.md, baseline docs
  (BASELINE_v8_ALL_CONFIGS.md, BASELINE_LINEAGE_v4_to_v10.md — needs v11 extension), and the two SPEC
  files are all behind the /mnt/user-data/outputs versions. Findings 6–18 are what the loss work needs.
- **Pass to distribution chat:** E[commonLossFactor] prediction; the draw-vs-pure-premium constraint;
  existing dead scaffolding (shockProbability etc.); catastropheFactor hook (restore, don't delete).
- **Property/TIV data** missing from the new roster.
- Finding 13 fix (thread instance.lossEnvironment to the audit page); finding 16 (expose
  riskControlEffectiveness — wanted before loss work); finding 12 (optional net-ratio display).
- Bad commits on record: `e94387e` (corrupt v9 capture, superseded by `8693655`).
- Claude Code paste-chips arrive EMPTY in this chat — use screenshots or .docx uploads instead.
