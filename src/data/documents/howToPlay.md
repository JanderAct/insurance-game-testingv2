# How to Play

<!--
Static. Shown in the Introduction tab after the Welcome Memorandum.

CHANGES FROM THE PDF, all corrections to describe what is actually built:
  - Reinsurance moved OUT of "coming later". WC and GL both have per-layer towers plus a WC
    aggregate stop-loss. Only Property still uses the old level selector.
  - Risk control ADDED. It is a live pool-wide decision, 0-8% of premium, and the PDF omits it.
  - Dividends and assessments ADDED. Also live, also omitted.
  - Enrollment standard MARKED not yet active. The controls render but are inert pending the
    experience modifier.
  - Funding rate reworded to name the confidence level explicitly, since the slider now has an
    Expected setting and per-line derived curves.

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

You decide how much of each line's losses to transfer and how much to keep. This works differently
depending on the line.

**Workers' Compensation and General Liability** use a **layer tower**. The Pool keeps the first $1 million
of every claim. Above that, cover is offered in bands, and you choose which bands to buy — declining a band
means keeping that slice of every large claim. Workers' Compensation also offers an **aggregate
stop-loss**, which responds to total annual retained losses rather than any single claim.

**Above the top band, losses return to the Pool.** Reinsurance capacity runs out somewhere, and above that
point the Pool carries the risk whether or not it wants to. This is one of the few exposures no decision
can remove.

**Property** uses a simpler level selector.

The cost of each band rises with how remote it is. A band that pays often costs close to its expected
losses; a band that pays rarely costs several times its expected losses, because the reinsurer is being
paid to hold capital rather than to pay claims.

### Dividends and assessments

You may return surplus to members as a **dividend**, or collect an additional **assessment** from them.

A dividend lowers what members pay this year at the cost of the Pool's cushion. An assessment raises funds
but asks members for money beyond their contributions, which is rarely welcome.

### Investment allocation — Pool-wide

How the Pool's assets are divided among cash, bonds, and equities. A single policy applied across every
line. See the Investment Memorandum for the assumptions, the liquidity requirement, and the tradeoffs.

### Risk control — Pool-wide

You may spend a share of premium on risk control: safety programs, training, loss prevention. This reduces
the losses members actually suffer, but the benefit builds over time rather than arriving immediately, and
the money is spent whether or not it works.

### Enrollment standard — *not yet active*

How selective to be about which applicants and renewals you accept. Tighter standards can improve the
quality of the book but reduce volume — and because Pool membership is drawn from a fixed marketplace,
volume lost is not quickly regained.

*The controls appear but do not yet affect results.*

### Reserving posture — *coming later*

Reserve development is simplified for now.

## How to Read the Reports

**Pool-wide financials** follow standard insurance financial statement conventions: contributions in,
losses and expenses out, with the difference flowing into surplus. There are no shareholders and no profit
motive — surplus exists to protect the Pool's ability to pay claims.

**Per-line financials** break the same statement out by coverage line. If your Pool writes more than one
line, watch for one running hot while another runs cold — the pool-wide numbers alone can hide this.

**Claims exhibits** show recent large losses and how reserves on older claims are developing. Development
that consistently runs adverse is an early sign that a line is priced or reserved too thin.

Some claims are not reported in the year they occur. An injury can happen in one year and surface several
years later, so the Pool sets aside money for claims it knows must exist but has not yet seen.

**Two leverage ratios** are worth tracking every year: contribution to surplus, and reserves to surplus.
Both measure how much the Pool has committed relative to its cushion. A ratio that climbs steadily over
several years is a warning sign even if any single year looked fine.

## A Note on Your Departments

Actuarial, Claims, Underwriting, and Finance will each report their honest best assessment every year.
None of them has complete information, and none of their estimates are certain — reserve estimates move,
trend assumptions get revised, and investment returns can surprise you in either direction.

Their input is a starting point. The decisions, and what follows from them, are yours.
