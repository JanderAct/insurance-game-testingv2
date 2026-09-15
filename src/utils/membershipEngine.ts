// Membership engine for Risk Pool Simulation v1
// Uses count-based attraction to keep growth realistic

import type { Member, LineDecisionSet, CoverageLine, MembershipHistory, MemberLossHistory } from '../types/simulation';
import { SeededRandom } from './random';
import { canReenroll } from './membershipHistory';
import { appetiteEligible } from './newBusinessAppetite';
import { getMemberExposure } from './lineHelpers';
import { OPENING_SATISFACTION } from '../data/memberCatalog';
import { departureRisks } from './memberDeparture';
import {
  MEMBER_MOVEMENT_WEIGHTS,
  BASE_RETENTION,
  APPLICATION_RATE,
  MAX_NEW_MEMBER_SHARE,
  RATE_NEUTRAL_CHANGE_PCT,
  RATE_NEUTRAL_LOAD,
  RATE_RETENTION_SENSITIVITY,
  RATE_SATISFACTION_SENSITIVITY,
} from '../data/defaultAssumptions';

export interface MemberMovementInputs {
  currentMembers: Member[];
  allMarketMembers: Member[];
  // Authoritative per-line enrollment ledger — the ONLY legitimate source for
  // recruitment eligibility (see the candidate-pool filter below).
  membershipHistory: MembershipHistory;
  // The rolling loss ledger, as it stood entering this year. Departure reads
  // it for each member's experience modifier and its year-over-year change.
  memberLossHistory: MemberLossHistory;
  decisions: LineDecisionSet;
  line: CoverageLine;
  currentMemberSatisfaction: number;
  currentRiskQuality: number;
  surplus: number;
  annualPremium: number;
  priorYearLossRatio?: number;
  // % change in this line's TOTAL MEMBER CHARGE RATE per $100 vs last year.
  // Null when there is no usable prior rate — see priceSignalFor.
  rateChangePct?: number | null;
  // This line's total member charge rate over its pure premium rate. Null when
  // the pure premium is not positive.
  rateLoad?: number | null;
  competitivePressure: number;
  /**
   * DIAGNOSTIC SEAM. Overrides APPLICATION_RATE for one call.
   *
   * ⚠ THE ENGINE NEVER SETS THIS AND THE UI CANNOT REACH IT. It exists so
   * new-business-appetite-derive can sweep the rate over whole played games and
   * report where short years actually begin, rather than computing the answer
   * from acceptance shares and calling arithmetic a measurement. The rate is a
   * single scalar with no other input, so a sweep is the only way to see its
   * effect on a book that responds to it — and re-deriving the constant is
   * exactly what this seam is for. Same precedent as the injected clock on
   * createSaveScheduler.
   */
  applicationRateOverride?: number;
  memberSensitivity: number;
  yearNumber: number;
  calendarYear: number;
  rng: SeededRandom;
}

export interface MemberMovementResult {
  activeMembers: Member[];
  newMembers: Member[];
  withdrawnMembers: Member[];
  // ⚠ THE THREE INTAKE COUNTS, RECORDED BECAUSE WITHOUT THEM "THE POOL CAME UP
  // SHORT" IS NOT OBSERVABLE FROM OUTSIDE. newMembers.length is the only thing
  // a result used to carry, and it is min(demand, cap, eligible) — three
  // different constraints collapsed into one number, so a year limited by a
  // strict bar looks exactly like a year nobody wanted to join. These separate
  // them: `intakeRoom` is what the pool had space for after demand and both
  // caps, `applicantCount` is how many applied, `eligibleCount` how many
  // cleared the bar. Short ⟺ eligibleCount < intakeRoom.
  intakeRoom: number;
  applicantCount: number;
  eligibleCount: number;
  retentionRate: number;
  memberSatisfaction: number;
  averageRiskQuality: number;
  activeExposure: number;
  totalMarketExposure: number;
}

