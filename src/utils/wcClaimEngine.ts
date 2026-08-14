// Workers' Compensation claim-level loss generator.
//
// Draws ONE loss amount per claim from a per-rating-group lognormal mixture,
// then a REPORT LAG. Replaces the four-tier structure (medical-only /
// temporary / permanent / catastrophic plus a separate presumption process)
// whose parameters were authored as priors and then fitted to each other.
//
// FOUR INVARIANTS THIS MODULE EXISTS TO HOLD
//
// 1. ONE BASIS FOR LOSSES AND PRICING (finding 6). generateWcClaims (the draw)
//    and the expectation below are written as a matched pair over the same
//    factors — same group rates, same theta, same mixture weights, same
//    component means, same region multipliers. The expectation differs from the
//    draw ONLY by taking E[member noise] = 1 and using analytic component
//    means. WC's purePremiumPer100 is derived from the expectation, so premium
//    and losses cannot drift onto different bases. Change a factor in one and
//    you must change it in the other.
//
// 2. TWO CHANNELS ARE DRAW-ONLY (finding 17). riskControlEffectiveness AND the
//    risk-quality SEVERITY TILT multiply the draw and are ABSENT from the
//    pricing expectation. Applying either to both sides would move premium and
//    losses together and cancel — exactly the no-op finding 17 identified for
//    loss trend. Keeping them one-sided is what makes risk control and risk
//    quality genuinely move the loss ratio.
//
//    ⚠ THE TILT IS NOT ABSENT FROM k_line. k_line's job is to normalise the
//    book's risk-quality MIX, so it must see every channel RQ acts on or the
//    held pure premium drifts as the roster changes. That is why there are TWO
//    named expectation wrappers below rather than one function with a boolean.
//
// 3. PURE PREMIUM IS HELD, k_line ADAPTS. The pick is derived once from the
//    neutral book (deriveNeutralPurePremiumPer100) and does not track the
//    roster; computeKLine does the per-year risk-quality-mix correction. Both
//    tracking enrolment would double-correct.
//
// 4. A CLAIM'S AMOUNT IS FIXED AT DRAW, AND THE LAG DOES NOT TREND IT.
//    Severity carries no trend at all in this model, so there is no dollar
//    vintage to track and no truncation to impose. That is not a simplification
//    for its own sake: trending severity over the lag would make
//    E[(1 + r)^lag] over an unbounded lognormal DIVERGENT, which is precisely
//    why the retired presumption process had to bound its lag at 40 years. The
//    severity fit stays exactly as fitted.

import type {
  Claim,
  CoverageLine,
  Member,
  MemberLossResult,
  Occurrence,
  Region,
  WcUnreportedClaim,
} from '../types/simulation';
import { deriveSubRng, type SeededRandom } from './random';
import { lognormalParams } from './claimMath';
import {
  WC_LOSS_MODEL,
  WC_RATING_GROUPS,
  WC_SEVERITY_COMPONENTS,
  type WcComponentKey,
  type WcRatingGroup,
} from '../data/defaultAssumptions';
import { shockFactorFor } from './shockEffects';

const M = WC_LOSS_MODEL;
const LINE: CoverageLine = 'WC';
const NEUTRAL_RQ = 5;

// --- small shared helpers ---------------------------------------------------

// A member's rating group. STORED on the member, never derived — see
// WC_HIGH_SAFETY_CITIES for why deriving it from WC_CLASS_MIX is impossible.
// Throws rather than defaulting: a member with no group would silently generate
// no WC claims at all, which is the kind of hole that reads as a calibration
// drift months later.
export function ratingGroupOf(member: Member): WcRatingGroup {
  const g = member.wcRatingGroup;
  if (!g) {
    throw new Error(
      `member '${member.id}' (${member.name}) has no wcRatingGroup. It is a STORED attribute assigned `
      + `in memberCatalog.ts and cannot be derived — see WC_HIGH_SAFETY_CITIES.`,
    );
  }
  return g;
}

// Keyed lookup over the roster's authored Region. Mean-neutral by construction,
// so region shifts the distribution of severity across members without moving
// the book's expected loss.
export function regionMultiplier(region: Region): number {
  return M.regionMultiplier[region] ?? 1;
}

// Risk-quality frequency factor. RQ 10 (best) draws fewer claims, RQ 1 more.
function thetaWc(riskQuality: number): number {
  return Math.exp(-M.rqFrequencyBeta * (riskQuality - NEUTRAL_RQ));
}

