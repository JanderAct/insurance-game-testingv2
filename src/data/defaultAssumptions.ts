// Centralized assumptions for Risk Pool Simulation v1
// V2: Allow admin-editable assumptions from a backend config

import type { Region } from '../types/simulation';

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

  // Geographic severity multiplier, keyed by the roster's authored Region.
  //
  // MEAN-NEUTRAL BY CONSTRUCTION: the three factors average exactly 1.00 at
  // equal assignment probability, so region redistributes severity between
  // members without moving the book's expected severity. The superseded 5-region
  // array [0.92, 0.97, 1.03, 1.08, 1.12] under weights 10/20/40/20/10 had a
  // weighted mean of 1.026 — region was silently adding 2.6% to every WC
  // severity, which the pure premium then absorbed as if it were pure risk.
  regionMultiplier: { North: 0.95, Central: 1.00, South: 1.05 } as Record<Region, number>,
};

// ===========================================================================
// GENERAL LIABILITY claim-level loss model (design doc Part B).
//
// The second line converted to individual claims, on the WC architecture:
// matched draw/analytic-expectation pair, RC on the draw only, held pure
// premium + annual k_GL, accident-year dollars with trendToSettlement as the
// only vintage conversion, shared ctx.gPool (GL does not draw its own
// aggregate factor). What is genuinely new versus WC: the liability GATE
// (latent claim strength decides IF a claim pays, correlated with how much),
// litigation-stage-keyed ALAE, per-claim settlement timing driving per-claim
// severity trend, a Pareto tail on law enforcement, multi-claimant abuse
// occurrences, and the stateLaw/federal1983 cap flag.
// ===========================================================================

export const GL_SUB_KEYS = ['general', 'epl', 'lawEnforcement', 'abuse'] as const;
export type GlSubKey = (typeof GL_SUB_KEYS)[number];

export const GL_LITIGATION_STAGES = ['closedOnInvestigation', 'settledPreSuit', 'suitDiscoverySettle', 'triedToVerdict'] as const;
export type GlLitigationStage = (typeof GL_LITIGATION_STAGES)[number];

// Social inflation: ONE shared severity trend across GL's four sub-coverages,
// applied through the standard accident-year-dollars + trendToSettlement
// convention (indemnity AND ALAE — defense costs ride the same tort
// environment). GL-INTERNAL for now: it is not pool-wide and does not touch
// WC. HOOK, NOT BUILT: a future shock-event system may replace this constant
// with a cross-line inflation regime (which is exactly what would reprice
// prior accident years retroactively); nothing here anticipates that beyond
// keeping the rate a single named constant.
export const GL_SOCIAL_INFLATION = 0.07;

// Statutory damages cap for state-law claims — ILLUSTRATIVE value, a policy
// lever like WC's weekly cap. Applies to INDEMNITY ONLY (statutory caps bound
// damages, not defense costs), and only to claims flagged stateLaw; a
// federal1983 claim is uncapped, which is why law enforcement owns the tail.
// Consumed by the retention-waterfall phase, not by claim generation — claims
// carry the flag from birth so the waterfall can apply cap -> retention ->
// reinsurance in order.
export const GL_STATUTORY_CAP = 1_000_000;

