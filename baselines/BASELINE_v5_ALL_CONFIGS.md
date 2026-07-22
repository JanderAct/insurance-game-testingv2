# Baseline v5 — Post Per-Line Investments (Stage 2.9) + Multi-Line xlsx Export (Stage 2.8)

**Seed:** `MAMC6EA4` · **Decisions:** baseline defaults, Lock Year ×3 · **Allocation:** each line
10/80/10 default (segregated per-line portfolios).
**Captured:** after Stage 2.9 (per-line segregated investments) and Stage 2.8 (multi-tab .xlsx
export). First baseline set captured from the new .xlsx export with real per-line breakouts.

## Files
- `BASELINE_v5_WC.xlsx` — WC only (Pool + WC tabs)
- `BASELINE_v5_WC_GL_PR.xlsx` — all three lines (Pool + WC + GL + Property tabs)
- (WC+GL divergence workbook was used for the divergence check, not kept as a baseline — it had
  WC at 0/100/0, not defaults.)

## Verification (all passed)
- **WC-only matches v4 exactly:** 83 rows checked, 0 mismatches. Confirms that with one line,
  segregated and shared portfolios are identical — WC-only is unchanged by Stage 2.9, as predicted.
- **Pool = sum of per-line tabs** on all summable rows (premium, losses, reserves, surplus,
  investment income), to the dollar (a $1 rounding difference on one beginning-surplus row is
  floating-point rounding, not a discrepancy).
- **Tie-out = 0** on every tab (Pool/WC/GL/Property), every year.
- **Per-line investment divergence confirmed in exported data:** in a WC+GL game with WC at
  0/100/0 (all bonds) and GL at 10/80/10 default, the exported tabs showed different returns —
  WC 1.25% / 4.96% / 2.65% vs GL 3.07% / 6.97% / 5.16%. This is the capability the old
  single-sheet CSV could not produce.

## WC+GL+PR per-line Ending Surplus (v5 defaults, all tie-out 0)
| Tab | Y1 | Y2 | Y3 |
|---|---|---|---|
| Pool | 5,612,359 | 8,772,281 | 12,321,008 |
| WC | 4,715,883 | 7,020,253 | 9,139,442 |
| GL | 442,306 | 1,038,883 | 2,109,645 |
| Property | 454,170 | 713,145 | 1,071,921 |

Pool = WC + GL + Property each year (to the dollar).

## Notes
- WC-only v5 == v4 == v3 (WC unaffected by the per-line investment change). The WC regression
  anchor is stable across all of v3/v4/v5.
- GL/Property allocations are still locked at the 10/80/10 default (per-line decision *editing* is
  Stage 2.7, not yet built). Once 2.7 lands and allocations become editable per line, capture a
  fresh set if default allocations change.

## Baseline lineage
- v1 — original, pre-refactor. Superseded.
- v2 — post investment-engine rewrite (20/50/30). Superseded.
- v3 — post 10/80/10 default. Superseded (WC still matches).
- v4 — post Year-1 initialization fix. Superseded (WC still matches).
- **v5 — post per-line segregated investments + xlsx export. Current reference.**
