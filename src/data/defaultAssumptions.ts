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

// ===========================================================================
// WORKERS' COMPENSATION claim-level loss model (design doc Part A).
//
// Replaces, for WC only, the aggregate member-Gamma draw above: individual
// claims are generated per member per rating class, so the $1M retention
// waterfall, per-claim reserving, and per-tail development have real objects
// to work on. GL and Property still use MEMBER_LOSS_VOLATILITY /
// AGGREGATE_LOSS_DISTRIBUTION until their own generators are built.
//
// Two model-wide conventions worth stating up front:
//
// 1. DOLLAR VINTAGE IS EXPLICIT. Every severity figure here is stated in
//    ACCIDENT-YEAR dollars. Carrying a payment forward to the year it is
//    actually settled is done in exactly one place — trendToSettlement() in
//    wcClaimEngine — using the two trend rates below. Nothing in the model
//    stores a value whose vintage is ambiguous, which is what lets Phase 3
//    reserving trend and discount FROM a known basis instead of trying to
//    reconstruct a vintage the generator threw away. Frequency trends too,
//    separately (below).
//
// 2. FREQUENCY TREND IS A DECLINE and pure premium does NOT track it. WC's
//    purePremiumPer100 is derived ONCE from the neutral-book expectation and
//    held (see wcClaimEngine), while realized frequency falls 1.5%/yr. The
//    loss ratio therefore drifts down slightly over a game — a deliberate
//    consequence of holding the pick while frequency improves, and the
//    counterpart to the severity inflation that Phase 3 will add on the other
//    side.
// ===========================================================================

export const WC_CLASS_KEYS = ['clerical', 'publicWorks', 'police', 'fire'] as const;
export type WcClassKey = (typeof WC_CLASS_KEYS)[number];

export const WC_TIERS = ['medOnly', 'temp', 'perm', 'catastrophic'] as const;
export type WcTier = (typeof WC_TIERS)[number];

