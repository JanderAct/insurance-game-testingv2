// PROPERTY'S AGGREGATE STOP-LOSS — priced from the COMPOUND DISTRIBUTION
// (Panjer recursion), not the lognormal approximation WC's quoteAggregate uses.
//
// ============================================================================
// WHY NOT REUSE WC'S lognormalPartialMoment APPROACH.
//
// Measured directly (Monte Carlo, 200,000 simulated years, against a
// lognormal fit matched on mean and CV): the lognormal's error in E[ceded] is
// NOT a fixed bias a multiplier could correct — it is non-monotone and changes
// SIGN across the attachment range that matters here:
//   1.50x E[R]   -29.7%  (underpriced)
//   1.75x E[R]   -22.8%
//   2.00x E[R]   -15.4%
//   2.50x E[R]    +3.4%  (overpriced)
// A model whose error changes sign cannot be patched with a loading factor —
// there is no single correction that fixes both ends. WC's own aggregate very
// likely carries a smaller version of the same defect (WC's claim count is
// ~4x Property's, and the error shrinks as claim count grows), but fixing it
// is explicitly OUT OF SCOPE for this commit: it would move WC-solo's values
// and destroy the line-control isolation this commit's null test depends on.
// See scripts/diagnostics/property-tower-mc.ts for the measurement and a
// same-method estimate of WC's own exposure.
//
// PANJER RECURSION is the textbook alternative: given a frequency distribution
// in the (a, b, 0) class (Poisson, negative binomial, binomial) and a
// DISCRETIZED severity distribution, it builds the EXACT pmf of the compound
// sum via a recursion, rather than approximating its shape. No simulation is
// needed at runtime — the recursion is deterministic and fast enough to run on
// every render (see the UI's live "declining a layer repriced the aggregate
// immediately" requirement, same as WC's).
//
// ============================================================================
// THE MODEL, AND WHERE IT SIMPLIFIES RELATIVE TO THE TRUE GENERATOR.
//
// TRUE GENERATOR (propertyClaimEngine.ts): each member draws
// Poisson(tiv_i x frequencyPer1mTiv x theta(rq_i) x eps_i x kPr), eps_i ~
// Gamma(k, 1/k) INDEPENDENTLY PER MEMBER PER YEAR, then each of that member's
// claims draws from a mixture whose location is shifted by that member's own
// severityFactor(rq_i). Exact convolution of ~60 distinct per-member mixed-
// Poisson-severity processes has no closed form.
//
// WHAT THIS MODULE DOES INSTEAD, and why each simplification is small:
//
//   FREQUENCY: the total annual claim count is fit to a SINGLE negative
//   binomial by matching its first two moments to the true sum:
//     E[N]   = sum_i lambda_i                         (lambda_i at ACTUAL basis
//                                                       — real RQ, real kPr)
//     Var[N] = sum_i (lambda_i + lambda_i^2/k)         (each member's own
//                                                       Gamma-frailty variance;
//                                                       members are independent)
//   This is EXACT for the mean and variance; it assumes the shape of the sum
//   is well-approximated by a single NegBin, which is standard actuarial
//   practice for a sum of many small mixed-Poisson terms (no single member is
//   a large share of the book).
//
//   SEVERITY: discretized at NEUTRAL risk quality (severityFactor(5) = 1, the
//   same neutral basis retainedOccurrenceMoments and layerRiskMoments already
//   price the occurrence layer from — see towerMoments.ts's header on why
//   pricing stays off the actual RQ tilt). RQ varies severity by at most a few
//   percent per member (rqSeverityBeta = 0.04), so a book-average severity
//   shape is a minor approximation, not a structural one.
//
//   THE MEAN IS RESCALED to the caller's actual-basis expectedRetained after
//   the compound distribution is built (see quotePropertyAggregate), so the
//   modelled DOLLAR LEVEL is always exactly the engine's own E[R] — only the
//   distribution's SHAPE (CV, skew, discrete jumps from small claim counts)
//   comes from this module's own frequency/severity fit. This is the same
//   division WC's quoteAggregate uses (CV from neutral moments, E[R] from the
//   caller), extended from "one ratio" to "a whole distribution".
// ============================================================================

