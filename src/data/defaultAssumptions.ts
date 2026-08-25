// Centralized assumptions for Risk Pool Simulation v1
// V2: Allow admin-editable assumptions from a backend config

import type { Region, CoverageLine } from '../types/simulation';

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
// WORKERS' COMPENSATION claim-level loss model.
//
// PER-RATING-GROUP LOGNORMAL MIXTURES, fitted to the pool's own claim
// severities by EM, with per-group weights solved against the pool's own
// layered rate table. This REPLACED a four-tier structure (medical-only /
// temporary / permanent / catastrophic) whose ~65 parameters were authored as
// domain-judgment estimates and then fitted to each other over three rounds of
// calibration — internally consistent, externally unvalidated. This model is
// the first independent measurement of the book in this project.
//
// Three model-wide conventions:
//
// 1. ONE LOSS AMOUNT PER CLAIM. There are no tiers, no wage/medical legs, and
//    no annuity. A claim draws a mixture component, then a severity from that
//    component. The medical / indemnity / impairment split is GONE — it needed
//    tiers to exist. Consequences are recorded in CALIBRATION_FINDINGS.
//
// 2. NO SEVERITY TREND, AND THEREFORE NO VINTAGE PROBLEM. A claim's amount is
//    fixed at draw. The retired model carried separate 6.0% medical and 3.5%
//    indemnity trends and a single vintage-conversion point; with a report lag
//    now in the model, trending severity over the lag would make
//    E[(1+r)^lag] over an unbounded lognormal DIVERGENT — which is exactly why
//    the retired presumption process had to truncate its lag at 40 years. Not
//    trending removes the divergence, removes the truncation, and leaves the
//    severity fit as fitted.
//
// 3. FREQUENCY TREND IS A DECLINE AND THE PRICE NOW TRACKS IT. The pick is still
//    DERIVED ONCE from the neutral-book expectation and held; the pricing step
//    then multiplies it by wcFrequencyTrend(yearNumber), so the rate falls 1.5%
//    a year alongside the draw. Over a ten-year game the WC rate declines ~13%.
//
//    ⚠ THIS PARAGRAPH USED TO SAY THE PRICE DELIBERATELY DID NOT TRACK IT
//    ("unchanged from the retired model"), and that was a real defect wearing a
//    documented-intent label. The draw trended and the price did not, so losses
//    ran below the priced level BY CONSTRUCTION and the gap compounded: 93.5% of
//    expected averaged over ten years, turning an expected 100.0% combined ratio
//    into a measured 93.9%. It was inherited from the retired tier model rather
//    than chosen for this one. Do not restore it.
//
//    The held-pure-premium rule is intact. It forbids RE-DERIVING the pick each
//    year, which would double-correct against k_line and make pricing chase the
//    roster; a factor that is a pure function of the year cannot do either.
// ===========================================================================

// RETAINED IN FULL — the police column is GL law-enforcement's exposure base
// (GL_LOSS_MODEL.ratePer1M.lawEnforcement is applied to WC_CLASS_MIX[type].police
// x payroll), and keeping all four columns avoids touching the roster file.
// WC ITSELF NO LONGER READS THIS TABLE for loss generation: rating groups
// (below) replaced rating classes. See WC_RATING_GROUP_BY_TYPE for the one
// remaining WC-side use, which is group assignment, not class payroll.
export const WC_CLASS_KEYS = ['clerical', 'publicWorks', 'police', 'fire'] as const;
export type WcClassKey = (typeof WC_CLASS_KEYS)[number];

// --- Rating groups ---------------------------------------------------------
//
// Four groups replace the four rating classes. A member's group is a STORED
// per-member attribute (Member.wcRatingGroup, assigned in memberCatalog.ts),
// NOT a derived one — and that is load-bearing, not a style choice.
//
// ⚠ WHY IT CANNOT BE DERIVED. WC_CLASS_MIX is an exact function of entity
// type, so every one of the 32 cities carries a safety share of exactly 0.3500
// (verified across the roster, spread 0.0001). Any threshold rule therefore
// selects either all 32 cities or none. A 40%-safety threshold picks out the
// 16 Fire Districts and nothing else (County 0.30, School 0.02, the other six
// types 0.00). The eight High Safety cities are genuinely additional
// information about which cities run their own police and fire departments,
// and they have to be written down.
export const WC_RATING_GROUPS = ['county', 'schools', 'highSafety', 'lowSafety'] as const;
export type WcRatingGroup = (typeof WC_RATING_GROUPS)[number];

// Group by entity type, for the types where type alone decides it. City is
// deliberately ABSENT: a city is High Safety or Low Safety depending on whether
// it appears in WC_HIGH_SAFETY_CITIES below, and nothing else distinguishes
// them. Leaving City out of this table rather than defaulting it makes the
// lookup fail loudly if the stored-city list is ever lost.
export const WC_RATING_GROUP_BY_TYPE: Record<string, WcRatingGroup> = {
  County: 'county',
  'School District': 'schools',
  'Fire District': 'highSafety',
  'Park District': 'lowSafety',
  'Recreation District': 'lowSafety',
  'Special District': 'lowSafety',
  'Transit Authority': 'lowSafety',
  'Water District': 'lowSafety',
};

// THE EIGHT HIGH SAFETY CITIES — STORED DATA, NOT A DERIVATION.
//
// Chosen by a size-tilted random draw (payroll^0.55, seed 20260814) constrained
// to put High Safety between 18% and 22% of combined Low+High payroll; the
// result is 19.4%. They span size ranks 1, 2, 3, 4, 13, 19, 22 and 22 of 32 —
// deliberately NOT the eight largest, because a small city in the right area
// runs its own department too.
//
// Matched by member NAME, which is stable: the canonical roster is permanent
// and never regenerated (memberCatalog.ts header). The assignment is asserted
// to select exactly these eight, and to survive a save/load round trip, in
// scripts/diagnostics/wc-severity-rebuild-check.ts.
export const WC_HIGH_SAFETY_CITIES: ReadonlySet<string> = new Set([
  'Harbor City 192',
  'Glenmoor City 062',
  'Fairmont City 080',
  'Harbor City 064',
  'Ridgeway City 180',
  'Brookhaven City 160',
  'Summit City 036',
  'Cedar Falls City 010',
]);

// --- Severity mixture components -------------------------------------------
//
// LOG-SCALE parameters: a draw is exp(Normal(mu, sigma)). Components are
// SHARED ACROSS GROUPS (except Schools' second) and only the WEIGHTS differ.
// That is deliberate physics: a catastrophic injury costs roughly the same
// whoever employs the person, but a firefighter is far more likely to suffer
// one. Scaling mu by group instead would put High Safety's ceiling at $67M and
// County's at $36M, which is wrong.
export interface WcSeverityComponent {
  mu: number;
  sigma: number;
}

export const WC_SEVERITY_COMPONENTS = {
  // FITTED (EM on the pool's claim severities). Median $308, mean $489, CV 1.23.
  small: { mu: 5.731549, sigma: 0.960883 },
  // FITTED (EM). Median $1,753, mean $2,974, CV 1.37.
  medium: { mu: 7.469014, sigma: 1.028369 },
  // ⚠⚠ ASSERTED, NOT FITTED. Median $13,064, mean $96,529, CV 7.32.
  //
  // The EM fit produced mu 10.653133, sigma 1.243817 (median $42,325, mean
  // $91,736, CV 1.92). THAT IS NOT WHAT THIS IS, and it must not be "corrected"
  // back to the fit. The fitted component cannot produce large claims: its
  // practical maximum over a 50-year game is about $5.3M and it reaches $9.8M
  // roughly once per 431 years. THE POOL HAS OBSERVED CLAIMS IN THE $45-50M
  // RANGE, so the fitted tail understates reality — consistent with the fit
  // having been run on paid or capped amounts rather than developed-to-ultimate
  // values (recorded as an open item; it decides whether this is a correction
  // or an override).
  //
  // Re-specified to reach $47M about once per century pool-wide, HOLDING the
  // $1M-limited loss costs fixed at the pool's supplied rates — so the change
  // moves the tail without moving the priced layer.
  //
  //                 fitted      asserted
  //   mu            10.653133   9.4776
  //   sigma          1.243817   2.00
  //   mean          $91,736     $96,529
  //   CV             1.92       7.32
  //   loss > $1M     9.1%       26.0%
  //   1-in-50yr      $5.3M      $33.8M
  //   1-in-100yr     $6.5M      $47.0M
  //
  // WHAT WOULD DISPLACE IT: the same EM fit run on large claims developed to
  // ultimate, or a separate tail fitted to the known catastrophic claims.
  //
  // ⚠ THE TAIL NOW HAS A CEILING — WC_SEVERITY_CAP, below. This note used to
  // read "THE TAIL HAS NO CEILING... recorded as an open item, deliberately not
  // imposed here." That open item is closed; the cap is $85M and its basis is
  // written at the constant.
  large: { mu: 9.4776, sigma: 2.00 },
  // ASSERTED. Schools' second component. Median $5,363, mean $27,100, CV 3.51.
  // Schools has TWO components by design — a school district does not generate
  // the catastrophic-injury tail that a public-works or safety group does.
  schoolsMedium: { mu: 8.5873, sigma: 1.80 },
} as const satisfies Record<string, WcSeverityComponent>;

