# Working Practices — hard-won operational lessons
Things that were discovered expensively and live only in conversation memory. Read before doing engine work.

## Verification
- **`npm run typecheck` is the real command.** Root `tsc --noEmit` is a NO-OP — root tsconfig has
  `"files": []` with project references, so it checks zero files and always exits 0. Several earlier
  "typecheck clean" claims were vacuous.
- **Hand-check a printed sample of any displayed formula.** A harness that verifies operands cannot see
  *formatting*. Twice a displayed rate was too imprecise to hand-multiply back to its row (e.g. "−0.8%"
  against a −$153,009 row). Only manual sample inspection caught it, both times.
- **Verify by properties, not baseline diffs, when a change is baseline-shifting** — ties out, in band,
  deterministic, config-independent. Value-matching only works for cosmetic changes.
- **Baseline-neutrality is the strongest test for a structural change.** If defaults produce byte-identical
  output, the restructure provably didn't leak into the math. The "projection" pattern (copy pool values
  into line slices at `processYear` entry) achieved this for the pool-wide decisions change.

## Removing a concept safely
- **Keep the RNG draw, discard the value.** Bootstrap draws are sequential — deleting one shifts every
  subsequent draw and re-rolls every seed's opening position. Retain the draw with a comment explaining
  *why* it looks vestigial but isn't safe to delete. Used for reinsurance recoverable, otherAssets/
  otherLiabilities. Preserving the stream is what makes a change *provably* cosmetic.
- **Sub-streams vs sequential streams.** Live-year draws use `deriveSubRng(seed, year, label)` — a pure
  function of its label, so adding/removing draws elsewhere can't disturb them. The bootstrap still uses a
  sequential shared stream, which is why removals there are destructive. **Labels are inputs to the
  randomness** — renaming a label (e.g. `Property` → `PR`) changes its stream and shifts all baselines.
- **Invested assets are the balance-sheet PLUG** against a surplus pinned at K × premium. Removing an
  asset/liability pair does *not* move net position by their difference — invested assets absorb it and
  both sides drop by the former liability. Counterintuitive; verify rather than predict.

## Model tiers
- **Opus/Fable:** bootstrap, seeding, contribution-share weights, reserve cohorts, anything where a
  subtle error is hard to detect.
- **Sonnet:** display, formula conversion, mechanical deletion, reorganisation — where verification is
  unambiguous.
- Ask for **the plan before code** on anything load-bearing. Measuring before building has repeatedly
  caught blowups cheaply (the A1 over-capitalisation, the wrong seed fix, three broken audit checks).

## Known hazards
- **The opening-band redraw is chaotic** (finding 8). Any systematic change to premium/capital/reserves
  re-rolls some seeds onto entirely different attempts. During loss calibration, sample 30–50 seeds and
  compare distributions — do NOT baseline-diff.
- **Pure-premium multipliers cancel** (finding 17). Anything multiplying `purePremiumPer100` moves premium
  and losses in lockstep and has zero loss-ratio effect. Apply loss-side factors to the DRAW.
- **Claude Code paste-chips arrive EMPTY in the planning chat.** Long pastes auto-collapse to a "PASTED"
  attachment that transfers as an empty document. Use screenshots or .docx uploads instead.
- **`e94387e` is a bad commit** — corrupt v9 baselines (NAN reserve rows). Superseded by `8693655`.
- **The baseline generator once held its own copy of the result-metric list** and drifted from the app
  twice. Now extracted to `src/utils/resultMetrics.ts` (`RESULT_METRICS`), imported by both. Keep it that
  way.
