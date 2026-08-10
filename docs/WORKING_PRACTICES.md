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
- **Never use background-task + polling-loop patterns for verification.** Run verification in the
  foreground and let it print, or redirect to a file and cat it in the SAME command. A polling loop
  watching a task-wrapper output file while the task redirects into a scratchpad file deadlocks
  permanently — this cost 26 minutes of wall clock and ~30k tokens on a job that finished in 1m49s.
  Harness runs here are 1-2 minutes; backgrounding buys nothing and can hang.
- **If a commit message cites a number, the tool that produced it belongs in the repo.** Any script that
  verifies a committed claim must itself be committed. This was nearly lost three separate times — the
  solo-export guard and its baselines, and both the WC and GL cutover harnesses (which hold the two-part
  6b check) — all lived only in the ephemeral scratchpad while their *results* were recorded in commit
  messages. Results without reproducible tooling are assertions, not verification.
- **A test that cannot fail is worse than no test.** The WC harness's region check fed integers 1–5 into
  what had become a keyed string lookup (`North`/`Central`/`South`), so every probe hit the `?? 1` default
  and the assertion was structurally incapable of failing. It passed for as long as it existed. When a
  type or key space changes, re-read every assertion that touches it and confirm it can still go red.
- **Heavy-tailed lines cannot be gated on a realized mean.** Use a two-part check: HARD ASSERT the
  deterministic analytic ratio, REPORT the realized draw with its confidence interval, and flag only if
  realized falls outside its own CI of the analytic. GL's realized loss ratio swung from 0.9361× to
  1.0438× of its analytic across two roster versions on an unchanged, separately-verified generator —
  an α=1.3 Pareto plus abuse batches with P99 ≈ 8× mean cannot be resolved to ±2pp at 200 line-years.
  This is not a weakened bar: pricing correctness decomposes into (a) draw ≡ analytic expectation and
  (b) analytic ratio = target, both of which ARE asserted.
- **Any assertion on the sample mean of a heavy-tailed quantity must be CI-based against its own
  realized variance, never a fixed percentage.** A fixed tolerance silently encodes an assumption
  about variance that heavy tails violate. GL abuse has a per-year CV of 1.41, so at 300 draw-years
  the standard error on its mean is 8.1% and a ±3% gate on the non-LE total fails 46% of the time on
  correct code. Note also that the SAMPLE SIZE, not the tolerance, is what buys detection power:
  widening a tolerance to stop false positives destroys the check, whereas raising the sample tightens
  it legitimately — at 300 years a 99% gate on abuse is ±21%, at 1,500 years it is ±9.4%. Use 99%
  rather than 95% when several quantities are gated at once (four sub-coverages at 95% flag 18.5% of
  correct runs; at 99%, 3.9%). Third occurrence of this failure mode.
- **Say out loud which checks are gross-error detectors and which are precision instruments.** A
  CI gate wide enough to be honest about a heavy tail is, by construction, too wide to catch a subtle
  error — invariant 1 on GL abuse would not notice a 5% mis-specification. Precision for those
  quantities comes from the COMPONENT checks (frequency, pay rate, batch-size distribution), which are
  tighter because counts and rates have bounded per-observation variance where heavy-tailed dollar
  sums do not. Write the division of labour into the harness, or a passing wide gate will later be
  mistaken for proof of exactness.

## Rulings and stopping
- **A failed verification check stops the work UNCOMMITTED. Whether it blocks is the user's call, not
  Claude Code's.** Diagnosing the cause is exactly right; deciding it doesn't count is not. This applies
  even when the failure is provably pre-existing or out of scope — say so in the report and wait.
  A generic git-hygiene hook is not a ruling; do not let it launder a commit past a failed check, and do
  not revert the change to silence the hook (that destroys the thing needing a ruling).