// --- the price signal, in the two forms the three sites need ----------------
//
// NULL HANDLING, one rule for both. A missing signal means NEUTRAL — deviation
// exactly 0, no penalty and no bonus — never a default of "zero rate change",
// which is a different and wrong thing on a line whose neutral is not zero.
// Treating a null as a literal 0% change on a line whose neutral is not zero
// would read as a rate CUT of the neutral's size and hand out a bonus for
// missing data. GL is the live example now (neutral +1.26%); Property used to
// be the striking one at +4.83% and then +4.10%, but its netting re-measured
// it to -0.21% — essentially flat, which is what a line with no frequency
// trend, no severity trend and a non-inflating exposure base should read.
//
// In practice null is nearly unreachable: runPriorHistory simulates three
// pre-game years through this same engine, so lineState.ratePer100 is already
// populated when year 1 runs — measured 30/30 line-instances with a prior rate
// in year 1, on every line. The branch exists for a save restored mid-stream or
// a line switched on late, not for the normal opening.
function priceSignalFor(inputs: MemberMovementInputs): {
  changeDeviationPct: number;
  levelDeviationPct: number;
} {
  const neutralChange = RATE_NEUTRAL_CHANGE_PCT[inputs.line] ?? 0;
  const neutralLoad = RATE_NEUTRAL_LOAD[inputs.line] ?? 0;

  const changeDeviationPct = inputs.rateChangePct === null || inputs.rateChangePct === undefined
    ? 0
    : inputs.rateChangePct - neutralChange;

  const levelDeviationPct = inputs.rateLoad === null || inputs.rateLoad === undefined || neutralLoad <= 0
    ? 0
    : (inputs.rateLoad / neutralLoad - 1) * 100;

  return { changeDeviationPct, levelDeviationPct };
}

function calcRetentionProbability(inputs: MemberMovementInputs): number {
  const { decisions, currentMemberSatisfaction, surplus, annualPremium, priorYearLossRatio } = inputs;

  const satisfactionImpact = (currentMemberSatisfaction - 5.0) / 5.0 * 0.03;
  const surplusRatio = surplus / Math.max(annualPremium, 1);
  const financialImpact = Math.min(0.02, Math.max(-0.02, (surplusRatio - 0.6) / 30));
  const dividendImpact = decisions.dividendPct * 0.20;
  const assessmentPenalty = decisions.assessmentPct * 0.15;
  // rateIncreasePenalty RECONNECTED. Reads the derived rate change — this
  // year's total member charge rate per $100 against last year's — measured
  // as a DEVIATION from this line's own neutral, because at defaults the
  // neutral is not zero and differs per line (see RATE_NEUTRAL_CHANGE_PCT).
  //
  // PENALTY ONLY: a cut below neutral earns nothing back here. Members notice
  // increases; the goodwill from a cut runs through satisfaction instead.
  const { changeDeviationPct } = priceSignalFor(inputs);
  const rateIncreasePenalty = Math.max(0, changeDeviationPct) * RATE_RETENTION_SENSITIVITY;
  const poorResultPenalty = priorYearLossRatio
    ? Math.max(0, priorYearLossRatio - 0.85) * 0.05
    : 0;

  const W = MEMBER_MOVEMENT_WEIGHTS.retention;
  const adjustment =
    W.satisfaction * satisfactionImpact
    + W.financialStrength * financialImpact
    + W.dividend * dividendImpact
    - W.assessmentPenalty * assessmentPenalty
    - W.rateIncreasePenalty * rateIncreasePenalty
    - poorResultPenalty;

  return Math.max(0.80, Math.min(0.99, BASE_RETENTION + adjustment));
}

// ============================================================================
// ⚠ prospectCaptureRate AND baseNewMembers ARE DELETED. THE BOOK NO LONGER HAS
// A TARGET.
//
// They solved a capture rate k from MEMBERSHIP_EQUILIBRIUM_ENROLLMENT by
// requiring expected joins to equal expected departures at N* = 63:
//
//     k = (N* x d - adj) / (roster - N*)
//
// which made the book a quantity the model STEERED TOWARD rather than an
// outcome. Every measurement taken against that system — that growth was
// unreachable at any cap, that intake ran 2.6/yr against withdrawals of
// 2.65-2.94 — was a measurement of the target, not of the mechanism.
//
// WHAT REPLACES IT: nothing on the demand side. Intake is now entirely supply:
// a share of the unenrolled marketplace applies, the appetite bar filters them,
// and everyone who clears is written up to the capacity guard. Departures stay
// proportional to the book. The two flows cross where
//
//     APPLICATION_RATE x (roster - N)  =  N x (1 - retention)
//
// and that crossing is an OUTCOME of two independent rates rather than a
// constant. A book that settles there is two flows meeting; a book that settles
// at 63 would mean something is still steering, which is the discriminator
// new-business-appetite-derive reports against.
//
// ============================================================================
// ⚠ AND THE PRICE CHANNEL INTO RECRUITMENT IS DARK FROM THIS COMMIT. Ruled
// deliberately, not overlooked.
//
// newMemberAdjustment below carried price, satisfaction, surplus, assessment
// and risk-control into the join count. Its scale is in MEMBERS PER YEAR —
// absolute, and netted against k so that all-defaults came out neutral — so it
// cannot be reused as a multiplier on an application rate without being
// re-measured from scratch. Re-measuring it against a system that is still
// moving would mean measuring it twice.
//
// So it is retired here and returns with the market derivation, which
// satisfaction needs anyway. AT DEFAULTS THE LOSS IS NEAR ZERO — the price term
// reads levelDeviationPct, which is ~0 at defaults — but A PLAYER WHO PRICES
// LOW NO LONGER ATTRACTS MEMBERS, and that is a live lever going dark for a
// commit. Named here so it is restored rather than rediscovered.
// ============================================================================