//
// ============================================================================
// ⚠ AND THE RETAINED LOSS IS TWO PROCESSES NOW, NOT ONE. With the cat band in,
// annual retained loss is
//
//   R = R_attritional + R_cat
//
// two compound distributions with structurally different frequency and
// severity. They are INDEPENDENT — the attritional draws and the cat draws come
// from disjoint streams and share no factor (measured correlation of the two
// annual totals: 0.0011) — so the distribution of R is the CONVOLUTION of the
// two, and that is how it is built:
//
//   R_attritional   the NegBin Panjer fit above, rescaled to its dollar level,
//                   then RE-BINNED onto the lattice by the same mean-preserving
//                   split every other lattice placement here uses
//   R_cat           EXACT: the event distribution of propertyCatastrophe.ts,
//                   mapped through Property's one layer, compounded by Panjer's
//                   Poisson recursion (exact for a Poisson count)
//
// The attritional re-bin is the ONLY approximation the cat band adds, and it
// is mean-preserving. Validated against an independent event simulation by
// scripts/diagnostics/property-cat-check.ts.
//
// ⚠ THE CONVOLUTION STOPS AT THE LAYER TOP, AND THAT IS EXACT, NOT A SHORTCUT.
// Every retained dollar at or above attachment + limit cedes the full limit, so
// the layer needs the distribution only BELOW its top plus the mass above it —
// and the mass above it is 1 minus the mass below. A convolution's first T
// outputs depend only on the first T inputs of each side, so truncating both
// at T changes nothing below T. That is what keeps a live re-quote in the
// low milliseconds instead of a 28,000 x 8,000 product.
// ============================================================================

import { PROPERTY_CAT_MODEL, PROPERTY_LOSS_MODEL } from '../data/defaultAssumptions';
import { AGG_LIMIT_MULTIPLE, REINSURANCE_TOWER, RISK_LOAD_LAMBDA } from '../data/reinsuranceTower';
import { normalCdf } from './claimMath';
import { propertyInternals } from './propertyClaimEngine';
import { PROPERTY_LATTICE_BIN, catAnnualRetainedPmf, catEventRetained } from './propertyCatastrophe';
import type { Member } from '../types/simulation';

const PM = PROPERTY_LOSS_MODEL;

// Discretization bin width.
//
// ⚠ THIS USED TO BE A CONVERGENCE PARAMETER AND IS NO LONGER ONE. The original
// discretisation was a naive CDF difference — bucket j held
// F(j*BIN) - F((j-1)*BIN) and that mass was placed at j*BIN, i.e. every claim
// was rounded UP to the next lattice point. The bias is ~BIN/2 per claim,
// which at $50k bins inflated the per-claim retained severity mean by 8.1%
// (measured: true E[min(X,$5M)] = $328,026 against a discretised $354,658).
// With ~33 claims a year that compounded into the annual mean, the rescale
// below then divided it out, and the correction landed on the SHAPE — where
// it was invisible in the mean but showed up as an ~18% understatement of
// E[ceded] at the higher attachment, which is exactly where the aggregate's
// value is thinnest and hardest to check.
//
// The fix is GERBER'S MEAN-PRESERVING (local moment matching) discretisation
// below, which is exact in the mean at ANY bin width — verified to float
// precision from $200k down to $2k bins. BIN is therefore now a
// speed/resolution choice for the CEDED integral alone, not an accuracy knob:
// the first moment is exact by construction and only the layer integral's
// bucket resolution depends on it. $25k gives 40 buckets per $1M against
// attachments rounded to whole $1M, and quotes in a few milliseconds, which
// the Decisions panel needs since it re-quotes live on every render.
//
// ⚠ SHARED WITH THE CAT BAND — read from propertyCatastrophe rather than
// restated, because the combined convolution needs one lattice for both sides.
const BIN = PROPERTY_LATTICE_BIN;
// Retained loss up to $200M/yr covers every playable scenario with wide margin
// (even fully declining the layer, ~37 claims/yr capped individually at the
// $75M severity cap does not realistically sum anywhere near this).
// ⚠ ATTRITIONAL RETAINED LOSS ONLY, now. The cat side is never built on this
// range — it is built to the layer top, and anything above the top is the tail
// mass, so a $500M event does not need this range to hold it.
const MAX_BINS = Math.round(200_000_000 / BIN);

// Neutral-RQ mixture CDF, F(x) = P(raw severity <= x). Retained only for the
// harness, which uses it to reconstruct the retired naive discretisation and
// demonstrate the bias this module no longer carries.
function neutralSeverityCdf(x: number): number {
  if (!(x > 0)) return 0;
  const lnX = Math.log(x);
  let f = 0;
  for (const c of PM.severityMixture) {
    f += c.weight * normalCdf((lnX - c.mu) / c.sigma);
  }
  return f;
}

