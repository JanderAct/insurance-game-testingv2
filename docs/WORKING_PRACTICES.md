# Working Practices — hard-won operational lessons
Things that were discovered expensively and live only in conversation memory. Read before doing engine work.

## Verification
- **`npm run gates` is the sweep, and the sweep is the complete set.** There used to be no sweep — just a
  dozen script names carried by hand from one commit message to the next. Two gates went red inside that
  arrangement without anyone noticing: `allocation-grid` threw for a whole commit, and
  `cession-path-independence` had been failing for four. Running the third one down
  (`panel-engine-parity-check`) for the first time found it red too.
  - `npm run gates` — 44 gates, ~2 min wall clock. Every commit.
  - `npm run gates:slow` — `property-tower-mc` (~21 min) plus both CLF grid derivers. Before a merge, and after any tower, severity or GL cap change.
  - `npm run gates:all`, `npm run gates:probes`, `npm run gates:list`.
  - **The manifest in `scripts/gates.ts` is checked against the directory on every run.** A new script in
    `scripts/diagnostics/` that is in no list fails the runner by name. That check, not the list, is the
    thing that keeps the sweep complete — a list alone only fixes the omission you already know about.
  - **A script named `*-check` is not necessarily a gate, and there are TWO different ways that goes
    wrong.** This bullet used to say "eleven of them print and assert nothing", which straddled the two
    and hid the worse one. Measured: **nine** asserted nothing at all — renamed to `*-report`
    (`loss-ratio`, `membership-equilibrium`, `opening-basis`, `property-fit`, `reinsurance-layer`,
    `tower-downside`, `wc-behaviour`, `wc-cap-stability`, `ibner-clf-basis`) — and **five** asserted,
    printed `FAIL` per row, and then **exited 0**, so the runner printed `ok` beside a script that had
    just printed FAIL. Four of those five were promoted to real gates (`gl-claim-check`,
    `gl-cutover-check`, `reinsurance-tower-check`, `wc-cutover-check`); the fifth,
    `clf-downside-check`, turned out to have nothing to promote and was deleted. Do not read a name as
    a verdict, and do not read a green runner line as one either.
  - **A probe still has to run.** `allocation-grid` asserts nothing and was still red, because it threw.
  - **A gate's NAME can become a coverage argument, and then the coverage is imaginary.** Three comments
    in the engine credited `property-fit-check` with asserting the Property mean severity and the derived
    held pure premium — one of them saying it was "the check that would otherwise be missing". That script
    asserts nothing. The assertions were real but lived in `property-claim-check`; the name alone carried
    them for months. When a comment says a script asserts something, open the script.
  - **A "green" gate is worth nothing until something has made it go red — and 24 of 40 here never had.**
    Put every gate through the same method used on a new one: perturb the thing it claims to watch with a
    *plausible* defect, confirm red, revert. 22 fired. `property-tower-mc` fired only at 80x its lattice
    size and passes an 8x coarsening, so it is a smoke alarm on that axis and now prints its own
    resolution. Two could not fire at all and were deleted. **Say what you perturbed and by how much** —
    "halved the constant" and "changed it 2%" are different findings, and a gate that only fires when you
    zero its subject has not been shown to catch anything a person would write.
  - **A tautology is the hardest vacuous check to see, because its comment agrees with you.**
    `const wcExpectedClf = 1.0; assert(wcExpectedClf === 1)` sat in `funding-expected-check` under the
    comment "the literal engine short-circuit — nothing to compute". The reader agrees there is nothing to
    compute and moves on. `clf-downside-check`'s only assertion was `(1+a+r)/(1+a+r) === 1` over hardcoded
    literals. Both read no engine value at all, which is the tell: **if a perturbation to the engine cannot
    reach the assertion, the assertion is about the harness.** Grep for `=== 1`, `note(true`, and locals
    assigned a literal and then asserted.
  - **Separate "cannot fire" from "obsolete" before deciding anything.** They look identical in a sweep and
    need opposite responses. `pool-market-share-check` was *structurally incapable* — its subject was alive
    and watched three times over, it just never read it; that is a bug and it was deleted because the
    coverage existed elsewhere. `enrolment-independence-check`'s WX columns were *obsolete* — the weather
    band moved into the fitted severity mixture and no draw remains, so there was nothing to assert; the
    columns went and the gate stayed. **A hardcoded pass is not a skipped test, it is a test that says PASS.**
  - **Before deleting a gate, name the file that asserts the property and the perturbation that proves it.**
    Not "something else also looks at this". Both deletions here cleared that bar: `ratio-basis-check` holds
    the combined-ratio identity at 1e-12 against the real engine and fails on a gross loss numerator;
    `pool-aggregation-check` fails and names `marketShare` by field on the same zeroing that left the
    deleted gate green. Where the coverage went is written into `scripts/gates.ts`, so the name cannot be
    re-added on the strength of the name.
  - **A number presented as an EXTERNAL ANCHOR must name where it came from, in the constant, or the label
    is unfalsifiable.** `CLAIM_OPEN_SHARE_SOURCE` was named `_SOURCE` and described as the pool's own claim
    development. It was this model's own value-weighted open register, read one age later. On that label a
    whole finding was published — "GL's closure curves hold value open 2.3x longer than the pool's book" —
    and retracted at the next commit. **The durable fix is not "check your labels".** It is that an anchor
    should carry the file, extract or run it came from, so a reader can go and look; a provenance claim
    nobody can check is a claim resting on recall, and recall is what failed here. Two descriptions of the
    same column were in front of me and I propagated the wrong one without reconciling them. Where the
    source genuinely cannot be in the repo, say what it is and say what would falsify the label — here,
    that the model reproduces the series at age a+1 with an RMS error of 2.23pp against 16.66pp unshifted,
    which settles it in one run.
  - **An unconditionally-true condition is invisible to lint, and this is the sixteenth instance of the
    family.** `if (a + 1 <= closureAge - 1 + 1 && a + 1 <= closureAge)` — `closureAge - 1 + 1` is
    `closureAge`, so both conjuncts are the loop guard four lines above. TESTED, so the next reader does not
    reach for the wrong tool: `no-constant-binary-expression` and `no-constant-condition` both return **zero
    messages** on that exact expression, because neither operand is constant and the two sides are not
    textually identical. There is no rule to switch on. **Catch it with a runtime identity instead, and
    prefer an EXACT one.** `openEnd[a] === openStart[a+1]` needs no tolerance, no sample size and no noise
    budget — a claim open at the end of a year is a claim open at the start of the next — and a
    reintroduced tautology collapses the two series and breaks it at every age at once. Measured: the
    restored defect produces 9 failures. An exact identity is the cheapest assertion there is; reach for one
    before reaching for a threshold.
