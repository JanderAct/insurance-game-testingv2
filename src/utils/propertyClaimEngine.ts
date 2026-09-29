// PROPERTY claim generator — FITTED to the pool's own nine years of claims.
//
// ===========================================================================
// WHAT THIS REPLACED, AND WHY THE OLD ONE LOOKED FINE.
//
// The retired design drew ~112 claims a year at a $190,179 mean, from a
// per-LOCATION frequency and a severity of damageRatio x the hit location's
// TIV. The fit says 15.5 claims a year at $435,254: eleven times too many
// claims at 44% of the size. The AAL therefore landed within a factor of three
// BY ACCIDENT, because only the PRODUCT was ever anchored and the two factors
// were free to be wrong in opposite directions.
//
// That is finding 37's defect in a different line: a product can be right
// while both of its factors are wrong, and only fitting them separately finds
// it. The lesson generalises — anchor factors, not products.
//
// WHAT WENT WITH IT:
//   - the per-location frequency basis (frequency is now per $1M of TIV)
//   - damageRatio x locationTiv severity (now a free-standing mixture)
//   - the location schedule, primary-asset chopping and the insured-value cap
//     they produced — severity no longer references a location at all
//   - the separate WEATHER band. Weather is 21% of the non-cat book and IS IN
//     the mixture: baking it in moves the annual CV by 0.02 (0.26 -> 0.24),
//     which does not buy a 345-line event/zone/footprint simulator.
//   - the retired CAT band. ⚠ A NEW ONE IS BACK — see "THE CATASTROPHE BAND"
//     in the generator below and PROPERTY_CAT_MODEL. It is not the retired
//     design: one regional event process with a fixed loss per member hit,
//     priced exactly, rather than per-peril hazard tables and drawn intensities.
//
// ⚠ SEVERITY IS NO LONGER BOUNDED BY INSURED VALUE. The old structure capped
// each claim at its location's TIV by construction. A free-standing mixture has
// no such bound, which is why severityCap exists and why it is not optional —
// see PROPERTY_LOSS_MODEL. Do not reintroduce a location cap on top: the
// mixture was fitted to claim AMOUNTS, which already embody whatever real
// insured-value limits applied.
// ===========================================================================

import type { Claim, CoverageLine, Member, MemberLossResult, Occurrence, Region } from '../types/simulation';
import { deriveSubRng } from './random';
import { PROPERTY_CAT_MODEL, PROPERTY_LOSS_MODEL } from '../data/defaultAssumptions';
import { EXPERIENCE_SPLIT_POINT } from './memberLossHistory';
import { CAT_REGIONS, catLossIfHit, expectedPropertyCatLoss, memberExpectedCatLoss } from './propertyCatastrophe';

const M = PROPERTY_LOSS_MODEL;
const LINE: CoverageLine = 'Property';
// Exported for the same reason as WC's — see the note there.
export const NEUTRAL_RQ = 5;
// The attritional band's tier label, kept so Claim.tier stays populated and
// the claims export keeps a stable column.
const BAND = 'property';
// The catastrophe band's. A second label now that a second band exists — the
// claims export and the tower both need to tell a cat claim from an
// attritional one, and Occurrence.isCatastrophe is the flag the tower reads.
export const CAT_BAND = 'cat';

// Risk quality scales the Poisson mean. Neutral RQ 5 is the reference, so a
// neutral book reproduces the fitted frequency exactly.
function thetaFrequency(riskQuality: number): number {
  const rq = Math.max(1, Math.min(10, riskQuality));
  return 1 + M.rqFrequencyBeta * (NEUTRAL_RQ - rq);
}

// Risk quality scales severity MULTIPLICATIVELY, by shifting every component's
// location parameter by log(factor). That moves the whole mixture and leaves
// its shape — the weights and sigmas — untouched, which is what keeps the
// fitted tail intact under an RQ the fit never saw.
function severityFactor(riskQuality: number): number {
  const rq = Math.max(1, Math.min(10, riskQuality));
  return 1 + M.rqSeverityBeta * (NEUTRAL_RQ - rq);
}

