# Decisions Chat — Context Handoff (refreshed)

This is the **decision-design** thread for the Pool Risk Management Game. A separate chat handles
the build stages (implementation with Claude Code). Keep this thread focused on the *design* of
player decisions and their consequences; leave stage/implementation work to the build thread.

**This refreshes the earlier handoff** — some things were decided in the build thread since, and
the open list has changed. Read this file first, then the referenced docs.

## What the game is
A multi-line insurance risk-pool simulation (React/TypeScript). The player runs a public-entity
pool across up to three coverage lines — Workers' Comp (WC), General Liability (GL), Property (PR)
— making yearly decisions about pricing, underwriting, reinsurance, reserving, investments, and
capital, then seeing long-term consequences. It rewards disciplined, sustainable management over
short-term optimization.

## Core design principles (unchanged)
- No decision is a single input with a single output — every decision ripples into member
  behavior, pool finances, and future years, often with delay.
- Members react to what they **experience** (their bill, pool stability, their own claim
  experience), not to the internal levers the player pulls.

## RESOLVED in the build thread since the last handoff (absorb these into the decision docs)

**Per-line investments (big one — reverses a Tier 1 lock).** Investments are no longer
shared/commingled. Each line now invests its own assets with its own cash/bonds/equities
allocation (rationale: asset-liability duration matching — WC's long tail vs. Property's short
tail). Specifics:
- Asset allocation is now a **per-line** decision (was pool-level).
- Inter-line loan rate = the pool's **asset-weighted blended** investment return that year, fixed
  at origination.
- Inter-line borrowing is **kept** — lines invest separately but can still lend surplus to each
  other.
- Correlated investment risk is now **isolated per line** (a bond-heavy line is insulated from a
  market drop that hits an equity-heavy line). Accepted by design.
- Consequence: the **"Pool" tab is removed from decision-oriented pages** (Decisions, Decision
  History) — no pool-level decisions remain. It stays on results pages (Dashboard, Financials,
  Results, year-comparison) as a combined-results view.
- Full detail: DECISIONS_CHANGE_per_line_investments.md.

**Action for this chat:** update DECISIONS.md — move asset allocation to the per-line section, and
revise its cross-effects (it now affects only its own line's surplus, not the whole pool).

## STILL OPEN — resolve these here

1. **Decision audit Gaps 6 & 7.** Confirm keeping (a) the poor-loss-year retention penalty and
   (b) the surplus-strength retention/growth bumps as-is. Both looked correct; just need final
   sign-off. (Gaps 2–5 already resolved; see DECISIONS.md.)

2. **Effective-rate-drives-satisfaction fix (build Stage 2.5).** Direction decided (satisfaction
   keys off the members' actual bill, not just the rateChange decision). Tabled sub-decisions:
   how a reserve funding load translates into the bill (multiplier vs. additive), whether
   effective-rate satisfaction replaces or layers on the existing rateChange→satisfaction link,
   and exactly what the effective bill includes. Also the **CLF satisfaction sign correction**:
   current code wrongly makes higher CLF *raise* satisfaction (a free lunch); it should be
   net-negative (bill pain) softened by a small stability bonus that stays smaller than the pain.

3. **Per-line decision editing UX.** With every decision now per-line (including asset allocation)
   and no Pool decision tab, decide whether editing is strictly per-line (each line on its own
   tab) or includes a cross-line "apply to all" convenience. Models A/C (strict) vs. B/hybrid
   (convenience). Detail + update in BRAINSTORM_per_line_decision_editing.md.

## How this connects to the build thread
Decide here → document in DECISIONS.md → flag for the build thread to implement. Don't implement
here. Several build stages are gated on these: Stage 2.5 (effective-rate) and Stage 2.7 (per-line
editing) both wait on decisions above.

## Files in this bundle
- START_HERE_context.md (this file)
- DECISIONS.md / .pdf — technical decision reference (the source of truth to update)
- Decisions_Detailed_Reference / Decisions_Manager_Overview — formatted views
- DECISIONS_CHANGE_per_line_investments.md — the resolved per-line investments change
- BRAINSTORM_per_line_decision_editing.md — open item 3 detail
- decision_tree.html — interactive decision tree
