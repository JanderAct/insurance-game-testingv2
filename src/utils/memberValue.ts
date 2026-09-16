// ============================================================================
// VALUE — WHAT THE MONEY BOUGHT. Two questions, and they have two different
// counterparties, which is why they are two functions and not one with a flag.
//
//   POOL AGAINST MARKET   did the pool return more of my money as claims than a
//                         carrier would have?
//   MEMBER AGAINST POOL   did I get back more or less than the average member?
//
// ============================================================================
// THE POTS ARE LAYERS, NOT CLAIM-SIZE BANDS, AND THAT IS THE FIRST THING TO GET
// RIGHT BECAUSE THE OBVIOUS READING IS WRONG.
//
// A $3M WC claim is not "a tower claim". It puts $1M in the retained pot and $2M
// in the tower, and both are true at once. Funding is per LAYER — poolPremium
// funds the retained band, reinsuranceCost funds the ceded band — so the pots
// that describe who paid have to be layers too. Banding by claim size instead
// would put the whole $3M in one pot and misattribute the $1M the members
// themselves funded.
//
//     tower       what the PLACED layers cede    funded by reinsuranceCost
//     aboveTower  max(x - TOP, 0)                funded by SURPLUS. Nothing else.
//     retained    x - tower - aboveTower         funded by poolPremium
//
// The three sum to x for every claim, exactly, and potsAreExhaustive asserts it.
//
// ⚠ THE TOWER POT IS THE PLACED LAYERS AND NOT THE NOMINAL BAND, which is why
// `retained` is defined by subtraction rather than as min(x, R). A declined layer
// is not charged for and its loss comes back to the members — so that band is
// pool-funded, and a disjoint retained band (decline the middle layer, keep the
// others) is a shape no min/max pair gets right. See potSplit.
//
// ⚠ R IS EACH LINE'S OWN RETENTION AND NOT A FLAT FIGURE. $1M on WC and GL, $5M
// on Property, read from REINSURANCE_TOWER rather than restated. A flat $1M
// would file Property's $1M-$5M range — measured at 31.89% of its gross loss,
// its largest single band — under "paid for by reinsurance" when pool premium
// pays every dollar of it.
//
// ============================================================================
// ⚠ THERE IS NO LOWER BOUNDARY INSIDE THE RETAINED POT, AND IT WAS MEASURED
// RATHER THAN DROPPED ON TASTE. This records a boundary that was proposed,
// tested and rejected, because the next reader will propose it again.
//
// THE PROPOSAL was to split the retained pot at 100k / 100k / 500k — "routine"
// against "serious". THE OBJECTION that killed it is that both sides of that
// line are funded by the same pot of money, so unlike the upper boundaries it
// gives no weight for free: any weight across it is picked.
//
// MEASURED, 12 games x 12 years at defaults. Each sub-layer's loss over the
// line-year's expected loss, rescaled to mean 1, which is exactly what a value
// term reads:
//
//   line      SD lower  SD upper  corr(lo,hi)   corr(hi, unsplit pot)
//   WC          0.107     0.248      0.516            0.968
//   GL          0.236     0.315      0.771            0.979
//   Property    0.177     0.465      0.506            0.978
//
// and then the weight. value(w) = w.index_lo + (1-w).index_hi against the
// UNSPLIT pot index:
//
//   line      w=0.25   w=0.50   w=0.75   w=dollar-natural
//   WC        0.9901   0.9993   0.9456   1.0000  (w=0.455)
//   GL        0.9975   0.9959   0.9613   1.0000  (w=0.363)
//   Property  0.9944   0.9982   0.9396   1.0000  (w=0.426)
//
// AT THE DOLLAR-NATURAL WEIGHT THE SPLIT REPRODUCES THE UNSPLIT POT EXACTLY —
// it must, by construction — and anywhere in the plausible middle it reads
// r >= 0.94. The split only says something new at w -> 1, where the term stops
// being about dollars and starts being about claim counts, and nothing in the
// model derives that w.
//
// ⚠ ONE DERIVATION FOR THE WEIGHT DOES EXIST, AND IT ANSWERS THE WRONG
// QUESTION. The house method for "how much should I trust this number" is
// credibility, and each sub-layer's own reliability could supply it. Measured
// test-retest on the member's three-year ratio — the same statistic the
// experience modifier is built on — the lower layer reads 0.110 on WC and the
// upper reads -0.013. Credibility-weighting would therefore put essentially all
// the weight on the lower layer and none on the upper, which means discarding
// the 55% of retained dollars that sit above 100k. That is the right move for a
// MODIFIER, whose question is how well a member is run and for which a large
// claim is luck. It is the wrong move for VALUE, whose question is what the
// member got back — and a member with a $2M claim paid got $2M. The derivation
// exists, it is sound, and it belongs to the other term.
//
// SO THE RETAINED POT IS ONE POT. If a lower boundary ever returns it needs a
// matching pot of MONEY, not a matching intuition.
//
// ============================================================================
// ⚠ UNCAPPED, AND THE CONTRAST WITH THE EXPERIENCE MODIFIER IS DELIBERATE. The
// next reader will find two per-member loss ratios in this repo and assume one
// is a mistake, so it is written down here.
//
//   memberExperienceMod  divides by EXPERIENCE_SPLIT_POINT-capped primary loss
//                        (sum of min(claim, $25k)). Its question is HOW WELL IS
//                        THIS MEMBER RUN, and for that a large claim is luck
//                        that drowns the signal — see memberLossHistory.ts's
//                        measured split-half reliability for why the cap is
//                        there.
//
//   this file            divides by the FULL layer amount, nothing discarded.
//                        Its question is WHAT DID THE MEMBER GET BACK, and a
//                        member with a $2M claim paid got $2M.
//
// The layer split is not a cap: summed across the three pots every claim is
// counted at its full value, it is merely attributed to the pot that funded it.
//
// ============================================================================
// ⚠ IT FEEDS NOTHING, THE SAME RULING Member.satisfaction CARRIES, AND FOR A
// SHARPER REASON HERE. member-value-check asserts it on a static allow-list.
//
// Measured test-retest correlation of a member's three-year value ratio against
// the SAME member's ratio in the preceding non-overlapping three years, 12 games
// x 12 years:
//
//   line       retained pot   lower layer   upper layer   tower
//   WC            0.007          0.110        -0.013      -0.014
//   GL           -0.016         -0.017        -0.016      -0.012
//   Property      0.024          0.013         0.023       0.004
//
// EVERY ONE OF THOSE IS ZERO TO MEASUREMENT ERROR. That is not a defect in the
// term and it does not need fixing: value is a RETROSPECTIVE REPORT OF FACT, and
// what a member got back last window genuinely does not predict what they get
// back next window. It is a defect in any use of the term that would treat it as
// a property of the member. So the ruling is not "feeds nothing for now" the way
// satisfaction's is — it is that anything acting ON a member must read the
// modifier, which is credibility-weighted and capped precisely because this
// number is not stable.
//
// ⚠ AND THESE FIGURES REPRODUCE THE REPO'S OWN, WHICH IS THE CHECK THAT MAKES
// THEM BELIEVABLE. memberLossHistory.ts records split-half reliability of the
// three-year WC ratio at 0.052 on the whole-loss basis, rising on the capped
// primary basis. Measured here from a different direction the whole retained pot
// reads 0.007 and the sub-$100k layer 0.110 — same ordering, same magnitude,
// independently derived.
//
// ============================================================================
// PURE. NO DRAWS, NO STATE. Everything here is a function of claims that have
// already been generated and of premium figures the engine has already computed,
// so adding it cannot re-phase a seeded stream or move a baseline.
// ============================================================================

