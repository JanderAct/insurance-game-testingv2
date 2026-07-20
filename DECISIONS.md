# Decision Impact Map

Every decision a player can make, what it actually touches mechanically (grounded in the real
engine code where it exists today), and — the important part — how it ripples into *other*
outcomes beyond its obvious one. Nothing in this game is a single input → single output; almost
every decision shows up in at least 3-4 places, often with a delay.

**Status tags:** 🟢 = live in the current codebase today. 🔵 = designed in the phase plan, not
yet built.

---

## 1. Quick Reference

| Decision | Level | Status | Direct Mechanical Effect | Core Tradeoff |
|---|---|---|---|---|
| Rate change | Per line | 🟢 | Sets the charged premium rate | Growth/retention vs. revenue |
| Underwriting strictness | Per line | 🟢 | Filters new-member risk quality | Growth speed vs. book quality |
| Risk control % | Per line | 🟢 | Spend that slowly reduces future expected losses | Cash now vs. lower losses later |
| Reinsurance level | Per line | 🟢 (basis expands 🔵) | Sets retention/attachment, cost, and recovery | Cost vs. protection from tail losses |
| Funding confidence level (CLF) | Per line | 🟢 | Loads a risk margin into the charged rate | Price competitiveness vs. pricing safety margin |
| Dividend % | Per line | 🟢 (moves to per-line 🔵) | Returns cash to members | Member goodwill vs. surplus growth |
| Assessment % | Per line | 🟢 (moves to per-line 🔵) | Charges members extra, above premium | Fast cash vs. member goodwill |
| Reserve strategy | Per line | 🔵 | Sets carried reserve vs. indicated reserve | Reported surplus now vs. future adverse-development risk |
| Asset allocation (cash/bonds/equities) | Pool | 🔵 | Blends investment return/volatility | Growth potential vs. stability |
| Loan repayment aggressiveness | Per line (conditional) | 🔵 | % of net income used to pay down an inter-line loan | Faster debt payoff vs. faster surplus rebuild |
| Authorize inter-line loan | Per line (event-triggered) | 🔵 | Zeroes out a negative line surplus | Debt + interest vs. a visibly deficient line |
| Reinsurance basis (aggregate/occurrence/combined) | Per line | 🔵 | Changes *how* reinsurance responds to losses | Broad protection vs. large-claim protection vs. cost |

---

## 2. Decision Detail

### Rate Change 🟢
**Mechanism:** Multiplies `rateLevel`, which directly sets the premium rate charged per
exposure unit. Does **not** change expected losses (`purePremiumPer100` evolves independently,
driven only by loss trend and risk control) — rate change is purely a pricing lever, not a loss
lever.

**Immediate effects:** Higher rate → more premium revenue this year → more cash → (via the
investment sweep) more invested assets → more investment income next year.

**Second-order effects:**
- A rate increase directly reduces member satisfaction (`delta -= rateChange * 5.0`) and
  directly reduces retention if positive (`rateIncreasePenalty`) — the pain is proportional to
  the increase.
- Large rate increases (>8-15%) actively reduce the number of new members joining; rate
  decreases attract more.
- Because retention/growth this year sets next year's exposure base, an aggressive rate hike
  can shrink the pool, which shrinks *future* premium even at a higher rate — a real risk of
  pricing yourself out of members.

**Interacts with:** Assessment % and dividend % also move satisfaction/retention — they can
offset or compound a rate change's member-relations impact in the same year.

---

### Underwriting Strictness 🟢
**Mechanism:** At strictness > 6, the new-member candidate pool is filtered to only the top 60%
by risk quality before anyone is admitted. Also directly nudges the pool's average risk quality
each year (`strictnessAdjustment = (strictness - 5) * 0.04`).

**Immediate effects:** Higher strictness → fewer, better-quality new members. Lower strictness
(≤2-4) → more new members, unfiltered quality, faster growth.

