// Centralized assumptions for Risk Pool Simulation v1
// V2: Allow admin-editable assumptions from a backend config

// Administrative expense is 15% of Pure Premium at CLF 1.000. It is added
// after the selected CLF is applied and is not itself multiplied by the CLF.
export const ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM = 0.15;

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
  actualLossLevelMultiplier: 2.05,
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

// Investment return assumptions by risk level (0-10)
// Conservative public-entity / risk-pool style portfolio assumptions.
// These are intentionally modest so investment income does not dominate underwriting results.
export const INVESTMENT_RISK_PARAMS = {
  baseReturnByLevel: [
    0.0075, // 0 - Very Conservative
    0.0100,
    0.0125,
    0.0150, // 3 - Default-ish
    0.0175,
    0.0200,
    0.0225,
    0.0250,
    0.0275,
    0.0300,
    0.0325, // 10 - Aggressive for this pool
  ],
  volatilityByLevel: [
    0.0025,
    0.0035,
    0.0050,
    0.0075,
    0.0100,
    0.0135,
    0.0175,
    0.0225,
    0.0275,
    0.0325,
    0.0400,
  ],
  downsideShockProbByLevel: [
    0.010,
    0.015,
    0.020,
    0.025,
    0.030,
    0.035,
    0.040,
    0.045,
    0.050,
    0.055,
    0.060,
  ],
};

// Reinsurance program table indexed by level (0-4)
// Aggregate quota-share reinsurance, above the pool's own expected loss.
// Attachment is fixed at 100% of expected gross loss + LAE for every paid level —
// the pool retains all losses up to its own expected loss, no matter the level chosen.
// Above that attachment, the reinsurer pays a flat quota share (recoveryPct) of the
// excess, uncapped (no limit) — this is aggregate-basis for now; occurrence-basis
// layering is deferred until a claim-level frequency/severity model exists.
export const REINSURANCE_PROGRAMS = [
  {
    level: 0,
    label: 'None',
    description: 'No reinsurance protection',
    attachmentMultiplierOfExpectedLoss: 0,
    limitPctOfPremium: 0,
    recoveryPct: 0,
    costPctOfPremiumMin: 0,
    costPctOfPremiumMax: 0,
  },
  {
    level: 1,
    label: 'Low',
    description: '100% attachment, 50% quota share, uncapped',
    attachmentMultiplierOfExpectedLoss: 1.00,
    limitPctOfPremium: Infinity,
    recoveryPct: 0.50,
    costPctOfPremiumMin: 0.06,
    costPctOfPremiumMax: 0.09,
  },
  {
    level: 2,
    label: 'Moderate',
    description: '100% attachment, 75% quota share, uncapped',
    attachmentMultiplierOfExpectedLoss: 1.00,
    limitPctOfPremium: Infinity,
    recoveryPct: 0.75,
    costPctOfPremiumMin: 0.12,
    costPctOfPremiumMax: 0.18,
  },
  {
    level: 3,
    label: 'High',
    description: '100% attachment, 90% quota share, uncapped',
    attachmentMultiplierOfExpectedLoss: 1.00,
    limitPctOfPremium: Infinity,
    recoveryPct: 0.90,
    costPctOfPremiumMin: 0.22,
    costPctOfPremiumMax: 0.32,
  },
  {
    level: 4,
    label: 'Full Transfer',
    description: '100% attachment, 100% quota share (full transfer of excess), uncapped',
    attachmentMultiplierOfExpectedLoss: 1.00,
    limitPctOfPremium: Infinity,
    recoveryPct: 1.00,
    costPctOfPremiumMin: 0.45,
    costPctOfPremiumMax: 0.65,
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

// Starting pool payroll exposure targets ($M)
export const STARTING_POOL_EXPOSURE = { min: 50, max: 75 };

// Total market payroll exposure targets ($M)
export const TOTAL_MARKET_EXPOSURE = { min: 180, max: 300 };

// Starting rate per $100 payroll range
export const STARTING_RATE_PER_100 = { min: 5.00, max: 10.00 };

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
  investmentRisk: { min: 0, max: 10, step: 1, default: 3 },
};

// Starting pool member count range
export const STARTING_MEMBER_RANGE = { min: 20, max: 35 };
export const TOTAL_MARKET_MEMBERS = 100;

// Reserve paydown percentage per year
export const RESERVE_PAYDOWN_PCT = 0.35;
