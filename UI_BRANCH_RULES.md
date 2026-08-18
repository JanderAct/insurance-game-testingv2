# UI Branch Rules — ui/decision-surface

Read this before touching anything on this branch.

## The five rules

1. **NEVER RECAPTURE BASELINES ON THIS BRANCH.** UI work is value-neutral,
   so it gates against `claims-distribution`'s baselines unchanged. A moved
   value is a LEAK TO INVESTIGATE, not a re-baseline. `VALUE_IDENTITY_v*.json`
   and `SOLO_EXPORT_GUARD_v*.json` are generated artifacts and git cannot
   merge them — two branches each recapturing produces a conflict with no
   correct resolution.

2. **TO PICK UP ENGINE WORK, MERGE `claims-distribution` IN. Never rebase.**
   Other sessions may have this branch checked out and rebasing rewrites
   history under them. Merging the other way is safe, and typecheck catches
   semantic conflicts — if the engine renames a field the UI reads, the
   build fails loudly.

3. **THIS BRANCH SQUASH-MERGES BACK.** Iteration commits stay here;
   `claims-distribution` gets one clean commit per finished piece of UI.
   Going back and forth on styling produces commits like "try this" and
   "revert that" — those should not reach the main history.

4. **MERGE `claims-distribution` IN AS SOON AS IT DRIFTS MORE THAN TWO OR
   THREE COMMITS.** Letting it go fourteen commits made a squash-merge back
   risky (a much larger diff to land in one shot) and made this branch's own
   gate checks meaningless in the meantime — they were comparing against a
   baseline everyone already knew was stale/red on the parent, not against
   a current, trustworthy state. Merge early and often; do not let this
   branch become the reason a merge needs a careful review pass.

5. **ONLY ONE SESSION HOLDS THIS BRANCH AT A TIME.** Two sessions worked it
   concurrently on 2026-08-19 — one merged `claims-distribution` into it
   (`e092317`, then a rules-file refresh in `6d8d4fe`), the other
   squash-merged this branch's contents into `claims-distribution`
   (`8c0ae6f`) and force-pushed that over the branch, orphaning the first
   session's two commits. Nothing was lost only because the tab work hadn't
   started yet — a squash-merge-and-force-push a few hours later would have
   silently discarded real, uncommitted-elsewhere UI work. Before starting
   work here, confirm no other session currently has this branch as its
   active target; before ending a session that touched it, say so plainly
   rather than leaving the next reader to discover it from the reflog.
