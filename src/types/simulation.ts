// Core TypeScript types for Risk Pool Simulation v1

// Type-only, and circular with shocks.ts (which imports CoverageLine and Region
// from here). Erased at compile time, so the cycle never reaches the bundle.
import type { ScheduledShock, ShockRecord } from './shocks';

export type MemberStatus = 'active' | 'withdrawn' | 'prospect';
export type MemberType =
  | 'City'
  | 'County'
  | 'Fire District'
  | 'Water District'
  | 'Transit Authority'
  | 'School District'
  | 'Park District'
  | 'Recreation District'
  | 'Special District';

export type SizeCategory = 'Small' | 'Medium' | 'Large' | 'Very Large';

// Geographic region, an authored canonical-roster column since v2 (replacing a
// synthetic 1-5 draw). Three regions, assigned 72 / 61 / 67 across the roster.
export type Region = 'North' | 'Central' | 'South';

export interface Member {
  id: string;
  name: string;
  type: MemberType;
  sizeCategory: SizeCategory;
  // Geographic region — an authored column of the canonical roster (v2), never
  // re-rolled per game seed. Feeds WC's regional severity multiplier and is
  // scaffolding for future regional loss correlation (catastrophes striking a
  // region), which is what Property's generator will want.
  region: Region;
  // Property's location schedule, both authored roster columns since v3.
  // `locations` is the integer count of insured sites and is the attritional
  // frequency base (1,866 pool-wide) — a physical fact about the member, NOT
  // derived from insured value. `primaryAssetShare` is the fraction of the
  // member's TIV sitting in its DESIGNATED PRIMARY ASSET — which is not
  // necessarily its largest: for 9 v3 members the nominal primary is the
  // smaller site. Together they chop member TIV into per-location values,
  // which is what caps each claim's severity and keeps the per-risk
  // reinsurance layer alive (it fires on within-member concentration, not on
  // member-level TIV skew).
  locations: number;
  primaryAssetShare: number;
  exposureByLine: Partial<Record<CoverageLine, number>>; // exposure units, per coverage line
  // LOSSY display convenience, NOT an enrollment record. Opening enrollees are
  // stamped yearJoined: 1 ("was here when the game started" — the display
  // convention the members table wants) even though they actually enrolled at
  // the start of the pre-game (ledger startYear: -2). Consequently at Y1 a
  // genuine Y1 recruit and an opening member both read yearJoined: 1 and are
  // indistinguishable by this scalar alone — only PoolState.membershipHistory
  // can separate them. Do NOT "repair" this field to the true year (it would
  // surface pre-game internals in the UI) and do NOT answer per-line/per-year
  // enrollment questions from it — use the ledger.
  yearJoined: number; // yearNumber when joined
  calendarYearJoined: number;
  riskQuality: number; // 1-10
  satisfaction: number; // 1-10
  status: MemberStatus;
  yearWithdrawn?: number;
}

export interface MemberSegment {
  type: MemberType;
  count: number;
  totalExposure: number;
  averageRiskQuality: number;
  averageSatisfaction: number;
}

export interface MemberLossResult {
  memberId: string;
  memberName: string;
  exposure: number; // exposure units for the line this loss was simulated on
  riskQuality: number;
  expectedLoss: number;
  coefficientOfVariation: number;
  standardDeviation: number;
  simulatedLoss: number;
}

// ---------------------------------------------------------------------------
// Claim / Occurrence scaffolding for the loss-distribution work.
//
// TYPE SCAFFOLDING ONLY: nothing constructs, stores, or consumes these yet —
// no generation logic, no processLineYear wiring, no reinsuranceEngine
// involvement. They exist so the claim-level loss generator being designed
// against the WC/GL distribution spec has a settled data shape to target.
// ---------------------------------------------------------------------------

