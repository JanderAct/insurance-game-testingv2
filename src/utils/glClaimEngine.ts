// General Liability claim-level loss generator — REBUILT onto a fitted
// per-claim 3-component lognormal mixture. See GL_LOSS_MODEL in
// defaultAssumptions.ts for the full rationale and an inventory of what this
// rebuild deleted (sub-coverages, the liability gate, litigation stages,
// GL_SOCIAL_INFLATION, the statutory cap, multi-claimant abuse batches).
//
// Same architecture as WC (wcClaimEngine.ts is the template), narrower now
// that the gate and batches are gone:
// 1. ONE BASIS: generateGlClaims (draw) and expectedGlGrossLossForKLine
//    (analytic on the draw's own basis) are a matched pair; GL's pure premium
//    derives from expectedGlGrossLossForPricing. See GlLossBasis for which
//    risk-quality channels each of the two sees, and why there are two.
// 2. RISK CONTROL HITS THE DRAW ONLY — absent from both expectations.
// 3. PURE PREMIUM HELD, k_GL ADAPTS — k_GL is GL's own normalizer, separate
//    from WC's, recomputed annually against the enrolled book. It neutralises
//    BOTH risk-quality channels, so the drawn expected loss equals the held
//    priced expectation whatever the book's RQ mix.
// 3b. SEVERITY IS CAPPED ON BOTH SIDES OF THE PAIR, AND THE CEILING TRENDS.
//    glSeverityCap(year) = GL_SEVERITY_CAP ($100M, year-1) x glSeverityTrend.
//    The draw clamps every claim; expectedClaimSeverity has NO uncapped code
//    path left. Because the ceiling now moves WITH the distribution, the capped
//    expectation grows at exactly glSeverityTrend again — glCappedSeverityTrend
//    still exists and is still what pricing calls, but it now returns the raw
//    trend. It is kept as a live cross-check rather than collapsed; see its
//    header for why that is the safer shape.
// 4. DOLLAR VINTAGE IS THE ACCIDENT YEAR, ONCE. Severity is trended to the
//    accident year at the draw (glSeverityTrend) and frozen onto the claim.
//    GL has NO REPORT LAG — every claim reports in its own accident year — so
//    there is no emergence to re-value and no lag for the trend to compound
//    over. Frequency is FLAT and reads REAL payroll; the wage factor is a
//    rating/premium/display quantity only (see lineHelpers.getMemberExposure).
//
// OCCURRENCE == CLAIM, exactly like WC. GL's batch mechanism is deleted, not
// layered differently — see GL_LOSS_MODEL's header comment for why.

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence } from '../types/simulation';
import { deriveSubRng } from './random';
import { WHOLE_LINE } from './shockEffects';
import { GL_HEAVY_COMPONENT_INDEX, GL_LOSS_MODEL, GL_SEVERITY_CAP, GL_SEVERITY_COMPONENTS, type GlSeverityComponent } from '../data/defaultAssumptions';
import { limitedExpectedValue, memoizeByYear } from './claimMath';

const M = GL_LOSS_MODEL;
const LINE: CoverageLine = 'GL';
const NEUTRAL_RQ = 5;

// --- severity trend ------------------------------------------------------------

// GL SEVERITY TREND — wage inflation compounded with LONG-RUN social inflation.
//
//   wage inflation            3.63%   (see exposureTrend.ts for its derivation)
//   long-run social inflation 2.00%   JUDGMENT — see below
//   composed                  1.0363 x 1.0200 = 1.057026  ->  5.7026%/yr
//
// ⚠ COMPOSED MULTIPLICATIVELY, NOT SUMMED. Swiss Re define social inflation as
// severity growth BEYOND economic drivers — an additive excess as a CONCEPT —
// but the figures only reconcile as a product: 3.63 + 2.00 = 5.63, whereas
// 1.0363 x 1.020 = 1.057026. Summing the rates would understate the trend and
// break the rate-trend identity below.
//
// THE IDENTITY THAT MAKES THIS PAIR CORRECT: GL's rate is per $100 of NOMINAL
// payroll, so
//   rate trend = severityTrend / wageFactor = 1.057026 / 1.0363 = 1.0200
// exactly the social-inflation half. Payroll grows with the economic half,
// severity with both, and members feel the difference. Over a ten-year game
// (nine compounding periods) the rate rises x1.1951 and the member charge
// x1.6473, against WC's rate which stays flat.
//
// ===========================================================================
// SOURCING, AND WHICH NUMBER IS NOT SOURCED
// ===========================================================================
//
// SOURCED — Swiss Re Institute, sigma 4/2024, Social Inflation Index:
//   57% cumulative over the decade (4.6%/yr), 5.4%/yr average 2017-2022,
//   peaking at 7% in 2023. Social inflation observed since the 1980s, with
//   prior episodes in the 1980s and 2000s and the current one beginning in the
//   mid-2010s; the index has been above zero every year since 2014.
//
// ⚠ THE 2.0% IS A JUDGMENT, NOT A SWISS RE FIGURE. The 4.6%, 5.4% and 7.0%
// figures above are theirs; 2.0% is an estimate of a LONG-RUN AVERAGE ACROSS
// EPISODES AND QUIET PERIODS.
//
// WHY NOT USE 4.6% AS THE BASELINE. It is the CURRENT EPISODE'S average, not a
// long-run rate. Baking it in permanently asserts the episode never ends — and
// then the hard-market event (shockCatalog #19) adds another episode on top of
// it, double-counting. If the EVENT is the episode, the BASELINE has to be the
// between-episode rate. That is a structural argument, not a calibration one:
// it would hold even if the resulting numbers were convenient.
//
// WHAT WOULD DISPLACE IT: a social-inflation index covering the pre-2014
// period, or a public-entity liability severity trend from a rate filing.
// ===========================================================================
export const GL_SEVERITY_TREND_PER_YEAR = 0.057026;

