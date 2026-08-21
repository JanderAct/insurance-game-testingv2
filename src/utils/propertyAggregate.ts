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
const BIN = 25_000;
// Retained loss up to $200M/yr covers every playable scenario with wide margin
// (even fully declining the layer, ~37 claims/yr capped individually at the
// $75M severity cap does not realistically sum anywhere near this).
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
  neutralSeverityCdf, limitedExpectedValue, discretizedRetainedSeverity, panjerNegBinCompound,
};