// One loss event. Groups the claims it causes (a single event can produce
// several claims — GL's abuse batches are the first multi-claim user; WC
// emits 1:1; Property's weather/cat events reuse the same shape), and
// is the unit the $1M retention waterfall nets against: the retention
// applies to the OCCURRENCE total, i.e. the sum over claimIds.
export interface Occurrence {
  id: string;
  line: CoverageLine;
  // WHO THE EVENT HIT. memberIds is the authoritative list and is ALWAYS
  // populated (length >= 1). memberId is a single-member convenience field,
  // present only when the event hit exactly one member.
  //
  // DO NOT "SIMPLIFY" memberId BACK TO A REQUIRED string. Its optionality is
  // load-bearing, not stylistic. tsconfig sets strict: true, so memberId reads
  // as `string | undefined` and the COMPILER forces every consumer to handle
  // the multi-member case explicitly rather than silently attributing a
  // pool-wide event to one member. Weather is the first genuinely multi-member
  // occurrence: GL's abuse batches are multi-CLAIM but single-member, and that
  // distinction is exactly what this shape exists to keep visible.
  memberId?: string;
  memberIds: string[];
  accidentYear: number;   // yearNumber the event happened (pre-game years negative)
  calendarYear: number;
  // For a single-member event, that member's region. For a multi-member
  // hazard event, the ZONE the event struck — the correlation unit itself,
  // not a property of any one member.
  region: Region;
  isCatastrophe: boolean; // part of a regional/pool-wide catastrophe event
  claimIds: string[];     // every claim this event produced (WC: exactly one)
  // The hazard band this event belongs to, for lines that have more than one:
  // Property emits 'attritional' | 'weather' | 'cat'. Absent on WC and GL,
  // which have a single hazard band each — their sub-coverage vocabulary lives
  // on Claim.tier and is a rating class, not a peril. Deliberately a string,
  // for the same reason Claim.tier is.
  peril?: string;
  // The event's realized hazard intensity, where the band draws one (weather,
  // cat). Unitless and band-specific: it is the driver that scales BOTH the
  // event's footprint and its damage severity, so it is recorded to make that
  // shared dependence externally checkable. Absent where no such draw exists.
  intensity?: number;
}

export type ClaimStatus = 'open' | 'closed' | 'reopened';

// A catastrophic claim's payment stream. Lifetime-care claims are not a single
// severity draw — they are decades of inflating medical payments plus wage
// indemnity to retirement. Stored NOMINAL (first-year payment plus the
// escalation rate and duration of each leg) so Phase 3 reserving can consume
// the real schedule rather than re-deriving it. The medical and indemnity legs
// escalate at different rates on purpose.
//
// The claim's booked grossUltimate is the PRESENT VALUE of this stream, not
// its nominal sum — see WC_LOSS_MODEL.catastrophicDiscountRate for why this
// one tier is discounted before Phase 3.
export interface ClaimAnnuity {
  medicalFirstYearPayment: number;
  medicalInflationPct: number;
  medicalYears: number;
  indemnityAnnualPayment: number;
  indemnityInflationPct: number;
  indemnityYears: number;
}

// One claim within an occurrence.
export interface Claim {
  id: string;
  occurrenceId: string;
  memberId: string;
  line: CoverageLine;
  accidentYear: number;   // yearNumber (pre-game years negative)
  calendarYear: number;
  // Sub-coverage / rating tier the claim falls under: a WC_CLASS_MIX class
  // (clerical / publicWorks / police / fire) for WC, a GL_RELATIVITIES
  // sub-line (general / epl / lawEnforcement / abuse) for GL, a peril label
  // for Property. Deliberately a string, not a union — the tier vocabularies
  // belong to the distribution work.
  tier: string;
  // The rating class the claim arose from (WC: clerical/publicWorks/police/
  // fire). Kept alongside tier because WC severity depends on both.
  ratingClass?: string;
  status: ClaimStatus;
  reportedYear: number;   // yearNumber the claim became known (>= accidentYear; supports IBNR vs case)
  grossUltimate: number;  // current estimate of the claim's full gross cost
  paidToDate: number;
  caseReserve: number;    // unpaid estimate on this claim (grossUltimate - paidToDate once reported)
  // Fractions of grossUltimate expected to be paid in years 1..n after the
  // accident year (A7). Data for Phase 3 reserving — nothing consumes it yet.
  // Absent on catastrophic claims, which carry `annuity` instead.
  paymentPattern?: number[];
  annuity?: ClaimAnnuity;
  // --- WC payout components (medical / indemnity / impairment) -------------
  // A PURE DECOMPOSITION of grossUltimate: the three sum to it to the cent on
  // every WC claim. Stored rather than recomputed because the engine already
  // derives medical and indemnity separately and TRENDS THEM AT DIFFERENT
  // RATES (medicalTrend 6.0% vs indemnityTrend 3.5%) — collapsing them into
  // one figure threw away the mix that produced the claim, so the book's
  // blended effective trend could not be verified from its own output.
  //
  // `medical` is care cost. `indemnity` is WAGE REPLACEMENT while the worker
  // is off work. `impairment` is the scheduled award for residual permanent
  // impairment — a distinct payment with its own statutory basis, which is
  // why it is not folded into indemnity.
  //
  // Which tiers populate which component:
  //   medOnly       medical only.
  //   temp          medical + indemnity.
  //   perm          medical + indemnity (healing period) + impairment (award).
  //   catastrophic  medical + indemnity. impairment is 0 — permanent TOTAL
  //                 disability is lifetime wage replacement, not a scheduled
  //                 award for a residual rating.
  //   presumption   medical only, matching the fact that the engine trends
  //                 the whole claim at medicalTrend.
  medical?: number;
  impairment?: number;
  // --- GL claim-level fields (Part B) ---
  // Indemnity/ALAE split of grossUltimate. Kept separately because the
  // statutory cap applies to INDEMNITY ONLY (caps bound damages, not defense
  // costs), while the $1M occurrence retention applies to the combined total
  // — a capped state-law claim can still pierce retention via defense costs.
  //
  // NOTE ON THE SHARED `indemnity` FIELD: WC and GL both populate it, and in
  // both it means "the loss payment proper", but they decompose grossUltimate
  // over DIFFERENT partitions — WC over (medical, indemnity, impairment), GL
  // over (indemnity, alae). Read it with the claim's `line` in hand; a check
  // that sums indemnity+alae, or medical+indemnity+impairment, is only valid
  // within its own line. Both partitions are asserted per line in that line's
  // harness, never across lines.
  indemnity?: number;
  alae?: number;
  // stateLaw claims are capped at GL_STATUTORY_CAP in the waterfall;
  // federal1983 claims are uncapped (why law enforcement owns the tail).
  legalBasis?: 'stateLaw' | 'federal1983';
  litigationStage?: string;
  // yearNumber the claim settles (accident + report lag + stage lag) — the
  // year whose dollars the booked severity is trended to.
  settlementYear?: number;
  // --- Property claim-level fields (design doc property_noncat NC1) ---
  // Property severity is EMERGED FROM THE BOOK rather than drawn as a dollar
  // amount: severity = damageRatio x the hit location's TIV, which is what
  // bounds every claim at insured value. Both components are recorded so that
  // cap is externally checkable — a harness can assert
  // grossUltimate <= locationTiv without re-deriving the location schedule,
  // and damageRatio can be tested against its Beta directly.
  damageRatio?: number;
  locationTiv?: number;
}