- **"Store the inputs, not the output" — and check whether the inputs are already stored before adding
  any.** Claim regeneration was briefed as persisting five scalars per line-year against the ~7 MB of claim
  objects they replace. Tracing each one: the roster (`memberList`) and `kLineApplied` were already on the
  `LineResultSet`; `gPool` is `deriveSubRng(seed, year, 'wc_gpool')`, a pure function of two things already
  stored; the shock effects come from `resolveShocks(instance, year)`, which consumes no randomness and
  reads an `instance` field never mutated after creation. **One input was genuinely missing** — the
  rc-effectiveness applied to the year's draw existed only as the line state's rolling *current* value, so
  a past year's was recorded nowhere. It became `rcEffectivenessApplied`, one number per line-year. And a
  third stored input only showed up when the gate failed: pre-game years run on `(seed + attempt × 997)`,
  and `priorHistoryEngine` had already stamped `pregameAttempt` on each pre-game result *for this exact
  purpose* — the first run reproduced all 156 game line-years and got all 24 pre-game ones wrong by
  hundreds of claims. Three stored, one added, two derived; the save grew by about 3.4 KB.
  - **And the first draft of this paragraph said nothing needed adding.** The field named
    `riskControlEffectiveness` was visible on a result-shaped object in the engine and read as the per-year
    value; it was the line state. Typecheck caught it, not the tracing. When an input "is already stored",
    confirm it is stored *per period*, not merely *currently*.
  - **A derivable value stored is a second copy of one fact.** `gPool` was extracted from an inline
    expression into `poolYearFactor(seed, year)` so the engine and the regenerator call the same function,
    rather than storing the number or duplicating the expression. Same for the shock effects.
  - **The gate has to compare the register, not its totals — and it has to carry its own positive
    control.** `save-round-trip-check` regenerates every line-year of a restored game and compares it to the
    straight-through arm claim by claim on every field, ids included. It then regenerates once more with
    one input perturbed and asserts the result DIFFERS. A reproduction gate whose comparison could not
    fail would be a JSON tautology, and last time that had to be proved by hand.
  - **A regenerator that cannot reproduce must throw, not guess.** A save written before `kLineApplied`
    existed has no k to redraw with. Defaulting to 1 would produce plausible claims that were never drawn,
    silently — the exact failure the gate exists to catch, reintroduced as a fallback.
- **A comment that excuses a gap is only as good as the day it was written, and nothing re-reads it when
  the gap acquires a consumer.** Third instance of the shape, after `cededByLayer`. `enrolment-independence-
  check` excluded claim ids from its comparison with a paragraph saying the exclusion was safe because "no
  downstream consumer keys on them across runs". Every clause was true on the day. Then Stage 0's payment
  split started calling `isClaimClosed(gameId, claimId)`, and from that commit a claim's closure status,
  paid-to-date and the workbook's Status column all read the id. Nothing in the check changed; the thing
  it was excusing acquired a consumer elsewhere, and the excuse kept standing.
  - **GL was the only line where it bit** — its id embedded a counter across the whole member loop, so a
    roster change renamed every later member's claims without touching a value. WC and Property were
    already per-member. Fixed by matching them, and the check now COMPARES ids rather than excusing them:
    a note explaining why a gap is harmless became an assertion that it is closed, and restoring the
    counter turns every GL probe red.
  - **The tell for this shape: an exclusion justified by an absence.** "Nothing reads X" is a claim about
    the whole codebase at one moment. It cannot be checked from inside the file that makes it, and it
    silently expires the first time anything anywhere starts reading X. Prefer asserting the property to
    excusing its absence; where you must excuse, grep for the consumer at every commit that touches the
    thing excused.
- **"No value moved" needs the right fingerprint AND enough seeds — and the two failures look
  identical.** A six-seed value-only hash of every GL claim was byte-identical across the id change. An
  eight-seed probe on different seeds then showed GL gross loss moving 30–90% in six line-years. Both were
  correct: one seed had re-rolled onto a different opening-band attempt (finding 8 — the redraw is chaotic
  and any reserve change re-rolls some seeds), and from year 1 its roster shared only ~19–24 of ~58 members
  with the other arm — not "two fewer", a different pool. Its claims differed because its *members* did.
  - **The proof had to separate count from amount.** Of 96 member-years present in both arms, 4 differed —
    and every one was a claim *count* change (2→3, 17→18, 4→5, 1→2), a Poisson draw flipping on a lambda
    rescaled by the roster-dependent `k_line`, which `enrolment-independence-check` holds fixed for exactly
    this reason. **Zero differed by amount at the same count** — the shape an id reaching the severity draw
    would have. "No value moved" was true, but the first version of this paragraph said "identical in every
    member-year" before the probe had run, and that was false. Check a "nothing moved" result against a
    different seed set before writing it down; when something then moves, ask whether the roster moved
    first; and when common members differ, ask whether it is the count or the amount.
