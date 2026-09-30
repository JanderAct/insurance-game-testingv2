# Session table — a provisioning summary

**This note is a summary. `src/session/server/keys.ts` is authoritative.** The design, the write
conditions, the reasons and the full list of what the design makes hard are in that file's header,
next to the functions that build every key. If this note and that file disagree, the file is right
and this note is stale: fix this note.

It is for whoever creates and sizes the table, not whoever writes the handlers.

## The table

One table. One partition per room.

| Key | Value |
|---|---|
| Partition key | `ROOM#<code>` (string) |
| Sort key | `ROOM`, `NAME#<name>`, `D#<teamId>#<yyy>`, `R#<teamId>#<yyy>`, `VIEW#<tokenHash>` (string) |

- **No secondary index.** The handlers do not need one, and must not read through one: every read is
  strongly consistent (below), and a GSI cannot be.
- **TTL on.** Every item carries an expiry attribute, stamped from its room's header. A room is
  ~220 items, so there is no single item to delete.
- **Single region.** Strongly consistent reads hold only in the region that took the write.

## Sizes, ten teams by ten years

| Item | Size | Basis |
|---|---|---|
| Header (`ROOM`) | ~3 KB | estimated from field counts |
| Decisions, per team-year | ~1.05 KB | derived by subtraction from a measured record |
| Result, per team-year | 0.5 KB rising to ~1.0 KB | measured (browser run, via `scripts/tools/poll-cost-report.ts`); years 9–10 extrapolated |
| Whole partition | ~200 KB | derived: the sum |

The measured figures are JSON characters, not DynamoDB item bytes — the same order, not the same
number. The largest item is the header at ~3 KB; the 400 KB item cap is not a concern.

## Capacity

Derived from `poll-cost-report.ts`'s two-hour, ten-team session (11,631 reads, 230 writes, with the
shipped back-off) and the sizes above. **Estimates, not measurements.**

- **Reads dominate by count, not by size.** Most polls find nothing new and cost one small batch get
  of the header (~1–2 read units, strongly consistent). A changed read costs ~3 read units for a
  player and up to ~22 for the host. Order of magnitude: **tens of thousands of read units per
  session**.
- **Writes are two-item transactions**, which bill at twice the standard rate and pay for the whole
  header each time: ~10 write units per write, **a few thousand per session**.
- **Strongly consistent reads are required**, at twice the cost of eventual ones. Do not switch them
  to eventual to save capacity: that reintroduces a lost update (see the module).
- **On-demand billing fits the shape.** A room is a two-hour burst and then idle.

## What capacity cannot fix

A room's writes all touch its header item. When many teams post in the same second — results
arrive in a burst just after each advance — their transactions conflict and retry. **That limit is
per item, not per table: raising capacity does not move it.** It is occasional at 10–12 teams and
sustained at 50+. Team count times burstiness is what breaks first, not years. The module records
the escape hatch.