// Safety improves ~1.5%/yr. Live Year 1 is the reference (factor 1.0); the
// pre-game years sit slightly above 1 — the past was more dangerous.
function frequencyTrend(yearNumber: number): number {
  return Math.pow(1 + M.frequencyTrendPerYear, yearNumber - 1);
}

// Mean of one mixture component. exp(mu + sigma^2 / 2).
export function componentMean(key: WcComponentKey): number {
  const c = WC_SEVERITY_COMPONENTS[key];
  return Math.exp(c.mu + (c.sigma * c.sigma) / 2);
}

// THE RISK-QUALITY SEVERITY TILT. Multiplies the HEAVY component's weight and
// renormalises the others, preserving their ratio to each other:
//
//   w_heavy' = clamp(w_heavy x exp(-rqSeverityBeta x (RQ - 5)))
//   scale    = (1 - w_heavy') / (sum of the other weights at group level)
//
// Returns weights in the group's own mix order. At RQ 5 this is the identity,
// so the neutral book is untouched.
//
// ⚠ DRAW AND k_line ONLY — never the pricing expectation. See invariant 2.
export function tiltedWeights(group: WcRatingGroup, riskQuality: number, params = M): number[] {
  const g = params.ratingGroups[group];
  const factor = Math.exp(-params.rqSeverityBeta * (riskQuality - NEUTRAL_RQ));
  const heavyIndex = g.mix.findIndex(m => m.component === g.heavyComponent);
  if (heavyIndex < 0) {
    throw new Error(`rating group '${group}' declares heavyComponent '${g.heavyComponent}', which is not in its mix`);
  }
  const baseHeavy = g.mix[heavyIndex].weight;
  // The clamp must exist even though it should not bind: the largest case is
  // High Safety at 0.4113 x 1.271 = 0.5228. 0.999 rather than 1.0 so the other
  // components keep a positive weight and `scale` stays finite.
  const tiltedHeavy = Math.min(baseHeavy * factor, 0.999);
  const otherTotal = g.mix.reduce((s, m, i) => (i === heavyIndex ? s : s + m.weight), 0);
  const scale = otherTotal > 0 ? (1 - tiltedHeavy) / otherTotal : 0;
  return g.mix.map((m, i) => (i === heavyIndex ? tiltedHeavy : m.weight * scale));
}

// Group weights with NO tilt — the pricing basis.
function groupWeights(group: WcRatingGroup, params = M): number[] {
  return params.ratingGroups[group].mix.map(m => m.weight);
}

// Expected severity of one claim from this group, over its mixture.
// `weights` is passed in so the caller decides tilted vs untilted rather than
// this function guessing — the same reason the two expectation wrappers exist.
export function expectedClaimSeverity(
  group: WcRatingGroup,
  weights: number[],
  regionMult: number,
  params = M,
): number {
  const mix = params.ratingGroups[group].mix;
  let total = 0;
  for (let i = 0; i < mix.length; i++) total += weights[i] * componentMean(mix[i].component);
  return total * regionMult;
}

// --- report lag --------------------------------------------------------------

// lag = round(1 + lognormal(mean, cv)), in whole years, always >= 1.
// Drawn ONLY for claims that came up delayed, so an undelayed claim consumes no
// lag randomness at all.
function drawReportLag(rng: SeededRandom, params = M): number {
  const { mu, sigma } = lognormalParams(params.reportLag.meanYears, params.reportLag.cv);
  return Math.max(1, Math.round(1 + rng.lognormal(mu, sigma)));
}

// --- exported: analytic expectation ------------------------------------------

export interface ExpectedWcLossOptions {
  // Force every member to this risk quality (used for the neutral book and for
  // k_line's numerator). Omit to use each member's actual risk quality.
  riskQualityOverride?: number;
  kLine?: number;        // default 1
  yearNumber?: number;   // default 1 (frequency trend factor 1.0)
  // Shock component-frequency multipliers, for MEASURING a shock's expected
  // cost — never for pricing. The difference between this expectation with and
  // without them IS the analytic expected addition.
  componentFreqMultipliers?: Record<string, number>;
}