**Second-order effects:**
- Better average risk quality lowers each member's loss coefficient of variation in the Gamma
  loss model — meaning **lower loss volatility pool-wide**, not just lower average losses. A
  high-quality book doesn't just cost less, it's more *predictable*, which matters for reserve
  strategy and capital planning.
- Slower growth from high strictness means a smaller exposure base, which caps how fast premium
  (and therefore surplus) can grow, independent of pricing decisions.

**Interacts with:** Risk control % — both push in the same long-run direction (lower loss
volatility) but through different channels: underwriting selects *who* is in the pool, risk
control changes *how* existing members perform.

---

### Risk Control % 🟢
**Mechanism:** Costs `poolPremium × riskControlPct` immediately (a direct expense, hits
underwriting income now). Builds `riskControlEffectiveness` gradually over a multi-year lag
(`RISK_CONTROL_PARAMS.lagYears`), which then reduces `purePremiumPer100` — i.e., **lowers future
expected losses**, not this year's.

**Immediate effects:** Reduces this year's underwriting income by the spend amount. No
loss-reduction benefit yet.

**Second-order effects:**
- If spending drops to near zero, effectiveness doesn't just stop growing — it **decays twice as
  fast** as normal decay. This makes risk control a genuine multi-year commitment: starting and
  stopping is worse than a steady moderate spend.
- Once effectiveness builds up, it compounds: lower expected losses → lower pure premium → lower
  charged rate for the same funding confidence → more price-competitive without a "rate cut"
  decision at all.
- A small satisfaction/growth bump exists directly (≥5% spend → +0.2 expected new members) on
  top of the loss-reduction pathway.

**Interacts with:** Reserve strategy (🔵) — a pool that's invested heavily in risk control and
seeing effectiveness pay off can reasonably run a less conservative reserve strategy, since its
loss trend is genuinely improving, not just being underestimated.

---

### Reinsurance Level 🟢 (basis expands 🔵 in Phase 6)
**Mechanism:** Sets the attachment point / structure via `getReinsuranceStructure`, which
determines `reinsuranceCost` (an expense, hits underwriting income every year) and
`reinsuranceRecovery` (reduces net losses, only matters in a bad year). Lower reinsurance levels
(more self-funded) get a **discount off the notional cost** of the retained layer
(`SELF_FUNDED_DISCOUNT_PCT`) — cheaper on average, but the pool absorbs more of a bad year itself.

**Immediate effects:** Higher reinsurance level → higher recurring cost every year, win or lose.
Lower level → cheaper most years, more exposed in a bad year.

**Second-order effects:**
- This is the primary lever against **surplus volatility**, not average cost. A pool that's
  thinly capitalized (or has taken an inter-line loan, 🔵) has a much stronger reason to buy more
  reinsurance even though it costs more on average — it's insurance against needing another loan.
- 🔵 Once experience-rating is live (Phase 6), a bad loss year raises the *cost* of reinsurance
  for the next ~2 years regardless of what level you pick next — meaning a bad year's
  consequences don't end when the year does.
- 🔵 Once occurrence reinsurance and per-claim data exist, the *basis* chosen (aggregate vs.
  occurrence vs. combined) determines whether a single huge claim gets caught at all — an
  aggregate-only program can let one catastrophic claim through untouched if the *year's total*
  losses aren't extreme, even though that one claim was.

**Interacts with:** Shock events (🔵) — a `multipleLargeClaims`-type event (wildfire/earthquake)
specifically tests whether occurrence coverage exists; a broad economic/legislative event tests
the aggregate layer instead. The "right" reinsurance basis depends partly on which categories of
shock risk you're most worried about, which the player can't fully know in advance (odds are
hidden) — this is a genuine risk-management judgment call, not a solvable optimization.

---