// Seeded, read-only operating history shown before Year 1 begins.
export interface HistoricalYear {
  historyYearNumber: number;
  calendarYear: number;
  activeMembers: number;
  activeExposure: number;
  totalMarketExposure: number;
  marketShare: number;
  purePremiumPer100: number;
  poolPremiumRatePer100: number;
  expectedLoss: number;
  poolPremium: number;
  adminExpense: number;
  poolPremiumAndAdminExpense: number;
  reinsuranceCost: number;
  totalMemberCharge: number;
  grossUltimateLoss: number;
  attachment: number;          // per-level attachment; boundary between Pool Losses and Excess Losses
  poolLosses: number;          // min(grossUltimateLoss, attachment) — retained below attachment
  excessLosses: number;        // max(0, grossUltimateLoss - attachment) — the layer above attachment
  quotaShareLosses: number;    // pool's retained share of Excess Losses = (1 - quota%) x excessLosses
  reinsuranceRecovery: number; // reinsurer's paid share of Excess Losses = quota% x excessLosses
  netUltimateLoss: number;
  netPaidLosses: number;
  endingNetReserve: number;
  actualLossRatio: number;
  actualExpenseRatio: number;
  actualCombinedRatio: number;
  underwritingIncome: number;
  investmentIncome: number;
  netIncome: number;
  endingSurplus: number;
  requiredReserveMargin: number;
  excessCapitalRatio: number | null;
  capitalAdequacyStatus: string;
}

// Game instance environment — seeded, immutable after creation
export interface GameInstance {
  instanceId: string;
  seed: number;
  lossEnvironment: {
    baseLossRatio: number;        // e.g. 0.68
    lossTrend: number;            // annual claim inflation e.g. 0.04
    volatility: number;           // std dev factor e.g. 0.15
    shockProbability: number;     // e.g. 0.08
    shockSeverityMultiplier: number; // e.g. 2.5
    heavyTailRisk: number;        // 0-1 extra tail probability
  };
  investmentEnvironment: {
    baseReturn: number;           // e.g. 0.04
    volatility: number;           // e.g. 0.06
    downsideRisk: number;         // probability of negative year e.g. 0.10
  };
  marketEnvironment: {
    totalMarketGrowthRate: number; // e.g. 0.02
    competitivePressure: number;   // 0-1
    memberSensitivity: number;     // 0-1 how reactive members are to price
  };
  // Shock events scheduled for this game, by catalog id and fire year. See
  // src/data/shockCatalog.ts.
  //
  // OPTIONAL AND ABSENT BY DEFAULT, AND THAT IS LOAD-BEARING. generateGameInstance
  // does NOT draw to populate this and does not write the field at all unless a
  // scenario supplies one, so a game with no shocks is byte-identical to one
  // from before shocks existed. Probability-based firing, when it is added,
  // populates this same list from its own purpose-keyed RNG label; everything
  // downstream is unchanged by that.
  scheduledShocks?: ScheduledShock[];
}

