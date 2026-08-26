// Deterministic seeded pseudo-random number generator
// Uses a simple LCG (Linear Congruential Generator) for reproducibility

export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0; // ensure unsigned 32-bit integer
  }

  // Returns next pseudo-random number in [0, 1)
  next(): number {
    // LCG parameters from Numerical Recipes
    this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  // Returns random float in [min, max)
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Returns random integer in [min, max] inclusive
  intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1 - 1e-10));
  }

  // Returns true with probability p
  chance(p: number): boolean {
    return this.next() < p;
  }

  // Returns a sample from a normal distribution using Box-Muller transform
  normal(mean: number, stdDev: number): number {
    const u1 = Math.max(this.next(), 1e-10);
    const u2 = this.next();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  // Returns a sample from a lognormal distribution
  lognormal(logMean: number, logSigma: number): number {
    return Math.exp(this.normal(logMean, logSigma));
  }

  // Returns a sample from a Gamma distribution using the Marsaglia-Tsang
  // method. Shape and scale must both be positive.
  gamma(shape: number, scale: number): number {
    if (shape <= 0 || scale <= 0) return 0;

    if (shape < 1) {
      const u = Math.max(this.next(), 1e-10);
      return this.gamma(shape + 1, scale) * Math.pow(u, 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      const x = this.normal(0, 1);
      const vBase = 1 + c * x;
      if (vBase <= 0) continue;

      const v = vBase * vBase * vBase;
      const u = this.next();

      if (u < 1 - 0.0331 * x * x * x * x) {
        return d * v * scale;
      }

      if (Math.log(Math.max(u, 1e-10)) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v * scale;
      }
    }
  }

  // Returns a sample from a Poisson distribution with the given mean.
  // Knuth's product method below lambda 30 (exact, and lambda is small in
  // practice — per-member-per-class claim counts); a normal approximation
  // with continuity correction above, where Knuth's loop would be slow and
  // the approximation is close (relative error in the mean under 1%).
  poisson(lambda: number): number {
    if (!(lambda > 0)) return 0;
    if (lambda < 30) {
      const limit = Math.exp(-lambda);
      let product = this.next();
      let count = 0;
      while (product > limit) {
        count++;
        product *= this.next();
      }
      return count;
    }
    return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
  }

  // Returns an index into `weights`, chosen with probability proportional to
  // each weight. Weights need not be normalised; non-positive total returns 0.
  // One draw per call — a multinomial over N trials is N calls.
  categorical(weights: number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (!(total > 0)) return 0;
    const target = this.next() * total;
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += Math.max(0, weights[i]);
      if (target < cumulative) return i;
    }
    return weights.length - 1;
  }

  // Returns a sample from a Pareto distribution with minimum x_m and tail
  // index alpha, via the inverse CDF: x_m * u^(-1/alpha). Note the tail is
  // heavy by design: for alpha <= 2 the variance is INFINITE (and for
  // alpha <= 1 even the mean is), so verification of Pareto-driven figures
  // must rest on medians/quantiles/tail counts, never on tight sample-mean
  // assertions.
  pareto(xm: number, alpha: number): number {
    if (!(xm > 0) || !(alpha > 0)) return 0;
    const u = Math.max(this.next(), 1e-12);
    return xm * Math.pow(u, -1 / alpha);
  }

  // Returns a sample from a Beta(a, b) distribution, via the standard gamma
  // ratio X/(X+Y) with X ~ Gamma(a,1), Y ~ Gamma(b,1). Consumes the gamma
  // stream twice per draw.
  //
  // Property's damage ratio uses the MEAN-CONCENTRATION parameterization —
  // a = mu * nu, b = (1 - mu) * nu — so mu is the mean and nu controls
  // dispersion (see betaFromMeanConcentration below).
  //
  // BEWARE alpha < 1. At a < 1 the density is UNBOUNDED at 0 (proportional to
  // t^(a-1)), and Property's attritional ratio runs a = 0.08. That is a
  // perfectly well-behaved integrable singularity for SAMPLING, but it breaks
  // fixed-grid quadrature: integrating the density from 0 outward through the
  // spike underestimates the mass there, deflating the CDF and inflating the
  // survival function. A first attempt at the per-risk breach rate did exactly
  // this and returned 21.8 breaches/yr against a true 1.78 — a 12x error that
  // looked plausible. VERIFY BETA QUANTITIES BY MONTE CARLO OR CLOSED FORM
  // (E[X] = mu exactly), never by naive quadrature over the density.
  //
  // VALIDATED AT SMALL SHAPE — hypothesis closed, do not re-litigate. Because
  // gamma() uses the Marsaglia-Tsang boost G(a) = G(a+1) x u^(1/a), shape 0.08
  // computes u^12.5, which would amplify any weakness in the uniform's bits and
  // could shave the right tail while leaving the mean intact. Tested directly
  // at Beta(0.08, 1.92), 5,000,000 draws through the real deriveSubRng path,
  // against exact incomplete-beta values:
  //   mean 0.040027 vs 0.040000 exact (z = 0.54)
  //   P(X>0.02) 21.4561% vs 21.4547%   P(X>0.10) 11.1483% vs 11.1506%
  //   P(X>0.40)  2.8025% vs  2.7970%   — every |z| < 1.5
  //   P(X<1e-6) 35.5933% vs 35.6148%, tracking correctly down to 1e-100
  // The boost's resolution is not a constraint either: over 2M draws max u is
  // 0.999999463791, so 1-u = 5.4e-7 and u^12.5 reaches 0.999993. Truncation
  // would require 1-u around 1e-3. An 8% right-tail deficit would have shown
  // as z ~ -70 at t = 0.40.
  //
  // ⚠ SCOPE OF THAT VALIDATION: WITHIN-STREAM QUALITY ONLY. Those 5,000,000
  // draws came from ONE long stream, so they establish that a single stream's
  // orbit is sound. They say NOTHING about how streams are SEEDED RELATIVE TO
  // EACH OTHER, which is an independent property and needs its own test.
  //
  // That gap was real, not hypothetical. When member-level streams became keyed
  // per member ('pr_sev:member-001', ':member-002', ...), the generators began
  // taking a handful of draws from each of 200 streams instead of a long orbit
  // from one — and the unfinalized hash gave those 200 seeds a lag-1
  // correlation of 0.9908, which u^12.5 turned into a mean of 0.005639 against
  // 0.040000 exact. See the finalizer note on deriveSubRng below, and the
  // permanent per-key dispersion regression test in
  // scripts/diagnostics/enrolment-independence-check.ts.
  //
  // A VALIDATION THAT EXERCISES ONE STREAM CANNOT DETECT A DEFECT IN HOW
  // STREAMS ARE SEEDED RELATIVE TO EACH OTHER.
  beta(a: number, b: number): number {
    if (!(a > 0) || !(b > 0)) return 0;
    const x = this.gamma(a, 1);
    const y = this.gamma(b, 1);
    const s = x + y;
    return s > 0 ? x / s : 0;
  }

  // Shuffles array in place (Fisher-Yates)
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.intRange(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Pick one element from an array
  pick<T>(arr: T[]): T {
    return arr[this.intRange(0, arr.length - 1)];
  }
}

// Murmur3's 32-bit finalizer. AVALANCHE: a one-bit change anywhere in the
// input flips about half the output bits.
//
// ⚠ THIS IS LOAD-BEARING, NOT DECORATION. See deriveSubRng below.
function fmix32(h: number): number {
  h = h >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// Derive a sub-RNG for a specific purpose within a year.
//
// ⚠ WHY THE FINALIZER EXISTS — DO NOT REMOVE IT.
//
// `hash * 31 + charCode` is a weak multiplicative string hash: keys that differ
// only in their trailing characters produce seeds that differ by a small
// increment. An LCG's FIRST output is a near-affine function of its seed, so
// nearby seeds give nearly identical first draws.
//
// That was harmless while every label opened ONE stream per year and consumed a
// long orbit from it. It stopped being harmless when member-level streams became
// keyed per member ('pr_sev:member-001', 'pr_sev:member-002', ...), because the
// generators then take only a HANDFUL of draws from each of 200 streams — i.e.
// they sample the first few outputs of 200 nearly-identical LCGs.
//
// Measured on the unfinalized hash, 200 member keys at one seed and year:
//   first uniforms 0.1957, 0.1961, 0.1965, 0.1969, ...  (an arithmetic run)
//   lag-1 correlation across consecutive member ids: 0.9908
//   mean of one Beta(0.08, 1.92) draw per member: 0.005639 vs 0.040000 exact
// The Beta blowup is the SeededRandom.beta warning made real: Marsaglia-Tsang's
// small-shape boost computes u^(1/0.08) = u^12.5, which amplifies any weakness
// in the uniform's bits. Property's damage ratio runs exactly that shape, and
// the property harness failed four distributional checks because of it — drawn
// weather gross ran +62% against its analytic.
//
// With fmix32 the same measurements read: first-mean 0.5120, lag-1 correlation
// -0.0306, Beta mean 0.036290 (n = 200, well inside one SE of 0.040000).
//
// The validation recorded on SeededRandom.beta was performed on ONE long stream,
// which is why it did not catch this: the weakness is in seed DISPERSION across
// keys, not in the orbit of any single stream.
export function deriveSubRng(baseSeed: number, yearNumber: number, purpose: string): SeededRandom {
  let hash = (baseSeed * 2654435761) >>> 0;
  hash = (hash ^ (yearNumber * 40503)) >>> 0;
  for (let i = 0; i < purpose.length; i++) {
    hash = (hash * 31 + purpose.charCodeAt(i)) >>> 0;
  }
  return new SeededRandom(fmix32(hash));
}
