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
  // Probability this component's claim is reported LATE (see reportLag below).
  // Tilted 3.6x on `large` on purpose — see the reportLag comment.
  pDelayed: number;
}

export const WC_SEVERITY_COMPONENTS = {
  // FITTED (EM on the pool's claim severities). Median $308, mean $489, CV 1.23.
  small: { mu: 5.731549, sigma: 0.960883, pDelayed: 0.05 },
  // FITTED (EM). Median $1,753, mean $2,974, CV 1.37.
  medium: { mu: 7.469014, sigma: 1.028369, pDelayed: 0.05 },
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
  // THE TAIL HAS NO CEILING. The 1-in-250-year claim is $71.2M. If $50M is a
  // hard maximum rather than a high observation, that needs an explicit cap —
  // recorded as an open item, deliberately not imposed here.
  large: { mu: 9.4776, sigma: 2.00, pDelayed: 0.18 },
  // ASSERTED. Schools' second component. Median $5,363, mean $27,100, CV 3.51.
  // Schools has TWO components by design — a school district does not generate
  // the catastrophic-injury tail that a public-works or safety group does.
  schoolsMedium: { mu: 8.5873, sigma: 1.80, pDelayed: 0.05 },
} as const satisfies Record<string, WcSeverityComponent>;

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

  // --- Report lag ---------------------------------------------------------
  //
  // Every claim draws a lag AFTER its severity. The draws are INDEPENDENT — the
  // only coupling is that p_delayed differs by component (above), which is what
  // makes the unreported inventory dollar-weighted rather than a random sample.
  //
  //   lag = round(1 + lognormal(mean 2.5, CV 2.0))     [years, >= 1]
  //
  // Shape: median 2 years, 10% beyond 7, 1% beyond 22, a thin tail to ~57.
  // That matches the real structure — a large mass reporting at once, a chunk
  // at one year (December injuries, and minor injuries that later worsened),
  // and a thin tail of genuine occupational disease.
  //
  // THE 15%-ISH OVERALL DELAYED RATE IS DOING TWO JOBS DELIBERATELY: genuine
  // late reporting, and the CALENDAR-BOUNDARY EFFECT — a December injury
  // reported in January has a one-month real lag but crosses the accident year.
  // In an annual model those are indistinguishable.
  //
  // WHY `large` IS TILTED 3.6x (0.18 against 0.05). It carries ~94% of the loss,
  // so tilting it makes the IBNR inventory dollar-weighted toward large claims:
  // 8.4% of claims by count but 17.1% by dollars, pool-wide. That recovers the
  // correlation the retired presumption process had (0.82% of claims, 16% of
  // dollars) and it is what gives a retroactive shock real force — without the
  // tilt the inventory would be a random sample of ordinary claims. Schools has
  // no `large` component, so its count and dollar shares are equal at 5.0%,
  // which is right: a school district's late claims are not occupational
  // disease.
  //
  // NO TRUNCATION IS NEEDED, unlike the retired presumption lag, because
  // severity does not trend over the lag. See convention 2 in the header.
  //
  // ALL FOUR LAG PARAMETERS ARE ASSERTED. DISPLACED BY: report-date-minus-
  // accident-date from the same claim file the severity fit came from — which
  // would also make the implied loss-development factors a measured output
  // instead of a derived one.
  reportLag: { meanYears: 2.5, cv: 2.0 },

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
// WC_SEVERITY_COMPONENTS.large. This is therefore the FIRST severity cap in
// the live model, and it leaves WC and GL on different footings. Bounding WC
// is a separate decision that has NOT been taken.
//
// WHAT WOULD DISPLACE IT: a public-entity liability claim distribution with
// observed maxima, or a verdict study establishing a realistic ceiling. A
// different number is a one-line change here — every consumer routes through
// expectedClaimSeverity (analytic) and the single draw site in glClaimEngine.
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
// defaults (4.2%), NOT the nominal 1 - BASE_RETENTION (5.0%). See that constant
// for why the two differ and why using the nominal one would re-tilt the fix.
//
// It is derived at the call site from the LIVE roster length rather than frozen
// as a literal, so it stays correct if BASE_RETENTION moves or the roster is
// ever resized — the basis of a calibrated rate is part of its value (the
// sdOverExpected lesson).
//
// ⚠ THE CONDITION IS ON TOTAL JOINS, NOT ON THE BASE ALONE, and the `adj` term
// is why. The adjustment ladder in membershipEngine's newMemberAdjustment does
// NOT sit at zero when every decision is at its default: measured at +0.60
// members/yr, stable across all ten years and near-identical on all three lines
// (WC +0.617, GL +0.639, Property +0.549). Two channels drive it —
// competitivePressure, drawn in [0.3, 0.8], contributes (1 - cp) x 0.5, mean
// +0.225; and satisfaction starts in [6.5, 8.5], so the >= 7.5 branch fires
// about half the time. Pinning k on the base alone would therefore leave the
// pool growing at defaults, which fails the whole point of the fix.
//
// Folding it in is not a fudge, it is what makes the adjustments DIFFERENTIAL:
// all-defaults is now the neutral point, so a player who raises assessments or
// tightens underwriting moves the book relative to a book that would otherwise
// have held still. Decline becomes attributable to a decision, which is the
// entire objective. Leaving `adj` out would measure every decision against a
// silently growing baseline instead.
//
// N* = 62 is the pooled median starting book over 60 seeds with all three lines
// active (WC 59, GL 64, Property 63). Starting books are drawn as an exposure
// SHARE (STARTING_EXPOSURE_SHARE, 25-35%), never as a count, so the count is
// emergent. The three per-line medians span 1.085x — well inside the range one
// k can serve — so no per-line calibration is warranted.
//
// ⚠ N* IS MILDLY SELF-REFERENTIAL, and that is understood rather than
// overlooked: runPriorHistory simulates three pre-game years through this same
// membership engine, so the book handed to year 1 already reflects whatever k
// is in force. Measured under the shipped k the starting book settles at 58-61
// rather than the 62 it was calibrated from — a fixed point self-consistent to
// about two members, which is well inside seed noise (the per-seed starting
// book spans 45 to 88). It does not iterate away: the measured ten-year
// trajectory holds flat from wherever it opens, which is the property that
// actually matters and is verified directly in
// scripts/diagnostics/membership-equilibrium-check.ts.
//
//     k = (62 x 0.042 - 0.60) / (200 - 62) = 2.004 / 138 = 0.014522
export const MEMBERSHIP_EQUILIBRIUM_ENROLLMENT = 62;

