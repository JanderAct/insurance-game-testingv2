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

// Create a child RNG derived from a parent seed and a year number
export function deriveYearRng(baseSeed: number, yearNumber: number): SeededRandom {
  const mixed = (baseSeed * 2654435761 + yearNumber * 40503) >>> 0;
  return new SeededRandom(mixed);
}

// Derive a sub-RNG for a specific purpose within a year
export function deriveSubRng(baseSeed: number, yearNumber: number, purpose: string): SeededRandom {
  let hash = (baseSeed * 2654435761) >>> 0;
  hash = (hash ^ (yearNumber * 40503)) >>> 0;
  for (let i = 0; i < purpose.length; i++) {
    hash = (hash * 31 + purpose.charCodeAt(i)) >>> 0;
  }
  return new SeededRandom(hash);
}
