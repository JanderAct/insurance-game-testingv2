# State — `feature/member-satisfaction`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**.

**Tip when written:** `59e5c4b` (2026-09-23), the merge that brought the session layer in.

---

## What this branch is, and what it now holds

**Everything.** Since `59e5c4b` this is the only branch carrying all of it:

- **The engine** — claims, pricing, reinsurance, reserves, the market model, and the five changes that
  landed here after the session layer branched: WC's supplied CLF curve (`ed8b582`), WC's shared year
  factor (`8d55cdc`), GL's triangle contraction re-solve (`5c39e2d`), the satisfaction scale at 3×
  (`f88fc71`, `120a94a`), and a GL underwriting cycle (`3084262`, `3c3731e`).
- **The satisfaction work** the branch is named for.
- **The multiplayer session layer** — the five-endpoint contract, `localStorage` and HTTP transports, the
  stub server, host/player/viewer screens, the Teams and Charts tabs, the poll back-off.
- **The eight browser drivers**, at `scripts/tools/session-drivers/`.

There is no longer a live branch that has something this one lacks.

---

## The two frozen demo branches — do not touch either

| Branch | What it is |
|---|---|
| `demo-multiplayer-2026-09` | Cut from `0f0750b` (the driver commit) on the pre-merge session branch. A working session layer on the engine as it stood 2026-09-18 — **five engine changes behind this branch**, so every figure it produces differs from one produced here. Carries its own `FROZEN.md` and the eight drivers that verify it. |
| `demo-2026-09` | Older still. ⚠ **Not visible from this remote** — `origin` carries only `main`, `feature/member-satisfaction`, `feature/pricing-estimate`, `claude/bold-bardeen-38lhp5` and `demo-multiplayer-2026-09`. Its freezing convention could not be read, which is why `demo-multiplayer-2026-09`'s `FROZEN.md` asks for the two to be reconciled by someone who can see both. |

Neither receives work. Quote a number from either as "the demo build", never as the engine's behaviour.

---

## The verification inventory — all of it, in one place

| Instrument | What it is | State at `59e5c4b` |
|---|---|---|
| `npm run gates` | **54 FAST gates** | green but for the standing red set |
| `npm run gates:slow` | **14 SLOW gates** (68 in total) | `member-satisfaction-check` moved here from FAST at `3c3731e` |
| `npm run gates:probes` | 27 probes — readings, not gates | not run at the merge |
| `baselines/VALUE_IDENTITY_v47.json` | every computed value, 150 instances | **holds** |
| `baselines/SOLO_EXPORT_GUARD_v47.json` | the export's shape, 24 exports | **holds, byte-identical** |
| `baselines/RENDER_IDENTITY_v1.json` | **248 fingerprints across five configurations** (WC, GL, PR, WC+GL, WC+GL+PR), two year-points | **18 moved and unruled** — see the rulings below |
| `scripts/tools/session-contract-check.ts` | the five endpoints | **126/126 against `localStorage`, 126/126 over the wire** |
| `scripts/tools/session-drivers/` | eight browser drivers | host-charts 46, full-session 33, viewer 19, two-contexts 16, four-tabs 15, host-teams 13, replay-fidelity 8 — all green at the merge; solo-oracle 46 fingerprints, 32 of them moved by the merge |

**Standing red set:** `ibner-null-check` and `cession-uplift-basis`, both with their reasons in
`EXPECTED_RED` in `scripts/gates.ts`. An unexpected *pass* on either is as loud as a failure.

The drivers need a built app and a preview server; there is no npm script for that reason.
`scripts/tools/session-drivers/_shared.cjs` carries the invocation and says which of their assertions
survive an engine change.

---

## ⚠ What each instrument can and cannot see

**This distinction has cost real time twice.** Both times the answer was "a check was green and the thing
it cannot see was broken".

- **The value baselines are blind to the screens.** `VALUE_IDENTITY` carries pool-level quantised
  `memberSatisfaction` and has no per-member dimension; `SOLO_EXPORT_GUARD` carries the export's shape.
  Neither renders a page. 27 of 86 `src` files — every page, every component, `App.tsx` — are reachable
  from no gate at all. A display defect will not move either of them.
- **The render baseline is the only five-configuration instrument.** It is what catches a display change,
  and it is what proved the merge lost nothing: both the pre-merge tip and the merge show the same 18
  moved fingerprints at the same values.
- **The solo oracle plays WC-only, and has no baseline file.** Its 46 fingerprints proved *confinement*,
  not correctness — every Membership defect found in September lived in a configuration it never plays
  (GL-only and Property-only open with an empty roster; WC+GL opened showing 65 of 112 members). And
  `solo-oracle.cjs` prints to stdout: shipping the instrument did not ship its comparison, so "46/46"
  always meant "compared against a run somebody was holding". **Rule with the render baseline.**
- **The browser drivers are structural, not numeric.** Seven of the eight assert relationships — two
  computations agreeing, a state being distinct from another, a count of points — so they survive an
  engine change by construction. The merge demonstrated it: all seven green against five engine changes.
  The exceptions are the oracle's fingerprints and one threshold in `host-charts`.
