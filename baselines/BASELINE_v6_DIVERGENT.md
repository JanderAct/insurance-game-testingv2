# Baseline v6 — Divergent Per-Line Decisions (post Stage 2.7)

**Seed:** `MAMC6EA4` · **Captured:** after Stage 2.7 (per-line decision editing, Model A).
First baseline that exercises DIVERGENT per-line decisions rather than uniform defaults — so it's
the regression anchor for any future change that could affect per-line decision behavior.

## File
- `BASELINE_v6_WC_GL_PR_divergent.xlsx` — WC+GL+Property, seed MAMC6EA4, 3 years.

## Decisions set (the divergence being locked as the reference)
- **WC:** all defaults (rate 0, allocation 10/80/10).
- **GL:** rate change +10% every year; allocation default 10/80/10.
- **Property:** allocation equity-heavy 0/10/90; rate default.

## Verified behavior (all passed)
- Each line's decisions applied ONLY to that line (no cross-contamination):
  - GL premium elevated by the +10% rate: 1,178,801 / 1,227,916 / 1,250,171.
  - Property investment return swung hard from its 90% equity: −1.6% / +24.6% / −3.4%.
  - WC stayed conservative/steady: +2.98% / +2.67% / +2.76%.
- Tie-out = 0 on all four tabs, all years.
- WC-only game (separate export) still matches v5 exactly (85 rows, 0 mismatches) — enabling
  GL/PR editing did not disturb WC.

## The accepted micro-leak (see CALIBRATION_FINDINGS.md item 2)
WC's Y3 ending surplus is 9,139,481 here vs 9,139,442 in the v5 defaults baseline — a ~$39
(0.0004%) drift caused by Property's divergent decisions nudging the shared operating-cash split.
Known, accepted, negligible; not a bug. Do NOT treat this $39 as a regression failure in future
checks — it's expected whenever per-line decisions differ.

## Baseline lineage
- v1–v4 — superseded (see BASELINE_v4_ALL_CONFIGS.md for history).
- v5 — post per-line investments + xlsx export, DEFAULTS only. Still the clean defaults anchor;
  WC-only matches v5 exactly.
- **v6 — post per-line editing, DIVERGENT decisions. Reference for per-line-decision behavior.**

## How to use these two anchors
- **Regression for "did I break the engine":** WC-only defaults game must match v5 WC exactly.
- **Regression for "did I break per-line decision handling":** the v6 divergent run should
  reproduce (allowing the accepted ~$39 shared-cash drift, which is not a failure).