// Live year 1 is the reference (factor 1.0).
//
// ⚠ FLOORS AT YEAR 1, exactly as wageFactor does, and for the same reason. The
// pre-game is an INITIAL-CONDITIONS GENERATOR whose dollar constants are
// year-1 dollars, not a severity history. The two factors must floor TOGETHER:
// pinning payroll while letting severity deflate would make the drawn and
// priced loss diverge across the years that set opening reserves.
// MEMOIZED, FLOORED AT THE CACHE KEY. Fires once per DRAWN CLAIM in
// generateGlClaims's severity draw (the grossUltimate = ... line, via
// trendedMuGl below) — ~1,024/yr at full market, every game-year — plus once
// per (member, component) inside glAggregateCumulants's cappedRawMoments.
// Floors at year 1 exactly like wcSeverityTrend, for the same reason (see
// wageFactor's header).
export const glSeverityTrend = memoizeByYear(
  (yearNumber: number) => Math.pow(1 + GL_SEVERITY_TREND_PER_YEAR, Math.max(1, yearNumber) - 1),
  yearNumber => Math.max(1, yearNumber),
);

// THE CEILING IN THAT YEAR'S DOLLARS. GL_SEVERITY_CAP is the YEAR-1 ceiling;
// this trends it at GL's own severity trend, exactly as wcSeverityCap does for
// WC. See that function for the algebra.
//
// GL IS THE LARGEST CASE OF THE DEFECT THIS FIXES. At a 5.7026% severity trend
// a stationary $100M ceiling was worth $60.7M in year-1 terms by year 10 — a
// 39% real-terms tightening, against WC's 28%. That is what glCappedSeverityTrend
// below was built to compensate for, and with the ceiling trending there is
// nothing left to compensate.
//
// FLOORED AT YEAR 1 and memoized on that floor, matching glSeverityTrend.
export const glSeverityCap = memoizeByYear(
  (yearNumber: number) => GL_SEVERITY_CAP * glSeverityTrend(yearNumber),
  yearNumber => Math.max(1, yearNumber),
);

// A component's log-location shifted to a given year, and optionally by a
// severity SHOCK factor on top.
//
// exp(mu + ln(s)) = s x exp(mu), so a location shift in log space IS a
// multiplicative scale on the drawn amount — it leaves sigma untouched, and
// therefore leaves the per-claim CV untouched, and therefore does not slide a
// CV-indexed CLF grid. Same trick as wcClaimEngine's trendedMu.
//
// THE SHOCK RIDES THE SAME SHIFT rather than scaling the drawn amount
// afterwards, so there is ONE mechanism and one place for it to be wrong.
export function trendedMuGl(mu: number, yearNumber: number, severityShock = 1): number {
  return mu + Math.log(glSeverityTrend(yearNumber) * severityShock);
}

