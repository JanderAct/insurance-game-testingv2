# Dependencies and Integrations

## 0. The short version

**There are no integrations.** Ripple consumes no external service, calls no
API, authenticates against nothing, and transmits nothing off the machine it
runs on. Every dependency below is an npm package that ships into the bundle or
runs at build time. There are no credentials to hold, rotate or hand over.

That is unusual enough to state explicitly before the tables:

| Integration category | Status |
|---|---|
| Third-party API consumed at runtime | **N/A** — none |
| Database / data store (hosted or local) | **N/A** — none |
| Authentication / identity provider | **N/A** — none |
| Payment processor | **N/A** — none |
| Email / SMS / notification service | **N/A** — none |
| Analytics, telemetry, crash reporting | **N/A** — none |
| CDN or asset host | **N/A** — none; all assets are bundled |
| Hosting / deployment platform | **N/A today** — see §4 |
| CI/CD service | **N/A** — no workflow files; see §4 |
| Feature flag / config service | **N/A** — flags are TypeScript constants |
| Secrets manager / vault | **N/A** — no secrets exist |
| Webhooks (in or out) | **N/A** — none |

**Verified**, not assumed: `src/` contains no `fetch`, `XMLHttpRequest`,
`WebSocket` or `axios` call, and no `https://` URL outside of comments. There is
no `.env` file in the repository and no `process.env` or `import.meta.env`
reference in `src/`.

---

## 1. Runtime dependencies (7)

These ship into the browser bundle.

| Package | Declared | Installed | Licence | What it does here |
|---|---|---|---|---|
| `react` | `^18.3.1` | 18.3.1 | MIT | UI framework. |
| `react-dom` | `^18.3.1` | 18.3.1 | MIT | DOM renderer for React. |
| `lucide-react` | `^0.344.0` | 0.344.0 | ISC | Icon set. Used in **17** files across `src/components/` and `src/pages/`. |
| `xlsx` | `^0.18.5` | 0.18.5 | Apache-2.0 | Generates the two `.xlsx` exports. Used by `src/utils/claimsExport.ts`, `src/utils/resultsExport.ts`, `src/utils/resultMetrics.ts`, `src/utils/lineDisplay.ts`, `src/pages/ResultSpreadsheetPage.tsx`. **⚠ See §5.1 — this one needs a decision.** |
| `marked` | `^18.0.10` | 18.0.10 | MIT | Markdown → HTML for the three in-app documents. Used at exactly one site: `src/utils/renderMarkdown.ts:1`. |
| `fflate` | `^0.8.3` | 0.8.3 | MIT | DEFLATE for the save codec. Used at exactly one site: `src/utils/gameSave.ts:140` (`deflateSync`, `inflateSync`, `strFromU8`, `strToU8`). **The only recent runtime addition.** |
| `@supabase/supabase-js` | `^2.57.4` | 2.108.2 | MIT | **NOTHING. See §5.2.** |

### 1.1 Why `fflate`, and the package that is not here

`fflate` is the newest runtime dependency, added to compress the save after the
raw payload reached 101% of its budget (see `data.md` §3.2).

**⚠ `lz-string` is not a dependency and never was one in a committed state.** It
was installed temporarily to produce a measured codec bake-off and then removed.
It appears at HEAD only inside comments — `src/utils/gameSave.ts` (the results
table) and `docs/WORKING_PRACTICES.md` — and transiently in `package-lock.json`
at commit `44a61fe`. A reader cannot re-run that table without reinstalling it,
which is why the numbers are preserved in the comment rather than left as a
reproducible script. It lost on speed, not size: every `lz-string` variant beat
`fflate` on stored bytes, and `fflate` was ten times faster to produce, on a
write path that fires far more often than once a year.

*For licence purposes: `lz-string` (MIT, or WTFPL in older releases) is **not**
shipped, not linked, and not in the lockfile at HEAD. Only its measured output
sizes are recorded.*

---

## 2. Development dependencies (16)

Build-time and verification only; none of these reach a player.