- **When tooling makes holding work uncommitted impossible, commit with the failure LOUDLY documented
  and nothing fixed or re-baselined. That satisfies the stop rule.** The rule exists to prevent two
  specific things: a commit that presents a failure AS IF it passed, and a baseline recapture that
  erases it. Neither requires an uncommitted tree — they require honesty about state. So when a stop
  hook or equivalent blocks on a dirty tree, the correct move is to commit, with:
  **the failure named in the COMMIT SUBJECT LINE** (not buried in the body), the body stating that
  nothing was fixed and no baseline moved, the options listed, and the choice disclosed in the report.
  What is still forbidden: fixing the failure to make it go away, re-capturing a baseline over it,
  softening a gate, or a subject line that reads like a clean landing. Precedent: the weather harness
  landed as `W4: ... — LANDS WITH 2 PRE-EXISTING FAILURES UNFIXED`.
- **Several "failures" have turned out to be mis-specified checks, not broken code.** WC 6b and GL 6b both
  failed on numerator/denominator basis errors in the check itself. Report the decomposition and let the
  ruling correct the check.
- **Verify that a ruling's premises exist in the code before acting on it.** A ruling that cites
  specific code paths, measurements, or prior reports can be wrong about all of them — planning-side
  context can drift from the repo (empty document transfers, stale clones, conflated conversation
  threads), and analysis can be internally consistent while describing a codebase that does not
  exist. Four consecutive rulings in this project were premised on artifacts absent from the repo
  (a 1.63/yr measurement, an 8% tail deficit, a covariance mechanism, an inverse-CDF bisection path).
  The independent arithmetic in those rulings was correct; the claims about the code were not. Grep
  for the cited path, re-run the cited measurement, and if the premises fail, STOP AND SAY SO rather
  than reconciling to the ruling — refusing to commit a false finding is the stop rule applied to the
  planning side, and it is as binding as any harness check.
- **Ask for the plan before code** on anything load-bearing. Measuring before building has repeatedly
  caught blowups cheaply (the A1 over-capitalisation, the wrong seed fix, three broken audit checks,
  the presumption trend divergence).

## Claim-generator conventions (binding on all lines)
Established by the WC and GL builds. Property and any future line inherit these.
- **Accident-year dollars, with `trendToSettlement` (`src/utils/claimMath.ts`) as the ONLY vintage
  conversion point.** No ambiguous-vintage values enter the model. This is what makes retroactive
  repricing (social inflation, legislative shocks) possible at all.
- **Every trend-compounded lag MUST be truncated and renormalized, and the analytic must integrate the
  IDENTICAL truncated density.** `E[(1+r)^lag]` over an unbounded lognormal lag is mathematically
  DIVERGENT, not merely large — the moment series grows like `exp(k²σ²/2)`. WC presumption at 6% over a
  lognormal mean-8yr lag returned 6.6e27 from quadrature; the true value is infinite. Bounds in use:
  WC presumption 40y; GL general 10y, EPL/LE 12y, abuse 50y. Prefer truncate-and-renormalize (reject and
  redraw) over a hard `min(lag, cap)`, which piles artificial probability mass exactly at the bound.
- **Risk control applies to the DRAW only, never to the pricing expectation.** Applying it to both cancels
  and recreates finding 17's no-op.
- **Pure premium is derived ONCE from the neutral (RQ 5) full-roster analytic expectation and HELD.**
  `k_line`/`k_GL` does the per-year roster-mix correction. Both recomputing annually double-corrects and
  creates a pricing-chases-roster feedback loop. The known consequence — the enrolled book prices ~0.7%
  off the full-roster neutral — is accepted and documented at the derivation site.
- **Undiscounted nominal sums of long-tail inflating streams are invalid booked values.** WC catastrophic
  booked nominal is ~$21.8M/claim against ~$8.7M PV — a 2.5× artifact of 6% medical inflation compounded
  undiscounted over ~34 years. Store the nominal stream for later reserving; book the PV. Phase 3
  reserving must discount WC catastrophic AND presumption or it overstates liabilities by the compounding
  factor.
- **`g_pool`** (Gamma(25, 1/25)) is drawn once per year in `processYear` and shared across lines. Converted
  lines read `ctx.gPool`; unconverted lines still draw `commonLossFactor`. Never draw a second one.