// LIMITED EXPECTED VALUE, E[min(X, t)], for the neutral-RQ mixture, in closed
// form. This is the quantity mean-preserving discretisation is built from, and
// having it in closed form is what makes that discretisation exact rather than
// merely finer:
//   E[min(X,t)] = sum_c w_c ( exp(mu+s^2/2) Phi((ln t - mu - s^2)/s)
//                             + t (1 - Phi((ln t - mu)/s)) )
function limitedExpectedValue(t: number): number {
  if (!(t > 0)) return 0;
  const lnT = Math.log(t);
  let total = 0;
  for (const c of PM.severityMixture) {
    const below = Math.exp(c.mu + (c.sigma * c.sigma) / 2) * normalCdf((lnT - c.mu - c.sigma * c.sigma) / c.sigma);
    const atOrAbove = t * (1 - normalCdf((lnT - c.mu) / c.sigma));
    total += c.weight * (below + atOrAbove);
  }
  return total;
}

// GERBER'S MEAN-PRESERVING DISCRETISATION of min(raw severity, threshold).
//
//   f_0 = 1 - E[X ^ h] / h
//   f_j = (2 E[X ^ jh] - E[X ^ (j-1)h] - E[X ^ (j+1)h]) / h,   j >= 1
//
// where h = BIN and E[X ^ t] is the limited expected value above. The
// construction spreads each interval's mass across its two bounding lattice
// points in exactly the proportion that preserves the first moment, so
// E[discretised] == E[min(X, threshold)] identically — no rounding direction
// and no residual bias at any bin width.
//
// Returns index 0..J, INCLUDING f_0 (the mass at zero, which this method
// necessarily creates and the naive one did not). The Panjer recursion below
// carries the f_0 correction terms that make that valid.
//
// The top lattice point absorbs the remaining probability: raw severity at or
// above `threshold` retains exactly `threshold`, which IS that lattice point,
// so this is the exact atom the retention creates rather than an approximation.
function discretizedRetainedSeverity(threshold: number): Float64Array {
  const J = Math.round(threshold / BIN);
  const f = new Float64Array(J + 1);
  const L = (k: number) => limitedExpectedValue(Math.min(k * BIN, threshold));
  f[0] = 1 - L(1) / BIN;
  for (let j = 1; j < J; j++) {
    f[j] = (2 * L(j) - L(j - 1) - L(j + 1)) / BIN;
  }
  let accumulated = 0;
  for (let j = 0; j < J; j++) accumulated += f[j];
  f[J] = Math.max(0, 1 - accumulated);
  return f;
}

// Panjer recursion for a Negative Binomial frequency (r, beta), mean = r*beta,
// variance = r*beta*(1+beta). a = beta/(1+beta), b = (r-1)*beta/(1+beta).
//
// severityPmf is indexed from 0 and CARRIES A MASS AT ZERO (f_0 > 0), which
// mean-preserving discretisation necessarily produces. Both f_0 corrections
// are therefore required and neither is optional:
//   g_0 = P_N(f_0) = (1 + beta(1 - f_0))^(-r)   — the NegBin pgf at f_0,
//         not (1+beta)^(-r), which is P_N(0) and only correct when f_0 == 0
//   each g_s is divided by (1 - a f_0)
// Dropping either silently reintroduces a bias of the same order as the one
// the mean-preserving discretisation exists to remove.
function panjerNegBinCompound(r: number, beta: number, severityPmf: Float64Array, maxBins: number): Float64Array {
  const a = beta / (1 + beta);
  const b = (r - 1) * beta / (1 + beta);
  const f0 = severityPmf[0];
  const g = new Float64Array(maxBins + 1);
  g[0] = Math.pow(1 + beta * (1 - f0), -r);
  const denom = 1 - a * f0;
  const M = severityPmf.length - 1;
  for (let s = 1; s <= maxBins; s++) {
    let sum = 0;
    const upper = Math.min(s, M);
    for (let j = 1; j <= upper; j++) {
      sum += (a + (b * j) / s) * severityPmf[j] * g[s - j];
    }
    g[s] = sum / denom;
  }
  return g;
}

export interface AggregateQuote {
  attachment: number;
  limit: number;
  expectedRetained: number;
  sdRetained: number;
  expectedCeded: number;
  premium: number;
}