// ⚠ PROPERTY DOES NOT APPLY AN ACCIDENT-YEAR -> SETTLEMENT TREND, and it is
// the only line that does not. This is a property of the FIT, not a
// simplification.
//
// ⚠ THE SENTENCE THAT STOOD HERE WAS ALREADY FALSE WHEN IT WAS WRITTEN. It read
// "WC and GL parameterise severity at ACCIDENT-year level and multiply by
// patternTrendFactor to reach settlement dollars." WC stopped calling
// patternTrendFactor at 3181b18 — the same commit this comment came in with —
// and GL never called it at all. Neither line reaches settlement dollars by any
// route; both trend severity to an ACCIDENT-year level and stop there.
//
// The conclusion below is unaffected and still correct: Property's mixture was fitted
// to claim AMOUNTS ALREADY TRENDED TO 2024 — that is, to what those claims
// actually cost when settled. Multiplying again would apply the settlement lag
// twice.
//
// Measured, because the size is small enough to have been shrugged off: the
// factor is 1.04^0.35 = 1.013822 on a 70/25/5 pattern, so applying it makes the
// generator draw 1.35% above the price it is funded at. Small, but it is
// finding 37's defect exactly — a factor in the DRAW that is not in the PRICE —
// and the fact that it is 1.35% rather than 35% is what would have kept it
// hidden.
//
// severityTrendPerYear and payoutPattern both stay live: the PATTERN still
// governs cash timing (70/25/5 over three years), and the trend rate is still
// the right number should an accident-year parameterisation ever replace this
// one. Neither is dead; only the multiplication is gone.
const PAYOUT_TREND_FACTOR = 1;

// --- the fitted severity distribution ---------------------------------------

// Standard normal CDF via Abramowitz & Stegun 7.1.26 — accurate to ~1e-7,
// which is well inside what a capped first and second moment need here.
function normCdf(z: number): number {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return 0.5 * (1 + s * (1 - poly * Math.exp(-x * x)));
}

// E[min(X, cap)^k] for one lognormal component, in CLOSED FORM.
//
// ⚠ CLOSED FORM ON PURPOSE, not quadrature. The top component has sigma 1.7417
// and the cap sits 3.4 sigma into its tail, which is precisely where a
// fixed-grid integration loses the mass that matters — the same trap the
// retired Beta severity carried a warning about, for the opposite reason.
//
//   E[X^k 1{X<=K}] = exp(k mu + k^2 s^2 / 2) Phi((lnK - mu - k s^2)/s)
//   plus K^k P(X > K) for the atom the cap creates at K.
function cappedComponentMoment(mu: number, sigma: number, k: number, cap: number): number {
  const lnK = Math.log(cap);
  const below = Math.exp(k * mu + (k * k * sigma * sigma) / 2) * normCdf((lnK - mu - k * sigma * sigma) / sigma);
  const atCap = Math.pow(cap, k) * (1 - normCdf((lnK - mu) / sigma));
  return below + atCap;
}

// PROPERTY'S SEVERITY TREND IS EXACTLY 1, AND THAT IS A REAL STATEMENT, not a
// placeholder. Property's severity does not trend at the DRAW: the construction-
// cost inflation in PROPERTY_LOSS_MODEL.severityTrendPerYear is consumed by the
// accident-year -> settlement dollar-vintage convention (PAYOUT_TREND_FACTOR),
// not by shifting mu each year. The fit found no second trending convention and
// adding one here would double-count it — the finding-37 trap the pure-premium
// comment in simulationEngine warns about.
//
// ⚠ THE RATE IS A NAMED CONSTANT AT ZERO, AND THE FUNCTION HAS THE SAME SHAPE
// AS wcSeverityTrend AND glSeverityTrend — including the year-1 floor — rather
// than being a stub that returns 1. That is the difference between "Property is
// special-cased" and "Property's rate happens to be zero": giving Property a
// draw-side severity trend is a one-constant edit here, and everything
// downstream (the ceiling, the capped moments, the draw) already routes through
// it. Read propertySeverityCap's header FIRST if you are about to make that
// edit — the tower is welded to Property's ceiling in three places.
//
// ⚠ NOT PROPERTY_LOSS_MODEL.severityTrendPerYear (0.04). That one is live and
// means something different: construction-cost inflation consumed by the
// accident-year -> settlement dollar-vintage convention. Setting THIS to 0.04
// would apply the same inflation twice — the finding-37 trap PAYOUT_TREND_FACTOR
// already documents. The two names are deliberately distinct.
export const PROPERTY_DRAW_SEVERITY_TREND_PER_YEAR = 0;

