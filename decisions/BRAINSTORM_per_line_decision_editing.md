# Brainstorm to Carry Into the Decisions Chat

## Topic: Per-line decision *editing UX* — should the Pool tab edit all lines, or only view them?

**Context / where this came from:** During Stage 2.1 (the pool/per-line view toggle), the current
build lets you make a decision on the Pool tab (e.g. a rate change) and have it apply to all
active lines at once. Per-line decision *editing* (setting a different rate for GL vs WC) isn't
built out yet — only WC is currently editable. Before that gets built, we want to decide how
editing should work across the Pool tab and the per-line tabs.

**Important distinction:** this is NOT about the data model. The Tier 1 decisions already settled
that rate change, underwriting strictness, risk control %, reinsurance level, CLF, dividend %, and
assessment % are all **per-line** decisions. The underlying state is already per-line. This
brainstorm is only about the **editing interface** on top of that model — where and how the player
sets those per-line values.

---

## The three models

**Model A — Strict separation.** The Pool tab edits nothing line-specific; each per-line decision
is set only on that line's own tab (WC rate on the WC tab, GL rate on the GL tab, etc.). The Pool
tab is for pool-wide decisions (asset allocation) and combined *viewing* only.
- Pro: zero ambiguity about what you changed; reinforces that lines are managed separately.
- Con: moving all three lines together takes three separate edits (tedious for broad moves).

**Model B — Pool convenience + per-line override.** The Pool tab offers a "set for all lines"
broad stroke (e.g. "+5% rate across all lines"), and line tabs allow individual overrides.
- Pro: fast for broad posture-setting; mirrors how an administrator sets a default then tunes
  outliers.
- Con: needs a clear conflict rule (does a per-line edit override a later pool-wide edit? does
  re-applying pool-wide wipe per-line tweaks?). That ambiguity can leave players unsure what their
  actual decision was.

**Model C — Pool shows per-line decisions read-only.** The Pool tab displays a summary of what's
set for each line but isn't editable there; all editing happens on line tabs.
- Pro: A's clarity plus an at-a-glance overview of all lines' decisions.
- Con: still three edits for a broad move; slightly more to build.

---

## Lean / argument (for discussion, not decided)

Leaning **A or C** for a *teaching* game specifically. The core lesson is that WC, GL, and Property
must be managed *differently* — different loss patterns, volatility, reinsurance needs. A
"change all three at once" convenience (Model B) subtly encourages treating them as one blob, which
cuts against that lesson. Forcing the player onto each line's tab to set that line's decisions
reinforces "these are separate businesses deserving separate thought" — the mild tedium is arguably
a feature.

Counterpoint: if playtesting shows per-line editing feels like pure busywork (especially in early
years when a player reasonably wants to move everything together), Model B's convenience earns its
keep. Could also consider a hybrid: default to strict per-line (A/C), but offer an explicit,
clearly-labeled "apply to all lines" action that the player has to consciously invoke — so the
broad stroke exists but isn't the silent default.

## Open question for the decisions chat
- Pick A, B, C, or the labeled-hybrid.
- If B or hybrid: define the exact conflict/precedence rule (per-line always wins? last-edit wins?
  does pool-wide re-apply overwrite overrides?).
- Decide whether the Pool tab should at minimum show a read-only per-line decision summary
  regardless of which editing model is chosen (that part is appealing under any model).

## Status
Not decided. Not blocking current build — surfaces when per-line decision *editing* (GL/PR
decision controls) is actually built. Data model is already per-line, so any of these is
implementable without structural change.

---

## UPDATE — asset allocation is now also a per-line decision
Since this brainstorm was first written, the per-line investments change was resolved: asset
allocation (cash/bonds/equities) is no longer pool-level — it's now a per-line decision like the
others. This means:
- **Every** decision is now per-line. There are no pool-level decisions left, so the "Pool tab
  edits all lines" convenience models (B and hybrid) would apply to asset allocation too.
- The Pool tab is being removed from the decision-oriented pages entirely (no pool-level
  decisions remain to edit there). So the editing-UX question is purely about how the per-line
  tabs (WC/GL/Property) handle editing — whether there's any cross-line "apply to all" convenience
  or strictly per-line editing.
- Reframed question: with all decisions per-line and no Pool decision tab, do we want a
  convenience mechanism to set a decision across all lines at once (invoked from somewhere), or
  strictly edit each line on its own tab? Models A/C (strict per-line) vs. B/hybrid (a broad-stroke
  convenience) still apply — just without a Pool tab as the home for the broad stroke.