// WHICH RISK-QUALITY CHANNELS THE EXPECTATION SEES.
//
//   'pricing'  frequency theta only. The severity tilt is draw-only
//              (invariant 2), so including it here would move premium and
//              losses together and cancel.
//   'kLine'    BOTH channels. k_line normalises the book's risk-quality mix,
//              so it has to see everything RQ does or the held pure premium
//              drifts as the roster changes.
//
// NO DEFAULT, and two named wrappers below rather than a boolean parameter:
// the call site should read its own intent. `expectedWcGrossLoss(members,
// true)` does not.
type WcLossBasis = 'pricing' | 'kLine';

function expectedWcGrossLossCore(
  members: Member[],
  basis: WcLossBasis,
  options: ExpectedWcLossOptions,
): number {
  const params = M;
  const rqOverride = options.riskQualityOverride;
  const kLine = options.kLine ?? 1;
  const trend = frequencyTrend(options.yearNumber ?? 1);

  let total = 0;
  for (const member of members) {
    const payroll = member.exposureByLine.WC ?? 0;
    if (payroll <= 0) continue;
    const rq = rqOverride ?? member.riskQuality;
    const group = ratingGroupOf(member);
    const g = params.ratingGroups[group];
    const regionMult = regionMultiplier(member.region);
    const lambda = payroll * g.ratePer1M * thetaWc(rq) * kLine * trend;
    const weights = basis === 'kLine' ? tiltedWeights(group, rq, params) : groupWeights(group, params);

    for (let i = 0; i < g.mix.length; i++) {
      let componentLambda = lambda * weights[i];
      if (options.componentFreqMultipliers) {
        componentLambda *= shockFactorFor(options.componentFreqMultipliers, g.mix[i].component);
      }
      total += componentLambda * componentMean(g.mix[i].component) * regionMult;
    }
  }
  return total;
}

// The analytic expected GROSS loss for PRICING. Frequency theta only — see the
// WcLossBasis comment. This is what purePremiumPer100 and every displayed
// expected loss derive from.
export function expectedWcGrossLossForPricing(members: Member[], options: ExpectedWcLossOptions = {}): number {
  return expectedWcGrossLossCore(members, 'pricing', options);
}

// The analytic expected GROSS loss on the k_line basis — BOTH risk-quality
// channels. Only computeKLine should need this; it is exported so the
// diagnostic can assert the two bases differ in the direction expected.
export function expectedWcGrossLossForKLine(members: Member[], options: ExpectedWcLossOptions = {}): number {
  return expectedWcGrossLossCore(members, 'kLine', options);
}

// --- exported: k_line ---------------------------------------------------------

// The risk-quality-mix normaliser: expected loss if the enrolled book were all
// at neutral risk quality, over expected loss at its actual mix. Applied to
// lambda so that changing WHO is enrolled doesn't drift the pool's aggregate
// expected loss away from the held pick.
//
// BOTH SIDES USE THE k_line BASIS, so the correction covers frequency theta AND
// the severity tilt. At neutral RQ the tilt is the identity, so the numerator is
// unaffected by it and the ratio measures exactly the mix effect.
export function computeKLine(members: Member[]): number {
  const neutral = expectedWcGrossLossForKLine(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedWcGrossLossForKLine(members, {});
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// --- exported: the held neutral pure premium ----------------------------------

// WC's purePremiumPer100, derived ONCE from the full canonical roster at neutral
// risk quality and then HELD. Expressed per $100 of payroll, matching the
// engine's expectedLoss = exposure x PP x 10,000.
export function deriveNeutralPurePremiumPer100(fullRoster: Member[]): number {
  const expected = expectedWcGrossLossForPricing(fullRoster, {
    riskQualityOverride: NEUTRAL_RQ,
    kLine: 1,
    yearNumber: 1,
  });
  const payrollUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.WC ?? 0), 0) * 10_000;
  if (!(payrollUnits > 0)) return 0;
  return expected / payrollUnits;
}

// --- exported: the generator ---------------------------------------------------

export interface WcGenerationInputs {
  members: Member[];          // the book to generate for
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kLine: number;
  riskControlEffectiveness: number; // DRAW ONLY — see invariant 2
  // Claims from the unreported inventory whose reportYear is THIS year. Passed
  // in rather than looked up so the generator stays pure, and materialised HERE
  // rather than by the caller so claim construction lives in exactly one place.
  //
  // ⚠ THE CALLER MUST HAVE FILTERED THESE. This function does not check
  // reportYear; it emits every entry it is given.
  emerging?: WcUnreportedClaim[];
  // Claims a shock event injects this year, each with an EXPLICIT AMOUNT.
  injections?: { count: number; amount: number; accidentYearOffset?: number }[];
  // Current-horizon shock multipliers on a COMPONENT'S ARRIVAL RATE. Keys are
  // component names ('large', ...) or '*' for every component. DRAW ONLY.
  componentFreqMultipliers?: Record<string, number>;
}