// Coverage lines a pool can write. Selected once at game setup and locked for
// the whole game. (Stage 1.1: type + setup selection only — not yet consumed by
// the simulation engine.)
export type CoverageLine = 'WC' | 'GL' | 'Property';

export interface GameSetupSettings {
  poolName: string;
  gameLength: number;     // number of years
  startingYear: number;   // calendar year label only
  instanceId: string;
  activeLines: CoverageLine[];  // coverage lines the pool writes (at least one)
}

// Per-line player decisions for a given year.
// riskControlPct and assetAllocation are POOL-WIDE decisions (set once on
// DecisionSet below); the copies here are projected from the pool values at
// processYear entry so the engine and each line's locked result snapshot keep
// their existing per-line shape. The UI edits only the DecisionSet-level pair.
export interface LineDecisionSet {
  // rateChange REMOVED — CLF-only pricing. Funding confidence is now the sole
  // pricing lever (see SLIDER_RANGES.fundingConfidenceLevel and the funding
  // consequence panel on DecisionsPage). Three read sites removed it
  // deliberately, each commented: membershipEngine.ts's updateSatisfaction,
  // calcRetentionProbability and calcExpectedNewMembers.
  fundingConfidenceLevel: number; // 0.30 to 0.95
  dividendPct: number;            // 0.00 to 0.15 of premium
  assessmentPct: number;          // 0.00 to 0.25 of premium
  underwritingStrictness: number; // 0-10
  riskControlPct: number;         // 0.00 to 0.08 of premium (projected from DecisionSet.riskControlPct)
  reinsuranceLevel: number;       // 0-4
  assetAllocation: AssetAllocation;    // projected from DecisionSet.assetAllocation
  loanRepaymentAggressiveness: number; // 0.00 to 1.00 — share of positive net income used to
                                       // repay an outstanding inter-line loan first; only
                                       // relevant while that line carries a loan balance
}

// An inter-line loan from specific lending lines to a single line whose surplus
// went negative. Tracked at the pool level (see PoolState.interLineLoans). At
// most one outstanding loan per borrowing line at a time. Stage 2.9: the money
// is a real transfer out of the lending lines' invested assets; repayments
// (principal + interest) flow back to the same lenders in the same fixed shares.
export interface InterLineLoan {
  borrowingLine: CoverageLine;
  principal: number;              // original amount borrowed (the deficit that was covered)
  remainingBalance: number;       // outstanding principal + accrued interest, reduced by repayments
  rateAtOrigination: number;      // the pool's asset-weighted blended investment return that year,
                                  // fixed for the loan's life
  yearOriginated: number;
  lenderShares: Partial<Record<CoverageLine, number>>; // each lending line's share of the loan
                                                       // (sums to 1), fixed at origination
}

// Investment portfolio allocation across cash/bonds/equities — must sum to
// 100. The ALLOCATION DECISION is pool-wide (one policy for every line), but
// portfolios stay segregated per line (Stage 2.9): each line applies this
// shared allocation to its own invested assets against the shared market draw.
export interface AssetAllocation {
  cashPct: number;
  bondsPct: number;
  equitiesPct: number;
}

// Player decisions for a given year: one LineDecisionSet per line, plus the
// two POOL-WIDE decisions — investment allocation and risk-control intensity.
// Pool-wide means one policy value; each line still applies it to its OWN
// base (own invested assets / own premium), so effects stay line-sized.
export interface DecisionSet {
  yearNumber: number;
  byLine: Record<CoverageLine, LineDecisionSet>;
  assetAllocation: AssetAllocation;  // pool-wide investment policy
  riskControlPct: number;            // pool-wide risk-control intensity (0.00-0.08 of each line's own premium)
}

// Reinsurance structure derived from level selection
export interface ReinsuranceStructure {
  level: number;
  label: string;
  attachment: number;           // dollar amount
  limit: number;                // dollar amount
  recoveryPct: number;          // fraction recovered above attachment up to limit
  costPctOfPremium: number;     // approximate annual cost as % of premium
}

