# State — `claude/bold-bardeen-38lhp5`

**Read this instead of reconstructing branch state from conversation.** Naming convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**. `feature/member-satisfaction` gets `STATE_member-satisfaction.md`, written on that branch by
whoever works it — this file must not try to describe it beyond the comparison below.

**Tip when written:** `29598af` (2026-09-23) · **Branched from** `feature/pricing-estimate` at `85b3b79`
(2026-09-18) · **22 commits since.**

---

## What this branch is for

The **multiplayer session layer**: a host runs a room, teams join from their own browsers, each browser
computes its own year from the shared seed. Nothing in it changes the engine — `processYear` is a pure
function of state and decisions, and this branch changes only what triggers it and what happens to the
result afterwards.

It is *not* an engine branch. Every engine question belongs on `feature/member-satisfaction`.

---

## What it carries that the other branch does not

All 22 commits, in four groups:

1. **The session transport and its contract** — five endpoints defined once (`src/session/contract.ts`),
   two implementations behind them (`localTransport.ts`, `httpTransport.ts`), a throwaway stub server
   (`scripts/tools/session-stub-server.ts`), and a poll back-off (`client/pollSchedule.ts`).
2. **The screens** — host (create, room, tabs: Game Setup / Teams / Charts), player, viewer-as-a-flag.
3. **The shared game shell** — `src/game/` (`GameShell`, `derivations.ts`, `openingRoster.ts`), extracted
   from `App.tsx` so solo and session play render from one implementation.
4. **Three Membership fixes**, which that branch has already taken by port (`750ce12`).

---

## What it lacks, and what that means for a demo

The engine moved on `feature/member-satisfaction` after the branch point. **Five things are absent here**,
all in files last touched before `85b3b79`:

| Absent | Commit there | Files |
|---|---|---|
| Supplied CLF curve for WC | `ed8b582` | `src/data/clfTables.ts` (+191) |
| WC's slider range + surplus-limb re-solve | `d1cef12`, `fa8d07e` | `defaultAssumptions.ts` |
| WC's shared year factor — the correlation channel | `8d55cdc` | `wcClaimEngine.ts`, `wcLossDistribution.ts` |
| GL's triangle contraction re-solve | `5c39e2d` | `towerMoments.ts` |
| Satisfaction scale ×3, and `MAX_DEFAULTS_DRIFT` per game | `f88fc71`, `120a94a` | `memberSatisfaction.ts` (+400) |

⚠ **The GL market cycle is NOT absent.** `src/utils/marketConditions.ts` last changed at `a6cc7ff`, before
the branch point, and is byte-identical on both branches. It is shared inheritance, not their work.

**What a demo run on this branch shows.** The session layer, correctly and completely — joining, the turn
cycle, the host's table and charts, two browsers against a server. The **numbers** it shows are the engine
as of 2026-09-18: WC prices off the old CLF table with no correlation channel, GL's contraction is
unre-solved, and satisfaction moves on the old scale. Demonstrate the *mechanics* here; do not quote a
figure from a run on this branch as the engine's current behaviour.

---

## Where the documentation is

| Path | What it is |
|---|---|
| `docs/WORKING_PRACTICES.md` | **1,030 lines, engine practice.** On this branch too, not only on the other one. Verification, gate blindness, measurement claims, claim-generator conventions. |
| `SESSION_PRACTICES.md` (root) | This layer's own lessons. Written to point at `docs/WORKING_PRACTICES.md` rather than repeat it. |
| `UI_BRANCH_RULES.md` (root) | Branch hygiene for value-neutral work. Written for `ui/decision-surface`; its rule 1 (never re-baseline) applies here for the same reason. |
| `docs/handoff/` | Nine files: `overview`, `architecture`, `data`, `history`, `known-issues`, `setup`, `dependencies-and-integrations`, `source-provenance`, `wishlist`. |
| `src/session/httpTransport.ts` | The eight AWS deployment constraints, numbered, in the file header. |
| `SYNC_README.md` (root) | Folder layout. Dated 2026-07-22. |
| `docs/PROJECT_STATE_SUMMARY.md` | ⚠ **Stale.** Names `multi-line-build` as the working branch. Treat as history. |

A new reader should open `docs/handoff/overview.md`, then this file, then `SESSION_PRACTICES.md`.

---

## What verification exists here

**In the repo, runnable:**

- `scripts/tools/session-contract-check.ts` — **126/126 assertions, run twice**: once against
  `localStorage`, once against the HTTP transport on a real socket. Same assertions both times.
- `npm run gates` — **55 FAST gates**; `gates:slow` 13; 27 probes.
- Both value baselines, at **v44**: `baselines/VALUE_IDENTITY_v44.json`,
  `baselines/SOLO_EXPORT_GUARD_v44.json`. Both have held bit-identical through all 22 commits.
- `scripts/tools/poll-cost-report.ts` — the poll's request and byte cost, before and after the back-off.

**NOT in the repo — and this is the branch's largest verification gap:**

- ⚠ **The browser drivers exist only in a session scratchpad.** `solo-oracle` (46 fingerprints),
  `host-charts` (46), `full-session` (33), `viewer` (19), `two-contexts` (16), `four-tabs` (15),
  `host-teams` (13), `replay-fidelity` (8), plus the storage and gap probes. Every count quoted in the 22
  commit messages came from these, and **none of it is reproducible by anyone reading this repository.**
  `playwright` is not in `package.json`. This is the solo-oracle failure that `SESSION_PRACTICES.md` §1
  is about, still unfixed at the time of writing.