- **A truncated game reports performance the runoff has not had a chance to take back.** A five-year GL
  game ends with a median actual/expected loss ratio of 0.868; over complete cohort lives it is 0.964.
  **Ten of those thirteen points are truncation, not skill.** At year five roughly half of everything the
  casualty lines booked is still unpaid. Any figure that closes the game — ending surplus above all — is
  measuring an unfinished position, and a player who underpriced reads it as vindication.
  - **Show both the raw figure and what it nets to; never replace one with the other.** The surplus is
    what the balance sheet says and the net figure is what it means. A player has to watch them disagree.
  - **A ratio with a decision in its denominator measures the decision, not the thing.** Outstanding ÷
    premium reads WC 2.43x / GL 1.87x / Property 0.86x at defaults and 3.81x / 2.67x / 1.79x under a
    squeeze — the *player* moved, not the line. Outstanding ÷ everything-booked reads 50% / 50% / 22%
    either way. When a measure is meant to characterise the model, check whether a player's choice can
    move it.
  - **A panel that teaches a comparison must assert the comparison still holds.** `ending-position-check`
    fails if Property ever stops settling faster than the casualty lines. Without that the exhibit would
    keep rendering and would quietly teach the opposite of what it was built for.
- **A disclosure that changes what it discloses is not a disclosure, and the failure is invisible.** The
  un-emerged deficiency reads live cohort state. If computing it mutated anything, the number would still
  be self-consistent — just wrong, with nothing on screen to say so. The gate runs one seed twice, calling
  the disclosure every year on one arm and never on the other, and requires the two games to be identical.
  Any read-only claim about live state deserves that shape of test rather than an inspection.
- **Two views of one fact, built from different sources, will disagree — and neither looks wrong.** The
  claims workbook's line sheets read `lockedResults`, which starts at year 1. Its Development sheet reads
  `poolState`, whose cohorts include the pre-game years. So accident years -2, -1 and 0 had development
  listed on one sheet and no claim rows on any other, in the same file, for as long as both sheets have
  existed. Each was correct against its own source, which is exactly why neither read as a defect.
  - **The fix is one source or an assertion, not care.** The line sheets take `priorHistory` as a second
    source now, and `claims-workbook-check` asserts the two sheets' accident-year sets agree. Where a
    single source is not available, the cross-check has to be written down — "the sheets should match" in
    a header is not a check.
  - **Boundary constants belong to whichever module owns the concept, and get imported.** `PRIOR_BOUNDARY`
    is -2 because that is exactly the line between cohorts with a claim register and cohorts without.
    The workbook imports it from `actuarialMemo` rather than restating -2, so the exhibit's Prior row and
    the workbook's "cannot appear here" are one fact rather than two that happen to agree today.
- **A marker is a statement of a gap, not its resolution — say which at the site.** A reloaded game's
  claim sheets now name the first accident year whose detail survives and distinguish the two causes:
  a seed cohort with no register (permanent, nothing to act on) versus detail not retained across a
  save/restore (a session artefact a player may want to act on). That is worth having, and it is not the
  fix. Regeneration removes the second cause entirely and makes the branch dead code. Recorded at the
  marker so the next reader does not close the item on seeing it.
- **A comment describing behaviour nobody implemented reads as a guarantee.** `LineResultSet.claims` said
  it was "deliberately NOT persisted to localStorage (~800 claims/yr × years would blow the quota)" and
  "regenerated from seed × member × year on demand". Neither was true: `persistState` was a bare
  `JSON.stringify` of the whole `GameState`, nothing stripped anything, no regeneration function existed,
  and the save passed the ~5 MiB quota at **year 4** — after which every write threw `QuotaExceededError`
  into a bare `catch {}` and the game stopped being recorded, silently, for the life of the project.
  - **The sentence was load-bearing three times over.** It was repeated in four files, it was the stated
    reason `enrolment-independence-check` may ignore claim ids, and it was the premise of a plan to derive
    per-claim revision rather than store it. Each reader took it as settled because it reads as settled.
  - **The tell: a comment that describes a MECHANISM should name the code that implements it.** "Stripped
    on the way out by `gameSave.SAVE_STRIPPED_KEYS`" can be checked in one grep. "Is not persisted" cannot
    be checked at all — it describes an absence, and an absence looks identical whether it was arranged or
    merely assumed.
- **A defect can arrive by growth, with no commit that caused it.** Nobody broke the save; the save
  outgrew the quota as lines were added. Measured at year 10: WC-only 4.60 MiB (**never** crosses),
  WC+GL 7.85 MiB (crosses at year 6), all three 9.05 MiB (crosses at **year 4**). Every configuration the
  project used early was immune, so there was no bisectable moment and no arm to blame. Where a resource
  limit exists, gate the SIZE, not the change — `save-size-check` asserts the worst case the setup slider
  can reach rather than watching for a regression.