// Annual reserve cohort for simplified development. NET basis: losses enter
// net of reinsurance recoveries (recovery cash arrives in lockstep with the
// claim payments it offsets, so there is no separate recoverable receivable).
export interface ReserveCohort {
  yearNumber: number;
  calendarYear: number;
  netUltimate: number;
  netPaid: number;
  netUnpaid: number;
  paydownPct: number;           // portion paid each year
  developmentFactor: number;    // seeded favorable/adverse dev
  closed: boolean;
}

// Full result for one completed simulation year
export interface ResultSet {
  yearNumber: number;
  calendarYear: number;

  // Decisions echoed
  decisions: LineDecisionSet;
  assetAllocation: AssetAllocation; // this line's own allocation decision, echoed
                                    // (pool-level aggregate shows the first line's as a placeholder)

  // Membership
  activeMembers: number;
  newMembers: number;
  withdrawnMembers: number;
  activeExposure: number;
  totalMarketExposure: number;
  marketShare: number;          // exposure-based
  memberRetentionRate: number;
  memberSatisfaction: number;
  averageRiskQuality: number;
  memberList: Member[];

  // Pricing
  rateLevel: number;            // cumulative index
  ratePer100: number;           // rate per $100 payroll
  purePremiumPer100: number;    // expected loss per $100 payroll
  purePremium: number;          // kept for compat
  writtenExposure: number;      // payroll exposure in $M

  // Premium
  poolPremium: number;                     // expected loss at selected CLF
  adminExpense: number;                    // payroll-based administrative charge
  poolPremiumAndAdminExpense: number;      // expected-ratio denominator
  totalMemberCharge: number;               // includes separately stated reinsurance cost
  grossPremium: number;
  assessments: number;
  dividends: number;

  // Losses
  // The roster/risk-quality-mix correction ACTUALLY APPLIED to this line's draw
  // this year — k_line for WC, k_GL for GL. Absent on the aggregate (Property)
  // path, which has no such correction.
  //
  // EXPOSED SO THE ENROLLED-BOOK RULE CAN BE ASSERTED RATHER THAN REVIEWED. It
  // must equal computeKLine/computeKGl of the ENROLLED book. Marketplace-wide
  // generation makes it easy to pass the 200-member roster here by accident,
  // which would drive the correction to ~1 and silently disable it — and on the
  // canonical roster the two values differ by only ~0.4% (0.9820 vs 0.9781),
  // far too little to notice in any downstream figure. Asserted in
  // scripts/diagnostics/marketplace-generation-check.ts.
  kLineApplied?: number;
  // ENROLLED MEMBERS ONLY. This is the pool-accounting list: aggregateMemberLoss,
  // grossUltimateLoss, reserves and reinsurance all derive from it.
  memberLossResults: MemberLossResult[];
  // ALL 200 CANONICAL MEMBERS, enrolled and prospect alike — loss HISTORY only,
  // never pool accounting. Claims are generated marketplace-wide so that a
  // prospect arrives with a readable loss record instead of a blank one, which
  // is what lets an underwriting screen read experience rather than a hidden
  // risk-quality score.
  //
  // ⚠ DO NOT SUM THIS INTO ANY POOL FIGURE. Prospects pay no premium and cede
  // nothing; their losses are not the pool's. The enrolled entries here are the
  // same objects as memberLossResults above, so the two are consistent by
  // construction rather than by a second computation.
  //
  // Optional for the same reason claims? is: the aggregate (Property) path does
  // not produce it, and it is in-memory only.
  marketMemberLossResults?: MemberLossResult[];
  aggregateMemberLoss: number;
  commonLossFactor: number;
  catastropheFactor: number;
  // Claim-level detail, WC and GL (Property still draws an aggregate).
  // IN-MEMORY FOR THE CURRENT SESSION ONLY — deliberately NOT persisted to
  // localStorage (~800 claims/yr x years would blow the quota); results saved
  // and reloaded carry the aggregates, and per-claim detail is regenerated
  // from seed x member x year on demand. Optional for exactly that reason:
  // any consumer must handle its absence.
  claims?: Claim[];
  occurrences?: Occurrence[];
  claimCountsByClass?: Record<string, number>;  // WC
  claimCountsByTier?: Record<string, number>;   // WC
  claimCountsBySub?: Record<string, number>;    // GL (general/epl/lawEnforcement/abuse + abuseIncidents)
  shockLossAmount: number;
  grossUltimateLoss: number;
  // ⚠ NOT THE SHOCK EVENT SYSTEM. This flag predates it and already carries
  // THREE different line-specific meanings — a WC catastrophic-tier claim, a GL
  // occurrence over $1M, or Property's aggregate factor exceeding its
  // threshold. Configured shock events record on `shockEvents` below, on a
  // separate channel, precisely so that overloading this one does not corrupt
  // three live signals.
  shockLossIncurred: boolean;
  // Configured shock events in force this year that touched THIS line. Absent
  // when none are — an array field, so value-identity-check (which captures
  // only numeric fields) is blind to it by construction.
  shockEvents?: ShockRecord[];
  reinsuranceCost: number;
  attachment: number;          // 100% of expected loss; boundary between Pool Losses and Excess Losses
  poolLosses: number;          // min(grossUltimateLoss, attachment) — retained below attachment
  excessLosses: number;        // max(0, grossUltimateLoss - attachment) — the layer above attachment
  quotaShareLosses: number;    // pool's retained share of Excess Losses = (1 - quota%) x excessLosses
  reinsuranceRecovery: number; // reinsurer's paid share of Excess Losses = quota% x excessLosses
  netUltimateLoss: number;
  netIncurredLoss: number;      // netUltimateLoss adjusted for prior-year reserve development