import { REINSURANCE_TOWER, TOWER_TOP } from '../data/reinsuranceTower';
import { cedeToLayer, normalizeLayersPlaced } from './reinsuranceTower';
import { MARKET_TARGET_LOSS_RATIO } from './marketConditions';
import type {
  Claim, CoverageLine, MemberPremiumShare, MemberValueRow, PoolValueRow, PotTotals,
} from '../types/simulation';

// Declared in types/simulation.ts and re-exported here, the same arrangement
// SatisfactionMove has: LineResultSet carries these, and a result type importing
// a util would invert the dependency.
export type { MemberValueRow, PoolValueRow, PotTotals };

/**
 * Where the funding source changes for this line.
 *
 * ⚠ READ FROM THE TOWER RATHER THAN RESTATED. The retention is the first layer's
 * attachment and the top is TOWER_TOP, so a change to either moves this with it.
 * Writing $1M / $5M here as literals is how the two go out of step.
 */
export function potBounds(line: CoverageLine): { retention: number; towerTop: number } {
  const layers = REINSURANCE_TOWER[line as keyof typeof REINSURANCE_TOWER];
  const top = TOWER_TOP[line as keyof typeof TOWER_TOP];
  if (!layers?.length || !(top > 0)) {
    throw new Error(`potBounds: no tower for line ${line}`);
  }
  return { retention: layers[0].attachment, towerTop: top };
}