// ============================================================================
// WC SEVERITY CAP — the ceiling on a single claim.
//
// ⚠ THE ANCHOR IS THE POOL'S OWN OBSERVED MAXIMUM, which is why this is the
// best-evidenced of the three caps rather than the loosest. WC_SEVERITY_COMPONENTS
// .large records that THE POOL HAS OBSERVED CLAIMS IN THE $45-50M RANGE — that
// observation is the entire reason that component was ASSERTED rather than
// fitted, since the EM fit topped out near $9.8M once per 431 years and could
// not produce what the pool had actually seen. So the cap is set against a real
// maximum, not against a modelled one.
//
// $85M is 1.8x that observed $47M, THE SAME MULTIPLE PROPERTY USED against its
// scaled $42M. GL's $100M is deliberately NOT the reference: it has no stated
// multiple behind it (its own note says "a public-entity liability claim
// distribution with observed maxima" would displace it), so copying its number
// onto a line that HAS a real anchor would discard the better evidence.
//
// WHAT IT FIXES — three symptoms of one fact, that the mixture was unbounded:
//
//   THE DRAW. The model produced a $248.84M claim. At 1-in-5,228 full-market
//   years that is EXPECTED rather than anomalous — it is what an unbounded
//   lognormal with sigma 2.00 does — but it is 5x anything the pool has seen.
//
//   THE AGGREGATE STOP-LOSS HAD NOTHING ABOVE IT. With all layers declined WC's
//   aggregate tops out at $36.59M against unbounded severity; even fully
//   purchased the tower reaches $50M and the pool retains above that without
//   limit. retainedOccurrenceMoments carried `Number.POSITIVE_INFINITY` as WC's
//   ceiling for exactly this reason.
//
//   THE CALENDAR CV WAS UNMEASURABLE. It rose 28% between 50 and 120 games on
//   UNCHANGED code (0.2502 -> 0.3211), because a block bootstrap cannot
//   resample a tail event the sample never contained. That is not a noisy
//   measurement, it is an unusable one, and it is why WC's CLF re-derivation
//   question could not be settled by a CV comparison.
//
// ⚠ IT IS A CEILING, NOT A LOSS LIMIT, and it DOES inflate with the severity
// trend — same convention as GL's. This note used to say the opposite ("it does
// NOT inflate... a fixed ceiling binds harder in later years, which is what a
// practical maximum does"). That reading was reversed: a ceiling held at a
// nominal number while the distribution inflates does not model a practical
// maximum, it quietly shrinks the modelled tail by 28% over a ten-year game and
// breaks the severity-scale invariance the CLF grid's axis rests on. The
// distinction that matters is CONTRACT vs MODEL — a reinsurance attachment is a
// nominal figure the pool actually signed and must erode; a statement about how
// large a claim can be is a real-terms one. See wcSeverityCap.
//
// WHAT WOULD DISPLACE IT: the pool's large-claim history developed to ultimate
// (which is the same open item that would displace component `large` itself),
// or a statutory/structural argument for a different maximum — a state fund's
// per-claim ceiling, or an excess carrier's stated capacity. A different number
// is a one-line change here: every consumer routes through the capped analytic
// in wcClaimEngine and the single draw site in generateWcClaims.
// ⚠ THIS IS THE YEAR-1 CEILING, NOT A FIXED ONE. wcSeverityCap(year) trends it
// at wcSeverityTrend, so the ceiling is restated in each year's dollars rather
// than eroding against a rising distribution. Read this number as "$85M in
// year-1 dollars"; by year 10 the live ceiling is $117.6M.
//
// It was briefly nominal, and the reason it is not is worth keeping: a
// stationary ceiling under a 3.67% severity trend was worth $61.5M in year-1
// terms by year 10, a 28% real-terms tightening that changed the modelled
// distribution's SHAPE over a game — it broke the severity-scale invariance
// wcClfGrid's interpolation axis depends on, and it made the pricing year
// factor (the raw trend) disagree with the generator. See wcSeverityCap.
export const WC_SEVERITY_CAP = 85_000_000;

export type WcComponentKey = keyof typeof WC_SEVERITY_COMPONENTS;

export interface WcGroupModel {
  // Claims per $1M of payroll per year.
  ratePer1M: number;
  // Mixture weights over components. MUST sum to exactly 1.0 (asserted).
  mix: { component: WcComponentKey; weight: number }[];
  // The component the risk-quality severity tilt acts on. STORED EXPLICITLY,
  // not "the last one" — Schools' heavy component is its SECOND, and a
  // mix[mix.length - 1] shortcut would work for the three three-component
  // groups and silently mis-tilt Schools.
  heavyComponent: WcComponentKey;
}

export const WC_LOSS_MODEL = {
  // --- Frequency ----------------------------------------------------------
  //
  // ⚠ THESE FOUR RATES ARE THE LAST FIGURES DERIVED FROM RETIRED MACHINERY.
  // Each is the payroll-weighted average of the four (now deleted) class rates
  // {clerical 0.6452, publicWorks 2.0690, police 1.4118, fire 1.7073} weighted
  // through WC_CLASS_MIX. They are internally consistent with the calibration
  // below and reconcile with the pool's own rate table to within 3.4%, but they
  // come from the structure this model deletes.
  // DISPLACED BY: fitted per-group claim frequencies, which would also remove
  // WC's last dependency on WC_CLASS_MIX.
  //
  // Full-market expected counts on the canonical roster (200 members, $1,300M
  // payroll): County 491.7 + Schools 103.9 + High Safety 228.6 + Low Safety
  // 1001.4 = 1,825.6/yr.
  ratingGroups: {
    county: {
      ratePer1M: 1.2607,
      mix: [
        { component: 'small', weight: 0.4415 },
        { component: 'medium', weight: 0.3274 },
        { component: 'large', weight: 0.2311 },
      ],
      heavyComponent: 'large',
    },
    schools: {
      ratePer1M: 1.0592,
      mix: [
        { component: 'small', weight: 0.5500 },
        { component: 'schoolsMedium', weight: 0.4500 },
      ],
      heavyComponent: 'schoolsMedium',
    },
    highSafety: {
      ratePer1M: 1.4516,
      mix: [
        { component: 'small', weight: 0.3380 },
        { component: 'medium', weight: 0.2507 },
        { component: 'large', weight: 0.4113 },
      ],
      heavyComponent: 'large',
    },
    lowSafety: {
      ratePer1M: 1.5302,
      mix: [
        { component: 'small', weight: 0.4228 },
        { component: 'medium', weight: 0.3135 },
        { component: 'large', weight: 0.2637 },
      ],
      heavyComponent: 'large',
    },
  } as Record<WcRatingGroup, WcGroupModel>,

  // Workplace safety improves ~1.5%/yr. Applied as (1 + trend)^(yearNumber-1),
  // so live Year 1 is the reference (factor 1.0) and the pre-game years carry a
  // factor slightly ABOVE 1 — the past was more dangerous.
  frequencyTrendPerYear: -0.015,

  // Per member-year frequency noise, mean 1 (SD 0.25). Makes claim counts
  // overdispersed relative to pure Poisson.
  //
  // ⚠ GAMMA, NOT NORMAL, AND THIS IS NOT INTERCHANGEABLE. Normal(1, 0.25) goes
  // negative with probability 3.17e-5 per draw; a 50-year game across 200
  // members is 10,000 draws, so 27.1% of games would produce at least one
  // NEGATIVE FREQUENCY MULTIPLIER, which means a negative claim count. Gamma at
  // shape 16 is already nearly symmetric (SD 0.250, skewness 0.500, median
  // 0.979) and cannot go negative.
  memberFrequencyNoise: { shape: 16, scale: 1 / 16 },

  // ⚠ MISNAMED, DELIBERATELY LEFT IN PLACE. WC NO LONGER READS THIS.
  //
  // The pool-wide annual factor is still DRAWN once per year in processYear
  // (parameterised from here) because GL consumes it via commonLossFactor —
  // but it no longer enters WC's generation path. Removing WC's pool factor
  // makes WC, GL and Property fully independent: it was the model's ONLY
  // cross-line correlation, so a bad WC year now carries no information about
  // GL. The variance effect on WC is modest because WC's volatility is
  // dominated by its severity tail.
  //
  // Relocating this constant to a pool-level home has zero numeric content and
  // would touch GL's basis, so it stays here with this comment instead.
  poolYearFactor: { shape: 25, scale: 1 / 25 },

  // --- Risk quality: two channels ----------------------------------------
  //
  // The retired model spent its RQ budget over three channels — frequency
  // (0.080), tier mix (0.030) and duration (0.033). Tiers are gone, so the
  // latter two died with them, and that removed 44% of the budget, ALL OF IT
  // SEVERITY. rqSeverityBeta below restores a severity channel in a form the
  // mixture can express.
  rqFrequencyBeta: 0.08,   // theta_WC(RQ) = exp(-0.08 x (RQ - 5)), DRAW ONLY

  // Tilts the HEAVY component's weight:
  //   w_heavy(member) = w_heavy(group) x exp(-rqSeverityBeta x (RQ - 5))
  // with the remaining weights renormalised, preserving their ratio to each
  // other. Across the roster's RQ 1-10 range the heavy weight runs 1.271x at
  // RQ 1 down to 0.741x at RQ 10, so the worst-managed members produce severe
  // claims about 70% more often than the best.
  //
  // ASSERTED at 0.06 — approximately what the two retired channels carried
  // combined. DISPLACED BY: observed severity by risk-quality band, or
  // return-to-work outcome data.
  //
  // WHY A WEIGHT TILT RATHER THAN POST-DRAW SCALING. The two are the same size
  // (a +-10% move gives +-10.0% of loss scaled post-draw against +-9.5%
  // tilted), so this is a choice of MECHANISM, not magnitude. The tilt
  // represents what actually operates: safety programmes and early intervention
  // PREVENT CLAIMS ESCALATING — they stop a strained back becoming a permanent
  // disability. Post-draw scaling would instead assert that a well-managed
  // employer's catastrophic claim costs 10% less, which is only partly true; a
  // quadriplegic needing lifetime attendant care costs what it costs.
  //
  // AND IT MUST TOUCH THE HEAVY COMPONENT OR IT DOES NOTHING: scaling the two
  // small components by +-10% moves total loss by +-0.51%, because together
  // they are 5.1% of it.
  rqSeverityBeta: 0.06,

  // ⚠ reportLag IS GONE, WITH THE WHOLE REPORT-LAG MECHANIC. WC was the only
  // line that had one, which made its grossUltimateLoss calendar-year while
  // GL's and Property's were accident-year. Retired in favour of IBNER — claims
  // reported immediately, booked below ultimate, converging over several years —
  // which applies to all three lines and needs no deferral architecture. The
  // per-component pDelayed fields above went with it. See the note in
  // simulationEngine where the IBNR provision used to be computed.


  // Region severity multiplier. Mean-neutral by construction, so region shifts
  // the DISTRIBUTION of severity across members without moving the book's
  // expected loss. Unchanged.
  regionMultiplier: { North: 0.95, Central: 1.00, South: 1.05 } as Record<Region, number>,
};