| Package | Declared | Installed | Licence | Role |
|---|---|---|---|---|
| `vite` | `^5.4.2` | 5.4.21 | MIT | Dev server and production bundler. |
| `@vitejs/plugin-react` | `^4.3.1` | 4.7.0 | MIT | React fast refresh / JSX transform. |
| `typescript` | `^5.5.3` | 5.9.3 | **Apache-2.0** | Type checking. `strict: true`. |
| `typescript-eslint` | `^8.3.0` | 8.62.0 | MIT | TS rules for ESLint. |
| `eslint` | `^9.9.1` | 9.39.4 | MIT | Linter. |
| `@eslint/js` | `^9.9.1` | 9.39.4 | MIT | ESLint's own recommended config. |
| `eslint-plugin-react-hooks` | `^5.1.0-rc.0` | 5.2.0 | MIT | Hook rules. **Declared at a release candidate**; the installed 5.2.0 is stable. |
| `eslint-plugin-react-refresh` | `^0.4.11` | 0.4.26 | MIT | Fast-refresh safety rules. |
| `globals` | `^15.9.0` | 15.15.0 | MIT | Global identifier lists for ESLint. |
| `tailwindcss` | `^3.4.1` | 3.4.19 | MIT | Styling. |
| `@tailwindcss/typography` | `^0.5.20` | 0.5.20 | MIT | Prose styles for the rendered markdown documents. |
| `postcss` | `^8.4.35` | 8.5.16 | MIT | CSS pipeline Tailwind runs on. |
| `autoprefixer` | `^10.4.18` | 10.5.2 | MIT | Vendor prefixes. |
| `@types/node` | `^22.20.1` | 22.20.1 | MIT | Node types for `scripts/`. |
| `@types/react` | `^18.3.5` | 18.3.31 | MIT | React types. |
| `@types/react-dom` | `^18.3.0` | 18.3.7 | MIT | React DOM types. |

### 2.1 Licence summary — direct dependencies

| Licence | Count | Packages |
|---|---:|---|
| MIT | 20 | everything not listed below |
| Apache-2.0 | 2 | `typescript`, `xlsx` |
| ISC | 1 | `lucide-react` |

**All 23 direct dependencies are permissive.** No copyleft (GPL/LGPL/AGPL), no
source-available or non-commercial licence, no dual-licensed package requiring
a commercial key, among the direct set. Apache-2.0 carries a patent grant and
an attribution/NOTICE requirement; MIT and ISC require attribution only. None
restricts commercial use or redistribution of this application.

**⚠ Transitive dependencies have not been licence-audited.** `package-lock.json`
resolves **307** packages. The 23 above are the declared set; the other ~284
were not individually reviewed for this handoff. A team taking this on
commercially should run a licence scan over the full tree before shipping. This
is flagged rather than resolved. See `source-provenance.md`.

---

## 3. Undeclared tooling — `tsx`

**⚠ The entire verification harness runs on a package that is not a declared
dependency.** All five gate scripts in `package.json` invoke `npx tsx`:

```
"gates":        "npx tsx scripts/gates.ts",
"gates:slow":   "npx tsx scripts/gates.ts --slow",
"gates:all":    "npx tsx scripts/gates.ts --all",
"gates:probes": "npx tsx scripts/gates.ts --probes",
"gates:list":   "npx tsx scripts/gates.ts --list"
```

`tsx` appears nowhere in `package.json`, appears in `package-lock.json` only as
an *optional peer* of another package (`"tsx": "^4.8.1"` under
`peerDependenciesMeta` → optional), and **is not present in `node_modules`**.

Consequences a new team will hit:

1. `npm run gates` triggers `npx` to fetch `tsx` from the npm registry on first
   use. **The verification suite therefore requires network access to run**,
   even though the application itself does not.
2. The version is unpinned. Whatever `npx` resolves is what the 89 gates run
   on. Two developers can be running different TypeScript loaders against the
   same baselines.
3. In an air-gapped or offline environment the gates simply do not run.