const ZERO: PotTotals = { retained: 0, tower: 0, aboveTower: 0, gross: 0 };

/**
 * One claim, split across the three funding layers. The parts sum to `amount`
 * exactly, whatever the placement.
 *
 * ⚠ THE TOWER POT IS WHAT THE PLACED LAYERS ACTUALLY CEDE, NOT THE BAND BETWEEN
 * THE NOMINAL ATTACHMENT AND THE NOMINAL TOP. A player who DECLINES a layer is
 * not charged for it and keeps the loss in it, so that band is funded by pool
 * premium and belongs in the retained pot — the engine's `poolPremium` already
 * moves the same way, because netPurePremiumPer100 subtracts only the expected
 * cession through the layers actually placed.
 *
 * Getting this wrong would be invisible at default decisions, where every layer
 * is placed and the two readings coincide, and would silently misattribute the
 * whole $4M xs $1M band the moment a player declined it — reporting a member as
 * having been funded by reinsurance that nobody bought.
 *
 * ⚠ AND IT USES THE ENGINE'S OWN cedeToLayer RATHER THAN RE-DERIVING THE
 * ARITHMETIC, so the value term and the cession cannot disagree about what a
 * layer pays. A declined middle layer leaves a DISJOINT retained band, which is
 * the case a hand-rolled `min`/`max` pair gets wrong.
 */
export function potSplit(
  amount: number, line: CoverageLine, layersPlaced?: boolean[],
): PotTotals {
  const { towerTop } = potBounds(line);
  const towerLine = line as keyof typeof REINSURANCE_TOWER;
  const layers = REINSURANCE_TOWER[towerLine];
  const placed = normalizeLayersPlaced(towerLine, layersPlaced);
  const x = Math.max(0, amount);
  let tower = 0;
  layers.forEach((l, i) => {
    if (!placed[i] || !l.purchasable) return;
    tower += cedeToLayer(x, l.attachment, l.limit);
  });
  const aboveTower = Math.max(0, x - towerTop);
  return { retained: x - tower - aboveTower, tower, aboveTower, gross: x };
}

const addPots = (a: PotTotals, b: PotTotals): PotTotals => ({
  retained: a.retained + b.retained,
  tower: a.tower + b.tower,
  aboveTower: a.aboveTower + b.aboveTower,
  gross: a.gross + b.gross,
});

/** Every claim on the line, split and summed. */
export function potTotals(
  claims: readonly Claim[], line: CoverageLine, layersPlaced?: boolean[],
): PotTotals {
  return claims.reduce((acc, c) => addPots(acc, potSplit(c.grossUltimate, line, layersPlaced)), ZERO);
}

/** The same split, kept per member. */
export function memberPotTotals(
  claims: readonly Claim[], line: CoverageLine, layersPlaced?: boolean[],
): Map<string, PotTotals> {
  const out = new Map<string, PotTotals>();
  for (const c of claims) {
    out.set(c.memberId, addPots(out.get(c.memberId) ?? ZERO, potSplit(c.grossUltimate, line, layersPlaced)));
  }
  return out;
}