// ===========================================================================
// GENERAL LIABILITY claim-level loss model — REBUILT onto a fitted per-claim
// mixture, on the WC architecture (WC_LOSS_MODEL above is the template):
// matched draw/analytic-expectation pair, RC on the draw only, held pure
// premium + annual k_GL, shared ctx.gPool (GL does not draw its own aggregate
// factor).
//
// WHAT THE ORIGINAL DESIGN-DOC MODEL HAD THAT THIS ONE DOES NOT:
//   - FOUR SUB-COVERAGES (general/epl/lawEnforcement/abuse), each with its own
//     frequency rate, pay rate, severity distribution and ALAE. DELETED. One
//     flat rate, one severity distribution, no per-type or per-sub
//     differentiation. A deliberate simplification, not an oversight — see
//     the flat-rate note below for what it costs.
//   - THE LIABILITY GATE: a latent claim-strength draw deciding pay/no-pay,
//     correlated with severity, plus an RQ-driven threshold shift
//     (rqGateGamma). DELETED. A fitted PAID-claim severity distribution has
//     no analog of an unpaid attempt to gate away — every drawn claim is
//     already a realized paid outcome. The RQ effect this threshold carried
//     does NOT reappear as a frequency recalibration (rqFrequencyBeta stays
//     at its pre-existing 0.055); it reappears below as a severity tilt.
//   - LITIGATION STAGES, stage-keyed ALAE, and GL_SOCIAL_INFLATION's
//     within-claim settlement-lag trend. DELETED, all together. The fitted
//     mixture includes ALAE and comes from a real pool's real claim
//     experience — whatever settlement-lag trending happened historically is
//     already realized in those dollar amounts. Trending on top would
//     double-count, the identical reasoning that retired the statutory cap
//     below. GL carries no severity or frequency trend of any kind as a
//     result — see exposureTrend.ts's GL note.
//   - THE STATUTORY CAP (indemnity-only, state-law-only) and the
//     indemnity/ALAE/legalBasis split it needed. DELETED. It was applied in
//     the waterfall, downstream of generation, against a severity that was
//     itself an invented parameter with no claim on reality beyond internal
//     consistency. The fitted mixture instead comes from a pool that already
//     operated under real statutory caps — a second cap on top would
//     suppress claims that were never able to exceed it in the first place.
//     One real, named consequence: a capped claim could previously still
//     pierce the $1M retention on ALAE alone even with near-zero indemnity.
//     Nothing replaces that; it is a genuine loss, not an absorbed one.
//   - MULTI-CLAIMANT ABUSE BATCHES. DELETED ENTIRELY, not layered on top of
//     the mixture. This was reconsidered after measurement, not assumed: the
//     71.8%/71.5% (full-market/enrolled) share of >$25M occurrences that were
//     batch accumulations, and the 185-claimant reference case, both traced
//     to external anchors rather than this pool's own claim experience —
//     which tops out around 15 claimants — and the fitted mixture is on
//     INDIVIDUAL CLAIMS, which already include whatever abuse-type claimants
//     exist in the pool's real data. Occurrence == claim for GL now, exactly
//     as WC's is. Measured consequence of dropping batches: occurrences
//     above $25M fall to 0.236/yr (one per 4.2 years) — see the verification
//     targets below and the tower-rederivation diagnostic that measures it
//     against a live generator rather than treating it as a shortfall.
//
// WHAT SURVIVES: the RQ FREQUENCY channel (rqFrequencyBeta, unchanged), the
// per-member-year frequency noise, and k_GL / held-pure-premium / RC-on-draw-
// only exactly as before. One thing is NEW versus the original design: an RQ
// SEVERITY tilt (rqSeverityBeta below), added to partially restore what the
// deleted gate's RQ-threshold channel contributed.
// ===========================================================================

// One component of the fitted 3-component lognormal mixture every GL claim
// draws from — no sub-coverage, no gate, ALAE included in the amount.
export interface GlSeverityComponent {
  key: string;
  weight: number;
  mu: number;
  sigma: number;
}

// FITTED TO THE POOL'S OWN INDIVIDUAL CLAIMS (not occurrence totals — there
// are no occurrences bigger than one claim anymore). Component 1 is the heavy
// tail: 51.9% of claims by weight, 99.1% of loss by dollar, CV 21.5 alone.
// Component 2 (6.3% weight, CV 0.55 — tight for any claims distribution, let
// alone the tail-heavy component sitting next to it) is flagged as a
// candidate EM-fitting artifact rather than a genuine population; kept for
// now because three parameters disturb nothing else, and dropping it later is
// a one-line trim, not a rebuild. Component 3 carries most of the CLAIM
// COUNT (41.8%) at a small dollar share — the ordinary-nuisance-claim mass.
//
// heavyIndex 0 is hardcoded rather than a named field (contrast WC's
// per-rating-group heavyComponent) because there is only one mixture here —
// nothing to look the heavy component up BY, unlike WC's four rating groups
// where Schools tilts its 2nd component, not its last.
export const GL_SEVERITY_COMPONENTS: GlSeverityComponent[] = [
  { key: 'component1', weight: 0.519201, mu: 8.799445, sigma: 2.477151 },
  { key: 'component2', weight: 0.0629521, mu: 8.1841218, sigma: 0.5127005 },
  { key: 'component3', weight: 0.417847, mu: 6.601986, sigma: 0.830612 },
];
export const GL_HEAVY_COMPONENT_INDEX = 0;

// ASSERTED, NOT SOURCED. The hard ceiling on any single GL claim.
//
// WHY IT EXISTS. The uncapped mixture puts HALF ITS VARIANCE ABOVE $1.42
// BILLION — under the x^2-weighted measure ln X is Normal(mu + 2 sigma^2,
// sigma^2) for component 1, whose median is exp(8.799445 + 2 x 6.136277) =
// $1.41B. A single claim at that level is roughly THIRTY TIMES the pool's
// entire annual GL loss. That is not a public-entity liability outcome; it is
// an artifact of extrapolating a lognormal tail far past the claims it was
// fitted to. The pool has seen nothing near $100M.
//
// WHAT THE CAP COSTS AND BUYS (derived, and asserted in gl-claim-check.ts):
//   ground-up loss cost   5.886 -> 5.632 per $100   (-4.33%)
//   mean claim            $74,714 -> $71,480
//   severity CV           29.55 -> 13.68
//   above-$25M share      12.0% -> 8.0% of loss
//   binds                 1 per ~137 years at the enrolled book
// The POINT IS THE VARIANCE, not the mean: it removes 4.3% of expected loss
// and MORE THAN HALF the annual CV.
//
// ⚠ THE ANCHOR IS UNTOUCHED, AND THAT IS CHECKED. GL's frequency was derived
// from the 0-$1M loss cost of 2.83 per $100, and E[min(X,$1M)] cannot see a
// $100M cap: min(min(X, 100M), 1M) === min(X, 1M) identically. So
// E[min(X,$1M)] stays $35,920 and ratePer1M stays 0.7879. NOT re-derived.
//
// ⚠ NOT A PRECEDENT FROM WC, contrary to how this ruling was framed. WC's
// $15.51M ceiling was a property of the RETIRED annuity model (see
// reinsuranceTower.ts:145 and CALIBRATION_FINDINGS "the mixture has no
// ceiling"); the CURRENT WC mixture is explicitly UNCAPPED, with its 1-in-250
// -year claim at $71.2M and the absence of a cap recorded as an open item at
// WC_SEVERITY_COMPONENTS.large. This was the FIRST severity cap in the live
// model and for a while left WC and GL on different footings; WC is bounded
// too now, and both ceilings trend.
//
// WHAT WOULD DISPLACE IT: a public-entity liability claim distribution with
// observed maxima, or a verdict study establishing a realistic ceiling. A
// different number is a one-line change here — every consumer routes through
// expectedClaimSeverity (analytic) and the single draw site in glClaimEngine.
// ⚠ THIS IS THE YEAR-1 CEILING, NOT A FIXED ONE — glSeverityCap(year) trends it
// at GL's own severity trend. GL is the largest case of the erosion that change
// fixes: at 5.7026%/yr a stationary $100M was worth $60.7M in year-1 terms by
// year 10, a 39% real-terms tightening. By year 10 the live ceiling is $164.7M.
export const GL_SEVERITY_CAP = 100_000_000;

