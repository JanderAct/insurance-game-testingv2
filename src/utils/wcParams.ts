// PER-INSTANCE WC PARAMETERS — the overlay a future-horizon shock writes through.
//
// THE PROBLEM. WC_LOSS_MODEL is a module-level constant read directly by the
// generator. A Future event (#10, presumption expansion) has to change one of
// its numbers for the rest of THAT game without affecting any other game in the
// same browser session. Threading a parameter object through every function in
// wcClaimEngine would touch dozens of signatures; mutating the global would
// leak across games. This resolves at READ TIME instead.
//
// IDENTITY, NOT A COPY, WHEN THERE ARE NO OVERRIDES. getWcParams returns the
// module constant OBJECT ITSELF when nothing is overridden — not a spread, not a
// clone. That is what makes "no shock cannot move a number" true rather than
// hoped: there is no arithmetic, no re-serialisation, and nothing that could
// drift by a float.
//
// ---------------------------------------------------------------------------
// ⚠ THE OVERLAY REACHES ONLY READS LEXICALLY INSIDE generateWcClaims,
// expectedWcGrossLoss AND computeKLine.
//
// Those three shadow the module-level `M` with the resolved params, so every
// `M.x` in their own bodies picks up an override. Module-level HELPERS —
// thetaWc, tierProbabilities, catastrophicStream, weeklyBenefit, durationFactor,
// frequencyTrend — still close over the global and do NOT.
//
// So a path read in BOTH places would be half-overridden, which is worse than
// not overriding it at all: the draw would use one value and the severity model
// another. WC_OVERRIDABLE_PATHS is the allow-list of paths verified to be read
// ONLY inside those three functions, and getWcParams THROWS on anything else.
//
// TO ADD A PATH: grep every read of it. If any read is inside a module-level
// helper, make that helper take params before adding the path here. Do not
// widen the list on the assumption that it is probably fine.
// ---------------------------------------------------------------------------
//
// WHY WC AND NOT THE OTHER LINES. WC has zero module-load-time constants
// derived from its model, so shadowing is sufficient. GL has two —
// `baseThreshold` and `stageTrendFactor` — and Property has four
// (PAYOUT_TREND_FACTOR, WX_CAP_INTENSITY, WX_INTENSITY_FACTOR,
// WEATHER_PAYOUT_TREND_FACTOR). Those are computed once at import and would
// silently ignore any override. Before either line can accept a paramOverride,
// its caches must become memoised functions keyed on the resolved params.
// stageTrendFactor in particular runs 20,000-point quadrature per sub x stage,
// so it needs real memoisation rather than naive recomputation.

import { WC_LOSS_MODEL } from '../data/defaultAssumptions';

export type WcParams = typeof WC_LOSS_MODEL;

// Paths verified to be read ONLY inside generateWcClaims, expectedWcGrossLoss
// and computeKLine. See the warning above before adding to this.
//
//   presumption.ratePer1MPoliceFire — two reads: the lambda in the generator's
//   A5 block, and the frequency term in the analytic's presumption block. No
//   module-level helper touches it, which is exactly why the design doc calls
//   presumption "the legislative-shock hook".
export const WC_OVERRIDABLE_PATHS: ReadonlySet<string> = new Set([
  'presumption.ratePer1MPoliceFire',
]);

function setPath(target: Record<string, unknown>, path: string, value: number): void {
  const segments = path.split('.');
  let node = target;
  for (let i = 0; i < segments.length - 1; i++) {
    node = node[segments[i]] as Record<string, unknown>;
  }
  node[segments[segments.length - 1]] = value;
}

// The WC loss model as this instance-year sees it.
//
// Returns the GLOBAL BY IDENTITY when there is nothing to override, which is
// every call in a game with no future-horizon shock in force.
export function getWcParams(overrides?: Record<string, number>): WcParams {
  if (!overrides) return WC_LOSS_MODEL;
  const paths = Object.keys(overrides);
  if (paths.length === 0) return WC_LOSS_MODEL;

  for (const path of paths) {
    if (!WC_OVERRIDABLE_PATHS.has(path)) {
      throw new Error(
        `WC paramOverride path '${path}' is not in WC_OVERRIDABLE_PATHS. It may be read by a `
        + `module-level helper that the overlay does not reach, which would half-apply the override. `
        + `See the warning in src/utils/wcParams.ts before adding it.`,
      );
    }
  }

  const resolved = structuredClone(WC_LOSS_MODEL) as unknown as Record<string, unknown>;
  for (const path of paths) setPath(resolved, path, overrides[path]);
  return resolved as unknown as WcParams;
}