// HOW FAST THE CAPPED EXPECTED CLAIM ACTUALLY GROWS. Since the ceiling started
// trending this is glSeverityTrend — but it is still COMPUTED rather than
// returned, and the distinction is the point of the function.
//
// ⚠ THIS USED TO DIFFER FROM THE RAW TREND AND THE HISTORY IS WHY IT SURVIVES.
// Under a FIXED ceiling glSeverityTrend stopped being a scale on the
// EXPECTATION, because E[min(s X, cap)] = s E[min(X, cap/s)] < s E[min(X, cap)].
// The cap did not inflate, so it bit harder every year and the capped mean grew
// STRICTLY SLOWER than the raw trend:
//
//   year   glSeverityTrend   capped-then   raw/capped
//      2          1.057026      1.054798       +0.21%
//      5          1.248368      1.237251       +0.90%
//     10          1.647294      1.611191       +2.24%
//     20          2.868321      2.710606       +5.82%
//
// With glSeverityCap trending alongside the distribution, min(s X, s L) =
// s min(X, L) and the ratio collapses to s exactly. Every row above is now
// equal to its raw trend to float precision, which gl-claim-check.ts ASSERTS
// rather than assumes.
//
// ⚠ IT IS DELIBERATELY NOT COLLAPSED TO `return glSeverityTrend(y)`. Pricing
// needs the year factor that matches the GENERATOR, and this function derives
// that factor from the same expectedClaimSeverity the generator is matched
// against. Written as a ratio it stays correct automatically if the ceiling is
// ever re-pinned, a second ceiling is introduced, or the mixture gains a
// component that hits the cap differently. Written as the raw trend it would be
// correct only by coincidence, and would silently become the over-charge it was
// built to prevent. The cost is two normalCdf calls per year, memoized.
//
// ⚠ PRICING MUST USE THIS ONE. The engine prices GL as (held year-1 pure
// premium) x (year factor), and if that year factor were the RAW trend while
// the generator was capped nominally, the pool would charge for dollars the
// generator cannot produce — over-charging 2.2% by year 10 and 5.8% by year 20.
// That is finding 37's failure class with the sign reversed (price moving
// without the draw), and capping the within-year moments alone does NOT catch
// it: k_GL is a ratio of two same-year quantities, so the drift is invisible
// there (it shows up as a ~1e-5 wobble, no more).
//
// SAFE UNDER THE HELD-PURE-PREMIUM RULE. This is a deterministic, ROSTER-BLIND
// function of the year alone — it reads the untilted mixture weights and the
// cap, never the enrolled book — so it is exactly the kind of year factor that
// may ride on top of a held pure premium. k_GL keeps sole responsibility for the
// roster/risk-quality-mix correction.
// THE DENOMINATOR IS A CONSTANT, not merely year-invariant — HELD_PURE_PREMIUM_
// YEAR never changes, so `base` was being recomputed identically on EVERY call
// before this fix, independent of the per-year memoization below. Computed
// lazily, once, ever.
let cachedHeldBaseSeverity: number | undefined;
function heldBaseSeverity(): number {
  if (cachedHeldBaseSeverity === undefined) {
    cachedHeldBaseSeverity = expectedClaimSeverity(untiltedGlWeights(), HELD_PURE_PREMIUM_YEAR);
  }
  return cachedHeldBaseSeverity;
}

// MEMOIZED, FLOORED AT THE CACHE KEY, same reasoning as glSeverityTrend above
// — this is glClaimEngine's own pricing-year factor and the most expensive of
// the five per raw call: expectedClaimSeverity evaluates limitedExpectedValue
// (two normalCdf calls each) across all three GL severity components, not one
// Math.pow.
export const glCappedSeverityTrend = memoizeByYear(
  (yearNumber: number) => {
    const base = heldBaseSeverity();
    if (!(base > 0)) return 1;
    return expectedClaimSeverity(untiltedGlWeights(), yearNumber) / base;
  },
  yearNumber => Math.max(1, yearNumber),
);

// --- risk quality ------------------------------------------------------------