This is a genuine gap, recorded here and in `known-issues.md`. Per the brief it
has **not** been fixed. The obvious remedy — adding `tsx` to `devDependencies`
at a pinned version — is listed in `wishlist.md`.

---

## 4. Platforms and services

### 4.1 Source hosting

GitHub — `JanderAct/insurance-game-testingv2`. Active branch
`feature/pricing-estimate`; `demo-2026-09` is **frozen for a presentation** and
must not be pushed to. Ten branches exist in total (see `history.md`).

### 4.2 CI/CD

**N/A — none configured.** There is no `.github/workflows/`, no CI config of any
kind. The "gates" are a local npm script, not a hosted pipeline. Nothing runs
automatically on push or on pull request. Verification happens because a
developer runs it.

### 4.3 Hosting / deployment

**N/A today — the application has never been deployed to a hosting platform.**
`npm run build` produces a static bundle that any static host would serve, but
no host is configured, no deploy script exists, and there is no production URL.

The one distribution channel that has been used is **StackBlitz**, for demoing
the game from a git ref. That is a browser-based IDE reading the public GitHub
repo — it needs no credential and stores nothing. A known constraint was
recorded during that work: StackBlitz fails at the clone step on a
`/tree/<short-sha>` URL, matching `stackblitz/core` issue #1423, so the demo ref
must be a form it can resolve.

### 4.4 Runtime platform

The player's browser. Chromium is the only engine against which the
`localStorage` quota was actually measured (5,242,613 characters); other engines
were not reachable to measure, which is why the save's failure path is loud
rather than assumed impossible.

Node is required for development only. `tsconfig.scripts.json` and
`@types/node` ^22 imply Node 22; no `engines` field or `.nvmrc` pins it. See
`setup.md`.

### 4.5 Ownership and cost

| | |
|---|---|
| Recurring cost of dependencies | **£0 / $0.** Every package is free and permissively licensed. |
| Recurring cost of services | **£0 / $0.** There are no services. |
| Paid accounts required | **None.** |
| Vendor lock-in | **None** at the service level. The heaviest coupling is to React and Vite, both replaceable with effort. |
| Ownership of the code | Not stated anywhere in the repository — there is **no `LICENSE` file**, no copyright header, and no `license` field in `package.json` (which is marked `"private": true`). **This needs resolving before any distribution.** See `source-provenance.md`. |

---

## 5. Dependency issues requiring a decision

### 5.1 `xlsx` — two high-severity advisories with no fix available

`npm audit` reports, against the installed tree:

```
xlsx  *
Severity: high
  Prototype Pollution in sheetJS   GHSA-4r6h-8v6p-xvw6
  SheetJS Regular Expression DoS   GHSA-5pgg-2g8v-p4x9
No fix available
```

"No fix available" is accurate and is not a stale advisory database: SheetJS
stopped publishing the `xlsx` package to npm after the 0.18 line. The npm
package is frozen at 0.18.5; current releases are distributed from the vendor's
own CDN. So `npm update` cannot resolve this, by construction.

**Exposure assessment, stated so a reviewer can weigh it rather than react to
it:** both advisories concern *parsing* untrusted spreadsheet input. This
application only ever **writes** workbooks — it has no import path and accepts
no user-supplied file (see `data.md` §1, §5). On that reading the practical
exposure is low. That is an assessment, not a clearance; the advisories are
real and the package is unmaintained on the channel it is being consumed from.

Options, none of them taken here: migrate to the vendor CDN distribution,
switch to a maintained alternative (e.g. `exceljs`), or accept and document the
risk on the grounds that no parsing path exists. **Flagged, not remediated.**

### 5.2 `@supabase/supabase-js` is declared and completely unused

Searched across the whole repository: the string `supabase` appears **only** in
`package.json` and in `package-lock.json`. There is no import, no client
construction, no URL, no key, no configuration and no code path that would use
it.