// ============================================================================
// POOL AGAINST MARKET.
//
// ⚠ THE BRIEF ASKED FOR THIS PER POT AND IT SHIPS AS TWO COMPARISONS PLUS A
// DECOMPOSITION, BECAUSE ONLY TWO OF THE POTS HAVE A COUNTERPARTY TO COMPARE
// AGAINST. This is the same finding as the lower boundary, one level up: a
// boundary earns a comparison only where there is a second price on the other
// side of it.
//
//   THE WHOLE BILL, against a carrier.  A carrier's price is NOT itemised by
//     layer — MARKET_TARGET_LOSS_RATIO's own header puts "its expenses, its
//     profit and its own reinsurance" inside the one 35% load. So there is no
//     carrier price for "the band below $1M" to compare the retained pot
//     against, and inventing one by prorating the target across layers would be
//     a picked number dressed as a decomposition. One bill, one comparison.
//
//     ⚠ AND THE MODEL ITSELF DISPROVES THE PRORATION, WHICH IS WHY THIS IS A
//     MEASUREMENT AND NOT A PREFERENCE. If a target loss ratio really did carry
//     across layers, the reinsurer writing the tower would be pricing to about
//     0.65 as well. It is not: expectedCeded / reinsuranceCost reads 0.539 on
//     WC, 0.646 on GL and 0.456 on Property, because an excess layer is mostly
//     risk load and hardly any expense while a primary layer is the reverse.
//     A single target prorated across the layers would therefore be wrong on
//     both of them, in opposite directions, and would show up as the retained
//     pot flattering the pool by exactly the amount the tower understated it.
//
//   THE TOWER LEG, against the reinsurer. This one IS itemised: reinsuranceCost
//     is separately stated on every member's bill and the counterparty is
//     modelled. Its benchmark is DERIVED, not judged — the tower is priced at
//     E[ceded] + lambda.SD[ceded], so the reinsurer's own implied loss ratio is
//     expectedCeded / reinsuranceCost and nothing has to be picked at all.
//
//   ABOVE THE TOWER has no funding leg, so it has no ratio. It is reported in
//     DOLLARS. A ratio needs a denominator and surplus is not one.
//
// The pot figures below therefore decompose WHERE THE RETURNED MONEY WENT. They
// are a numerator split, and only `valueAgainstMarket` and
// `valueAgainstReinsurer` are comparisons.
//
// ⚠ THE ABOVE-TOWER LOSS IS IN THE NUMERATOR AND NOT IN THE DENOMINATOR, AND
// THAT IS THE MUTUAL SHOWING UP RATHER THAN A LEAK. `returnedPerDollar` divides
// ALL the loss by what the members were BILLED — and no part of the bill funds
// the band above the tower, because surplus does. So a year in which GL keeps
// $40M above its tower reads as unusually good value, and it WAS: the members
// got those dollars back and did not pay for them. Netting the band out of the
// numerator to make the ratio tidy would delete the one thing a pool does that a
// carrier's price cannot: spend accumulated surplus on a member's catastrophe.
// `aboveTowerDollars` is carried separately so a reader can always see how much
// of a good year came from there.
//
// ⚠ ADMIN IS IN THE DENOMINATOR OF THE WHOLE-BILL RATIO AND IS NOT A POT. It
// funds claim HANDLING, not claim payment — which is why the engine charges it
// on gross expected loss even for ceded layers. A member pays it and gets a
// service rather than a loss payment back, so it belongs in what they paid and
// has nothing to appear as on the way out. The carrier's 35% covers its own
// equivalent, so the comparison stays like-for-like.
// ============================================================================

export function poolValueRow(input: {
  line: CoverageLine;
  claims: readonly Claim[];
  poolPremium: number;
  adminExpense: number;
  reinsuranceCost: number;
  /** towerQuote.expectedCeded, in dollars. */
  expectedCeded: number;
  /** The year's layer placement. Undefined means the shipped default: all placed. */
  layersPlaced?: boolean[];
}): PoolValueRow {
  const pots = potTotals(input.claims, input.line, input.layersPlaced);
  const totalMemberCharge = input.poolPremium + input.adminExpense + input.reinsuranceCost;
  const returnedPerDollar = totalMemberCharge > 0 ? pots.gross / totalMemberCharge : 0;
  const towerReturnedPerDollar = input.reinsuranceCost > 0 ? pots.tower / input.reinsuranceCost : 0;
  const reinsurerBenchmark = input.reinsuranceCost > 0 ? input.expectedCeded / input.reinsuranceCost : 0;
  return {
    line: input.line,
    pots,
    totalMemberCharge,
    returnedPerDollar,
    marketBenchmark: MARKET_TARGET_LOSS_RATIO,
    valueAgainstMarket: returnedPerDollar / MARKET_TARGET_LOSS_RATIO,
    towerReturnedPerDollar,
    reinsurerBenchmark,
    valueAgainstReinsurer: reinsurerBenchmark > 0 ? towerReturnedPerDollar / reinsurerBenchmark : 0,
    aboveTowerDollars: pots.aboveTower,
  };
}

