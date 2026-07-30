# Brief — Loss Distribution Work
For the chat/agent building claim-level loss distributions. Read this before finalising any severity
parameters. Full context: CALIBRATION_FINDINGS.md findings 6, 7, 9, 11, 17, 18.

## THE ONE CONSTRAINT THAT MATTERS
**Apply loss factors to the DRAW, never to pure premium.**

```
Gamma mean:      memberExposure × newPurePremiumPer100 × 10,000
simulated loss:  independentLoss × commonLossFactor × catastropheFactor
premium:         exposure × newPurePremiumPer100 × CLF × rateLevel
```

`purePremiumPer100` appears on both sides and cancels. Anything multiplying it has **zero loss-ratio
effect** — proven: loss trend and risk-control effectiveness are both no-ops (0.000pp premium-vs-loss CAGR
divergence across 5 seeds × 12 years). `commonLossFactor` and `catastropheFactor` multiply the draw *after*
the mean is set, so they DO move the loss ratio. Build there.

## TASK 1 — Test this prediction first (cheap, high value)
Actual loss ratio runs ~46% against a 66.8% pricing assumption; only 2 of 60 line-years reached expected.
Since `E[loss ratio] ≈ E[commonLossFactor] / (CLF × rateLevel)`, the prediction is:

**`E[commonLossFactor] ≈ 0.69` rather than 1.0.**

If it measures ~0.69, finding 6 (the single largest open issue) is a one-parameter fix. If it measures 1.0,
the gap is elsewhere and needs hunting. `commonLossFactor` is a lognormal with constant
logMean/logSigma/multiplier, `simulationEngine.ts:203-206`.

## TASK 2 — Don't rebuild what already exists
The catastrophe system was **designed and abandoned**, not never built:
- `catastropheFactor` — hardcoded to `1` at `simulationEngine.ts:210`, applied at `:232`. **Restore it;
  do not delete it.** It's the hook for per-line tail amplification.
- `shockLossAmount` — computed and stored every year, never displayed. `shockLossIncurred` (boolean) IS
  consumed by ResultsPage. So a catastrophe *threshold* concept already exists.
- **`instance.lossEnvironment` is dead except `lossTrend`:** `baseLossRatio`, `volatility`,
  `shockProbability`, `shockSeverityMultiplier`, `heavyTailRisk` are all drawn **per instance**, typed, and
  never read (superseded by flat `AGGREGATE_LOSS_DISTRIBUTION` / `MEMBER_LOSS_VOLATILITY` constants).

Per-instance draws mean the original design gave **each seed its own loss environment** — some volatile,
some calm, some shock-prone. That's the scenario variety wanted for instructor-assigned play, already
scaffolded.

## TASK 3 — Per-line profiles
Finding 7: Property currently has the **narrowest** loss-ratio spread of the three lines (11pt vs GL's
39pt) — backwards for the catastrophe-exposed line. Targets:
- **WC** — high frequency, low severity, long tail (7–10yr payout)
- **GL** — moderate frequency, wider severity dispersion, medium tail. Its CLF curve is empirically
  *steeper* than WC's, which implies more relative aggregate spread.
- **Property** — low frequency, high severity, genuine catastrophe tail, short payout

## WHAT THIS UNBLOCKS
Six mechanics are currently dormant *solely* because losses are too small to trigger them: reinsurance
recovery (fires 2 of 15 line-years), loss ratio >100% (2 of 60), Property cat risk, the operating-cash
liquidity floor (**0 of 2,322** scope-instances), the zero-investments floor (0 of 2,322), and the
dividend-block condition. Recentring losses turns on machinery that already exists.

## DELIVERABLES THE REST OF THE BUILD NEEDS FROM YOU
1. **Claim counts** per line-year — needed to drive ULAE and (if ever revived) credibility.
2. **Severity CV per line** — the CLF confidence-to-multiplier curves should be **derived** from the
   aggregate loss distribution (the multiplier at 75% confidence *is* the 75th percentile ÷ the mean), not
   hand-set. Otherwise there are two independent assumptions about the same thing and they drift.
3. **Reporting patterns** if feasible — what share of an accident year is reported by year-end, year 2,
   year 3. This gives Phase 3 real IBNR-vs-case structure without per-claim tracking.

## MEASUREMENT WARNING
The opening-band reject-and-redraw is **chaotically sensitive** (finding 8): any systematic change to
premium/capital/reserves flips some seeds onto entirely different pre-game attempts (a 1% premium change
re-rolled 9 of 72 seed-lines). **Do not verify by baseline diff.** Sample 30–50 seeds and compare
distributions. Build that harness first.

## DECIDED SCOPE
Frequency/severity + aggregate reporting patterns — **not** per-claim lifecycle simulation. Reserving is a
management-consequence mechanic (funding adequacy expressed through rates/CLF), not an actuarial estimation
exercise, so emergent noisy triangles aren't needed. Per-claim is deferred (mainly required later for
occurrence-based reinsurance).
