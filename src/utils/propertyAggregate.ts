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

import { PROPERTY_LOSS_MODEL } from '../data/defaultAssumptions';
import { AGG_LIMIT_MULTIPLE, RISK_LOAD_LAMBDA } from '../data/reinsuranceTower';
import { normalCdf } from './claimMath';
import { propertyInternals } from './propertyClaimEngine';
import type { Member } from '../types/simulation';

const PM = PROPERTY_LOSS_MODEL;

// Discretization bin width. Fine enough that rounding the final attachment to
// the nearest whole $1M (see the caller) is not sensitive to it: at $50k bins,
// 20 bins per $1M.
const BIN = 50_000;
// Retained loss up to $200M/yr covers every playable scenario with wide margin
// (even fully declining the layer, ~37 claims/yr capped individually at the
// $75M severity cap does not realistically sum anywhere near this).
const MAX_BINS = Math.round(200_000_000 / BIN);

// Neutral-RQ mixture CDF, F(x) = P(raw severity <= x). Used only to build the
// discretized RETAINED severity below, never to draw anything.
function neutralSeverityCdf(x: number): number {
  if (!(x > 0)) return 0;
  const lnX = Math.log(x);
  let f = 0;
  for (const c of PM.severityMixture) {
    f += c.weight * normalCdf((lnX - c.mu) / c.sigma);
  }
  return f;
}

// Discretized pmf of min(raw severity, threshold), in BIN-sized buckets,
// buckets[j] = P(retained in bucket j+1), j = 0..J-1, J = threshold/BIN.
// The top bucket absorbs BOTH "raw severity landed just under threshold" and
// "raw severity capped at threshold" — the two are indistinguishable at BIN
// resolution and both retain (approximately) `threshold`, which is exactly
// what makes this a valid discretization of an atom at `threshold`.
function discretizedRetainedSeverity(threshold: number): Float64Array {
  const J = Math.round(threshold / BIN);
  const out = new Float64Array(J);
  let prevCdf = 0;
  for (let j = 1; j < J; j++) {
    const cdf = neutralSeverityCdf(j * BIN);
    out[j - 1] = cdf - prevCdf;
    prevCdf = cdf;
  }
  out[J - 1] = 1 - prevCdf;
  return out;
}

// Panjer recursion for a Negative Binomial frequency (r, beta), mean = r*beta,
// variance = r*beta*(1+beta). a = beta/(1+beta), b = (r-1)*beta/(1+beta).
// severityPmf[j] = P(one occurrence's retained severity is in bucket j+1);
// severityPmf has no j=0 (zero-severity) term, since every occurrence here has
// positive retained severity, which is what keeps the recursion's g_0 = p_0
// term exact (the general Panjer formula's f_0 correction is for a possible
// mass at zero, absent here).
function panjerNegBinCompound(r: number, beta: number, severityPmf: Float64Array, maxBins: number): Float64Array {
  const a = beta / (1 + beta);
  const b = (r - 1) * beta / (1 + beta);
  const g = new Float64Array(maxBins + 1);
  g[0] = Math.pow(1 + beta, -r);
  const M = severityPmf.length;
  for (let s = 1; s <= maxBins; s++) {
    let sum = 0;
    const upper = Math.min(s, M);
    for (let j = 1; j <= upper; j++) {
      sum += (a + (b * j) / s) * severityPmf[j - 1] * g[s - j];
    }
    g[s] = sum;
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
// `expectedGrossLoss` is the line's own actual-basis E[gross] for the year
// (same role as in WC's quoteAggregate); `level` indexes
// AGG_ATTACHMENT_LEVELS.Property.
export function quotePropertyAggregate(
  placed: boolean[],
  members: Member[],
  expectedGrossLoss: number,
  level: number,
  attachmentMultiples: readonly number[],
  layerExpectedCeded: number,
): AggregateQuote {
  // E[R] is DERIVED from the layer price, exactly like WC: retained = gross -
  // everything the occurrence layer cedes. Kept on the caller's actual basis so
  // this cannot drift from the engine's own funding numbers.
  const purchased = placed[0] === true;
  const expectedRetained = Math.max(1, expectedGrossLoss - (purchased ? layerExpectedCeded : 0));

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

  const threshold = purchased ? PM.perRiskRetention : PM.severityCap;
  const severityPmf = discretizedRetainedSeverity(threshold);

  // NegBin fit by moments: Var[N] = E[N] + sum(lambda_i^2)/k (k = frailty
  // shape). beta = Var/mean - 1, r = mean/beta. sumLambda > 0 is required by
  // the caller (an enrolled Property book always has members with TIV > 0);
  // guard defensively rather than assert, since a zero-member book is a valid
  // (if unplayed) state.
  if (sumLambda <= 0) {
    const attachment = Math.round((expectedRetained * attachmentMultiples[level]) / 1e6) * 1e6;
    const limit = expectedRetained * AGG_LIMIT_MULTIPLE;
    return { attachment, limit, expectedRetained, sdRetained: 0, expectedCeded: 0, premium: 0 };
  }
  const beta = sumLambdaSq / (PM.memberFrequencyNoise.shape * sumLambda);
  const r = (sumLambda * sumLambda) / (sumLambdaSq / PM.memberFrequencyNoise.shape);

  const g = panjerNegBinCompound(r, beta, severityPmf, MAX_BINS);

  // Panjer's own mean (neutral severity x actual-basis frequency) generally
  // does not exactly equal expectedRetained (severity here is neutral-RQ,
  // expectedRetained reflects the book's ACTUAL RQ mix) — rescale the dollar
  // axis so the distribution's mean matches the engine's own E[R] exactly,
  // preserving the SHAPE (CV, skew) the Panjer fit supplies. Same division of
  // labour as WC's quoteAggregate: shape from a neutral-basis model, level
  // from the caller's actual-basis figure.
  let panjerMean = 0;
  for (let s = 0; s <= MAX_BINS; s++) panjerMean += g[s] * s * BIN;
  const scale = panjerMean > 0 ? expectedRetained / panjerMean : 1;

  const attachment = Math.round((expectedRetained * attachmentMultiples[level]) / 1e6) * 1e6;
  const limit = expectedRetained * AGG_LIMIT_MULTIPLE;
  const top = attachment + limit;

  let eCeded = 0, eCeded2 = 0;
  for (let s = 0; s <= MAX_BINS; s++) {
    if (g[s] <= 0) continue;
    const dollar = s * BIN * scale;
    const ceded = Math.max(0, Math.min(dollar, top) - attachment);
    eCeded += g[s] * ceded;
    eCeded2 += g[s] * ceded * ceded;
  }
  const variance = Math.max(0, eCeded2 - eCeded * eCeded);
  const sdCeded = Math.sqrt(variance);

  // sdRetained: reported for parity with WC's AggregateQuote shape (the UI
  // reads it), computed the same rescaled way as E[ceded] above rather than
  // re-deriving a second SD from the raw moment formulas.
  let eRet2 = 0;
  for (let s = 0; s <= MAX_BINS; s++) {
    if (g[s] <= 0) continue;
    const dollar = s * BIN * scale;
    eRet2 += g[s] * dollar * dollar;
  }
  const sdRetained = Math.sqrt(Math.max(0, eRet2 - expectedRetained * expectedRetained));

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
  neutralSeverityCdf, discretizedRetainedSeverity, panjerNegBinCompound,
};