export const GL_LOSS_MODEL = {
  // --- frequency -------------------------------------------------------------
  // lambda = totalPayroll x ratePer1M x theta_GL(RQ) x k_GL x epsilon x gPool.
  // FLAT: no sub-coverage, no per-type relativity — a water district and a
  // city with the same payroll face the same rate and the same severity
  // distribution. RULED DELIBERATE, overriding the alternative this rebuild's
  // planning turn raised (a composite per-type multiplier to preserve some
  // signal that police-less districts can't generate law-enforcement-type
  // severe claims). Recorded as a known, deliberate simplification: GL_RELATIVITIES
  // was never externally validated either (roster-CSV judgment calls, see
  // CALIBRATION_FINDINGS), so this trades one unanchored differentiation for
  // none rather than for a better one.
  //
  // DERIVED, NOT FITTED — this is GL's only externally-grounded number.
  // The pool's observed 0-$1M loss cost is $2.8300 per $100 of payroll.
  // The mixture's $1M-LIMITED mean (E[min(X, 1e6)] across all three
  // components) is $35,920. A rate consistent with both:
  //   rate = 2.8300 x 10,000 / 35,920 = 0.7879 claims per $1M of payroll
  // ($2.83 is stated per $100; x10,000 converts the $100-basis loss cost to a
  // per-$1M-of-payroll dollar figure before dividing by the limited mean, so
  // rate comes out in claims per $1M). Every other GL number in this block —
  // the mixture's own weights/mu/sigma, rqFrequencyBeta, rqSeverityBeta — is
  // either fitted directly or carried over from before this rebuild; this
  // rate is the one number derived FROM an external anchor plus the fit.
  ratePer1M: 0.7879,

  // Per member-year frequency noise, mean 1 (SD ~0.35) — unchanged from
  // before the rebuild. One draw per member per year; with no sub-coverages
  // left to share it across, this is simply the line's own noise term now.
  memberFrequencyNoise: { shape: 8, scale: 1 / 8 },

  // --- risk quality: two channels, unchanged split -----------------------
  // FREQUENCY: theta_GL = exp(-0.055 x (RQ - 5)). UNCHANGED from before the
  // gate was deleted — ruled explicitly not to recalibrate upward to
  // compensate for the lost gate-threshold channel. GL's combined RQ budget
  // (frequency beta + severity beta, treated as roughly additive sensitivity,
  // not composed analytically — they act on different things, a count and a
  // mixture weight) is 0.055 + 0.060 = 0.115, against WC's own
  // rqFrequencyBeta 0.08 + rqSeverityBeta 0.06 = 0.14. The gap between GL's
  // 0.115 and WC's 0.14 comes entirely from the two lines' PRE-EXISTING
  // frequency betas (0.055 vs 0.08), not from anything invented in this
  // rebuild.
  rqFrequencyBeta: 0.055,

  // SEVERITY TILT — NEW in this rebuild, matching WC's rqSeverityBeta
  // mechanism exactly: worse RQ raises the heavy component's (index 0) share
  // of the mixture, remaining weights renormalise to preserve their ratio to
  // each other, clamp below 1.0 exactly as WC's tiltedWeights does. DRAW AND
  // k_GL ONLY, NEVER the pricing expectation (WC invariant 2, carried over
  // unchanged) — the held pure premium and neutral k_GL both use the
  // untilted weights above. At RQ 5 (neutral) this is the identity.
  rqSeverityBeta: 0.060,
} as const;

// Base retention probability per member per year — high by default for realistic public entity pools
export const BASE_RETENTION = 0.95;

// RETIRED as the join base — kept only because CalculationAuditPage still
// displays it and removing it would silently blank an audit row. Nothing in
// membershipEngine reads it any more. See MEMBERSHIP_EQUILIBRIUM_ENROLLMENT
// below for what replaced it and why.
export const BASE_NEW_MEMBERS_PER_YEAR = 1.0;

// --- the join base: marketplace-scaled, not a fixed count -------------------
//
// THE DEFECT THIS REPLACES. Joins used to be a flat BASE_NEW_MEMBERS_PER_YEAR
// (1.0) while departures are proportional (a member leaves with probability
// 1 - BASE_RETENTION, so a book of N sheds 0.05N per year). A flat join count
// against a proportional leave rate has exactly one equilibrium,
//
//     BASE_NEW_MEMBERS_PER_YEAR / (1 - BASE_RETENTION) = 1.0 / 0.05 = 20 members,
//
// and it is the SAME 20 for every line whatever that line's book actually is.
// Measured starting books are 56 (WC), 57 (GL), 58 (Property), so every line
// began roughly 2.9 members/yr out and drifted down toward 20 no matter what
// the player did. Every GL and WC run's 10-12% "decline" was this, not a
// decision — which made decline uninterpretable, since a badly-run pool looked
// exactly like the default.
//
// THE RULE. Joins now scale with the REMAINING marketplace:
//
//     expectedNewMembers = k x (roster - enrolled)
//
// which is self-correcting in the way a fixed count is not: a bigger book has
// fewer prospects left to recruit, so growth slows on its own, and there is a
// natural ceiling at the roster. A shrinking book frees prospects and recovers.
//
// k IS NOT A FREE PARAMETER. It is pinned by requiring TOTAL expected joins to
// equal expected departures at the enrolled book the game actually starts from:
//
//     k x (roster - N*) + adj = N* x d
//     k = (N* x d - adj) / (roster - N*)
//
// where d is MEMBERSHIP_DEFAULT_DEPARTURE_RATE — the REALISED departure rate at
// defaults (4.45%), NOT the nominal 1 - BASE_RETENTION (5.0%). See that constant
// for why the two differ and why using the nominal one would re-tilt the fix.
//
// It is derived at the call site from the LIVE roster length rather than frozen
// as a literal, so it stays correct if BASE_RETENTION moves or the roster is
// ever resized — the basis of a calibrated rate is part of its value (the
// sdOverExpected lesson).
//
// ⚠ THE CONDITION IS ON TOTAL JOINS, NOT ON THE BASE ALONE, and the `adj` term
// is why. The adjustment ladder in membershipEngine's newMemberAdjustment does
// NOT sit at zero when every decision is at its default: measured at +0.611
// members/yr at the last measurement and +0.5852 now (WC +0.494, GL +0.590,
// Property +0.671 — no longer near-identical; see that constant). Two channels drive it — competitivePressure, drawn in
// [0.3, 0.8], contributes (1 - cp) x 0.5, mean +0.225; and satisfaction starts
// in [6.5, 8.5], so the >= 7.5 branch fires about half the time. The rate-LEVEL
// term added with the price channel contributes essentially nothing here BY
// CONSTRUCTION, since RATE_NEUTRAL_LOAD is measured at defaults — the residual
// level deviation at defaults is within a few hundredths of a percent on every
// line. Pinning k on the base alone would leave the pool growing at
// defaults, which fails the whole point of the fix.
//
// Folding it in is not a fudge, it is what makes the adjustments DIFFERENTIAL:
// all-defaults is now the neutral point, so a player who raises assessments or
// tightens underwriting moves the book relative to a book that would otherwise
// have held still. Decline becomes attributable to a decision, which is the
// entire objective. Leaving `adj` out would measure every decision against a
// silently growing baseline instead.
//
// N* = 63 is the pooled median starting book with all three lines active
// (WC 64, GL 62, Property 63), re-measured after the funding basis moved to net. Starting
// books are drawn as an exposure SHARE (STARTING_EXPOSURE_SHARE, 25-35%), never
// as a count, so the count is emergent.
//
// ONE k STILL SERVES ALL THREE, and this was re-checked rather than assumed.
// The price channel is the first mechanism here with a genuinely per-line
// neutral point, so the question was reopened. Per-line k values come out at
// WC 0.017289, GL 0.014912, Property 0.015467 — a 1.159x spread, still TIGHTER
// than the 1.359x spread in the adjustment alone, because each line's higher
// adjustment is offset by its own departure rate and starting book. The pooled
// 0.016192 sits inside that range. Re-checked at Property's netting rather than
// carried forward: Property's adjustment moved the most of the three, so this
// was exactly the change that could have broken the one-k assumption, and it
// did not — the spread widened from 1.097x to 1.159x and stayed well inside
// the adjustment's own.
//
// ⚠ N* IS MILDLY SELF-REFERENTIAL, and that is understood rather than
// overlooked: runPriorHistory simulates three pre-game years through this same
// membership engine, so the book handed to year 1 already reflects whatever k
// is in force — and now the pre-game runs the price channel too. Measured under
// the shipped k the starting book settles within a member or two of the value it
// was calibrated from, well inside seed noise (the per-seed starting book spans
// 45 to 88). It does not iterate away: the measured ten-year trajectory holds
// flat from wherever it opens, which is the property that actually matters and
// is verified directly in scripts/diagnostics/membership-equilibrium-check.ts.
//
//     k = (63 x 0.0445 - 0.5852) / (200 - 63) = 2.2183 / 137 = 0.016192
export const MEMBERSHIP_EQUILIBRIUM_ENROLLMENT = 63;

// The measured contribution of the adjustment ladder at ALL-DEFAULT decisions,
// in members/yr. Folded into k so that defaults are the neutral point — see the
// note above. Measured, not chosen: 40 games x 10 years x 3 lines, calling the
// engine's own newMemberAdjustment.
//
// ⚠ If any adjustment branch's coefficient changes, THIS NUMBER MUST BE
// RE-MEASURED. It is a property of the ladder, not a constant of nature, and a
// stale value here silently re-tilts the equilibrium. It has already had to move
// twice for exactly that reason: reconnecting the price channel added the
// rate-LEVEL term to this ladder (0.60 -> 0.619), and moving the pool premium to
// a net funding basis moved every line's load and with it the level term
// (0.619 -> 0.611). NOW THREE TIMES: Property's own netting moved its load the
// same way WC's and GL's moved at fab85e4 (0.611 -> 0.5852).
//
// ⚠ THE PER-LINE SPREAD WIDENED AND IT IS PROPERTY THAT MOVED. WC +0.494,
// GL +0.590, Property +0.671 — a 1.36x spread against the 1.21x recorded when
// this was last measured. Property sits highest because its satisfaction runs
// highest (mean 8.10 against WC 7.27 / GL 7.66), so the >= 7.5 branch of the
// ladder fires far more often on it. One pooled value still serves all three —
// see the k note above, where the per-line k spread is checked directly and is
// tighter than this one, for the same offsetting reason.
export const MEMBERSHIP_DEFAULT_ADJUSTMENT = 0.5852;