export function propertySeverityTrend(yearNumber: number): number {
  return Math.pow(1 + PROPERTY_DRAW_SEVERITY_TREND_PER_YEAR, Math.max(1, yearNumber) - 1);
}

// THE CEILING IN THAT YEAR'S DOLLARS — the Property member of the same family as
// wcSeverityCap and glSeverityCap. INERT TODAY because the trend above is 1.
//
// ⚠ IT CANNOT SIMPLY BE SWITCHED ON, AND THIS IS THE PART TO READ BEFORE GIVING
// PROPERTY A SEVERITY TREND. Property's ceiling is not only a severity
// statement — it is STRUCTURALLY WELDED TO THE REINSURANCE TOWER in two places
// that WC's and GL's are not:
//
//   reinsuranceTower.ts   the per-risk layer's limit is severityCap - perRiskRetention
//   propertyAggregate.ts  the aggregate threshold falls back to severityCap
//
// (There were three. TOWER_TOP.Property WAS severityCap until the cat band
// landed and needed the tower to reach $500M; it is PROPERTY_CAT_CEILING now,
// its own constant, and no longer moves with this one.)
//
// So a trending Property ceiling would silently grow the purchased tower and
// move an aggregate threshold, which is a reinsurance change wearing a severity
// change's clothes. Three further things assume year-invariance and would need
// a year threaded or a key added: PROPERTY_MEAN_SEVERITY (a module-level
// const), expectedPropertyGrossLoss (ExpectedPropertyLossOptions carries no
// yearNumber at all, deliberately — Property's expectation is year-blind
// today), and towerMoments' propertyBandCache (a single slot with no year
// key). property-claim-check.ts
// ASSERTS the invariance rather than trusting this comment, so switching the
// trend on fails loudly at exactly these seams instead of drifting.
export function propertySeverityCap(yearNumber: number): number {
  return M.severityCap * propertySeverityTrend(yearNumber);
}

// The capped mixture's k-th moment at a given severity scale factor. The
// factor enters as a shift of mu by log(factor), so it multiplies the k-th
// moment by factor^k only when the cap is absent — with the cap present the
// integral must be re-evaluated, which is why the factor is applied to mu here
// rather than to the result.
//
// ⚠ severityScale IS RISK QUALITY, NOT A YEAR, and the two are deliberately
// different in how they meet the ceiling. A high-RQ member genuinely draws
// larger claims against the SAME physical ceiling, so the cap does not scale
// with it — exactly as WC's cap does not scale with regionMult. `yearNumber`
// restates the whole distribution in later dollars, so the ceiling DOES move
// with it. Today that distinction costs nothing because Property's trend is 1;
// it is wired so it stays correct if that changes.
export function propertySeverityMoment(k: number, severityScale = 1, yearNumber = 1): number {
  const shift = Math.log(Math.max(severityScale, 1e-9));
  return M.severityMixture.reduce(
    (a, c) => a + c.weight * cappedComponentMoment(
      c.mu + shift, c.sigma, k, propertySeverityCap(yearNumber)),
    0,
  );
}

// Mean claim size at neutral risk quality — the figure the held pure premium
// is built from. Asserted against the brief's $435,254 by property-claim-check
// (`|PROPERTY_MEAN_SEVERITY - 435_254| < 500`).
//
// ⚠ THIS NAMED property-fit-check, WHICH ASSERTS NOTHING — it prints a scale
// analysis and exits 0 either way, and is now property-fit-report. The
// assertion is real and always was; it just lives in the other script. The
// name alone was enough to make three comments in this engine credit it.
export const PROPERTY_MEAN_SEVERITY = propertySeverityMoment(1, 1);

// --- analytic expectation (invariant 1) -------------------------------------

export interface ExpectedPropertyLossOptions {
  riskQualityOverride?: number;
  kPr?: number;
}