- **The contract harness cannot see the rules twice.** It runs against both transports, but the stub
  server borrows `LocalSessionTransport` rather than restating the rules, so the HTTP pass proves the
  *wire* — marshalling, headers, status mapping, CORS — and not a second implementation. The second
  implementation of the rules is the AWS one, and it does not exist.

---

## Open rulings — waiting on a decision, not on work

1. **The 18 moved render fingerprints.** Membership at y2 in every configuration, and Result Spreadsheet
   at y2 — the inherited 3× satisfaction scale. Unruled since it landed, carried through the merge
   unchanged, and **not to be recaptured** until somebody says the new values are right.
2. **The market-gap modifier.** Measured and reported: the gap's slope is the load's slope, the load falls
   because the ceded share rises against a tower load that falls with book size, and a *flat* modifier
   changes the level and not the slope. The ruling is whether the drift is real and should be shown, or
   modelled away. ⚠ Now actionable **on this branch**, which holds both `marketConditions.ts` and the
   measurement's subject.
3. **The solo oracle's 32 moved fingerprints.** Recapture needs an attribution — which change moved which
   screen — that nobody has done, and there is no file to recapture into. Either give it a baseline and
   attribute, or retire it in favour of the render baseline.
4. **`advance` is not idempotent.** A retried POST skips a year; the fix carries the expected current year
   and compare-and-swaps, which changes `AdvanceRequest`. Contract-level, recorded at
   `src/session/httpTransport.ts` item 4, deliberately not done.
5. **Whether the measurement probes ship.** The storage and gap-decomposition probes are still outside the
   repo, which is the same failure the drivers just had.

---

## Recorded only in commit messages

A list of things that exist only in `git log` should not itself exist only in `git log`. Carried forward
from the file this replaces, and updated for the merge:

- **The line-independence proof.** `instanceGenerator.ts:72` asserts draws are independent of which lines
  are active; the verification — pre-game register, opening roster and every live-year register hashing
  identically across WC / WC+GL / tri-line — is only in `73d749d`. ⚠ Both the assertion and its subject
  are now on this branch, so it can be recorded where it belongs.
- **The market-gap decomposition** — `load = 1.15 + c(L−1)`, and the no-cede arm flat at −25.25pp for all
  three lines. It belongs beside `marketLevelGapPct` in `src/utils/marketConditions.ts`, **which is on
  this branch**. It was deferred as "engine-side"; that is no longer a reason.
- **The storage measurements** (26,233 → 30,947 chars; 480 chars per team for the opening position; 0.59%
  of the measured quota). The probe that produced them is still not in the repo.
- **Why there are three roles rather than two** — that a viewer is a flag on the player path rather than a
  screen, and what that buys. The player/viewer asymmetry is at `localTransport.ts:374`; the reasoning is
  not.
- **The poll-cost model's assumptions** — the session shape it integrates over (230 writes in two hours)
  is in `poll-cost-report.ts`, but *why* that is the right shape is in `ede8008` only.
- **The merge's own proof** — that the pre-merge tip and the merge render identically across 248
  fingerprints — is in `59e5c4b` only. It is the evidence that `App.tsx`'s resolution lost nothing, and
  it is the method to repeat on the next merge of this shape.

Already recorded at a file, so not on this list: the room's team count binding nothing
(`contract.ts:301`), the identity split (`identity.ts:14`), `initialMembers`' single reader
(`openingRoster.ts:20`), the loan step's absence, the shock seam, the double host poller, the eight AWS
constraints (`httpTransport.ts`), and the drivers' merge-survival classification (`_shared.cjs`).

---

## Where the other state file went

`STATE_bold-bardeen-38lhp5.md` was deleted from this branch in the same commit that created this one. It
described the pre-merge session branch — its tip, its absences, its verification gaps — and every one of
those statements is false here. It survives, correct and in context, on **`demo-multiplayer-2026-09`**,
which is the branch it actually describes. Nothing was lost; one file stopped being two files where one
was wrong.

---

## ⚠ This file goes stale, and here is exactly how

`docs/PROJECT_STATE_SUMMARY.md` is this project's worked example: it names `multi-line-build` as the
working branch and describes mechanisms removed months ago. It was not wrong when written.

**What makes this file stale:**

- The tip commit moves. Every commit on this branch invalidates the header.
- A baseline is recaptured — the 18 render fingerprints most of all, since "unruled" is the current fact
  and is the one most likely to be quoted after it stops being true.
- A gate changes tier, or the standing red set changes.
- A ruling above is made, or the probes land, or a driver count changes.
- A demo branch is thawed, or `demo-2026-09` becomes visible and the freezing conventions are reconciled.

**Who updates it:** whoever makes the change that invalidates a line, in the same commit. A state document
updated separately from the work it describes is a state document that will not be updated.

**If you are reading this and the tip commit above is not `git log -1`, trust the repository and fix this
file.** Nothing here is authoritative over the code.