// ⚠ newMemberAdjustment AND calcExpectedNewMembers ARE DELETED WITH THE TARGET.
// See the block above for why the ladder cannot simply be re-pointed at the
// application rate, and for what goes dark in the meantime.
//
// ⚠ AND THE DELETION TOOK TWO CONSTANTS WITH IT THAT THE PLAN DID NOT NAME.
// MEMBER_MOVEMENT_WEIGHTS.attraction (six weights) and RATE_LEVEL_SENSITIVITY
// had this ladder as their ONLY engine consumer. Both are now dormant: still
// exported, still rendered on the Calculation Audit page, acting on nothing.
// They are kept as data because they return with the market derivation, and
// they are marked dormant at their definitions rather than left to read as
// live. MEMBER_MOVEMENT_WEIGHTS.retention is untouched — departure still reads
// it, and that is the half of the object that still does work.

function updateSatisfaction(
  current: number,
  decisions: LineDecisionSet,
  changeDeviationPct: number,
): number {
  let delta = 0;
  // The rateChange satisfaction term RECONNECTED, reading the same derived rate
  // change the retention term reads, as a deviation from this line's neutral.
  //
  // SYMMETRIC here, unlike retention: satisfaction is a slow-moving stock
  // clamped to [1, 10], and a penalty-only form would ratchet it downward at
  // defaults on rate noise alone. Letting it move both ways keeps it centred on
  // its starting value when the pool prices at its neutral.
  delta -= changeDeviationPct * RATE_SATISFACTION_SENSITIVITY;
  delta += decisions.dividendPct * 10.0;
  delta -= decisions.assessmentPct * 8.0;
  // NEUTRALISED — coefficient set to 0, not sign-flipped. This term zeroed at
  // the old fundingConfidenceLevel default (0.75); the new default is 0.60
  // (CLF-only pricing), so it started contributing -0.075 satisfaction/yr at
  // defaults (-0.225/yr at the 30% floor) — and backwards: charging members
  // LESS was making them UNHAPPIER. Two reasons it goes to 0 rather than
  // getting its sign corrected: the 0.75 reference point is now arbitrary
  // since the default moved to 0.60, and this whole term is being replaced by
  // bill-based satisfaction (Economics Step 1 / Stage 2.5). A term with an
  // arbitrary anchor and an uncalibrated magnitude is better dormant than
  // wrong.
  delta += (decisions.fundingConfidenceLevel - 0.75) * 0;
  return Math.max(1.0, Math.min(10.0, parseFloat((current + delta).toFixed(1))));
}

// ⚠ THE STRICTNESS TERM IS DELETED, AND AT THE SHIPPED DEFAULT IT WAS ZERO.
// This carried `(underwritingStrictness - 5) * 0.04`, a direct nudge to the
// pool's average risk quality from a slider position. The slider defaulted to
// 5, so the term was exactly 0 in every default game — which is why removing
// it moves no baseline. It goes with the slider.
//
// What remains is the honest part: the average moves because WHO IS ENROLLED
// changed, blended at half the new members' share of the book.
function updateRiskQuality(
  current: number,
  newMembers: Member[],
  allActiveMembers: Member[],
): number {
  const newMemberAvgQuality = newMembers.length > 0
    ? newMembers.reduce((s, m) => s + m.riskQuality, 0) / newMembers.length
    : current;
  const blendedQuality = current
    + (newMemberAvgQuality - current) * (newMembers.length / Math.max(allActiveMembers.length, 1)) * 0.5;
  return Math.max(1.0, Math.min(10.0, parseFloat(blendedQuality.toFixed(1))));
}

