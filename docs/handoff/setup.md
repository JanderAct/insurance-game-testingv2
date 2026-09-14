# Setup

How to get this running from scratch on a new machine. Every step below was
executed against the repository at `62e0481` while writing this document; the
outputs quoted are real.

**There are no secrets to obtain.** No API keys, no `.env` file, no accounts, no
credentials of any kind are required — the application has no backend and makes
no network calls. If someone hands you a credential for this project, ask what
it is for, because nothing in the repository needs one. See
`dependencies-and-integrations.md` §7.

---

## 1. Prerequisites

| Requirement | Version used | How it is pinned |
|---|---|---|
| **Node.js** | **v22.22.2** | **⚠ Not pinned.** No `engines` field, no `.nvmrc`, no `.node-version`. `@types/node` is `^22.20.1` and `tsconfig.scripts.json` targets Node, which is the only signal. **Use Node 22.** |
| **npm** | 10.9.7 | Ships with Node 22. |
| Git | any | — |
| A browser | Chromium-based recommended | The `localStorage` quota was measured on Chromium only. Other engines should work; only Chromium was verified. |

**Network access is required for `npm install`**, and — less obviously — **also
to run the verification gates**, because `tsx` is fetched by `npx` at run time
(see §5.2). The application itself needs no network at all once built.

Nothing else. No database to provision, no service to sign up for, no Docker,
no system packages.

---

## 2. Get the code

```bash
git clone https://github.com/JanderAct/insurance-game-testingv2.git
cd insurance-game-testingv2
```

**⚠ Then immediately check out a working branch. `main` is not the project.**

`main` still points at `116b96d` — the founding upload of 2026-07-15, a
two-month-old prototype. All 364 subsequent commits live on feature branches.

```bash
git checkout feature/pricing-estimate     # the effective trunk, current state
```

| Branch | Use it for |
|---|---|
| `feature/pricing-estimate` | **The current state.** This is what you want. |
| `demo-2026-09` | **FROZEN for a presentation. Do not push to it.** |
| `main` | The 2026-07-15 prototype. Not the project. |

See `history.md` §3 for the full branch taxonomy.

---

## 3. Install

```bash
npm install
```

Or, for a reproducible install matching the committed lockfile exactly:

```bash
npm ci
```

`package-lock.json` is committed (307 packages), so `npm ci` is deterministic.
Prefer it.

**Expect `npm audit` to report 9 vulnerabilities (2 moderate, 7 high).** This is
the known standing position, not a sign that the install went wrong. Seven of
them clear with `npm audit fix`; `xlsx` has no fix available and `esbuild`'s fix
is a breaking Vite major upgrade. **Do not run `npm audit fix --force` casually**
— it will move Vite from 5.x to 8.x. The full breakdown, and the reasoning about
which of these actually matter here, is in `dependencies-and-integrations.md`
§5.3.

---

## 4. Run it

### 4.1 Development server

```bash
npm run dev
```

Vite serves on `http://localhost:5173` by default. The app loads straight onto
the **Game Setup** tab; pick coverage lines and a game length and start. No
login, no configuration.

### 4.2 Production build

```bash
npm run build
```

Verified at `62e0481`:

```
vite v5.4.21 building for production...
✓ 1554 modules transformed.
dist/index.html                   0.45 kB │ gzip:   0.29 kB
dist/assets/index-BJfamAv-.css   55.80 kB │ gzip:   8.60 kB
dist/assets/index-DUv8Bqh9.js   911.61 kB │ gzip: 286.92 kB
✓ built in 9.56s
```

Note the 911 kB JS bundle, which exceeds Vite's 500 kB chunk warning. It builds
and works; no code splitting has been done. Recorded in `known-issues.md`.

```bash
npm run preview     # serve the built bundle locally
```

`dist/` is gitignored. There is **no deploy step** — no host is configured and
the application has never been deployed. Any static file host would serve
`dist/` as-is; nothing else is needed, because there is no backend.

---

## 5. Verify it

### 5.1 Type checking and linting

```bash
npm run typecheck      # tsc --noEmit on both the app and the scripts projects
npm run lint           # eslint .
```

Verified at `62e0481`:

- **`typecheck` passes clean.** No output, exit 0.
- **`lint` reports 21 problems (14 errors, 7 warnings).** This is the standing
  state, not something you broke. 6 are auto-fixable. See `known-issues.md`.

### 5.2 The gate sweep

This is the project's real verification and it is where most of the confidence
in the codebase lives — 89 diagnostic scripts in three tiers.

```bash
npm run gates          # FAST tier  — 52 gates
npm run gates:slow     # SLOW tier  — 13 gates
npm run gates:all      # FAST + SLOW — 65 gates, the full pass/fail sweep
npm run gates:probes   # PROBES     — 24 measurement scripts, no pass/fail
npm run gates:list     # list every gate and its tier
```

**⚠ Two things to know before your first run:**

