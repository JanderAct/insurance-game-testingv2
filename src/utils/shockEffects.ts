// Shared shock-effect arithmetic. A LEAF MODULE with no imports, so both loss
// engines can use it without either one depending on the shock catalog or the
// resolver — a line-local generator should know how to apply an effect, not
// where effects come from.

// The key a frequency multiplier uses when it targets a whole line rather than
// one sub-coverage.
export const WHOLE_LINE = '*';

// The factor for one sub-coverage: its own multiplier times any whole-line one.
// BOTH APPLY. An event targeting EPL and an event raising all of GL are two
// independent causes, and a claim is subject to both.
export function shockFactorFor(multipliers: Record<string, number>, sub: string): number {
  return (multipliers[sub] ?? 1) * (multipliers[WHOLE_LINE] ?? 1);
}