- **The reload path had no coverage because every gate runs straight through.** Thirty-five scripts, one
  process each, none touching storage — so the one thing a player does that a gate never did was the one
  thing that was broken. `save-round-trip-check` plays a game straight through, plays it again with a
  save/restore in the middle, and requires the years AFTER the reload to agree. Checking that the parsed
  object equals the written one is a JSON tautology; the value is in re-running the engine from the
  restored state.
  - **And it had to be shown to fail.** Adding `developingClaims` to the strip list made it report 12
    differences; the real list makes it green. A round-trip gate that cannot fail is a JSON test.
  - **`undefined` and absent are the same thing across a round trip.** `JSON.stringify` drops keys whose
    value is `undefined`, so every unset optional (`shockEvents`, `claimCount`, `claimCountsByClass`) is
    present-but-undefined on one arm and missing on the other. The first run reported 24 such differences
    and none were real. Fix the comparison, not the gate's threshold: `o.k === undefined` is true either
    way, so no consumer can tell them apart and neither should the diff.
- **Swallowing an error on the one thing that preserves a player's work is worse than the error.** The
  quota was a capacity problem with a fix; `catch {}` turned it into an invisible one. But the answer is
  not to throw either — that would unmount the React tree and destroy the in-memory game as well as the
  stored one, which in a facilitated room of ten people is a white screen nobody can debug. Keep the
  session alive, return the failure, and make the UI impossible to miss.
- **A per-row quantity that is computable one row at a time will be, and that is where the incoherence
  hides.** The claim payment split was `claimPaidWeight(claimGrossUltimate, registerGrossSum)` — pro rata,
  no other input needed — so every OPEN claim was handed the cohort's *average* paid share and the claims
  workbook printed GL files marked `open` at **99.8% paid**. Nothing was wrong with the arithmetic; the
  function simply could not see the fact that would have made it wrong, because a claim's cohort-mates
  were not in its signature.
  - **The fix was a signature change before it was a rule change.** A closed file has paid everything it
    will ever pay, so what is left for the open ones depends on which of them are closed. That is a
    property of the register, and `claimPaidSplit(claims[], cohortGrossPaid)` can express it while the
    per-claim form cannot. When a quantity keeps coming out incoherent, check whether its inputs can even
    represent the constraint before tuning the formula.
  - **Normalising weights without enforcing the cap over-pays exactly the wrong rows.** The obvious fix —
    weight each claim by its own closure progress — was measured and is *worse*: it left **78.2% of open WC
    claims at zero headroom** against 0.0% under the rule it replaced. A closed claim cannot absorb more
    than its own ultimate, but a normaliser that only sees weights does not know that, so the dollars it
    cannot take are handed to the open claims instead of withheld. This is independent of the weight's
    shape, so no better weight fixes it. Tiered allocation, not cleverer weighting.
- **A green standing gate proves nothing outside its own scope, and the scope is narrower than the name.**
  This change moved every Gross Paid cell in the claims workbook. `value-identity-check` passed — it keys
  on `RESULT_METRICS` field names and the split is not a metric. `solo-export-guard` passed — it SHA-256s
  the *summary* workbook and this is the *claims* workbook. Both were right to pass. The Paid column had
  no baseline and no assertion at all, which is why the visible contradiction survived: the gates that
  would have caught it were not looking at it, and their green was quoted as though they were.
  - **The check now lives where the defect was visible** (`claims-workbook-check`), not where it was
    convenient. And it is written down there that the assertion it carries — open files must not have paid
    their whole incurred — **would not have caught the original defect**, because 99.8% is under 100%. The
    quantiles printed beside it are what a reader compares. An assertion that cannot catch the bug it was
    written for is worth having only if it says so.
- **A gate's verdict must NAME what failed, not count it.** The manifest fixes *is it run*; this fixes
  *is it readable when it fails*. Sixteen of thirty-five gates ended on a bare `N CHECK(S) FAILED` with
  the per-item FAIL lines printed pages earlier — and one, `audit-formula-check`, printed **no verdict at
  all** on failure, because its closing prose sat inside an `if (all clear)` with no `else`. That is the
  gate this project has leaned on hardest.
  - **The property is naming, not adjacency.** A verdict that lists the failures cannot be absorbed by a
    neighbouring paragraph no matter what the paragraph says. A verdict that counts them sends the reader
    scrolling, and whatever they land on on the way gets read as the explanation.
  - **This is not hypothetical.** `panel-engine-parity-check` printed "2 CHECK(S) FAILED" directly under a
    paragraph explaining that the residual it had just measured "is NOT a defect" — while the failures
    were in two earlier sections, on WC only, at 6,356x the rounding bound. It was misread that way here
    on the first pass, and the misreading survived into a written report.
  - **The form to use** is the one nineteen gates already had:
    `` `${n} CHECK(S) FAILED:\n  ${failed.join('\n  ')}` ``, fenced above and below with a rule so no
    adjacent prose can run into it. Collect the label into a `failed: string[]` in the same helper that
    prints the inline FAIL.
  - **Four gates had prose immediately above the verdict that argued the failure away** — `roster-catalog`
    ("this one is a readout"), `pool-market-share` ("not from a residual defect"), `panel-engine-parity`
    ("is NOT a defect"), `ratio-basis`. Naming the failure defuses all four; `pool-market-share` also says
    in its failing branch that the block above is not a check.
- **`npm run typecheck` is the real command.** Root `tsc --noEmit` is a NO-OP — root tsconfig has
  `"files": []` with project references, so it checks zero files and always exits 0. Several earlier
  "typecheck clean" claims were vacuous.
- **A harness that cannot compile is worse than no harness.** scripts/ sat outside tsconfig.app.json
  for the whole project, so no diagnostic was ever typechecked — they failed only at runtime, on
  whichever paths a given run exercised. The harnesses hold most of the verification logic in this
  project; an unchecked bug in one reports green. This is the "a test that cannot fail" entry one
  level up. Now covered by its own tsconfig.
- **When a documented hazard recurs, make it impossible rather than documenting it harder.** The root
  `tsc --noEmit` no-op was recorded in the very first entry of this file and still produced vacuous
  "typecheck clean" claims across a whole build phase, because the wrong command exits 0 with no
  output — nothing signals the mistake. A practice that depends on remembering will be forgotten. The
  root path is now removed.