// ============================================================================
// MEMBER AGAINST POOL.
//
//     value_i = (loss_i / premium_i) / (loss_pool / premium_pool)
//
// on the RETAINED pot, rebased so the premium-weighted book reads exactly 1. A
// member at 1.4 got back 40% more per premium dollar than the book did.
//
// ⚠ THE TOWER POT IS DELIBERATELY NOT A RATIO HERE, AND THIS IS THE RULING
// RATHER THAN AN OMISSION.
//
// A naive per-member tower ratio says the members who did not have a $1M claim
// were robbed. Measured, 12 games x 12 years, share of members with ZERO tower
// loss over a full three-year window: WC 86.1%, GL 77.7%, Property 97.1%. So the
// naive reading robs between 78% and 97% of the book, every year, forever.
//
// IT IS WRONG BECAUSE THE MEMBER DID NOT BUY A RECOVERY, THEY BOUGHT A LIMIT.
// What the reinsurance line on the bill purchases is that one member's
// catastrophe does not end the pool — and that is delivered in full in every
// year, including and especially the years nobody claims. Scoring it by whether
// the disaster happened marks a service by whether it was needed.
//
// ⚠ AND THE STATISTICS AGREE WITH THE ARGUMENT, WHICH IS WHY IT IS NOT JUST A
// PREFERENCE. The tower pot's member-level test-retest correlation is -0.014 /
// -0.012 / +0.004 — it carries no information about the member at all. A ratio
// that is both unfair and uninformative has nothing to recommend it.
//
// SO THE TOWER IS DISCLOSED, NOT RATED: dollars recovered and whether the member
// reached the layer at all. That answers "what did I get back" truthfully
// without implying the 97% were cheated.
//
// ⚠ AND THERE IS A SECOND REASON NOT TO BUILD THE RATIO, WHICH IS THAT ITS
// DENOMINATOR DOES NOT EXIST. reinsuranceCost is charged to the LINE and the
// model has no per-member allocation of it. Building one would be an invented
// split, and it would be invented in service of a ratio that has already been
// ruled out on its merits.
//
// ⚠ ABOVE THE TOWER IS NOT RATED EITHER, for the same reason it has no pool-side
// ratio: there is no funding leg to divide by.
//
// ⚠ NO MULTI-YEAR WINDOW IS SHIPPED, AND THE REASON IS A BUDGET AND A
// MEASUREMENT AGREEING. A persistent window needs a per-member per-pot field on
// MemberLossYear, and that ledger's own header has costed its remaining room:
// "FIVE IS THE END OF IT THOUGH. At 98.2% the margin is under two points, and
// the sixth number is not a question worth asking." There is one slot left, for
// a term that feeds nothing. AND IT WOULD BUY NOTHING MEASURABLE: the
// three-year window's test-retest correlations in the header are zero on every
// pot, so widening the window does not turn this into a statement about the
// member. The gate computes multi-year windows in memory, which is where the
// question lives until something consumes the term.
// ============================================================================

/**
 * ⚠ THE BOOK'S OWN RATIO IS THE DENOMINATOR, NOT A CONSTANT, so the rows rebase
 * to 1 whatever kind of year it was. A pool having a terrible year does not make
 * every member's value reading high — that is a statement about the pool and it
 * belongs in `poolValueRow`, which is where it is made. This function answers
 * only "against the other members", and member-value-check asserts the rebase.
 *
 * A member with no premium share reads 1 — NEUTRAL, not zero. They cannot be
 * compared to the book on a per-premium basis at all, and the house rule for a
 * missing signal is neutrality, not a penalty: scoring them 0 would say they got
 * nothing back when what is actually true is that the question does not apply.
 */
export function memberValueRows(
  shares: readonly MemberPremiumShare[],
  claims: readonly Claim[],
  line: CoverageLine,
  layersPlaced?: boolean[],
): MemberValueRow[] {
  const byMember = memberPotTotals(claims, line, layersPlaced);
  const pool = potTotals(claims, line, layersPlaced);
  const poolPremium = shares.reduce((s, m) => s + m.premium, 0);
  // The book's retained loss per premium dollar. Zero loss or zero premium makes
  // the comparison undefined, and the neutral answer is 1 — the same
  // missing-signal-is-neutral rule priceSignalFor and satisfactionMoves use.
  const bookRate = poolPremium > 0 && pool.retained > 0 ? pool.retained / poolPremium : 0;
  return shares.map(m => {
    const p = byMember.get(m.memberId) ?? ZERO;
    const own = m.premium > 0 ? p.retained / m.premium : 0;
    return {
      memberId: m.memberId,
      premium: m.premium,
      retainedLoss: p.retained,
      retainedValue: bookRate > 0 && m.premium > 0 ? own / bookRate : 1,
      towerRecovered: p.tower,
      reachedTower: p.tower > 0,
      aboveTowerLoss: p.aboveTower,
    };
  });
}

/**
 * The exhaustiveness identity, exported so the gate asserts it rather than
 * re-deriving it: the three pots sum to the gross loss for every claim.
 */
export function potsAreExhaustive(
  claims: readonly Claim[], line: CoverageLine, layersPlaced?: boolean[],
): boolean {
  const t = potTotals(claims, line, layersPlaced);
  const gross = claims.reduce((s, c) => s + Math.max(0, c.grossUltimate), 0);
  return Math.abs(t.retained + t.tower + t.aboveTower - gross) <= 1e-6 * Math.max(1, gross)
    && Math.abs(t.gross - gross) <= 1e-6 * Math.max(1, gross);
}