// The REALISED share of the book that leaves per year at all-default decisions.
//
// ⚠ THIS IS NOT 1 - BASE_RETENTION, AND USING THAT INSTEAD IS THE SAME MISTAKE
// AS IGNORING THE JOIN ADJUSTMENT. BASE_RETENTION 0.95 is only the base of
// calcRetentionProbability, which then adds a satisfaction term and a
// financial-strength term — both POSITIVE at defaults, since satisfaction
// starts in [6.5, 8.5] against a 5.0 reference and the surplus ratio climbs
// through the 0.6 reference as the pool builds surplus. MAX_WITHDRAWN_PER_YEAR
// then truncates the top of the noise distribution on top of that. The measured
// result is 4.4%, not 5.0% — WC 4.36%, GL 4.42%, Property 4.41%, over 40 games
// x 10 years x 3 lines at defaults.
//
// Both sides of the equilibrium therefore have to be taken as they actually
// behave at defaults, not as their nominal constants read. Pinning k on 5.0%
// while the book only sheds 4.4% builds in a permanent upward tilt.
//
// ⚠ RE-MEASURE THIS TOO whenever the retention ladder changes. It moved from
// 0.042 to 0.044 when the price channel was reconnected (and held at 0.044
// through the move to net funding), then to 0.0445 at Property's netting, and
// the mechanism is worth naming: the rate-change retention penalty is
// PENALTY-ONLY, so ordinary year-to-year rate noise around the neutral point
// produces penalties in up years and nothing in down years. That asymmetry is a
// genuine, permanent increase in the departure rate at defaults, not a
// measurement artefact.
//
// ⚠ PROPERTY'S SHARE OF THAT ASYMMETRY WAS SWITCHED OFF UNTIL NOW, which is
// the substantive part of this re-measurement rather than the third decimal
// place. Its RATE_NEUTRAL_CHANGE_PCT stood at +4.10 while its actual rate ran
// at -0.21%/yr, so actual-minus-neutral was permanently about -4.3pp and a
// penalty-only term could never fire on it at any realistic decision. Property
// therefore shed 4.24%/yr against WC's 4.45% and GL's 4.47%. With the neutral
// corrected it shows 4.43% and the three lines agree to within 0.04pp.
export const MEMBERSHIP_DEFAULT_DEPARTURE_RATE = 0.0445;

// Hard caps on annual membership movement
export const MAX_NEW_MEMBERS_PER_YEAR = 4;
export const MAX_WITHDRAWN_PER_YEAR = 4;

