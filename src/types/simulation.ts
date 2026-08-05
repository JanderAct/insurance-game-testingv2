// Core TypeScript types for Risk Pool Simulation v1

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

export interface Member {
  id: string;
  name: string;
  type: MemberType;
  sizeCategory: SizeCategory;
  // Geographic region 1-5. A fixed, one-time-generated property of each
  // canonical-roster member (weights 10/20/40/20/10) — independent of every
  // other column and never re-rolled per game seed. Scaffolding for future
  // regional loss correlation (e.g. catastrophes striking a region).
  region: number;
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
// several claims), which is the unit occurrence-based reinsurance will
// eventually attach to.
export interface Occurrence {
  id: string;
  line: CoverageLine;
  memberId: string;
  accidentYear: number;   // yearNumber the event happened (pre-game years negative)
  calendarYear: number;
  region: number;         // the member's region 1-5, for regional correlation (e.g. catastrophes)
  isCatastrophe: boolean; // part of a regional/pool-wide catastrophe event
}

export type ClaimStatus = 'open' | 'closed' | 'reopened';

// A catastrophic claim's payment stream. Lifetime-care claims are not a single
// severity draw — they are decades of inflating medical payments plus wage
// indemnity to retirement. Carried on the claim so reserving can consume the
// real schedule instead of re-deriving it. grossUltimate is the NOMINAL sum of
// this stream (undiscounted); present-value treatment is Phase 3.
export interface ClaimAnnuity {
  medicalFirstYearPayment: number;
  medicalInflationPct: number;
  medicalYears: number;
  indemnityAnnualPayment: number;
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
  rateChange: number;             // -0.20 to +0.30 as decimal
  fundingConfidenceLevel: number; // 0.50 to 0.95
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
  memberLossResults: MemberLossResult[];
  aggregateMemberLoss: number;
  commonLossFactor: number;
  catastropheFactor: number;
  // Claim-level detail, WC only (the other lines still draw an aggregate).
  // IN-MEMORY FOR THE CURRENT SESSION ONLY — deliberately NOT persisted to
  // localStorage (~800 claims/yr x years would blow the quota); results saved
  // and reloaded carry the aggregates, and per-claim detail is regenerated
  // from seed x member x year on demand. Optional for exactly that reason:
  // any consumer must handle its absence.
  claims?: Claim[];
  occurrences?: Occurrence[];
  claimCountsByClass?: Record<string, number>;
  claimCountsByTier?: Record<string, number>;
  shockLossAmount: number;
  grossUltimateLoss: number;
  shockLossIncurred: boolean;
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

  // Ratios
  expectedLossRatio: number;
  expectedExpenseRatio: number;
  expectedCombinedRatio: number;
  actualLossRatio: number;
  actualExpenseRatio: number;
  actualCombinedRatio: number;
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
