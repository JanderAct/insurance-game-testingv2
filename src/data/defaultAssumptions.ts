// Centralized assumptions for Risk Pool Simulation v1
// V2: Allow admin-editable assumptions from a backend config

// Administrative expense is 15% of Pure Premium at CLF 1.000. It is added
// after the selected CLF is applied and is not itself multiplied by the CLF.
export const ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM = 0.15;

// Liquid operating cash the pool keeps on hand each year, sized to that year's
// premium. Cash above this target is swept into investments at year-end, where
// it earns a return; cash below this target is covered by drawing down
// investments instead of letting the shortfall vanish.
export const OPERATING_CASH_PCT_OF_PREMIUM = 0.15;

export const LOSS_TREND = 0.04; // 4% annual claim inflation (default; instance may override)

// Every member uses a Gamma distribution whose mean is its Pure Premium
// expected loss. Risk quality changes volatility, not the expected value.
export const MEMBER_LOSS_VOLATILITY = {
  distribution: 'Gamma',
  worstRiskCV: 1.00, // risk quality 1
  bestRiskCV: 0.30,  // risk quality 10
};

// Continuous pool-wide annual factor calibrated to balanced stock-decision
// gameplay. This adds correlation across members without a binary shock regime.
export const AGGREGATE_LOSS_DISTRIBUTION = {
  distribution: 'Lognormal',
  logMean: -0.163964,
  logSigma: 0.25,
  // Chosen so the mean of (lognormal × multiplier) ≈ 1.0, i.e. actual losses
  // average about the expected loss (pure premium). The CLF loading in the
  // premium then supplies the funding margin instead of losses systematically
  // running above expected. (Lognormal mean = exp(logMean + logSigma²/2) ≈ 0.876,
  // so 1 / 0.876 ≈ 1.14.)
  actualLossLevelMultiplier: 1.14,
  catastropheThresholdConfidence: 0.95,
};

// Base retention probability per member per year — high by default for realistic public entity pools
export const BASE_RETENTION = 0.95;

// Expected new members per year under neutral conditions (count-based, not fraction-based)
// Normal year: 0-2 new members. Favorable year: up to 4.
export const BASE_NEW_MEMBERS_PER_YEAR = 1.0;

// Hard caps on annual membership movement
export const MAX_NEW_MEMBERS_PER_YEAR = 4;
export const MAX_WITHDRAWN_PER_YEAR = 4;

// Funding confidence level factor (CLF) table
// Represents the multiplier applied to expected losses to set funding targets
export const FUNDING_CLF_TABLE: Record<number, number> = {
  0.95: 2.448,
  0.90: 1.951,
  0.85: 1.694,
  0.80: 1.501,
  0.75: 1.346,
  0.70: 1.217,
  0.65: 1.105,
  0.60: 1.003,
  0.55: 0.908,
  0.50: 0.827,
};

// Investment return assumptions by asset class. Conservative public-entity /
// risk-pool style portfolio assumptions, intentionally modest so investment
// income does not dominate underwriting results. Cash and bonds essentially
// never have a real down year; equities does, by design, to make the
// allocation decision carry real risk/return tradeoff.
export interface AssetClassAssumption {
  expectedReturn: number;
  standardDeviation: number;
  minReturn: number;
  maxReturn: number;
  downsideProbability: number;
  downsideMeanReturn: number;
  downsideStandardDeviation: number;
}

export const ASSET_CLASS_ASSUMPTIONS: Record<'cash' | 'bonds' | 'equities', AssetClassAssumption> = {
  cash: {
    expectedReturn: 0.020,
    standardDeviation: 0.003,
    minReturn: 0.005,
    maxReturn: 0.035,
    downsideProbability: 0,
    downsideMeanReturn: 0.005,
    downsideStandardDeviation: 0.002,
  },
  bonds: {
    expectedReturn: 0.035,
    standardDeviation: 0.020,
    minReturn: -0.04,
    maxReturn: 0.09,
    downsideProbability: 0.10,
    downsideMeanReturn: -0.02,
    downsideStandardDeviation: 0.015,
  },
  equities: {
    expectedReturn: 0.075,
    standardDeviation: 0.110,
    minReturn: -0.30,
    maxReturn: 0.35,
    downsideProbability: 0.18,
    downsideMeanReturn: -0.15,
    downsideStandardDeviation: 0.08,
  },
};

// Default shared-portfolio allocation — a bonds-heavy, realistic pool posture.
export const ASSET_ALLOCATION_DEFAULT = { cashPct: 10, bondsPct: 80, equitiesPct: 10 };

// Reinsurance program table indexed by level (0-4)
// Aggregate quota-share reinsurance, above the pool's own expected loss.
// Attachment is 125% of expected gross loss + LAE for Self Fund/Low/Moderate/High —
// the pool retains real loss risk into its own CLF-funded cushion before any
// reinsurance help arrives, no matter the level chosen. Full Transfer keeps a
// 100% attachment, since it is meant to be genuine full risk transfer above
// expected loss. Above attachment, the reinsurer pays a flat quota share
// (recoveryPct) of the excess, uncapped (no limit) — this is aggregate-basis for
// now; occurrence-basis layering is deferred until a claim-level frequency/
// severity model exists.
// Full Transfer costs a flat 50% of premium; other paid levels scale that cost
// linearly by their quota share (cost and quota share move together). Self Fund
// (level 0) pays nothing externally — instead it retains that same 50%-of-premium
// budget in cash, which the general cash-sweep mechanism carries into investments
// where it earns a return, rather than paying it away with nothing in exchange.
export const FULL_TRANSFER_COST_PCT_OF_PREMIUM = 0.50;

