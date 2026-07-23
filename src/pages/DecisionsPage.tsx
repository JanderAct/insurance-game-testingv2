import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw } from 'lucide-react';
import type { DecisionSet, LineDecisionSet, CoverageLine } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import AllocationBar from '../components/AllocationBar';
import { SLIDER_RANGES, REINSURANCE_PROGRAMS, FULL_TRANSFER_COST_PCT_OF_PREMIUM, SELF_FUNDED_DISCOUNT_PCT } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { getReinsuranceStructure } from '../utils/reinsuranceEngine';
import { defaultLineDecisionSet } from '../utils/decisionDefaults';

export interface LineLoanInfo {
  balance: number;
  dividendBlocked: boolean;
}

interface DecisionsPageProps {
  decisions: DecisionSet;
  onChange: (d: DecisionSet) => void;
  yearNumber: number;
  estimatedPremium: number;
  estimatedExpectedLoss: number;
  disabled?: boolean;
  // Stage 2.9: decisions are all per-line, so this page has no Pool view —
  // it always shows a specific coverage line.
  lineView: CoverageLine;
  lineLoanInfo: Record<CoverageLine, LineLoanInfo>;
}

const FUNDING_LEVEL_LABELS: Record<number, string> = {
  0.50: 'Very Low', 0.55: 'Low', 0.60: 'Below Average', 0.65: 'Moderate-Low', 0.70: 'Moderate', 0.75: 'Balanced', 0.80: 'Above Average', 0.85: 'High', 0.90: 'Very High', 0.95: 'Maximum',
};

function getFundingLabel(v: number): string {
  const rounded = Math.round(v * 20) / 20;
  return FUNDING_LEVEL_LABELS[rounded] ?? v.toFixed(2);
}

const UW_LABELS = ['Very Flexible', 'Flexible', 'Somewhat Flexible', 'Moderate-Flexible', 'Moderate', 'Moderate-Strict', 'Somewhat Strict', 'Strict', 'Very Strict', 'Extremely Strict', 'Maximum Strict'];

// Reset only the given line to defaults (Model A strict per-line: resetting on
// one line's tab must not clobber the other lines' choices).
function resetLineToDefaults(decisions: DecisionSet, line: CoverageLine): DecisionSet {
  return {
    ...decisions,
    byLine: {
      ...decisions.byLine,
      [line]: defaultLineDecisionSet(),
    },
  };
}