- **Hand-check a printed sample of any displayed formula.** A harness that verifies operands cannot see
  *formatting*. Twice a displayed rate was too imprecise to hand-multiply back to its row (e.g. "−0.8%"
  against a −$153,009 row). Only manual sample inspection caught it, both times.
- **Verify by properties, not baseline diffs, when a change is baseline-shifting** — ties out, in band,
  deterministic, config-independent. Value-matching only works for cosmetic changes.
- **Baseline-neutrality is the strongest test for a structural change.** If defaults produce byte-identical
  output, the restructure provably didn't leak into the math. The "projection" pattern (copy pool values
  into line slices at `processYear` entry) achieved this for the pool-wide decisions change.
- **⚠ BYTE-IDENTITY ON A SOLO CONFIG IS PROOF ONLY WHEN THE CHANGE IS STRUCTURALLY CONFINED** — meaning no
  code path exists from the change to the other line. For a change that IS shared but small it has a large
  FALSE-NEGATIVE rate, because membership joins are `Math.round` of a float
  (`rawNewCount = Math.round(expectedNew * rng.range(0.3, 1.7))`, membershipEngine). A small parameter
  change only shows up where it happens to cross a rounding boundary.
  Measured at `265b1ce` (the recalibration cascade): `k` moved +2.65%, WC's `expectedNew` moved
  +0.057 members/yr, and the boundary was crossed on only ~5.7% of line-years — giving the 3-seed × 5-year
  gate a **42% chance of reading WC-solo byte-identical on a line that genuinely moved**. It did read
  byte-identical. Widening to 40 seeds × 8 years, WC changed on 171 of 1,280 fields across 18 of 40 games.
  So when a commit touches SHARED machinery, either widen the seed set or rely on the mechanism null test.
- **The null test and the line control answer DIFFERENT questions, and are not interchangeable.** We
  treated them as such and it produced the error above.
  - **Mechanism null test** proves **ATTRIBUTION**: force the new code to reproduce the old behaviour
    (revert just the constants, decline the new cover) and assert byte-identity against the parent. A pass
    says *the moved values are the thing you changed, not the refactor around it*. It says nothing about
    which lines moved.
  - **Line control** (solo-config hashes) proves **SCOPE**: which lines the change reached. Valid only
    under structural confinement, per the point above.
  A shared-machinery commit needs the null test for attribution and a widened seed set for scope. `265b1ce`
  had the former (reverting four constants reproduced the parent on 15,900 of 15,900 fields) and the latter
  was missing.
- **Earlier commits NOT affected by this caveat — do not re-audit them.** Each was structurally confined,
  so its line control stands as proof of scope: Property's loss-model rebuild (`645c15e`), the cat-load
  pull (`22672a4`), both TIV rescales (`b3c6635`, `997a4fd`), roster v6, the Property tower and aggregate
  (`dbd9138`), and Property's derived CLF table (`0bfd899`). All touch `PROPERTY_*` constants,
  `propertyClaimEngine`, `REINSURANCE_TOWER.Property` or `STATIC_CLF_TABLE.Property` — none of which WC or
  GL reads. The caveat applies specifically to commits that move SHARED constants: the membership
  equilibrium constants, `RATE_NEUTRAL_*`, `FUNDING_CLF_TABLE`, and anything in `membershipEngine`.
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
- **⚠ AND THE CITED EVIDENCE MUST ACTUALLY SUPPORT THE CLAIM — check it against the output in front of you
  before writing it down.** `265b1ce`'s commit message asserted "All three lines move, as expected with k
  pool-wide" while the measurement printed in that same turn read `configs: GL-solo, PR-solo, tri` — WC-solo
  absent. The MECHANISM was right (WC is genuinely affected; see the false-negative point under
  Verification), so the conclusion happened to be true, but the evidence cited did not establish it and the
  gap went unnoticed for two commits.
  This is a DIFFERENT error from being wrong, and the more common one: reasoning forward from a mechanism to
  what the numbers *should* say, then writing that down as though it were the reading. It is also harder to
  catch, because a true claim attracts no scrutiny. When a commit message states what moved, the sentence
  must be transcribed from the measurement, not derived from the design — and if the two disagree, that
  disagreement is the finding.
- **A test that cannot fail is worse than no test.** The WC harness's region check fed integers 1–5 into
  what had become a keyed string lookup (`North`/`Central`/`South`), so every probe hit the `?? 1` default
  and the assertion was structurally incapable of failing. It passed for as long as it existed. When a
  type or key space changes, re-read every assertion that touches it and confirm it can still go red.
- **A check passing for its entire life while unable to fail is a category, not one unlucky harness.** Five
  more instances, each built on a premise that later stopped being true and was never re-checked against it:
  - **region check** (above) — a keyed lookup outgrew the integers probing it.
  - **BROKEN IDENTITIES** (value-identity-check) — tolerated 1e-12 to decide a baseline "was exactly 1" but
    used strict inequality to decide "changed"; it would have called its own target field not-an-identity on
    the first recapture and never armed cleanly again.
  - **membership equilibrium check** — reports the share of games ending smaller against 50%, at 40 games.
    Standard error is 7.9pp, ~24% power against a genuine 10pp tilt: it found the original 82% collapse
    easily and could never verify the correction that followed.
  - **line control** (solo-config byte-identity, above) — 3 seeds; a shared-but-small change crosses
    membership's rounding boundary in only ~5.7% of line-years, so the gate read clean 42% of the time on a
    line that had moved.
  - **shock-check's WC attachment assertion** — checked that a shock does not move "the attachment, being
    125% of expected loss." The tower removed that dependence; the assertion had decayed into constant ==
    constant.

  **The rule, widened.** Already written down above for type and key-space changes: when a premise changes,
  re-read every assertion resting on it and confirm it can still go red. A premise is any fact an assertion
  depends on — a distribution's shape, a field's basis, a sample size adequate for one question and
  reassigned to another, a constant that used to be derived from something else.

  **The second-order rule.** A diagnostic built to catch a GROSS error gets silently repurposed as a
  PRECISION instrument once that error is fixed, and its sample size does not follow the reassignment. The
  equilibrium check is the clean case: right tool for a 12% collapse, wrong tool for confirming a 1%
  residual. This project already separates gross-error detectors from precision instruments for
  heavy-tailed gates (below); it is the same distinction, applied to a check nobody had classified either
  way.