// The pool's retained (non-ceded) share of the excess layer is billed to members
// at a discount off its full-transfer-equivalent notional cost, taken immediately
// in the current year's charge — self-funding avoids a commercial reinsurer's
// margin, so pools can pass that savings straight through to members.
export const SELF_FUNDED_DISCOUNT_PCT = 0.08;

export const REINSURANCE_PROGRAMS = [
  {
    level: 0,
    label: 'Self Fund',
    description: '125% attachment — no external reinsurance; the pool retains and invests the amount it would otherwise pay for full coverage',
    attachmentMultiplierOfExpectedLoss: 1.25,
    limitPctOfPremium: 0,
    recoveryPct: 0,
    costPctOfPremiumMin: 0,
    costPctOfPremiumMax: 0,
  },
  {
    level: 1,
    label: 'Low',
    description: '125% attachment, pool retains 50% of excess, uncapped',
    attachmentMultiplierOfExpectedLoss: 1.25,
    limitPctOfPremium: Infinity,
    recoveryPct: 0.50,
    costPctOfPremiumMin: 0.50 * FULL_TRANSFER_COST_PCT_OF_PREMIUM,
    costPctOfPremiumMax: 0.50 * FULL_TRANSFER_COST_PCT_OF_PREMIUM,
  },
  {
    level: 2,
    label: 'Moderate',
    description: '125% attachment, pool retains 25% of excess, uncapped',
    attachmentMultiplierOfExpectedLoss: 1.25,
    limitPctOfPremium: Infinity,
    recoveryPct: 0.75,
    costPctOfPremiumMin: 0.75 * FULL_TRANSFER_COST_PCT_OF_PREMIUM,
    costPctOfPremiumMax: 0.75 * FULL_TRANSFER_COST_PCT_OF_PREMIUM,
  },
  {
    level: 3,
    label: 'High',
    description: '125% attachment, pool retains 10% of excess, uncapped',
    attachmentMultiplierOfExpectedLoss: 1.25,
    limitPctOfPremium: Infinity,
    recoveryPct: 0.90,
    costPctOfPremiumMin: 0.90 * FULL_TRANSFER_COST_PCT_OF_PREMIUM,
    costPctOfPremiumMax: 0.90 * FULL_TRANSFER_COST_PCT_OF_PREMIUM,
  },
  {
    level: 4,
    label: 'Full Transfer',
    description: '100% attachment, pool retains 0% of excess (full transfer), uncapped',
    attachmentMultiplierOfExpectedLoss: 1.00,
    limitPctOfPremium: Infinity,
    recoveryPct: 1.00,
    costPctOfPremiumMin: FULL_TRANSFER_COST_PCT_OF_PREMIUM,
    costPctOfPremiumMax: FULL_TRANSFER_COST_PCT_OF_PREMIUM,
  },
];

// Member movement weight parameters
export const MEMBER_MOVEMENT_WEIGHTS = {
  retention: {
    satisfaction: 0.35,
    financialStrength: 0.15,
    dividend: 0.15,
    assessmentPenalty: 0.20,
    rateIncreasePenalty: 0.15,
  },
  attraction: {
    competitiveness: 0.25,
    underwritingAccessibility: 0.20,
    financialStrength: 0.15,
    riskControlValue: 0.10,
    rateLevel: 0.20,
    assessmentPenalty: 0.10,
  },
};

// Risk control rolling effectiveness parameters
export const RISK_CONTROL_PARAMS = {
  maxEffectiveness: 0.15,
  lagYears: 3,
  decayRate: 0.20,
};

// Payroll-based exposure ranges (in $M of payroll)
// Total market of 100 members should aggregate to ~$180-300M payroll
export const EXPOSURE_RANGES: Record<string, { min: number; max: number }> = {
  Small: { min: 0.3, max: 1.5 },
  Medium: { min: 1.5, max: 4.0 },
  Large: { min: 4.0, max: 10.0 },
  'Very Large': { min: 10.0, max: 20.0 },
};

// Size category probability weights — mostly small entities
export const SIZE_WEIGHTS = [0.55, 0.30, 0.12, 0.03];

// Starting enrollment per line: each active line independently enrolls members
// (seeded random order) until its enrolled exposure reaches this share of the
// market's TOTAL exposure for that line (WC payroll / GL payroll / Property
// TIV). The exposure target drives the member count, not the other way around.
export const STARTING_EXPOSURE_SHARE = { min: 0.25, max: 0.35 };

// Total market payroll exposure targets ($M)
export const TOTAL_MARKET_EXPOSURE = { min: 180, max: 300 };

