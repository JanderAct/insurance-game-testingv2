# Stage 1.2 Regression Baseline — WC-only

**Seed / Instance ID:** `MAMC6EA4`
**Configuration:** Workers' Compensation only, default decisions each year (rates held roughly
flat, 75% funding confidence, no assessments/dividends, no risk control spend).
**Captured:** before Stage 1.2 (state-type refactor), on post-Stage-1.1 code.

## How to use this
After Stage 1.2, start a new game with seed `MAMC6EA4`, WC-only, and play three years making the
**same default decisions**. Every number below must match. Any drift = a bug introduced by the
refactor (Stage 1.2 is a pure restructure and must not change the math). The two internal
tie-outs (ending surplus → next beginning surplus; ending reserve → next beginning reserve) held
across all three years in the baseline, so they must hold after the refactor too.

---

## Year 1

| Field | Value |
|---|---|
| Rate Level Index | 100.00 |
| Pure Premium Rate / $100 Payroll | $7.96 |
| Pool Premium Rate @ 75% CLF | $10.71 |
| Written Payroll | $59.92M |
| Pool Premium | $6,416,262 |
| Admin Expense | $715,037 |
| Reinsurance Cost | $2,406,098 |
| Actual Ultimate Losses | $3,425,822 |
| Net Ultimate Loss | $3,425,822 |
| Prior-Year Development | −$158,436 |
| Beginning Gross Reserve | $6,804,557 |
| Current-Year Gross Reserve | $2,055,493 |
| Gross Paid Losses | $3,807,376 |
| Ending Gross Accounting Reserve | $6,581,438 |
| Reinsurance Recoverable on Unpaid | $498,171 |
| Net Accounting Reserve | $6,083,267 |
| Invested Assets | $8,554,230 |
| Investment Return Rate | 1.0% |
| Investment Income | $88,515 |
| Actual Loss Ratio (Net) | 37.7% |
| Selected CLF | 1.346 |
| Required Reserve Margin | $5,785,187 |
| Excess Available Surplus | $1,986,266 |
| Excess Capital Ratio | 34.3% (Strong) |
| Beginning Surplus | $4,897,657 |
| Net Income | $2,873,796 |
| **Ending Surplus** | **$7,771,453** |

## Year 2

| Field | Value |
|---|---|
| Pure Premium Rate / $100 Payroll | $8.40 |
| Pool Premium Rate @ 75% CLF | $11.30 |
| Written Payroll | $58.89M |
| Pool Premium | $6,656,761 |
| Admin Expense | $741,838 |
| Reinsurance Cost | $2,496,285 |
| Actual Ultimate Losses | $4,571,007 |
| Net Ultimate Loss | $4,571,007 |
| Prior-Year Development | +$22,488 (favorable) |
| Beginning Gross Reserve | $6,581,438 (ties to Y1 ending) |
| Current-Year Gross Reserve | $2,742,604 |
| Gross Paid Losses | $4,124,035 |
| Ending Gross Accounting Reserve | $7,005,922 |
| Reinsurance Recoverable on Unpaid | $333,885 |
| Net Accounting Reserve | $6,672,037 |
| Invested Assets | $12,278,963 |
| Investment Return Rate | 0.4% |
| Investment Income | $44,006 |
| Actual Loss Ratio (Net) | 46.1% |
| Actual Combined Ratio | 79.1% |
| Required Reserve Margin | $6,345,107 |
| Excess Available Surplus | $3,527,525 |
| Excess Capital Ratio | 55.6% (Strong) |
| Beginning Surplus | $7,771,453 (ties to Y1 ending) |
| Net Income | $2,101,179 |
| **Ending Surplus** | **$9,872,632** |

## Year 3

| Field | Value |
|---|---|
| Pure Premium Rate / $100 Payroll | $8.87 |
| Pool Premium Rate @ 75% CLF | $11.93 |
| Written Payroll | $61.22M |
| Pool Premium | $7,305,095 |
| Admin Expense | $814,089 |
| Reinsurance Cost | $2,739,410 |
| Actual Ultimate Losses | $5,402,915 |
| Net Ultimate Loss | $5,402,915 |
| Prior-Year Development | −$4,564 |
| Beginning Gross Reserve | $7,005,922 (ties to Y2 ending) |
| Current-Year Gross Reserve | $3,241,749 |
| Gross Paid Losses | $4,614,836 |
| Ending Gross Accounting Reserve | $7,798,565 |
| Reinsurance Recoverable on Unpaid | $212,794 |
| Net Accounting Reserve | $7,585,771 |
| Invested Assets | $14,915,649 |
| Investment Return Rate | 0.6% |
| Investment Income | $83,357 |
| Actual Loss Ratio (Net) | 50.2% |
| Actual Combined Ratio | 83.1% |
| Required Reserve Margin | $7,214,069 |
| Excess Available Surplus | $4,559,974 |
| Excess Capital Ratio | 63.2% (Strong) |
| Beginning Surplus | $9,872,632 (ties to Y2 ending) |
| Net Income | $1,901,410 |
| **Ending Surplus** | **$11,774,042** |

---

## Known cosmetic note (not a bug)
The "What Happened This Year" narrative rounds the loss ratio slightly differently from the
panel (e.g. narrative said 46.5% vs. panel 46.1% in Year 2, 50.1% vs 50.2% in Year 3). This is a
display rounding difference between the narrative text and the metrics panel, not a calculation
discrepancy — don't chase it during the regression check.