- **"Contains zero" at a sample too small to resolve the effect is not evidence of absence.** It is the
  other half of the CI rule below, and it is the half that bites, because a null result looks like good
  news. State what the sample CAN resolve before reading a null as a null.
  - **This cost a residual being declared closed for four commits.** At `89f9508` the markdown/unwind
    convexity residual was measured over 50 games as "WC −0.6%, CI [−2.2%, +1.0%], contains zero" and
    written down as shrunk below resolution — correctly — and then read back as *fixed*. It was not
    fixed. At 300 games it is −$2.30M on WC with CI [−$2.47M, −$2.12M], has always been there, and is on
    all three lines. Nobody lied; the instrument could not see it and its output was indistinguishable
    from an instrument that could.
  - **The form that fixes it is an EQUIVALENCE test, not a null test.** Two conditions, both required:
    the estimate is inside the tolerance (`|mean| ≤ TOL`), **and** the sample could have seen the
    tolerance (`half-width ≤ TOL`). The second is the one a null test never asks. A run that cannot
    resolve TOL must fail as NOT RESOLVED, not pass quietly. `cession-path-independence` does this per
    line and prints both columns.
  - **And it means a gate's sample size is part of its claim.** That gate ran GAMES=60 for its whole
    life; at 60 the two endpoints of a bisect missed zero by $0.16M and $0.29M and read green and red,
    while at 200 they were statistically indistinguishable. It had been passing on noise and failing on
    slightly less noise. Print the resolution next to the verdict — the way `closure-draw-check` prints
    its per-line resolution — so the number is visible without re-deriving it.
- **If a quantity is booked as INCREMENTS, it telescopes, and no path explanation of it can be right.**
  `cedeDevelopment` books `cede(next) - cede(current)` each step, so a claim's lifetime cession is
  `cede(final) - cede(start)` and every intermediate value cancels. "The wobble lands at lower values and
  convexity does the rest" is therefore false by construction — convexity is evaluated at two endpoints
  only. A persistent difference means the series ENDED EARLY or the ENDPOINTS differ; those are the only
  two options, and they are cheap to test separately. This wrong explanation was written into a gate
  header, restated back by the reviewer, and survived four commits because it sounds like the convexity
  argument in `developmentAllocation.ts` — which is about something else.
- **A windowed sum of a quantity with a multi-year tail carries a truncation term, and it will look like
  a defect.** `cession-path-independence` recognises the booking give-back in full at inception and earns
  it back over the cohort's horizon, so every fixed window cuts its last H cohorts mid-unwind. **The tell
  is the scaling**: the gap grew in dollars and shrank as a share across 12/25/40-year windows, with
  `share x years` flat at 52 / 55 / 52. A fixed-size tail against a linearly growing total does that;
  no engine mechanism does. Check the scaling before believing a windowed residual.
- **A per-line total is a sum of components that can hide each other.** The same gate reported "WC only"
  twice, and WC was not special: the development component excludes zero on all three lines and GL's is
  the largest. WC's TOTAL crossed first only because GL's positive inception noise offset more of GL's
  negative development gap. If a quantity decomposes, gate the components, not the sum — and if you must
  report the sum, print the split beside it.
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
- **Generator statistics are FULL-MARKET; treaty and portfolio statistics are ENROLLED. Any figure
  quoted without saying which is suspect.** Generator harnesses run against all 200 canonical members,
  because that is how a generator gets tested standalone. But the pool insures only ~25-35% of the
  marketplace, so every treaty question — retention firing rates, occurrence exceedance, what a shock
  costs — is a question about the enrolled book, not the market. The two differ by roughly 3-4x, and not
  by exactly the TIV or payroll ratio either: breach counts are additive over locations, so the ratio
  depends on which members the enrolment draw happened to include, and a fixed dollar threshold cuts a
  different point of each book's size distribution. This has produced a wrong number four separate
  times — the per-risk breach rate (asserted at 4.115/yr full-market against a band built for 1.78,
  when the enrolled figure was 1.005), WC presumption expansion (+7.5 claims/yr quoted full-market when
  the pool sees +2.0), the GL EPL surge (impact measured against EPL's own expected loss rather than
  GL's), and the #15 mega-claim injection (a fixed claim COUNT, so identical dollars at either basis —
  +30.8% of full-market WC but +126.2% of the enrolled book). Report BOTH bases side by side whenever a
  figure could be read either way, and label them. Corollary: a treaty firing rate is a portfolio
  property, not a generator property — it does not belong in a generator harness at all.
