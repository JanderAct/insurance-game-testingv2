# Stage 1.5+ Regression Baseline (v2) — WC-only

**Seed / Instance ID:** `MAMC6EA4`
**Configuration:** Workers' Compensation only. No manual decision changes — "Lock Year" x3.
**Asset allocation:** Cash 20% / Bonds 50% / Equities 30% (the Stage 1.5 default).
**Captured:** after Stage 1.5 (investment engine rewrite), before Stage 1.6.
**Raw data:** `BASELINE_WC_seed_MAMC6EA4_v2.csv` (full CSV export — the authoritative source).

## Why there's a v2
Stage 1.5 replaced the single `investmentRisk` slider with the cash/bonds/equities model.
That deliberately changes investment income, invested assets, surplus, and capital ratios — so
the original baseline (v1) is stale for those fields. Everything NOT downstream of investment
income was verified to still match v1 exactly (see below). Use v2 as the reference for Stage 1.6
onward.

## Verified against v1 (Stage 1.5 was clean)
**Unchanged from v1 (must stay identical — confirms no leak):**
- Pure Premium Rate: 7.9555 / 8.398 / 8.8652
- Pool Premium: 6,416,262 / 6,656,761 / 7,305,095
- Gross/Net Ultimate Loss: 3,425,822 / 4,571,007 / 5,402,915
- Admin Expense: 715,037 / 741,838 / 814,089
- Reinsurance Cost: 2,406,098 / 2,496,285 / 2,739,410
- All reserve figures, prior-year development, loss ratios, combined ratios — all match v1.

**Changed from v1 (expected — the point of Stage 1.5):**
| Field | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Investment Return Rate | +6.43% | −1.62% | +3.04% |
| Investment Income | 550,073 | −205,767 | 459,703 |
| Net Income | 3,335,354 | 1,851,406 | 2,277,756 |
| Ending Surplus | 8,233,011 | 10,084,416 | 12,362,173 |
| Excess Capital Ratio | 42.3% | 58.9% | 71.4% |

Note Year 2's **negative** investment return — the equities downside surfacing. The old engine
never produced this; the new one does, which is the intended behavior.

## How to use this for Stage 1.6
Stage 1.6 (inter-line borrowing) is dormant unless a line goes negative. So a healthy WC-only
game on seed MAMC6EA4 with the default 20/50/30 allocation, Lock Year x3, must reproduce the v2
numbers exactly — the loan system should not touch a pool that never goes into deficit. Any drift
in a healthy game = the loan logic is firing when it shouldn't.

## Fields newly visible in the CSV export (not in old screenshots)
Worth knowing these exist for later phases:
- **Shared Annual Loss Factor** (1.105 / 1.110 / 1.006) — the pool-wide correlation multiplier.
- **Catastrophe Factor** (1 / 1 / 1) — currently inert; will matter for shock events (Phase 4).
- **Shock Uplift / Shock Loss Incurred** (0 / No) — placeholders for the shock system.
- **Indicated Net Reserve at Confidence** (8,188,077 / 8,980,561 / 10,210,448) — the
  confidence-loaded reserve, relevant when reserve strategy (Phase 3) is built.

## Reproduction settings (for an exact rerun)
Rate Change 0, Funding Confidence 0.75 (CLF 1.346), Dividend 0, Assessment 0, Underwriting
Strictness 5, Risk Control 0, Reinsurance Level 2, Asset Allocation 20/50/30.
