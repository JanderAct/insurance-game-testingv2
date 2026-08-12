# Claude Code Playbook — Building the Ripple Phases

A session-by-session guide for implementing the phase plan with Claude Code. Written assuming
you're still getting comfortable with Claude Code and haven't settled on a git workflow — so the
version control is built into the routine here, kept as simple as possible. Follow the rhythm and
you get safe checkpoints for free, without having to think about git as a separate task.

---

## The One Rule That Matters Most

**One stage per session. One commit per stage. Test before you commit.**

Every stage in `PHASES.md` (1.1, 1.2, 1.3, …) is sized to be a single Claude Code session. Do
not let a session run two stages together, even if the first one went fast and Claude Code
offers to keep going. The entire point of the staged plan is that when something breaks, you know
it broke in *this* stage — that only holds if each stage is committed on its own.

---

## Before You Start: One-Time Setup

Do this once, at the very beginning, before Stage 1.1.

1. **Get the design docs into the repo.** Copy `PHASES.md`, `DECISIONS.md`, and this playbook
   into the repo root. Commit them:
   ```
   git add PHASES.md DECISIONS.md CLAUDE_CODE_PLAYBOOK.md
   git commit -m "Add design docs and playbook"
   ```
   Now Claude Code can read them directly — you'll never have to paste the design into chat.

2. **Make a dedicated branch for this whole effort.** This keeps the multi-line rebuild separate
   from your current working code until it's proven.
   ```
   git checkout -b multi-line-build
   ```
   Everything from here happens on `multi-line-build`. Your old branch stays untouched as a
   fallback. (You can name it anything — just be consistent.)

3. **Confirm the game runs and note a baseline.** Start the game, play a WC-only game a few
   years, and screenshot or write down a couple of key numbers (year-3 premium, surplus,
   whatever). This is your Stage 1.2 regression reference — you'll compare against it to prove
   the big refactor didn't change the math.

---

## The Session Rhythm (repeat for every stage)

Each stage follows the same six steps. Once you've done it two or three times it becomes
automatic.

### Step 1 — Open the session with context
Start each Claude Code session by pointing it at the docs and naming the stage. Example:
> Read PHASES.md and DECISIONS.md. We're doing **Stage 1.3** only. Do not start any other
> stage. Show me your plan before you write code.

Asking for the plan first is a cheap safety check — you'll catch "it misunderstood the stage"
before any code is written, not after.

### Step 2 — Let it implement the single stage
Paste (or point to) that stage's prompt from `PHASES.md`. Each stage already has a ready-made
prompt in a code block. Let Claude Code make the changes.

### Step 3 — Run it and test the stage's acceptance criteria
Every stage in `PHASES.md` has a "Test before moving on" line. Actually do it — start the game,
check the specific thing. Don't take "it should work" on faith. If the stage was a refactor
(like 1.2), this is where you compare against your baseline numbers.

### Step 4 — If it's broken, fix in the same session
Describe the problem to Claude Code specifically ("Property premium is using payroll, not TIV —
year 2 shows X but should be roughly Y"). Fix it *before* committing. Never commit a stage you
know is broken — a broken commit defeats the checkpoint's purpose.

### Step 5 — Commit the working stage
Once the acceptance test passes:
```
git add -A
git commit -m "Stage 1.3: wire GL as second coverage line"
```
Use the stage number in every commit message. Later, `git log` reads like your progress
checklist, and if you ever need to undo, you can point at an exact stage.

### Step 6 — Stop
End the session. Take the win. Start the next stage fresh later — a clean session keeps Claude
Code from carrying over stale assumptions.

---

## When a Stage Goes Wrong

**A stage's test fails and a quick fix doesn't work.** You have a clean commit at the end of the
previous stage, so you can always get back to safe ground:
```
git restore .          # throws away uncommitted changes, back to last commit
```
Then restart the stage fresh. Because stages are small, redoing one is a minor loss, not a
disaster — this is the whole payoff of working small.

**A stage reveals the design doc was wrong or incomplete.** This will happen — no plan survives
contact with the code perfectly. When it does: *don't* let Claude Code improvise a big design
decision on its own. Stop, bring the specific question back to a planning chat (like this one),
decide, update `PHASES.md`/`DECISIONS.md`, commit the doc change, then resume. The docs staying
accurate is what makes later stages trustworthy.

**Claude Code wants to "also fix" something outside the stage.** Politely decline: "Just Stage
1.3 for now, note the other thing and we'll handle it separately." Scope creep inside a stage is
how a clean plan turns muddy.

---

## Stage Checklist

Tick these off as you go. Each is one session, one commit. (Stage details and per-stage prompts
live in `PHASES.md` — this is just the running order.)

**Phase 1 — Multi-Line Foundation (the hard gate — do in order)**
- [ ] 1.1 — CoverageLine type + line-selection UI (no engine changes)
- [ ] 1.2 — Restructure state types; **WC-only regression must match baseline exactly**
- [ ] 1.3 — Wire GL as second line
- [ ] 1.4 — Wire Property as third line (TIV exposure)
- [ ] 1.5 — Shared investment pool + cash/bonds/equities allocation
- [ ] 1.6 — Inter-line borrowing

**Phase 2 — Results & Decision Interface (can follow after 1.4)**
- [ ] 2.1 — Pool/line view toggle across pages
- [ ] 2.2 — Decision History page
- [ ] 2.3 — Individual-year comparison view
- [ ] 2.5 — "Effective rate" drives satisfaction (fix to live mechanic — do before Phase 3)
- [ ] 2.4 — Accident-year development view (build alongside/after Stage 3.1)

**Phase 3 — Reserve Development**
- [ ] 3.1 — Accident-year reserve model + per-line development patterns
- [ ] 3.2 — Reserve strategy decision (+ its funding load connecting into Stage 2.5)

**Phase 4 — Shock Events**
- [ ] 4.1 — Event data structure + 2-3 starter events
- [ ] 4.2 — Probability roll + selection (max one/year, hidden odds)
- [ ] 4.3 — Narrative integration
- [ ] 4.4 — Expand event library to full size

**Phase 5 — Per-Claim Simulation**
- [ ] 5.1 — Frequency/severity claim generation (recalibrate to baseline!)
- [ ] 5.2 — Claim reporting (bucket summary + large-claims table)
- [ ] 5.3 — Wire shock event manifestation types into claims

**Phase 6 — Reinsurance Expansion**
- [ ] 6.1 — Occurrence-based reinsurance
- [ ] 6.2 — Experience-rated pricing

**Phase 7 — IRIS Ratios**
- [ ] 7.1 — IRIS 11 and 12
- [ ] 7.2 — IRIS 13

**Later (not blocking)**
- [ ] 4b — Event Library / encyclopedia page

---

## A Few Claude Code Habits Worth Building

- **Ask for the plan before the code** on any non-trivial stage. Cheapest bug-catch there is.
- **Keep sessions focused on one stage.** Fresh session per stage beats one long marathon.
- **Commit messages carry the stage number.** Your `git log` becomes your progress log.
- **You are the tester, not Claude Code.** It can write tests, but you confirm the game actually
  behaves right in the browser — especially the "feel" things a unit test won't catch (does a
  rate hike visibly cost you members? does an aggressive reserve strategy actually show higher
  surplus?).
- **When in doubt about a design choice, stop and bring it to planning.** Building the wrong
  thing correctly is still the wrong thing. The docs are cheap to update; rebuilding a stage is
  less cheap.