export function thetaGl(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// THE FITTED WEIGHTS, NORMALISED TO SUM TO EXACTLY 1.
//
// ⚠ THE SOURCE WEIGHTS DO NOT. 0.519201 + 0.0629521 + 0.417847 = 1.0000001 — a
// ~1e-7 rounding residual from the fit being stated to six decimal places. That
// is immaterial as a dollar figure and the stored constants are deliberately
// left exactly as the fit gave them, but EVERY consumer of a weight vector must
// see the SAME normalisation or the two expectation bases disagree at that
// residual and k_GL's identity stops being exact.
//
// It bit once already, and subtly. tiltedGlWeights renormalises by construction
// (it rescales the non-heavy weights so the vector sums to 1), while the untilted
// accessor used to hand back the raw weights unchanged. So the 'pricing' basis
// carried the 1e-7 excess and the 'kLine' basis did not, and the held-pure-premium
// identity held only to 1.9e-9 instead of to float precision. The arithmetic of
// that residual: the two small components are 0.926% of the mixture's dollars and
// were being scaled down by 2.08e-7, giving 0.00926 x 2.08e-7 = 1.93e-9 — exactly
// what was measured. Not a wrong answer at any scale that matters, but a real
// inconsistency between two things that must agree, so it is removed at the source
// rather than absorbed into a looser tolerance.
//
// SeededRandom.categorical normalises by its own total too, so the DRAW was never
// affected either way.
const NORMALISED_WEIGHTS: number[] = (() => {
  const raw = GL_SEVERITY_COMPONENTS.map(c => c.weight);
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map(w => w / total) : raw;
})();

// THE RISK-QUALITY SEVERITY TILT — mirrors wcClaimEngine.ts's tiltedWeights
// exactly:
//   w_heavy' = min(w_heavy x exp(-rqSeverityBeta x (RQ - 5)), 0.999)
//   scale    = (1 - w_heavy') / (sum of the other weights)
// Renormalises the remaining components, preserving their ratio to each
// other. At RQ 5 (neutral) this is the identity.
//
// ⚠ NOT THE PRICING BASIS — see GlLossBasis below. Used by the DRAW and by the
// k_GL basis; never by 'pricing'. GL has only one mixture (no rating groups to
// look a heavy component up per-group the way WC does), so the heavy index is
// the fixed constant GL_HEAVY_COMPONENT_INDEX rather than a per-group field.
//
// ⚠ NO `params` ARGUMENT, DELIBERATELY DIVERGING FROM WC's tiltedWeights.
// This function used to take `params = M` and then discard it (`void params`),
// reading module-level M regardless — a signature that promised
// parameterisation and silently ignored it. Removed rather than honoured,
// because honouring it could only ever be HALF true: WC's rating groups and
// its rqSeverityBeta both live inside WC_LOSS_MODEL, so WC's params really does
// parameterise its whole model, whereas GL's mixture lives in the separate
// GL_SEVERITY_COMPONENTS export. A GL `params` argument could carry the beta
// but never the components, so a caller passing an alternative model would
// still get the real mixture back — the same class of silent wrong answer,
// one level subtler. If GL ever needs a parameterised severity model, move
// GL_SEVERITY_COMPONENTS into GL_LOSS_MODEL first and add the argument then.
export function tiltedGlWeights(riskQuality: number): number[] {
  const base = NORMALISED_WEIGHTS;
  const factor = Math.exp(-M.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
  const tiltedHeavy = Math.min(base[GL_HEAVY_COMPONENT_INDEX] * factor, 0.999);
  const otherTotal = base.reduce((s, w, i) => (i === GL_HEAVY_COMPONENT_INDEX ? s : s + w), 0);
  const scale = otherTotal > 0 ? (1 - tiltedHeavy) / otherTotal : 0;
  return base.map((w, i) => (i === GL_HEAVY_COMPONENT_INDEX ? tiltedHeavy : w * scale));
}

// The untilted mix — the pricing basis. Normalised, exactly as tiltedGlWeights'
// base is, so the two bases agree at neutral RQ to float precision. Kept as a
// named function so callers read "pricing basis" rather than reaching into
// GL_SEVERITY_COMPONENTS directly.
//
// EXPORTED for towerMoments.ts, which prices the reinsurance tower on the same
// pricing basis (invariant 2: the severity tilt is draw-and-k_GL only, and must
// not reach a price — including a reinsurance price).
export function untiltedGlWeights(): number[] {
  return NORMALISED_WEIGHTS.slice();
}

// --- severity means (analytic side of the matched pair) ----------------------

// CAPPED at GL_SEVERITY_CAP, like every other analytic mean here — the draw
// cannot produce a claim above the cap, so no analytic in this file may price
// one. Exposed through glInternals, so leaving an UNCAPPED variant reachable
// would be a trap-door: a future harness could build an uncapped expectation
// off it and the mismatch would look like a generator defect.
function componentMean(c: GlSeverityComponent, yearNumber: number): number {
  return limitedExpectedValue(trendedMuGl(c.mu, yearNumber), c.sigma, glSeverityCap(yearNumber));
}

// Expected severity of one claim under a given weight vector, IN THAT YEAR'S
// DOLLARS. `limit` caps each claim at that amount (E[min(X, limit)] per
// component) — see ExpectedGlLossOptions.severityLimit for why that exists.
//
// ⚠ ALWAYS CAPPED AT GL_SEVERITY_CAP, WHETHER OR NOT `limit` IS PASSED, and
// there is no longer any code path here that returns an uncapped mean. The draw
// clamps every claim to the cap, so an uncapped expectation would price dollars
// the generator cannot produce — finding 37's failure class (a factor reaching
// one side of the matched pair only), just wearing the cap as a costume instead
// of a trend. The two limits COMPOSE by min() rather than one overriding the
// other: the caller's $1M bounded-variance limit and the model's $100M ceiling
// are both real, and min() is exactly E[min(min(X, cap), limit)].
//
// ⚠ THE CALLER'S `limit` IS A FIXED DOLLAR AMOUNT AND THE SEVERITY INFLATES
// PAST IT. That is deliberate and is the whole point of the capped basis: a $1M
// bounded-variance limit in year 10 is a smaller share of the distribution than
// in year 1, exactly as a fixed reinsurance attachment is. The capped ANALYTIC
// here trends the same way the capped DRAW does, so the two stay matched.
//
// ⚠ THE MODEL CEILING IS THE OPPOSITE CASE AND THIS COMMENT USED TO CONFLATE
// THEM. It read: "THE $100M CEILING IS FIXED IN THE SAME SENSE — it does NOT
// inflate with the severity trend, so it binds harder in later years, which is
// what a legal/practical ceiling does." That was a considered position and it
// has been REVERSED, deliberately, not overlooked:
//
//   - A fixed reinsurance attachment is a CONTRACT the pool actually signed at
//     a nominal number, so its erosion is a real economic fact the game should
//     show. That is the caller's `limit`, and it stays fixed.
//   - The model ceiling is not a contract. It is this file's statement about
//     how large a GL claim can physically be, expressed in year-1 dollars
//     because that is the only vintage the fit had. Freezing it nominally does
//     not model a hard legal cap; it silently shrinks the modelled tail by 39%
//     in real terms over ten years, which changed the distribution's SHAPE and
//     broke the severity-scale invariance that glClfGrid depends on.
//
// So the ceiling now rides glSeverityCap and the two limits still COMPOSE by
// min(), which is exactly E[min(min(X, cap_t), limit)]. A caller passing $1M
// gets $1M in every year; a caller passing nothing gets that year's ceiling.
export function expectedClaimSeverity(weights: number[], yearNumber: number, limit?: number): number {
  const effectiveLimit = Math.min(limit ?? Number.POSITIVE_INFINITY, glSeverityCap(yearNumber));
  let total = 0;
  for (let i = 0; i < GL_SEVERITY_COMPONENTS.length; i++) {
    const c = GL_SEVERITY_COMPONENTS[i];
    total += weights[i] * limitedExpectedValue(trendedMuGl(c.mu, yearNumber), c.sigma, effectiveLimit);
  }
  return total;
}

// --- exported: analytic expectation --------------------------------------------

export interface ExpectedGlLossOptions {
  // The year whose DOLLARS this expectation is in. REQUIRED, WITH NO DEFAULT,
  // AND DELIBERATELY UNLIKE wcClaimEngine's optional `yearNumber?: number`.
  //
  // ⚠ A DEFAULT HERE IS FINDING 37's FAILURE CLASS EXACTLY: it lets a call site
  // silently price at year 1 forever while the draw trends away from it, which
  // is the defect that left WC's frequency trend unpriced for months. WC's
  // signature predates that finding; GL's is written after it. Required means
  // `options` itself cannot be omitted either — every caller states its year.
  yearNumber: number;
  // Force every member to this risk quality (used for the neutral book and for
  // k_GL's numerator). Omit to use each member's actual risk quality.
  riskQualityOverride?: number;
  kGl?: number;        // default 1
  // Shock frequency multipliers, for MEASURING a shock's expected cost — NEVER
  // for pricing. GL has no sub-coverages left to key by, so the only key that
  // means anything is WHOLE_LINE ('*'); both of GL's shock events are
  // whole-line multipliers (see shockCatalog.ts #22 and #28, and the
  // load-time validator there that keeps it that way).
  //
  // ⚠ RISK CONTROL IS ABSENT FROM THIS EXPECTATION BY DESIGN (invariant 2), and
  // so is the SHOCK when this option is omitted. Nothing that prices GL calls
  // it with this set.
  freqMultipliers?: Record<string, number>;
  // Cap each claim's severity at this limit inside the expectation.
  //
  // ⚠ EXISTS FOR THE BOUNDED-VARIANCE GATES, NOT FOR PRICING. GL's blended CV is
  // 29.55, so a ground-up sample mean cannot be gated at any realistic sample
  // size (finding 26). gl-cutover-check and marketplace-generation-check
  // therefore gate the $1M-CAPPED loss, whose per-claim variance is bounded, and
  // they need a matched capped ANALYTIC to compare against. Defining it here
  // rather than hand-rolling it in each harness keeps one definition of GL's
  // capped expectation instead of two that can drift. Nothing that prices GL
  // passes this.
  severityLimit?: number;
}

// WHICH RISK-QUALITY CHANNELS THE EXPECTATION SEES.
//
//   'pricing'  frequency theta only. The severity tilt is draw-only, so
//              including it here would move premium and losses together and
//              cancel (finding 17).
//   'kLine'    BOTH channels. k_GL normalises the book's risk-quality mix, so
//              it has to see everything RQ does or the held pure premium drifts
//              as the roster changes.
//
// NO DEFAULT, and two named wrappers below rather than a boolean parameter: the
// call site should read its own intent. Mirrors wcClaimEngine.ts's WcLossBasis
// seam exactly — see the k_GL note on computeKGl for what went wrong when GL
// had only the 'pricing' basis and used it on both sides of k_GL.
type GlLossBasis = 'pricing' | 'kLine';

function expectedGlGrossLossCore(
  members: Member[],
  basis: GlLossBasis,
  options: ExpectedGlLossOptions,
): number {
  const rqOverride = options.riskQualityOverride;
  const kGl = options.kGl ?? 1;
  const wholeLineMult = options.freqMultipliers?.[WHOLE_LINE] ?? 1;
  // Hoisted for 'pricing', where severity does not depend on the member.
  const untiltedSeverity = expectedClaimSeverity(untiltedGlWeights(), options.yearNumber, options.severityLimit);

  let total = 0;
  for (const member of members) {
    const payroll = member.exposureByLine.GL ?? 0;
    if (payroll <= 0) continue;
    const rq = rqOverride ?? member.riskQuality;
    const lambda = payroll * M.ratePer1M * thetaGl(rq) * kGl * wholeLineMult;
    const severity = basis === 'kLine'
      ? expectedClaimSeverity(tiltedGlWeights(rq), options.yearNumber, options.severityLimit)
      : untiltedSeverity;
    total += lambda * severity;
  }
  return total;
}

// The analytic expected GROSS loss for PRICING (accident-year dollars, ALAE
// included in the mixture). Frequency theta only — see the GlLossBasis comment.
// This is what purePremiumPer100 and every displayed expected loss derive from.
// Excludes risk control (invariant 2); E[member noise] = E[gPool] = 1.
export function expectedGlGrossLossForPricing(members: Member[], options: ExpectedGlLossOptions): number {
  return expectedGlGrossLossCore(members, 'pricing', options);
}

// The analytic expected GROSS loss on the k_GL basis — BOTH risk-quality
// channels, so it is also the DRAW's own expectation. computeKGl needs it;
// exported so the diagnostics can assert the two bases differ in the direction
// expected and that k_GL's identity holds.
export function expectedGlGrossLossForKLine(members: Member[], options: ExpectedGlLossOptions): number {
  return expectedGlGrossLossCore(members, 'kLine', options);
}

// --- exported: k_GL and the held pure premium ----------------------------------

// The risk-quality-mix normaliser: expected loss if the enrolled book were all
// at neutral risk quality, over expected loss at its actual mix. Applied to
// lambda so that changing WHO is enrolled doesn't drift the pool's aggregate
// expected loss away from the held pick.
//
// BOTH SIDES USE THE k_GL BASIS, so the correction covers frequency theta AND
// the severity tilt. At neutral RQ the tilt is the identity, so the numerator is
// unaffected by it and the ratio measures exactly the mix effect.
//
// ⚠ THIS WAS THE DEFECT FOUND REVIEWING THE GL REBUILD, and the old comment
// here asserted the opposite of what the code did. Both sides used to call the
// PRICING basis, which is untilted — so the severity term cancelled out of the
// ratio and k_GL corrected FREQUENCY ONLY. The draw applied the tilt anyway, so
// it survived in losses with nothing offsetting it in price, and the drawn
// expected loss diverged from the held priced expectation by up to 26.6% as the
// book's RQ mix moved (measured: 3.0% at the observed enrolled book's mean RQ of
// 5.51, 11.2% at RQ 7). Because underwriting selection moves the book's mean RQ,
// a player who underwrote well earned a hidden margin that grew with their
// skill — where on WC the same skill lowers the PRICE and the loss ratio stays
// flat, which is the right lesson for a pool whose objective is affordable
// coverage rather than profit.
//
// The invariant this restores is asserted directly, across the whole RQ range
// rather than only at neutral, in gl-claim-check.ts: for any book,
//   expectedGlGrossLossForKLine(book, { kGl: computeKGl(book) })
//     === expectedGlGrossLossForPricing(book, { riskQualityOverride: 5, kGl: 1 })
// ⚠ TREND-INVARIANT BY CONSTRUCTION, and asserted as such. glSeverityTrend is a
// scalar multiplier on both sides, so it cancels exactly out of the ratio — k_GL
// measures the roster's risk-quality mix and nothing else. yearNumber is still
// threaded rather than pinned, so that if a future trend ever became
// member-dependent the cancellation would visibly stop holding instead of being
// hidden by a hardcoded year.
export function computeKGl(members: Member[], yearNumber: number): number {
  const neutral = expectedGlGrossLossForKLine(members, { yearNumber, riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedGlGrossLossForKLine(members, { yearNumber });
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// GL's purePremiumPer100: derived ONCE from the full canonical roster at
// neutral risk quality and then HELD (Correction 1 discipline). Per $100 of
// payroll — GL's exposure base.
// ⚠ PINNED TO YEAR 1, and that pin is load-bearing. The held pick is the
// REFERENCE-YEAR pure premium; simulationEngine then multiplies it by
// glSeverityTrend(year) / wageFactor('GL', year) at pricing time. Deriving it at
// any other year would bake the trend in twice — once here and once there.
export const HELD_PURE_PREMIUM_YEAR = 1;
export function deriveNeutralGlPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedGlGrossLossForPricing(fullRoster, {
    yearNumber: HELD_PURE_PREMIUM_YEAR, riskQualityOverride: NEUTRAL_RQ, kGl: 1,
  });
  const payrollUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.GL ?? 0), 0) * 10_000;
  if (!(payrollUnits > 0)) return 0;
  return expected / payrollUnits;
}

// --- exported: the generator ----------------------------------------------------

export interface GlGenerationInputs {
  members: Member[];
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kGl: number;
  gPool: number;                    // the year's shared pool factor (from processYear)
  riskControlEffectiveness: number; // DRAW ONLY
  // Shock-event frequency multipliers. WHOLE_LINE ('*') is the only key that
  // means anything for GL now — see ExpectedGlLossOptions.freqMultipliers.
  // DRAW ONLY, like risk control and for the same reason: a shock is a
  // realized event, not a repricing, so it must move the loss ratio rather
  // than cancel out of it.
  freqMultipliers?: Record<string, number>;
  // Shock-event SEVERITY multipliers, same key convention and the same
  // DRAW-ONLY rule. Applied through trendedMuGl's log-location shift, so a
  // severity shock and the severity trend are one mechanism.
  sevMultipliers?: Record<string, number>;
}

export interface GlGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCount: number;          // total claims generated this line-year
  maxOccurrenceGross: number;  // GL's shock signal: any occurrence > $1M (ruled J11) — occurrence == claim, so this is the largest single claim
}

export function generateGlClaims(inputs: GlGenerationInputs): GlGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kGl, gPool, riskControlEffectiveness } = inputs;
  const wholeLineMult = inputs.freqMultipliers?.[WHOLE_LINE] ?? 1;
  const severityShock = inputs.sevMultipliers?.[WHOLE_LINE] ?? 1;
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  let claimCount = 0;
  let maxOccurrenceGross = 0;

  for (const member of members) {
    // PER-MEMBER STREAMS, keyed on member.id — a pure function of
    // (seed, year, memberId), same discipline as WC and the same reason: the
    // marketplace generator draws for all 200 members, and a member's claim
    // history must not depend on who else is enrolled or on iteration order.
    // See scripts/diagnostics/enrolment-independence-check.ts.
    const freqRng = deriveSubRng(instanceSeed, yearNumber, `gl_freq:${member.id}`);
    const sevRng = deriveSubRng(instanceSeed, yearNumber, `gl_sev:${member.id}`);

    const rq = member.riskQuality;
    const theta = thetaGl(rq);
    const payroll = member.exposureByLine.GL ?? 0;
    const before = claims.length;

    if (payroll > 0) {
      // One frequency-noise draw per member-year, mean 1. With no
      // sub-coverages left, this is simply the line's own noise term.
      const epsilon = freqRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);
      const lambda = payroll * M.ratePer1M * theta * kGl * epsilon * gPool * rcFactor * wholeLineMult;

      if (lambda > 0) {
        const count = freqRng.poisson(lambda);
        if (count > 0) {
          // The RQ severity tilt applies to every claim this member draws
          // this year — computed once per member, not per claim, since RQ is
          // constant within a member-year.
          const weights = tiltedGlWeights(rq);
          for (let i = 0; i < count; i++) {
            const componentIdx = sevRng.categorical(weights);
            const component = GL_SEVERITY_COMPONENTS[componentIdx];
            // TRENDED TO THE ACCIDENT YEAR AND FROZEN. GL has no report lag, so
            // this is the only vintage the claim ever has. The shock rides the
            // same log-location shift.
            //
            // ⚠ CLAMPED TO THAT YEAR'S CEILING, AND THE CLAMP IS AFTER THE SHOCK, not
            // before. The cap is a ceiling on what a real claim can cost, so a
            // severity shock inflates the draw INTO the ceiling rather than
            // carrying it upward with them — which does mean a shock's realized
            // effect is slightly damped (#19's x1.1004 lands as x1.0957 on the
            // capped mean, a 0.43% relative shortfall). That is the correct
            // behaviour for a hard ceiling and is reported, not corrected.
            //
            // The matched analytic is expectedClaimSeverity, capped at the same
            // year's ceiling. It does NOT see severityShock, because severity shocks are
            // deliberately draw-only (a realized event must move the loss ratio
            // rather than cancel out of it) — so the matched-pair assertion in
            // gl-claim-check.ts holds at severityShock = 1, which is the basis it
            // is stated on.
            const grossUltimate = Math.min(
              sevRng.lognormal(trendedMuGl(component.mu, yearNumber, severityShock), component.sigma),
              glSeverityCap(yearNumber));

            // ⚠ THE INDEX IS THIS MEMBER'S OWN, NOT A COUNTER ACROSS THE LOOP.
            // It used to be `sequence`, incremented once per claim over the
            // WHOLE member list, so an id meant "the fifteenth claim of the
            // year" rather than "member 042's third claim". WC
            // (`wc-${y}-${id}-${component}-${n}`) and Property
            // (`PR-${y}-${id}-${i}`) were both already per-member; GL was the
            // odd one out.
            //
            // WHY IT MATTERED. The per-member RNG streams mean member 007 draws
            // the same claims with the same values whoever else enrolled — that
            // is enrolment-independence-check's guarantee. But the COUNT of
            // claims drawn before them was not stable, so a roster change
            // renamed every later member's claims without touching a value.
            //
            // AND SOMETHING DOWNSTREAM KEYS ON THE NAME NOW. isClaimClosed
            // hashes (gameId, claimId), so GL's closure draw — and through it
            // the payment split, paid-to-date and the workbook's Status column —
            // moved with the roster through the id alone. The check's own
            // comment used to excuse ids on the grounds that "no downstream
            // consumer keys on them across runs"; that stopped being true at
            // Stage 0 and this is what makes it true again.
            const occurrenceId = `gl-${yearNumber}-${member.id}-${i}`;
            const claimId = `${occurrenceId}-c1`;
            claims.push({
              id: claimId,
              occurrenceId,
              memberId: member.id,
              line: LINE,
              accidentYear: yearNumber,
              calendarYear,
              tier: component.key,
              status: 'open',
              reportedYear: yearNumber,
              grossUltimate,
              paidToDate: 0,
              caseReserve: grossUltimate,
            });
            occurrences.push({
              id: occurrenceId,
              line: LINE,
              memberId: member.id,
              memberIds: [member.id],
              accidentYear: yearNumber,
              calendarYear,
              region: member.region,
              isCatastrophe: false,
              claimIds: [claimId],
            });
            if (grossUltimate > maxOccurrenceGross) maxOccurrenceGross = grossUltimate;
          }
          claimCount += count;
        }
      }
    }

    const simulatedLoss = claims.slice(before).reduce((s, c) => s + c.grossUltimate, 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: payroll,
      riskQuality: rq,
      // PRICING basis, matching wcClaimEngine's memberLossResults: this figure is
      // what the member is charged against, not what the draw expects of them.
      expectedLoss: expectedGlGrossLossForPricing([member], { yearNumber, kGl }),
      // Dispersion is emergent (frequency x severity mixture), not a
      // per-member CV — same convention as the WC generator.
      coefficientOfVariation: 0,
      standardDeviation: 0,
      simulatedLoss,
    });
  }

  const grossUltimateLoss = claims.reduce((s, c) => s + c.grossUltimate, 0);
  return { claims, occurrences, grossUltimateLoss, memberLossResults, claimCount, maxOccurrenceGross };
}

// Exposed for the diagnostic harness: the exact internals the analytic uses,
// so harness checks integrate the same numbers rather than re-deriving them.
export const glInternals = {
  thetaGl,
  tiltedGlWeights,
  untiltedGlWeights,
  componentMean,
  expectedClaimSeverity,
};
