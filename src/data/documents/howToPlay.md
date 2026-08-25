# How to Play

<!--
Static. Shown in the Introduction tab after the Welcome Memorandum.

CHANGES FROM THE PDF, all corrections to describe what is actually built:
  - Reinsurance moved OUT of "coming later". ALL THREE LINES are per-occurrence layer towers.
    The old level selector is gone everywhere — REINSURANCE_PROGRAMS and reinsuranceEngine.ts
    were retired once Property got its own tower. WC and Property carry an aggregate stop-loss
    on top, conditional on having placed an occurrence layer; GL has none.
  - Risk control ADDED. It is a live pool-wide decision, 0-8% of premium, and the PDF omits it.
  - Dividends and assessments ADDED. Also live, also omitted.
  - Underwriting strictness DESCRIBED AS LIVE, and an earlier revision of this document was WRONG
    to mark it "not yet active pending the experience modifier". The field is underwritingStrictness
    (0-10, default 5) and it has THREE live channels in membershipEngine.ts: the join-count
    adjustment (+0.8 at <=2, +0.3 at <=4, -0.4 at >=8), the candidate screen (>6 sorts the available
    field by risk quality and keeps the top 60%; otherwise it shuffles), and updateRiskQuality's
    direct (strictness - 5) * 0.04 nudge. It changes both HOW MANY join and WHO.
  - Inter-line loan ADDED. loanRepaymentAggressiveness is a live per-line decision and neither it
    nor the loan itself appeared in any earlier revision.
  - IBNR PARAGRAPH REMOVED. It described claims reported years after they occur; IBNR went with WC's
    report lag at the IBNER cutover and nothing defers reporting now. Replaced with what actually
    happens — claims are known immediately, their COST estimate develops.
  - Reserving moved OUT of "coming later". IBNER is live and the funding slider IS the reserving
    posture (ibnerBookingBias = 0.80 * max(0, 1 - selectedFundingCLF)).
  - Funding rate reworded to name the confidence level explicitly, since the slider now has an
    Expected setting and per-line derived curves.
  - Departments list aligned to DepartmentsPage: Actuarial, Claims, Underwriting, INVESTMENT — not
    Finance, which is not a department the page ships.
  - Liquidity reference qualified. The Investment Memorandum marks its liquidity sections as planned
    and not built, and this document pointed at them as though they were live.

Narrative framing (the yearly cycle, the departments) is deliberately light here — the Welcome
Memorandum carries it. This document is the mechanical reference.
-->

Your Pool has been created. Before your first decision, here is how the game itself works.

## The Yearly Cycle

Every year in Ripple follows the same sequence:

1. **Review the reports.** Standing financials, claims activity, reserve development, investment results,
   and any notable events from the year just closed.
2. **Make your decisions** for the coming year.
3. **Advance the year.** The simulation generates the year's outcomes — new business written, claims
   incurred, reserves developed, investments returned — and reports back.
4. **Repeat**, for as many years as you selected at setup.

There is no single score to chase. The challenge is balancing affordable coverage for your members against
the Pool's long-term solvency. A shorter game rewards decisions that pay off quickly; a longer game gives
slow-moving consequences — reserve development, member attrition, a thin reinsurance program — the time
they need to surface.

## The Decisions You Make

Only the coverage lines you selected at setup will appear. Some decisions are set per line; others apply
to the Pool as a whole.

### Funding confidence, by line

Rather than adjusting price by a percentage, you set how confident you want to be that a line's
contributions will cover its losses. Losses vary — some years run light, some run heavy — and your
confidence level is the share of years in which the contributions collected should prove sufficient.

Each line has its own curve, because each line's losses behave differently. A more volatile line needs a
higher percentile to reach the same economic point, which is why **Expected** — funding at exactly the
loss you expect — sits at a different place on each line's slider.

Funding above Expected builds margin against a bad year. Funding below it improves affordability and
leaves the Pool exposed.

### Reinsurance, by line

You decide how much of each line's losses to transfer and how much to keep. Every line works the same way:
a **layer tower** sitting above a retention the Pool keeps on every claim.

The Pool keeps the first slice of each claim itself — **$1 million on Workers' Compensation and General
Liability, $5 million on Property**. Above that, cover is offered in bands, and you choose which bands to
buy. Declining a band means keeping that slice of every large claim.

- **Workers' Compensation** — three bands, reaching $50 million.
- **General Liability** — three bands, reaching $25 million.
- **Property** — a single band, reaching $75 million.

**Above the top band, losses return to the Pool.** Reinsurance capacity runs out somewhere, and above that
point the Pool carries the risk whether or not it wants to. This is one of the few exposures no decision
can remove. It bites hardest on General Liability: the market for excess liability cover stops at $25
million and General Liability's severity does not, so everything above that band is retained without limit.