1. **`tsx` is not a declared dependency.** All five scripts invoke `npx tsx`,
   and `tsx` appears in `package.json` not at all and in `package-lock.json`
   only as an optional peer of another package. `npx` will fetch it from the
   registry on first use, at whatever version it resolves. **This means the
   gates need network access and are not version-pinned.** It also means they
   will not run at all in an air-gapped environment. This is a real gap, not a
   quirk — see `known-issues.md` and `wishlist.md`.

2. **The sweep is not fast and it is not all green.** `gates:all` runs 65
   scripts three at a time and **takes well over ten minutes** — the SLOW tier
   alone exceeded 25 minutes here, with single gates at 978s and 844s. The
   expected standing result at `62e0481` is recorded in `known-issues.md` §1:
   **57 ok, 4 FAIL, 3 expected-red, 1 XPASS.** Do not treat a red sweep as a
   broken checkout until you have compared it against that table.

Tier boundaries are derived from measured runtime, not hand-assigned:
`TIER_THRESHOLD_SECONDS = 88`, with recorded timings in
`scripts/gate-timings.json`. A manifest check fails if a gate in FAST measures
over the threshold, which is what stops the tiering going stale.

### 5.3 The baselines

Two pinned baselines live in `baselines/` and several gates read them directly
from disk:

- a **value-identity snapshot** (~30,480 numeric fields)
- a set of **export captures**

If an engine change moves either, that is the finding — the gates are designed
so a recapture is a deliberate act, not a convenience. `BASELINE_LINEAGE_v4_to_v35.md`
(2,349 lines) records what moved at each of 32 versions and why.

---

## 6. Repository layout

```
src/                  the application — 86 files, 37,847 lines
  App.tsx             state, the save, tab routing
  main.tsx            entry point
  pages/              12 tab pages
  components/         9 shared components
  data/               constants, the member catalogue, roster CSVs, documents
  types/              simulation.ts (1,587 lines) + shocks.ts (255)
  utils/              the engines, the save codec, exports
  assets/             RippleLogo.tsx (inline SVG)
scripts/              verification — 91 files, 30,328 lines
  gates.ts            the runner, tiers, EXPECTED_RED register, manifest check
  gate-timings.json   recorded runtimes, updated on demand — see §7
  diagnostics/        the 89 gates and probes
  tools/              generate-member-catalog.ts
baselines/            pinned value-identity and export baselines
docs/                 11 documents, 5,518 lines — plus docs/handoff/ (this set)
```

Config at the root: `vite.config.ts`, `eslint.config.js`, `postcss.config.js`,
`tailwind.config.js`, `tsconfig.app.json`, `tsconfig.node.json`,
`tsconfig.scripts.json`, `index.html`.

`tsconfig.app.json` sets `strict: true`, `noUnusedLocals`, `noUnusedParameters`
and `noFallthroughCasesInSwitch`. The strictness is load-bearing in places —
`Occurrence.memberId` is deliberately optional so the compiler forces every
consumer to handle the multi-member case.

---

## 7. Gotchas a new developer will hit

**`scripts/gate-timings.json` holds the recorded runtimes the manifest check
enforces the tier threshold against.** It is committed, and — importantly — it is
**not** rewritten by an ordinary sweep: running `gates:all` leaves it unmodified.
The figures are updated on demand, not continuously, so a gate that has quietly
got slower will not be caught until someone re-records. If you change something
expensive, re-record deliberately.

**Regenerating the member catalogue** is a separate build-time step, not part of
`npm run build`:

```bash
npx tsx scripts/tools/generate-member-catalog.ts
```

It reads `src/data/roster_canonical_v6.csv` and rewrites
`src/data/memberCatalog.ts`, which is committed. **Note that
`memberCatalog.ts:2` claims the source is `v5` — that header is stale; the
generator reads `v6`.**

**Saved games do not survive a change to the save format.** There is no
migration path and that is a ruled design decision — an old save fails to parse
and is discarded, giving a clean route to a new game. If you are playtesting
while changing `gameSave.ts`, expect to lose the game in progress.

**`localStorage` is per-origin.** A game started on `localhost:5173` will not
appear on a different port or a deployed URL.

**Clearing a stuck save:** delete the key `riskpool_gamestate_v10` in the
browser's dev tools, or start a new game from the Setup tab (which removes it).

**The `/vite.svg` favicon in `index.html` does not exist** — there is no
`public/` directory. A harmless 404 in the console; not a broken install.

---

## 8. First hour, suggested

1. `npm ci && npm run dev`, start a three-line, ten-year game, and play a few
   years. The mechanics are the fastest way into the domain.
2. Read **`source-provenance.md`** — specifically *Items Recommended for
   Review*. There are decisions waiting there that should be made before the
   project goes anywhere.
3. Read `src/utils/gameSave.ts`'s header. It is the best single illustration of
   how this codebase records reasoning, and it takes ten minutes.
4. Run `npm run gates` and compare the result against `known-issues.md` §1, so
   you know what red is normal here before you change anything.
5. Read the file header of anything you intend to modify. They frequently
   contain an explicit warning against the change you are about to make, with
   the measurement that ruled it out.