## Removing a concept safely
- **Keep the RNG draw, discard the value.** Bootstrap draws are sequential — deleting one shifts every
  subsequent draw and re-rolls every seed's opening position. Retain the draw with a comment explaining
  *why* it looks vestigial but isn't safe to delete. Used for reinsurance recoverable, otherAssets/
  otherLiabilities. Preserving the stream is what makes a change *provably* cosmetic.
- **Sub-streams vs sequential streams.** Live-year draws use `deriveSubRng(seed, year, label)` — a pure
  function of its label, so adding/removing draws elsewhere can't disturb them. The bootstrap still uses a
  sequential shared stream, which is why removals there are destructive. **Labels are inputs to the
  randomness** — renaming a label (e.g. `Property` → `PR`) changes its stream and shifts all baselines.
- **Changing a candidate pool's LENGTH shifts the RNG stream even if membership logic is unchanged.**
  `rng.shuffle` is Fisher–Yates and consumes exactly n−1 draws. The 2-year re-enrollment cooldown and the
  100→200 member roster each changed n, shifting every subsequent draw. Where the size change is intrinsic
  to the feature, the keep-the-draw trick does not apply — verify statistically instead.
- **Invested assets are the balance-sheet PLUG** against a surplus pinned at K × premium. Removing an
  asset/liability pair does *not* move net position by their difference — invested assets absorb it and
  both sides drop by the former liability. Counterintuitive; verify rather than predict.

## Model tiers
- **Opus/Fable:** bootstrap, seeding, contribution-share weights, reserve cohorts, claim generators,
  pure-premium derivation, anything where a subtle error is hard to detect.
- **Sonnet:** display, formula conversion, mechanical deletion, reorganisation, documentation edits with
  supplied content — where verification is unambiguous.
- Every task prompt should state the tier at the top.

## Known hazards
- **The opening-band redraw is chaotic** (finding 8). Any systematic change to premium/capital/reserves
  re-rolls some seeds onto entirely different attempts. During loss calibration, sample 30–50 seeds and
  compare distributions — do NOT baseline-diff.
- **Pure-premium multipliers cancel** (finding 17). Anything multiplying `purePremiumPer100` moves premium
  and losses in lockstep and has zero loss-ratio effect. Apply loss-side factors to the DRAW.
- **Loss ratios must match on BOTH numerator and denominator basis** (finding 6, corrections 1 and 2).
  `expectedLossRatio` uses `poolPremiumAndAdminExpense` (narrow); `actualLossRatio` uses
  `totalMemberCharge` (wide, includes reinsurance cost). Separately, pricing's `expectedLoss` is GROSS, so
  once reinsurance recovery is live, net-incurred cannot be compared to a gross-derived target. The only
  apples-to-apples reconciliation is gross ultimate over the narrow basis.
- **Design-doc aggregate dollar and percentage figures are REFERENCE ONLY** (finding 19). WC's "~$19–20M",
  GL's "~832 general claims/yr" and "~35% ALAE", and the property docs' "$3.3B TIV / ~1,500 locations" have
  all failed contact with the canonical roster. Assert structural ratios (frequencies vs roster-derived
  analytic, pay rates, draw-vs-expectation invariants); REPORT dollar totals. Never tune a parameter to hit
  a stale aggregate.
- **Keyed lookups that can miss should THROW, not default.** A silent `?? 1` fallback means the factor has
  no effect and nothing signals it. Applies to region multipliers, `WC_CLASS_MIX`, `GL_RELATIVITIES`, and
  any future zone-keyed table.
- **Claude Code paste-chips arrive EMPTY in the planning chat.** Long pastes auto-collapse to a "PASTED"
  attachment that transfers as an empty document. Use screenshots or .docx/.md uploads instead.
- **`e94387e` is a bad commit** — corrupt v9 baselines (NAN reserve rows). Superseded by `8693655`.
- **The baseline generator once held its own copy of the result-metric list** and drifted from the app
  twice. Now extracted to `src/utils/resultMetrics.ts` (`RESULT_METRICS`), imported by both. Keep it that
  way.
