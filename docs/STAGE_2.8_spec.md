### Stage 2.8 — Multi-Line Results Export (.xlsx, tab per line)

**Goal:** Replace the current single-sheet CSV results export with a multi-tab Excel (.xlsx)
workbook that breaks out every active coverage line separately, plus a combined Pool tab. Today's
export only shows one set of results (pool-level combined, or a single line when only one is
active); it can't show each line's individual results in a multi-line game.

**The work:**
- Change the results export from `.csv` to `.xlsx` (a real workbook with multiple tabs — CSV
  cannot hold multiple sheets).
- One tab per **active** line, plus a **Pool** (combined) tab. Only active lines get tabs — a
  WC+GL game produces Pool / WC / GL (no empty Property tab).
- **Tab order:** Pool first, then WC, GL, Property (in that fixed order, active lines only).
- **Each line tab:** the same rows/metrics as today's CSV export, scoped to that line, **plus a
  few line-specific fields where relevant** (e.g. that line's exposure base and units — payroll
  for WC/GL, TIV for Property — and any line-specific reinsurance/reserve fields that only make
  sense per line). Keep the familiar row structure so it reads like today's export.
- **Pool tab:** the combined/summed totals across active lines (equivalent to today's pool-level
  export), so Pool = sum of the line tabs on the summable metrics.

**Filename (supersedes UI_REFINEMENTS item 3):** `SEED_{seed}_{lines}_YR{currentYear}.xlsx`
- `{lines}` = active lines joined with underscores in fixed order WC_GL_PR (Property = PR), e.g.
  `SEED_MAMC6EA4_WC_GL_PR_YR3.xlsx`. This replaces the single-line filename convention that item
  was originally written for — handle them together.
- Contents still include every played year (columns Y1..current), same as today — only the
  format and the per-line breakout are changing.

**Regression / correctness checks:**
- Pool tab must equal the sum of the per-line tabs on summable metrics (premium, losses,
  reserves, etc.) — same reconciliation that holds in the app's Pool view.
- Every line tab must still tie out (Surplus Tie-Out Difference ~0), matching the v4 baselines.
- A WC-only game produces Pool + WC tabs whose numbers match the v4 WC baseline exactly.
- No engine/calculation changes — this is an export/format change only.

**Note:** this makes verification EASIER going forward — a single .xlsx will contain every line's
results in one file, so baseline captures and cross-checks won't need multiple separate CSV
exports per config.

**Test:** export from a 3-line game; confirm four tabs in order (Pool, WC, GL, Property), each
line tab scoped correctly, Pool = sum of lines, filename matches the convention, and all tabs
tie out.