- ⚠ **No render baseline.** `RENDER_IDENTITY_v1.json` and `scripts/tools/render-identity-check.ts` are on
  `feature/member-satisfaction` only. The value baselines carry pool-level quantised `memberSatisfaction`
  with no per-member dimension, so **nothing on this branch can see a display change.** Display defects
  here are found by a person looking.

**Baseline versions differ between the branches.** We are at v44; they recaptured at **v47** and added
`RENDER_IDENTITY_v1`. Merging their engine work means taking their baselines with it — ours cannot be
carried forward across their re-solves.

---

## Standing red set

Two gates are expected red, both recorded in `EXPECTED_RED` in `scripts/gates.ts` with their reasons:
`ibner-null-check` and `cession-uplift-basis`. An unexpected pass on either is as loud as a failure.

`member-satisfaction-check` is red on GL on the **other** branch (its own tip commit says so). It is not
red here because the work that made it red is not here.

---

## The session layer's own state

**Built and driven:** the five-endpoint contract; `localStorage` and HTTP implementations; host create /
room / Teams / Charts tabs; player screen with the full solo game behind it; viewer as a read-only flag;
per-year decision and result histories; the opening position posted as year 0; four charts (surplus,
members, losses as booked, losses as developed); poll back-off 3s→10s.

**Stubbed:** `scripts/tools/session-stub-server.ts` — Node, in memory, CORS, five routes. It borrows
`LocalSessionTransport` rather than restating the rules, so it is not a second opinion. Its header says
what it is and what does not survive.

**Waiting on AWS:** the eight constraints at the top of `src/session/httpTransport.ts`. Two are
contract-level rather than operational — `advance` is not idempotent (a retried POST skips a year and
needs a compare-and-swap on the expected year, which changes `AdvanceRequest`), and `createRoom` is not
either.

**Carried but not consumed:** the room holds a shock schedule and nothing reads it —
`generateGameInstance` never populates `instance.scheduledShocks`. That seam is engine-side and
deliberately untouched here.

---

## Open questions — rulings, not work

1. **Does the widening market level gap get a modifier?** Measured: it is not the pool under-pricing and
   not the target's level. Gap slope ≡ load slope; the load falls because the ceded share rises against a
   tower load that falls with book size. A *flat* modifier changes the level and not the slope. The ruling
   needed is whether the drift is real and should be shown, or modelled away.
2. **Does this branch get the drivers, or does the render baseline subsume them?** They overlap: the
   solo oracle is 46 UI fingerprints, and the render baseline is the same idea done properly on the other
   branch.
3. **Does the session layer merge into the engine line, or stay separate until AWS?** It is 22 commits and
   ~5,000 lines that the engine branch does not have, and the gap grows each time either moves.
4. **Who owns a market cycle versus a shock event** — named as unrecorded, and it is engine-side, so it
   belongs in `docs/WORKING_PRACTICES.md`, not here.

---

## Recorded only in commit messages

Each of these is a finding a future reader would want and cannot find at a file. Listed here because a list
of things that exist only in `git log` should not itself exist only in `git log`.

- **The line-independence proof.** `instanceGenerator.ts:72` asserts draws are independent of which lines
  are active; the verification — pre-game register, opening roster and every live-year register hashing
  identically across WC / WC+GL / tri-line — is only in `73d749d`.
- **Every browser-driver count**, and the storage measurements (26,233 → 30,947 chars; 480 chars per team
  for the opening position; 0.59% of the measured quota). The tools that produced them are not in the repo.
- **The market-gap decomposition** — `load = 1.15 + c(L−1)`, and the no-cede arm flat at −25.25pp for all
  three lines. It belongs beside `marketLevelGapPct`, which is engine-side.
- **Why there are three roles rather than two** — that a viewer is a flag on the player path rather than a
  screen, and what that buys. The player/viewer asymmetry is at `localTransport.ts:374`; the reasoning is
  not.
- **The poll-cost model's assumptions** — the session shape it integrates over (230 writes in two hours) is
  in `poll-cost-report.ts` ✓, but *why* those are the right shape is in `ede8008` only.

Already recorded, so not on this list: the room's team count binding nothing (`contract.ts:301`), the
identity split (`identity.ts:14`), `initialMembers`' single reader (`openingRoster.ts:20`), the loan step's
absence, the shock seam, the double host poller.

---

## ⚠ This file goes stale, and here is exactly how

`docs/PROJECT_STATE_SUMMARY.md` is this project's worked example: it names `multi-line-build` as the
working branch and describes mechanisms removed months ago. It was not wrong when written.

**What makes this file stale:**

- The tip commit moves. Every commit on this branch invalidates the header.
- Either branch moves: the absent-engine-changes table and the 16/22 commit counts are a snapshot of one
  merge-base.
- The baselines are recaptured, here or there. The v44-versus-v47 fact is the one most likely to be quoted
  after it stops being true.
- The drivers land in the repo, or the render baseline arrives here. Both would delete a section.
- Any open question is ruled on.

**Who updates it:** whoever makes the change that invalidates a line, in the same commit. A state document
updated separately from the work it describes is a state document that will not be updated.

**If you are reading this and the tip commit above is not `git log -1`, trust the repository and fix this
file.** Nothing here is authoritative over the code.