  // Expenses
  operatingExpense: number;
  riskControlInvestment: number;

  // Reserve development (NET basis — reserves are net of reinsurance)
  priorYearDevelopment: number; // positive = favorable, negative = adverse
  beginningNetReserve: number;
  currentYearNetReserve: number; // IBNR + case for this accident year, net
  netPaidLosses: number;
  endingNetReserve: number;

  // Investment
  investmentReturnRate: number;
  investedAssets: number;
  investmentIncome: number;

  // Inter-line loan (Stage 1.6). All zero/false for a line with no loan activity.
  outstandingLoanBalance: number;   // this line's outstanding inter-line loan balance at year-end
  loanRepaymentApplied: number;     // net income skimmed this year to repay the loan
  loanInterestAccrued: number;      // interest added to the balance this year
  loanOriginatedThisYear: number;   // principal of a loan originated this year (0 if none)
  dividendBlocked: boolean;         // true if this line's dividend was blocked (negative surplus carried in)

  // CLF / Funding Confidence
  //
  // Important model distinction:
  // - Accounting reserves are expected unpaid claims from incurred losses.
  // - CLF does not multiply booked accounting reserves.
  // - CLF is used for premium funding adequacy and reserve confidence analysis.
  // - Capital cushion compares surplus to the extra CLF margin above booked expected unpaid losses.

  selectedFundingConfidenceLevel: number;  // Player-facing selection, e.g. 0.75
  selectedFundingCLF: number;              // Backend actuarial factor from CLF table

  // A. Rate / Premium Funding Adequacy
  expectedLoss: number;                    // Current-year expected loss before CLF
  clfAdjustedExpectedLoss: number;          // expectedLoss × selectedFundingCLF
  requiredFundingPremium: number;           // CLF-adjusted loss + expense + RI + risk control
  actualPremium: number;                    // Usually grossPremium
  premiumFundingGap: number;                // actualPremium - requiredFundingPremium
  premiumFundingRatio: number;              // actualPremium / requiredFundingPremium
  premiumFundingAdequacyStatus: string;     // "Strong" | "Adequate" | "Thin" | "Deficient"

  indicatedFundingRatePer100: number;       // requiredFundingPremium / payroll units
  actualRatePer100: number;                 // selected/actual rate per $100 payroll
  rateFundingGapPer100: number;             // actualRatePer100 - indicatedFundingRatePer100
  rateAdequacyRatio: number;                // actualRatePer100 / indicatedFundingRatePer100

  // B. Accounting Reserve / Reserve Confidence View
  expectedNetUnpaidLoss: number;            // Expected unpaid losses (net of reinsurance)

  netFundingTarget: number;                 // expectedNetUnpaidLoss × selectedFundingCLF
  indicatedNetReserveAtConfidenceLevel: number; // Confidence-level indication, not booked reserve

  fundingMarginNeeded: number;              // Legacy name for reserveRiskMarginNeeded
  reserveRiskMarginNeeded: number;          // netFundingTarget - expectedNetUnpaidLoss

  // C. Capital / Surplus Cushion
  availableFunding: number;                 // Legacy name; equals endingSurplus
  availableSurplus: number;                 // endingSurplus
  fundingGap: number;                       // Legacy name for capitalFundingGap
  capitalFundingGap: number;                // availableSurplus - reserveRiskMarginNeeded
  excessAvailableSurplus: number;           // surplus - required reserve margin
  excessCapitalRatio: number | null;        // excess / required reserve margin
  capitalAdequacyRatio: number | null;      // Legacy alias for excessCapitalRatio
  capitalAdequacyStatus: string;            // "Strong" | "Adequate" | "Thin" | "Deficient"