- **Shock and no-shock runs on the same seed are NOT paired.** poisson() consumes a variable number of
  uniforms, so anything that changes a frequency — freqMultiplier, exposureChange, an injected claim
  that draws — reshapes every subsequent draw in that stream. A "with shock minus without shock" delta
  on one seed therefore measures the shock PLUS a reshuffle of everything downstream. Measured
  instance: the GL EPL surge read a $2.85M whole-line delta against a $4.47M analytic until it was
  isolated to EPL alone, where it landed at $4.32M — the gap was abuse-tail reshuffle, not the shock.
  Either measure the affected sub-coverage in isolation, or run enough seeds that the reshuffle
  averages out; state which in the harness header. Same family as the full-market/enrolled error:
  arithmetically correct, measured against the wrong thing.
- **A gate's tolerance has to clear the ESTIMATOR'S noise, not just sit under the effect.** The
  natural way to pick a threshold is to look at the defect you are gating and halve it. That is one
  of two constraints and the first draft of opening-centring-check only met it: 0.15 band widths
  against a 0.49-width drift looked like a comfortable 3x margin, but the statistic being gated is a
  MEDIAN of a wide distribution and its bootstrap SE at that sample size was 5–11% of a band width —
  so the tolerance was 1.4–3.0 SE and would have gone red on nothing at all. A gate that flaps is a
  gate people learn to skip, which is the same end state as no gate. Measure the estimator's own
  sampling error, set the tolerance above it AND below the effect, and print the offset in SE
  alongside the pass/fail so the next reader can see the margin rather than trust it. Raising the
  sample size buys room as 1/sqrt(n) if the two constraints will not both fit.
- **Selection cannot bias what it barely filters — measure a mis-centred search in ACCEPTANCE, not
  in its output.** The intuitive story about a reject-and-redraw search whose proposal distribution
  has drifted above its acceptance band is that the ceiling shears off the top and the accepted set
  is drawn from the low tail. Measured, that is false whenever the band is narrow against the
  proposal's spread: conditional on landing inside, position within the band is nearly uniform. At a
  drift of +34% of band width on WC the accepted median was +5% off midpoint and in the HIGH
  direction, and re-centring moved it by 2%; accepted p10–p90 spanned 79–81% of the band either way.
  What drift actually costs is attempts, and that cost is a CLIFF, not a slope — flat while the band
  sits in the bulk (2.81/2.63/4.13 attempts before against 2.75/2.88/4.14 after, i.e. nothing), then
  8–17x once it leaves. So gate the centring, which gives warning while it is still free; watching
  attempts or watching the shipped output gives no warning until it is already expensive. Corollary
  for briefs and headers: do not write the intuitive damage claim into a failure message. It reads
  as measured, and the next person budgets against a number nobody took.

## ⚠ THE TWO KINDS OF GATE BLINDNESS, AND THEY HAVE DIFFERENT ANSWERS

"The gate is blind" has now been said about two different failures with two
different responses, and conflating them wastes the fix. Ask which one before
reaching for an arm.

**CONFIGURATION BLINDNESS — the gate ran one decision set.** The quantity exists
and is watched, but is inert in the configuration the gate exercises, so a change
to it reads as no change. **ARMS CLOSE THIS.** Three instruments have had it:

| instrument | status |
|---|---|
| `audit-formula-check` | **fixed** at `118b1fb` — the squeezed arm turned ONE reported defect into ELEVEN |
| `value-identity-check` / `solo-export-guard` | **fixed** at `af5788a`, after both read clean on a real 171-instance change |
| the absolute identity check | **fixed** at the v24 recapture, and see the warning below |

**SCOPE BLINDNESS — the field is not watched at all.** No configuration reaches
it because nothing captures it. **AN ARM DOES NOTHING HERE; only widening the
watched set does.** Seven occurrences to date: the four loss-split fields, the
`reserveDevelopment` ledger on `LinePoolState`, the `ReserveCohort` shape change,
and `priorYearDevelopmentCeded`.

The two can hide the same change at once and look like one problem. At `932246f`
both gates read clean on a field split: `value-identity-check` because it ran
defaults only (configuration), and `solo-export-guard` because the field was not
in `RESULT_METRICS` at all (scope). The arm added at `af5788a` fixed the first and
did nothing for the second — the field only became visible to the export guard
when it was added to `RESULT_METRICS`.

**⚠ AND AN ARM CAN NARROW COVERAGE WHILE APPEARING TO WIDEN IT.** The absolute
identity check DETECTS identities by uniformity across every captured instance.
Adding the squeezed arm doubled that instance set with a configuration where
several quantities legitimately stop being uniform — so `expectedCombinedRatio`
(the only genuinely held identity it asserts), `fundingCLF`, `selectedFundingCLF`
and `bookingGiveBack` all fell out of DETECTION, and their assertions vanished
with no diagnostic at all. Four assertions lost, silently, by a commit whose
purpose was more coverage.

The fix is to detect PER ARM rather than pooling them, and it pays twice: the
four come back, and `bookingGiveBack` now reads bit-exactly 0 in `def` and is
absent from the `sqz` list — "inactive at defaults, live under squeeze" on the
face of the report, where pooled it had been classified as a probable tautology.