export const WC_LOSS_MODEL = {
  // --- A1 frequency -------------------------------------------------------
  // Claims per $1M of that class's payroll per year. Calibrated to the
  // canonical roster: expected pool claim counts 75 / 511 / 79 / 144 = ~809.
  rateClassPer1M: { clerical: 0.15, publicWorks: 0.80, police: 1.20, fire: 1.50 } as Record<WcClassKey, number>,

  // Workplace safety improves ~1.5%/yr. Applied as (1 + trend)^(yearNumber-1),
  // so live Year 1 is the reference (factor 1.0) and the pre-game years carry
  // a factor slightly ABOVE 1 — the past was more dangerous, which is both
  // realistic and keeps the pre-game consistent with the live model.
  frequencyTrendPerYear: -0.015,

  // Per member-year frequency noise, mean 1 (SD 0.25). Makes claim counts
  // overdispersed relative to pure Poisson.
  memberFrequencyNoise: { shape: 16, scale: 1 / 16 },

  // Pool-wide year factor, mean 1 (SD 0.20). ONE draw per year SHARED ACROSS
  // ALL LINES (drawn in processYear, not per line) — this is the aggregate
  // correlation that commonLossFactor used to supply per-line.
  poolYearFactor: { shape: 25, scale: 1 / 25 },

  // --- A6 risk-quality beta budget (total nominal 0.12) -------------------
  // Frequency channel is fully realized; the tier-mix and duration channels
  // are diluted by tier mix and by indemnity's share of severity.
  // Catastrophic probability is deliberately NOT affected by risk quality.
  rqFrequencyBeta: 0.08,   // theta_WC(RQ) = exp(-0.08 * (RQ - 5))
  rqTierMixDelta: 0.030,   // per point of (5 - RQ), on non-catastrophic tiers
  rqDurationBeta: 0.033,   // on temp/perm duration (~0.015 realized after dilution)

  // --- A2 tier mix --------------------------------------------------------
  // [medOnly, temp, perm, catastrophic] per rating class.
  tierProbabilities: {
    clerical:    { medOnly: 0.78, temp: 0.20, perm: 0.019, catastrophic: 0.0005 },
    publicWorks: { medOnly: 0.68, temp: 0.26, perm: 0.057, catastrophic: 0.003 },
    police:      { medOnly: 0.60, temp: 0.30, perm: 0.095, catastrophic: 0.005 },
    fire:        { medOnly: 0.58, temp: 0.30, perm: 0.113, catastrophic: 0.007 },
  } as Record<WcClassKey, Record<WcTier, number>>,

  // Severity-ordering scores for the risk-quality tier tilt: worse risk
  // quality shifts weight toward the higher-score (costlier) tiers.
  tierMixScores: { medOnly: 0, temp: 1, perm: 2 } as Record<'medOnly' | 'temp' | 'perm', number>,

  // --- Dollar vintage: trend rates and the one discount rate -------------
  // Severity is DRAWN and STORED in accident-year dollars; these carry a
  // payment forward to its settlement year (trendToSettlement). Medical and
  // wage inflation are kept as SEPARATE rates deliberately — collapsing them
  // into one would assert an equality between medical and wage inflation that
  // is false, and GL will need the same distinction for its own legs.
  medicalTrend: 0.06,    // medical leg of every tier, incl. the catastrophic annuity
  indemnityTrend: 0.035, // indemnity / wage-linked legs

  // The ONLY discounting done before Phase 3, and only for the catastrophic
  // tier. Short-tail tiers settle within a few years, so their trended-nominal
  // value is already within a rounding error of present value; the
  // catastrophic tier's ~34-year inflating stream diverges by roughly 2.5x
  // undiscounted, which makes an undiscounted nominal sum a meaningless number
  // to book. Phase 3 replaces this flat rate with proper reserve-cohort
  // discounting applied uniformly to every tier.
  catastrophicDiscountRate: 0.04,

  // --- A3 severity (accident-year dollars; lognormal mean + CV) -----------
  severity: {
    medOnly: { mean: 1800, cv: 1.0 },
    temp: { durationWeeksMean: 9, durationWeeksCv: 1.2, medicalMean: 16000, medicalCv: 1.5 },
    perm: { durationWeeksMean: 45, durationWeeksCv: 1.0, medicalMean: 65000, medicalCv: 1.8 },
  },

  // Average annual wage by class; the weekly indemnity benefit is
  // min(2/3 x weekly wage, statutory cap).
  classAnnualWage: { clerical: 62_000, publicWorks: 58_000, police: 85_000, fire: 82_000 } as Record<WcClassKey, number>,
  indemnityWageReplacement: 2 / 3,
  // A visible policy lever, INTENTIONALLY NON-BINDING at current wages: the
  // binding weekly benefit tops out at ~$1,090 (police), well under this cap.
  // It exists to be turned into a constraint later — by wage inflation, by a
  // high-wage class, or by a deliberate scenario change — not to bite today.
  statutoryWeeklyCap: 1450,

  // --- A4 catastrophic tier (an inflating annuity, not a single draw) -----
  // Frequency note: the design text says "~5-6/yr", but the tierProbabilities
  // table above implies 2.97/yr on the canonical roster (0.04 clerical + 1.53
  // publicWorks + 0.40 police + 1.01 fire). The table is the operative
  // parameter; the "5-6" text is stale and is not asserted anywhere.
  catastrophic: {
    ageMin: 25,
    ageMax: 55,
    // Disability-adjusted remaining life: (lifeExpectancyAge - age) x
    // disabilityAdjustment. A closed-form PROXY standing in for a mortality
    // table — deliberately simple, and the only place a table would be needed.
    lifeExpectancyAge: 80,
    disabilityAdjustment: 0.85,
    medicalFirstYear: 180_000,
    retirementAge: 65, // indemnity runs to here, medical runs for life
    // The medical leg escalates at medicalTrend and the indemnity leg at
    // indemnityTrend (above) — the tier no longer carries its own hardcoded
    // inflation rate.
  },

  // --- A5 presumption claims (police/fire occupational disease) -----------
  // A separate process with a long report lag: the hook for a retroactive
  // legislative shock. theta_WC(RQ) is deliberately NOT applied — presumption
  // exposure is statutory, not a function of how well the member is run.
  presumption: {
    ratePer1MPoliceFire: 0.06, // ~10 claims/yr pool-wide on the canonical roster
    reportLagYearsMean: 8,
    reportLagYearsCv: 0.8,
    // The lag distribution is TRUNCATED AND RENORMALISED here — mandatory, not
    // a tuning choice. Severity is trended forward over the lag at
    // medicalTrend, and E[(1 + medicalTrend)^lag] for an unbounded lognormal
    // lag is mathematically DIVERGENT (the lognormal's tail decays more slowly
    // than the exponential grows), so expected severity has no finite value
    // and the draw admits absurd claims — an uncapped 100-year lag books a
    // $119M claim, which a long harness will eventually produce.
    //
    // 40 years covers a defensible worst case (exposure at ~22, latent
    // occupational disease at ~62) and keeps the long-latency cancer and
    // asbestos claims that make presumption a real policy issue. The book is
    // insensitive to the exact bound (20y-60y moves it ~3%), so the choice is
    // made on defensibility rather than on scale.
    maxReportLagYears: 40,
    severityMean: 350_000,
    severityCv: 1.5,
  },

  // --- A7 payout patterns (data for Phase 3 reserving; nothing reads them yet)
  // Fractions of the claim paid in years 1..n after the accident year.
  // Catastrophic uses its own annuity schedule instead. Presumption is
  // recognized at report and then pays out like perm.
  payoutPatterns: {
    medOnly: [0.90, 0.10],
    temp: [0.60, 0.30, 0.10],
    perm: [0.35, 0.25, 0.20, 0.12, 0.08],
  } as Record<'medOnly' | 'temp' | 'perm', number[]>,

  // Geographic severity multiplier, indexed by member.region - 1 (regions
  // 1-5). A direct lookup, not interpolated.
  regionMultiplier: [0.92, 0.97, 1.03, 1.08, 1.12],
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
// Single-regime model: one normal draw per class per year, minus a fee.
// Means/SDs are GROSS of fees and are whole-period historical values that
// already include crash years — there is deliberately NO separate downside
// regime (that would double-count the downside; market crashes are the Phase 4
// shock-event system's job). minReturn/maxReturn are inert sanity rails only —
// wide enough (3.4σ+) that they essentially never fire; they exist to prevent
// nonsense like a sub−100% draw producing negative invested assets, not to
// shape the distribution.
export interface AssetClassAssumption {
  expectedReturn: number;      // gross annual mean
  standardDeviation: number;   // gross annual SD
  feeRate: number;             // subtracted from every draw (net = draw − fee)
  minReturn: number;           // net clamp floor (sanity rail)
  maxReturn: number;           // net clamp ceiling (sanity rail)
}

export const ASSET_CLASS_ASSUMPTIONS: Record<'cash' | 'bonds' | 'equities', AssetClassAssumption> = {
  cash: {
    expectedReturn: 0.0419,
    standardDeviation: 0.0040,
    feeRate: 0.00040,
    minReturn: 0.0,
    maxReturn: 0.08,
  },
  bonds: {
    expectedReturn: 0.0520,
    standardDeviation: 0.0404,
    feeRate: 0.00124,
    minReturn: -0.20,
    maxReturn: 0.25,
  },
  equities: {
    expectedReturn: 0.0826,
    standardDeviation: 0.1825,
    feeRate: 0.00124,
    minReturn: -0.60,
    maxReturn: 0.70,
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

// Per-line opening capital (seed-fix-per-line-opening): each active line's
// opening surplus = this multiple × that line's own opening premium. Config-
// independent by construction (depends only on the line's own premium), which
// replaces the old net-reserve-weighted split of a single shared pot.
// Tuned (investment-and-opening-tuning) so the 3-year pre-game typically lands
// each line's Year-1 opening inside its OPENING_MULTIPLE_BAND below; the
// two-sided pre-game redraw is the guarantee, these are the primary mechanism.
export const STARTING_CAPITAL_TO_PREMIUM: Record<string, number> = {
  WC: 0.70,
  GL: 0.45,
  Property: 0.18,
};

// Pre-game acceptance band (per line): the line's Year-1 opening surplus must
// land within [min, max] × that line's own Required Reserve Margin, or its
// pre-game redraws on its own derived seed. PER-LINE on purpose — checking at
// pool level would reintroduce config-dependence. Property's band is higher
// because Required Reserve Margin measures RESERVE risk, structurally small
// for a short-tail line (margin ≈ 0.64× premium vs WC's 1.16×); Property's
// real exposure is catastrophe/underwriting risk that the margin metric
// doesn't capture, so it must hold a larger multiple of that small margin to
// carry comparable surplus against its premium.
export const OPENING_MULTIPLE_BAND: Record<string, { min: number; max: number }> = {
  WC: { min: 1.35, max: 2.0 },
  GL: { min: 1.35, max: 2.0 },
  Property: { min: 2.0, max: 3.0 },
};

// Starting enrollment per line: each active line independently enrolls members
// (seeded random order) until its enrolled exposure reaches this share of the
// market's TOTAL exposure for that line (WC payroll / GL payroll / Property
// TIV). The exposure target drives the member count, not the other way around.
export const STARTING_EXPOSURE_SHARE = { min: 0.25, max: 0.35 };

// The actual market totals (member count, per-line exposure) are derived from
// the canonical roster itself — see MARKET_MEMBER_COUNT and
// MARKET_TOTAL_EXPOSURE in memberCatalog.ts. The old hand-maintained
// TOTAL_MARKET_MEMBERS / TOTAL_MARKET_EXPOSURE constants displayed stale
// values and had no engine consumer; they were removed with the canonical
// roster ingestion.

// Each member's WC payroll splits across four rating classes as an exact,
// permanent function of its entity Type (fractions sum to 1.0 per type). The
// canonical roster's WC_* dollar columns are round(fraction x payroll, 4) —
// verified at generation time by scripts/tools/generate-member-catalog.ts to
// reproduce every CSV cell within $100. Intentionally NOT stored per member.
export const WC_CLASS_MIX: Record<string, { clerical: number; publicWorks: number; police: number; fire: number }> = {
  City:                  { clerical: 0.35, publicWorks: 0.30, police: 0.22, fire: 0.13 },
  County:                { clerical: 0.45, publicWorks: 0.25, police: 0.20, fire: 0.10 },
  'Fire District':       { clerical: 0.08, publicWorks: 0.04, police: 0.00, fire: 0.88 },
  'Park District':       { clerical: 0.30, publicWorks: 0.70, police: 0.00, fire: 0.00 },
  'Recreation District': { clerical: 0.45, publicWorks: 0.55, police: 0.00, fire: 0.00 },
  'School District':     { clerical: 0.70, publicWorks: 0.28, police: 0.02, fire: 0.00 },
  'Special District':    { clerical: 0.50, publicWorks: 0.50, police: 0.00, fire: 0.00 },
  'Transit Authority':   { clerical: 0.25, publicWorks: 0.75, police: 0.00, fire: 0.00 },
  'Water District':      { clerical: 0.30, publicWorks: 0.70, police: 0.00, fire: 0.00 },
};

// GL sub-line loss relativities, likewise an exact, permanent function of
// entity Type (matches the canonical roster's GL_* columns cell-for-cell —
// verified at generation time). Relativities, not dollars: the future claim
// generator applies them against the member's payroll exposure.
export const GL_RELATIVITIES: Record<string, { general: number; epl: number; lawEnforcement: number; abuse: number }> = {
  City:                  { general: 1.1, epl: 1.0, lawEnforcement: 1.00, abuse: 0.6 },
  County:                { general: 1.0, epl: 1.1, lawEnforcement: 1.00, abuse: 0.8 },
  'Fire District':       { general: 0.9, epl: 0.9, lawEnforcement: 0.05, abuse: 0.2 },
  'Park District':       { general: 1.0, epl: 0.8, lawEnforcement: 0.05, abuse: 1.6 },
  'Recreation District': { general: 1.0, epl: 0.8, lawEnforcement: 0.05, abuse: 1.9 },
  'School District':     { general: 0.9, epl: 1.1, lawEnforcement: 0.10, abuse: 1.8 },
  'Special District':    { general: 0.9, epl: 1.0, lawEnforcement: 0.05, abuse: 0.4 },
  'Transit Authority':   { general: 1.6, epl: 1.0, lawEnforcement: 0.10, abuse: 0.3 },
  'Water District':      { general: 0.8, epl: 1.2, lawEnforcement: 0.00, abuse: 0.1 },
};

// Starting rate per $100 payroll range
export const STARTING_RATE_PER_100 = { min: 5.00, max: 10.00 };

// GL (General Liability) starting assumptions. GL shares WC's payroll exposure
// base. Calibrated so GL is a substantial ~$7-10M-premium line: the rate was
// scaled ×5 (from 1.50-3.00 to 7.50-15.00 per $100 payroll). Loss cost per
// exposure = rate × expected-loss-ratio, so scaling the rate scales the loss
// cost by the same factor — GL's loss ratio is unchanged (a bigger book at the
// same profitability, not a margin change).
export const GL_STARTING_RATE_PER_100 = { min: 7.50, max: 15.00 };
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
// Property book is a substantial third line rather than a rounding error.
// Applied at module load in memberCatalog.ts (each member's baked unscaledTiv
// × this constant), so it remains a live knob — changing it rescales every
// member's TIV proportionally without regenerating the catalog. Rate and loss
// ratio are unchanged, and losses are exposure-proportional (mean loss = TIV ×
// purePremiumPer100 × 10,000), so scaling TIV scales premium and losses
// together — the loss ratio is invariant, and so is the enrolled roster (the
// exposure-targeted enrollment boundary scales identically).
//
// 16 recalibrates for the canonical 200-member roster, preserving the OLD
// catalog's RELATIVE Property share: aggregate TIV / aggregate payroll stays
// ~50x (old: $13,719M TIV on $271.96M payroll at scale 7; canonical unscaled
// TIV totals $3,996.25M on $1,300M payroll, and 16.41 restores the 50.44x
// ratio — rounded to 16), so Property's premium keeps its ~80%-of-WC relative
// weight as the whole game scales up, rather than shrinking to a sliver.
export const PROPERTY_TIV_SCALE = 16;

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
