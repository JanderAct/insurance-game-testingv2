// Investment engine for Risk Pool Simulation v1
// Models a single portfolio as a blend of three asset classes (cash/bonds/
// equities), weighted by an allocation.
//
// Randomness lives at the ASSET-CLASS level: the market (one realized return
// per class) is drawn ONCE per year via simulateMarketReturns and SHARED across
// every active line. Each line then blends those shared returns by its own
// allocation (blendInvestmentReturn) against its own invested-asset base. So
// two lines with identical allocations earn identical return RATES (differing
// only in dollar income by asset base), and an equity-heavy line swings wider
// than a bond-heavy one because it is more exposed to the high-variance equity
// draw. Portfolios stay segregated per line (each owns its assets and picks its
// allocation); only the return draws are shared.

import { SeededRandom } from './random';
import type { AssetAllocation } from '../types/simulation';
import { ASSET_CLASS_ASSUMPTIONS, type AssetClassAssumption } from '../data/defaultAssumptions';

export interface InvestmentResult {
  returnRate: number;
  income: number;
}

// One realized NET return per asset class for a given year — the shared market.
export interface MarketReturns {
  cash: number;
  bonds: number;
  equities: number;
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

// Single-regime draw: one normal(mean, sd) per class per year, minus the
// class's fee, then clamped to the inert sanity rails. Equivalent to Excel's
// NORM.INV(RAND(), Mean, SD) − Fee. Crash-year adversity lives in the drawn
// distribution itself (whole-period historical mean/SD) — no downside regime.
function simulateAssetClassReturn(assumption: AssetClassAssumption, rng: SeededRandom): number {
  const netReturn = rng.normal(assumption.expectedReturn, assumption.standardDeviation) - assumption.feeRate;
  return clamp(netReturn, assumption.minReturn, assumption.maxReturn);
}

// Draw the shared market for one year: one realized return per asset class.
// Fixed draw order (cash, then bonds, then equities) so results stay
// reproducible per seed regardless of any line's allocation. Called ONCE per
// year with a single shared RNG — every line blends these same returns.
export function simulateMarketReturns(rng: SeededRandom): MarketReturns {
  return {
    cash: simulateAssetClassReturn(ASSET_CLASS_ASSUMPTIONS.cash, rng),
    bonds: simulateAssetClassReturn(ASSET_CLASS_ASSUMPTIONS.bonds, rng),
    equities: simulateAssetClassReturn(ASSET_CLASS_ASSUMPTIONS.equities, rng),
  };
}

// Blend the shared market returns by one line's allocation and asset base.
// Pure (no RNG): identical allocation -> identical returnRate, every time.
export function blendInvestmentReturn(
  investedAssets: number,
  allocation: AssetAllocation,
  market: MarketReturns,
): InvestmentResult {
  const normalized = normalizeAllocation(allocation);

  const returnRate =
    (normalized.cashPct / 100) * market.cash +
    (normalized.bondsPct / 100) * market.bonds +
    (normalized.equitiesPct / 100) * market.equities;

  const income = investedAssets * returnRate;

  return { returnRate, income };
}

// A `simulateInvestmentReturn(assets, allocation, rng)` wrapper — draw the
// market and blend it in one call — used to live here and was deleted unused.
// Do not restore it: the engine deliberately draws the market ONCE per year
// (simulateMarketReturns) and blends it per line (blendInvestmentReturn),
// because the market is shared across lines. A per-line wrapper that draws its
// own market re-seeds the market once per line and silently decorrelates them,
// which is the exact bug the two-function split exists to prevent.