// Funding confidence level factor (CLF) table
// Represents the multiplier applied to expected losses to set funding targets
// 0.60 ALIGNED TO 1.000, matching the reference chart — the chart is the
// authority. Was 1.003 in code; that made the funding-consequence panel read
// 99.8% at the "expected" 60% setting instead of exactly 100.0%, when exactly
// break-even is the entire point of that label. 0.45/0.40/0.35/0.30 were ADDED
// (not previously present) to support the funding-confidence slider's
// extended 30%-95% range; their values are taken directly from that same
// reference chart, since there was no existing entry to conflict with.
export const FUNDING_CLF_TABLE: Record<number, number> = {
  0.95: 2.448,
  0.90: 1.951,
  0.85: 1.694,
  0.80: 1.501,
  0.75: 1.346,
  0.70: 1.217,
  0.65: 1.105,
  0.60: 1.000,
  0.55: 0.908,
  0.50: 0.827,
  0.45: 0.745,
  0.40: 0.666,
  0.35: 0.590,
  0.30: 0.516,
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
//
// RETIRED. Property was this model's last consumer and now runs its own
// per-occurrence tower (see reinsuranceTower.ts) — no line reads a
// percentage-of-premium quota share any more. FULL_TRANSFER_COST_PCT_OF_PREMIUM
// and the REINSURANCE_PROGRAMS table that scaled off it are gone with it, along
// with reinsuranceEngine.ts (getReinsuranceStructure / calculateReinsuranceCost
// / calculateReinsuranceRecovery) and the `reinsuranceLevel` decision field.

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

// --- THE PRICE CHANNEL ------------------------------------------------------
//
// What a member is CHARGED now affects whether they stay and whether prospects
// join. Three sites had their price term deleted when CLF pricing replaced the
// Rate Change decision, each with a comment saying a bill-based replacement was
// pending rather than silently zeroed; these constants are that replacement.
//
// THE SPLIT, and it is load-bearing:
//   RATE CHANGE (vs last year) -> retention and satisfaction. Members notice
//     increases year over year.
//   RATE LEVEL (load over pure premium) -> new business, through the existing
//     competitivePressure hook. Prospects compare levels.
// A pool overpriced for five straight years shows NO rate change and would
// otherwise take no penalty at all. That is the case the level term exists for,
// and it is exactly the case the reinsurance tower creates: the tower is bought
// once and held, so it raises the level permanently while producing a rate
// change only in the year it is first placed.

// ⚠ THE NEUTRAL POINT IS PER LINE AND IT IS NOT ZERO. At all-default decisions
// each line's rate already moves on its trends alone, before any player does
// anything: WC's falls, GL's rises modestly, Property's rises hard because its
// TIV exposure base does not inflate while its losses do (WAGE_INFLATION_APPLIES
// .Property is false). Penalising the RAW rate change would therefore be a
// permanent tax on Property and a permanent subsidy to WC, at defaults — which
// would re-break the very property the membership equilibrium fix established,
// that all-defaults is the neutral point and any drift is attributable to a
// decision. The penalty is applied to the DEVIATION from these.
//
// Measured at all-default decisions (which INCLUDE the full occurrence tower —
// DEFAULT_LAYERS_PLACED places every purchasable layer), 30 games x 10 years,
// medians, in % per year.
//
// ⚠ RE-MEASURE THESE if any trend constant moves, if DEFAULT_LAYERS_PLACED
// changes, or if the admin ratio changes. They are properties of the pricing
// path, not constants of nature.
// ⚠ RE-MEASURED AT PROPERTY'S NETTING. Property's own figure was the large one
// and it was large because it was measured on the LEGACY product: 4.10 was a
// gross-funded, percentage-of-premium Property. Netted and towered, Property's
// rate is essentially FLAT year to year (-0.21%/yr), which is what a line with
// no frequency trend, no severity trend and a non-wage-inflating exposure base
// should do. Leaving 4.10 in force meant the rate-change penalty — which is
// PENALTY-ONLY — could never fire on Property at any realistic decision,
// because actual-minus-neutral was permanently ~-4.3pp. That is a permanent
// subsidy, and the constant's own header calls out exactly this failure mode.
//
// WC and GL moved slightly too, and NOT because anything in their own lines
// changed: the measurement arm did. price-channel-facts read its neutrals off
// the NO-TOWER arm while these constants are defined at DEFAULTS (tower placed)
// — see that script's section 2/3 note.
export const RATE_NEUTRAL_CHANGE_PCT: Record<CoverageLine, number> = {
  WC: -1.45,
  GL: 1.26,
  Property: -0.21,
};

// The load — total member charge rate / pure premium rate — at all-default
// decisions, per line. Same measurement run as above.
//
// Without any tower ALL THREE now sit at 1.1500 (Property 1.1497), which is
// 1 + ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM at CLF 1.000 — the cleanest possible
// confirmation that the load is reading what it is meant to read. The full
// tower is what lifts them to these values, and that gap IS the tower's price
// signal to prospects.
//
// ⚠ THE 1.1500 CLAIM USED TO BE WC/GL-ONLY and Property could not make it: on
// the legacy percentage-of-premium cover its no-tower load was not 1.15,
// because `layersPlaced` did not control its product. That Property now lands
// on 1.1497 with its layer declined is a direct confirmation the cutover put
// it on the same footing as the other two.
//
// ⚠ ONLY PROPERTY MOVED AT ITS NETTING, AND THE CRITERION IS NOT THE HEADLINE
// MEASUREMENT. price-channel-facts and membership-recalibrate draw DIFFERENT
// seed populations (30 games from 7_700_000 + 5171g against 40 from
// 5_200_000 + 6353g), and their measured loads differ by up to ~0.3% on GL —
// more than the precision this constant is quoted to. The tie-break is what
// the constant is FOR: the level term in the join ladder must sit at zero when
// every decision is at its default, or all-defaults stops being the neutral
// point and k is pinned against a tilted baseline. So these are set to zero
// the residual in the CONSUMING population (membership-recalibrate's "level
// deviation at defaults" section), not to the other script's medians.
//
// Under the pre-netting values WC and GL already read -0.07% and +0.01% there
// and are therefore LEFT ALONE; Property read -0.44%, an order of magnitude
// out, and 1.525 -> 1.518 is what closes it.
export const RATE_NEUTRAL_LOAD: Record<CoverageLine, number> = {
  WC: 1.472,
  GL: 1.457,
  Property: 1.521,
};

// Retention response, per percentage point of rate increase ABOVE the line's
// neutral, BEFORE the MEMBER_MOVEMENT_WEIGHTS.retention.rateIncreasePenalty
// weight of 0.15 is applied. 0.02 x 0.15 = 0.0030 of retention per point, i.e.
// a 10-point rise costs 3.0 points of retention:
//
//     deviation    retention
//         0%          0.950
//        +5%          0.935
//       +10%          0.920
//       +20%          0.890
//       +50%          0.800  (the existing [0.80, 0.99] clamp binds here)
//
// That is the requested starting scale, adopted as given rather than re-derived
// — there is no measurement in this model that could pin a member's price
// elasticity, so it is a judgment, and it is recorded as one. The clamp at 0.80
// arrives at +50% rather than +59%; the difference is the clamp, not the slope.
export const RATE_RETENTION_SENSITIVITY = 0.02;

// PENALTY ONLY — a rate cut below neutral earns no retention bonus here.
// Deliberate, and the asymmetry is the realistic half of it (members notice
// increases far more than decreases), but it has a measurable cost: year-to-year
// rate noise around the neutral point produces penalties in up years and nothing
// in down years, so it is a small net drag even at defaults. That drag is real,
// is absorbed into the re-measured MEMBERSHIP_DEFAULT_DEPARTURE_RATE, and is the
// reason that constant had to be re-measured rather than carried over.

// Satisfaction response, in satisfaction points per percentage point of rate
// deviation. SYMMETRIC, unlike the retention term: satisfaction is a slow stock
// that already clamps to [1, 10], and making it penalty-only would have it decay
// monotonically at defaults on rate noise alone, which is worse than letting it
// drift both ways around its starting value. A 10-point rise costs 0.15
// satisfaction, which then feeds retention and new business through the existing
// satisfaction channels rather than as a second direct price term.
export const RATE_SATISFACTION_SENSITIVITY = 0.015;

// New-business response to the rate LEVEL, per percentage point of load above
// the line's neutral, before MEMBER_MOVEMENT_WEIGHTS.attraction.rateLevel (0.20)
// and before the competitivePressure scaling. Symmetric: a pool that is cheaper
// than its neutral genuinely does attract more members, and that is the arm that
// makes NOT buying the tower visible.
//
// Scaled so that the full tower — which lifts GL's load about 65% above the
// no-tower level — moves new business by roughly 0.6-0.7 members/yr at the mean
// competitive pressure of 0.55: 0.20 x 0.55 x 0.10 x 65 = 0.72. Against a base
// of about 2.5 joins/yr that is a material but not dominating penalty, which is
// the intended weight for a deliberate risk-transfer decision.
export const RATE_LEVEL_SENSITIVITY = 0.10;

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

// PRE-GAME SEED capital: each active line's surplus at the START of the 3-year
// pre-game = this multiple x that line's own premium. Config-independent by
// construction (depends only on the line's own premium).
//
// ⚠ THIS IS NOT THE YEAR-1 OPENING RATIO, and the distinction matters more than
// it looks. These are the pre-game's INITIAL conditions at year -2; three
// simulated years of operation then run on top, and the acceptance band below
// selects which of those runs is kept. Measured, the year-1 opening lands at
// 1.068x premium on WC, 1.300x on GL and 1.263x on Property — nowhere near
// 0.70 / 0.45 / 0.18. Anyone reading these as "WC opens at 0.70x premium" will
// be wrong by a factor of 1.5.
//
// ⚠ THE PER-LINE ORDERING HAS NO SURVIVING RATIONALE, and inventing one would be
// worse than saying so. The comment here used to justify these by the acceptance
// test they were tuned against, and that test has been replaced. Checked against
// the two candidate explanations:
//
//   TAIL LENGTH cannot separate WC from GL. The engine's only per-line runoff
//   parameter is LINE_RESERVE_PAYDOWN_PCT, and WC and GL are IDENTICAL on it
//   (both 0.35, steady-state reserve 1.71x annual loss). It explains Property
//   being lower (0.65 paydown, 0.92x) and nothing else.
//
//   RISK does not explain it either, and points the wrong way: GL's retained
//   annual CV is about 0.78 against WC's 0.39, so GL is twice as volatile per
//   dollar of expected loss while receiving LESS seed capital per dollar of
//   premium.
//
// What they are, honestly: pre-game initial conditions whose influence on the
// year-1 opening is largely washed out by three years of operation and by the
// acceptance band. DISPLACED BY: a real per-line capital standard, if one is
// ever adopted. Until then the band below is what actually sets the opening.
export const STARTING_CAPITAL_TO_PREMIUM: Record<string, number> = {
  WC: 0.70,
  GL: 0.45,
  Property: 0.18,
};

// Pre-game acceptance band: the line's Year-1 opening surplus must land within
// [min, max] x that line's own opening PREMIUM, or its pre-game redraws on its
// own derived seed. PER-LINE on purpose — checking at pool level would
// reintroduce config-dependence.
//
// ⚠ IT USED TO BE MEASURED AGAINST THE REQUIRED RESERVE MARGIN, and that was
// the defect. The margin is expectedNetUnpaidLoss x (reserveMarginCLF - 1):
// a stable target (STARTING_CAPITAL_TO_PREMIUM, a multiple of premium) filtered
// through an unstable acceptance test, and the filter wins. Three consecutive
// commits moved the opening through that path without any decision causing it:
//   f328d65  static CLF tables — reserveMarginCLF fell ~1.79 -> 1.36 on GL
//   fab85e4  net funding — the margin's basis was corrected
//   962ef60  IBNR removed — the reserve fell 24.8%, the opening fell 30.4%
// The last made reserves-to-surplus WORSE (0.920 -> 1.089) while the reserve
// SHRANK, because the opening moved further than the reserve did. Both sides now
// reference premium, so the margin has left the opening path entirely.
//
// ⚠ NOT A TOLERANCE AROUND STARTING_CAPITAL_TO_PREMIUM, which would have been
// the obvious construction and is wrong: that constant is the pre-game's year -2
// SEED (0.70 / 0.45 / 0.18), while this band tests the YEAR-1 opening after three
// years of operation, which measures 1.065 / 1.270 / 1.293. A tolerance around
// 0.70 would reject essentially every WC pre-game.
//
// ⚠ STILL PER-LINE, AND ONE SHARED BAND WAS TRIED AND REJECTED ON MEASUREMENT.
// The argument for collapsing Property's separate band is sound as far as it
// goes — its old 2.0-3.0 existed because the reserve margin is structurally
// small for a short-tail line, and on a premium basis that reasoning does
// evaporate. But the three lines do NOT currently open at the same multiple of
// premium, and their ranges barely overlap: WC [0.83, 1.22] against Property
// [1.13, 1.70]. A single band spanning the union was measured and moved the
// openings materially — WC's median +22%, Property's -18% — which is a re-tune,
// and precisely the kind of uncaused movement this change exists to stop.
//
// So: one BASIS for all three lines (premium, which is the fix), three
// TOLERANCES (which is what preserves the distribution). Collapsing to a single
// number would be a separate decision about a common capital standard, and it
// should be taken deliberately rather than smuggled in behind a basis change.
//
// CALIBRATED TO PRESERVE THE CURRENT DISTRIBUTION, not to re-tune it. Each band
// is the OLD margin-basis band translated onto premium at that line's median
// margin/premium ratio AS MEASURED AT THE PARENT (WC 0.612, GL 0.744, Property
// 0.567 — the after-state ratios differ, which is the point):
//   WC        [1.35, 2.0] x 0.612 = [0.83, 1.22]
//   GL        [1.35, 2.0] x 0.744 = [1.00, 1.49]
//   Property  [2.0,  3.0] x 0.567 = [1.13, 1.70]
// so the accept/reject decision is the same one, taken against a stable basis.
export const OPENING_SURPLUS_TO_PREMIUM_BAND: Record<string, { min: number; max: number }> = {
  WC: { min: 0.83, max: 1.22 },
  GL: { min: 1.00, max: 1.49 },
  Property: { min: 1.13, max: 1.70 },
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

// WC_CLASS_MIX and GL_RELATIVITIES (per-entity-Type lookup tables, exact
// functions of Type, matched cell-for-cell against the canonical roster CSV
// at generation time) BOTH RETIRED by the GL severity rebuild.
//
// WC_CLASS_MIX's last production consumer was glClaimEngine.ts's
// law-enforcement exposure base (POLICE payroll rather than total payroll) —
// WC itself stopped reading it at the per-rating-group severity rebuild.
// GL_RELATIVITIES was GL's own four-sub-coverage relativity table. The GL
// rebuild deleted sub-coverages entirely (one flat rate for all of GL, see
// GL_LOSS_MODEL below), which removed both: no relativity to weight, and no
// distinct law-enforcement exposure base to gate by police payroll. A water
// district and a city with the same total payroll now face the same rate and
// the same severity distribution — ruled deliberate, not discovered. Neither
// table was ever externally validated (both were roster-CSV judgment calls,
// see CALIBRATION_FINDINGS), so nothing sourced is lost, only an unanchored
// differentiation.
// scripts/tools/generate-member-catalog.ts's verification of these two tables
// against the roster CSV retired with them.

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

// WC's funding-confidence range, post finding-38 (WC's own derived loss
// distribution replaces FUNDING_CLF_TABLE for WC — see wcClfGrid.ts). NOT a
// {min,max,step} triple: WC's derived curve spans 10%-99% at non-uniform
// stops (a uniform 5-point grid from 10 to 95, plus 97.5 and 99 — going from
// 95% to 99% costs meaningfully more than one more 5-point step would, so it
// is kept as its own stop rather than rounded into the grid or dropped).
// EVERY STOP USES ITS OWN EXACT PERCENTILE'S MULTIPLIER — no stop is snapped
// onto a nearby one, which is exactly the mislabelling finding 38 removed
// (the old table's 0.60 stop silently meant the ROUNDED 60%, not the
// computed 65% where WC's mean actually falls; see wcClfGrid.ts).
//
// DATA ONLY. GL and Property keep SLIDER_RANGES.fundingConfidenceLevel above,
// unmodified. Consuming this for WC's actual slider widget (rendering the
// non-uniform stops, and marking where drawn/expected = 1.000 falls between
// stops) is UI work for ui/decision-surface — not built here.
export const WC_FUNDING_CONFIDENCE_RANGE = {
  min: 0.10,
  max: 0.99,
  default: 0.60,
  stops: [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.975, 0.99],
};

// Slider ranges (not player-editable in v1)
export const SLIDER_RANGES = {
  // rateChange REMOVED (CLF-only pricing). Funding confidence is now the only
  // pricing lever; its default moved from 0.75 to 0.60 (break-even) and its
  // range extended down to 0.30 so underfunding is directly selectable rather
  // than only reachable via the old rate-change discount.
  // GL and Property only, post finding-38: WC reads WC_FUNDING_CONFIDENCE_RANGE
  // below instead, since its own derived curve covers a wider span at
  // non-uniform stops that this {min,max,step} shape cannot express.
  fundingConfidenceLevel: { min: 0.30, max: 0.95, step: 0.05, default: 0.60 },
  dividendPct: { min: 0, max: 0.15, step: 0.005, default: 0 },
  assessmentPct: { min: 0, max: 0.25, step: 0.005, default: 0 },
  // The combined dividend/assessment control's own range: zero at centre,
  // dividends extend positive (to dividendPct.max), assessments extend
  // negative (to -assessmentPct.max). dividendPct/assessmentPct above remain
  // the fields the engine reads; this exists only for the collapsed input.
  dividendAssessment: { min: -0.25, max: 0.15, step: 0.005, default: 0 },
  underwritingStrictness: { min: 0, max: 10, step: 1, default: 5 },
  riskControlPct: { min: 0, max: 0.08, step: 0.01, default: 0 },
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
// IBNER — INCURRED BUT NOT ENOUGH REPORTED.
//
// Friedland's structure: reported claims + IBNER = ultimate. The claim register
// is untouched — it keeps showing exactly what the generator drew, and that sum
// IS the accident year's INITIAL ESTIMATE of ultimate. Development is a separate
// AGGREGATE provision carried per cohort on top of it:
//
//   registerSum   = sum of drawn claims                     (never changes)
//   estimate(1)   = registerSum x (1 - b)                   b = booking bias
//   estimate(t+1) = estimate(t) x (1 + m x s x z_t + b/H)   z_t ~ N(0,1)
//   ultimate      = estimate(H), fixed thereafter
//   provision     = estimate - registerSum                  (the IBNER balance)
//
// ⚠ THESE ARE STARTING VALUES CHOSEN TO FEEL RIGHT, NOT FITTED TO ANY BOOK.
// Nothing here was measured off real triangles. They are a first playable set,
// expected to move once the loss behaviour has been played with, and no
// calibration should be anchored to them until they settle.
//
// ⚠ A MARTINGALE PLUS A KNOWN DRIFT, and the drift is deliberate.
// The z_t term has zero mean, so the STOCHASTIC component is a pure martingale:
// no mean reversion, and a player cannot infer from a cohort's history where it
// is heading. The b/H term is a deterministic unwind of the initial optimistic
// booking, present so E[estimate(H)] = registerSum EXACTLY, per cohort — the
// pool cannot end up paying less than it drew. A player who works out that
// drift from their own funding choice is reading their own decision back, which
// is the intended lesson rather than a leak.
//
// ⚠ DEVELOPMENT IS ENTIRELY RETAINED. The tower cedes PER CLAIM and no claim
// changed size; this is an aggregate overlay on top of a register the tower has
// already run against. So reinsuranceRecovery is unmoved and 100% of
// development lands on the pool. That is CONSERVATIVE and DELIBERATE — a real
// treaty would pick some of it up — and it is recorded here so it is not later
// read as a bug. See reinsuranceDisplay.ts's seam note.

// Total development SD over the whole runoff, per line. The ANNUAL step is
// total / sqrt(E[horizon]), so a cohort accumulates approximately this much
// relative SD by the time it matures.
//
// ⚠ PROPERTY'S 15% IS A PLAYABILITY ADJUSTMENT, NOT A FITTED FIGURE, AND THE
// TWO SHOULD NOT BE CONFUSED. WC's 25% and GL's 20% are judgement calls about
// what a long-tail casualty runoff looks like. Property's ORIGINAL 8% was the
// same kind of call and was defensible on its own terms — a short-tail line
// genuinely does settle fast. It was raised to 15% for a different reason: at
// 8% the per-accident-year exhibit had almost nothing to show. Measured over
// 200 games, only 27.0% of Property rows ever moved more than 1%, none were
// still developing by game year 5, and a ten-year exhibit rendered as columns
// of repeated identical numbers for every accident year older than about
// three. 15% is chosen so the display has content. Both numbers are honest;
// they are answering different questions, and this note exists so a later
// reader does not mistake the second for the first.
//
// THE HORIZON DELIBERATELY DID NOT MOVE. Lengthening it would make each step
// QUIETER (the step is total/sqrt(E[H])), which is the opposite of what the
// exhibit needed — a longer runoff spreads the same total over more years and
// shows less per year, not more.
//
// AND THERE IS A REAL ARGUMENT FOR THE HIGHER NUMBER, worth stating so it does
// not read as pure display tuning. Property's book carries claims to $75M, and
// a large fire or flood genuinely takes years to adjust — scope disputes,
// business-interruption measurement, subrogation. A property book whose
// ultimates never move more than 8% is a book without large losses in it.
// Short-tail describes the PAYMENT pattern; it does not mean the first
// estimate of a $40M fire is within 8% of the final one.
export const IBNER_TOTAL_SD: Record<string, number> = {
  WC: 0.25,
  GL: 0.20,
  Property: 0.15,
};

// Runoff horizon in years, drawn PER COHORT (inclusive), so the player cannot
// tell how much development a given accident year has left.
export const IBNER_HORIZON: Record<string, { min: number; max: number }> = {
  WC: { min: 5, max: 12 },
  GL: { min: 3, max: 8 },
  Property: { min: 2, max: 4 },
};

// ⚠ NORMALISED TO RMS 1, AND THAT NORMALISATION IS LOAD-BEARING.
// The mixture exists so roughly half of accident years barely move: real books
// have boring years, and the boring ones are what make the others visible. It
// is drawn ONCE PER COHORT (not per step) — "boring YEAR" is a property of the
// accident year, not of each individual step.
//
// The weights below were first written as bridge sigmas (0.04 / 0.15 / 0.45)
// and would have been applied as step multipliers. Their RMS is
// sqrt(0.5(0.04^2) + 0.4(0.15^2) + 0.1(0.45^2)) = 0.1734, so used raw they
// would have delivered 17.3% of every stated total above — WC's "25%" arriving
// as 4.3%. Dividing through by that RMS gives the multipliers here, whose RMS
// is 1.000, so IBNER_TOTAL_SD means what it says while the shape is preserved:
// the 50% bucket still moves at 23% of nominal (about 2.0%/yr on WC).
export const IBNER_STEP_MIXTURE: readonly { weight: number; multiplier: number }[] = [
  { weight: 0.50, multiplier: 0.231 },
  { weight: 0.40, multiplier: 0.865 },
  { weight: 0.10, multiplier: 2.596 },
];

// FUNDING BIASES THE BOOKING. A squeezed pool books optimistically and the
// shortfall emerges later as adverse development.
//
//   squeeze = max(0, 1 - selectedFundingCLF)     b = COEFF x squeeze
//
// CLF 1.000 is break-even by construction, so `squeeze` is exactly "how far
// below break-even you chose to fund". Maximum available squeeze is close on
// all three lines — WC 0.234 (its slider reaches stop 10, CLF 0.7661), GL 0.250,
// Property 0.261 — so ONE pool-wide coefficient works without per-line
// normalisation.
//
// ⚠ RAISED FROM 0.40 TO 0.80 AFTER MEASURING, AND THE REASON IS THE RULING IT
// SUPPORTS. At 0.40 the maximum-squeeze drift measured 0.14 sigma of WC's
// calendar-year noise at steady state and about a third of that in years 1-3.
// The end-of-game deficiency disclosure was ruled on the premise that the
// exhibit shows the drift year by year, so the player sees the consequence and
// works out the cause; at 0.14 sigma it does not show, which makes a player
// unable to change course during the window when changing course is still
// possible. 0.80 gives a ~19% optimistic booking at maximum squeeze.
//
// ⚠ AND DOUBLING DOES NOT FIX THE EARLY-GAME WINDOW, because the coefficient is
// not what gates it. The unwind is only carried by cohorts the PLAYER wrote —
// pre-game cohorts carry bookingBias 0 by construction, since the player made
// none of those decisions — so in year 2 there is exactly one biased cohort and
// in year 3 there are two. The early signal is limited by cohort COUNT, and no
// value of this constant changes that. Raising it doubles the steady-state
// signal and leaves the first two or three years thin. If an early signal is
// wanted, the lever is the SHAPE of the unwind (front-loading it rather than
// spreading b/H evenly), not this number.
//
// STARTING VALUE still, measured but not fitted.
//
// ⚠ INERT AT DEFAULTS. defaultLineDecisionSet sets fundingAtExpected, pinning
// CLF to 1.000, so squeeze is 0 and no bias applies on a default run. That keeps
// default-run gates and the CLF derivation (which runs at defaults) clean of it.
//
// ⚠ THIS REPLACES fundingImpactOnDevelopment, WHICH NEVER APPLIED AT ALL. That
// term read priorFundingAdequacyRatio, which reads fundingAdequacyRatio, which
// is assigned from premiumFundingRatio — a hardcoded 1. Measured across 40
// games x 10 years x 3 lines at funding levels 0.30/0.60/0.95, that ratio took
// exactly one distinct value: 1. So the old bias was identically zero on every
// path, not merely weak. premiumFundingRatio is a separate defect and is
// deliberately NOT fixed here.
export const IBNER_BOOKING_BIAS_COEFF = 0.80;

// ⚠ THE UNWIND IS FRONT-LOADED, NOT SPREAD EVENLY, and the shape is the point.
// A flat b/H left years 2-3 of a squeezed game at 0.03-0.04 sigma of the line's
// own calendar noise — invisible during exactly the window when the player could
// still change course, because the early signal is gated by how many biased
// cohorts EXIST (one in year 2, two in year 3) rather than by how big the bias
// is. Doubling the coefficient scales every year equally and cannot fix that.
//
// Front-loading is also the more realistic shape. Friedland's age-to-age factors
// are largest at the earliest ages: a deficient case reserve gets corrected as
// soon as information arrives, not evenly across the runoff.
//
// The step weights are geometric with this ratio — half the remaining unwind at
// each step. On a WC cohort at maximum squeeze that is roughly 9.4% / 4.7% /
// 2.3% against the flat schedule's 2.2% every year.
// Typed `number` rather than left to narrow to the literal 0.5, so
// ibnerUnwindStep's rho === 1 guard (the degenerate flat-weights case) stays a
// legitimate branch instead of a compile error the day someone tries it.
export const IBNER_UNWIND_DECAY: number = 0.5;

// ===========================================================================
// PROPERTY loss model — FITTED, and it replaces a design that was never fitted.
//
// ⚠ WHAT WAS WRONG, IN BOTH DIRECTIONS AT ONCE. The retired design drew ~112
// claims a year at a $190,179 mean off a per-LOCATION frequency and a
// damage-ratio-times-location-TIV severity. Nine years of the pool's own
// property claims say 15.5 claims a year at $435,254. Eleven times too many
// claims at 44% of the size — so the AAL landed within a factor of three BY
// ACCIDENT, because only the product was ever anchored. That is the same
// defect WC's frequency had (finding 37): a product can be right while both
// factors are wrong, and only fitting the factors separately catches it.
//
// FIT PROVENANCE — 1,822 claims over nine MATURE policy years, 2015-16 to
// 2023-24.
//   NON-VEHICLE ONLY. VCL is auto physical damage: 51% of claims but 5.5% of
//     dollars, and its severity CV of 1.57 against 15.2 for the rest shows it
//     is a different population, not a thin tail of the same one.
//   THE 2025-01-07 WILDFIRE IS EXCLUDED — six claims, $557.5M. It belongs to
//     the cat shock events, and leaving it in would have let one event set the
//     shape of the whole body.
//   Amounts trended to 2024 at 4%/yr. The SHAPE is insensitive to that choice:
//     the fitted mean moves 22% across a 2.4-10% range, which is small next to
//     the tail parameter it would otherwise be confounded with.
//   ⚠ 40% OF AMOUNTS ARE ROUND-NUMBER CASE RESERVES, so the body carries spikes
//     at $25k/$50k/$100k and the fit is mildly TIGHTER than settled claims
//     would be. Read the body as slightly optimistic; the tail is unaffected.
export const PROPERTY_LOSS_MODEL = {
  // Per $1M of TIV, not per location and not per member. The location basis
  // went with the damage-ratio severity it existed to serve.
  //
  // FROM THE RECENT FIVE YEARS, NOT ALL NINE. The early years run ~30% lower,
  // which is the signature of TIV restated to current membership rather than a
  // real frequency trend. Both readings argue for the recent figure: if TIV was
  // restated, the early years understate frequency against a too-large
  // denominator; if it is genuine escalation, the recent level is where the
  // book now sits.
  frequencyPer1mTiv: 0.00221,

  // FLAT. There is no frequency trend in the fit, and inventing one from nine
  // years of a book whose TIV basis moved would be reading noise.
  frequencyTrendPerYear: 0,

  // Four-component lognormal mixture on the claim amount. AIC 6714 and BIC
  // 6775 BOTH select k=4 — no conflict between them, unlike GL, where the two
  // criteria disagreed and the choice had to be argued.
  //
  // Component means: $11,414 / $29,664 / $85,725 / $913,762. The top component
  // carries 45% of the weight at sigma 1.7417 and is what makes this line's
  // annual result a question of whether a large claim happened.
  severityMixture: [
    { weight: 0.1562, mu: 9.2566, sigma: 0.4147 },
    { weight: 0.0714, mu: 10.2933, sigma: 0.0937 },
    { weight: 0.3210, mu: 11.1586, sigma: 0.6330 },
    { weight: 0.4514, mu: 12.2086, sigma: 1.7417 },
  ],

  // ⚠ THE CAP IS NOT OPTIONAL, and the evidence is better than GL's was.
  // Uncapped, the top component puts half of E[X^2] above $86.5M against a
  // SAMPLE MAXIMUM of $51.9M, and the severity CV reads 6.22 against the
  // sample's 4.46. Capped here it is 4.78 — still above the sample, correctly,
  // since a nine-year sample does not contain its own worst case.
  //
  // Measured by property-fit-check.ts from these parameters rather than taken
  // on trust: the cap removes 1.9% of the mean and binds once in 6,610 claims,
  // which at the enrolled book is about once per 700 years. It disciplines the
  // second moment, which is its job; it is not a loss limit.
  severityCap: 75_000_000,

  // RQ channels, unchanged in structure from the retired design and
  // re-pointed at the mixture: frequency scales the Poisson mean, severity
  // scales the mixture's LOCATION parameter (mu + log(factor)), which moves the
  // whole distribution multiplicatively and leaves its shape alone.
  rqFrequencyBeta: 0.08,
  rqSeverityBeta: 0.04,

  // Short-tailed: reported in the accident year, paid over three.
  reportLagYears: 0,
  payoutPattern: [0.70, 0.25, 0.05],

  // Construction cost inflation, through the shared accident-year ->
  // settlement convention. Not a second trending convention.
  severityTrendPerYear: 0.04,

  // Per-occurrence frequency noise, Gamma(k, 1/k). Kept at the retired
  // design's k=44.4 (SD 0.15) because nothing in the fit speaks to
  // year-on-year frequency dispersion — nine years cannot separate it from
  // severity noise. INHERITED, NOT FITTED, and it should be revisited if the
  // claim counts ever support it.
  memberFrequencyNoise: { shape: 44.4, scale: 1 / 44.4 },

  // ⚠ RE-DERIVED AND NOW LOAD-BEARING. Was $2M, set at roster v3 ($6,993.3M
  // TIV) and left unanchored through two TIV rescales — its own comment used
  // to say so. $5M is the per-occurrence tower's retention (see
  // reinsuranceTower.ts's header), decided before this commit and consumed by
  // reinsuranceTower.ts's REINSURANCE_TOWER.Property and by
  // propertyAggregate.ts's aggregate pricing, not just the diagnostic breach
  // counter this field used to serve alone.
  perRiskRetention: 5_000_000,
};

// The held pure premium, per $100 of TIV. DERIVED, and now derived ONLY.
//
// = frequencyPer1mTiv x the capped mixture mean ($435,256), i.e. the
// generator's own analytic expectation over the 1,822 fitted claims. Asserted
// against the generator by property-fit-check.ts and property-claim-check.ts,
// so the price and the draw cannot drift apart.
//
// ⚠ AN ASSERTED CAT LOAD OF 0.0247 WAS REMOVED FROM THIS CONSTANT, taking it
// from 0.1209 to 0.0962. Recorded in full so it can be restored correctly
// rather than re-derived from memory:
//
//   WHAT IT WAS. One observed event in ten years — $550M of loss on $111.1B of
//   TIV, 0.495% — priced at a 1-in-20 return period. A SINGLE OBSERVATION AT A
//   CHOSEN RETURN PERIOD, never a fit, and tagged ASSERTED throughout.
//
//   WHY IT CAME OUT. The intent was that shock events REALISE the load rather
//   than add to it, the same structure as GL's social-inflation baseline with
//   event #19 on top. But Property's cat shock is gated off and the aggregate
//   shock add-on that used to reach Property left with the Gamma path, so
//   Property collected the load every year and COULD NOT INCUR IT — a 20.4%
//   over-collection with CERTAINTY, not in expectation.
//
//   AND IT WOULD HAVE POISONED THE CLF TABLE. That table is derived by
//   backtest against what the engine actually draws. With the load in, it
//   would have measured a Property collecting 0.1209 and losing 0.0962 —
//   reading ~80% of premium every year with no variance contributed by the
//   load at all. Every stop would sit in the wrong place, and because the
//   table is iterated to a fixed point it would have converged onto that
//   wrong answer confidently.
//
//   ⚠ IT RETURNS WITH THE CAT BAND, IN THE SAME COMMIT AS THE CAT BAND, so the
//   price and the losses can never disagree again. Adding the load back on its
//   own would recreate exactly the defect that removed it.
export const PROPERTY_HELD_PURE_PREMIUM_PER_100 = 0.0962;

// The retired load, kept as data rather than prose so the restoring commit has
// a value to reinstate and property-claim-check has something to assert the
// held constant is NOT carrying. `catAssertedRetired` is deliberately NOT summed
// into the held constant anywhere.
export const PROPERTY_PURE_PREMIUM_SPLIT = { nonCatDerived: 0.0962, catAssertedRetired: 0.0247 };
