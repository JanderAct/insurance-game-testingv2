// Centralized assumptions for Risk Pool Simulation v1
// V2: Allow admin-editable assumptions from a backend config

import type { Region, CoverageLine } from '../types/simulation';
import type { PayoutPattern } from '../utils/payoutPattern';
import type { ClosureCurve } from '../utils/claimClosure';

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
  //
  // ⚠ AND ITS ABSENCE HAS NOW BEEN REDISCOVERED FIVE TIMES, SO IT IS WRITTEN
  // DOWN HERE RATHER THAN FOUND AGAIN. The model has NO late reporting on any
  // line: every claim is in the register from its accident year. The source's
  // reported COUNTS grow 6.5% by age 2 and are still moving 0.25% at age 5.
  //
  // It is small, and it is a real absence rather than a simplification with a
  // ruling behind it. What it costs is specific: a triangle built from this
  // model develops only through CASE movement on claims already reported, so
  // every age-to-age factor is a statement about open claims and none of it is
  // pure emergence. Anything that reasons from a factor above 1.0 on a line
  // whose claims are closed — as one reading of GL's ages 9 and 10 did — has no
  // mechanism here to explain it and should suspect this first.
  //
  // RECORDED, NOT FIXED. Reinstating it is a deferral architecture and a ruling
  // reversal, and at 6.5% by age 2 it is not what is holding the rebuild up.


  // ⚠ SHOCK-ONLY NOW. This no longer scales chronic severity — it is retained
  // as data because a regional catastrophe is a real thing for region to scale,
  // and a standing +/-5% on every claim in one region was not. Nothing in the
  // WC draw or analytic reads it; wcClaimEngine's accessor is the single door
  // a future shock should come back through.
  //
  // ⚠ AND IT WAS NEVER "MEAN-NEUTRAL BY CONSTRUCTION", which is what this said.
  // The three multipliers average to exactly 1.00; the BOOK does not. Weighted
  // by expected loss the roster's mean is 0.996983, so region was quietly
  // holding WC's expected loss 0.30% BELOW where the mixture put it.
  //
  // ⚠ AND THE PAYROLL-WEIGHTED FIGURE (0.997587, i.e. 0.24%) IS THE WRONG ONE,
  // which is worth stating because it is the intuitive one to reach for. WC's
  // loss cost is not proportional to payroll: schools carry 7.5% of payroll but
  // 2.7% of expected loss, highSafety 12.1% against 19.0%. The region mixes
  // differ across those groups — schools is 45.7% South, lowSafety 45.4% North
  // — so weighting by payroll and weighting by loss give different answers, and
  // only the loss-weighted one predicts what removing the multiplier did.
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
// is measured in scripts/diagnostics/membership-equilibrium-report.ts.
//
// ⚠ "VERIFIED" WAS THE WRONG WORD AND THE FILE'S OLD NAME (-check) IS WHY. That
// script prints the trajectory and exits 0 either way, so the flatness is a
// RECORDED READING and nothing gates it. Nothing else asserts it either.
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
// risk-pool style portfolio assumptions. Cash and bonds essentially never have
// a real down year; equities does, by design, to make the allocation decision
// carry real risk/return tradeoff.
//
// Single-regime model: one normal draw per class per year, minus a fee. Means
// and SDs are GROSS of fees. There is deliberately NO separate downside regime
// — market crashes are the Phase 4 shock-event system's job, and a second
// downside distribution here would double-count them. minReturn/maxReturn are
// inert sanity rails only, wide enough (3.4σ+) that they essentially never
// fire; they exist to prevent nonsense like a sub−100% draw producing negative
// invested assets, not to shape the distribution.
//
// ============================================================================
// WHAT THESE ACTUALLY DELIVER, MEASURED — 200,000 draws through the real
// simulateMarketReturns/blendInvestmentReturn path, at the default 10/80/10:
//
//     net mean 5.28%      SD 3.71%      (analytic: 5.289% / 3.712%)
//     p5 -0.83%   p25 2.78%   p75 7.79%   p95 11.37%
//     31.4% of years land below 3.5%; 7.7% are negative
//
// ⚠ ONE MARKET DRAW PER YEAR, SHARED, AND THE ALLOCATION IS POOL-WIDE. Every
// line therefore realises the IDENTICAL return rate in a given year — the
// market is drawn once (simulateMarketReturns) and processYear projects one
// `assetAllocation` into every line. A report showing "the same implied return
// on all three lines" has measured that construction, not a coincidence.
//
// ============================================================================
// ⚠ "INTENTIONALLY MODEST SO INVESTMENT INCOME DOES NOT DOMINATE UNDERWRITING
// RESULTS" STOOD HERE AND IS NO LONGER TRUE. That WAS the design intent and it
// is worth keeping on the record, because the way it broke matters more than
// the fact that it did.
//
// Measured across 30 games at CLF 0.45, investment income as a multiple of
// |underwriting income|:
//
//     WC 1.12x        GL 0.66x        Property 0.40x
//
// and the share of underwriting-NEGATIVE line-years that still grew surplus:
//
//     WC 52%          GL 43%          Property 14%
//
// On WC the float now out-earns the underwriting result outright.
//
// ⚠ THE RATE DID NOT MOVE. THE DENOMINATOR DID. Not one parameter below has
// changed. The payout patterns roughly doubled the reserve, the reserve IS the
// invested base, so the float this same rate applies to roughly doubled with
// it. The intent broke because the thing it was set against moved underneath
// it — nobody loosened it.
//
// ⚠ REVIEWED AND DELIBERATELY LEFT. 5.28% net, with bonds at 5.20% gross, is a
// defensible short-duration investment-grade posture on its own terms, and the
// dominance arrived through a CORRECT change to the reserve. Cutting returns to
// restore an intent whose premise had moved would be correcting a right thing
// with a wrong one. The dominance is also not implausible: a long-tail pool
// with a large float genuinely can absorb underwriting losses for years, which
// is cash-flow underwriting, and it is the mechanism that makes reserving
// matter now that the ending-position panel shows what is still owed.
//
// ⚠ AND THE PARAMETERS CITE NO SOURCE. "Whole-period historical values that
// already include crash years" names no index, no period and no study, here or
// in the commit that introduced them (406fba9) or in the player-facing
// investmentMemo, which restates this table downstream rather than sourcing it.
// They are considered numbers, not sourced ones. A reader should not assume
// there is a reference behind them, and anyone who wants to move them is
// choosing against judgement rather than against data.
//
// ============================================================================
// THE OPEN ITEM IS THE ALLOCATION, NOT THE RATE.
//
// AllocationBar is a free 0-100% control across the three classes, so the
// reachable mean spans 4.15% (all cash) to 8.14% (all equities) — and NOTHING
// PRICES THE VOLATILITY except insolvency. On a $40M float over five years:
//
//     default 10/80/10   E +$10.6M    SD  $3.3M
//     all equities       E +$16.3M    SD $16.3M
//
// so switching buys about +$5.7M in expectation against ±$16.3M of noise. For a
// player judged on ending surplus, with no penalty attached to the spread, that
// is simply the correct play — at which point the allocation stops being a
// decision and becomes a right answer.
//
// ⚠ THE MISSING PIECE IS ALREADY NAMED IN THE MEMO: "no liquidity requirement
// or early-sale cost is currently applied." That is the live gap, the doubled
// float made it bigger, and SHOCK EVENTS LAND ON TOP OF IT — a claim spike
// against a 100% equity book with no cost to selling into it is precisely the
// scenario a liquidity requirement exists to model. Fix that before revisiting
// anything below.
// ============================================================================
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
// ============================================================================
// ⚠ THIS IS A SEARCH ORIGIN, NOT A CAPITAL STANDARD. Read that sentence before
// reasoning about these numbers at all. The obvious reading is wrong, and the
// length of what follows is because it was reached twice in one week from
// opposite directions — once by a plan to pin opening surplus to the reserve,
// and once by this constant's own retired comment.
//
// The pre-game is a reject-and-redraw search: runLinePreGame simulates a
// candidate three-year past, tests its ending surplus against
// OPENING_SURPLUS_TO_PREMIUM_BAND, and redraws until one lands inside. This
// constant sets where that search STARTS. The BAND sets where it LANDS. They are
// a proposal distribution and a target, and moving the proposal changes the
// ACCEPTANCE RATE, not the answer.
//
// MEASURED, so it is not a story. Doubling each pin in turn and re-running the
// solo pre-game. These are pin-vs-band-check.ts's own readings; that gate
// asserts the PROPERTY rather than these exact figures, so re-run it rather than
// trusting the table if a band or a pin moves. Re-measured at the shipped
// 0.41 / 0.27 / 0.41:
//
//   line       accepted opening surplus/premium   mean redraw attempts
//   WC              1.044 -> 1.083   (+3.7%)          1.93 -> 16.60    (8.6x)
//   GL              1.454 -> 1.531   (+5.3%)          1.52 -> 12.65    (8.3x)
//   Property        1.463 -> 1.487   (+1.6%)          2.92 -> 10.22    (3.5x)
//
// (At the retired pins the same table read 1.034 -> 1.104 / 1.433 -> 1.602 /
// 1.431 -> 1.521 on the opening and 2.20 -> 67.90 / 1.75 -> 7.90 / 3.17 ->
// 14.55 on attempts. The RELATIONSHIP is what the gate asserts; the digits move
// with every re-centring and are a reading, not a target.)
//
// A 100% MOVE IN THE PIN BUYS A 2-6% MOVE IN THE OPENING AND MULTIPLIES THE
// REDRAW BILL. It was found the other way round, at the retired values: doubling
// GL's old pin of 0.45 moved its opening 1.1% and took the mean attempt count
// from 11.8 to 108.2, with a worst case of 481 against a MAX_HISTORY_ATTEMPTS of
// 500 — within 4% of the search failing outright.
//
// SO THE CALIBRATION TARGET IS THE CENTRING, and the redraw bill is its symptom.
// Each value is the K that centres its line's UNFILTERED opening distribution on
// its own band's midpoint, so the band accepts near the mode instead of out in a
// tail. Measured with the band disabled, the median opening is affine in K:
//
//   WC        surplus/premium ~ 0.2059 + 2.1214 K   band midpoint 1.025  ->  0.41
//   GL        surplus/premium ~ 0.4306 + 4.1063 K   band midpoint 1.510  ->  0.27
//   Property  surplus/premium ~ 0.1296 + 3.3089 K   band midpoint 1.415  ->  0.41
//
// (300 seeds at each of five K per line, R^2 0.9988 / 0.9997 / 0.9998. The fits
// recorded here before this commit — -0.014 + 2.227K, 0.531 + 4.132K, 0.033 +
// 2.889K, giving 0.47 / 0.24 / 0.48 — were the same measurement against an
// earlier engine and are superseded, not corrected.)
//
// The basin is broad, not a knife edge — GL measured 2.15 / 2.21 / 2.01 / 1.91 /
// 1.95 mean attempts at K = 0.20 / 0.22 / 0.24 / 0.26 / 0.28 — so the fitted
// value is kept rather than the sample minimum, which would be fitting noise.
//
// ⚠ THE SLOPE IS SOLID AND THE LEVEL IS NOISY, WHICH IS HOW TO RE-SOLVE THIS.
// R^2 above 0.998 makes the slope reliable, but the median itself is a sample
// statistic: bootstrap SE at 800 seeds is 0.015 / 0.031 / 0.046, so a 300-seed
// fit can place the level ~0.05 off and the first solve from these fits
// overshot every line by about that much. The method that worked: solve from the
// fit, then measure the median at that K on a LARGE INDEPENDENT seed base and
// take one Newton step, `K += (midpoint - median) / slope`. Validated at 800
// fresh seeds, the shipped values land +0.015 / -0.003 / +0.022 from their
// midpoints — 1.0 / 0.1 / 0.5 standard errors, i.e. centred within noise.
// opening-centring-check asserts this property on every run.
//
// WHY THIS IS WORTH A COMMIT: the pre-game runs at the start of every session and
// fifty opening positions are to be precomputed, so an attempt is setup time paid
// fifty times over. 150 solo seeds per line, mean attempts, at the ORIGINAL
// re-centring:
//
//   WC 7.25 -> 1.63    GL 10.57 -> 1.87    Property 4.81 -> 2.99
//   pool total 22.63 -> 6.49 candidate pre-games per opening, a 71% cut
//
// ⚠ AND IT HAS NOW DRIFTED TWICE, WHICH IS WHY THERE IS A GATE. This is a
// property of the constant AGAINST AN ENGINE, and payout patterns, closure
// curves and the per-claim payment split all moved it after it was last set.
// Found the first time at 995f6f9 while re-reading the constant; found the
// second time while measuring something else entirely (the cost of a deeper
// pre-game), by which point the unfiltered median sat +0.19 off its midpoint on
// WC and +0.29 on Property — roughly half of each band's width, so half the
// candidate distribution was rejected at the CEILING and the accepted set came
// from the low tail. The pool was shipping systematically weaker openings than
// the engine's own distribution gives, and nothing downstream could see it
// because every accepted opening is inside the band by construction.
//
// The redraw bill barely moved across the second drift (2.9 / 2.6 / 4.0 attempts
// against 2.20 / 1.75 / 3.17 recorded), which is exactly why cost is the wrong
// thing to watch: the SELECTION BIAS is the damage and it is invisible in
// attempt counts. opening-centring-check asserts the centring directly, so the
// next engine change trips a gate instead of the drift being found a month later
// by someone measuring something else.
//
// ⚠ THE OLD VALUES WERE 0.70 / 0.45 / 0.18 AND THEIR COMMENT APOLOGISED FOR
// HAVING NO RATIONALE. The apology was for the absence of a rationale this
// constant never needed: it went looking for a per-line CAPITAL argument (tail
// length, volatility) to justify an ordering, found none, and recorded the
// failure. There was nothing to find, because the ordering was never carrying
// line-specific capital information — it was carrying the OFFSET between each
// line's natural opening and its own band. Centre the three lines on their bands
// and the spread collapses from 3.9x to 2.0x, which is the tell.
//
// ⚠ NOT THE YEAR-1 OPENING RATIO EITHER. Three simulated years run on top of
// these, so the opening lands at roughly 1.01x / 1.55x / 1.42x premium. Anyone
// reading 0.41 as "WC opens at 0.41x premium" is wrong by a factor of two and a
// half.
//
// DISPLACED BY: nothing. A real capital standard would displace the BAND, not
// this. See the closed form recorded under the band below.
// ============================================================================
export const STARTING_CAPITAL_TO_PREMIUM: Record<string, number> = {
  WC: 0.41,
  GL: 0.27,
  Property: 0.41,
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
// SEED, while this band tests the opening after three years of operation. It is
// the search's starting point and this is its target; a tolerance around the
// start would reject essentially every pre-game. See the pin's own comment.
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
// margin/premium ratio:
//   WC        [1.35, 2.0] x 0.612 = [0.83, 1.22]   (a3d7760, parent's ratio)
//   GL        [1.35, 2.0] x 0.900 = [1.22, 1.80]   (re-translated — see below)
//   Property  [2.0,  3.0] x 0.567 = [1.13, 1.70]   (a3d7760, parent's ratio)
// so the accept/reject decision is the same one, taken against a stable basis.
//
// ============================================================================
// ⚠ WHEN A BAND MAY BE RE-TRANSLATED, AND WHY THE RULE IS NARROW.
//
// Translating a band at the current margin/premium ratio is how a band gets its
// number. It is NOT a standing tie to that ratio. Re-translating every time the
// ratio moves would reinstate exactly the coupling a3d7760 removed — the opening
// tracking the reserve margin — only at commit latency instead of automatically,
// which is worse, because it looks deliberate.
//
// So the TRIGGER is an observed defect in the opening, not a stale ratio. The
// translation is only the METHOD for choosing the replacement, used in place of
// picking a number.
//
// GL MET THAT BAR. The payout patterns lengthened GL's tail, its reserve rose
// 61.6% and its required margin rose with it, while surplus — pinned to premium
// — did not move. The band's floor of 1.00 ended up BELOW the margin the line
// had to hold, so the pre-game was accepting openings GL could not capitalise:
// 28.7% of solo seeds opened below their own required margin, against 0% before.
// Re-translated to [1.22, 1.80] that closes to 0.0%, with even the 10th
// percentile at 1.29x margin.
//
// ⚠ MOST OF THAT TAIL WAS THE PIN, NOT THE BAND, and the honest attribution
// matters because it is the reason the first re-translation attempted here was
// wrong. Re-centring GL's pin alone, band untouched at [1.00, 1.49], already
// takes the below-margin rate from 28.7% to 4.0%. The old pin sat so far above
// GL's band that the band was only ever accepting the LOW-SURPLUS TAIL of the
// candidate distribution, and a low-surplus candidate is one with heavy losses,
// hence a large reserve and a large margin. The 29% was mostly that selection.
// The residual 4.0% is the real defect and is structural: the floor of 1.00 sits
// below GL's margin/premium at the upper end however the pin is placed.
//
// ⚠ SO THE TRANSLATION RATIO MUST BE MEASURED UNFILTERED. Measured on the
// band-SELECTED sample, GL's ratio read 1.119 and gave [1.51, 2.24] — 48% above
// the old band, which would have been a re-tune wearing a translation's clothes.
// Measured on the UNFILTERED candidate distribution (band disabled, attempt 0)
// it is 0.900. The unfiltered figure is the right basis because it is the only
// one that does not depend on the band being calibrated, and because it is
// stable: across a 4x range of pin values it moves less than 1%.
//
//   line       unfiltered median margin/premium at K x0.5 / x1 / x2
//   WC              0.5591 / 0.5575 / 0.5532
//   GL              0.8944 / 0.8942 / 0.8922
//   Property        0.5502 / 0.5446 / 0.5446
//
// The selected ratio has no such property — it is a function of where the band
// is, so translating at it is a fixed-point iteration against your own
// selection effect. That is the same self-reference clfTables.ts records three
// passes of, and it is avoidable here rather than merely survivable.
//
// WC AND PROPERTY WERE CHECKED AND DELIBERATELY LEFT ALONE. Neither has a
// defect: no seed on either line opens below its required margin, at p10
// surplus/margin 1.46 on WC and 1.91 on Property.
//
// ⚠ AND THE APPARENT CASE FOR MOVING PROPERTY EVAPORATED ON THE UNFILTERED
// BASIS, which is worth recording because it nearly caused a second re-tune.
// Property's SELECTED margin/premium read 0.401 against the parent's 0.567 — a
// 29% move that looked like GL's case. It was almost entirely selection: the old
// pin of 0.18 sat far BELOW Property's band, so the band accepted only the
// HIGH-surplus tail, which is the low-loss, low-reserve, low-margin tail.
// Unfiltered, Property's ratio is 0.5446 and the parent's figure was 0.567.
//
// A CONSISTENT UNFILTERED DERIVATION OF ALL THREE, for whoever touches one next:
//
//   line       unfiltered ratio   band it implies    band in force
//   WC              0.5575        [0.75, 1.11]       [0.83, 1.22]   +9%
//   GL              0.9000        [1.22, 1.80]       [1.22, 1.80]    on it
//   Property        0.5446        [1.09, 1.63]       [1.13, 1.70]   +4%
//
// So GL is now derived on that basis and WC and Property are 9% and 4% above it,
// carrying a3d7760's parent-selected figures. That is a basis inconsistency and
// it is being lived with rather than hidden: 9% and 4% do not warrant re-rolling
// every seed on two lines that are not misbehaving, and the numbers are written
// down so the next change starts from the right basis instead of rediscovering
// this the hard way, as this commit did.
//
// ⚠ ONE LIVE QUESTION LEFT, AND IT IS NOT AN ARITHMETIC ONE: Property opens at
// 2.76x its required margin, so its capital constraint may never bind and the
// line may carry no capital DECISION for the player. That is a game-design
// finding for the playtest, to be settled by watching someone play.
// ============================================================================
export const OPENING_SURPLUS_TO_PREMIUM_BAND: Record<string, { min: number; max: number }> = {
  WC: { min: 0.83, max: 1.22 },
  GL: { min: 1.22, max: 1.80 },
  Property: { min: 1.13, max: 1.70 },
};

// ============================================================================
// THE ARITHMETIC BEHIND ANY FUTURE CAPITAL RULE — recorded because it is not
// obvious, and because it is the thing to check before proposing one.
//
// A capital standard would replace the band above with a rule of the form
// "hold J x reserve" or "hold T x required margin". The two are the same rule,
// because required margin is EXACTLY a per-line multiple of the reserve:
//
//   reserveRiskMarginNeeded = expectedNetUnpaidLoss x (reserveMarginCLF - 1)
//
// and reserveMarginCLF at the 90% stop is a STATIC per-line table. So
// margin/reserve is not an estimate with a confidence interval, it is a
// constant, and it measures with zero dispersion across seeds and across both
// payout-pattern arms:
//
//   WC 0.3294      GL 0.5020      Property 0.5923
//
// Therefore J_line = T x (CLF_line - 1) exactly. Which means: any per-line
// reserve pin that carries a capital RATIONALE puts the 90% CLF back on the
// opening path — the single coupling a3d7760 removed, and the one
// simulationEngine.ts's margin site says in terms to keep out. A uniform J
// avoids the CLF but then asserts the three lines should hold the same capital
// per dollar of reserve while their CLFs differ by 1.80x, which is not a
// standard either. If a standard is adopted, freeze the CLF-derived J as
// literal constants at calibration time — the way a3d7760 froze this band — so
// the CLF sets the number once and never becomes a live consumer.
//
// ⚠ A RESERVE PIN WAS PROPOSED AND MEASURED AND REJECTED. Not on taste: the
// proposal was to seed surplus as J x reserve instead of K x premium, and the
// only reserve in existence at year -2 is the bootstrap draw, which is a STATIC
// DOLLAR BAND (WC $4-8M, GL $1-2.5M, Property $0.3-0.9M) with no link to how big
// the pool is. Pearson r against seed premium over 200 instances:
//
//   WC -0.014      GL +0.068      Property -0.008
//
// and seed reserve/premium spans 1.94x / 2.71x / 4.17x p90-over-p10. J x seed
// reserve would make opening capital INDEPENDENT OF POOL SIZE and 2-4x noisier
// than K x premium. The seed reserve is also 3.6x / 16.9x / 14.8x smaller than
// the reserve at the opening, so it is not the pool's liability in any case.
// Whoever proposes this next should find this measurement rather than repeat the
// proposal.
// ============================================================================

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

// ===========================================================================
// PER-LINE PAYOUT PATTERNS.
//
// ⚠ THIS RETIRES LINE_RESERVE_PAYDOWN_PCT (0.35 WC/GL, 0.65 Property) AND
// IBNER_OPEN_FRACTION (0.60). Both were placeholders and said so: the paydown
// constant described itself as "the lightweight placeholder for each line's
// development-pattern character until Phase 3 builds real per-line
// accident-year triangles." This is that, arriving by fit rather than by
// triangle.
//
// ⚠ A SINGLE RATE IS A WEIBULL WITH k FIXED AT 1, AND TWO OF THE THREE LINES
// SIT NOWHERE NEAR IT. That is the whole argument for the change. A geometric
// paydown pays a constant share of what is left every year, which is what k = 1
// means; the fitted shapes are k = 0.64, 1.88 and 0.96, so only Property was
// ever close. WC pays fast then crawls, GL pays almost nothing for two years
// and then piles in, and no single number expresses either.
//
// ⚠ WHERE THE PARAMETERS COME FROM, AND WHAT IS DELIBERATELY NOT HERE.
// The shape was fitted against the pool's own real settlement experience, each
// line fitted SEPARATELY — the differences between the three are measured, not
// assumed. THE PARAMETERS BELOW ARE THE ENTIRE RECORD OF THAT FIT. No source
// data is carried into this repository: no claim counts, no dollar totals, no
// policy years, no valuation dates, no triangles. The same standing convention
// as GL's severity constants, which cite their fit without carrying the claims
// behind it.
//
// The instinct when writing a header like this is to paste the table that was
// fitted against so a later reader can re-derive it. Do not. If the fit needs
// revisiting, it is re-run against the source where the source lives.
//
// ⚠ THE TABLE BELOW IS A CHECK ON THE PARAMETERS, NOT THEIR SOURCE. It is what
// `1 - exp(-(t/b)^k)` produces, rounded, and exists so a reader can see the
// shape without running anything. Cumulative % of ultimate paid by age t:
//
//   age          1     2     3     5     8    10
//   WC        41.0  56.0  65.5  77.2  86.4  90.0
//   GL         9.6  31.0  54.9  87.5  99.3 100.0
//   Property  50.4  74.4  86.6  96.3  99.4  99.8
//
// against what the retired constants produced:
//
//   WC        40.0  61.0  74.6  89.3  97.1  98.8
//   GL        40.0  61.0  74.6  89.3  97.1  98.8
//   Property  40.0  79.0  92.7  99.1 100.0 100.0
//
// ⚠ WHAT THIS DOES TO THE POOL, so nothing downstream reads as a defect. The
// steady-state reserve goes from about 1.38 years of loss to about 2.28, call
// it 1.66x: WC 1.90x, GL 1.46x, Property 1.93x. Invested assets rise with the
// reserve and investment income rises with them. GL's first year goes from 40%
// paid to 9.6%, the largest single correction, on the line carrying about 45%
// of pool loss. That is the point of the change and not a side effect of it.
// ===========================================================================
export const FITTED_PAYOUT_PATTERN: Record<string, PayoutPattern> = {
  WC: { kind: 'weibull', k: 0.64, b: 2.717 },
  GL: { kind: 'weibull', k: 1.88, b: 3.388 },
  Property: { kind: 'weibull', k: 0.96, b: 1.449 },
};

// ⚠ THE NULL TEST'S CONTROL, AND IT IS THE RETIRED MECHANISM RATHER THAN A
// TIDY VERSION OF IT. openFraction is the old IBNER_OPEN_FRACTION and
// `conditional` the old LINE_RESERVE_PAYDOWN_PCT, stored in exactly the form
// the engine used to multiply by so the arithmetic reproduces bit for bit.
//
// A payout pattern spends NO RNG DRAW, so unlike the last several mechanism
// changes this one can be null-tested against the parent baseline directly:
//
//   sed -i 's/= FITTED_PAYOUT_PATTERN/= LEGACY_GEOMETRIC_PATTERN/' src/data/defaultAssumptions.ts
//   npx tsx scripts/diagnostics/value-identity-check.ts     # expect 0 values changed
//   sed -i 's/= LEGACY_GEOMETRIC_PATTERN/= FITTED_PAYOUT_PATTERN/' src/data/defaultAssumptions.ts
//
// That separates the plumbing from the calibration: green means the pattern
// machinery reproduces the old mechanism exactly, so everything that moves when
// the fitted parameters go in is the fit and nothing else.
export const LEGACY_GEOMETRIC_PATTERN: Record<string, PayoutPattern> = {
  WC: { kind: 'geometric', openFraction: 0.60, conditional: 0.35 },
  GL: { kind: 'geometric', openFraction: 0.60, conditional: 0.35 },
  Property: { kind: 'geometric', openFraction: 0.60, conditional: 0.65 },
};

export const LINE_PAYOUT_PATTERN: Record<string, PayoutPattern> = FITTED_PAYOUT_PATTERN;

// ===========================================================================
// CLAIM CLOSURE CURVES — see claimClosure.ts for the form and the discipline.
//
// Fitted against the pool's own closure experience, each line separately, on the
// share of REPORTED claims closed by age.
//
// ⚠ CORRECTED ONTO A NO-LATE-REPORTING BASIS BEFORE FITTING, and that correction
// is the single largest thing separating these numbers from the previous ones.
// The source measures closed over the count REPORTED SO FAR, and that count
// keeps growing — claims are still being reported at age 5. The model has no
// report lag at all: every claim exists at age 0 and the count is final from the
// start. So the source's raw share is closed over a denominator that is still
// filling, and applying it to a full denominator closes too many claims too
// early.
//
// Each source age's closed share is therefore divided by that age's reported
// development factor before fitting. The reported count grows 12.16% from age 1
// to ultimate, so age 1 carries a factor of 0.8916 and the correction decays at
// 0.4421 per step — two numbers that reproduce the whole adjustment, recorded
// here for the same reason k and b are, and with no counts.
//
// ⚠ THIS IS A CALIBRATION, NOT A MECHANIC. The alternative was to give the model
// late reporting — a status layer, or a real report lag — and it was rejected:
// adding a mechanic to fix a calibration is backwards, and the honest statement
// is that this model has no late reporting and its closure curve is calibrated
// to that. FOURTH SIGHTING of the removed report lag (a stale WC header,
// understated workbook counts, the closure discrepancy, now this basis); if
// there is a fifth, the assumption deserves one commit that states everywhere it
// is load-bearing.
//
// ⚠ CLOSURE IS SLOWER THAN PAYMENT AND THE TWO ARE SEPARATE FITS. Compare the
// k's against FITTED_PAYOUT_PATTERN's — WC closure 0.670 against payout 0.64, GL
// closure 1.410 against payout 1.88. Genuinely different, not one number wearing
// two names.
//
// ⚠ FITTED ON A GAME-RANGE OBJECTIVE: ages 1-5 carry full weight, ages beyond
// carry a fifth. The game is five years, so ages 1-5 are what a player ever sees
// and ages 8-10 are almost never reached; the tail is kept at a fifth rather than
// dropped so the curve still has to terminate sensibly instead of running off.
//
// ⚠ AND THE OBVIOUS WEIGHTINGS WERE MEASURED AND REJECTED, which is worth
// recording because they LOOK like they serve the same purpose and do not. The
// age-1 residual is the visible symptom, so weighting toward age 1 is the
// tempting fix: 1/age cuts WC's age-1 residual from +3.42 to +1.49, and an
// age-1 x8 weight to +0.64. But measured over ages 1-5 TOGETHER — the actual
// stated goal — both make things WORSE on every line:
//
//   line       objective     age-1 resid   RMSE ages 1-5
//   WC         unweighted       +3.42         0.0306
//   WC         1/age            +1.49         0.0319
//   WC         age-1 x8         +0.64         0.0338
//   WC         game range       +3.02         0.0303
//   GL         unweighted       +2.33         0.0213
//   GL         game range       +2.18         0.0213
//   Property   unweighted       -0.78         0.0119
//   Property   game range       -0.75         0.0119
//
// So age-1 x8 overfits the front harder than 1/age, and 1/age overfits it too:
// both buy the single age-1 point by giving away ages 2-5. On the ALL-CLAIMS
// curves the game-range objective is therefore nearly the unweighted fit — those
// series barely reach past the game anyway. Where it earns its place is the
// LARGE-claim curves below, which run to ages 10 and 23.
//
// THE AGE-1 RESIDUAL SURVIVES, at +3.02 on WC and +2.18 on GL. It is the
// Weibull's inability to reproduce a fast-then-crawl shape, not a calibration
// error, and no objective tested removes it without costing more elsewhere.
//
// Residuals on the corrected series: WC RMSE 0.026, GL 0.018, Property 0.010.
// ===========================================================================
export const CLOSURE_REPORTED_DEVELOPMENT = { ageOneFactor: 0.8916, decayPerStep: 0.4421 };

export const FITTED_CLOSURE_CURVE: Record<string, ClosureCurve> = {
  WC: { k: 0.688, b: 1.930 },
  GL: { k: 1.418, b: 2.300 },
  Property: { k: 0.998, b: 1.550 },
};

// ===========================================================================
// THE SIZE SPLIT — PER LINE, EACH FITTED AGAINST ITS OWN EXPERIENCE.
//
// Closure correlates strongly with size. On WC, of claims over $100k, ZERO of the
// first year's cohort closed at age 1 and 2.5% by age 3, against 49/72/77 for all
// claims. GL's own over-$100k experience is the same shape: 0.8% at age 1 and
// 15.8% at age 3 against 27/61/79 for all claims. A size-blind rule holds trivial
// files open for years and lets large ones close early, and both are wrong.
//
// Each line's all-claims curve is therefore a MIXTURE of a large-claim curve and
// a small-claim one. The large curve is fitted directly against that line's own
// over-threshold experience, on the same no-late-reporting basis and the same
// game-range objective as the curves above; the weight is MEASURED on the model's
// own drawn claims; the small curve is then backed out of that line's own
// all-claims curve at that weight.
//
// ⚠ THE EARLIER CONCLUSION "WC's LARGE CURVE DOES NOT TRANSPLANT" WAS MEASURED
// CORRECTLY AND READ TOO BROADLY. It ruled out putting WC's large curve inside
// GL's mixture, which was right — WC's reaches 43% by age 10 and cannot sit
// inside a GL all-claims curve that reaches 100%. It was then taken to mean GL
// and Property could have no size split at all, and that did not follow. GL's OWN
// large curve reaches 99.7% by age 10 and sits inside its own curve without
// strain. The cost of the over-reading was a $4M GL claim closing on GL's
// all-claims curve at 76.7% by age 3 when its own experience says 17%.
//
// ⚠ THE RECONCILIATION TEST IS AGAINST EACH LINE'S OWN ALL-CLAIMS CURVE, not
// against the source data, and the distinction matters. Both the mixture and the
// plain curve carry the same shape residual against the data, so comparing to the
// data makes an honest split look broken — WC reads 0.041 that way, which is the
// Weibull's age-2 problem, not the split's. Comparing to the CURVE isolates the
// only question that matters: does splitting by size change the line's aggregate
// closure? Measured:
//
//   WC   maxAbsErr 0.0064      GL   maxAbsErr 0.0087
//   GL with WC's large curve transplanted:  0.0442
//
// The test still separates a real split from the transplant by a factor of five.
//
// ⚠ PROPERTY IS DELIBERATELY NOT SPLIT, AND THE REASON IS ITS THRESHOLD RATHER
// THAN MISSING DATA. Property's source split is at $25k, not $100k, and on the
// model's own severity distribution that is the 23rd PERCENTILE: 76.80% of drawn
// Property claims exceed it, against 4.63% of WC's and 8.21% of GL's over $100k.
// A "large claim" band containing three quarters of the book is not the same kind
// of cut as one containing five percent, and a mixture at p = 0.768 is dominated
// by its large component — the all-claims curve already IS approximately the
// large curve, so the split would buy almost nothing even with the extract in
// hand.
//
// That gap between what $25k means on the source and what it means here is
// unresolved and is the real finding: either Property's modelled severity is
// scaled differently from the book the threshold came from (model median claim
// $65.4k), or $25k is a handling threshold rather than a size band. Fitting a
// split across that gap would be inventing a reconciliation. Property stays
// size-blind until the question is settled.
//
// ⚠ AND THE THRESHOLDS DIFFERING BY LINE IS ITSELF THE ARGUMENT FOR A CONTINUOUS
// SIZE FUNCTION. $100k sits at WC's 95th percentile, GL's 92nd, and Property's
// 8th. Three lines, three unrelated places in their own distributions, each a
// nominal dollar boundary that erodes as severity trends — the fourth instance of
// that trap on this branch. A function of size relative to the line's own scale
// has none of these problems. Not resolved here: closure is still display-only,
// so no boundary moves anything yet.
//
// DISPLACED BY: a continuous size function, and Property's own extract if the
// threshold question is ever settled.
// ===========================================================================
export const CLOSURE_SIZE_THRESHOLD = 100_000;

export interface ClosureSizeSplit {
  /** Share of the line's drawn claims at or above CLOSURE_SIZE_THRESHOLD, MEASURED. */
  weight: number;
  small: ClosureCurve;
  large: ClosureCurve;
}

// ⚠ WEIGHTS MEASURED, NEVER INFERRED. WC's was 6.94% by an inference chain — half
// the age-10 open set is large — and directly measured it is 4.63%. The inference
// was wrong, and it was wrong twice over because the small curve is backed out
// USING the weight. Both lines' weights here are measured on 97,184 and 60,201
// drawn claims.
export const CLOSURE_BY_SIZE: Record<string, ClosureSizeSplit> = {
  WC: { weight: 0.0463, small: { k: 0.734, b: 1.720 }, large: { k: 1.604, b: 14.320 } },
  GL: { weight: 0.0821, small: { k: 1.542, b: 2.070 }, large: { k: 2.854, b: 5.390 } },
};

// The curve a claim of this size on this line closes on. A line with no split
// falls back to its own all-claims curve — see Property above.
export function resolveClosureCurve(line: string, grossUltimate: number): ClosureCurve {
  const split = CLOSURE_BY_SIZE[line];
  if (split) {
    return grossUltimate >= CLOSURE_SIZE_THRESHOLD ? split.large : split.small;
  }
  return FITTED_CLOSURE_CURVE[line] ?? FITTED_CLOSURE_CURVE.GL;
}

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
// ⚠ IBNER_OPEN_FRACTION IS RETIRED. It was the share of a fresh accident year's
// booked ultimate still unpaid at the end of its own year — 0.60 on every line,
// the other 40% paid within it — and it is now `unpaidShare(pattern, 1)`, which
// is 59.0% on WC, 90.4% on GL and 49.6% on Property. ONE NUMBER FOR THREE LINES
// WAS THE DEFECT: GL settles almost nothing in its accident year and Property
// settles half, and the retired constant put both at 40% paid.
//
// Its own header said why it had to be a named constant rather than a literal:
// "simulationEngine reads this twice — once to book the cohort, once inside
// reserveStepSigma to derive the per-step scale that hits IBNER_TOTAL_SD — and
// the two must be the same number or a line develops at the wrong scale with no
// other symptom." That requirement is unchanged and is now carried by both
// sites reading the same pattern. reserveStepSigma's derivation moved with it —
// see the general-form sum there, which replaces a closed form that assumed a
// constant paydown.

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
// path, not merely weak.
//
// ⚠ ALL THREE OF THOSE FIELD NAMES ARE NOW DELETED, and this comment keeps them
// only to record the chain. They were resolved by DELETION rather than repair:
// the concept was already live under its real name, since premiumFundingRatio
// was documented as actualPremium / requiredFundingPremium and that IS
// selectedFundingCLF. The line above — reading selectedFundingCLF directly — is
// the migrated version, and the vestige simply outlived it.
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
// THE PER-CLAIM REVISION LAW — STAGE 1, FLAG-GATED AND OFF.
//
// ⚠ NOTHING BELOW IS LIVE. PER_CLAIM_REVISION.enabled is false and the cohort
// IBNER path above is untouched. This block is the fitted record; claimRevision.ts
// is the mechanism; terminal-severity-check.ts derives the one free parameter.
//
// What it replaces, when it is flipped: the cohort-level lognormal step above
// develops `netUltimate` top-down against IBNER_TOTAL_SD, and
// developmentAllocation then spreads that movement over the claims. Stage 1
// inverts it — each open claim revises its own CASE RESERVE, and the cohort's
// ultimate is the sum. The register stops being frozen at inception.
//
// ===========================================================================
// THE BASIS IS THE CASE RESERVE, AND IT IS THE WHOLE REASON THIS SHAPE WORKS.
//
// Stage 0 measured what a paid-to-date floor on the INCURRED costs: 42.5% of
// cohort ultimate on WC, 15.3% on GL, 4.5% on Property, against a martingale
// tolerance near 1%. That is not a residual defect in the payment split — the
// split was rebuilt and it only fell from 55.4% — it is structural. A large
// claim's annual revision SD is the same order as the headroom ANY coherent
// payment schedule can leave on a file that has been paying for years, so no
// split closes it. claimClosure.ts's own header sets out the choice this
// resolves.
//
// A mean-one multiplicative factor on a POSITIVE reserve is bounded away from
// zero by construction, so nothing truncates and there is no floor to hit. The
// conversion is one division:
//
//   magnitude_on_reserve = magnitude_on_incurred / headroom,   per claim
//
// where headroom is the share of the claim still unpaid. A claim 90% paid gets
// a 10x larger factor on its remaining tenth, which is the same dollar
// movement — that is what makes the two bases equivalent rather than a
// re-scaling.
//
// ===========================================================================
// MAGNITUDE — 200% / (age + 1), IN MODEL TERMS, AND THE OFFSET IS NOT COSMETIC.
//
// ⚠ AND THE MAGNITUDE IS ON THE INCURRED, WITH THE HEADROOM CORRECTION MOVED
// OUT TO ITS OWN CONSTANT — A DATA RULING. s used to be phi.m/headroom so that
// the DOLLAR movement was invariant to how much of a claim had been paid. The
// pool's own GL experience, banded by headroom, value-weighted within band, open
// claims, pre-game excluded, says movement scales WITH headroom instead:
//
//   headroom      |move| / incurred      |move| / reserve
//   h < 5%              0.015                  0.997
//   5-15%               0.064                  0.801
//   15-35%              0.451                  1.741
//   35-65%              0.766                  1.512
//   h > 65%             0.788                  0.854
//
// A claim under 5% headroom moves 1.5% of its incurred, not 79%. That direction
// is settled and nothing below reopens it. HOW FAST movement scales with
// headroom is a separate question, it was got wrong once, and it now lives at
// CLAIM_REVISION_HEADROOM_EXPONENT with the sweep that settled it. Do not fit an
// exponent to the five rows above without reading that note first: the two
// thinnest bands carry almost the whole slope of a naive fit, and a power fitted
// across all five reproduces neither regime.
//
// DATA AGE 1 IS A PLACEHOLDER STAGE AND IS EXCLUDED FROM THE FIT. First
// estimates at that age are overwhelmingly round administrative numbers rather
// than adjuster valuations, and they are revised by nearly their whole value on
// first real contact — a distribution the model has no analogue for, because the
// model's claims arrive already valued by the severity draw. So MODEL AGE 1
// CORRESPONDS TO DATA AGE 2, and the curve is indexed accordingly. Reading the
// fit off data age 1 would put a ~100% revision on every claim in its first
// model year and it would be modelling a filing convention.
export const CLAIM_REVISION_MAGNITUDE_NUMERATOR = 2.00;

// ===========================================================================
// THE HEADROOM EXPONENT — HOW FAST MOVEMENT SCALES WITH HEADROOM.
//
//   s = phi x m x h^(e-1),   applied through   d = v x h x (f-1)
//   so  |move| / incurred  ~  0.798 x phi x m x h^e   in the small-s limit.
//
// e = 0 is the retired form (the h cancels; movement invariant to headroom).
// e = 1 is the form this replaces (movement strictly proportional to headroom).
//
// ⚠ THIS IS A CHOICE OF WHICH REGIME TO FIT, NOT A FITTED EXPONENT. Read the
// three notes below before changing it. Two of them say the evidence is weaker
// than it looks, and the third says the functional form is wrong. All three
// still leave 0.50 as the right call, for reasons that are about WHICH part of
// the source is trustworthy rather than about goodness of fit.
//
// ===========================================================================
// 1. THE ANCHOR DOES NOT DISCRIMINATE. THE EXPONENT IS A FREE CHOICE.
//
// phi is re-solved against CLAIM_SETTLED_LOG_SD_ANCHOR at every exponent, and
// every one of them lands the terminal settled log-SD at 2.2900 exactly:
//
//   e      0.00    0.25    0.35    0.50    0.75    1.00    1.25
//   phi   0.6452  0.6527  0.6590  0.6699  0.6907  0.7123  0.7345
//
// phi moves 4% across the entire range of exponents anyone has argued for —
// from the form where h cancels completely to one steeper than the naive fit.
// The reason is the variance budget at phi's own note: phi is solved against a
// small residual, so large changes in the walk move the terminal log-SD very
// little.
//
// ⚠ SO THE LOAD-BEARING GATE OF STAGE 1 CANNOT SEE THIS PARAMETER, and anyone
// re-solving phi later should know the anchor will not object to whatever
// exponent it is solved under. terminal-severity-check going green says nothing
// about whether the exponent is right. What discriminates is the band shape
// below and the engine's cohort spread — neither of which is an anchor.
//
// ===========================================================================
// 2. WC AND PROPERTY CANNOT BE SCORED. THIS IS A GL CHOICE APPLIED BY ASSUMPTION.
//
// Measured on the model, both lines read exactly 0.000 in the h < 5% and
// h > 65% bands, because their payout patterns never put a cohort's headroom
// there: WC's first valuation sits at 59% headroom and Property's at 49.6%, and
// their IBNER horizons truncate before headroom falls under 5%. Only GL spans
// the range, reaching 90.4%. Any shape score for the other two lines is
// arithmetic over two structurally empty cells and means nothing — theirs came
// out at 0.62-0.65 against GL's 0.185 and that difference is an artefact of the
// empty cells, not a worse fit.
//
// The source band table is GL's. So the exponent is chosen on GL evidence and
// carried to WC and Property by assumption, exactly as CLAIM_SETTLED_LOG_SD_
// ANCHOR and CLAIM_REVISION_SIZE_TREND are. Say so wherever those lines'
// figures are quoted.
//
// ===========================================================================
// 3. THE FORM IS WRONG AND THE DECISION IS RIGHT.
//
// The source has TWO REGIMES, not one slope. Taking the recorded band table
// above and reading the exponent between adjacent band midpoints:
//
//   0.025 -> 0.100     e = 1.05     the two thinnest rows in the table
//   0.100 -> 0.229     e = 2.36     the steep segment, and it rests on the
//                                   thinnest row of all
//   0.229 -> 0.477     e = 0.72
//   0.477 -> 0.806     e = 0.05     essentially FLAT
//
// A factor of 47 between the steepest and flattest segment. No single power has
// two slopes, so a single exponent must sit in the middle and be wrong at both
// ends — which is visible in the sweep: the exponent that matches the collapse
// regime is furthest wrong on the flat one and vice versa. The choice is which
// regime to fit, and it is ABOVE 15% HEADROOM, because the three bands above
// that hold the overwhelming majority of the pool's claims while the collapse
// regime rests on the two thinnest rows in the table. Fitting both at once is
// what produced the h^1.0 reading that put this at e = 1.
//
// ⚠ AND 0.50 REPRODUCES THE LOW-HEADROOM FLOOR'S EFFECT WITHOUT IMPOSING ONE.
// The model's h < 5% band reads 0.014 against the source's 0.015 at this
// exponent — not because a knee was built, but because the model's own size
// trend and its development path correlate m with h. So the argument for a
// two-regime form or an explicit floor loses most of its value: it would buy a
// knee position and a second slope fitted to the two thinnest rows in the table,
// to reproduce something the single power already delivers.
//
// A TWO-REGIME FORM IS THE BETTER DESCRIPTION AND WAS NOT BUILT, DELIBERATELY.
// If a low-headroom band ever arrives with a serious sample behind it, that is
// the thing to revisit. A saturating hyperbola h/(h+h0) was checked and is the
// WRONG FAMILY — it is concave, so it cannot produce a sharp low-h collapse at
// all. Do not reach for it.
//
// ===========================================================================
// WHY 0.50 AND NOT ITS NEIGHBOURS — the sweep, on shape and on the engine.
//
// SHAPE. Each table normalised to its own top band, RMS against the source's
// normalised shape. "thick" is the three bands above 15% headroom:
//
//   e       RMS all five     RMS thick bands
//   0.00       0.282             0.154
//   0.25       0.301             0.140   <- best on the thick bands
//   0.35       0.221             0.161
//   0.50       0.185             0.203   <- best overall
//   0.75       0.215             0.274
//   1.00       0.261             0.336   <- what this replaces
//   1.25       0.301             0.389
//
// ENGINE. 40 games x 20 years, robust spread of pre-cession cohort development,
// against a flag-off arm reading 7.51 / 6.78 / 4.20% on WC / GL / Property:
//
//   e       WC/GL/Prop robust      worst cohort, WC/GL/Prop      x flag-off
//   0.25     12.14 / 13.59 / 9.43   180.81 / 89.14 / 205.68%     1.62/2.00/2.25
//   0.50      8.37 / 10.10 / 7.95    74.30 / 63.29 /  87.74%     1.11/1.49/1.89
//   1.00      5.65 /  7.17 / 6.77    78.99 / 66.75 /  65.57%     0.75/1.06/1.61
//
// NOT 1.0. At that exponent the law makes WC develop LESS than the cohort path
// it supersedes — 0.75x. That is a qualitative defect rather than a magnitude
// preference, and 0.50 puts all three lines above 1.0.
//
// NOT 0.25, even though it wins the thick bands. The tail restarts: 181% on WC
// and 206% on Property against 63-88% at 0.50. The whole reason e = 0 was
// retired was the tail, and buying shape back at the price of reopening it is
// the trade that ruling already refused.
//
// NOT 0.35 — AND IT IS RECORDED HERE AS THE CANDIDATE TO REVISIT. It is the
// SLOPE-OPTIMAL choice: the model's realised log-log slope at a nominal 0.35 is
// h^0.477, against the source's above-15% regime of h^0.48. (Realised slope runs
// ABOVE nominal e at every exponent, because m rises as claims develop and
// headroom falls.) It was not taken because it is law-level only — it has no
// engine measurement and no ledger run behind it — while 0.50 has both, already
// holds the tail, and already fixes the WC reversal. The gain is one regime's
// slope against a measured value. Revisit 0.35 if a low-headroom band ever
// arrives with a serious sample, or if the level question below is settled.
//
// ===========================================================================
// ⚠ OPEN, AND LARGER THAN THE EXPONENT: THE BAND LEVELS ARE ~7x APART.
//
// The model's |move|/incurred tops out at 0.10-0.11 per band where the source
// reads 0.45-0.79. That gap is a near-constant factor across bands and it is
// present AT EVERY EXPONENT, because the level is set by phi and phi is pinned
// by the terminal-severity anchor. No exponent addresses it. It cancels under
// normalisation, which is why the shape comparison above is the one that carries
// information.
//
// ⚠ IT IS THE 84-VERSUS-9.8 GAP AGAIN, SEEN PER-CLAIM RATHER THAN PER-COHORT.
// That item is recorded as CLOSED at CLAIM_MOVEMENT_BY_AGE_TARGET, on
// survivorship the model cannot have, a denominator worth x0.756, and a
// numerator dominated by a placeholder phenomenon the model does not model. Those
// compound to roughly 2x. They do not compound to 7x. So one of two things is
// true and this file does not yet know which:
//
//   EITHER the closure was too generous — one or more of those three factors is
//     doing less work than it was credited with, and the residual is real;
//   OR the remaining factor is the STEP-AND-BASIS question: the source ratio's
//     step length and its denominator are not established to be the model's
//     per-model-age step on carried incurred, and a mismatch there would show up
//     as exactly this — a constant multiple, invariant to the exponent.
//
// ⚠ NOBODY SHOULD TUNE AGAINST THE BAND LEVELS UNTIL THAT IS SETTLED. Pinning
// the source ratio's step length and denominator basis is the next measurement,
// and it is a measurement rather than a fit.
//
// AND KEEP THE TWO EFFECTS IN PROPORTION. The exponent move lifts cohort spread
// against the retired constants from 0.23/0.36/0.45 to 0.33/0.51/0.53 — a
// relative gain of 43/42/18%, but only 13/23/15% of the distance remaining to
// 1.0x. So the exponent is the smaller half of the quietness question and this
// level item is the larger one. It is not the law's to fix until the two ratios
// are known to be the same quantity.
export const CLAIM_REVISION_HEADROOM_EXPONENT = 0.50;

// SIZE TREND — CONTINUOUS, AND THE CONTINUITY IS THE POINT.
//
//   m(v) = 20.12 x v^-0.2891      v in dollars, m a fraction of incurred
//
// ⚠ IT MUST NOT BE A STEP FUNCTION. The obvious fit is two or three size bands,
// and a band boundary lands on or near the $1M occurrence retention. A
// discontinuity in revision magnitude exactly at the retention is the
// free-lunch shape: a claim a dollar under the boundary and one a dollar over
// develop at different rates, so the cession a player receives jumps at a
// threshold they can see. A continuous power law has no such edge anywhere.
//
// ⚠ THE EXPONENT SURVIVED A CHALLENGE AND THE CHALLENGE IS WORTH RECORDING.
// The suspicion was that -0.2891 is a COUNT-BASIS ARTEFACT — fitted where small
// claims dominate the count, and therefore not a statement about the value the
// pool actually carries. It is not. On a value-weighted basis the pool's two
// largest size bands differ by a factor of 2.76, against the 2.8 this exponent
// predicts for the same pair. Large claims genuinely revise about a third as
// much proportionally as mid-size ones, and the exponent is a value-basis fact.
//
// ⚠ AND THAT IS WHAT CLOSED THE MOVEMENT TARGET — see
// CLAIM_MOVEMENT_BY_AGE_TARGET. Once the exponent is real, a value-weighted
// movement of 110% of cohort incurred cannot be a statement about proportional
// revision, because the value sits in the bands that move LEAST.
//
// ⚠ ALL THREE LINES RUN THIS EXPONENT, AND IT IS GL'S. There is no per-line
// size trend — this is a bare object, not a Record keyed by line, and nothing
// in src/ or scripts/ indexes it by line. The same is true of
// CLAIM_REVISION_FREQUENCY: q = 0.70 is one scalar for every claim on every
// line. So the plan's domain read that "Property revision probability falls
// steeply with claim size" reached the code in NEITHER form — not as a Property
// slope on the magnitude, and not at all as a size-conditional FREQUENCY, which
// the model does not have anywhere. That is the explanation for Property's
// cession rising furthest under the law, and it is a separate commit: giving
// Property its own slope is a re-fit, and adding a size-conditional frequency
// is a new mechanism. Recorded here so the next reader does not re-derive it.
//
// ⚠ THE s TAIL THIS CONSTANT FED IS SHUT, AND IT IS THE EXPONENT THAT SHUT IT.
// The size trend is still what makes s vary between claims. Under s = phi.m/h,
// at the median tracked occurrence on the payout pattern's headroom, s reached
// 22.75 on GL by age 8 and 3.80 on Property by age 4, with 15.6% of tracked
// value sitting at s >= 10 where E|f-1|/s had collapsed to 0.133. At the shipped
// exponent the same table reads 1.84 and 1.01. The engine's worst cohort is
// 63-88% of register against 2950%.
//
// ⚠ THIS IS A TAIL HELD, NOT A DIVISOR REMOVED, AND THE REASON MATTERS. h^-0.5
// still diverges, and the engine divides by the cohort's REALISED balance rather
// than by the pattern, which goes lower still. What killed the tail is that the
// delta no longer cancels the divisor: movement goes as sqrt(h), so a large s
// arrives exactly where the balance it multiplies is vanishing. Re-measure if
// the exponent ever moves down — at e = 0 the cancellation is exact again.
//
// ⚠ NOTHING TESTS THIS WHERE IT DOES ITS WORK, and that gap is real and stays
// open. composition-table-check validates the AGE curve on a count basis, and
// its only sensitivity to this constant is a floor asserting it does NOT bind.
// At GL model age 1 the size trend binds on 14.3% of claims by COUNT and 95.9%
// by VALUE, so the gate and this constant do not meet. The measured cost of
// closing the gap is recorded at that gate's head.
// ============================================================================
// ⚠ THE LAW SUPPLIES ABOUT HALF THE DISPERSION REALITY DOES — MEASURED PER LINE
// AGAINST A REAL COMPARATOR, WHICH IS WHAT MAKES THIS DIFFERENT FROM THE EARLIER
// STATEMENTS OF IT.
//
// ln(settled / first estimate), each line walked through its OWN claims, its own
// closure curve and its own size mix rather than carrying GL's figure across:
//
//   line       model development log-SD     source, first estimate to settled
//   WC                  0.620                          1.28
//   GL                  0.714                          1.28
//   Property            0.579                          1.28
//
// The comparator is the pool's own first-estimate-to-settled spread, not a
// judgement constant, which is why this reading is worth more than the three
// that preceded it. IBNER_TOTAL_SD's 25/20/15% self-describe as judgement; the
// movement-by-age target turned out not to be a target at all; the cohort-spread
// ratios were against those same retired constants. This one is against a
// measured external quantity and it says the same thing they did.
//
// ⚠ IT IS NOT THE SAME FINDING AS THE BAND LEVELS, AND THEY SHOULD NOT BE ADDED.
// CLAIM_REVISION_HEADROOM_EXPONENT records a ~7x gap in per-step |move|/incurred
// whose basis is unsettled. This is the ACCUMULATED spread over a whole claim
// life, on a basis that is settled, and it is a factor of about two. If the two
// are the same underlying shortfall seen at different aggregations, the per-step
// figure has to come down as the step basis is pinned; if they are not, there
// are two.
//
// NOT THIS COMMIT'S TO FIX, and not the triangle's either. Raising it means
// raising phi, which re-solves against the terminal anchor and moves the
// headroom exponent's whole sweep with it. Recorded here, where the variance the
// size trend feeds actually lives, so the next re-solve starts from a measured
// number instead of rediscovering it.
// ============================================================================
export const CLAIM_REVISION_SIZE_TREND = { scale: 20.12, exponent: -0.2891 };

// ⚠ COMBINE BY THE SMALLER OF THE TWO, NOT THE PRODUCT — MEASURED.
//
// Age and size were fitted on the SAME experience, so each has already absorbed
// the other's average effect and multiplying them counts it twice. Measured
// against the terminal-severity anchor, the product arm over-widens on every
// line — 1.80x / 2.33x / 1.82x of target against 1.00 / 0.96 / 0.70 for the
// minimum. The minimum is also the actuarially conservative reading: whichever
// consideration binds harder is the one an adjuster acts on.
export type ClaimRevisionCombine = 'min' | 'product';
export const CLAIM_REVISION_COMBINE: ClaimRevisionCombine = 'min';

// ⚠ PERSISTENCE IS RETIRED. rho = 0 AND THE SIGN CHAIN IS GONE FROM THE CODE.
// The constant stays at zero as the RECORD of a fitted parameter that was ruled
// out; nothing reads it. What follows is why, because the reasoning is the part
// worth keeping.
//
// WHAT IT WAS: a two-state Markov chain on the sign, rho = 0.18, so that
// P(same sign as the previous revision) = (1 + rho)/2 = 0.59, fitted from the
// pool's own GL experience. The first sign was fair, so the chain was stationary
// at 1/2 and every step's factor stayed marginally mean-one.
//
// ⚠ WHY IT WENT, AND THE TRADE IS NOT CLOSE. Sign persistence makes each step
// CONDITIONALLY non-mean-one, so a runoff drifts UP, and the settlement level
// existed to pay that back. Once the ledger crossing was closed by putting the
// settlement factor on the RESERVE, that offset became h-scaled — the required
// level is (1/persistence - 1)/h and h is a cohort quantity that varies by line,
// age and realised development, so no scalar cancels it. The drift stopped being
// cancellable and ran at +6.04% pre-cession on WC, six times the martingale
// tolerance from one term.
//
// AGAINST THAT, rho bought 3.5 / 4.2 / 1.8pp on a direction statistic the model
// already produces most of by another route: at rho = 0 the realised same-sign
// rate still reads 57.0 / 55.5 / 66.9% against the pool's 59%, because the
// mean-one correction -s^2/2 biases moves downward and a biased coin repeats
// itself. Six percent of drift in the ultimate for four points on a statistic
// that was already three-quarters delivered is not a trade.
//
// ⚠ AND IT WAS ALWAYS THE WEAKER PARAMETER, WHICH IS THE DURABLE LESSON. It was
// FITTED from OBSERVED reserve-change directions and APPLIED as a LATENT chain,
// on a model whose observable direction is dominated by something else entirely.
// A parameter fitted on one basis and applied on another double-counts whatever
// the other mechanism already supplies. revision-direction-check now asserts the
// OBSERVABLE — the thing the pool actually measured — rather than a latent rate
// no data ever saw.
//
// ⚠ FREQUENCY IS MEMORYLESS AND THAT IS A MEASUREMENT, NOT AN OMISSION. Whether
// a claim moves at all in a given year is i.i.d. at q = 0.70: the conditional
// rates given a move and given no move came out 72% and 74%, which is the same
// number twice. Only the DIRECTION carries memory. A reader looking for a
// frequency chain here should find this note instead of adding one.
//
// ⚠ ASSERTED BY revision-persistence-check, AND IT HAD TO BE. Persistence lives
// entirely in the autocorrelation of successive signs: it moves no total, no
// mean, no SD and no martingale test, so a wiring that silently set it to zero
// would be invisible everywhere else. That already happened once — the first cut
// of reviseDevelopingSet passed `lastSign: 0` into every step, making every sign
// a fair coin while this constant went on reading 0.18. The gate reads the rate
// back out of reviseDevelopingSet and ships a rho = 0 control arm.
//
// ⚠ THE 59% IS THE LATENT CHAIN'S, NOT THE MODEL'S OBSERVABLE, AND THE TWO COME
// APART AT THE SHIPPED phi. rho was fitted from the direction of successive
// reserve CHANGES, as though the chain were directly observable. It is not: the
// mean-one correction -s^2/2 makes the median move downward, so the model's
// movement DIRECTIONS repeat more often than the chain does — 60% / 60% / 69%
// against the chain's 59%, and most of that survives with rho set to zero. The
// gate reports both. It is a phi-scale question and it belongs with the 84%/9.8%
// work; recorded here so the constant is not read as if the model reproduced the
// source's 59% on the quantity the source measured it on.
export const CLAIM_REVISION_PERSISTENCE_RHO = 0;

// THE DIRECTION TARGET — the pool's own GL rate at which successive revisions on
// the same claim move the same way. This is the OBSERVABLE, measured on reserve
// changes, and it is what revision-direction-check holds the model to.
//
// ⚠ IT IS THE SAME 0.59 THAT rho WAS FITTED FROM, ON THE BASIS IT WAS MEASURED
// ON. rho took this figure and applied it to a LATENT chain; the model's
// observable direction is dominated by the mean-one correction instead, so the
// chain double-counted it. The number did not change — what it is compared
// against did.
export const CLAIM_MOVEMENT_DIRECTION_TARGET = 0.59;
export const CLAIM_REVISION_FREQUENCY = 0.70;

// SETTLEMENT — SHAPE MEASURED, MEAN DERIVED.
//
// The factor applied when a claim closes, against its then-carried value:
// 19% of claims settle at zero, overall median 0.74, overall p90 1.60. Those
// three points fit a zero-inflated lognormal on the non-zero part, and the
// SHAPE below is that fit.
//
// ⚠ THE MEAN IS NOT MEASURED, IT IS DERIVED, AND IT HAS TO BE. Sign persistence
// breaks the step-by-step martingale: given the previous sign, the next factor
// is not conditionally mean-one, and over a runoff that compounds into a real
// upward drift in E[ultimate]. The settlement factor's mean is solved so the
// cohort is a martingale WITH rho in force. Fitting the mean as well would
// double-book the same experience and leave the drift in.
//
// So `nonZeroScale` is a SOLVED number, not a fitted one, and martingale-
// equivalence-check is what falsifies it. The measured shape is preserved
// exactly: the zero mass and the log-spread are fixed, only the level moves.
//
// ⚠ IT IS WIRED INTO THE ENGINE AS OF THIS COMMIT, AND FOR TWO COMMITS IT WAS
// NOT. settlementFactor had no caller in src/ outside claimRevision.ts: the
// engine routed processIbner through reviseDevelopingSet and nothing else, so a
// claim that pierced the retention and settled at 0.74x handed nothing back.
// The gate could not see it — it paired a MEASURED persistence term with this
// CLOSED-FORM mean, and a closed form cannot disagree with an implementation.
// Both terms are now measured, and the gate carries an ENGINE ARM that asserts
// current_on === current_off x settlementFactor claim by claim, exactly, at the
// valuation each claim closes. Verified to fail: un-wiring the engine block
// turns that arm red 24 of 24 while leaving every statistical term green.
//
// ⚠ THE ENGINE APPLIES IT TO THE RESERVE, NOT TO THE WHOLE VALUE, AND THAT
// CHANGES WHAT THE LEVEL DELIVERS THERE. settleClosingSet computes
// v.h.(f - 1) with h the cohort's balance over its register, because the
// unbounded form — the factor on the whole carried value — was half of the
// ledger crossing. Two consequences, both measured:
//
//   IT MAKES "CLOSES AT ZERO" LITERALLY TRUE. A claim settling at factor 0 now
//   lands at v.(1 - h), its paid to date, rather than at nothing.
//
//   ⚠ AND IT COLLAPSED THE OFFSET, WHICH IS WHAT RETIRED rho. The expected effect
//   on a claim's value is 1 + h.(E[f] - 1) rather than E[f], so an offset arrives
//   scaled by the cohort's h. The required level was (1/persistence - 1)/h and h
//   varies by cohort, so no scalar could cancel the drift — the engine ran +6.04%
//   pre-cession on WC. The resolution was to remove the drift rather than chase
//   the offset: see CLAIM_REVISION_PERSISTENCE_RHO.
//
// ⚠ WITH NO DRIFT TO CANCEL, THE LEVEL IS THE ONE THAT MAKES THIS FACTOR
// MEAN-ONE OUTRIGHT, AND THE h PROBLEM DISSOLVES. 1 + h.(1 - 1) = 1 for every h.
// Measured on the engine, paired off against on, the settlement quotient now
// reads 0.997 / 1.000 / 0.999 — neutral, which is what it should be.
//
// ⚠ AND IT DOES NOT REDUCE CESSION, WHICH IS THE OPPOSITE OF WHAT IT WAS
// EXPECTED TO DO. Settlement was reasoned about as the FAVOURABLE force — a
// claim above the retention settling low hands the layer back. It does hand
// back on the downside, but cession is CONVEX in occurrence size and this
// factor is a large mean-neutral dispersion (19% at zero against a p90 of
// 1.60) applied to every claim at closure. By Jensen the up-tail cedes more
// than the down-tail returns. Measured, 200 games, flag ON against OFF: total
// expected recovery per line-year moves 1.16x on WC, 1.02x on GL and 1.20x on
// Property WITH settlement, against 1.07 / 1.01 / 1.01 without it. Wiring the
// favourable force made the tower respond MORE.
export const CLAIM_SETTLEMENT_FACTOR = {
  zeroProbability: 0.19,
  /** Log-sigma of the non-zero part, from the median/p90 pair. FITTED. */
  nonZeroLogSigma: 0.5297,
  /** Log-mu of the non-zero part, from the same pair. FITTED. */
  nonZeroLogMu: -0.1432,
  // ⚠ SOLVED, NOT FITTED — the level that makes the cohort a martingale.
  //
  //   nonZeroScale = 1 / (E[persistence] x (1 - p0) x exp(mu + sigma^2/2))
  //                = 1 / (1.00000 x 0.807646) = 1.238164
  //
  // The fitted shape's own mean is 0.8076, so the level moves it to 1.0000.
  //
  // ⚠ E[persistence] IS NOW EXACTLY 1 AND THAT DISSOLVES THE h PROBLEM. It read
  // 1.00460 while the sign chain existed, and the offset that cancelled it was
  // 0.9955 — which, once settlement moved onto the RESERVE, arrived scaled by the
  // cohort's h and therefore did not cancel anything. With rho retired there is
  // no drift to pay back, so the right level is the one that makes the settlement
  // factor mean-one outright. And a mean-one factor is mean-one at ANY h:
  // 1 + h(E[f] - 1) = 1 for every h. The h-dependence was only ever a problem for
  // a NON-zero offset, and there is no longer one.
  // martingale-equivalence-check is what falsifies this and it decomposes the
  // two terms rather than reading the total.
  //
  // ⚠ THE CORRECTION IS SMALL, WHICH IS NOT WHAT THE DERIVATION IMPLIED — AND
  // THE FIRST SOLVE OF IT WAS UNDER-RESOLVED. MEASURED with a paired estimator:
  // at 8 registers x 40 replicates the persistence drift read 1.00082 +/- 0.00126
  // and looked indistinguishable from zero; at 24 x 200 it reads
  // 1.00460 +/- 0.00065, which is +0.46% at 7 standard errors and is REAL. The
  // first figure was not wrong, it was un-resolved — and a scale solved on it
  // left the cohort 0.46% off. So "derive the mean to offset rho" is a genuine
  // step applying a genuine half-percent correction; it is simply nowhere near
  // the size the briefed phi would have needed.
  //
  // IT IS SMALL BECAUSE phi IS SMALL, and the two corrections compound.
  // Measured drift against phi on one register, 80 replicates:
  //   phi 0.00  1.00000            phi 0.63  1.00331 +/- 0.00269
  //   phi 0.31  1.00150 +/- 0.00130  phi 1.00  1.00530 +/- 0.00445
  //   phi 1.90  1.00866 +/- 0.01010
  // At the briefed phi = 1.9 the drift would have been ~0.87% and would have
  // needed a real correction; at the anchor-solved 0.63 it does not. Getting phi
  // right shrank this problem rather than solving it separately.
  nonZeroScale: 1.238164,
};

// ===========================================================================
// phi — THE ONE FREE PARAMETER, AND ITS LABEL MATTERS MORE THAN ITS VALUE.
//
// ⚠ phi IS NOT A KNOB. Read this before changing it.
//
// phi = 4.2 IS A CORRECT MEASUREMENT of the pool's revision process. The
// matched-slice check reproduces the source's own widening at 1.265 against
// 1.285, so the number is right about the thing it measures.
//
// IT CANNOT BE APPLIED AT FACE VALUE, because the model's severity draw has
// ALREADY SPENT MOST OF IT. The GL mixture was fitted to SETTLED claim values,
// not to first estimates, so its log-SD of about 2.14 already contains the
// revision history of the claims it was fitted to. The pool's settled log-SD is
// 2.29. Applying a full phi = 4.2 on top of a distribution that is already
// 2.14 wide would count the same widening twice and put the model's terminal
// severity far past anything the pool has seen.
//
// ⚠ AND phi HERE IS NOT THE ADDENDUM'S phi. THE PARAMETERISATION CHANGED AT THE
// ANCHOR SOLVE, AND A NOTE THAT STOOD HERE COMPARED THE TWO AS IF IT HAD NOT.
//
// In claimRevision.ts, phi is a STRAIGHT MULTIPLIER on the magnitude:
//     s = phi x magnitude x headroom^-0.5,  factor = exp(sign.s.|Z| - s^2/2)
// so `s` is the log-SD of the mean-one factor and phi is dimensionless. The
// addendum's phi is e^(s^2) — an SD-to-median ratio, bounded below by 1 by
// construction. THE TWO NUMBERS ARE NOT COMPARABLE.
//
// Converting at GL age 1 (count-weighted magnitude 0.934, headroom 0.904):
//     phi_here 0.6699 ->  s = 0.658 ->  e^(s^2) = 1.54 in the addendum's units
//     addendum 1.9    ->  s = 0.801
//     addendum 4.2    ->  s = 1.198
// The conversion has barely moved across all three headroom exponents (it read
// 1.53 under both predecessors) — at GL age 1 headroom is 0.904, so any power of
// it is near 1 and the exponent has almost no leverage this early. It bites late
// in a runoff, not here.
//
// ⚠ SO THE EARLIER NOTE'S "ABOUT 3x TOO BIG" WAS A UNITS ERROR OF MINE, and it
// is corrected here rather than left to mislead the next investigation. On a
// like-for-like basis the anchor solve lands at 1.53 against the briefed
// residual of 1.9 — about 19% lower in s, not a factor of three.
//
// WHAT THE VARIANCE-BUDGET ARGUMENT STILL SHOWS, because it is unaffected by the
// units. The 2.14-vs-2.29 derivation nets out the severity fit's own spread and
// stops; it does not net out the settlement factor's fitted log-sigma of 0.5297,
// worth 0.2806 of log-variance and not phi's to spend. Measured: at phi = 0 the
// settlement shape ALONE carries the model from a drawn 2.1668 to 2.2304, over
// half of the 2.1668 -> 2.29 gap consumed before the revision law contributes
// anything. That is what accounts for landing at 1.53 rather than 1.9.
//
// ⚠ IT IS THE SAME DOUBLE-COUNT THE COMBINE RULE ALREADY REJECTS, one level up.
// CLAIM_REVISION_COMBINE takes the minimum of age and size "because both were
// fitted on the same experience, so multiplying double-counts". The settlement
// factor was fitted on that same experience too.
//
// SOLVED, not asserted: 0.6252 / 0.6273 / 0.6285 on the three largest samples
// (309k / 98k / 147k claims), 0.5492 and 0.5665 on the two others. The spread
// tracks the drawn log-SD — a wider draw leaves less residual — and the value
// below is taken from the configuration that matches a real game's year range.
//
// ⚠ RE-SOLVED TWICE AS THE HEADROOM SCALING CHANGED, AND BARELY MOVING IS THE
// POINT. It was 0.63 while s = phi.m/h, 0.7123 at s = phi.m, and 0.6699 at the
// shipped s = phi.m/sqrt(h). The whole range over which the exponent has been
// argued moves phi by 4% — see the table at CLAIM_REVISION_HEADROOM_EXPONENT,
// where every exponent from 0.00 to 1.25 lands the anchor at 2.2900 exactly.
// The reason is the variance budget above: phi is solved against a small
// residual, so a large change in the walk moves the terminal log-SD very little.
//
// ⚠ WHICH MEANS THE ANCHOR CANNOT SEE THE EXPONENT, and terminal-severity-check
// going green is not evidence that the headroom scaling is right. Whoever
// re-solves phi next should read that note before concluding anything from this
// one.
//
// ⚠ AND THE LAW SATURATES, SO phi IS NOT IDENTIFIABLE ABOVE ABOUT 3 — IN THE
// UNITS OF THIS FILE, i.e. phi as a multiplier. Re-measured at the new form:
// terminal log-SD 2.4197 at 1.4, 2.5108 at 1.9, 2.5873 at 2.5, 2.6295 at 3.2,
// 2.6331 at 4.2 — it flattens against a ceiling near 2.633. The mean-one factor
// exp(s.sign.|Z| - s^2/2) has median exp(-s^2/2), so at large s the drift term
// collapses carried values toward zero faster than the spread term widens them.
// Two consequences worth stating: the model has a hard ceiling near 2.62 that no
// phi can pass, and any phi above ~3 has a twin that reads the same. phi = 4.2
// could therefore never have been applied here at face value even if the fit had
// spent nothing — which strengthens the double-count argument rather than
// replacing it.
export const CLAIM_REVISION_PHI = 0.6699;

// THE ANCHOR — EXTERNAL, MEASURED AND FALSIFIABLE, AND IT IS GL'S.
//
// The pool's settled-claim log-SD. This is what terminal-severity-check holds
// the model to and what phi is solved against.
//
// ⚠ IT IS A GL NUMBER AND THE OTHER TWO LINES INHERIT IT. WC and Property have
// no settled-severity distribution of their own, so whatever emergent SD they
// show under a GL-derived phi is a CONSEQUENCE of carrying that phi across, not
// a validated result for those lines. Say so wherever those figures are quoted.
export const CLAIM_SETTLED_LOG_SD_ANCHOR = 2.29;

// THE MOVEMENT-BY-AGE TARGET — the pool's own GL cohort movement as a share of
// cohort incurred, by DATA age. Fitted figures, recorded the way the payout
// curves are; the underlying experience stays out of the repo.
//
// Data age 1 is excluded for the reason recorded at
// CLAIM_REVISION_MAGNITUDE_NUMERATOR — it is the placeholder-correction stage
// the model has no analogue for. So MODEL age = DATA age - 1 and the five
// figures below are model ages 1 through 5. Data age 7+ is noise and is not a
// target.
//
// ============================================================================
// ⚠ CLOSED, NOT DEFERRED: THIS SERIES IS NOT A TARGET THE MODEL CAN MATCH, AND
// NONE OF THE THREE REASONS IS A DEFECT IN THE LAW.
//
// The model realises 11.1% at model age 1 against this series' 110%. That gap
// was chased for three commits as if it were one number with one cause. It is
// three basis mismatches, and once each is named the residual is not a defect.
// The series stays in the file as the RECORD of what the pool did; it is no
// longer something the law is expected to reproduce, and no phi, no
// re-parameterisation and no re-fit will make it reproduce it.
//
// 1. SURVIVORSHIP — STRUCTURAL AND UNCLOSABLE.
//    The series is measured on claims OPEN at the earlier valuation, and in the
//    pool that subset is systematically adverse: it grows 1.30x to 1.49x a year
//    while the whole cohort grows 1.09x to 1.11x. Cheap claims close, so the
//    survivors are the ones that grew.
//    THE MODEL CANNOT HAVE THIS. Closure resolves from the DRAWN value and its
//    unit hashes (gameId, claimId) — see simulationEngine's isClaimClosed call
//    site — so staying open is size-correlated and GROWTH-INDEPENDENT. Measured
//    across three lines, six age steps, with and without the settlement factor,
//    the model's open subset grows 0.97x to 1.01x. It is mean-one to within
//    half a percent because it was built to be.
//    ⚠ THE SIZE OF THIS: at GL ages 1-3 the target's PURE DRIFT COMPONENT alone
//    exceeds the model's entire realised movement — 0.355 / 0.237 / 0.177 of
//    cohort incurred against the model's whole 0.111 / 0.093 / 0.076. No
//    dispersion argument is needed to see the two are different quantities.
//    Closing it would mean making closure depend on the revision path, which
//    claimClosure.ts prohibits for unrelated and stronger reasons.
//
// 2. DENOMINATOR — MECHANICAL, WORTH x0.756 OR BETTER.
//    The series divides by the pool's BOOKED INCURRED at that valuation. The
//    model divides by the sum of DRAWN grossUltimate — see composition-table-
//    check's `total`. In the model those are the same object: the register is
//    drawn AT ultimate and the law is mean-one, so measured booked(age)/drawn
//    runs 1.000 to 1.009. In the pool they are not: its cohort incurred grows
//    9-11% a year, so an early valuation's denominator is materially below
//    ultimate. Over the three measured steps that is x1.322, so restating this
//    series onto the model's denominator multiplies it by at most 0.756 —
//    less if development continues past the measured window.
//
// 3. NUMERATOR COMPOSITION — THE 110% IS A TAIL STATEMENT, NOT A MAGNITUDE ONE.
//    Value-weighted movement within size band falls by two orders of magnitude
//    from the smallest band to the largest, and the small bands dominate the
//    numerator. A claim under $10k moves many times its own incurred: that is
//    near-zero reserves becoming real claims — the placeholder phenomenon
//    already excluded at data age 1 (see CLAIM_REVISION_MAGNITUDE_NUMERATOR),
//    reappearing at every age in the small bands. THE MODEL HAS NO PLACEHOLDER
//    STAGE BY DESIGN: a $500 drawn claim is a $500 claim, and the severity draw
//    delivers it already valued. The two largest bands, where the model and the
//    pool are describing the same thing, agree — see the exponent's own
//    validation at CLAIM_REVISION_SIZE_TREND.
//
// ⚠ AND THE CEILING FINDING WEAKENED ONCE (2) WAS APPLIED. This is worth
// keeping because it is the reason the RESERVE BASIS is not the constraint.
// E[f] = 1 with f >= 0 gives E|f-1| <= 2, so movement/incurred can never exceed
// 2 x openShare x headroom x q for ANY mean-one factor on the reserve. Against
// that ceiling this series sat at 91 / 76 / 86 / 76 / 81% — close enough to a
// degenerate limit to read as an impossibility proof, and it was reported as
// one. Restated onto the model's denominator it sits at 69 / 57 / 65 / 58 /
// 61%, and with (1)'s drift removed the dispersion the model must supply is
// about 41% of the ceiling at age 1. The reserve basis has room. It only looked
// incapable because it was being compared against an unrestated statistic.
//
// ============================================================================
// ⚠ AND THE CLOSURE HAS SINCE BEEN QUESTIONED FROM A SECOND DIRECTION. READ THIS
// BEFORE CITING THE THREE REASONS ABOVE AS SETTLED.
//
// The same gap reappears PER CLAIM rather than per cohort: banded by headroom,
// the model's |move|/incurred tops out at 0.10-0.11 where the source reads
// 0.45-0.79, a near-constant ~7x at every headroom exponent. The three reasons
// above compound to roughly 2x, not 7x. So either one of them is doing less work
// than it was credited with, or there is a fourth factor — the step-and-basis
// question — and this file does not yet know which. The full statement of it,
// with both possibilities named, is the open item at
// CLAIM_REVISION_HEADROOM_EXPONENT.
//
// WHAT THAT DOES AND DOES NOT DO TO THIS NOTE. It does not restore this series
// as a target: survivorship is still structural and the model still has no
// placeholder stage, so no phi and no re-fit make the model reproduce it. What
// it does is remove the right to treat the SIZE of the residual as accounted
// for. "Not a target" and "fully explained" are different claims, and only the
// first is established.
export const CLAIM_MOVEMENT_BY_AGE_TARGET: readonly number[] = [1.10, 0.65, 0.42, 0.17, 0.06];

// ⚠ RETRACTED AT THIS COMMIT — THIS IS THE MODEL'S OWN READING, NOT SOURCE DATA.
// THE NAME SAID `_SOURCE` AND THAT WAS WRONG. Read this before using the series.
//
// The composition that validates the law's FORM is
//     movement(age) = magnitude(age) x open share(age)
// and the series below is the open-share term. b206cc6 recorded it as
// CLAIM_OPEN_SHARE_SOURCE, described it as the pool's own claim development, and
// published a finding that the model's closure curves hold value open 2.3x
// longer than the pool's book.
//
// THAT FINDING DOES NOT EXIST. The series is this model's own value-weighted
// open register, measured at the END of each model age. b206cc6's gate compared
// it against a START-of-age measurement, and the whole "widening ratio" was that
// one-age offset. Aligned correctly the ratio is 1.00 / 0.99 / 0.99 / 1.07 / 1.27
// rather than 1.08 / 1.13 / 1.25 / 1.52 / 2.28.
//
// HOW IT WAS SETTLED, since a label is worth nothing without a check. Measured
// at 12 independent registers x 40 replicates: the model's value-weighted open
// share at model age a+1 reproduces this series with an RMS error of 2.23pp
// against 16.66pp unshifted, exact at the first entry and 0.3 across-register sd
// at the fourth. And the regression hypothesis is excluded on both candidates —
// the revision law cannot touch it (the gate resolves the closure curve from the
// DRAWN value and accumulates the DRAWN value, so the law is not in that path),
// and 858f9ba moved the model TOWARD this series, not away: before it GL had a
// single size-independent curve reading 73.5 / 44.0 / 23.4 / 11.3 / 5.0.
//
// SO IT IS A REGRESSION REFERENCE AND NOTHING MORE. Comparing the model to it
// says whether the model has moved. It says nothing about the pool, and any
// future reader reaching for it as an external anchor is repeating b206cc6.
export const CLAIM_OPEN_SHARE_MODEL_RECORDED: readonly number[] = [0.901, 0.794, 0.630, 0.409, 0.192];


// ===========================================================================
// ⚠ IBNER_TOTAL_SD RETIRES AS A TARGET WHEN THIS FLAG FLIPS — ALL THREE LINES.
//
// It does not retire as a record. The three values stay above as the recorded
// predecessors, and the reason they retire is that ALL THREE SELF-DESCRIBE AS
// JUDGEMENT: WC's 25% and GL's 20% are, in their own note, "judgement calls
// about what a long-tail casualty runoff looks like", and Property's 15% is
// recorded there as a playability adjustment made so the per-accident-year
// exhibit had something to show. None is a measurement. The anchor above is
// measured, external and falsifiable, which is why it displaces them.
//
// WHAT REPLACES THEM IS NOT A THIRD TARGET. Under Stage 1 the total SD of a
// cohort's ultimate is EMERGENT — it falls out of the per-claim law, the
// register's size mix and the closure curve, and there is no constant to set.
// The emergent figures under a GL-derived phi are a reading, not a target.
//
// ⚠ AND THE READING HAS MOVED A LONG WAY SINCE, THREE TIMES, ALL OF IT DRIVEN BY
// THE HEADROOM EXPONENT. Measured on the engine at 40 games x 20 years, robust
// spread of pre-cession cohort development, WC / GL / Property:
//
//   s = phi.m/h        35.1 / 20.4 / 14.8%   worst cohort 2950%, sample SD 169%
//   s = phi.m           5.65 / 7.17 / 6.77%  worst cohort 79%,   sample SD 7.79%
//   s = phi.m/sqrt(h)   8.37 / 10.10 / 7.95% worst cohort 88%,   sample SD 10.83%
//
// against a flag-off arm of 7.51 / 6.78 / 4.20%. The shipped middle row is
// 1.11x / 1.49x / 1.89x of the path it replaces and 0.33 / 0.51 / 0.53 of the
// retired constants.
//
// TWO THINGS THE MIDDLE ROW SHOWS THAT THE OTHERS DO NOT. The tail stays shut —
// the estimability problem that the 1/h form created is closed, and the
// martingale's persistence SE stays tight. And the law develops MORE than the
// cohort lognormal on every line, which s = phi.m did not: at that exponent WC
// read 0.75x, i.e. the replacement was quieter than the thing it replaced. That
// reversal is what the exponent move fixed, and it was a qualitative defect
// rather than a magnitude preference. Recorded so the next reader sees the size
// of the move rather than rediscovering it.
//
// ⚠ AND ~0.5x OF THE RETIRED CONSTANTS IS STILL NOT 1.0x. That is not a target
// being missed, because there is no longer a target — but the remaining gap has
// a named suspect and it is NOT the exponent. See the open item at
// CLAIM_REVISION_HEADROOM_EXPONENT: the model's per-band movement level sits ~7x
// below the source's at every exponent, and the exponent cannot move it.
//
// ⚠ AND PROPERTY LANDING AT 14.8% AGAINST ITS OLD 0.15 WAS A COINCIDENCE — the
// FIRST row of the table above, not the shipped one, which reads 7.95%. Keep
// this line anyway: the warning is about how to read agreement, and it is worth
// more now that the number no longer agrees. The old constant was chosen for
// display content on a short-tail
// line; the new one is what a GL-derived phi happens to produce through
// Property's own size mix and its 2-4 year horizon. Reading the near-agreement
// as corroboration would be reading a coincidence as a validation — and WC's
// 35.1% against 25% is the same kind of number in the other direction, which is
// the tell.
// ⚠ AN OBJECT AND NOT A BARE BOOLEAN, FOR THE SAME REASON IBNER_TOTAL_SD IS A
// RECORD. A gate cannot toggle a `const x = false`, and a flag whose two arms
// cannot be run side by side in one process has no A/B test — which is exactly
// what pregame-acceptance-check needs, since the blocker question is what the
// pre-game search does ON the new path against the old one. reserveStepSigma's
// cache note records the same requirement from the other direction: it is keyed
// on the target precisely so ibner-null-check's runtime mutation works.
//
// ⚠ MUTATE IT ONLY IN A GATE, AND PUT IT BACK. The shipped value is false and
// nothing in src/ writes to it.
//
// ============================================================================
// ⚠ STAGE 1'S CALIBRATION IS CLOSED. NOT DEFERRED — CLOSED.
//
// The movement-by-age target is the last item and it resolved as NOT MATCHABLE,
// for three basis reasons none of which is a defect in the law. The full record
// is at CLAIM_MOVEMENT_BY_AGE_TARGET; the short form is survivorship the model
// cannot have by construction, a denominator worth x0.756, and a numerator
// dominated by a placeholder phenomenon the model does not model by design.
// Anyone reopening it should read that note before measuring anything.
//
// ⚠ AND ONE ITEM HAS SINCE REOPENED IN A NARROW SENSE — THE LEVEL, NOT THE
// TARGET. The per-band movement level sits ~7x below the source's at every
// headroom exponent, and the three reasons above compound to about 2x. The
// target stays closed; the SIZE of the residual is not accounted for. Full
// statement, with both candidate explanations, at
// CLAIM_REVISION_HEADROOM_EXPONENT.
//
// WHAT HOLDS, AND THESE ARE WHAT FEED THE GAME:
//   terminal severity              2.29, the external anchor, phi solved to it
//                                  — but the anchor cannot see the headroom
//                                  exponent, so it is not evidence for that
//   emergent cohort SD             0.33 / 0.51 / 0.53 of the retired constants,
//                                  1.11 / 1.49 / 1.89x of the path it replaces
//   headroom exponent              0.50, chosen on GL band shape and the
//                                  engine's tail, recorded as a regime choice
//   martingale                     passes, persistence and settlement
//                                  decomposed separately
//   pre-game acceptance            unmoved on all three lines, no fallbacks
//   sign persistence               gated, with its rho = 0 control arm
//   flag off                       bit-identical to the parent on both
//                                  standing gates
//
// ⚠ RESOLVED — THE LEDGER CROSSING IS CLOSED, BY AN INEQUALITY RATHER THAN A
// FLOOR. reviseDevelopingSet now takes the cohort's BALANCE and derives the
// headroom from it, h = balance / register total, so every claim's movement is
// a share of the balance it lands in: d_i = B.w_i.(f_i - 1) >= -B.w_i with
// sum(w) = 1 and every f_i >= 0, hence sum(d) >= -B. The bound survives cession
// because the retained function is non-decreasing, 1-Lipschitz and zero at zero.
// settleClosingSet puts the settlement factor inside the same h. The full
// argument is at those two functions; cohort-ledger-check asserts the outcome on
// BOTH arms and reads 0 violations across 81,312 flag-on cohort-valuations at 6x
// its shipped sample. Its EXPECTED_RED entry is gone.
//
// ⚠ AND h IS THE SAME IN THE FACTOR AND IN THE DELTA. s = phi.m.h^-0.5 and
// d = v.h.(f-1), so to first order a claim's movement goes as sqrt(h) — half the
// h cancels and half survives, and the surviving half is the ruling at
// CLAIM_REVISION_HEADROOM_EXPONENT. The fix corrects WHICH reserve the movement
// is a share of; the exponent decides how much a claim moves. Feeding the two
// different h's — the pattern's to one and the cohort's to the other — is what
// caused the crossing in the first place and must not come back.
//
// THE REJECTED ALTERNATIVE, RECORDED: h = netUnpaid / netUltimate tracks the
// pattern headroom almost exactly on healthy cohorts (median 0.945 / 0.976 /
// 1.000 of it) and would have been the smaller change, but its bound needs
// sum(claim values) <= netUltimate and the register EXCEEDS netUltimate on 89%
// of cohort-valuations — median 1.31x, p95 2.86x — because the register is GROSS
// and netUltimate is NET. It would have gone green on the seeds it was built
// against and red on someone else's.
//
// ⚠ WHAT IT COST WAS THE SETTLEMENT OFFSET, AND THAT ITEM IS NOW CLOSED BY
// RETIRING rho. The offset became h-scaled and therefore uncancellable; with the
// sign chain gone there is no drift to cancel, the settlement level is re-solved
// to mean-one, and a mean-one factor is mean-one at every h. See
// CLAIM_REVISION_PERSISTENCE_RHO and CLAIM_SETTLEMENT_FACTOR.
//
// ⚠ AND THE HEADROOM FIX IS INDEPENDENT OF rho — MEASURED, NOT ASSUMED.
// cohort-ledger-check reads 0 violations on both arms with the chain removed,
// across 9,373 flag-on cohort-valuations. The bound is arithmetic on the
// weights; it never referred to the sign.
//
// ⚠ THE ORIGINAL FINDING, KEPT BECAUSE THE DIAGNOSIS IS THE USEFUL PART:
// THE PER-CLAIM PATH COULD DRIVE A COHORT'S NET RESERVE NEGATIVE. `newUnpaid += res.retained` sums
// CLAIM-level deltas and nothing bounds that sum by the cohort's own remaining
// reserve, so a register that settles or improves below what the cohort has
// already paid leaves a negative balance. Measured over 40 games x 15 years:
// 0.00% of cohort-valuations with the flag off, 4.03% with the flag on and the
// settlement step suppressed (worst -$17.1M), 7.88% with it live (worst
// -$35.3M). It arrived with the Stage 1 wiring at 42b2c2b; settlement roughly
// doubles it. ibner-null-check cannot see it — that gate runs flag-off, where
// the count is genuinely zero, and simulationEngine's floors note still says the
// crossing is "unreachable", which is true only of the cohort path.
// DO NOT CLAMP IT. A floor on the reserve is precisely the Stage 0 defect that
// note records: it truncates favourable movement one-sidedly and breaks the
// martingale. THE FLAG MUST NOT FLIP UNTIL THIS IS RESOLVED.
//
// ⚠ THE MECHANISM IS NOW DIAGNOSED AND IT IS AN AGGREGATION DEFECT, NOT A HOLE
// IN THE RESERVE BASIS. reviseDevelopingSet's call site scales each claim's
// movement by a headroom taken from the PAYOUT PATTERN,
// `cumulativePaid(LINE_PAYOUT_PATTERN[line], c.age + 1)`, while the cohort
// balance those movements land on has been paid down along its own REALISED
// path — and development moves the realised path off the curve. Median headroom
// entering a step: 0.125 pattern against 0.003 realised on cohorts that end the
// step negative, 0.136 against 0.143 on cohorts that do not. A 46x
// overstatement of the balance available to move.
//
// THE CLAIM LEVEL IS SOUND. With settlement suppressed, 100% of negative-reserve
// cohorts have every tracked claim carrying a positive value and 0% were floored
// by cedeDevelopment — the per-claim reserve genuinely cannot go negative, which
// is the whole basis argument and it holds. What is broken is that the cohort
// balance is maintained in parallel with nothing tying it to the register.
// The cohort path cannot do this because `newUnpaid *= factor` MULTIPLIES the
// balance; the per-claim path ADDS deltas computed against a different base.
//
// AND IT IS THE SAME CROSSING STAGE 0 REMOVED, arriving by a different route:
// cumulative netPaid FALLS on 8.9% of cohort year-over-year steps and 815
// cohort-valuations carry an ultimate below their own paid-to-date.
//
// GATED: cohort-ledger-check (FAST) asserts the three ledger identities on BOTH
// arms. It was built RED against the flag-on arm at 85252cc so that the fix
// would turn it green rather than being argued in a report, and it did.
//
// WHAT IS STILL OPEN AND IS NOT CALIBRATION: the size trend is untested where
// it does its work (see its own note and composition-table-check's head), and
// the law's cohort total is unbudgeted against the retired constants — recorded
// below, and a cost for the flip to own rather than a question for Stage 1.
//
// ⚠ `settlement` IS A SECOND ARM, NOT A SECOND FEATURE, AND IT SHIPS TRUE.
// It exists so martingale-equivalence-check can run the engine with the
// settlement step suppressed and read the PERSISTENCE term on its own, then run
// it again with the step live and read the TOTAL. The settlement factor is
// hash-derived and consumes no RNG stream, so the two runs are identical in
// every other respect — a perfect pairing, and the only way to decompose the
// martingale from the engine rather than from a closed form. It has no effect
// whatever while `enabled` is false, because the settlement block never runs.
// ============================================================================
export const PER_CLAIM_REVISION = { enabled: false, settlement: true };

// ===========================================================================
// THE PRICING TRIANGLE — S1, FLAG-GATED AND OFF. Nothing in src/ reads it.
//
// Ten accident years, each at its own maturity, claims drawn as an INITIAL
// estimate and developed FORWARD. The mechanism is at claimTriangle.ts; this
// block is the parameter record and the M1 measurement that cleared it.
//
// ⚠ TWO FLAGS, AND THE ORDER BETWEEN THEM IS LOAD-BEARING. A triangle is a
// per-claim object, so its development is the per-claim law — and with
// PER_CLAIM_REVISION off the live engine develops COHORTS and has no per-claim
// development to match. So the factors this triangle teaches become true of the
// played game only once PER_CLAIM_REVISION flips. PER_CLAIM_REVISION must lead
// PRICING_TRIANGLE. Neither is flipped here.
export const PRICING_TRIANGLE = { enabled: false };

// Ten years is ordinary practice and the window is a weak lever, so it is not
// tuned. It is SHORTER THAN THE TAIL deliberately: the year that drops off is
// the most mature one, so the tail is never fully observed.
//
// ⚠ AND WHAT THAT BUYS DIFFERS BY BASIS — measured, because the two were
// conflated once. On the PAID triangle a ten-year window costs WC 9.8% (chain
// ladder estimate/truth 0.902 in every one of 40 games), because WC's payments
// run past its twelve-year IBNER horizon and a tail factor of 1.0 misses them.
// On the INCURRED triangle it costs almost nothing (0.999-1.002 on all three
// lines), because the estimate stops moving at the horizon. GL and Property fit
// inside the window on both bases. Do not quote the paid figure on the incurred
// basis; they are different deficiencies.
export const TRIANGLE_HISTORY_YEARS = 10;

// ===========================================================================
// THE INITIAL ESTIMATE — DERIVED FROM THE TERMINAL TARGET, NOT FITTED.
//
//     initial = A x drawn^k
//
// The severity fit becomes the TERMINAL distribution rather than the draw, so
// the initial spread is what is left after development is netted out:
//
//     Var[ln initial] = Var[ln terminal] - Var[ln development] - 2Cov
//     k = sqrt(target^2 - devt^2) / sd(ln drawn),   A = mean(drawn) / mean(drawn^k)
//
// ⚠ M1 — THE STOP CONDITION, AND IT CLEARED ON EVERY LINE. A negative residual
// on any line would mean that line has no initial distribution and the rebuild
// stops there. Measured, each line walked through ITS OWN claims, its own
// horizon and its own size mix:
//
//   line      terminal target   own devt   residual var   implied initial
//   WC              2.044         0.620        3.792          1.947
//   GL              2.140         0.714        4.069          2.017
//   Property        1.636         0.579        2.344          1.531
//
// ⚠ AND GL'S DEVELOPMENT VARIANCE WAS NOT CARRIED ACROSS, WHICH MATTERED IN THE
// UNEXPECTED DIRECTION. The brief tabulated the residual at GL's 1.28 for all
// three lines, which put Property at an implied initial of 1.019 and made it the
// stop-condition candidate. Each line's OWN development is roughly half that
// figure — 0.579 on Property — so its real headroom is 1.531 and it is not
// close to the boundary. Carrying GL across would have been conservative rather
// than dangerous here, but it would have been a second inheritance stacked on
// the GL-derived phi, and the point of measuring was not to find out which way
// it leaned.
//
// ⚠ WHAT THE REBUILD ACTUALLY WANTS IS STILL FURTHER AWAY, AND THIS IS THE OPEN
// ITEM. The source's own first-estimate-to-settled spread is 1.48-1.96. At these
// terminal targets that implies development of 1.410-0.580 on WC and 1.546-0.859
// on GL, against the model's 0.620 and 0.714 today — so phi would have to rise
// substantially. AND PROPERTY CANNOT REACH THE TOP OF THAT RANGE AT ALL: at a
// terminal of 1.636, an initial of 1.96 is a NEGATIVE residual. Property's
// terminal is too narrow to hold the source's first-estimate spread, and that is
// a real constraint on S2 rather than a rounding problem. Recorded now because
// S1 is where it becomes visible and S2 is where it has to be answered.
//
// The constants below are solved against the SHIPPED law at the SHIPPED phi.
// They are not free parameters: triangle-check re-solves them and fails if
// either the terminal spread or the preserved mean has drifted.
export const TRIANGLE_INITIAL_CONTRACTION: Record<string, { k: number; A: number }> = {
  WC: { k: 0.901934, A: 1.506467 },
  GL: { k: 0.855989, A: 2.156982 },
  Property: { k: 0.924533, A: 2.431518 },
};

// ===========================================================================
// THE DEVELOPMENT DRIFT — WHY THE HISTORY DEVELOPS AT ALL.
//
//     value(age+1) = value(age) x (1 + g x 2/(age+1)),  while the claim is OPEN
//
// ⚠ S1 SHIPPED WITHOUT THIS AND THE TRIANGLE CAME OUT FLAT. The revision law is
// mean-one, so E[terminal] = E[initial] however the initial spread is
// contracted: contracting buys DISPERSION and a chain ladder estimates the MEAN.
// Measured then, cumulative over six steps: 1.002 / 1.036 / 0.987, against the
// pool's own GL cumulative of 3.60. A factor selection had nothing to be wrong
// about, which is what made assertion 5 red.
//
// ⚠ THE DECAY IS LOAD-BEARING AND A CONSTANT RATE IS THE THIRD INSTANCE OF ONE
// FAILURE FAMILY. Sized both ways before choosing: a constant per-open-year rate
// anchored on GL gives WC a cumulative of 4,756, because 3.9% of WC's VALUE is
// still open at age 30 and a geometric rate compounds over all of it. Same shape
// as s = phi.m/h and as the 1/headroom exponent — a rate applied to a quantity
// that does not shrink fast enough to stop it. The shape used instead is
// CLAIM_REVISION_MAGNITUDE_NUMERATOR's own age curve, read from that constant
// rather than copied.
//
// ===========================================================================
// ⚠ GL IS MEASURED. WC AND PROPERTY ARE JUDGEMENT. Do not read the three as
// equally grounded.
//
// GL's target cumulative of 3.60 is the pool's own age-to-age factors multiplied
// out: 1.872 x 1.439 x 1.265 x 1.031 x 1.024. 85% of that development sits in
// ages 2 to 4. An earlier reading that GL still develops at ages 9 and 10 was
// withdrawn as noise — those factors are 0.998 and 1.026 on three observations
// each, straddling 1.0 — and GL's own fitted closure curve agrees: 0.1% of GL
// value is open at age 10.
//
// WC 2.50 and Property 1.25 have NO source behind them. Neither transfer rule
// from GL works and both were measured before being rejected: the same annual
// rate gives WC a cumulative of 8.8 and Property 1.65; the same cumulative needs
// g of 34.9% on WC and 138% on Property. Either is a judgement wearing an
// anchor's clothes, so these are stated as judgement instead — the same standing
// as IBNER_TOTAL_SD's 25/20/15%, phi's carry-across to two lines with no settled
// severity of their own, and the headroom exponent chosen on GL evidence. The
// reasoning is ordinary domain judgement: WC is long-tailed but its early
// development is less explosive than liability, and Property settles most of its
// book within three years.
//
// WHAT WOULD DISPLACE THEM: those two lines' own age-to-age triangles. One
// extract each, and they stop being judgement.
//
// ===========================================================================
// ⚠ AND THE WINDOW TAIL IS WC's ALONE, WHICH IS NOT WHAT THE DESIGN ASSUMED.
// The point of a ten-year window is that development continues past it, so the
// correct tail factor is unknown and has to be selected. Measured from each
// line's own fitted closure curve, value-weighted open share at age 10:
//
//   WC 43.6%      GL 0.1%      Property 0.1%
//
// So GL and Property have essentially nothing open past the window and NO drift
// of any size reaches beyond it — their tail factors run 1.0001 to 1.027 across
// the whole plausible range of g. Only WC gets a structural window error, and at
// its shipped drift that is about 17% — a CHOSEN number, since WC's g is
// judgement, not a measured one.
//
// This is not a defect to fix here. It means the SELECTION error carries GL and
// Property rather than supplementing them, which is S5's job and now its whole
// job on two of three lines. Said plainly so nobody later reads a structural
// tail error as applying to all three.
//
// ⚠ LENGTHENING IBNER_HORIZON WOULD DO NOTHING, and this was checked rather than
// assumed. That constant bounds the COHORT path; the triangle develops while
// age < closureAge and never reads it. The binding constraint is closure, and
// those curves are fitted per line against their own over-threshold experience.
export const TRIANGLE_DEVELOPMENT_DRIFT: Record<string, number> = {
  WC: 0.26342,
  GL: 0.58721,
  Property: 0.26093,
};
// ===========================================================================
// ⚠ ALL FOUR STAGE 1 GATES NOW EXIST. This note recorded two as unbuilt and
// said the flag must not be flipped until both did; both do, and the record of
// WHY each was blocked is kept because each blocker was a real one.
//
// THE COMPOSITION TABLE — BUILT (composition-table-check, FAST). It was blocked
//   on the target, not on the code: the series it reproduces is source
//   experience that must stay out of this repo (the standing rule — the
//   parameters ARE the record, the tables are not), and building the model half
//   alone would have been a `*-check` that prints a table and asserts nothing.
//   The target was supplied and it became a real gate.
//   ⚠ AND WHAT IT ASSERTS IS NARROWER THAN ITS NAME. It validates the AGE curve
//   on a COUNT basis. It does not reach the size trend, and the movement target
//   it was built against has since been closed as unmatchable — see
//   CLAIM_MOVEMENT_BY_AGE_TARGET. The gate is still correct and still worth
//   running; it is the SCOPE that a reader must not over-read.
//
// PRE-GAME ACCEPTANCE — BUILT AT THE WIRING COMMIT (pregame-acceptance-check).
//   It could not exist before: the search calls processYear, which developed
//   through the old cohort path while the law had no caller in src/.
//
// ⚠ AND THE FLIP COSTS THE SEARCH NOTHING, WHICH IS NOT WHAT WAS EXPECTED.
// Measured, flag ON against flag OFF, 150 seeds per line:
//
//   line       mean attempts    p99        fallbacks against the 500 cap
//   WC         2.93 -> 2.93     12 -> 10   0 -> 0
//   GL         3.06 -> 3.11     12 -> 13   0 -> 0
//   Property   3.97 -> 3.97     19 -> 15   0 -> 0
//
// WC — the fragile line, the one that would fail first — is unchanged to two
// decimal places, and no seed on either arm exhausted the cap.
//
// THE OPENING BAND DOES NOT NEED RE-TRANSLATING EITHER. Measured on the
// UNFILTERED ratio (attempt 0 only, no rejection), per 995f6f9's rule that the
// band-selected sample is a fixed-point iteration against your own selection
// effect — 300 seeds per line:
//
//   line       SD ratio ON/OFF    unfiltered in-band share OFF -> ON
//   WC             1.069             34.3% -> 32.3%
//   GL             0.980             33.3% -> 36.7%
//   Property       1.007             28.0% -> 26.0%
//
// GL's spread NARROWS. Every difference above sits inside about one standard
// error at this sample, so the honest reading is no measurable change rather
// than a small one.
//
// ⚠ THE CONDITION THAT WAS ATTACHED TO THIS IS WITHDRAWN, AND THE REASONING
// BEHIND IT WAS WRONG TWICE OVER. It read: the law does not widen the pre-game
// because its realised movement (9.8% of cohort incurred at age 1) is smaller
// than the cohort path it replaces (IBNER_TOTAL_SD 20-25%), so if the 84%/9.8%
// work raises that movement the band question reopens.
//
// THOSE WERE DIFFERENT STATISTICS. 9.8% is PER STEP. IBNER_TOTAL_SD is the TOTAL
// relative SD of the ultimate over the whole runoff, by its own definition at
// reserveStepSigma. Increments add in variance, so 9.8% over five or six steps
// is 21.9% to 24.0% — the same neighbourhood, not a third of it.
//
// AND THE DIRECTION WAS BACKWARDS. Measured on the constant's own basis
// (revision-total-sd-report: pre-cession cohort development at maturity, sample
// unbiased in the horizon draw), the law develops 2.7x to 3.2x the cohort path
// on the robust spread — MORE, not less, on every line.
//
// So the band clearance above is unconditional, and for a better reason than
// the one it had. The ON arm measured here IS that widened mechanism at the
// same phi: the pre-game already contains the widening and the opening
// distribution did not move. A 3-year pre-game takes two or three steps of a
// five-to-twelve-step runoff, at the low-age end where s is smallest, and the
// opening surplus ratio is set by premium and loss LEVEL rather than by cohort
// development tails. The band met the widening and survived it.
//
// ⚠ THE 84%-VERSUS-9.8% ITEM IS CLOSED. Its answer is at
// CLAIM_MOVEMENT_BY_AGE_TARGET and it is that the target is not a target. What
// follows is what the chase established, kept because each step was wrong in a
// way a future reader could repeat.
//
// THE COMPOSITION AND THE TARGET NEVER MET. With the ages aligned (see the
// retraction at CLAIM_OPEN_SHARE_MODEL_RECORDED) the composition tracks as
// briefed — count-weighted magnitude x leaving open share gives 84 / 50 / 30 /
// 17 / 8 against 110 / 65 / 42 / 17 / 6 — and that agreement carried no
// information about the target, because the two constrain DISJOINT HALVES of
// the min(age, size) combine. At GL model age 1 the size trend binds on 14.3%
// of claims by count and 95.9% by value: the count-weighted composition is
// measuring the AGE CURVE with the size trend inactive, and the value-weighted
// target is measuring the SIZE TREND with the age curve inactive. A gate that
// validates one says nothing about the other.
//
// THE DECOMPOSITION, WHICH CLOSES EXACTLY. Composed 0.829 to realised 0.111 at
// GL age 1 is four multiplicative terms and the ladder reproduces the realised
// figure to three decimals at every age on every line:
//   weighting basis, count against value   /2.88   53% of the log gap
//   phi = 0.63                             /1.59   23%
//   q = 0.70                               /1.43   18%
//   E|f-1| / s = 0.799                     /1.25   11%
//   open-share timing                      x1.10   -5%
// phi and q are not defects — they are terms the composition never contained.
//
// ⚠ AND THE MEAN-ONE CORRECTION WAS THE SMALLEST TERM, WHICH REFUTED THE
// HYPOTHESIS IT WAS BUILT TO TEST. exp(-s^2/2) was the natural suspect: one
// parameter doing two jobs, a median that collapses as s grows. It accounts for
// 11% of the gap and, at the ages the target lives on, essentially none of it —
// E|X-1|/s tends to sqrt(2/pi) = 0.798 for ANY log-symmetric factor as s -> 0,
// and GL age 1 measures 0.799. The correction only bites where s is large,
// which on GL is age 5 (0.763) and on Property is age 5 (0.258). It is a real
// property of the factor and it is not the movement gap.
//
// ⚠ AND THE SECOND OPEN ITEM, WHICH IS LARGER THAN THE FIRST: THE LAW'S COHORT
// TOTAL IS UNBUDGETED. Measured on IBNER_TOTAL_SD's own basis
// (revision-total-sd-report), the law develops 2.7x to 3.2x the cohort path it
// replaces on the robust spread. Two things follow and both belong to the flip.
//
//   THE SD IS NOT ESTIMABLE ON THE ON ARM. WC's sample SD read 31% at 40 games
//   and 83% at 100, because one cohort at 22x its register sum sets it. That is
//   reserveStepSigma's own warning from the other side — its header records a
//   Monte Carlo still climbing toward the closed form at 48M trials. "Does the
//   law deliver IBNER_TOTAL_SD" cannot be answered by measuring an SD.
//
//   s IS UNBOUNDED, AND THAT WAS THE PROXIMATE CAUSE. Under s = phi x magnitude
//   / headroom nothing bounded the division: as a cohort pays down, headroom
//   goes to zero. At the median tracked occurrence GL reached s = 22.75 by age 8
//   and Property s = 3.80 by age 4. The magnitude was fitted on the INCURRED and
//   the division is what puts it on the reserve, so nothing fitted ever chose
//   those values. At large s the factor is still exactly mean-one but delivers
//   it as a near-certain collapse plus a vanishing chance of an enormous
//   multiple. WC's tail is the other shape: s stays near 1 and twelve steps
//   compound it.
//   ⚠ s IS STILL UNBOUNDED AND THE TAIL IS STILL SHUT — BOTH, AND THIS PARAGRAPH
//   STAYS AS WRITTEN BECAUSE ITS DIAGNOSIS WAS ONLY HALF RIGHT. h^-0.5 diverges
//   too, and the same table now reads GL 1.84 and Property 1.01 only because it
//   uses the PATTERN's headroom; the engine uses the realised balance and goes
//   lower. What actually removed the tail is that the delta stopped cancelling
//   the divisor — movement goes as sqrt(h), so a large s now arrives where the
//   balance it multiplies is vanishing. So "s is unbounded" was never the
//   mechanism on its own, and clamping s would not have been the fix. See
//   CLAIM_REVISION_HEADROOM_EXPONENT.
//
// THIS DOES NOT CONTRADICT THE TERMINAL-SEVERITY ANCHOR. That anchor constrains
// the log-SD of SETTLED severity PER CLAIM; this is the COHORT aggregate. The
// old path drew one lognormal per accident year with a mixture that made half
// of them nearly flat, while the law draws every occurrence separately and a
// cohort's movement is then dominated by its few largest with almost no
// diversification. Matching the one and widening the other are consistent —
// which is exactly why this quantity went unbudgeted until it was measured.
//
// WHAT IS BUILT AND GREEN: terminal-severity-check (FAST, 30s) derives phi
// against the anchor and carries the phi = 0 control arm;
// revision-direction-check (FAST, 5s) asserts the probe arm out of
// reviseDevelopingSet; martingale-equivalence-check (SLOW) decomposes the
// persistence and settlement terms with separate intervals and carries the
// fitted-level control arm, which reads 0.837 against a 1% tolerance. At the
// shipped exponent it measures persistence 1.00034 +/- 0.00022, settlement
// 1.00099 +/- 0.00174, total 1.00130 +/- 0.00172 over 49.4M claim-walks, with
// the engine arm agreeing on h to 1.7e-15 within cohort.
//
// ⚠ AND ONE THING THAT WAS NOT GREEN AND NOTHING CAUGHT: revision-total-sd-report
// kept its own inlined copy of s with the headroom division hardcoded, so for a
// whole commit it printed the RETIRED form's s table under a heading describing
// the shipped one, with a paragraph of prose reasoning from those numbers. It is
// now routed through revisionSigma, which exists for that reason. A report that
// recomputes the law cannot disagree with the law, so no gate could have found
// this — only reading it could.
// ===========================================================================


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
  // Measured by property-fit-report.ts from these parameters rather than taken
  // on trust — MEASURED, not gated: that script prints and exits 0, so this is
  // a recorded reading. The cap removes 1.9% of the mean and binds once in 6,610 claims,
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
// against the generator by property-claim-check.ts ALONE, so the price and the
// draw cannot drift apart.
//
// ⚠ THIS ALSO NAMED property-fit-check, WHICH ASSERTS NOTHING (now
// property-fit-report — it prints the scale analysis and exits 0 either way).
// One asserting script and one reading script read as two guards.
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