  // Legacy compatibility
  // Going forward, fundingAdequacyRatio/status describe premium funding adequacy.
  fundingAdequacyRatio: number;             // Alias for premiumFundingRatio
  fundingAdequacyStatus: string;            // Alias for premiumFundingAdequacyStatus
  fundingCLF: number;                       // Alias for selectedFundingCLF
  fundingAdequacyIndicator: string;         // Alias for premiumFundingAdequacyStatus

  // Income statement
  underwritingIncome: number;   // totalMemberCharge + assessments − netIncurredLoss − operatingExpense − riskControlInvestment − reinsuranceCost − dividends
  netIncome: number;            // underwritingIncome + investmentIncome

  // Balance sheet
  beginningCash: number;
  endingCash: number;
  beginningInvestments: number;
  endingInvestments: number;
  totalAssets: number;
  unearnedPremium: number;
  totalLiabilities: number;
  beginingSurplus: number;
  endingSurplus: number;

  // Surplus rollforward validation
  surplusFromIncome: number;                // beginingSurplus + netIncome
  surplusTieOutDifference: number;          // endingSurplus - surplusFromIncome

  // Ratios — EVERY ONE STATES ITS DENOMINATOR, because two exist and mixing
  // them is finding 6's recurring error.
  //   pricing basis       = poolPremiumAndAdminExpense (poolPremium + admin)
  //   member-charge basis = totalMemberCharge (the above + reinsurance cost)
  // A loss ratio and an expense ratio may only be ADDED when they share a
  // denominator, which is why the combined ratios use the member-charge basis
  // on both terms.
  expectedLossRatio: number;             // PRICING basis — the finding-6 reconciliation figure
  expectedLossRatioMemberBasis: number;  // MEMBER-CHARGE basis — the combined-ratio component
  expectedExpenseRatio: number;          // MEMBER-CHARGE basis
  expectedCombinedRatio: number;         // member-charge basis on both terms
  actualLossRatio: number;               // MEMBER-CHARGE basis
  actualExpenseRatio: number;            // MEMBER-CHARGE basis
  actualCombinedRatio: number;           // member-charge basis on both terms
  combinedRatio: number;
  lossRatio: number;
  expenseRatio: number;

  // Narrative
  narrativeExplanation: string;

  // Provenance of the pre-game reject-and-redraw bootstrap (priorHistoryEngine).
  // Set only on pre-game years (yearNumber <= 0), per line, so the exact
  // effective seed that produced that line's history — instance.seed +
  // pregameAttempt x 997 — is derivable from saved state. Undefined for live
  // years and for the pool-level aggregate (each line can carry a different
  // attempt, so there is no single pool-level value).
  pregameAttempt?: number;

  // Per-line breakdown. Pool-level fields above are aggregates across active
  // lines (dollar/count fields summed, ratios recomputed from the summed
  // components); this map retains each line's own unaggregated result.
  byLine: Record<CoverageLine, LineResultSet>;
}

// A single line's own result for the year, before pool-level aggregation.
export type LineResultSet = Omit<ResultSet, 'byLine'>;

// UI display filter (Stage 2.1): 'pool' shows the combined/summed totals;
// a specific line filters every figure on the page to that line's slice.
export type LineView = 'pool' | CoverageLine;

// Per-line pool state (rolled from year to year)
export interface LinePoolState {
  rateLevel: number;           // cumulative rate index (starts at 100)
  ratePer100: number;          // rate per $100 of payroll (e.g. 7.50)
  purePremiumPer100: number;   // expected loss cost per $100 payroll
  /** @deprecated use purePremiumPer100 */
  purePremium: number;         // kept for backward compat — equals purePremiumPer100
  memberSatisfaction: number;
  averageRiskQuality: number;
  riskControlEffectiveness: number; // rolling score 0-1
  reserveCohorts: ReserveCohort[];
  members: Member[];
  netUnpaidReserve: number;    // unpaid loss reserve, net of reinsurance
  surplus: number;
  investedAssets: number;      // this line's own segregated investment portfolio (Stage 2.9),
                               // carried forward year to year like surplus
  totalMarketExposure: number;
}

// One continuous stretch of enrollment in a single coverage line, in ACTIVE
// yearNumbers, inclusive on both ends (pre-game years are negative). A member
// withdrawn during year Y's movement was last active in Y-1, so its interval
// closes with endYear = Y-1; endYear null = currently enrolled.
export interface EnrollmentInterval {
  startYear: number;
  endYear: number | null;
}

