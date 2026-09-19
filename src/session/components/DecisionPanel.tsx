// ============================================================================
// THE PLAYER'S DECISION CONTROLS.
//
// ⚠ SCOPE, STATED PLAINLY: this is the primary lever set, not the solo game's
// full DecisionsPage. That page takes thirteen props, most of them derived
// inside App.tsx from a live GameState — the funding-consequence panel, the
// reinsurance tower priced off the enrolled book, renewal underwriting's live
// decline counts, new-business appetite's applicant pool. Reproducing that
// derivation here would have been the bulk of this work and none of it would
// have been session layer.
//
// WHAT MATTERS FOR CORRECTNESS IS THAT THE OBJECT IS REAL. The DecisionSet
// edited here is the engine's own type, built by the engine's own
// defaultDecisionSet, carrying every field the engine reads — the untouched ones
// keep their real defaults rather than being absent. processYear receives
// exactly this object. Widening the control surface is UI work against a
// DecisionSet that already round-trips correctly.
// ============================================================================

import { SLIDER_RANGES } from '../../data/defaultAssumptions';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import type { CoverageLine, DecisionSet } from '../../types/simulation';

interface Props {
  decisions: DecisionSet;
  activeLines: CoverageLine[];
  disabled: boolean;
  onChange: (d: DecisionSet) => void;
}

export default function DecisionPanel({ decisions, activeLines, disabled, onChange }: Props) {
  function setLine(line: CoverageLine, patch: Partial<DecisionSet['byLine'][CoverageLine]>) {
    onChange({
      ...decisions,
      byLine: { ...decisions.byLine, [line]: { ...decisions.byLine[line], ...patch } },
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- pool-wide ---- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pool-wide</p>

        <label className="mt-3 block">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Risk control</span>
            <span data-testid="risk-control-value" className="font-medium text-slate-800">
              {(decisions.riskControlPct * 100).toFixed(0)}% of premium
            </span>
          </div>
          <input
            data-testid="risk-control"
            type="range"
            className="mt-1 w-full"
            min={SLIDER_RANGES.riskControlPct.min}
            max={SLIDER_RANGES.riskControlPct.max}
            step={SLIDER_RANGES.riskControlPct.step}
            value={decisions.riskControlPct}
            disabled={disabled}
            onChange={e => onChange({ ...decisions, riskControlPct: Number(e.target.value) })}
          />
        </label>

        <div className="mt-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Equities</span>
            <span data-testid="equities-value" className="font-medium text-slate-800">
              {decisions.assetAllocation.equitiesPct}%
            </span>
          </div>
          {/* Cash is held and bonds absorb the remainder, so the three always
              sum to 100 without a second control to keep in step. */}
          <input
            data-testid="equities"
            type="range"
            className="mt-1 w-full"
            min={0}
            max={100 - decisions.assetAllocation.cashPct}
            step={5}
            value={decisions.assetAllocation.equitiesPct}
            disabled={disabled}
            onChange={e => {
              const equitiesPct = Number(e.target.value);
              onChange({
                ...decisions,
                assetAllocation: {
                  ...decisions.assetAllocation,
                  equitiesPct,
                  bondsPct: 100 - decisions.assetAllocation.cashPct - equitiesPct,
                },
              });
            }}
          />
          <p className="mt-1 text-xs text-slate-400">
            {decisions.assetAllocation.cashPct}% cash · {decisions.assetAllocation.bondsPct}% bonds
          </p>
        </div>
      </div>

      {/* ---- per line ---- */}
      {activeLines.map(line => {
        const d = decisions.byLine[line];
        return (
          <div key={line} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{LINE_FULL_NAME[line]}</p>

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input
                data-testid={`funding-expected-${line}`}
                type="checkbox"
                checked={d.fundingAtExpected}
                disabled={disabled}
                onChange={e => setLine(line, { fundingAtExpected: e.target.checked })}
              />
              Fund at expected loss
            </label>

            {!d.fundingAtExpected && (
              <label className="mt-3 block">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Funding confidence</span>
                  <span data-testid={`funding-value-${line}`} className="font-medium text-slate-800">
                    {(d.fundingConfidenceLevel * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  data-testid={`funding-${line}`}
                  type="range"
                  className="mt-1 w-full"
                  min={SLIDER_RANGES.fundingConfidenceLevel.min}
                  max={SLIDER_RANGES.fundingConfidenceLevel.max}
                  step={SLIDER_RANGES.fundingConfidenceLevel.step}
                  value={d.fundingConfidenceLevel}
                  disabled={disabled}
                  onChange={e => setLine(line, { fundingConfidenceLevel: Number(e.target.value) })}
                />
              </label>
            )}

            <label className="mt-3 block">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Dividend</span>
                <span data-testid={`dividend-value-${line}`} className="font-medium text-slate-800">
                  {(d.dividendPct * 100).toFixed(1)}% of premium
                </span>
              </div>
              <input
                data-testid={`dividend-${line}`}
                type="range"
                className="mt-1 w-full"
                min={SLIDER_RANGES.dividendPct.min}
                max={SLIDER_RANGES.dividendPct.max}
                step={SLIDER_RANGES.dividendPct.step}
                value={d.dividendPct}
                disabled={disabled}
                onChange={e => setLine(line, { dividendPct: Number(e.target.value) })}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