// Expected ATTRITIONAL loss for a book, in booked (settlement-trended) dollars —
// the fitted mixture's band alone, without the catastrophe band.
//
// THE IDENTITY. Frequency is per $1M of TIV and severity is independent of the
// member, so expected loss is exactly proportional to TIV:
//
//   E[loss] = TIV_$M x frequencyPer1mTiv x theta(rq) x E[severity | rq] x trend
//
// Simpler than the retired form, which needed the location count to cancel out
// of a per-location frequency times a per-location severity. Nothing cancels
// here because nothing was introduced that had to.
//
// ⚠ THE IDENTITY IS THE ATTRITIONAL BAND'S ONLY. The cat band's expected loss
// runs through primaryAssetShare and region, so it is NOT proportional to TIV,
// and neither is the total. property-claim-check asserts proportionality on
// this function, which is why it is kept separate rather than folded in.
export function expectedPropertyAttritionalLoss(
  members: Member[],
  options: ExpectedPropertyLossOptions = {},
): number {
  const kPr = options.kPr ?? 1;
  let total = 0;
  for (const member of members) {
    const tiv = member.exposureByLine.Property ?? 0;
    if (!(tiv > 0)) continue;
    const rq = options.riskQualityOverride ?? member.riskQuality;
    const lambda = tiv * M.frequencyPer1mTiv * thetaFrequency(rq) * kPr;
    total += lambda * propertySeverityMoment(1, severityFactor(rq));
  }
  return total;
}

// Expected GROSS loss for a book: the attritional band plus the catastrophe
// band. The cat term takes neither option — it has no risk-quality channel and
// kPr does not apply to it (see PROPERTY_CAT_MODEL's "what is not applied").
export function expectedPropertyGrossLoss(
  members: Member[],
  options: ExpectedPropertyLossOptions = {},
): number {
  return expectedPropertyAttritionalLoss(members, options) + expectedPropertyCatLoss(members);
}

// The roster/risk-quality mix correction, exactly as WC's k_line and GL's k_GL:
// the held pure premium is derived at NEUTRAL risk quality over the full
// roster, so a book whose actual RQ mix differs must be corrected back.
//
// ⚠ ATTRITIONAL ONLY. kPr multiplies the attritional frequency in the draw and
// nothing else, so the correction it carries must be solved on the band it is
// applied to. Solving it on the total would shrink it towards 1 by the cat
// share and leave the attritional draw off its own price.
export function computeKPr(members: Member[]): number {
  const neutral = expectedPropertyAttritionalLoss(members, { riskQualityOverride: NEUTRAL_RQ });
  const adjusted = expectedPropertyAttritionalLoss(members);
  if (!(adjusted > 0)) return 1;
  return neutral / adjusted;
}

// Pure premium per $100 of TIV, BY BAND, on a full roster at neutral risk
// quality. property-claim-check holds PROPERTY_PURE_PREMIUM_SPLIT against both
// halves and PROPERTY_HELD_PURE_PREMIUM_PER_100 against their sum.
export function deriveNeutralPropertyPurePremiumSplit(fullRoster: Member[]): { nonCat: number; cat: number } {
  const tivUnits = fullRoster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0) * 10_000;
  if (!(tivUnits > 0)) return { nonCat: 0, cat: 0 };
  return {
    nonCat: expectedPropertyAttritionalLoss(fullRoster, { riskQualityOverride: NEUTRAL_RQ, kPr: 1 }) / tivUnits,
    cat: expectedPropertyCatLoss(fullRoster) / tivUnits,
  };
}

// Pure premium per $100 of TIV — THE WHOLE PRICE, both bands.
//
// ⚠ THE CAT LOAD IS BACK IN, TOGETHER WITH THE LOSSES, which is the only way
// it was ever allowed back. For a while this function returned the non-cat
// figure alone, because the asserted 0.0247 load had been removed from a line
// that could not incur a catastrophe. The cat band now draws real events, so
// its derived load (0.0286) returns in the same commit — see
// PROPERTY_HELD_PURE_PREMIUM_PER_100.
export function deriveNeutralPropertyPurePremiumPer100(fullRoster: Member[]): number {
  const { nonCat, cat } = deriveNeutralPropertyPurePremiumSplit(fullRoster);
  return nonCat + cat;
}

// --- the generator ----------------------------------------------------------

export interface PropertyGenerationInputs {
  members: Member[];
  yearNumber: number;
  calendarYear: number;
  instanceSeed: number;
  kPr: number;
  riskControlEffectiveness: number; // DRAW ONLY
}

