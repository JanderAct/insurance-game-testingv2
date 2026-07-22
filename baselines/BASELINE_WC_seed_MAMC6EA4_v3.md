# Stage 1.6 Regression Baseline (v3) — WC-only

**Seed / Instance ID:** `MAMC6EA4`
**Configuration:** Workers' Compensation only. No manual decision changes — "Lock Year" x3.
**Asset allocation:** Cash 10% / Bonds 80% / Equities 10% (the new realistic default).
**Captured:** after the 10/80/10 default change, before/during Stage 1.6.
**Raw data:** `BASELINE_WC_seed_MAMC6EA4_v3.csv` (authoritative source).

## Why there's a v3
The default asset allocation was changed from 20/50/30 (v2) to 10/80/10. This changes investment
income, surplus, and capital ratios — so v2 is stale for those fields. v3 is the current
reference for Stage 1.6 onward.

## Verified clean against v2
**Non-investment fields — identical to v2 (0 mismatches):** pure premium rate, pool premium,
gross/net ultimate loss, admin expense, reinsurance cost, ending gross reserve, prior-year
development, actual loss ratio, active members (31), payroll exposure. The allocation change did
not leak into any underwriting/loss/reserve math.

**Investment fields — changed as expected for a conservative 10/80/10 posture:**
| Field | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Investment Return Rate | +2.98% | +2.67% | +2.76% |
| Investment Income | 255,310 | 331,959 | 424,482 |
| Net Income | 3,040,591 | 2,389,132 | 2,242,535 |
| Ending Surplus | 7,938,248 | 10,327,380 | 12,569,915 |

Returns are now smooth and all-positive — no negative year (v2 had −1.62% in Year 2 from its 30%
equity weight). This is the intended effect of the bond-heavy default: lower peak return, higher
stability.

## How to use this for Stage 1.6
Stage 1.6 (inter-line borrowing) is dormant unless a line goes negative. A healthy WC-only game
on seed MAMC6EA4, 10/80/10 default, Lock Year x3, must reproduce the v3 numbers exactly — the
loan system must not touch a pool that never goes into deficit. Any drift in a healthy game means
the loan logic is firing when it shouldn't.

To actually TEST the loan mechanic you must force a deficit (a healthy game won't trigger it):
drive a line negative via a large dividend + assessment cut, or hand-edited test state, then
confirm the prompt / authorize / repayment-skim / decline behaviors.

## Reproduction settings
Rate Change 0, Funding Confidence 0.75 (CLF 1.346), Dividend 0, Assessment 0, Underwriting
Strictness 5, Risk Control 0, Reinsurance Level 2, Asset Allocation 10/80/10.

## Baseline lineage
- **v1** — original, pre-Stage-1.2 (old investment engine, 0.4–1.0% tame returns). Superseded.
- **v2** — post-Stage-1.5 (new engine, 20/50/30 default, volatile incl. a down year). Superseded.
- **v3** — post 10/80/10 default change. **Current reference.**