**Workers' Compensation and Property also offer an aggregate stop-loss**, which responds to total annual
retained losses rather than to any single claim. It is conditional on the tower beneath it — buy no bands
and the aggregate cannot be bought either, because with no per-claim layer capping each loss, a single
claim could consume the whole aggregate limit on its own. General Liability has no aggregate offered.

The cost of each band rises with how remote it is. A band that pays often costs close to its expected
losses; a band that pays rarely costs several times its expected losses, because the reinsurer is being
paid to hold capital rather than to pay claims.

### Dividends and assessments

You may return surplus to members as a **dividend**, or collect an additional **assessment** from them.

A dividend lowers what members pay this year at the cost of the Pool's cushion. An assessment raises funds
but asks members for money beyond their contributions, which is rarely welcome.

### Loan repayment, by line

If a coverage line ends a year with negative surplus, the Pool's other lines may offer to cover the
shortfall. This is a real transfer of invested assets from the lending lines, not an accounting entry —
and the offer only exists if the other lines can fund the whole deficit without going negative themselves.
If they cannot, no offer is made and the line simply carries its deficit. An assessment is the other way
out.

Once a line carries a loan, you set how aggressively it repays: the share of that line's positive net
income diverted to debt service each year. A line with no net income repays nothing regardless of the
setting, and no repayment can exceed what the line actually holds in cash and investments.

The balance accrues interest at the Pool's own blended investment return, floored at zero — the lending
lines are made whole for the return they gave up, and never less than whole. Repaying fast clears the
interest but starves the borrowing line's own surplus; repaying slowly leaves the debt compounding against
it.

### Investment allocation — Pool-wide

How the Pool's assets are divided among cash, bonds, and equities. A single policy applied across every
line. See the Investment Memorandum for the assumptions and the tradeoffs. Note that the liquidity
requirement it describes is planned rather than in effect — no liquidity constraint or early-sale cost is
currently applied to your allocation.

### Risk control — Pool-wide

You may spend a share of premium on risk control: safety programs, training, loss prevention. This reduces
the losses members actually suffer, but the benefit builds over time rather than arriving immediately, and
the money is spent whether or not it works.

### Underwriting strictness, by line

How selective to be about which applicants you accept, on a scale of 0 to 10. This is a real trade of
volume against quality, and it works on both sides at once.

**Fewer join when you are strict.** A loose standard attracts entities that a stricter Pool would turn
away; a tight one turns them away. The effect is not symmetric — loosening buys more volume than
tightening costs.

**But the ones who do join are better.** Above a strictness of 6 the Pool stops taking applicants as they
come and screens them, considering only the better half of the available field. Below that it accepts from
the whole field without sorting. Strictness also nudges the book's average risk quality directly, up or
down from the neutral setting of 5.

Because Pool membership is drawn from a fixed marketplace, volume lost is not quickly regained — an entity
that goes elsewhere is not available again immediately. A tight standard compounds slowly in your favour
through quality and slowly against you through size.

### Reserving — you have already set it

There is no separate reserving control, and there is not going to be one, because you have already made
the decision somewhere else.

An accident year's true cost is not known when the year closes. The Pool books an estimate and that
estimate develops for several years as the claims mature — moving up in some years, down in others, and
settling only once the year has run off. Older lines take longer: Workers' Compensation claims can still
be moving a decade later, while Property settles within a few years.

**Your funding confidence level is your reserving posture.** Funding a line below break-even does not only
collect less money; it books the year's losses optimistically to match. The claims are unchanged — the
Pool has simply recorded them low, and the difference comes back as adverse development in later years,
after the saving has already been banked. Funding at or above break-even books the year honestly and
carries no such correction.

This is why development is worth watching even in a year that looks calm. It is the delayed half of a
decision you made earlier.

## How to Read the Reports

**Pool-wide financials** follow standard insurance financial statement conventions: contributions in,
losses and expenses out, with the difference flowing into surplus. There are no shareholders and no profit
motive — surplus exists to protect the Pool's ability to pay claims.

**Per-line financials** break the same statement out by coverage line. If your Pool writes more than one
line, watch for one running hot while another runs cold — the pool-wide numbers alone can hide this.

**Claims exhibits** show recent large losses and how reserves on older claims are developing. Development
that consistently runs adverse is an early sign that a line is priced or reserved too thin.

The Pool knows about its claims as they happen — what it does not know is what they will finally cost. A
serious injury or a liability suit is reported immediately and then takes years to resolve, and the
reserve carried against it is an estimate that gets revised as it does. That revision is what the
development columns show.

**Two leverage ratios** are worth tracking every year: contribution to surplus, and reserves to surplus.
Both measure how much the Pool has committed relative to its cushion. A ratio that climbs steadily over
several years is a warning sign even if any single year looked fine.

## A Note on Your Departments

Actuarial, Claims, Underwriting, and Investment will each report their honest best assessment every year.
None of them has complete information, and none of their estimates are certain — reserve estimates move,
trend assumptions get revised, and investment returns can surprise you in either direction.

Their input is a starting point. The decisions, and what follows from them, are yours.
