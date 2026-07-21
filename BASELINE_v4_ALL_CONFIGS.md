# Baseline v4 — Post Year-1-Initialization-Fix (all line configs)

**Seed:** `MAMC6EA4` · **Decisions:** baseline (Lock Year, no changes) · **Allocation:** 10/80/10
**Captured:** after the Year 1 opening-balance initialization fix (instanceGenerator.ts surplus
allocation). This is the first set of **correct multi-line** baselines.

## Files
- `BASELINE_WC_seed_MAMC6EA4_v4.csv` — WC only
- `BASELINE_GL_seed_MAMC6EA4_v4.csv` — GL only
- `BASELINE_WC-GL_seed_MAMC6EA4_v4.csv` — WC + GL
- `BASELINE_WC-GL-PR_seed_MAMC6EA4_v4.csv` — all three lines

## What the fix corrected
GL/Property previously stored a reserves-only starting surplus (no asset share), producing a
negative Year 1 beginning surplus and a Year 1 tie-out gap equal to SHARED_NET ($10,953,236).
The fix redistributes the pool's opening surplus across active lines by net-reserve weight, so
each line's stored surplus matches its opening balance sheet.

## Verification (all passed)
- **Tie-out = 0** in every year for all four configs (was $10.95M in Year 1 for GL/multi-line).
- **GL Year 1 beginning surplus = $9,275,461** (was −$1,677,774) — matches the diagnosis' predicted
  value to the dollar.
- **WC-only is byte-identical to v3** — 0 mismatches. The fix did not disturb WC.
- **Pool total surplus only redistributed, not changed.**

## Beginning / Ending surplus by config (all tie-out 0)
| Config | Y1 Begin | Y1 End | Y2 End | Y3 End |
|---|---|---|---|---|
| WC | 4,897,657 | 7,938,248 | 10,327,380 | 12,569,915 |
| GL | 9,275,461 | 9,458,805 | 10,118,599 | 11,127,904 |
| WC+GL | 3,219,883 | 6,166,383 | 9,007,770 | 12,197,869 |
| WC+GL+PR | 2,454,276 | 5,608,334 | 8,657,956 | 12,144,725 |

Note: solo runs give the single line 100% of shared assets, so solo figures do not sum to
combined figures — expected by design. Each config reconciles internally.

## Baseline lineage
- v1 — original, pre-refactor. Superseded.
- v2 — post investment-engine rewrite (20/50/30). Superseded.
- v3 — post 10/80/10 default. **Still the WC-only reference (v4 WC matches it exactly).**
- **v4 — post Year-1 initialization fix. Current reference for all multi-line configs.**
