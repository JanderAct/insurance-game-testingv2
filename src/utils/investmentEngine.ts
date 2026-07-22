// Investment engine for Risk Pool Simulation v1
// Models a single portfolio as a blend of three asset classes (cash/bonds/
// equities), weighted by an allocation. Stage 2.9: called once per active line
// with that line's own invested assets and its own allocation — portfolios are
// segregated per line, not commingled.

import { SeededRandom } from './random';
import type { AssetAllocation } from '../types/simulation';
import { ASSET_CLASS_ASSUMPTIONS, type AssetClassAssumption } from '../data/defaultAssumptions';

export interface InvestmentResult {
  returnRate: number;
  income: number;
  isShockYear: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Normalize an allocation to sum to 100 so a malformed/rounded input (e.g.
// from a UI bug or stale save) still blends sanely instead of over- or
// under-weighting the portfolio.
function normalizeAllocation(allocation: AssetAllocation): AssetAllocation {
  const total = allocation.cashPct + allocation.bondsPct + allocation.equitiesPct;
  if (total <= 0) return { cashPct: 100, bondsPct: 0, equitiesPct: 0 };
  return {
    cashPct: (allocation.cashPct / total) * 100,
    bondsPct: (allocation.bondsPct / total) * 100,
    equitiesPct: (allocation.equitiesPct / total) * 100,
  };
}

function simulateAssetClassReturn(assumption: AssetClassAssumption, rng: SeededRandom): { returnRate: number; isDownside: boolean } {
  const isDownside = assumption.downsideProbability > 0 && rng.chance(assumption.downsideProbability);

  const simulatedReturn = isDownside
    ? rng.normal(assumption.downsideMeanReturn, assumption.downsideStandardDeviation)
    : rng.normal(assumption.expectedReturn, assumption.standardDeviation);

  return {
    returnRate: clamp(simulatedReturn, assumption.minReturn, assumption.maxReturn),
    isDownside,
  };
}

export function simulateInvestmentReturn(
  investedAssets: number,
  allocation: AssetAllocation,
  rng: SeededRandom,
): InvestmentResult {
  const normalized = normalizeAllocation(allocation);

  // Fixed draw order (cash, then bonds, then equities) so results stay
  // reproducible per seed regardless of allocation.
  const cash = simulateAssetClassReturn(ASSET_CLASS_ASSUMPTIONS.cash, rng);
  const bonds = simulateAssetClassReturn(ASSET_CLASS_ASSUMPTIONS.bonds, rng);
  const equities = simulateAssetClassReturn(ASSET_CLASS_ASSUMPTIONS.equities, rng);

  const returnRate =
    (normalized.cashPct / 100) * cash.returnRate +
    (normalized.bondsPct / 100) * bonds.returnRate +
    (normalized.equitiesPct / 100) * equities.returnRate;

  const income = investedAssets * returnRate;

  return {
    returnRate,
    income,
    isShockYear: bonds.isDownside || equities.isDownside,
  };
}