### Funding Confidence Level (CLF) 🟢
**Mechanism:** Looked up via `lookupCLF`, this multiplies the actuarial expected loss rate into
the *charged* rate (`rateAtConfidenceLevelPer100 = purePremium × CLF × pricingAdjustment`).
Higher CLF = pricing built around a more conservative (less likely to be exceeded) loss
estimate — a genuine actuarial safety margin, not a markup.

**Immediate effects:** Higher CLF → higher premium charged, independent of `rateChange` (these
are two separate levers on the same final price — one actuarially justified, one purely
commercial).

**Second-order effects:**
- A small satisfaction boost exists above CLF 0.75 — counterintuitively, *some* members reward a
  well-funded, safely-priced pool rather than only punishing higher cost. But this is a much
  smaller effect than the direct cost increase, so in practice CLF still trades safety for
  competitiveness.
- Because CLF only affects the *charged rate*, not the *booked reserves* (reserves are driven by
  actual incurred losses, not CLF), a low CLF doesn't understate your liabilities — it just means
  you're pricing closer to the expected outcome with less cushion built in if experience runs bad.

**Interacts with:** Reserve strategy (🔵) — CLF is the pricing-side safety margin; reserve
strategy is the reserving-side safety margin. A pool could theoretically run a low CLF (thin
pricing) but a conservative reserve strategy (thick reserving) — worth watching for that
inconsistency as a "bad combination" pattern in the game's feedback.

---

### Dividend % 🟢 (per-line 🔵)
**Mechanism:** Direct expense (`dividends = poolPremium × dividendPct`), reduces underwriting
income and cash/investments dollar-for-dollar. In return, boosts retention (weighted
`dividendImpact`) and satisfaction (`+10.0 × dividendPct`, the single largest satisfaction lever
in the model).

**Immediate effects:** Lower surplus growth this year, in exchange for member goodwill.

**Second-order effects:**
- Since satisfaction and retention feed next year's exposure base, dividends are really an
  investment in *future* premium volume, paid for with *current* surplus — the payoff is
  delayed and indirect.
- 🔵 Per-line dividends mean a line with strong current-year performance can reward its members
  even while another line in the same pool is struggling — realistic, but also means the player
  needs to resist paying a dividend from a line that's building toward needing an inter-line
  loan next year.

**Interacts with:** Inter-line loans (🔵) — declining to borrow leaves a line's surplus negative,
which should block that line's dividend next year (already specified in the phase plan) — so a
dividend decision this year has to account for whether the line might need its surplus cushion
imminently.

---

### Assessment % 🟢 (per-line 🔵)
**Mechanism:** Direct extra charge on top of premium (`assessments = poolPremium ×
assessmentPct`), immediately boosts cash. In return, meaningfully hurts satisfaction (`-8.0 ×
assessmentPct`), retention (`assessmentPenalty`), and new-member attraction (sharply, above 5-15%).

**Immediate effects:** Fast cash injection, at a real member-relations cost.

**Second-order effects:**
- This is the "emergency lever" — good for shoring up a shortfall *this year*, but the damage to
  satisfaction and growth persists and compounds if used repeatedly or aggressively.
- 🔵 It's explicitly *not* the same tool as an inter-line loan: assessment raises money from
  members (a real cost to them), while a loan borrows from the pool's own other lines (a cost to
  future net income via repayment skim). A player facing a shortfall genuinely has two different
  tools with different victims — members vs. future-line-surplus — worth making visible as a
  real choice, not just two paths to the same number.

**Interacts with:** Reserve strategy — a line running Aggressive reserves that then needs an
assessment to cover a shortfall is a visible "the bill came due" pattern the game should surface
clearly, since it directly demonstrates the aggressive-reserve tradeoff discussed in Tier 3.

---

### Reserve Strategy 🔵 (Phase 3)
**Mechanism:** A per-line preset (aggressive/moderate/conservative/very conservative) sets
`carriedReserve` as a multiplier on the actuarially indicated reserve (structured as a
confidence-level lookup, per the phase plan, so it can later become a continuous slider).

