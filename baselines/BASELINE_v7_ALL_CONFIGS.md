# Baseline v7 — Per-Line Independence Complete (config-independent openings + shared-market investments + GL/Property resized)

**Seed:** `MAMC6EA4` · **Decisions:** defaults · **Years:** 3 · **Captured on branch:**
`seed-fix-per-line-opening`
**This is the reference baseline** for the fully independent multi-line model. Captured across all
three configs to *prove* config-independence.

## Files
- `BASELINE_v7_WC.xlsx` — WC only (Pool + WC)
- `BASELINE_v7_WC_GL.xlsx` — WC + GL (Pool + WC + GL)
- `BASELINE_v7_WC_GL_PR.xlsx` — all three (Pool + WC + GL + Property)

## What v7 captures (everything from the seed-fix-per-line-opening branch)
- **Per-line opening capital** — each line brings its own capital, sized by K × its own premium
  (K: WC 1.0 / GL 0.7 / Property 0.9, risk-weighted). Replaced the old shared-pot net-reserve
  split. Bootstrap total ~$19M (~1.15:1 premium-to-surplus).
- **Per-line adequacy redraw** — each line redraws on its own seed; one line failing adequacy no
  longer reseeds the others.
- **Shared-market investment returns** — one set of asset-class returns (cash/bonds/equities)
  drawn per year, shared across lines; each line blends by its own allocation. Same allocation →
  same return rate; more equity → more volatility.
- **GL resized ~5x** — GL premium now ~$8-9M (rate ×5 with loss cost, loss ratio unchanged).
  Exposure still = WC payroll.
- **Property resized ~7x** (carried from earlier) — Property premium ~$6-7M.
- **Per-line prior histories** (Stage 2.10) — each line's own 3-year pre-game past feeds its Y1
  opening.

## Headline per-line numbers (3-line config, v7)
| Line | Premium Y1/Y2/Y3 | Ending Surplus Y1/Y2/Y3 |
|---|---|---|
| WC | 7.34M / 7.75M / 8.18M | 17.42M / 18.28M / 20.22M |
| GL | 8.12M / 8.70M / 9.04M | 8.91M / 10.13M / 15.84M |
| Property | 6.25M / 6.78M / 7.13M | 14.69M / 16.76M / 20.97M |

Three comparably-sized substantial lines — no runt line anymore.

## Verification (all passed)
- **Tie-out = 0** on all four tabs, all years, all configs.
- **Pool = sum of lines** to the dollar (Y1 pool premium $21,714,018 = WC+GL+PR sum).
- **Config-independence:** WC byte-identical solo vs 3-line on roster/exposure/premium/losses/
  reserves — all three years. GL byte-identical (members) between WC+GL and 3-line.
- **Investment return rate identical across configs** (shared-market fix confirmed).
- **Determinism:** same seed → same everything (double-export byte-identical).

## Accepted residuals (NOT regressions — see CALIBRATION_FINDINGS.md)
- **WC+GL Y3 one-member flip:** in the WC+GL config only, WC ends Y3 with 38 members vs 39 in
  solo/3-line — the retained live shared-operating-cash coupling nudging one recruit by Y3.
  WC-only and 3-line remain byte-identical to each other. This is the accepted ≤0.03% shared-cash
  coupling; do not treat it as a regression failure.
- **Surplus micro-drift:** ending surplus differs ≤0.001% across configs from the same shared-cash
  split (e.g. WC Y3 solo 20,223,812 vs 3-line 20,223,944 = $132 on $20.2M).
- **GL/Property realized loss-ratio** carries the small fixed-dollar-reserve-seed drift accepted
  for the resizes.

## Baseline lineage
See BASELINE_LINEAGE_v4_to_v7.md for the full genealogy. In brief:
- v4 — post Year-1 init fix (first correct multi-line)
- v5 — post per-line investments + xlsx export
- v6 — post per-line decision editing (divergent-decisions anchor)
- **v7 — per-line independence complete. First version where even WC-only shifts** (per-line
  capital changed WC's opening), ending the "WC is the unchanging bedrock" era by design.

## How to use v7 as a regression anchor
- **Engine regression:** WC-only defaults should reproduce v7 WC exactly.
- **Config-independence:** WC's tab should stay identical across configs (through Y2 strictly; Y3
  allows the documented ≤1-member WC+GL flip).
- **Per-line/combined:** 3-line workbook is the primary anchor; Pool = sum of lines.
- Verify by PROPERTIES (ties out, config-independent, deterministic), not value-matching against
  earlier versions — v7 numbers differ from v5/v6 by design.