export default function DecisionsPage({ decisions, onChange, yearNumber, estimatedPremium, estimatedExpectedLoss, disabled = false, lineView, lineLoanInfo }: DecisionsPageProps) {
  // Stage 2.7: every active line's decisions are edited on its own tab. The
  // page always shows one specific line (lineView); all controls read and
  // write that line's slice of decisions.byLine.
  const selectedLine: CoverageLine = lineView;
  const d = decisions.byLine[selectedLine];
  const selectedLoanInfo = lineLoanInfo[selectedLine];

  const set = (key: keyof LineDecisionSet, val: number | LineDecisionSet['assetAllocation']) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, [key]: val } } });

  // Asset allocation is a per-line decision (Stage 2.9) — the bar edits the
  // selected line's own segregated portfolio.
  const setAllocation = (allocation: LineDecisionSet['assetAllocation']) => set('assetAllocation', allocation);

  const reinsStructure = getReinsuranceStructure(d.reinsuranceLevel, estimatedPremium, estimatedExpectedLoss);
  const prog = REINSURANCE_PROGRAMS[d.reinsuranceLevel];
  const reinsCostPct = prog ? (prog.costPctOfPremiumMin + prog.costPctOfPremiumMax) / 2 : 0;
  const reinsCost = estimatedPremium * reinsCostPct;
  const retainedSharePct = 1 - reinsStructure.recoveryPct;
  const selfFundedDiscount = retainedSharePct * FULL_TRANSFER_COST_PCT_OF_PREMIUM * estimatedPremium * SELF_FUNDED_DISCOUNT_PCT;

  const rateDisplay = (v: number) => v >= 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`;
  const pctDisplay = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Year {yearNumber} Decisions — {lineView}</h2>
          <p className="text-gray-500 text-sm">Configure this line's strategy for the year</p>
        </div>
        {!disabled && (
          <button onClick={() => onChange(resetLineToDefaults(decisions, selectedLine))} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset {selectedLine} to Defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Pricing & Funding" icon={<DollarSign size={16} />}>
          <SliderInput label="Rate Change" value={d.rateChange} min={SLIDER_RANGES.rateChange.min} max={SLIDER_RANGES.rateChange.max} step={SLIDER_RANGES.rateChange.step} onChange={v => set('rateChange', v)} formatValue={rateDisplay} leftLabel="Decrease" rightLabel="Increase" valueColor={d.rateChange > 0.05 ? 'text-amber-600' : d.rateChange < -0.05 ? 'text-blue-600' : 'text-gray-700'} disabled={disabled} helpText="Higher rates improve premium adequacy but reduce member retention." />
          <SliderInput label="Funding Confidence Level" value={d.fundingConfidenceLevel} min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step} onChange={v => set('fundingConfidenceLevel', v)} formatValue={v => `${getFundingLabel(v)} (${(v * 100).toFixed(0)}%)`} leftLabel="Lower Confidence" rightLabel="Higher Confidence" disabled={disabled} helpText="Sets the reserve confidence level. Higher levels strengthen the balance sheet." />
          <SliderInput label="Dividend / Return of Pool Premium" value={d.dividendPct} min={SLIDER_RANGES.dividendPct.min} max={SLIDER_RANGES.dividendPct.max} step={SLIDER_RANGES.dividendPct.step} onChange={v => set('dividendPct', v)} formatValue={pctDisplay} leftLabel="None" rightLabel="High" valueColor={d.dividendPct > 0 ? 'text-emerald-600' : 'text-gray-500'} disabled={disabled || selectedLoanInfo.dividendBlocked} helpText="Returns value to members." />
          {selectedLoanInfo.dividendBlocked && (
            <p className="text-xs text-red-600 -mt-3">Dividend blocked: this line carried a negative surplus in from last year.</p>
          )}
          <SliderInput label="Assessment" value={d.assessmentPct} min={SLIDER_RANGES.assessmentPct.min} max={SLIDER_RANGES.assessmentPct.max} step={SLIDER_RANGES.assessmentPct.step} onChange={v => set('assessmentPct', v)} formatValue={pctDisplay} leftLabel="None" rightLabel="High" valueColor={d.assessmentPct > 0 ? 'text-red-600' : 'text-gray-500'} disabled={disabled} helpText="Additional calls on members beyond premium." />
        </SectionCard>

        <SectionCard title="Growth & Underwriting" icon={<TrendingUp size={16} />}>
          <SliderInput label="Underwriting Strictness" value={d.underwritingStrictness} min={SLIDER_RANGES.underwritingStrictness.min} max={SLIDER_RANGES.underwritingStrictness.max} step={SLIDER_RANGES.underwritingStrictness.step} onChange={v => set('underwritingStrictness', v)} formatValue={v => `${v}/10 — ${UW_LABELS[Math.round(v)]}`} leftLabel="Flexible" rightLabel="Strict" disabled={disabled} helpText="Strict underwriting improves risk quality." />
          <SliderInput label="Risk Control Investment" value={d.riskControlPct} min={SLIDER_RANGES.riskControlPct.min} max={SLIDER_RANGES.riskControlPct.max} step={SLIDER_RANGES.riskControlPct.step} onChange={v => set('riskControlPct', v)} formatValue={pctDisplay} leftLabel="Low" rightLabel="High" valueColor={d.riskControlPct > 0.03 ? 'text-emerald-600' : 'text-gray-600'} disabled={disabled} helpText="Investment in member safety and training." />
        </SectionCard>

        {outstandingLoanSlider(d, set, selectedLoanInfo, disabled)}

        <SectionCard title="Reinsurance Program" icon={<Shield size={16} />}>
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reinsurance Level</p>
            <div className="grid grid-cols-5 gap-1">
              {REINSURANCE_PROGRAMS.map(prog => (
                <button key={prog.level} disabled={disabled} onClick={() => !disabled && set('reinsuranceLevel', prog.level)} className={`flex flex-col items-center p-2 rounded-lg border text-center transition-all text-xs ${d.reinsuranceLevel === prog.level ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
                  <span className="font-bold">{prog.label}</span>
                  <span className="text-xs opacity-75 mt-0.5 leading-tight hidden sm:block">{prog.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-1">
            {d.reinsuranceLevel > 0 ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <DataRow label="Attachment Point" value={formatCurrency(reinsStructure.attachment)} />
                <DataRow label="Attachment (% of Exp. Loss)" value={`${(REINSURANCE_PROGRAMS[d.reinsuranceLevel].attachmentMultiplierOfExpectedLoss * 100).toFixed(0)}%`} />
                <DataRow label="Quota Share % (Pool Retains)" value={`${((1 - reinsStructure.recoveryPct) * 100).toFixed(0)}%`} />
                <DataRow label="Coverage" value="Uncapped above attachment" />
                <DataRow label="Est. Annual Cost" value={`${formatCurrency(reinsCost)}/yr (${(reinsCostPct * 100).toFixed(0)}% of prem.)`} />
                <DataRow label="Self-Funded Discount" value={`(${formatCurrency(selfFundedDiscount)})/yr`} />
                <DataRow label="Net Cost to Members" value={`${formatCurrency(reinsCost - selfFundedDiscount)}/yr`} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <DataRow label="Attachment Point" value={formatCurrency(reinsStructure.attachment)} />
                <DataRow label="Attachment (% of Exp. Loss)" value={`${(REINSURANCE_PROGRAMS[0].attachmentMultiplierOfExpectedLoss * 100).toFixed(0)}%`} />
                <DataRow label="Self-Funded Amount" value={`${formatCurrency(estimatedPremium * REINSURANCE_PROGRAMS[4].costPctOfPremiumMax)}/yr`} />
                <DataRow label="Self-Funded Discount" value={`(${formatCurrency(selfFundedDiscount)})/yr`} />
                <p className="col-span-2 text-gray-500 italic mt-1">No external reinsurance — the pool retains all losses up to 125% of expected loss. Instead of paying the self-funded amount to a reinsurer, it (net of the discount) stays in the pool's cash and earns investment income for the pool's own account.</p>
              </div>
            )}
            <p className="text-blue-700 mt-2 text-xs leading-relaxed border-t border-blue-100 pt-2">Reinsurance does not reduce gross losses. Above the attachment point, the reinsurer pays its quota share of the excess; the pool retains the rest.</p>
          </div>
        </SectionCard>

        <SectionCard title="Investment Allocation" icon={<BarChart2 size={16} />}>
          <p className="text-xs text-gray-500 -mt-2">
            This allocation applies to the {lineView} line's own segregated investment portfolio — each line invests separately and keeps its own gains and losses.
          </p>
          <AllocationBar value={d.assetAllocation} onChange={setAllocation} disabled={disabled} />
        </SectionCard>
      </div>
    </div>
  );
}

// The loan-repayment slider is only shown while the selected line carries an
// outstanding inter-line loan balance.
function outstandingLoanSlider(
  d: LineDecisionSet,
  set: (key: keyof LineDecisionSet, val: number) => void,
  loanInfo: LineLoanInfo,
  disabled: boolean
) {
  if (loanInfo.balance <= 0) return null;
  return (
    <SectionCard title="Inter-Line Loan Repayment" icon={<Shield size={16} />}>
      <p className="text-xs text-amber-700">
        This line has an outstanding inter-line loan of {formatCurrency(loanInfo.balance)}.
      </p>
      <SliderInput
        label="Loan Repayment Aggressiveness"
        value={d.loanRepaymentAggressiveness}
        min={0} max={1} step={0.05}
        onChange={v => set('loanRepaymentAggressiveness', v)}
        formatValue={v => `${(v * 100).toFixed(0)}%`}
        leftLabel="Slow" rightLabel="Fast"
        disabled={disabled}
        helpText="Share of this line's positive net income used to repay the loan before it flows to the line's own surplus."
      />
    </SectionCard>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}:</span>
      <span className="font-semibold text-gray-800">{value}</span>
    </div>
  );
}
