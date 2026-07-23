# Baseline Lineage — v4 through v7

A genealogy of the multi-line baselines: what each version represents, what change caused the jump
to it, which numbers moved and why. Covers the multi-line-meaningful baselines (v4–v7). Earlier
v1–v3 were single-line / pre-multi-line refactor and are not covered here.

**Important reading note:** these baselines are NOT a smooth numeric trend. Each version reflects
a *different set of mechanics*, so the same seed (`MAMC6EA4`) produces a different game at each
version. Number movements below are explained by the mechanic change, not by any drift in a fixed
model. Compare a baseline only against its *own* version, never treat v5→v6→v7 as a progression of
the "same" number.

---

## v4 — First correct multi-line baseline
**Trigger:** the Year-1 balance-sheet initialization fix.
**What was wrong before:** GL and Property started Year 1 with negative surplus and a Year-1
tie-out gap (≈$10.95M, equal to SHARED_NET), because non-WC lines stored a reserves-only starting
surplus inconsistent with their opening balance sheet.
**The fix:** redistribute the pool's opening surplus across active lines by net-reserve weight, so
each line's stored surplus matches its opening balance sheet.
**Numbers that moved:** GL/Property Year-1 opening surplus corrected (GL Y1 begin went from
−$1.68M to +$9.28M). WC unaffected.
**WC status:** byte-identical to v3.
**Role:** first baseline where all configs tie out; the foundation multi-line reference.

---

## v5 — Per-line segregated investments + xlsx export
**Trigger:** Stage 2.9 (per-line investments) and Stage 2.8 (multi-tab xlsx export).
**What changed:** investments went from one shared/commingled pool portfolio to per-line
portfolios — each line invests its own assets with its own cash/bonds/equities allocation and keeps
its own gains/losses. Inter-line loan rate became the pool's asset-weighted blended return.
**Numbers that moved:** investment income and anything downstream of it (surplus, capital ratios)
for the multi-line configs, because each line now earned on its own portfolio rather than a share
of a pooled one.
**WC status:** byte-identical to v4/v3 (with one line, segregated and shared portfolios are
mathematically the same).
**Role:** the defaults anchor after investments went per-line.

---

## v6 — Per-line decision editing (divergent-decisions anchor)
**Trigger:** Stage 2.7 (per-line decision editing, Model A strict per-line).
**What changed:** GL and Property decisions became independently editable (previously only WC's
inputs were editable). v6 was captured with DIVERGENT per-line decisions (e.g. GL rate +10%,
Property equity-heavy, WC default) to anchor per-line-decision behavior specifically.
**Numbers that moved:** whatever the divergent decisions drove — GL premium up from its rate
change, Property investment returns swinging from its equity-heavy allocation, etc. This was a
deliberately non-default run.
**WC status:** byte-identical to v5 (making GL/PR editable didn't disturb WC; leaving decisions at
default reproduced v5).
**Role:** the "did per-line decision handling break" anchor. Exercises divergent decisions, unlike
the defaults-only v5.

---

## v7 — Per-line independence complete
**Trigger:** the `seed-fix-per-line-opening` branch — several changes at once:
- Per-line opening capital (each line brings its own, sized K × its premium; K = WC 1.0 / GL 0.7 /
  Property 0.9), replacing the shared-pot net-reserve split.
- Per-line adequacy redraw (each line redraws on its own seed).
- Shared-market investment returns (one asset-class draw per year, shared; each line blends by its
  own allocation — fixes the bug where identical allocations gave different/opposite returns).
- GL resized ~5× (premium ~$8-9M, loss ratio unchanged).
- Property resized ~7× (premium ~$6-7M) — carried in from just before the branch.
- Per-line prior histories (Stage 2.10) feeding each line's Year-1 opening.
**What changed:** essentially every number, for every config — because opening capital, investment
draws, and two lines' sizes all changed.
**WC status:** **v7 is the FIRST version where even WC-only shifts.** From v3 through v6, WC-only
was byte-identical — a stable bedrock signalling the refactors were clean. At v7, per-line opening
capital changed WC's own opening position, so WC-only moves too. This deliberately ends the
"WC is the unchanging anchor" era.
**Config-independence:** now a proven property — WC byte-identical across WC-only / WC+GL / 3-line
(through Y2 strictly; a documented ≤1-member flip in WC+GL at Y3 from the retained shared-cash
coupling). GL identical between WC+GL and 3-line.
**Role:** the current reference. All three lines are now substantial and comparably sized
(WC ~$7-8M, GL ~$8-9M, Property ~$6-7M), genuinely independent, config-independent.

---

## Quick "why did the numbers change" reference
| Jump | Cause | WC-only affected? |
|---|---|---|
| v3 → v4 | Year-1 init fix (GL/PR opening surplus) | No |
| v4 → v5 | Per-line segregated investments | No |
| v5 → v6 | Per-line decision editing (divergent run) | No (defaults reproduce v5) |
| v6 → v7 | Per-line capital + shared-market investments + GL/PR resize + prior histories | **Yes — first WC shift** |

## Still pending (would drive a future v8)
- The per-line loss-distribution rework (each line distinct frequency/severity/tail) — planned,
  see CALIBRATION_FINDINGS.md item 3. That will be baseline-shifting → v8 when done.