// Quote Property's aggregate for a given occurrence-layer selection.
// `expectedGrossLoss` is the line's own actual-basis E[gross] for the year —
// BOTH bands — (same role as in WC's quoteAggregate); `level` indexes
// AGG_ATTACHMENT_LEVELS.Property. `layerExpectedCeded` is index-aligned to
// REINSURANCE_TOWER.Property.
export function quotePropertyAggregate(
  placed: boolean[],
  members: Member[],
  expectedGrossLoss: number,
  level: number,
  attachmentMultiples: readonly number[],
  layerExpectedCeded: readonly number[],
  termsRetained?: number,
): AggregateQuote {
  // E[R] is DERIVED from the layer prices, exactly like WC: retained = gross -
  // everything the PLACED layers cede. Kept on the caller's actual basis so
  // this cannot drift from the engine's own funding numbers.
  const layers = REINSURANCE_TOWER.Property;
  const on = (i: number) => i >= 0 && placed[i] === true && layers[i].purchasable;
  // ONE LAYER, answering attritional claims and catastrophe occurrences alike.
  const purchased = on(0);
  const layer = layers[0];
  const cededByPlaced = layers.reduce((s, _l, i) => s + (on(i) ? (layerExpectedCeded[i] ?? 0) : 0), 0);
  const expectedRetained = Math.max(1, expectedGrossLoss - cededByPlaced);

  // THE CAT SIDE'S RETAINED DISTRIBUTION, EXACT, under this placement — the
  // same layer, read on each event's occurrence total. Its mean
  // is this book's own — so the ATTRITIONAL side is what absorbs any gap between
  // the caller's E[R] and the model's: the held rate carries the MARKET's cat
  // load, this book's events are this book's. The gap is the book's realised
  // cat share against the 12% budget, and it is small; see property-cat-check.
  const catLayer = purchased
    ? { attachment: layer.attachment, ceiling: layer.attachment + layer.limit }
    : null;
  const catEvent = catEventRetained(members, catLayer, BIN);
  const catMean = PROPERTY_CAT_MODEL.eventsPerYear * catEvent.m1Retained;
  const catVariance = PROPERTY_CAT_MODEL.eventsPerYear * catEvent.m2Retained;
  const attritionalRetained = Math.max(1, expectedRetained - catMean);

  // ⚠ THE TREATY IS AGREED IN ADVANCE AND E[R] IS NOT. `termsBasis` sets the
  // attachment and the limit; `expectedRetained` sets the DISTRIBUTION those
  // terms sit on. They are the same number on the held path (nothing is passed)
  // and they differ on the experience path, where the gross rate is the unknown
  // of a root-find and an attachment riding on it re-prices itself mid-solve.
  // The $1M rounding below is exactly what turns that circularity into a
  // discontinuity — see quoteAggregate's header in reinsuranceTower for the
  // sawtooth it produces and the grid it was measured on.
  const termsBasis = Math.max(1, termsRetained ?? expectedRetained);

  // ACTUAL-BASIS frequency sufficient statistics (real RQ, real kPr baked into
  // each member's own lambda via expectedPropertyGrossLoss's own formula,
  // restated here rather than imported to avoid a dependency on the caller's
  // kPr threading — see propertyInternals.thetaFrequency).
  let sumLambda = 0, sumLambdaSq = 0;
  for (const member of members) {
    const tiv = member.exposureByLine.Property ?? 0;
    if (!(tiv > 0)) continue;
    const lambda = tiv * PM.frequencyPer1mTiv * propertyInternals.thetaFrequency(member.riskQuality);
    sumLambda += lambda;
    sumLambdaSq += lambda * lambda;
  }

  // The attritional side's retained severity: capped at the layer's attachment
  // when it is placed, at the claim's own $75M cap when it is not.
  const threshold = purchased ? Math.min(layer.attachment, PM.severityCap) : PM.severityCap;
  const severityPmf = discretizedRetainedSeverity(threshold);

  // NegBin fit by moments: Var[N] = E[N] + sum(lambda_i^2)/k (k = frailty
  // shape). beta = Var/mean - 1, r = mean/beta. sumLambda > 0 is required by
  // the caller (an enrolled Property book always has members with TIV > 0);
  // guard defensively rather than assert, since a zero-member book is a valid
  // (if unplayed) state.
  if (sumLambda <= 0) {
    const attachment = Math.round((termsBasis * attachmentMultiples[level]) / 1e6) * 1e6;
    const limit = termsBasis * AGG_LIMIT_MULTIPLE;
    return { attachment, limit, expectedRetained, sdRetained: 0, expectedCeded: 0, premium: 0 };
  }
  const beta = sumLambdaSq / (PM.memberFrequencyNoise.shape * sumLambda);
  const r = (sumLambda * sumLambda) / (sumLambdaSq / PM.memberFrequencyNoise.shape);

  const g = panjerNegBinCompound(r, beta, severityPmf, MAX_BINS);

  // Panjer's own mean (neutral severity x actual-basis frequency) generally
  // does not exactly equal the attritional target (severity here is neutral-RQ,
  // the target reflects the book's ACTUAL RQ mix) — rescale the dollar axis so
  // the distribution's mean matches it exactly, preserving the SHAPE (CV, skew)
  // the Panjer fit supplies. Same division of labour as WC's quoteAggregate:
  // shape from a neutral-basis model, level from the caller's actual-basis
  // figure. The target is E[R] LESS the cat side's exact mean, so the combined
  // distribution's mean is the engine's E[R] to the cent.
  let panjerMean = 0;
  for (let s = 0; s <= MAX_BINS; s++) panjerMean += g[s] * s * BIN;
  const scale = panjerMean > 0 ? attritionalRetained / panjerMean : 1;

  const attachment = Math.round((termsBasis * attachmentMultiples[level]) / 1e6) * 1e6;
  const limit = termsBasis * AGG_LIMIT_MULTIPLE;
  const top = attachment + limit;

  // The last lattice index strictly below the layer top. Everything at or above
  // the top cedes the full limit; see the header on why stopping here is exact.
  const below = Math.max(0, Math.ceil(top / BIN) - 1);

  // THE ATTRITIONAL SIDE, RE-BINNED onto the lattice after the rescale: a
  // rescaled point s x scale falls between two lattice points and is split
  // between them in the proportion that keeps its mean.
  const attritional = new Float64Array(below + 1);
  for (let s = 0; s <= MAX_BINS; s++) {
    const p = g[s];
    if (p <= 0) continue;
    const x = s * scale;
    const lo = Math.floor(x);
    if (lo > below) break;
    const frac = x - lo;
    attritional[lo] += p * (1 - frac);
    if (frac > 0 && lo + 1 <= below) attritional[lo + 1] += p * frac;
  }

  // THE CAT SIDE, annual, exact to the same index.
  const cat = catAnnualRetainedPmf(catEvent, below);

  // THE CONVOLUTION, fixed loop order, below the top only.
  const combined = new Float64Array(below + 1);
  for (let i = 0; i <= below; i++) {
    const a = attritional[i];
    if (a === 0) continue;
    for (let j = 0; i + j <= below; j++) {
      const b = cat[j];
      if (b !== 0) combined[i + j] += a * b;
    }
  }

  let massBelow = 0, eCeded = 0, eCeded2 = 0;
  for (let k = 0; k <= below; k++) {
    const p = combined[k];
    if (p === 0) continue;
    massBelow += p;
    const ceded = Math.max(0, Math.min(k * BIN - attachment, limit));
    eCeded += p * ceded;
    eCeded2 += p * ceded * ceded;
  }
  // Everything at or above the top: the full limit.
  const tail = Math.max(0, 1 - massBelow);
  eCeded += tail * limit;
  eCeded2 += tail * limit * limit;
  const variance = Math.max(0, eCeded2 - eCeded * eCeded);
  const sdCeded = Math.sqrt(variance);

  // sdRetained: reported for parity with WC's AggregateQuote shape (the UI
  // reads it). The two sides are independent, so their variances add: the
  // attritional side's from the rescaled Panjer distribution, the cat side's
  // exactly as lambda E[r^2] of a compound Poisson sum.
  let eRet2 = 0;
  for (let s = 0; s <= MAX_BINS; s++) {
    if (g[s] <= 0) continue;
    const dollar = s * BIN * scale;
    eRet2 += g[s] * dollar * dollar;
  }
  const attritionalVariance = Math.max(0, eRet2 - attritionalRetained * attritionalRetained);
  const sdRetained = Math.sqrt(attritionalVariance + catVariance);

  return {
    attachment, limit, expectedRetained, sdRetained,
    expectedCeded: eCeded,
    premium: eCeded + RISK_LOAD_LAMBDA * sdCeded,
  };
}

// Exported for the diagnostic that validates this module against Monte Carlo —
// nothing in the engine calls these directly.
export const propertyAggregateInternals = {
  BIN, MAX_BINS,
  neutralSeverityCdf, limitedExpectedValue, discretizedRetainedSeverity, panjerNegBinCompound,
};