export const GL_LOSS_MODEL = {
  // --- B1 frequency --------------------------------------------------------
  // lambda_sub = basePayroll x weight(GL_RELATIVITIES) x rate x theta_GL(RQ)
  //              x k_GL x epsilon x gPool.
  // Payroll bases: general/epl/abuse use the member's TOTAL payroll;
  // lawEnforcement uses POLICE payroll (WC_CLASS_MIX[type].police x payroll).
  // No frequency trend — flat by design (WC's -1.5%/yr is WC-specific safety
  // improvement; GL frequency is not trending, its SEVERITY is, above).
  //
  // Full-market expected claims on the canonical roster: general ~897,
  // epl ~108, lawEnforcement ~13.3, abuse ~3.4 incidents. The design doc's
  // "~832 general" assumed a payroll-weighted mean relativity of 1.0; the
  // roster's actual mean is ~1.08, so 897 is the operative roster-derived
  // figure and 832 is a stale reference (ruled: rates verbatim, assert 897).
  ratePer1M: { general: 0.64, epl: 0.084, lawEnforcement: 0.21, abuse: 0.003 } as Record<GlSubKey, number>,

  // Per member-year frequency noise, mean 1 (SD ~0.35) — ONE draw per member
  // per year shared across the four sub-coverages (the literal design
  // reading). Wider than WC's k=16 because payroll is a looser GL predictor.
  memberFrequencyNoise: { shape: 8, scale: 1 / 8 },

  // --- B7 risk-quality channels (total realized beta ~0.084) ---------------
  rqFrequencyBeta: 0.055, // theta_GL = exp(-0.055 x (RQ - 5)), all subs
  // Gate-threshold shift per RQ point: worse RQ makes claims harder to
  // defend (higher pay rate). Moves the PAY RATE only — paid-claim severity
  // marginals stay the B3 distributions (ruled interpretation J9).
  rqGateGamma: 0.05,
  // NOTE deliberately skipped: an optional ~0.6 WC-GL theta correlation.
  // Both lines currently read the same member.riskQuality, which correlates
  // them at 1.0 already; a separate per-line RQ is a future refinement.

  // --- B2/B3 liability gate + severity (accident-year dollars) -------------
  // payRate at RQ 5; the gate threshold is t_sub = PhiInv(1 - payRate).
  // ALAE is drawn on EVERY claim (defense costs exist even when nothing is
  // paid); indemnity only when the latent strength clears the gate.
  subCoverages: {
    general: {
      payRate: 0.45,
      indemnity: { mean: 28_000, cv: 2.2 },
      alae: { mean: 5_000, cv: 1.5 },
      reportLag: { meanYears: 1.5, cv: 0.6, maxYears: 10 },
      federal1983Share: 0.075, // 92.5% state-law (ruled J7)
    },
    epl: {
      payRate: 0.38,
      indemnity: { mean: 105_000, cv: 1.9 },
      alae: { mean: 42_000, cv: 1.4 },
      reportLag: { meanYears: 2, cv: 0.6, maxYears: 12 },
      federal1983Share: 0.075,
    },
    lawEnforcement: {
      payRate: 0.30,
      // Bimodal: most paid LE claims are ordinary; 5% are the catastrophic
      // civil-rights tail (Pareto alpha 1.3 — infinite variance, finite mean
      // $4.33M). Component drawn first, gate quantile mapped within it (J8).
      indemnity: { mean: 85_000, cv: 1.5 },
      paretoTail: { weight: 0.05, xm: 1_000_000, alpha: 1.3 },
      alae: { mean: 70_000, cv: 1.6 },
      reportLag: { meanYears: 2, cv: 0.6, maxYears: 12 },
      federal1983Share: 0.60, // 60% plead section 1983 -> uncapped (given)
    },
    abuse: {
      payRate: 0.70,
      indemnity: { mean: 650_000, cv: 2.0 },
      alae: { mean: 150_000, cv: 1.2 },
      // 50y bound (ruled J1): 45y truncates 1.2% of mass exactly where the 7%
      // trend is steepest; 50y captures ~99.3% and matches what revival
      // statutes exist to do — reopen 50-year-old claims. Same
      // divergence-mandatory reasoning as WC presumption's 40y bound:
      // E[(1.07)^lag] over an UNBOUNDED lognormal lag has no finite value.
      reportLag: { meanYears: 15, cv: 0.6, maxYears: 50 },
      federal1983Share: 0.88, // "mostly uncapped" -> 88% (ruled J7)
    },
  } as Record<GlSubKey, {
    payRate: number;
    indemnity: { mean: number; cv: number };
    paretoTail?: { weight: number; xm: number; alpha: number };
    alae: { mean: number; cv: number };
    reportLag: { meanYears: number; cv: number; maxYears: number };
    federal1983Share: number;
  }>,

  // --- B4 litigation stages -------------------------------------------------
  // One stage per claim; the ALAE multiple applies to the sub's ALAE draw and
  // the settlement lag adds to the report lag (settlement = accident +
  // round(reportLag + stageLag), ruled J2). The tried-to-verdict stage with a
  // gate loss is the max-defense-cost-zero-indemnity case — deliberate.
  stageAlaeMultiple: { closedOnInvestigation: 0.3, settledPreSuit: 1.0, suitDiscoverySettle: 2.5, triedToVerdict: 6.0 } as Record<GlLitigationStage, number>,
  stageSettlementLagYears: { closedOnInvestigation: 0.5, settledPreSuit: 1.5, suitDiscoverySettle: 3, triedToVerdict: 5 } as Record<GlLitigationStage, number>,
  // epl and lawEnforcement skew toward discovery/verdict (ruled J4); abuse
  // uses the general vector (no design guidance — flagged micro-call).
  stageProbabilities: {
    general:        [0.45, 0.30, 0.20, 0.05],
    epl:            [0.25, 0.30, 0.30, 0.15],
    lawEnforcement: [0.30, 0.25, 0.30, 0.15],
    abuse:          [0.45, 0.30, 0.20, 0.05],
  } as Record<GlSubKey, number[]>,

  // --- abuse batch (the first multi-claim occurrence) -----------------------
  abuseBatch: {
    // Claimants per incident ~ Gamma-Poisson (NegBin) mean 5, dispersion r=2
    // (variance 17.5), truncated to >= 1 by reject-and-redraw — a 0-claimant
    // incident is a non-event (ruled J5). The truncation raises the realized
    // mean to mean/(1 - P0) with P0 = (r/(r+mean))^r — the analytic
    // expectation uses exactly that corrected mean.
    claimantMean: 5,
    claimantDispersion: 2,
    // Within-batch severity correlation via ONE shared occurrence-level
    // lognormal factor (mean 1) multiplying independent per-claimant
    // lognormals; the total CV 2.0 splits 50/50 in log-variance between the
    // shared and idiosyncratic components (ruled J6 — the harness REPORTS the
    // realized batch-total distribution so the plausibility of single-batch
    // size is a number, not a hope).
    logVarianceShare: 0.5,
  },
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
// member's TIV deliberately does NOT track its payroll closely. Rate per $100
// of TIV is much smaller than WC/GL's per-$100-payroll rate since TIV dollar
// amounts are much larger.
//
// TIV IS AUTHORED DATA as of roster v2: each member's value is a stored column
// of roster_canonical_v2.csv, totalling $5,250.8M (a blended 4.04x payroll).
// The former derivation — TIV_RANGES x TIV_TYPE_MULTIPLIER via the generator's
// tivFor(), then a PROPERTY_TIV_SCALE multiplier applied at module load — is
// deleted. There is no scale knob any more; to change Property's exposure,
// change the CSV.
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

// ===========================================================================
// PROPERTY loss model — ATTRITIONAL band only (design doc property_noncat
// section NC1). The cat and weather bands are recorded separately below and
// are INERT; only this block has a generator behind it.
//
// Property has three bands with different generative structures:
//   attritional — independent claims, routine loss plus the occasional large
//                 single-risk loss; owns the per-risk XoL layer      $16.8M
//   weather     — event -> zone -> footprint -> correlated claims     $4.5M
//   cat         — rare, severe, same event structure                  $7.5M
// Expected property loss is ~$28.8M in total, so ATTRITIONAL ALONE IS 58%.
// That is why Property is not cut over to its generator on the attritional
// band alone: a pure premium derived from 58% of eventual loss would price
// Property at 58% of its cost, and the loss ratio would break the moment
// weather and cat landed. Cutover happens once all three bands exist.
export const PROPERTY_LOSS_MODEL = {
  // Frequency is per STORED LOCATION, not per member and not off TIV. Location
  // count is a physical fact about a member; 1,866 locations x 0.06 = ~112
  // claims/yr pool-wide.
  baseFrequencyPerLocation: 0.06,

  // FLAT by design (NC1.1). Attritional property frequency carries no trend —
  // climate drift belongs to the weather band and, ultimately, a shock layer.
  frequencyTrendPerYear: 0,

  // Poisson, NOT negative binomial. Correlated lumpy variance is deliberately
  // quarantined into the weather and cat bands, which leaves attritional close
  // to genuinely independent. Do not "improve" this to NegBin — the band's job
  // is to be the stable one.
  //
  // eps is the per-member-year frequency noise: Gamma(k, 1/k) with SD 1/sqrt(k).
  // k = 44.4 gives SD 0.15 — MUCH tighter than WC's k=16 (SD 0.25) or GL's k=8
  // (SD 0.354), because this band is genuinely stable.
  memberFrequencyNoise: { shape: 44.4, scale: 1 / 44.4 },

  // Damage ratio, mean-concentration parameterization: a = mu*nu,
  // b = (1-mu)*nu. mu 0.04 / nu 2 -> Beta(0.08, 1.92): J-shaped, median ~1%,
  // mean 4%, thin tail toward total loss. Severity is damageRatio x the HIT
  // LOCATION's TIV, so it is capped at insured value by construction.
  //
  // NOTE a < 1: the density is unbounded at zero. Verify anything derived from
  // this distribution by closed form or Monte Carlo, never by fixed-grid
  // quadrature (see SeededRandom.beta and expectedOverLognormal).
  damageRatio: { mean: 0.04, concentration: 2 },

  // RQ channels, total beta 0.12 -> ~3.3x worst-to-best.
  //   frequency: housekeeping, electrical, inspections
  //   severity:  sprinklers, suppression — scales the Beta MEAN only, nu fixed,
  //              so RQ acts on the DAMAGE RATIO and never on the dollar amount.
  //              That is what preserves the insured-value cap.
  rqFrequencyBeta: 0.08,
  rqSeverityBeta: 0.04,

  // Short-tailed: reported the year it happens, paid out over three.
  reportLagYears: 0,
  payoutPattern: [0.70, 0.25, 0.05],

  // Construction cost inflation, applied through the standard accident-year
  // -> settlement convention (patternTrendFactor over the payout vector), the
  // same machinery WC's non-catastrophic tiers use. No second trending
  // convention.
  severityTrendPerYear: 0.04,

  // Per-risk XoL retention. Confirmed at v3 by four independent simulations
  // (1.77 / 1.78 / 1.78 / 1.77 breaches per year, 1.58% of attritional claims).
  // The treaty is alive ONLY through within-member concentration: at a flat
  // ~$3.75M average location almost no damage ratio breaches $2M, but Primary
  // Asset Share concentrates each member's TIV into one dominant site (largest
  // single location $93.5M). Flatten Primary Asset Share and the treaty dies.
  perRiskRetention: 2_000_000,
};

// ===========================================================================
// PROPERTY CAT and WEATHER parameters — INERT.
//
// NOTHING READS THESE. They are recorded now so the weather and cat bands have
// their calibration ready, and so the numbers live in the repo rather than in
// a chat attachment. Full derivation: docs/PROPERTY_CAT_ENGINE_DESIGN.md and
// docs/PROPERTY_NONCAT_DESIGN.md.
//
// ⚠ EVERY mu BELOW IS A NUMERIC SOLVE AGAINST A TARGET AAL, NOT A CLOSED FORM.
// Intensity enters the event TWICE — once through the footprint
// (hit_rate = min(base_footprint x intensity, cap)) and once through the damage
// ratio (event_mean_dr = mu x intensity) — so expected loss per event scales
// with E[I^2] = 1 + CV^2, not E[I]^2 = 1. A closed-form mu/(1+CV^2) correction
// does NOT land either, because the footprint cap interacts with the intensity
// draw (quake especially: cap 0.95 binds often at CV 1.1). These values were
// solved by simulation against each peril's target AAL holding lambda,
// base_footprint, cap and CV fixed.
//
// RE-SOLVE mu IF lambda, base_footprint, cap OR CV MOVES — and if the roster
// moves, since the solve is against v3's TIV and zone structure. Unlike the WC
// and GL pure premiums, these do NOT recompute themselves.
//
// Target AALs: flood $2.90M / wildfire $2.71M / earthquake $1.87M
// = $7.47M cat total AT v3 TIV, plus weather $9.20M at v4 TIV (see
// PROPERTY_WEATHER_MODEL.targetAal, which has been rescaled; the cat targets
// have NOT been, and are still v3 figures).
export const PROPERTY_CAT_MODEL = {
  flood:      { lambda: 0.70,  baseFootprint: 0.15, cap: 0.60, intensityCv: 0.7, betaMean: 0.00818, betaConcentration: 1.5, targetAal: 2_900_000 },
  wildfire:   { lambda: 0.80,  baseFootprint: 0.20, cap: 0.70, intensityCv: 0.5, betaMean: 0.00582, betaConcentration: 2.5, targetAal: 2_710_000 },
  earthquake: { lambda: 0.045, baseFootprint: 0.40, cap: 0.95, intensityCv: 1.1, betaMean: 0.02532, betaConcentration: 1.5, targetAal: 1_870_000 },

  // Events draw a region by hazard weight. This is the ONLY thing that
  // differentiates the three regions — zone TIV is near-even (2513.9 / 2400.2 /
  // 2079.2), so uniform weights would make geography decorative.
  hazardWeights: {
    flood:      { North: 0.30, Central: 0.25, South: 0.45 },  // South = coastal/riverine
    wildfire:   { North: 0.45, Central: 0.35, South: 0.20 },  // North = WUI / dry interface
    earthquake: { North: 0.25, Central: 0.45, South: 0.30 },  // Central = fault proximity
  } as Record<'flood' | 'wildfire' | 'earthquake', Record<Region, number>>,

  // Earthquake ALONE can span two ADJACENT regions under one occurrence id;
  // flood and wildfire are always single-region. North<->Central and
  // Central<->South are adjacent; NORTH AND SOUTH NEVER CO-OCCUR.
  //
  // A quake drawing Central engages one neighbour (50/50) with this
  // probability, giving 0.45 x 0.35 = 0.1575 extra zone-equivalents. The quake
  // AAL only reconciles WITH this: 0.045 x 0.40 x $2,331M x 2.532% is ~$1.05M
  // single-zone, and reaching $1.87M requires the span. A naive re-derivation
  // that omits it will look wrong — the span is load-bearing.
  earthquakeSpan: { probability: 0.35, adjacency: { North: ['Central'], Central: ['North', 'South'], South: ['Central'] } },

  // Two-layer structure. The occurrence limit is LIVE, not decorative.
  occurrenceAttachment: 5_000_000,
  // ⚠ $1B BINDS AT v3 TIV — do NOT assert it never fires. A two-region quake
  // exposes up to ~$4,662M (2x the average zone; the worst actual pair,
  // North+Central, is $4,914M), simulated span-quakes reach ~$2,224M, and
  // ~0.175% exceed $1B. Above the limit THE POOL RE-RETAINS THE EXCESS — a
  // genuine tail exposure and a real reason the aggregate matters.
  occurrenceLimit: 1_000_000_000,
  aggregateStopMultiple: 1.75,   // x expected annual retained; finite by default
};

export const PROPERTY_WEATHER_MODEL = {
  // PER-ZONE Poisson: each of the three zones draws its own count at 2.5, for
  // 7.5 events/yr pool-wide. This is the ruled reading of NC2.1, which also
  // contained a contradictory "draw a zone by weather hazard weight" line —
  // two different mechanisms, and per-zone is the one that reproduces both
  // 7.5 events/yr and the $4.5M target. That line is deleted, not implemented.
  lambdaPerZone: 2.5,
  baseFootprint: 0.10,
  cap: 0.50,
  intensityCv: 0.6,
  betaMean: 0.00189,        // numeric solve — see the warning above, and mu IS UNCHANGED below
  betaConcentration: 4.0,   // lighter tail than cat

  // TARGET AAL AT ROSTER v4 — rescaled from the v3 figure of $4.50M.
  //
  // mu IS UNCHANGED AND WAS NOT RE-SOLVED, which is the one case where the
  // "re-solve mu if the roster moves" warning above does not bite. Weather AAL
  // is EXACTLY LINEAR IN ZONE TIV: locations are hit by independent per-location
  // Bernoulli draws at hit_rate, so expected affected TIV is hit_rate x zone TIV
  // whatever the size mix, and expected loss per event is
  // hit_rate(I) x mu x I x zoneTIV. Nothing in that expression depends on the
  // TIV level, so AAL = C x mu x TIV: double the TIV and the target doubles at
  // the same mu. (Cat is NOT in this position — it draws its zone by hazard
  // weight, so its AAL depends on a hazard-weighted TIV mix, and roster v4
  // rescaled the three zones by different factors: 2.0045 / 2.0168 / 2.1277.
  // Cat's targets above are still v3 and its mu WILL need re-solving.)
  //
  // The rescale: 4.50M x 14,303.6 / 6,993.3 = 4.50M x 2.045325 = $9.204M.
  //
  // ⚠ THIS IS $9.204M, NOT the $9.26M quoted in the plan this work was approved
  // against. That figure does not reconcile against the linear identity above
  // (it would require a v3 TIV of $6,951M rather than the actual $6,993.3M).
  // The derived value is used here because it is the one the identity yields.
  // Difference 0.6%, far inside any verification gate, but an anchor mu is
  // solved against should be exactly derivable.
  targetAal: 9_204_000,

  // ⚠ WEATHER HAS NO REGIONAL HAZARD DIFFERENTIATION. Every zone draws the
  // same expected event count, so loss varies by zone ONLY through TIV
  // (v4: North $5,039.0M / Central $4,840.6M / South $4,423.9M, summing to the
  // book's $14,303.5M; these were $2,513.9M / $2,400.2M / $2,079.2M at v3). No
  // weather hazard table exists in either design doc. If differentiation is
  // wanted later it needs its OWN table — do NOT borrow flood's, which encodes
  // coastal/riverine exposure rather than storm frequency.
  regionalHazardDifferentiation: null,

  // RQ: frequency LOCKED (hazard is nature's, not the member's); RQ affects the
  // damage ratio only. Development 80/20 over two years.
  rqFrequencyBeta: 0,
  rqSeverityBeta: 0.04,
  payoutPattern: [0.80, 0.20],
};