// The authoritative per-member, per-line enrollment record, keyed by member
// id then coverage line: every past and present active interval, supporting
// "was member X active in line Y during year Z" for any combination,
// including multiple past intervals per member per line. Member.yearJoined /
// yearWithdrawn remain as DENORMALIZED convenience fields only — per-line
// questions (e.g. the re-enrollment cooldown) must be answered from this
// ledger, never from Member.status, which is fold-corrupted across lines
// (see membershipHistory.ts).
export type MembershipHistory = Record<string, Partial<Record<CoverageLine, EnrollmentInterval[]>>>;

// One member-line-year of loss experience. See src/utils/memberLossHistory.ts
// for what each leg includes and — importantly — what it deliberately does not.
export interface MemberLossYear {
  yearNumber: number;   // pre-game years negative, matching every other yearNumber here
  actual: number;       // that year's drawn gross ultimate loss for this member
  expected: number;     // the analytic expectation AS IT STOOD THAT YEAR (not recomputed later)
}

// Rolling per-member, per-line loss history, keyed memberId -> line -> years.
//
// KEYED PER (MEMBER, LINE) because enrolment is per line — a member can be in WC
// and not GL, and their experience differs accordingly.
//
// PLAIN JSON-SERIALISABLE, AND THAT IS A HARD REQUIREMENT, NOT A PREFERENCE.
// The whole GameState goes through JSON.stringify in App.tsx, where a Map
// serialises to {} SILENTLY — no error, no warning, just an empty object on the
// next load. Records and arrays only. Same constraint as MembershipHistory.
export type MemberLossHistory = Record<string, Partial<Record<CoverageLine, MemberLossYear[]>>>;

// Pool ongoing state: fields shared across all lines, plus one LinePoolState per
// line. Investments are NOT here — each line holds its own portfolio (Stage 2.9);
// cash remains shared and is split by contribution share.
export interface PoolState {
  cash: number;
  unearnedPremium: number;
  allMarketMembers: Member[];      // the full canonical marketplace (200 members)
  lines: Record<CoverageLine, LinePoolState>;
  interLineLoans: InterLineLoan[]; // pool-level ledger of outstanding inter-line loans
  membershipHistory: MembershipHistory; // authoritative per-line enrollment intervals
  // Rolling per-member, per-line actual/expected loss record — the input the
  // experience modifier (stage 4) reads. Maintained marketplace-wide, so
  // prospects carry history too.
  //
  // ON PoolState, NOT ON Member, deliberately. Member is a generated,
  // seed-independent catalog entry (memberCatalog.ts) shared by every game;
  // hanging per-game simulation state off it would make the catalog stateful and
  // would mean two concurrent games mutate each other's members.
  //
  // OPTIONAL because saves predating stage 3 lack it. App.tsx defaults it to {}
  // on load rather than bumping the save key — same precedent as
  // membershipHistory, and discarding a save over an additive field would be a
  // worse trade.
  memberLossHistory?: MemberLossHistory;
}

// Top-level game state
export interface GameState {
  setup: GameSetupSettings;
  instance: GameInstance;
  currentYearNumber: number;
  isStarted: boolean;
  isComplete: boolean;
  poolState: PoolState;
  lockedResults: ResultSet[];
  currentDecisions: DecisionSet;
  // Stage 2.10: the 3 simulated pre-game years (yearNumbers -2, -1, 0), run
  // through the real engine at default decisions. Year 0's ending state IS the
  // Year 1 opening position; year 0's result is Year 1's priorResult.
  priorHistory: ResultSet[];
}

// Starting financial position
export interface StartingFinancials {
  cash: number;
  investments: number;
  totalAssets: number;
  netUnpaidReserve: number;    // unpaid loss reserve, net of reinsurance
  unearnedPremium: number;
  totalLiabilities: number;
  surplus: number;
  annualPremium: number;
  expectedLossRatio: number;
  memberSatisfaction: number;
  riskQuality: number;
  surplusToPremiumRatio: number;
  activeMembers: number;
  activeExposure: number;      // payroll in $M
  totalMarketExposure: number; // payroll in $M
  marketShare: number;
  rateLevel: number;
  ratePer100: number;          // rate per $100 payroll
  purePremiumPer100: number;   // expected loss per $100 payroll
  purePremium: number;         // kept for compat
}

// V2: ChartDataPoint for future chart support
export interface ChartDataPoint {
  yearNumber: number;
  calendarYear: number;
  value: number;
  label: string;
}

// V2: LossDistributionConfig for more advanced modeling
export interface LossDistributionConfig {
  distributionType: 'lognormal' | 'gamma' | 'normal';
  mean: number;
  cv: number;
}

// V2: ReserveDevelopmentState for full accident-year triangle
export interface ReserveDevelopmentState {
  accidentYear: number;
  developmentPattern: number[];
  selectedFactors: number[];
}