**Immediate effects:** Lower carried reserve (Aggressive) → higher reported surplus *this year*,
since less is booked as a liability. Higher carried reserve → lower reported surplus now, more
cushion against future bad news.

**Second-order effects:**
- This is the single biggest lever on **IRIS ratios 11/12/13** — an aggressive strategy makes
  adverse development (when it inevitably shows up on some accident year) look larger relative
  to a thinner surplus base, more likely to trip the ~20%-of-surplus "unusual" flag.
- Interacts directly with shock events: a legislative/medical event biases *existing open
  cohorts'* development toward adverse for several years — a pool already running thin reserves
  going into that event has much less room to absorb the additional adverse push before hitting
  a capital adequacy warning or needing an inter-line loan.
- A string of good years can make an aggressive strategy look "correct" for a while, since nothing
  has forced a correction yet — this is intentional: the game should let players feel
  temporarily rewarded for a risky choice before the consequence surfaces, since that's the real
  dynamic reserve adequacy misjudgment has in practice.

**Missing link this doc originally omitted — reserve strategy → member satisfaction:** a more
conservative reserve strategy raises the funding requirement, which loads into the *indicated
rate*, which raises the members' actual bill — and a higher bill should reduce satisfaction and
retention, exactly like a rate increase does. The game does **not** model this today, because
`updateSatisfaction()` reacts only to the `rateChange` *decision*, not to the members' effective
bill. See the "Effective rate" note below — closing this gap is the intended design.

