# Session table — a provisioning summary

**This note is a summary. `src/session/server/keys.ts` is authoritative.** The design, the write
conditions, the reasons and the full list of what the design makes hard are in that file's header,
next to the functions that build every key. If this note and that file disagree, the file is right
and this note is stale: fix this note.

It is for whoever creates and sizes the table, not whoever writes the handlers.

## What the console asks for

None of these can be changed after the table exists.

| Console field | Enter | Type |
|---|---|---|
| Table name | `ripple-sessions` | — |
| Partition key | `pk` | String |
| Sort key | `sk` | String |
| TTL attribute (enable TTL after creation) | `expiresAtSec` | Number, **epoch seconds** |

The handler reads the table name from the `TABLE_NAME` environment variable and never hard-codes it.

## The keys: attribute names and value formats are two different things

The console asks what the key attribute is **called**. That is `pk` or `sk`. It does not ask for
the values below, which the handlers write into those attributes. **Do not type `ROOM#<code>` into
the console.**

| Attribute | Type | Value format | Item |
|---|---|---|---|
| `pk` | String | `ROOM#<code>` | every item of a room |
| `sk` | String | `ROOM` | the room header |
| `sk` | String | `NAME#<team name>` | a team name's claim |
| `sk` | String | `D#<teamId>#<yyy>` | one team's decisions for one year |
| `sk` | String | `R#<teamId>#<yyy>` | one team's result for one year (`000` is the opening position) |
| `sk` | String | `VIEW#<tokenHash>` | one viewer |

`<yyy>` is always three digits, so the sort order holds past year 99.

- **No secondary index.** The handlers do not need one, and must not read through one: every read is
  strongly consistent (below), and a GSI cannot be.
- **Single region.** Strongly consistent reads hold only in the region that took the write.

## TTL

- **The attribute is `expiresAtSec`, a Number, in epoch SECONDS.** A value stamped in milliseconds —
  the unit the rest of this codebase's timestamps use — reads as tens of thousands of years away, and
  nothing is ever deleted. A duration stored in place of a timestamp reads as 1970 and expires at once.
- **One write sets it and every other write copies it.** `createRoom` sets the header's value once
  (creation time in seconds, plus the retention period). Every later write copies the header's value
  verbatim onto the item it writes. A result posted in year 10 carries the same expiry as the header
  written two hours earlier, so the room expires as one rather than in pieces.
- **The retention period is not decided yet.** Unlike the attribute name, it can change later, for
  new rooms.
- **TTL deletes in the background, well after the expiry, item by item.** The handlers therefore treat
  a room as gone once its header's expiry has passed, whether or not TTL has removed it yet.

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

**The planned event is inside that range.** The AWS owner's guide plans for 140 players: 25 to 45
teams at three to six a team. That sits between "occasional" and "sustained", and nothing in between
has been measured. At that size the escape hatch may not be optional. Settle it before the session,
not during it.