export interface PropertyGenerationResult {
  claims: Claim[];
  occurrences: Occurrence[];
  grossUltimateLoss: number;
  memberLossResults: MemberLossResult[];
  claimCount: number;
  maxClaimGross: number;   // per-risk signal: largest single ATTRITIONAL claim
  perRiskBreaches: number; // attritional claims exceeding the per-risk retention
  capBindings: number;     // claims that hit severityCap — should be very rare
  // THE CAT BAND, separately, so a harness can read it without re-deriving
  // which claims were cat. catEvents counts events DRAWN, including any that
  // struck a region and hit no enrolled member (those emit no occurrence).
  catEvents: number;
  catGrossLoss: number;
}

export function generatePropertyClaims(inputs: PropertyGenerationInputs): PropertyGenerationResult {
  const { members, yearNumber, calendarYear, instanceSeed, kPr, riskControlEffectiveness } = inputs;
  const rcFactor = Math.max(0, 1 - riskControlEffectiveness);

  // ⚠ ACCEPTED SIMPLIFICATION, RECORDED SINCE VEHICLES WERE FOLDED IN: rcFactor
  // discounts ONE frequency lambda that now generates both building and
  // vehicle claims indiscriminately. Property Mitigation (roofs, water
  // detection, wind bracing) cannot reduce a fleet's collision or theft
  // frequency — physically, it targets none of the auto share of this line —
  // but there is no separate auto/building split in this generator for the
  // discount to respect, so it applies uniformly today regardless. IF the
  // buildings-only frequency (2.81/$1B TIV) is still the building component
  // inside the vehicle-inclusive 5.01, vehicles are ~44% of frequency
  // ((5.01-2.81)/5.01) — a bigger share than "roughly a third", though both
  // are the same qualitative point: a substantial share of what this line now
  // generates is immune to the only program built to reduce it. Not fixed
  // here — fixing it needs a real auto/building split this generator does not
  // have.

  const claims: Claim[] = [];
  const occurrences: Occurrence[] = [];
  const memberLossResults: MemberLossResult[] = [];
  let grossUltimateLoss = 0;
  let claimCount = 0;
  let maxClaimGross = 0;
  let perRiskBreaches = 0;
  let capBindings = 0;

  // Cumulative mixture weights, built once. Weights are the fitted ones and
  // are assumed to sum to 1; the final component absorbs any rounding residue
  // by construction of the search below.
  const cumulative: number[] = [];
  let acc = 0;
  for (const c of M.severityMixture) { acc += c.weight; cumulative.push(acc); }

  // ==========================================================================
  // THE CATASTROPHE BAND — see PROPERTY_CAT_MODEL for the mechanism and the
  // ruling behind each parameter.
  //
  // ⚠ THE EVENTS ARE DRAWN BEFORE ANY MEMBER IS LOOKED AT, FROM A STREAM THAT
  // KNOWS NOTHING ABOUT THE BOOK. How many events, and which region each one
  // strikes, is a fact about the year, not about who enrolled: `pr_cat_event`
  // is keyed on the seed and year alone and the region weights are the
  // market's. Each member then decides its own hits from its own stream,
  // `pr_cat:<id>`, one uniform per event in event order whether or not the
  // event is in its region — so its draw count, and therefore its hits, depend
  // on the year's events and on nothing else. That is what keeps a member's cat
  // claims independent of every other enrolment decision, which the retired
  // weather band's shared within-event draws did not.
  //
  // Neither stream existed before, so no attritional draw moves: with no event
  // in a year the book's claims are bit-identical to the attritional-only
  // generator's.
  // ==========================================================================
  const eventRng = deriveSubRng(instanceSeed, yearNumber, 'pr_cat_event');
  const eventCount = eventRng.poisson(PROPERTY_CAT_MODEL.eventsPerYear);
  const eventRegions: Region[] = [];
  for (let e = 0; e < eventCount; e++) {
    const u = eventRng.next();
    let cum = 0;
    let region: Region = CAT_REGIONS[CAT_REGIONS.length - 1];
    for (const r of CAT_REGIONS) {
      cum += PROPERTY_CAT_MODEL.regionWeights[r as keyof typeof PROPERTY_CAT_MODEL.regionWeights];
      if (u < cum) { region = r; break; }
    }
    eventRegions.push(region);
  }
  // Per event, the claims it produced and whom it hit — assembled into ONE
  // occurrence per event after every member has drawn.
  const eventClaimIds: string[][] = eventRegions.map(() => []);
  const eventMemberIds: string[][] = eventRegions.map(() => []);
  let catGrossLoss = 0;

  for (const member of members) {
    // PER-MEMBER STREAMS, KEYED ON member.id — unchanged from the retired
    // generator and for the same reason. A member's claim history must not
    // depend on WHO ELSE is enrolled or on iteration order, or a prospect's
    // losses would move because of an enrolment decision made years earlier
    // and an underwriting screen would be incoherent. Asserted by
    // scripts/diagnostics/enrolment-independence-check.ts.
    //
    // The `pr_loc` stream is GONE with the location schedule. The remaining
    // three keep their labels, so a member's frequency and severity draws are
    // unchanged in derivation even though what they feed has changed.
    const freqRng = deriveSubRng(instanceSeed, yearNumber, `pr_freq:${member.id}`);
    const epsRng = deriveSubRng(instanceSeed, yearNumber, `pr_eps:${member.id}`);
    const sevRng = deriveSubRng(instanceSeed, yearNumber, `pr_sev:${member.id}`);

    const tiv = member.exposureByLine.Property ?? 0;
    let memberLoss = 0;
    // Where this member's claims start, so primaryActual below can read the
    // claims actually drawn for them rather than re-deriving from memberLoss.
    const beforeClaims = claims.length;

    if (tiv > 0) {
      // One eps per member-year, shared across that member's claims — the same
      // convention WC and GL use.
      const eps = epsRng.gamma(M.memberFrequencyNoise.shape, M.memberFrequencyNoise.scale);

      // ⚠ NO gPool. Property drew the shared pool factor under the aggregate
      // path; it does not now. gPool was the model's cross-line correlation and
      // WC already left it, so Property leaving means GL is the only line still
      // consuming it. That is a REDUCTION IN CROSS-LINE CORRELATION and it is
      // deliberate: a compound-Poisson book's year-to-year variation comes from
      // its own frequency and tail, and layering a shared multiplier on top
      // would double-count volatility the mixture already carries.
      const lambda = tiv * M.frequencyPer1mTiv * thetaFrequency(member.riskQuality) * eps * kPr * rcFactor;
      const count = freqRng.poisson(Math.max(0, lambda));
      const sevScale = severityFactor(member.riskQuality);

      for (let i = 0; i < count; i++) {
        // Component, then a lognormal draw from it, then the cap.
        const u = sevRng.next();
        let idx = 0;
        while (idx < cumulative.length - 1 && u > cumulative[idx]) idx++;
        const comp = M.severityMixture[idx];
        const raw = sevRng.lognormal(comp.mu + Math.log(sevScale), comp.sigma);
        // Already settlement dollars — see PAYOUT_TREND_FACTOR above.
        // THAT YEAR'S ceiling, wired like WC's and GL's; inert while
        // propertySeverityTrend is 1. See propertySeverityCap.
        const cap = propertySeverityCap(yearNumber);
        const gross = Math.min(raw, cap);
        if (raw > cap) capBindings++;

        const occurrenceId = `PR-${yearNumber}-${member.id}-${i}`;
        const claimId = `${occurrenceId}-c1`;
        claims.push({
          id: claimId,
          occurrenceId,
          memberId: member.id,
          line: LINE,
          accidentYear: yearNumber,
          calendarYear,
          tier: BAND,
          status: 'open',
          // Property damage is known the day it happens.
          reportedYear: yearNumber,
          grossUltimate: gross,
          paidToDate: 0,
          caseReserve: gross,
          paymentPattern: [...M.payoutPattern],
        });
        // One claim per occurrence — for the ATTRITIONAL band. The cat band
        // below is what makes one event own several claims.
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
          peril: BAND,
        });
        memberLoss += gross;
        grossUltimateLoss += gross;
        claimCount++;
        if (gross > maxClaimGross) maxClaimGross = gross;
        if (gross > M.perRiskRetention) perRiskBreaches++;
      }
    }

    // THIS MEMBER'S CAT HITS. A fixed loss when hit — no severity draw, no
    // cap, no kPr, no risk control; see PROPERTY_CAT_MODEL for why each is
    // absent. The claim joins the EVENT's occurrence, not one of its own.
    if (eventCount > 0) {
      const lossIfHit = catLossIfHit(member);
      const catRng = deriveSubRng(instanceSeed, yearNumber, `pr_cat:${member.id}`);
      for (let e = 0; e < eventCount; e++) {
        const u = catRng.next();
        if (!(lossIfHit > 0) || member.region !== eventRegions[e]) continue;
        if (u >= PROPERTY_CAT_MODEL.footprint) continue;
        const occurrenceId = `PR-${yearNumber}-CAT-${e}`;
        const claimId = `${occurrenceId}-${member.id}`;
        claims.push({
          id: claimId,
          occurrenceId,
          memberId: member.id,
          line: LINE,
          accidentYear: yearNumber,
          calendarYear,
          tier: CAT_BAND,
          status: 'open',
          reportedYear: yearNumber,
          grossUltimate: lossIfHit,
          paidToDate: 0,
          caseReserve: lossIfHit,
          paymentPattern: [...M.payoutPattern],
        });
        eventClaimIds[e].push(claimId);
        eventMemberIds[e].push(member.id);
        memberLoss += lossIfHit;
        grossUltimateLoss += lossIfHit;
        catGrossLoss += lossIfHit;
        claimCount++;
      }
    }

    // PER CLAIM, over the claims this member just generated. Property is not
    // RATED on experience (its measured primary-layer credibility is 0.000 —
    // see memberExperienceMod.ts), but the figure is recorded anyway so the
    // decision rests on a measurement that stays live rather than on a gap.
    const primaryLoss = claims.slice(beforeClaims)
      .reduce((s, c) => s + Math.min(c.grossUltimate, EXPERIENCE_SPLIT_POINT), 0);
    memberLossResults.push({
      memberId: member.id,
      memberName: member.name,
      exposure: tiv,
      riskQuality: member.riskQuality,
      // BOTH BANDS. The member's cat expectation is its own share of the
      // event process (events x P(its region) x footprint x loss-if-hit), which
      // is additive over members — nobody else's enrolment moves it.
      expectedLoss: expectedPropertyAttritionalLoss([member], { kPr }) + memberExpectedCatLoss(member),
      // THE MANUAL: same call, same k — risk quality alone overridden. The cat
      // term has no RQ channel, so it is the same on both.
      expectedLossAtManual: expectedPropertyAttritionalLoss(
        [member], { kPr, riskQualityOverride: NEUTRAL_RQ },
      ) + memberExpectedCatLoss(member),
      primaryLoss,
      coefficientOfVariation: 0,
      standardDeviation: 0,
      simulatedLoss: memberLoss,
    });
  }

  // ONE OCCURRENCE PER EVENT, with every hit member's claim in it — the unit the
  // cat layer attaches to. An event that hit nobody enrolled produced no claim
  // and emits no occurrence. memberId is set only when exactly one member was
  // hit: the Occurrence type makes it optional precisely so a multi-member
  // event cannot be silently attributed to one of them.
  eventRegions.forEach((region, e) => {
    if (eventClaimIds[e].length === 0) return;
    occurrences.push({
      id: `PR-${yearNumber}-CAT-${e}`,
      line: LINE,
      ...(eventMemberIds[e].length === 1 ? { memberId: eventMemberIds[e][0] } : {}),
      memberIds: eventMemberIds[e],
      accidentYear: yearNumber,
      calendarYear,
      region,
      isCatastrophe: true,
      claimIds: eventClaimIds[e],
      peril: CAT_BAND,
    });
  });

  return {
    claims,
    occurrences,
    grossUltimateLoss,
    memberLossResults,
    claimCount,
    maxClaimGross,
    perRiskBreaches,
    capBindings,
    catEvents: eventCount,
    catGrossLoss,
  };
}

export const propertyInternals = {
  payoutTrendFactor: PAYOUT_TREND_FACTOR,
  thetaFrequency,
  severityFactor,
  propertySeverityMoment,
  normCdf,
};
