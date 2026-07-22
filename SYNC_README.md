# Repo Sync — Project Docs (2026-07-22)

Full set of planning/design/baseline docs to bring the repo in sync with the design work.
Unzip into the repo root; the three folders (`docs/`, `baselines/`, `decisions/`) can sit at the
repo root. Then commit everything.

**Note on what's included vs. excluded:**
- **Included:** all source markdown, CSV, and .xlsx baseline files — the things Claude Code and
  the build reference.
- **Excluded on purpose:** the derived `.pdf`/`.docx` formatted versions (generated from the
  markdown for reading/sharing — no need to version them) and the snapshot `.zip` files (those
  are Teams-folder archives, not repo content).

## Folder layout
- **docs/** — build plan and tracking: PHASES.md, CLAUDE_CODE_PLAYBOOK.md, UI_REFINEMENTS.md,
  CALIBRATION_FINDINGS.md, STAGE_2.8_spec.md
- **baselines/** — all regression baselines. Current references: BASELINE_v5_* (defaults anchor,
  WC-only matches this) and BASELINE_v6_* (divergent per-line decisions anchor). Earlier
  v1–v4 kept for lineage.
- **decisions/** — decision-design docs: DECISIONS.md (source of truth), the per-line investments
  change, the editing-UX brainstorm, the decisions-chat START_HERE, and the interactive
  decision_tree.html.

## Current project state (for reference)
- Phase 1 complete + verified. Phase 2: Stages 2.1, 2.2, 2.3, 2.7, 2.8, 2.9 built & verified.
- Remaining Phase 2: 2.4 (needs Phase 3), 2.10 (per-line prior histories, not built), 2.5
  (needs decisions-chat), plus batched UI refinements.
- Branch: multi-line-build. Seed: MAMC6EA4. Baselines current at v5 (defaults) / v6 (divergent).
