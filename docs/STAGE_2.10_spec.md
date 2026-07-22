### Stage 2.10 — Per-Line Prior Histories (each line simulates its own pre-game past)

**Goal:** Replace the single pool/WC-level pre-game history with a per-line one. Each active line
generates its OWN pre-game past (prior loss years, reserve development, opening position) by
running the same engine as live years, and each line's pre-game ending state becomes its Year 1
opening position. This makes each line start the game as the product of its own history rather
than a set starting value — the closing piece of the multi-line foundation.

**Design decisions (settled):**
- **Generation method:** reuse `processLineYear` (the SAME engine as in-game years) to simulate
  the pre-game years for each line — no separate history generator. Each line's past is therefore
  consistent with how it behaves in-game.
- **Number of pre-game years:** 3 (same for all lines, matching the current pool history depth).
- **Decisions for pre-game years:** default decisions for all pre-game years (represents a pool
  that was being managed steadily before the player took over — the player did not make these).
- **Opening-position hand-off:** after the 3 pre-game years run, each line's ending state
  (surplus, reserves, invested assets, etc.) becomes that line's Year 1 opening position. The
  history feeds the game, it isn't just display.

**Seeding (critical — must stay reproducible and not disturb live draws):**
- The pre-game sim must use the seed deterministically so the same seed reproduces the same
  history every time.
- It must use its own derived per-line sub-streams (mirroring how Stage 2.9 gave each line its own
  `invest_GL` / `invest_Property` investment stream) so the pre-game draws do NOT shift the
  in-game year RNG. In-game year results for a given seed must not change because of how the
  pre-game history consumed random numbers.

**The work:**
- For each active line, run 3 pre-game years through `processLineYear` at default decisions,
  seeded per-line deterministically.
- Carry each line's pre-game ending state into its Year 1 opening position.
- Surface each line's own prior history on the Pool History page per line (this also addresses
  the deferred UI item about Pool History being WC-scaled — see UI_REFINEMENTS item 4; coordinate
  the two).

**Regression / correctness:**
- Pre-game years must tie out (Surplus Tie-Out Difference ~0), same as live years — essentially
  free since they reuse `processLineYear`.
- This WILL change Year 1 opening positions for every config (the opening position is now the
  product of a simulated history, not a fixed starting value) — including WC-only. So this is a
  baseline-shifting stage: capture a fresh v7 baseline set afterward. WC-only will NOT match v5/v6.
- Confirm each line's history is deterministic (same seed → same history) and that in-game draws
  are unaffected by the pre-game sim's RNG consumption (compare in-game year results against a
  build where pre-game sim is toggled off, if feasible, or verify the sub-stream isolation).

**Test:** start a 3-line game on seed MAMC6EA4; confirm each line shows 3 distinct pre-game years
on Pool History, each line's Year 1 opening position matches its pre-game ending state, everything
ties out, and re-running the same seed reproduces identical histories.

**Note:** run on Opus/Fable — this reworks initialization (how each line's opening state is
produced) and touches seeding, which is interlocking-correctness work, not additive display.