**The general rule: after widening a gate, check what it stopped saying.** A
detector keyed on uniformity, a bound derived from observed magnitudes, a
coverage counter — anything inferred FROM the captured set changes meaning when
the set changes, and the loss is silent because nothing fails.

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
- **`git fetch` BEFORE checking a ruling's premises, not after.** A stale checkout makes the premise
  check itself unreliable, and it fails in the most misleading possible direction: `git log --all`
  searches the LOCAL refs, so it reports "this work does not exist anywhere" with total confidence
  while the commits sit on the remote. Twice now a whole stage has been declared missing on that
  basis — once seven commits behind on `claims-distribution`, once on `main` at `116b96d`. The
  refusal was correct given what was visible both times, which is exactly what makes this dangerous:
  the reasoning is sound and the conclusion is wrong. Fetch first, then grep.
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
- **⚠ CORRECTED: THERE IS NO VINTAGE CONVERSION, AND `trendToSettlement` IS DELETED.** This bullet used
  to name it as "the ONLY vintage conversion point" and claim that was what made retroactive repricing
  possible at all. Traced through git, the chain (`trendToSettlement` ← `patternTrendFactor`) was dead
  end to end from 3181b18 and had no live caller in any generator. **A claim's amount is fixed at draw and
  is never re-vintaged.** Every live `Math.pow(1 + trend, year - 1)` — WC frequency and severity, GL
  severity, Property's draw trend, `exposureTrend`'s wage inflation — is a LEVEL trend that sets what a
  year-N accident year costs in year-N dollars. That establishes a vintage; it does not convert between
  two. Amounts are still unambiguous, but by construction rather than by routing.
  **What retroactive repricing actually runs on is IBNER:** add a term to the development step and every
  open accident year reprices at once, surfacing as adverse development. That moves the ESTIMATE, not the
  claim's vintage, which is how social inflation appears in a real triangle.
- **Every trend-compounded lag MUST be truncated and renormalized, and the analytic must integrate the
  IDENTICAL truncated density.** `E[(1+r)^lag]` over an unbounded lognormal lag is mathematically
  DIVERGENT, not merely large — the moment series grows like `exp(k²σ²/2)`. WC presumption at 6% over a
  lognormal mean-8yr lag returned 6.6e27 from quadrature; the true value is infinite. Bounds that were in
  use while lags existed: WC presumption 40y; GL general 10y, EPL/LE 12y, abuse 50y. Prefer
  truncate-and-renormalize (reject and redraw) over a hard `min(lag, cap)`, which piles artificial
  probability mass exactly at the bound.
  ⚠ **THE TRIGGER IS A RANDOM EXPONENT, NOT A TREND.** The divergence above is a property of raising a
  trend to a DRAWN power, and stating the rule without that is what makes "WC has a severity trend" and
  "the rule does not apply to WC" look contradictory. They are not:

      (1+r)^L         L a drawn lag           — DIVERGENT, needs the bound and the matching density
      (1+r)^(year-1)  year a bounded integer  — deterministic and finite, needs nothing

  Every line trends severity through the second form and none through the first. All three route the same
  accident-year factor `Math.pow(1 + r, max(1, year) - 1)`: `wcSeverityTrend` (`wcClaimEngine.ts:171`,
  shifting mu via `trendedMu`, and what carries `WC_SEVERITY_CAP` from $85M in year 1 to $117.6M by year
  10), `glSeverityTrend`, and `propertySeverityTrend`. ⚠ PROPERTY'S RATE IS A NAMED CONSTANT AT ZERO, so
  its factor is exactly 1 — same shape and same call sites, deliberately not a stub, so turning it on is a
  one-constant edit. Do not read "all three trend" as "all three trend at a non-zero rate"; that is the
  same flattening this bullet exists to prevent.

  The trend is applied at the accident year and frozen onto the claim. No line raises a trend to a random
  power any more: the fitted mixtures are fitted to settled amounts, and the lags they replaced are gone.
  So the rule constrains NOTHING today and remains binding on any future line that draws a lag and trends
  across it. See `wcClaimEngine.ts:588` and `glClaimEngine.ts:578`, which state it at the draw sites.
  ⚠ DO NOT COMPRESS THIS TO "WC CARRIES NO SEVERITY TREND" — that sentence stood here between 101d84e and
  3da9ebb and it is false. "No random exponent" and "no severity trend" are different facts, and
  collapsing them mis-describes the live severity model. The shared `drawTruncatedLognormal` helper was
  deleted unused: the rule survives, its one-size implementation did not.
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
  - **SECOND FORM: a required argument with a plausible default is the same defect, and reads as more
    legitimate.** `currentPurePremiumPer100(line, year, members = [])` — the default is not "no book
    supplied", it is "the full-roster constant", because an empty book takes `wcBlendedRatePer100`'s
    `exposure > 0 ? … : WC_HELD_PURE_PREMIUM_PER_100` branch. When `0a465df` added that parameter it
    updated three of four call sites; the fourth compiled, ran, and quietly compared the enrolled-book
    blend against the whole-market blend for **62 commits and six days**. A missing lookup key at least
    looks like an absence. A defaulted parameter looks like an API being kind to you.
  - **The tell is that the default is a legitimate VALUE rather than a sentinel.** `= []` reaching a
    branch that returns a real number is indistinguishable, at every call site and in every type check,
    from a caller that meant it. If the argument is required for correctness, make it required: no
    default, or a sentinel that throws. `members: Member[]` with no `= []` would have failed the build
    at the one call site that needed fixing.
  - **And it defeated a written warning.** `fundingConsequence.ts` says at its own call: "Omitting it
    would put the panel back on the full-market blend and reopen exactly the parity gap this file exists
    to assert against." Correct, aimed at the right hazard — and it lived in the file being *checked*,
    not the *checker*, so nobody editing the checker ever read it. Prose guards the file it sits in.
- **Claude Code paste-chips arrive EMPTY in the planning chat.** Long pastes auto-collapse to a "PASTED"
  attachment that transfers as an empty document. Use screenshots or .docx/.md uploads instead.
- **`e94387e` is a bad commit** — corrupt v9 baselines (NAN reserve rows). Superseded by `8693655`.
- **The baseline generator once held its own copy of the result-metric list** and drifted from the app
  twice. Now extracted to `src/utils/resultMetrics.ts` (`RESULT_METRICS`), imported by both. Keep it that
  way.
