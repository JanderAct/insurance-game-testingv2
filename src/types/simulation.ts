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
  exposureByLine: Partial<Record<CoverageLine, number>>; // exposure units, per coverage line
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
  selfFundedDiscount: number;   // discount on the retained (non-ceded) share, taken immediately
  reinsuranceCost: number;
  totalMemberCharge: number;
  grossUltimateLoss: number;
  attachment: number;          // per-level attachment; boundary between Pool Losses and Excess Losses
  poolLosses: number;          // min(grossUltimateLoss, attachment) — retained below attachment
  excessLosses: number;        // max(0, grossUltimateLoss - attachment) — the layer above attachment
  quotaShareLosses: number;    // pool's retained share of Excess Losses = (1 - quota%) x excessLosses
  reinsuranceRecovery: number; // reinsurer's paid share of Excess Losses = quota% x excessLosses
  netUltimateLoss: number;
  grossPaidLosses: number;
  endingGrossReserve: number;
  endingReinsuranceRecoverable: number;
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

// Per-line player decisions for a given year
export interface LineDecisionSet {
  rateChange: number;             // -0.20 to +0.30 as decimal
  fundingConfidenceLevel: number; // 0.50 to 0.95
  dividendPct: number;            // 0.00 to 0.15 of premium
  assessmentPct: number;          // 0.00 to 0.25 of premium
  underwritingStrictness: number; // 0-10
  riskControlPct: number;         // 0.00 to 0.08 of premium
  reinsuranceLevel: number;       // 0-4
  loanRepaymentAggressiveness: number; // 0.00 to 1.00 — share of positive net income used to
                                       // repay an outstanding inter-line loan first; only
                                       // relevant while that line carries a loan balance
}

// An inter-line loan from the shared pool to a single line whose surplus went
// negative. Tracked at the pool level (see PoolState.interLineLoans). At most
// one outstanding loan per borrowing line at a time.
export interface InterLineLoan {
  borrowingLine: CoverageLine;
  principal: number;              // original amount borrowed (the deficit that was covered)
  remainingBalance: number;       // outstanding principal + accrued interest, reduced by repayments
  rateAtOrigination: number;      // that year's realized pool investment return, fixed for the loan's life
  yearOriginated: number;
}

// Shared investment portfolio allocation across cash/bonds/equities. Pool-level
// (one shared, commingled portfolio) — must sum to 100.
export interface AssetAllocation {
  cashPct: number;
  bondsPct: number;
  equitiesPct: number;
}

// Player decisions for a given year: pool-level fields plus one LineDecisionSet per line
export interface DecisionSet {
  yearNumber: number;
  assetAllocation: AssetAllocation; // pool-level (shared asset pool)
  byLine: Record<CoverageLine, LineDecisionSet>;
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

// Annual reserve cohort for simplified development
export interface ReserveCohort {
  yearNumber: number;
  calendarYear: number;
  grossUltimate: number;
  grossPaid: number;
  grossUnpaid: number;
  reinsuranceRecoverable: number;
  reinsuranceReceived: number;
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
  assetAllocation: AssetAllocation; // pool-level decision, echoed for this line's result

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
  selfFundedDiscount: number;               // discount on the retained (non-ceded) share, taken immediately
  totalMemberCharge: number;               // includes separately stated reinsurance cost, net of selfFundedDiscount
  grossPremium: number;
  assessments: number;
  dividends: number;

  // Losses
  memberLossResults: MemberLossResult[];
  aggregateMemberLoss: number;
  commonLossFactor: number;
  catastropheFactor: number;
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

  // Reserve development
  priorYearDevelopment: number; // positive = favorable, negative = adverse
  beginningGrossReserve: number;
  currentYearGrossReserve: number; // IBNR + case for this accident year
  grossPaidLosses: number;
  endingGrossReserve: number;
  beginningReinsRecoverable: number;
  endingReinsRecoverable: number;

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
  expectedGrossUnpaidLoss: number;          // Expected unpaid losses from all cohorts, gross
  expectedReinsuranceRecoverable: number;   // Reinsurance recoverable on unpaid losses
  expectedNetUnpaidLoss: number;            // Expected unpaid losses net of reinsurance

  grossFundingTarget: number;               // expectedGrossUnpaidLoss × selectedFundingCLF
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
  otherAssets: number;
  totalAssets: number;
  unearnedPremium: number;
  otherLiabilities: number;
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

  // Per-line breakdown. Pool-level fields above are aggregates across active
  // lines (dollar/count fields summed, ratios recomputed from the summed
  // components); this map retains each line's own unaggregated result.
  byLine: Record<CoverageLine, LineResultSet>;
}

// A single line's own result for the year, before pool-level aggregation.
export type LineResultSet = Omit<ResultSet, 'byLine'>;

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
  grossUnpaidReserve: number;
  reinsuranceRecoverable: number;
  surplus: number;
  totalMarketExposure: number;
}

// Pool ongoing state: fields shared across all lines, plus one LinePoolState per line
export interface PoolState {
  cash: number;
  investments: number;
  otherAssets: number;
  unearnedPremium: number;
  otherLiabilities: number;
  allMarketMembers: Member[];      // all 100 fictional members
  lines: Record<CoverageLine, LinePoolState>;
  interLineLoans: InterLineLoan[]; // pool-level ledger of outstanding inter-line loans
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
}

// Starting financial position
export interface StartingFinancials {
  cash: number;
  investments: number;
  reinsuranceRecoverable: number;
  otherAssets: number;
  totalAssets: number;
  grossUnpaidReserve: number;
  unearnedPremium: number;
  otherLiabilities: number;
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