export function simulateMemberMovement(inputs: MemberMovementInputs): MemberMovementResult {
  const { currentMembers, allMarketMembers, line, yearNumber, calendarYear, rng } = inputs;

  const totalMarketExposure = allMarketMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);

  // ⚠ MAX_WITHDRAWN_PER_YEAR IS DELETED, AND IT WAS A GROWTH ACCELERATOR.
  // Departures are PROPORTIONAL — book x (1 - retention) — and the cap was a
  // FLAT COUNT of 4. At a 62-member book expected departures are 2.76 and the
  // cap only clipped the noise tail; at 120 members they are 5.34 and the cap
  // would have bound almost every year, suppressing ~1.3 departures annually.
  // The brake weakened exactly as it was needed most, so the first growth arm
  // measured would have run away and it would have looked like the intake model
  // doing it.
  //
  // ⚠ NO SHARE CAP REPLACES IT, AND THAT IS A DECISION. A share cap on the
  // outflow would be the right FORM if a cap were wanted, but there is nothing
  // to cap: retention is already clamped to [0.80, 0.99] in
  // calcRetentionProbability, so departures cannot exceed 20% of the book in
  // any year however bad it gets. The noise multiplier is bounded at 1.6. A
  // second bound on top of a bounded quantity would only mask the first.
  const retentionProb = calcRetentionProbability(inputs);
  const expectedWithdrawals = currentMembers.length * (1 - retentionProb);
  const cappedWithdrawalCount = Math.min(
    currentMembers.length,
    Math.round(expectedWithdrawals * rng.range(0.4, 1.6)),
  );

  // ============================================================================
  // WHO LEAVES. The COUNT is above (calcRetentionProbability, which reads the
  // pool-wide rate increase, dividends, assessments and surplus); this is the
  // SELECTION, and it is the member's own decision rather than the pool's.
  //
  // Sorted DESCENDING — highest departure risk leaves — which is the opposite
  // of the key this replaced. See memberDeparture.ts for the model, for the
  // measurements that condemned the old one, and for why marketability's
  // scale is derived from the clamp rather than chosen.
  //
  // ⚠ THE OLD KEY READ riskQuality DIRECTLY AND THIS ONE DOES NOT. Departure
  // now runs on the experience modifier, which is something the member can
  // actually see in their own claims and their own bill. Risk quality reaches
  // this decision only through the losses it generates, which is the whole
  // difference between an economic mechanism and a psychic one.
  // ============================================================================
  const risks = new Map(
    departureRisks(
      currentMembers, line, inputs.memberLossHistory,
      priceSignalFor(inputs).changeDeviationPct, rng,
    ).map(r => [r.memberId, r.risk]),
  );
  const membersSortedByLeaveRisk = [...currentMembers].sort(
    (a, b) => (risks.get(b.id) ?? 0) - (risks.get(a.id) ?? 0)
  );

  const withdrawnMembers: Member[] = membersSortedByLeaveRisk
    .slice(0, cappedWithdrawalCount)
    .map(m => ({ ...m, status: 'withdrawn' as const, yearWithdrawn: yearNumber }));
  const withdrawnIds = new Set(withdrawnMembers.map(m => m.id));
  // ⚠ PER-MEMBER SATISFACTION IS NOT COMPUTED HERE AND THAT IS THE POINT.
  // It lived in this function for one commit and moved out at the convex
  // rebuild, to processLineYear, AFTER the charged rate exists. Two reasons,
  // and the second is the one that forced it:
  //
  //   THE BASIS. This function is fed the PRE-MOVEMENT QUOTE, which is the
  //     right signal for retention and departure — a member decides whether to
  //     renew on what they were quoted. Satisfaction is about the bill they
  //     actually PAID, and the two differ by a measured +0.9 to +1.1pp a year on
  //     every line, because the book grows between the quote and the charge and
  //     spreads the tower cost over more exposure.
  //
  //   A CONVEX REACTION CANNOT CARRY A SYSTEMATIC OFFSET. Under the linear form
  //     a permanent +1pp read as a small constant drift. Squared, it shifts the
  //     whole distribution into the amplified region and compounds.
  //
  // It also makes "feeds nothing" STRUCTURAL rather than asserted: movement
  // cannot read a quantity that does not exist until after movement has run.
  const retainedMembers = currentMembers.filter(m => !withdrawnIds.has(m.id));

  // ============================================================================
  // INTAKE IS SUPPLY, NOT DEMAND. There is no expected-new-members term left.
  //
  // Everyone who applies and clears the appetite bar is written, up to the
  // capacity guard. The book is then an OUTCOME of three independent flows —
  // who applies, who clears, who leaves — rather than a number steered toward.
  //
  // ⚠ THE DEMAND NOISE DRAW IS GONE TOO, AND REMOVING A DRAW IS WHY THE
  // BASELINES MOVE. `Math.round(expectedNew * rng.range(0.3, 1.7))` consumed one
  // draw from the shared line stream every year; nothing multiplies now, so the
  // draw goes rather than being spent and discarded. Intake variance comes from
  // WHICH members apply — binomial through the bar — which is real variance
  // rather than a multiplier on a point estimate.
  //
  // ⚠ AND THE CONFINEMENT IS STRUCTURAL, NOT HOPEFUL. The rng handed to this
  // function is `deriveSubRng(seed, yearNumber, lineRngLabel('members', line))`
  // — its own stream, hashed from a purpose label, with simulateMemberMovement
  // as its only consumer (simulationEngine's single `rng: memberRng` call site).
  // Adding or removing a draw here cannot re-phase any other stream, because no
  // other stream is this one. Member-level claim draws are separately keyed on
  // (seed, year, memberId), which enrolment-independence-check asserts.
  //
  // So the baselines move through exactly one channel: WHICH MEMBERS ARE
  // ENROLLED. Not through re-phased claim draws, not through development, not
  // through investment returns. Every moved figure should trace to a different
  // book, and anything that does not would be the finding.
  // ============================================================================
  const intakeRoom = Math.floor(currentMembers.length * MAX_NEW_MEMBER_SHARE);

  // Candidate-pool eligibility reads EXCLUSIVELY from membershipHistory,
  // NEVER from Member.status. The shared status field is fold-corrupted
  // across lines (one status per member, folded sequentially per line, so a
  // member withdrawn from a later-processed line while active in an earlier
  // one reads 'withdrawn' — CALIBRATION_FINDINGS 2/5) and cannot answer the
  // per-line question "may this member (re-)enroll in THIS line?". The
  // ledger is per-line by construction: canReenroll is true for a member
  // never enrolled in this line, false while its interval is open (which
  // also blocks same-year re-entry after a withdrawal — the ledger is
  // updated in processYear AFTER this movement, so a just-withdrawn member
  // still reads as enrolled here), and true again only once the 2-year
  // per-line cooldown from the most recent withdrawal has elapsed.
  const activeIds = new Set(retainedMembers.map(m => m.id));
  const availableMembers = allMarketMembers.filter(
    m => !activeIds.has(m.id) && canReenroll(inputs.membershipHistory, m.id, line, yearNumber)
  );

  // ⚠ THE UNDERWRITING-STRICTNESS SCREEN WAS HERE AND IS DELETED. Above
  // strictness 6 this sorted the candidate pool by riskQuality DESCENDING and
  // kept the top 60% — exact selection on the hidden truth, at zero
  // information cost. Risk quality is no longer shown to the player anywhere
  // per-member, and a lever that selects perfectly on an attribute the UI
  // does not admit exists is worse than no lever: it is strictly better than
  // the experience modifier meant to replace it, which ranks true risk
  // quality at 0.332 rather than at 1.0. Hiding the attribute without
  // retiring this branch would have made the modifier pointless.
  //
  // ⚠ AND THE SHUFFLE IS NOW UNCONDITIONAL, WHICH IS A KEEP-THE-DRAW
  // STATEMENT. The old code shuffled ONLY on the else branch, so a game at
  // strictness > 6 consumed no shuffle at all. Every default game already
  // took the else branch (the slider defaulted to 5), so the stream is
  // unchanged for them — which is why both baselines still hold across this
  // deletion. A game saved at strictness > 6 would draw differently, and
  // there is no such game: the field is gone from the decision set.
  // ============================================================================
  // NEW BUSINESS APPETITE — the tier filter, and it runs BEFORE the shuffle.
  //
  // RANDOM AMONG ELIGIBLE, NOT BEST-FIRST. Filter to who clears the standard,
  // then shuffle, then take the cap off the top. Best-first would collapse every
  // tier into the cap — at "accept everyone" the pool would still take the best
  // four and a tighter tier would barely differ. See newBusinessAppetite.ts.
  //
  // ⚠ AT THE DEFAULT (null) appetiteEligible RETURNS A COPY AND FILTERS NOTHING,
  // so the pool handed to the shuffle is the same length it has always been and
  // consumes the same draws. That is what keeps both baselines holding across
  // this commit. Any other tier shortens the pool and diverges the stream, which
  // is correct: it is a different decision.
  // ============================================================================
  // ============================================================================
  // WHO APPLIES, THEN WHO CLEARS THE BAR, THEN WHO GETS WRITTEN. Three steps,
  // and the first one is new.
  //
  // ⚠ APPLICATIONS ARE A SHARE OF THE UNENROLLED POOL, NOT THE WHOLE OF IT.
  // Every unenrolled member used to be treated as an applicant every year —
  // ~140 of them for 4 slots — which is why New Business Appetite could only
  // ever change WHICH members joined and never HOW MANY. See APPLICATION_RATE.
  //
  // ⚠ ONE SHUFFLE, AND IT IS OVER THE FULL AVAILABLE POOL, WHICH IS WHAT KEEPS
  // THE DRAW STABLE. Shuffling `availableMembers` and then taking a prefix is
  // the same draw the old code made, so at Accept All the members selected are
  // IDENTICAL to before this commit — take the first 9 and then the first 3 of
  // those, and you have the first 3. It also means the appetite tier no longer
  // perturbs the RNG stream at all: every arm shuffles the same array to the
  // same order, and only the filter downstream differs. Comparing two tiers is
  // therefore comparing two decisions on one game rather than two games.
  //
  // ⚠ THE APPLICATION COUNT IS DETERMINISTIC AND THE VARIANCE IS IN WHO APPLIES.
  // A noisy count would need its own draw and would move every downstream
  // stream; it is not needed. With ~9 applicants and roughly a third clearing
  // the strict bar, the number eligible is already binomial with a standard
  // deviation near 1.4, which is where short years come from.
  // ============================================================================
  const shuffledPool = [...availableMembers];
  rng.shuffle(shuffledPool);

  const applicationCount = Math.min(
    shuffledPool.length,
    Math.round(shuffledPool.length * (inputs.applicationRateOverride ?? APPLICATION_RATE)),
  );
  const applicants = shuffledPool.slice(0, applicationCount);

  // The bar. Order is preserved, so the survivors are still in shuffled order
  // and taking a prefix of them is random-among-eligible.
  const candidatePool = appetiteEligible(
    applicants, line, inputs.memberLossHistory, yearNumber,
    inputs.decisions.newBusinessAppetite ?? null,
  );

  const newMembers: Member[] = candidatePool.slice(0, Math.min(intakeRoom, candidatePool.length)).map(m => ({
    ...m,
    status: 'active' as const,
    yearJoined: yearNumber,
    calendarYearJoined: calendarYear,
    // ⚠ SAME ONE DRAW, NARROWER RANGE — see OPENING_SATISFACTION. Changing the
    // BOUNDS of an rng.range consumes exactly the same value from the stream
    // and maps it differently, so the whole membership stream is untouched and
    // both baselines hold. Removing the draw and using the catalog's
    // deterministic disposition would have been tidier and would have re-phased
    // every member draw after it.
    //
    // ⚠ AND TWO DECIMALS, MATCHING THE STOCK. The old one-decimal rounding here
    // was fine for a frozen field; on a stock whose yearly moves are hundredths
    // it would quantise a joiner's opening onto a coarser grid than the thing
    // it feeds.
    satisfaction: parseFloat(rng.range(OPENING_SATISFACTION.min, OPENING_SATISFACTION.max).toFixed(2)),
  }));

  const activeMembers: Member[] = [...retainedMembers, ...newMembers];
  const activeExposure = activeMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);

  const retentionRate = currentMembers.length > 0
    ? retainedMembers.length / currentMembers.length
    : 1;

  const newSatisfaction = updateSatisfaction(
    inputs.currentMemberSatisfaction, inputs.decisions, priceSignalFor(inputs).changeDeviationPct,
  );
  const newRiskQuality = updateRiskQuality(inputs.currentRiskQuality, newMembers, activeMembers);

  return {
    activeMembers,
    newMembers,
    withdrawnMembers,
    intakeRoom,
    applicantCount: applicants.length,
    eligibleCount: candidatePool.length,
    retentionRate,
    memberSatisfaction: newSatisfaction,
    averageRiskQuality: newRiskQuality,
    activeExposure,
    totalMarketExposure,
  };
}
