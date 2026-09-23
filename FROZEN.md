# FROZEN — `demo-multiplayer-2026-09`

**This branch does not receive work.** It is cut from `claude/bold-bardeen-38lhp5` at `0f0750b`, the
commit that put the eight browser drivers in the repository, so that the frozen demo carries the
instruments that verify it rather than a claim that it once passed.

Anything further belongs on a live branch. If you are here to change something, you are on the wrong
branch.

---

## What this is

**A working multiplayer session layer on the engine as it stood on 2026-09-18.**

A host creates a room, teams join from their own browsers and choose their own coverage lines, every
browser computes its own year from the shared seed, and the host watches a table and four charts fill.
It runs against `localStorage` in one browser or against a server across machines.

## ⚠ Its numbers are not current, and this is the whole caveat

The branch point is `85b3b79` on `feature/pricing-estimate`. Four engine changes landed on
`feature/member-satisfaction` afterwards and **none of them are here**:

| Absent | Their commit |
|---|---|
| WC's supplied CLF curve | `ed8b582` |
| WC's shared year factor — the correlation channel | `8d55cdc` |
| GL's triangle contraction re-solve | `5c39e2d` |
| The satisfaction scale, and `MAX_DEFAULTS_DRIFT` per game | `f88fc71`, `120a94a` |

So **any figure produced by a run on this branch differs from one produced by anything built after
2026-09-18** — premiums, loss ratios, surplus, satisfaction. Demonstrate the mechanics from here.
Quote a number from here only as "the demo build", never as the engine's behaviour.

The GL market cycle is NOT in that list: `marketConditions.ts` predates the branch point and is
byte-identical on both branches.

The baselines here are at **v44**. `feature/member-satisfaction` recaptured at **v47** after its
re-solves, so these two sets are not interchangeable.

## How to verify it still works

```
npm install
npm run build && npx vite preview --port 4173 --strictPort &
node scripts/tools/session-drivers/host-teams.cjs        # ... and the other seven
npx tsx scripts/tools/session-contract-check.ts          # 126/126, twice
```

Expected, as of the freeze: solo-oracle 46, host-charts 46, full-session 33, viewer 19, two-contexts 16,
four-tabs 15, host-teams 13, replay-fidelity 8; the contract harness 126/126 against `localStorage` and
126/126 against the stub server; both value baselines bit-identical; 55 FAST gates with `ibner-null-check`
and `cession-uplift-basis` expected red.

`scripts/tools/session-drivers/_shared.cjs` says what each driver is for and which of their assertions
would survive an engine change — read it before concluding a red run means the demo has rotted.

## Where to read next

`STATE_bold-bardeen-38lhp5.md` (branch state, written the day before the freeze) ·
`SESSION_PRACTICES.md` (this layer's lessons) · `docs/WORKING_PRACTICES.md` (engine practice) ·
`src/session/httpTransport.ts` (the eight things a deployment still needs).

## ⚠ On the freezing convention

This file was written without sight of `demo-2026-09` — that branch is not on the remote this session can
see (`origin` carries only `claude/bold-bardeen-38lhp5`, `feature/member-satisfaction`,
`feature/pricing-estimate` and `main`), so its marking could not be copied and was not guessed at. If
`demo-2026-09` marks a freeze differently — a tag, a different filename, a line in the README — make the
two match and delete this note.