It pulls in a substantial transitive subtree (`@supabase/auth-js`,
`functions-js`, `postgrest-js`, `realtime-js`, `storage-js`, `phoenix`) for no
benefit, and its presence actively misleads — a reader inspecting
`package.json` will reasonably conclude the application has a backend, a
database and authentication. It has none of those.

**It is residue from the Bolt (bolt.new / StackBlitz) scaffold the project
started from** — established, not guessed: it is one of only four dependencies
in the founding commit's `package.json`, which is that template's default set.
See `source-provenance.md` §1.1. **Nothing here was ever planned as a backend.**

**Flagged, not remediated** — removing it is a `package.json` change and this
exercise is documentation only. It is the single cheapest cleanup available and
is first on `wishlist.md`.

### 5.3 Full audit position

`npm audit` on the installed tree: **9 vulnerabilities — 2 moderate, 7 high.**

| Package | Severity | Direct? | Fix |
|---|---|---|---|
| `xlsx` | high (×2) | **direct** | **none available** — see §5.1 |
| `postcss` | high | **direct** | `npm audit fix` |
| `brace-expansion` | high | transitive (eslint tree) | `npm audit fix` |
| `browserslist` | high | transitive | `npm audit fix` |
| `js-yaml` | high | transitive | `npm audit fix` |
| `nanoid` | high | transitive | `npm audit fix` |
| `esbuild` | moderate | transitive (via `vite`) | `npm audit fix --force` — **breaking**, installs vite 8.x from 5.x |
| `baseline-browser-mapping` | moderate | transitive | `npm audit fix` |

Notes for whoever acts on this:

- The `esbuild` advisory (GHSA-67mh-4wv8-2f99) concerns the **dev server**
  allowing any website to send requests to it and read the response. It does
  not affect the built bundle. The fix is a major Vite upgrade (5 → 8), which
  is a real piece of work and should not be done casually before a
  presentation.
- Everything except `xlsx` and `esbuild` clears with a plain `npm audit fix`.
- **None of these was fixed as part of this documentation exercise**, per the
  brief.

### 5.4 Declared ranges have drifted from installed versions

Several carets now resolve well past what was declared — `typescript` `^5.5.3`
→ 5.9.3, `eslint` `^9.9.1` → 9.39.4, `@supabase/supabase-js` `^2.57.4` →
2.108.2, `vite` `^5.4.2` → 5.4.21. `package-lock.json` is committed, so a
`npm ci` install is reproducible; a plain `npm install` on a fresh clone with a
deleted lockfile would not be. Not a defect, but worth knowing before
debugging a "works on my machine" difference.

`eslint-plugin-react-hooks` is declared at `^5.1.0-rc.0` — a **release
candidate** as the floor of the range. It resolves to stable 5.2.0 today; the
declaration should be tidied to `^5.2.0`.

---

## 6. Runtime browser APIs relied on

Not packages, but external contracts the code depends on and would break
without:

| API | Used for | Note |
|---|---|---|
| `localStorage` | The save | Quota measured on Chromium only. |
| `btoa` / `atob` | base64 in the save codec | Chosen over a hand-rolled implementation deliberately: both are globals in every browser **and in Node 16+**, so the gates and the app run identical code, and the engine implementation measured ~8× faster (10.4 ms vs 79.2 ms on the worst save). |
| `visibilitychange`, `pagehide` | Flushing the debounced save | A static gate asserts both listeners are registered, both handlers reach `flush()`, and cleanup removes both. **It cannot assert the browser actually fires them** — that assumption is documented at the gate rather than hidden. |
| Blob / object URL download | `.xlsx` and `.csv` exports | Standard client-side download. |

---

## 7. What a new team needs to obtain

**Nothing.** No accounts, no API keys, no licences to purchase, no service to
provision, no data to be granted access to. `git clone`, `npm install`,
`npm run dev`. See `setup.md`.

The only access question in the project is not technical: it concerns the real
pool experience the model parameters were fitted against, and whether those
parameters may be distributed. That is set out in **`source-provenance.md` →
Items Recommended for Review**.