// The measured contribution of the adjustment ladder at ALL-DEFAULT decisions,
// in members/yr. Folded into k so that defaults are the neutral point — see the
// note above. Measured, not chosen: 40 games x 10 years x 3 lines, calling the
// engine's own newMemberAdjustment.
//
// ⚠ If any adjustment branch's coefficient changes, or a dormant channel (the
// pending bill-based satisfaction and rate-change replacements) is switched on,
// THIS NUMBER MUST BE RE-MEASURED. It is a property of the ladder, not a
// constant of nature, and a stale value here silently re-tilts the equilibrium.
export const MEMBERSHIP_DEFAULT_ADJUSTMENT = 0.60;

// The REALISED share of the book that leaves per year at all-default decisions.
//
// ⚠ THIS IS NOT 1 - BASE_RETENTION, AND USING THAT INSTEAD IS THE SAME MISTAKE
// AS IGNORING THE JOIN ADJUSTMENT. BASE_RETENTION 0.95 is only the base of
// calcRetentionProbability, which then adds a satisfaction term and a
// financial-strength term — both POSITIVE at defaults, since satisfaction
// starts in [6.5, 8.5] against a 5.0 reference and the surplus ratio climbs
// through the 0.6 reference as the pool builds surplus. MAX_WITHDRAWN_PER_YEAR
// then truncates the top of the noise distribution on top of that. The measured
// result is 4.2%, not 5.0% — WC 4.1%, GL 4.2%, Property 4.2%, over 40 games x
// 10 years x 3 lines at defaults.
//
// Both sides of the equilibrium therefore have to be taken as they actually
// behave at defaults, not as their nominal constants read. Pinning k on 5.0%
// while the book only sheds 4.2% builds in a permanent upward tilt.
export const MEMBERSHIP_DEFAULT_DEPARTURE_RATE = 0.042;

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

  // Per-risk XoL retention. The figures below are v4 (roster v4 doubled TIV
  // while this $2M threshold stayed fixed in dollars, so the v3 figures this
  // comment used to cite — 1.77/1.78/1.78/1.77 breaches/yr, largest location
  // $93.5M — are stale by roughly 2x and have been replaced).
  //
  // Measured at v4 by property-claim-check.ts, BOTH BASES, because the treaty
  // responds to the POOL's claims, not the market's, and every per-risk figure
  // in this project's history that was quoted full-market alone has read
  // roughly 3.7x too high:
  //   full-market breaches/yr   ~3.92, ~3.6% of attritional claims
  //   enrolled-pool breaches/yr ~1.05 — the treaty-facing basis
  // The retention itself has NOT been revisited at v4 and may want to be: a
  // fixed $2M threshold against a roster whose TIV doubled is a materially
  // looser retention in real terms than it was at v3.
  //
  // The treaty is alive ONLY through within-member concentration: at a flat
  // ~$7.67M average location (v4, $14,303.6M / 1,866 locations) almost no
  // damage ratio breaches $2M, but Primary Asset Share concentrates each
  // member's TIV into one dominant site (largest single location $187.0M, v4).
  // Flatten Primary Asset Share and the treaty dies.
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
// ⚠ EVERY mu BELOW WAS SOLVED NUMERICALLY AGAINST A TARGET AAL. Intensity
// enters the event TWICE — once through the footprint
// (hit_rate = min(base_footprint x intensity, cap)) and once through the damage
// ratio (event_mean_dr = mu x intensity) — so expected loss per event scales
// with E[I^2] = 1 + CV^2, not E[I]^2 = 1, and a naive mu/(1+CV^2) correction
// does NOT land, because the footprint cap interacts with the intensity draw
// (quake especially: cap 0.95 binds often at CV 1.1).
//
// AN EXACT CLOSED FORM DOES EXIST, though — the cap does not defeat one, it just
// means SPLITTING the expectation at the cap instead of taking it whole. See
// claimMath.lognormalPartialMoment and finding 22's refinement note.
// expectedWeatherGrossLoss is built on it.
//
// DO NOT RE-SOLVE mu ON THE STRENGTH OF THAT. The existing values verify well
// inside tolerance (weather sits +0.33% from its target, which is mu's own
// rounding to three significant figures), so a re-solve would move a pinned
// constant for no behavioural gain. The closed form is recorded so the option is
// available, not so it gets exercised.
//
// RE-SOLVE mu IF lambda, base_footprint, cap OR CV MOVES — and if the roster
// moves in a way that is not a pure scale change. Unlike the WC and GL pure
// premiums, these do NOT recompute themselves. Weather is the ONE exemption from
// the roster clause: its AAL is exactly linear in TIV (see targetAal below), so
// roster v4 rescaled its target without re-solving. Cat has no such exemption —
// it draws its zone by hazard weight, v4 rescaled the zones by DIFFERENT factors
// (2.0045 / 2.0168 / 2.1277), and the cat targets below are still v3 figures.
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