export interface WcGenerationResult {
  // Claims REPORTED this calendar year: those from this accident year that were
  // not delayed, plus those emerging from prior accident years. Their
  // `accidentYear` fields therefore are NOT all equal to yearNumber — that is
  // the dual-booking convention, not a bug.
  claims: Claim[];
  occurrences: Occurrence[];
  // Sum of `claims` above — the CALENDAR-year reported loss, which is what the
  // income statement recognises.
  grossUltimateLoss: number;
  // The slice of grossUltimateLoss belonging to THIS accident year. This is the
  // figure the chain-ladder provision applies its LDF to.
  currentAccidentYearGross: number;
  // The slice belonging to PRIOR accident years — recognised now, attributed
  // back. Feeds prior-year development.
  emergedGross: number;
  // Drawn this year but NOT reported this year. The caller adds these to the
  // inventory; they are not in `claims`.
  newlyDelayed: WcUnreportedClaim[];
  memberLossResults: MemberLossResult[];
  claimCountsByGroup: Record<string, number>;
  claimCountsByComponent: Record<string, number>;
  // Count of claims drawn this accident year that were deferred, and their
  // dollars — reported by the diagnostic, not used in accounting.
  delayedCount: number;
  delayedGross: number;
  // One entry per requested injection, in the same order.
  injectionResults: { count: number; gross: number }[];
}

