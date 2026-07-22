# Decisions-Chat Entry: Move Asset Allocation to Per-Line (segregated investments)

## The change
Reverse the Tier 1 decision that investments are **shared/commingled with a single pool-level
asset allocation**. Instead: **each coverage line invests its own assets separately**, with its
**own cash/bonds/equities allocation decision**, keeping its own gains and losses.

## Why (rationale)
Realism / asset-liability matching. Lines have very different liability durations — WC's long
tail (7–10 yr payout) wants different assets than Property's short tail (3–4 yr). Real pools with
per-line accounting often segregate investments for exactly this reason. Also sets up a future
teaching point about matching asset duration to liability duration.

## What this reverses / supersedes
- **Tier 1 (Capital structure):** "Investments are shared/commingled — one portfolio, income
  allocated back to each line by contribution share." → now **per-line portfolios**.
- **Asset allocation decision** moves from **pool-level** to **per-line**.

## Downstream implications to reconcile (this is more than moving a slider)

1. **Investment engine (was Stage 1.5).** Currently: one shared portfolio; income allocated back
   to lines by contribution share. Becomes: each line has its own sub-portfolio, allocates
   independently, earns/loses on its own. The "allocate shared income by contribution share"
   mechanic is removed entirely.

2. **Inter-line loan rate (Stage 1.6) — needs a new rule. ⚠️ OPEN QUESTION.** The loan interest
   rate is currently "the *pool's* realized investment return that year." With no single pool
   return anymore, which return sets the loan rate? Options: the borrowing line's return, the
   lending pool's blended return, an explicit pool-set rate, or a fixed reference rate. Must be
   decided before implementing.

3. **Correlated-risk dynamic changes.** Today a bad equities year hits all lines' surplus
   together (shared portfolio). With per-line portfolios, a conservative (bond-heavy) line is
   insulated while an aggressive (equity-heavy) line takes the hit. Arguably better teaching —
   your allocation choice affects only your line — but it changes the documented dynamic in
   DECISIONS.md.

4. **DECISIONS docs update.** Move asset allocation from the pool-level section to per-line; update
   its cross-effects writeup (it now interacts with that line's own surplus/reserve strategy, not
   the whole pool's).

5. **Inter-line borrowing still shares capital even if investments are separate.** Confirm the
   intent: lines invest separately, but can they still *borrow* from each other (Stage 1.6)? Most
   likely yes — a line short on surplus can still borrow from another line's surplus even if each
   invests independently. Just confirm investing-separately and borrowing-across-lines coexist.

## Open questions for the decisions chat
- Confirm the reversal (per-line segregated investments) is final.
- Decide the new inter-line loan rate rule (implication #2 above).
- Confirm inter-line borrowing still exists alongside separate investing (#5).
- Decide how (if at all) to preserve any correlated-risk teaching, or accept the new insulated
  dynamic (#3).
- Confirm the Pool-tab removal on decision-oriented pages (#6 below).

## Implication #6 — "Pool" tab disappears from the DECISION-oriented pages
Asset allocation was the **last remaining pool-level decision**. Once it moves per-line, EVERY
decision is per-line and there are no pool-level decisions left. Consequences:
- **Decisions page:** the Pool tab has nothing to decide → remove it, leaving WC / GL / Property.
- **Decision History page:** its Pool tab currently shows pool-level asset allocation → it would
  also have nothing to show → likely drop the Pool tab there too.
- **BUT keep the Pool tab everywhere it means "combined results":** Dashboard, Financials,
  Results, and the year-comparison view. There, "Pool" is a results *aggregation* (sum across
  lines), which is still meaningful and wanted.
- Net: "Pool" means two different things by context — a *decision scope* (now empty, remove) vs.
  a *results aggregation* (keep). This change removes only the former.

## Build impact (for the build thread, once decided)
This is a rework of the Stage 1.5 investment engine and a change to the Stage 1.6 loan-rate
source — both already built. So it's a modify-existing-code change, not a fresh stage. Will need
a new baseline capture afterward (investment numbers change for every config). WC-only will also
change this time (its investment income is now WC's own portfolio, not a shared one) — so even the
WC baseline shifts, unlike prior changes. Plan a fresh baseline set (v5) after implementing.

## Status
✅ RESOLVED — all open sub-decisions settled (see resolutions below). Ready to hand to the build
thread as Stage 2.9.

## Resolutions (settled)
1. **Inter-line loan rate:** the pool's **asset-weighted blended investment return** for that year
   (weight each line's return by its invested assets), fixed at origination — same "locked at
   origination" behavior as today. Keeps the loan rate tied to real experience, easy to explain,
   and minimal change from current Stage 1.6 behavior.
2. **Inter-line borrowing:** KEPT. Lines invest separately but can still lend surplus to each
   other when one runs a deficit. Only the rate calculation changes (per #1); the loan mechanic is
   otherwise intact.
3. **Correlated-risk dynamic:** ACCEPT the new isolated model — each line owns its own investment
   risk. A bond-heavy line is insulated from a market drop that hurts an equity-heavy line. Do NOT
   try to re-engineer pool-wide investment correlation (it would contradict separate portfolios).
   Pool-wide compounding still exists via shared shock events hitting multiple lines' losses, and
   via borrowing when a hit line draws on others.