// Starting rate per $100 payroll range
export const STARTING_RATE_PER_100 = { min: 5.00, max: 10.00 };

// GL (General Liability) starting assumptions. GL shares WC's payroll exposure
// base, but liability is lower-frequency/higher-severity than WC's injury/
// medical exposure, so its charged rate and loss cost per payroll dollar are
// set meaningfully lower than WC's. Tunable placeholders — calibrate by feel.
export const GL_STARTING_RATE_PER_100 = { min: 1.50, max: 3.00 };
export const GL_EXPECTED_LOSS_RATIO = { min: 0.55, max: 0.70 };
export const GL_STARTING_FINANCIALS = {
  grossUnpaidReserve: { min: 1_000_000, max: 2_500_000 },
  reinsuranceRecoverable: { min: 0, max: 300_000 },
};

// Property starting assumptions. Property's exposure base is Total Insured
// Value (TIV, $M) — buildings, apparatus, and equipment — not payroll, and a
// member's TIV need not track its payroll closely (see TIV_TYPE_MULTIPLIER
// below). Rate per $100 of TIV is much smaller than WC/GL's per-$100-payroll
// rate since TIV dollar amounts are much larger. Tunable placeholders.
export const TIV_RANGES: Record<string, { min: number; max: number }> = {
  Small: { min: 2, max: 8 },
  Medium: { min: 6, max: 20 },
  Large: { min: 18, max: 55 },
  'Very Large': { min: 50, max: 140 },
};

// Infrastructure-heavy member types carry disproportionately more insured
// property value per payroll dollar than administrative-heavy types — this
// decorrelates Property exposure from payroll exposure per member.
export const TIV_TYPE_MULTIPLIER: Record<string, number> = {
  City: 1.0,
  County: 1.0,
  'Fire District': 2.2,
  'Water District': 1.8,
  'Transit Authority': 1.6,
  'School District': 1.7,
  'Park District': 1.3,
  'Recreation District': 1.3,
  'Special District': 1.0,
};

// Calibration: scale every member's Property TIV up by this factor so the
// Property book is a substantial third line (~$5-10M premium) rather than a
// rounding error. Applied in memberCatalog's tivFor(). Rate and loss ratio are
// unchanged, and losses are exposure-proportional (mean loss = TIV ×
// purePremiumPer100 × 10,000), so scaling TIV scales premium and losses
// together — the loss ratio is invariant.
export const PROPERTY_TIV_SCALE = 7;

export const PROPERTY_STARTING_RATE_PER_100 = { min: 0.10, max: 0.30 };
export const PROPERTY_EXPECTED_LOSS_RATIO = { min: 0.45, max: 0.60 };
export const PROPERTY_STARTING_FINANCIALS = {
  grossUnpaidReserve: { min: 300_000, max: 900_000 },
  reinsuranceRecoverable: { min: 0, max: 150_000 },
};

// Starting pool financial ranges
export const STARTING_FINANCIALS = {
  annualPremium: { min: 4_000_000, max: 8_000_000 },
  expectedLossRatio: { min: 0.65, max: 0.80 },
  memberSatisfaction: { min: 6.5, max: 8.5 },
  riskQuality: { min: 4.0, max: 6.0 },
  surplusToPremiumRatio: { min: 0.60, max: 1.20 },
  cash: { min: 1_000_000, max: 3_000_000 },
  investments: { min: 6_000_000, max: 12_000_000 },
  reinsuranceRecoverable: { min: 0, max: 1_000_000 },
  otherAssets: { min: 100_000, max: 400_000 },
  grossUnpaidReserve: { min: 4_000_000, max: 8_000_000 },
  otherLiabilities: { min: 100_000, max: 400_000 },
  startingSurplus: { min: 3_000_000, max: 7_000_000 },
};

// Slider ranges (not player-editable in v1)
export const SLIDER_RANGES = {
  rateChange: { min: -0.20, max: 0.30, step: 0.01, default: 0 },
  fundingConfidenceLevel: { min: 0.50, max: 0.95, step: 0.05, default: 0.75 },
  dividendPct: { min: 0, max: 0.15, step: 0.005, default: 0 },
  assessmentPct: { min: 0, max: 0.25, step: 0.005, default: 0 },
  underwritingStrictness: { min: 0, max: 10, step: 1, default: 5 },
  riskControlPct: { min: 0, max: 0.08, step: 0.01, default: 0 },
  reinsuranceLevel: { min: 0, max: 4, step: 1, default: 2 },
};

export const TOTAL_MARKET_MEMBERS = 100;

// Reserve paydown percentage per year
export const RESERVE_PAYDOWN_PCT = 0.35;

// Per-line reserve paydown speed — the lightweight placeholder for each
// line's development-pattern character until Phase 3 builds real per-line
// accident-year triangles. WC and GL both keep the original flat rate
// (unchanged); Property pays down much faster (short tail).
export const LINE_RESERVE_PAYDOWN_PCT: Record<string, number> = {
  WC: RESERVE_PAYDOWN_PCT,
  GL: RESERVE_PAYDOWN_PCT,
  Property: 0.65,
};