export function generateWcClaims(inputs: WcGenerationInputs): WcGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kLine, riskControlEffectiveness } = inputs;
  const params = M;
  const componentFreqMultipliers = inputs.componentFreqMultipliers;

  const trend = frequencyTrend(yearNumber);
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  const newlyDelayed: WcUnreportedClaim[] = [];
  const claimCountsByGroup: Record<string, number> = {};
  const claimCountsByComponent: Record<string, number> = {};
  for (const g of WC_RATING_GROUPS) claimCountsByGroup[g] = 0;
  for (const c of Object.keys(WC_SEVERITY_COMPONENTS)) claimCountsByComponent[c] = 0;

  let currentAccidentYearGross = 0;
  let emergedGross = 0;
  let delayedCount = 0;
  let delayedGross = 0;

  // Emit one claim + its occurrence. WC emits exactly ONE claim per occurrence,
  // which is what makes the per-occurrence tower's layer arithmetic exact at
  // claim level.
  const emit = (
    id: string,
    memberId: string,
    region: Region,
    ratingGroup: WcRatingGroup,
    component: WcComponentKey | 'injected',
    amount: number,
    accidentYear: number,
    reportedYear: number,
  ) => {
    const occurrenceId = `wc-occ-${id}`;
    occurrences.push({
      id: occurrenceId,
      line: LINE,
      memberId,
      memberIds: [memberId],
      accidentYear,
      calendarYear,
      region,
      // WC injuries are individual events; a shared catastrophe grouping is a
      // Property concept and stays false here.
      isCatastrophe: false,
      claimIds: [id],
    });
    claims.push({
      id,
      occurrenceId,
      memberId,
      line: LINE,
      accidentYear,
      calendarYear,
      // The mixture component replaces the retired tier. Kept on the field
      // named `tier` so the claims export, the tower and every count-by-type
      // readout keep working against one vocabulary rather than two.
      tier: component,
      ratingClass: ratingGroup,
      status: 'open',
      reportedYear,
      grossUltimate: amount,
      paidToDate: 0,
      caseReserve: amount,
    });
  };

  for (const member of members) {
    // PER-MEMBER STREAMS, KEYED ON member.id. deriveSubRng hashes the whole
    // purpose string, so the key space is free.
    //
    // WHY NOT ONE STREAM PER YEAR consumed in member order: the marketplace
    // generator draws for all 200 members, and a member's claim history must not
    // depend on WHO ELSE is enrolled or on iteration order. Keying per member
    // makes each member's draws a pure function of (seed, year, memberId) —
    // asserted in scripts/diagnostics/enrolment-independence-check.ts.
    const freqRng = deriveSubRng(instanceSeed, yearNumber, `wc_freq:${member.id}`);
    const sevRng = deriveSubRng(instanceSeed, yearNumber, `wc_sev:${member.id}`);
    const lagRng = deriveSubRng(instanceSeed, yearNumber, `wc_lag:${member.id}`);

    const payroll = member.exposureByLine.WC ?? 0;
    const rq = member.riskQuality;
    const group = ratingGroupOf(member);
    const g = params.ratingGroups[group];
    const regionMult = regionMultiplier(member.region);
    const before = claims.length;
    let memberDelayed = 0;

    if (payroll > 0) {
      // Per member-year noise, mean 1. NO POOL FACTOR — it was removed from WC
      // (see WC_LOSS_MODEL.poolYearFactor); the pool-level draw still happens for
      // GL, and WC simply does not read it.
      const epsilon = freqRng.gamma(params.memberFrequencyNoise.shape, params.memberFrequencyNoise.scale);
      const lambda = payroll * g.ratePer1M * thetaWc(rq) * kLine * trend * epsilon * rcFactor;
      const weights = tiltedWeights(group, rq, params);

      // ⚠ POISSON THINNING: one Poisson draw PER COMPONENT at rate
      // lambda x w_i x k_i, rather than one Poisson for the total followed by a
      // multinomial assignment. Absent a shock the two are distributionally
      // IDENTICAL, so this is not a behaviour change — but it is what makes a
      // component-frequency shock expressible without touching the weights.
      //
      // AND THAT MATTERS: raising a component's WEIGHT would force the others
      // DOWN to keep the mix summing to 1, so a presumption-style expansion of
      // severe claims would make ordinary sprained backs RARER. Under thinning
      // that mistake cannot be written.
      for (let i = 0; i < g.mix.length; i++) {
        const componentKey = g.mix[i].component;
        let componentLambda = lambda * weights[i];
        if (componentFreqMultipliers) {
          componentLambda *= shockFactorFor(componentFreqMultipliers, componentKey);
        }
        const count = freqRng.poisson(componentLambda);
        if (count <= 0) continue;
        claimCountsByGroup[group] += count;
        claimCountsByComponent[componentKey] += count;

        const spec = WC_SEVERITY_COMPONENTS[componentKey];
        for (let n = 0; n < count; n++) {
          // Severity: a single amount, no legs, no trend, no vintage.
          const amount = sevRng.lognormal(spec.mu, spec.sigma) * regionMult;
          // Report lag: drawn AFTER severity and INDEPENDENT of it. The only
          // coupling between the two is that p_delayed differs by component,
          // which is what makes the inventory dollar-weighted.
          const delayed = lagRng.next() < spec.pDelayed;
          const id = `wc-${yearNumber}-${member.id}-${componentKey}-${n}`;
          if (delayed) {
            const reportYear = yearNumber + drawReportLag(lagRng, params);
            newlyDelayed.push({
              id,
              memberId: member.id,
              region: member.region,
              ratingGroup: group,
              component: componentKey,
              accidentYear: yearNumber,
              reportYear,
              amount,
            });
            delayedCount += 1;
            delayedGross += amount;
            memberDelayed += amount;
          } else {
            emit(id, member.id, member.region, group, componentKey, amount, yearNumber, yearNumber);
            currentAccidentYearGross += amount;
          }
        }
      }
    }

    const reportedThisYear = claims.slice(before).reduce((s, c) => s + c.grossUltimate, 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: payroll,
      riskQuality: rq,
      expectedLoss: expectedWcGrossLossForPricing([member], { kLine, yearNumber }),
      // Not modelled per member: dispersion is an emergent property of frequency
      // x mixture, not a single per-member CV.
      coefficientOfVariation: 0,
      standardDeviation: 0,
      // REPORTED-BASIS, matching grossUltimateLoss: what this member's claims
      // cost the pool in THIS calendar year. Claims deferred to a later year are
      // deliberately excluded — they are not yet known, and an underwriting
      // screen reading loss history must see what a real one would see.
      // Emerging prior-year claims are added below, after they are emitted.
      simulatedLoss: reportedThisYear,
    });
    void memberDelayed;
  }

  // --- claims emerging from the unreported inventory --------------------------
  //
  // Drawn in an earlier accident year, reported now. They keep their ORIGINAL
  // id, member, region, group, component and amount — the record is replayed,
  // not re-drawn, which is what makes a retroactive shock able to act on the
  // inventory without history silently restating itself.
  const byMember = new Map(memberLossResults.map(r => [r.memberId, r]));
  for (const u of inputs.emerging ?? []) {
    emit(u.id, u.memberId, u.region, u.ratingGroup, u.component, u.amount, u.accidentYear, yearNumber);
    emergedGross += u.amount;
    claimCountsByGroup[u.ratingGroup] = (claimCountsByGroup[u.ratingGroup] ?? 0) + 1;
    claimCountsByComponent[u.component] = (claimCountsByComponent[u.component] ?? 0) + 1;
    const r = byMember.get(u.memberId);
    if (r) r.simulatedLoss += u.amount;
  }

  // --- shock injections ---------------------------------------------------------
  //
  // Emitted through the SAME `emit` closure the natural draws use, so an
  // injected claim is indistinguishable from a drawn one.
  //
  // ⚠ AN INJECTION CARRIES AN EXPLICIT AMOUNT, and that is deliberate. Injecting
  // "one claim of component `large`" and letting it draw would produce its MEAN
  // of $96,529 — against the retired catastrophic tier's $9.0M, which is 93x
  // smaller and would silently gut the event. $9.0M is component `large`'s
  // 99.95th percentile, not its mean. An instructor-triggered event wants a
  // reproducible amount, not a tail draw.
  //
  // ITS OWN RNG STREAM ('wc_inject'), so natural claims are bit-identical whether
  // or not anything is injected.
  const injectionResults: { count: number; gross: number }[] = [];
  if (inputs.injections?.length) {
    const injRng = deriveSubRng(instanceSeed, yearNumber, 'wc_inject');

    // WHO IT HAPPENS TO, drawn from the NATURAL INCIDENCE of severe claims:
    // payroll x group rate x the group's heavy-component weight. An injected
    // event lands where such an event actually lands, rather than on an
    // arbitrary or worst-case member.
    const targets: { member: Member; group: WcRatingGroup; weight: number }[] = [];
    let totalWeight = 0;
    for (const member of members) {
      const payroll = member.exposureByLine.WC ?? 0;
      if (payroll <= 0) continue;
      const group = ratingGroupOf(member);
      const g = params.ratingGroups[group];
      const heavy = g.mix.find(m => m.component === g.heavyComponent);
      const weight = payroll * g.ratePer1M * (heavy?.weight ?? 0);
      if (weight > 0) { targets.push({ member, group, weight }); totalWeight += weight; }
    }

    const injectedByMember = new Map<string, number>();
    let injSeq = 0;
    for (const injection of inputs.injections) {
      if (!(injection.amount > 0)) {
        throw new Error(`WC claim injection requires a positive explicit amount; got ${injection.amount}`);
      }
      let count = 0;
      let gross = 0;
      for (let i = 0; i < injection.count && totalWeight > 0; i++) {
        let pick = targets[targets.length - 1];
        let u = injRng.next() * totalWeight;
        for (const t of targets) { u -= t.weight; if (u <= 0) { pick = t; break; } }

        // A BACKDATED accidentYear is how a RETROACTIVE event adds claims that
        // were not compensable when they happened. It is a different mechanism
        // from revising the existing inventory (which makes known-but-unreported
        // claims cost more) and the two must not be conflated: this one adds
        // claims, that one reprices them.
        const accidentYear = yearNumber + (injection.accidentYearOffset ?? 0);
        injSeq += 1;
        const id = `wc-inject-${yearNumber}-${injSeq}`;
        emit(id, pick.member.id, pick.member.region, pick.group, 'injected', injection.amount, accidentYear, yearNumber);
        if (accidentYear === yearNumber) currentAccidentYearGross += injection.amount;
        else emergedGross += injection.amount;
        claimCountsByGroup[pick.group] += 1;
        injectedByMember.set(pick.member.id, (injectedByMember.get(pick.member.id) ?? 0) + injection.amount);
        count += 1;
        gross += injection.amount;
      }
      injectionResults.push({ count, gross });
    }

    for (const result of memberLossResults) {
      const added = injectedByMember.get(result.memberId);
      if (added) result.simulatedLoss += added;
    }
  }

  const grossUltimateLoss = claims.reduce((s, c) => s + c.grossUltimate, 0);
  return {
    claims,
    occurrences,
    grossUltimateLoss,
    currentAccidentYearGross,
    emergedGross,
    newlyDelayed,
    memberLossResults,
    claimCountsByGroup,
    claimCountsByComponent,
    delayedCount,
    delayedGross,
    injectionResults,
  };
}