**Interacts with:** CLF (see above), dividend % (a line that just took an adverse development hit
under an aggressive strategy probably shouldn't simultaneously be paying a big dividend), and
inter-line loans (thin reserves are a leading indicator of needing one).

---

### ⚠️ Cross-cutting fix — "Effective rate" drives satisfaction (intended design)
**The gap:** satisfaction/retention today respond only to *decision inputs* — `rateChange`,
`dividendPct`, `assessmentPct`, `fundingConfidenceLevel` — not to what members actually end up
paying. So anything else that moves the bill (a reserve funding load, a reinsurance cost
increase, future experience-rating) currently has **zero** effect on satisfaction, even though a
real member's bill went up.

**The intended fix:** route satisfaction/retention off a derived **effective rate change** —
this year's total member charge per exposure unit vs. last year's — so every bill-moving
mechanic reaches members through one realistic channel instead of needing bespoke wiring each.

**Build order (two steps):**
1. *Early (fix to a live mechanic, before Phase 3):* reroute `updateSatisfaction`/retention to
   respond to effective rate change, tested against the inputs that already move the bill today
   (rate change, CLF, reinsurance cost).
2. *Phase 3:* reserve strategy's funding load feeds the indicated rate, which now flows through
   step 1 automatically — no new satisfaction wiring needed.

**Tabled (revisit before building Phase 3's reserve funding load) — direction decided, math open:**
- How the reserve funding requirement translates into the bill (multiplier? additive load?
  itemized vs. baked in?).
- Whether effective-rate satisfaction *replaces* or *layers on top of* the existing
  `rateChange` → satisfaction link.
- Exactly which components the "effective bill" includes.

---

### Asset Allocation (Cash / Bonds / Equities) 🔵 (Phase 1.5, pool-level)
**Mechanism:** Replaces the old single risk slider with three blended components — cash (low
return, low volatility), bonds (moderate), equities (higher expected return, higher volatility,
occasional downside) — combined per the player's allocation percentages. Income is shared across
the pool's investment portfolio, then allocated back to each line by its contribution share.

**Immediate effects:** More equities → higher expected investment income, but more variance
year-to-year (including real risk of a down year). More cash/bonds → lower, steadier income.

**Second-order effects:**
- Because investment income feeds every line's surplus, a bad equities year during the *same*
  year as a bad loss year (or a shock event) compounds — two sources of surplus pressure landing
  together. This is a real correlated-risk lesson: investment risk and underwriting risk aren't
  independent from the player's perspective even though they're mechanically separate systems.
- A pool sitting close to a capital-adequacy threshold has a much stronger reason to hold more
  cash/bonds — not because equities are "bad," but because the pool can't afford the downside
  variance right now. This mirrors real insurer investment policy (surplus adequacy drives asset
  allocation conservatism), and is a good teaching moment.

**Interacts with:** Reinsurance level and reserve strategy — all three are ultimately different
levers on the same underlying question ("how much volatility can this pool absorb"), just
applied to different risk sources (claims tail, reserve adequacy, investment markets).

---

### Inter-Line Loan Authorization & Repayment Aggressiveness 🔵 (Phase 1.6)
**Mechanism:** Triggered automatically when a line's ending surplus is negative. Player chooses
to authorize (pool lends at that year's realized investment return rate, fixed at origination)
or decline (line carries negative surplus forward, dividend blocked, capital-adequacy/IRIS flags
raised). If authorized, a separate `loanRepaymentAggressiveness` decision (0-100%) determines
what share of that line's future positive net income goes to debt paydown vs. that line's own
surplus growth.

**Immediate effects:** Authorizing brings the line back to zero immediately, at the cost of future
income and an unfavorable-if-badly-timed interest rate (locked to whatever the pool's investment
return happened to be that year).

**Second-order effects:**
- High repayment aggressiveness clears the debt fast but effectively freezes that line's own
  surplus growth (and likely blocks its dividend, since there's little income left after the
  skim) for longer than a low-aggressiveness approach would, even though the total interest paid
  is lower.
- The rate being locked at *origination* means a loan taken during a weak investment year is
  cheap; a loan taken right after a strong investment year is expensive — timing (partly outside
  the player's control) matters as much as the borrowing decision itself.
- Declining to borrow is not "safe" — a negative surplus line still shows up on every capital
  adequacy and IRIS view as deficient, likely worse optically than a loan would be, so declining
  is really "absorb the reputational/regulatory hit instead of the debt," not a free option.

**Interacts with:** Every other per-line decision on that line, since a line carrying a loan (or
recovering from declining one) has less financial slack for a rate cut, a dividend, extra
reinsurance, or risk control spend — the loan (or its refusal) becomes a real constraint on every
other lever for that line until resolved.

---

### Reinsurance Basis (Aggregate / Occurrence / Combined) 🔵 (Phase 6)
**Mechanism:** Adds *how* reinsurance responds, on top of *how much* (`reinsuranceLevel`).
Occurrence basis tests each individual claim against a retention/limit; aggregate tests the
year's total; combined applies occurrence first, then aggregate on the remainder.

**Immediate effects:** No direct cost difference is implied by basis alone (cost still comes from
`reinsuranceLevel` + experience rating) — this decision is about *shape* of protection, not price
by itself, though in a fuller market model different bases would likely price differently.

**Second-order effects:**
- Directly determines what shows up in the large-claims table (Phase 5/6): under
  occurrence/combined, a single giant claim gets its own retained/ceded/uncovered breakdown;
  under aggregate-only, that same claim's cost is invisible except as part of the year's total.
- This is where the Property line's earthquake risk becomes concrete: a `multipleLargeClaims`
  earthquake event with no occurrence coverage could sail through an aggregate program mostly
  unnoticed if the year's total isn't extreme, then turn up as a nasty surprise later if a second
  bad thing happens the same year and the *combined* total finally breaches the aggregate
  attachment.

**Interacts with:** Shock event manifestation types (🔵) — `multipleLargeClaims` events are the
direct stress-test for whether the basis choice was right.

---

## 3. Cross-Effect Matrix

Rows = decisions. Columns = outcomes they touch. **↑/↓** = direction of effect if the decision is
increased. **(delayed)** = effect shows up in a later year, not the year it's made.

| Decision | Premium | Expected Losses | Loss Volatility | Reserves / IRIS | Reinsurance Cost | Investment Income | Surplus | Growth | Satisfaction |
|---|---|---|---|---|---|---|---|---|---|
| Rate change | ↑ | — | — | — | — | ↑ (via cash) | ↑ | ↓ | ↓ |
| Underwriting strictness | — | — | ↓ (delayed) | — | — | — | — | ↓ | — |
| Risk control % | — | ↓ (delayed) | ↓ (delayed) | — | — | — | ↓ now, ↑ later | ↑ slight | — |
| Reinsurance level | — | — | ↓ | ↑ | — | — | steadier | — | — |
| CLF | ↑ | — | — | (pricing-side margin only) | — | — | ↑ cushion | — | ↑ slight |
| Dividend % | — | — | — | — | — | ↓ (less to invest) | ↓ | ↑ (delayed) | ↑ |
| Assessment % | ↑ | — | — | — | — | ↑ (via cash) | ↑ | ↓ | ↓ |
| Reserve strategy | — | — | — | ↑↓ directly | — | — | ↑↓ directly | — | — |
| Asset allocation | — | — | — | — | — | ↑ return & ↑ variance (equities) | more/less steady | — | — |
| Loan repayment aggressiveness | — | — | — | — | — | — | ↓ near-term, faster debt-free | — | — |
| Reinsurance basis | — | — | ↓ for large claims specifically | — | (shape, not amount) | — | steadier vs. large claims | — | — |

---

## 4. Illustrative Causal Chains

These are the multi-step "why did that happen" stories the game should be able to tell, since
they're what make a single-year number make sense in context.

**Chain A — the assessment spiral:**
Line takes a bad loss year → surplus drops → player levies an assessment to shore it up (instead
of a loan) → satisfaction and retention drop → next year, fewer members and slower growth → same
fixed costs spread over a smaller exposure base → rate per member effectively needs to rise to
cover it → further satisfaction pressure. A single bad year, handled with assessments repeatedly,
can shrink a line rather than just costing it money.

**Chain B — risk control payoff delay:**
Player commits to risk control spending → underwriting income dips for several years with no
visible benefit → effectiveness finally builds past the lag threshold → pure premium starts
falling → charged rate can drop *without* a rate-change decision, or funding confidence can rise
at the same charged rate → member satisfaction improves from a lower bill, growth improves →
virtuous cycle, but only visible to a player who didn't quit funding it in year 2 out of
impatience.

**Chain C — aggressive reserves meets a shock event:**
Line runs Aggressive reserve strategy for several quiet years → reported surplus looks strong →
a legislative shock event fires, biasing that line's open cohorts adverse for the next few years
→ IRIS 11/12 both trip since the surplus base the ratio is measured against was already thin from
running aggressive → capital adequacy status drops to Thin/Deficient → line surplus goes negative
→ player faces the loan-vs-assessment choice, worse-positioned than a Moderate-strategy line
would have been facing the same event.

**Chain D — investment allocation correlated with underwriting risk:**
Player leans heavily into equities for growth → the same year, a catastrophe shock event fires on
Property → if it's also a down year for equities, the line absorbs both a claims hit *and* a
weak investment income contribution simultaneously → surplus falls further than either shock
alone would predict → underscores that "diversifying" investment risk away from underwriting risk
doesn't happen automatically just because they're different mechanical systems — the player has
to actively choose a more conservative allocation if they want that protection.

---

## 5. What This Means for Game Feedback / UI

Given how tangled these chains are, the game's narrative and results views (Phase 2, Phase 4.3)
should lean toward connecting decisions to outcomes explicitly where the causal distance is more
than one step — e.g., "Retention fell this year, largely due to the assessment levied last year
combined with this year's rate increase" is a more useful sentence than just reporting the
retention number. This is really an argument for the **Decision History + Individual-Year
comparison + narrative engine** (Phase 2/4) all pulling from the same underlying causal
relationships listed above, rather than each view describing outcomes in isolation.
